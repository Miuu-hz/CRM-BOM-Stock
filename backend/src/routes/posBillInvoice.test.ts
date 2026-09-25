import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import posBillRouter from './pos-bill.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/pos', posBillRouter)

function seedBill(tenantId: string, status: 'OPEN' | 'PAID', total = 500) {
  const id = generateId()
  db.prepare(`
    INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, total_amount, subtotal, opened_at, created_by)
    VALUES (?, ?, ?, 'Test Bill', ?, ?, ?, ?, 'tester')
  `).run(id, tenantId, 'POS-' + id.slice(0, 6), status, total, total, new Date().toISOString())
  return id
}

// กิจการต้องมีเลขผู้เสียภาษีก่อน ไม่งั้นออกใบกำกับไม่ได้ (SELLER_TAX_ID_REQUIRED)
function createSeller() {
  const u = createTestUser({ role: 'ADMIN' })
  db.prepare('INSERT INTO company_settings (tenant_id, name, tax_id) VALUES (?, ?, ?)')
    .run(u.tenantId, 'ร้านทดสอบ', '0105561234567')
  return u
}

function seedCustomer(tenantId: string) {
  const id = generateId()
  db.prepare(`
    INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, tax_id, address, tenant_id)
    VALUES (?, ?, 'ลูกค้าทดสอบ', 'INDIVIDUAL', 'ลูกค้าทดสอบ', ?, '0800000000', 'กรุงเทพ', '1234567890123', '999 ถนนทดสอบ', ?)
  `).run(id, 'CUST-' + id.slice(0, 6), `${id}@example.com`, tenantId)
  return id
}

// ผู้ที่ไม่มีสิทธิ์ billing เลย — role USER แผนกผลิต (ไม่ใช่ SALES/ACCOUNTING/CEO/IT)
function createProductionUser(tenantId: string) {
  const u = createTestUser({ role: 'USER', tenantId })
  db.prepare("UPDATE users SET departments = '[\"PRODUCTION\"]' WHERE id = ?").run(u.userId)
  return u
}

describe('POST /bills/:id/invoice — ออกใบกำกับภาษีจากบิล POS', () => {
  it('บิล PAID + user มีสิทธิ์ billing → 201 พร้อมเลขใบกำกับ', async () => {
    const seller = createSeller()
    const billId = seedBill(seller.tenantId, 'PAID')
    const customerId = seedCustomer(seller.tenantId)

    const res = await request(app).post(`/api/pos/bills/${billId}/invoice`)
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ customerId })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.invoice.invoice_number).toMatch(/^INV-/)
  })

  it('ยิงซ้ำบิลเดิม → 409 DUPLICATE_INVOICE', async () => {
    const seller = createSeller()
    const billId = seedBill(seller.tenantId, 'PAID')
    const customerId = seedCustomer(seller.tenantId)

    await request(app).post(`/api/pos/bills/${billId}/invoice`)
      .set('Authorization', `Bearer ${seller.token}`).send({ customerId })

    const res = await request(app).post(`/api/pos/bills/${billId}/invoice`)
      .set('Authorization', `Bearer ${seller.token}`).send({ customerId })

    expect(res.status).toBe(409)
    expect(res.body.success).toBe(false)
  })

  it('บิลยัง OPEN (ยังไม่จ่ายเงิน) → 400', async () => {
    const seller = createSeller()
    const billId = seedBill(seller.tenantId, 'OPEN')
    const customerId = seedCustomer(seller.tenantId)

    const res = await request(app).post(`/api/pos/bills/${billId}/invoice`)
      .set('Authorization', `Bearer ${seller.token}`).send({ customerId })

    expect(res.status).toBe(400)
  })

  it('user ไม่มีสิทธิ์ billing (แผนกผลิต role USER) → 403', async () => {
    const admin = createSeller()
    const productionUser = createProductionUser(admin.tenantId)
    const billId = seedBill(admin.tenantId, 'PAID')
    const customerId = seedCustomer(admin.tenantId)

    const res = await request(app).post(`/api/pos/bills/${billId}/invoice`)
      .set('Authorization', `Bearer ${productionUser.token}`).send({ customerId })

    expect(res.status).toBe(403)
  })
})

describe('PATCH /bills/:id/member — แก้ผู้ซื้อหลังจ่ายเงิน', () => {
  it('บิล PAID ที่ยังไม่ออกใบกำกับ → แก้ผู้ซื้อได้สำเร็จ', async () => {
    const seller = createSeller()
    const billId = seedBill(seller.tenantId, 'PAID')
    const customerId = seedCustomer(seller.tenantId)

    const res = await request(app).patch(`/api/pos/bills/${billId}/member`)
      .set('Authorization', `Bearer ${seller.token}`).send({ customer_id: customerId })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('บิล PAID ที่ออกใบกำกับไปแล้ว → 409 ห้ามเปลี่ยนผู้ซื้อ', async () => {
    const seller = createSeller()
    const billId = seedBill(seller.tenantId, 'PAID')
    const customerId = seedCustomer(seller.tenantId)
    const otherCustomerId = seedCustomer(seller.tenantId)

    await request(app).post(`/api/pos/bills/${billId}/invoice`)
      .set('Authorization', `Bearer ${seller.token}`).send({ customerId })

    const res = await request(app).patch(`/api/pos/bills/${billId}/member`)
      .set('Authorization', `Bearer ${seller.token}`).send({ customer_id: otherCustomerId })

    expect(res.status).toBe(409)
  })
})

describe('GET /bills/:id — ข้อมูลใบกำกับที่ออกแล้ว', () => {
  it('บิลที่ออกใบกำกับแล้ว → data.invoice.invoice_number ตรง และมี customer_tax_branch', async () => {
    const seller = createSeller()
    const billId = seedBill(seller.tenantId, 'PAID')
    const customerId = seedCustomer(seller.tenantId)

    // ต้องผูกสมาชิกเข้าบิลก่อน (pos_running_bills.customer_id) ไม่งั้น GET /bills/:id
    // จะ JOIN customers ไม่เจอ — createInvoiceFromPosBill เองไม่แตะคอลัมน์นี้
    await request(app).patch(`/api/pos/bills/${billId}/member`)
      .set('Authorization', `Bearer ${seller.token}`).send({ customer_id: customerId })

    const invoiceRes = await request(app).post(`/api/pos/bills/${billId}/invoice`)
      .set('Authorization', `Bearer ${seller.token}`).send({ customerId })

    const res = await request(app).get(`/api/pos/bills/${billId}`)
      .set('Authorization', `Bearer ${seller.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.invoice.invoice_number).toBe(invoiceRes.body.data.invoice.invoice_number)
    expect(res.body.data.customer_tax_branch).toBe('สำนักงานใหญ่')
  })
})
