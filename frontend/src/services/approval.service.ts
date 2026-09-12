import api from './api'

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'EXECUTED' | 'REJECTED' | 'AUTO'

export interface ApprovalRequest {
  id: string
  request_number: string
  module_type: string
  reference_type: string
  reference_id: string
  reference_number?: string
  requester_name: string
  requester_role: string
  amount: number
  description: string
  status: ApprovalStatus
  approver_1_name?: string
  approver_2_name?: string
  approver_1_at?: string
  approver_2_at?: string
  executed_at?: string
  // /approval/history คำนวณ COALESCE มาให้แล้วเป็น 2 ฟิลด์นี้โดยตรง
  // (/pending, /my-requests คืน ar.* ดิบ ไม่มี 2 ฟิลด์นี้ ต้องประกอบเองจาก approver_1/2_*)
  approver_name?: string
  decided_at?: string
  created_at: string
  updated_at?: string
}

export interface ApprovalHistoryParams {
  from?: string
  to?: string
  moduleType?: string
  status?: string
  requesterId?: string
  limit?: number
  offset?: number
}

// backend คืน payload/before ผสมแบนอยู่ในตัว request เอง ไม่ได้ห่อเป็น { request, payload, before }
// (ดู GET /approval/requests/:id/detail — res.json({ data: { ...request, payload, before } }))
export type ApprovalDetail = ApprovalRequest & {
  payload: Record<string, any> | null
  before: Record<string, any> | null
}

/** ชื่อ+เวลาผู้ตัดสินใจล่าสุด ไม่ว่าจะมาจาก /history (คำนวณให้แล้ว) หรือ /pending, /my-requests (ดิบ) */
export function decidedBy(req: ApprovalRequest): { name?: string; at?: string } {
  return {
    name: req.approver_name || req.approver_2_name || req.approver_1_name,
    at: req.decided_at || req.approver_2_at || req.approver_1_at || req.executed_at,
  }
}

// ponytail: ดึงเอกสารจริงมาโชว์แบบ read-only แทนการยกโค้ด render ของ Purchase.tsx มาใช้ซ้ำ —
// ตัวนั้นผูกกับ state/handler ในไฟล์นั้นแน่นมาก และ Purchase.tsx อยู่นอกขอบเขตที่แก้ได้ในงานนี้
// (เจ้าของ agent อื่นดูแล) จึงเลือกทาง fallback ที่สเปกอนุญาตไว้: ยิง endpoint ที่มีอยู่แล้ว
async function fetchOrNull(url: string) {
  try {
    const res = await api.get(url)
    return res.data?.data ?? null
  } catch {
    return null
  }
}

/** เอกสารต้นทางของคำขอ ใช้แสดงในหน้ารายละเอียด — รองรับ 3 ชนิดที่พบบ่อยที่สุด */
export async function getSourceDocument(referenceType: string, referenceId: string): Promise<any | null> {
  switch (referenceType) {
    case 'purchase_orders':
      return fetchOrNull(`/purchase-orders/${referenceId}`)
    case 'stock_items':
    case 'stock_adjustments':
      return fetchOrNull(`/stock/${referenceId}`)
    case 'pos_running_bills':
      return fetchOrNull(`/pos/bills/${referenceId}`)
    default:
      return null
  }
}

const approvalService = {
  async getPending(): Promise<ApprovalRequest[]> {
    const res = await api.get('/approval/pending').catch(() => ({ data: { data: [] } }))
    return Array.isArray(res.data?.data) ? res.data.data : []
  },

  async getMyRequests(): Promise<ApprovalRequest[]> {
    const res = await api.get('/approval/my-requests').catch(() => ({ data: { data: [] } }))
    return Array.isArray(res.data?.data) ? res.data.data : []
  },

  // endpoint ใหม่ ยังไม่ล่ม backend ระหว่างพัฒนาคู่ขนาน — คืนค่าว่างเงียบๆ ถ้ายัง 404
  async getHistory(params: ApprovalHistoryParams): Promise<{ data: ApprovalRequest[]; total: number }> {
    const res = await api.get('/approval/history', { params }).catch(() => ({ data: { data: [], total: 0 } }))
    return {
      data: Array.isArray(res.data?.data) ? res.data.data : [],
      total: typeof res.data?.total === 'number' ? res.data.total : 0,
    }
  },

  async getDetail(id: string): Promise<ApprovalDetail | null> {
    const res = await api.get(`/approval/requests/${id}/detail`).catch(() => null)
    return res?.data?.data ?? null
  },

  async decide(id: string, decision: 'APPROVED' | 'REJECTED', comment = ''): Promise<void> {
    await api.put(`/approval/requests/${id}/decision`, { decision, comment })
  },

  getSourceDocument,
}

export default approvalService
