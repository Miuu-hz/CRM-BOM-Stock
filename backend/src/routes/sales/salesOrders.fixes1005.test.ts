import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import salesOrdersRouter from './salesOrders'
import quotationsRouter from './quotations'
import { createTestUser } from '../../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/sales-orders', authenticate, salesOrdersRouter)
app.use('/api/quotations', authenticate, quotationsRouter)

function seedCustomer(tenantId: string) {
  const customerId = generateId()
  db.prepare(`
    INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, tenant_id)
    VALUES (?, ?, 'ลูกค้าทดสอบ', 'RETAIL', 'x', 'x@example.com', '0800000000', 'BKK', ?)
  `).run(customerId, 'CUS-' + customerId.slice(0, 8), tenantId)
  return customerId
}

function seedStockItem(tenantId: string, category: string, qty = 50) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
    VALUES (?, ?, ?, 'สินค้าทดสอบ', ?, ?, 'pcs', 'pcs', 'MAIN', 'ACTIVE')
  `).run(id, tenantId, id, category, qty)
  return id
}

function seedDraftSO(tenantId: string, customerId: string, amount = 1000) {
  const soId = generateId()
  db.prepare(`
    INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, total_amount, status)
    VALUES (?, ?, ?, ?, ?, 'DRAFT')
  `).run(soId, tenantId, 'SO-TEST-' + soId.slice(0, 8), customerId, amount)
  return soId
}

function addSOLine(tenantId: string, soId: string, stockItemId: string, qty: number) {
  const id = generateId()
  db.prepare(`
    INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_name, quantity, unit_price, total_price, unit)
    VALUES (?, ?, ?, ?, 'สินค้าทดสอบ', ?, 100, ?, 'pcs')
  `).run(id, tenantId, soId, stockItemId, qty, qty * 100)
  return id
}

// ADMIN มี bypass ประตูอนุมัติเสมอ (ดู salesOrders.test.ts) — ใช้ยืนยัน SO ตรงๆในเทสต์นี้
function confirmSO(token: string, soId: string) {
  return request(app).put(`/api/sales-orders/${soId}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'CONFIRMED' })
}

/**
 * ITEM 1 (ตรวจ 2026-10-05): POST /:id/delivery-order เดิมไม่มีเทสต์ระดับ route เลย —
 * มีแต่เทสต์ของ createDeliveryOrderForSO() ตรงๆ (autoDeliveryOrder.test.ts) ที่ไม่ผ่าน HTTP/auth
 * เลย ยืนยันพฤติกรรม route จริง: ได้ doNumber, ไม่ซ้ำ (409), ไม่แตะสต็อกเพิ่ม, สถานะที่ยังไม่
 * ยืนยัน (DRAFT) ออกใบไม่ได้
 */
describe('POST /sales-orders/:id/delivery-order', () => {
  it('ยืนยัน SO แล้วออกใบส่งของได้ ได้ doNumber, มีแถว delivery_orders, ไม่แตะสต็อกเพิ่ม', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const customerId = seedCustomer(admin.tenantId)
    const stockId = seedStockItem(admin.tenantId, 'FINISHED', 50)
    const soId = seedDraftSO(admin.tenantId, customerId)
    addSOLine(admin.tenantId, soId, stockId, 10)

    const confirmRes = await confirmSO(admin.token, soId)
    expect(confirmRes.status).toBe(200)

    const movBefore = (db.prepare("SELECT COUNT(*) c FROM stock_movements WHERE tenant_id = ?").get(admin.tenantId) as any).c
    const qtyBefore = (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockId) as any).quantity

    const res = await request(app).post(`/api/sales-orders/${soId}/delivery-order`)
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(201)
    expect(res.body.data.doNumber).toMatch(/^DO/)

    const dos = db.prepare('SELECT * FROM delivery_orders WHERE tenant_id = ? AND sales_order_id = ?').all(admin.tenantId, soId) as any[]
    expect(dos).toHaveLength(1)
    expect(dos[0].do_number).toBe(res.body.data.doNumber)

    // ออกใบส่งของต้องไม่แตะสต็อกอีก — ตัดไปแล้วตั้งแต่ยืนยัน SO (deductStockForSO)
    const movAfter = (db.prepare("SELECT COUNT(*) c FROM stock_movements WHERE tenant_id = ?").get(admin.tenantId) as any).c
    const qtyAfter = (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockId) as any).quantity
    expect(movAfter, 'ไม่มี stock_movements แถวใหม่').toBe(movBefore)
    expect(qtyAfter, 'quantity ไม่เปลี่ยน').toBe(qtyBefore)
  })

  it('เรียกครั้งที่สองซ้ำ → 409 ไม่ออกใบซ้ำ', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const customerId = seedCustomer(admin.tenantId)
    const stockId = seedStockItem(admin.tenantId, 'FINISHED', 50)
    const soId = seedDraftSO(admin.tenantId, customerId)
    addSOLine(admin.tenantId, soId, stockId, 10)
    await confirmSO(admin.token, soId)

    const first = await request(app).post(`/api/sales-orders/${soId}/delivery-order`).set('Authorization', `Bearer ${admin.token}`)
    expect(first.status).toBe(201)

    const second = await request(app).post(`/api/sales-orders/${soId}/delivery-order`).set('Authorization', `Bearer ${admin.token}`)
    expect(second.status).toBe(409)

    const count = (db.prepare('SELECT COUNT(*) c FROM delivery_orders WHERE sales_order_id = ?').get(soId) as any).c
    expect(count).toBe(1)
  })

  it('สถานะ DRAFT (ยังไม่ยืนยัน) → ออกใบส่งของไม่ได้ 400', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const customerId = seedCustomer(admin.tenantId)
    const soId = seedDraftSO(admin.tenantId, customerId)

    const res = await request(app).post(`/api/sales-orders/${soId}/delivery-order`)
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(400)
  })
})

/**
 * ITEM 2 (ตรวจ 2026-10-05): เหมือน quotations.test.ts แต่ยืนยันที่ฝั่ง SO (salesOrders.ts)
 * เองด้วย — findNonSellableLine ตัวเดียวกับ shared.ts ต้องครอบทั้ง POST และ PUT ของ SO
 */
describe('การ์ดขายวัตถุดิบไม่ได้ — SO POST/PUT', () => {
  it('POST /sales-orders ขายวัตถุดิบ (category=raw) ถูกบล็อก 400 ITEM_NOT_SELLABLE', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const customerId = seedCustomer(u.tenantId)
    const rawId = seedStockItem(u.tenantId, 'raw')

    const res = await request(app).post('/api/sales-orders')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ customerId, items: [{ productId: rawId, productName: 'ของดิบ', quantity: 1, unitPrice: 10, unit: 'pcs' }] })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('ITEM_NOT_SELLABLE')
  })

  it('POST /sales-orders ขายสินค้าสำเร็จรูป (FINISHED) ผ่าน', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const customerId = seedCustomer(u.tenantId)
    const finId = seedStockItem(u.tenantId, 'FINISHED')

    const res = await request(app).post('/api/sales-orders')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ customerId, items: [{ productId: finId, productName: 'ของสำเร็จ', quantity: 1, unitPrice: 10, unit: 'pcs' }] })

    expect(res.status).toBe(201)
  })

  it('PUT /sales-orders/:id (DRAFT) เปลี่ยนรายการเป็นวัตถุดิบ ถูกบล็อก 400 ITEM_NOT_SELLABLE', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const customerId = seedCustomer(u.tenantId)
    const soId = seedDraftSO(u.tenantId, customerId)
    const rawId = seedStockItem(u.tenantId, 'raw')

    const res = await request(app).put(`/api/sales-orders/${soId}`)
      .set('Authorization', `Bearer ${u.token}`)
      .send({ items: [{ productId: rawId, productName: 'ของดิบ', quantity: 1, unitPrice: 10, unit: 'pcs' }] })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('ITEM_NOT_SELLABLE')
  })
})

/**
 * ITEM 3 (ตรวจ 2026-10-05): SO_NEXT_STATUS/QT_NEXT_STATUS ของจริงใน salesOrders.ts/quotations.ts
 * ยังไม่มีเทสต์ยืนยันว่า "ข้ามขั้น" ถูกบล็อกจริง และขั้นที่อนุญาตพิเศษ (PENDING_APPROVAL→CANCELLED,
 * PARTIAL→DELIVERED) ยังผ่านอยู่
 */
describe('สถานะข้ามขั้นถูกบล็อก (PUT /sales-orders/:id/status)', () => {
  it('CONFIRMED→COMPLETED (ข้ามขั้น PROCESSING/READY/DELIVERED) → 400 INVALID_STATUS_TRANSITION', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const customerId = seedCustomer(admin.tenantId)
    const soId = seedDraftSO(admin.tenantId, customerId)
    const confirmRes = await confirmSO(admin.token, soId)
    expect(confirmRes.status).toBe(200)

    const res = await request(app).put(`/api/sales-orders/${soId}/status`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'COMPLETED' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_STATUS_TRANSITION')
  })

  it('PENDING_APPROVAL→CANCELLED อนุญาตสำหรับ admin', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const customerId = seedCustomer(admin.tenantId)
    const soId = seedDraftSO(admin.tenantId, customerId)
    db.prepare("UPDATE sales_orders SET status = 'PENDING_APPROVAL' WHERE id = ?").run(soId)

    const res = await request(app).put(`/api/sales-orders/${soId}/status`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'CANCELLED' })

    expect(res.status).toBe(200)
    const so = db.prepare('SELECT status FROM sales_orders WHERE id = ?').get(soId) as any
    expect(so.status).toBe('CANCELLED')
  })

  it('PARTIAL→DELIVERED อนุญาต', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const customerId = seedCustomer(admin.tenantId)
    const soId = seedDraftSO(admin.tenantId, customerId)
    db.prepare("UPDATE sales_orders SET status = 'PARTIAL' WHERE id = ?").run(soId)

    const res = await request(app).put(`/api/sales-orders/${soId}/status`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'DELIVERED' })

    expect(res.status).toBe(200)
    const so = db.prepare('SELECT status FROM sales_orders WHERE id = ?').get(soId) as any
    expect(so.status).toBe('DELIVERED')
  })
})

describe('สถานะข้ามขั้นถูกบล็อก (PUT /quotations/:id/status) — QT_NEXT_STATUS', () => {
  function seedDraftQT(tenantId: string, customerId: string) {
    const id = generateId()
    db.prepare(`
      INSERT INTO quotations (id, tenant_id, quotation_number, customer_id, total_amount, status)
      VALUES (?, ?, ?, ?, 1000, 'DRAFT')
    `).run(id, tenantId, 'QT-TEST-' + id.slice(0, 8), customerId)
    return id
  }

  it('DRAFT→SENT อนุญาตตรง (ตาม QT_NEXT_STATUS.DRAFT)', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const customerId = seedCustomer(u.tenantId)
    const qtId = seedDraftQT(u.tenantId, customerId)

    const res = await request(app).put(`/api/quotations/${qtId}/status`)
      .set('Authorization', `Bearer ${u.token}`)
      .send({ status: 'SENT' })

    expect(res.status).toBe(200)
    const qt = db.prepare('SELECT status FROM quotations WHERE id = ?').get(qtId) as any
    expect(qt.status).toBe('SENT')
  })

  it('DRAFT→REJECTED (ข้ามขั้น SENT) → 400 INVALID_STATUS_TRANSITION', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const customerId = seedCustomer(u.tenantId)
    const qtId = seedDraftQT(u.tenantId, customerId)

    const res = await request(app).put(`/api/quotations/${qtId}/status`)
      .set('Authorization', `Bearer ${u.token}`)
      .send({ status: 'REJECTED' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_STATUS_TRANSITION')
  })
})

/**
 * ITEM 4 (ตรวจ 2026-10-05): เหมือน quotations.test.ts — formatDocumentNumber('SO', ...)
 * ต้องอยู่ในทรานแซกชันเดียวกับ insert ไม่งั้น insert ล้มเหลว (เช่น FK ลูกค้าไม่มีจริง) ตัวนับขยับ
 * ไปแล้วไม่ย้อนกลับ
 */
describe('เลขที่เอกสารไม่เสียถ้า insert ล้มเหลว (numbering rollback) — SO', () => {
  it('customerId ไม่มีจริง → FK พังตอน insert, ตัวนับ document_sequences SALES_ORDER ไม่ขยับ', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const before = (db.prepare(
      "SELECT COALESCE(MAX(last_number),0) n FROM document_sequences WHERE tenant_id = ? AND doc_type = 'SALES_ORDER'"
    ).get(u.tenantId) as any).n

    const res = await request(app).post('/api/sales-orders')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ customerId: 'ไม่มีจริง-' + generateId(), items: [{ productName: 'ของ', quantity: 1, unitPrice: 10 }] })

    expect(res.status).toBe(500)

    const after = (db.prepare(
      "SELECT COALESCE(MAX(last_number),0) n FROM document_sequences WHERE tenant_id = ? AND doc_type = 'SALES_ORDER'"
    ).get(u.tenantId) as any).n
    expect(after, 'เลขต้องไม่ขยับเมื่อ insert ล้มเหลว').toBe(before)
  })
})
