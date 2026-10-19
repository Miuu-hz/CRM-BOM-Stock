import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import posBillRouter from './pos-bill.routes'
import customerRouter from './customer.routes'
import settingsRouter from './settings.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/pos', posBillRouter)
app.use('/api/customers', customerRouter)
app.use('/api/settings', settingsRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['loyalty_transactions', 'journal_lines', 'journal_entries', 'pos_payments', 'pos_bill_items', 'pos_running_bills',
                       'pos_shifts', 'pos_menu_configs', 'stock_items', 'customers', 'company_settings', 'accounts', 'users', 'document_sequences']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* no tenant_id column */ }
    }
  }
})

function seed(phone: string) {
  const u = createTestUser()
  tenants.push(u.tenantId)
  db.prepare('INSERT INTO company_settings (tenant_id, pos_bom_deduct) VALUES (?, 0)').run(u.tenantId)
  db.prepare(`INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, opening_cash, opened_by)
              VALUES (?, ?, 'SH-M', 'OPEN', ?, 0, 'tester')`).run(generateId(), u.tenantId, new Date().toISOString())
  const custId = generateId()
  db.prepare(`INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, status, tenant_id)
              VALUES (?, ?, 'มิ้นท์', 'INDIVIDUAL', '-', '', ?, '', 'ACTIVE', ?)`).run(custId, 'C-' + custId.slice(0, 6), phone, u.tenantId)
  return { ...u, custId }
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

describe('POS member by phone', () => {
  it('ค้นสมาชิกด้วยเบอร์ได้ ไม่ว่าจะพิมพ์ขีด/ช่องว่าง/+66 ต่างจากที่บันทึกไว้', async () => {
    const u = seed('081-234-5678')
    for (const q of ['0812345678', '+66 81 234 5678', '66812345678', '5678', '081 234']) {
      const r = await request(app).get('/api/customers/search').query({ q }).set(auth(u.token))
      expect(r.status, q).toBe(200)
      expect(r.body.data.map((c: any) => c.id), q).toEqual([u.custId])
    }
  })

  async function openMemberBill(u: ReturnType<typeof seed>, price: number) {
    const productId = generateId(), menuId = generateId()
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, unit, location, status)
                VALUES (?, ?, ?, 'ข้าวผัด', 'FOOD', 'pcs', 'WH1', 'ACTIVE')`).run(productId, u.tenantId, productId)
    db.prepare(`INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price) VALUES (?, ?, ?, ?)`).run(menuId, u.tenantId, productId, price)
    const bill = await request(app).post('/api/pos/bills').set(auth(u.token)).send({ customer_id: u.custId })
    expect(bill.status).toBe(200)
    const billId = bill.body.data.id
    expect((await request(app).post(`/api/pos/bills/${billId}/items`).set(auth(u.token)).send({ pos_menu_id: menuId, quantity: 1 })).status).toBe(200)
    return billId as string
  }
  const points = (custId: string) => (db.prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(custId) as any).loyalty_points

  it('รับชำระบิลที่ผูกสมาชิกได้ และแต้มคิดตามอัตราของร้านที่ตั้งไว้ฝั่ง server', async () => {
    const u = seed('0812345678')
    const set = await request(app).put('/api/settings/company').set(auth(u.token)).send({ loyalty_earn_rate: 25 })
    expect(set.status).toBe(200)
    const billId = await openMemberBill(u, 100)

    // earn_rate จาก client ต้องไม่มีผล — กันแคชเชียร์ปั๊มแต้ม
    const pay = await request(app).post(`/api/pos/bills/${billId}/pay`).set(auth(u.token)).send({ payment_method: 'CASH', received_amount: 1000, earn_rate: 1 })
    expect(pay.status, JSON.stringify(pay.body)).toBe(200)
    expect(pay.body.data.points_earned).toBe(Math.floor(pay.body.data.amount / 25))
    expect(points(u.custId)).toBe(pay.body.data.points_earned)
  })

  it('แลกแต้มกลายเป็นส่วนลดในบิลจริง และตรวจขั้นต่ำ/แต้มคงเหลือที่ server', async () => {
    const u = seed('0812345678')
    db.prepare('UPDATE customers SET loyalty_points = 500 WHERE id = ?').run(u.custId)
    await request(app).put('/api/settings/company').set(auth(u.token)).send({ loyalty_earn_rate: 25, loyalty_redeem_rate: 10, loyalty_min_redeem: 100 })
    const billId = await openMemberBill(u, 300)

    const tooFew = await request(app).post(`/api/pos/bills/${billId}/pay`).set(auth(u.token)).send({ payment_method: 'CASH', redeem_points: 50 })
    expect(tooFew.status).toBe(400)
    expect(tooFew.body.code).toBe('REDEEM_INVALID')
    const tooMany = await request(app).post(`/api/pos/bills/${billId}/pay`).set(auth(u.token)).send({ payment_method: 'CASH', redeem_points: 900 })
    expect(tooMany.status).toBe(400)

    const pay = await request(app).post(`/api/pos/bills/${billId}/pay`).set(auth(u.token)).send({ payment_method: 'CASH', redeem_points: 200, discount_amount: 0 })
    expect(pay.status, JSON.stringify(pay.body)).toBe(200)
    expect(pay.body.data.redeem_discount).toBe(20)
    const bill = db.prepare('SELECT discount_amount, total_amount FROM pos_running_bills WHERE id = ?').get(billId) as any
    expect(bill.discount_amount).toBe(20)
    expect(pay.body.data.amount).toBe(bill.total_amount)
    expect(points(u.custId)).toBe(500 - 200 + Math.floor(bill.total_amount / 25))
  })

  it('ตั้งค่าแต้มผิด → 400', async () => {
    const u = seed('0812345678')
    for (const body of [{ loyalty_earn_rate: 0 }, { loyalty_redeem_rate: -1 }, { loyalty_min_redeem: 1.5 }, { loyalty_enabled: 'yes' }]) {
      expect((await request(app).put('/api/settings/company').set(auth(u.token)).send(body)).status, JSON.stringify(body)).toBe(400)
    }
  })
})
