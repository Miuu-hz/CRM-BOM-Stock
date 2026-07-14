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
  subconStockValue: number
  outsourceMaterialOutstandingCount: number
  overdueAmount: number
}

export interface SubconStockRow {
  id: string
  supplier_id: string
  supplier_name: string
  stock_item_id: string
  item_name: string
  unit: string
  quantity: number
  total_value: number
  updated_at: string
}

export interface SubconStockSummary {
  total_value: number
  by_supplier: Array<{ supplier_id: string; supplier_name: string; value: number; items: number }>
}

export interface SubconMaterialIssue {
  id: string
  issue_number: string
  subcontract_id: string
  stock_item_id: string
  item_name: string
  quantity: number
  unit: string
  unit_cost: number
  total_value: number
  issued_at: string
  issued_by: string
}

export interface SubconReceipt {
  id: string
  receipt_number: string
  subcontract_id: string
  received_qty: number
  scrap_qty: number
  shortage_qty: number
  qc_inspection_id: string | null
  material_reconcile: string
  notes: string
  received_at: string
  received_by: string
}

export interface SubcontractReconcile {
  contract_id: string
  contract_number: string
  status: string
  materials: Array<{
    stock_item_id: string; item_name: string; unit: string
    issued_qty: number; issued_value: number
    consumed_qty: number; returned_qty: number; shortage_qty: number
    outstanding_qty: number
  }>
  pieces: { agreed_qty: number; received_qty: number; scrap_qty: number; shortage_qty: number }
  issues: SubconMaterialIssue[]
  receipts: SubconReceipt[]
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
    contract_type?: 'PIECE_RATE' | 'OUTSOURCE'
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

  // Phase 3: outsource (ส่งผลิตข้างนอก)
  async issueMaterials(id: string, data: { items: Array<{ stock_item_id: string; quantity: number }> }): Promise<any> {
    const res = await api.post(`/subcontracts/${id}/issue-materials`, data)
    return res.data?.data
  },

  async receiveGoods(id: string, data: {
    received_qty: number; scrap_qty: number; shortage_qty: number
    materials: Array<{ stock_item_id: string; consumed_qty: number; returned_qty: number; shortage_qty: number }>
    notes?: string
  }): Promise<any> {
    const res = await api.post(`/subcontracts/${id}/receipts`, data)
    return res.data?.data
  },

  async getReconcile(id: string): Promise<SubcontractReconcile> {
    const res = await api.get(`/subcontracts/${id}/reconcile`)
    return res.data?.data
  },

  async getSubconStock(): Promise<{ rows: SubconStockRow[]; summary: SubconStockSummary }> {
    const res = await api.get('/subcontracts/subcon-stock')
    return { rows: res.data?.data, summary: res.data?.summary }
  },
}

export default subcontractService
