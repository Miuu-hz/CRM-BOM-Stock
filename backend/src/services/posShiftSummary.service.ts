import db from '../db/sqlite'
import { thaiDateStr } from '../utils/id'

/**
 * สรุปกะที่เพิ่งปิด สำหรับส่ง LINE ให้ Admin — อ่านอย่างเดียว เรียกหลังปิดกะสำเร็จ
 * ยอดขาย/ลิ้นชักอ่านจากแถว pos_shifts ที่ปิดกะเพิ่งเขียน (ตัวเลขเดียวกับที่ลงบัญชี ไม่คำนวณซ้ำ)
 */
export interface ShiftSummary {
  shiftNumber: string
  shopName: string
  openedAt: string
  closedAt: string
  closedByName: string
  billCount: number
  totalRevenue: number
  cashRevenue: number
  bankRevenue: number
  expectedCash: number
  countedCash: number
  difference: number
  topSales: { name: string; qty: number; amount: number }[]
  buys: { total: number; top: { label: string; sub: string; amount: number }[] }
  alerts: { voids: number; itemVoids: number; discountTotal: number }
}

const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100

export function buildShiftSummary(tenantId: string, shiftId: string): ShiftSummary | null {
  const s = db.prepare(`
    SELECT s.*, u.name AS closed_by_name FROM pos_shifts s
    LEFT JOIN users u ON u.id = s.closed_by
    WHERE s.id = ? AND s.tenant_id = ? AND s.status = 'CLOSED'
  `).get(shiftId, tenantId) as any
  if (!s) return null
  const shop = db.prepare('SELECT name FROM company_settings WHERE tenant_id = ?').get(tenantId) as any

  const topSales = (db.prepare(`
    SELECT bi.product_name AS name, SUM(bi.quantity) AS qty, SUM(bi.total_price) AS amount
    FROM pos_bill_items bi JOIN pos_running_bills b ON b.id = bi.bill_id
    WHERE b.tenant_id = ? AND b.shift_id = ? AND b.status = 'PAID'
    GROUP BY bi.product_name ORDER BY amount DESC LIMIT 5
  `).all(tenantId, shiftId) as any[]).map(r => ({ name: r.name, qty: r2(r.qty), amount: r2(r.amount) }))

  // ฝั่งซื้อ = ใบรับของที่รับในช่วงวันของกะ + ใบสั่งซื้อที่อนุมัติระหว่างกะ (ที่ยังไม่มีใบรับของในรายการ) + เงินออกลิ้นชัก
  // ponytail: มูลค่าใบรับของ = จำนวนรับ × ราคาในใบสั่งซื้อ ไม่รวม VAT/ส่วนลดท้ายบิล — เป็นตัวเลขแจ้งเตือน ไม่ใช่ตัวเลขบัญชี
  const fromDate = thaiDateStr(s.opened_at), toDate = thaiDateStr(s.closed_at)
  const grs = db.prepare(`
    SELECT gr.gr_number, gr.purchase_order_id, sp.name AS supplier,
      COALESCE(SUM(gri.received_qty * poi.unit_price), 0) AS amount
    FROM goods_receipts gr
    LEFT JOIN suppliers sp ON sp.id = gr.supplier_id
    LEFT JOIN goods_receipt_items gri ON gri.goods_receipt_id = gr.id
    LEFT JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id
    WHERE gr.tenant_id = ? AND gr.status = 'CONFIRMED' AND gr.receipt_date BETWEEN ? AND ?
    GROUP BY gr.id
  `).all(tenantId, fromDate, toDate) as any[]
  const receivedPo = new Set(grs.map(g => g.purchase_order_id))
  const pos = (db.prepare(`
    SELECT po.id, po.po_number, po.total_amount AS amount, sp.name AS supplier FROM purchase_orders po
    LEFT JOIN suppliers sp ON sp.id = po.supplier_id
    WHERE po.tenant_id = ? AND po.approved_at BETWEEN ? AND ?
  `).all(tenantId, s.opened_at, s.closed_at) as any[]).filter(p => !receivedPo.has(p.id))
  const paidOut = db.prepare(`
    SELECT reason, amount FROM pos_shift_cash_movements WHERE tenant_id = ? AND shift_id = ? AND type = 'PAID_OUT'
  `).all(tenantId, shiftId) as any[]

  const buyRows = [
    ...grs.map(g => ({ label: `${g.gr_number}${g.supplier ? ` · ${g.supplier}` : ''}`, sub: 'รับของเข้าคลัง', amount: r2(g.amount) })),
    ...pos.map(p => ({ label: `${p.po_number}${p.supplier ? ` · ${p.supplier}` : ''}`, sub: 'ใบสั่งซื้ออนุมัติแล้ว', amount: r2(p.amount) })),
    ...paidOut.map(m => ({ label: m.reason || 'จ่ายออกจากลิ้นชัก', sub: 'เงินออกลิ้นชัก', amount: r2(m.amount) })),
  ].sort((a, b) => b.amount - a.amount)

  const logs = db.prepare(`
    SELECT module_type, status, amount FROM approval_requests
    WHERE tenant_id = ? AND created_at BETWEEN ? AND ?
      AND module_type IN ('pos_void', 'pos_item_void', 'pos_discount') AND status IN ('AUTO', 'APPROVED', 'EXECUTED')
  `).all(tenantId, s.opened_at, s.closed_at) as any[]

  return {
    shiftNumber: s.shift_number,
    shopName: shop?.name || '',
    openedAt: s.opened_at,
    closedAt: s.closed_at,
    closedByName: s.closed_by_name || '',
    billCount: s.bill_count || 0,
    totalRevenue: r2(s.total_revenue),
    cashRevenue: r2(s.cash_revenue),
    bankRevenue: r2(s.bank_revenue),
    expectedCash: r2(s.expected_cash),
    countedCash: r2(s.closing_cash_counted),
    difference: r2(s.cash_difference),
    topSales,
    buys: { total: r2(buyRows.reduce((t, b) => t + b.amount, 0)), top: buyRows.slice(0, 5) },
    alerts: {
      voids: logs.filter(l => l.module_type === 'pos_void').length,
      itemVoids: logs.filter(l => l.module_type === 'pos_item_void').length,
      discountTotal: r2(logs.filter(l => l.module_type === 'pos_discount').reduce((t, l) => t + (l.amount || 0), 0)),
    },
  }
}
