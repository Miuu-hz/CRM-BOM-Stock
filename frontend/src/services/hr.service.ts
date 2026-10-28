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
}

export default hrService
