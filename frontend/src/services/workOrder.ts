import api from './api'

export interface WorkOrder {
  id: string
  wo_number: string
  bom_id: string | null
  product_name: string
  quantity: number
  completed_qty: number
  scrap_qty: number
  status: string
  priority: string
  start_date: string | null
  due_date: string | null
  completed_date: string | null
  assigned_to: string
  notes: string
  estimated_cost: number
  actual_cost: number
  material_count?: number
  materials?: WorkOrderMaterial[]
  created_at: string
}

export interface WorkOrderMaterial {
  id: string
  material_id: string
  material_name: string
  required_qty: number
  issued_qty: number
  unit: string
  status: string
}

export interface WOStats {
  totalOrders: number
  inProgress: number
  planned: number
  completed: number
  totalProduced: number
}

const workOrderService = {
  async getAll(): Promise<WorkOrder[]> {
    const res = await api.get('/work-orders')
    return res.data?.data
  },

  async getById(id: string): Promise<WorkOrder> {
    const res = await api.get(`/work-orders/${id}`)
    return res.data?.data
  },

  async getStats(): Promise<WOStats> {
    const res = await api.get('/work-orders/stats')
    return res.data?.data
  },

  async create(data: any): Promise<WorkOrder> {
    const res = await api.post('/work-orders', data)
    return res.data?.data
  },

  async update(id: string, data: any): Promise<WorkOrder> {
    const res = await api.put(`/work-orders/${id}`, data)
    return res.data?.data
  },

  async updateStatus(id: string, status: string): Promise<WorkOrder> {
    const res = await api.put(`/work-orders/${id}/status`, { status })
    return res.data?.data
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/work-orders/${id}`)
  },
}

export default workOrderService
