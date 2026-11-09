// HR Phase 7 (สัญญากลาง docs/contracts/hr-phase7.md) — กติกากฎหมายแรงงานและคำนวณค่าแรงตารางกะ (pure functions ไม่แตะ DB)

export interface WorkDay {
  date: string
  hours: number
}

const round2 = (n: number): number => Math.round(n * 100) / 100

export function employeeWarnings(
  days: WorkDay[],
  breakShort: Array<{ date: string; shiftName: string }>,
  totalDays: number
): string[] {
  const warnings: string[] = []

  for (const d of days) {
    if (d.hours > 8) {
      const ot = String(round2(d.hours - 8))
      warnings.push(`${d.date} เกิน 8 ชม. (OT ${ot} ชม.)`)
    }
  }

  for (const b of breakShort) {
    warnings.push(`${b.date} ${b.shiftName} พักน้อยกว่า 1 ชม.`)
  }

  const normalHours = days.reduce((sum, d) => sum + Math.min(8, d.hours), 0)
  if (normalHours > 48) {
    warnings.push('ชั่วโมงปกติเกิน 48 ชม./สัปดาห์')
  }

  const otHours = days.reduce((sum, d) => sum + Math.max(0, d.hours - 8), 0)
  if (otHours > 36) {
    warnings.push('OT เกิน 36 ชม./สัปดาห์')
  }

  if (totalDays > 0 && days.length >= totalDays) {
    warnings.push('ไม่มีวันหยุดในสัปดาห์ (ม.28)')
  }

  return warnings
}

export function dayLaborCost(
  employmentType: 'MONTHLY' | 'DAILY' | 'HOURLY',
  baseWage: number,
  hours: number,
  daysPerMonthForRate: number
): number {
  if (employmentType === 'MONTHLY') {
    return round2(baseWage / (daysPerMonthForRate || 30))
  }
  if (employmentType === 'DAILY') {
    return round2(baseWage)
  }
  return round2(baseWage * hours)
}

export function laborPct(laborCost: number, avgSales: number | null): number | null {
  if (avgSales === null || avgSales <= 0) return null
  return Math.round((laborCost / avgSales) * 1000) / 10
}
