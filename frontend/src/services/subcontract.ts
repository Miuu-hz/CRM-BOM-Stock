import api from './api'

export interface Subcontract {
  id: string
  contract_number: string
  work_order_id: string
  supplier_id: string
  supplier_name: string
  supplier_code?: string
  contract_type: string
  purchase_order_id: string | null
  rate_per_unit: number
  agreed_qty: number
  received_qty: number
  billed_qty: number
  labor_amount: number
  wht_rate: number
  paid_amount: number
  status: string
  due_date: string | null
  notes: string
  created_at: string
  updated_at: string
  wo_number?: string
  wo_product_name?: string
}

export interface SubcontractStats {
  openContracts: number
  outstandingAmount: number
  paidThisMonth: number
}

const subcontractService = {
  async getAll(params?: { work_order_id?: string; status?: string }): Promise<Subcontract[]> {
    const res = await api.get('/subcontracts', { params })
    return res.data?.data
  },

  async getById(id: string): Promise<Subcontract & { journal_entries: any[] }> {
    const res = await api.get(`/subcontracts/${id}`)
    return res.data?.data
  },

  async getStats(): Promise<SubcontractStats> {
    const res = await api.get('/subcontracts/stats')
    return res.data?.data
  },

  async create(data: {
    work_order_id: string
    supplier_id: string
    rate_per_unit: number
    agreed_qty: number
    wht_rate?: number
    due_date?: string
    notes?: string
  }): Promise<Subcontract> {
    const res = await api.post('/subcontracts', data)
    return res.data?.data
  },

  async update(id: string, data: Partial<{
    rate_per_unit: number; agreed_qty: number; due_date: string; notes: string
  }>): Promise<Subcontract> {
    const res = await api.put(`/subcontracts/${id}`, data)
    return res.data?.data
  },

  async pay(id: string, data: { payment_method: 'CASH' | 'BANK'; amount?: number }): Promise<Subcontract> {
    const res = await api.post(`/subcontracts/${id}/pay`, data)
    return res.data?.data
  },

  async cancel(id: string): Promise<void> {
    await api.post(`/subcontracts/${id}/cancel`)
  },
}

export default subcontractService
