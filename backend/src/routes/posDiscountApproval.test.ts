import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import posBillRouter from './pos-bill.routes'
import approvalRouter from './approval.routes'
import settingsRouter from './settings.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/pos', posBillRouter)
app.use('/api/approval', approvalRouter)
app.use('/api/settings', settingsRouter)

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

function seed() {
  const admin = createTestUser({ role: 'ADMIN' })
  const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
  // ปิด VAT/ค่าบริการ ให้ยอดก่อนลด = ราคาสินค้าตรง ๆ
  db.prepare('INSERT INTO company_settings (tenant_id, pos_bom_deduct, pos_vat_enabled, pos_service_enabled) VALUES (?, 0, 0, 0)').run(admin.tenantId)
  db.prepare(`INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, opening_cash, opened_by)
              VALUES (?, ?, 'SH-D', 'OPEN', ?, 0, 'tester')`).run(generateId(), admin.tenantId, new Date().toISOString())
  return { admin, user, tenantId: admin.tenantId }
}

async function openBill(t: ReturnType<typeof seed>, prices: number[], customerId?: string) {
  const bill = await request(app).post('/api/pos/bills').set(auth(t.user.token)).send(customerId ? { customer_id: customerId } : {})
  expect(bill.status, JSON.stringify(bill.body)).toBe(200)
  const billId = bill.body.data.id as string
  for (const price of prices) {
    const productId = generateId(), menuId = generateId()
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, unit, location, status)
                VALUES (?, ?, ?, 'อาหาร', 'FOOD', 'pcs', 'WH1', 'ACTIVE')`).run(productId, t.tenantId, productId)
    db.prepare('INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price) VALUES (?, ?, ?, ?)').run(menuId, t.tenantId, productId, price)
    const r = await request(app).post(`/api/pos/bills/${billId}/items`).set(auth(t.user.token)).send({ pos_menu_id: menuId, quantity: 1 })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
  }
  return billId
}

const pay = (token: string, billId: string, body: any) =>
  request(app).post(`/api/pos/bills/${billId}/pay`).set(auth(token)).send({ payment_method: 'CASH', ...body })
const billRow = (id: string) => db.prepare('SELECT * FROM pos_running_bills WHERE id = ?').get(id) as any
const decide = (token: string, reqId: string, decision = 'APPROVED') =>
  request(app).put(`/api/approval/requests/${reqId}/decision`).set(auth(token)).send({ decision })
// เลขคำขอรันแยกต่อ tenant — ต้องกรอง tenant ด้วย
const reqByNumber = (tenantId: string, n: string) =>
  db.prepare('SELECT * FROM approval_requests WHERE tenant_id = ? AND request_number = ?').get(tenantId, n) as any

describe('ส่วนลด POS ต้องขออนุมัติ', () => {
  it('USER ลด 50% → 202 บิลยังไม่ลด · อนุมัติแล้วจ่ายซ้ำได้ ยอดและบัญชีถูก', async () => {
    const t = seed()
    const billId = await openBill(t, [1000])

    const r1 = await pay(t.user.token, billId, { discount_amount: 500 })
    expect(r1.status, JSON.stringify(r1.body)).toBe(202)
    // ระหว่างรอ หน้าบิล/QR ต้องเห็นยอดเต็ม
    expect(billRow(billId).discount_amount).toBe(0)
    expect(billRow(billId).total_amount).toBe(1000)
    const req1 = reqByNumber(t.tenantId, r1.body.request_number)
    expect(JSON.parse(req1.payload)).toMatchObject({ discountPct: 50, baseBeforeDiscount: 1000 })

    expect((await decide(t.admin.token, req1.id)).status).toBe(200)
    expect(billRow(billId).discount_amount).toBe(500)
    expect(billRow(billId).total_amount).toBe(500)

    const r2 = await pay(t.user.token, billId, { discount_amount: 500 })
    expect(r2.status, JSON.stringify(r2.body)).toBe(200)
    expect(r2.body.data.amount).toBe(500)
    expect(billRow(billId).status).toBe('PAID')
    const sums = db.prepare('SELECT SUM(debit) d, SUM(credit) c FROM journal_lines WHERE journal_entry_id = ?')
      .get(r2.body.data.journal_entry_id) as any
    expect(sums.d).toBeGreaterThan(0)
    expect(sums.d).toBeCloseTo(sums.c, 2)
  })

  it('ลบรายการหลังอนุมัติ (% สูงขึ้น) → ต้องขอใหม่', async () => {
    const t = seed()
    const billId = await openBill(t, [600, 400])
    const r1 = await pay(t.user.token, billId, { discount_amount: 500 })
    expect(r1.status).toBe(202)
    await decide(t.admin.token, reqByNumber(t.tenantId, r1.body.request_number).id)

    const item = db.prepare('SELECT id FROM pos_bill_items WHERE bill_id = ? AND total_price = 400').get(billId) as any
    expect((await request(app).delete(`/api/pos/bills/${billId}/items/${item.id}`).set(auth(t.user.token))).status).toBe(200)

    const r2 = await pay(t.user.token, billId, { discount_amount: 500 })
    expect(r2.status, JSON.stringify(r2.body)).toBe(202)
    expect(r2.body.request_number).not.toBe(r1.body.request_number)
    expect(billRow(billId).status).toBe('OPEN')
  })

  it('ใช้คำขอที่ค้างอยู่ซ้ำได้เฉพาะเมื่อครอบยอดที่ขอ', async () => {
    const t = seed()
    const billId = await openBill(t, [1000])
    const a = await pay(t.user.token, billId, { discount_amount: 500 })
    const same = await pay(t.user.token, billId, { discount_amount: 500 })
    expect(same.body.request_number).toBe(a.body.request_number)
    const bigger = await pay(t.user.token, billId, { discount_amount: 600 })
    expect(bigger.status).toBe(202)
    expect(bigger.body.request_number).not.toBe(a.body.request_number)
    const smaller = await pay(t.user.token, billId, { discount_amount: 550 })
    expect(smaller.body.request_number).toBe(bigger.body.request_number)
  })

  it('เกณฑ์ % ตั้งได้ใน Settings → การอนุมัติ และ backend ใช้ค่านั้น', async () => {
    const t = seed()
    const save = (body: any, token = t.admin.token) => request(app).post('/api/approval/settings').set(auth(token))
      .send({ role: 'USER', moduleType: 'pos_discount', approvalRequired: false, autoApproveThreshold: 0, ...body })
    expect((await save({ maxDiscountPct: 60 }, t.user.token)).status).toBe(403)
    expect((await save({ maxDiscountPct: 150 })).status).toBe(400)
    expect((await save({ maxDiscountPct: 60 })).status).toBe(200)
    // บันทึกสวิตช์โดยไม่ส่ง % → ค่าเดิมต้องไม่หาย
    expect((await save({})).body.data.max_discount_pct).toBe(60)

    const ok = await pay(t.user.token, await openBill(t, [1000]), { discount_amount: 500 })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)

    await save({ maxDiscountPct: 30 })
    const blocked = await pay(t.user.token, await openBill(t, [1000]), { discount_amount: 350 })
    expect(blocked.status).toBe(202)
    expect(blocked.body.message).toContain('30%')
  })

  it('แลกแต้ม + ส่วนลดมือที่ติดด่าน → จ่ายรอบใหม่ ส่วนลดจากแต้มนับครั้งเดียว', async () => {
    const t = seed()
    await request(app).put('/api/settings/company').set(auth(t.admin.token))
      .send({ loyalty_earn_rate: 25, loyalty_redeem_rate: 10, loyalty_min_redeem: 100 })
    const custId = generateId()
    db.prepare(`INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, status, tenant_id, loyalty_points)
                VALUES (?, ?, 'มิ้นท์', 'INDIVIDUAL', '-', '', '0812345678', '', 'ACTIVE', ?, 500)`).run(custId, 'C-' + custId.slice(0, 6), t.tenantId)
    const billId = await openBill(t, [1000], custId)

    const r1 = await pay(t.user.token, billId, { discount_amount: 500, redeem_points: 200 })
    expect(r1.status, JSON.stringify(r1.body)).toBe(202)
    expect(billRow(billId).discount_amount).toBe(0)
    const d = await decide(t.admin.token, reqByNumber(t.tenantId, r1.body.request_number).id)
    expect(d.status, JSON.stringify(d.body)).toBe(200)
    // openBill ฝั่งหน้าจอดึง discount_amount กลับเป็นส่วนลดมือ — ต้องไม่มีแต้มปนมา
    expect(billRow(billId).discount_amount).toBe(500)

    const r2 = await pay(t.user.token, billId, { discount_amount: billRow(billId).discount_amount, redeem_points: 200 })
    expect(r2.status, JSON.stringify(r2.body)).toBe(200)
    expect(billRow(billId).discount_amount).toBe(520)
    expect(r2.body.data.amount).toBe(480)
  })
})

describe('อนุมัติยกเลิกบิล POS พร้อมกันสองคน', () => {
  it('ยกเลิกบิลแค่ครั้งเดียว', async () => {
    const t = seed()
    db.prepare(`INSERT INTO approval_settings (id, tenant_id, role, module_type, approval_required, auto_approve_threshold)
                VALUES (?, ?, 'USER', 'pos_void', 1, 0)`).run(generateId(), t.tenantId)
    const billId = generateId()
    db.prepare(`INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, total_amount, subtotal, opened_at, created_by)
                VALUES (?, ?, ?, 'T', 'PAID', 500, 500, ?, 'tester')`).run(billId, t.tenantId, 'POS-' + billId.slice(0, 6), new Date().toISOString())
    const c = await request(app).post(`/api/pos/bills/${billId}/cancel`).set(auth(t.user.token)).send({ reason: 'ซ้ำ' })
    expect(c.status).toBe(202)
    const pending = db.prepare("SELECT id FROM approval_requests WHERE reference_id = ? AND status = 'PENDING'").get(billId) as any

    const admin2 = createTestUser({ role: 'ADMIN', tenantId: t.tenantId })
    const results = await Promise.all([decide(t.admin.token, pending.id), decide(admin2.token, pending.id)])
    expect(results.map(r => r.status).filter(s => s === 200)).toHaveLength(1)
    const bill = billRow(billId)
    expect(bill.status).toBe('CANCELLED')
    expect((bill.notes.match(/\[CANCELLED/g) || []).length).toBe(1)
    expect((db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(pending.id) as any).status).toBe('EXECUTED')
  })
})
