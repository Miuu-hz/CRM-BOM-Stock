import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import creditNotesRouter from './creditNotes'
import { createTestUser } from '../../test/testAuth'
import { ACC } from '../../config/accountCodes'

/**
 * restoreCreditNoteStock() เดิมคืนสต็อกเข้าคลังตอนใบลดหนี้มีของคืนจริง (credit_note_items)
 * แต่ไม่เคยกลับรายการต้นทุนขาย (COGS) เลย — credit_notes อยู่ในบัญชีแต่ของที่คืนไม่ลด COGS/
 * เพิ่มสต็อกในงบ ทำให้ต้นทุนขายในงบสูงเกินจริงถาวรหลังมีการคืนของ
 */
function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/sales/credit-notes', authenticate, creditNotesRouter)
  return app
}
const app = buildApp()

function seedReturnScenario(tenantId: string, issuedUnitCost: number) {
  const customerId = generateId()
  db.prepare(`
    INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city)
    VALUES (?, ?, ?, 'ลูกค้าทดสอบ', 'RETAIL', '-', '-', '-', '-')
  `).run(customerId, tenantId, 'CUST-' + customerId.slice(0, 6))

  const productId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, 'สินค้าทดสอบ', 'FINISHED', 0, 'pcs', 'pcs', 999, 'STOCK', 'ACTIVE')
  `).run(productId, tenantId, 'SKU-' + productId.slice(0, 8))
  // unit_cost = 999 ปัจจุบัน แต่ต้นทุนที่ควรกลับรายการต้องมาจาก issued_unit_cost (ต้นทุน ณ
  // ตอนขายจริง) ไม่ใช่ตัวเลขนี้ — พิสูจน์ว่าไม่ได้หยิบ unit_cost ปัจจุบันมาใช้ผิดตัว

  const soId = generateId()
  db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id) VALUES (?, ?, ?, ?)`)
    .run(soId, tenantId, 'SO-' + soId.slice(0, 6), customerId)

  const soItemId = generateId()
  db.prepare(`
    INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, quantity, unit, issued_unit_cost)
    VALUES (?, ?, ?, ?, 5, 'pcs', ?)
  `).run(soItemId, tenantId, soId, productId, issuedUnitCost)

  const invoiceId = generateId()
  db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id) VALUES (?, ?, ?, ?, ?)`)
    .run(invoiceId, tenantId, 'INV-' + invoiceId.slice(0, 6), soId, customerId)

  const invoiceItemId = generateId()
  db.prepare(`
    INSERT INTO invoice_items (id, tenant_id, invoice_id, sales_order_item_id, stock_item_id, product_name, quantity, unit_price, total_price)
    VALUES (?, ?, ?, ?, ?, 'สินค้าทดสอบ', 5, 50, 250)
  `).run(invoiceItemId, tenantId, invoiceId, soItemId, productId)

  const cnId = generateId()
  db.prepare(`
    INSERT INTO credit_notes (id, tenant_id, cn_number, invoice_id, customer_id, credit_date, reason, subtotal, tax_rate, tax_amount, total_amount, status)
    VALUES (?, ?, ?, ?, ?, ?, 'รับคืนสินค้า', 150, 0, 0, 150, 'DRAFT')
  `).run(cnId, tenantId, 'CN-' + cnId.slice(0, 6), invoiceId, customerId, new Date().toISOString())

  // คืน 3 หน่วยจาก 5 ที่ขายไป
  db.prepare(`
    INSERT INTO credit_note_items (id, tenant_id, credit_note_id, invoice_item_id, quantity, unit_price, total_price)
    VALUES (?, ?, ?, ?, 3, 50, 150)
  `).run(generateId(), tenantId, cnId, invoiceItemId)

  return { cnId, productId }
}

describe('PUT /credit-notes/:id/status ISSUED — กลับรายการ COGS เมื่อมีของคืนจริง', () => {
  it('คืน 3 หน่วย ต้นทุน ณ ตอนขาย (issued_unit_cost) = 20/หน่วย → Dr สต็อก 60 / Cr ต้นทุนขาย 60', async () => {
    const { tenantId, token } = createTestUser()
    const { cnId, productId } = seedReturnScenario(tenantId, 20)

    const res = await request(app)
      .put(`/api/sales/credit-notes/${cnId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ISSUED' })

    expect(res.status, JSON.stringify(res.body)).toBe(200)

    const je = db.prepare(`
      SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = 'CREDIT_NOTE_COGS' AND reference_id = ?
    `).get(tenantId, cnId) as any
    expect(je, 'ไม่พบ journal CREDIT_NOTE_COGS').toBeTruthy()

    const lines = db.prepare(`
      SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
      JOIN accounts a ON a.id = jl.account_id
      WHERE jl.journal_entry_id = ?
    `).all(je.id) as any[]
    const inv = lines.find(l => l.code === ACC.INVENTORY)
    const cogs = lines.find(l => l.code === ACC.COGS_PRODUCT)
    expect(inv?.debit).toBe(60)
    expect(cogs?.credit).toBe(60)

    const stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(productId) as any
    expect(stock.quantity).toBe(3)
  })

  it('ใบลดหนี้ไม่มีของคืน (ไม่มี credit_note_items) → ไม่ลง CREDIT_NOTE_COGS เลย', async () => {
    const { tenantId, token } = createTestUser()
    const customerId = generateId()
    db.prepare(`
      INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city)
      VALUES (?, ?, ?, 'ลูกค้าทดสอบ', 'RETAIL', '-', '-', '-', '-')
    `).run(customerId, tenantId, 'CUST-' + customerId.slice(0, 6))
    const soId = generateId()
    db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id) VALUES (?, ?, ?, ?)`)
      .run(soId, tenantId, 'SO-' + soId.slice(0, 6), customerId)
    const invoiceId = generateId()
    db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id) VALUES (?, ?, ?, ?, ?)`)
      .run(invoiceId, tenantId, 'INV-' + invoiceId.slice(0, 6), soId, customerId)
    const cnId = generateId()
    db.prepare(`
      INSERT INTO credit_notes (id, tenant_id, cn_number, invoice_id, customer_id, credit_date, reason, subtotal, tax_rate, tax_amount, total_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, 'ลดราคาหลังขาย', 100, 0, 0, 100, 'DRAFT')
    `).run(cnId, tenantId, 'CN-' + cnId.slice(0, 6), invoiceId, customerId, new Date().toISOString())

    const res = await request(app)
      .put(`/api/sales/credit-notes/${cnId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ISSUED' })

    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const je = db.prepare(`
      SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = 'CREDIT_NOTE_COGS' AND reference_id = ?
    `).get(tenantId, cnId)
    expect(je).toBeUndefined()
  })
})
