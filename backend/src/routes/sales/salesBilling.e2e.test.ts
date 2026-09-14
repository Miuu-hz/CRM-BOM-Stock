import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import { createTestUser } from '../../test/testAuth'
import salesOrdersRouter from './salesOrders'
import invoicesRouter from './invoices'
import receiptsRouter from './receipts'

/**
 * ทดสอบเพิ่มที่ระดับ REST (ไม่ใช่แค่ MCP) สำหรับ 2 บั๊กที่แก้ในงานนี้ (2026-09-14):
 *   1) ออกใบแจ้งหนี้ซ้ำจาก SO เดิม
 *   2) รับชำระกับใบแจ้งหนี้ที่ถูกยกเลิกไปแล้ว
 * ทั้งสองจุดตอนนี้เช็คใน services/salesBilling.service.ts ตัวเดียวที่ REST และ MCP เรียกร่วมกัน
 */
const app = express()
app.use(express.json())
app.use('/api/sales-orders', authenticate, salesOrdersRouter)
app.use('/api/invoices', authenticate, invoicesRouter)
app.use('/api/receipts', authenticate, receiptsRouter)

const tenants: string[] = []
function setup() {
  const user = createTestUser({ role: 'ADMIN' })
  tenants.push(user.tenantId)
  const t = user.tenantId
  db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock) VALUES (?, ?, 0)').run(t, 'ร้านทดสอบ')

  const customerId = generateId()
  db.prepare(`
    INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, address, city, status)
    VALUES (?, ?, ?, 'ลูกค้าทดสอบ', 'RETAIL', '-', 'x@example.com', '0800000000', '1 ถนนทดสอบ', 'BKK', 'ACTIVE')
  `).run(customerId, t, 'CUS-' + customerId.slice(0, 6))

  const stockId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status, unit_cost, unit_price)
    VALUES (?, ?, ?, 'สินค้าทดสอบ', 'FINISHED', 100, 'pcs', 'pcs', 'MAIN', 'ACTIVE', 60, 100)
  `).run(stockId, t, 'SKU-' + stockId.slice(0, 6))

  return { ...user, customerId, stockId, auth: (r: any) => r.set('Authorization', 'Bearer ' + user.token) }
}

afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const table of ['journal_lines', 'journal_entries', 'receipts', 'invoice_items', 'invoices',
      'sales_order_items', 'sales_orders', 'customers', 'stock_items', 'accounts', 'document_sequences',
      'company_settings', 'users']) {
      try { db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(t) } catch { /* ตารางไม่มีคอลัมน์นี้ */ }
    }
  }
})

describe('REST POST /api/invoices — กันออกใบแจ้งหนี้ซ้ำจาก SO เดิม', () => {
  it('ยิงสร้างใบแจ้งหนี้ 2 ครั้งจาก SO เดียวกัน → ครั้งที่สองถูกบล็อก 409', async () => {
    const s = setup()
    const line = { productId: s.stockId, productName: 'สินค้าทดสอบ', quantity: 5, unit: 'pcs', unitPrice: 100 }
    const so = await s.auth(request(app).post('/api/sales-orders')).send({ customerId: s.customerId, items: [line], taxRate: 0 })
    const soId = so.body.data.id

    const first = await s.auth(request(app).post('/api/invoices')).send({ salesOrderId: soId })
    expect(first.status).toBe(201)

    const second = await s.auth(request(app).post('/api/invoices')).send({ salesOrderId: soId })
    expect(second.status, 'ออกซ้ำต้องถูกบล็อก ไม่ใช่สร้างใบที่สอง').toBe(409)
    expect(second.body.success).toBe(false)

    const count = (db.prepare('SELECT COUNT(*) c FROM invoices WHERE sales_order_id = ?').get(soId) as any).c
    expect(count, 'ต้องมีใบแจ้งหนี้แค่ใบเดียว ไม่ลงบัญชีซ้ำ').toBe(1)
    const journalCount = (db.prepare("SELECT COUNT(*) c FROM journal_entries WHERE tenant_id = ? AND reference_type = 'INVOICE'").get(s.tenantId) as any).c
    expect(journalCount).toBe(1)
  })
})

describe('REST POST /api/receipts — กันรับชำระกับใบแจ้งหนี้ที่ถูกยกเลิกแล้ว', () => {
  it('ยกเลิกใบแจ้งหนี้แล้วพยายามรับชำระ → ถูกบล็อก', async () => {
    const s = setup()
    const line = { productId: s.stockId, productName: 'สินค้าทดสอบ', quantity: 5, unit: 'pcs', unitPrice: 100 }
    const so = await s.auth(request(app).post('/api/sales-orders')).send({ customerId: s.customerId, items: [line], taxRate: 0 })
    const soId = so.body.data.id

    const inv = await s.auth(request(app).post('/api/invoices')).send({ salesOrderId: soId })
    const invoiceId = inv.body.data.id

    const cancel = await s.auth(request(app).put(`/api/invoices/${invoiceId}/status`)).send({ status: 'CANCELLED' })
    expect(cancel.status).toBe(200)

    const pay = await s.auth(request(app).post('/api/receipts')).send({ invoiceId, amount: 100, paymentMethod: 'CASH' })
    expect(pay.status, 'รับชำระกับใบที่ถูกยกเลิกไปแล้วต้องถูกบล็อก').toBe(400)
    expect(pay.body.success).toBe(false)

    const receiptCount = (db.prepare('SELECT COUNT(*) c FROM receipts WHERE invoice_id = ?').get(invoiceId) as any).c
    expect(receiptCount).toBe(0)
  })
})
