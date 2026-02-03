import api from './api'

export interface PurchaseOrder {
  id: string
  po_number: string
  supplier_id: string
  supplier_name?: string
  supplier_code?: string
  status: string
  order_date: string
  expected_date: string | null
  received_date: string | null
  subtotal: number
  tax_rate: number
  tax_amount: number
  total_amount: number
  notes: string
  item_count?: number
  items?: PurchaseOrderItem[]
  created_at: string
}

export interface PurchaseOrderItem {
  id: string
  material_id: string
  description: string
  quantity: number
  unit_price: number
  total_price: number
  received_qty: number
  unit: string
  notes: string
}

export interface POStats {
  totalOrders: number
  draftOrders: number
  pendingOrders: number
  receivedOrders: number
  totalValue: number
}

const purchaseOrderService = {
  async getAll(): Promise<PurchaseOrder[]> {
    const res = await api.get('/purchase-orders')
    return res.data?.data
  },

  async getById(id: string): Promise<PurchaseOrder> {
    const res = await api.get(`/purchase-orders/${id}`)
    return res.data?.data
  },

  async getStats(): Promise<POStats> {
    const res = await api.get('/purchase-orders/stats')
    return res.data?.data
  },

  async create(data: any): Promise<PurchaseOrder> {
    const res = await api.post('/purchase-orders', data)
    return res.data?.data
  },

  async update(id: string, data: any): Promise<PurchaseOrder> {
    const res = await api.put(`/purchase-orders/${id}`, data)
    return res.data?.data
  },

  async updateStatus(id: string, status: string): Promise<PurchaseOrder> {
    const res = await api.put(`/purchase-orders/${id}/status`, { status })
    return res.data?.data
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/purchase-orders/${id}`)
  },
}

export default purchaseOrderService
