import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import {
  parseAttendanceFile,
  summarizeDay,
  summarizePeriod,
  Punch,
  Shift,
  DaySummary,
  PeriodTotals,
} from './attendance'

export const MAX_ATTENDANCE_IMPORT_BYTES = 5 * 1024 * 1024 // 5 MB

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidIsoDate(val: unknown): val is string {
  if (typeof val !== 'string' || !DATE_RE.test(val)) return false
  const d = new Date(`${val}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === val
}

export class AttendanceError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export interface ImportAttendanceInput {
  tenantId: string
  filename?: string
  content: string
  source?: 'FILE' | 'MCP' | 'WEB' | 'DEVICE'
  createdBy?: string | null
}

export interface UnmappedPinCount {
  pin: string
  count: number
}

export interface ImportAttendanceResult {
  importId: string
  total: number
  inserted: number
  duplicates: number
  skipped: { line: number; reason: string }[]
  skippedCount: number
  unmappedPins: UnmappedPinCount[]
}

export function importAttendance(input: ImportAttendanceInput): ImportAttendanceResult {
  const { tenantId, filename = 'upload.txt', content, source = 'FILE', createdBy = null } = input

  if (typeof content !== 'string') {
    throw new AttendanceError('กรุณาระบุเนื้อหาไฟล์เวลาเข้าออก (content)', 400)
  }

  const byteLen = Buffer.byteLength(content, 'utf8')
  if (byteLen > MAX_ATTENDANCE_IMPORT_BYTES) {
    throw new AttendanceError('ขนาดไฟล์เกินกำหนดสูงสุด 5 MB', 413)
  }

  let parsed
  try {
    parsed = parseAttendanceFile(content, filename)
  } catch (err: any) {
    throw new AttendanceError(err?.message || 'ไม่พบข้อมูลบันทึกเวลาที่ถูกต้องในไฟล์', 400)
  }

  const importId = generateId()
  const now = new Date().toISOString()
  const total = parsed.punches.length + parsed.skipped.length

  let inserted = 0
  let duplicates = 0

  const insertLogStmt = db.prepare(`
    INSERT OR IGNORE INTO attendance_logs (
      id, tenant_id, device_pin, punched_at, source, import_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const insertImportStmt = db.prepare(`
    INSERT INTO attendance_imports (
      id, tenant_id, filename, source, total, inserted, duplicates, skipped, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const runTx = db.transaction(() => {
    for (const p of parsed.punches) {
      const info = insertLogStmt.run(
        generateId(),
        tenantId,
        p.devicePin,
        p.at,
        source,
        importId,
        now
      )
      if (info.changes > 0) inserted++
      else duplicates++
    }

    insertImportStmt.run(
      importId,
      tenantId,
      String(filename || 'upload.txt').trim() || 'upload.txt',
      source,
      total,
      inserted,
      duplicates,
      parsed.skipped.length,
      createdBy,
      now
    )
  })

  runTx()

  // Count punches per pin in this import that are not mapped to an ACTIVE employee
  const activePinsRows = db
    .prepare(
      `SELECT device_pin FROM employees WHERE tenant_id = ? AND status = 'ACTIVE' AND device_pin IS NOT NULL`
    )
    .all(tenantId) as { device_pin: string }[]
  const activePins = new Set(activePinsRows.map((r) => r.device_pin))

  const pinCounts = new Map<string, number>()
  for (const p of parsed.punches) {
    if (!activePins.has(p.devicePin)) {
      pinCounts.set(p.devicePin, (pinCounts.get(p.devicePin) || 0) + 1)
    }
  }

  const unmappedPins: UnmappedPinCount[] = [...pinCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([pin, count]) => ({ pin, count }))

  return {
    importId,
    total,
    inserted,
    duplicates,
    skipped: parsed.skipped.slice(0, 50),
    skippedCount: parsed.skipped.length,
    unmappedPins,
  }
}

export interface UnmappedPinDetail {
  pin: string
  device_pin: string
  devicePin: string
  count: number
  counts: number
  first_punch: string
  last_punch: string
  firstPunch: string
  lastPunch: string
}

export function getUnmappedPins(tenantId: string): UnmappedPinDetail[] {
  const rows = db
    .prepare(
      `
      SELECT
        l.device_pin AS pin,
        COUNT(*) AS count,
        MIN(l.punched_at) AS first_punch,
        MAX(l.punched_at) AS last_punch
      FROM attendance_logs l
      WHERE l.tenant_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM employees e
          WHERE e.tenant_id = l.tenant_id
            AND e.device_pin = l.device_pin
            AND e.status = 'ACTIVE'
        )
      GROUP BY l.device_pin
      ORDER BY l.device_pin ASC
    `
    )
    .all(tenantId) as { pin: string; count: number; first_punch: string; last_punch: string }[]

  return rows.map((r) => ({
    pin: r.pin,
    device_pin: r.pin,
    devicePin: r.pin,
    count: Number(r.count),
    counts: Number(r.count),
    first_punch: r.first_punch,
    last_punch: r.last_punch,
    firstPunch: r.first_punch,
    lastPunch: r.last_punch,
  }))
}

export interface ShiftInfo extends Shift {
  id: string
  name: string
  start_time: string
  end_time: string
  grace_minutes: number
  break_minutes: number
}

export interface EmployeeAttendanceSummaryItem extends PeriodTotals {
  employeeId: string
  employee_id: string
  id: string
  code: string
  first_name: string
  last_name: string | null
  nickname: string | null
  name: string
  position: string | null
  org_unit_id: string | null
  org_unit_name: string | null
  device_pin: string | null
  devicePin: string | null
  shift_id: string
  shiftId: string
  shift_name: string
  shiftName: string
  employee: {
    id: string
    code: string
    first_name: string
    last_name: string | null
    device_pin: string | null
    shift_id: string
  }
  shift: ShiftInfo
  days: DaySummary[]
  totals: PeriodTotals
}

export interface NoShiftEmployeeItem {
  employeeId: string
  employee_id: string
  id: string
  code: string
  first_name: string
  last_name: string | null
  nickname: string | null
  name: string
  position: string | null
  org_unit_id: string | null
  org_unit_name: string | null
  device_pin: string | null
  devicePin: string | null
}

export interface AttendanceSummaryResponse {
  from: string
  to: string
  employees: EmployeeAttendanceSummaryItem[]
  noShift: NoShiftEmployeeItem[]
  unmappedPins: UnmappedPinDetail[]
}

function listDates(from: string, to: string): string[] {
  const dates: string[] = []
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const cur = new Date(Date.UTC(fy, fm - 1, fd))
  const end = new Date(Date.UTC(ty, tm - 1, td))
  while (cur <= end) {
    const y = cur.getUTCFullYear()
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0')
    const d = String(cur.getUTCDate()).padStart(2, '0')
    dates.push(`${y}-${m}-${d}`)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

export function getAttendanceSummary(
  tenantId: string,
  from: string,
  to: string,
  employeeId?: string
): AttendanceSummaryResponse {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    throw new AttendanceError('กรุณาระบุช่วงวันที่ from และ to ในรูปแบบ YYYY-MM-DD', 400)
  }
  if (from > to) {
    throw new AttendanceError('วันที่เริ่มต้น (from) ต้องไม่มากกว่าวันที่สิ้นสุด (to)', 400)
  }

  const fromMs = new Date(`${from}T00:00:00Z`).getTime()
  const toMs = new Date(`${to}T00:00:00Z`).getTime()
  const diffDays = Math.floor((toMs - fromMs) / 86_400_000) + 1
  if (diffDays > 62) {
    throw new AttendanceError('ช่วงวันที่สรุปเวลาเข้าออกต้องไม่เกิน 62 วัน', 400)
  }

  let empSql = `
    SELECT
      e.id, e.code, e.first_name, e.last_name, e.nickname, e.position,
      e.org_unit_id, ou.name AS org_unit_name, e.device_pin, e.shift_id,
      s.name AS shift_name, s.start_time, s.end_time, s.grace_minutes, s.break_minutes
    FROM employees e
    LEFT JOIN org_units ou ON e.org_unit_id = ou.id AND ou.tenant_id = e.tenant_id
    LEFT JOIN shifts s ON e.shift_id = s.id AND s.tenant_id = e.tenant_id
    WHERE e.tenant_id = ? AND e.status = 'ACTIVE'
  `
  const empParams: any[] = [tenantId]
  if (employeeId && employeeId.trim()) {
    empSql += ' AND e.id = ?'
    empParams.push(employeeId.trim())
  }
  empSql += ' ORDER BY e.code ASC'

  const empRows = db.prepare(empSql).all(...empParams) as any[]

  const logStmt = db.prepare(`
    SELECT punched_at
    FROM attendance_logs
    WHERE tenant_id = ?
      AND device_pin = ?
      AND punched_at >= ?
      AND punched_at <= ?
    ORDER BY punched_at ASC
  `)

  const employees: EmployeeAttendanceSummaryItem[] = []
  const noShift: NoShiftEmployeeItem[] = []

  // Buffer 1 day around [from, to] so summarizeDay's [-4h, +6h] window catches early/overnight punches
  const fromBuffer = new Date(fromMs - 86_400_000).toISOString().slice(0, 10)
  const toBuffer = new Date(toMs + 86_400_000).toISOString().slice(0, 10)
  const fromBound = `${fromBuffer} 00:00:00`
  const toBound = `${toBuffer} 23:59:59`
  const dates = listDates(from, to)

  // B3: Load public holidays and approved leave requests for the range
  const holidayRows = db.prepare(
    'SELECT date FROM public_holidays WHERE tenant_id = ? AND date >= ? AND date <= ?'
  ).all(tenantId, from, to) as { date: string }[]
  const holidayDates = new Set(holidayRows.map((r) => r.date))

  let leaveSql = `
    SELECT employee_id, start_date, end_date
    FROM leave_requests
    WHERE tenant_id = ?
      AND status = 'APPROVED'
      AND start_date <= ?
      AND end_date >= ?
  `
  const leaveParams: any[] = [tenantId, to, from]
  if (employeeId && employeeId.trim()) {
    leaveSql += ' AND employee_id = ?'
    leaveParams.push(employeeId.trim())
  }
  const leaveRows = db.prepare(leaveSql).all(...leaveParams) as { employee_id: string; start_date: string; end_date: string }[]

  const empLeaveDates = new Map<string, Set<string>>()
  for (const lr of leaveRows) {
    let set = empLeaveDates.get(lr.employee_id)
    if (!set) {
      set = new Set<string>()
      empLeaveDates.set(lr.employee_id, set)
    }
    const rStart = lr.start_date < from ? from : lr.start_date
    const rEnd = lr.end_date > to ? to : lr.end_date
    for (const d of listDates(rStart, rEnd)) {
      set.add(d)
    }
  }

  for (const emp of empRows) {
    const fullName = `${emp.first_name}${emp.last_name ? ' ' + emp.last_name : ''}`
    if (!emp.shift_id || !emp.start_time || !emp.end_time) {
      noShift.push({
        employeeId: emp.id,
        employee_id: emp.id,
        id: emp.id,
        code: emp.code,
        first_name: emp.first_name,
        last_name: emp.last_name,
        nickname: emp.nickname,
        name: fullName,
        position: emp.position,
        org_unit_id: emp.org_unit_id,
        org_unit_name: emp.org_unit_name ?? null,
        device_pin: emp.device_pin ?? null,
        devicePin: emp.device_pin ?? null,
      })
      continue
    }

    const graceMinutes = Number(emp.grace_minutes ?? 0)
    const breakMinutes = Number(emp.break_minutes ?? 60)

    const shift: ShiftInfo = {
      id: emp.shift_id,
      name: emp.shift_name,
      start: emp.start_time,
      end: emp.end_time,
      graceMinutes,
      breakMinutes,
      start_time: emp.start_time,
      end_time: emp.end_time,
      grace_minutes: graceMinutes,
      break_minutes: breakMinutes,
    }

    const pin: string | null = emp.device_pin ?? null
    const punches: Punch[] = pin
      ? (logStmt.all(tenantId, pin, fromBound, toBound) as { punched_at: string }[]).map((r) => ({
          devicePin: pin,
          at: r.punched_at,
        }))
      : []

    let days: DaySummary[]
    let totals: PeriodTotals

    if (pin && punches.length > 0) {
      const periodResult = summarizePeriod(punches, () => shift, from, to)
      const empPeriod = periodResult.byPin[pin]
      days = empPeriod ? empPeriod.days : dates.map((d) => summarizeDay([], shift, d))
      totals = empPeriod
        ? empPeriod.totals
        : {
            lateMinutes: 0,
            earlyLeaveMinutes: 0,
            otCandidateMinutes: 0,
            absentDays: dates.length,
            daysWorked: 0,
          }
    } else {
      days = dates.map((d) => summarizeDay([], shift, d))
      totals = {
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        otCandidateMinutes: 0,
        absentDays: dates.length,
        daysWorked: 0,
      }
    }

    // ponytail: B3 holiday and approved leave days are not absent; holiday wins when both
    const leaveDates = empLeaveDates.get(emp.id) ?? new Set<string>()
    let holidayDays = 0
    let leaveDays = 0

    for (const day of days) {
      const isHoliday = holidayDates.has(day.workDate)
      const isLeave = leaveDates.has(day.workDate)
      if (isHoliday) {
        holidayDays++
        day.absent = false
      } else if (isLeave) {
        leaveDays++
        day.absent = false
      }
    }

    totals = {
      ...totals,
      absentDays: days.filter((d) => d.absent).length,
    }
    if (holidayDays > 0) totals.holidayDays = holidayDays
    if (leaveDays > 0) totals.leaveDays = leaveDays

    employees.push({
      employeeId: emp.id,
      employee_id: emp.id,
      id: emp.id,
      code: emp.code,
      first_name: emp.first_name,
      last_name: emp.last_name,
      nickname: emp.nickname,
      name: fullName,
      position: emp.position,
      org_unit_id: emp.org_unit_id,
      org_unit_name: emp.org_unit_name ?? null,
      device_pin: pin,
      devicePin: pin,
      shift_id: emp.shift_id,
      shiftId: emp.shift_id,
      shift_name: emp.shift_name,
      shiftName: emp.shift_name,
      employee: {
        id: emp.id,
        code: emp.code,
        first_name: emp.first_name,
        last_name: emp.last_name,
        device_pin: pin,
        shift_id: emp.shift_id,
      },
      shift,
      days,
      totals,
      ...totals,
    })
  }

  const unmappedPins = getUnmappedPins(tenantId)

  return {
    from,
    to,
    employees,
    noShift,
    unmappedPins,
  }
}
