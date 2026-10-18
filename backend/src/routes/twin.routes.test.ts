import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import twinRouter from './twin.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use('/api/twin', twinRouter)

function seed(tenantId: string) {
  const supId = generateId(), cusId = generateId(), soId = generateId()
  db.prepare(`INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, 'S1', 'ผู้ขายเอ', '-')`).run(supId, tenantId)
  db.prepare(`INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city) VALUES (?, ?, 'C1', 'ลูกค้าบี', 'RETAIL', '-', '-', '-', '-')`).run(cusId, tenantId)
  db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, status) VALUES (?, ?, 'SO-T1', ?, 'CONFIRMED')`).run(soId, tenantId, cusId)
  const item = db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, min_stock, unit_cost, location, status) VALUES (?, ?, ?, ?, ?, ?, 'pcs', ?, 10, 'A-01', 'ACTIVE')`)
  item.run(generateId(), tenantId, 'SKU-1', 'กล่อง', 'raw', 100, 10)
  item.run(generateId(), tenantId, 'SKU-2', 'เทป', 'raw', 2, 10)   // ใกล้หมด
  item.run(generateId(), tenantId, 'SKU-3', 'สินค้า', 'finished', 0, 0)
  const po = db.prepare(`INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, total_amount) VALUES (?, ?, ?, ?, ?, 500)`)
  po.run(generateId(), tenantId, 'PO-T1', supId, 'APPROVED')
  po.run(generateId(), tenantId, 'PO-T2', supId, 'DRAFT')         // ยังไม่ใช่ขาเข้า
  const dOrder = db.prepare(`INSERT INTO delivery_orders (id, tenant_id, do_number, sales_order_id, customer_id, status, vehicle_plate) VALUES (?, ?, ?, ?, ?, ?, '1กข-1234')`)
  dOrder.run(generateId(), tenantId, 'DO-T1', soId, cusId, 'READY')
  dOrder.run(generateId(), tenantId, 'DO-T2', soId, cusId, 'SHIPPED')
  db.prepare(`INSERT INTO work_orders (id, tenant_id, wo_number, product_name, quantity, completed_qty, status) VALUES (?, ?, 'WO-T1', 'เซรั่ม', 100, 40, 'IN_PROGRESS')`).run(generateId(), tenantId)
}

describe('GET /twin — สถานะคลังจากข้อมูลจริง', () => {
  it('นับขาเข้า/ขาออก/สต็อก/ผลิต ของ tenant ตัวเองเท่านั้น', async () => {
    const a = createTestUser({ role: 'ADMIN' })
    const b = createTestUser({ role: 'ADMIN' })
    seed(a.tenantId)

    const res = await request(app).get('/api/twin').set('Authorization', `Bearer ${a.token}`)
    expect(res.status).toBe(200)
    const d = res.body.data
    expect(d.stock).toMatchObject({ sku: 3, inStock: 2, low: 1, value: 1020 })
    expect(d.stock.lowItems[0].sku).toBe('SKU-2')
    expect(d.inbound.open).toBe(1)
    expect(d.inbound.list[0]).toMatchObject({ number: 'PO-T1', party: 'ผู้ขายเอ', amount: 500 })
    expect(d.outbound).toMatchObject({ ready: 1, shipped: 1 })
    expect(d.outbound.list.map((x: any) => x.number)).toEqual(['DO-T1', 'DO-T2'])
    expect(d.production.list[0]).toMatchObject({ number: 'WO-T1', completed: 40 })

    const other = await request(app).get('/api/twin').set('Authorization', `Bearer ${b.token}`)
    expect(other.body.data).toMatchObject({ stock: { sku: 0 }, inbound: { open: 0 }, outbound: { ready: 0 }, production: { active: 0 } })
  })

  it('พนักงานทั่วไปไม่เห็นตัวเลขเงิน', async () => {
    const u = createTestUser({ role: 'USER' })
    seed(u.tenantId)
    const d = (await request(app).get('/api/twin').set('Authorization', `Bearer ${u.token}`)).body.data
    expect(d.stock.value).toBeNull()
    expect(d.inbound.list[0].amount).toBeNull()
  })
})
