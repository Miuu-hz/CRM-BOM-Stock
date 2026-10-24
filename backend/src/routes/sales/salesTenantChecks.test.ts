import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import salesRouter from './index'
import { createTestUser } from '../../test/testAuth'

/** ตรวจ tenant ของสินค้า/ลูกค้า/ใบสั่งขายในใบสั่งขาย ใบเสนอราคา และ backorder */
const app = express()
app.use(express.json())
app.use('/api/sales', salesRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const table of ['backorder_items', 'backorders', 'delivery_orders', 'sales_order_items', 'sales_orders', 'quotation_items', 'quotations',
      'customers', 'stock_items', 'accounts', 'document_sequences', 'company_settings', 'users']) {
      try { db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(t) } catch { /* ตารางไม่มีคอลัมน์นี้ */ }
    }
  }
})

function setup() {
  const u = createTestUser({ role: 'ADMIN' })
  tenants.push(u.tenantId)
  db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock, vat_registered) VALUES (?, ?, 0, 1)').run(u.tenantId, 'ร้านทดสอบ')
  const customerId = generateId()
  db.prepare(`INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, tenant_id) VALUES (?, ?, 'ลูกค้า', 'RETAIL', 'x', 'x@example.com', '0800000000', 'BKK', ?)`)
    .run(customerId, 'C-' + customerId.slice(0, 6), u.tenantId)
  const stockId = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status, unit_cost, unit_price)
    VALUES (?, ?, ?, 'สินค้า', 'FINISHED', 100, 'pcs', 'pcs', 'MAIN', 'ACTIVE', 60, 100)`).run(stockId, u.tenantId, 'SKU-' + stockId.slice(0, 6))
  const line = { productId: stockId, productName: 'สินค้า', quantity: 5, unit: 'pcs', unitPrice: 100 }
  const auth = (r: any) => r.set('Authorization', 'Bearer ' + u.token)
  return { t: u.tenantId, customerId, stockId, line, auth }
}

describe('C1 สินค้าในบรรทัดต้องเป็นของ tenant ตัวเอง', () => {
  it('ใบสั่งขาย/ใบเสนอราคา POST+PUT: productId ของบริษัทอื่นหรือ id มั่ว → 400 · ของตัวเอง/ไม่ระบุ → ผ่าน', async () => {
    const s = setup(), other = setup()
    const base = { customerId: s.customerId, taxRate: 0 }
    for (const path of ['sales-orders', 'quotations']) {
      for (const bad of [other.stockId, 'no-such-product']) {
        const res = await s.auth(request(app).post('/api/sales/' + path)).send({ ...base, items: [s.line, { ...s.line, productId: bad }] })
        expect(res.status, path + ' ' + bad).toBe(400)
        expect(res.body.code).toBe('PRODUCT_NOT_FOUND')
      }
      const ok = await s.auth(request(app).post('/api/sales/' + path)).send({ ...base, items: [s.line, { ...s.line, productId: undefined }] })
      expect(ok.status, path).toBe(201)
      const put = await s.auth(request(app).put(`/api/sales/${path}/${ok.body.data.id}`)).send({ items: [{ ...s.line, productId: other.stockId }] })
      expect(put.status, path + ' PUT').toBe(400)
      expect(put.body.code).toBe('PRODUCT_NOT_FOUND')
    }
    // 400 แล้วไม่เหลือเอกสารที่สอง
    expect((db.prepare('SELECT COUNT(*) c FROM sales_orders WHERE tenant_id = ?').get(s.t) as any).c).toBe(1)
  })
})

describe('C2 POST ต้องมีลูกค้าในกิจการนี้', () => {
  it('customerId ที่ไม่มีจริง หรือเป็นของบริษัทอื่น → 400', async () => {
    const s = setup(), other = setup()
    for (const path of ['sales-orders', 'quotations']) {
      for (const customerId of ['no-such-customer', other.customerId]) {
        const res = await s.auth(request(app).post('/api/sales/' + path)).send({ customerId, items: [s.line], taxRate: 0 })
        expect(res.status, path + ' ' + customerId).toBe(400)
        expect(res.body.message).toContain('ลูกค้า')
      }
    }
  })
})

describe('C3 สร้าง backorder', () => {
  function seedSo(s: ReturnType<typeof setup>) {
    const soId = generateId(), soItemId = generateId(), doId = generateId()
    db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, status, total_amount) VALUES (?, ?, ?, ?, 'CONFIRMED', 500)`).run(soId, s.t, 'SO-' + soId.slice(0, 8), s.customerId)
    db.prepare(`INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_name, quantity, unit, unit_price, total_price)
      VALUES (?, ?, ?, ?, 'สินค้า', 5, 'pcs', 100, 500)`).run(soItemId, s.t, soId, s.stockId)
    db.prepare(`INSERT INTO delivery_orders (id, tenant_id, do_number, sales_order_id, customer_id) VALUES (?, ?, ?, ?, ?)`)
      .run(doId, s.t, 'DO-' + doId.slice(0, 8), soId, s.customerId)
    return { soId, soItemId, doId }
  }

  it('originalDoId / salesOrderItemId ของบริษัทอื่นหรือของ SO อื่น → 400 · ยอดค้างติดลบ → 400 · ถูกต้อง → 201', async () => {
    const s = setup(), other = setup()
    const mine = seedSo(s), mine2 = seedSo(s), theirs = seedSo(other)
    const item = (salesOrderItemId: string, orderedQty = 5, deliveredQty = 2) => ({ salesOrderItemId, orderedQty, deliveredQty })
    const post = (body: any) => s.auth(request(app).post('/api/sales/backorders')).send({ salesOrderId: mine.soId, ...body })

    expect((await post({ originalDoId: theirs.doId, items: [item(mine.soItemId)] })).status).toBe(400) // DO บริษัทอื่น
    expect((await post({ originalDoId: mine2.doId, items: [item(mine.soItemId)] })).status).toBe(400)  // DO ของ SO อื่น
    expect((await post({ items: [item(theirs.soItemId)] })).status).toBe(400)                            // รายการบริษัทอื่น
    expect((await post({ items: [item(mine2.soItemId)] })).status).toBe(400)                             // รายการของ SO อื่น
    expect((await post({ items: [item(mine.soItemId, 2, 5)] })).status).toBe(400)                        // ส่งเกินสั่ง
    expect((await post({ items: [item(mine.soItemId, 5, 'abc' as any)] })).status).toBe(400)
    expect((db.prepare('SELECT COUNT(*) c FROM backorders WHERE tenant_id = ?').get(s.t) as any).c).toBe(0)

    const ok = await post({ originalDoId: mine.doId, items: [item(mine.soItemId)] })
    expect(ok.status).toBe(201)
    expect(ok.body.data.items[0].remaining_qty).toBe(3)
  })
})
