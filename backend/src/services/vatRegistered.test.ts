import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import { createPurchaseInvoice } from './purchaseBilling.service'
import { createGoodsReceipt, confirmGoodsReceipt } from './goodsReceipt.service'
import { ACC } from '../config/accountCodes'

// Kids House ยังไม่จด VAT แต่ระบบตั้ง 1110 ภาษีซื้อไว้ ฿548.42 (2026-09-28)
// ยังไม่จด = ภาษีซื้อขอคืนไม่ได้ ต้องรวมเป็นต้นทุนของ และไม่เข้าทะเบียนภาษีซื้อ

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_lines', 'journal_entries', 'purchase_invoice_items', 'purchase_invoices',
                       'goods_receipt_items', 'goods_receipts', 'purchase_order_items', 'purchase_orders',
                       'stock_movements', 'stock_items', 'suppliers', 'accounts', 'users',
                       'document_sequences', 'vat_entries', 'company_settings']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* ข้ามตารางที่ไม่มี tenant_id */ }
    }
  }
})

const balanceOf = (tenantId: string, code: string) => {
  const row = db.prepare(`SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS bal
    FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.tenant_id = ? AND a.code = ?`).get(tenantId, code) as any
  return Math.round((row.bal || 0) * 100) / 100
}

/** ซื้อของ 10 × 100 = 1,000 + VAT 7% = 1,070 */
function buy(vatRegistered: number | null) {
  const user = createTestUser({ role: 'ADMIN' })
  const t = user.tenantId
  tenants.push(t)
  if (vatRegistered !== null) {
    db.prepare(`INSERT INTO company_settings (tenant_id, name) VALUES (?, 'ทดสอบ')`).run(t)
    db.prepare('UPDATE company_settings SET vat_registered = ? WHERE tenant_id = ?').run(vatRegistered, t)
  }
  const supplierId = generateId()
  db.prepare(`INSERT INTO suppliers (id, tenant_id, code, name, contact_name, email, phone, status)
              VALUES (?, ?, ?, 'ผู้ขาย', 'x', 'x@example.com', '0800000000', 'ACTIVE')`).run(supplierId, t, 'S-' + supplierId.slice(0, 6))
  const stockId = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
              VALUES (?, ?, ?, 'ของ', 'RAW', 0, 'kg', 'kg', 0, 'MAIN', 'ACTIVE')`).run(stockId, t, 'K-' + stockId.slice(0, 6))
  const poId = generateId()
  db.prepare(`INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, order_date, subtotal, tax_amount, total_amount, status)
              VALUES (?, ?, ?, ?, date('now'), 1000, 70, 1070, 'APPROVED')`).run(poId, t, 'PO-T-' + poId.slice(0, 5), supplierId)
  const poItemId = generateId()
  db.prepare(`INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, received_qty, unit, unit_price, total_price)
              VALUES (?, ?, ?, ?, 'ของ', 10, 0, 'kg', 100, 1000)`).run(poItemId, t, poId, stockId)
  // ต้องมี GR ที่ยืนยันแล้วก่อนออกใบแจ้งหนี้ (2026-09-29 ตัดทางออกบิลตรงไม่ผ่าน GR ทิ้งแล้ว)
  const gr = createGoodsReceipt(t, user.email, {
    purchaseOrderId: poId,
    items: [{ poItemId, materialId: stockId, orderedQty: 10, receivedQty: 10, acceptedQty: 10 }],
  }) as any
  confirmGoodsReceipt(t, user.userId, gr.id)
  createPurchaseInvoice(t, user.email, {
    purchaseOrderId: poId, supplierInvoiceNumber: 'INV-1', taxRate: 7,
  } as any)
  const vatRows = (db.prepare('SELECT COUNT(*) c FROM vat_entries WHERE tenant_id = ?').get(t) as any).c
  return { t, vatRows }
}

describe('ภาษีซื้อ ตามสถานะจดทะเบียน VAT', () => {
  it('ยังไม่จด VAT: ภาษีรวมเข้าต้นทุนของ 1107 ไม่มียอด 1110 และไม่เข้าทะเบียนภาษีซื้อ', () => {
    const { t, vatRows } = buy(0)
    expect(balanceOf(t, ACC.INPUT_VAT)).toBe(0)
    expect(balanceOf(t, ACC.RAW_MATERIAL)).toBe(1070)
    expect(balanceOf(t, ACC.AP)).toBe(-1070)
    expect(vatRows).toBe(0)
  })

  it('จด VAT แล้ว: แยกภาษีซื้อ 1110 และลงทะเบียนภาษีซื้อเหมือนเดิม', () => {
    const { t, vatRows } = buy(1)
    expect(balanceOf(t, ACC.INPUT_VAT)).toBe(70)
    expect(balanceOf(t, ACC.RAW_MATERIAL)).toBe(1000)
    expect(vatRows).toBe(1)
  })

  it('ไม่มีแถวตั้งค่าบริษัท = ถือว่าจดแล้ว (พฤติกรรมเดิม)', () => {
    const { t } = buy(null)
    expect(balanceOf(t, ACC.INPUT_VAT)).toBe(70)
  })
})
