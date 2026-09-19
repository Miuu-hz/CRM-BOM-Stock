import { Router, Request, Response } from 'express'
import db from '../db/sqlite'

const router = Router()

// ============================================================
// GET /journal/:id/source — เอกสารต้นทางของรายการสมุดรายวันหนึ่งใบ
// ------------------------------------------------------------
// คนทำบัญชีเห็นแต่ Dr/Cr กับคำอธิบายสั้น ๆ แล้วตัดสินใจไม่ได้ว่ารายการนี้ถูกหรือเปล่า
// ต้องเห็นตัวเอกสาร: เลขที่ วันที่ คู่กรณี รายการสินค้า หมายเหตุ และสลิปที่แนบไว้
//
// คืน refs ของไฟล์แนบเป็นรายการ (refType + refId) ให้หน้าจอไปเรียก /attachments/:refType/:refId
// เอง — endpoint นั้นมีสิทธิ์และ subscription gate ของมันอยู่แล้ว ไม่ต้องทำซ้ำที่นี่
// ============================================================

interface SourceDoc {
  kind: string
  docNumber: string | null
  docDate: string | null
  partyLabel: string | null
  party: string | null
  notes: string | null
  amounts: { subtotal?: number; tax?: number; total?: number; paid?: number; balance?: number } | null
  extra: { label: string; value: string }[]
  items: { name: string; quantity?: number; unit?: string; unitPrice?: number; total?: number }[]
  attachments: { refType: string; refId: string; label: string }[]
  /** หน้าที่ควรกดไปดูต่อ — frontend เอาไปทำลิงก์ */
  route: string | null
}

const empty = (kind: string): SourceDoc => ({
  kind, docNumber: null, docDate: null, partyLabel: null, party: null, notes: null,
  amounts: null, extra: [], items: [], attachments: [], route: null,
})

router.get('/:id/source', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ? AND tenant_id = ?')
      .get(req.params.id, tenantId) as any
    if (!entry) return res.status(404).json({ success: false, message: 'ไม่พบรายการสมุดรายวัน' })

    const refId: string | null = entry.reference_id || null
    const kind: string = entry.reference_type || 'MANUAL'
    if (!refId) return res.json({ success: true, data: null })

    const one = (sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any
    const many = (sql: string, ...args: any[]) => db.prepare(sql).all(...args) as any[]
    const out = empty(kind)

    if (kind === 'INVOICE') {
      const inv = one(`SELECT i.*, c.name AS customer_name FROM invoices i
                       LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
                       WHERE i.id = ? AND i.tenant_id = ?`, refId, tenantId)
      if (!inv) return res.json({ success: true, data: null })
      out.docNumber = inv.invoice_number
      out.docDate = inv.invoice_date
      out.partyLabel = 'ลูกค้า'
      out.party = inv.customer_name
      out.notes = inv.notes || null
      out.amounts = { subtotal: inv.subtotal, tax: inv.tax_amount, total: inv.total_amount, paid: inv.paid_amount, balance: inv.balance_amount }
      out.extra = [
        { label: 'ครบกำหนด', value: inv.due_date ? String(inv.due_date).slice(0, 10) : '-' },
        { label: 'สถานะชำระ', value: inv.payment_status || '-' },
      ]
      out.items = many('SELECT product_name, quantity, unit_price, total_price FROM invoice_items WHERE invoice_id = ?', refId)
        .map(r => ({ name: r.product_name, quantity: r.quantity, unitPrice: r.unit_price, total: r.total_price }))
      out.attachments = [{ refType: 'INVOICE', refId, label: 'แนบกับใบแจ้งหนี้' }]
      for (const rc of many('SELECT id, receipt_number FROM receipts WHERE invoice_id = ? AND tenant_id = ?', refId, tenantId)) {
        out.attachments.push({ refType: 'RECEIPT', refId: rc.id, label: `สลิปรับชำระ ${rc.receipt_number || ''}`.trim() })
      }
      out.route = '/sales'

    } else if (kind === 'PAYMENT') {
      const rc = one(`SELECT r.*, c.name AS customer_name, i.invoice_number FROM receipts r
                      LEFT JOIN customers c ON c.id = r.customer_id AND c.tenant_id = r.tenant_id
                      LEFT JOIN invoices i ON i.id = r.invoice_id AND i.tenant_id = r.tenant_id
                      WHERE r.id = ? AND r.tenant_id = ?`, refId, tenantId)
      if (!rc) return res.json({ success: true, data: null })
      out.docNumber = rc.receipt_number
      out.docDate = rc.receipt_date
      out.partyLabel = 'ลูกค้า'
      out.party = rc.customer_name
      out.notes = rc.notes || null
      out.amounts = { total: rc.amount }
      out.extra = [
        { label: 'ช่องทาง', value: rc.payment_method || '-' },
        { label: 'อ้างอิง', value: rc.payment_reference || '-' },
        { label: 'ใบแจ้งหนี้', value: rc.invoice_number || '-' },
      ]
      out.attachments = [{ refType: 'RECEIPT', refId, label: 'สลิปรับชำระ' }]
      out.route = '/sales'

    } else if (kind === 'PURCHASE_INVOICE') {
      const pi = one(`SELECT pi.*, s.name AS supplier_name, po.po_number FROM purchase_invoices pi
                      LEFT JOIN suppliers s ON s.id = pi.supplier_id AND s.tenant_id = pi.tenant_id
                      LEFT JOIN purchase_orders po ON po.id = pi.purchase_order_id AND po.tenant_id = pi.tenant_id
                      WHERE pi.id = ? AND pi.tenant_id = ?`, refId, tenantId)
      if (!pi) return res.json({ success: true, data: null })
      out.docNumber = pi.pi_number
      out.docDate = pi.invoice_date
      out.partyLabel = 'ผู้ขาย'
      out.party = pi.supplier_name
      out.notes = pi.notes || null
      out.amounts = { subtotal: pi.subtotal, tax: pi.tax_amount, total: pi.total_amount, paid: pi.paid_amount, balance: pi.balance_amount }
      out.extra = [
        { label: 'เลขที่บิลผู้ขาย', value: pi.supplier_invoice_number || '-' },
        { label: 'ใบสั่งซื้อ', value: pi.po_number || '-' },
        { label: 'ครบกำหนด', value: pi.due_date ? String(pi.due_date).slice(0, 10) : '-' },
      ]
      out.items = many(`SELECT COALESCE(si.name, poi.description, 'ไม่ระบุ') AS name, pii.quantity, pii.unit_price, pii.total_price, poi.unit
                        FROM purchase_invoice_items pii
                        LEFT JOIN stock_items si ON si.id = pii.material_id
                        LEFT JOIN purchase_order_items poi ON poi.id = pii.purchase_order_item_id
                        WHERE pii.purchase_invoice_id = ?`, refId)
        .map(r => ({ name: r.name, quantity: r.quantity, unit: r.unit, unitPrice: r.unit_price, total: r.total_price }))
      out.attachments = [{ refType: 'PURCHASE_INVOICE', refId, label: 'บิล/ใบกำกับจากผู้ขาย' }]
      // ใบรับสินค้าที่บิลนี้อ้างถึง — รูปของตอนรับมักอยู่ที่นั่น ไม่ได้อยู่กับบิล
      let grIds: string[] = []
      try { grIds = pi.goods_receipt_ids ? JSON.parse(pi.goods_receipt_ids) : [] } catch { grIds = [] }
      if (pi.goods_receipt_id && !grIds.includes(pi.goods_receipt_id)) grIds.push(pi.goods_receipt_id)
      for (const grId of grIds) {
        const gr = one('SELECT gr_number FROM goods_receipts WHERE id = ? AND tenant_id = ?', grId, tenantId)
        out.attachments.push({ refType: 'GOODS_RECEIPT', refId: grId, label: `หลักฐานรับของ ${gr?.gr_number || ''}`.trim() })
      }
      if (pi.purchase_order_id) out.attachments.push({ refType: 'PURCHASE_ORDER', refId: pi.purchase_order_id, label: `เอกสารใบสั่งซื้อ ${pi.po_number || ''}`.trim() })
      out.route = '/purchase'

    } else if (kind === 'SUPPLIER_PAYMENT') {
      const sp = one(`SELECT sp.*, s.name AS supplier_name, pi.pi_number FROM supplier_payments sp
                      LEFT JOIN suppliers s ON s.id = sp.supplier_id AND s.tenant_id = sp.tenant_id
                      LEFT JOIN purchase_invoices pi ON pi.id = sp.purchase_invoice_id AND pi.tenant_id = sp.tenant_id
                      WHERE sp.id = ? AND sp.tenant_id = ?`, refId, tenantId)
      if (!sp) return res.json({ success: true, data: null })
      out.docNumber = sp.payment_number
      out.docDate = sp.payment_date
      out.partyLabel = 'ผู้ขาย'
      out.party = sp.supplier_name
      out.notes = sp.notes || null
      out.amounts = { subtotal: sp.amount, tax: sp.withholding_tax, total: sp.net_amount }
      out.extra = [
        { label: 'ช่องทาง', value: sp.payment_method || '-' },
        { label: 'อ้างอิง', value: sp.payment_reference || '-' },
        { label: 'ใบแจ้งหนี้ซื้อ', value: sp.pi_number || '-' },
        { label: 'หัก ณ ที่จ่าย', value: `฿${Number(sp.withholding_tax || 0).toLocaleString('th-TH')}` },
      ]
      out.attachments = [{ refType: 'SUPPLIER_PAYMENT', refId, label: 'สลิปโอนเงิน' }]
      out.route = '/purchase'

    } else if (kind === 'GOODS_RECEIPT') {
      const gr = one(`SELECT gr.*, s.name AS supplier_name, po.po_number FROM goods_receipts gr
                      LEFT JOIN suppliers s ON s.id = gr.supplier_id AND s.tenant_id = gr.tenant_id
                      LEFT JOIN purchase_orders po ON po.id = gr.purchase_order_id AND po.tenant_id = gr.tenant_id
                      WHERE gr.id = ? AND gr.tenant_id = ?`, refId, tenantId)
      if (!gr) return res.json({ success: true, data: null })
      out.docNumber = gr.gr_number
      out.docDate = gr.receipt_date
      out.partyLabel = 'ผู้ขาย'
      out.party = gr.supplier_name
      out.notes = gr.notes || null
      out.extra = [
        { label: 'ใบสั่งซื้อ', value: gr.po_number || '-' },
        { label: 'เลขที่ใบส่งของผู้ขาย', value: gr.delivery_note_no || '-' },
        { label: 'ออกใบแจ้งหนี้แล้ว', value: gr.invoiced_at ? 'แล้ว' : 'ยังไม่ออก' },
      ]
      out.items = many(`SELECT COALESCE(si.name, poi.description, 'ไม่ระบุ') AS name, gri.accepted_qty, gri.rejected_qty, poi.unit, poi.unit_price
                        FROM goods_receipt_items gri
                        LEFT JOIN stock_items si ON si.id = gri.material_id
                        LEFT JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id
                        WHERE gri.goods_receipt_id = ?`, refId)
        .map(r => ({
          name: r.rejected_qty > 0 ? `${r.name} (ตีกลับ ${r.rejected_qty})` : r.name,
          quantity: r.accepted_qty, unit: r.unit, unitPrice: r.unit_price,
          total: Math.round((r.accepted_qty || 0) * (r.unit_price || 0) * 100) / 100,
        }))
      out.attachments = [{ refType: 'GOODS_RECEIPT', refId, label: 'รูปของตอนรับ' }]
      if (gr.purchase_order_id) out.attachments.push({ refType: 'PURCHASE_ORDER', refId: gr.purchase_order_id, label: `เอกสารใบสั่งซื้อ ${gr.po_number || ''}`.trim() })
      out.route = '/purchase'

    } else if (kind === 'POS_SALE' || kind === 'POS_CANCEL') {
      const bill = one('SELECT * FROM pos_running_bills WHERE id = ? AND tenant_id = ?', refId, tenantId)
      if (!bill) return res.json({ success: true, data: null })
      out.docNumber = bill.bill_number
      out.docDate = bill.closed_at || bill.opened_at
      out.partyLabel = 'โต๊ะ/ลูกค้า'
      out.party = bill.display_name || bill.customer_name
      out.notes = bill.notes || null
      out.amounts = { subtotal: bill.subtotal, tax: bill.tax_amount, total: bill.total_amount }
      out.items = many('SELECT product_name, quantity, unit_price, total_price FROM pos_bill_items WHERE bill_id = ?', refId)
        .map(r => ({ name: r.product_name, quantity: r.quantity, unitPrice: r.unit_price, total: r.total_price }))
      for (const pay of many('SELECT id, payment_method FROM pos_payments WHERE bill_id = ? AND tenant_id = ?', refId, tenantId)) {
        out.attachments.push({ refType: 'POS_PAYMENT', refId: pay.id, label: `สลิป ${pay.payment_method || ''}`.trim() })
      }
      out.route = '/cashier'

    } else if (kind === 'STOCK_ADJUST') {
      // reference_id ของรายการปรับสต็อกชี้ที่ stock_items ไม่ใช่ใบปรับสต็อก จึงต้องย้อนหา
      const adj = one(`SELECT * FROM stock_adjustments WHERE tenant_id = ? AND stock_item_id = ?
                       ORDER BY created_at DESC LIMIT 1`, tenantId, refId)
      const item = one('SELECT name, unit, base_unit FROM stock_items WHERE id = ? AND tenant_id = ?', refId, tenantId)
      if (!adj && !item) return res.json({ success: true, data: null })
      out.docNumber = adj?.adjustment_number || null
      out.docDate = adj?.created_at || null
      out.partyLabel = 'สินค้า'
      out.party = item?.name || null
      out.notes = adj?.notes || adj?.reason || null
      out.amounts = adj ? { total: adj.total_value } : null
      out.extra = adj ? [
        { label: 'เหตุผล', value: adj.reason || '-' },
        { label: 'ก่อน → หลัง', value: `${adj.quantity_before} → ${adj.quantity_after} ${item?.base_unit || item?.unit || ''}` },
      ] : []
      if (adj) out.attachments = [{ refType: 'STOCK_ADJUSTMENT', refId: adj.id, label: 'รูปตอนนับของ' }]
      out.route = '/stock'

    } else {
      return res.json({ success: true, data: null })
    }

    res.json({ success: true, data: out })
  } catch (error) {
    console.error('Journal source doc error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถโหลดเอกสารต้นทางได้' })
  }
})

export default router
