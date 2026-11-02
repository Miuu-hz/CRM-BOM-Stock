import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { authenticate, requirePermission } from '../middleware/auth.middleware'
import { userCan } from '../services/rbac.service'
import { AttendanceError, getAttendanceSummary, isValidIsoDate } from '../services/hr/attendanceStore'

// สัญญากลาง: docs/contracts/hr-phase4.md — เช็คอินเว็บ + หน้าของฉัน (งาน B4)
// ponytail: ยังไม่ทำเช็คอินด้วยใบหน้าในเฟสนี้ (ต้องเก็บ PDPA consent ข้อมูลชีวมิติและมี PIN fallback เสมอ) — ใช้ GPS + Kiosk PIN ก่อน
const router = Router()
router.use(authenticate)

const DEBOUNCE_MS = 120 * 1000
const PIN_WINDOW_MS = 5 * 60 * 1000
const PIN_LOCKOUT_MS = 5 * 60 * 1000
const PIN_MAX_FAILURES = 5

// ponytail: เก็บตัวนับกด PIN ผิดใน Map ในหน่วยความจำ ใช้ได้เฉพาะโพรเซสเดียว (single process)
// ถ้ารันหลายโพรเซสหลัง load balancer ค่อยย้ายไปเก็บใน Redis หรือตาราง sqlite
interface PinFailureRecord {
  count: number
  firstFailedAt: number
  lockedUntil: number
}
const pinFailures = new Map<string, PinFailureRecord>()

export function resetCheckinPinLockout(): void {
  pinFailures.clear()
}

function isPinLocked(key: string, now = Date.now()): boolean {
  const rec = pinFailures.get(key)
  if (!rec) return false
  if (rec.lockedUntil > now) return true
  if (rec.lockedUntil > 0 || now - rec.firstFailedAt > PIN_WINDOW_MS) {
    pinFailures.delete(key)
  }
  return false
}

function recordPinFailure(key: string, now = Date.now()): boolean {
  let rec = pinFailures.get(key)
  if (!rec || rec.lockedUntil > 0 || now - rec.firstFailedAt > PIN_WINDOW_MS) {
    rec = { count: 0, firstFailedAt: now, lockedUntil: 0 }
  }
  rec.count += 1
  if (rec.count >= PIN_MAX_FAILURES) {
    rec.lockedUntil = now + PIN_LOCKOUT_MS
    pinFailures.set(key, rec)
    return true
  }
  pinFailures.set(key, rec)
  return false
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
export const haversine = haversineMeters

function thaiNowDateTime(nowMs = Date.now()): string {
  const datePart = thaiDateStr(new Date(nowMs))
  const timePart = new Date(nowMs + 7 * 3600_000).toISOString().slice(11, 19)
  return `${datePart} ${timePart}`
}

function isUniqueConstraintError(err: any): boolean {
  return (
    err?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    String(err?.message || '').includes('UNIQUE constraint failed')
  )
}

function getSelfEmployee(tenantId: string, userId: string) {
  return db
    .prepare(
      `SELECT e.*, s.name AS shift_name
       FROM employees e
       LEFT JOIN shifts s ON e.shift_id = s.id AND s.tenant_id = e.tenant_id
       WHERE e.tenant_id = ? AND e.user_id = ? AND e.status = 'ACTIVE'`
    )
    .get(tenantId, userId) as any
}

// ponytail: พนักงานที่ยังไม่มี device_pin จะได้ W + ตัวเลข 4 หลักอัตโนมัติตอนเช็คอินเว็บครั้งแรก
// เพดาน 9,999 คนต่อบริษัท ถ้าเกินค่อยขยายเป็น 6 หลัก
function ensureDevicePin(tenantId: string, employeeId: string, existingPin: string | null): string {
  if (existingPin && String(existingPin).trim()) {
    return String(existingPin).trim()
  }
  const rows = db
    .prepare(`SELECT device_pin FROM employees WHERE tenant_id = ? AND device_pin LIKE 'W%'`)
    .all(tenantId) as { device_pin: string }[]
  const used = new Set<string>()
  let maxNum = 0
  for (const r of rows) {
    if (!r.device_pin) continue
    used.add(r.device_pin)
    const m = /^W(\d{4})$/.exec(r.device_pin)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > maxNum) maxNum = n
    }
  }

  const now = new Date().toISOString()
  for (let attempt = 0; attempt < 50; attempt++) {
    const nextNum = ((maxNum + attempt) % 9999) + 1
    const candidate = `W${String(nextNum).padStart(4, '0')}`
    if (used.has(candidate)) continue
    try {
      db.prepare(
        'UPDATE employees SET device_pin = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND device_pin IS NULL'
      ).run(candidate, now, employeeId, tenantId)
      const updated = db
        .prepare('SELECT device_pin FROM employees WHERE id = ? AND tenant_id = ?')
        .get(employeeId, tenantId) as { device_pin: string | null } | undefined
      if (updated?.device_pin) return updated.device_pin
    } catch (err: any) {
      if (!isUniqueConstraintError(err)) throw err
      used.add(candidate)
    }
  }
  throw new Error('ไม่สามารถออกรหัส device_pin อัตโนมัติได้')
}

function executeCheckin(
  tenantId: string,
  emp: any,
  geo: { lat?: unknown; lng?: unknown; accuracy?: unknown }
): { status: number; body: any } {
  const loc = db
    .prepare('SELECT lat, lng, radius_m FROM hr_checkin_locations WHERE tenant_id = ?')
    .get(tenantId) as { lat: number; lng: number; radius_m: number } | undefined

  const hasLat =
    geo?.lat !== undefined && geo?.lat !== null && geo?.lat !== '' && typeof geo?.lat !== 'boolean'
  const hasLng =
    geo?.lng !== undefined && geo?.lng !== null && geo?.lng !== '' && typeof geo?.lng !== 'boolean'
  const latNum = hasLat ? Number(geo.lat) : NaN
  const lngNum = hasLng ? Number(geo.lng) : NaN
  const validCoords =
    Number.isFinite(latNum) &&
    Number.isFinite(lngNum) &&
    latNum >= -90 &&
    latNum <= 90 &&
    lngNum >= -180 &&
    lngNum <= 180

  let distanceM: number | null = null
  if (loc) {
    if (!validCoords) {
      return {
        status: 400,
        body: { success: false, message: 'ต้องเปิดตำแหน่ง (GPS) เพื่อเช็คอิน' },
      }
    }
    const rawDist = haversineMeters(Number(loc.lat), Number(loc.lng), latNum, lngNum)
    distanceM = Math.round(rawDist)
    const rawAcc =
      geo?.accuracy !== undefined && geo?.accuracy !== null && typeof geo?.accuracy !== 'boolean'
        ? Number(geo.accuracy)
        : 0
    const accuracy = Number.isFinite(rawAcc) && rawAcc > 0 ? rawAcc : 0
    const maxDist = Number(loc.radius_m) + Math.min(accuracy, 100)
    if (rawDist > maxDist) {
      return {
        status: 400,
        body: { success: false, message: `อยู่นอกพื้นที่ร้าน (ห่าง ${distanceM} ม.)` },
      }
    }
  }

  const devicePin = ensureDevicePin(tenantId, emp.id, emp.device_pin ?? null)
  const nowThai = thaiNowDateTime()
  const today = nowThai.slice(0, 10)
  const nowEpochMs = Date.parse(nowThai.replace(' ', 'T') + 'Z')

  try {
    return db.transaction(() => {
      const lastLog = db
        .prepare(
          `SELECT punched_at FROM attendance_logs
           WHERE tenant_id = ? AND device_pin = ? AND punched_at <= ?
           ORDER BY punched_at DESC LIMIT 1`
        )
        .get(tenantId, devicePin, nowThai) as { punched_at: string } | undefined

      if (lastLog?.punched_at) {
        const lastMs = Date.parse(lastLog.punched_at.replace(' ', 'T') + 'Z')
        if (Number.isFinite(lastMs) && nowEpochMs - lastMs >= 0 && nowEpochMs - lastMs < DEBOUNCE_MS) {
          return {
            status: 409,
            body: { success: false, message: `เพิ่งบันทึกไปเมื่อ ${lastLog.punched_at.slice(11, 16)}` },
          }
        }
      }

      const existingToday = db
        .prepare(
          `SELECT 1 FROM attendance_logs
           WHERE tenant_id = ? AND device_pin = ? AND punched_at >= ? AND punched_at <= ?
           LIMIT 1`
        )
        .get(tenantId, devicePin, `${today} 00:00:00`, `${today} 23:59:59`)
      const kind: 'IN' | 'OUT' = existingToday ? 'OUT' : 'IN'

      db.prepare(
        `INSERT INTO attendance_logs (
           id, tenant_id, device_pin, punched_at, source, import_id, lat, lng, distance_m, created_at
         ) VALUES (?, ?, ?, ?, 'WEB', NULL, ?, ?, ?, ?)`
      ).run(
        generateId(),
        tenantId,
        devicePin,
        nowThai,
        validCoords ? latNum : null,
        validCoords ? lngNum : null,
        distanceM,
        new Date().toISOString()
      )

      const employeeName = `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim()
      return {
        status: 201,
        body: {
          success: true,
          data: {
            punched_at: nowThai,
            kind,
            employee_name: employeeName,
            distance_m: distanceM,
          },
        },
      }
    })()
  } catch (err: any) {
    if (isUniqueConstraintError(err)) {
      return {
        status: 409,
        body: { success: false, message: `เพิ่งบันทึกไปเมื่อ ${nowThai.slice(11, 16)}` },
      }
    }
    throw err
  }
}

// C1: GET /api/hr/checkin/location (hr:read หรือ self)
router.get('/checkin/location', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = (req.user as any)?.id || req.user!.userId
    if (!userCan(req.user!, 'hr', 'read') && !getSelfEmployee(tenantId, userId)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }
    const row = db
      .prepare('SELECT lat, lng, radius_m FROM hr_checkin_locations WHERE tenant_id = ?')
      .get(tenantId) as { lat: number; lng: number; radius_m: number } | undefined

    res.json({
      success: true,
      data: row ? { lat: Number(row.lat), lng: Number(row.lng), radius_m: Number(row.radius_m) } : null,
    })
  } catch (error: any) {
    console.error('Get checkin location error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// C2: PUT /api/hr/checkin/location (hr:write)
router.put('/checkin/location', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const body = req.body

    const isClear =
      body === null ||
      body === undefined ||
      (typeof body === 'object' &&
        !Array.isArray(body) &&
        (Object.keys(body).length === 0 || (body.lat === null && body.lng === null)))

    if (isClear) {
      db.prepare('DELETE FROM hr_checkin_locations WHERE tenant_id = ?').run(tenantId)
      return res.json({ success: true, data: null })
    }

    const lat = typeof body?.lat === 'boolean' || body?.lat === '' || body?.lat === null ? NaN : Number(body?.lat)
    const lng = typeof body?.lng === 'boolean' || body?.lng === '' || body?.lng === null ? NaN : Number(body?.lng)
    const rawRadius = body?.radius_m === undefined ? 150 : body?.radius_m
    const radiusM =
      typeof rawRadius === 'boolean' || rawRadius === '' || rawRadius === null ? NaN : Number(rawRadius)

    if (
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      !Number.isFinite(lng) ||
      lng < -180 ||
      lng > 180 ||
      !Number.isFinite(radiusM) ||
      radiusM <= 0
    ) {
      return res.status(400).json({ success: false, message: 'พิกัดหรือรัศมีจุดเช็คอินไม่ถูกต้อง' })
    }

    const roundedRadius = Math.round(radiusM)
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO hr_checkin_locations (tenant_id, lat, lng, radius_m, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id) DO UPDATE SET
         lat = excluded.lat,
         lng = excluded.lng,
         radius_m = excluded.radius_m,
         updated_at = excluded.updated_at`
    ).run(tenantId, lat, lng, roundedRadius, now)

    res.json({
      success: true,
      data: { lat, lng, radius_m: roundedRadius },
    })
  } catch (error: any) {
    console.error('Set checkin location error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// C3: POST /api/hr/checkin (self)
router.post('/checkin', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = (req.user as any)?.id || req.user!.userId
    const emp = getSelfEmployee(tenantId, userId)
    if (!emp) {
      return res.status(404).json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    const result = executeCheckin(tenantId, emp, req.body || {})
    return res.status(result.status).json(result.body)
  } catch (error: any) {
    console.error('Self checkin error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// C4: POST /api/hr/checkin/pin (hr:read — Kiosk)
router.post('/checkin/pin', requirePermission('hr', 'read'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const body = req.body || {}
    const employeeCode = typeof body.employee_code === 'string' ? body.employee_code.trim() : ''
    const pin = typeof body.pin === 'string' ? body.pin.trim() : ''

    if (!employeeCode || !pin) {
      return res.status(400).json({ success: false, message: 'รหัสพนักงานหรือ PIN ไม่ถูกต้อง' })
    }

    const lockKey = `${tenantId}:${employeeCode}`
    if (isPinLocked(lockKey)) {
      return res.status(429).json({
        success: false,
        message: 'กด PIN ผิดเกินจำนวนครั้งที่กำหนด กรุณารอ 5 นาทีแล้วลองใหม่',
      })
    }

    const emp = db
      .prepare(
        `SELECT * FROM employees
         WHERE tenant_id = ? AND code = ? AND status = 'ACTIVE'`
      )
      .get(tenantId, employeeCode) as any

    const pinValid =
      emp && emp.checkin_pin_hash ? await bcrypt.compare(pin, String(emp.checkin_pin_hash)) : false

    if (!pinValid) {
      const lockedNow = recordPinFailure(lockKey)
      if (lockedNow) {
        return res.status(429).json({
          success: false,
          message: 'กด PIN ผิดเกินจำนวนครั้งที่กำหนด กรุณารอ 5 นาทีแล้วลองใหม่',
        })
      }
      return res.status(400).json({ success: false, message: 'รหัสพนักงานหรือ PIN ไม่ถูกต้อง' })
    }

    pinFailures.delete(lockKey)

    const result = executeCheckin(tenantId, emp, body)
    return res.status(result.status).json(result.body)
  } catch (error: any) {
    console.error('PIN checkin error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// C5: GET /api/hr/me/attendance (self)
router.get('/me/attendance', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = (req.user as any)?.id || req.user!.userId
    const emp = getSelfEmployee(tenantId, userId)
    if (!emp) {
      return res.status(404).json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    const rawTo = typeof req.query.to === 'string' ? req.query.to.trim() : ''
    const rawFrom = typeof req.query.from === 'string' ? req.query.from.trim() : ''
    const to = rawTo || thaiDateStr()
    const from =
      rawFrom ||
      (isValidIsoDate(to)
        ? new Date(new Date(`${to}T00:00:00Z`).getTime() - 13 * 86_400_000).toISOString().slice(0, 10)
        : '')

    const summary = getAttendanceSummary(tenantId, from, to, emp.id)
    const empSummary = summary.employees[0]

    const pin: string | null = emp.device_pin ?? null
    const logs = pin
      ? (
          db
            .prepare(
              `SELECT punched_at, source, distance_m
               FROM attendance_logs
               WHERE tenant_id = ? AND device_pin = ? AND punched_at >= ? AND punched_at <= ?
               ORDER BY punched_at DESC, id DESC`
            )
            .all(tenantId, pin, `${from} 00:00:00`, `${to} 23:59:59`) as {
            punched_at: string
            source: 'FILE' | 'MCP' | 'WEB' | 'DEVICE'
            distance_m: number | null
          }[]
        ).map((r) => ({
          punched_at: r.punched_at,
          source: r.source,
          distance_m: r.distance_m !== null && r.distance_m !== undefined ? Number(r.distance_m) : null,
        }))
      : []

    const fullName = `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim()
    res.json({
      success: true,
      data: {
        employee: {
          id: emp.id,
          code: emp.code,
          name: fullName,
          device_pin: pin,
          shift_name: emp.shift_name ?? null,
        },
        logs,
        days: empSummary ? empSummary.days : [],
        totals: empSummary ? empSummary.totals : null,
      },
    })
  } catch (error: any) {
    if (error instanceof AttendanceError) {
      return res.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Get my attendance error:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router

