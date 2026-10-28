import { Router, Request, Response } from 'express'
import { authenticate, requirePermission } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import {
  AttendanceError,
  getAttendanceSummary,
  getUnmappedPins,
  importAttendance,
} from '../services/hr/attendanceStore'

const router = Router()
router.use(authenticate, subscriptionGate('hr'))

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidTime(val: unknown): val is string {
  return typeof val === 'string' && TIME_RE.test(val.trim())
}

function isNonNegativeInt(val: unknown): boolean {
  if (typeof val === 'boolean' || Array.isArray(val) || val === '' || val === null) return false
  const n = Number(val)
  return Number.isInteger(n) && n >= 0
}

function isUniqueConstraintError(err: any): boolean {
  return (
    err?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    String(err?.message || '').includes('UNIQUE constraint failed')
  )
}

// GET /api/hr/shifts
router.get('/shifts', requirePermission('hr', 'read'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const rows = db
      .prepare('SELECT * FROM shifts WHERE tenant_id = ? ORDER BY name ASC')
      .all(tenantId)
    res.json({ success: true, data: rows, shifts: rows })
  } catch (error: any) {
    console.error('List shifts error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/hr/shifts
router.post('/shifts', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { name, start_time, end_time, grace_minutes, break_minutes, is_active } = req.body || {}

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อกะงาน' })
    }
    if (!isValidTime(start_time) || !isValidTime(end_time)) {
      return res
        .status(400)
        .json({ success: false, message: 'เวลาเข้า-ออกงานต้องอยู่ในรูปแบบ HH:mm (00:00 - 23:59)' })
    }

    const graceVal = grace_minutes === undefined ? 0 : grace_minutes
    const breakVal = break_minutes === undefined ? 60 : break_minutes
    if (!isNonNegativeInt(graceVal) || !isNonNegativeInt(breakVal)) {
      return res
        .status(400)
        .json({ success: false, message: 'เวลาผ่อนผันและเวลาพักต้องเป็นจำนวนเต็มไม่ติดลบ' })
    }

    const trimmedName = name.trim()
    const dup = db
      .prepare('SELECT id FROM shifts WHERE tenant_id = ? AND name = ?')
      .get(tenantId, trimmedName)
    if (dup) {
      return res.status(409).json({ success: false, message: 'ชื่อกะงานนี้มีอยู่แล้ว' })
    }

    const id = generateId()
    const now = new Date().toISOString()
    const activeVal = is_active === undefined ? 1 : is_active ? 1 : 0

    db.prepare(
      `
      INSERT INTO shifts (
        id, tenant_id, name, start_time, end_time, grace_minutes, break_minutes, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      id,
      tenantId,
      trimmedName,
      start_time.trim(),
      end_time.trim(),
      Number(graceVal),
      Number(breakVal),
      activeVal,
      now
    )

    const created = db
      .prepare('SELECT * FROM shifts WHERE id = ? AND tenant_id = ?')
      .get(id, tenantId)
    res.status(201).json({ success: true, data: created, shift: created })
  } catch (error: any) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({ success: false, message: 'ชื่อกะงานนี้มีอยู่แล้ว' })
    }
    console.error('Create shift error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

function handleUpdateShift(req: Request, res: Response) {
  try {
    const tenantId = req.user!.tenantId
    const id = req.params.id || req.body?.id
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสกะงาน' })
    }

    const existing = db
      .prepare('SELECT * FROM shifts WHERE id = ? AND tenant_id = ?')
      .get(id, tenantId) as any
    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบกะงาน' })
    }

    const { name, start_time, end_time, grace_minutes, break_minutes, is_active } = req.body || {}

    const nextName =
      name !== undefined ? (typeof name === 'string' ? name.trim() : '') : existing.name
    if (!nextName) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อกะงาน' })
    }

    const nextStart = start_time !== undefined ? start_time : existing.start_time
    const nextEnd = end_time !== undefined ? end_time : existing.end_time
    if (!isValidTime(nextStart) || !isValidTime(nextEnd)) {
      return res
        .status(400)
        .json({ success: false, message: 'เวลาเข้า-ออกงานต้องอยู่ในรูปแบบ HH:mm (00:00 - 23:59)' })
    }

    const nextGrace = grace_minutes !== undefined ? grace_minutes : existing.grace_minutes
    const nextBreak = break_minutes !== undefined ? break_minutes : existing.break_minutes
    if (!isNonNegativeInt(nextGrace) || !isNonNegativeInt(nextBreak)) {
      return res
        .status(400)
        .json({ success: false, message: 'เวลาผ่อนผันและเวลาพักต้องเป็นจำนวนเต็มไม่ติดลบ' })
    }

    const nextActive = is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active

    const dup = db
      .prepare('SELECT id FROM shifts WHERE tenant_id = ? AND name = ? AND id != ?')
      .get(tenantId, nextName, id)
    if (dup) {
      return res.status(409).json({ success: false, message: 'ชื่อกะงานนี้มีอยู่แล้ว' })
    }

    db.prepare(
      `
      UPDATE shifts
      SET name = ?, start_time = ?, end_time = ?, grace_minutes = ?, break_minutes = ?, is_active = ?
      WHERE id = ? AND tenant_id = ?
    `
    ).run(
      nextName,
      nextStart.trim(),
      nextEnd.trim(),
      Number(nextGrace),
      Number(nextBreak),
      nextActive,
      id,
      tenantId
    )

    const updated = db
      .prepare('SELECT * FROM shifts WHERE id = ? AND tenant_id = ?')
      .get(id, tenantId)
    res.json({ success: true, data: updated, shift: updated })
  } catch (error: any) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({ success: false, message: 'ชื่อกะงานนี้มีอยู่แล้ว' })
    }
    console.error('Update shift error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
}

// PUT /api/hr/shifts/:id and PUT /api/hr/shifts
router.put('/shifts/:id', requirePermission('hr', 'write'), handleUpdateShift)
router.put('/shifts', requirePermission('hr', 'write'), handleUpdateShift)

// POST /api/hr/attendance/import
router.post(
  '/attendance/import',
  requirePermission('hr', 'write'),
  (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId
      const userId = (req.user as any)?.id || req.user!.userId || null
      const { filename, content } = req.body || {}

      const result = importAttendance({
        tenantId,
        filename: typeof filename === 'string' && filename.trim() ? filename.trim() : 'upload.txt',
        content,
        source: 'FILE',
        createdBy: userId,
      })

      res.json({
        success: true,
        ...result,
        data: result,
      })
    } catch (error: any) {
      if (error instanceof AttendanceError) {
        return res.status(error.status).json({ success: false, message: error.message })
      }
      console.error('Import attendance error:', error)
      res.status(500).json({ success: false, message: error.message })
    }
  }
)

// GET /api/hr/attendance/imports
router.get(
  '/attendance/imports',
  requirePermission('hr', 'read'),
  (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId
      const rows = db
        .prepare(
          `
          SELECT * FROM attendance_imports
          WHERE tenant_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT 50
        `
        )
        .all(tenantId)
      res.json({ success: true, data: rows, imports: rows })
    } catch (error: any) {
      console.error('List attendance imports error:', error)
      res.status(500).json({ success: false, message: error.message })
    }
  }
)

// GET /api/hr/attendance/unmapped
router.get(
  '/attendance/unmapped',
  requirePermission('hr', 'read'),
  (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId
      const rows = getUnmappedPins(tenantId)
      res.json({ success: true, data: rows, unmappedPins: rows, pins: rows })
    } catch (error: any) {
      console.error('Get unmapped attendance pins error:', error)
      res.status(500).json({ success: false, message: error.message })
    }
  }
)

// GET /api/hr/attendance/summary?from=&to=&employee_id=
router.get(
  '/attendance/summary',
  requirePermission('hr', 'read'),
  (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId
      const from = typeof req.query.from === 'string' ? req.query.from.trim() : ''
      const to = typeof req.query.to === 'string' ? req.query.to.trim() : ''
      const employeeId =
        typeof req.query.employee_id === 'string'
          ? req.query.employee_id.trim()
          : typeof req.query.employeeId === 'string'
            ? req.query.employeeId.trim()
            : undefined

      const summary = getAttendanceSummary(tenantId, from, to, employeeId)
      res.json({
        success: true,
        ...summary,
        summaries: summary.employees,
        data: {
          ...summary,
          summaries: summary.employees,
        },
      })
    } catch (error: any) {
      if (error instanceof AttendanceError) {
        return res.status(error.status).json({ success: false, message: error.message })
      }
      console.error('Get attendance summary error:', error)
      res.status(500).json({ success: false, message: error.message })
    }
  }
)

// GET /api/hr/attendance/logs?from=&to=&pin=
router.get('/attendance/logs', requirePermission('hr', 'read'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const from = typeof req.query.from === 'string' ? req.query.from.trim() : ''
    const to = typeof req.query.to === 'string' ? req.query.to.trim() : ''
    const pin =
      typeof req.query.pin === 'string'
        ? req.query.pin.trim()
        : typeof req.query.device_pin === 'string'
          ? req.query.device_pin.trim()
          : ''

    const rawLimit = Number(req.query.limit ?? 100)
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 500) : 100
    const rawOffset =
      req.query.offset !== undefined
        ? Number(req.query.offset)
        : req.query.page !== undefined
          ? (Math.max(Number(req.query.page), 1) - 1) * limit
          : 0
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.trunc(rawOffset) : 0

    let whereSql = 'WHERE l.tenant_id = ?'
    const params: any[] = [tenantId]

    if (pin) {
      whereSql += ' AND l.device_pin = ?'
      params.push(pin)
    }
    if (from) {
      const fromBound = DATE_ONLY_RE.test(from) ? `${from} 00:00:00` : from
      whereSql += ' AND l.punched_at >= ?'
      params.push(fromBound)
    }
    if (to) {
      const toBound = DATE_ONLY_RE.test(to) ? `${to} 23:59:59` : to
      whereSql += ' AND l.punched_at <= ?'
      params.push(toBound)
    }

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS cnt FROM attendance_logs l ${whereSql}`)
      .get(...params) as { cnt: number }

    const rows = db
      .prepare(
        `
        SELECT
          l.*,
          e.id AS employee_id,
          e.code AS employee_code,
          e.first_name,
          e.last_name
        FROM attendance_logs l
        LEFT JOIN employees e
          ON e.tenant_id = l.tenant_id
         AND e.device_pin = l.device_pin
         AND e.status = 'ACTIVE'
        ${whereSql}
        ORDER BY l.punched_at DESC, l.id DESC
        LIMIT ? OFFSET ?
      `
      )
      .all(...params, limit, offset)

    res.json({
      success: true,
      data: rows,
      logs: rows,
      total: Number(totalRow?.cnt ?? 0),
      limit,
      offset,
    })
  } catch (error: any) {
    console.error('Get attendance logs error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
