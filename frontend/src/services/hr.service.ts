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
  notes?: string | null
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
}

export default hrService
