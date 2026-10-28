// คำนวณเงินเดือน ประกันสังคม (สปส.) และภาษีหัก ณ ที่จ่าย (ภ.ง.ด.1) รายคน — pure function ไม่แตะ DB

export type EmploymentType = 'MONTHLY' | 'DAILY' | 'HOURLY'
export type OtKind = 'WORKDAY_OT' | 'HOLIDAY_WORK' | 'HOLIDAY_OT'

export interface OtEntry {
  hours: number
  kind: OtKind
}

export interface PayItem {
  name: string
  amount: number
  taxable: boolean
  ssoable: boolean
}

export interface OtherDeduction {
  name: string
  amount: number
}

export interface TaxAllowances {
  spouse?: number
  children?: number
  lifeInsurance?: number
  other?: number
}

export interface TaxBracket {
  min: number
  max: number | null
  rate: number
}

export interface HrSettings {
  ssoRate: number
  ssoMinBase: number
  ssoMaxBase: number
  ssoIncludesOT: boolean
  workHoursPerDay: number
  daysPerMonthForRate: number
  taxBrackets: TaxBracket[]
  expenseDeductionRate: number
  expenseDeductionCap: number
  personalAllowance: number
  ssoDeductionCapPerYear: number
}

export const DEFAULT_HR_SETTINGS: HrSettings = {
  ssoRate: 0.05,
  ssoMinBase: 1650,
  ssoMaxBase: 17500,
  ssoIncludesOT: true,
  workHoursPerDay: 8,
  daysPerMonthForRate: 30,
  taxBrackets: [
    { min: 0, max: 150000, rate: 0 },
    { min: 150000, max: 300000, rate: 0.05 },
    { min: 300000, max: 500000, rate: 0.10 },
    { min: 500000, max: 750000, rate: 0.15 },
    { min: 750000, max: 1000000, rate: 0.20 },
    { min: 1000000, max: 2000000, rate: 0.25 },
    { min: 2000000, max: 5000000, rate: 0.30 },
    { min: 5000000, max: null, rate: 0.35 },
  ],
  expenseDeductionRate: 0.5,
  expenseDeductionCap: 100000,
  personalAllowance: 60000,
  ssoDeductionCapPerYear: 17500 * 0.05 * 12, // 10,500
}

export interface PayrollCalcInput {
  employmentType: EmploymentType
  baseWage: number
  daysWorked?: number
  hoursWorked?: number
  unpaidLeaveDays?: number
  lateMinutes?: number
  ot?: OtEntry[]
  payItems?: PayItem[]
  otherDeductions?: OtherDeduction[]
  ssoEnrolled?: boolean
  taxAllowances?: TaxAllowances
  settings?: Partial<HrSettings>
}

export interface PayrollSlipLine {
  code: string
  label: string
  amount: number
}

export interface PayrollCalcResult {
  basePay: number
  lateDeduction: number
  otPay: number
  payItemsTotal: number
  gross: number
  ssoBase: number
  ssoEmployee: number
  ssoEmployer: number
  taxableMonthly: number
  wht: number
  otherDeductionsTotal: number
  net: number
  lines: PayrollSlipLine[]
}

const VALID_EMPLOYMENT_TYPES: readonly EmploymentType[] = ['MONTHLY', 'DAILY', 'HOURLY']
const VALID_OT_KINDS: readonly OtKind[] = ['WORKDAY_OT', 'HOLIDAY_WORK', 'HOLIDAY_OT']

/** ปัดทศนิยม 2 ตำแหน่งแบบ half-up (กัน float drift เช่น 1.005 * 100 = 100.49999999999999) */
export const round2 = (n: number): number =>
  n < 0 ? -Math.round((-n + 1e-9) * 100) / 100 : Math.round((n + 1e-9) * 100) / 100

/** ปัดเป็นบาทเต็มแบบ half-up สำหรับประกันสังคม (เช่น 82.5 -> 83) */
export const roundBaht = (n: number): number =>
  n < 0 ? -Math.round(-n + 1e-9) : Math.round(n + 1e-9)

const assertNonNegative = (v: unknown, label: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new Error(`${label}ต้องเป็นตัวเลขไม่ติดลบ`)
  }
  return v
}

/** ตัวคูณค่าล่วงเวลาตาม พ.ร.บ.คุ้มครองแรงงาน ม.61-63 */
export function getOtMultiplier(employmentType: EmploymentType, kind: OtKind): number {
  switch (kind) {
    case 'WORKDAY_OT':
      return 1.5
    case 'HOLIDAY_WORK':
      return employmentType === 'MONTHLY' ? 1 : 2
    case 'HOLIDAY_OT':
      return 3
    default:
      throw new Error(`ประเภทค่าล่วงเวลาไม่ถูกต้อง: ${String(kind)}`)
  }
}

/** คำนวณภาษีเงินได้บุคคลธรรมดาแบบขั้นบันได (ต่อปี) */
export function calcProgressiveTax(
  netTaxableAnnual: number,
  brackets: TaxBracket[] = DEFAULT_HR_SETTINGS.taxBrackets
): number {
  if (netTaxableAnnual <= 0) return 0
  let tax = 0
  for (const b of brackets) {
    if (netTaxableAnnual <= b.min) continue
    const upper = b.max ?? Infinity
    const slice = Math.min(netTaxableAnnual, upper) - b.min
    if (slice > 0) tax += slice * b.rate
  }
  return tax
}

export function calculatePayroll(
  input: PayrollCalcInput,
  settingsOverride?: Partial<HrSettings>
): PayrollCalcResult {
  if (!input || typeof input !== 'object') {
    throw new Error('ข้อมูลคำนวณเงินเดือนไม่ถูกต้อง')
  }
  if (!VALID_EMPLOYMENT_TYPES.includes(input.employmentType)) {
    throw new Error(`ประเภทการจ้างไม่ถูกต้อง: ${String(input.employmentType)}`)
  }

  const merged = { ...DEFAULT_HR_SETTINGS, ...input.settings, ...settingsOverride }
  const explicitCap = settingsOverride?.ssoDeductionCapPerYear ?? input.settings?.ssoDeductionCapPerYear
  const s: HrSettings = {
    ...merged,
    ssoDeductionCapPerYear: explicitCap ?? roundBaht(merged.ssoMaxBase * merged.ssoRate) * 12,
  }

  if (!Number.isFinite(s.workHoursPerDay) || s.workHoursPerDay <= 0) {
    throw new Error('ชั่วโมงทำงานต่อวันต้องมากกว่า 0')
  }
  if (!Number.isFinite(s.daysPerMonthForRate) || s.daysPerMonthForRate <= 0) {
    throw new Error('จำนวนวันต่อเดือนสำหรับคิดอัตราต้องมากกว่า 0')
  }
  assertNonNegative(s.ssoRate, 'อัตราประกันสังคม')
  assertNonNegative(s.ssoMinBase, 'ฐานประกันสังคมขั้นต่ำ')
  assertNonNegative(s.ssoMaxBase, 'ฐานประกันสังคมสูงสุด')
  if (s.ssoMaxBase < s.ssoMinBase) {
    throw new Error('ฐานประกันสังคมสูงสุดต้องไม่น้อยกว่าฐานขั้นต่ำ')
  }

  const baseWage = assertNonNegative(input.baseWage, 'อัตราค่าจ้าง')
  const daysWorked = input.daysWorked !== undefined ? assertNonNegative(input.daysWorked, 'จำนวนวันทำงาน') : 0
  const hoursWorked = input.hoursWorked !== undefined ? assertNonNegative(input.hoursWorked, 'จำนวนชั่วโมงทำงาน') : 0
  const unpaidLeaveDays = input.unpaidLeaveDays !== undefined
    ? assertNonNegative(input.unpaidLeaveDays, 'จำนวนวันลาไม่รับค่าจ้าง')
    : 0
  const lateMinutes = input.lateMinutes !== undefined ? assertNonNegative(input.lateMinutes, 'นาทีมาสาย') : 0

  if (input.employmentType === 'MONTHLY' && unpaidLeaveDays > s.daysPerMonthForRate) {
    throw new Error('จำนวนวันลาไม่รับค่าจ้างเกินจำนวนวันคิดอัตราต่อเดือน')
  }

  const otList = input.ot ?? []
  if (!Array.isArray(otList)) throw new Error('รายการล่วงเวลาไม่ถูกต้อง')
  for (const entry of otList) {
    if (!entry || !VALID_OT_KINDS.includes(entry.kind)) {
      throw new Error(`ประเภทค่าล่วงเวลาไม่ถูกต้อง: ${String(entry?.kind)}`)
    }
    assertNonNegative(entry.hours, 'ชั่วโมงล่วงเวลา')
  }

  const payItems = input.payItems ?? []
  if (!Array.isArray(payItems)) throw new Error('รายการเงินได้ไม่ถูกต้อง')
  for (const item of payItems) {
    if (!item || typeof item.name !== 'string' || !item.name.trim()) {
      throw new Error('รายการเงินได้ต้องระบุชื่อ')
    }
    assertNonNegative(item.amount, `รายการเงินได้ (${item.name}) `)
  }

  const otherDeductions = input.otherDeductions ?? []
  if (!Array.isArray(otherDeductions)) throw new Error('รายการหักอื่นๆ ไม่ถูกต้อง')
  for (const item of otherDeductions) {
    if (!item || typeof item.name !== 'string' || !item.name.trim()) {
      throw new Error('รายการหักอื่นๆ ต้องระบุชื่อ')
    }
    assertNonNegative(item.amount, `รายการหักอื่นๆ (${item.name}) `)
  }

  const taxAllowances = input.taxAllowances ?? {}
  const spouseAllowance = taxAllowances.spouse !== undefined ? assertNonNegative(taxAllowances.spouse, 'ลดหย่อนคู่สมรส') : 0
  const childrenAllowance = taxAllowances.children !== undefined ? assertNonNegative(taxAllowances.children, 'ลดหย่อนบุตร') : 0
  const lifeInsAllowance = taxAllowances.lifeInsurance !== undefined ? assertNonNegative(taxAllowances.lifeInsurance, 'ลดหย่อนประกันชีวิต') : 0
  const otherAllowance = taxAllowances.other !== undefined ? assertNonNegative(taxAllowances.other, 'ลดหย่อนอื่นๆ') : 0

  // 1. อัตราต่อวันและต่อชั่วโมง (ไม่ปัดก่อนคูณ เพื่อไม่ให้เศษสตางค์เพี้ยน เช่น 25 นาที × 50/60 = 20.83)
  const dailyRate = input.employmentType === 'MONTHLY' ? baseWage / s.daysPerMonthForRate : baseWage
  const hourlyRate =
    input.employmentType === 'MONTHLY'
      ? baseWage / s.daysPerMonthForRate / s.workHoursPerDay
      : input.employmentType === 'DAILY'
        ? baseWage / s.workHoursPerDay
        : baseWage

  // 2. ค่าจ้างพื้นฐาน (Base pay)
  const basePay =
    input.employmentType === 'MONTHLY'
      ? round2(baseWage - unpaidLeaveDays * dailyRate)
      : input.employmentType === 'DAILY'
        ? round2(baseWage * daysWorked)
        : round2(baseWage * hoursWorked)

  // 3. หักมาสาย = ค่าจ้างส่วนที่ไม่ได้ทำงาน (พ.ร.บ.คุ้มครองแรงงาน ม.76 ห้ามปรับเป็นเบี้ยปรับ)
  const lateDeduction = round2(lateMinutes * (hourlyRate / 60))

  // 4. ค่าล่วงเวลา (OT)
  const otPay = round2(
    otList.reduce((sum, e) => sum + e.hours * hourlyRate * getOtMultiplier(input.employmentType, e.kind), 0)
  )

  // รายการเงินได้เพิ่มเติม (เบี้ยเลี้ยง/ค่าอาหาร/ค่าเดินทาง)
  const payItemsTotal = round2(payItems.reduce((sum, item) => sum + round2(item.amount), 0))
  const ssoablePayItems = round2(
    payItems.filter(item => item.ssoable).reduce((sum, item) => sum + round2(item.amount), 0)
  )
  const taxablePayItems = round2(
    payItems.filter(item => item.taxable).reduce((sum, item) => sum + round2(item.amount), 0)
  )

  // รายได้รวมก่อนหักมาสาย (gross = basePay + otPay + payItemsTotal)
  const gross = round2(basePay + otPay + payItemsTotal)

  // 5. ประกันสังคม (สปส.)
  const ssoEnrolled = input.ssoEnrolled ?? true
  const rawSsoBase = round2(basePay - lateDeduction + (s.ssoIncludesOT ? otPay : 0) + ssoablePayItems)
  const ssoBase = ssoEnrolled ? Math.min(s.ssoMaxBase, Math.max(s.ssoMinBase, rawSsoBase)) : 0
  const ssoEmployee = ssoEnrolled ? roundBaht(ssoBase * s.ssoRate) : 0
  const ssoEmployer = ssoEmployee

  // 6. เงินได้พึงประเมินรายเดือน
  const taxableMonthly = Math.max(0, round2(basePay - lateDeduction + otPay + taxablePayItems))

  // 7. ภาษีหัก ณ ที่จ่าย ภ.ง.ด.1 (คำนวณแบบประมาณการทั้งปี)
  // ponytail: flat ×12 estimate — switch to YTD actual + remaining-months projection when bonuses/variable pay matter
  const annualIncome = round2(taxableMonthly * 12)
  const expenseDeduction = Math.min(round2(annualIncome * s.expenseDeductionRate), s.expenseDeductionCap)
  const ssoAnnualDeduction = Math.min(ssoEmployee * 12, s.ssoDeductionCapPerYear)
  const totalTaxAllowances = round2(spouseAllowance + childrenAllowance + lifeInsAllowance + otherAllowance)
  const netTaxableAnnual = Math.max(
    0,
    round2(annualIncome - expenseDeduction - s.personalAllowance - ssoAnnualDeduction - totalTaxAllowances)
  )
  const annualTax = calcProgressiveTax(netTaxableAnnual, s.taxBrackets)
  const wht = round2(annualTax / 12)

  // 8. หักอื่นๆ จากเงินเดือนสุทธิ (เบิกล่วงหน้า/เงินกู้ — ไม่ลดฐานภาษีและไม่ลดฐาน สปส.)
  const otherDeductionsTotal = round2(otherDeductions.reduce((sum, item) => sum + round2(item.amount), 0))

  // 9. เงินได้สุทธิและรายการบรรทัดสลิปเงินเดือน
  const net = round2(gross - lateDeduction - ssoEmployee - wht - otherDeductionsTotal)

  const lines: PayrollSlipLine[] = [{ code: 'BASE', label: 'ค่าจ้าง', amount: basePay }]
  if (otPay > 0) {
    lines.push({ code: 'OT', label: 'ค่าล่วงเวลา', amount: otPay })
  }
  for (const item of payItems) {
    const amt = round2(item.amount)
    if (amt > 0) {
      lines.push({ code: 'PAY_ITEM', label: item.name, amount: amt })
    }
  }
  if (lateDeduction > 0) {
    lines.push({ code: 'LATE', label: 'หักมาสาย', amount: -lateDeduction })
  }
  if (ssoEmployee > 0) {
    lines.push({ code: 'SSO', label: 'ประกันสังคม', amount: -ssoEmployee })
  }
  if (wht > 0) {
    lines.push({ code: 'WHT', label: 'ภาษีหัก ณ ที่จ่าย', amount: -wht })
  }
  for (const item of otherDeductions) {
    const amt = round2(item.amount)
    if (amt > 0) {
      lines.push({ code: 'OTHER_DEDUCTION', label: item.name, amount: -amt })
    }
  }

  return {
    basePay,
    lateDeduction,
    otPay,
    payItemsTotal,
    gross,
    ssoBase,
    ssoEmployee,
    ssoEmployer,
    taxableMonthly,
    wht,
    otherDeductionsTotal,
    net,
    lines,
  }
}

export const calcPayroll = calculatePayroll
