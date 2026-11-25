import api from './api'

export interface WorkOrder {
  id: string
  wo_number: string
  bom_id: string | null
  /** สินค้าในคลังที่ผลิต (ใช้เมื่อไม่มี BOM) */
  product_id?: string | null
  product_name: string
  quantity: number
  /** หน่วยของ quantity/completed_qty (R2-UI) — ไม่มีค่า = ใช้หน่วยของสินค้า (WO เก่าก่อน field นี้จะไม่มีค่านี้) */
  unit?: string
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
  inspections?: QCInspectionSummary[]
  sales_order_id?: string | null
  so_number?: string | null
  created_at: string
}

export interface WorkOrderMaterial {
  id: string
  material_id: string | null
  material_name: string
  required_qty: number
  issued_qty: number
  unit: string
  status: string
  // สถานะสต็อกจาก GET /:id (เฉพาะบรรทัดที่ยังไม่เบิก)
  stockStatus?: MaterialCheck['stockStatus']
  stockQty?: number
  stockUnit?: string
  shortQty?: number
  sku?: string
}

export interface MaterialCheck {
  stockStatus: 'ok' | 'short' | 'mismatch' | 'unknown'
  stockQty: number
  stockUnit: string
  needQty: number | null
  shortQty: number
  sku: string
}

export interface MaterialDraft {
  materialId: string
  materialName: string
  requiredQty: number
  unit: string
}

export interface QCInspectionSummary {
  id: string
  checklist_name: string
  status: 'PENDING' | 'PASS' | 'FAIL'
  inspected_qty: number
  passed_qty: number
  rejected_qty: number
  created_at: string
  completed_at: string | null
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

  async bomMaterials(bomId: string, quantity: number, unit?: string): Promise<MaterialDraft[]> {
    const res = await api.get(`/work-orders/bom-materials/${bomId}`, { params: { quantity, unit: unit || undefined } })
    return res.data?.data || []
  },

  async checkMaterials(materials: MaterialDraft[]): Promise<MaterialCheck[]> {
    const res = await api.post('/work-orders/check-materials', { materials })
    return res.data?.data || []
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
