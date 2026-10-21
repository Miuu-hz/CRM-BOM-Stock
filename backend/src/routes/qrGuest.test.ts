import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import posBillRouter from './pos-bill.routes'
import posTablesRouter from './pos-tables.routes'
import qrPublicRouter from './qr-public.routes'
import settingsRouter from './settings.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use(cookieParser())
app.use('/api/pos', posBillRouter)
app.use('/api/pos', posTablesRouter)
app.use('/api/settings', settingsRouter)
app.use('/qr/api', qrPublicRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM pos_kds_ticket_items WHERE ticket_id IN (SELECT id FROM pos_kds_tickets WHERE tenant_id = ?)').run(t)
    for (const tbl of [
      'pos_guest_bill_items', 'pos_guest_devices', 'pos_qr_order_keys', 'pos_member_devices',
      'loyalty_transactions', 'activity_logs', 'pos_kds_tickets', 'journal_lines', 'journal_entries',
      'pos_payments', 'pos_bill_items', 'pos_running_bills', 'pos_tables', 'pos_shifts',
      'pos_menu_configs', 'stock_items', 'customers', 'company_settings', 'accounts', 'users', 'document_sequences',
    ]) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* no tenant_id column */ }
    }
  }
})

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

async function seedShop() {
  const u = createTestUser()
  tenants.push(u.tenantId)
  db.prepare(`INSERT INTO company_settings (tenant_id, name, pos_bom_deduct, loyalty_enabled, loyalty_earn_rate, loyalty_redeem_rate, loyalty_min_redeem)
              VALUES (?, 'ครัวบ้านสวน', 0, 1, 25, 10, 100)`).run(u.tenantId)
  db.prepare(`INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, opening_cash, opened_by)
              VALUES (?, ?, 'SH-G', 'OPEN', ?, 0, 'tester')`).run(generateId(), u.tenantId, new Date().toISOString())
  const addMenu = (name: string, price: number, available = 1) => {
    const productId = generateId(), menuId = generateId()
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, unit, location, status)
                VALUES (?, ?, ?, ?, 'FOOD', 'pcs', 'WH1', 'ACTIVE')`).run(productId, u.tenantId, productId, name)
    db.prepare(`INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price, cost_price, is_available)
                VALUES (?, ?, ?, ?, 30, ?)`).run(menuId, u.tenantId, productId, price, available)
    return menuId
  }
  const kaprao = addMenu('ข้าวกะเพรา', 100)
  const padthai = addMenu('ผัดไทย', 120)
  const tomyum = addMenu('ต้มยำกุ้ง', 180)
  await request(app).post('/api/pos/tables').set(auth(u.token)).send({ names: ['T-01'] })
  const table = db.prepare('SELECT id, qr_token FROM pos_tables WHERE tenant_id = ?').get(u.tenantId) as any
  const openBill = async () => {
    const res = await request(app).post('/api/pos/bills').set(auth(u.token)).send({ table_id: table.id })
    const bId = res.body.data.id as string
    const b = db.prepare('SELECT qr_token FROM pos_running_bills WHERE id = ?').get(bId) as any
    return { id: bId, sessionToken: b.qr_token as string }
  }
  const first = await openBill()
  return { ...u, kaprao, padthai, tomyum, tableId: table.id as string, tableQr: table.qr_token as string, billId: first.id, qr: first.sessionToken, openBill }
}

describe('TASK F: จำเมนูของลูกค้าทั่วไป (PDPA consent) + สั่งซ้ำ + แต้มย้อนหลังตอนสมัครสมาชิก', () => {
  it('ยังไม่กดยินยอม → ไม่ผูกเครื่อง · กดยินยอม → ตั้ง cookie + ผูกรายการก่อนหน้า + ออเดอร์ถัดไปผูกอัตโนมัติ', async () => {
    const s = await seedShop()
    const guestAgent = request.agent(app)

    // สั่งรอบแรกก่อนกดยินยอม
    const order1 = await guestAgent.post('/qr/api/order').send({
      t: s.qr,
      items: [{ menuId: s.kaprao, qty: 2 }],
    })
    expect(order1.status).toBe(200)
    expect(order1.body.data.itemIds).toHaveLength(1)
    const firstItemId = order1.body.data.itemIds[0]

    // ยังไม่กดยินยอม: ไม่มีแถวใน pos_guest_devices และ pos_guest_bill_items
    expect((db.prepare('SELECT COUNT(*) n FROM pos_guest_devices WHERE tenant_id = ?').get(s.tenantId) as any).n).toBe(0)
    expect((db.prepare('SELECT COUNT(*) n FROM pos_guest_bill_items WHERE tenant_id = ?').get(s.tenantId) as any).n).toBe(0)
    const sessBefore = await guestAgent.get('/qr/api/session').query({ t: s.qr })
    expect(sessBefore.body.data.guest).toBeNull()

    // แคชเชียร์คีย์รายการเอง 1 รายการ (created_by != 'QR') — ต้องไม่ถูกผูกเมื่อลูกค้าส่ง itemIds มั่วมา
    const cashierItemRes = await request(app).post(`/api/pos/bills/${s.billId}/items`).set(auth(s.token))
      .send({ pos_menu_id: s.tomyum, quantity: 1 })
    const cashierItemId = cashierItemRes.body.data.id

    // ลูกค้ากดยินยอม ("จำไว้") พร้อมแนบ itemIds ที่สั่งไปก่อนหน้า (และลองแอบส่ง token ที่ client ตั้งเองมาด้วย)
    const consent = await guestAgent.post('/qr/api/guest')
      .set('Cookie', 'phq_guest=client_chosen_fake_token_1234567890')
      .send({ t: s.qr, itemIds: [firstItemId, cashierItemId, 'non-existent-id'] })
    expect(consent.status, JSON.stringify(consent.body)).toBe(200)
    const guestCookie = String(consent.headers['set-cookie']?.[0] ?? '')
    expect(guestCookie).toMatch(/^phq_guest=[A-Za-z0-9_-]{20,};/)
    expect(guestCookie).toMatch(/; Path=\/qr\/api(;|$)/)
    expect(guestCookie).toMatch(/; HttpOnly(;|$)/)
    expect(guestCookie).toMatch(/; SameSite=Lax(;|$)/i)
    expect(consent.headers['set-cookie']?.[0]).not.toContain('client_chosen_fake_token_1234567890')

    // ตรวจสอบว่าเก็บเฉพาะ hash และผูกเฉพาะรายการที่สั่งผ่าน QR ของบิลนี้
    const guestRow = db.prepare('SELECT * FROM pos_guest_devices WHERE tenant_id = ?').get(s.tenantId) as any
    expect(guestRow).toBeTruthy()
    expect(guestRow.token_hash).toHaveLength(64)
    const linkedRows = db.prepare('SELECT * FROM pos_guest_bill_items WHERE tenant_id = ?').all(s.tenantId) as any[]
    expect(linkedRows).toEqual([{ bill_item_id: firstItemId, guest_id: guestRow.id, tenant_id: s.tenantId, bill_id: s.billId }])

    // สั่งรอบที่ 2 หลังมี cookie แล้ว → ผูกรายการให้อัตโนมัติใน transaction เดียวกัน
    const order2 = await guestAgent.post('/qr/api/order').send({
      t: s.qr,
      items: [{ menuId: s.padthai, qty: 1 }],
    })
    expect(order2.status).toBe(200)
    expect(order2.body.data.itemIds).toHaveLength(1)
    const allLinked = db.prepare('SELECT bill_item_id FROM pos_guest_bill_items WHERE tenant_id = ? AND guest_id = ?')
      .all(s.tenantId, guestRow.id) as any[]
    expect(allLinked.map(r => r.bill_item_id).sort()).toEqual([firstItemId, order2.body.data.itemIds[0]].sort())
  })

  it('จ่ายบิลที่ไม่มีสมาชิก → อัปเดต visits/spent/lastOrder/favorite · จ่ายบิลที่มีสมาชิก → อัปเดต visits แต่ไม่บวก spent ซ้ำ', async () => {
    const s = await seedShop()
    const guestAgent = request.agent(app)

    // บิลที่ 1 (ไม่มีสมาชิก): สั่งข้าวกะเพรา 2 (200) + ผัดไทย 1 (120) = 320
    const ord1 = await guestAgent.post('/qr/api/order').send({
      t: s.qr,
      items: [{ menuId: s.kaprao, qty: 2 }, { menuId: s.padthai, qty: 1 }],
    })
    await guestAgent.post('/qr/api/guest').send({ t: s.qr, itemIds: ord1.body.data.itemIds })

    const pay1 = await request(app).post(`/api/pos/bills/${s.billId}/pay`).set(auth(s.token)).send({ payment_method: 'CASH' })
    expect(pay1.status, JSON.stringify(pay1.body)).toBe(200)

    const gAfter1 = db.prepare('SELECT * FROM pos_guest_devices WHERE tenant_id = ?').get(s.tenantId) as any
    expect(gAfter1.visits).toBe(1)
    expect(gAfter1.spent).toBe(320)
    expect(gAfter1.last_visit_at).toBeTruthy()
    expect(JSON.parse(gAfter1.last_order)).toEqual([
      { menuId: s.kaprao, name: 'ข้าวกะเพรา', qty: 2 },
      { menuId: s.padthai, name: 'ผัดไทย', qty: 1 },
    ])

    // เปิดบิลที่ 2 (มีสมาชิกผูกกับบิล): ตรวจ GET /session ก่อนสั่ง
    const bill2 = await s.openBill()
    const sess2 = await guestAgent.get('/qr/api/session').query({ t: bill2.sessionToken })
    expect(sess2.body.data.guest).toEqual({
      visits: 1,
      lastOrder: [
        { menuId: s.kaprao, name: 'ข้าวกะเพรา', qty: 2, available: true },
        { menuId: s.padthai, name: 'ผัดไทย', qty: 1, available: true },
      ],
      favorite: 'ข้าวกะเพรา',
      retroPoints: 12, // floor(320 / 25) = 12
    })

    // ถ้าเมนูผัดไทยหมดชั่วคราว → lastOrder ยังแสดงพร้อม available: false
    db.prepare('UPDATE pos_menu_configs SET is_available = 0 WHERE id = ?').run(s.padthai)
    const sessSoldOut = await guestAgent.get('/qr/api/session').query({ t: bill2.sessionToken })
    expect(sessSoldOut.body.data.guest.lastOrder.find((x: any) => x.menuId === s.padthai).available).toBe(false)
    db.prepare('UPDATE pos_menu_configs SET is_available = 1 WHERE id = ?').run(s.padthai)

    // เพื่อนร่วมโต๊ะผูกสมาชิกกับบิลที่ 2
    const memberFriend = request.agent(app)
    await memberFriend.post('/qr/api/member').send({ t: bill2.sessionToken, phone: '0891112222', consentPoints: true })

    // ลูกค้าทั่วไปสั่งผัดไทย 3 ที่ (360 บาท) ในบิลที่มีสมาชิกอยู่แล้ว
    const ord2 = await guestAgent.post('/qr/api/order').send({
      t: bill2.sessionToken,
      items: [{ menuId: s.padthai, qty: 3 }],
    })
    expect(ord2.status).toBe(200)

    const pay2 = await request(app).post(`/api/pos/bills/${bill2.id}/pay`).set(auth(s.token)).send({ payment_method: 'CASH' })
    expect(pay2.status, JSON.stringify(pay2.body)).toBe(200)

    // visits เพิ่มเป็น 2, favorite กลายเป็นผัดไทย (รวม 4 ที่ > กะเพรา 2 ที่), แต่ spent ต้องคงเดิมที่ 320
    const gAfter2 = db.prepare('SELECT * FROM pos_guest_devices WHERE tenant_id = ?').get(s.tenantId) as any
    expect(gAfter2.visits).toBe(2)
    expect(gAfter2.spent).toBe(320)
    expect(JSON.parse(gAfter2.last_order)).toEqual([{ menuId: s.padthai, name: 'ผัดไทย', qty: 3 }])

    const bill3 = await s.openBill()
    const sess3 = await guestAgent.get('/qr/api/session').query({ t: bill3.sessionToken })
    expect(sess3.body.data.guest).toMatchObject({
      visits: 2,
      favorite: 'ผัดไทย',
      retroPoints: 12,
    })
  })

  it('สมัครสมาชิก: ได้แต้มย้อนหลัง min(cap, floor(spent / earnRate)) ครั้งเดียว + บันทึก CRM + ลบแถวลูกค้าทั่วไป', async () => {
    const s = await seedShop()
    const guestAgent = request.agent(app)

    // ตั้งเพดานแต้มย้อนหลัง = 10 แต้ม (และตรวจ validation ของ settings)
    expect((await request(app).put('/api/settings/company').set(auth(s.token)).send({ loyalty_retro_cap: -1 })).status).toBe(400)
    expect((await request(app).put('/api/settings/company').set(auth(s.token)).send({ loyalty_retro_cap: 100001 })).status).toBe(400)
    expect((await request(app).put('/api/settings/company').set(auth(s.token)).send({ loyalty_retro_cap: 10 })).status).toBe(200)

    // บิลแรก: ยอด 360 บาท (floor(360 / 25) = 14 แต้ม แต่ติดเพดาน cap = 10 แต้ม)
    await guestAgent.post('/qr/api/guest').send({ t: s.qr })
    await guestAgent.post('/qr/api/order').send({ t: s.qr, items: [{ menuId: s.tomyum, qty: 2 }] })
    await request(app).post(`/api/pos/bills/${s.billId}/pay`).set(auth(s.token)).send({ payment_method: 'CASH' })

    const guestRowBefore = db.prepare('SELECT id FROM pos_guest_devices WHERE tenant_id = ?').get(s.tenantId) as any
    expect(guestRowBefore).toBeTruthy()

    const bill2 = await s.openBill()
    const sess = await guestAgent.get('/qr/api/session').query({ t: bill2.sessionToken })
    expect(sess.body.data.guest.retroPoints).toBe(10)

    // สมัครสมาชิกด้วยเบอร์โทร
    const join = await guestAgent.post('/qr/api/member').send({
      t: bill2.sessionToken,
      phone: '081-234-5678',
      name: 'กานต์',
      consentPoints: true,
    })
    expect(join.status, JSON.stringify(join.body)).toBe(200)
    expect(join.body.data.retroPoints).toBe(10)
    expect(join.body.data.linked).toBe(true)

    const cust = db.prepare('SELECT * FROM customers WHERE tenant_id = ?').get(s.tenantId) as any
    expect(cust.loyalty_points).toBe(10)

    const tx = db.prepare(`SELECT * FROM loyalty_transactions WHERE tenant_id = ? AND customer_id = ?`).get(s.tenantId, cust.id) as any
    expect(tx).toMatchObject({
      type: 'ADJUST',
      points: 10,
      balance_after: 10,
      reference_type: 'QR_GUEST_RETRO',
      reference_id: guestRowBefore.id,
      note: 'แต้มย้อนหลัง 1 ครั้งก่อนสมัครสมาชิก',
    })

    const noteRow = db.prepare(`SELECT * FROM activity_logs WHERE tenant_id = ? AND customer_id = ? AND type = 'NOTE'`).get(s.tenantId, cust.id) as any
    expect(noteRow?.note).toBe('ประวัติก่อนสมัคร: มา 1 ครั้ง ยอด ฿360 เมนูที่สั่งบ่อย ต้มยำกุ้ง')

    // ลบข้อมูลลูกค้าทั่วไปและรายการที่ผูกไว้แล้ว
    expect((db.prepare('SELECT COUNT(*) n FROM pos_guest_devices WHERE tenant_id = ?').get(s.tenantId) as any).n).toBe(0)
    expect((db.prepare('SELECT COUNT(*) n FROM pos_guest_bill_items WHERE tenant_id = ?').get(s.tenantId) as any).n).toBe(0)

    // ลองสมัครซ้ำด้วยเบอร์เดิม (แม้จากอีกเครื่องที่เป็น guest) ต้องไม่ได้แต้มย้อนหลังซ้ำเป็นครั้งที่สอง
    const anotherGuest = request.agent(app)
    await anotherGuest.post('/qr/api/guest').send({ t: bill2.sessionToken })
    await anotherGuest.post('/qr/api/order').send({ t: bill2.sessionToken, items: [{ menuId: s.kaprao, qty: 2 }] })
    await request(app).patch(`/api/pos/bills/${bill2.id}/member`).set(auth(s.token)).send({ customer_id: null })
    await request(app).post(`/api/pos/bills/${bill2.id}/pay`).set(auth(s.token)).send({ payment_method: 'CASH' })

    const bill3 = await s.openBill()
    const joinAgain = await anotherGuest.post('/qr/api/member').send({
      t: bill3.sessionToken,
      phone: '081-234-5678',
      consentPoints: true,
    })
    expect(joinAgain.status).toBe(200)
    expect(joinAgain.body.data.retroPoints).toBe(0)
    expect((db.prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(cust.id) as any).loyalty_points).toBe(10)
    expect((db.prepare(`SELECT COUNT(*) n FROM loyalty_transactions WHERE tenant_id = ? AND reference_type = 'QR_GUEST_RETRO'`).get(s.tenantId) as any).n).toBe(1)
  })

  it('ตั้งเพดานแต้มย้อนหลัง = 0 → ไม่ให้แต้มย้อนหลังตอนสมัครสมาชิก', async () => {
    const s = await seedShop()
    expect((await request(app).put('/api/settings/company').set(auth(s.token)).send({ loyalty_retro_cap: 0 })).status).toBe(200)

    const guestAgent = request.agent(app)
    await guestAgent.post('/qr/api/guest').send({ t: s.qr })
    await guestAgent.post('/qr/api/order').send({ t: s.qr, items: [{ menuId: s.tomyum, qty: 2 }] })
    await request(app).post(`/api/pos/bills/${s.billId}/pay`).set(auth(s.token)).send({ payment_method: 'CASH' })

    const bill2 = await s.openBill()
    const sess = await guestAgent.get('/qr/api/session').query({ t: bill2.sessionToken })
    expect(sess.body.data.guest.retroPoints).toBe(0)

    const join = await guestAgent.post('/qr/api/member').send({
      t: bill2.sessionToken,
      phone: '082-333-4444',
      consentPoints: true,
    })
    expect(join.status).toBe(200)
    expect(join.body.data.retroPoints).toBe(0)
    const cust = db.prepare('SELECT loyalty_points FROM customers WHERE tenant_id = ?').get(s.tenantId) as any
    expect(cust.loyalty_points).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) n FROM loyalty_transactions WHERE tenant_id = ? AND reference_type = 'QR_GUEST_RETRO'`).get(s.tenantId) as any).n).toBe(0)
    expect((db.prepare('SELECT COUNT(*) n FROM pos_guest_devices WHERE tenant_id = ?').get(s.tenantId) as any).n).toBe(0)
  })

  it('กดลบข้อมูลและหยุดจำ (/guest/forget) → ลบข้อมูลในฐานข้อมูลและล้าง cookie · เครื่องที่เป็นสมาชิกแล้วสร้าง guest ไม่ได้ (403)', async () => {
    const s = await seedShop()
    const guestAgent = request.agent(app)

    await guestAgent.post('/qr/api/guest').send({ t: s.qr })
    await guestAgent.post('/qr/api/order').send({ t: s.qr, items: [{ menuId: s.kaprao, qty: 1 }] })
    expect((db.prepare('SELECT COUNT(*) n FROM pos_guest_devices WHERE tenant_id = ?').get(s.tenantId) as any).n).toBe(1)
    expect((db.prepare('SELECT COUNT(*) n FROM pos_guest_bill_items WHERE tenant_id = ?').get(s.tenantId) as any).n).toBe(1)

    // แถวที่หมดอายุแล้วถูกลบออกแบบ opportunistic
    const expiredId = generateId()
    db.prepare(`INSERT INTO pos_guest_devices (id, tenant_id, token_hash, consent_at, visits, spent, item_counts, last_order, created_at, expires_at)
                VALUES (?, ?, 'expired_hash', '2020-01-01T00:00:00.000Z', 1, 100, '{}', '[]', '2020-01-01T00:00:00.000Z', '2020-01-02T00:00:00.000Z')`)
      .run(expiredId, s.tenantId)
    db.prepare(`INSERT INTO pos_guest_bill_items (bill_item_id, guest_id, tenant_id, bill_id) VALUES ('exp_item', ?, ?, ?)`).run(expiredId, s.tenantId, s.billId)

    const sessBeforeForget = await guestAgent.get('/qr/api/session').query({ t: s.qr })
    expect(sessBeforeForget.body.data.guest).toBeTruthy()
    expect(db.prepare('SELECT 1 FROM pos_guest_devices WHERE id = ?').get(expiredId)).toBeUndefined()
    expect(db.prepare('SELECT 1 FROM pos_guest_bill_items WHERE guest_id = ?').get(expiredId)).toBeUndefined()

    const forget = await guestAgent.post('/qr/api/guest/forget').send({ t: s.qr })
    expect(forget.status).toBe(200)
    expect((db.prepare('SELECT COUNT(*) n FROM pos_guest_devices WHERE tenant_id = ?').get(s.tenantId) as any).n).toBe(0)
    expect((db.prepare('SELECT COUNT(*) n FROM pos_guest_bill_items WHERE tenant_id = ?').get(s.tenantId) as any).n).toBe(0)
    expect((await guestAgent.get('/qr/api/session').query({ t: s.qr })).body.data.guest).toBeNull()

    // เครื่องที่ผูกเป็นสมาชิกอยู่แล้ว (phq_dev) กดสร้าง guest ไม่ได้ (403)
    const memberAgent = request.agent(app)
    await memberAgent.post('/qr/api/member').send({ t: s.qr, phone: '0834445555', consentPoints: true })
    const denied = await memberAgent.post('/qr/api/guest').send({ t: s.qr })
    expect(denied.status).toBe(403)
    expect((await memberAgent.get('/qr/api/session').query({ t: s.qr })).body.data.guest).toBeNull()
  })
})
