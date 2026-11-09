import api from './api'

export type EmploymentType = 'MONTHLY' | 'DAILY' | 'HOURLY'
export type EmployeeStatus = 'ACTIVE' | 'RESIGNED' | 'TERMINATED'
export type BusinessUnit = 'RETAIL' | 'WHOLESALE' | 'ONLINE' | 'OTHER'

export interface OrgUnit {
  id: string
  tenant_id: string
  name: string
  parent_id: string | null
  manager_employee_id: string | null
  manager_first_name?: string | null
  manager_last_name?: string | null
  business_unit: BusinessUnit | null
  is_active: number
  created_at?: string
  updated_at?: string
}

export interface Employee {
  id: string
  tenant_id: string
  code: string
  first_name: string
  last_name?: string | null
  nickname?: string | null
  org_unit_id?: string | null
  org_unit_name?: string | null
  org_business_unit?: BusinessUnit | null
  position?: string | null
  employment_type: EmploymentType
  base_wage?: number
  start_date: string
  end_date?: string | null
  status: EmployeeStatus
  national_id?: string | null
  bank_name?: string | null
  bank_account?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  sso_enrolled: number
  tax_allowances?: string
  user_id?: string | null
  device_pin?: string | null
  shift_id?: string | null
  shift_name?: string | null
  has_checkin_pin?: boolean
  notes?: string | null
  created_at?: string
  updated_at?: string
}

export interface EmployeeInput {
  code?: string
  first_name: string
  last_name?: string | null
  nickname?: string | null
  org_unit_id?: string | null
  position?: string | null
  employment_type: EmploymentType
  base_wage?: number
  start_date: string
  end_date?: string | null
  status?: EmployeeStatus
  national_id?: string | null
  bank_name?: string | null
  bank_account?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  sso_enrolled?: number | boolean
  tax_allowances?: Record<string, any> | string
  user_id?: string | null
  device_pin?: string | null
  shift_id?: string | null
  checkin_pin?: string | null
  notes?: string | null
}

export interface Shift {
  id: string
  tenant_id: string
  name: string
  start_time: string
  end_time: string
  grace_minutes: number
  break_minutes: number
  is_active: number
  created_at?: string
}

export interface ShiftInput {
  name: string
  start_time: string
  end_time: string
  grace_minutes?: number
  break_minutes?: number
  is_active?: number | boolean
}

export interface AttendanceImportResult {
  importId: string
  total: number
  inserted: number
  duplicates: number
  skipped: { line: number; reason: string }[]
  unmappedPins: { pin: string; count: number }[]
}

export interface AttendanceImportRecord {
  id: string
  tenant_id: string
  filename: string
  source: string
  total: number
  inserted: number
  duplicates: number
  skipped: number
  created_by?: string | null
  created_at: string
}
export type AttendanceImportRow = AttendanceImportRecord

export interface UnmappedPin {
  pin: string
  count: number
  first_punch: string
  last_punch: string
}

export interface DaySummary {
  workDate: string
  in?: string
  out?: string
  lateMinutes: number
  earlyLeaveMinutes: number
  workedMinutes: number
  otCandidateMinutes: number
  missingOut: boolean
  absent: boolean
}

export interface PeriodTotals {
  daysWorked: number
  absentDays: number
  lateMinutes: number
  earlyLeaveMinutes: number
  otCandidateMinutes: number
  leaveDays?: number
  holidayDays?: number
}

export interface EmployeeAttendanceSummary extends PeriodTotals {
  employeeId: string
  id: string
  code: string
  first_name: string
  last_name?: string | null
  nickname?: string | null
  name: string
  position?: string | null
  org_unit_id?: string | null
  org_unit_name?: string | null
  device_pin?: string | null
  shift_id: string
  shift_name: string
  employee?: {
    id: string
    code: string
    first_name: string
    last_name?: string | null
    device_pin?: string | null
    shift_id: string
  }
  shift: {
    id: string
    name: string
    start: string
    end: string
    graceMinutes: number
    breakMinutes: number
    start_time?: string
    end_time?: string
  }
  days: DaySummary[]
  totals: PeriodTotals
}
export type AttendanceSummaryEmployee = EmployeeAttendanceSummary

export interface NoShiftEmployee {
  employeeId?: string
  id: string
  code: string
  first_name: string
  last_name?: string | null
  nickname?: string | null
  name?: string
  position?: string | null
  org_unit_name?: string | null
  device_pin?: string | null
}
export type AttendanceNoShiftEmployee = NoShiftEmployee

export interface AttendanceSummaryResult {
  from: string
  to: string
  employees: EmployeeAttendanceSummary[]
  noShift: NoShiftEmployee[]
  unmappedPins?: UnmappedPin[]
}

export interface OrgUnitInput {
  name: string
  parent_id?: string | null
  manager_employee_id?: string | null
  business_unit?: BusinessUnit | null
  is_active?: number | boolean
}

export type OtKind = 'WORKDAY_OT' | 'HOLIDAY_WORK' | 'HOLIDAY_OT'
export type OTKind = OtKind
export type PayItemCalc = 'FIXED' | 'PER_DAY'
export type PayrollRunStatus = 'DRAFT' | 'APPROVED' | 'POSTED' | 'PAID' | 'VOID'

export interface HrSettings {
  ssoRate: number
  ssoMinBase: number
  ssoMaxBase: number
  ssoIncludesOT: boolean
  workHoursPerDay: number
  daysPerMonthForRate: number
  expenseDeductionRate: number
  expenseDeductionCap: number
  personalAllowance: number
  ssoDeductionCapPerYear: number
  /** HR Phase 7 */
  rosterMinStaff?: number
  laborCostTargetPct?: number
  loanInterestRatePct?: number
  taxBrackets?: Array<{ min: number; max: number | null; rate: number }>
}

export type HrSettingsData = HrSettings

export interface PayItemDef {
  id: string
  tenant_id: string
  name: string
  taxable: number
  ssoable: number
  calc: PayItemCalc
  default_amount: number
  is_active: number
  created_at?: string
}

export type PayItem = PayItemDef

export interface EmployeePayItem {
  id?: string
  pay_item_id: string
  amount: number | null
  effective_amount?: number
  name?: string
  taxable?: number
  ssoable?: number
  calc?: PayItemCalc
  default_amount?: number
  is_active?: number
}

export interface OtEntry {
  hours: number
  kind: OtKind
}

export interface ExtraPayItemInput {
  name: string
  amount: number
  taxable: boolean
  ssoable: boolean
}

export interface OtherDeductionInput {
  name: string
  amount: number
}

export interface PayrollLineInputs {
  daysWorked: number
  hoursWorked: number
  unpaidLeaveDays: number
  lateMinutes: number
  ot: OtEntry[]
  extraPayItems: ExtraPayItemInput[]
  otherDeductions: OtherDeductionInput[]
  disabledPayItemIds?: string[]
  advanceDeductions?: AdvanceDeduction[]
}

export type PayrollRunLineInputs = Partial<PayrollLineInputs>

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

export interface PayrollRunLine {
  id: string
  tenant_id: string
  run_id: string
  employee_id: string
  code: string
  employee_code: string
  first_name: string
  last_name: string
  nickname?: string | null
  employee_name: string
  full_name: string
  national_id?: string | null
  employment_type: EmploymentType
  base_wage: number
  sso_enrolled: boolean
  org_unit_id?: string | null
  org_unit_name?: string | null
  business_unit?: string | null
  position?: string | null
  bank_name?: string | null
  bank_account?: string | null
  inputs: PayrollLineInputs
  recurring_pay_items?: Array<{
    pay_item_id: string
    name: string
    calc: PayItemCalc
    rate: number
    taxable: boolean
    ssoable: boolean
  }>
  result: PayrollCalcResult
  base_pay: number
  ot_pay: number
  pay_items_total: number
  sso_base: number
  taxable_monthly: number
  gross: number
  late: number
  sso_employee: number
  sso_employer: number
  wht: number
  other_deduction: number
  advance_deduction?: number
  net: number
  period?: string
  status?: PayrollRunStatus
  pay_date?: string | null
}

export interface PayrollRunTotals {
  employee_count: number
  base_pay?: number
  ot_pay?: number
  pay_items_total?: number
  gross: number
  late: number
  sso_employee: number
  sso_employer: number
  wht: number
  other_deduction: number
  net: number
}

export interface PayrollRun {
  id: string
  tenant_id: string
  period: string
  status: PayrollRunStatus
  pay_date?: string | null
  pay_account_id?: string | null
  other_deduction_account_id?: string | null
  accrual_je_ids: string[]
  payment_je_id?: string | null
  created_by?: string | null
  approved_by?: string | null
  approved_at?: string | null
  posted_at?: string | null
  created_at?: string
  updated_at?: string
  lines?: PayrollRunLine[]
  totals: PayrollRunTotals
  warnings?: string[]
}

export interface Pnd1ExportResponse {
  period: string
  run_id: string | null
  status: string | null
  pay_date: string | null
  rows: Array<{
    employee_id: string
    employee_code: string
    national_id: string
    name: string
    income: number
    gross: number
    wht: number
  }>
  totals: {
    employee_count: number
    income: number
    gross: number
    wht: number
  }
}

// ==================== HR Phase 4 — สัญญากลาง docs/contracts/hr-phase4.md (ห้ามแก้รูปร่างโดยไม่แก้สัญญา) ====================
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export interface LeaveType {
  id: string
  code: string
  name: string
  paid: boolean
  days_per_year: number | null
  is_active: boolean
}

export interface LeaveTypeInput {
  code: string
  name: string
  paid: boolean
  days_per_year: number | null
  is_active?: boolean
}

export interface LeaveRequest {
  id: string
  employee_id: string
  employee_code: string
  employee_name: string
  org_unit_name: string | null
  leave_type_id: string
  leave_type_code: string
  leave_type_name: string
  paid: boolean
  start_date: string
  end_date: string
  days: number
  reason: string | null
  status: LeaveStatus
  approval_request_id: string | null
  requested_by: string | null
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

export interface LeaveRequestInput {
  employee_id: string
  leave_type_id: string
  start_date: string
  end_date: string
  days: number
  reason?: string
}

export interface LeaveBalance {
  leave_type_id: string
  code: string
  name: string
  paid: boolean
  quota: number | null
  used: number
  pending: number
  remaining: number | null
}

export interface PublicHoliday {
  id: string
  date: string
  name: string
}

export interface CheckinLocation {
  lat: number
  lng: number
  radius_m: number
}

export interface CheckinGeo {
  lat?: number
  lng?: number
  accuracy?: number
}

export interface CheckinPinInput extends CheckinGeo {
  employee_code: string
  pin: string
}

export interface CheckinResult {
  punched_at: string
  kind: 'IN' | 'OUT'
  employee_name: string
  distance_m: number | null
}

export interface MyAttendanceLog {
  punched_at: string
  source: 'FILE' | 'MCP' | 'WEB' | 'DEVICE'
  distance_m: number | null
}

export interface MyAttendance {
  employee: { id: string; code: string; name: string; device_pin: string | null; shift_name: string | null }
  logs: MyAttendanceLog[]
  days: DaySummary[]
  totals: PeriodTotals | null
}

// ==================== HR Phase 5-6 — สัญญากลาง docs/contracts/hr-phase5-6.md (ห้ามแก้รูปร่างโดยไม่แก้สัญญา) ====================
export type TrainingKind = 'INTERNAL' | 'EXTERNAL'

export interface TrainingCourse {
  id: string
  name: string
  kind: TrainingKind
  mandatory: boolean
  validity_months: number | null
  is_active: boolean
  record_count: number
}

export interface TrainingCourseInput {
  name: string
  kind: TrainingKind
  mandatory: boolean
  validity_months: number | null
  is_active?: boolean
}

export interface TrainingRecord {
  id: string
  course_id: string
  course_name: string
  course_kind: TrainingKind
  employee_id: string
  employee_code: string
  employee_name: string
  trained_on: string
  expires_on: string | null
  provider: string | null
  notes: string | null
  days_left: number | null
  attachment_count: number
  created_at: string
}

export interface TrainingRecordInput {
  course_id: string
  employee_ids: string[]
  trained_on: string
  expires_on?: string | null
  provider?: string | null
  notes?: string | null
}

export interface TrainingRecordUpdate {
  trained_on?: string
  expires_on?: string | null
  provider?: string | null
  notes?: string | null
}

export type AdvanceKind = 'ADVANCE' | 'LOAN'
export type AdvanceStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'ACTIVE' | 'CLOSED'

export interface EmployeeAdvance {
  id: string
  employee_id: string
  employee_code: string
  employee_name: string
  kind: AdvanceKind
  amount: number
  installments: number
  installment_amount: number
  /** HR Phase 7: ดอกเบี้ย % ต่อปี (ADVANCE = 0) และดอกเบี้ยรวมทั้งสัญญา — outstanding รวมดอกเบี้ยแล้ว */
  interest_rate: number
  interest_amount: number
  start_period: string
  reason: string | null
  status: AdvanceStatus
  approval_request_id: string | null
  decided_at: string | null
  disbursed_on: string | null
  disburse_je_id: string | null
  repaid: number
  outstanding: number
  created_at: string
}

export interface AdvanceRepayment {
  /** source CASH: run_id = id ของ JE รับเงิน */
  run_id: string
  period: string
  amount: number
  interest: number
  source: 'PAYROLL' | 'CASH'
  created_at: string
}

export interface EmployeeAdvanceDetail extends EmployeeAdvance {
  repayments: AdvanceRepayment[]
}

export interface AdvanceInput {
  employee_id: string
  kind: AdvanceKind
  amount: number
  installments?: number
  start_period: string
  reason?: string
  /** HR เท่านั้น, LOAN เท่านั้น, 0–15 · ไม่ส่ง = ค่าตั้งต้น hr_settings.loanInterestRatePct */
  interest_rate?: number
}

export type MyAdvanceInput = Omit<AdvanceInput, 'employee_id' | 'interest_rate'>

export interface AdvanceRepayCashInput {
  amount: number
  date: string
  pay_account_id: string
}

// ==================== HR Phase 7 — สัญญากลาง docs/contracts/hr-phase7.md (ห้ามแก้รูปร่างโดยไม่แก้สัญญา) ====================

export interface RosterShift {
  id: string
  name: string
  start_time: string
  end_time: string
  grace_minutes: number
  break_minutes: number
  is_active: number
  hours: number
}

export interface RosterCell {
  date: string
  /** null = วันหยุด (ASSIGNED) หรือไม่มีกะ (NONE) */
  shift_id: string | null
  source: 'ASSIGNED' | 'DEFAULT' | 'NONE'
  on_leave: boolean
  holiday: boolean
}

export interface RosterEmployeeRow {
  id: string
  code: string
  name: string
  org_unit_name: string | null
  employment_type: EmploymentType
  default_shift_id: string | null
  cells: RosterCell[]
  hours: number
  labor_cost: number
  warnings: string[]
}

export interface RosterDay {
  date: string
  staff: number
  labor_cost: number
  avg_sales: number | null
  labor_pct: number | null
  warnings: string[]
}

export interface RosterWeek {
  week_start: string
  dates: string[]
  shifts: RosterShift[]
  employees: RosterEmployeeRow[]
  days: RosterDay[]
  settings: { rosterMinStaff: number; laborCostTargetPct: number }
}

export interface RosterAssignmentInput {
  employee_id: string
  work_date: string
  /** null = วันหยุด */
  shift_id: string | null
  /** true = ลบแถว กลับไปใช้กะประจำ (ไม่สน shift_id) */
  clear?: boolean
}

export interface MyRosterDay {
  date: string
  shift: RosterShift | null
  source: 'ASSIGNED' | 'DEFAULT' | 'NONE'
  on_leave: boolean
  holiday: boolean
}

export interface MyRosterWeek {
  week_start: string
  employee_id: string
  days: MyRosterDay[]
}

export interface ColleagueShift {
  employee_id: string
  name: string
  org_unit_name: string | null
  shift: RosterShift | null
}

export type ShiftSwapStatus = 'PEER_PENDING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'DECLINED' | 'CANCELLED'

export interface ShiftSwap {
  id: string
  work_date: string
  requester_employee_id: string
  requester_name: string
  target_employee_id: string
  target_name: string
  /** กะที่มีผลตอนนี้ของแต่ละคนในวันนั้น (หลังอนุมัติจะสลับกันแล้ว) */
  requester_shift: RosterShift | null
  target_shift: RosterShift | null
  reason: string | null
  status: ShiftSwapStatus
  approval_request_id: string | null
  created_at: string
}

export interface ShiftSwapInput {
  target_employee_id: string
  work_date: string
  reason?: string
}

export interface AdvanceDisburseInput {
  pay_account_id: string
  date: string
}

export interface AdvanceDeduction {
  advance_id: string
  kind: AdvanceKind
  name: string
  amount: number
}

export const hrService = {
  async getOrgUnits(): Promise<OrgUnit[]> {
    const res = await api.get('/hr/org-units')
    return res.data.data || []
  },

  async createOrgUnit(data: OrgUnitInput): Promise<OrgUnit> {
    const res = await api.post('/hr/org-units', data)
    return res.data.data
  },

  async updateOrgUnit(id: string, data: Partial<OrgUnitInput>): Promise<OrgUnit> {
    const res = await api.put(`/hr/org-units/${id}`, data)
    return res.data.data
  },

  async deleteOrgUnit(id: string): Promise<void> {
    await api.delete(`/hr/org-units/${id}`)
  },

  async getEmployees(params?: { status?: string; org_unit_id?: string; q?: string }): Promise<Employee[]> {
    const res = await api.get('/hr/employees', { params })
    return res.data.data || []
  },

  async getEmployee(id: string): Promise<Employee> {
    const res = await api.get(`/hr/employees/${id}`)
    return res.data.data
  },

  async createEmployee(data: EmployeeInput): Promise<Employee> {
    const res = await api.post('/hr/employees', data)
    return res.data.data
  },

  async updateEmployee(id: string, data: Partial<EmployeeInput>): Promise<Employee> {
    const res = await api.put(`/hr/employees/${id}`, data)
    return res.data.data
  },

  async offboardEmployee(id: string, data: { end_date: string; status: 'RESIGNED' | 'TERMINATED' }): Promise<Employee> {
    const res = await api.post(`/hr/employees/${id}/offboard`, data)
    return res.data.data
  },

  async getMe(): Promise<Employee> {
    const res = await api.get('/hr/me')
    return res.data.data
  },

  async getShifts(): Promise<Shift[]> {
    const res = await api.get('/hr/shifts')
    return res.data.data || []
  },

  async createShift(data: ShiftInput): Promise<Shift> {
    const res = await api.post('/hr/shifts', data)
    return res.data.data
  },

  async updateShift(id: string, data: Partial<ShiftInput>): Promise<Shift> {
    const res = await api.put(`/hr/shifts/${id}`, data)
    return res.data.data
  },

  async importAttendance(data: { filename: string; content: string }): Promise<AttendanceImportResult> {
    const res = await api.post('/hr/attendance/import', data)
    return res.data.data || res.data
  },

  async getAttendanceImports(): Promise<AttendanceImportRecord[]> {
    const res = await api.get('/hr/attendance/imports')
    return res.data.data || []
  },

  async getUnmappedPins(): Promise<UnmappedPin[]> {
    const res = await api.get('/hr/attendance/unmapped')
    return res.data.data || []
  },

  async getAttendanceSummary(params: {
    from: string
    to: string
    employee_id?: string
  }): Promise<AttendanceSummaryResult> {
    const res = await api.get('/hr/attendance/summary', { params })
    return res.data.data || res.data
  },

  async getAttendanceLogs(params?: {
    from?: string
    to?: string
    pin?: string
    limit?: number
    offset?: number
  }): Promise<{ data: any[]; total: number }> {
    const res = await api.get('/hr/attendance/logs', { params })
    return { data: res.data.data || [], total: res.data.total || 0 }
  },

  async getSettings(): Promise<HrSettings> {
    const res = await api.get('/hr/settings')
    return res.data
  },

  async updateSettings(data: Partial<HrSettings>): Promise<HrSettings> {
    const res = await api.put('/hr/settings', data)
    return res.data
  },

  async getPayItems(): Promise<PayItemDef[]> {
    const res = await api.get('/hr/pay-items')
    return res.data || []
  },

  async createPayItem(data: Partial<PayItemDef>): Promise<PayItemDef> {
    const res = await api.post('/hr/pay-items', data)
    return res.data
  },

  async updatePayItem(id: string, data: Partial<PayItemDef>): Promise<PayItemDef> {
    const res = await api.put(`/hr/pay-items/${id}`, data)
    return res.data
  },

  async createStarterPayItems(): Promise<PayItemDef[]> {
    const res = await api.post('/hr/pay-items/starter', {})
    return res.data || []
  },

  async getEmployeePayItems(employeeId: string): Promise<EmployeePayItem[]> {
    const res = await api.get(`/hr/employees/${employeeId}/pay-items`)
    return res.data || []
  },

  async updateEmployeePayItems(
    employeeId: string,
    items: Array<{ pay_item_id: string; amount: number | null }>
  ): Promise<EmployeePayItem[]> {
    const res = await api.put(`/hr/employees/${employeeId}/pay-items`, items)
    return res.data || []
  },

  async getPayrollRuns(): Promise<PayrollRun[]> {
    const res = await api.get('/hr/payroll-runs')
    return res.data || []
  },

  async createPayrollRun(period: string): Promise<PayrollRun> {
    const res = await api.post('/hr/payroll-runs', { period })
    return res.data
  },

  async getPayrollRun(id: string): Promise<PayrollRun> {
    const res = await api.get(`/hr/payroll-runs/${id}`)
    return res.data
  },

  async updatePayrollRunLine(runId: string, lineId: string, inputs: Partial<PayrollLineInputs>): Promise<PayrollRunLine> {
    const res = await api.put(`/hr/payroll-runs/${runId}/lines/${lineId}`, inputs)
    return res.data
  },

  async approvePayrollRun(id: string): Promise<PayrollRun> {
    const res = await api.post(`/hr/payroll-runs/${id}/approve`, {})
    return res.data
  },

  async postPayrollRun(
    id: string,
    payload: { payDate: string; payAccountId: string; otherDeductionAccountId?: string; payNow?: boolean }
  ): Promise<PayrollRun> {
    const res = await api.post(`/hr/payroll-runs/${id}/post`, payload)
    return res.data
  },

  async payPayrollRun(id: string, payload?: { payDate?: string; payAccountId?: string }): Promise<PayrollRun> {
    const res = await api.post(`/hr/payroll-runs/${id}/pay`, payload || {})
    return res.data
  },

  async voidPayrollRun(id: string, reason?: string): Promise<PayrollRun> {
    const res = await api.post(`/hr/payroll-runs/${id}/void`, { reason })
    return res.data
  },

  async deletePayrollRun(id: string): Promise<void> {
    await api.delete(`/hr/payroll-runs/${id}`)
  },

  async getRunSlips(id: string): Promise<{ run_id: string; period: string; status: string; pay_date: string | null; slips: PayrollRunLine[]; run?: { period: string; pay_date: string | null } }> {
    const res = await api.get(`/hr/payroll-runs/${id}/slips`)
    return res.data
  },

  async getPayrollRunSlips(id: string): Promise<{ run_id: string; period: string; status: string; pay_date: string | null; slips: PayrollRunLine[]; run?: { period: string; pay_date: string | null } }> {
    return this.getRunSlips(id)
  },

  async getMySlips(): Promise<PayrollRunLine[]> {
    const res = await api.get('/hr/me/slips')
    return res.data || []
  },

  async exportSsoCsv(runId: string): Promise<string> {
    const res = await api.get(`/hr/payroll-runs/${runId}/export/sso`, { responseType: 'text' })
    return res.data
  },

  async getPnd1(period: string): Promise<Pnd1ExportResponse> {
    const res = await api.get('/hr/payroll-runs/tax/pnd1', { params: { period } })
    return res.data
  },

  async exportPnd1Csv(period: string): Promise<string> {
    const res = await api.get('/hr/payroll-runs/tax/pnd1', {
      params: { period, format: 'csv' },
      responseType: 'text',
    })
    return res.data
  },

  async getPnd1Csv(period: string): Promise<string> {
    return this.exportPnd1Csv(period)
  },
  // ---------- HR Phase 4 (สัญญากลาง docs/contracts/hr-phase4.md) ----------
  async getLeaveTypes(params?: { active?: 1 }): Promise<LeaveType[]> {
    const res = await api.get('/hr/leave-types', { params })
    return res.data.data || []
  },

  async createLeaveType(data: LeaveTypeInput): Promise<LeaveType> {
    const res = await api.post('/hr/leave-types', data)
    return res.data.data
  },

  async updateLeaveType(id: string, data: Partial<LeaveTypeInput>): Promise<LeaveType> {
    const res = await api.put(`/hr/leave-types/${id}`, data)
    return res.data.data
  },

  async createStarterLeaveTypes(): Promise<{ created: number }> {
    const res = await api.post('/hr/leave-types/starter')
    return res.data.data
  },

  async getHolidays(year?: number): Promise<PublicHoliday[]> {
    const res = await api.get('/hr/holidays', { params: year ? { year } : undefined })
    return res.data.data || []
  },

  async createHoliday(data: { date: string; name: string }): Promise<PublicHoliday> {
    const res = await api.post('/hr/holidays', data)
    return res.data.data
  },

  async deleteHoliday(id: string): Promise<void> {
    await api.delete(`/hr/holidays/${id}`)
  },

  async getLeaveRequests(params?: { status?: LeaveStatus; employee_id?: string; from?: string; to?: string }): Promise<LeaveRequest[]> {
    const res = await api.get('/hr/leave-requests', { params })
    return res.data.data || []
  },

  async createLeaveRequest(data: LeaveRequestInput): Promise<LeaveRequest> {
    const res = await api.post('/hr/leave-requests', data)
    return res.data.data
  },

  async cancelLeaveRequest(id: string): Promise<LeaveRequest> {
    const res = await api.post(`/hr/leave-requests/${id}/cancel`)
    return res.data.data
  },

  async getLeaveBalances(params: { employee_id: string; year?: number }): Promise<LeaveBalance[]> {
    const res = await api.get('/hr/leave-balances', { params })
    return res.data.data || []
  },

  async getCheckinLocation(): Promise<CheckinLocation | null> {
    const res = await api.get('/hr/checkin/location')
    return res.data.data ?? null
  },

  async setCheckinLocation(data: CheckinLocation | null): Promise<CheckinLocation | null> {
    const res = await api.put('/hr/checkin/location', data)
    return res.data.data ?? null
  },

  async checkin(geo: CheckinGeo): Promise<CheckinResult> {
    const res = await api.post('/hr/checkin', geo)
    return res.data.data
  },

  async checkinWithPin(data: CheckinPinInput): Promise<CheckinResult> {
    const res = await api.post('/hr/checkin/pin', data)
    return res.data.data
  },

  async getMyAttendance(params?: { from?: string; to?: string }): Promise<MyAttendance> {
    const res = await api.get('/hr/me/attendance', { params })
    return res.data.data
  },
  // ---------- HR Phase 5-6 (สัญญากลาง docs/contracts/hr-phase5-6.md) ----------
  async getTrainingCourses(params?: { active?: 1 }): Promise<TrainingCourse[]> {
    const res = await api.get('/hr/training/courses', { params })
    return res.data.data || []
  },

  async createTrainingCourse(data: TrainingCourseInput): Promise<TrainingCourse> {
    const res = await api.post('/hr/training/courses', data)
    return res.data.data
  },

  async updateTrainingCourse(id: string, data: Partial<TrainingCourseInput>): Promise<TrainingCourse> {
    const res = await api.put(`/hr/training/courses/${id}`, data)
    return res.data.data
  },

  async getTrainingRecords(params?: { employee_id?: string; course_id?: string }): Promise<TrainingRecord[]> {
    const res = await api.get('/hr/training/records', { params })
    return res.data.data || []
  },

  async createTrainingRecords(data: TrainingRecordInput): Promise<TrainingRecord[]> {
    const res = await api.post('/hr/training/records', data)
    return res.data.data || []
  },

  async updateTrainingRecord(id: string, data: TrainingRecordUpdate): Promise<TrainingRecord> {
    const res = await api.put(`/hr/training/records/${id}`, data)
    return res.data.data
  },

  async deleteTrainingRecord(id: string): Promise<void> {
    await api.delete(`/hr/training/records/${id}`)
  },

  async getExpiringTraining(days = 60): Promise<TrainingRecord[]> {
    const res = await api.get('/hr/training/expiring', { params: { days } })
    return res.data.data || []
  },

  async getMyTraining(): Promise<TrainingRecord[]> {
    const res = await api.get('/hr/me/training')
    return res.data.data || []
  },

  async getAdvances(params?: { employee_id?: string; status?: AdvanceStatus }): Promise<EmployeeAdvance[]> {
    const res = await api.get('/hr/advances', { params })
    return res.data.data || []
  },

  async getAdvance(id: string): Promise<EmployeeAdvanceDetail> {
    const res = await api.get(`/hr/advances/${id}`)
    return res.data.data
  },

  async createAdvance(data: AdvanceInput): Promise<EmployeeAdvance> {
    const res = await api.post('/hr/advances', data)
    return res.data.data
  },

  async getMyAdvances(): Promise<EmployeeAdvance[]> {
    const res = await api.get('/hr/me/advances')
    return res.data.data || []
  },

  async createMyAdvance(data: MyAdvanceInput): Promise<EmployeeAdvance> {
    const res = await api.post('/hr/me/advances', data)
    return res.data.data
  },

  async cancelAdvance(id: string): Promise<EmployeeAdvance> {
    const res = await api.post(`/hr/advances/${id}/cancel`)
    return res.data.data
  },

  async disburseAdvance(id: string, data: AdvanceDisburseInput): Promise<EmployeeAdvance> {
    const res = await api.post(`/hr/advances/${id}/disburse`, data)
    return res.data.data
  },

  // ---------- HR Phase 7 (สัญญากลาง docs/contracts/hr-phase7.md) ----------
  async repayCashAdvance(id: string, data: AdvanceRepayCashInput): Promise<EmployeeAdvanceDetail> {
    const res = await api.post(`/hr/advances/${id}/repay-cash`, data)
    return res.data.data
  },

  async getRoster(weekStart: string): Promise<RosterWeek> {
    const res = await api.get('/hr/roster', { params: { week_start: weekStart } })
    return res.data.data
  },

  async saveRosterAssignments(items: RosterAssignmentInput[]): Promise<{ updated: number; cleared: number }> {
    const res = await api.put('/hr/roster/assignments', { items })
    return res.data.data
  },

  async copyRosterWeek(fromWeekStart: string, toWeekStart: string, overwrite = false): Promise<{ copied: number; skipped: number }> {
    const res = await api.post('/hr/roster/copy', { from_week_start: fromWeekStart, to_week_start: toWeekStart, overwrite })
    return res.data.data
  },

  async getMyRoster(weekStart: string): Promise<MyRosterWeek> {
    const res = await api.get('/hr/me/roster', { params: { week_start: weekStart } })
    return res.data.data
  },

  async getColleagueShifts(date: string): Promise<ColleagueShift[]> {
    const res = await api.get('/hr/me/roster/day', { params: { date } })
    return res.data.data || []
  },

  async getMyShiftSwaps(): Promise<ShiftSwap[]> {
    const res = await api.get('/hr/me/shift-swaps')
    return res.data.data || []
  },

  async createShiftSwap(data: ShiftSwapInput): Promise<ShiftSwap> {
    const res = await api.post('/hr/me/shift-swaps', data)
    return res.data.data
  },

  async acceptShiftSwap(id: string): Promise<ShiftSwap> {
    const res = await api.post(`/hr/me/shift-swaps/${id}/accept`)
    return res.data.data
  },

  async declineShiftSwap(id: string): Promise<ShiftSwap> {
    const res = await api.post(`/hr/me/shift-swaps/${id}/decline`)
    return res.data.data
  },

  async cancelShiftSwap(id: string): Promise<ShiftSwap> {
    const res = await api.post(`/hr/shift-swaps/${id}/cancel`)
    return res.data.data
  },

  async getShiftSwaps(status?: ShiftSwapStatus): Promise<ShiftSwap[]> {
    const res = await api.get('/hr/shift-swaps', { params: status ? { status } : {} })
    return res.data.data || []
  },
}

export default hrService
