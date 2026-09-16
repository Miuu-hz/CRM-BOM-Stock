import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createPurchaseInvoice, paySupplier, PurchaseBillingError } from './purchaseBilling.service'
import { createGoodsReceipt, confirmGoodsReceipt } from './goodsReceipt.service'
import { createTestUser } from '../test/testAuth'

/**
 * บั๊กที่เจอจริง (PO-2026-00029): ออกใบแจ้งหนี้โดยไม่เลือกใบรับสินค้า
 * → ระบบไม่ตีตรา invoiced_at ให้ GR ของ PO นั้น
 * → ใบสั่งซื้อยังโผล่ในตัวเลือก "สร้างใบแจ้งหนี้" ทั้งที่ออกไปแล้ว พอกดก็ถูกเด้งว่าซ้ำ
 */
function seedPoWithConfirmedGr(tenantId: string, userEmail: string) {
  const supplierId = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')")
    .run(supplierId, tenantId, supplierId)
  const poId = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_rate, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'APPROVED', 100, 7, 7, 107, ?, ?)
  `).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, now, now)

  const materialId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, 'ของทดสอบ', 'raw', 0, 'pcs', 'pcs', 10, 'STOCK', 'ACTIVE')
  `).run(materialId, tenantId, 'SKU-' + materialId.slice(0, 8))
  db.prepare(`
    INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty)
    VALUES (?, ?, ?, ?, 'ของทดสอบ', 10, 'pcs', 10, 100, 0)
  `).run(generateId(), tenantId, poId, materialId)

  const created = createGoodsReceipt(tenantId, userEmail, { purchaseOrderId: poId }) as any
  const gr = confirmGoodsReceipt(tenantId, 'u1', created.id) as any
  return { poId, grId: gr.id }
}

describe('ใบแจ้งหนี้ซื้อ — ล็อกใบรับสินค้าไม่ให้ออกซ้ำ', () => {
  it('ออกใบคลุมทั้ง PO (ไม่เลือก GR) ต้องตีตรา GR ของ PO นั้นด้วย', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId, grId } = seedPoWithConfirmedGr(user.tenantId, user.email)

    const before = db.prepare('SELECT invoiced_at FROM goods_receipts WHERE id = ?').get(grId) as any
    expect(before.invoiced_at).toBeNull()

    const inv = createPurchaseInvoice(user.tenantId, user.email, {
      purchaseOrderId: poId, supplierInvoiceNumber: 'TAX-001',
    }) as any

    const after = db.prepare('SELECT invoiced_at FROM goods_receipts WHERE id = ?').get(grId) as any
    expect(after.invoiced_at).toBeTruthy()          // เดิมยังเป็น null → ต้นเหตุของบั๊ก

    const row = db.prepare('SELECT goods_receipt_ids FROM purchase_invoices WHERE id = ?').get(inv.id) as any
    expect(JSON.parse(row.goods_receipt_ids)).toContain(grId)   // ยกเลิกใบแล้วต้องปลดล็อกคืนได้
  })

  it('ยอดยังคิดจาก PO เหมือนเดิม ไม่ได้เปลี่ยนเป็นยอดจาก GR', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId } = seedPoWithConfirmedGr(user.tenantId, user.email)
    const inv = createPurchaseInvoice(user.tenantId, user.email, {
      purchaseOrderId: poId, supplierInvoiceNumber: 'TAX-002',
    }) as any
    expect(inv.subtotal).toBe(100)
    expect(inv.total_amount).toBeCloseTo(107, 2)
  })

  it('ออกใบซ้ำใบที่สองต้องถูกปฏิเสธ', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId } = seedPoWithConfirmedGr(user.tenantId, user.email)
    createPurchaseInvoice(user.tenantId, user.email, {
      purchaseOrderId: poId, supplierInvoiceNumber: 'TAX-003',
    })
    expect(() => createPurchaseInvoice(user.tenantId, user.email, {
      purchaseOrderId: poId, supplierInvoiceNumber: 'TAX-004',
    })).toThrow(PurchaseBillingError)
  })

  it('PO ที่ไม่มี GR เลย ยังออกใบได้ตามเดิม และกันใบซ้ำได้', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const supplierId = generateId()
    db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')")
      .run(supplierId, user.tenantId, supplierId)
    const poId = generateId()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_rate, tax_amount, total_amount, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'APPROVED', 50, 7, 3.5, 53.5, ?, ?)
    `).run(poId, user.tenantId, 'PO-' + poId.slice(0, 6), supplierId, now, now)

    const inv = createPurchaseInvoice(user.tenantId, user.email, {
      purchaseOrderId: poId, supplierInvoiceNumber: 'TAX-005',
    }) as any
    expect(inv.subtotal).toBe(50)
    expect(() => createPurchaseInvoice(user.tenantId, user.email, {
      purchaseOrderId: poId, supplierInvoiceNumber: 'TAX-006',
    })).toThrow(/มีใบแจ้งหนี้อยู่แล้ว/)
  })
})

describe('journal ของใบแจ้งหนี้ซื้อ/จ่ายเงิน ต้อง is_posted = 1 (เดิมไม่ใส่คอลัมน์นี้เลย รายงานการเงินมองไม่เห็น)', () => {
  it('ออกใบแจ้งหนี้ซื้อ → journal_entries แถวใหม่ต้อง is_posted = 1', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId } = seedPoWithConfirmedGr(user.tenantId, user.email)

    const inv = createPurchaseInvoice(user.tenantId, user.email, {
      purchaseOrderId: poId, supplierInvoiceNumber: 'TAX-POST-01',
    }) as any

    const journal = db.prepare(
      "SELECT is_posted, is_auto_generated, posted_by FROM journal_entries WHERE reference_type = 'PURCHASE_INVOICE' AND reference_id = ?"
    ).get(inv.id) as any
    expect(journal).toBeTruthy()
    expect(journal.is_posted).toBe(1)
    expect(journal.is_auto_generated).toBe(1)
    expect(journal.posted_by).toBe(user.email)
  })

  it('จ่ายเงินซัพพลายเออร์ → journal_entries แถวใหม่ต้อง is_posted = 1', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId } = seedPoWithConfirmedGr(user.tenantId, user.email)
    const inv = createPurchaseInvoice(user.tenantId, user.email, {
      purchaseOrderId: poId, supplierInvoiceNumber: 'TAX-POST-02',
    }) as any

    const payment = paySupplier(user.tenantId, user.email, {
      supplierId: inv.supplier_id, purchaseInvoiceId: inv.id, amount: inv.total_amount,
    }) as any

    const journal = db.prepare(
      "SELECT is_posted, is_auto_generated FROM journal_entries WHERE reference_type = 'SUPPLIER_PAYMENT' AND reference_id = ?"
    ).get(payment.id) as any
    expect(journal).toBeTruthy()
    expect(journal.is_posted).toBe(1)
    expect(journal.is_auto_generated).toBe(1)
  })
})
