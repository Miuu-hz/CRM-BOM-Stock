import cron from 'node-cron'
import db from '../db/sqlite'
import { thaiDateStr } from '../utils/id'
import { getSubscription } from './subscription.service'
import { can } from './rbac.service'
import { lineBotService } from './line-bot.service'

// เตือนเฉพาะวันที่เหลือ 60/30/7 วัน และวันถัดจากหมดอายุ (-1) พอดี
// → เอกสาร 1 ใบถูกกล่าวถึงใน digest ได้อย่างมาก 4 ครั้งตลอดอายุ
// โควตา push (300/เดือน ทั้งระบบ) ถูกจำกัดด้วย: 1 ข้อความ/ผู้ใช้/บริษัท/วัน และตาราง hr_expiry_digest_runs กันซ้ำเมื่อรีสตาร์ต
const DUE_DAYS = [60, 30, 7, -1]
const MAX_LINES = 15

export interface ExpiryItem {
  employee_name: string
  kind: 'DOCUMENT' | 'TRAINING'
  title: string
  expires_on: string
  days_left: number
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10)
}

function daysBetween(fromStr: string, toStr: string): number {
  const [fy, fm, fd] = fromStr.split('-').map(Number)
  const [ty, tm, td] = toStr.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000)
}

export function collectExpiryDigest(tenantId: string, today: string): ExpiryItem[] {
  const dates = DUE_DAYS.map(n => addDays(today, n))
  const ph = dates.map(() => '?').join(',')
  const docs = db.prepare(`
    SELECT e.first_name, e.last_name, d.title, d.expires_on
    FROM hr_employee_documents d
    JOIN employees e ON e.id = d.employee_id AND e.tenant_id = d.tenant_id
    WHERE d.tenant_id = ? AND e.status = 'ACTIVE' AND d.expires_on IN (${ph})`).all(tenantId, ...dates) as any[]
  // เฉพาะบันทึกล่าสุดของ (พนักงาน, หลักสูตร) เหมือน GET /training/expiring
  const trainings = db.prepare(`
    WITH Ranked AS (
      SELECT r.course_id, r.employee_id, r.expires_on, r.tenant_id,
        ROW_NUMBER() OVER (PARTITION BY r.employee_id, r.course_id ORDER BY r.trained_on DESC, r.created_at DESC, r.id DESC) AS rn
      FROM training_records r
      JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      WHERE r.tenant_id = ? AND e.status = 'ACTIVE'
    )
    SELECT c.name AS title, e.first_name, e.last_name, r.expires_on
    FROM Ranked r
    JOIN training_courses c ON c.id = r.course_id AND c.tenant_id = r.tenant_id
    JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
    WHERE r.rn = 1 AND r.expires_on IN (${ph})`).all(tenantId, ...dates) as any[]

  const toItem = (kind: ExpiryItem['kind']) => (r: any): ExpiryItem => ({
    employee_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
    kind,
    title: r.title,
    expires_on: r.expires_on,
    days_left: daysBetween(today, r.expires_on),
  })
  return [...docs.map(toItem('DOCUMENT')), ...trainings.map(toItem('TRAINING'))]
    .sort((a, b) => a.days_left - b.days_left || a.employee_name.localeCompare(b.employee_name))
}

function buildMessage(company: string, items: ExpiryItem[]): string {
  const lines = items.slice(0, MAX_LINES).map(i =>
    `• ${i.employee_name} — ${i.title} · ${i.days_left < 0 ? 'หมดอายุแล้ว' : `เหลือ ${i.days_left} วัน (${i.expires_on})`}`)
  const more = items.length - MAX_LINES
  return [`เอกสารใกล้ครบกำหนด · ${company}`, ...lines, ...(more > 0 ? [`… และอีก ${more} รายการ`] : []), 'ดูทั้งหมดที่ HR > เอกสารพนักงาน'].join('\n')
}

export async function runExpiryDigest(today = thaiDateStr()): Promise<{ tenants: number; pushes: number }> {
  // PDPA: ลบใบสมัครที่เกินกำหนดเก็บ (6 เดือน) ทุกวัน ไม่ต้องรอ HR เปิดหน้ารับสมัคร — ไม่ลบคนที่รับเข้าทำงานแล้ว
  try { db.prepare(`DELETE FROM hr_applicants WHERE stage <> 'HIRED' AND purge_after < ?`).run(today) } catch (e) { console.error('[HrExpiry] purge applicants failed', e) }
  const tenantIds = (db.prepare(`
    SELECT tenant_id FROM hr_employee_documents WHERE expires_on IS NOT NULL
    UNION SELECT tenant_id FROM training_records WHERE expires_on IS NOT NULL`).all() as any[]).map(r => r.tenant_id as string)
  let tenants = 0
  let pushes = 0
  for (const tenantId of tenantIds) {
    try {
      const sub = getSubscription(tenantId)
      if (sub.status === 'EXPIRED' || sub.status === 'CANCELLED') continue
      if (sub.status !== 'NONE' && !sub.features.includes('hr')) continue
      const items = collectExpiryDigest(tenantId, today)
      if (!items.length) continue

      const users = (db.prepare(`
        SELECT u.id, u.role, u.departments, u.custom_permissions
        FROM users u JOIN line_user_mappings m ON m.tenant_id = u.tenant_id AND m.user_id = u.id
        WHERE u.tenant_id = ? AND u.status = 'active'`).all(tenantId) as any[])
        .filter(u => can(u.role, u.departments ? JSON.parse(u.departments) : [], 'hr', 'read',
          u.custom_permissions ? JSON.parse(u.custom_permissions) : undefined))
      if (!users.length) continue

      // แทรกแถวก่อน push: รันซ้ำวันเดิม/รีสตาร์ต → changes = 0 → ไม่ส่งซ้ำ
      const claimed = db.prepare('INSERT OR IGNORE INTO hr_expiry_digest_runs (tenant_id, run_date) VALUES (?, ?)').run(tenantId, today)
      if (claimed.changes === 0) continue

      const company = (db.prepare('SELECT name FROM company_settings WHERE tenant_id = ?').get(tenantId) as any)?.name || ''
      const message = { type: 'text', text: buildMessage(company, items) }
      let sent = 0
      for (const u of users) if (await lineBotService.pushToUser(tenantId, u.id, message)) sent++
      db.prepare('UPDATE hr_expiry_digest_runs SET pushes = ? WHERE tenant_id = ? AND run_date = ?').run(sent, tenantId, today)
      tenants++
      pushes += sent
    } catch (err: any) {
      console.error(`[HrExpiry] tenant ${tenantId} failed:`, err.message)
    }
  }
  return { tenants, pushes }
}

export function startHrExpiryScheduler() {
  cron.schedule('0 9 * * *', async () => {
    try {
      const r = await runExpiryDigest()
      console.log(`[HrExpiry] digest sent — tenants ${r.tenants}, pushes ${r.pushes}`)
    } catch (err: any) {
      console.error('[HrExpiry] digest failed:', err.message)
    }
  }, { timezone: 'Asia/Bangkok' })
  console.log('[HrExpiry] ⏰ Scheduler started — runs at 09:00 Asia/Bangkok daily')
}
