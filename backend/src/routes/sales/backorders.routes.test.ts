import { describe, it, expect, afterEach } from 'vitest'
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

// tenant ทิ้ง สร้างใหม่ทุกเคสแล้วลบใน afterEach
const tenants: string[] = []

function seedBackorder(tenantId: string) {
  const customerId = generateId()
  db.prepare(`
    INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, tenant_id)
    VALUES (?, ?, 'ลูกค้าทดสอบ', 'RETAIL', 'x', 'x@example.com', '0800000000', 'BKK', ?)
  `).run(customerId, 'CUS-' + customerId.slice(0, 8), tenantId)

  const soId = generateId()
  db.prepare(`
    INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, total_amount, status)
    VALUES (?, ?, ?, ?, 100, 'PARTIAL')
  `).run(soId, tenantId, 'SO-TEST-' + soId.slice(0, 8), customerId)

  const stockItemId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
    VALUES (?, ?, ?, 'สินค้าเทสต์', 'FINISHED', 50, 'pcs', 'pcs', 'MAIN', 'ACTIVE')
  `).run(stockItemId, tenantId, stockItemId)

  const soItemId = generateId()
  db.prepare(`
    INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_name, quantity, delivered_qty, unit_price, total_price, unit)
    VALUES (?, ?, ?, ?, 'สินค้าเทสต์', 10, 6, 100, 1000, 'pcs')
  `).run(soItemId, tenantId, soId, stockItemId)

  const boId = generateId()
  db.prepare(`
    INSERT INTO backorders (id, tenant_id, bo_number, sales_order_id, customer_id, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'PENDING', '', datetime('now'), datetime('now'))
  `).run(boId, tenantId, 'BO-TEST-' + boId.slice(0, 8), soId, customerId)

  db.prepare(`
    INSERT INTO backorder_items (id, tenant_id, backorder_id, sales_order_item_id, product_id, ordered_qty, delivered_qty, remaining_qty, notes)
    VALUES (?, ?, ?, ?, NULL, 10, 6, 4, '')
  `).run(generateId(), tenantId, boId, soItemId)

  return { boId, soId, stockItemId }
}

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM backorder_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM backorders WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM sales_order_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM sales_orders WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_movements WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM customers WHERE tenant_id = ?').run(t)
  }
})

function newTenant() {
  const t = 'test_bo_' + generateId()
  tenants.push(t)
  return t
}

describe('PUT /api/backorders/:id/status — ปิดของค้างส่ง', () => {
  it('PENDING → FULFILLED เปลี่ยนสถานะจริง และไม่แตะสต็อก/stock_movements เด็ดขาด', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const t = user.tenantId
    tenants.push(t)
    const { boId, stockItemId } = seedBackorder(t)

    const stockBefore = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockItemId) as any

    const res = await request(app).put(`/api/backorders/${boId}/status`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ status: 'FULFILLED' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.status).toBe('FULFILLED')

    const bo = db.prepare('SELECT status FROM backorders WHERE id = ?').get(boId) as any
    expect(bo.status).toBe('FULFILLED')

    const stockAfter = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockItemId) as any
    expect(stockAfter.quantity, 'ห้ามตัดสต็อกซ้ำตอนปิดของค้างส่ง — ตัดไปแล้วตอนยืนยัน SO').toBe(stockBefore.quantity)

    const movements = db.prepare('SELECT COUNT(*) c FROM stock_movements WHERE tenant_id = ?').get(t) as any
    expect(movements.c, 'ห้ามเกิด stock_movements ใหม่จากการปิดของค้างส่ง').toBe(0)
  })

  it('ปิดซ้ำสองครั้งไม่ได้ (ต้องเป็น PENDING เท่านั้น)', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const { boId } = seedBackorder(user.tenantId)

    await request(app).put(`/api/backorders/${boId}/status`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ status: 'FULFILLED' })

    const res2 = await request(app).put(`/api/backorders/${boId}/status`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ status: 'CANCELLED' })

    expect(res2.status).toBe(400)
  })

  it('status ที่ไม่รู้จักถูกปฏิเสธ', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const { boId } = seedBackorder(user.tenantId)

    const res = await request(app).put(`/api/backorders/${boId}/status`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ status: 'PENDING' })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/backorders/:id — รายละเอียดของค้างส่ง', () => {
  it('คืนรายการพร้อมชื่อสินค้า (fallback จาก sales_order_items.product_name)', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const { boId } = seedBackorder(user.tenantId)

    const res = await request(app).get(`/api/backorders/${boId}`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.items).toHaveLength(1)
    expect(res.body.data.items[0].product_name).toBe('สินค้าเทสต์')
    expect(res.body.data.items[0].remaining_qty).toBe(4)
  })
})
