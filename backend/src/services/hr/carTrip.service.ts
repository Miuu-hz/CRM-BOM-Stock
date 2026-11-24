import cron from 'node-cron'
import db from '../../db/sqlite'
import { TRIP_MAX_OPEN_MS, TripFlagCode } from './carTripFlags'

export type CarType = 'COMPANY' | 'PRIVATE'
export type TripStatus = 'OPEN' | 'COMPLETED' | 'INCOMPLETE'
export type RouteStatus =
  | 'NONE'
  | 'PENDING'
  | 'OK'
  | 'FAILED'
  | 'UNAVAILABLE'
  | 'SKIPPED'

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
