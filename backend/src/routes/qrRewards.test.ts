import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import posBillRouter from './pos-bill.routes'
import posTablesRouter from './pos-tables.routes'
import qrPublicRouter from './qr-public.routes'
import qrMarketingRouter from './qr-marketing.routes'
import { createTestUser } from '../test/testAuth'
import { thaiNow } from '../services/qrRewards.service'
import { parseSelection } from '../services/billing.catalog'

const app = express()
app.use(express.json())
app.use(cookieParser())
app.use('/api/pos', posBillRouter)
app.use('/api/pos', posTablesRouter)
app.use('/api/pos/qr-marketing', qrMarketingRouter)
app.use('/qr/api', qrPublicRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM pos_kds_ticket_items WHERE ticket_id IN (SELECT id FROM pos_kds_tickets WHERE tenant_id = ?)').run(t)
    for (const tbl of ['pos_redemptions', 'pos_rewards', 'pos_promotions', 'pos_ad_slots', 'pos_ad_events', 'pos_member_devices', 'loyalty_transactions',
                       'pos_kds_tickets', 'journal_lines', 'journal_entries', 'pos_payments', 'pos_bill_items', 'pos_running_bills', 'pos_tables',
                       'pos_shifts', 'pos_menu_configs', 'stock_items', 'customers', 'company_settings', 'accounts', 'users', 'document_sequences']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* no tenant_id column */ }
    }
  }
})

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

async function shop() {
  const u = createTestUser()
  tenants.push(u.tenantId)
  db.prepare(`INSERT INTO company_settings (tenant_id, name, pos_bom_deduct, loyalty_earn_rate) VALUES (?, 'ครัวบ้านสวน', 0, 100)`).run(u.tenantId)
  db.prepare(`INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, opening_cash, opened_by) VALUES (?, ?, 'SH-R', 'OPEN', ?, 0, 'tester')`)
    .run(generateId(), u.tenantId, new Date().toISOString())
  const menu = (name: string, price: number) => {
    const pid = generateId(), mid = generateId()
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, unit, location, status) VALUES (?, ?, ?, ?, 'FOOD', 'pcs', 'WH1', 'ACTIVE')`).run(pid, u.tenantId, pid, name)
    db.prepare(`INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price) VALUES (?, ?, ?, ?)`).run(mid, u.tenantId, pid, price)
    return mid
  }
  const rice = menu('ข้าวผัด', 100), coconut = menu('น้ำมะพร้าว', 45)
  await request(app).post('/api/pos/tables').set(auth(u.token)).send({ names: ['T-01'] })
  const table = db.prepare('SELECT id, qr_token FROM pos_tables WHERE tenant_id = ?').get(u.tenantId) as any
  const billId = (await request(app).post('/api/pos/bills').set(auth(u.token)).send({ table_id: table.id })).body.data.id as string
  return { ...u, rice, coconut, qr: table.qr_token as string, billId }
}

async function verifiedMember(s: Awaited<ReturnType<typeof shop>>, points: number) {
  const phone = request.agent(app)
  await phone.post('/qr/api/member').send({ t: s.qr, phone: '0812345678', consentPoints: true })
  await request(app).post(`/api/pos/bills/${s.billId}/verify-member`).set(auth(s.token))
  const cust = db.prepare('SELECT id FROM customers WHERE tenant_id = ?').get(s.tenantId) as any
  db.prepare('UPDATE customers SET loyalty_points = ? WHERE id = ?').run(points, cust.id)
  return { phone, custId: cust.id as string }
}
const pts = (custId: string) => (db.prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(custId) as any).loyalty_points

describe('เฟส 3: โปรโมชัน', () => {
  it('โปรที่อยู่ในช่วงวันโผล่ในหน้า QR · หมดช่วงไม่โผล่ · โปรสมาชิกไม่ให้ปุ่มสั่งกับคนที่ไม่ใช่สมาชิก', async () => {
    const s = await shop()
    const today = thaiNow().date
    const add = (body: object) => request(app).post('/api/pos/qr-marketing/promotions').set(auth(s.token)).send(body)
    expect((await add({ title: 'น้ำมะพร้าว 1 แถม 1', pos_menu_id: s.coconut, starts_on: today, ends_on: today })).status).toBe(200)
    expect((await add({ title: 'หมดแล้ว', ends_on: '2020-01-01' })).status).toBe(200)
    expect((await add({ title: 'สมาชิกลด 10%', pos_menu_id: s.rice, members_only: true })).status).toBe(200)
    expect((await add({ title: '' })).status).toBe(400)
    expect((await add({ title: 'เมนูร้านอื่น', pos_menu_id: 'nope' })).status).toBe(400)

    const promos = (await request(app).get('/qr/api/session').query({ t: s.qr })).body.data.promotions
    expect(promos.map((p: any) => [p.title, p.menuId])).toEqual([['น้ำมะพร้าว 1 แถม 1', s.coconut], ['สมาชิกลด 10%', null]])
  })
})

describe('เฟส 3: แลกแต้มเป็นของแถม (จองตอนสั่ง → ตัดตอนจ่าย)', () => {
  it('สมาชิกยืนยันแล้วแลกได้ · ของแถมเข้าบิลราคา 0 และเข้าครัว · แต้มจอง → ตัดจริงตอนจ่าย', async () => {
    const s = await shop()
    const { phone, custId } = await verifiedMember(s, 300)
    const reward = (await request(app).post('/api/pos/qr-marketing/rewards').set(auth(s.token))
      .send({ name: 'น้ำมะพร้าวฟรี', points_cost: 120, pos_menu_id: s.coconut })).body.data.id

    const session = (await phone.get('/qr/api/session').query({ t: s.qr })).body.data
    expect(session.rewards).toEqual([{ id: reward, name: 'น้ำมะพร้าวฟรี', points: 120, available: true }])
    expect(session.member.available).toBe(300)

    const order = await phone.post('/qr/api/order').send({ t: s.qr, items: [{ menuId: s.rice, qty: 1 }], rewards: [reward, reward] })
    expect(order.status, JSON.stringify(order.body)).toBe(200)
    const items = db.prepare('SELECT product_name, total_price, sent_to_kds FROM pos_bill_items WHERE bill_id = ? ORDER BY total_price').all(s.billId) as any[]
    expect(items).toEqual([
      { product_name: '🎁 น้ำมะพร้าวฟรี', total_price: 0, sent_to_kds: 1 },
      { product_name: '🎁 น้ำมะพร้าวฟรี', total_price: 0, sent_to_kds: 1 },
      { product_name: 'ข้าวผัด', total_price: 100, sent_to_kds: 1 },
    ])
    expect((await phone.get('/qr/api/session').query({ t: s.qr })).body.data.member.available).toBe(60)
    expect(pts(custId)).toBe(300) // ยังไม่ตัดจริง

    const tooMuch = await phone.post('/qr/api/order').send({ t: s.qr, rewards: [reward] })
    expect(tooMuch.status).toBe(409)
    expect(tooMuch.body.message).toMatch(/แต้มไม่พอ/)

    const pay = await request(app).post(`/api/pos/bills/${s.billId}/pay`).set(auth(s.token)).send({ payment_method: 'CASH' })
    expect(pay.status, JSON.stringify(pay.body)).toBe(200)
    expect(pay.body.data.points_redeemed).toBe(240)
    expect(pts(custId)).toBe(300 - 240 + pay.body.data.points_earned)
    expect(db.prepare(`SELECT status FROM pos_redemptions WHERE bill_id = ?`).all(s.billId).map((r: any) => r.status)).toEqual(['USED', 'USED'])
  })

  it('เครื่องยังไม่ยืนยันแลกไม่ได้ · แคชเชียร์ลบของแถมออก = ไม่ตัดแต้ม · ถอดสมาชิกออกแล้วจ่ายไม่ได้จนกว่าจะแก้', async () => {
    const s = await shop()
    const reward = (await request(app).post('/api/pos/qr-marketing/rewards').set(auth(s.token))
      .send({ name: 'น้ำฟรี', points_cost: 50, pos_menu_id: s.coconut })).body.data.id
    const stranger = request.agent(app)
    await stranger.post('/qr/api/member').send({ t: s.qr, phone: '0899999999', consentPoints: true })
    expect((await stranger.post('/qr/api/order').send({ t: s.qr, rewards: [reward] })).status).toBe(403)

    await request(app).post(`/api/pos/bills/${s.billId}/verify-member`).set(auth(s.token))
    const custId = (db.prepare('SELECT id FROM customers WHERE tenant_id = ?').get(s.tenantId) as any).id
    db.prepare('UPDATE customers SET loyalty_points = 100 WHERE id = ?').run(custId)
    expect((await stranger.post('/qr/api/order').send({ t: s.qr, items: [{ menuId: s.rice, qty: 1 }], rewards: [reward] })).status).toBe(200)

    // ถอดสมาชิก → จ่ายไม่ได้ (ของแถมเป็นของสมาชิกคนนั้น)
    await request(app).patch(`/api/pos/bills/${s.billId}/member`).set(auth(s.token)).send({ customer_id: null })
    const blocked = await request(app).post(`/api/pos/bills/${s.billId}/pay`).set(auth(s.token)).send({ payment_method: 'CASH' })
    expect(blocked.status).toBe(409)
    expect(blocked.body.code).toBe('REWARD_MEMBER_MISMATCH')

    // ผูกกลับ + ลบรายการของแถม → จ่ายได้ แต้มไม่ถูกตัด
    await request(app).patch(`/api/pos/bills/${s.billId}/member`).set(auth(s.token)).send({ customer_id: custId })
    const gift = db.prepare(`SELECT id FROM pos_bill_items WHERE bill_id = ? AND total_price = 0`).get(s.billId) as any
    expect((await request(app).delete(`/api/pos/bills/${s.billId}/items/${gift.id}`).query({ reason: 'ลูกค้าไม่เอา' }).set(auth(s.token))).status).toBe(200)
    const pay = await request(app).post(`/api/pos/bills/${s.billId}/pay`).set(auth(s.token)).send({ payment_method: 'CASH' })
    expect(pay.status, JSON.stringify(pay.body)).toBe(200)
    expect(pay.body.data.points_redeemed).toBe(0)
    expect((db.prepare('SELECT status FROM pos_redemptions WHERE bill_id = ?').get(s.billId) as any).status).toBe('RETURNED')
  })
})

describe('เฟส 4: Pop-up โฆษณา', () => {
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64)])

  it('อัปโหลดรูป + ตั้งช่วงเวลา → ขึ้นในหน้า QR เฉพาะในช่วง · เก็บสถิติ · ลบรูปแล้วไม่ขึ้น', async () => {
    const s = await shop()
    const up = await request(app).post('/api/pos/qr-marketing/ad/image').set(auth(s.token)).attach('image', png, { filename: 'ad.png', contentType: 'image/png' })
    expect(up.status, JSON.stringify(up.body)).toBe(200)
    expect(up.body.data.image_url).toMatch(/^\/uploads\/qr-ads\/.+\.png$/)
    expect((await request(app).post('/api/pos/qr-marketing/ad/image').set(auth(s.token))
      .attach('image', Buffer.from('not an image at all'), { filename: 'x.png', contentType: 'image/png' })).status).toBe(400)

    expect((await request(app).put('/api/pos/qr-marketing/ad').set(auth(s.token)).send({ link_type: 'menu', link_menu_id: s.coconut })).status).toBe(200)
    const ad = (await request(app).get('/qr/api/session').query({ t: s.qr })).body.data.ad
    expect(ad).toMatchObject({ image: up.body.data.image_url, link: 'menu', menuId: s.coconut })

    // นอกช่วงเวลาที่ตั้ง → ไม่ขึ้น
    const now = thaiNow().time
    const later = now < '22:00' ? ['23:00', '23:30'] : ['01:00', '01:30']
    await request(app).put('/api/pos/qr-marketing/ad').set(auth(s.token)).send({ link_type: 'promo', daily_start: later[0], daily_end: later[1] })
    expect((await request(app).get('/qr/api/session').query({ t: s.qr })).body.data.ad).toBeNull()
    expect((await request(app).put('/api/pos/qr-marketing/ad').set(auth(s.token)).send({ daily_start: '10:00' })).status).toBe(400)

    await request(app).put('/api/pos/qr-marketing/ad').set(auth(s.token)).send({ link_type: 'none' })
    expect((await request(app).post('/qr/api/ad-event').send({ t: s.qr, type: 'shown' })).status).toBe(200)
    expect((await request(app).post('/qr/api/ad-event').send({ t: s.qr, type: 'tap' })).status).toBe(200)
    expect((await request(app).post('/qr/api/ad-event').send({ t: s.qr, type: 'hack' })).status).toBe(400)
    expect((await request(app).get('/api/pos/qr-marketing/ad').set(auth(s.token))).body.data.stats).toEqual({ shown: 1, tap: 1, close: 0 })

    await request(app).delete('/api/pos/qr-marketing/ad/image').set(auth(s.token))
    expect((await request(app).get('/qr/api/session').query({ t: s.qr })).body.data.ad).toBeNull()
  })

  it('Add-on Pop-up ฿19 ซื้อได้เฉพาะเมื่อมี Pack Shop', () => {
    expect(() => parseSelection({ plan: 'business', cycle: 'monthly', packs: ['online', 'maker'], addons: { qr_ad: 1 } })).toThrow(/Pack Shop/)
    expect(parseSelection({ plan: 'business', cycle: 'monthly', packs: ['shop', 'maker'], addons: { qr_ad: 1 } }).addons).toEqual({ qr_ad: 1 })
    expect(parseSelection({ plan: 'pro', cycle: 'monthly', packs: [], addons: { qr_ad: 1 } }).addons).toEqual({ qr_ad: 1 })
  })
})
