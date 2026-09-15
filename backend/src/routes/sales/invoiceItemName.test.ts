import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import invoicesRouter from './invoices'
import quotationsRouter from './quotations'
import { createTestUser } from '../../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/invoices', authenticate, invoicesRouter)
app.use('/api/quotations', authenticate, quotationsRouter)

/**
 * `SELECT ii.*, p.name as product_name` + `LEFT JOIN products` = คอลัมน์ชื่อซ้ำกัน
 * ตัวหลังทับตัวหน้า ⇒ เอา null (เพราะ products เป็นตารางที่เลิกใช้แล้ว) ไปทับชื่อสินค้าจริง
 * ที่เก็บอยู่ในแถว ⇒ **ใบแจ้งหนี้/ใบเสร็จที่ส่งให้ลูกค้าไม่มีชื่อสินค้า**
 * (invoice_items ไม่มีคอลัมน์ description ให้ fallback ตอนพิมพ์จึงเหลือแค่ "-")
 */
function seedInvoiceWithItem(tenantId: string, productName: string) {
  const customerId = generateId()
  db.prepare(`
    INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, tenant_id)
    VALUES (?, ?, 'ลูกค้าทดสอบ', 'RETAIL', 'x', 'x@example.com', '0800000000', 'BKK', ?)
  `).run(customerId, 'CUS-' + customerId.slice(0, 8), tenantId)

  const soId = generateId()
  db.prepare(`
    INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, total_amount, status)
    VALUES (?, ?, ?, ?, 100, 'CONFIRMED')
  `).run(soId, tenantId, 'SO-TEST-' + soId.slice(0, 8), customerId)

  const invId = generateId()
  db.prepare(`
    INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, invoice_date,
      subtotal, tax_amount, total_amount, paid_amount, balance_amount, status, payment_status)
    VALUES (?, ?, ?, ?, ?, ?, 100, 0, 100, 0, 100, 'ISSUED', 'UNPAID')
  `).run(invId, tenantId, 'INV-TEST-' + invId.slice(0, 8), soId, customerId, new Date().toISOString().slice(0, 10))

  // product_id เป็น NULL เหมือนข้อมูลจริงทุกแถว (19/19) — ชื่ออยู่ที่ product_name
  db.prepare(`
    INSERT INTO invoice_items (id, tenant_id, invoice_id, sales_order_item_id, stock_item_id, product_id,
      product_name, quantity, unit_price, total_price)
    VALUES (?, ?, ?, NULL, NULL, NULL, ?, 1, 100, 100)
  `).run(generateId(), tenantId, invId, productName)

  return { invId }
}

describe('ชื่อสินค้าบนเอกสารต้องไม่ถูก null จากตาราง products ทับ', () => {
  it('ใบแจ้งหนี้: GET /invoices/:id ต้องคืนชื่อสินค้า ไม่ใช่ null', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { invId } = seedInvoiceWithItem(user.tenantId, 'ขนมจีนทดสอบ')

    const res = await request(app).get(`/api/invoices/${invId}`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.items).toHaveLength(1)
    expect(res.body.data.items[0].product_name).toBe('ขนมจีนทดสอบ')
  })

  it('ใบแจ้งหนี้: ถ้าผูก stock_item ไว้ ให้ใช้ชื่อล่าสุดจากคลัง (ชื่อสินค้าถูกแก้ทีหลัง)', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { invId } = seedInvoiceWithItem(user.tenantId, 'ชื่อเก่าในบิล')

    const stockId = generateId()
    db.prepare(`
      INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
      VALUES (?, ?, ?, 'ชื่อใหม่ในคลัง', 'raw', 10, 'pcs', 'pcs', 'STOCK', 'ACTIVE')
    `).run(stockId, user.tenantId, 'SKU-' + stockId.slice(0, 8))
    db.prepare('UPDATE invoice_items SET stock_item_id = ? WHERE invoice_id = ?').run(stockId, invId)

    const res = await request(app).get(`/api/invoices/${invId}`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.body.data.items[0].product_name).toBe('ชื่อใหม่ในคลัง')
    expect(res.body.data.items[0].product_code).toBeTruthy()   // มาจาก stock_items.sku
  })

  it('ใบเสนอราคา: GET /quotations/:id ต้องคืนชื่อสินค้าเหมือนกัน', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const customerId = generateId()
    db.prepare(`
      INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, tenant_id)
      VALUES (?, ?, 'ลูกค้าทดสอบ', 'RETAIL', 'x', 'x@example.com', '0800000000', 'BKK', ?)
    `).run(customerId, 'CUS-' + customerId.slice(0, 8), user.tenantId)

    const qtId = generateId()
    db.prepare(`
      INSERT INTO quotations (id, tenant_id, quotation_number, customer_id, quotation_date, total_amount, status)
      VALUES (?, ?, ?, ?, ?, 100, 'DRAFT')
    `).run(qtId, user.tenantId, 'QT-TEST-' + qtId.slice(0, 8), customerId, new Date().toISOString().slice(0, 10))
    db.prepare(`
      INSERT INTO quotation_items (id, tenant_id, quotation_id, stock_item_id, product_id, product_name,
        quantity, unit_price, total_price)
      VALUES (?, ?, ?, NULL, NULL, 'สินค้าในใบเสนอราคา', 1, 100, 100)
    `).run(generateId(), user.tenantId, qtId)

    const res = await request(app).get(`/api/quotations/${qtId}`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.items[0].product_name).toBe('สินค้าในใบเสนอราคา')
  })
})
