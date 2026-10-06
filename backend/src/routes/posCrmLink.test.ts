import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import customerRouter from './customer.routes'
import dashboardRouter from './dashboard.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/customers', customerRouter)
app.use('/api/dashboard', dashboardRouter)

// บิล POS ที่ผูกสมาชิก CRM ต้องโผล่ทั้งในประวัติซื้อของลูกค้า และลูกค้าท็อป 5 บนแดชบอร์ด
describe('POS → CRM / Dashboard', () => {
  it('บิล POS ที่จ่ายแล้วของสมาชิก นับในประวัติซื้อ + ท็อปลูกค้า', async () => {
    const { tenantId, token } = createTestUser()
    const custId = generateId(), billId = generateId()
    db.prepare(`INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, status, tenant_id) VALUES (?, ?, 'ลูกค้าหน้าร้าน', 'INDIVIDUAL', '-', '-', '-', '-', 'ACTIVE', ?)`)
      .run(custId, 'C-' + custId.slice(0, 6), tenantId)
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, opened_at, closed_at, total_amount, customer_id)
      VALUES (?, ?, 'POS-T-1', 'โต๊ะ 1', 'PAID', ?, ?, 450, ?)`).run(billId, tenantId, now, now, custId)
    db.pragma('foreign_keys = OFF') // ponytail: ไม่สร้างเมนู POS จริง เทสต์นี้สนแค่ยอดบิล
    db.prepare(`INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price)
      VALUES (?, ?, ?, 'menu-t', 'กาแฟเย็น', 3, 150, 450)`).run(generateId(), tenantId, billId)
    db.pragma('foreign_keys = ON')

    try {
      const orders = await request(app).get(`/api/customers/${custId}/orders`).set('Authorization', `Bearer ${token}`)
      expect(orders.status).toBe(200)
      expect(orders.body.pagination.total).toBe(1)
      expect(orders.body.data[0]).toMatchObject({ source: 'POS', totalAmount: 450 })
      expect(orders.body.data[0].items[0]).toMatchObject({ productName: 'กาแฟเย็น', quantity: 3 })

      const top = await request(app).get('/api/dashboard/top-customers?period=day').set('Authorization', `Bearer ${token}`)
      expect(top.status).toBe(200)
      expect(top.body.data).toEqual([expect.objectContaining({ id: custId, revenue: 450 })])
    } finally {
      db.prepare('DELETE FROM pos_bill_items WHERE bill_id = ?').run(billId)
      db.prepare('DELETE FROM pos_running_bills WHERE id = ?').run(billId)
      db.prepare('DELETE FROM customers WHERE id = ?').run(custId)
    }
  })
})
