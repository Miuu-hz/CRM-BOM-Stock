import { Router, Request, Response } from 'express'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { can } from '../services/rbac.service'
import { round2 } from '../services/hr/payrollCalc'
import { advanceOutstanding, recalcRunLine } from './hr.payroll.routes'

// HR Phase 9A — เช็กลิสต์เข้า/ออกงาน + เงินงวดสุดท้าย (สัญญากลาง docs/contracts/hr-phase9-11.md)
const router = Router()

const KINDS = ['ONBOARD', 'OFFBOARD']
const AUTO_ACTIONS = ['DISABLE_USER', 'UNLINK_LINE']

function userHasHr(req: Request, action: 'read' | 'write'): boolean {
  if (!req.user) return false
  return can(req.user.role, req.user.departments || [], 'hr', action, req.user.customPermissions)
}

const forbid = (res: Response) => res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
const bad = (res: Response, message: string, status = 400) => res.status(status).json({ success: false, message })

const dayNum = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86400000)
}

// ---------- เงินงวดสุดท้าย (pure) ----------

export function severanceDaysFor(tenureDays: number): number {
  if (tenureDays >= 7300) return 400
  if (tenureDays >= 3650) return 300
  if (tenureDays >= 2190) return 240
  if (tenureDays >= 1095) return 180
  if (tenureDays >= 365) return 90
  if (tenureDays >= 120) return 30
  return 0
}

export function computeFinalPay(i: {
  employmentType: 'MONTHLY' | 'DAILY' | 'HOURLY'
  baseWage: number
  tenureDays: number
  unusedAnnualLeaveDays: number
  outstandingAdvances: number
  unreturnedAssets?: { id: string; code: string; name: string; loaned_on: string }[]
  /** ลาออกเอง = ไม่มีค่าชดเชย (ม.118 จ่ายเมื่อนายจ้างเลิกจ้าง) */
  resigned?: boolean
}) {
  const wage = Number(i.baseWage) || 0
  const rawDaily = i.employmentType === 'MONTHLY' ? wage / 30 : i.employmentType === 'HOURLY' ? wage * 8 : wage // คูณก่อนปัด กันเศษสะสม
  const tenureDays = Math.max(0, Math.floor(i.tenureDays))
  const severanceDays = i.resigned ? 0 : severanceDaysFor(tenureDays)
  const unused = Math.max(0, Number(i.unusedAnnualLeaveDays) || 0)
  return {
    dailyWage: round2(rawDaily),
    tenureDays,
    severanceDays,
    severanceAmount: round2(severanceDays * rawDaily),
    unusedAnnualLeaveDays: unused,
    leavePayout: round2(unused * rawDaily),
    outstandingAdvances: round2(Number(i.outstandingAdvances) || 0),
    unreturnedAssets: i.unreturnedAssets ?? [],
  }
}

// ---------- แม่แบบ ----------

const DEFAULT_TEMPLATES: { kind: string; title: string; auto?: string }[] = [
  { kind: 'ONBOARD', title: 'เซ็นสัญญาจ้าง' },
  { kind: 'ONBOARD', title: 'รับยูนิฟอร์ม' },
  { kind: 'ONBOARD', title: 'เปิดบัญชีผู้ใช้/POS' },
  { kind: 'ONBOARD', title: 'อบรมพนักงานใหม่' },
  { kind: 'ONBOARD', title: 'ผูก LINE' },
  { kind: 'ONBOARD', title: 'แจ้งเข้า สปส.1-03 ภายใน 30 วัน' },
  { kind: 'OFFBOARD', title: 'คืนทรัพย์สินของบริษัท' },
  { kind: 'OFFBOARD', title: 'ปิดบัญชีผู้ใช้ ERP', auto: 'DISABLE_USER' },
  { kind: 'OFFBOARD', title: 'ยกเลิกผูก LINE', auto: 'UNLINK_LINE' },
  { kind: 'OFFBOARD', title: 'แจ้งออก สปส.6-09 ภายในวันที่ 15 ของเดือนถัดไป' },
  { kind: 'OFFBOARD', title: 'จ่ายเงินงวดสุดท้าย + ค่าพักร้อนคงเหลือ + ค่าชดเชย' },
  { kind: 'OFFBOARD', title: 'ออกหนังสือรับรองการทำงาน' },
  { kind: 'OFFBOARD', title: 'ออก 50 ทวิ' },
]

const fmtTemplate = (r: any) => ({
  id: r.id, kind: r.kind, org_unit_id: r.org_unit_id ?? null, title: r.title,
  sort_order: Number(r.sort_order), auto_action: r.auto_action ?? null, is_active: Boolean(r.is_active),
})

/** คืน error message ถ้าผิด ไม่งั้นคืนค่าที่ตรวจแล้ว */
function parseTemplateBody(tenantId: string, b: any, partial: boolean): { error: string } | { v: any } {
  const v: any = {}
  if (!partial || b.kind !== undefined) {
    if (!KINDS.includes(b.kind)) return { error: 'ประเภทไม่ถูกต้อง' }
    v.kind = b.kind
  }
  if (!partial || b.title !== undefined) {
    if (typeof b.title !== 'string' || !b.title.trim() || b.title.trim().length > 200) return { error: 'ชื่อข้อต้องไม่ว่างและไม่เกิน 200 ตัวอักษร' }
    v.title = b.title.trim()
  }
  if (b.org_unit_id !== undefined) {
    if (b.org_unit_id === null || b.org_unit_id === '') v.org_unit_id = null
    else {
      if (typeof b.org_unit_id !== 'string') return { error: 'แผนกไม่ถูกต้อง' }
      const ou = db.prepare('SELECT id FROM org_units WHERE id = ? AND tenant_id = ?').get(b.org_unit_id, tenantId)
      if (!ou) return { error: 'ไม่พบแผนก' }
      v.org_unit_id = b.org_unit_id
    }
  }
  if (b.sort_order !== undefined) {
    if (!Number.isInteger(b.sort_order) || b.sort_order < 0 || b.sort_order > 10000) return { error: 'ลำดับไม่ถูกต้อง' }
    v.sort_order = b.sort_order
  }
  if (b.auto_action !== undefined) {
    if (b.auto_action !== null && !AUTO_ACTIONS.includes(b.auto_action)) return { error: 'การทำงานอัตโนมัติไม่ถูกต้อง' }
    v.auto_action = b.auto_action
  }
  if (b.is_active !== undefined) {
    if (typeof b.is_active !== 'boolean') return { error: 'สถานะไม่ถูกต้อง' }
    v.is_active = b.is_active ? 1 : 0
  }
  return { v }
}

router.get('/checklist-templates', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) return forbid(res)
    const kind = req.query.kind
    if (kind !== undefined && (typeof kind !== 'string' || !KINDS.includes(kind))) return bad(res, 'ประเภทไม่ถูกต้อง')
    const rows = db.prepare(
      `SELECT * FROM hr_checklist_templates WHERE tenant_id = ? ${kind ? 'AND kind = ?' : ''} ORDER BY kind, sort_order, created_at`
    ).all(...(kind ? [req.user!.tenantId, kind] : [req.user!.tenantId])) as any[]
    res.json({ success: true, data: rows.map(fmtTemplate) })
  } catch (err: any) {
    console.error('Get checklist templates error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

router.post('/checklist-templates/seed-defaults', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return forbid(res)
    const tenantId = req.user!.tenantId
    const has = db.prepare('SELECT 1 FROM hr_checklist_templates WHERE tenant_id = ? LIMIT 1').get(tenantId)
    if (has) return bad(res, 'มีแม่แบบอยู่แล้ว', 409)
    const ins = db.prepare(
      `INSERT INTO hr_checklist_templates (id, tenant_id, kind, org_unit_id, title, sort_order, auto_action, is_active, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, 1, ?)`
    )
    const now = new Date().toISOString()
    db.transaction(() => {
      DEFAULT_TEMPLATES.forEach((t, idx) => ins.run(generateId(), tenantId, t.kind, t.title, idx + 1, t.auto ?? null, now))
    })()
    res.status(201).json({ success: true, data: { created: DEFAULT_TEMPLATES.length } })
  } catch (err: any) {
    console.error('Seed checklist templates error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

router.post('/checklist-templates', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return forbid(res)
    const tenantId = req.user!.tenantId
    const p = parseTemplateBody(tenantId, req.body || {}, false)
    if ('error' in p) return bad(res, p.error)
    const id = generateId()
    db.prepare(
      `INSERT INTO hr_checklist_templates (id, tenant_id, kind, org_unit_id, title, sort_order, auto_action, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, tenantId, p.v.kind, p.v.org_unit_id ?? null, p.v.title, p.v.sort_order ?? 0, p.v.auto_action ?? null, p.v.is_active ?? 1, new Date().toISOString())
    const row = db.prepare('SELECT * FROM hr_checklist_templates WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    res.status(201).json({ success: true, data: fmtTemplate(row) })
  } catch (err: any) {
    console.error('Create checklist template error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

router.put('/checklist-templates/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return forbid(res)
    const tenantId = req.user!.tenantId
    const cur = db.prepare('SELECT * FROM hr_checklist_templates WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!cur) return bad(res, 'ไม่พบแม่แบบ', 404)
    const p = parseTemplateBody(tenantId, req.body || {}, true)
    if ('error' in p) return bad(res, p.error)
    const keys = Object.keys(p.v)
    if (keys.length) {
      // keys มาจาก parseTemplateBody เท่านั้น (ไม่ใช่ input ตรงๆ)
      db.prepare(`UPDATE hr_checklist_templates SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND tenant_id = ?`)
        .run(...keys.map((k) => p.v[k]), req.params.id, tenantId)
    }
    const row = db.prepare('SELECT * FROM hr_checklist_templates WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: fmtTemplate(row) })
  } catch (err: any) {
    console.error('Update checklist template error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

router.delete('/checklist-templates/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return forbid(res)
    const r = db.prepare('DELETE FROM hr_checklist_templates WHERE id = ? AND tenant_id = ?').run(req.params.id, req.user!.tenantId)
    if (!r.changes) return bad(res, 'ไม่พบแม่แบบ', 404)
    res.json({ success: true, data: { id: req.params.id } })
  } catch (err: any) {
    console.error('Delete checklist template error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ---------- เช็กลิสต์ของพนักงาน ----------

function templatesFor(tenantId: string, emp: any, kind: string) {
  return db.prepare(
    `SELECT * FROM hr_checklist_templates
     WHERE tenant_id = ? AND kind = ? AND is_active = 1 AND (org_unit_id IS NULL OR org_unit_id = ?)
     ORDER BY sort_order, created_at`
  ).all(tenantId, kind, emp.org_unit_id ?? null) as any[]
}

const hasOpenItems = (tenantId: string, employeeId: string, kind: string) =>
  !!db.prepare('SELECT 1 FROM hr_checklist_items WHERE tenant_id = ? AND employee_id = ? AND kind = ? AND done_at IS NULL LIMIT 1')
    .get(tenantId, employeeId, kind)

/** คัดลอกแม่แบบเป็นข้อของพนักงาน คืนจำนวนที่สร้าง (0 = ไม่มีแม่แบบ / พนักงานไม่พบ / มีข้อค้างอยู่แล้ว) */
export function startChecklist(tenantId: string, employeeId: string, kind: string, _userId: string): number {
  if (!KINDS.includes(kind)) return 0
  const emp = db.prepare('SELECT id, org_unit_id FROM employees WHERE id = ? AND tenant_id = ?').get(employeeId, tenantId) as any
  if (!emp || hasOpenItems(tenantId, employeeId, kind)) return 0
  const tpls = templatesFor(tenantId, emp, kind)
  const ins = db.prepare(
    `INSERT INTO hr_checklist_items (id, tenant_id, employee_id, kind, title, auto_action, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const now = new Date().toISOString()
  db.transaction(() => {
    for (const t of tpls) ins.run(generateId(), tenantId, employeeId, kind, t.title, t.auto_action ?? null, t.sort_order, now)
  })()
  return tpls.length
}

const getEmployee = (tenantId: string, id: string) =>
  db.prepare('SELECT * FROM employees WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any

const fmtItem = (r: any) => ({
  id: r.id, employee_id: r.employee_id, kind: r.kind, title: r.title, auto_action: r.auto_action ?? null,
  sort_order: Number(r.sort_order), done_at: r.done_at ?? null, done_by: r.done_by ?? null, note: r.note ?? null,
})

router.post('/employees/:id/checklists', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return forbid(res)
    const tenantId = req.user!.tenantId
    const emp = getEmployee(tenantId, req.params.id)
    if (!emp) return bad(res, 'ไม่พบพนักงาน', 404)
    const kind = req.body?.kind
    if (!KINDS.includes(kind)) return bad(res, 'ประเภทไม่ถูกต้อง')
    if (hasOpenItems(tenantId, emp.id, kind)) return bad(res, 'มีเช็กลิสต์ที่ยังไม่เสร็จอยู่แล้ว', 409)
    if (!templatesFor(tenantId, emp, kind).length) return bad(res, 'ยังไม่มีแม่แบบเช็กลิสต์', 400)
    const created = startChecklist(tenantId, emp.id, kind, req.user!.userId)
    res.status(201).json({ success: true, data: { created } })
  } catch (err: any) {
    console.error('Start checklist error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

router.get('/employees/:id/checklists', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) return forbid(res)
    const tenantId = req.user!.tenantId
    if (!getEmployee(tenantId, req.params.id)) return bad(res, 'ไม่พบพนักงาน', 404)
    const kind = req.query.kind
    if (kind !== undefined && (typeof kind !== 'string' || !KINDS.includes(kind))) return bad(res, 'ประเภทไม่ถูกต้อง')
    const rows = db.prepare(
      `SELECT * FROM hr_checklist_items WHERE tenant_id = ? AND employee_id = ? ${kind ? 'AND kind = ?' : ''} ORDER BY sort_order, created_at`
    ).all(...(kind ? [tenantId, req.params.id, kind] : [tenantId, req.params.id])) as any[]
    res.json({ success: true, data: rows.map(fmtItem) })
  } catch (err: any) {
    console.error('Get checklist items error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

router.put('/checklist-items/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return forbid(res)
    const tenantId = req.user!.tenantId
    const item = db.prepare('SELECT * FROM hr_checklist_items WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!item) return bad(res, 'ไม่พบรายการ', 404)
    const { done, note } = req.body || {}
    if (typeof done !== 'boolean') return bad(res, 'ต้องระบุ done เป็น true/false')
    if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 5000)) return bad(res, 'หมายเหตุยาวเกินไป')

    let targetUserId: string | null = null
    // auto action ทำเฉพาะตอนเปลี่ยนจากยังไม่ทำ → ทำแล้ว (กดซ้ำ/ลองใหม่ต้องไม่ปิดบัญชีที่ถูกเปิดคืนไปแล้ว)
    const firstTick = done && !item.done_at
    if (firstTick && item.auto_action === 'DISABLE_USER') {
      const emp = getEmployee(tenantId, item.employee_id)
      if (emp?.user_id) {
        if (emp.user_id === req.user!.userId) return bad(res, 'ห้ามปิดบัญชีของตัวเอง')
        const u = db.prepare('SELECT role FROM users WHERE id = ? AND tenant_id = ?').get(emp.user_id, tenantId) as any
        if (u && (u.role === 'MASTER' || u.role === 'OWNER')) return bad(res, 'ห้ามปิดบัญชีผู้ดูแลสูงสุด')
        // สิทธิ์ hr write ไม่ควรปิดบัญชีผู้ดูแลระบบได้ — ต้องเป็นผู้ดูแลด้วยกัน
        if (u?.role === 'ADMIN' && !['ADMIN', 'MASTER', 'OWNER'].includes(req.user!.role)) return bad(res, 'บัญชีนี้เป็นผู้ดูแลระบบ ต้องให้ผู้ดูแลระบบเป็นคนปิด')
        if (u) targetUserId = emp.user_id
      }
    }
    let unlinkUserId: string | null = null
    if (firstTick && item.auto_action === 'UNLINK_LINE') unlinkUserId = getEmployee(tenantId, item.employee_id)?.user_id ?? null

    db.transaction(() => {
      if (targetUserId) db.prepare(`UPDATE users SET status = 'inactive' WHERE id = ? AND tenant_id = ?`).run(targetUserId, tenantId)
      if (unlinkUserId) {
        db.prepare('DELETE FROM line_user_mappings WHERE user_id = ? AND tenant_id = ?').run(unlinkUserId, tenantId)
        db.prepare('DELETE FROM line_login_tokens WHERE user_id = ? AND tenant_id = ?').run(unlinkUserId, tenantId)
      }
      db.prepare('UPDATE hr_checklist_items SET done_at = ?, done_by = ?, note = ? WHERE id = ? AND tenant_id = ?')
        .run(done ? new Date().toISOString() : null, done ? req.user!.userId : null, note === undefined ? item.note : note, item.id, tenantId)
    })()

    const row = db.prepare('SELECT * FROM hr_checklist_items WHERE id = ? AND tenant_id = ?').get(item.id, tenantId)
    const undoWarn = !done && item.done_at && item.auto_action
      ? ' (การยกเลิกติ๊กไม่ย้อนการปิดบัญชี/ยกเลิกผูก LINE ที่ทำไปแล้ว)' : ''
    res.json({ success: true, message: `บันทึกแล้ว${undoWarn}`, data: fmtItem(row) })
  } catch (err: any) {
    console.error('Update checklist item error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ---------- เงินงวดสุดท้าย ----------

function finalPayFor(tenantId: string, emp: any) {
  const today = thaiDateStr()
  const endDay = emp.end_date || today
  const tenureDays = dayNum(endDay) - dayNum(emp.start_date)

  // ยอดลาคงเหลือ: สูตรเดียวกับ GET /leave-balances (quota - APPROVED ปีนั้น) ของประเภท VACATION
  const lt = db.prepare(`SELECT id, days_per_year FROM leave_types WHERE tenant_id = ? AND code = 'VACATION' AND is_active = 1`).get(tenantId) as any
  let unusedAnnualLeaveDays = 0
  if (lt && lt.days_per_year !== null && lt.days_per_year !== undefined) {
    const used = db.prepare(
      `SELECT COALESCE(SUM(days), 0) AS used FROM leave_requests
       WHERE tenant_id = ? AND employee_id = ? AND leave_type_id = ? AND status = 'APPROVED' AND start_date LIKE ?`
    ).get(tenantId, emp.id, lt.id, `${endDay.slice(0, 4)}-%`) as any
    unusedAnnualLeaveDays = Math.max(0, Number(lt.days_per_year) - Number(used.used))
  }

  // ยอดคงค้าง: เฉพาะรายการที่เบิกจ่ายแล้ว (ACTIVE) ใช้ตัวคิดเดียวกับหน้าเบิก/ยืม
  const advs = db.prepare(`SELECT id FROM employee_advances WHERE tenant_id = ? AND employee_id = ? AND status = 'ACTIVE'`).all(tenantId, emp.id) as any[]
  const outstandingAdvances = advs.reduce((s, a) => s + advanceOutstanding(tenantId, a.id), 0)

  const unreturnedAssets = db.prepare(
    `SELECT a.id, a.code, a.name, l.loaned_on FROM hr_asset_loans l
     JOIN hr_assets a ON a.id = l.asset_id AND a.tenant_id = l.tenant_id
     WHERE l.tenant_id = ? AND l.employee_id = ? AND l.returned_on IS NULL ORDER BY l.loaned_on`
  ).all(tenantId, emp.id) as any[]

  // กำหนดเก็บข้อมูลหลังออกงาน: ค่าจ้าง/เวลาทำงาน 2 ปี (พ.ร.บ.คุ้มครองแรงงาน ม.115), เอกสารภาษี 5 ปี — ระบบไม่ลบเอง แสดงไว้ให้รู้ว่าห้ามลบก่อนวันไหน
  const plusYears = (n: number) => `${Number(endDay.slice(0, 4)) + n}${endDay.slice(4)}`
  return {
    ...computeFinalPay({
      employmentType: emp.employment_type, baseWage: emp.base_wage, tenureDays,
      unusedAnnualLeaveDays, outstandingAdvances, unreturnedAssets, resigned: emp.status === 'RESIGNED',
    }),
    retainWageUntil: plusYears(2), retainTaxUntil: plusYears(5),
  }
}

router.get('/employees/:id/final-pay', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) return forbid(res)
    const tenantId = req.user!.tenantId
    const emp = getEmployee(tenantId, req.params.id)
    if (!emp) return bad(res, 'ไม่พบพนักงาน', 404)

    res.json({ success: true, data: finalPayFor(tenantId, emp) })
  } catch (err: any) {
    console.error('Final pay error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

const SEVERANCE_NOTE = 'ค่าชดเชยส่งเข้าแบบไม่คิดภาษี (กฎหมายยกเว้นไม่เกิน 300 วันและ 600,000 บาท) ถ้าเกินให้นักบัญชีแก้ช่องคิดภาษีในรอบเงินเดือนก่อนอนุมัติ'
const SEV_PREFIX = 'ค่าชดเชยตามกฎหมาย'
const LEAVE_PREFIX = 'ค่าจ้างวันหยุดพักผ่อนคงเหลือ'

// ส่งเงินงวดสุดท้ายเข้าบรรทัดเงินเดือนในรอบ DRAFT เป็นรายการครั้งเดียว (คำนวณ/บันทึกผ่าน recalcRunLine เดียวกับ PUT line)
router.post('/employees/:id/final-pay/apply', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return forbid(res)
    const tenantId = req.user!.tenantId
    const emp = getEmployee(tenantId, req.params.id)
    if (!emp) return bad(res, 'ไม่พบพนักงาน', 404)
    const runId = req.body?.run_id
    if (typeof runId !== 'string' || !runId) return bad(res, 'กรุณาเลือกรอบเงินเดือน')
    const run = db.prepare('SELECT id, status FROM payroll_runs WHERE id = ? AND tenant_id = ?').get(runId, tenantId) as any
    if (!run) return bad(res, 'ไม่พบรอบเงินเดือน', 404)
    if (run.status !== 'DRAFT') return bad(res, 'ส่งเข้าได้เฉพาะรอบเงินเดือนที่เป็นร่าง', 409)
    const lineRow = db.prepare('SELECT * FROM payroll_run_lines WHERE run_id = ? AND employee_id = ? AND tenant_id = ?').get(runId, emp.id, tenantId) as any
    if (!lineRow) return bad(res, 'พนักงานคนนี้ไม่อยู่ในรอบเงินเดือนนี้', 409)

    if (emp.status === 'ACTIVE' && !emp.end_date) return bad(res, 'พนักงานยังไม่ได้ออกงาน กรุณาบันทึกวันออกงานก่อน', 409)
    // กันจ่ายซ้ำข้ามรอบ: รอบอื่น (ที่ไม่ถูกยกเลิก) มีรายการงวดสุดท้ายของคนนี้แล้ว
    const dup = db.prepare(`SELECT r.period FROM payroll_run_lines l JOIN payroll_runs r ON r.id = l.run_id AND r.tenant_id = l.tenant_id
      WHERE l.tenant_id = ? AND l.employee_id = ? AND l.run_id != ? AND r.status != 'VOID' AND (l.inputs LIKE ? OR l.inputs LIKE ?)`)
      .get(tenantId, emp.id, runId, `%${SEV_PREFIX}%`, `%${LEAVE_PREFIX}%`) as any
    if (dup) return bad(res, `ส่งเงินงวดสุดท้ายเข้ารอบ ${dup.period} ไปแล้ว`, 409)

    const fp = finalPayFor(tenantId, emp)
    const added: { name: string; amount: number }[] = []
    if (fp.severanceAmount > 0) added.push({ name: `${SEV_PREFIX} (${fp.severanceDays} วัน)`, amount: fp.severanceAmount })
    if (fp.leavePayout > 0) added.push({ name: `${LEAVE_PREFIX} (${fp.unusedAnnualLeaveDays} วัน)`, amount: fp.leavePayout })
    if (added.length === 0) return bad(res, 'ไม่มียอดค่าชดเชยหรือค่าพักร้อนคงเหลือให้ส่ง', 409)

    let line: any
    try {
      line = db.transaction(() => {
        const prev = JSON.parse(lineRow.inputs || '{}')
        const kept = (Array.isArray(prev.extraPayItems) ? prev.extraPayItems : Array.isArray(prev.payItems) ? prev.payItems : [])
          .filter((p: any) => { const n = String(p?.name ?? ''); return !n.startsWith(SEV_PREFIX) && !n.startsWith(LEAVE_PREFIX) })
        // ค่าชดเชยตามกฎหมายได้ยกเว้นภาษี (ไม่เกิน 300 วันและ 600,000 บาท) และถ้าคิดภาษีแบบคูณ 12 จะหักเกินจริงมาก → ไม่คิดภาษี/สปส.
        const items = added.map((a) => { const sev = a.name.startsWith(SEV_PREFIX); return { ...a, taxable: !sev, ssoable: !sev } })
        return recalcRunLine(tenantId, runId, lineRow, emp, { extraPayItems: [...kept, ...items] })
      })()
    } catch (err: any) {
      return bad(res, err.message || 'ไม่สามารถคำนวณเงินเดือนได้')
    }
    res.json({ success: true, data: { line, added, note: SEVERANCE_NOTE } })
  } catch (err: any) {
    console.error('Final pay apply error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

export default router
