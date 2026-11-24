import { Router, Request, Response } from 'express'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate, requirePermission } from '../middleware/auth.middleware'
import { isValidIsoDate } from '../services/hr/attendanceStore'
import {
  TRIP_CONSENT_VERSION,
  TRIP_CONSENT_NOTICE_TEXT,
  TRIP_MAX_STOPS,
  validateCoords,
  validateOdometer,
  computeTripFlags,
} from '../services/hr/carTripFlags'
import { computeRoadRoute } from '../services/hr/googleRoutes.service'
import {
  getSelfEmployee,
  closeExpiredTrips,
  formatCarTripBase,
  formatManagerCarTrip,
} from '../services/hr/carTrip.service'

const router = Router()
router.use(authenticate)

class ConflictRollbackError extends Error {
  constructor(message: string) {
    super(message)
  }
}

function isUniqueConstraintError(err: any): boolean {
  return (
    err?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    String(err?.message || '').includes('UNIQUE constraint failed')
  )
}

function getUserId(req: Request): string {
  return (req.user as any)?.id || req.user!.userId
}

function getConsentRow(tenantId: string, employeeId: string) {
  return db
    .prepare(
      `SELECT accepted_at
       FROM hr_trip_consents
       WHERE tenant_id = ? AND employee_id = ? AND consent_version = ?`
    )
    .get(tenantId, employeeId, TRIP_CONSENT_VERSION) as
    | { accepted_at: string }
    | undefined
}

function getConsentStatus(tenantId: string, employeeId: string) {
  const row = getConsentRow(tenantId, employeeId)
  return {
    accepted: Boolean(row),
    version: TRIP_CONSENT_VERSION,
    accepted_at: row?.accepted_at ?? null,
    notice_text: TRIP_CONSENT_NOTICE_TEXT,
  }
}

function getActiveVehiclesForMe(tenantId: string) {
  return db
    .prepare(
      `SELECT id, plate_no, label
       FROM hr_vehicles
       WHERE tenant_id = ? AND is_active = 1
       ORDER BY plate_no ASC`
    )
    .all(tenantId) as Array<{ id: string; plate_no: string; label: string | null }>
}

function fetchTripRow(tenantId: string, tripId: string, employeeId?: string) {
  const empFilter = employeeId ? ' AND t.employee_id = ?' : ''
  const params = employeeId ? [tripId, tenantId, employeeId] : [tripId, tenantId]
  return db
    .prepare(
      `SELECT t.*, e.code AS employee_code, e.first_name, e.last_name
       FROM hr_car_trips t
       JOIN employees e ON e.id = t.employee_id AND e.tenant_id = t.tenant_id
       WHERE t.id = ? AND t.tenant_id = ?${empFilter}`
    )
    .get(...params) as any
}

function fetchTripStops(tenantId: string, tripId: string) {
  return db
    .prepare(
      `SELECT * FROM hr_car_trip_stops
       WHERE tenant_id = ? AND trip_id = ?
       ORDER BY seq ASC`
    )
    .all(tenantId, tripId) as any[]
}

function fetchStopsByTripIds(
  tenantId: string,
  tripIds: string[]
): Map<string, any[]> {
  const map = new Map<string, any[]>()
  if (tripIds.length === 0) return map
  const ph = tripIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT * FROM hr_car_trip_stops
       WHERE tenant_id = ? AND trip_id IN (${ph})
       ORDER BY seq ASC`
    )
    .all(tenantId, ...tripIds) as any[]
  for (const r of rows) {
    const arr = map.get(r.trip_id)
    if (arr) arr.push(r)
    else map.set(r.trip_id, [r])
  }
  return map
}

function validateOptionalText(
  val: unknown,
  maxLen: number,
  errMsg: string
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (val === undefined || val === null) return { ok: true, value: null }
  if (typeof val !== 'string') return { ok: false, message: errMsg }
  const trimmed = val.trim()
  if (trimmed.length > maxLen) return { ok: false, message: errMsg }
  return { ok: true, value: trimmed || null }
}

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

// T1: GET /api/hr/me/trips/status
router.get('/me/trips/status', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const emp = getSelfEmployee(tenantId, getUserId(req))
    if (!emp) {
      return res
        .status(404)
        .json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    closeExpiredTrips({ tenantId, employeeId: emp.id })

    const consent = getConsentStatus(tenantId, emp.id)
    const openRow = db
      .prepare(
        `SELECT t.*, e.code AS employee_code, e.first_name, e.last_name
         FROM hr_car_trips t
         JOIN employees e ON e.id = t.employee_id AND e.tenant_id = t.tenant_id
         WHERE t.tenant_id = ? AND t.employee_id = ? AND t.status = 'OPEN'
         LIMIT 1`
      )
      .get(tenantId, emp.id) as any

    const open_trip = openRow
      ? formatCarTripBase(openRow, fetchTripStops(tenantId, openRow.id))
      : null

    return res.json({
      success: true,
      data: {
        consent,
        open_trip,
        vehicles: getActiveVehiclesForMe(tenantId),
        max_stops: TRIP_MAX_STOPS,
      },
    })
  } catch (err: any) {
    console.error('Get my trips status error:', err?.message || err)
    return res
      .status(500)
      .json({ success: false, message: 'ไม่สามารถโหลดสถานะการเดินทางได้' })
  }
})

// T2: GET /api/hr/me/vehicles
router.get('/me/vehicles', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const emp = getSelfEmployee(tenantId, getUserId(req))
    if (!emp) {
      return res
        .status(404)
        .json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }
    return res.json({ success: true, data: getActiveVehiclesForMe(tenantId) })
  } catch (err: any) {
    console.error('Get my vehicles error:', err?.message || err)
    return res
      .status(500)
      .json({ success: false, message: 'ไม่สามารถโหลดรายการรถได้' })
  }
})

// T3: POST /api/hr/me/trips/consent
router.post('/me/trips/consent', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = getUserId(req)
    const emp = getSelfEmployee(tenantId, userId)
    if (!emp) {
      return res
        .status(404)
        .json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    const { consent, version } = req.body || {}
    if (consent !== true) {
      return res.status(400).json({
        success: false,
        message: 'กรุณายอมรับเงื่อนไขการเก็บตำแหน่ง (PDPA)',
      })
    }
    if (version !== undefined && version !== TRIP_CONSENT_VERSION) {
      return res.status(400).json({
        success: false,
        message: 'เวอร์ชันเงื่อนไขความยินยอมไม่ถูกต้อง',
      })
    }

    const nowIso = new Date().toISOString()
    db.prepare(
      `INSERT INTO hr_trip_consents (
         id, tenant_id, employee_id, user_id, consent_version, accepted_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, employee_id, consent_version)
       DO UPDATE SET user_id = excluded.user_id, accepted_at = excluded.accepted_at`
    ).run(generateId(), tenantId, emp.id, userId, TRIP_CONSENT_VERSION, nowIso)

    return res.json({ success: true, data: getConsentStatus(tenantId, emp.id) })
  } catch (err: any) {
    console.error('Save trip consent error:', err?.message || err)
    return res
      .status(500)
      .json({ success: false, message: 'บันทึกความยินยอมไม่สำเร็จ' })
  }
})

// T4: POST /api/hr/me/trips/start
router.post('/me/trips/start', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const emp = getSelfEmployee(tenantId, getUserId(req))
    if (!emp) {
      return res
        .status(404)
        .json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    if (!getConsentRow(tenantId, emp.id)) {
      return res.status(403).json({
        success: false,
        code: 'CONSENT_REQUIRED',
        message: 'กรุณายอมรับเงื่อนไขการเก็บตำแหน่ง (PDPA) ก่อนเริ่มทริป',
      })
    }

    const body = req.body || {}
    const coords = validateCoords(body)
    if (!coords.ok) {
      return res.status(400).json({ success: false, message: coords.message })
    }

    const startOdo = validateOdometer(body.start_odometer)
    if (!startOdo.ok) {
      return res.status(400).json({ success: false, message: startOdo.message })
    }

    const carType = body.car_type
    if (carType !== 'COMPANY' && carType !== 'PRIVATE') {
      return res.status(400).json({
        success: false,
        message: 'กรุณาระบุประเภทรถที่ใช้งาน',
      })
    }

    const purposeCheck = validateOptionalText(
      body.purpose,
      500,
      'วัตถุประสงค์ต้องไม่เกิน 500 ตัวอักษร'
    )
    if (!purposeCheck.ok) {
      return res
        .status(400)
        .json({ success: false, message: purposeCheck.message })
    }

    let vehicleId: string | null = null
    let plateNo = ''
    let vehicleLabel: string | null = null

    if (carType === 'COMPANY') {
      const rawVid =
        typeof body.vehicle_id === 'string' ? body.vehicle_id.trim() : ''
      if (!rawVid) {
        return res
          .status(400)
          .json({ success: false, message: 'กรุณาเลือกรถบริษัท' })
      }
      const vehicle = db
        .prepare(
          `SELECT id, plate_no, label, is_active
           FROM hr_vehicles
           WHERE id = ? AND tenant_id = ?`
        )
        .get(rawVid, tenantId) as
        | { id: string; plate_no: string; label: string | null; is_active: number }
        | undefined
      if (!vehicle) {
        return res
          .status(404)
          .json({ success: false, message: 'ไม่พบรถบริษัทที่เลือก' })
      }
      if (!vehicle.is_active) {
        return res
          .status(400)
          .json({ success: false, message: 'รถบริษัทนี้ถูกปิดใช้งานแล้ว' })
      }
      vehicleId = vehicle.id
      plateNo = vehicle.plate_no
      vehicleLabel = vehicle.label ?? null
    } else {
      const rawPlate =
        typeof body.plate_no === 'string' ? body.plate_no.trim() : ''
      if (!rawPlate || rawPlate.length > 30) {
        return res.status(400).json({
          success: false,
          message: 'กรุณาระบุทะเบียนรถ (1-30 ตัวอักษร)',
        })
      }
      const labelCheck = validateOptionalText(
        body.vehicle_label,
        100,
        'ชื่อรุ่น/รายละเอียดรถต้องไม่เกิน 100 ตัวอักษร'
      )
      if (!labelCheck.ok) {
        return res
          .status(400)
          .json({ success: false, message: labelCheck.message })
      }
      plateNo = rawPlate
      vehicleLabel = labelCheck.value
    }

    // Standalone before transaction so a 409/400 never rolls back expired-trip closure.
    closeExpiredTrips({ tenantId, employeeId: emp.id })

    const txResult = db.transaction((): { status: number; body: any } => {
      let prevEndOdo: number | null = null
      if (carType === 'COMPANY' && vehicleId) {
        const prevRow = db
          .prepare(
            `SELECT end_odometer
             FROM hr_car_trips
             WHERE tenant_id = ? AND vehicle_id = ? AND status = 'COMPLETED'
               AND end_odometer IS NOT NULL
             ORDER BY ended_at DESC, created_at DESC
             LIMIT 1`
          )
          .get(tenantId, vehicleId) as { end_odometer: number } | undefined
        prevEndOdo =
          prevRow?.end_odometer !== undefined && prevRow?.end_odometer !== null
            ? Number(prevRow.end_odometer)
            : null
      }

      const flags = computeTripFlags({
        carType,
        startOdometer: startOdo.value,
        prevVehicleEndOdometer: prevEndOdo,
        odometerKm: null,
        mapDistanceKm: null,
        durationSec: null,
        mapDurationSec: null,
        accuracies: [coords.accuracy_m],
      })

      const tripId = generateId()
      const nowIso = new Date().toISOString()

      try {
        db.prepare(
          `INSERT INTO hr_car_trips (
             id, tenant_id, employee_id, vehicle_id, car_type, plate_no, vehicle_label,
             purpose, status, started_at, start_odometer, start_lat, start_lng,
             start_accuracy_m, prev_vehicle_end_odometer, route_status, flags_json,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, 'NONE', ?, ?, ?)`
        ).run(
          tripId,
          tenantId,
          emp.id,
          vehicleId,
          carType,
          plateNo,
          vehicleLabel,
          purposeCheck.value,
          nowIso,
          startOdo.value,
          coords.lat,
          coords.lng,
          coords.accuracy_m,
          prevEndOdo,
          JSON.stringify(flags),
          nowIso,
          nowIso
        )
      } catch (err: any) {
        if (isUniqueConstraintError(err)) {
          return {
            status: 409,
            body: {
              success: false,
              message: 'คุณมีทริปที่เปิดอยู่แล้ว กรุณาจบทริปเดิมก่อน',
            },
          }
        }
        throw err
      }

      const inserted = fetchTripRow(tenantId, tripId, emp.id)
      return {
        status: 201,
        body: { success: true, data: formatCarTripBase(inserted, []) },
      }
    })()

    return res.status(txResult.status).json(txResult.body)
  } catch (err: any) {
    console.error('Start car trip error:', err?.message || err)
    return res
      .status(500)
      .json({ success: false, message: 'เริ่มทริปไม่สำเร็จ' })
  }
})

// T5: POST /api/hr/me/trips/:id/stops
router.post('/me/trips/:id/stops', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const emp = getSelfEmployee(tenantId, getUserId(req))
    if (!emp) {
      return res
        .status(404)
        .json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    if (!getConsentRow(tenantId, emp.id)) {
      return res.status(403).json({
        success: false,
        code: 'CONSENT_REQUIRED',
        message: 'กรุณายอมรับเงื่อนไขการเก็บตำแหน่ง (PDPA) ก่อนบันทึกจุดแวะ',
      })
    }

    const body = req.body || {}
    const coords = validateCoords(body)
    if (!coords.ok) {
      return res.status(400).json({ success: false, message: coords.message })
    }

    const noteCheck = validateOptionalText(
      body.note,
      200,
      'หมายเหตุจุดแวะต้องไม่เกิน 200 ตัวอักษร'
    )
    if (!noteCheck.ok) {
      return res.status(400).json({ success: false, message: noteCheck.message })
    }

    // Standalone before transaction so expired-trip closure persists even on 409.
    closeExpiredTrips({ tenantId, employeeId: emp.id })

    let result: { status: number; body: any }
    try {
      result = db.transaction((): { status: number; body: any } => {
        const trip = fetchTripRow(tenantId, req.params.id, emp.id)
        if (!trip) {
          return {
            status: 404,
            body: { success: false, message: 'ไม่พบทริปนี้' },
          }
        }
        if (trip.status === 'INCOMPLETE') {
          return {
            status: 409,
            body: {
              success: false,
              message: 'ทริปเปิดเกิน 12 ชั่วโมง ระบบปิดเป็นไม่สมบูรณ์แล้ว',
            },
          }
        }
        if (trip.status !== 'OPEN') {
          return {
            status: 409,
            body: { success: false, message: 'ทริปนี้ถูกปิดไปแล้ว' },
          }
        }

        const existingStops = fetchTripStops(tenantId, trip.id)
        if (existingStops.length >= TRIP_MAX_STOPS) {
          return {
            status: 409,
            body: {
              success: false,
              message: 'แวะจุดได้สูงสุด 10 จุดต่อทริป',
            },
          }
        }

        const seq = existingStops.length + 1
        const nowIso = new Date().toISOString()
        const stopId = generateId()

        db.prepare(
          `INSERT INTO hr_car_trip_stops (
             id, tenant_id, trip_id, seq, lat, lng, accuracy_m, note, recorded_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          stopId,
          tenantId,
          trip.id,
          seq,
          coords.lat,
          coords.lng,
          coords.accuracy_m,
          noteCheck.value,
          nowIso
        )

        const accuracies: (number | null)[] = [
          trip.start_accuracy_m !== null && trip.start_accuracy_m !== undefined
            ? Number(trip.start_accuracy_m)
            : null,
          ...existingStops.map((s) =>
            s.accuracy_m !== null && s.accuracy_m !== undefined
              ? Number(s.accuracy_m)
              : null
          ),
          coords.accuracy_m,
        ]
        const flags = computeTripFlags({
          carType: trip.car_type,
          startOdometer: Number(trip.start_odometer),
          prevVehicleEndOdometer:
            trip.prev_vehicle_end_odometer !== null &&
            trip.prev_vehicle_end_odometer !== undefined
              ? Number(trip.prev_vehicle_end_odometer)
              : null,
          odometerKm: null,
          mapDistanceKm: null,
          durationSec: null,
          mapDurationSec: null,
          accuracies,
        })

        const upd = db
          .prepare(
            `UPDATE hr_car_trips
             SET flags_json = ?, updated_at = ?
             WHERE id = ? AND tenant_id = ? AND employee_id = ? AND status = 'OPEN'`
          )
          .run(JSON.stringify(flags), nowIso, trip.id, tenantId, emp.id)

        if (upd.changes !== 1) {
          throw new ConflictRollbackError('ทริปนี้ถูกปิดไปแล้ว')
        }

        const updatedTrip = fetchTripRow(tenantId, trip.id, emp.id)
        const updatedStops = fetchTripStops(tenantId, trip.id)
        return {
          status: 201,
          body: {
            success: true,
            data: formatCarTripBase(updatedTrip, updatedStops),
          },
        }
      })()
    } catch (err: any) {
      if (err instanceof ConflictRollbackError) {
        return res.status(409).json({ success: false, message: err.message })
      }
      throw err
    }

    return res.status(result.status).json(result.body)
  } catch (err: any) {
    console.error('Add car trip stop error:', err?.message || err)
    return res
      .status(500)
      .json({ success: false, message: 'บันทึกจุดแวะไม่สำเร็จ' })
  }
})

type EndTripTx =
  | { status: 400 | 404 | 409; body: { success: false; message: string } }
  | {
      status: 200
      savedTrip: any
      stops: ReturnType<typeof fetchTripStops>
      odometerKm: number
      durationSec: number
      accuracies: (number | null)[]
      startOdo: number
      prevEndOdo: number | null
    }

// T6: POST /api/hr/me/trips/:id/end
router.post('/me/trips/:id/end', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const emp = getSelfEmployee(tenantId, getUserId(req))
    if (!emp) {
      return res
        .status(404)
        .json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    if (!getConsentRow(tenantId, emp.id)) {
      return res.status(403).json({
        success: false,
        code: 'CONSENT_REQUIRED',
        message: 'กรุณายอมรับเงื่อนไขการเก็บตำแหน่ง (PDPA) ก่อนจบทริป',
      })
    }

    const body = req.body || {}
    const coords = validateCoords(body)
    if (!coords.ok) {
      return res.status(400).json({ success: false, message: coords.message })
    }

    const endOdo = validateOdometer(body.end_odometer)
    if (!endOdo.ok) {
      return res.status(400).json({ success: false, message: endOdo.message })
    }

    // Standalone before transaction so expired-trip closure persists even on 409.
    closeExpiredTrips({ tenantId, employeeId: emp.id })

    const hasKey = Boolean((process.env.GOOGLE_ROUTES_API_KEY || '').trim())

    const tx: EndTripTx = db.transaction((): EndTripTx => {
      const trip = fetchTripRow(tenantId, req.params.id, emp.id)
      if (!trip) {
        return {
          status: 404,
          body: { success: false, message: 'ไม่พบทริปนี้' },
        } as const
      }
      if (trip.status === 'INCOMPLETE') {
        return {
          status: 409,
          body: {
            success: false,
            message: 'ทริปเปิดเกิน 12 ชั่วโมง ระบบปิดเป็นไม่สมบูรณ์แล้ว',
          },
        } as const
      }
      if (trip.status !== 'OPEN') {
        return {
          status: 409,
          body: { success: false, message: 'ทริปนี้ถูกปิดไปแล้ว' },
        } as const
      }

      const startOdo = Number(trip.start_odometer)
      if (endOdo.value < startOdo) {
        return {
          status: 400,
          body: {
            success: false,
            message: 'เลขไมล์สิ้นสุดต้องมากกว่าหรือเท่ากับเลขไมล์เริ่มต้น',
          },
        } as const
      }

      const stops = fetchTripStops(tenantId, trip.id)
      const nowIso = new Date().toISOString()
      const odometerKm = Math.round((endOdo.value - startOdo) * 1000) / 1000
      const startMs = Date.parse(trip.started_at)
      const endMs = Date.parse(nowIso)
      const durationSec = Number.isFinite(startMs)
        ? Math.max(0, Math.round((endMs - startMs) / 1000))
        : 0

      const routeStatus = hasKey ? 'PENDING' : 'UNAVAILABLE'
      const routeError = hasKey ? null : 'NO_API_KEY'
      const accuracies: (number | null)[] = [
        trip.start_accuracy_m !== null && trip.start_accuracy_m !== undefined
          ? Number(trip.start_accuracy_m)
          : null,
        ...stops.map((s) =>
          s.accuracy_m !== null && s.accuracy_m !== undefined
            ? Number(s.accuracy_m)
            : null
        ),
        coords.accuracy_m,
      ]
      const prevEndOdo =
        trip.prev_vehicle_end_odometer !== null &&
        trip.prev_vehicle_end_odometer !== undefined
          ? Number(trip.prev_vehicle_end_odometer)
          : null

      const flags = computeTripFlags({
        carType: trip.car_type,
        startOdometer: startOdo,
        prevVehicleEndOdometer: prevEndOdo,
        odometerKm,
        mapDistanceKm: null,
        durationSec,
        mapDurationSec: null,
        accuracies,
      })

      const upd = db
        .prepare(
          `UPDATE hr_car_trips
           SET status = 'COMPLETED',
               ended_at = ?,
               end_odometer = ?,
               end_lat = ?,
               end_lng = ?,
               end_accuracy_m = ?,
               odometer_km = ?,
               duration_sec = ?,
               route_status = ?,
               route_error = ?,
               flags_json = ?,
               updated_at = ?
           WHERE id = ? AND tenant_id = ? AND employee_id = ? AND status = 'OPEN'`
        )
        .run(
          nowIso,
          endOdo.value,
          coords.lat,
          coords.lng,
          coords.accuracy_m,
          odometerKm,
          durationSec,
          routeStatus,
          routeError,
          JSON.stringify(flags),
          nowIso,
          trip.id,
          tenantId,
          emp.id
        )

      if (upd.changes !== 1) {
        return {
          status: 409,
          body: { success: false, message: 'ทริปนี้ถูกปิดไปแล้ว' },
        } as const
      }

      const savedTrip = fetchTripRow(tenantId, trip.id, emp.id)
      return {
        status: 200,
        savedTrip,
        stops,
        odometerKm,
        durationSec,
        accuracies,
        startOdo,
        prevEndOdo,
      } as const
    })()

    if (tx.status !== 200) {
      return res.status(tx.status).json(tx.body)
    }

    if (hasKey) {
      const routeRes = await computeRoadRoute(
        { lat: Number(tx.savedTrip.start_lat), lng: Number(tx.savedTrip.start_lng) },
        { lat: coords.lat, lng: coords.lng },
        tx.stops.map((s) => ({ lat: Number(s.lat), lng: Number(s.lng) }))
      )

      const fetchedAt = new Date().toISOString()
      const mapDistanceM =
        routeRes.status === 'OK' ? routeRes.distanceMeters : null
      const mapDistanceKm =
        routeRes.status === 'OK' ? routeRes.distanceKm : null
      const mapDurationSec =
        routeRes.status === 'OK' ? routeRes.durationSec : null
      const nextRouteStatus = routeRes.status
      const nextRouteError =
        routeRes.status === 'OK' ? null : routeRes.errorCode

      const recomputedFlags = computeTripFlags({
        carType: tx.savedTrip.car_type,
        startOdometer: tx.startOdo,
        prevVehicleEndOdometer: tx.prevEndOdo,
        odometerKm: tx.odometerKm,
        mapDistanceKm,
        durationSec: tx.durationSec,
        mapDurationSec,
        accuracies: tx.accuracies,
      })

      db.prepare(
        `UPDATE hr_car_trips
         SET map_distance_m = ?,
             map_distance_km = ?,
             map_duration_sec = ?,
             route_status = ?,
             route_error = ?,
             route_fetched_at = ?,
             flags_json = ?,
             updated_at = ?
         WHERE id = ? AND tenant_id = ? AND status = 'COMPLETED'`
      ).run(
        mapDistanceM,
        mapDistanceKm,
        mapDurationSec,
        nextRouteStatus,
        nextRouteError,
        fetchedAt,
        JSON.stringify(recomputedFlags),
        fetchedAt,
        tx.savedTrip.id,
        tenantId
      )
    }

    const finalTrip = fetchTripRow(tenantId, tx.savedTrip.id, emp.id)
    return res.json({
      success: true,
      data: formatCarTripBase(finalTrip, tx.stops),
    })
  } catch (err: any) {
    console.error('End car trip error:', err?.message || err)
    return res
      .status(500)
      .json({ success: false, message: 'บันทึกจบทริปไม่สำเร็จ' })
  }
})

// T7: GET /api/hr/me/trips
router.get('/me/trips', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const emp = getSelfEmployee(tenantId, getUserId(req))
    if (!emp) {
      return res
        .status(404)
        .json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    const bounds = parseThaiDateBounds(req.query.from, req.query.to)
    if (!bounds.ok) {
      return res.status(400).json({ success: false, message: bounds.message })
    }

    closeExpiredTrips({ tenantId, employeeId: emp.id })

    const conditions = ['t.tenant_id = ?', 't.employee_id = ?']
    const params: any[] = [tenantId, emp.id]
    if (bounds.fromIso) {
      conditions.push('t.started_at >= ?')
      params.push(bounds.fromIso)
    }
    if (bounds.toIso) {
      conditions.push('t.started_at <= ?')
      params.push(bounds.toIso)
    }

    const rows = db
      .prepare(
        `SELECT t.*, e.code AS employee_code, e.first_name, e.last_name
         FROM hr_car_trips t
         JOIN employees e ON e.id = t.employee_id AND e.tenant_id = t.tenant_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY t.started_at DESC
         LIMIT 200`
      )
      .all(...params) as any[]

    const stopsByTrip = fetchStopsByTripIds(
      tenantId,
      rows.map((r) => r.id)
    )
    const data = rows.map((r) =>
      formatCarTripBase(r, stopsByTrip.get(r.id) ?? [])
    )

    return res.json({ success: true, data })
  } catch (err: any) {
    console.error('Get my trips error:', err?.message || err)
    return res
      .status(500)
      .json({ success: false, message: 'ไม่สามารถโหลดประวัติการเดินทางได้' })
  }
})

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
      const tenantId = req.user!.tenantId
      const trip = fetchTripRow(tenantId, req.params.id)
      if (!trip) {
        return res
          .status(404)
          .json({ success: false, message: 'ไม่พบทริปนี้' })
      }
      if (trip.status !== 'COMPLETED') {
        return res.status(409).json({
          success: false,
          message: 'คำนวณใหม่ได้เฉพาะทริปที่จบแล้ว',
        })
      }
      if (trip.route_status === 'OK') {
        return res.status(409).json({
          success: false,
          message: 'คำนวณระยะทางแผนที่เรียบร้อยแล้ว',
        })
      }

      const hasKey = Boolean((process.env.GOOGLE_ROUTES_API_KEY || '').trim())
      if (!hasKey) {
        return res.status(503).json({
          success: false,
          message: 'ยังไม่ได้ตั้งค่า Google Routes API Key',
        })
      }

      const stops = fetchTripStops(tenantId, trip.id)
      const routeRes = await computeRoadRoute(
        { lat: Number(trip.start_lat), lng: Number(trip.start_lng) },
        { lat: Number(trip.end_lat), lng: Number(trip.end_lng) },
        stops.map((s) => ({ lat: Number(s.lat), lng: Number(s.lng) }))
      )

      const fetchedAt = new Date().toISOString()
      const mapDistanceM =
        routeRes.status === 'OK' ? routeRes.distanceMeters : null
      const mapDistanceKm =
        routeRes.status === 'OK' ? routeRes.distanceKm : null
      const mapDurationSec =
        routeRes.status === 'OK' ? routeRes.durationSec : null
      const nextRouteStatus = routeRes.status
      const nextRouteError =
        routeRes.status === 'OK' ? null : routeRes.errorCode

      const accuracies: (number | null)[] = [
        trip.start_accuracy_m !== null && trip.start_accuracy_m !== undefined
          ? Number(trip.start_accuracy_m)
          : null,
        ...stops.map((s) =>
          s.accuracy_m !== null && s.accuracy_m !== undefined
            ? Number(s.accuracy_m)
            : null
        ),
        trip.end_accuracy_m !== null && trip.end_accuracy_m !== undefined
          ? Number(trip.end_accuracy_m)
          : null,
      ]

      const flags = computeTripFlags({
        carType: trip.car_type,
        startOdometer: Number(trip.start_odometer),
        prevVehicleEndOdometer:
          trip.prev_vehicle_end_odometer !== null &&
          trip.prev_vehicle_end_odometer !== undefined
            ? Number(trip.prev_vehicle_end_odometer)
            : null,
        odometerKm:
          trip.odometer_km !== null && trip.odometer_km !== undefined
            ? Number(trip.odometer_km)
            : null,
        mapDistanceKm,
        durationSec:
          trip.duration_sec !== null && trip.duration_sec !== undefined
            ? Number(trip.duration_sec)
            : null,
        mapDurationSec,
        accuracies,
      })

      const upd = db
        .prepare(
          `UPDATE hr_car_trips
           SET map_distance_m = ?,
               map_distance_km = ?,
               map_duration_sec = ?,
               route_status = ?,
               route_error = ?,
               route_fetched_at = ?,
               flags_json = ?,
               updated_at = ?
           WHERE id = ? AND tenant_id = ? AND status = 'COMPLETED' AND route_status <> 'OK'`
        )
        .run(
          mapDistanceM,
          mapDistanceKm,
          mapDurationSec,
          nextRouteStatus,
          nextRouteError,
          fetchedAt,
          JSON.stringify(flags),
          fetchedAt,
          trip.id,
          tenantId
        )

      if (upd.changes !== 1) {
        return res.status(409).json({
          success: false,
          message: 'คำนวณระยะทางแผนที่เรียบร้อยแล้ว',
        })
      }

      const updated = fetchTripRow(tenantId, trip.id)
      return res.json({
        success: true,
        data: formatManagerCarTrip(updated, stops),
      })
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
