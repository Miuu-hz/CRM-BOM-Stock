import { describe, it, expect } from 'vitest'
import { employeeWarnings, dayLaborCost, laborPct } from './roster'

describe('roster pure rules (HR Phase 7 — B7a)', () => {
  it('triggers every warning on a heavy 7-day week and none on a clean 5-day 8h week', () => {
    // 7 วัน: มีวัน 10 ชม., กะ 6 ชม. พัก 30 นาที, ปกติรวม 54 (>48), OT รวม 37 (>36), ไม่มีวันหยุด
    const heavyDays = [
      { date: '2030-01-07', hours: 10 }, // ปกติ 8, OT 2
      { date: '2030-01-08', hours: 6 },  // ปกติ 6, OT 0 (พัก 30 นาที)
      { date: '2030-01-09', hours: 15 }, // ปกติ 8, OT 7
      { date: '2030-01-10', hours: 15 }, // ปกติ 8, OT 7
      { date: '2030-01-11', hours: 15 }, // ปกติ 8, OT 7
      { date: '2030-01-12', hours: 15 }, // ปกติ 8, OT 7
      { date: '2030-01-13', hours: 15 }, // ปกติ 8, OT 7
    ]
    const warnings = employeeWarnings(
      heavyDays,
      [{ date: '2030-01-08', shiftName: 'กะสั้น' }],
      7
    )

    expect(warnings).toContain('2030-01-07 เกิน 8 ชม. (OT 2 ชม.)')
    expect(warnings).toContain('2030-01-08 กะสั้น พักน้อยกว่า 1 ชม.')
    expect(warnings).toContain('ชั่วโมงปกติเกิน 48 ชม./สัปดาห์')
    expect(warnings).toContain('OT เกิน 36 ชม./สัปดาห์')
    expect(warnings).toContain('ไม่มีวันหยุดในสัปดาห์ (ม.28)')

    // สัปดาห์ปกติ 5 วัน วันละ 8 ชม. ไม่มีคำเตือน
    const cleanDays = [
      { date: '2030-01-07', hours: 8 },
      { date: '2030-01-08', hours: 8 },
      { date: '2030-01-09', hours: 8 },
      { date: '2030-01-10', hours: 8 },
      { date: '2030-01-11', hours: 8 },
    ]
    expect(employeeWarnings(cleanDays, [], 7)).toEqual([])
  })

  it('calculates dayLaborCost for MONTHLY, DAILY, and HOURLY', () => {
    expect(dayLaborCost('MONTHLY', 15000, 8, 30)).toBe(500)
    expect(dayLaborCost('MONTHLY', 10000, 8, 30)).toBe(333.33)
    expect(dayLaborCost('DAILY', 400, 11, 30)).toBe(400)
    expect(dayLaborCost('HOURLY', 50, 8.5, 30)).toBe(425)
  })

  it('calculates laborPct and returns null when avgSales is null or <= 0', () => {
    expect(laborPct(900, null)).toBeNull()
    expect(laborPct(900, 0)).toBeNull()
    expect(laborPct(900, -500)).toBeNull()
    expect(laborPct(900, 1000)).toBe(90)
    expect(laborPct(100, 300)).toBe(33.3)
  })
})
