import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createPurchaseInvoice, paySupplier, PurchaseBillingError } from './purchaseBilling.service'
import { createGoodsReceipt, confirmGoodsReceipt, getPendingPoItems } from './goodsReceipt.service'
import { createTestUser } from '../test/testAuth'

/**
 * Phase 1 (2026-10-03): journal ใบแจ้งหนี้ซื้อต้องดุลถึงสตางค์เสมอ + paySupplier กันใบยกเลิก/
 * เศษ float/งวดปิด — ตัวเลขของ 2 เคสแรกก๊อปมาจากใบจริงของ Kids House Cafe ที่ลงบัญชีไม่ดุล
 *   PI-025-021026: subtotal 168.585 → เดิม Dr 168.58 + 11.80 = 180.38 แต่ Cr 2101 180.39
 *   PI-018-021026: subtotal 976.916 → เดิม Dr 2109 976.916 (ไม่ปัด) ต่างจาก Cr 0.004
 */

const r2 = (n: number) => Math.round(n * 100) / 100

function seedSupplier(tenantId: string) {
  const id = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'ผู้ขายทดสอบ', 'C')")
    .run(id, tenantId, id)
  return id
}

/** PO หลายบรรทัด (แยก VAT 7%) + GR ยืนยันแล้วรับครบ */
function seedPoWithGr(tenantId: string, userEmail: string, supplierId: string, lines: [number, number][]) {
  const poId = generateId()
  const now = new Date().toISOString()
  const sub = lines.reduce((s, [q, p]) => s + q * p, 0)
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_rate, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'APPROVED', ?, 7, ?, ?, ?, ?)
  `).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, sub, r2(sub * 0.07), r2(sub * 1.07), now, now)
  for (const [qty, price] of lines) {
    const materialId = generateId()
    db.prepare(`
      INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
      VALUES (?, ?, ?, 'ของทดสอบ', 'raw', 0, 'kg', 'kg', ?, 'STOCK', 'ACTIVE')
    `).run(materialId, tenantId, 'SKU-' + materialId.slice(0, 8), price)
    db.prepare(`
      INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty)
      VALUES (?, ?, ?, ?, 'ของทดสอบ', ?, 'kg', ?, ?, 0)
    `).run(generateId(), tenantId, poId, materialId, qty, price, qty * price)
  }
  const pending = getPendingPoItems(tenantId, poId)
  const created = createGoodsReceipt(tenantId, userEmail, {
    purchaseOrderId: poId,
    items: pending.map(p => ({ poItemId: p.id, materialId: p.material_id, orderedQty: p.quantity, receivedQty: p.pending_qty, acceptedQty: p.pending_qty })),
  }) as any
  const gr = confirmGoodsReceipt(tenantId, 'u1', created.id) as any
  return { poId, grId: gr.id as string }
}

function journalOf(referenceType: string, referenceId: string) {
  const je = db.prepare('SELECT * FROM journal_entries WHERE reference_type = ? AND reference_id = ?').get(referenceType, referenceId) as any
  const lines = db.prepare('SELECT debit, credit FROM journal_lines WHERE journal_entry_id = ?').all(je.id) as any[]
  const dr = r2(lines.reduce((s, l) => s + l.debit, 0))
  const cr = r2(lines.reduce((s, l) => s + l.credit, 0))
  return { je, lines, dr, cr }
}

/** ทุกบรรทัดเป็นสตางค์ ไม่มีเศษ 3 ตำแหน่ง + ดุล + หัวรายการ = ผลรวมบรรทัด */
function expectBalanced(j: ReturnType<typeof journalOf>, expectedTotal: number) {
  for (const l of j.lines) {
    expect(r2(l.debit)).toBe(l.debit)
    expect(r2(l.credit)).toBe(l.credit)
  }
  expect(j.dr).toBe(expectedTotal)
  expect(j.cr).toBe(expectedTotal)
  expect(j.je.total_debit).toBe(j.dr)
  expect(j.je.total_credit).toBe(j.cr)
}

describe('journal ใบแจ้งหนี้ซื้อดุลถึงสตางค์ (เคสจริง)', () => {
  it('PI-025-021026: subtotal 168.585 @7% แยก → Dr รวม = Cr 180.39', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const g = seedPoWithGr(user.tenantId, user.email, seedSupplier(user.tenantId), [[1.285, 86], [0.505, 115]])
    const inv = createPurchaseInvoice(user.tenantId, user.email, { goodsReceiptIds: [g.grId], autoPay: false }) as any
    expect(inv.total_amount).toBe(180.39)
    expect(inv.tax_amount).toBe(11.8)
    expectBalanced(journalOf('PURCHASE_INVOICE', inv.id), 180.39)
  })

  it('PI-018-021026: subtotal 976.916 @7% แยก → ไม่มีบรรทัด 976.916, Dr รวม = Cr 1045.30', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const g = seedPoWithGr(user.tenantId, user.email, seedSupplier(user.tenantId), [
      [1.118, 124], [1.908, 87], [1.112, 215], [1.294, 45], [1.542, 69], [1.4, 129], [1, 69], [1, 18.98],
    ])
    const inv = createPurchaseInvoice(user.tenantId, user.email, { goodsReceiptIds: [g.grId], autoPay: false }) as any
    expect(inv.total_amount).toBe(1045.3)
    expectBalanced(journalOf('PURCHASE_INVOICE', inv.id), 1045.3)
  })

  it('มีส่วนลดท้ายบิล (โหมดแยก VAT) ก็ยังดุล', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const g = seedPoWithGr(user.tenantId, user.email, seedSupplier(user.tenantId), [[10, 10]])
    const inv = createPurchaseInvoice(user.tenantId, user.email, { goodsReceiptIds: [g.grId], discountAmount: 10, autoPay: false }) as any
    // ฐาน 90 ภาษี 6.30 รวม 96.30
    expect(inv.total_amount).toBe(96.3)
    expectBalanced(journalOf('PURCHASE_INVOICE', inv.id), 96.3)
  })
})

describe('paySupplier', () => {
  function issuedInvoice() {
    const user = createTestUser({ role: 'ADMIN' })
    const sup = seedSupplier(user.tenantId)
    const g = seedPoWithGr(user.tenantId, user.email, sup, [[1.285, 86], [0.505, 115]])
    const inv = createPurchaseInvoice(user.tenantId, user.email, { goodsReceiptIds: [g.grId], autoPay: false }) as any
    return { user, sup, inv }
  }

  it('ใบที่ยกเลิกแล้วจ่ายไม่ได้ (เดิมกันแค่ใน MCP tool)', () => {
    const { user, sup, inv } = issuedInvoice()
    db.prepare("UPDATE purchase_invoices SET status = 'CANCELLED' WHERE id = ?").run(inv.id)
    let caught: any = null
    try { paySupplier(user.tenantId, user.email, { supplierId: sup, purchaseInvoiceId: inv.id, amount: 10 }) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(PurchaseBillingError)
    expect(caught.code).toBe('INVOICE_CANCELLED')
    expect((db.prepare('SELECT COUNT(*) c FROM supplier_payments WHERE purchase_invoice_id = ?').get(inv.id) as any).c).toBe(0)
  })

  it('ยอดคงค้างมีเศษ float → จ่ายเต็มได้, balance ปัดเป็น 0 และ PAID', () => {
    const { user, sup, inv } = issuedInvoice()
    db.prepare('UPDATE purchase_invoices SET balance_amount = ? WHERE id = ?').run(180.38999999, inv.id)
    const pay = paySupplier(user.tenantId, user.email, { supplierId: sup, purchaseInvoiceId: inv.id, amount: 180.39 }) as any
    expect(pay.invoice.balance_amount).toBe(0)
    expect(pay.invoice.payment_status).toBe('PAID')
    expectBalanced(journalOf('SUPPLIER_PAYMENT', pay.id), 180.39)
  })

  it('จ่ายบางส่วน 2 ครั้ง → paid/balance ปัดเป็นสตางค์', () => {
    const { user, sup, inv } = issuedInvoice()
    paySupplier(user.tenantId, user.email, { supplierId: sup, purchaseInvoiceId: inv.id, amount: 0.1 })
    const pay = paySupplier(user.tenantId, user.email, { supplierId: sup, purchaseInvoiceId: inv.id, amount: 0.2 }) as any
    expect(pay.invoice.paid_amount).toBe(0.3)
    expect(pay.invoice.balance_amount).toBe(180.09)
    expect(pay.invoice.payment_status).toBe('PARTIAL')
  })

  it('จ่ายเกินเกินครึ่งสตางค์ยังโดน OVER_BALANCE', () => {
    const { user, sup, inv } = issuedInvoice()
    expect(() => paySupplier(user.tenantId, user.email, { supplierId: sup, purchaseInvoiceId: inv.id, amount: 180.4 }))
      .toThrow(PurchaseBillingError)
  })

  it('หัว journal จ่ายเงินมี WHT = ผลรวมบรรทัด', () => {
    const { user, sup, inv } = issuedInvoice()
    const pay = paySupplier(user.tenantId, user.email, { supplierId: sup, purchaseInvoiceId: inv.id, amount: 100, withholdingTax: 3 }) as any
    expectBalanced(journalOf('SUPPLIER_PAYMENT', pay.id), 100)
  })
})

describe('งวดปิดบัญชี — create/pay ใช้กติกาเดียวกับ updatePurchaseInvoice', () => {
  function closePeriod(tenantId: string, year: number, month: number) {
    db.prepare(`INSERT INTO tax_periods (id, tenant_id, year, month, period_type, start_date, end_date, status)
      VALUES (?, ?, ?, ?, 'MONTHLY', ?, ?, 'CLOSED')`).run(generateId(), tenantId, year, month, `${year}-01-01`, `${year}-01-31`)
  }

  it('ออกใบแจ้งหนี้ลงวันที่ในงวดปิด → PERIOD_CLOSED และไม่ล็อก GR', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const g = seedPoWithGr(user.tenantId, user.email, seedSupplier(user.tenantId), [[10, 10]])
    closePeriod(user.tenantId, 2025, 1)
    let caught: any = null
    try { createPurchaseInvoice(user.tenantId, user.email, { goodsReceiptIds: [g.grId], invoiceDate: '2025-01-15', autoPay: false }) } catch (e) { caught = e }
    expect(caught?.code).toBe('PERIOD_CLOSED')
    expect((db.prepare('SELECT invoiced_at FROM goods_receipts WHERE id = ?').get(g.grId) as any).invoiced_at).toBeFalsy()
  })

  it('จ่ายเงินลงวันที่ในงวดปิด → PERIOD_CLOSED', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const sup = seedSupplier(user.tenantId)
    const g = seedPoWithGr(user.tenantId, user.email, sup, [[10, 10]])
    const inv = createPurchaseInvoice(user.tenantId, user.email, { goodsReceiptIds: [g.grId], autoPay: false }) as any
    closePeriod(user.tenantId, 2025, 2)
    let caught: any = null
    try { paySupplier(user.tenantId, user.email, { supplierId: sup, purchaseInvoiceId: inv.id, amount: 10, paymentDate: '2025-02-10' }) } catch (e) { caught = e }
    expect(caught?.code).toBe('PERIOD_CLOSED')
  })
})
