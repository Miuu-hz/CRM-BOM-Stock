import { describe, it, expect } from 'vitest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { registerPurchaseBillingTools } from './purchaseBilling'
import { createGoodsReceipt, confirmGoodsReceipt } from '../../services/goodsReceipt.service'
import { createTestUser } from '../../test/testAuth'
import type { IMcpServer } from '../sdk-compat'

/**
 * เทสต์ create_purchase_invoice / pay_supplier (MCP) — เรียกผ่าน registerPurchaseBillingTools
 * ตรง ๆ (ไม่ผ่าน HTTP) แพทเทิร์นเดียวกับ purchase.gr.test.ts
 * ตั้งใจไม่เทสต์ REST /invoices, /payments เพราะ route เหล่านั้นเรียก service เดียวกันนี้
 * (services/purchaseBilling.service.ts) — เทสต์ที่นี่จึงคุ้มครองทั้งสองฝั่งไปด้วย
 */
function fakeServer(): { server: IMcpServer; tools: Record<string, (args: any) => Promise<any>> } {
  const tools: Record<string, (args: any) => Promise<any>> = {}
  const server: IMcpServer = {
    tool: (name: string, _desc: string, _schema: any, handler: any) => { tools[name] = handler },
    connect: async () => {},
    close: async () => {},
  }
  return { server, tools }
}

function parseOk(res: any): any {
  return JSON.parse(res.content[0].text)
}

/** สร้าง PO ที่ APPROVED พร้อมรายการที่ผูก material_id แล้ว (เหมือนคนกดผูกใน web มาก่อน) */
function seedApprovedPo(tenantId: string, lines: { description: string; qty: number; unitPrice: number }[]) {
  const supplierId = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')")
    .run(supplierId, tenantId, supplierId)
  const poId = generateId()
  const now = new Date().toISOString()
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_rate, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'APPROVED', ?, 7, ?, ?, ?, ?)
  `).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, subtotal, subtotal * 0.07, subtotal * 1.07, now, now)
  for (const line of lines) {
    const materialId = generateId()
    db.prepare(`
      INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
      VALUES (?, ?, ?, ?, 'raw', 0, 'pcs', 'pcs', 10, 'STOCK', 'ACTIVE')
    `).run(materialId, tenantId, 'SKU-' + materialId.slice(0, 8), line.description)
    db.prepare(`
      INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty)
      VALUES (?, ?, ?, ?, ?, ?, 'pcs', ?, ?, 0)
    `).run(generateId(), tenantId, poId, materialId, line.description, line.qty, line.unitPrice, line.qty * line.unitPrice)
  }
  return { poId, supplierId }
}

/** สร้าง+ยืนยัน GR ครบทุกรายการที่ค้างรับของ PO — คืน GR ที่ CONFIRMED แล้ว */
function receiveWholePo(tenantId: string, userEmail: string, poId: string) {
  const created = createGoodsReceipt(tenantId, userEmail, { purchaseOrderId: poId }) as any
  return confirmGoodsReceipt(tenantId, 'u1', created.id) as any
}

function sumJournalLines(journalEntryId: string): { debit: number; credit: number } {
  const rows = db.prepare('SELECT debit, credit FROM journal_lines WHERE journal_entry_id = ?').all(journalEntryId) as any[]
  return rows.reduce((acc, r) => ({ debit: acc.debit + r.debit, credit: acc.credit + r.credit }), { debit: 0, credit: 0 })
}

describe('MCP create_purchase_invoice', () => {
  it('ออกใบแจ้งหนี้จาก GR แล้ว journal ดุลและยอดตรง', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { server, tools } = fakeServer()
    registerPurchaseBillingTools(server, user.tenantId, user.userId, user.email, 'ADMIN')

    const { poId } = seedApprovedPo(user.tenantId, [{ description: 'แป้งสาลี', qty: 5, unitPrice: 100 }])
    const gr = receiveWholePo(user.tenantId, user.email, poId)

    const res = parseOk(await tools['create_purchase_invoice']({ goods_receipt_ids: [gr.gr_number] }))
    expect(res.success, res.message).toBe(true)
    expect(res.สรุปยอด.มูลค่าก่อนภาษี).toBe(500)
    expect(res.สรุปยอด.ภาษีมูลค่าเพิ่ม).toBeCloseTo(35, 5)
    expect(res.สรุปยอด.ยอดรวม).toBeCloseTo(535, 5)

    const pi = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(res.piId) as any
    expect(pi.total_amount).toBeCloseTo(535, 5)
    expect(pi.balance_amount).toBeCloseTo(535, 5)

    const journal = db.prepare("SELECT * FROM journal_entries WHERE reference_type = 'PURCHASE_INVOICE' AND reference_id = ?").get(pi.id) as any
    expect(journal).toBeTruthy()
    expect(journal.total_debit).toBeCloseTo(535, 5)
    expect(journal.total_credit).toBeCloseTo(535, 5)
    const lineSums = sumJournalLines(journal.id)
    expect(lineSums.debit).toBeCloseTo(lineSums.credit, 5)
    expect(lineSums.debit).toBeCloseTo(535, 5)

    // GR ต้องถูก lock ไว้ (invoiced_at ถูกเซ็ต) กันออกใบซ้ำ
    const grRow = db.prepare('SELECT invoiced_at FROM goods_receipts WHERE id = ?').get(gr.id) as any
    expect(grRow.invoiced_at).toBeTruthy()
  })

  it('ออกใบซ้ำจาก GR เดิมไม่ได้', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { server, tools } = fakeServer()
    registerPurchaseBillingTools(server, user.tenantId, user.userId, user.email, 'ADMIN')

    const { poId } = seedApprovedPo(user.tenantId, [{ description: 'น้ำตาลทราย', qty: 2, unitPrice: 40 }])
    const gr = receiveWholePo(user.tenantId, user.email, poId)

    const first = parseOk(await tools['create_purchase_invoice']({ goods_receipt_ids: [gr.gr_number] }))
    expect(first.success, first.message).toBe(true)

    const second = parseOk(await tools['create_purchase_invoice']({ goods_receipt_ids: [gr.gr_number] }))
    expect(second.success).toBe(false)
    expect(second.message).toContain('ถูกใช้สร้างใบแจ้งหนี้ไปแล้ว')
  })

  it('ใบแจ้งหนี้ที่รวมหลาย GR ยอดรวมถูก', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { server, tools } = fakeServer()
    registerPurchaseBillingTools(server, user.tenantId, user.userId, user.email, 'ADMIN')

    // PO 2 รายการ — รับเป็น 2 รอบ (2 GR) แต่รวมออกใบแจ้งหนี้เดียว
    const supplierId = generateId()
    db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')")
      .run(supplierId, user.tenantId, supplierId)
    const poId = generateId()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_rate, tax_amount, total_amount, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'APPROVED', 700, 7, 49, 749, ?, ?)
    `).run(poId, user.tenantId, 'PO-' + poId.slice(0, 6), supplierId, now, now)
    const mat1 = generateId(); const mat2 = generateId()
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
      VALUES (?, ?, ?, 'ข้าว', 'raw', 0, 'pcs', 'pcs', 10, 'STOCK', 'ACTIVE')`).run(mat1, user.tenantId, 'SKU1')
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
      VALUES (?, ?, ?, 'น้ำมันพืช', 'raw', 0, 'pcs', 'pcs', 10, 'STOCK', 'ACTIVE')`).run(mat2, user.tenantId, 'SKU2')
    db.prepare(`INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty)
      VALUES (?, ?, ?, ?, 'ข้าว', 10, 'pcs', 50, 500, 0)`).run(generateId(), user.tenantId, poId, mat1)
    db.prepare(`INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty)
      VALUES (?, ?, ?, ?, 'น้ำมันพืช', 4, 'pcs', 50, 200, 0)`).run(generateId(), user.tenantId, poId, mat2)

    // GR รอบแรก: รับข้าวทั้งหมด
    const gr1created = createGoodsReceipt(user.tenantId, user.email, {
      purchaseOrderId: poId,
      items: [{ poItemId: (db.prepare("SELECT id FROM purchase_order_items WHERE purchase_order_id = ? AND description = 'ข้าว'").get(poId) as any).id,
        materialId: mat1, orderedQty: 10, receivedQty: 10, acceptedQty: 10 }],
    }) as any
    const gr1 = confirmGoodsReceipt(user.tenantId, 'u1', gr1created.id) as any

    // GR รอบสอง: รับน้ำมันพืชทั้งหมด
    const gr2created = createGoodsReceipt(user.tenantId, user.email, {
      purchaseOrderId: poId,
      items: [{ poItemId: (db.prepare("SELECT id FROM purchase_order_items WHERE purchase_order_id = ? AND description = 'น้ำมันพืช'").get(poId) as any).id,
        materialId: mat2, orderedQty: 4, receivedQty: 4, acceptedQty: 4 }],
    }) as any
    const gr2 = confirmGoodsReceipt(user.tenantId, 'u1', gr2created.id) as any

    const res = parseOk(await tools['create_purchase_invoice']({ goods_receipt_ids: [gr1.gr_number, gr2.gr_number] }))
    expect(res.success, res.message).toBe(true)
    // 10*50 + 4*50 = 700
    expect(res.สรุปยอด.มูลค่าก่อนภาษี).toBe(700)
    expect(res.สรุปยอด.ยอดรวม).toBeCloseTo(749, 5)
  })
})

describe('MCP pay_supplier', () => {
  async function setupInvoice(role = 'ADMIN') {
    const user = createTestUser({ role: role as any })
    const { server, tools } = fakeServer()
    registerPurchaseBillingTools(server, user.tenantId, user.userId, user.email, role)
    const { poId } = seedApprovedPo(user.tenantId, [{ description: 'ไข่ไก่', qty: 10, unitPrice: 50 }])
    const gr = receiveWholePo(user.tenantId, user.email, poId)
    const invRes = parseOk(await tools['create_purchase_invoice']({ goods_receipt_ids: [gr.gr_number] }))
    return { user, tools, invRes }
  }

  it('จ่ายเงินแล้ว paid_amount/balance_amount/payment_status ถูก และ journal ดุล', async () => {
    const { tools, invRes } = await setupInvoice('ADMIN')
    // ยอดรวม 535 — จ่ายบางส่วน 300
    const res = parseOk(await tools['pay_supplier']({ purchase_invoice_id: invRes.piId, amount: 300 }))
    expect(res.success, res.message).toBe(true)
    expect(res.ตาราง.ยอดจ่าย).toBe(300)
    expect(res.ตาราง.คงค้างหลังจ่าย).toBeCloseTo(235, 5)
    expect(res.ตาราง.สถานะการจ่าย).toBe('PARTIAL')

    const pi = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(invRes.piId) as any
    expect(pi.paid_amount).toBeCloseTo(300, 5)
    expect(pi.balance_amount).toBeCloseTo(235, 5)
    expect(pi.payment_status).toBe('PARTIAL')

    const journal = db.prepare("SELECT * FROM journal_entries WHERE reference_type = 'SUPPLIER_PAYMENT' AND reference_id = ?").get(res.paymentId) as any
    expect(journal).toBeTruthy()
    const lineSums = sumJournalLines(journal.id)
    expect(lineSums.debit).toBeCloseTo(lineSums.credit, 5)
    expect(lineSums.debit).toBeCloseTo(300, 5)
  })

  it('จ่ายจนครบยอด แล้วสถานะเป็น PAID', async () => {
    const { tools, invRes } = await setupInvoice('ADMIN')
    const res = parseOk(await tools['pay_supplier']({ purchase_invoice_id: invRes.piId, amount: 535 }))
    expect(res.success, res.message).toBe(true)
    expect(res.ตาราง.สถานะการจ่าย).toBe('PAID')
    expect(res.ตาราง.คงค้างหลังจ่าย).toBeCloseTo(0, 5)
  })

  it('จ่ายเกินยอดค้างไม่ได้', async () => {
    const { tools, invRes } = await setupInvoice('ADMIN')
    const res = parseOk(await tools['pay_supplier']({ purchase_invoice_id: invRes.piId, amount: 9999 }))
    expect(res.success).toBe(false)
    expect(res.message).toMatch(/exceeds|เกิน/i)
  })

  it('รองรับภาษีหัก ณ ที่จ่าย — เงินสดออกจริงหักแล้ว', async () => {
    const { tools, invRes } = await setupInvoice('ADMIN')
    const res = parseOk(await tools['pay_supplier']({ purchase_invoice_id: invRes.piId, amount: 535, withholding_tax: 15 }))
    expect(res.success, res.message).toBe(true)
    expect(res.ตาราง.เงินสดออกจริง).toBeCloseTo(520, 5)
    // journal ต้องดุลแม้มี WHT แยกบรรทัด
    const journal = db.prepare("SELECT * FROM journal_entries WHERE reference_type = 'SUPPLIER_PAYMENT' AND reference_id = ?").get(res.paymentId) as any
    const lineSums = sumJournalLines(journal.id)
    expect(lineSums.debit).toBeCloseTo(lineSums.credit, 5)
    expect(lineSums.debit).toBeCloseTo(535, 5)
  })

  it('ผู้ใช้สิทธิ์ USER (ไม่ใช่ ADMIN/MANAGER/MASTER/POWERUSER) จ่ายเงินไม่ได้', async () => {
    const { tools, invRes } = await setupInvoice('USER')
    const res = parseOk(await tools['pay_supplier']({ purchase_invoice_id: invRes.piId, amount: 100 }))
    expect(res.success).toBe(false)
    expect(res.message).toContain('ไม่มีสิทธิ์')

    // ต้องไม่มีการเขียนอะไรลง DB เลย — เช็คสิทธิ์ก่อนแตะ service
    const paymentCount = (db.prepare('SELECT COUNT(*) as c FROM supplier_payments WHERE purchase_invoice_id = ?').get(invRes.piId) as any).c
    expect(paymentCount).toBe(0)
  })
})
