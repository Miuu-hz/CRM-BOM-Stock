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
    for (const tbl of ['pos_kds_tickets', 'journal_lines', 'journal_entries', 'pos_payments', 'pos_bill_items', 'pos_running_bills', 'pos_tables',
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
    expect(session.body.data.state).toBe('open')
    expect(session.body.data.menu).toHaveLength(3)
    expect(session.body.data.menu.find((m: any) => m.id === shop.soldOut).available).toBe(false)
    expect(Object.keys(session.body.data.menu[0])).not.toContain('cost_price')

    // ราคาที่มือถือส่งมาต้องไม่มีผล
    const order = await request(app).post('/qr/api/order')
      .send({ t: table.token, items: [{ menuId: shop.kaprao, qty: 2, price: 1, note: 'ไม่เผ็ด' }, { menuId: shop.padthai, qty: 1 }] })
    expect(order.status, JSON.stringify(order.body)).toBe(200)
    expect(order.body.data.round).toBe(1)
    const items = db.prepare('SELECT * FROM pos_bill_items WHERE bill_id = ? ORDER BY unit_price').all(open.body.data.id) as any[]
    expect(items.map(i => [i.product_name, i.quantity, i.total_price, i.created_by, i.sent_to_kds])).toEqual([
      ['ข้าวกะเพรา', 2, 158, 'QR', 1], ['ผัดไทย', 1, 95, 'QR', 1],
    ])
    expect(items[0].special_instructions).toBe('ไม่เผ็ด')
    const ticket = db.prepare('SELECT * FROM pos_kds_tickets WHERE bill_id = ?').get(open.body.data.id) as any
    expect(ticket).toMatchObject({ table_name: 'T-07', round: 1, status: 'PENDING' })

    const round2 = await request(app).post('/qr/api/order').send({ t: table.token, items: [{ menuId: shop.padthai, qty: 1 }] })
    expect(round2.body.data.round).toBe(2)

    expect((await request(app).post('/qr/api/order').send({ t: table.token, items: [{ menuId: shop.soldOut, qty: 1 }] })).body.code).toBe('MENU_UNAVAILABLE')
    expect((await request(app).post('/qr/api/order').send({ t: table.token, items: [{ menuId: shop.kaprao, qty: 0 }] })).status).toBe(400)
    expect((await request(app).post('/qr/api/order').send({ t: table.token, items: [] })).status).toBe(400)

    const billView = (await request(app).get('/qr/api/session').query({ t: table.token })).body.data.bill
    expect(billView.items).toHaveLength(3)
    expect(billView.total).toBeGreaterThanOrEqual(158 + 95 + 95)
    expect(billView.billRequested).toBe(false)

    expect((await request(app).post('/qr/api/call-bill').send({ t: table.token })).status).toBe(200)
    const board = await request(app).get('/api/pos/tables').set(auth(shop.token))
    expect(board.body.data.tables[0]).toMatchObject({ bill_id: open.body.data.id, item_count: 3, qr_item_count: 3 })
    expect(board.body.data.tables[0].bill_requested_at).toBeTruthy()

    const pay = await request(app).post(`/api/pos/bills/${open.body.data.id}/pay`).set(auth(shop.token)).send({ payment_method: 'CASH' })
    expect(pay.status, JSON.stringify(pay.body)).toBe(200)
    expect((await request(app).get('/qr/api/session').query({ t: table.token })).body.data.state).toBe('not_open')
    expect((await request(app).post('/qr/api/order').send({ t: table.token, items: [{ menuId: shop.kaprao, qty: 1 }] })).status).toBe(409)
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
    const cross = await request(app).post('/qr/api/order').send({ t: table.token, items: [{ menuId: shopB.kaprao, qty: 1 }] })
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
})
