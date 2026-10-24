import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import kdsRouter from './kds.routes'
import posBillRouter from './pos-bill.routes'
import { cancelPosBill } from '../services/posBillCancel.service'

/**
 * จอครัวต้องตามบิลให้ทัน: ยกเลิกทั้งบิล → การ์ดแดงจนกดรับทราบ, ลด/ลบรายการ → ตั๋วเห็น,
 * เพิ่มจำนวนของที่ส่งไปแล้ว → ส่งรอบใหม่ได้, จ่ายเงินแล้วยังไม่เสร็จ → ตั๋วยังอยู่
 */
const app = express()
app.use(express.json())
app.use('/api/pos/kds', kdsRouter)
app.use('/api/pos', posBillRouter)

function seed() {
  const user = createTestUser({ role: 'USER' })
  const T = user.tenantId
  const stockId = generateId(), menuId = generateId(), billId = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, unit, location, status)
    VALUES (?, ?, ?, 'กะเพรา', 'FOOD', 'pcs', 'WH1', 'ACTIVE')`).run(stockId, T, stockId)
  db.prepare('INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price) VALUES (?, ?, ?, 89)').run(menuId, T, stockId)
  db.prepare(`INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, created_by)
    VALUES (?, ?, ?, 'โต๊ะ 1', 'OPEN', 'tester')`).run(billId, T, `POS-KDS-${billId}`)
  const itemId = generateId()
  db.prepare(`INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price)
    VALUES (?, ?, ?, ?, 'กะเพรา', 3, 89, 267)`).run(itemId, T, billId, menuId)
  return { user, T, billId, itemId, auth: { Authorization: `Bearer ${user.token}` } }
}

const send = (s: ReturnType<typeof seed>) =>
  request(app).post('/api/pos/kds/send').set(s.auth).send({ bill_id: s.billId })
const tickets = async (s: ReturnType<typeof seed>) =>
  (await request(app).get('/api/pos/kds/tickets').set(s.auth)).body.data as any[]

describe('KDS ตามบิล', () => {
  it('ลดจำนวนหลังส่งครัว → ตั๋วขึ้นจำนวนที่ยกเลิก+เหตุผล · ลบทั้งรายการ → สถานะ CANCELLED', async () => {
    const s = seed()
    expect((await send(s)).status).toBe(200)
    await request(app).put(`/api/pos/bills/${s.billId}/items/${s.itemId}`).set(s.auth).send({ quantity: 2, reason: 'ลูกค้าเปลี่ยนใจ' })
    let item = (await tickets(s))[0].items[0]
    expect(item.quantity).toBe(3)
    expect(item.void_qty).toBe(1)
    expect(item.void_reason).toBe('ลูกค้าเปลี่ยนใจ')

    await request(app).delete(`/api/pos/bills/${s.billId}/items/${s.itemId}`).set(s.auth).send({ reason: 'ของหมด' })
    item = (await tickets(s))[0].items[0]
    expect(item.void_qty).toBe(3)
    expect(item.status).toBe('CANCELLED')
  })

  it('กด + บนรายการที่ส่งครัวแล้ว → เกิดรายการใหม่ที่ยังไม่ส่ง ส่งครัวรอบ 2 ได้', async () => {
    const s = seed()
    await send(s)
    await request(app).put(`/api/pos/bills/${s.billId}/items/${s.itemId}`).set(s.auth).send({ quantity: 5 })
    const rows = db.prepare('SELECT quantity, sent_to_kds FROM pos_bill_items WHERE bill_id = ? ORDER BY sent_to_kds DESC').all(s.billId) as any[]
    expect(rows).toEqual([{ quantity: 3, sent_to_kds: 1 }, { quantity: 2, sent_to_kds: 0 }])
    const round2 = await send(s)
    expect(round2.status).toBe(200)
    expect(round2.body.data.round).toBe(2)
  })

  it('ยกเลิกทั้งบิล → การ์ด CANCELLED ค้างจนกดรับทราบ · จ่ายเงินแล้วตั๋วยังไม่หาย', async () => {
    const s = seed()
    await send(s)
    await cancelPosBill(s.T, s.user.userId, s.billId, 'ลูกค้ากลับ')
    const list = await tickets(s)
    expect(list.map(t => t.status)).toEqual(['CANCELLED'])
    // ทำอย่างอื่นนอกจากรับทราบไม่ได้
    expect((await request(app).patch(`/api/pos/kds/tickets/${list[0].id}/status`).set(s.auth).send({ status: 'DONE' })).status).toBe(400)
    expect((await request(app).patch(`/api/pos/kds/tickets/${list[0].id}/status`).set(s.auth).send({ status: 'CANCEL_ACK' })).status).toBe(200)
    expect(await tickets(s)).toEqual([])

    const paid = seed()
    await send(paid)
    db.prepare(`UPDATE pos_running_bills SET status = 'PAID' WHERE id = ?`).run(paid.billId)
    expect((await tickets(paid)).length).toBe(1)
  })
})

describe('KDS ติ๊กรายเมนู', () => {
  it('ติ๊กได้หลังรับงานเท่านั้น · สลับไปมาได้ รายการไม่หาย · ไม่บังคับครบก่อนกดเสร็จทั้งตั๋ว', async () => {
    const s = seed()
    const second = generateId()
    db.prepare(`INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price)
      VALUES (?, ?, ?, (SELECT pos_menu_id FROM pos_bill_items WHERE id = ?), 'ไข่ดาว', 1, 10, 10)`).run(second, s.T, s.billId, s.itemId)
    await send(s)
    const [t] = await tickets(s)
    const item = t.items.find((i: any) => i.bill_item_id === s.itemId)
    const tick = (done: boolean) => request(app).patch(`/api/pos/kds/tickets/${t.id}/items/${item.id}`).set(s.auth).send({ done })

    // ยังไม่กดรับงาน → ติ๊กไม่ได้
    expect((await tick(true)).status).toBe(400)

    await request(app).patch(`/api/pos/kds/tickets/${t.id}/status`).set(s.auth).send({ status: 'IN_PROGRESS' })
    const before = db.prepare('SELECT updated_at FROM pos_kds_tickets WHERE id = ?').get(t.id) as any
    const ticked = await tick(true)
    expect(ticked.status).toBe(200)
    let items = (await tickets(s))[0].items
    expect(items).toHaveLength(2)
    expect(items.find((i: any) => i.id === item.id).status).toBe('DONE')
    expect((db.prepare('SELECT status FROM pos_bill_items WHERE id = ?').get(s.itemId) as any).status).toBe('READY')

    // เอาติ๊กออก → กลับเป็นยังไม่เสร็จ รายการยังอยู่
    expect((await tick(false)).status).toBe(200)
    items = (await tickets(s))[0].items
    expect(items.find((i: any) => i.id === item.id).status).toBe('PENDING')
    expect((db.prepare('SELECT status FROM pos_bill_items WHERE id = ?').get(s.itemId) as any).status).toBe('PREPARING')

    // ติ๊กรายเมนูไม่ไปแตะเวลาแก้ของตั๋ว (จอครัวใช้จับการแก้จาก POS เพื่อส่งเสียง)
    expect((db.prepare('SELECT updated_at FROM pos_kds_tickets WHERE id = ?').get(t.id) as any).updated_at)
      .toBe(before.updated_at)

    // ค่าที่ไม่ใช่ boolean ไม่รับ
    expect((await request(app).patch(`/api/pos/kds/tickets/${t.id}/items/${item.id}`).set(s.auth).send({ done: 'yes' })).status).toBe(400)

    // ติ๊กไม่ครบก็กดเสร็จทั้งตั๋วได้
    expect((await request(app).patch(`/api/pos/kds/tickets/${t.id}/status`).set(s.auth).send({ status: 'DONE' })).status).toBe(200)
    expect((await tick(true)).status).toBe(400) // ตั๋วปิดแล้ว
  })

  it('รายการที่ถูกยกเลิกติ๊กไม่ได้', async () => {
    const s = seed()
    await send(s)
    const [t] = await tickets(s)
    await request(app).patch(`/api/pos/kds/tickets/${t.id}/status`).set(s.auth).send({ status: 'IN_PROGRESS' })
    await request(app).delete(`/api/pos/bills/${s.billId}/items/${s.itemId}`).set(s.auth).send({ reason: 'ของหมด' })
    const res = await request(app).patch(`/api/pos/kds/tickets/${t.id}/items/${t.items[0].id}`).set(s.auth).send({ done: true })
    expect(res.status).toBe(400)
  })
})

describe('KDS ติ๊กรายเมนู — ความปลอดภัย/สถานะ', () => {
  async function inProgress() {
    const s = seed()
    const second = generateId()
    db.prepare(`INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price)
      VALUES (?, ?, ?, (SELECT pos_menu_id FROM pos_bill_items WHERE id = ?), 'ไข่ดาว', 1, 10, 10)`).run(second, s.T, s.billId, s.itemId)
    await send(s)
    const [t] = await tickets(s)
    await request(app).patch(`/api/pos/kds/tickets/${t.id}/status`).set(s.auth).send({ status: 'IN_PROGRESS' })
    return { s, t, status: (st: string) => request(app).patch(`/api/pos/kds/tickets/${t.id}/status`).set(s.auth).send({ status: st }) }
  }

  it('token ของ tenant อื่น → 404 · item ของตั๋วอื่น → 404', async () => {
    const { s, t } = await inProgress()
    const other = createTestUser({ role: 'USER' })
    const res = await request(app).patch(`/api/pos/kds/tickets/${t.id}/items/${t.items[0].id}`)
      .set({ Authorization: `Bearer ${other.token}` }).send({ done: true })
    expect(res.status).toBe(404)

    const s2 = seed()
    await send(s2)
    const [t2] = await tickets(s2)
    await request(app).patch(`/api/pos/kds/tickets/${t2.id}/status`).set(s2.auth).send({ status: 'IN_PROGRESS' })
    const cross = await request(app).patch(`/api/pos/kds/tickets/${t.id}/items/${t2.items[0].id}`).set(s.auth).send({ done: true })
    expect(cross.status).toBe(404)
  })

  it('DONE ทั้งตั๋วไม่ทับรายการที่ยกเลิกแล้ว (ทั้งรายการครัวและรายการบิล)', async () => {
    const { s, t, status } = await inProgress()
    await request(app).delete(`/api/pos/bills/${s.billId}/items/${s.itemId}`).set(s.auth).send({ reason: 'ของหมด' })
    expect((await status('DONE')).status).toBe(200)
    const cancelled = t.items.find((i: any) => i.bill_item_id === s.itemId)
    expect((db.prepare('SELECT status FROM pos_kds_ticket_items WHERE id = ?').get(cancelled.id) as any).status).toBe('CANCELLED')
    const other = t.items.find((i: any) => i.bill_item_id !== s.itemId)
    expect((db.prepare('SELECT status FROM pos_kds_ticket_items WHERE id = ?').get(other.id) as any).status).toBe('DONE')
  })

  it('กดรับงานซ้ำไม่รีเซ็ตรายการที่ติ๊กเสร็จแล้ว', async () => {
    const { s, t, status } = await inProgress()
    const item = t.items.find((i: any) => i.bill_item_id === s.itemId)
    await request(app).patch(`/api/pos/kds/tickets/${t.id}/items/${item.id}`).set(s.auth).send({ done: true })
    expect((await status('IN_PROGRESS')).status).toBe(200)
    expect((db.prepare('SELECT status FROM pos_bill_items WHERE id = ?').get(s.itemId) as any).status).toBe('READY')
    expect((db.prepare('SELECT status FROM pos_kds_ticket_items WHERE id = ?').get(item.id) as any).status).toBe('DONE')
  })
})
