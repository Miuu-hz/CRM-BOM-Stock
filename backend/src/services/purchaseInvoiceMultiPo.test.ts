import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createPurchaseInvoice, PurchaseBillingError } from './purchaseBilling.service'
import { createGoodsReceipt, confirmGoodsReceipt } from './goodsReceipt.service'
import { createTestUser } from '../test/testAuth'

/**
 * บั๊กที่เจ้าของเจอจริง 2026-09-17 ตอนรวมหลายใบสั่งซื้อไว้ในบิลเดียว:
 *   1. ใบที่เอามารวม (extra PO) ไม่เคยถูกล็อก → ยังโผล่ใน dropdown ให้เลือกซ้ำได้ตลอด
 *   2. ใบแจ้งหนี้ไม่มีรายการสินค้าเลยสักบรรทัด (ตอนนั้นว่าง 13 จาก 13 ใบ)
 *      เพราะ derive รายการจาก "ใบรับสินค้าที่ผู้ใช้เจาะจงเลือก" เท่านั้น
 *      พอสร้างจาก dropdown ใบสั่งซื้อตรง ๆ จึงไม่มีอะไรเลย ยอดไปโผล่แค่ตอนบวกครั้งสุดท้าย
 */
function seedSupplier(tenantId: string, taxId?: string) {
  const id = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name, tax_id) VALUES (?, ?, ?, 'ผู้ขายทดสอบ', 'C', ?)")
    .run(id, tenantId, id, taxId ?? null)
  return id
}

function seedPo(tenantId: string, userEmail: string, supplierId: string, qty: number, price: number) {
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
  db.prepare(`
    INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty)
    VALUES (?, ?, ?, ?, 'ของทดสอบ', ?, 'pcs', ?, ?, 0)
  `).run(generateId(), tenantId, poId, materialId, qty, price, sub)

  const created = createGoodsReceipt(tenantId, userEmail, { purchaseOrderId: poId }) as any
  const gr = confirmGoodsReceipt(tenantId, 'u1', created.id) as any
  return { poId, grId: gr.id }
}

describe('ใบแจ้งหนี้ซื้อ — รวมหลายใบสั่งซื้อไว้ในบิลเดียว', () => {
  it('ยอดต้องรวมทุกใบ และมีรายการสินค้าครบทุกใบ (ไม่ใช่บิลเปล่า)', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const sup = seedSupplier(user.tenantId)
    const a = seedPo(user.tenantId, user.email, sup, 10, 10)   // 100
    const b = seedPo(user.tenantId, user.email, sup, 5, 40)    // 200

    const inv = createPurchaseInvoice(user.tenantId, user.email, {
      purchaseOrderId: a.poId,
      purchaseOrderIds: [a.poId, b.poId],
      supplierInvoiceNumber: 'TAX-M1',
    }) as any

    expect(inv.subtotal).toBe(300)
    expect(inv.total_amount).toBeCloseTo(321, 2)

    // เดิมตารางนี้ว่างเปล่า — ผู้ใช้เห็นแต่ยอดรวม ไม่รู้ว่าเงินมาจากของอะไรบ้าง
    const items = db.prepare('SELECT quantity, unit_price FROM purchase_invoice_items WHERE purchase_invoice_id = ?').all(inv.id) as any[]
    expect(items).toHaveLength(2)
    expect(items.reduce((s, r) => s + r.quantity * r.unit_price, 0)).toBe(300)
  })

  it('ใบรับสินค้าของใบที่เอามารวม ต้องถูกล็อกด้วย ไม่ใช่แค่ใบหลัก', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const sup = seedSupplier(user.tenantId)
    const a = seedPo(user.tenantId, user.email, sup, 10, 10)
    const b = seedPo(user.tenantId, user.email, sup, 5, 40)

    createPurchaseInvoice(user.tenantId, user.email, {
      purchaseOrderId: a.poId, purchaseOrderIds: [a.poId, b.poId], supplierInvoiceNumber: 'TAX-M2',
    })

    const rows = db.prepare('SELECT id, invoiced_at FROM goods_receipts WHERE id IN (?, ?)').all(a.grId, b.grId) as any[]
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(r.invoiced_at).toBeTruthy()   // ใบ b เคยค้างเป็น null → ต้นเหตุของบั๊ก
  })

  it('ใบที่ถูกรวมไปแล้ว เอามาออกบิลใหม่อีกไม่ได้', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const sup = seedSupplier(user.tenantId)
    const a = seedPo(user.tenantId, user.email, sup, 10, 10)
    const b = seedPo(user.tenantId, user.email, sup, 5, 40)

    createPurchaseInvoice(user.tenantId, user.email, {
      purchaseOrderId: a.poId, purchaseOrderIds: [a.poId, b.poId], supplierInvoiceNumber: 'TAX-M3',
    })
    expect(() => createPurchaseInvoice(user.tenantId, user.email, {
      purchaseOrderId: b.poId, supplierInvoiceNumber: 'TAX-M4',
    })).toThrow(PurchaseBillingError)
  })

  it('ผู้ขายคนละราย รวมเข้าบิลเดียวกันไม่ได้ (หนี้/ใบกำกับต้องแยกตามนิติบุคคล)', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const a = seedPo(user.tenantId, user.email, seedSupplier(user.tenantId, '1111111111111'), 10, 10)
    const b = seedPo(user.tenantId, user.email, seedSupplier(user.tenantId, '2222222222222'), 5, 40)

    expect(() => createPurchaseInvoice(user.tenantId, user.email, {
      purchaseOrderId: a.poId, purchaseOrderIds: [a.poId, b.poId], supplierInvoiceNumber: 'TAX-M5',
    })).toThrow(/คนละราย/)
  })

  it('ใบเดียวไม่มีของรวม ยอดและรายการต้องยังถูกเหมือนเดิม', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const a = seedPo(user.tenantId, user.email, seedSupplier(user.tenantId), 10, 10)
    const inv = createPurchaseInvoice(user.tenantId, user.email, {
      purchaseOrderId: a.poId, supplierInvoiceNumber: 'TAX-M6',
    }) as any
    expect(inv.subtotal).toBe(100)
    const items = db.prepare('SELECT COUNT(*) n FROM purchase_invoice_items WHERE purchase_invoice_id = ?').get(inv.id) as any
    expect(items.n).toBe(1)
  })
})
