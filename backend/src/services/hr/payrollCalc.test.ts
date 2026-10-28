import { describe, it, expect } from 'vitest'
import {
  calculatePayroll,
  DEFAULT_HR_SETTINGS,
  round2,
} from './payrollCalc'

describe('payrollCalc — Golden tests (คำนวณเงินเดือน สปส. ภ.ง.ด.1)', () => {
  it('สมชาย: MONTHLY 15,000 + OT 6h WORKDAY_OT + ค่าอาหาร 500 (taxable, !ssoable)', () => {
    const r = calculatePayroll({
      employmentType: 'MONTHLY',
      baseWage: 15000,
      ot: [{ hours: 6, kind: 'WORKDAY_OT' }],
      payItems: [{ name: 'ค่าอาหาร', amount: 500, taxable: true, ssoable: false }],
    })

    expect(r.basePay).toBe(15000)
    expect(r.otPay).toBe(562.5)
    expect(r.payItemsTotal).toBe(500)
    expect(r.gross).toBe(16062.5)
    expect(r.lateDeduction).toBe(0)
    expect(r.ssoBase).toBe(15562.5)
    expect(r.ssoEmployee).toBe(778)
    expect(r.ssoEmployer).toBe(778)
    expect(r.taxableMonthly).toBe(16062.5)
    expect(r.wht).toBe(0)
    expect(r.otherDeductionsTotal).toBe(0)
    expect(r.net).toBe(15284.5)
    expect(round2(r.lines.reduce((s, l) => s + l.amount, 0))).toBe(r.net)
    expect(r.lines.map(l => l.label)).toEqual(['ค่าจ้าง', 'ค่าล่วงเวลา', 'ค่าอาหาร', 'ประกันสังคม'])
  })

  it('มาลี: DAILY 400 × 26 วัน + OT 4h WORKDAY_OT + ค่าอาหาร 780 + สาย 25 นาที', () => {
    const r = calculatePayroll({
      employmentType: 'DAILY',
      baseWage: 400,
      daysWorked: 26,
      lateMinutes: 25,
      ot: [{ hours: 4, kind: 'WORKDAY_OT' }],
      payItems: [{ name: 'ค่าอาหาร', amount: 780, taxable: true, ssoable: false }],
    })

    expect(r.basePay).toBe(10400)
    expect(r.otPay).toBe(300)
    expect(r.payItemsTotal).toBe(780)
    expect(r.gross).toBe(11480)
    expect(r.lateDeduction).toBe(20.83)
    expect(r.ssoBase).toBe(10679.17)
    expect(r.ssoEmployee).toBe(534)
    expect(r.ssoEmployer).toBe(534)
    expect(r.taxableMonthly).toBe(11459.17)
    expect(r.wht).toBe(0)
    expect(r.net).toBe(10925.17)
    expect(round2(r.lines.reduce((s, l) => s + l.amount, 0))).toBe(r.net)
    expect(r.lines.find(l => l.code === 'LATE')).toEqual({ code: 'LATE', label: 'หักมาสาย', amount: -20.83 })
  })

  it('วิชัย: MONTHLY 35,000 + เบี้ยเลี้ยง 500 (taxable, !ssoable) → ชนเพดาน สปส. 875 และหัก ภ.ง.ด.1 = 439.58', () => {
    const r = calculatePayroll({
      employmentType: 'MONTHLY',
      baseWage: 35000,
      payItems: [{ name: 'ค่าอาหาร', amount: 500, taxable: true, ssoable: false }],
    })

    expect(r.basePay).toBe(35000)
    expect(r.gross).toBe(35500)
    expect(r.ssoBase).toBe(17500)
    expect(r.ssoEmployee).toBe(875)
    expect(r.ssoEmployer).toBe(875)
    expect(r.taxableMonthly).toBe(35500)
    expect(r.wht).toBe(439.58)
    expect(r.lateDeduction).toBe(0)
    expect(r.net).toBe(34185.42)
    expect(round2(r.lines.reduce((s, l) => s + l.amount, 0))).toBe(r.net)
    expect(r.lines.find(l => l.code === 'WHT')).toEqual({ code: 'WHT', label: 'ภาษีหัก ณ ที่จ่าย', amount: -439.58 })
  })

  it('นภา: MONTHLY 18,000 ลางานไม่รับค่าจ้าง 1 วัน', () => {
    const r = calculatePayroll({
      employmentType: 'MONTHLY',
      baseWage: 18000,
      unpaidLeaveDays: 1,
    })

    expect(r.basePay).toBe(17400)
    expect(r.gross).toBe(17400)
    expect(r.ssoBase).toBe(17400)
    expect(r.ssoEmployee).toBe(870)
    expect(r.ssoEmployer).toBe(870)
    expect(r.wht).toBe(0)
    expect(r.lateDeduction).toBe(0)
    expect(r.net).toBe(16530)
  })
})

describe('payrollCalc — กฎเฉพาะ (สปส. ขั้นต่ำ/ไม่ขึ้นทะเบียน, OT วันหยุด, รายชั่วโมง, หักอื่นๆ)', () => {
  it('ฐาน สปส. ต่ำกว่าขั้นต่ำ 1,650 → บีบขึ้นเป็น 1,650 คูณ 5% = 82.5 ปัดครึ่งขึ้นเป็น 83 บาท', () => {
    const r = calculatePayroll({
      employmentType: 'DAILY',
      baseWage: 300,
      daysWorked: 3, // 900 < 1,650
    })

    expect(r.basePay).toBe(900)
    expect(r.ssoBase).toBe(1650)
    expect(r.ssoEmployee).toBe(83)
    expect(r.ssoEmployer).toBe(83)
    expect(r.net).toBe(817)
  })

  it('ไม่เข้าประกันสังคม (ssoEnrolled = false) → สปส. ลูกจ้างและนายจ้างเป็น 0', () => {
    const r = calculatePayroll({
      employmentType: 'MONTHLY',
      baseWage: 20000,
      ssoEnrolled: false,
    })

    expect(r.ssoBase).toBe(0)
    expect(r.ssoEmployee).toBe(0)
    expect(r.ssoEmployer).toBe(0)
    expect(r.lines.some(l => l.code === 'SSO')).toBe(false)
  })

  it('ตัวคูณ OT: HOLIDAY_OT = 3×, HOLIDAY_WORK รายเดือน = 1× และรายวัน/รายชั่วโมง = 2×', () => {
    // รายเดือน 24,000 → ชม.ละ 24,000/30/8 = 100 บาท
    const monthly = calculatePayroll({
      employmentType: 'MONTHLY',
      baseWage: 24000,
      ot: [
        { hours: 2, kind: 'HOLIDAY_WORK' }, // 2 × 100 × 1 = 200
        { hours: 3, kind: 'HOLIDAY_OT' },   // 3 × 100 × 3 = 900
      ],
    })
    expect(monthly.otPay).toBe(1100)

    // รายชั่วโมง 100 บาท/ชม.
    const hourly = calculatePayroll({
      employmentType: 'HOURLY',
      baseWage: 100,
      hoursWorked: 160,
      ot: [
        { hours: 2, kind: 'HOLIDAY_WORK' }, // 2 × 100 × 2 = 400
        { hours: 3, kind: 'HOLIDAY_OT' },   // 3 × 100 × 3 = 900
      ],
    })
    expect(hourly.basePay).toBe(16000)
    expect(hourly.otPay).toBe(1300)
  })

  it('หักอื่นๆ (เบิกล่วงหน้า/เงินกู้) หักจากสุทธิเท่านั้น ไม่ลดฐานภาษีหรือฐาน สปส. และลดหย่อนภาษีช่วยลด WHT', () => {
    const r = calculatePayroll({
      employmentType: 'MONTHLY',
      baseWage: 35000,
      payItems: [{ name: 'ค่าอาหาร', amount: 500, taxable: true, ssoable: false }],
      otherDeductions: [{ name: 'หักเงินเบิกล่วงหน้า', amount: 2000 }],
      taxAllowances: { spouse: 60000, children: 30000, lifeInsurance: 20000 }, // รวม 110,000 → เงินได้สุทธิ 255,500 - 110,000 = 145,500 (ยกเว้นภาษี)
    })

    expect(r.ssoEmployee).toBe(875)
    expect(r.taxableMonthly).toBe(35500)
    expect(r.wht).toBe(0)
    expect(r.otherDeductionsTotal).toBe(2000)
    expect(r.net).toBe(35500 - 875 - 2000)
  })

  it('ตั้งค่า ssoIncludesOT = false → ไม่นำ OT มารวมฐาน สปส.', () => {
    const r = calculatePayroll(
      {
        employmentType: 'MONTHLY',
        baseWage: 15000,
        ot: [{ hours: 6, kind: 'WORKDAY_OT' }],
      },
      { ...DEFAULT_HR_SETTINGS, ssoIncludesOT: false }
    )
    expect(r.ssoBase).toBe(15000)
    expect(r.ssoEmployee).toBe(750)
  })
})

describe('payrollCalc — ตรวจสอบความถูกต้องของข้อมูลขาเข้า (Validation)', () => {
  it.each([
    [{ employmentType: 'CONTRACT' as any, baseWage: 15000 }, 'ประเภทการจ้าง'],
    [{ employmentType: 'MONTHLY' as const, baseWage: -1 }, 'อัตราค่าจ้าง'],
    [{ employmentType: 'MONTHLY' as const, baseWage: Number.NaN }, 'อัตราค่าจ้าง'],
    [{ employmentType: 'DAILY' as const, baseWage: 400, daysWorked: -2 }, 'จำนวนวันทำงาน'],
    [{ employmentType: 'HOURLY' as const, baseWage: 60, hoursWorked: -5 }, 'จำนวนชั่วโมงทำงาน'],
    [{ employmentType: 'MONTHLY' as const, baseWage: 15000, unpaidLeaveDays: -1 }, 'จำนวนวันลา'],
    [{ employmentType: 'MONTHLY' as const, baseWage: 15000, unpaidLeaveDays: 31 }, 'เกินจำนวนวัน'],
    [{ employmentType: 'MONTHLY' as const, baseWage: 15000, lateMinutes: -10 }, 'นาทีมาสาย'],
    [{ employmentType: 'MONTHLY' as const, baseWage: 15000, ot: [{ hours: -1, kind: 'WORKDAY_OT' as const }] }, 'ชั่วโมงล่วงเวลา'],
    [{ employmentType: 'MONTHLY' as const, baseWage: 15000, ot: [{ hours: 2, kind: 'NIGHT_OT' as any }] }, 'ประเภทค่าล่วงเวลา'],
    [{ employmentType: 'MONTHLY' as const, baseWage: 15000, payItems: [{ name: 'ค่าอาหาร', amount: -100, taxable: true, ssoable: false }] }, 'รายการเงินได้'],
    [{ employmentType: 'MONTHLY' as const, baseWage: 15000, otherDeductions: [{ name: 'กู้ยืม', amount: -50 }] }, 'รายการหักอื่นๆ'],
    [{ employmentType: 'MONTHLY' as const, baseWage: 15000, taxAllowances: { spouse: -1000 } }, 'ลดหย่อนคู่สมรส'],
  ])('ปฏิเสธอินพุตที่ไม่ถูกต้อง (%#)', (badInput, expectedMsg) => {
    expect(() => calculatePayroll(badInput)).toThrow(expectedMsg)
  })
})
