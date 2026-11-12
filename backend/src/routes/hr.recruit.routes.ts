import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { startChecklist } from './hr.lifecycle.routes'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { can } from '../services/rbac.service'

// HR Phase 11 — รับสมัครงาน (สัญญากลาง docs/contracts/hr-phase9-11.md)
const router = Router()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const STAGES = ['APPLIED', 'INTERVIEW', 'TRIAL', 'HIRED', 'REJECTED']
const EMPLOYMENT_TYPES = ['MONTHLY', 'DAILY', 'HOURLY']

function isValidDate(val: unknown): val is string {
  if (typeof val !== 'string' || !DATE_RE.test(val)) return false
  const d = new Date(`${val}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === val
}

function isUniqueConstraintError(err: any): boolean {
  return err?.code === 'SQLITE_CONSTRAINT_UNIQUE' || String(err?.message || '').includes('UNIQUE constraint failed')
}

function userHasHr(req: Request, action: 'read' | 'write'): boolean {
  if (!req.user) return false
  return can(req.user.role, req.user.departments || [], 'hr', action, req.user.customPermissions)
}

const bad = (res: Response, message: string) => res.status(400).json({ success: false, message })
const forbidden = (res: Response) => res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
const fail = (res: Response, err: any) => {
  console.error('HR recruit error:', err)
  res.status(500).json({ success: false, message: 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง' })
}

const fmtPosting = (r: any) => ({
  id: r.id, title: r.title, org_unit_id: r.org_unit_id ?? null, description: r.description ?? null,
  public_token: r.public_token, is_open: Boolean(r.is_open), created_at: r.created_at,
  applicant_count: Number(r.applicant_count || 0),
})

// อ่านและตรวจ title/description/org_unit_id ร่วมกันของ POST/PUT — คืน string = ข้อความ error
function checkPostingBody(body: any, tenantId: string, partial: boolean): string | { title?: string; description?: string | null; org_unit_id?: string | null } {
  const out: any = {}
  if (!partial || body.title !== undefined) {
    const t = typeof body.title === 'string' ? body.title.trim() : ''
    if (!t || t.length > 200) return 'กรุณาระบุชื่อตำแหน่ง (ไม่เกิน 200 ตัวอักษร)'
    out.title = t
  }
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string' || body.description.length > 5000) return 'รายละเอียดต้องไม่เกิน 5000 ตัวอักษร'
    out.description = body.description.trim() || null
  }
  if (body.org_unit_id !== undefined && body.org_unit_id !== null && body.org_unit_id !== '') {
    if (typeof body.org_unit_id !== 'string' || !db.prepare('SELECT id FROM org_units WHERE id = ? AND tenant_id = ?').get(body.org_unit_id, tenantId)) {
      return 'ไม่พบหน่วยงานในบริษัทนี้'
    }
    out.org_unit_id = body.org_unit_id
  } else if (body.org_unit_id !== undefined) out.org_unit_id = null
  return out
}

const POSTING_SELECT = `SELECT p.*, (SELECT COUNT(*) FROM hr_applicants a WHERE a.posting_id = p.id AND a.tenant_id = p.tenant_id) AS applicant_count
  FROM hr_job_postings p`

router.get('/job-postings', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) return forbidden(res)
    const rows = db.prepare(`${POSTING_SELECT} WHERE p.tenant_id = ? ORDER BY p.created_at DESC`).all(req.user!.tenantId) as any[]
    res.json({ success: true, data: rows.map(fmtPosting) })
  } catch (err) { fail(res, err) }
})

router.post('/job-postings', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return forbidden(res)
    const tenantId = req.user!.tenantId
    const v = checkPostingBody(req.body || {}, tenantId, false)
    if (typeof v === 'string') return bad(res, v)
    const id = generateId()
    const isOpen = req.body.is_open === false || req.body.is_open === 0 ? 0 : 1
    db.prepare(`INSERT INTO hr_job_postings (id, tenant_id, title, org_unit_id, description, public_token, is_open, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, tenantId, v.title, v.org_unit_id ?? null, v.description ?? null,
      crypto.randomBytes(16).toString('hex'), isOpen, new Date().toISOString())
    const row = db.prepare(`${POSTING_SELECT} WHERE p.id = ? AND p.tenant_id = ?`).get(id, tenantId)
    res.status(201).json({ success: true, data: fmtPosting(row) })
  } catch (err) { fail(res, err) }
})

router.put('/job-postings/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return forbidden(res)
    const tenantId = req.user!.tenantId
    const cur = db.prepare('SELECT id FROM hr_job_postings WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!cur) return res.status(404).json({ success: false, message: 'ไม่พบตำแหน่งงาน' })
    const body = req.body || {}
    const v = checkPostingBody(body, tenantId, true)
    if (typeof v === 'string') return bad(res, v)
    const sets: string[] = []
    const vals: any[] = []
    for (const k of ['title', 'description', 'org_unit_id'] as const) {
      if (k in v) { sets.push(`${k} = ?`); vals.push((v as any)[k]) }
    }
    if (body.is_open !== undefined) {
      if (typeof body.is_open !== 'boolean') return bad(res, 'สถานะเปิด/ปิดไม่ถูกต้อง')
      sets.push('is_open = ?'); vals.push(body.is_open ? 1 : 0)
    }
    if (sets.length) db.prepare(`UPDATE hr_job_postings SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...vals, req.params.id, tenantId)
    const row = db.prepare(`${POSTING_SELECT} WHERE p.id = ? AND p.tenant_id = ?`).get(req.params.id, tenantId)
    res.json({ success: true, data: fmtPosting(row) })
  } catch (err) { fail(res, err) }
})

const fmtApplicant = (r: any) => ({
  id: r.id, posting_id: r.posting_id, posting_title: r.posting_title ?? null, full_name: r.full_name, phone: r.phone,
  email: r.email ?? null, note: r.note ?? null, source: r.source ?? null, stage: r.stage,
  interview_at: r.interview_at ?? null, interview_note: r.interview_note ?? null,
  consent_at: r.consent_at, purge_after: r.purge_after, employee_id: r.employee_id ?? null, created_at: r.created_at,
})

const APPLICANT_SELECT = `SELECT a.*, p.title AS posting_title FROM hr_applicants a
  LEFT JOIN hr_job_postings p ON p.id = a.posting_id AND p.tenant_id = a.tenant_id`

router.get('/applicants', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) return forbidden(res)
    const tenantId = req.user!.tenantId
    const { posting_id, stage } = req.query
    if (stage !== undefined && (typeof stage !== 'string' || !STAGES.includes(stage))) return bad(res, 'ขั้นตอนไม่ถูกต้อง')
    if (posting_id !== undefined && typeof posting_id !== 'string') return bad(res, 'ตำแหน่งงานไม่ถูกต้อง')
    // PDPA: ลบใบสมัครหมดอายุของบริษัทนี้ (ไม่ลบคนที่รับเข้าทำงานแล้ว)
    db.prepare(`DELETE FROM hr_applicants WHERE tenant_id = ? AND stage <> 'HIRED' AND purge_after < ?`).run(tenantId, thaiDateStr())
    const where = ['a.tenant_id = ?']
    const args: any[] = [tenantId]
    if (posting_id) { where.push('a.posting_id = ?'); args.push(posting_id) }
    if (stage) { where.push('a.stage = ?'); args.push(stage) }
    const rows = db.prepare(`${APPLICANT_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC`).all(...args) as any[]
    res.json({ success: true, data: rows.map(fmtApplicant) })
  } catch (err) { fail(res, err) }
})

router.put('/applicants/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return forbidden(res)
    const tenantId = req.user!.tenantId
    const cur = db.prepare('SELECT id, stage FROM hr_applicants WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!cur) return res.status(404).json({ success: false, message: 'ไม่พบผู้สมัคร' })
    const b = req.body || {}
    const sets: string[] = []
    const vals: any[] = []
    if (b.stage !== undefined) {
      if (typeof b.stage !== 'string' || !STAGES.includes(b.stage)) return bad(res, 'ขั้นตอนไม่ถูกต้อง')
      if (b.stage === 'HIRED') return bad(res, 'การรับเข้าทำงานต้องใช้ปุ่มรับเข้าทำงาน')
      if (cur.stage === 'HIRED') return res.status(409).json({ success: false, message: 'รับเข้าทำงานแล้ว เปลี่ยนขั้นตอนไม่ได้' })
      sets.push('stage = ?'); vals.push(b.stage)
    }
    if (b.interview_at !== undefined) {
      if (b.interview_at !== null && b.interview_at !== '' && (typeof b.interview_at !== 'string' || b.interview_at.length > 40 || Number.isNaN(Date.parse(b.interview_at)))) {
        return bad(res, 'วันนัดสัมภาษณ์ไม่ถูกต้อง')
      }
      sets.push('interview_at = ?'); vals.push(b.interview_at || null)
    }
    if (b.interview_note !== undefined) {
      if (b.interview_note !== null && (typeof b.interview_note !== 'string' || b.interview_note.length > 5000)) return bad(res, 'บันทึกสัมภาษณ์ต้องไม่เกิน 5000 ตัวอักษร')
      sets.push('interview_note = ?'); vals.push(b.interview_note?.trim() || null)
    }
    if (sets.length) db.prepare(`UPDATE hr_applicants SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...vals, req.params.id, tenantId)
    const row = db.prepare(`${APPLICANT_SELECT} WHERE a.id = ? AND a.tenant_id = ?`).get(req.params.id, tenantId)
    res.json({ success: true, data: fmtApplicant(row) })
  } catch (err) { fail(res, err) }
})

router.post('/applicants/:id/hire', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return forbidden(res)
    const tenantId = req.user!.tenantId
    const userId = req.user!.userId
    const ap = db.prepare('SELECT * FROM hr_applicants WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!ap) return res.status(404).json({ success: false, message: 'ไม่พบผู้สมัคร' })
    if (ap.stage === 'HIRED' || ap.employee_id) return res.status(409).json({ success: false, message: 'รับเข้าทำงานแล้ว' })
    const b = req.body || {}
    // ตรวจเหมือน POST /employees ใน hr.routes.ts (เขียนซ้ำเฉพาะที่ใช้ เพราะไม่ได้ export helper)
    const code = typeof b.code === 'string' ? b.code.trim() : ''
    if (!code || code.length > 50) return bad(res, 'กรุณาระบุรหัสพนักงาน (ไม่เกิน 50 ตัวอักษร)')
    if (typeof b.employment_type !== 'string' || !EMPLOYMENT_TYPES.includes(b.employment_type)) return bad(res, 'ประเภทการจ้างต้องเป็น MONTHLY, DAILY หรือ HOURLY')
    const rawWage = b.base_wage === undefined || b.base_wage === null || b.base_wage === '' ? 0 : b.base_wage
    if (typeof rawWage === 'boolean' || Array.isArray(rawWage) || !Number.isFinite(Number(rawWage)) || Number(rawWage) < 0) return bad(res, 'ฐานค่าจ้างต้องเป็นตัวเลขไม่ติดลบ')
    if (!isValidDate(b.start_date)) return bad(res, 'วันที่เริ่มงานต้องอยู่ในรูปแบบ YYYY-MM-DD')
    let orgUnitId: string | null = null
    if (b.org_unit_id != null && b.org_unit_id !== '') {
      if (typeof b.org_unit_id !== 'string' || !db.prepare('SELECT id FROM org_units WHERE id = ? AND tenant_id = ?').get(b.org_unit_id, tenantId)) return bad(res, 'ไม่พบหน่วยงานในบริษัทนี้')
      orgUnitId = b.org_unit_id
    }
    if (db.prepare('SELECT id FROM employees WHERE tenant_id = ? AND code = ?').get(tenantId, code)) {
      return res.status(409).json({ success: false, message: 'รหัสพนักงานซ้ำในบริษัทนี้' })
    }
    const name = String(ap.full_name).trim()
    const sp = name.indexOf(' ')
    const firstName = sp > 0 ? name.slice(0, sp) : name
    const lastName = sp > 0 ? name.slice(sp + 1).trim() || null : null
    const empId = generateId()
    const now = new Date().toISOString()
    db.transaction(() => {
      db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, last_name, org_unit_id, employment_type, base_wage, start_date,
        status, phone, email, sso_enrolled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, 1, ?, ?)`)
        .run(empId, tenantId, code, firstName, lastName, orgUnitId, b.employment_type, Number(rawWage), b.start_date, ap.phone, ap.email ?? null, now, now)
      db.prepare(`UPDATE hr_applicants SET stage = 'HIRED', employee_id = ? WHERE id = ? AND tenant_id = ?`).run(empId, ap.id, tenantId)
      // ไม่มีแม่แบบ → คืน 0 เฉยๆ · ถ้า error จริงให้ล้มทั้งการรับเข้าทำงาน (อยู่ใน transaction เดียวกัน)
      startChecklist(tenantId, empId, 'ONBOARD', userId)
    })()
    const row = db.prepare(`${APPLICANT_SELECT} WHERE a.id = ? AND a.tenant_id = ?`).get(ap.id, tenantId)
    res.status(201).json({ success: true, data: fmtApplicant(row) })
  } catch (err: any) {
    if (isUniqueConstraintError(err)) return res.status(409).json({ success: false, message: 'ข้อมูลพนักงานซ้ำกับที่มีอยู่ในระบบ' })
    fail(res, err)
  }
})

export default router
