import { Router, Request, Response } from 'express'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate, requirePermission } from '../middleware/auth.middleware'
import { isValidIsoDate } from '../services/hr/attendanceStore'
import {
  closeExpiredTrips,
  formatManagerCarTrip,
  fetchStopsByTripIds,
  validateOptionalText,
  isUniqueConstraintError,
  retryTripRoute,
} from '../services/hr/carTrip.service'

const router = Router()
router.use(authenticate)

function formatVehicleRow(r: any) {
  return {
    id: r.id,
    plate_no: r.plate_no,
    label: r.label ?? null,
    is_active: Boolean(r.is_active),
    notes: r.notes ?? null,
    last_end_odometer:
      r.last_end_odometer !== null && r.last_end_odometer !== undefined
        ? Number(r.last_end_odometer)
        : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

function parseThaiDateBounds(
  rawFrom: unknown,
  rawTo: unknown
):
  | { ok: true; fromIso: string | null; toIso: string | null }
  | { ok: false; message: string } {
  let fromIso: string | null = null
  let toIso: string | null = null

  if (typeof rawFrom === 'string' && rawFrom.trim()) {
    const f = rawFrom.trim()
    if (!isValidIsoDate(f)) {
      return { ok: false, message: 'วันที่เริ่มต้นไม่ถูกต้อง' }
    }
    fromIso = new Date(`${f}T00:00:00+07:00`).toISOString()
  }

  if (typeof rawTo === 'string' && rawTo.trim()) {
    const t = rawTo.trim()
    if (!isValidIsoDate(t)) {
      return { ok: false, message: 'วันที่สิ้นสุดไม่ถูกต้อง' }
    }
    toIso = new Date(`${t}T23:59:59.999+07:00`).toISOString()
  }

  return { ok: true, fromIso, toIso }
}

// T8: GET /api/hr/trips (Manager view)
router.get(
  '/trips',
  requirePermission('hr', 'read'),
  (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId

      const bounds = parseThaiDateBounds(req.query.from, req.query.to)
      if (!bounds.ok) {
        return res.status(400).json({ success: false, message: bounds.message })
      }

      const conditions = ['t.tenant_id = ?']
      const params: any[] = [tenantId]

      if (bounds.fromIso) {
        conditions.push('t.started_at >= ?')
        params.push(bounds.fromIso)
      }
      if (bounds.toIso) {
        conditions.push('t.started_at <= ?')
        params.push(bounds.toIso)
      }
      if (
        typeof req.query.employee_id === 'string' &&
        req.query.employee_id.trim()
      ) {
        conditions.push('t.employee_id = ?')
        params.push(req.query.employee_id.trim())
      }
      if (
        typeof req.query.vehicle_id === 'string' &&
        req.query.vehicle_id.trim()
      ) {
        conditions.push('t.vehicle_id = ?')
        params.push(req.query.vehicle_id.trim())
      }
      if (typeof req.query.car_type === 'string' && req.query.car_type.trim()) {
        const ct = req.query.car_type.trim()
        if (ct !== 'COMPANY' && ct !== 'PRIVATE') {
          return res
            .status(400)
            .json({ success: false, message: 'ประเภทรถไม่ถูกต้อง' })
        }
        conditions.push('t.car_type = ?')
        params.push(ct)
      }
      if (typeof req.query.plate === 'string' && req.query.plate.trim()) {
        conditions.push('t.plate_no LIKE ?')
        params.push(`%${req.query.plate.trim()}%`)
      }
      if (typeof req.query.status === 'string' && req.query.status.trim()) {
        const st = req.query.status.trim()
        if (st !== 'OPEN' && st !== 'COMPLETED' && st !== 'INCOMPLETE') {
          return res
            .status(400)
            .json({ success: false, message: 'สถานะทริปไม่ถูกต้อง' })
        }
        conditions.push('t.status = ?')
        params.push(st)
      }
      if (req.query.flagged === '1' || req.query.flagged === 'true') {
        conditions.push("t.flags_json <> '[]'")
      }

      closeExpiredTrips({ tenantId })

      const rows = db
        .prepare(
          `SELECT t.*, e.code AS employee_code, e.first_name, e.last_name
           FROM hr_car_trips t
           JOIN employees e ON e.id = t.employee_id AND e.tenant_id = t.tenant_id
           WHERE ${conditions.join(' AND ')}
           ORDER BY t.started_at DESC
           LIMIT 500`
        )
        .all(...params) as any[]

      const stopsByTrip = fetchStopsByTripIds(
        tenantId,
        rows.map((r) => r.id)
      )
      const data = rows.map((r) =>
        formatManagerCarTrip(r, stopsByTrip.get(r.id) ?? [])
      )

      return res.json({ success: true, data })
    } catch (err: any) {
      console.error('Get manager trips error:', err?.message || err)
      return res
        .status(500)
        .json({ success: false, message: 'ไม่สามารถโหลดข้อมูลการเดินทางได้' })
    }
  }
)

// T9: POST /api/hr/trips/:id/retry-route
router.post(
  '/trips/:id/retry-route',
  requirePermission('hr', 'write'),
  async (req: Request, res: Response) => {
    try {
      const result = await retryTripRoute(req.user!.tenantId, req.params.id)
      if (!result.ok) {
        return res.status(result.status).json({
          success: false,
          ...(result.code ? { code: result.code } : {}),
          message: result.message,
        })
      }
      return res.json({ success: true, data: result.data })
    } catch (err: any) {
      console.error('Retry route error:', err?.message || err)
      return res
        .status(500)
        .json({ success: false, message: 'คำนวณเส้นทางใหม่ไม่สำเร็จ' })
    }
  }
)

// T10: GET /api/hr/vehicles
router.get(
  '/vehicles',
  requirePermission('hr', 'read'),
  (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId
      const activeOnly =
        req.query.active === '1' || req.query.active === 'true'
      const activeFilter = activeOnly ? ' AND v.is_active = 1' : ''

      const rows = db
        .prepare(
          `SELECT v.*,
            (
              SELECT t.end_odometer
              FROM hr_car_trips t
              WHERE t.tenant_id = v.tenant_id
                AND t.vehicle_id = v.id
                AND t.status = 'COMPLETED'
                AND t.end_odometer IS NOT NULL
              ORDER BY t.ended_at DESC, t.created_at DESC
              LIMIT 1
            ) AS last_end_odometer
           FROM hr_vehicles v
           WHERE v.tenant_id = ?${activeFilter}
           ORDER BY v.is_active DESC, v.plate_no ASC`
        )
        .all(tenantId) as any[]

      return res.json({ success: true, data: rows.map(formatVehicleRow) })
    } catch (err: any) {
      console.error('Get vehicles error:', err?.message || err)
      return res
        .status(500)
        .json({ success: false, message: 'ไม่สามารถโหลดรายการรถบริษัทได้' })
    }
  }
)

// T11: POST /api/hr/vehicles
router.post(
  '/vehicles',
  requirePermission('hr', 'write'),
  (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId
      const body = req.body || {}
      const plateNo =
        typeof body.plate_no === 'string' ? body.plate_no.trim() : ''
      if (!plateNo || plateNo.length > 30) {
        return res.status(400).json({
          success: false,
          message: 'กรุณาระบุทะเบียนรถ (1-30 ตัวอักษร)',
        })
      }

      const labelCheck = validateOptionalText(
        body.label,
        100,
        'ชื่อ/รุ่นรถต้องไม่เกิน 100 ตัวอักษร'
      )
      if (!labelCheck.ok) {
        return res
          .status(400)
          .json({ success: false, message: labelCheck.message })
      }

      const notesCheck = validateOptionalText(
        body.notes,
        500,
        'หมายเหตุต้องไม่เกิน 500 ตัวอักษร'
      )
      if (!notesCheck.ok) {
        return res
          .status(400)
          .json({ success: false, message: notesCheck.message })
      }

      const id = generateId()
      const nowIso = new Date().toISOString()

      try {
        db.prepare(
          `INSERT INTO hr_vehicles (
             id, tenant_id, plate_no, label, is_active, notes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
        ).run(
          id,
          tenantId,
          plateNo,
          labelCheck.value,
          notesCheck.value,
          nowIso,
          nowIso
        )
      } catch (err: any) {
        if (isUniqueConstraintError(err)) {
          return res.status(409).json({
            success: false,
            message: 'มีทะเบียนรถนี้ในระบบแล้ว',
          })
        }
        throw err
      }

      const created = db
        .prepare(
          `SELECT v.*, NULL AS last_end_odometer
           FROM hr_vehicles v
           WHERE v.id = ? AND v.tenant_id = ?`
        )
        .get(id, tenantId)

      return res
        .status(201)
        .json({ success: true, data: formatVehicleRow(created) })
    } catch (err: any) {
      console.error('Create vehicle error:', err?.message || err)
      return res
        .status(500)
        .json({ success: false, message: 'เพิ่มรถบริษัทไม่สำเร็จ' })
    }
  }
)

// T12: PUT /api/hr/vehicles/:id
router.put(
  '/vehicles/:id',
  requirePermission('hr', 'write'),
  (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId
      const existing = db
        .prepare(`SELECT * FROM hr_vehicles WHERE id = ? AND tenant_id = ?`)
        .get(req.params.id, tenantId) as any
      if (!existing) {
        return res
          .status(404)
          .json({ success: false, message: 'ไม่พบรถบริษัท' })
      }

      const body = req.body || {}
      let plateNo: string = existing.plate_no
      if (body.plate_no !== undefined) {
        if (typeof body.plate_no !== 'string') {
          return res.status(400).json({
            success: false,
            message: 'กรุณาระบุทะเบียนรถ (1-30 ตัวอักษร)',
          })
        }
        const trimmed = body.plate_no.trim()
        if (!trimmed || trimmed.length > 30) {
          return res.status(400).json({
            success: false,
            message: 'กรุณาระบุทะเบียนรถ (1-30 ตัวอักษร)',
          })
        }
        plateNo = trimmed
      }

      let label: string | null = existing.label ?? null
      if (body.label !== undefined) {
        const labelCheck = validateOptionalText(
          body.label,
          100,
          'ชื่อ/รุ่นรถต้องไม่เกิน 100 ตัวอักษร'
        )
        if (!labelCheck.ok) {
          return res
            .status(400)
            .json({ success: false, message: labelCheck.message })
        }
        label = labelCheck.value
      }

      let notes: string | null = existing.notes ?? null
      if (body.notes !== undefined) {
        const notesCheck = validateOptionalText(
          body.notes,
          500,
          'หมายเหตุต้องไม่เกิน 500 ตัวอักษร'
        )
        if (!notesCheck.ok) {
          return res
            .status(400)
            .json({ success: false, message: notesCheck.message })
        }
        notes = notesCheck.value
      }

      let isActive: number = Number(existing.is_active) ? 1 : 0
      if (body.is_active !== undefined) {
        if (
          typeof body.is_active !== 'boolean' &&
          body.is_active !== 0 &&
          body.is_active !== 1
        ) {
          return res
            .status(400)
            .json({ success: false, message: 'สถานะการใช้งานรถไม่ถูกต้อง' })
        }
        isActive = body.is_active ? 1 : 0
      }

      const nowIso = new Date().toISOString()
      try {
        db.prepare(
          `UPDATE hr_vehicles
           SET plate_no = ?, label = ?, is_active = ?, notes = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ?`
        ).run(plateNo, label, isActive, notes, nowIso, existing.id, tenantId)
      } catch (err: any) {
        if (isUniqueConstraintError(err)) {
          return res.status(409).json({
            success: false,
            message: 'มีทะเบียนรถนี้ในระบบแล้ว',
          })
        }
        throw err
      }

      const updated = db
        .prepare(
          `SELECT v.*,
            (
              SELECT t.end_odometer
              FROM hr_car_trips t
              WHERE t.tenant_id = v.tenant_id
                AND t.vehicle_id = v.id
                AND t.status = 'COMPLETED'
                AND t.end_odometer IS NOT NULL
              ORDER BY t.ended_at DESC, t.created_at DESC
              LIMIT 1
            ) AS last_end_odometer
           FROM hr_vehicles v
           WHERE v.id = ? AND v.tenant_id = ?`
        )
        .get(existing.id, tenantId)

      return res.json({ success: true, data: formatVehicleRow(updated) })
    } catch (err: any) {
      console.error('Update vehicle error:', err?.message || err)
      return res
        .status(500)
        .json({ success: false, message: 'แก้ไขข้อมูลรถบริษัทไม่สำเร็จ' })
    }
  }
)

export default router
