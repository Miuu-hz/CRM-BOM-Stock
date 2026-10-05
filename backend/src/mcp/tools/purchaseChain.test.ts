import { describe, it, expect } from 'vitest'
import db from '../../db/sqlite'
import { generateId, formatDocumentNumber } from '../../utils/id'
import { registerPurchaseTools } from './purchase'
import { registerPurchaseBillingTools } from './purchaseBilling'
import { findStuckMcpPurchaseOrders } from '../../services/purchaseChain.service'
import { changePurchaseOrderDate } from '../../services/purchaseOrderUpdate.service'
import { createTestUser } from '../../test/testAuth'

/**
 * บิลที่ AI ป้อนผ่าน MCP (2026-10-06): เลขที่เอกสารต้องตามรูปแบบใน Settings + วันที่บนบิล
 * และบิลที่จ่ายแล้วต้องเดินครบ PO → GR → PI → ใบจ่ายเงิน ได้ (complete_purchase_bill)
 */
function fakeServer() {
  const tools: Record<string, any> = {}
  return {
    server: { tool: (name: string, _d: any, _s: any, handler: any) => { tools[name] = handler } } as any,
    call: async (name: string, args: any) => JSON.parse((await tools[name](args)).content[0].text),
  }
}

function setFormat(tenantId: string, docType: string, prefix: string, dateFormat: string) {
  db.prepare(`INSERT OR REPLACE INTO document_number_formats (tenant_id, doc_type, enabled, prefix, padding, date_format, separator, updated_at)
    VALUES (?, ?, 1, ?, 3, ?, '-', datetime('now'))`).run(tenantId, docType, prefix, dateFormat)
}

function seedItem(tenantId: string, name: string): string {
  const id = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, ?, 'raw', 0, 'kg', 'kg', 10, 'STOCK', 'ACTIVE')`).run(id, tenantId, 'SKU-' + id.slice(0, 8), name)
  return id
}

function setup(role: any = 'ADMIN') {
  const user = createTestUser({ role })
  const { server, call } = fakeServer()
  registerPurchaseTools(server, user.tenantId, user.userId, user.email, role)
  registerPurchaseBillingTools(server, user.tenantId, user.userId, user.email, role)
  return { t: user.tenantId, call }
}

describe('formatDocumentNumber ใช้วันที่ของเอกสาร', () => {
  it('รูปแบบใน Settings: ส่วนวันที่และถังปีมาจาก docDate ไม่ใช่วันนี้', () => {
    const t = 'tn_docdate_' + generateId().slice(0, 8)
    setFormat(t, 'PO', 'PX', 'DDMMYY')
    expect(formatDocumentNumber('PO', t, 'PO', 2025, 5, '2025-12-28')).toBe('PX-001-281225')
    const seq = db.prepare('SELECT year, last_number FROM document_sequences WHERE tenant_id = ? AND doc_type = ?').all(t, 'PO') as any[]
    expect(seq).toEqual([{ year: 2025, last_number: 1 }])
    // ไม่ส่ง docDate = วันนี้ (เข้ากันได้กับผู้เรียกเดิม)
    expect(formatDocumentNumber('PO', t, 'PO')).toMatch(new RegExp(`^PX-001-\\d{4}${String(new Date().getFullYear()).slice(-2)}$`))
  })
})

describe('MCP บิลซื้อ: create_draft_po → complete_purchase_bill', () => {
  it('บิลเงินสดย้อนหลัง เดินครบสาย เลขทุกใบตาม Settings + วันบนบิล และลงเงินสดไม่ใช่ธนาคาร', async () => {
    const { t, call } = setup()
    setFormat(t, 'PO', 'PO', 'DDMMYY')
    setFormat(t, 'GOODS_RECEIPT', 'GR', 'DDMMYY')
    setFormat(t, 'PURCHASE_INVOICE', 'PI', 'DDMMYY')
    setFormat(t, 'SUPPLIER_PAYMENT', 'PAY', 'DDMMYY')
    // มีบัญชีธนาคารอยู่ — เดิม create_draft_po ผูกบัญชีนี้ให้บิลเงินสดเอง
    const glBank = generateId()
    db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, is_active, created_at, updated_at)
      VALUES (?, ?, '1102-01', 'KBANK', 'ASSET', 'CURRENT_ASSET', 'DEBIT', 1, datetime('now'), datetime('now'))`).run(glBank, t)
    db.prepare(`INSERT INTO bank_accounts (id, tenant_id, bank_name, account_number, account_name, account_id, is_active, is_default, created_at, updated_at)
      VALUES (?, ?, 'KBANK', '1', 'x', ?, 1, 1, datetime('now'), datetime('now'))`).run(generateId(), t, glBank)
    seedItem(t, 'หมูสับ')

    const po = await call('create_draft_po', {
      items: [{ description: 'หมูสับ', quantity: 2, unit: 'kg', unitPrice: 100 }],
      supplier_hint: 'ตลาดสด', payment_method: 'เงินสด', is_paid: true, bill_date: '2026-09-28',
    })
    expect(po.poNumber).toBe('PO-001-280926')
    expect(po.payment.bank_account_id).toBeNull()
    expect(findStuckMcpPurchaseOrders(t).map(p => p.id)).toEqual([po.poId])

    // dry-run ไม่เขียนอะไร
    const dry = await call('complete_purchase_bill', { po_id: po.poNumber, dry_run: true })
    expect(dry.success).toBe(true)
    expect(dry.steps.length).toBeGreaterThanOrEqual(4)
    expect((db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(po.poId) as any).status).toBe('DRAFT')

    const r = await call('complete_purchase_bill', { po_id: po.poNumber })
    expect(r.success).toBe(true)

    const poRow = db.prepare('SELECT status, order_date FROM purchase_orders WHERE id = ?').get(po.poId) as any
    expect(poRow.status).toBe('RECEIVED')
    expect(poRow.order_date).toBe('2026-09-28')
    const gr = db.prepare('SELECT gr_number, status, receipt_date FROM goods_receipts WHERE purchase_order_id = ?').get(po.poId) as any
    expect(gr).toMatchObject({ gr_number: 'GR-001-280926', status: 'CONFIRMED', receipt_date: '2026-09-28' })
    const pi = db.prepare('SELECT id, pi_number, invoice_date, payment_status, total_amount FROM purchase_invoices WHERE purchase_order_id = ?').get(po.poId) as any
    expect(pi).toMatchObject({ pi_number: 'PI-001-280926', invoice_date: '2026-09-28', payment_status: 'PAID', total_amount: 200 })
    const pay = db.prepare('SELECT id, payment_number, amount FROM supplier_payments WHERE purchase_invoice_id = ?').get(pi.id) as any
    expect(pay).toMatchObject({ payment_number: 'PAY-001-280926', amount: 200 })
    const creditAcc = db.prepare(`SELECT a.code FROM journal_lines l JOIN journal_entries je ON je.id = l.journal_entry_id
      JOIN accounts a ON a.id = l.account_id WHERE je.reference_type = 'SUPPLIER_PAYMENT' AND je.reference_id = ? AND l.credit > 0`).get(pay.id) as any
    expect(creditAcc.code).toBe('1101')

    expect(findStuckMcpPurchaseOrders(t)).toEqual([])
    // เรียกซ้ำ = ไม่มีอะไรต้องทำ ไม่ออกเอกสารซ้ำ
    const again = await call('complete_purchase_bill', { po_id: po.poId })
    expect(again.steps).toEqual([])
    expect((db.prepare('SELECT COUNT(*) c FROM purchase_invoices WHERE purchase_order_id = ?').get(po.poId) as any).c).toBe(1)
  })

  it('จ่ายบางส่วน: จ่ายแค่ paid_amount ที่เหลือค้างเป็นเจ้าหนี้ · เรียกซ้ำไม่จ่ายซ้ำ', async () => {
    const { t, call } = setup()
    seedItem(t, 'กุ้ง')
    const po = await call('create_draft_po', {
      items: [{ description: 'กุ้ง', quantity: 2, unit: 'kg', unitPrice: 100 }],
      supplier_hint: 'แพกุ้ง', payment_method: 'เงินสด', is_paid: true, paid_amount: 120, bill_date: '2026-09-20',
    })
    const dry = await call('complete_purchase_bill', { po_id: po.poId, dry_run: true })
    expect(dry.steps.at(-1)).toMatch(/฿120 /)

    const r = await call('complete_purchase_bill', { po_id: po.poId })
    expect(r.success).toBe(true)
    const pi = db.prepare('SELECT id, paid_amount, balance_amount, payment_status FROM purchase_invoices WHERE purchase_order_id = ?').get(po.poId) as any
    expect(pi).toMatchObject({ paid_amount: 120, balance_amount: 80 })
    expect(pi.payment_status).not.toBe('PAID')
    expect(findStuckMcpPurchaseOrders(t)).toEqual([])

    const again = await call('complete_purchase_bill', { po_id: po.poId })
    expect(again.steps).toEqual([])
    const again2 = await call('complete_purchase_bill', { po_id: po.poId, dry_run: true })
    expect(again2.steps).toEqual([])
    expect((db.prepare('SELECT COUNT(*) c FROM supplier_payments WHERE purchase_invoice_id = ?').get(pi.id) as any).c).toBe(1)
  })

  it('บิลเก่าวันที่ผิด: update_purchase_order(order_date) แล้วเอกสารทั้งสายลงวันใหม่ · เลข PO คงเดิม', async () => {
    const { t, call } = setup()
    seedItem(t, 'ไข่')
    const po = await call('create_draft_po', { items: [{ description: 'ไข่', quantity: 1, unit: 'kg', unitPrice: 50 }], supplier_hint: 'ฟาร์ม', is_paid: true })
    const u = await call('update_purchase_order', { po_id: po.poNumber, order_date: '2026-09-15' })
    expect(u.message).toContain('2026-09-15')
    expect(u.po.po_number).toBe(po.poNumber)
    expect(u.po.order_date).toBe('2026-09-15')

    expect((await call('complete_purchase_bill', { po_id: po.poId })).success).toBe(true)
    const gr = db.prepare('SELECT receipt_date FROM goods_receipts WHERE purchase_order_id = ?').get(po.poId) as any
    expect(gr.receipt_date).toBe('2026-09-15')
    // มีเอกสารลูกแล้ว แก้วันที่ไม่ได้
    expect(() => changePurchaseOrderDate(t, po.poId, '2026-09-01')).toThrow(/ใบรับสินค้า/)
  })

  it('แก้วันที่: วันผิดรูปแบบ/งวดปิด → ไม่แตะ PO และไม่แก้รายการครึ่งทาง', async () => {
    const { t, call } = setup()
    const po = await call('create_draft_po', { items: [{ description: 'z', quantity: 1, unit: 'pcs', unitPrice: 10 }], bill_date: '2026-09-10' })
    expect(() => changePurchaseOrderDate(t, po.poId, '2026-02-31')).toThrow(/ไม่ถูกต้อง/)
    db.prepare(`INSERT INTO tax_periods (id, tenant_id, year, month, period_type, start_date, end_date, status)
      VALUES (?, ?, 2026, 8, 'MONTHLY', '2026-08-01', '2026-08-31', 'CLOSED')`).run(generateId(), t)
    const r = await call('update_purchase_order', { po_id: po.poId, order_date: '2026-08-15', notes: 'ห้ามเข้า' })
    expect(r.success).toBe(false)
    expect(r.message).toMatch(/8\/2026/)
    const row = db.prepare('SELECT order_date, notes FROM purchase_orders WHERE id = ?').get(po.poId) as any
    expect(row.order_date).toBe('2026-09-10')
    expect(row.notes).not.toBe('ห้ามเข้า')
  })

  it('ไม่ได้ตั้งรูปแบบ: เลขใช้ปีของวันบนบิล', async () => {
    const { call } = setup()
    const po = await call('create_draft_po', { items: [{ description: 'x', quantity: 1, unit: 'pcs', unitPrice: 1 }], bill_date: '2025-12-31' })
    expect(po.poNumber).toBe('PO-2025-00001')
  })

  it('รายการยังไม่ผูกสินค้า → หยุดก่อนเขียนอะไร', async () => {
    const { call } = setup()
    const po = await call('create_draft_po', {
      items: [{ description: 'ของไม่มีในคลัง', quantity: 1, unit: 'pcs', unitPrice: 50 }], supplier_hint: 'ร้าน A', is_paid: true,
    })
    const r = await call('complete_purchase_bill', { po_id: po.poId })
    expect(r.success).toBe(false)
    expect(r.blocker).toBeTruthy()
    expect((db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(po.poId) as any).status).toBe('DRAFT')
    expect(db.prepare('SELECT 1 FROM goods_receipts WHERE purchase_order_id = ?').get(po.poId)).toBeUndefined()
  })

  it('ไม่มีสิทธิ์จัดการบิลซื้อ → ปฏิเสธ', async () => {
    const { t, call } = setup('USER')
    seedItem(t, 'น้ำตาล')
    const po = await call('create_draft_po', { items: [{ description: 'น้ำตาล', quantity: 1, unit: 'kg', unitPrice: 30 }], supplier_hint: 'ร้าน B' })
    const r = await call('complete_purchase_bill', { po_id: po.poId })
    expect(r.success).toBe(false)
    expect((db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(po.poId) as any).status).toBe('DRAFT')
  })

  it('สร้างผู้ขายใหม่ไม่ชนรหัสเดิม (เดิม COUNT+1 ชน UNIQUE หลังลบผู้ขาย)', async () => {
    const { t, call } = setup()
    db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name, status) VALUES (?, ?, ?, 'เก่า', 'เก่า', 'INACTIVE')")
      .run(generateId(), t, `SUP-${new Date().getFullYear()}-0001`)
    const po = await call('create_draft_po', { items: [{ description: 'y', quantity: 1, unit: 'pcs', unitPrice: 1 }], supplier_hint: 'ร้านใหม่' })
    expect(po.supplier.isNew).toBe(true)
  })
})
