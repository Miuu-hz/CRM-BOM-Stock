import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
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
app.use('/api/pos', posBillRouter)
app.use('/api/pos', posTablesRouter)
app.use('/api/settings', settingsRouter)
app.use('/qr/api', qrPublicRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM pos_kds_ticket_items WHERE ticket_id IN (SELECT id FROM pos_kds_tickets WHERE tenant_id = ?)').run(t)
    for (const tbl of ['pos_qr_order_keys', 'pos_kds_tickets', 'journal_lines', 'journal_entries', 'pos_payments', 'pos_bill_items', 'pos_running_bills', 'pos_tables',
                       'pos_shifts', 'pos_menu_configs', 'stock_items', 'company_settings', 'accounts', 'users', 'document_sequences']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* no tenant_id column */ }
    }
  }
})

function seedShop() {
  const u = createTestUser()
  tenants.push(u.tenantId)
  db.prepare(`INSERT INTO company_settings (tenant_id, name, pos_bom_deduct) VALUES (?, 'ครัวบ้านสวน', 0)`).run(u.tenantId)
  db.prepare(`INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, opening_cash, opened_by)
              VALUES (?, ?, 'SH-Q', 'OPEN', ?, 0, 'tester')`).run(generateId(), u.tenantId, new Date().toISOString())
  const menu = (name: string, price: number, available = 1) => {
    const productId = generateId(), menuId = generateId()
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, unit, location, status)
                VALUES (?, ?, ?, ?, 'FOOD', 'pcs', 'WH1', 'ACTIVE')`).run(productId, u.tenantId, productId, name)
    db.prepare(`INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price, cost_price, is_available) VALUES (?, ?, ?, ?, 30, ?)`)
      .run(menuId, u.tenantId, productId, price, available)
    return menuId
  }
  return { ...u, kaprao: menu('ข้าวกะเพรา', 79), padthai: menu('ผัดไทย', 95), soldOut: menu('ราดหน้า', 75, 0) }
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

async function addTable(shop: ReturnType<typeof seedShop>, name = 'T-07') {
  expect((await request(app).post('/api/pos/tables').set(auth(shop.token)).send({ names: [name] })).status).toBe(200)
  const list = await request(app).get('/api/pos/tables').set(auth(shop.token))
  const table = list.body.data.tables.find((t: any) => t.name === name)
  const { qr_token } = db.prepare('SELECT qr_token FROM pos_tables WHERE id = ?').get(table.id) as any
  return { id: table.id as string, token: qr_token as string }
}

describe('QR สั่งที่โต๊ะ', () => {
  it('QR ถาวร: โต๊ะยังไม่เปิดสั่งไม่ได้ → เปิดโต๊ะ → สั่ง → เข้าบิลและครัว → เรียกเช็คบิล → จ่ายแล้ว QR ใช้ไม่ได้', async () => {
    const shop = seedShop()
    const table = await addTable(shop)

    const before = await request(app).get('/qr/api/session').query({ t: table.token })
    expect(before.body.data).toMatchObject({ state: 'not_open', shop: { name: 'ครัวบ้านสวน' }, table: { name: 'T-07' } })
    expect((await request(app).post('/qr/api/order').send({ t: table.token, items: [{ menuId: shop.kaprao, qty: 1 }] })).status).toBe(409)

    const open = await request(app).post('/api/pos/bills').set(auth(shop.token)).send({ table_id: table.id })
    expect(open.status).toBe(200)
    expect(open.body.data.display_name).toBe('T-07')
    const again = await request(app).post('/api/pos/bills').set(auth(shop.token)).send({ table_id: table.id })
    expect(again.status).toBe(409)
    expect(again.body).toMatchObject({ code: 'TABLE_ALREADY_OPEN', data: { bill_id: open.body.data.id } })

    const session = await request(app).get('/qr/api/session').query({ t: table.token })
    expect(session.body.data).toEqual({ state: 'redirect', sessionToken: expect.any(String) })
    const sessionToken = session.body.data.sessionToken
    expect(sessionToken).not.toBe(table.token)

    // สั่งอาหารด้วย sticker token โดนปฏิเสธ 409 SESSION_REQUIRED
    const rejectOrder = await request(app).post('/qr/api/order')
      .send({ t: table.token, items: [{ menuId: shop.kaprao, qty: 1 }] })
    expect(rejectOrder.status).toBe(409)
    expect(rejectOrder.body).toMatchObject({ success: false, code: 'SESSION_REQUIRED', data: { sessionToken } })

    // เรียกเช็คบิลด้วย sticker token โดนปฏิเสธ 409 SESSION_REQUIRED เช่นกัน
    const rejectCallBill = await request(app).post('/qr/api/call-bill').send({ t: table.token })
    expect(rejectCallBill.status).toBe(409)
    expect(rejectCallBill.body).toMatchObject({ success: false, code: 'SESSION_REQUIRED', data: { sessionToken } })

    // โหลด session ด้วย session token ได้เมนูและสถานะ open
    const sessionDetail = await request(app).get('/qr/api/session').query({ t: sessionToken })
    expect(sessionDetail.body.data.state).toBe('open')
    expect(sessionDetail.body.data.sessionToken).toBe(sessionToken)
    expect(sessionDetail.body.data.menu).toHaveLength(3)
    expect(sessionDetail.body.data.menu.find((m: any) => m.id === shop.soldOut).available).toBe(false)
    expect(Object.keys(sessionDetail.body.data.menu[0])).not.toContain('cost_price')

    // ราคาที่มือถือส่งมาต้องไม่มีผล
    const order = await request(app).post('/qr/api/order')
      .send({ t: sessionToken, items: [{ menuId: shop.kaprao, qty: 2, price: 1, note: 'ไม่เผ็ด' }, { menuId: shop.padthai, qty: 1 }] })
    expect(order.status, JSON.stringify(order.body)).toBe(200)
    expect(order.body.data.round).toBe(1)
    const items = db.prepare('SELECT * FROM pos_bill_items WHERE bill_id = ? ORDER BY unit_price').all(open.body.data.id) as any[]
    expect(items.map(i => [i.product_name, i.quantity, i.total_price, i.created_by, i.sent_to_kds])).toEqual([
      ['ข้าวกะเพรา', 2, 158, 'QR', 1], ['ผัดไทย', 1, 95, 'QR', 1],
    ])
    expect(items[0].special_instructions).toBe('ไม่เผ็ด')
    const ticket = db.prepare('SELECT * FROM pos_kds_tickets WHERE bill_id = ?').get(open.body.data.id) as any
    expect(ticket).toMatchObject({ table_name: 'T-07', round: 1, status: 'PENDING' })

    const round2 = await request(app).post('/qr/api/order').send({ t: sessionToken, items: [{ menuId: shop.padthai, qty: 1 }] })
    expect(round2.body.data.round).toBe(2)

    expect((await request(app).post('/qr/api/order').send({ t: sessionToken, items: [{ menuId: shop.soldOut, qty: 1 }] })).body.code).toBe('MENU_UNAVAILABLE')
    expect((await request(app).post('/qr/api/order').send({ t: sessionToken, items: [{ menuId: shop.kaprao, qty: 0 }] })).status).toBe(400)
    expect((await request(app).post('/qr/api/order').send({ t: sessionToken, items: [] })).status).toBe(400)

    const billView = (await request(app).get('/qr/api/session').query({ t: sessionToken })).body.data.bill
    expect(billView.items).toHaveLength(3)
    expect(billView.total).toBeGreaterThanOrEqual(158 + 95 + 95)
    expect(billView.billRequested).toBe(false)

    expect((await request(app).post('/qr/api/call-bill').send({ t: sessionToken })).status).toBe(200)
    const board = await request(app).get('/api/pos/tables').set(auth(shop.token))
    expect(board.body.data.tables[0]).toMatchObject({ bill_id: open.body.data.id, item_count: 3, qr_item_count: 3 })
    expect(board.body.data.tables[0].bill_requested_at).toBeTruthy()

    const pay = await request(app).post(`/api/pos/bills/${open.body.data.id}/pay`).set(auth(shop.token)).send({ payment_method: 'CASH' })
    expect(pay.status, JSON.stringify(pay.body)).toBe(200)
    expect((await request(app).get('/qr/api/session').query({ t: table.token })).body.data.state).toBe('not_open')
    expect((await request(app).get('/qr/api/session').query({ t: sessionToken })).body.data).toMatchObject({ state: 'closed', bill: { paid: true } })
    expect((await request(app).post('/qr/api/order').send({ t: table.token, items: [{ menuId: shop.kaprao, qty: 1 }] })).status).toBe(409)
    expect((await request(app).post('/qr/api/order').send({ t: sessionToken, items: [{ menuId: shop.kaprao, qty: 1 }] })).status).toBe(409)

    // เปิดบิลใหม่ที่โต๊ะเดิม ได้ session token ใหม่ที่ต่างจากเดิม
    const open2 = await request(app).post('/api/pos/bills').set(auth(shop.token)).send({ table_id: table.id })
    expect(open2.status).toBe(200)
    const session2 = await request(app).get('/qr/api/session').query({ t: table.token })
    expect(session2.body.data.state).toBe('redirect')
    const sessionToken2 = session2.body.data.sessionToken
    expect(sessionToken2).toBeTruthy()
    expect(sessionToken2).not.toBe(sessionToken)
    expect((await request(app).get('/qr/api/session').query({ t: sessionToken })).body.data.state).toBe('closed')
    expect((await request(app).get('/qr/api/session').query({ t: sessionToken2 })).body.data.state).toBe('open')
  })

  it('QR เปลี่ยนทุกรอบ: QR ถาวรใช้ไม่ได้, ต้องใช้ใบของรอบ, ปิดบิลแล้วใบเก่าตาย', async () => {
    const shop = seedShop()
    const table = await addTable(shop)
    expect((await request(app).put('/api/settings/company').set(auth(shop.token)).send({ pos_qr_mode: 'rotate' })).status).toBe(200)

    // rotate: ยังไม่เปิดโต๊ะ พิมพ์ใบไม่ได้
    expect((await request(app).get(`/api/pos/tables/${table.id}/slip`).set(auth(shop.token))).status).toBe(409)
    const open = await request(app).post('/api/pos/bills').set(auth(shop.token)).send({ table_id: table.id })
    const slip = await request(app).get(`/api/pos/tables/${table.id}/slip`).set(auth(shop.token))
    expect(slip.status).toBe(200)
    expect(slip.body.data).toMatchObject({ table: 'T-07', mode: 'rotate' })
    expect(slip.body.data.qr).toMatch(/^data:image\/png;base64,/)
    const roundToken = new URL(slip.body.data.url).searchParams.get('t')!
    expect(roundToken).not.toBe(table.token)

    expect((await request(app).get('/qr/api/session').query({ t: table.token })).body.data.state).toBe('rotate_only')
    expect((await request(app).get('/qr/api/session').query({ t: roundToken })).body.data.state).toBe('open')
    expect((await request(app).post('/qr/api/order').send({ t: roundToken, items: [{ menuId: shop.kaprao, qty: 1 }] })).status).toBe(200)

    await request(app).post(`/api/pos/bills/${open.body.data.id}/pay`).set(auth(shop.token)).send({ payment_method: 'CASH' })
    const after = await request(app).get('/qr/api/session').query({ t: roundToken })
    expect(after.body.data).toMatchObject({ state: 'closed', bill: { paid: true } })
    expect((await request(app).post('/qr/api/order').send({ t: roundToken, items: [{ menuId: shop.kaprao, qty: 1 }] })).status).toBe(409)
  })

  it('POST ที่ไม่ใช่ JSON หรือมาจากเว็บอื่น → 403 (กัน CSRF ผ่าน cookie สมาชิก)', async () => {
    const shop = seedShop()
    const table = await addTable(shop)
    expect((await request(app).post('/qr/api/call-bill').type('form').send({ t: table.token })).status).toBe(403)
    expect((await request(app).post('/qr/api/call-bill').set('Sec-Fetch-Site', 'cross-site').send({ t: table.token })).status).toBe(403)
  })

  it('token มั่ว → 404 · สั่งเมนูของร้านอื่นผ่าน QR ร้านเราไม่ได้ · สร้าง QR ใหม่แล้วอันเก่าตาย', async () => {
    const shopA = seedShop()
    const shopB = seedShop()
    const table = await addTable(shopA)
    await request(app).post('/api/pos/bills').set(auth(shopA.token)).send({ table_id: table.id })

    expect((await request(app).get('/qr/api/session').query({ t: 'x'.repeat(32) })).status).toBe(404)
    expect((await request(app).get('/qr/api/session').query({ t: "' OR 1=1 --" })).status).toBe(404)
    const sessionRes = await request(app).get('/qr/api/session').query({ t: table.token })
    const sessionToken = sessionRes.body.data.sessionToken
    const cross = await request(app).post('/qr/api/order').send({ t: sessionToken, items: [{ menuId: shopB.kaprao, qty: 1 }] })
    expect(cross.status).toBe(409)
    expect(cross.body.code).toBe('MENU_UNAVAILABLE')

    // ร้านอื่นแตะโต๊ะของเราไม่ได้
    expect((await request(app).post('/api/pos/bills').set(auth(shopB.token)).send({ table_id: table.id })).status).toBe(404)
    expect((await request(app).get(`/api/pos/tables/${table.id}/slip`).set(auth(shopB.token))).status).toBe(404)

    expect((await request(app).post(`/api/pos/tables/${table.id}/regenerate-qr`).set(auth(shopA.token))).status).toBe(200)
    expect((await request(app).get('/qr/api/session').query({ t: table.token })).status).toBe(404)
  })

  it('จัดการโต๊ะ: ชื่อซ้ำ/ว่างไม่ได้ · โต๊ะที่เปิดอยู่ลบไม่ได้', async () => {
    const shop = seedShop()
    const table = await addTable(shop, 'A1')
    expect((await request(app).post('/api/pos/tables').set(auth(shop.token)).send({ names: ['A1'] })).status).toBe(409)
    expect((await request(app).post('/api/pos/tables').set(auth(shop.token)).send({ names: ['B1', 'B1'] })).status).toBe(400)
    expect((await request(app).post('/api/pos/tables').set(auth(shop.token)).send({ names: [' '] })).status).toBe(400)
    expect((await request(app).patch(`/api/pos/tables/${table.id}`).set(auth(shop.token)).send({ name: 'A2' })).status).toBe(200)

    await request(app).post('/api/pos/bills').set(auth(shop.token)).send({ table_id: table.id })
    expect((await request(app).delete(`/api/pos/tables/${table.id}`).set(auth(shop.token))).status).toBe(409)
  })

  it('บิลรุ่นเก่าที่ไม่มี qr_token: เมื่อ resolve จะสร้าง qr_token ใหม่และบันทึก', async () => {
    const shop = seedShop()
    const table = await addTable(shop, 'T-LEGACY')
    const open = await request(app).post('/api/pos/bills').set(auth(shop.token)).send({ table_id: table.id })
    expect(open.status).toBe(200)

    // จำลองบิลรุ่นเก่าโดยเคลียร์ qr_token เป็น NULL
    db.prepare('UPDATE pos_running_bills SET qr_token = NULL WHERE id = ? AND tenant_id = ?').run(open.body.data.id, shop.tenantId)
    const checkDbBefore = db.prepare('SELECT qr_token FROM pos_running_bills WHERE id = ?').get(open.body.data.id) as any
    expect(checkDbBefore.qr_token).toBeNull()

    // เมื่อเรียก resolveQrToken หรือ GET /session ด้วย sticker token
    const res = await request(app).get('/qr/api/session').query({ t: table.token })
    expect(res.body.data.state).toBe('redirect')
    expect(res.body.data.sessionToken).toBeTruthy()

    // ตรวจสอบว่าบันทึกลงฐานข้อมูลจริง
    const checkDbAfter = db.prepare('SELECT qr_token FROM pos_running_bills WHERE id = ?').get(open.body.data.id) as any
    expect(checkDbAfter.qr_token).toBe(res.body.data.sessionToken)

    // สั่งอาหารด้วย token ที่เพิ่งสร้างใหม่ได้
    const order = await request(app).post('/qr/api/order')
      .send({ t: res.body.data.sessionToken, items: [{ menuId: shop.kaprao, qty: 1 }] })
    expect(order.status).toBe(200)
  })

  it('รวมโต๊ะ: บิลที่ถูกรวม (merged_into_bill_id) ตามไปหาบิลปลายทางที่เปิดอยู่และได้ sessionToken ของบิลปลายทาง', async () => {
    const shop = seedShop()
    const table1 = await addTable(shop, 'T-01')
    const table2 = await addTable(shop, 'T-02')

    const bill1 = (await request(app).post('/api/pos/bills').set(auth(shop.token)).send({ table_id: table1.id })).body.data.id
    const bill2 = (await request(app).post('/api/pos/bills').set(auth(shop.token)).send({ table_id: table2.id })).body.data.id

    const token1 = (db.prepare('SELECT qr_token FROM pos_running_bills WHERE id = ?').get(bill1) as any).qr_token
    const token2 = (db.prepare('SELECT qr_token FROM pos_running_bills WHERE id = ?').get(bill2) as any).qr_token
    expect(token1).toBeTruthy()
    expect(token2).toBeTruthy()
    expect(token1).not.toBe(token2)

    // รวม bill1 เข้า bill2: bill1 ปิดและชี้ merged_into_bill_id ไป bill2
    db.prepare("UPDATE pos_running_bills SET status = 'MERGED', merged_into_bill_id = ? WHERE id = ? AND tenant_id = ?")
      .run(bill2, bill1, shop.tenantId)

    // เข้าด้วย token1 ของบิลเก่าที่ถูกรวม → ต้องตามไปบิล 2 ซึ่งสถานะ OPEN และได้ sessionToken ของบิล 2
    const sessionRes = await request(app).get('/qr/api/session').query({ t: token1 })
    expect(sessionRes.status).toBe(200)
    expect(sessionRes.body.data.state).toBe('open')
    expect(sessionRes.body.data.sessionToken).toBe(token2)
    expect(sessionRes.body.data.table.name).toBe('T-02')

    // สั่งอาหารผ่าน token1 เดิม จะลงบิล bill2 ปลายทาง
    const order = await request(app).post('/qr/api/order').send({ t: token1, items: [{ menuId: shop.kaprao, qty: 1 }] })
    expect(order.status).toBe(200)
    const itemInBill2 = db.prepare('SELECT * FROM pos_bill_items WHERE bill_id = ?').all(bill2)
    expect(itemInBill2).toHaveLength(1)

    // ปิดบิลปลายทาง (bill2) → token1 ต้องกลายเป็น closed
    db.prepare("UPDATE pos_running_bills SET status = 'PAID' WHERE id = ? AND tenant_id = ?").run(bill2, shop.tenantId)
    const afterClosed = await request(app).get('/qr/api/session').query({ t: token1 })
    expect(afterClosed.body.data.state).toBe('closed')
  })

  it('orderKey: ส่งซ้ำได้ผลเดิมและไม่ลงบิลซ้ำ (items inserted once, second response equals first)', async () => {
    const shop = seedShop()
    const table = await addTable(shop, 'T-KEY1')
    const open = await request(app).post('/api/pos/bills').set(auth(shop.token)).send({ table_id: table.id })
    const sessionToken = (await request(app).get('/qr/api/session').query({ t: table.token })).body.data.sessionToken

    const key = 'ordkey_' + 'a'.repeat(20)

    // ส่ง orderKey ครั้งแรก
    const res1 = await request(app).post('/qr/api/order')
      .send({ t: sessionToken, orderKey: key, items: [{ menuId: shop.kaprao, qty: 2 }] })
    expect(res1.status).toBe(200)
    expect(res1.body).toMatchObject({ success: true, data: { round: 1, items: 1, rewards: 0 } })

    const itemsAfter1 = db.prepare('SELECT * FROM pos_bill_items WHERE bill_id = ?').all(open.body.data.id)
    expect(itemsAfter1).toHaveLength(1)

    // ส่งซ้ำด้วย orderKey เดิม → ได้ response เดิมเป๊ะ และ pos_bill_items ไม่ถูก insert ซ้ำ
    const res2 = await request(app).post('/qr/api/order')
      .send({ t: sessionToken, orderKey: key, items: [{ menuId: shop.kaprao, qty: 2 }] })
    expect(res2.status).toBe(200)
    expect(res2.body).toEqual(res1.body)

    const itemsAfter2 = db.prepare('SELECT * FROM pos_bill_items WHERE bill_id = ?').all(open.body.data.id)
    expect(itemsAfter2).toHaveLength(1)
  })

  it('orderKey: ใช้ key เดียวกันกับคนละบิล → 409 ORDER_KEY_REUSED', async () => {
    const shop = seedShop()
    const table1 = await addTable(shop, 'T-B1')
    const table2 = await addTable(shop, 'T-B2')

    const open1 = await request(app).post('/api/pos/bills').set(auth(shop.token)).send({ table_id: table1.id })
    const sessionToken1 = (await request(app).get('/qr/api/session').query({ t: table1.token })).body.data.sessionToken

    const open2 = await request(app).post('/api/pos/bills').set(auth(shop.token)).send({ table_id: table2.id })
    const sessionToken2 = (await request(app).get('/qr/api/session').query({ t: table2.token })).body.data.sessionToken

    const key = 'ordkey_' + 'b'.repeat(20)

    // สั่งใน bill1 สำเร็จ
    const res1 = await request(app).post('/qr/api/order')
      .send({ t: sessionToken1, orderKey: key, items: [{ menuId: shop.kaprao, qty: 1 }] })
    expect(res1.status).toBe(200)

    // เอา key เดียวกันไปสั่งใน bill2 → 409 ORDER_KEY_REUSED
    const resConflict = await request(app).post('/qr/api/order')
      .send({ t: sessionToken2, orderKey: key, items: [{ menuId: shop.kaprao, qty: 1 }] })
    expect(resConflict.status).toBe(409)
    expect(resConflict.body).toMatchObject({ success: false, code: 'ORDER_KEY_REUSED' })

    const itemsBill2 = db.prepare('SELECT * FROM pos_bill_items WHERE bill_id = ?').all(open2.body.data.id)
    expect(itemsBill2).toHaveLength(0)
  })

  it('orderKey: รูปแบบไม่ถูกต้อง (สั้นไป / ยาวไป / อักขระพิเศษ / ไม่ใช่ string) → 400', async () => {
    const shop = seedShop()
    const table = await addTable(shop, 'T-INV')
    await request(app).post('/api/pos/bills').set(auth(shop.token)).send({ table_id: table.id })
    const sessionToken = (await request(app).get('/qr/api/session').query({ t: table.token })).body.data.sessionToken

    // สั้นไป (< 16 chars)
    const tooShort = await request(app).post('/qr/api/order')
      .send({ t: sessionToken, orderKey: 'short_key', items: [{ menuId: shop.kaprao, qty: 1 }] })
    expect(tooShort.status).toBe(400)
    expect(tooShort.body.success).toBe(false)

    // ยาวไป (> 64 chars)
    const tooLong = await request(app).post('/qr/api/order')
      .send({ t: sessionToken, orderKey: 'k'.repeat(65), items: [{ menuId: shop.kaprao, qty: 1 }] })
    expect(tooLong.status).toBe(400)
    expect(tooLong.body.success).toBe(false)

    // อักขระพิเศษ (ไม่อยู่ใน A-Za-z0-9_-)
    const invalidChars = await request(app).post('/qr/api/order')
      .send({ t: sessionToken, orderKey: 'invalid key with spaces!@#$', items: [{ menuId: shop.kaprao, qty: 1 }] })
    expect(invalidChars.status).toBe(400)
    expect(invalidChars.body.success).toBe(false)

    // ไม่ใช่ string
    const notString = await request(app).post('/qr/api/order')
      .send({ t: sessionToken, orderKey: 1234567890123456, items: [{ menuId: shop.kaprao, qty: 1 }] })
    expect(notString.status).toBe(400)
    expect(notString.body.success).toBe(false)
  })

  it('orderKey: คำขอที่ไม่ส่ง key → ทำงานได้ตามปกติเหมือนเดิม (unchanged behaviour)', async () => {
    const shop = seedShop()
    const table = await addTable(shop, 'T-NOKEY')
    const open = await request(app).post('/api/pos/bills').set(auth(shop.token)).send({ table_id: table.id })
    const sessionToken = (await request(app).get('/qr/api/session').query({ t: table.token })).body.data.sessionToken

    const res1 = await request(app).post('/qr/api/order')
      .send({ t: sessionToken, items: [{ menuId: shop.kaprao, qty: 1 }] })
    expect(res1.status).toBe(200)
    expect(res1.body.data.round).toBe(1)

    const res2 = await request(app).post('/qr/api/order')
      .send({ t: sessionToken, items: [{ menuId: shop.padthai, qty: 2 }] })
    expect(res2.status).toBe(200)
    expect(res2.body.data.round).toBe(2)

    const items = db.prepare('SELECT * FROM pos_bill_items WHERE bill_id = ?').all(open.body.data.id)
    expect(items).toHaveLength(2)
  })

  it('orderKey: ลบ key เก่าเกิน 2 วันแบบ opportunistic ตอนสั่งอาหาร', async () => {
    const shop = seedShop()
    const table = await addTable(shop, 'T-CLEAN')
    const open = await request(app).post('/api/pos/bills').set(auth(shop.token)).send({ table_id: table.id })
    const sessionToken = (await request(app).get('/qr/api/session').query({ t: table.token })).body.data.sessionToken

    // จำลอง key เก่า 3 วันที่แล้ว และ key ใหม่ 1 วันที่แล้ว
    const oldKey = 'oldkey_' + 'x'.repeat(20)
    const recentKey = 'recent_' + 'y'.repeat(20)
    const threeDaysAgo = new Date(Date.now() - 3 * 86400_000).toISOString()
    const oneDayAgo = new Date(Date.now() - 1 * 86400_000).toISOString()

    db.prepare('INSERT INTO pos_qr_order_keys (tenant_id, order_key, bill_id, response, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(shop.tenantId, oldKey, open.body.data.id, JSON.stringify({ old: true }), threeDaysAgo)
    db.prepare('INSERT INTO pos_qr_order_keys (tenant_id, order_key, bill_id, response, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(shop.tenantId, recentKey, open.body.data.id, JSON.stringify({ recent: true }), oneDayAgo)

    // ส่งออเดอร์ใหม่เพื่อ trigger opportunistic delete
    const newKey = 'newkey_' + 'z'.repeat(20)
    const res = await request(app).post('/qr/api/order')
      .send({ t: sessionToken, orderKey: newKey, items: [{ menuId: shop.kaprao, qty: 1 }] })
    expect(res.status).toBe(200)

    // key เก่าเกิน 2 วันต้องถูกลบไปแล้ว ส่วน key 1 วันก่อนและ key ปัจจุบันยังอยู่
    const oldCheck = db.prepare('SELECT order_key FROM pos_qr_order_keys WHERE tenant_id = ? AND order_key = ?').get(shop.tenantId, oldKey)
    expect(oldCheck).toBeUndefined()

    const recentCheck = db.prepare('SELECT order_key FROM pos_qr_order_keys WHERE tenant_id = ? AND order_key = ?').get(shop.tenantId, recentKey)
    expect(recentCheck).toBeTruthy()

    const newCheck = db.prepare('SELECT order_key FROM pos_qr_order_keys WHERE tenant_id = ? AND order_key = ?').get(shop.tenantId, newKey)
    expect(newCheck).toBeTruthy()
  })
})
