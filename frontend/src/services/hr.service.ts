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
}

export default hrService
