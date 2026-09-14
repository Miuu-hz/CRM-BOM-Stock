import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import purchaseRouter from './purchase.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/purchase', authenticate, purchaseRouter)

/**
 * ยกเลิกการจ่ายเงินผู้ขายเคยใช้ DELETE ลบแถวทิ้ง — journal ที่กลับรายการแล้วชี้ reference_id
 * มาที่แถวที่ไม่มีอยู่จริง ตามรอยไม่ได้ว่าเป็นใบไหน ตอนนี้เป็น soft-cancel
 * เทสต์นี้กันไม่ให้ย้อนกลับไปเป็น DELETE และกันไม่ให้ยอดที่ยกเลิกแล้วถูกนับซ้ำ
 */
function seedPaidInvoice(tenantId: string) {
  const supplierId = generateId()
  db.prepare(`INSERT INTO suppliers (id, tenant_id, code, name, contact_name, email, phone)
    VALUES (?, ?, ?, 'ผู้ขายทดสอบ', 'x', 'x@example.com', '0800000000')`)
    .run(supplierId, tenantId, 'SUP-' + supplierId.slice(0, 8))

  const poId = generateId()
  db.prepare(`INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, total_amount, order_date)
    VALUES (?, ?, ?, ?, 'RECEIVED', 1000, ?)`)
    .run(poId, tenantId, 'PO-TEST-' + poId.slice(0, 8), supplierId, new Date().toISOString())

  const piId = generateId()
  db.prepare(`INSERT INTO purchase_invoices (id, tenant_id, pi_number, purchase_order_id, supplier_id, invoice_date,
      subtotal, tax_amount, total_amount, paid_amount, balance_amount, status, payment_status)
    VALUES (?, ?, ?, ?, ?, ?, 1000, 0, 1000, 1000, 0, 'ISSUED', 'PAID')`)
    .run(piId, tenantId, 'PI-TEST-' + piId.slice(0, 8), poId, supplierId, new Date().toISOString().slice(0, 10))

  const payId = generateId()
  db.prepare(`INSERT INTO supplier_payments (id, tenant_id, payment_number, supplier_id, purchase_invoice_id,
      payment_date, payment_method, amount, withholding_tax, net_amount, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'CASH', 1000, 0, 1000, 'test')`)
    .run(payId, tenantId, 'PAY-TEST-' + payId.slice(0, 8), supplierId, piId, new Date().toISOString().slice(0, 10))

  return { piId, payId }
}

describe('ยกเลิกการจ่ายเงินผู้ขาย = soft-cancel ไม่ใช่ลบแถว', () => {
  it('ยกเลิกแล้วแถวยังอยู่ สถานะเป็น CANCELLED และใบแจ้งหนี้กลับไปค้างชำระ', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const { piId, payId } = seedPaidInvoice(admin.tenantId)

    const res = await request(app).delete(`/api/purchase/payments/${payId}`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)

    const row = db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(payId) as any
    expect(row).toBeTruthy()                    // ห้ามหายไปจากฐาน
    expect(row.status).toBe('CANCELLED')

    const pi = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(piId) as any
    expect(pi.paid_amount).toBe(0)
    expect(pi.payment_status).toBe('UNPAID')
  })

  it('ยกเลิกซ้ำไม่ได้ และยอดที่ยกเลิกแล้วไม่ถูกนับในลิสต์การจ่ายเงิน', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const { payId } = seedPaidInvoice(admin.tenantId)

    await request(app).delete(`/api/purchase/payments/${payId}`)
      .set('Authorization', `Bearer ${admin.token}`)
    const again = await request(app).delete(`/api/purchase/payments/${payId}`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(again.status).toBe(400)

    const list = await request(app).get('/api/purchase/payments')
      .set('Authorization', `Bearer ${admin.token}`)
    expect(list.status).toBe(200)
    expect((list.body.data as any[]).some(p => p.id === payId)).toBe(false)
  })
})
