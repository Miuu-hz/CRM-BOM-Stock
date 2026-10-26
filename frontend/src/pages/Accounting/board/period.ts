// ตัวช่วยคำนวณช่วงวันของ Phopy Board 7 บท — แยกออกมาเป็นฟังก์ชัน pure ให้เทสต์ได้โดยไม่ต้องยิง API
import {
  startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear,
  subYears, subMonths, subDays, differenceInCalendarDays, format, parseISO,
} from 'date-fns'

export type PeriodPreset = 'month' | 'quarter' | 'year' | '3y' | '5y' | 'custom'
export type ComparePreset = 'prev' | 'yoy' | 'budget'
export interface DateRange { startDate: string; endDate: string }

const d = (x: Date) => format(x, 'yyyy-MM-dd')

/** ช่วงวันของตัวกรองงวด — เดือน/ไตรมาส/ปี ใช้ปฏิทินปัจจุบัน, 3ปี/5ปี นับรวมปีปัจจุบันด้วย */
export function periodRange(preset: PeriodPreset, now: Date, custom?: DateRange): DateRange {
  switch (preset) {
    case 'month': return { startDate: d(startOfMonth(now)), endDate: d(endOfMonth(now)) }
    case 'quarter': return { startDate: d(startOfQuarter(now)), endDate: d(endOfQuarter(now)) }
    case 'year': return { startDate: d(startOfYear(now)), endDate: d(endOfYear(now)) }
    case '3y': return { startDate: d(startOfYear(subYears(now, 2))), endDate: d(endOfYear(now)) }
    case '5y': return { startDate: d(startOfYear(subYears(now, 4))), endDate: d(endOfYear(now)) }
    case 'custom': return custom ?? { startDate: d(startOfMonth(now)), endDate: d(now) }
  }
}

/**
 * งวดเทียบ: ช่วงเดียวกันปีก่อน (yoy) หรือ งวดก่อนหน้าที่ยาวเท่ากันติดกัน (prev — เช่นไตรมาสนี้เทียบไตรมาสก่อน)
 * งบประมาณ (budget) ไม่มีช่วงวันของตัวเอง (เทียบกับทั้งปี ไม่ใช่ช่วงวันที่) จึงคืน null
 */
export function compareRange(range: DateRange, compare: ComparePreset): DateRange | null {
  if (compare === 'budget') return null
  const start = parseISO(range.startDate), end = parseISO(range.endDate)
  if (compare === 'yoy') return { startDate: d(subYears(start, 1)), endDate: d(subYears(end, 1)) }
  const days = differenceInCalendarDays(end, start) + 1
  const prevEnd = subDays(start, 1)
  return { startDate: d(subDays(prevEnd, days - 1)), endDate: d(prevEnd) }
}

/** งวดปิดบัญชีคู่กับด่านตรวจ (บท 6): เดือนของ endDate ถ้าเดือนนั้นจบแล้ว ไม่งั้นใช้เดือนก่อนหน้า */
export function closeChecklistPeriod(endDate: string, now: Date = new Date()): string {
  const end = parseISO(endDate)
  const monthEnded = endOfMonth(end).getTime() < now.getTime()
  return format(monthEnded ? end : subMonths(end, 1), 'yyyy-MM')
}
