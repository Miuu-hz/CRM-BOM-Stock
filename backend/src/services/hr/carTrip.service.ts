import cron from 'node-cron'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import {
  TRIP_CONSENT_VERSION,
  TRIP_CONSENT_NOTICE_TEXT,
  TRIP_MAX_OPEN_MS,
  TRIP_MAX_STOPS,
  TripFlagCode,
  validateCoords,
  validateOdometer,
  computeTripFlags,
} from './carTripFlags'
import { computeRoadRoute } from './googleRoutes.service'

export type CarType = 'COMPANY' | 'PRIVATE'
export type TripStatus = 'OPEN' | 'COMPLETED' | 'INCOMPLETE'
export type RouteStatus =
  | 'NONE'
  | 'PENDING'
  | 'OK'
  | 'FAILED'
  | 'UNAVAILABLE'
  | 'SKIPPED'

export type TripServiceResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      status: 400 | 403 | 404 | 409 | 503
      code?: string
      message: string
    }

export interface ActiveVehicleOption {
  id: string
  plate_no: string
  label: string | null
}

export interface TripConsentStatus {
  accepted: boolean
  version: string
  accepted_at: string | null
  notice_text: string
}

export interface CarTripStop {
  id: string
  seq: number
  lat: number
  lng: number
  accuracy_m: number | null
  note: string | null
  recorded_at: string
  map_url: string
}

export interface CarTripBase {
  id: string
  employee_id: string
  employee_code: string
  employee_name: string
  vehicle_id: string | null
  car_type: CarType
  plate_no: string
  vehicle_label: string | null
  purpose: string | null
  status: TripStatus
  started_at: string
  start_odometer: number
  start_lat: number
  start_lng: number
  start_accuracy_m: number | null
  ended_at: string | null
  end_odometer: number | null
  end_lat: number | null
  end_lng: number | null
  end_accuracy_m: number | null
  odometer_km: number | null
  duration_sec: number | null
  map_distance_km: number | null
  map_duration_sec: number | null
  route_status: RouteStatus
  close_reason: string | null
  stops: CarTripStop[]
  start_map_url: string
  end_map_url: string | null
  route_map_url: string
}

export interface ManagerCarTrip extends CarTripBase {
  flags: TripFlagCode[]
  prev_vehicle_end_odometer: number | null
  route_error: string | null
  route_fetched_at: string | null
}

/** Look up the ACTIVE employee row linked to the authenticated user within the tenant. */
export function getSelfEmployee(tenantId: string, userId: string) {
  return db
    .prepare(
      `SELECT * FROM employees WHERE tenant_id = ? AND user_id = ? AND status = 'ACTIVE'`
    )
    .get(tenantId, userId) as any
}

/** Close any OPEN trips that have been open for 12+ hours as INCOMPLETE (no push messages). */
export function closeExpiredTrips(opts?: {
  tenantId?: string
  employeeId?: string
  nowMs?: number
}): number {
  const nowMs = opts?.nowMs ?? Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const cutoffIso = new Date(nowMs - TRIP_MAX_OPEN_MS).toISOString()

  const conditions = ["status = 'OPEN'", 'started_at <= ?']
  const params: any[] = [nowIso, nowIso, cutoffIso]

  if (opts?.tenantId) {
    conditions.push('tenant_id = ?')
    params.push(opts.tenantId)
  }
  if (opts?.employeeId) {
    conditions.push('employee_id = ?')
    params.push(opts.employeeId)
  }

  const res = db
    .prepare(
      `UPDATE hr_car_trips
       SET status = 'INCOMPLETE',
           ended_at = NULL,
           end_odometer = NULL,
           odometer_km = NULL,
           duration_sec = NULL,
           map_distance_m = NULL,
           map_distance_km = NULL,
           map_duration_sec = NULL,
           route_status = 'SKIPPED',
           close_reason = 'EXPIRED_12H',
           auto_closed_at = ?,
           updated_at = ?
       WHERE ${conditions.join(' AND ')}`
    )
    .run(...params)

  return res.changes
}

let schedulerStarted = false

/** Start the 15-minute background sweep that closes trips open longer than 12 hours. */
export function startCarTripExpiryScheduler(): void {
  if (schedulerStarted) return
  schedulerStarted = true
  cron.schedule('*/15 * * * *', () => {
    try {
      closeExpiredTrips()
    } catch (e) {
      console.error('[CarTrip] expiry sweep failed', e)
    }
  })
}

export function buildStopMapUrl(stop: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`
}

/** Build Google Maps URLs for trip start, end, and full driving route with waypoints. */
export function buildGoogleMapsLinks(
  trip: {
    start_lat: number
    start_lng: number
    end_lat?: number | null
    end_lng?: number | null
  },
  stops: Array<{ lat: number; lng: number }>
): {
  start_map_url: string
  end_map_url: string | null
  route_map_url: string
} {
  const start_map_url = `https://www.google.com/maps/search/?api=1&query=${trip.start_lat},${trip.start_lng}`
  const hasEnd = trip.end_lat != null && trip.end_lng != null
  const end_map_url = hasEnd
    ? `https://www.google.com/maps/search/?api=1&query=${trip.end_lat},${trip.end_lng}`
    : null

  const route_map_url = hasEnd
    ? `https://www.google.com/maps/dir/?api=1&origin=${trip.start_lat},${trip.start_lng}&destination=${trip.end_lat},${trip.end_lng}` +
      (stops.length > 0
        ? `&waypoints=${stops.map((s) => `${s.lat},${s.lng}`).join('%7C')}`
        : '') +
      `&travelmode=driving`
    : start_map_url

  return { start_map_url, end_map_url, route_map_url }
}

export function formatTripStop(row: any): CarTripStop {
  return {
    id: row.id,
    seq: Number(row.seq),
    lat: Number(row.lat),
    lng: Number(row.lng),
    accuracy_m:
      row.accuracy_m !== null && row.accuracy_m !== undefined
        ? Number(row.accuracy_m)
        : null,
    note: row.note ?? null,
    recorded_at: row.recorded_at,
    map_url: buildStopMapUrl({ lat: Number(row.lat), lng: Number(row.lng) }),
  }
}

export function formatCarTripBase(row: any, rawStops: any[]): CarTripBase {
  const stops = rawStops.map(formatTripStop)
  const links = buildGoogleMapsLinks(
    {
      start_lat: Number(row.start_lat),
      start_lng: Number(row.start_lng),
      end_lat:
        row.end_lat !== null && row.end_lat !== undefined
          ? Number(row.end_lat)
          : null,
      end_lng:
        row.end_lng !== null && row.end_lng !== undefined
          ? Number(row.end_lng)
          : null,
    },
    stops
  )

  return {
    id: row.id,
    employee_id: row.employee_id,
    employee_code: row.employee_code ?? '',
    employee_name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
    vehicle_id: row.vehicle_id ?? null,
    car_type: row.car_type,
    plate_no: row.plate_no,
    vehicle_label: row.vehicle_label ?? null,
    purpose: row.purpose ?? null,
    status: row.status,
    started_at: row.started_at,
    start_odometer: Number(row.start_odometer),
    start_lat: Number(row.start_lat),
    start_lng: Number(row.start_lng),
    start_accuracy_m:
      row.start_accuracy_m !== null && row.start_accuracy_m !== undefined
        ? Number(row.start_accuracy_m)
        : null,
    ended_at: row.ended_at ?? null,
    end_odometer:
      row.end_odometer !== null && row.end_odometer !== undefined
        ? Number(row.end_odometer)
        : null,
    end_lat:
      row.end_lat !== null && row.end_lat !== undefined
        ? Number(row.end_lat)
        : null,
    end_lng:
      row.end_lng !== null && row.end_lng !== undefined
        ? Number(row.end_lng)
        : null,
    end_accuracy_m:
      row.end_accuracy_m !== null && row.end_accuracy_m !== undefined
        ? Number(row.end_accuracy_m)
        : null,
    odometer_km:
      row.odometer_km !== null && row.odometer_km !== undefined
        ? Number(row.odometer_km)
        : null,
    duration_sec:
      row.duration_sec !== null && row.duration_sec !== undefined
        ? Number(row.duration_sec)
        : null,
    map_distance_km:
      row.map_distance_km !== null && row.map_distance_km !== undefined
        ? Number(row.map_distance_km)
        : null,
    map_duration_sec:
      row.map_duration_sec !== null && row.map_duration_sec !== undefined
        ? Number(row.map_duration_sec)
        : null,
    route_status: row.route_status,
    close_reason: row.close_reason ?? null,
    stops,
    ...links,
  }
}

export function formatManagerCarTrip(row: any, rawStops: any[]): ManagerCarTrip {
  let flags: TripFlagCode[] = []
  try {
    const parsed = JSON.parse(row.flags_json || '[]')
    if (Array.isArray(parsed)) flags = parsed
  } catch {
    flags = []
  }

  return {
    ...formatCarTripBase(row, rawStops),
    flags,
    prev_vehicle_end_odometer:
      row.prev_vehicle_end_odometer !== null &&
      row.prev_vehicle_end_odometer !== undefined
        ? Number(row.prev_vehicle_end_odometer)
        : null,
    route_error: row.route_error ?? null,
    route_fetched_at: row.route_fetched_at ?? null,
  }
}

class ConflictRollbackError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export function isUniqueConstraintError(err: any): boolean {
  return (
    err?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    String(err?.message || '').includes('UNIQUE constraint failed')
  )
}

export function validateOptionalText(
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

export function fetchTripRow(
  tenantId: string,
  tripId: string,
  employeeId?: string
) {
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

export function fetchTripStops(tenantId: string, tripId: string) {
  return db
    .prepare(
      `SELECT * FROM hr_car_trip_stops
       WHERE tenant_id = ? AND trip_id = ?
       ORDER BY seq ASC`
    )
    .all(tenantId, tripId) as any[]
}

export function fetchStopsByTripIds(
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

export function getTripConsentStatus(
  tenantId: string,
  employeeId: string
): TripConsentStatus {
  const row = getConsentRow(tenantId, employeeId)
  return {
    accepted: Boolean(row),
    version: TRIP_CONSENT_VERSION,
    accepted_at: row?.accepted_at ?? null,
    notice_text: TRIP_CONSENT_NOTICE_TEXT,
  }
}

export function acceptTripConsent(
  tenantId: string,
  employeeId: string,
  userId: string,
  version: string = TRIP_CONSENT_VERSION
): TripServiceResult<TripConsentStatus> {
  if (version !== TRIP_CONSENT_VERSION) {
    return {
      ok: false,
      status: 400,
      message: 'เวอร์ชันเงื่อนไขความยินยอมไม่ถูกต้อง',
    }
  }

  const nowIso = new Date().toISOString()
  db.prepare(
    `INSERT INTO hr_trip_consents (
       id, tenant_id, employee_id, user_id, consent_version, accepted_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, employee_id, consent_version)
     DO UPDATE SET user_id = excluded.user_id, accepted_at = excluded.accepted_at`
  ).run(generateId(), tenantId, employeeId, userId, TRIP_CONSENT_VERSION, nowIso)

  return { ok: true, data: getTripConsentStatus(tenantId, employeeId) }
}

export function getActiveVehicles(tenantId: string): ActiveVehicleOption[] {
  return db
    .prepare(
      `SELECT id, plate_no, label
       FROM hr_vehicles
       WHERE tenant_id = ? AND is_active = 1
       ORDER BY plate_no ASC`
    )
    .all(tenantId) as ActiveVehicleOption[]
}

export function getOpenCarTrip(
  tenantId: string,
  employeeId: string
): CarTripBase | null {
  closeExpiredTrips({ tenantId, employeeId })
  const openRow = db
    .prepare(
      `SELECT t.*, e.code AS employee_code, e.first_name, e.last_name
       FROM hr_car_trips t
       JOIN employees e ON e.id = t.employee_id AND e.tenant_id = t.tenant_id
       WHERE t.tenant_id = ? AND t.employee_id = ? AND t.status = 'OPEN'
       LIMIT 1`
    )
    .get(tenantId, employeeId) as any
  return openRow
    ? formatCarTripBase(openRow, fetchTripStops(tenantId, openRow.id))
    : null
}

export function startCarTrip(input: {
  tenantId: string
  employeeId: string
  carType: unknown
  vehicleId?: unknown
  plateNo?: unknown
  vehicleLabel?: unknown
  startOdometer: unknown
  purpose?: unknown
  lat: unknown
  lng: unknown
  accuracyM?: unknown
}): TripServiceResult<CarTripBase> {
  const { tenantId, employeeId } = input
  if (!getConsentRow(tenantId, employeeId)) {
    return {
      ok: false,
      status: 403,
      code: 'CONSENT_REQUIRED',
      message: 'กรุณายอมรับเงื่อนไขการเก็บตำแหน่ง (PDPA) ก่อนเริ่มทริป',
    }
  }

  const coords = validateCoords({
    lat: input.lat,
    lng: input.lng,
    accuracy_m: input.accuracyM,
  })
  if (!coords.ok) {
    return { ok: false, status: 400, message: coords.message }
  }

  const startOdo = validateOdometer(input.startOdometer)
  if (!startOdo.ok) {
    return { ok: false, status: 400, message: startOdo.message }
  }

  const carType = input.carType
  if (carType !== 'COMPANY' && carType !== 'PRIVATE') {
    return {
      ok: false,
      status: 400,
      message: 'กรุณาระบุประเภทรถที่ใช้งาน',
    }
  }

  const purposeCheck = validateOptionalText(
    input.purpose,
    500,
    'วัตถุประสงค์ต้องไม่เกิน 500 ตัวอักษร'
  )
  if (!purposeCheck.ok) {
    return { ok: false, status: 400, message: purposeCheck.message }
  }

  let vehicleId: string | null = null
  let plateNo = ''
  let vehicleLabel: string | null = null

  if (carType === 'COMPANY') {
    const rawVid =
      typeof input.vehicleId === 'string' ? input.vehicleId.trim() : ''
    if (!rawVid) {
      return { ok: false, status: 400, message: 'กรุณาเลือกรถบริษัท' }
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
      return { ok: false, status: 404, message: 'ไม่พบรถบริษัทที่เลือก' }
    }
    if (!vehicle.is_active) {
      return { ok: false, status: 400, message: 'รถบริษัทนี้ถูกปิดใช้งานแล้ว' }
    }
    vehicleId = vehicle.id
    plateNo = vehicle.plate_no
    vehicleLabel = vehicle.label ?? null
  } else {
    const rawPlate =
      typeof input.plateNo === 'string' ? input.plateNo.trim() : ''
    if (!rawPlate || rawPlate.length > 30) {
      return {
        ok: false,
        status: 400,
        message: 'กรุณาระบุทะเบียนรถ (1-30 ตัวอักษร)',
      }
    }
    const labelCheck = validateOptionalText(
      input.vehicleLabel,
      100,
      'ชื่อรุ่น/รายละเอียดรถต้องไม่เกิน 100 ตัวอักษร'
    )
    if (!labelCheck.ok) {
      return { ok: false, status: 400, message: labelCheck.message }
    }
    plateNo = rawPlate
    vehicleLabel = labelCheck.value
  }

  // Standalone before transaction so a 409/400 never rolls back expired-trip closure.
  closeExpiredTrips({ tenantId, employeeId })

  return db.transaction((): TripServiceResult<CarTripBase> => {
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
        employeeId,
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
          ok: false,
          status: 409,
          message: 'คุณมีทริปที่เปิดอยู่แล้ว กรุณาจบทริปเดิมก่อน',
        }
      }
      throw err
    }

    const inserted = fetchTripRow(tenantId, tripId, employeeId)
    return { ok: true, data: formatCarTripBase(inserted, []) }
  })()
}

export function addCarTripStop(input: {
  tenantId: string
  employeeId: string
  tripId: string
  lat: unknown
  lng: unknown
  accuracyM?: unknown
  note?: unknown
}): TripServiceResult<CarTripBase> {
  const { tenantId, employeeId, tripId } = input
  if (!getConsentRow(tenantId, employeeId)) {
    return {
      ok: false,
      status: 403,
      code: 'CONSENT_REQUIRED',
      message: 'กรุณายอมรับเงื่อนไขการเก็บตำแหน่ง (PDPA) ก่อนบันทึกจุดแวะ',
    }
  }

  const coords = validateCoords({
    lat: input.lat,
    lng: input.lng,
    accuracy_m: input.accuracyM,
  })
  if (!coords.ok) {
    return { ok: false, status: 400, message: coords.message }
  }

  const noteCheck = validateOptionalText(
    input.note,
    200,
    'หมายเหตุจุดแวะต้องไม่เกิน 200 ตัวอักษร'
  )
  if (!noteCheck.ok) {
    return { ok: false, status: 400, message: noteCheck.message }
  }

  // Standalone before transaction so expired-trip closure persists even on 409.
  closeExpiredTrips({ tenantId, employeeId })

  try {
    return db.transaction((): TripServiceResult<CarTripBase> => {
      const trip = fetchTripRow(tenantId, tripId, employeeId)
      if (!trip) {
        return { ok: false, status: 404, message: 'ไม่พบทริปนี้' }
      }
      if (trip.status === 'INCOMPLETE') {
        return {
          ok: false,
          status: 409,
          message: 'ทริปเปิดเกิน 12 ชั่วโมง ระบบปิดเป็นไม่สมบูรณ์แล้ว',
        }
      }
      if (trip.status !== 'OPEN') {
        return { ok: false, status: 409, message: 'ทริปนี้ถูกปิดไปแล้ว' }
      }

      const existingStops = fetchTripStops(tenantId, trip.id)
      if (existingStops.length >= TRIP_MAX_STOPS) {
        return {
          ok: false,
          status: 409,
          message: 'แวะจุดได้สูงสุด 10 จุดต่อทริป',
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
        .run(JSON.stringify(flags), nowIso, trip.id, tenantId, employeeId)

      if (upd.changes !== 1) {
        throw new ConflictRollbackError('ทริปนี้ถูกปิดไปแล้ว')
      }

      const updatedTrip = fetchTripRow(tenantId, trip.id, employeeId)
      const updatedStops = fetchTripStops(tenantId, trip.id)
      return {
        ok: true,
        data: formatCarTripBase(updatedTrip, updatedStops),
      }
    })()
  } catch (err: any) {
    if (err instanceof ConflictRollbackError) {
      return { ok: false, status: 409, message: err.message }
    }
    throw err
  }
}

type EndTripTx =
  | { ok: false; status: 400 | 404 | 409; message: string }
  | {
      ok: true
      savedTrip: any
      stops: ReturnType<typeof fetchTripStops>
      odometerKm: number
      durationSec: number
      accuracies: (number | null)[]
      startOdo: number
      prevEndOdo: number | null
    }

export async function endCarTrip(input: {
  tenantId: string
  employeeId: string
  tripId: string
  endOdometer: unknown
  lat: unknown
  lng: unknown
  accuracyM?: unknown
}): Promise<TripServiceResult<ManagerCarTrip>> {
  const { tenantId, employeeId, tripId } = input
  if (!getConsentRow(tenantId, employeeId)) {
    return {
      ok: false,
      status: 403,
      code: 'CONSENT_REQUIRED',
      message: 'กรุณายอมรับเงื่อนไขการเก็บตำแหน่ง (PDPA) ก่อนจบทริป',
    }
  }

  const coords = validateCoords({
    lat: input.lat,
    lng: input.lng,
    accuracy_m: input.accuracyM,
  })
  if (!coords.ok) {
    return { ok: false, status: 400, message: coords.message }
  }

  const endOdo = validateOdometer(input.endOdometer)
  if (!endOdo.ok) {
    return { ok: false, status: 400, message: endOdo.message }
  }

  // Standalone before transaction so expired-trip closure persists even on 409.
  closeExpiredTrips({ tenantId, employeeId })

  const hasKey = Boolean((process.env.GOOGLE_ROUTES_API_KEY || '').trim())

  const tx: EndTripTx = db.transaction((): EndTripTx => {
    const trip = fetchTripRow(tenantId, tripId, employeeId)
    if (!trip) {
      return { ok: false, status: 404, message: 'ไม่พบทริปนี้' }
    }
    if (trip.status === 'INCOMPLETE') {
      return {
        ok: false,
        status: 409,
        message: 'ทริปเปิดเกิน 12 ชั่วโมง ระบบปิดเป็นไม่สมบูรณ์แล้ว',
      }
    }
    if (trip.status !== 'OPEN') {
      return { ok: false, status: 409, message: 'ทริปนี้ถูกปิดไปแล้ว' }
    }

    const startOdo = Number(trip.start_odometer)
    if (endOdo.value < startOdo) {
      return {
        ok: false,
        status: 400,
        message: 'เลขไมล์สิ้นสุดต้องมากกว่าหรือเท่ากับเลขไมล์เริ่มต้น',
      }
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
        employeeId
      )

    if (upd.changes !== 1) {
      return { ok: false, status: 409, message: 'ทริปนี้ถูกปิดไปแล้ว' }
    }

    const savedTrip = fetchTripRow(tenantId, trip.id, employeeId)
    return {
      ok: true,
      savedTrip,
      stops,
      odometerKm,
      durationSec,
      accuracies,
      startOdo,
      prevEndOdo,
    }
  })()

  if (!tx.ok) {
    return tx
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

  const finalTrip = fetchTripRow(tenantId, tx.savedTrip.id, employeeId)
  return { ok: true, data: formatManagerCarTrip(finalTrip, tx.stops) }
}

export function getMyRecentTrips(
  tenantId: string,
  employeeId: string,
  limit = 5
): CarTripBase[] {
  closeExpiredTrips({ tenantId, employeeId })
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)))
  const rows = db
    .prepare(
      `SELECT t.*, e.code AS employee_code, e.first_name, e.last_name
       FROM hr_car_trips t
       JOIN employees e ON e.id = t.employee_id AND e.tenant_id = t.tenant_id
       WHERE t.tenant_id = ? AND t.employee_id = ?
       ORDER BY t.started_at DESC, t.created_at DESC
       LIMIT ?`
    )
    .all(tenantId, employeeId, safeLimit) as any[]

  const stopsByTrip = fetchStopsByTripIds(
    tenantId,
    rows.map((r) => r.id)
  )
  return rows.map((r) => formatCarTripBase(r, stopsByTrip.get(r.id) ?? []))
}

export async function retryTripRoute(
  tenantId: string,
  tripId: string
): Promise<TripServiceResult<ManagerCarTrip>> {
  const trip = fetchTripRow(tenantId, tripId)
  if (!trip) {
    return { ok: false, status: 404, message: 'ไม่พบทริปนี้' }
  }
  if (trip.status !== 'COMPLETED') {
    return {
      ok: false,
      status: 409,
      message: 'คำนวณใหม่ได้เฉพาะทริปที่จบแล้ว',
    }
  }
  if (trip.route_status === 'OK') {
    return {
      ok: false,
      status: 409,
      message: 'คำนวณระยะทางแผนที่เรียบร้อยแล้ว',
    }
  }

  const hasKey = Boolean((process.env.GOOGLE_ROUTES_API_KEY || '').trim())
  if (!hasKey) {
    return {
      ok: false,
      status: 503,
      message: 'ยังไม่ได้ตั้งค่า Google Routes API Key',
    }
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
  const mapDistanceKm = routeRes.status === 'OK' ? routeRes.distanceKm : null
  const mapDurationSec = routeRes.status === 'OK' ? routeRes.durationSec : null
  const nextRouteStatus = routeRes.status
  const nextRouteError = routeRes.status === 'OK' ? null : routeRes.errorCode

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
    return {
      ok: false,
      status: 409,
      message: 'คำนวณระยะทางแผนที่เรียบร้อยแล้ว',
    }
  }

  const updated = fetchTripRow(tenantId, trip.id)
  return { ok: true, data: formatManagerCarTrip(updated, stops) }
}
