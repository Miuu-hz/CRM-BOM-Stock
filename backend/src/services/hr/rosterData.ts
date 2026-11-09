import db from '../../db/sqlite'

// HR Phase 7 (สัญญากลาง docs/contracts/hr-phase7.md) — อ่านกะที่มีผลจริงรายวัน ใช้ร่วมกันทั้งตารางกะและแลกกะ
// ลำดับ: แถว shift_assignments (shift_id NULL = วันหยุด) → กะประจำ employees.shift_id → ไม่มีกะ

export interface RosterShift {
  id: string
  name: string
  start_time: string
  end_time: string
  grace_minutes: number
  break_minutes: number
  is_active: number
  /** ชั่วโมงทำงานสุทธิ (หักพักแล้ว) */
  hours: number
}

export interface RosterCell {
  date: string
  shift_id: string | null
  source: 'ASSIGNED' | 'DEFAULT' | 'NONE'
  on_leave: boolean
  holiday: boolean
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 7 วันเริ่มจาก week_start (ต้องเป็นวันจันทร์ — ผู้เรียกตรวจเอง) */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

export function isMonday(date: string): boolean {
  return isIsoDate(date) && new Date(`${date}T00:00:00Z`).getUTCDay() === 1
}

/** ชั่วโมงสุทธิของกะ: (เลิก − เริ่ม, ข้ามเที่ยงคืนได้) − พัก */
export function shiftHours(start: string, end: string, breakMinutes: number): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = eh * 60 + em - (sh * 60 + sm)
  if (mins <= 0) mins += 24 * 60
  return Math.max(0, Math.round(((mins - (breakMinutes || 0)) / 60) * 100) / 100)
}

export function listShifts(tenantId: string): RosterShift[] {
  const rows = db.prepare('SELECT * FROM shifts WHERE tenant_id = ? ORDER BY start_time ASC, name ASC').all(tenantId) as any[]
  return rows.map((r) => ({
    id: r.id, name: r.name, start_time: r.start_time, end_time: r.end_time,
    grace_minutes: Number(r.grace_minutes ?? 0), break_minutes: Number(r.break_minutes ?? 60), is_active: Number(r.is_active ?? 1),
    hours: shiftHours(r.start_time, r.end_time, Number(r.break_minutes ?? 60)),
  }))
}

/**
 * กะที่มีผลของพนักงานแต่ละคนในวันที่ `dates` (เรียงตาม dates) — key = employee_id
 * ไม่ส่ง employeeIds = พนักงาน ACTIVE ทุกคนของ tenant
 */
export function getEffectiveCells(tenantId: string, dates: string[], employeeIds?: string[]): Map<string, RosterCell[]> {
  const out = new Map<string, RosterCell[]>()
  if (dates.length === 0) return out
  const from = dates.reduce((a, b) => (a < b ? a : b))
  const to = dates.reduce((a, b) => (a > b ? a : b))
  const emps = (employeeIds
    ? employeeIds.map((id) => db.prepare('SELECT id, shift_id FROM employees WHERE id = ? AND tenant_id = ?').get(id, tenantId)).filter(Boolean)
    : db.prepare("SELECT id, shift_id FROM employees WHERE tenant_id = ? AND status = 'ACTIVE' ORDER BY code ASC").all(tenantId)) as Array<{ id: string; shift_id: string | null }>

  const holidays = new Set((db.prepare('SELECT date FROM public_holidays WHERE tenant_id = ? AND date >= ? AND date <= ?').all(tenantId, from, to) as { date: string }[]).map((r) => r.date))
  const assignStmt = db.prepare('SELECT work_date, shift_id FROM shift_assignments WHERE tenant_id = ? AND employee_id = ? AND work_date >= ? AND work_date <= ?')
  const leaveStmt = db.prepare("SELECT start_date, end_date FROM leave_requests WHERE tenant_id = ? AND employee_id = ? AND status = 'APPROVED' AND start_date <= ? AND end_date >= ?")

  for (const e of emps) {
    const assigned = new Map((assignStmt.all(tenantId, e.id, from, to) as { work_date: string; shift_id: string | null }[]).map((a) => [a.work_date, a.shift_id]))
    const leaves = leaveStmt.all(tenantId, e.id, to, from) as { start_date: string; end_date: string }[]
    out.set(e.id, dates.map((date) => {
      const has = assigned.has(date)
      const shiftId = has ? assigned.get(date) ?? null : e.shift_id ?? null
      return {
        date,
        shift_id: shiftId,
        source: has ? 'ASSIGNED' : shiftId ? 'DEFAULT' : 'NONE',
        on_leave: leaves.some((l) => l.start_date <= date && l.end_date >= date),
        holiday: holidays.has(date),
      }
    }))
  }
  return out
}
