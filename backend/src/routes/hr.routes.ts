import { Router, Request, Response } from 'express'
import { authenticate, requirePermission } from '../middleware/auth.middleware'
import { userCan } from '../services/rbac.service'
import db from '../db/sqlite'
import { generateId } from '../utils/id'

const router = Router()
router.use(authenticate)

const ALLOWED_BUSINESS_UNITS = ['RETAIL', 'WHOLESALE', 'ONLINE', 'OTHER'] as const
const ALLOWED_EMPLOYMENT_TYPES = ['MONTHLY', 'DAILY', 'HOURLY'] as const
const ALLOWED_STATUSES = ['ACTIVE', 'RESIGNED', 'TERMINATED'] as const
const SENSITIVE_FIELDS = ['national_id', 'bank_account', 'base_wage', 'tax_allowances'] as const
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidDate(val: unknown): val is string {
  if (typeof val !== 'string' || !DATE_RE.test(val)) return false
  const d = new Date(`${val}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === val
}

function isUniqueConstraintError(err: any): boolean {
  return err?.code === 'SQLITE_CONSTRAINT_UNIQUE' || String(err?.message || '').includes('UNIQUE constraint failed')
}

function sanitizeEmployee(row: any, canWrite: boolean) {
  if (!row) return row
  const out = { ...row }
  if (!canWrite) {
    for (const f of SENSITIVE_FIELDS) delete out[f]
  }
  return out
}

function nextEmployeeCode(tenantId: string): string {
  const rows = db.prepare(
    `SELECT code FROM employees WHERE tenant_id = ? AND code LIKE 'EMP-%'`
  ).all(tenantId) as { code: string }[]
  let max = 0
  for (const r of rows) {
    const m = /^EMP-(\d+)$/.exec(r.code)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return `EMP-${String(max + 1).padStart(3, '0')}`
}

function hasOrgCycle(tenantId: string, selfId: string | null, parentId: string | null): boolean {
  let cur = parentId
  const seen = new Set<string>()
  if (selfId) seen.add(selfId)
  while (cur) {
    if (seen.has(cur)) return true
    seen.add(cur)
    const row = db.prepare(
      'SELECT parent_id FROM org_units WHERE id = ? AND tenant_id = ?'
    ).get(cur, tenantId) as { parent_id: string | null } | undefined
    cur = row?.parent_id ?? null
  }
  return false
}

// GET /api/hr/me — พนักงานที่ผูกกับบัญชีผู้ใช้ของตัวเอง (คืนครบทุก field)
router.get('/me', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = (req.user as any)?.id || req.user!.userId
    const row = db.prepare(`
      SELECT e.*, ou.name as org_unit_name, ou.business_unit as business_unit
      FROM employees e
      LEFT JOIN org_units ou ON e.org_unit_id = ou.id AND ou.tenant_id = e.tenant_id
      WHERE e.tenant_id = ? AND e.user_id = ?
    `).get(tenantId, userId)
    if (!row) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงานที่ผูกกับบัญชีผู้ใช้นี้' })
    }
    res.json({ success: true, data: row })
  } catch (error: any) {
    console.error('Get HR me error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/hr/org-units
router.get('/org-units', requirePermission('hr', 'read'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const rows = db.prepare(`
      SELECT ou.*,
        m.code as manager_code,
        m.first_name as manager_first_name,
        m.last_name as manager_last_name
      FROM org_units ou
      LEFT JOIN employees m ON ou.manager_employee_id = m.id AND m.tenant_id = ou.tenant_id
      WHERE ou.tenant_id = ?
      ORDER BY ou.name ASC
    `).all(tenantId)
    res.json({ success: true, data: rows })
  } catch (error: any) {
    console.error('List org units error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/hr/org-units
router.post('/org-units', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { name, parent_id, manager_employee_id, business_unit, is_active } = req.body || {}

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อหน่วยงาน' })
    }
    const trimmedName = name.trim()
    const parentId = parent_id ? String(parent_id).trim() : null
    const managerId = manager_employee_id ? String(manager_employee_id).trim() : null
    const bizUnit = business_unit ? String(business_unit).trim() : null

    if (bizUnit && !(ALLOWED_BUSINESS_UNITS as readonly string[]).includes(bizUnit)) {
      return res.status(400).json({ success: false, message: 'หน่วยธุรกิจไม่ถูกต้อง' })
    }

    if (parentId) {
      const parent = db.prepare('SELECT id FROM org_units WHERE id = ? AND tenant_id = ?').get(parentId, tenantId)
      if (!parent) {
        return res.status(400).json({ success: false, message: 'ไม่พบหน่วยงานแม่ในบริษัทนี้' })
      }
      if (hasOrgCycle(tenantId, null, parentId)) {
        return res.status(400).json({ success: false, message: 'โครงสร้างหน่วยงานวนซ้ำ (Cycle)' })
      }
    }

    if (managerId) {
      const mgr = db.prepare('SELECT id FROM employees WHERE id = ? AND tenant_id = ?').get(managerId, tenantId)
      if (!mgr) {
        return res.status(400).json({ success: false, message: 'ไม่พบหัวหน้างานในบริษัทนี้' })
      }
    }

    const dup = db.prepare('SELECT id FROM org_units WHERE tenant_id = ? AND name = ?').get(tenantId, trimmedName)
    if (dup) {
      return res.status(409).json({ success: false, message: 'ชื่อหน่วยงานนี้มีอยู่แล้ว' })
    }

    const id = generateId()
    const now = new Date().toISOString()
    const activeVal = is_active === undefined ? 1 : is_active ? 1 : 0

    db.prepare(`
      INSERT INTO org_units (id, tenant_id, name, parent_id, manager_employee_id, business_unit, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, trimmedName, parentId, managerId, bizUnit, activeVal, now, now)

    const created = db.prepare('SELECT * FROM org_units WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    res.status(201).json({ success: true, data: created })
  } catch (error: any) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({ success: false, message: 'ชื่อหน่วยงานนี้มีอยู่แล้ว' })
    }
    console.error('Create org unit error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// PUT /api/hr/org-units/:id
router.put('/org-units/:id', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const id = req.params.id
    const existing = db.prepare('SELECT * FROM org_units WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบหน่วยงาน' })
    }

    const { name, parent_id, manager_employee_id, business_unit, is_active } = req.body || {}
    const nextName = name !== undefined ? (typeof name === 'string' ? name.trim() : '') : existing.name
    if (!nextName) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อหน่วยงาน' })
    }

    const nextParentId = parent_id !== undefined ? (parent_id ? String(parent_id).trim() : null) : existing.parent_id
    const nextManagerId = manager_employee_id !== undefined ? (manager_employee_id ? String(manager_employee_id).trim() : null) : existing.manager_employee_id
    const nextBizUnit = business_unit !== undefined ? (business_unit ? String(business_unit).trim() : null) : existing.business_unit
    const nextActive = is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active

    if (nextBizUnit && !(ALLOWED_BUSINESS_UNITS as readonly string[]).includes(nextBizUnit)) {
      return res.status(400).json({ success: false, message: 'หน่วยธุรกิจไม่ถูกต้อง' })
    }

    if (nextParentId) {
      if (nextParentId === id) {
        return res.status(400).json({ success: false, message: 'ไม่สามารถตั้งหน่วยงานเป็นหน่วยงานแม่ของตัวเองได้' })
      }
      const parent = db.prepare('SELECT id FROM org_units WHERE id = ? AND tenant_id = ?').get(nextParentId, tenantId)
      if (!parent) {
        return res.status(400).json({ success: false, message: 'ไม่พบหน่วยงานแม่ในบริษัทนี้' })
      }
      if (hasOrgCycle(tenantId, id, nextParentId)) {
        return res.status(400).json({ success: false, message: 'โครงสร้างหน่วยงานวนซ้ำ (Cycle)' })
      }
    }

    if (nextManagerId) {
      const mgr = db.prepare('SELECT id FROM employees WHERE id = ? AND tenant_id = ?').get(nextManagerId, tenantId)
      if (!mgr) {
        return res.status(400).json({ success: false, message: 'ไม่พบหัวหน้างานในบริษัทนี้' })
      }
    }

    const dup = db.prepare('SELECT id FROM org_units WHERE tenant_id = ? AND name = ? AND id != ?').get(tenantId, nextName, id)
    if (dup) {
      return res.status(409).json({ success: false, message: 'ชื่อหน่วยงานนี้มีอยู่แล้ว' })
    }

    const now = new Date().toISOString()
    db.prepare(`
      UPDATE org_units
      SET name = ?, parent_id = ?, manager_employee_id = ?, business_unit = ?, is_active = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(nextName, nextParentId, nextManagerId, nextBizUnit, nextActive, now, id, tenantId)

    const updated = db.prepare('SELECT * FROM org_units WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    res.json({ success: true, data: updated })
  } catch (error: any) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({ success: false, message: 'ชื่อหน่วยงานนี้มีอยู่แล้ว' })
    }
    console.error('Update org unit error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// DELETE /api/hr/org-units/:id
router.delete('/org-units/:id', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const id = req.params.id
    const existing = db.prepare('SELECT id FROM org_units WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบหน่วยงาน' })
    }

    const activeEmp = db.prepare(
      `SELECT 1 FROM employees WHERE tenant_id = ? AND org_unit_id = ? AND status = 'ACTIVE' LIMIT 1`
    ).get(tenantId, id)
    if (activeEmp) {
      return res.status(409).json({ success: false, message: 'ไม่สามารถลบหน่วยงานที่ยังมีพนักงานปฏิบัติงานอยู่ได้' })
    }

    const childUnit = db.prepare(
      `SELECT 1 FROM org_units WHERE tenant_id = ? AND parent_id = ? LIMIT 1`
    ).get(tenantId, id)
    if (childUnit) {
      return res.status(409).json({ success: false, message: 'ไม่สามารถลบหน่วยงานที่ยังมีหน่วยงานย่อยอยู่ได้' })
    }

    db.transaction(() => {
      db.prepare('UPDATE employees SET org_unit_id = NULL WHERE tenant_id = ? AND org_unit_id = ?').run(tenantId, id)
      db.prepare('DELETE FROM org_units WHERE id = ? AND tenant_id = ?').run(id, tenantId)
    })()

    res.json({ success: true, message: 'ลบหน่วยงานเรียบร้อยแล้ว' })
  } catch (error: any) {
    console.error('Delete org unit error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/hr/employees?status=&org_unit_id=&q=
router.get('/employees', requirePermission('hr', 'read'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const canWrite = userCan(req.user!, 'hr', 'write')
    const { status, org_unit_id, q } = req.query

    let sql = `
      SELECT e.*, ou.name as org_unit_name, ou.business_unit as business_unit
      FROM employees e
      LEFT JOIN org_units ou ON e.org_unit_id = ou.id AND ou.tenant_id = e.tenant_id
      WHERE e.tenant_id = ?
    `
    const params: any[] = [tenantId]

    if (typeof status === 'string' && status.trim()) {
      sql += ' AND e.status = ?'
      params.push(status.trim())
    }
    if (typeof org_unit_id === 'string' && org_unit_id.trim()) {
      sql += ' AND e.org_unit_id = ?'
      params.push(org_unit_id.trim())
    }
    if (typeof q === 'string' && q.trim()) {
      const like = `%${q.trim()}%`
      sql += ' AND (e.code LIKE ? OR e.first_name LIKE ? OR e.last_name LIKE ? OR e.nickname LIKE ? OR e.position LIKE ?)'
      params.push(like, like, like, like, like)
    }

    sql += ' ORDER BY e.code ASC'
    const rows = (db.prepare(sql).all(...params) as any[]).map(r => sanitizeEmployee(r, canWrite))
    res.json({ success: true, data: rows })
  } catch (error: any) {
    console.error('List employees error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/hr/employees/:id
router.get('/employees/:id', requirePermission('hr', 'read'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const canWrite = userCan(req.user!, 'hr', 'write')
    const row = db.prepare(`
      SELECT e.*, ou.name as org_unit_name, ou.business_unit as business_unit
      FROM employees e
      LEFT JOIN org_units ou ON e.org_unit_id = ou.id AND ou.tenant_id = e.tenant_id
      WHERE e.id = ? AND e.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!row) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' })
    }
    res.json({ success: true, data: sanitizeEmployee(row, canWrite) })
  } catch (error: any) {
    console.error('Get employee error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

function normalizeTaxAllowances(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return '{}'
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return JSON.stringify(raw)
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return JSON.stringify(parsed)
      }
    } catch { /* fallthrough */ }
  }
  return null
}

// POST /api/hr/employees
router.post('/employees', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const body = req.body || {}

    if (typeof body.first_name !== 'string' || !body.first_name.trim()) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อจริงของพนักงาน' })
    }
    const firstName = body.first_name.trim()
    const lastName = body.last_name != null && String(body.last_name).trim() !== '' ? String(body.last_name).trim() : null
    const nickname = body.nickname != null && String(body.nickname).trim() !== '' ? String(body.nickname).trim() : null
    const position = body.position != null && String(body.position).trim() !== '' ? String(body.position).trim() : null

    const employmentType = body.employment_type
    if (typeof employmentType !== 'string' || !(ALLOWED_EMPLOYMENT_TYPES as readonly string[]).includes(employmentType)) {
      return res.status(400).json({ success: false, message: 'ประเภทการจ้างต้องเป็น MONTHLY, DAILY หรือ HOURLY' })
    }

    const rawWage = body.base_wage === undefined || body.base_wage === null || body.base_wage === '' ? 0 : body.base_wage
    if (typeof rawWage === 'boolean' || Array.isArray(rawWage) || !Number.isFinite(Number(rawWage)) || Number(rawWage) < 0) {
      return res.status(400).json({ success: false, message: 'ฐานค่าจ้างต้องเป็นตัวเลขไม่ติดลบ' })
    }
    const baseWage = Number(rawWage)

    if (!isValidDate(body.start_date)) {
      return res.status(400).json({ success: false, message: 'วันที่เริ่มงานต้องอยู่ในรูปแบบ YYYY-MM-DD' })
    }
    const startDate = body.start_date

    const endDate = body.end_date != null && String(body.end_date).trim() !== '' ? String(body.end_date).trim() : null
    if (endDate !== null && !isValidDate(endDate)) {
      return res.status(400).json({ success: false, message: 'วันที่สิ้นสุดต้องอยู่ในรูปแบบ YYYY-MM-DD' })
    }

    const status = body.status === undefined || body.status === null || body.status === '' ? 'ACTIVE' : body.status
    if (typeof status !== 'string' || !(ALLOWED_STATUSES as readonly string[]).includes(status)) {
      return res.status(400).json({ success: false, message: 'สถานะพนักงานไม่ถูกต้อง' })
    }

    const orgUnitId = body.org_unit_id != null && String(body.org_unit_id).trim() !== '' ? String(body.org_unit_id).trim() : null
    if (orgUnitId) {
      const ou = db.prepare('SELECT id FROM org_units WHERE id = ? AND tenant_id = ?').get(orgUnitId, tenantId)
      if (!ou) {
        return res.status(400).json({ success: false, message: 'ไม่พบหน่วยงานในบริษัทนี้' })
      }
    }

    const userId = body.user_id != null && String(body.user_id).trim() !== '' ? String(body.user_id).trim() : null
    if (userId) {
      const u = db.prepare('SELECT id FROM users WHERE id = ? AND tenant_id = ?').get(userId, tenantId)
      if (!u) {
        return res.status(400).json({ success: false, message: 'ไม่พบบัญชีผู้ใช้ในบริษัทนี้' })
      }
      const linked = db.prepare('SELECT id FROM employees WHERE tenant_id = ? AND user_id = ?').get(tenantId, userId)
      if (linked) {
        return res.status(409).json({ success: false, message: 'บัญชีผู้ใช้นี้ผูกกับพนักงานคนอื่นแล้ว' })
      }
    }

    const devicePin = body.device_pin != null && String(body.device_pin).trim() !== '' ? String(body.device_pin).trim() : null
    if (devicePin) {
      const dupPin = db.prepare('SELECT id FROM employees WHERE tenant_id = ? AND device_pin = ?').get(tenantId, devicePin)
      if (dupPin) {
        return res.status(409).json({ success: false, message: 'รหัส PIN ซ้ำกับพนักงานคนอื่น' })
      }
    }

    const taxAllowances = normalizeTaxAllowances(body.tax_allowances)
    if (taxAllowances === null) {
      return res.status(400).json({ success: false, message: 'ข้อมูลลดหย่อนภาษีต้องเป็น JSON object' })
    }

    const rawCode = typeof body.code === 'string' ? body.code.trim() : ''
    const code = rawCode || nextEmployeeCode(tenantId)
    const dupCode = db.prepare('SELECT id FROM employees WHERE tenant_id = ? AND code = ?').get(tenantId, code)
    if (dupCode) {
      return res.status(409).json({ success: false, message: 'รหัสพนักงานซ้ำในบริษัทนี้' })
    }

    const ssoEnrolled = body.sso_enrolled === undefined ? 1 : body.sso_enrolled ? 1 : 0
    const nationalId = body.national_id != null && String(body.national_id).trim() !== '' ? String(body.national_id).trim() : null
    const bankName = body.bank_name != null && String(body.bank_name).trim() !== '' ? String(body.bank_name).trim() : null
    const bankAccount = body.bank_account != null && String(body.bank_account).trim() !== '' ? String(body.bank_account).trim() : null
    const phone = body.phone != null && String(body.phone).trim() !== '' ? String(body.phone).trim() : null
    const email = body.email != null && String(body.email).trim() !== '' ? String(body.email).trim() : null
    const address = body.address != null && String(body.address).trim() !== '' ? String(body.address).trim() : null
    const notes = body.notes != null && String(body.notes).trim() !== '' ? String(body.notes).trim() : null

    const id = generateId()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO employees (
        id, tenant_id, code, first_name, last_name, nickname, org_unit_id, position,
        employment_type, base_wage, start_date, end_date, status,
        national_id, bank_name, bank_account, phone, email, address,
        sso_enrolled, tax_allowances, user_id, device_pin, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, code, firstName, lastName, nickname, orgUnitId, position,
      employmentType, baseWage, startDate, endDate, status,
      nationalId, bankName, bankAccount, phone, email, address,
      ssoEnrolled, taxAllowances, userId, devicePin, notes, now, now
    )

    const created = db.prepare(`
      SELECT e.*, ou.name as org_unit_name, ou.business_unit as business_unit
      FROM employees e
      LEFT JOIN org_units ou ON e.org_unit_id = ou.id AND ou.tenant_id = e.tenant_id
      WHERE e.id = ? AND e.tenant_id = ?
    `).get(id, tenantId)

    res.status(201).json({ success: true, data: created })
  } catch (error: any) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({ success: false, message: 'ข้อมูลพนักงานซ้ำกับที่มีอยู่ในระบบ' })
    }
    console.error('Create employee error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// PUT /api/hr/employees/:id
router.put('/employees/:id', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const id = req.params.id
    const existing = db.prepare('SELECT * FROM employees WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' })
    }

    const body = req.body || {}

    const firstName = body.first_name !== undefined
      ? (typeof body.first_name === 'string' ? body.first_name.trim() : '')
      : existing.first_name
    if (!firstName) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อจริงของพนักงาน' })
    }

    const code = body.code !== undefined
      ? (typeof body.code === 'string' ? body.code.trim() : '')
      : existing.code
    if (!code) {
      return res.status(400).json({ success: false, message: 'รหัสพนักงานห้ามว่าง' })
    }
    const dupCode = db.prepare('SELECT id FROM employees WHERE tenant_id = ? AND code = ? AND id != ?').get(tenantId, code, id)
    if (dupCode) {
      return res.status(409).json({ success: false, message: 'รหัสพนักงานซ้ำในบริษัทนี้' })
    }

    const employmentType = body.employment_type !== undefined ? body.employment_type : existing.employment_type
    if (typeof employmentType !== 'string' || !(ALLOWED_EMPLOYMENT_TYPES as readonly string[]).includes(employmentType)) {
      return res.status(400).json({ success: false, message: 'ประเภทการจ้างต้องเป็น MONTHLY, DAILY หรือ HOURLY' })
    }

    let baseWage = existing.base_wage
    if (body.base_wage !== undefined) {
      if (typeof body.base_wage === 'boolean' || Array.isArray(body.base_wage) || body.base_wage === '' || body.base_wage === null || !Number.isFinite(Number(body.base_wage)) || Number(body.base_wage) < 0) {
        return res.status(400).json({ success: false, message: 'ฐานค่าจ้างต้องเป็นตัวเลขไม่ติดลบ' })
      }
      baseWage = Number(body.base_wage)
    }

    const startDate = body.start_date !== undefined ? body.start_date : existing.start_date
    if (!isValidDate(startDate)) {
      return res.status(400).json({ success: false, message: 'วันที่เริ่มงานต้องอยู่ในรูปแบบ YYYY-MM-DD' })
    }

    const endDate = body.end_date !== undefined
      ? (body.end_date != null && String(body.end_date).trim() !== '' ? String(body.end_date).trim() : null)
      : existing.end_date
    if (endDate !== null && !isValidDate(endDate)) {
      return res.status(400).json({ success: false, message: 'วันที่สิ้นสุดต้องอยู่ในรูปแบบ YYYY-MM-DD' })
    }

    const status = body.status !== undefined ? body.status : existing.status
    if (typeof status !== 'string' || !(ALLOWED_STATUSES as readonly string[]).includes(status)) {
      return res.status(400).json({ success: false, message: 'สถานะพนักงานไม่ถูกต้อง' })
    }

    const orgUnitId = body.org_unit_id !== undefined
      ? (body.org_unit_id != null && String(body.org_unit_id).trim() !== '' ? String(body.org_unit_id).trim() : null)
      : existing.org_unit_id
    if (orgUnitId) {
      const ou = db.prepare('SELECT id FROM org_units WHERE id = ? AND tenant_id = ?').get(orgUnitId, tenantId)
      if (!ou) {
        return res.status(400).json({ success: false, message: 'ไม่พบหน่วยงานในบริษัทนี้' })
      }
    }

    const userId = body.user_id !== undefined
      ? (body.user_id != null && String(body.user_id).trim() !== '' ? String(body.user_id).trim() : null)
      : existing.user_id
    if (userId) {
      const u = db.prepare('SELECT id FROM users WHERE id = ? AND tenant_id = ?').get(userId, tenantId)
      if (!u) {
        return res.status(400).json({ success: false, message: 'ไม่พบบัญชีผู้ใช้ในบริษัทนี้' })
      }
      const linked = db.prepare('SELECT id FROM employees WHERE tenant_id = ? AND user_id = ? AND id != ?').get(tenantId, userId, id)
      if (linked) {
        return res.status(409).json({ success: false, message: 'บัญชีผู้ใช้นี้ผูกกับพนักงานคนอื่นแล้ว' })
      }
    }

    const devicePin = body.device_pin !== undefined
      ? (body.device_pin != null && String(body.device_pin).trim() !== '' ? String(body.device_pin).trim() : null)
      : existing.device_pin
    if (devicePin) {
      const dupPin = db.prepare('SELECT id FROM employees WHERE tenant_id = ? AND device_pin = ? AND id != ?').get(tenantId, devicePin, id)
      if (dupPin) {
        return res.status(409).json({ success: false, message: 'รหัส PIN ซ้ำกับพนักงานคนอื่น' })
      }
    }

    const taxAllowances = body.tax_allowances !== undefined
      ? normalizeTaxAllowances(body.tax_allowances)
      : existing.tax_allowances
    if (taxAllowances === null) {
      return res.status(400).json({ success: false, message: 'ข้อมูลลดหย่อนภาษีต้องเป็น JSON object' })
    }

    const optStr = (field: string) =>
      body[field] !== undefined
        ? (body[field] != null && String(body[field]).trim() !== '' ? String(body[field]).trim() : null)
        : existing[field]

    const ssoEnrolled = body.sso_enrolled !== undefined ? (body.sso_enrolled ? 1 : 0) : existing.sso_enrolled
    const now = new Date().toISOString()

    db.prepare(`
      UPDATE employees SET
        code = ?, first_name = ?, last_name = ?, nickname = ?, org_unit_id = ?, position = ?,
        employment_type = ?, base_wage = ?, start_date = ?, end_date = ?, status = ?,
        national_id = ?, bank_name = ?, bank_account = ?, phone = ?, email = ?, address = ?,
        sso_enrolled = ?, tax_allowances = ?, user_id = ?, device_pin = ?, notes = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(
      code, firstName, optStr('last_name'), optStr('nickname'), orgUnitId, optStr('position'),
      employmentType, baseWage, startDate, endDate, status,
      optStr('national_id'), optStr('bank_name'), optStr('bank_account'), optStr('phone'), optStr('email'), optStr('address'),
      ssoEnrolled, taxAllowances, userId, devicePin, optStr('notes'), now,
      id, tenantId
    )

    const updated = db.prepare(`
      SELECT e.*, ou.name as org_unit_name, ou.business_unit as business_unit
      FROM employees e
      LEFT JOIN org_units ou ON e.org_unit_id = ou.id AND ou.tenant_id = e.tenant_id
      WHERE e.id = ? AND e.tenant_id = ?
    `).get(id, tenantId)

    res.json({ success: true, data: updated })
  } catch (error: any) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({ success: false, message: 'ข้อมูลพนักงานซ้ำกับที่มีอยู่ในระบบ' })
    }
    console.error('Update employee error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/hr/employees/:id/offboard
router.post('/employees/:id/offboard', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const id = req.params.id
    const existing = db.prepare('SELECT * FROM employees WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' })
    }

    const { end_date, status } = req.body || {}
    if (!isValidDate(end_date)) {
      return res.status(400).json({ success: false, message: 'วันที่สิ้นสุดการทำงานต้องอยู่ในรูปแบบ YYYY-MM-DD' })
    }
    if (status !== 'RESIGNED' && status !== 'TERMINATED') {
      return res.status(400).json({ success: false, message: 'สถานะการพ้นสภาพต้องเป็น RESIGNED หรือ TERMINATED' })
    }

    const now = new Date().toISOString()
    db.prepare(`
      UPDATE employees SET end_date = ?, status = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(end_date, status, now, id, tenantId)

    const updated = db.prepare(`
      SELECT e.*, ou.name as org_unit_name, ou.business_unit as business_unit
      FROM employees e
      LEFT JOIN org_units ou ON e.org_unit_id = ou.id AND ou.tenant_id = e.tenant_id
      WHERE e.id = ? AND e.tenant_id = ?
    `).get(id, tenantId)

    res.json({ success: true, data: updated })
  } catch (error: any) {
    console.error('Offboard employee error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
