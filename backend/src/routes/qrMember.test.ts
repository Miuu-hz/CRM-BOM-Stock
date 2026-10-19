import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import posBillRouter from './pos-bill.routes'
import posTablesRouter from './pos-tables.routes'
import qrPublicRouter from './qr-public.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use(cookieParser())
app.use('/api/pos', posBillRouter)
app.use('/api/pos', posTablesRouter)
app.use('/qr/api', qrPublicRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM pos_kds_ticket_items WHERE ticket_id IN (SELECT id FROM pos_kds_tickets WHERE tenant_id = ?)').run(t)
    for (const tbl of ['pos_member_devices', 'loyalty_transactions', 'activity_logs', 'pos_kds_tickets', 'journal_lines', 'journal_entries',
                       'pos_payments', 'pos_bill_items', 'pos_running_bills', 'pos_tables', 'pos_shifts', 'pos_menu_configs', 'stock_items',
                       'customers', 'company_settings', 'accounts', 'users', 'document_sequences']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* no tenant_id column */ }
    }
  }
})

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

async function shopWithOpenTable() {
  const u = createTestUser()
  tenants.push(u.tenantId)
  db.prepare(`INSERT INTO company_settings (tenant_id, name, pos_bom_deduct, loyalty_earn_rate, loyalty_redeem_rate, loyalty_min_redeem)
              VALUES (?, 'ครัวบ้านสวน', 0, 25, 10, 100)`).run(u.tenantId)
  db.prepare(`INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, opening_cash, opened_by)
              VALUES (?, ?, 'SH-M', 'OPEN', ?, 0, 'tester')`).run(generateId(), u.tenantId, new Date().toISOString())
  const productId = generateId(), menuId = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, unit, location, status) VALUES (?, ?, ?, 'ข้าวผัด', 'FOOD', 'pcs', 'WH1', 'ACTIVE')`)
    .run(productId, u.tenantId, productId)
  db.prepare(`INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price) VALUES (?, ?, ?, 300)`).run(menuId, u.tenantId, productId)
  await request(app).post('/api/pos/tables').set(auth(u.token)).send({ names: ['T-07'] })
  const table = db.prepare('SELECT id, qr_token FROM pos_tables WHERE tenant_id = ?').get(u.tenantId) as any
  const open = async () => (await request(app).post('/api/pos/bills').set(auth(u.token)).send({ table_id: table.id })).body.data.id as string
  const billId = await open()
  return { ...u, menuId, qr: table.qr_token as string, billId, open }
}

describe('สมาชิกด้วยเบอร์โทรผ่าน QR (แคชเชียร์ยืนยันแทน OTP)', () => {
  it('สมัคร → บิลสะสมแต้มให้ทันที แต่ยังไม่เห็นชื่อ/แต้ม → แคชเชียร์ยืนยัน → เห็นแต้มและแลกได้', async () => {
    const s = await shopWithOpenTable()
    const phone = request.agent(app)

    const join = await phone.post('/qr/api/member').send({ t: s.qr, phone: '081-234-5678', name: 'มิ้นท์', consentPoints: true, consentMarketing: true })
    expect(join.status, JSON.stringify(join.body)).toBe(200)
    expect(join.body.data).toEqual({ member: { status: 'pending', phone: '081-xxx-5678' }, linked: true })
    expect(join.headers['set-cookie'][0]).toMatch(/HttpOnly/)

    const cust = db.prepare('SELECT * FROM customers WHERE tenant_id = ?').get(s.tenantId) as any
    expect(cust).toMatchObject({ name: 'มิ้นท์', phone: '0812345678', lead_source: 'QR สั่งที่โต๊ะ', marketing_consent_at: null })
    expect(cust.pdpa_points_consent_at).toBeTruthy()

    const session = await phone.get('/qr/api/session').query({ t: s.qr })
    expect(session.body.data.member).toEqual({ status: 'pending', phone: '081-xxx-5678' })
    expect(session.body.data.billMember).toEqual({ mine: true, phone: '081-xxx-5678' })
    expect((await phone.get('/qr/api/member/ledger').query({ t: s.qr })).status).toBe(403)

    // แคชเชียร์เห็นว่ารอยืนยัน · แลกแต้มก่อนยืนยันไม่ได้
    db.prepare('UPDATE customers SET loyalty_points = 500 WHERE id = ?').run(cust.id)
    const bill = await request(app).get(`/api/pos/bills/${s.billId}`).set(auth(s.token))
    expect(bill.body.data).toMatchObject({ customer_id: cust.id, member_device_verified_at: null })
    expect(bill.body.data.member_device_id).toBeTruthy()
    await phone.post('/qr/api/order').send({ t: s.qr, items: [{ menuId: s.menuId, qty: 1 }] })
    const early = await request(app).post(`/api/pos/bills/${s.billId}/pay`).set(auth(s.token)).send({ payment_method: 'CASH', redeem_points: 100 })
    expect(early.status).toBe(400)
    expect(early.body.message).toMatch(/ยืนยัน/)

    expect((await request(app).post(`/api/pos/bills/${s.billId}/verify-member`).set(auth(s.token))).status).toBe(200)
    const verified = (await phone.get('/qr/api/session').query({ t: s.qr })).body.data.member
    expect(verified).toEqual({ status: 'verified', phone: '081-xxx-5678', name: 'มิ้นท์', points: 500, marketing: true, available: 500 })

    const pay = await request(app).post(`/api/pos/bills/${s.billId}/pay`).set(auth(s.token)).send({ payment_method: 'CASH', redeem_points: 100 })
    expect(pay.status, JSON.stringify(pay.body)).toBe(200)
    const ledger = await phone.get('/qr/api/member/ledger').query({ t: s.qr })
    expect(ledger.status).toBe(200)
    expect(ledger.body.data.map((l: any) => l.type).sort()).toEqual(['EARN', 'REDEEM'])
  })

  it('เบอร์ที่มีในระบบแล้ว (บันทึกต่างรูปแบบ) ผูกกับลูกค้าเดิม ไม่สร้างซ้ำ และไม่เผยชื่อคนอื่น', async () => {
    const s = await shopWithOpenTable()
    db.prepare(`INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, status, tenant_id, loyalty_points)
                VALUES (?, 'C-OLD', 'คุณสมชาย', 'INDIVIDUAL', '-', '', '+66 89 123 4521', '', 'ACTIVE', ?, 340)`).run(generateId(), s.tenantId)
    const stranger = request.agent(app)
    const join = await stranger.post('/qr/api/member').send({ t: s.qr, phone: '0891234521', consentPoints: true })
    expect(join.body.data.member).toEqual({ status: 'pending', phone: '089-xxx-4521' })
    expect(JSON.stringify(join.body)).not.toContain('สมชาย')
    expect(JSON.stringify(join.body)).not.toContain('340')
    expect((db.prepare('SELECT COUNT(*) n FROM customers WHERE tenant_id = ?').get(s.tenantId) as any).n).toBe(1)

    // คนที่สองที่โต๊ะเดียวกันใส่เบอร์อื่น: บิลมีสมาชิกแล้ว → ไม่ทับ
    const friend = request.agent(app)
    const second = await friend.post('/qr/api/member').send({ t: s.qr, phone: '0612223333', consentPoints: true })
    expect(second.body.data.linked).toBe(false)
    expect((await friend.get('/qr/api/session').query({ t: s.qr })).body.data.billMember).toEqual({ mine: false })
  })

  it('ตรวจข้อมูลเข้า: เบอร์ผิด/ไม่ยินยอม/โต๊ะไม่เปิด · เครื่องที่ยืนยันแล้วรอบหน้ากดผูกบิลได้โดยไม่ต้องใส่เบอร์ · ออกจากระบบ', async () => {
    const s = await shopWithOpenTable()
    const phone = request.agent(app)
    expect((await phone.post('/qr/api/member').send({ t: s.qr, phone: '021234567', consentPoints: true })).status).toBe(400)
    expect((await phone.post('/qr/api/member').send({ t: s.qr, phone: '0812345678' })).status).toBe(400)
    expect((await phone.post('/qr/api/member').send({ t: s.qr })).status).toBe(400)

    await phone.post('/qr/api/member').send({ t: s.qr, phone: '0812345678', consentPoints: true })
    await request(app).post(`/api/pos/bills/${s.billId}/verify-member`).set(auth(s.token))
    await request(app).post(`/api/pos/bills/${s.billId}/items`).set(auth(s.token)).send({ pos_menu_id: s.menuId, quantity: 1 })
    await request(app).post(`/api/pos/bills/${s.billId}/pay`).set(auth(s.token)).send({ payment_method: 'CASH' })
    expect((await phone.post('/qr/api/member').send({ t: s.qr })).status).toBe(409)

    // มาอีกวัน: โต๊ะเปิดรอบใหม่ เครื่องเดิมกดผูกบิลได้เลย
    const nextBill = await s.open()
    const attach = await phone.post('/qr/api/member').send({ t: s.qr })
    expect(attach.body.data).toMatchObject({ linked: true, member: { status: 'verified' } })
    expect((db.prepare('SELECT customer_id FROM pos_running_bills WHERE id = ?').get(nextBill) as any).customer_id).toBeTruthy()

    expect((await phone.post('/qr/api/member/consent').send({ t: s.qr, marketing: true })).body.data.marketing).toBe(true)
    expect((await phone.post('/qr/api/member/logout').send({ t: s.qr })).status).toBe(200)
    expect((await phone.get('/qr/api/session').query({ t: s.qr })).body.data.member).toBeNull()
  })

  it('ขอลบข้อมูล → ลงประวัติลูกค้าใน CRM + ถอนความยินยอมรับข่าวสาร + ลืมเครื่อง', async () => {
    const s = await shopWithOpenTable()
    const phone = request.agent(app)
    await phone.post('/qr/api/member').send({ t: s.qr, phone: '0812345678', consentPoints: true, consentMarketing: true })
    await request(app).post(`/api/pos/bills/${s.billId}/verify-member`).set(auth(s.token))
    expect((await phone.post('/qr/api/member/delete-request').send({ t: s.qr })).status).toBe(200)
    const cust = db.prepare('SELECT id, marketing_consent_at FROM customers WHERE tenant_id = ?').get(s.tenantId) as any
    expect(cust.marketing_consent_at).toBeNull()
    expect((db.prepare('SELECT note FROM activity_logs WHERE customer_id = ?').get(cust.id) as any).note).toMatch(/ขอลบข้อมูล/)
    expect((await phone.get('/qr/api/session').query({ t: s.qr })).body.data.member).toBeNull()
  })
})
