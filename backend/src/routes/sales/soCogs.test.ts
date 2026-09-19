import { describe, it, expect, afterEach } from 'vitest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { deductStockForSO, restoreStockForSO } from './shared'
import { createInvoiceFromSO } from '../../services/salesBilling.service'
import { ACC } from '../../config/accountCodes'

/**
 * ต้นทุนขายต้องลงตอนตัดสต็อก (ยืนยัน SO) ไม่ใช่ตอนออกใบแจ้งหนี้ — ดูรูปแบบจาก grni.test.ts
 * (ฝั่งจัดซื้อ ปัญหาเดียวกัน: ราคาต้นทุน ณ ตอนตัดจริง vs ตอนออกเอกสารทีหลังอาจไม่ตรงกัน)
 */

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_lines', 'journal_entries', 'vat_entries', 'receipts', 'invoice_items', 'invoices',
                       'stock_movements', 'sales_order_items', 'sales_orders', 'customers', 'stock_items',
                       'accounts', 'document_sequences', 'company_settings']) {
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

/** ลูกค้า + สินค้ามีต้นทุน + SO ยืนยันแล้ว 1 รายการ (ยังไม่ตัดสต็อก) */
function setupSO(qty = 5, unitPrice = 200, unitCost = 120) {
  const t = 'test_so_cogs_' + generateId()
  tenants.push(t)
  db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock) VALUES (?, ?, 0)').run(t, 'test')

  const customerId = generateId()
  db.prepare(`INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, status, created_at, updated_at)
              VALUES (?, ?, ?, 'ลูกค้าทดสอบ', 'RETAIL', '-', '', '', '', 'ACTIVE', datetime('now'), datetime('now'))`)
    .run(customerId, t, 'CUS-' + customerId.slice(0, 6))

  const stockId = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
              VALUES (?, ?, ?, 'สินค้าทดสอบ', 'FG', 100, 'pcs', 'pcs', ?, 'MAIN', 'ACTIVE')`)
    .run(stockId, t, 'SKU-' + stockId.slice(0, 6), unitCost)

  const totalAmount = qty * unitPrice
  const soId = generateId()
  const soNumber = 'SO-TEST-' + soId.slice(0, 6)
  db.prepare(`
    INSERT INTO sales_orders (id, tenant_id, so_number, quotation_id, customer_id, order_date, delivery_date,
      subtotal, discount_amount, tax_rate, tax_amount, total_amount, status, payment_status, notes, created_at, updated_at)
    VALUES (?, ?, ?, NULL, ?, datetime('now'), NULL, ?, 0, 0, 0, ?, 'CONFIRMED', 'UNPAID', '', datetime('now'), datetime('now'))
  `).run(soId, t, soNumber, customerId, totalAmount, totalAmount)

  const soItemId = generateId()
  db.prepare(`
    INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_id, product_name, quantity, unit, unit_price, discount_percent, total_price, notes)
    VALUES (?, ?, ?, ?, NULL, 'สินค้าทดสอบ', ?, 'pcs', ?, 0, ?, '')
  `).run(soItemId, t, soId, stockId, qty, unitPrice, totalAmount)

  return { tenantId: t, soId, soNumber, soItemId, stockId, totalAmount, qty, unitCost }
}

describe('ต้นทุนขายลงตอนตัดสต็อก (SO_COGS)', () => {
  it('ยืนยัน SO แล้ว 5101 เดบิต / 1106 เครดิต เท่าต้นทุนจริง และเขียน issued_unit_cost', () => {
    const { tenantId, soId, soNumber, soItemId, qty, unitCost } = setupSO()
    const expectedCogs = qty * unitCost

    deductStockForSO(tenantId, soId, soNumber)

    expect(balanceOf(tenantId, ACC.COGS_PRODUCT), 'ต้นทุนขายต้องลงทันทีตอนตัดสต็อก').toBe(expectedCogs)
    expect(balanceOf(tenantId, ACC.INVENTORY), 'สต็อกในงบต้องลดตามมูลค่าที่ตัดจริง').toBe(-expectedCogs)

    const item = db.prepare('SELECT issued_unit_cost FROM sales_order_items WHERE id = ?').get(soItemId) as any
    expect(item.issued_unit_cost, 'ต้องบันทึกต้นทุนต่อหน่วยฐาน ณ วินาทีตัดสต็อกไว้ที่บรรทัด SO').toBe(unitCost)
  })

  it('ออกใบแจ้งหนี้ต่อจากนั้น ต้นทุนไม่ถูกลงซ้ำ แต่ลูกหนี้/รายได้เกิดตามปกติ', () => {
    const { tenantId, soId, soNumber, qty, unitCost, totalAmount } = setupSO()
    const expectedCogs = qty * unitCost
    deductStockForSO(tenantId, soId, soNumber)

    const { invoice } = createInvoiceFromSO(tenantId, { salesOrderId: soId })

    expect(balanceOf(tenantId, ACC.COGS_PRODUCT), 'ออกใบแจ้งหนี้แล้วต้นทุนต้องไม่ถูกนับซ้ำ').toBe(expectedCogs)
    expect(balanceOf(tenantId, ACC.AR)).toBe(totalAmount)
    expect(balanceOf(tenantId, ACC.REVENUE_PRODUCT)).toBe(-totalAmount)
    expect(invoice.status).toBe('DRAFT')

    const cogsCount = (db.prepare("SELECT COUNT(*) c FROM journal_entries WHERE tenant_id = ? AND reference_type = 'SO_COGS'").get(tenantId) as any).c
    expect(cogsCount, 'ต้องมี journal ต้นทุนขายแค่ใบเดียวตลอดวงจร').toBe(1)
  })

  it('ยกเลิก SO แล้วต้นทุนถูกกลับรายการ', () => {
    const { tenantId, soId, soNumber, qty, unitCost } = setupSO()
    const expectedCogs = qty * unitCost
    deductStockForSO(tenantId, soId, soNumber)
    expect(balanceOf(tenantId, ACC.COGS_PRODUCT)).toBe(expectedCogs)

    restoreStockForSO(tenantId, soId, soNumber)

    expect(balanceOf(tenantId, ACC.COGS_PRODUCT), 'ยกเลิกแล้วต้นทุนขายต้องกลับเป็นศูนย์').toBe(0)
    expect(balanceOf(tenantId, ACC.INVENTORY), 'สต็อกในงบต้องกลับเป็นศูนย์ตามที่คืนของ').toBe(0)

    const cancelEntry = db.prepare("SELECT id FROM journal_entries WHERE tenant_id = ? AND reference_type = 'SO_COGS_CANCEL'").get(tenantId)
    expect(cancelEntry, 'ต้องมี journal กลับรายการต้นทุนขาย').toBeTruthy()
  })

  it('ลงบัญชีไม่ได้ (journal ชนกัน) แล้วใบแจ้งหนี้ต้องไม่ถูกสร้างค้างอยู่', () => {
    // สาขา INVOICE ของ createSalesJournal ยังเป็น raw INSERT (ไม่ผ่าน postJournal) เลขที่ header
    // total_debit/credit ที่ส่งเข้ามาจึง "ดุล" เสมอโดยโครงสร้าง — บังคับให้ลงไม่ได้จริงด้วยการยึด
    // เลขที่ JV ตัวถัดไปของ tenant นี้ไปดักไว้ก่อน (UNIQUE(tenant_id, entry_number)) ให้ผลเหมือนกับ
    // "ลงบัญชีไม่ได้" ทุกประการ — ต้อง throw ออกมาแล้ว (ไม่ใช่ swallow) และรอบสร้างใบแจ้งหนี้ทั้งใบ
    // (ที่อยู่ในทรานแซกชันเดียวกันตอนนี้) ต้องถูก rollback ไปด้วย
    const { tenantId, soId } = setupSO()
    const year = new Date().getFullYear()
    db.prepare(`
      INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at)
      VALUES (?, ?, ?, date('now'), 'MANUAL', NULL, 'กันเลขที่ JV ไว้ทดสอบ', 0, 0, 0, 1, 'test', datetime('now'), datetime('now'))
    `).run(generateId(), tenantId, `JV-${year}-00001`)

    expect(() => createInvoiceFromSO(tenantId, { salesOrderId: soId })).toThrow()

    const invoiceCount = (db.prepare('SELECT COUNT(*) c FROM invoices WHERE tenant_id = ?').get(tenantId) as any).c
    expect(invoiceCount, 'ลงบัญชีไม่ได้ ใบแจ้งหนี้ต้องไม่ถูกสร้างค้างอยู่').toBe(0)
  })
})
