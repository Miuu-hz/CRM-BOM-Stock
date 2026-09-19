import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import { confirmGoodsReceipt } from './goodsReceipt.service'
import { createPurchaseInvoice } from './purchaseBilling.service'
import { ACC } from '../config/accountCodes'

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_lines', 'journal_entries', 'purchase_invoice_items', 'purchase_invoices',
                       'goods_receipt_items', 'goods_receipts', 'purchase_order_items', 'purchase_orders',
                       'stock_movements', 'stock_items', 'suppliers', 'accounts', 'users',
                       'document_sequences', 'vat_entries']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* ข้ามตารางที่ไม่มี tenant_id */ }
    }
  }
})

/** ยอดคงเหลือของบัญชี = เดบิต − เครดิต */
function balanceOf(tenantId: string, code: string) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS bal
    FROM journal_lines l JOIN accounts a ON a.id = l.account_id
    WHERE l.tenant_id = ? AND a.code = ?
  `).get(tenantId, code) as any
  return Math.round((row.bal || 0) * 100) / 100
}

/** ใบสั่งซื้อ 1 รายการ 10 หน่วย หน่วยละ 100 + ใบรับสินค้าสถานะร่างที่รับครบ */
function seedPoAndGr(tenantId: string, qty = 10, price = 100) {
  const supplierId = generateId()
  db.prepare(`INSERT INTO suppliers (id, tenant_id, code, name, contact_name, email, phone, status)
              VALUES (?, ?, ?, 'ผู้ขายทดสอบ', 'x', 'x@example.com', '0800000000', 'ACTIVE')`)
    .run(supplierId, tenantId, 'SUP-' + supplierId.slice(0, 6))

  const stockId = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
              VALUES (?, ?, ?, 'วัตถุดิบทดสอบ', 'RAW', 0, 'kg', 'kg', 0, 'MAIN', 'ACTIVE')`)
    .run(stockId, tenantId, 'SKU-' + stockId.slice(0, 6))

  const poId = generateId()
  db.prepare(`INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, order_date, subtotal, tax_amount, total_amount, status)
              VALUES (?, ?, ?, ?, date('now'), ?, 0, ?, 'APPROVED')`)
    .run(poId, tenantId, 'PO-TEST-' + poId.slice(0, 5), supplierId, qty * price, qty * price)

  const poItemId = generateId()
  db.prepare(`INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, received_qty, unit, unit_price, total_price)
              VALUES (?, ?, ?, ?, 'วัตถุดิบทดสอบ', ?, 0, 'kg', ?, ?)`)
    .run(poItemId, tenantId, poId, stockId, qty, price, qty * price)

  const grId = generateId()
  db.prepare(`INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, receipt_date, status)
              VALUES (?, ?, ?, ?, ?, date('now'), 'DRAFT')`)
    .run(grId, tenantId, 'GR-TEST-' + grId.slice(0, 5), poId, supplierId)
  db.prepare(`INSERT INTO goods_receipt_items (id, tenant_id, goods_receipt_id, purchase_order_item_id, material_id, ordered_qty, received_qty, accepted_qty, rejected_qty)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`)
    .run(generateId(), tenantId, grId, poItemId, stockId, qty, qty, qty)

  return { poId, grId, stockId, supplierId, poItemId, value: qty * price }
}

describe('ของรับแล้วยังไม่ได้รับใบแจ้งหนี้ (2109)', () => {
  it('ยืนยันใบรับสินค้าแล้วตั้งค้างรับของทันที ไม่ต้องรอใบแจ้งหนี้', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const { grId, value } = seedPoAndGr(user.tenantId)

    confirmGoodsReceipt(user.tenantId, user.userId, grId)

    expect(balanceOf(user.tenantId, ACC.RAW_MATERIAL), 'ของเข้าคลังต้องมีมูลค่าในงบทันที').toBe(value)
    expect(balanceOf(user.tenantId, ACC.GRNI), '2109 เป็นหนี้สิน ยอดอยู่ฝั่งเครดิต').toBe(-value)
  })

  it('ออกใบแจ้งหนี้แล้ว 2109 กลับเป็นศูนย์ และสต็อกไม่ถูก Dr ซ้ำ', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const { poId, grId, value } = seedPoAndGr(user.tenantId)

    confirmGoodsReceipt(user.tenantId, user.userId, grId)
    createPurchaseInvoice(user.tenantId, user.email, {
      purchaseOrderId: poId,
      goodsReceiptIds: [grId],
      supplierInvoiceNumber: 'INV-ผู้ขาย-001',
      taxRate: 0,
    })

    expect(balanceOf(user.tenantId, ACC.GRNI), 'ได้ใบแจ้งหนี้แล้วบัญชีพักต้องเป็นศูนย์').toBe(0)
    expect(balanceOf(user.tenantId, ACC.RAW_MATERIAL), 'สต็อกต้องมีมูลค่าครั้งเดียว ไม่ใช่สองครั้ง').toBe(value)
    expect(balanceOf(user.tenantId, ACC.AP), 'เจ้าหนี้การค้าเกิดตอนได้ใบแจ้งหนี้').toBe(-value)
  })

  it('ไม่มีใบรับสินค้า (ซื้อแล้ววางบิลตรง) ยังลง Dr สต็อกตามเดิม', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const { poId, poItemId, value } = seedPoAndGr(user.tenantId)

    createPurchaseInvoice(user.tenantId, user.email, {
      purchaseOrderId: poId,
      supplierInvoiceNumber: 'INV-ตรง-001',
      taxRate: 0,
      items: [{ poItemId, quantity: 10, unitPrice: 100 }],
    })

    expect(balanceOf(user.tenantId, ACC.GRNI), 'ไม่เคยรับของผ่าน GR ก็ไม่ต้องมีบัญชีพัก').toBe(0)
    expect(balanceOf(user.tenantId, ACC.RAW_MATERIAL)).toBe(value)
  })
})
