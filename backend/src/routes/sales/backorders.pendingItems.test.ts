import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import backordersRouter from './backorders.routes'
import { createTestUser } from '../../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/backorders', authenticate, backordersRouter)

function seedCustomer(tenantId: string) {
  const customerId = generateId()
  db.prepare(`
    INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, tenant_id)
    VALUES (?, ?, 'ลูกค้าทดสอบ', 'RETAIL', 'x', 'x@example.com', '0800000000', 'BKK', ?)
  `).run(customerId, 'CUS-' + customerId.slice(0, 8), tenantId)
  return customerId
}

/** SO ค้างส่ง + 1 รายการที่ผูก stock_item_id แต่ product_id เป็น NULL (กติกาจริงตั้งแต่ย้ายมา stock_items) */
function seedSOWithPendingItem(tenantId: string, customerId: string) {
  const soId = generateId()
  db.prepare(`
    INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, total_amount, status)
    VALUES (?, ?, ?, ?, 1000, 'PARTIAL')
  `).run(soId, tenantId, 'SO-TEST-' + soId.slice(0, 8), customerId)

  const stockId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
    VALUES (?, ?, ?, 'สินค้าทดสอบ pending-item', 'FINISHED', 50, 'pcs', 'pcs', 'MAIN', 'ACTIVE')
  `).run(stockId, tenantId, stockId)

  const itemId = generateId()
  db.prepare(`
    INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_id, product_name, quantity, delivered_qty, unit_price, total_price, unit)
    VALUES (?, ?, ?, ?, NULL, 'สินค้าทดสอบ', 10, 4, 100, 1000, 'pcs')
  `).run(itemId, tenantId, soId, stockId)

  return { soId, stockId, itemId }
}

/**
 * ITEM 6 (ตรวจ 2026-10-05): เดิม query ของ pending-items ผูก product_code/product_name กับ
 * ตาราง products ที่ตายแล้ว (12 แถวลอย ไม่มีสายงานจริงเขียน) — ของจริงอยู่ที่ stock_items ผ่าน
 * sales_order_items.stock_item_id (product_id เกือบทุกแถวเป็น NULL) ยืนยันว่า product_code
 * มาจาก stock_items.sku จริง ไม่ใช่ NULL จากตาราง products
 */
describe('GET /backorders/pending-items/:salesOrderId', () => {
  it('product_code มาจาก stock_items.sku และมีชื่อ แม้ sales_order_items.product_id เป็น NULL', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const customerId = seedCustomer(u.tenantId)
    const { soId, stockId, itemId } = seedSOWithPendingItem(u.tenantId, customerId)

    // ยืนยัน precondition ก่อน: แถวจริงใน DB ต้องมี product_id เป็น NULL
    const rawRow = db.prepare('SELECT product_id FROM sales_order_items WHERE id = ?').get(itemId) as any
    expect(rawRow.product_id).toBeNull()

    const res = await request(app).get(`/api/backorders/pending-items/${soId}`)
      .set('Authorization', `Bearer ${u.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)

    const row = res.body.data[0]
    const sku = (db.prepare('SELECT sku, name FROM stock_items WHERE id = ?').get(stockId) as any)
    expect(row.product_code, 'product_code ต้องมาจาก stock_items.sku ไม่ใช่ NULL').toBe(sku.sku)
    expect(row.product_name).toBe(sku.name)
    expect(row.remaining_qty).toBe(6)
  })
})
