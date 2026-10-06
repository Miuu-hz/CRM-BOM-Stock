import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import salesOrdersRouter from './salesOrders'
import deliveryOrdersRouter from './deliveryOrders'
import settingsRouter from '../settings.routes'
import { createDeliveryOrderForSO, soStockAlreadyDeducted } from './shared'
import { rememberAlias } from '../../services/stockItem.service'
import { createTestUser } from '../../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/sales-orders', authenticate, salesOrdersRouter)
app.use('/api/delivery-orders', authenticate, deliveryOrdersRouter)
app.use('/api/settings', settingsRouter)

function seed(tenantId: string, qty = 50) {
  const customerId = generateId()
  db.prepare(`INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, tenant_id)
    VALUES (?, ?, 'ลูกค้าทดสอบ', 'RETAIL', 'x', 'x@example.com', '0800000000', 'BKK', ?)`).run(customerId, 'CUS-' + customerId.slice(0, 8), tenantId)
  const stockId = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, 'สินค้าทดสอบ', 'FINISHED', ?, 'pcs', 'pcs', 10, 'MAIN', 'ACTIVE')`).run(stockId, tenantId, stockId, qty)
  const soId = generateId()
  const soNumber = 'SO-FA-' + soId.slice(0, 8)
  db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, total_amount, status) VALUES (?, ?, ?, ?, 1000, 'DRAFT')`)
    .run(soId, tenantId, soNumber, customerId)
  db.prepare(`INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_name, quantity, unit_price, total_price, unit)
    VALUES (?, ?, ?, ?, 'สินค้าทดสอบ', 10, 100, 1000, 'pcs')`).run(generateId(), tenantId, soId, stockId)
  return { stockId, soId, soNumber }
}

const putStatus = (url: string, token: string, status: string) =>
  request(app).put(url).set('Authorization', `Bearer ${token}`).send({ status })
const qtyOf = (id: string) => (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(id) as any).quantity

describe('ยกเลิก SO ที่ยังเป็น DRAFT แต่ส่งของผ่าน DO ไปแล้ว', () => {
  it('คืนสต็อกและกลับรายการ SO_COGS', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const { stockId, soId } = seed(admin.tenantId)
    const d = createDeliveryOrderForSO(admin.tenantId, soId, { status: 'SHIPPED' })!
    const del = await putStatus(`/api/delivery-orders/${d.id}/status`, admin.token, 'DELIVERED')
    expect(del.status).toBe(200)
    expect(qtyOf(stockId)).toBe(40)
    // DO ไม่ได้ดัน SO ออกจาก DRAFT ในสถานการณ์นี้ — บังคับให้ตรงกับเคสจริง
    db.prepare("UPDATE sales_orders SET status = 'DRAFT' WHERE id = ?").run(soId)

    const res = await putStatus(`/api/sales-orders/${soId}/status`, admin.token, 'CANCELLED')
    expect(res.status).toBe(200)
    expect(qtyOf(stockId), 'สต็อกต้องกลับมา').toBe(50)
  })

  it('DRAFT ที่ไม่เคยตัดสต็อก ยกเลิกแล้วสต็อกไม่เพิ่ม', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const { stockId, soId } = seed(admin.tenantId)
    const res = await putStatus(`/api/sales-orders/${soId}/status`, admin.token, 'CANCELLED')
    expect(res.status).toBe(200)
    expect(qtyOf(stockId)).toBe(50)
  })
})

describe('ใบส่งของของ SO ที่ยกเลิกแล้ว', () => {
  it('DELIVERED ไม่ได้ (409) · delivered_qty/สต็อกไม่ขยับ · soStockAlreadyDeducted เป็น false หลังคืนสต็อก', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const { stockId, soId, soNumber } = seed(admin.tenantId)
    expect((await putStatus(`/api/sales-orders/${soId}/status`, admin.token, 'CONFIRMED')).status).toBe(200)
    expect(soStockAlreadyDeducted(admin.tenantId, soNumber)).toBe(true)
    const d = createDeliveryOrderForSO(admin.tenantId, soId, { status: 'SHIPPED' })!
    expect((await putStatus(`/api/sales-orders/${soId}/status`, admin.token, 'CANCELLED')).status).toBe(200)
    expect(qtyOf(stockId)).toBe(50)
    expect(soStockAlreadyDeducted(admin.tenantId, soNumber)).toBe(false)

    const res = await putStatus(`/api/delivery-orders/${d.id}/status`, admin.token, 'DELIVERED')
    expect(res.status).toBe(409)
    expect(qtyOf(stockId)).toBe(50)
    expect((db.prepare('SELECT SUM(delivered_qty) q FROM sales_order_items WHERE sales_order_id = ?').get(soId) as any).q).toBe(0)
    expect((db.prepare('SELECT status FROM sales_orders WHERE id = ?').get(soId) as any).status).toBe('CANCELLED')
  })
})

describe('rememberAlias onlyIfAbsent (ฝั่งขาย)', () => {
  it('ชื่อรองที่มีอยู่แล้วไม่ถูกย้าย SKU / ไม่ล้างหน่วย แต่ฝั่งซื้อ (ค่าเริ่มต้น) ยังทับได้', () => {
    const u = createTestUser({ role: 'ADMIN' })
    const t = u.tenantId
    db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock, stock_alias_enabled) VALUES (?, ?, 0, 1)').run(t, 'test')
    const mk = (name: string) => {
      const id = generateId()
      db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
        VALUES (?, ?, ?, ?, 'FINISHED', 0, 'pcs', 'pcs', 'MAIN', 'ACTIVE')`).run(id, t, id, name)
      return id
    }
    const a = mk('สินค้า A'), b = mk('สินค้า B')
    expect(rememberAlias(t, 'ชื่อเรียก', a, 'GR-1', u.userId)).toBe(true)
    db.prepare("UPDATE stock_item_aliases SET unit = 'ลัง', factor = 12 WHERE tenant_id = ?").run(t)

    expect(rememberAlias(t, 'ชื่อเรียก', b, 'SO-1', 'system', { onlyIfAbsent: true })).toBe(false)
    let row = db.prepare('SELECT * FROM stock_item_aliases WHERE tenant_id = ?').get(t) as any
    expect(row.stock_item_id).toBe(a)
    expect([row.unit, row.factor]).toEqual(['ลัง', 12])
    expect(rememberAlias(t, 'ชื่อเรียก', a, 'SO-2', 'system', { onlyIfAbsent: true })).toBe(true)

    expect(rememberAlias(t, 'ชื่อเรียก', b, 'GR-2', u.userId)).toBe(true)
    row = db.prepare('SELECT * FROM stock_item_aliases WHERE tenant_id = ?').get(t) as any
    expect(row.stock_item_id).toBe(b)
  })
})

describe('PUT /settings/company stock_alias_enabled', () => {
  const put = (token: string, v: unknown) =>
    request(app).put('/api/settings/company').set('Authorization', `Bearer ${token}`).send({ name: 'บริษัททดสอบ', stock_alias_enabled: v })
  const flag = (t: string) => (db.prepare('SELECT stock_alias_enabled v FROM company_settings WHERE tenant_id = ?').get(t) as any).v

  it.each([[false, 0], [0, 0], ['0', 0], ['false', 0], [true, 1], [1, 1], ['1', 1], ['true', 1]])('%j → %i', async (v, want) => {
    const u = createTestUser({ role: 'ADMIN' })
    const res = await put(u.token, v)
    expect(res.status).toBe(200)
    expect(flag(u.tenantId)).toBe(want)
  })

  it.each([[null], ['x'], [2], [{}]])('ค่าแปลก %j → 400 ไม่แตะค่าเดิม', async (v) => {
    const u = createTestUser({ role: 'ADMIN' })
    await put(u.token, false)
    const res = await put(u.token, v)
    expect(res.status).toBe(400)
    expect(flag(u.tenantId)).toBe(0)
  })
})
