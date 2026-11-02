import { Router, Request, Response } from 'express'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { can } from '../services/rbac.service'

// สัญญากลาง: docs/contracts/hr-phase5-6.md — บันทึกอบรม (งาน B5: T1–T9)
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

/**
 * Month addition with end-of-month clamp.
 * e.g. 2026-01-31 + 1 month -> 2026-02-28 (leap year 2024-01-31 + 1 month -> 2024-02-29).
 */
export function addMonthsClamped(dateStr: string, months: number): string {
  const [yStr, mStr, dStr] = dateStr.split('-')
  const y = Number(yStr)
  const m = Number(mStr)
  const d = Number(dStr)

  const totalMonths = y * 12 + (m - 1) + months
  const targetYear = Math.floor(totalMonths / 12)
  const targetMonth = ((totalMonths % 12) + 12) % 12 + 1
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate()
  const clampedDay = Math.min(d, daysInTargetMonth)

  const pad = (n: number) => String(n).padStart(2, '0')
  return `${targetYear}-${pad(targetMonth)}-${pad(clampedDay)}`
}

function daysLeft(todayStr: string, expiresOnStr: string | null): number | null {
  if (!expiresOnStr) return null
  const [ty, tm, td] = todayStr.split('-').map(Number)
  const [ey, em, ed] = expiresOnStr.split('-').map(Number)
  const todayUtc = Date.UTC(ty, tm - 1, td)
  const expUtc = Date.UTC(ey, em - 1, ed)
  return Math.round((expUtc - todayUtc) / 86400000)
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const targetUtc = Date.UTC(y, m - 1, d) + days * 86400000
  const dt = new Date(targetUtc)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

function formatTrainingCourseRow(r: any) {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    mandatory: Boolean(r.mandatory),
    validity_months: r.validity_months !== null && r.validity_months !== undefined ? Number(r.validity_months) : null,
    is_active: Boolean(r.is_active),
    record_count: Number(r.record_count || 0),
  }
}

function formatTrainingRecordRow(r: any, today: string) {
  return {
    id: r.id,
    course_id: r.course_id,
    course_name: r.course_name,
    course_kind: r.course_kind,
    employee_id: r.employee_id,
    employee_code: r.employee_code,
    employee_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
    trained_on: r.trained_on,
    expires_on: r.expires_on ?? null,
    provider: r.provider ?? null,
    notes: r.notes ?? null,
    days_left: daysLeft(today, r.expires_on),
    attachment_count: Number(r.attachment_count || 0),
    created_at: r.created_at,
  }
}

// ==================== T1–T3: หลักสูตรอบรม (training_courses) ====================

// T1: GET /training/courses (hr:read)
router.get('/training/courses', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const activeOnly = req.query.active === '1'

    const rows = db.prepare(`
      SELECT
        c.id, c.name, c.kind, c.mandatory, c.validity_months, c.is_active,
        (SELECT COUNT(*) FROM training_records r WHERE r.course_id = c.id AND r.tenant_id = c.tenant_id) AS record_count
      FROM training_courses c
      WHERE c.tenant_id = ? ${activeOnly ? 'AND c.is_active = 1' : ''}
      ORDER BY c.name ASC
    `).all(tenantId) as any[]

    res.json({ success: true, data: rows.map(formatTrainingCourseRow) })
  } catch (err: any) {
    console.error('Get training courses error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// T2: POST /training/courses (hr:write)
router.post('/training/courses', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
    if (!name) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อหลักสูตร' })
    }

    const kind = req.body.kind
    if (kind !== 'INTERNAL' && kind !== 'EXTERNAL') {
      return res.status(400).json({ success: false, message: 'ประเภทหลักสูตรไม่ถูกต้อง' })
    }

    const mandatory = req.body.mandatory ? 1 : 0

    let validity_months: number | null = null
    if (req.body.validity_months !== null && req.body.validity_months !== undefined && req.body.validity_months !== '') {
      const vm = Number(req.body.validity_months)
      if (!Number.isInteger(vm) || vm < 1 || vm > 120) {
        return res.status(400).json({ success: false, message: 'ระยะเวลาหมดอายุต้องเป็นจำนวนเต็ม 1-120 เดือน หรือเว้นว่าง' })
      }
      validity_months = vm
    }

    const is_active = req.body.is_active === undefined ? 1 : req.body.is_active ? 1 : 0
    const tenantId = req.user!.tenantId
    const id = generateId()
    const now = new Date().toISOString()

    try {
      db.prepare(`
        INSERT INTO training_courses (id, tenant_id, name, kind, mandatory, validity_months, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tenantId, name, kind, mandatory, validity_months, is_active, now)
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
        return res.status(409).json({ success: false, message: 'มีหลักสูตรชื่อนี้แล้ว' })
      }
      throw err
    }

    res.status(201).json({
      success: true,
      data: {
        id,
        name,
        kind,
        mandatory: Boolean(mandatory),
        validity_months,
        is_active: Boolean(is_active),
        record_count: 0,
      },
    })
  } catch (err: any) {
    console.error('Create training course error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// T3: PUT /training/courses/:id (hr:write)
router.put('/training/courses/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const existing = db.prepare(
      'SELECT * FROM training_courses WHERE id = ? AND tenant_id = ?'
    ).get(req.params.id, tenantId) as any

    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบหลักสูตรอบรม' })
    }

    let newName = existing.name
    if (req.body.name !== undefined) {
      if (typeof req.body.name !== 'string' || !req.body.name.trim()) {
        return res.status(400).json({ success: false, message: 'ชื่อหลักสูตรต้องไม่ว่างเปล่า' })
      }
      newName = req.body.name.trim()
    }

    let newKind = existing.kind
    if (req.body.kind !== undefined) {
      if (req.body.kind !== 'INTERNAL' && req.body.kind !== 'EXTERNAL') {
        return res.status(400).json({ success: false, message: 'ประเภทหลักสูตรไม่ถูกต้อง' })
      }
      newKind = req.body.kind
    }

    const newMandatory = req.body.mandatory !== undefined ? (req.body.mandatory ? 1 : 0) : existing.mandatory

    let newValidity = existing.validity_months
    if (req.body.validity_months !== undefined) {
      if (req.body.validity_months === null || req.body.validity_months === '') {
        newValidity = null
      } else {
        const vm = Number(req.body.validity_months)
        if (!Number.isInteger(vm) || vm < 1 || vm > 120) {
          return res.status(400).json({ success: false, message: 'ระยะเวลาหมดอายุต้องเป็นจำนวนเต็ม 1-120 เดือน หรือเว้นว่าง' })
        }
        newValidity = vm
      }
    }

    const newActive = req.body.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active

    try {
      db.prepare(`
        UPDATE training_courses
        SET name = ?, kind = ?, mandatory = ?, validity_months = ?, is_active = ?
        WHERE id = ? AND tenant_id = ?
      `).run(newName, newKind, newMandatory, newValidity, newActive, existing.id, tenantId)
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
        return res.status(409).json({ success: false, message: 'มีหลักสูตรชื่อนี้แล้ว' })
      }
      throw err
    }

    const recordCount = (
      db.prepare(
        'SELECT COUNT(*) AS count FROM training_records WHERE course_id = ? AND tenant_id = ?'
      ).get(existing.id, tenantId) as any
    )?.count || 0

    res.json({
      success: true,
      data: {
        id: existing.id,
        name: newName,
        kind: newKind,
        mandatory: Boolean(newMandatory),
        validity_months: newValidity !== null ? Number(newValidity) : null,
        is_active: Boolean(newActive),
        record_count: Number(recordCount),
      },
    })
  } catch (err: any) {
    console.error('Update training course error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ==================== T8: รายการใกล้หมดอายุ (training/expiring) ====================
// วางก่อน /training/records/:id เพื่อป้องกัน route collision
router.get('/training/expiring', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const today = thaiDateStr()

    let days = 60
    if (req.query.days !== undefined) {
      const d = Number(req.query.days)
      if (!Number.isInteger(d) || d < 1 || d > 365) {
        return res.status(400).json({ success: false, message: 'จำนวนวันต้องเป็นจำนวนเต็มระหว่าง 1 ถึง 365' })
      }
      days = d
    }

    const cutoffDate = addDays(today, days)

    // ponytail: window function ROW_NUMBER picks the latest session per (employee, course) for active employees.
    const rows = db.prepare(`
      WITH Ranked AS (
        SELECT
          r.id,
          r.tenant_id,
          r.course_id,
          r.employee_id,
          r.trained_on,
          r.expires_on,
          r.provider,
          r.notes,
          r.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY r.employee_id, r.course_id
            ORDER BY r.trained_on DESC, r.created_at DESC, r.id DESC
          ) AS rn
        FROM training_records r
        JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
        WHERE r.tenant_id = ?
          AND e.status = 'ACTIVE'
      )
      SELECT
        r.id, r.course_id, c.name AS course_name, c.kind AS course_kind,
        r.employee_id, e.code AS employee_code, e.first_name, e.last_name,
        r.trained_on, r.expires_on, r.provider, r.notes, r.created_at,
        (SELECT COUNT(*) FROM payment_attachments pa WHERE pa.tenant_id = r.tenant_id AND pa.ref_type = 'TRAINING_RECORD' AND pa.ref_id = r.id) AS attachment_count
      FROM Ranked r
      JOIN training_courses c ON c.id = r.course_id AND c.tenant_id = r.tenant_id
      JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      WHERE r.rn = 1
        AND r.expires_on IS NOT NULL
        AND r.expires_on <= ?
      ORDER BY r.expires_on ASC, r.trained_on DESC
    `).all(tenantId, cutoffDate) as any[]

    res.json({ success: true, data: rows.map(r => formatTrainingRecordRow(r, today)) })
  } catch (err: any) {
    console.error('Get expiring training error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ==================== T4–T7: บันทึกอบรม (training_records) ====================

// T4: GET /training/records (hr:read)
router.get('/training/records', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const today = thaiDateStr()

    const conditions: string[] = ['r.tenant_id = ?']
    const params: any[] = [tenantId]

    if (typeof req.query.employee_id === 'string' && req.query.employee_id.trim()) {
      conditions.push('r.employee_id = ?')
      params.push(req.query.employee_id.trim())
    }

    if (typeof req.query.course_id === 'string' && req.query.course_id.trim()) {
      conditions.push('r.course_id = ?')
      params.push(req.query.course_id.trim())
    }

    const rows = db.prepare(`
      SELECT
        r.id, r.course_id, c.name AS course_name, c.kind AS course_kind,
        r.employee_id, e.code AS employee_code, e.first_name, e.last_name,
        r.trained_on, r.expires_on, r.provider, r.notes, r.created_at,
        (SELECT COUNT(*) FROM payment_attachments pa WHERE pa.tenant_id = r.tenant_id AND pa.ref_type = 'TRAINING_RECORD' AND pa.ref_id = r.id) AS attachment_count
      FROM training_records r
      JOIN training_courses c ON c.id = r.course_id AND c.tenant_id = r.tenant_id
      JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY r.trained_on DESC, r.created_at DESC
    `).all(...params) as any[]

    res.json({ success: true, data: rows.map(r => formatTrainingRecordRow(r, today)) })
  } catch (err: any) {
    console.error('Get training records error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// T5: POST /training/records (hr:write)
router.post('/training/records', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const { course_id, employee_ids, trained_on } = req.body

    if (!course_id || typeof course_id !== 'string') {
      return res.status(400).json({ success: false, message: 'กรุณาระบุหลักสูตร' })
    }

    const course = db.prepare(
      'SELECT * FROM training_courses WHERE id = ? AND tenant_id = ?'
    ).get(course_id, tenantId) as any

    if (!course) {
      return res.status(400).json({ success: false, message: 'ไม่พบหลักสูตรอบรม' })
    }

    if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุพนักงานที่เข้ารับการอบรม' })
    }

    if (employee_ids.some(id => typeof id !== 'string' || !id.trim())) {
      return res.status(400).json({ success: false, message: 'รหัสพนักงานไม่ถูกต้อง' })
    }

    if (new Set(employee_ids).size !== employee_ids.length) {
      return res.status(400).json({ success: false, message: 'รหัสพนักงานซ้ำกันในรายการ' })
    }

    if (!isValidDate(trained_on)) {
      return res.status(400).json({ success: false, message: 'วันที่อบรมไม่ถูกต้อง' })
    }

    let expiresOn: string | null = null
    if (req.body.expires_on === undefined) {
      if (course.validity_months !== null && course.validity_months > 0) {
        expiresOn = addMonthsClamped(trained_on, Number(course.validity_months))
      } else {
        expiresOn = null
      }
    } else if (req.body.expires_on === null || req.body.expires_on === '') {
      expiresOn = null
    } else {
      const expStr = String(req.body.expires_on).trim()
      if (!isValidDate(expStr)) {
        return res.status(400).json({ success: false, message: 'วันหมดอายุไม่ถูกต้อง' })
      }
      if (expStr < trained_on) {
        return res.status(400).json({ success: false, message: 'วันหมดอายุต้องไม่ก่อนวันที่อบรม' })
      }
      expiresOn = expStr
    }

    // ตรวจสอบว่าพนักงานทุกคนสังกัด tenant นี้ (ไม่จำกัดสถานะ)
    const placeholders = employee_ids.map(() => '?').join(',')
    const employees = db.prepare(
      `SELECT id, code, first_name, last_name FROM employees WHERE tenant_id = ? AND id IN (${placeholders})`
    ).all(tenantId, ...employee_ids) as any[]

    if (employees.length !== employee_ids.length) {
      return res.status(400).json({ success: false, message: 'พบพนักงานที่ไม่ถูกต้องหรือไม่สังกัดบริษัท' })
    }

    const empMap = new Map<string, any>(employees.map(e => [e.id, e]))
    const provider = typeof req.body.provider === 'string' && req.body.provider.trim() ? req.body.provider.trim() : null
    const notes = typeof req.body.notes === 'string' && req.body.notes.trim() ? req.body.notes.trim() : null
    const today = thaiDateStr()
    const now = new Date().toISOString()
    const createdRecords: any[] = []

    db.transaction(() => {
      const insertStmt = db.prepare(`
        INSERT INTO training_records (
          id, tenant_id, course_id, employee_id, trained_on, expires_on, provider, notes, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      for (const empId of employee_ids) {
        const id = generateId()
        const emp = empMap.get(empId)!
        insertStmt.run(id, tenantId, course.id, empId, trained_on, expiresOn, provider, notes, req.user!.userId, now)
        createdRecords.push({
          id,
          course_id: course.id,
          course_name: course.name,
          course_kind: course.kind,
          employee_id: emp.id,
          employee_code: emp.code,
          employee_name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
          trained_on,
          expires_on: expiresOn,
          provider,
          notes,
          days_left: daysLeft(today, expiresOn),
          attachment_count: 0,
          created_at: now,
        })
      }
    })()

    res.status(201).json({ success: true, data: createdRecords })
  } catch (err: any) {
    console.error('Create training records error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// T6: PUT /training/records/:id (hr:write)
router.put('/training/records/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const existing = db.prepare(
      'SELECT * FROM training_records WHERE id = ? AND tenant_id = ?'
    ).get(req.params.id, tenantId) as any

    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบบันทึกการอบรม' })
    }

    let newTrainedOn = existing.trained_on
    if (req.body.trained_on !== undefined) {
      if (!isValidDate(req.body.trained_on)) {
        return res.status(400).json({ success: false, message: 'วันที่อบรมไม่ถูกต้อง' })
      }
      newTrainedOn = req.body.trained_on
    }

    let newExpiresOn = existing.expires_on
    if (req.body.expires_on !== undefined) {
      if (req.body.expires_on === null || req.body.expires_on === '') {
        newExpiresOn = null
      } else {
        const expStr = String(req.body.expires_on).trim()
        if (!isValidDate(expStr)) {
          return res.status(400).json({ success: false, message: 'วันหมดอายุไม่ถูกต้อง' })
        }
        newExpiresOn = expStr
      }
    }

    if (newExpiresOn !== null && newExpiresOn < newTrainedOn) {
      return res.status(400).json({ success: false, message: 'วันหมดอายุต้องไม่ก่อนวันที่อบรม' })
    }

    let newProvider = existing.provider
    if (req.body.provider !== undefined) {
      newProvider = req.body.provider !== null && String(req.body.provider).trim() ? String(req.body.provider).trim() : null
    }

    let newNotes = existing.notes
    if (req.body.notes !== undefined) {
      newNotes = req.body.notes !== null && String(req.body.notes).trim() ? String(req.body.notes).trim() : null
    }

    db.prepare(`
      UPDATE training_records
      SET trained_on = ?, expires_on = ?, provider = ?, notes = ?
      WHERE id = ? AND tenant_id = ?
    `).run(newTrainedOn, newExpiresOn, newProvider, newNotes, existing.id, tenantId)

    const today = thaiDateStr()
    const row = db.prepare(`
      SELECT
        r.id, r.course_id, c.name AS course_name, c.kind AS course_kind,
        r.employee_id, e.code AS employee_code, e.first_name, e.last_name,
        r.trained_on, r.expires_on, r.provider, r.notes, r.created_at,
        (SELECT COUNT(*) FROM payment_attachments pa WHERE pa.tenant_id = r.tenant_id AND pa.ref_type = 'TRAINING_RECORD' AND pa.ref_id = r.id) AS attachment_count
      FROM training_records r
      JOIN training_courses c ON c.id = r.course_id AND c.tenant_id = r.tenant_id
      JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      WHERE r.id = ? AND r.tenant_id = ?
    `).get(existing.id, tenantId) as any

    res.json({ success: true, data: formatTrainingRecordRow(row, today) })
  } catch (err: any) {
    console.error('Update training record error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// T7: DELETE /training/records/:id (hr:write)
router.delete('/training/records/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const existing = db.prepare(
      'SELECT id FROM training_records WHERE id = ? AND tenant_id = ?'
    ).get(req.params.id, tenantId) as any

    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบบันทึกการอบรม' })
    }

    const attachmentCount = (
      db.prepare(`
        SELECT COUNT(*) AS count FROM payment_attachments
        WHERE tenant_id = ? AND ref_type = 'TRAINING_RECORD' AND ref_id = ?
      `).get(tenantId, existing.id) as any
    )?.count || 0

    if (attachmentCount > 0) {
      return res.status(409).json({ success: false, message: 'ลบไฟล์ใบรับรองก่อน' })
    }

    db.prepare('DELETE FROM training_records WHERE id = ? AND tenant_id = ?').run(existing.id, tenantId)

    res.json({ success: true, data: { id: existing.id } })
  } catch (err: any) {
    console.error('Delete training record error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ==================== T9: อบรมของฉัน (me/training) ====================

// T9: GET /me/training (self)
router.get('/me/training', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const selfEmp = getSelfEmployee(tenantId, req.user!.userId)

    if (!selfEmp) {
      return res.status(404).json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    const today = thaiDateStr()
    const rows = db.prepare(`
      SELECT
        r.id, r.course_id, c.name AS course_name, c.kind AS course_kind,
        r.employee_id, e.code AS employee_code, e.first_name, e.last_name,
        r.trained_on, r.expires_on, r.provider, r.notes, r.created_at,
        (SELECT COUNT(*) FROM payment_attachments pa WHERE pa.tenant_id = r.tenant_id AND pa.ref_type = 'TRAINING_RECORD' AND pa.ref_id = r.id) AS attachment_count
      FROM training_records r
      JOIN training_courses c ON c.id = r.course_id AND c.tenant_id = r.tenant_id
      JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      WHERE r.tenant_id = ? AND r.employee_id = ?
      ORDER BY r.trained_on DESC, r.created_at DESC
    `).all(tenantId, selfEmp.id) as any[]

    res.json({ success: true, data: rows.map(r => formatTrainingRecordRow(r, today)) })
  } catch (err: any) {
    console.error('Get my training error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

export default router
