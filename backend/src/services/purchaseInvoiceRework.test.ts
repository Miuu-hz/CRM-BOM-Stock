import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createPurchaseInvoice, updatePurchaseInvoice, paySupplier, PurchaseBillingError } from './purchaseBilling.service'
import { createGoodsReceipt, confirmGoodsReceipt, getPendingPoItems } from './goodsReceipt.service'
import { createTestUser } from '../test/testAuth'
import { ACC } from '../config/accountCodes'

/**
 * เทสต์ยกเครื่องใบแจ้งหนี้ซื้อ 2026-09-29 (GR-centric, รวมหลาย PO, แก้ไขได้)
 * ครอบคลุม 6 เคสตามสรุปงาน: รวม GR ข้าม PO, ผู้ขายคนละรายถูกปฏิเสธก่อนเบิร์นเลข,
 * PO-only ขยายเป็น GR อัตโนมัติ/ไม่มี GR แล้ว throw, แก้หัวบิลไม่แตะ journal,
 * แก้ราคาบิลที่จ่ายแล้ว repost journal ถูก, GR ยืนยันทับ PI เก่าที่ไม่มี GR ไม่ลง 2109 ซ้ำ
 */

function balanceOf(tenantId: string, code: string) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS bal
    FROM journal_lines l JOIN accounts a ON a.id = l.account_id
    WHERE l.tenant_id = ? AND a.code = ?
  `).get(tenantId, code) as any
  return Math.round((row.bal || 0) * 100) / 100
}

function seedSupplier(tenantId: string, taxId?: string) {
  const id = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name, tax_id) VALUES (?, ?, ?, 'ผู้ขายทดสอบ', 'C', ?)")
    .run(id, tenantId, id, taxId ?? null)
  return id
}

/** PO 1 รายการ + GR ที่ยืนยันแล้วรับครบตามจำนวน (ของจริงเข้าคลัง+ตั้งค้างรับ 2109) */
function seedApprovedPoWithGr(tenantId: string, userEmail: string, supplierId: string, qty: number, price: number) {
  const poId = generateId()
  const now = new Date().toISOString()
  const sub = qty * price
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_rate, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'APPROVED', ?, 7, ?, ?, ?, ?)
  `).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, sub, sub * 0.07, sub * 1.07, now, now)

  const materialId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, 'ของทดสอบ', 'raw', 0, 'pcs', 'pcs', ?, 'STOCK', 'ACTIVE')
  `).run(materialId, tenantId, 'SKU-' + materialId.slice(0, 8), price)
  const poItemId = generateId()
  db.prepare(`
    INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty)
    VALUES (?, ?, ?, ?, 'ของทดสอบ', ?, 'pcs', ?, ?, 0)
  `).run(poItemId, tenantId, poId, materialId, qty, price, sub)

  const pending = getPendingPoItems(tenantId, poId)
  const created = createGoodsReceipt(tenantId, userEmail, {
    purchaseOrderId: poId,
    items: pending.map(p => ({ poItemId: p.id, materialId: p.material_id, orderedQty: p.quantity, receivedQty: p.pending_qty, acceptedQty: p.pending_qty })),
  }) as any
  const gr = confirmGoodsReceipt(tenantId, 'u1', created.id) as any
  return { poId, poItemId, materialId, grId: gr.id }
}

describe('1) รวม GR หลายใบ ข้าม PO ไว้ในบิลเดียว', () => {
  it('ล็อก GR ทุกใบ + ปิด 2109 เต็มยอด (ไม่ใช่แค่ PO หลัก)', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const sup = seedSupplier(user.tenantId)
    const a = seedApprovedPoWithGr(user.tenantId, user.email, sup, 10, 10) // 100
    const b = seedApprovedPoWithGr(user.tenantId, user.email, sup, 5, 40) // 200

    const inv = createPurchaseInvoice(user.tenantId, user.email, {
      goodsReceiptIds: [a.grId, b.grId],
      supplierInvoiceNumber: 'MERGE-1',
    }) as any

    expect(inv.subtotal).toBe(300)
    expect(inv.purchase_order_id).toBe(a.poId) // PO ของ GR ใบแรก
    expect(JSON.parse(inv.purchase_order_ids)).toEqual(expect.arrayContaining([a.poId, b.poId]))
    expect(JSON.parse(inv.goods_receipt_ids)).toEqual(expect.arrayContaining([a.grId, b.grId]))

    const grRows = db.prepare('SELECT id, invoiced_at FROM goods_receipts WHERE id IN (?, ?)').all(a.grId, b.grId) as any[]
    for (const r of grRows) expect(r.invoiced_at, `${r.id} ต้องถูกล็อก`).toBeTruthy()

    expect(balanceOf(user.tenantId, ACC.GRNI), 'ทั้ง 2 GR ต้องถูกปิดค้างรับครบ').toBe(0)
    expect(balanceOf(user.tenantId, ACC.RAW_MATERIAL), 'ต้นทุนลงครั้งเดียวรวมทั้ง 2 PO').toBe(300)
  })
})

describe('2) ผู้ขายคนละรายถูกปฏิเสธก่อนเบิร์นเลขที่เอกสาร', () => {
  it('PO_SUPPLIER_MISMATCH ไม่กินเลขที่ PI', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const a = seedApprovedPoWithGr(user.tenantId, user.email, seedSupplier(user.tenantId, '1111111111111'), 10, 10)
    const b = seedApprovedPoWithGr(user.tenantId, user.email, seedSupplier(user.tenantId, '2222222222222'), 5, 40)

    const year = new Date().getFullYear()
    const before = (db.prepare(
      "SELECT last_number FROM document_sequences WHERE tenant_id = ? AND doc_type = 'PURCHASE_INVOICE' AND year = ?"
    ).get(user.tenantId, year) as any)?.last_number || 0

    expect(() => createPurchaseInvoice(user.tenantId, user.email, {
      goodsReceiptIds: [a.grId, b.grId],
    })).toThrow(/คนละราย/)

    const after = (db.prepare(
      "SELECT last_number FROM document_sequences WHERE tenant_id = ? AND doc_type = 'PURCHASE_INVOICE' AND year = ?"
    ).get(user.tenantId, year) as any)?.last_number || 0
    expect(after, 'request ที่ถูกปฏิเสธต้องไม่เบิร์นเลขที่เอกสาร').toBe(before)
  })
})

describe('3) purchaseOrderId เดิม (ไม่ส่ง GR) ต้องขยายเป็น GR อัตโนมัติ / ไม่มี GR ต้อง throw NO_GR', () => {
  it('ส่ง purchaseOrderId อย่างเดียว → ขยายไปหา GR ที่ยืนยันแล้วให้เอง', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const a = seedApprovedPoWithGr(user.tenantId, user.email, seedSupplier(user.tenantId), 4, 25) // 100
    const inv = createPurchaseInvoice(user.tenantId, user.email, { purchaseOrderId: a.poId }) as any
    expect(inv.subtotal).toBe(100)
    expect(JSON.parse(inv.goods_receipt_ids)).toEqual([a.grId])
  })

  it('PO ไม่มี GR ที่ยืนยันแล้วเลย → NO_GR', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const supplierId = seedSupplier(user.tenantId)
    const poId = generateId()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_rate, tax_amount, total_amount, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'APPROVED', 50, 7, 3.5, 53.5, ?, ?)
    `).run(poId, user.tenantId, 'PO-' + poId.slice(0, 6), supplierId, now, now)

    let caught: any = null
    try {
      createPurchaseInvoice(user.tenantId, user.email, { purchaseOrderId: poId })
    } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(PurchaseBillingError)
    expect(caught.code).toBe('NO_GR')
    expect(caught.message).toContain('ต้องยืนยันรับของ (GR) ก่อนออกใบแจ้งหนี้')
  })
})

describe('4) แก้ไขหัวบิลอย่างเดียวไม่แตะ journal', () => {
  it('แก้ notes/dueDate → journal เดิมไม่เปลี่ยน ไม่มีแถวใหม่', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const a = seedApprovedPoWithGr(user.tenantId, user.email, seedSupplier(user.tenantId), 10, 10)
    const inv = createPurchaseInvoice(user.tenantId, user.email, { purchaseOrderId: a.poId, supplierInvoiceNumber: 'HDR-1' }) as any

    const journalBefore = db.prepare(
      "SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = 'PURCHASE_INVOICE' AND reference_id = ?"
    ).get(user.tenantId, inv.id) as any
    expect(journalBefore).toBeTruthy()

    const updated = updatePurchaseInvoice(user.tenantId, user.email, inv.id, {
      notes: 'แก้หมายเหตุ', dueDate: '2026-12-31',
    }) as any
    expect(updated.notes).toBe('แก้หมายเหตุ')
    expect(updated.due_date).toBe('2026-12-31')
    // ยอด/journal ต้องเหมือนเดิมเป๊ะ
    expect(updated.total_amount).toBeCloseTo(inv.total_amount, 5)

    const journalAfter = db.prepare(
      "SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = 'PURCHASE_INVOICE' AND reference_id = ?"
    ).get(user.tenantId, inv.id) as any
    expect(journalAfter.id).toBe(journalBefore.id) // journal แถวเดิม ไม่ใช่แถวใหม่
    expect(journalAfter.total_debit).toBeCloseTo(journalBefore.total_debit, 5)

    const editJournalCount = (db.prepare(
      "SELECT COUNT(*) c FROM journal_entries WHERE tenant_id = ? AND reference_type = 'PURCHASE_INVOICE_EDIT' AND reference_id = ?"
    ).get(user.tenantId, inv.id) as any).c
    expect(editJournalCount, 'แก้หัวบิลไม่ควรมี journal กลับรายการเกิดขึ้นเลย').toBe(0)
  })
})

describe('5) แก้ไขราคาใบที่จ่ายเงินไปแล้ว', () => {
  it('reverse+repost journal ถูก ดุล บวก balance คำนวณใหม่ถูก', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const a = seedApprovedPoWithGr(user.tenantId, user.email, seedSupplier(user.tenantId), 10, 10) // 100 subtotal, tax 7 -> total 107
    const inv = createPurchaseInvoice(user.tenantId, user.email, { purchaseOrderId: a.poId, supplierInvoiceNumber: 'EDIT-1' }) as any
    expect(inv.total_amount).toBeCloseTo(107, 2)

    paySupplier(user.tenantId, user.email, { supplierId: inv.supplier_id, purchaseInvoiceId: inv.id, amount: 107 })
    const paidInv = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(inv.id) as any
    expect(paidInv.payment_status).toBe('PAID')

    const item = db.prepare('SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = ?').get(inv.id) as any

    // ขึ้นราคาจาก 10 -> 20: subtotal ใหม่ 200, tax 14, total 214, balance = 214-107=107 (PARTIAL)
    const updated = updatePurchaseInvoice(user.tenantId, user.email, inv.id, {
      items: [{ id: item.id, unitPrice: 20 }],
    }) as any
    expect(updated.subtotal).toBe(200)
    expect(updated.tax_amount).toBeCloseTo(14, 2)
    expect(updated.total_amount).toBeCloseTo(214, 2)
    expect(updated.paid_amount).toBeCloseTo(107, 2)
    expect(updated.balance_amount).toBeCloseTo(107, 2)
    expect(updated.payment_status).toBe('PARTIAL')

    // journal เดิมถูก superseded ไปแล้ว เจอแถว current แค่แถวเดียว debit=credit
    const currentJournal = db.prepare(
      "SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = 'PURCHASE_INVOICE' AND reference_id = ?"
    ).get(user.tenantId, inv.id) as any
    expect(currentJournal).toBeTruthy()
    expect(currentJournal.total_debit).toBeCloseTo(214, 2)
    const lines = db.prepare('SELECT debit, credit FROM journal_lines WHERE journal_entry_id = ?').all(currentJournal.id) as any[]
    const sums = lines.reduce((acc, l) => ({ d: acc.d + l.debit, c: acc.c + l.credit }), { d: 0, c: 0 })
    expect(sums.d).toBeCloseTo(sums.c, 5)
    expect(sums.d).toBeCloseTo(214, 2)

    const supersededCount = (db.prepare(
      "SELECT COUNT(*) c FROM journal_entries WHERE tenant_id = ? AND reference_type = 'PURCHASE_INVOICE_SUPERSEDED' AND reference_id = ?"
    ).get(user.tenantId, inv.id) as any).c
    expect(supersededCount).toBe(1)
  })

  it('ยอดใหม่ต่ำกว่ายอดที่จ่ายไปแล้ว → ถูกปฏิเสธ', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const a = seedApprovedPoWithGr(user.tenantId, user.email, seedSupplier(user.tenantId), 10, 10)
    const inv = createPurchaseInvoice(user.tenantId, user.email, { purchaseOrderId: a.poId, supplierInvoiceNumber: 'EDIT-2' }) as any
    paySupplier(user.tenantId, user.email, { supplierId: inv.supplier_id, purchaseInvoiceId: inv.id, amount: 107 })

    const item = db.prepare('SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = ?').get(inv.id) as any
    expect(() => updatePurchaseInvoice(user.tenantId, user.email, inv.id, {
      items: [{ id: item.id, unitPrice: 1 }], // total ใหม่ ~10.7 < paid 107
    })).toThrow(/ยกเลิกการจ่ายเงิน/)
  })
})

describe('6) ยืนยัน GR ทับ PI เก่าที่ไม่มี GR (ข้อมูลก่อน 2026-09-29) ไม่ลง 2109 ซ้ำ', () => {
  it('เข้าคลังตามปกติ + ล็อก GR แต่ไม่โพสต์ Dr สต็อก/Cr 2109 ซ้ำ', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const supplierId = seedSupplier(user.tenantId)
    const poId = generateId()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_rate, tax_amount, total_amount, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'APPROVED', 100, 7, 7, 107, ?, ?)
    `).run(poId, user.tenantId, 'PO-' + poId.slice(0, 6), supplierId, now, now)
    const materialId = generateId()
    db.prepare(`
      INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
      VALUES (?, ?, ?, 'ของทดสอบ', 'raw', 5, 'pcs', 'pcs', 10, 'STOCK', 'ACTIVE')
    `).run(materialId, user.tenantId, 'SKU-' + materialId.slice(0, 8))
    const poItemId = generateId()
    db.prepare(`
      INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty)
      VALUES (?, ?, ?, ?, 'ของทดสอบ', 10, 'pcs', 10, 100, 0)
    `).run(poItemId, user.tenantId, poId, materialId)

    // สร้างใบแจ้งหนี้ "เก่าแบบไม่มี GR" ตรง ๆ ด้วย SQL (ก่อน 2026-09-29 ทางนี้ยังออกได้จริง)
    const piId = generateId()
    db.prepare(`
      INSERT INTO purchase_invoices (id, tenant_id, pi_number, purchase_order_id, purchase_order_ids, supplier_id,
        goods_receipt_ids, invoice_date, subtotal, tax_rate, tax_amount, total_amount, balance_amount, status, payment_status, created_at, updated_at)
      VALUES (?, ?, 'PI-LEGACY-1', ?, ?, ?, '[]', ?, 100, 7, 7, 107, 107, 'ISSUED', 'UNPAID', ?, ?)
    `).run(piId, user.tenantId, poId, JSON.stringify([poId]), supplierId, now, now, now)

    const stockBefore = (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(materialId) as any).quantity

    const pending = getPendingPoItems(user.tenantId, poId)
    const created = createGoodsReceipt(user.tenantId, user.email, {
      purchaseOrderId: poId,
      items: pending.map(p => ({ poItemId: p.id, materialId: p.material_id, orderedQty: p.quantity, receivedQty: p.pending_qty, acceptedQty: p.pending_qty })),
    }) as any
    const gr = confirmGoodsReceipt(user.tenantId, user.userId, created.id) as any

    const stockAfter = (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(materialId) as any).quantity
    expect(stockAfter - stockBefore, 'ของต้องเข้าคลังตามปกติ').toBe(10)

    // ห้ามมี journal ของ GR นี้เลย (ไม่ลง Dr สต็อก/Cr 2109 ซ้ำ เพราะ PI เก่า Dr สต็อกไปเต็มจำนวนแล้ว)
    const grJournal = db.prepare(
      "SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = 'GOODS_RECEIPT' AND reference_id = ?"
    ).get(user.tenantId, gr.id) as any
    expect(grJournal, 'ต้องไม่โพสต์ journal ให้ GR นี้เลย').toBeFalsy()

    // GR ถูกล็อกไว้ (invoiced_at) กันออกใบซ้ำ + ผูกกลับเข้า PI เดิม
    const grRow = db.prepare('SELECT invoiced_at FROM goods_receipts WHERE id = ?').get(gr.id) as any
    expect(grRow.invoiced_at).toBeTruthy()
    const piRow = db.prepare('SELECT goods_receipt_ids FROM purchase_invoices WHERE id = ?').get(piId) as any
    expect(JSON.parse(piRow.goods_receipt_ids)).toEqual([gr.id])
  })
})
