import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import poRouter from './purchaseOrder.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/purchase-orders', poRouter)

function seedSupplier(tenantId: string) {
  const id = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')")
    .run(id, tenantId, id)
  return id
}

function seedPO(tenantId: string, supplierId: string, status = 'APPROVED') {
  const id = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1000, 70, 1070, ?, ?)
  `).run(id, tenantId, 'PO-' + id.slice(0, 6), supplierId, status, now, now)
  return id
}

const edit = (token: string, poId: string, supplierId: string) =>
  request(app).put(`/api/purchase-orders/${poId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ supplierId, items: [{ quantity: 2, unitPrice: 5000 }], taxRate: 0 })

/**
 * ใบสั่งซื้อที่มีใบรับของ/ใบแจ้งหนี้อ้างอิงอยู่ ห้ามแก้ไม่ว่าใคร —
 * แก้ราคา/จำนวนย้อนหลังทำให้ของที่รับจริงกับบัญชีเจ้าหนี้ไม่ตรงกับใบสั่งซื้ออีกต่อไป
 */
describe('ล็อกใบสั่งซื้อที่รับของ/วางบิลแล้ว', () => {
  it('มีใบรับสินค้าอ้างอิง → ADMIN ก็แก้ไม่ได้', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const supplierId = seedSupplier(admin.tenantId)
    const poId = seedPO(admin.tenantId, supplierId)
    db.prepare(`
      INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, status)
      VALUES (?, ?, 'GR-0001', ?, ?, 'CONFIRMED')
    `).run(generateId(), admin.tenantId, poId, supplierId)

    const res = await edit(admin.token, poId, supplierId)
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('GR-0001')

    const after = db.prepare('SELECT total_amount FROM purchase_orders WHERE id = ?').get(poId) as any
    expect(after.total_amount).toBe(1070)
  })

  it('ใบรับสินค้าถูกยกเลิกแล้ว → แก้ได้', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const supplierId = seedSupplier(admin.tenantId)
    const poId = seedPO(admin.tenantId, supplierId)
    db.prepare(`
      INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, status)
      VALUES (?, ?, 'GR-0002', ?, ?, 'CANCELLED')
    `).run(generateId(), admin.tenantId, poId, supplierId)

    const res = await edit(admin.token, poId, supplierId)
    expect(res.status).toBe(200)
  })

  it('มีใบแจ้งหนี้อ้างอิง → แก้ไม่ได้', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const supplierId = seedSupplier(admin.tenantId)
    const poId = seedPO(admin.tenantId, supplierId)
    db.prepare(`
      INSERT INTO purchase_invoices (id, tenant_id, pi_number, purchase_order_id, supplier_id, invoice_date, total_amount, status)
      VALUES (?, ?, 'PI-0001', ?, ?, date('now'), 1070, 'PENDING')
    `).run(generateId(), admin.tenantId, poId, supplierId)

    const res = await edit(admin.token, poId, supplierId)
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('PI-0001')
  })

  it('ใบสะอาดไม่มีอะไรอ้างอิง → แก้ได้ตามปกติ', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const supplierId = seedSupplier(admin.tenantId)
    const poId = seedPO(admin.tenantId, supplierId)

    const res = await edit(admin.token, poId, supplierId)
    expect(res.status).toBe(200)
    const after = db.prepare('SELECT total_amount FROM purchase_orders WHERE id = ?').get(poId) as any
    expect(after.total_amount).toBe(10000)
  })
})
