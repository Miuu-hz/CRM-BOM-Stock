import { Router, Request, Response } from 'express'
import db from '../db/sqlite'

const router = Router()

// ============================================================
// เอกสารต้นทางของรายการบัญชี
// ------------------------------------------------------------
// คนทำบัญชีเห็นแต่ Dr/Cr กับคำอธิบายสั้น ๆ แล้วตัดสินใจไม่ได้ว่ารายการนี้ถูกหรือเปล่า
// ต้องเห็นตัวเอกสาร: เลขที่ วันที่ คู่กรณี รายการสินค้า VAT หมายเหตุ สลิป และ "สายเอกสาร"
// (PR → PO → GR → ใบแจ้งหนี้ซื้อ → จ่ายเงิน / SO · POS → ใบแจ้งหนี้ → รับชำระ · ใบลดหนี้)
//
//   GET /journal/:id/source            — จากรายการสมุดรายวัน (ของเดิม)
//   GET /journal/source/:kind/:refId   — เปิดใบใดก็ได้ในสาย (กดข้ามใบจากแถบสายเอกสาร)
//
// เลขแต่ละชนิดรันของใครของมัน สายเอกสารต่อกันด้วยคอลัมน์อ้างอิงที่มีอยู่แล้ว
// (linked_pr_id / purchase_order_id / goods_receipt_id / purchase_invoice_id / sales_order_id /
//  pos_bill_id / invoice_id) — ไม่ได้เพิ่มคอลัมน์หรือตารางใดเลย
//
// คืน refs ของไฟล์แนบเป็นรายการ (refType + refId) ให้หน้าจอไปเรียก /attachments/:refType/:refId
// เอง — endpoint นั้นมีสิทธิ์และ subscription gate ของมันอยู่แล้ว ไม่ต้องทำซ้ำที่นี่
// ============================================================

interface ChainNode {
  kind: string
  refId: string
  number: string | null
  date: string | null
  status: string | null
}

interface SourceDoc {
  kind: string
  refId: string
  docNumber: string | null
  docDate: string | null
  createdAt: string | null
  status: string | null
  partyLabel: string | null
  party: string | null
  notes: string | null
  amounts: { subtotal?: number; discount?: number; tax?: number; total?: number; paid?: number; balance?: number } | null
  vatInclusive: boolean | null
  extra: { label: string; value: string }[]
  items: { name: string; quantity?: number; unit?: string; unitPrice?: number; total?: number }[]
  itemsNote: string | null
  attachments: { refType: string; refId: string; label: string }[]
  chain: ChainNode[]
  /** หน้าที่ควรกดไปดูต่อ — frontend เอาไปทำลิงก์ */
  route: string | null
}

const empty = (kind: string, refId: string): SourceDoc => ({
  kind, refId, docNumber: null, docDate: null, createdAt: null, status: null, partyLabel: null, party: null,
  notes: null, amounts: null, vatInclusive: null, extra: [], items: [], itemsNote: null, attachments: [], chain: [],
  route: null,
})

const one = (sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any
const many = (sql: string, ...args: any[]) => db.prepare(sql).all(...args) as any[]
const ids = (json: unknown): string[] => {
  try { const v = JSON.parse(String(json ?? '')); return Array.isArray(v) ? v.filter(Boolean) : [] } catch { return [] }
}
const inList = (n: number) => Array(n).fill('?').join(',')

/** เอกสารที่เปิดดูได้ทั้งจากสมุดรายวันและจากแถบสายเอกสาร */
const KINDS = new Set([
  'PURCHASE_REQUEST', 'PURCHASE_ORDER', 'GOODS_RECEIPT', 'PURCHASE_INVOICE', 'SUPPLIER_PAYMENT',
  'SALES_ORDER', 'INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'POS_SALE', 'POS_CANCEL', 'STOCK_ADJUST',
])

/** ตารางของแต่ละชนิด — ใช้ดึงวันที่สร้าง/สถานะแบบเดียวกันทุกใบ */
const TABLE_OF: Record<string, string> = {
  PURCHASE_REQUEST: 'purchase_requests', PURCHASE_ORDER: 'purchase_orders', GOODS_RECEIPT: 'goods_receipts',
  PURCHASE_INVOICE: 'purchase_invoices', SUPPLIER_PAYMENT: 'supplier_payments', SALES_ORDER: 'sales_orders',
  INVOICE: 'invoices', PAYMENT: 'receipts', CREDIT_NOTE: 'credit_notes',
  POS_SALE: 'pos_running_bills', POS_CANCEL: 'pos_running_bills',
}

// ------------------------------------------------------------
// สายเอกสาร
// ponytail: เดินตามคอลัมน์อ้างอิงตรง ๆ ไม่ทำกราฟทั่วไป · ยังไม่รวมใบเสนอราคา/ใบส่งของ/ใบคืนของ
// เพิ่มได้ที่ salesChain / purchaseChain เมื่อมีคนต้องการดู
// ------------------------------------------------------------
function purchaseChain(tenantId: string, kind: string, refId: string): ChainNode[] {
  let prId: string | null = kind === 'PURCHASE_REQUEST' ? refId : null
  const poIds = new Set<string>()
  const grIds = new Set<string>()
  const piIds = new Set<string>()

  const addPi = (pi: any) => {
    if (!pi) return
    piIds.add(pi.id)
    if (pi.purchase_order_id) poIds.add(pi.purchase_order_id)
    ids(pi.purchase_order_ids).forEach(x => poIds.add(x))
    if (pi.goods_receipt_id) grIds.add(pi.goods_receipt_id)
    ids(pi.goods_receipt_ids).forEach(x => grIds.add(x))
  }

  if (kind === 'PURCHASE_ORDER') poIds.add(refId)
  if (kind === 'GOODS_RECEIPT') {
    grIds.add(refId)
    const gr = one('SELECT purchase_order_id FROM goods_receipts WHERE id = ? AND tenant_id = ?', refId, tenantId)
    if (gr?.purchase_order_id) poIds.add(gr.purchase_order_id)
  }
  if (kind === 'PURCHASE_INVOICE') addPi(one('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?', refId, tenantId))
  if (kind === 'SUPPLIER_PAYMENT') {
    const sp = one('SELECT purchase_invoice_id FROM supplier_payments WHERE id = ? AND tenant_id = ?', refId, tenantId)
    if (sp?.purchase_invoice_id) addPi(one('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?', sp.purchase_invoice_id, tenantId))
  }
  for (const grId of grIds) {
    const gr = one('SELECT purchase_order_id FROM goods_receipts WHERE id = ? AND tenant_id = ?', grId, tenantId)
    if (gr?.purchase_order_id) poIds.add(gr.purchase_order_id)
  }

  // ต้นเรื่อง PR → เอา PO พี่น้องที่แตกจาก PR เดียวกันมาด้วย (1 PR แยกสั่งหลายผู้ขาย)
  if (!prId && poIds.size) {
    const po = one(`SELECT linked_pr_id FROM purchase_orders WHERE tenant_id = ? AND id IN (${inList(poIds.size)}) AND linked_pr_id IS NOT NULL LIMIT 1`, tenantId, ...poIds)
    prId = po?.linked_pr_id || null
  }
  if (prId) many('SELECT id FROM purchase_orders WHERE tenant_id = ? AND linked_pr_id = ?', tenantId, prId).forEach(r => poIds.add(r.id))

  if (poIds.size) {
    many(`SELECT id FROM goods_receipts WHERE tenant_id = ? AND purchase_order_id IN (${inList(poIds.size)})`, tenantId, ...poIds)
      .forEach(r => grIds.add(r.id))
    // ใบแจ้งหนี้ซื้อที่รวมหลาย PO/GR เก็บเป็น JSON — กรองฝั่ง JS
    for (const pi of many('SELECT * FROM purchase_invoices WHERE tenant_id = ?', tenantId)) {
      const pos = [pi.purchase_order_id, ...ids(pi.purchase_order_ids)]
      const grs = [pi.goods_receipt_id, ...ids(pi.goods_receipt_ids)]
      if (pos.some(x => poIds.has(x)) || grs.some(x => grIds.has(x))) piIds.add(pi.id)
    }
  }

  const nodes: ChainNode[] = []
  const push = (k: string, rows: any[], num: string, date: string) =>
    rows.forEach(r => nodes.push({ kind: k, refId: r.id, number: r[num] ?? null, date: r[date] ?? null, status: r.status ?? null }))
  const pick = (table: string, set: Set<string>, order: string) =>
    set.size ? many(`SELECT * FROM ${table} WHERE tenant_id = ? AND id IN (${inList(set.size)}) ORDER BY ${order}`, tenantId, ...set) : []

  if (prId) push('PURCHASE_REQUEST', many('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?', prId, tenantId), 'pr_number', 'request_date')
  push('PURCHASE_ORDER', pick('purchase_orders', poIds, 'created_at'), 'po_number', 'order_date')
  push('GOODS_RECEIPT', pick('goods_receipts', grIds, 'created_at'), 'gr_number', 'receipt_date')
  push('PURCHASE_INVOICE', pick('purchase_invoices', piIds, 'created_at'), 'pi_number', 'invoice_date')
  if (piIds.size) {
    push('SUPPLIER_PAYMENT', many(`SELECT * FROM supplier_payments WHERE tenant_id = ? AND purchase_invoice_id IN (${inList(piIds.size)}) ORDER BY created_at`, tenantId, ...piIds), 'payment_number', 'payment_date')
  }
  return nodes
}

function salesChain(tenantId: string, kind: string, refId: string): ChainNode[] {
  let soId: string | null = kind === 'SALES_ORDER' ? refId : null
  let posId: string | null = kind === 'POS_SALE' || kind === 'POS_CANCEL' ? refId : null
  const invIds = new Set<string>()

  const addInv = (id: string | null | undefined) => {
    if (!id) return
    const inv = one('SELECT id, sales_order_id, pos_bill_id FROM invoices WHERE id = ? AND tenant_id = ?', id, tenantId)
    if (!inv) return
    invIds.add(inv.id)
    soId = soId || inv.sales_order_id || null
    posId = posId || inv.pos_bill_id || null
  }
  if (kind === 'INVOICE') addInv(refId)
  if (kind === 'PAYMENT') addInv(one('SELECT invoice_id FROM receipts WHERE id = ? AND tenant_id = ?', refId, tenantId)?.invoice_id)
  if (kind === 'CREDIT_NOTE') addInv(one('SELECT invoice_id FROM credit_notes WHERE id = ? AND tenant_id = ?', refId, tenantId)?.invoice_id)
  if (soId) many('SELECT id FROM invoices WHERE tenant_id = ? AND sales_order_id = ?', tenantId, soId).forEach(r => invIds.add(r.id))
  if (posId) many('SELECT id FROM invoices WHERE tenant_id = ? AND pos_bill_id = ?', tenantId, posId).forEach(r => invIds.add(r.id))

  const nodes: ChainNode[] = []
  const push = (k: string, rows: any[], num: string, date: string) =>
    rows.forEach(r => nodes.push({ kind: k, refId: r.id, number: r[num] ?? null, date: r[date] ?? null, status: r.status ?? null }))

  if (soId) push('SALES_ORDER', many('SELECT * FROM sales_orders WHERE id = ? AND tenant_id = ?', soId, tenantId), 'so_number', 'order_date')
  if (posId) push(kind === 'POS_CANCEL' ? 'POS_CANCEL' : 'POS_SALE', many('SELECT * FROM pos_running_bills WHERE id = ? AND tenant_id = ?', posId, tenantId), 'bill_number', 'closed_at')
  if (invIds.size) {
    const list = [...invIds]
    push('INVOICE', many(`SELECT * FROM invoices WHERE tenant_id = ? AND id IN (${inList(list.length)}) ORDER BY created_at`, tenantId, ...list), 'invoice_number', 'invoice_date')
    // ใบเสร็จไม่มีคอลัมน์สถานะ (ยกเลิก = ลบแถว) จึงไม่มี status
    push('PAYMENT', many(`SELECT * FROM receipts WHERE tenant_id = ? AND invoice_id IN (${inList(list.length)}) ORDER BY created_at`, tenantId, ...list), 'receipt_number', 'receipt_date')
    push('CREDIT_NOTE', many(`SELECT * FROM credit_notes WHERE tenant_id = ? AND invoice_id IN (${inList(list.length)}) ORDER BY created_at`, tenantId, ...list), 'cn_number', 'credit_date')
  }
  return nodes
}

const PURCHASE_KINDS = new Set(['PURCHASE_REQUEST', 'PURCHASE_ORDER', 'GOODS_RECEIPT', 'PURCHASE_INVOICE', 'SUPPLIER_PAYMENT'])
const SALES_KINDS = new Set(['SALES_ORDER', 'INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'POS_SALE', 'POS_CANCEL'])

/** รายการสินค้าจาก PO — ใช้เป็นค่าสำรองเมื่อใบแจ้งหนี้ซื้อไม่มีรายการของตัวเอง */
function poItems(tenantId: string, poIdList: string[]) {
  if (!poIdList.length) return []
  return many(`SELECT COALESCE(si.name, poi.description, 'ไม่ระบุ') AS name, poi.quantity, poi.unit, poi.unit_price, poi.total_price
               FROM purchase_order_items poi
               LEFT JOIN stock_items si ON si.id = poi.material_id
               WHERE poi.tenant_id = ? AND poi.purchase_order_id IN (${inList(poIdList.length)})`, tenantId, ...poIdList)
    .map(r => ({ name: r.name, quantity: r.quantity, unit: r.unit, unitPrice: r.unit_price, total: r.total_price }))
}

export function buildSourceDoc(tenantId: string, kind: string, refId: string): SourceDoc | null {
  if (!KINDS.has(kind) || !refId) return null
  const out = empty(kind, refId)

  if (kind === 'INVOICE') {
    const inv = one(`SELECT i.*, c.name AS customer_name FROM invoices i
                     LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
                     WHERE i.id = ? AND i.tenant_id = ?`, refId, tenantId)
    if (!inv) return null
    out.docNumber = inv.invoice_number
    out.docDate = inv.invoice_date
    out.partyLabel = 'ลูกค้า'
    out.party = inv.customer_name
    out.notes = inv.notes || null
    out.amounts = { subtotal: inv.subtotal, discount: inv.discount_amount || undefined, tax: inv.tax_amount, total: inv.total_amount, paid: inv.paid_amount, balance: inv.balance_amount }
    out.vatInclusive = !!inv.vat_inclusive
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
    if (!rc) return null
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

  } else if (kind === 'CREDIT_NOTE') {
    const cn = one(`SELECT cn.*, c.name AS customer_name, i.invoice_number FROM credit_notes cn
                    LEFT JOIN customers c ON c.id = cn.customer_id AND c.tenant_id = cn.tenant_id
                    LEFT JOIN invoices i ON i.id = cn.invoice_id AND i.tenant_id = cn.tenant_id
                    WHERE cn.id = ? AND cn.tenant_id = ?`, refId, tenantId)
    if (!cn) return null
    out.docNumber = cn.cn_number
    out.docDate = cn.credit_date
    out.partyLabel = 'ลูกค้า'
    out.party = cn.customer_name
    out.notes = cn.notes || null
    out.amounts = { subtotal: cn.subtotal, tax: cn.tax_amount, total: cn.total_amount }
    out.extra = [
      { label: 'อ้างอิงใบแจ้งหนี้', value: cn.invoice_number || '-' },
      { label: 'เหตุผล', value: cn.reason || '-' },
    ]
    out.items = many(`SELECT COALESCE(ii.product_name, 'ไม่ระบุ') AS name, cni.quantity, cni.unit_price, cni.total_price
                      FROM credit_note_items cni LEFT JOIN invoice_items ii ON ii.id = cni.invoice_item_id
                      WHERE cni.credit_note_id = ? AND cni.tenant_id = ?`, refId, tenantId)
      .map(r => ({ name: r.name, quantity: r.quantity, unitPrice: r.unit_price, total: r.total_price }))
    out.route = '/sales'

  } else if (kind === 'SALES_ORDER') {
    const so = one(`SELECT so.*, c.name AS customer_name FROM sales_orders so
                    LEFT JOIN customers c ON c.id = so.customer_id AND c.tenant_id = so.tenant_id
                    WHERE so.id = ? AND so.tenant_id = ?`, refId, tenantId)
    if (!so) return null
    out.docNumber = so.so_number
    out.docDate = so.order_date
    out.partyLabel = 'ลูกค้า'
    out.party = so.customer_name
    out.notes = so.notes || null
    out.amounts = { subtotal: so.subtotal, discount: so.discount_amount || undefined, tax: so.tax_amount, total: so.total_amount }
    out.vatInclusive = !!so.vat_inclusive
    out.extra = [{ label: 'สถานะชำระ', value: so.payment_status || '-' }]
    out.items = many('SELECT product_name, quantity, unit, unit_price, total_price FROM sales_order_items WHERE sales_order_id = ? AND tenant_id = ?', refId, tenantId)
      .map(r => ({ name: r.product_name, quantity: r.quantity, unit: r.unit, unitPrice: r.unit_price, total: r.total_price }))
    out.route = '/sales'

  } else if (kind === 'PURCHASE_REQUEST') {
    const pr = one('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?', refId, tenantId)
    if (!pr) return null
    out.docNumber = pr.pr_number
    out.docDate = pr.request_date
    out.partyLabel = 'ผู้ขอ'
    out.party = pr.requester_name
    out.notes = pr.notes || null
    out.amounts = { total: pr.total_amount }
    out.extra = [
      { label: 'ผู้ขายที่เสนอ', value: pr.supplier_name || '-' },
      { label: 'ต้องการภายใน', value: pr.required_date ? String(pr.required_date).slice(0, 10) : '-' },
    ]
    out.items = many(`SELECT COALESCE(si.name, pri.item_name, pri.description, 'ไม่ระบุ') AS name, pri.quantity, pri.unit,
                             COALESCE(pri.unit_price, pri.estimated_unit_price) AS unit_price, pri.estimated_total_price
                      FROM purchase_request_items pri LEFT JOIN stock_items si ON si.id = pri.material_id
                      WHERE (pri.purchase_request_id = ? OR pri.pr_id = ?) AND pri.tenant_id = ?`, refId, refId, tenantId)
      .map(r => ({ name: r.name, quantity: r.quantity, unit: r.unit, unitPrice: r.unit_price, total: r.estimated_total_price }))
    out.itemsNote = 'ราคาประมาณการตอนขอซื้อ'
    out.route = '/purchase'

  } else if (kind === 'PURCHASE_ORDER') {
    const po = one(`SELECT po.*, s.name AS supplier_name FROM purchase_orders po
                    LEFT JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
                    WHERE po.id = ? AND po.tenant_id = ?`, refId, tenantId)
    if (!po) return null
    out.docNumber = po.po_number
    out.docDate = po.order_date
    out.partyLabel = 'ผู้ขาย'
    out.party = po.supplier_name
    out.notes = po.notes || null
    out.amounts = { subtotal: po.subtotal, discount: po.discount_amount || undefined, tax: po.tax_amount, total: po.total_amount }
    out.vatInclusive = !!po.vat_inclusive
    out.extra = [
      { label: 'กำหนดรับ', value: po.expected_date ? String(po.expected_date).slice(0, 10) : '-' },
      { label: 'ชำระแล้ว', value: po.is_paid ? 'ชำระแล้ว' : 'ยังไม่ชำระ' },
    ]
    out.items = poItems(tenantId, [refId])
    out.attachments = [{ refType: 'PURCHASE_ORDER', refId, label: 'เอกสารใบสั่งซื้อ' }]
    out.route = '/purchase'

  } else if (kind === 'PURCHASE_INVOICE') {
    const pi = one(`SELECT pi.*, s.name AS supplier_name, po.po_number FROM purchase_invoices pi
                    LEFT JOIN suppliers s ON s.id = pi.supplier_id AND s.tenant_id = pi.tenant_id
                    LEFT JOIN purchase_orders po ON po.id = pi.purchase_order_id AND po.tenant_id = pi.tenant_id
                    WHERE pi.id = ? AND pi.tenant_id = ?`, refId, tenantId)
    if (!pi) return null
    out.docNumber = pi.pi_number
    out.docDate = pi.invoice_date
    out.partyLabel = 'ผู้ขาย'
    out.party = pi.supplier_name
    out.notes = pi.notes || null
    out.amounts = { subtotal: pi.subtotal, discount: pi.discount_amount || undefined, tax: pi.tax_amount, total: pi.total_amount, paid: pi.paid_amount, balance: pi.balance_amount }
    out.vatInclusive = !!pi.vat_inclusive
    out.extra = [
      { label: 'เลขที่ใบกำกับผู้ขาย', value: pi.supplier_invoice_number || '— ไม่ได้บันทึก' },
      { label: 'ใบสั่งซื้อ', value: pi.po_number || '-' },
      { label: 'ครบกำหนด', value: pi.due_date ? String(pi.due_date).slice(0, 10) : '-' },
    ]
    out.items = many(`SELECT COALESCE(si.name, poi.description, 'ไม่ระบุ') AS name, pii.quantity, pii.unit_price, pii.total_price, poi.unit
                      FROM purchase_invoice_items pii
                      LEFT JOIN stock_items si ON si.id = pii.material_id
                      LEFT JOIN purchase_order_items poi ON poi.id = pii.purchase_order_item_id
                      WHERE pii.purchase_invoice_id = ?`, refId)
      .map(r => ({ name: r.name, quantity: r.quantity, unit: r.unit, unitPrice: r.unit_price, total: r.total_price }))
    // ใบแจ้งหนี้ซื้อที่สร้างจาก PO/MCP หลายใบไม่มีรายการของตัวเอง — โชว์จาก PO แทน พร้อมบอกให้รู้
    const piPos = [...new Set([pi.purchase_order_id, ...ids(pi.purchase_order_ids)].filter(Boolean))] as string[]
    if (!out.items.length && piPos.length) {
      out.items = poItems(tenantId, piPos)
      if (out.items.length) out.itemsNote = 'ใบนี้ไม่มีรายการของตัวเอง — แสดงรายการจากใบสั่งซื้อ'
    }
    out.attachments = [{ refType: 'PURCHASE_INVOICE', refId, label: 'บิล/ใบกำกับจากผู้ขาย' }]
    // ใบรับสินค้าที่บิลนี้อ้างถึง — รูปของตอนรับมักอยู่ที่นั่น ไม่ได้อยู่กับบิล
    const grIds = ids(pi.goods_receipt_ids)
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
    if (!sp) return null
    out.docNumber = sp.payment_number
    out.docDate = sp.payment_date
    out.partyLabel = 'ผู้ขาย'
    out.party = sp.supplier_name
    out.notes = sp.notes || null
    // ช่อง "ภาษี" ของใบจ่ายเงินคือภาษีหัก ณ ที่จ่าย ไม่ใช่ VAT — แยกไว้ใน extra ให้ชัด
    out.amounts = { subtotal: sp.amount, total: sp.net_amount }
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
    if (!gr) return null
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
    // ใบรับของไม่มียอดเงินในตัว — รวมจำนวนที่รับ × ราคาใน PO ให้ดู (ก่อน VAT)
    const sum = out.items.reduce((s, it) => s + (it.total || 0), 0)
    out.amounts = { subtotal: Math.round(sum * 100) / 100 }
    out.itemsNote = 'มูลค่าคิดจากจำนวนที่รับ × ราคาในใบสั่งซื้อ (ก่อน VAT)'
    out.attachments = [{ refType: 'GOODS_RECEIPT', refId, label: 'รูปของตอนรับ' }]
    if (gr.purchase_order_id) out.attachments.push({ refType: 'PURCHASE_ORDER', refId: gr.purchase_order_id, label: `เอกสารใบสั่งซื้อ ${gr.po_number || ''}`.trim() })
    out.route = '/purchase'

  } else if (kind === 'POS_SALE' || kind === 'POS_CANCEL') {
    const bill = one('SELECT * FROM pos_running_bills WHERE id = ? AND tenant_id = ?', refId, tenantId)
    if (!bill) return null
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
    if (!adj && !item) return null
    out.docNumber = adj?.adjustment_number || null
    out.docDate = adj?.created_at || null
    out.createdAt = adj?.created_at || null
    out.status = adj?.status || null
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
  }

  // วันที่สร้าง/สถานะ อ่านแบบเดียวกันทุกชนิด
  const table = TABLE_OF[kind]
  if (table) {
    const row = one(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ?`, refId, tenantId)
    out.createdAt = row?.created_at ?? row?.opened_at ?? null
    out.status = row?.status ?? null
  }

  out.chain = PURCHASE_KINDS.has(kind) ? purchaseChain(tenantId, kind, refId)
    : SALES_KINDS.has(kind) ? salesChain(tenantId, kind, refId)
    : []
  // สายที่มีใบเดียว (ตัวมันเอง) ไม่มีประโยชน์ให้โชว์
  if (out.chain.length < 2) out.chain = []
  return out
}

// GET /journal/:id/source — เอกสารต้นทางของรายการสมุดรายวันหนึ่งใบ
router.get('/:id/source', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const entry = db.prepare('SELECT reference_type, reference_id FROM journal_entries WHERE id = ? AND tenant_id = ?')
      .get(req.params.id, tenantId) as any
    if (!entry) return res.status(404).json({ success: false, message: 'ไม่พบรายการสมุดรายวัน' })
    if (!entry.reference_id) return res.json({ success: true, data: null })
    res.json({ success: true, data: buildSourceDoc(tenantId, entry.reference_type || 'MANUAL', entry.reference_id) })
  } catch (error) {
    console.error('Journal source doc error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถโหลดเอกสารต้นทางได้' })
  }
})

// GET /journal/source/:kind/:refId — เปิดใบใดก็ได้ในสายเอกสาร (tenant ของผู้ใช้เท่านั้น)
router.get('/source/:kind/:refId', (req: Request, res: Response) => {
  try {
    const kind = String(req.params.kind || '').toUpperCase()
    if (!KINDS.has(kind)) return res.status(400).json({ success: false, message: 'ไม่รู้จักชนิดเอกสารนี้' })
    const doc = buildSourceDoc(req.user!.tenantId, kind, req.params.refId)
    if (!doc) return res.status(404).json({ success: false, message: 'ไม่พบเอกสาร' })
    res.json({ success: true, data: doc })
  } catch (error) {
    console.error('Source doc error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถโหลดเอกสารได้' })
  }
})

export default router
