import api from './api'

export type AssetStatus = 'AVAILABLE' | 'LOANED' | 'RETIRED'

export interface CurrentLoan {
  loan_id: string
  employee_id: string
  employee_name: string
  loaned_on: string
}

export interface HrAsset {
  id: string
  code: string
  name: string
  category: string | null
  status: AssetStatus
  notes: string | null
  created_at: string
  current_loan: CurrentLoan | null
}

export interface CreateAssetInput {
  code: string
  name: string
  category?: string | null
  notes?: string | null
}

export interface UpdateAssetInput {
  code?: string
  name?: string
  category?: string | null
  status?: AssetStatus
  notes?: string | null
}

export interface HrAssetLoan {
  id: string
  asset_id: string
  asset_code: string
  asset_name: string
  asset_category: string | null
  employee_id: string
  employee_code: string
  employee_name: string
  loaned_on: string
  returned_on: string | null
  note: string | null
  attachment_count: number
  created_by?: string | null
  created_at: string
}

export interface LoanAssetInput {
  employee_id: string
  loaned_on: string
  note?: string | null
}

export interface ReturnAssetInput {
  returned_on: string
}

export const hrAssetService = {
  async getAssets(params?: { status?: string; q?: string }): Promise<HrAsset[]> {
    const res = await api.get('/hr/assets', { params })
    return res.data.data || []
  },

  async getAsset(id: string): Promise<HrAsset> {
    const res = await api.get(`/hr/assets/${id}`)
    return res.data.data
  },

  async createAsset(data: CreateAssetInput): Promise<HrAsset> {
    const res = await api.post('/hr/assets', data)
    return res.data.data
  },

  async updateAsset(id: string, data: UpdateAssetInput): Promise<HrAsset> {
    const res = await api.put(`/hr/assets/${id}`, data)
    return res.data.data
  },

  async loanAsset(assetId: string, data: LoanAssetInput): Promise<HrAssetLoan> {
    const res = await api.post(`/hr/assets/${assetId}/loan`, data)
    return res.data.data
  },

  async returnAssetLoan(loanId: string, data: ReturnAssetInput): Promise<HrAssetLoan> {
    const res = await api.post(`/hr/asset-loans/${loanId}/return`, data)
    return res.data.data
  },

  async getAssetLoans(assetId: string): Promise<HrAssetLoan[]> {
    const res = await api.get(`/hr/assets/${assetId}/loans`)
    return res.data.data || []
  },

  async getEmployeeAssetLoans(employeeId: string): Promise<HrAssetLoan[]> {
    const res = await api.get(`/hr/employees/${employeeId}/asset-loans`)
    return res.data.data || []
  },

  async getMyAssetLoans(): Promise<HrAssetLoan[]> {
    const res = await api.get('/hr/me/asset-loans')
    return res.data.data || []
  },
}

export default hrAssetService
