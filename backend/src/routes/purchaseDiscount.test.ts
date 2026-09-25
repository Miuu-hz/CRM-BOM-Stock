import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import poRouter from './purchaseOrder.routes'
import { createTestUser } from '../test/testAuth'

/**
 * ส่วนลดท้ายบิลฝั่งซื้อ — ฟอร์มมีช่องให้กรอกมาตลอด แต่ purchase_orders ไม่มีคอลัมน์เก็บเลย
 * ยอดบนจอจึงไม่เคยตรงกับที่บันทึก (บั๊กรูปเดียวกับส่วนลด POS)
 * และตาม ม.79 ส่วนลดต้องหักออกจากฐานก่อนคิด VAT
 */
const app = express()
app.use(express.json())
app.use('/api/purchase-orders', poRouter)

function seedSupplier(tenantId: string) {
  const id = generateId()
  db.prepare(`INSERT INTO suppliers (id, tenant_id, code, name, contact_name, email, phone, address, status)
    VALUES (?, ?, ?, 'ผู้ขายทดสอบ', 'ติดต่อ', 'sup@example.com', '0800000000', '1 ถนนทดสอบ', 'ACTIVE')`)
    .run(id, tenantId, 'SUP-' + id.slice(0, 6))
  return id
}

describe('ส่วนลดใบสั่งซื้อ', () => {
  it('ส่วนลดต้องถูกบันทึก และหักออกจากฐานก่อนคิด VAT', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const supplierId = seedSupplier(u.tenantId)

    const res = await request(app).post('/api/purchase-orders')
      .set('Authorization', `Bearer ${u.token}`)
      .send({
        supplierId, taxRate: 7, discountAmount: 20,
        items: [{ description: 'ของทดสอบ', quantity: 1, unitPrice: 100, unit: 'ชิ้น' }],
      })

    expect(res.status).toBe(201)
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(res.body.data.id) as any
    expect(po.subtotal).toBe(100)
    expect(po.discount_amount, 'ส่วนลดต้องถูกบันทึก ไม่ใช่หายไป').toBe(20)
    expect(po.tax_amount, '(100 − 20) × 7% = 5.6 ไม่ใช่ 7').toBeCloseTo(5.6, 2)
    expect(po.total_amount).toBeCloseTo(85.6, 2)
    expect(po.subtotal - po.discount_amount + po.tax_amount).toBeCloseTo(po.total_amount, 2)
  })

  it('ไม่ส่งส่วนลดมา → พฤติกรรมเดิมทุกอย่าง', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const supplierId = seedSupplier(u.tenantId)

    const res = await request(app).post('/api/purchase-orders')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ supplierId, taxRate: 7, items: [{ description: 'ของทดสอบ', quantity: 1, unitPrice: 100, unit: 'ชิ้น' }] })

    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(res.body.data.id) as any
    expect(po.discount_amount).toBe(0)
    expect(po.tax_amount).toBe(7)
    expect(po.total_amount).toBe(107)
  })
})
