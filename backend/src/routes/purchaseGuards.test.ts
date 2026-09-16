import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import purchaseRouter from './purchase.routes'
import purchaseOrderRouter from './purchaseOrder.routes'
import { createTestUser } from '../test/testAuth'
import { createGoodsReceipt } from '../services/goodsReceipt.service'

const app = express()
app.use(express.json())
app.use('/api/purchase', authenticate, purchaseRouter)
app.use('/api/purchase-orders', authenticate, purchaseOrderRouter)

/**
 * เดิม PUT /goods-receipts/:id/confirm ไม่เช็ค role/แผนกเลย (มีแค่ authenticate ที่หัวไฟล์)
 * พนักงานแผนกไหนก็ล็อกอินแล้วยิงตรงได้ ทำให้สต็อกเพิ่มจริง+ลงบัญชีจริง — ปิดช่องนี้ด้วย
 * can(role, departments, 'purchase'|'stock', 'write') จาก rbac.service
 *
 * และ POST /requests, POST /purchase-orders (สร้างใบขอซื้อ/ใบสั่งซื้อ) เดิมรับ quantity/unitPrice
 * ดิบจาก body ไปคูณ+insert ตรง ๆ ใส่ค่าติดลบ/0 ผ่านได้หมด — ปิดด้วย zod เหมือน purchase-request.routes.ts
 */

function setDepartments(userId: string, departments: string[]) {
  db.prepare('UPDATE users SET departments = ? WHERE id = ?').run(JSON.stringify(departments), userId)
}

function seedPoWithMaterial(tenantId: string, qty = 5) {
  const supplierId = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')")
    .run(supplierId, tenantId, supplierId)

  const stockId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, sealed_qty, unit, base_unit, location, status, unit_cost)
    VALUES (?, ?, ?, 'วัตถุดิบทดสอบ', 'RAW', 0, 0, 'pcs', 'pcs', 'WH1', 'ACTIVE', 1)
  `).run(stockId, tenantId, 'MAT-' + stockId.slice(0, 5))

  const poId = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'APPROVED', 100, 0, 100, ?, ?)
  `).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, now, now)

  const poItemId = generateId()
  db.prepare(`
    INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty)
    VALUES (?, ?, ?, ?, 'วัตถุดิบทดสอบ', ?, 'pcs', 10, 10, 0)
  `).run(poItemId, tenantId, poId, stockId, qty)

  return { poId, poItemId, stockId }
}

describe('PUT /goods-receipts/:id/confirm — ต้องเช็คสิทธิ์ (เดิมไม่เช็คเลย)', () => {
  it('USER ที่ไม่มีแผนกจัดซื้อ/คลัง ยืนยันรับสินค้าไม่ได้ (403) และสต็อกไม่ขยับ', async () => {
    const user = createTestUser({ role: 'USER' })
    const { poId, poItemId, stockId } = seedPoWithMaterial(user.tenantId)
    const gr = createGoodsReceipt(user.tenantId, user.email, {
      purchaseOrderId: poId,
      items: [{ poItemId, materialId: stockId, orderedQty: 5, receivedQty: 5, acceptedQty: 5 }],
    }) as any

    const res = await request(app).put(`/api/purchase/goods-receipts/${gr.id}/confirm`)
      .set('Authorization', `Bearer ${user.token}`).send()

    expect(res.status).toBe(403)
    expect(db.prepare('SELECT status FROM goods_receipts WHERE id = ?').get(gr.id)).toMatchObject({ status: 'DRAFT' })
    expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockId) as any).quantity).toBe(0)
  })

  it('USER แผนกจัดซื้อ ยืนยันรับสินค้าได้ (200) และสต็อกขยับจริง', async () => {
    const user = createTestUser({ role: 'USER' })
    setDepartments(user.userId, ['PURCHASE'])
    const { poId, poItemId, stockId } = seedPoWithMaterial(user.tenantId)
    const gr = createGoodsReceipt(user.tenantId, user.email, {
      purchaseOrderId: poId,
      items: [{ poItemId, materialId: stockId, orderedQty: 5, receivedQty: 5, acceptedQty: 5 }],
    }) as any

    const res = await request(app).put(`/api/purchase/goods-receipts/${gr.id}/confirm`)
      .set('Authorization', `Bearer ${user.token}`).send()

    expect(res.status).toBe(200)
    expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockId) as any).quantity).toBeCloseTo(5, 6)
  })

  it('POWERUSER (ไม่มีแผนกกำหนด) ยืนยันรับสินค้าได้เสมอ', async () => {
    const user = createTestUser({ role: 'POWERUSER' })
    const { poId, poItemId, stockId } = seedPoWithMaterial(user.tenantId)
    const gr = createGoodsReceipt(user.tenantId, user.email, {
      purchaseOrderId: poId,
      items: [{ poItemId, materialId: stockId, orderedQty: 5, receivedQty: 5, acceptedQty: 5 }],
    }) as any

    const res = await request(app).put(`/api/purchase/goods-receipts/${gr.id}/confirm`)
      .set('Authorization', `Bearer ${user.token}`).send()

    expect(res.status).toBe(200)
  })
})

describe('POST /purchase/requests — ตรวจจำนวน/ราคา (เดิมไม่เช็คเลย)', () => {
  it('quantity ติดลบต้องได้ 400 พร้อมบอกบรรทัดที่ผิด', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const res = await request(app).post('/api/purchase/requests')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ department: 'ทดสอบ', items: [{ description: 'ของทดสอบ', quantity: -5, unit: 'pcs' }] })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('รายการที่ 1')
  })

  it('quantity เป็น 0 ต้องได้ 400', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const res = await request(app).post('/api/purchase/requests')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ items: [{ description: 'ของทดสอบ', quantity: 0 }] })

    expect(res.status).toBe(400)
  })

  it('ราคาต่อหน่วยติดลบต้องได้ 400 (ทั้งชื่อ field camelCase และ snake_case)', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const camel = await request(app).post('/api/purchase/requests')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ items: [{ description: 'ของทดสอบ', quantity: 1, estimatedUnitPrice: -1 }] })
    expect(camel.status).toBe(400)

    const snake = await request(app).post('/api/purchase/requests')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ items: [{ description: 'ของทดสอบ', quantity: 1, estimated_unit_price: -1 }] })
    expect(snake.status).toBe(400)
  })

  it('ไม่ส่ง items เลยต้องได้ 400', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const res = await request(app).post('/api/purchase/requests')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ items: [] })

    expect(res.status).toBe(400)
  })

  it('ข้อมูลปกติ (แบบที่หน้าเว็บส่งจริง, ราคา = 0) ต้องผ่านเหมือนเดิม (กัน regression)', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const res = await request(app).post('/api/purchase/requests')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ department: 'ทดสอบ', items: [{ material_id: '', description: 'ของทดสอบ', quantity: 3, unit: 'pcs', estimated_unit_price: 0, estimated_total_price: 0, notes: '' }] })

    expect(res.status).toBe(201)
    expect(res.body.data.items).toHaveLength(1)
  })
})

describe('POST /purchase-orders — ตรวจจำนวน/ราคา (เดิมไม่เช็คเลย)', () => {
  function seedSupplier(tenantId: string) {
    const supplierId = generateId()
    db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')")
      .run(supplierId, tenantId, supplierId)
    return supplierId
  }

  it('quantity ติดลบต้องได้ 400', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const supplierId = seedSupplier(user.tenantId)

    const res = await request(app).post('/api/purchase-orders')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ supplierId, items: [{ description: 'ของทดสอบ', quantity: -2, unitPrice: 10 }] })

    expect(res.status).toBe(400)
  })

  it('unitPrice ติดลบต้องได้ 400', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const supplierId = seedSupplier(user.tenantId)

    const res = await request(app).post('/api/purchase-orders')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ supplierId, items: [{ description: 'ของทดสอบ', quantity: 2, unitPrice: -10 }] })

    expect(res.status).toBe(400)
  })

  it('ไม่ส่ง items เลยต้องได้ 400', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const supplierId = seedSupplier(user.tenantId)

    const res = await request(app).post('/api/purchase-orders')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ supplierId, items: [] })

    expect(res.status).toBe(400)
  })

  it('ข้อมูลปกติต้องผ่านเหมือนเดิม (กัน regression)', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const supplierId = seedSupplier(user.tenantId)

    const res = await request(app).post('/api/purchase-orders')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ supplierId, items: [{ description: 'ของทดสอบ', quantity: 2, unitPrice: 10 }] })

    expect(res.status).toBe(201)
    expect(res.body.data.items).toHaveLength(1)
  })
})

describe('endpoint อื่นในไฟล์เดียวกันที่เจอว่าไม่เช็คสิทธิ์เลย — ปิดด้วยมาตรฐานเดียวกัน', () => {
  it('USER ธรรมดา แปลงใบขอซื้อ (PR) เป็นใบสั่งซื้อ (PO) ไม่ได้ (403)', async () => {
    const user = createTestUser({ role: 'USER' })
    const id = generateId()
    db.prepare(`
      INSERT INTO purchase_requests (id, tenant_id, pr_number, requester_id, requester_name, status, total_amount, request_date)
      VALUES (?, ?, ?, 'u', 'x', 'APPROVED', 100, ?)
    `).run(id, user.tenantId, 'PR-T-' + id.slice(0, 6), new Date().toISOString())

    const res = await request(app).post(`/api/purchase/requests/${id}/convert-to-po`)
      .set('Authorization', `Bearer ${user.token}`).send({ supplierId: generateId() })

    expect(res.status).toBe(403)
    expect(db.prepare('SELECT status FROM purchase_requests WHERE id = ?').get(id)).toMatchObject({ status: 'APPROVED' })
  })

  it('USER ธรรมดา ยืนยันคืนสินค้า (ตัดสต็อก+ลงบัญชี) ไม่ได้ (403)', async () => {
    const user = createTestUser({ role: 'USER' })
    const { poId } = seedPoWithMaterial(user.tenantId)
    const po = db.prepare('SELECT supplier_id FROM purchase_orders WHERE id = ?').get(poId) as any
    const id = generateId()
    db.prepare(`
      INSERT INTO purchase_returns (id, tenant_id, pr_number, purchase_order_id, supplier_id, return_date, reason, subtotal, tax_amount, total_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, 'ทดสอบ', 0, 0, 0, 'APPROVED')
    `).run(id, user.tenantId, 'PRT-T-' + id.slice(0, 6), poId, po.supplier_id, new Date().toISOString())

    const res = await request(app).put(`/api/purchase/returns/${id}/confirm`)
      .set('Authorization', `Bearer ${user.token}`).send()

    expect(res.status).toBe(403)
    expect(db.prepare('SELECT status FROM purchase_returns WHERE id = ?').get(id)).toMatchObject({ status: 'APPROVED' })
  })

  it('USER ธรรมดา อนุมัติ/ยกเลิกใบคืนสินค้าไม่ได้ (403)', async () => {
    const user = createTestUser({ role: 'USER' })
    const { poId } = seedPoWithMaterial(user.tenantId)
    const po = db.prepare('SELECT supplier_id FROM purchase_orders WHERE id = ?').get(poId) as any
    const id = generateId()
    db.prepare(`
      INSERT INTO purchase_returns (id, tenant_id, pr_number, purchase_order_id, supplier_id, return_date, reason, subtotal, tax_amount, total_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, 'ทดสอบ', 0, 0, 0, 'SUBMITTED')
    `).run(id, user.tenantId, 'PRT-T2-' + id.slice(0, 6), poId, po.supplier_id, new Date().toISOString())

    const res = await request(app).put(`/api/purchase/returns/${id}/status`)
      .set('Authorization', `Bearer ${user.token}`).send({ status: 'APPROVED' })

    expect(res.status).toBe(403)
    expect(db.prepare('SELECT status FROM purchase_returns WHERE id = ?').get(id)).toMatchObject({ status: 'SUBMITTED' })
  })
})
