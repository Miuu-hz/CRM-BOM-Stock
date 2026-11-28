export const TRIP_CONSENT_VERSION = '1.1'
export const TRIP_CONSENT_NOTICE_TEXT =
  'ระบบจะบันทึกพิกัดตำแหน่ง (GPS) เฉพาะตอนที่คุณกดเริ่มทริป แวะจุด และจบทริปเท่านั้น ไม่มีการติดตามตำแหน่งพื้นหลัง พิกัดและเลขไมล์ใช้เพื่อคำนวณระยะทางและตรวจสอบการใช้งานรถยนต์ของบริษัท โดยพิกัดเส้นทางอาจถูกส่งไปคำนวณระยะทางถนนผ่านบริการแผนที่ OpenStreetMap (OSRM) โดยไม่ส่งชื่อหรือข้อมูลส่วนตัวของคุณ'

export const TRIP_MAX_OPEN_MS = 12 * 60 * 60 * 1000
export const TRIP_MAX_STOPS = 10
export const POOR_GPS_ACCURACY_M = 150
export const ODOMETER_DIFF_RATIO = 0.20
export const DURATION_RATIO = 2.0
export const DURATION_MIN_EXCESS_SEC = 30 * 60

export type TripFlagCode =
  | 'ODOMETER_MISMATCH'
  | 'DURATION_EXCESSIVE'
  | 'ODOMETER_ROLLBACK'
  | 'POOR_GPS'

function toFiniteNumber(val: unknown): number | null {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null
  }
  if (typeof val === 'string') {
    const trimmed = val.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Validate GPS coordinates and optional accuracy_m. Rejects (0, 0), out-of-range, and non-numeric inputs. */
export function validateCoords(input: {
  lat?: unknown
  lng?: unknown
  accuracy_m?: unknown
}):
  | { ok: true; lat: number; lng: number; accuracy_m: number | null }
  | { ok: false; message: string } {
  const lat = toFiniteNumber(input?.lat)
  const lng = toFiniteNumber(input?.lng)
  if (
    lat === null ||
    lng === null ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180 ||
    (lat === 0 && lng === 0)
  ) {
    return {
      ok: false,
      message: 'พิกัด GPS ไม่ถูกต้อง กรุณาเปิดตำแหน่งแล้วลองใหม่',
    }
  }

  let accuracyM: number | null = null
  if (input?.accuracy_m !== undefined && input?.accuracy_m !== null) {
    const acc = toFiniteNumber(input.accuracy_m)
    if (acc === null || acc < 0 || acc > 100000) {
      return { ok: false, message: 'ค่าความแม่นยำ GPS ไม่ถูกต้อง' }
    }
    accuracyM = acc
  }

  return { ok: true, lat, lng, accuracy_m: accuracyM }
}

/** Validate odometer reading (0..9,999,999). */
export function validateOdometer(
  val: unknown
): { ok: true; value: number } | { ok: false; message: string } {
  const num = toFiniteNumber(val)
  if (num === null || num < 0 || num > 9_999_999) {
    return {
      ok: false,
      message: 'เลขไมล์ต้องเป็นตัวเลขตั้งแต่ 0 ถึง 9,999,999',
    }
  }
  return { ok: true, value: num }
}

/** Compute server-side anomaly flags for manager review. */
export function computeTripFlags(input: {
  carType: 'COMPANY' | 'PRIVATE'
  startOdometer: number
  prevVehicleEndOdometer: number | null
  odometerKm: number | null
  mapDistanceKm: number | null
  durationSec: number | null
  mapDurationSec: number | null
  accuracies: (number | null)[]
}): TripFlagCode[] {
  const flags: TripFlagCode[] = []

  if (
    input.odometerKm != null &&
    input.mapDistanceKm != null &&
    (input.mapDistanceKm > 0
      ? Math.abs(input.odometerKm - input.mapDistanceKm) >
        input.mapDistanceKm * ODOMETER_DIFF_RATIO
      : input.odometerKm >= 1)
  ) {
    flags.push('ODOMETER_MISMATCH')
  }

  if (
    input.durationSec != null &&
    input.mapDurationSec != null &&
    input.durationSec > input.mapDurationSec * DURATION_RATIO &&
    input.durationSec - input.mapDurationSec >= DURATION_MIN_EXCESS_SEC
  ) {
    flags.push('DURATION_EXCESSIVE')
  }

  if (
    input.carType === 'COMPANY' &&
    input.prevVehicleEndOdometer != null &&
    input.startOdometer < input.prevVehicleEndOdometer
  ) {
    flags.push('ODOMETER_ROLLBACK')
  }

  if (
    input.accuracies.some(
      (a) => a !== null && Number.isFinite(a) && a > POOR_GPS_ACCURACY_M
    )
  ) {
    flags.push('POOR_GPS')
  }

  return flags
}
