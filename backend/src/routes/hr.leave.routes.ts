import { Router, Request, Response } from 'express'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { can } from '../services/rbac.service'
import { createRequest } from '../services/approvalGate.service'

// สัญญากลาง: docs/contracts/hr-phase4.md — การลา + วันหยุด (งาน B1)
const router = Router()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidDate(val: unknown): val is string {
  if (typeof val !== 'string' || !DATE_RE.test(val)) return false
  const d = new Date(`${val}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === val
}

function isUniqueConstraintError(err: any): boolean {
  return (
    err?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    String(err?.message || '').includes('UNIQUE constraint failed')
  )
}

function userHasHr(req: Request, action: 'read' | 'write'): boolean {
  if (!req.user) return false
  return can(
    req.user.role,
    req.user.departments || [],
    'hr',
    action,
    req.user.customPermissions
  )
}

function getSelfEmployee(tenantId: string, userId: string) {
  return db.prepare(
    `SELECT * FROM employees WHERE tenant_id = ? AND user_id = ? AND status = 'ACTIVE'`
  ).get(tenantId, userId) as any
}

const STARTER_LEAVE_TYPES = [
  { code: 'SICK', name: 'ลาป่วย', paid: 1, days_per_year: 30 },
  { code: 'PERSONAL', name: 'ลากิจ', paid: 1, days_per_year: 3 },
  { code: 'VACATION', name: 'ลาพักร้อน', paid: 1, days_per_year: 6 },
  { code: 'MATERNITY', name: 'ลาคลอด', paid: 1, days_per_year: 120 },
  { code: 'STERILIZATION', name: 'ลาทำหมัน', paid: 1, days_per_year: null },
  { code: 'MILITARY', name: 'ลารับราชการทหาร', paid: 1, days_per_year: 60 },
  { code: 'TRAINING', name: 'ลาฝึกอบรม', paid: 1, days_per_year: null },
  { code: 'UNPAID', name: 'ลาไม่รับค่าจ้าง', paid: 0, days_per_year: null },
]

// L1: GET /leave-types (hr:read หรือ self)
router.get('/leave-types', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const hasHr = userHasHr(req, 'read')
    const selfEmp = getSelfEmployee(tenantId, req.user!.userId)

    if (!hasHr && !selfEmp) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const activeOnly = req.query.active === '1'
    const rows = db.prepare(`
      SELECT id, code, name, paid, days_per_year, is_active
      FROM leave_types
      WHERE tenant_id = ? ${activeOnly ? 'AND is_active = 1' : ''}
      ORDER BY code ASC
    `).all(tenantId) as any[]

    const data = rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      paid: Boolean(r.paid),
      days_per_year: r.days_per_year !== null ? Number(r.days_per_year) : null,
      is_active: Boolean(r.is_active),
    }))

    res.json({ success: true, data })
  } catch (err: any) {
    console.error('Get leave types error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// L4: POST /leave-types/starter (hr:write) — วางก่อน /:id เพื่อไม่ให้ชน path
router.post('/leave-types/starter', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const existing = new Set(
      (
        db.prepare('SELECT code FROM leave_types WHERE tenant_id = ?').all(tenantId) as { code: string }[]
      ).map((r) => r.code)
    )

    let created = 0
    const now = new Date().toISOString()
    const insertStmt = db.prepare(`
      INSERT INTO leave_types (id, tenant_id, code, name, paid, days_per_year, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `)

    db.transaction(() => {
      // ponytail: starter set ใช้ค่าคงที่ 8 รายการตามกฎหมายแรงงานไทย ไม่ต้องคอนฟิกเพิ่ม
      for (const item of STARTER_LEAVE_TYPES) {
        if (!existing.has(item.code)) {
          insertStmt.run(generateId(), tenantId, item.code, item.name, item.paid, item.days_per_year, now)
          created++
        }
      }
    })()

    res.json({ success: true, data: { created } })
  } catch (err: any) {
    console.error('Create starter leave types error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// L2: POST /leave-types (hr:write)
router.post('/leave-types', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const { code, name, paid, days_per_year, is_active } = req.body
    if (typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสประเภทการลา' })
    }
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อประเภทการลา' })
    }
    if (paid === undefined || paid === null) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุสถานะการจ่ายค่าจ้าง' })
    }

    let parsedDays: number | null = null
    if (days_per_year !== undefined && days_per_year !== null) {
      const d = Number(days_per_year)
      if (isNaN(d) || d < 0) {
        return res.status(400).json({ success: false, message: 'จำนวนวันลาต่อปีไม่ถูกต้อง' })
      }
      parsedDays = d
    }

    const tenantId = req.user!.tenantId
    const id = generateId()
    const now = new Date().toISOString()
    const activeVal = is_active === undefined ? 1 : is_active ? 1 : 0
    const paidVal = paid ? 1 : 0

    try {
      db.prepare(`
        INSERT INTO leave_types (id, tenant_id, code, name, paid, days_per_year, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tenantId, code.trim(), name.trim(), paidVal, parsedDays, activeVal, now)
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
        return res.status(409).json({ success: false, message: 'รหัสประเภทการลาซ้ำ' })
      }
      throw err
    }

    res.status(201).json({
      success: true,
      data: {
        id,
        code: code.trim(),
        name: name.trim(),
        paid: Boolean(paidVal),
        days_per_year: parsedDays,
        is_active: Boolean(activeVal),
      },
    })
  } catch (err: any) {
    console.error('Create leave type error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// L3: PUT /leave-types/:id (hr:write)
router.put('/leave-types/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const existing = db.prepare(
      'SELECT * FROM leave_types WHERE id = ? AND tenant_id = ?'
    ).get(req.params.id, tenantId) as any

    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบประเภทการลา' })
    }

    let newName = existing.name
    if (req.body.name !== undefined) {
      if (typeof req.body.name !== 'string' || !req.body.name.trim()) {
        return res.status(400).json({ success: false, message: 'ชื่อประเภทการลาต้องไม่ว่างเปล่า' })
      }
      newName = req.body.name.trim()
    }

    const newPaid = req.body.paid !== undefined ? (req.body.paid ? 1 : 0) : existing.paid

    let newDays = existing.days_per_year
    if (req.body.days_per_year !== undefined) {
      if (req.body.days_per_year === null) {
        newDays = null
      } else {
        const d = Number(req.body.days_per_year)
        if (isNaN(d) || d < 0) {
          return res.status(400).json({ success: false, message: 'จำนวนวันลาต่อปีไม่ถูกต้อง' })
        }
        newDays = d
      }
    }

    const newActive = req.body.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active

    db.prepare(`
      UPDATE leave_types
      SET name = ?, paid = ?, days_per_year = ?, is_active = ?
      WHERE id = ? AND tenant_id = ?
    `).run(newName, newPaid, newDays, newActive, existing.id, tenantId)

    res.json({
      success: true,
      data: {
        id: existing.id,
        code: existing.code,
        name: newName,
        paid: Boolean(newPaid),
        days_per_year: newDays !== null ? Number(newDays) : null,
        is_active: Boolean(newActive),
      },
    })
  } catch (err: any) {
    console.error('Update leave type error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// L5: GET /holidays (hr:read หรือ self)
router.get('/holidays', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const hasHr = userHasHr(req, 'read')
    const selfEmp = getSelfEmployee(tenantId, req.user!.userId)

    if (!hasHr && !selfEmp) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const yearStr =
      typeof req.query.year === 'string' && req.query.year.trim()
        ? req.query.year.trim()
        : thaiDateStr().slice(0, 4)

    if (!/^\d{4}$/.test(yearStr)) {
      return res.status(400).json({ success: false, message: 'ปีไม่ถูกต้อง' })
    }

    const rows = db.prepare(`
      SELECT id, date, name
      FROM public_holidays
      WHERE tenant_id = ? AND date LIKE ?
      ORDER BY date ASC
    `).all(tenantId, `${yearStr}-%`) as any[]

    res.json({ success: true, data: rows })
  } catch (err: any) {
    console.error('Get holidays error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// L6: POST /holidays (hr:write)
router.post('/holidays', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const { date, name } = req.body
    if (!isValidDate(date)) {
      return res.status(400).json({ success: false, message: 'วันที่ไม่ถูกต้อง' })
    }
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อวันหยุด' })
    }

    const tenantId = req.user!.tenantId
    const id = generateId()
    const now = new Date().toISOString()
    const trimmedName = name.trim()

    try {
      db.prepare(`
        INSERT INTO public_holidays (id, tenant_id, date, name, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, tenantId, date, trimmedName, now)
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
        return res.status(409).json({ success: false, message: 'มีวันหยุดในวันที่นี้แล้ว' })
      }
      throw err
    }

    res.status(201).json({
      success: true,
      data: {
        id,
        date,
        name: trimmedName,
      },
    })
  } catch (err: any) {
    console.error('Create holiday error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// L7: DELETE /holidays/:id (hr:write)
router.delete('/holidays/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const info = db.prepare(
      'DELETE FROM public_holidays WHERE id = ? AND tenant_id = ?'
    ).run(req.params.id, tenantId)

    if (info.changes === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบวันหยุด' })
    }

    res.json({ success: true, data: { id: req.params.id } })
  } catch (err: any) {
    console.error('Delete holiday error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// L8: GET /leave-requests (hr:read, self เห็นได้แค่ของตัวเอง)
router.get('/leave-requests', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const hasHr = userHasHr(req, 'read')
    const selfEmp = getSelfEmployee(tenantId, req.user!.userId)

    if (!hasHr && !selfEmp) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    let targetEmployeeId: string | undefined =
      typeof req.query.employee_id === 'string' && req.query.employee_id.trim()
        ? req.query.employee_id.trim()
        : undefined

    if (!hasHr) {
      if (targetEmployeeId && targetEmployeeId !== selfEmp.id) {
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ดูคำขอของพนักงานอื่น' })
      }
      targetEmployeeId = selfEmp.id
    }

    const conditions: string[] = ['lr.tenant_id = ?']
    const params: any[] = [tenantId]

    if (targetEmployeeId) {
      conditions.push('lr.employee_id = ?')
      params.push(targetEmployeeId)
    }

    if (typeof req.query.status === 'string' && req.query.status.trim()) {
      conditions.push('lr.status = ?')
      params.push(req.query.status.trim())
    }

    if (typeof req.query.from === 'string' && req.query.from.trim()) {
      const fromStr = req.query.from.trim()
      if (!isValidDate(fromStr)) {
        return res.status(400).json({ success: false, message: 'วันที่เริ่มต้นไม่ถูกต้อง' })
      }
      conditions.push('lr.end_date >= ?')
      params.push(fromStr)
    }

    if (typeof req.query.to === 'string' && req.query.to.trim()) {
      const toStr = req.query.to.trim()
      if (!isValidDate(toStr)) {
        return res.status(400).json({ success: false, message: 'วันที่สิ้นสุดไม่ถูกต้อง' })
      }
      conditions.push('lr.start_date <= ?')
      params.push(toStr)
    }

    const rows = db.prepare(`
      SELECT
        lr.id,
        lr.employee_id,
        e.code AS employee_code,
        e.first_name,
        e.last_name,
        ou.name AS org_unit_name,
        lr.leave_type_id,
        lt.code AS leave_type_code,
        lt.name AS leave_type_name,
        lt.paid AS leave_type_paid,
        lr.start_date,
        lr.end_date,
        lr.days,
        lr.reason,
        lr.status,
        lr.approval_request_id,
        lr.requested_by,
        lr.decided_by,
        lr.decided_at,
        lr.created_at
      FROM leave_requests lr
      JOIN employees e ON lr.employee_id = e.id AND e.tenant_id = lr.tenant_id
      LEFT JOIN org_units ou ON e.org_unit_id = ou.id AND ou.tenant_id = lr.tenant_id
      JOIN leave_types lt ON lr.leave_type_id = lt.id AND lt.tenant_id = lr.tenant_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY lr.created_at DESC
      LIMIT 500
    `).all(...params) as any[]

    const data = rows.map((r) => ({
      id: r.id,
      employee_id: r.employee_id,
      employee_code: r.employee_code,
      employee_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      org_unit_name: r.org_unit_name ?? null,
      leave_type_id: r.leave_type_id,
      leave_type_code: r.leave_type_code,
      leave_type_name: r.leave_type_name,
      paid: Boolean(r.leave_type_paid),
      start_date: r.start_date,
      end_date: r.end_date,
      days: Number(r.days),
      reason: r.reason ?? null,
      status: r.status,
      approval_request_id: r.approval_request_id ?? null,
      requested_by: r.requested_by ?? null,
      decided_by: r.decided_by ?? null,
      decided_at: r.decided_at ?? null,
      created_at: r.created_at,
    }))

    res.json({ success: true, data })
  } catch (err: any) {
    console.error('Get leave requests error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// L9: POST /leave-requests (self ของตัวเองเท่านั้น หรือ hr:write)
router.post('/leave-requests', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const hasHrWrite = userHasHr(req, 'write')
    const selfEmp = getSelfEmployee(tenantId, req.user!.userId)

    if (!hasHrWrite && !selfEmp) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์สร้างคำขอลา' })
    }

    const { employee_id, leave_type_id, start_date, end_date, days, reason } = req.body

    if (!employee_id || typeof employee_id !== 'string') {
      return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสพนักงาน' })
    }
    if (!leave_type_id || typeof leave_type_id !== 'string') {
      return res.status(400).json({ success: false, message: 'กรุณาระบุประเภทการลา' })
    }

    if (!hasHrWrite && employee_id !== selfEmp.id) {
      return res.status(403).json({ success: false, message: 'สามารถขอลาให้ตนเองเท่านั้น' })
    }

    const emp = db.prepare(
      'SELECT id, code, first_name, last_name, status, org_unit_id FROM employees WHERE id = ? AND tenant_id = ?'
    ).get(employee_id, tenantId) as any

    if (!emp) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' })
    }
    if (emp.status !== 'ACTIVE') {
      return res.status(400).json({ success: false, message: 'พนักงานไม่อยู่ในสถานะปฏิบัติงาน' })
    }

    const leaveType = db.prepare(
      'SELECT id, code, name, paid, days_per_year, is_active FROM leave_types WHERE id = ? AND tenant_id = ?'
    ).get(leave_type_id, tenantId) as any

    if (!leaveType) {
      return res.status(404).json({ success: false, message: 'ไม่พบประเภทการลา' })
    }
    if (!leaveType.is_active) {
      return res.status(400).json({ success: false, message: 'ประเภทการลานี้ไม่ได้เปิดใช้งาน' })
    }

    if (!isValidDate(start_date) || !isValidDate(end_date)) {
      return res.status(400).json({ success: false, message: 'วันที่ไม่ถูกต้อง' })
    }
    if (start_date > end_date) {
      return res.status(400).json({ success: false, message: 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น' })
    }

    const numDays = Number(days)
    if (!Number.isFinite(numDays) || numDays <= 0 || (numDays * 2) % 1 !== 0) {
      return res.status(400).json({ success: false, message: 'จำนวนวันลาต้องมากกว่า 0 และเป็นทวีคูณของ 0.5' })
    }

    const d1 = new Date(`${start_date}T00:00:00Z`).getTime()
    const d2 = new Date(`${end_date}T00:00:00Z`).getTime()
    const calendarDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1
    if (numDays > calendarDays) {
      return res.status(400).json({ success: false, message: 'จำนวนวันลาเกินจำนวนวันตามปฏิทินในช่วงที่ขอ' })
    }

    // Overlap check
    const overlap = db.prepare(`
      SELECT 1 FROM leave_requests
      WHERE tenant_id = ?
        AND employee_id = ?
        AND status IN ('PENDING', 'APPROVED')
        AND start_date <= ?
        AND end_date >= ?
      LIMIT 1
    `).get(tenantId, employee_id, end_date, start_date)

    if (overlap) {
      return res.status(409).json({ success: false, message: 'มีคำขอลาที่ซ้อนทับกับช่วงเวลาที่เลือกแล้ว' })
    }

    // Over-quota check: ponytail: โควตานับต่อปีปฏิทินของ start_date ไม่ทบยอดข้ามปี
    let isOverQuota = false
    if (leaveType.days_per_year !== null && leaveType.days_per_year !== undefined) {
      const year = start_date.slice(0, 4)
      const usage = db.prepare(`
        SELECT COALESCE(SUM(days), 0) as used
        FROM leave_requests
        WHERE tenant_id = ?
          AND employee_id = ?
          AND leave_type_id = ?
          AND status = 'APPROVED'
          AND start_date LIKE ?
      `).get(tenantId, employee_id, leave_type_id, `${year}-%`) as { used: number }
      if (usage.used + numDays > Number(leaveType.days_per_year)) {
        isOverQuota = true
      }
    }

    const empName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim()
    const desc = `${leaveType.name} ${numDays} วัน · ${empName} · ${start_date} ถึง ${end_date}${isOverQuota ? ' · เกินโควตา' : ''}`

    const leaveId = generateId()
    const now = new Date().toISOString()
    const reasonStr = typeof reason === 'string' && reason.trim() ? reason.trim() : null

    db.prepare(`
      INSERT INTO leave_requests (
        id, tenant_id, employee_id, leave_type_id, start_date, end_date, days,
        reason, status, approval_request_id, requested_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?, ?)
    `).run(
      leaveId,
      tenantId,
      employee_id,
      leave_type_id,
      start_date,
      end_date,
      numDays,
      reasonStr,
      req.user!.userId,
      now,
      now
    )

    const apr = createRequest({
      tenantId,
      user: {
        userId: req.user!.userId,
        email: req.user!.email,
        role: req.user!.role,
        departments: req.user!.departments,
        customPermissions: req.user!.customPermissions,
      },
      category: 'leave',
      refType: 'leave_requests',
      refId: leaveId,
      description: desc,
      amount: 0,
    })

    db.prepare(
      'UPDATE leave_requests SET approval_request_id = ? WHERE id = ? AND tenant_id = ?'
    ).run(apr.id, leaveId, tenantId)

    let orgUnitName: string | null = null
    if (emp.org_unit_id) {
      const ou = db.prepare('SELECT name FROM org_units WHERE id = ? AND tenant_id = ?').get(emp.org_unit_id, tenantId) as any
      orgUnitName = ou?.name ?? null
    }

    res.status(201).json({
      success: true,
      data: {
        id: leaveId,
        employee_id,
        employee_code: emp.code,
        employee_name: empName,
        org_unit_name: orgUnitName,
        leave_type_id,
        leave_type_code: leaveType.code,
        leave_type_name: leaveType.name,
        paid: Boolean(leaveType.paid),
        start_date,
        end_date,
        days: numDays,
        reason: reasonStr,
        status: 'PENDING',
        approval_request_id: apr.id,
        requested_by: req.user!.userId,
        decided_by: null,
        decided_at: null,
        created_at: now,
      },
    })
  } catch (err: any) {
    console.error('Create leave request error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// L10: POST /leave-requests/:id/cancel (เจ้าของคำขอ หรือ hr:write)
router.post('/leave-requests/:id/cancel', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const row = db.prepare(`
      SELECT lr.*, e.user_id as employee_user_id, e.code as employee_code,
             e.first_name, e.last_name, e.org_unit_id,
             lt.code as leave_type_code, lt.name as leave_type_name, lt.paid as leave_type_paid
      FROM leave_requests lr
      JOIN employees e ON lr.employee_id = e.id AND e.tenant_id = lr.tenant_id
      JOIN leave_types lt ON lr.leave_type_id = lt.id AND lt.tenant_id = lr.tenant_id
      WHERE lr.id = ? AND lr.tenant_id = ?
    `).get(req.params.id, tenantId) as any

    if (!row) {
      return res.status(404).json({ success: false, message: 'ไม่พบคำขอลา' })
    }

    const isOwner = row.requested_by === req.user!.userId || row.employee_user_id === req.user!.userId
    const hasHrWrite = userHasHr(req, 'write')
    if (!isOwner && !hasHrWrite) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ยกเลิกคำขอนี้' })
    }

    // ponytail: ยกเลิกได้เมื่อ PENDING หรือ APPROVED ที่ยังไม่ถึง start_date (เทียบกับเวลาไทย ณ วันนี้)
    const today = thaiDateStr()
    const canCancel =
      row.status === 'PENDING' ||
      (row.status === 'APPROVED' && row.start_date > today)

    if (!canCancel) {
      return res.status(409).json({ success: false, message: 'ไม่สามารถยกเลิกคำขอนี้ได้' })
    }

    const now = new Date().toISOString()
    db.prepare(`
      UPDATE leave_requests
      SET status = 'CANCELLED', updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(now, row.id, tenantId)

    if (row.approval_request_id) {
      const apr = db.prepare(
        'SELECT id, status FROM approval_requests WHERE id = ? AND tenant_id = ?'
      ).get(row.approval_request_id, tenantId) as any

      if (apr && apr.status === 'PENDING') {
        db.prepare(`
          UPDATE approval_requests
          SET status = 'CANCELLED', updated_at = ?
          WHERE id = ? AND tenant_id = ?
        `).run(now, apr.id, tenantId)

        db.prepare(`
          INSERT INTO approval_logs (
            id, tenant_id, approval_request_id, action, actor_id, actor_name, actor_role,
            comment, old_status, new_status, created_at
          ) VALUES (?, ?, ?, 'CANCEL', ?, ?, ?, 'ผู้ขอยกเลิกเอง', 'PENDING', 'CANCELLED', ?)
        `).run(
          generateId(),
          tenantId,
          apr.id,
          req.user!.userId,
          req.user!.email,
          req.user!.role,
          now
        )
      }
    }

    let orgUnitName: string | null = null
    if (row.org_unit_id) {
      const ou = db.prepare('SELECT name FROM org_units WHERE id = ? AND tenant_id = ?').get(row.org_unit_id, tenantId) as any
      orgUnitName = ou?.name ?? null
    }

    res.json({
      success: true,
      data: {
        id: row.id,
        employee_id: row.employee_id,
        employee_code: row.employee_code,
        employee_name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
        org_unit_name: orgUnitName,
        leave_type_id: row.leave_type_id,
        leave_type_code: row.leave_type_code,
        leave_type_name: row.leave_type_name,
        paid: Boolean(row.leave_type_paid),
        start_date: row.start_date,
        end_date: row.end_date,
        days: Number(row.days),
        reason: row.reason ?? null,
        status: 'CANCELLED',
        approval_request_id: row.approval_request_id ?? null,
        requested_by: row.requested_by ?? null,
        decided_by: row.decided_by ?? null,
        decided_at: row.decided_at ?? null,
        created_at: row.created_at,
      },
    })
  } catch (err: any) {
    console.error('Cancel leave request error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// L11: GET /leave-balances (hr:read หรือ self ของตัวเอง)
router.get('/leave-balances', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const hasHr = userHasHr(req, 'read')
    const selfEmp = getSelfEmployee(tenantId, req.user!.userId)

    if (!hasHr && !selfEmp) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    let targetEmpId =
      typeof req.query.employee_id === 'string' && req.query.employee_id.trim()
        ? req.query.employee_id.trim()
        : undefined

    if (!hasHr) {
      if (targetEmpId && targetEmpId !== selfEmp.id) {
        return res.status(403).json({ success: false, message: 'สามารถดูได้เฉพาะยอดคงเหลือของตนเอง' })
      }
      targetEmpId = selfEmp.id
    } else {
      if (!targetEmpId) {
        if (selfEmp) {
          targetEmpId = selfEmp.id
        } else {
          return res.status(400).json({ success: false, message: 'กรุณาระบุ employee_id' })
        }
      }
    }

    const emp = db.prepare(
      'SELECT id FROM employees WHERE id = ? AND tenant_id = ?'
    ).get(targetEmpId, tenantId) as any

    if (!emp) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' })
    }

    const yearStr =
      typeof req.query.year === 'string' && req.query.year.trim()
        ? req.query.year.trim()
        : thaiDateStr().slice(0, 4)

    if (!/^\d{4}$/.test(yearStr)) {
      return res.status(400).json({ success: false, message: 'ปีไม่ถูกต้อง' })
    }

    const types = db.prepare(`
      SELECT id, code, name, paid, days_per_year
      FROM leave_types
      WHERE tenant_id = ? AND is_active = 1
      ORDER BY code ASC
    `).all(tenantId) as any[]

    const statsRows = db.prepare(`
      SELECT
        leave_type_id,
        SUM(CASE WHEN status = 'APPROVED' THEN days ELSE 0 END) AS used,
        SUM(CASE WHEN status = 'PENDING' THEN days ELSE 0 END) AS pending
      FROM leave_requests
      WHERE tenant_id = ?
        AND employee_id = ?
        AND start_date LIKE ?
        AND status IN ('APPROVED', 'PENDING')
      GROUP BY leave_type_id
    `).all(tenantId, targetEmpId, `${yearStr}-%`) as any[]

    const statsMap = new Map<string, { used: number; pending: number }>()
    for (const r of statsRows) {
      statsMap.set(r.leave_type_id, {
        used: Number(r.used) || 0,
        pending: Number(r.pending) || 0,
      })
    }

    const data = types.map((t) => {
      const stats = statsMap.get(t.id) || { used: 0, pending: 0 }
      const quota = t.days_per_year !== null && t.days_per_year !== undefined ? Number(t.days_per_year) : null
      const used = stats.used
      const pending = stats.pending
      const remaining = quota !== null ? quota - used : null
      return {
        leave_type_id: t.id,
        code: t.code,
        name: t.name,
        paid: Boolean(t.paid),
        quota,
        used,
        pending,
        remaining,
      }
    })

    res.json({ success: true, data })
  } catch (err: any) {
    console.error('Get leave balances error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

export default router
