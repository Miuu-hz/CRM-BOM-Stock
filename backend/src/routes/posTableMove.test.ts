import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import posBillRouter, { recalculateBillTotals } from './pos-bill.routes'
import posTablesRouter from './pos-tables.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/pos', posBillRouter)
app.use('/api/pos', posTablesRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM pos_kds_ticket_items WHERE ticket_id IN (SELECT id FROM pos_kds_tickets WHERE tenant_id = ?)').run(t)
    for (const tbl of [
      'pos_guest_bill_items',
      'pos_guest_devices',
      'pos_redemptions',
      'pos_rewards',
      'pos_kds_tickets',
      'journal_lines',
      'journal_entries',
      'pos_payments',
      'pos_bill_items',
      'pos_running_bills',
      'pos_tables',
      'pos_shifts',
      'pos_menu_configs',
      'stock_items',
      'customers',
      'company_settings',
      'accounts',
      'users',
      'document_sequences',
    ]) {
      try {
        db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t)
      } catch {
        /* ignore missing tables */
      }
    }
  }
})

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

async function seedShop() {
  const u = createTestUser()
  tenants.push(u.tenantId)

  // ตั้งค่าบริษัท ไม่คิด VAT/Service Charge เพื่อให้ยอดเงินคำนวณตรงไปตรงมา
  db.prepare(`
    INSERT INTO company_settings (
      tenant_id, name, pos_bom_deduct, pos_vat_enabled, pos_service_enabled
    ) VALUES (?, 'ร้านทดสอบ ย้าย/รวมโต๊ะ', 0, 0, 0)
  `).run(u.tenantId)

  // เปิดกะสำหรับขาย
  db.prepare(`
    INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, opening_cash, opened_by)
    VALUES (?, ?, 'SH-MOVE', 'OPEN', ?, 0, 'tester')
  `).run(generateId(), u.tenantId, new Date().toISOString())

  // สร้างโต๊ะ T-01, T-02, T-03
  await request(app).post('/api/pos/tables').set(auth(u.token)).send({ names: ['T-01', 'T-02', 'T-03'] })
  const tables = db.prepare('SELECT id, name, qr_token FROM pos_tables WHERE tenant_id = ? ORDER BY sort_order').all(u.tenantId) as any[]
  const tableMap = new Map(tables.map(t => [t.name, t]))

  // สร้างเมนูอาหาร
  const addMenu = (name: string, price: number) => {
    const pid = generateId()
    const mid = generateId()
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, unit, location, status) VALUES (?, ?, ?, ?, 'FOOD', 'pcs', 'WH1', 'ACTIVE')`)
      .run(pid, u.tenantId, pid, name)
    db.prepare(`INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price) VALUES (?, ?, ?, ?)`).run(mid, u.tenantId, pid, price)
    return { mid, pid, name, price }
  }

  const kaprao = addMenu('ข้าวกะเพรา', 80)
  const soup = addMenu('ต้มยำกุ้ง', 150)

  // เปิดบิลที่ผูกกับโต๊ะ
  const openTableBill = async (tableId: string, customDisplayName?: string) => {
    const body: any = { table_id: tableId }
    if (customDisplayName) body.display_name = customDisplayName
    const res = await request(app).post('/api/pos/bills').set(auth(u.token)).send(body)
    return res.body.data
  }

  // เพิ่มรายการในบิล
  const addItem = (billId: string, menu: { mid: string; name: string; price: number }, qty = 1) => {
    const itemId = generateId()
    db.prepare(`
      INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price, sent_to_kds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(itemId, u.tenantId, billId, menu.mid, menu.name, qty, menu.price, menu.price * qty)
    recalculateBillTotals(billId)
    return itemId
  }

  // เพิ่มตั๋วครัว
  const addTicket = (billId: string, billNumber: string, tableName: string, status: 'PENDING' | 'IN_PROGRESS' | 'DONE') => {
    const ticketId = generateId()
    db.prepare(`
      INSERT INTO pos_kds_tickets (id, tenant_id, bill_id, bill_number, table_name, round, status, sent_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(ticketId, u.tenantId, billId, billNumber, tableName, status, new Date().toISOString(), new Date().toISOString())
    return ticketId
  }

  // สร้างสมาชิก
  const addCustomer = (name: string, phone: string) => {
    const custId = generateId()
    db.prepare(`
      INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, status, loyalty_points)
      VALUES (?, ?, ?, ?, 'INDIVIDUAL', ?, '', ?, '', 'ACTIVE', 100)
    `).run(custId, u.tenantId, custId, name, name, phone)
    return custId
  }

  return {
    ...u,
    tables: tableMap,
    kaprao,
    soup,
    openTableBill,
    addItem,
    addTicket,
    addCustomer,
  }
}

describe('C1: ย้ายโต๊ะ (POST /api/pos/bills/:id/move)', () => {
  it('ย้ายไปโต๊ะว่าง: table_id, display_name, ticket table_name อัปเดต และคง qr_token เดิม', async () => {
    const s = await seedShop()
    const t1 = s.tables.get('T-01')!
    const t2 = s.tables.get('T-02')!

    const bill = await s.openTableBill(t1.id)
    const billBefore = db.prepare('SELECT qr_token, display_name, table_id FROM pos_running_bills WHERE id = ?').get(bill.id) as any
    expect(billBefore.table_id).toBe(t1.id)
    expect(billBefore.display_name).toBe('T-01')
    expect(billBefore.qr_token).toBeTruthy()

    // เพิ่มตั๋วครัว: PENDING, IN_PROGRESS, DONE
    const pendingTicketId = s.addTicket(bill.id, bill.bill_number, 'T-01', 'PENDING')
    const inProgressTicketId = s.addTicket(bill.id, bill.bill_number, 'T-01', 'IN_PROGRESS')
    const doneTicketId = s.addTicket(bill.id, bill.bill_number, 'T-01', 'DONE')

    // ย้ายไปโต๊ะ T-02
    const res = await request(app).post(`/api/pos/bills/${bill.id}/move`).set(auth(s.token)).send({ table_id: t2.id })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.table_id).toBe(t2.id)
    expect(res.body.data.display_name).toBe('T-02')

    // ตรวจสอบข้อมูลบิลในฐานข้อมูล
    const billAfter = db.prepare('SELECT qr_token, display_name, table_id FROM pos_running_bills WHERE id = ?').get(bill.id) as any
    expect(billAfter.table_id).toBe(t2.id)
    expect(billAfter.display_name).toBe('T-02')
    expect(billAfter.qr_token).toBe(billBefore.qr_token) // qr_token ต้องคงเดิม

    // ตรวจสอบตั๋วครัว: PENDING และ IN_PROGRESS ต้องเปลี่ยนชื่อโต๊ะเป็น T-02, ส่วน DONE ต้องคงเดิม
    const pendingTicket = db.prepare('SELECT table_name FROM pos_kds_tickets WHERE id = ?').get(pendingTicketId) as any
    const inProgressTicket = db.prepare('SELECT table_name FROM pos_kds_tickets WHERE id = ?').get(inProgressTicketId) as any
    const doneTicket = db.prepare('SELECT table_name FROM pos_kds_tickets WHERE id = ?').get(doneTicketId) as any
    expect(pendingTicket.table_name).toBe('T-02')
    expect(inProgressTicket.table_name).toBe('T-02')
    expect(doneTicket.table_name).toBe('T-01')
  })

  it('ย้ายบิลที่มีชื่อกำหนดเอง (display_name ไม่ตรงกับชื่อโต๊ะเดิม): คงชื่อเดิมไว้ ไม่เปลี่ยนเป็นชื่อโต๊ะใหม่', async () => {
    const s = await seedShop()
    const t1 = s.tables.get('T-01')!
    const t2 = s.tables.get('T-02')!

    const bill = await s.openTableBill(t1.id)
    db.prepare('UPDATE pos_running_bills SET display_name = ? WHERE id = ?').run('ครอบครัวสุขสันต์', bill.id)

    const res = await request(app).post(`/api/pos/bills/${bill.id}/move`).set(auth(s.token)).send({ table_id: t2.id })
    expect(res.status).toBe(200)

    const billAfter = db.prepare('SELECT display_name, table_id FROM pos_running_bills WHERE id = ?').get(bill.id) as any
    expect(billAfter.table_id).toBe(t2.id)
    expect(billAfter.display_name).toBe('ครอบครัวสุขสันต์')
  })

  it('ย้ายไปโต๊ะเดิม -> 400', async () => {
    const s = await seedShop()
    const t1 = s.tables.get('T-01')!
    const bill = await s.openTableBill(t1.id)

    const res = await request(app).post(`/api/pos/bills/${bill.id}/move`).set(auth(s.token)).send({ table_id: t1.id })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('ย้ายไปโต๊ะที่มีบิลเปิดอยู่แล้ว -> 409 TABLE_ALREADY_OPEN', async () => {
    const s = await seedShop()
    const t1 = s.tables.get('T-01')!
    const t2 = s.tables.get('T-02')!

    const bill1 = await s.openTableBill(t1.id)
    await s.openTableBill(t2.id)

    const res = await request(app).post(`/api/pos/bills/${bill1.id}/move`).set(auth(s.token)).send({ table_id: t2.id })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('TABLE_ALREADY_OPEN')
  })

  it('ย้ายบิลที่ไม่ได้เปิดอยู่ (CANCELLED หรือ PAID) -> 400', async () => {
    const s = await seedShop()
    const t1 = s.tables.get('T-01')!
    const t2 = s.tables.get('T-02')!

    const bill = await s.openTableBill(t1.id)
    db.prepare(`UPDATE pos_running_bills SET status = 'CANCELLED' WHERE id = ?`).run(bill.id)

    const res = await request(app).post(`/api/pos/bills/${bill.id}/move`).set(auth(s.token)).send({ table_id: t2.id })
    expect(res.status).toBe(400)
  })
})

describe('C2: รวมโต๊ะ (POST /api/pos/bills/:id/merge)', () => {
  it('รวมบิลสำเร็จ: ย้าย items, tickets, redemptions, guest items, ยกเลิกบิลต้นทางพร้อม merged_into_bill_id และคำนวณยอดใหม่', async () => {
    const s = await seedShop()
    const t1 = s.tables.get('T-01')!
    const t2 = s.tables.get('T-02')!

    const bill1 = await s.openTableBill(t1.id)
    const bill2 = await s.openTableBill(t2.id)

    // บิล 1 สั่งข้าวกะเพรา 2 จาน (160 บาท)
    const item1 = s.addItem(bill1.id, s.kaprao, 2)
    const ticket1 = s.addTicket(bill1.id, bill1.bill_number, 'T-01', 'PENDING')

    // บิล 2 สั่งต้มยำกุ้ง 1 ถ้วย (150 บาท)
    s.addItem(bill2.id, s.soup, 1)

    // สร้างของแถมและแลกแต้มในบิล 1
    const rewardId = generateId()
    db.prepare(`INSERT INTO pos_rewards (id, tenant_id, name, points_cost, pos_menu_id) VALUES (?, ?, 'ชาเขียวฟรี', 50, ?)`).run(
      rewardId,
      s.tenantId,
      s.kaprao.mid
    )
    const custId = s.addCustomer('คุณเอ', '0811111111')
    const redemptionId = generateId()
    db.prepare(`
      INSERT INTO pos_redemptions (id, tenant_id, bill_id, customer_id, reward_id, bill_item_id, points, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 50, 'RESERVED', ?)
    `).run(redemptionId, s.tenantId, bill1.id, custId, rewardId, item1, new Date().toISOString())

    // บันทึกรายการสั่งของลูกค้าทั่วไป (guest)
    const guestDeviceId = generateId()
    db.prepare(`
      INSERT INTO pos_guest_devices (id, tenant_id, token_hash, consent_at, created_at, expires_at)
      VALUES (?, ?, 'hash123', ?, ?, ?)
    `).run(guestDeviceId, s.tenantId, new Date().toISOString(), new Date().toISOString(), new Date().toISOString())
    db.prepare(`
      INSERT INTO pos_guest_bill_items (bill_item_id, guest_id, tenant_id, bill_id)
      VALUES (?, ?, ?, ?)
    `).run(item1, guestDeviceId, s.tenantId, bill1.id)

    // บิล 1 มีเวลาเรียกเช็คบิลเร็วกว่าบิล 2
    const earlierTime = '2026-10-21T01:00:00.000Z'
    const laterTime = '2026-10-21T01:30:00.000Z'
    db.prepare('UPDATE pos_running_bills SET bill_requested_at = ? WHERE id = ?').run(earlierTime, bill1.id)
    db.prepare('UPDATE pos_running_bills SET bill_requested_at = ? WHERE id = ?').run(laterTime, bill2.id)

    // รวมบิล 1 เข้าบิล 2
    const res = await request(app).post(`/api/pos/bills/${bill1.id}/merge`).set(auth(s.token)).send({
      target_bill_id: bill2.id,
    })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.id).toBe(bill2.id)
    expect(res.body.data.bill_number).toBe(bill2.bill_number)

    // ตรวจสอบรายการอาหารทั้งหมดต้องย้ายมาที่ bill2
    const items = db.prepare('SELECT bill_id FROM pos_bill_items WHERE bill_id = ?').all(bill2.id) as any[]
    expect(items.length).toBe(2) // item1 + soup

    // ตรวจสอบตั๋วครัว ย้ายมา bill2 และเปลี่ยน table_name เป็น display_name ของ bill2
    const ticket = db.prepare('SELECT bill_id, bill_number, table_name FROM pos_kds_tickets WHERE id = ?').get(ticket1) as any
    expect(ticket.bill_id).toBe(bill2.id)
    expect(ticket.bill_number).toBe(bill2.bill_number)
    expect(ticket.table_name).toBe('T-02')

    // ตรวจสอบรายการแลกของแถม
    const redemption = db.prepare('SELECT bill_id FROM pos_redemptions WHERE id = ?').get(redemptionId) as any
    expect(redemption.bill_id).toBe(bill2.id)

    // ตรวจสอบ guest item
    const guestItem = db.prepare('SELECT bill_id FROM pos_guest_bill_items WHERE bill_item_id = ?').get(item1) as any
    expect(guestItem.bill_id).toBe(bill2.id)

    // ตรวจสอบยอดรวมบิล 2 ถูกคำนวณใหม่ (160 + 150 = 310)
    const targetBill = db.prepare('SELECT total_amount, subtotal, bill_requested_at FROM pos_running_bills WHERE id = ?').get(bill2.id) as any
    expect(targetBill.total_amount).toBe(310)
    expect(targetBill.subtotal).toBe(310)
    // เก็บเวลาเรียกเช็คบิลที่เร็วที่สุด
    expect(targetBill.bill_requested_at).toBe(earlierTime)

    // ตรวจสอบบิลต้นทาง (bill1) ถูกยกเลิก ปลดโต๊ะ และบันทึก merged_into_bill_id + หมายเหตุ
    const sourceBill = db.prepare('SELECT status, table_id, merged_into_bill_id, notes, closed_at FROM pos_running_bills WHERE id = ?').get(bill1.id) as any
    expect(sourceBill.status).toBe('CANCELLED')
    expect(sourceBill.table_id).toBeNull()
    expect(sourceBill.merged_into_bill_id).toBe(bill2.id)
    expect(sourceBill.closed_at).toBeTruthy()
    expect(sourceBill.notes).toContain(`[รวมเข้าบิล ${bill2.bill_number}]`)

    // โต๊ะ T-01 ต้องว่างแล้ว และสามารถเปิดบิลใหม่ได้
    const openAgain = await request(app).post('/api/pos/bills').set(auth(s.token)).send({ table_id: t1.id })
    expect(openAgain.status).toBe(200)
  })

  it('คัดลอกข้อมูลสมาชิกไปยังบิลปลายทางเมื่อปลายทางยังไม่มีสมาชิก', async () => {
    const s = await seedShop()
    const t1 = s.tables.get('T-01')!
    const t2 = s.tables.get('T-02')!

    const bill1 = await s.openTableBill(t1.id)
    const bill2 = await s.openTableBill(t2.id)

    const custId = s.addCustomer('คุณสมศรี', '0899999999')
    db.prepare(`
      UPDATE pos_running_bills
      SET customer_id = ?, customer_name = 'คุณสมศรี', customer_phone = '0899999999', member_device_id = 'dev-456'
      WHERE id = ?
    `).run(custId, bill1.id)

    const res = await request(app).post(`/api/pos/bills/${bill1.id}/merge`).set(auth(s.token)).send({
      target_bill_id: bill2.id,
    })
    expect(res.status).toBe(200)

    const targetAfter = db.prepare('SELECT customer_id, customer_name, customer_phone, member_device_id FROM pos_running_bills WHERE id = ?').get(bill2.id) as any
    expect(targetAfter.customer_id).toBe(custId)
    expect(targetAfter.customer_name).toBe('คุณสมศรี')
    expect(targetAfter.customer_phone).toBe('0899999999')
    expect(targetAfter.member_device_id).toBe('dev-456')
  })

  it('สมาชิกขัดแย้งกัน (customer_id ต่างกันทั้งสองบิล) -> 409 MEMBER_CONFLICT', async () => {
    const s = await seedShop()
    const t1 = s.tables.get('T-01')!
    const t2 = s.tables.get('T-02')!

    const bill1 = await s.openTableBill(t1.id)
    const bill2 = await s.openTableBill(t2.id)

    const cust1 = s.addCustomer('สมาชิก 1', '0810000001')
    const cust2 = s.addCustomer('สมาชิก 2', '0810000002')

    db.prepare('UPDATE pos_running_bills SET customer_id = ? WHERE id = ?').run(cust1, bill1.id)
    db.prepare('UPDATE pos_running_bills SET customer_id = ? WHERE id = ?').run(cust2, bill2.id)

    const res = await request(app).post(`/api/pos/bills/${bill1.id}/merge`).set(auth(s.token)).send({
      target_bill_id: bill2.id,
    })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('MEMBER_CONFLICT')
  })

  it('สมาชิกตรงกันทั้งสองบิล -> รวมได้ไม่เกิด conflict', async () => {
    const s = await seedShop()
    const t1 = s.tables.get('T-01')!
    const t2 = s.tables.get('T-02')!

    const bill1 = await s.openTableBill(t1.id)
    const bill2 = await s.openTableBill(t2.id)

    const cust = s.addCustomer('สมาชิกท่านเดียวกัน', '0810000001')
    db.prepare('UPDATE pos_running_bills SET customer_id = ? WHERE id = ?').run(cust, bill1.id)
    db.prepare('UPDATE pos_running_bills SET customer_id = ? WHERE id = ?').run(cust, bill2.id)

    const res = await request(app).post(`/api/pos/bills/${bill1.id}/merge`).set(auth(s.token)).send({
      target_bill_id: bill2.id,
    })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('บิลต้นทางมีส่วนลด -> 409 ให้ล้างออกก่อน', async () => {
    const s = await seedShop()
    const t1 = s.tables.get('T-01')!
    const t2 = s.tables.get('T-02')!

    const bill1 = await s.openTableBill(t1.id)
    const bill2 = await s.openTableBill(t2.id)

    db.prepare('UPDATE pos_running_bills SET discount_amount = 50 WHERE id = ?').run(bill1.id)

    const res = await request(app).post(`/api/pos/bills/${bill1.id}/merge`).set(auth(s.token)).send({
      target_bill_id: bill2.id,
    })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('SOURCE_HAS_DISCOUNT_OR_CHARGE')
  })

  it('บิลต้นทางมีค่าบริการเพิ่มเติม (extra_charge_amount) -> 409', async () => {
    const s = await seedShop()
    const t1 = s.tables.get('T-01')!
    const t2 = s.tables.get('T-02')!

    const bill1 = await s.openTableBill(t1.id)
    const bill2 = await s.openTableBill(t2.id)

    db.prepare('UPDATE pos_running_bills SET extra_charge_amount = 30 WHERE id = ?').run(bill1.id)

    const res = await request(app).post(`/api/pos/bills/${bill1.id}/merge`).set(auth(s.token)).send({
      target_bill_id: bill2.id,
    })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('SOURCE_HAS_DISCOUNT_OR_CHARGE')
  })

  it('รวมบิลตัวเอง (source == target) -> 400', async () => {
    const s = await seedShop()
    const t1 = s.tables.get('T-01')!
    const bill1 = await s.openTableBill(t1.id)

    const res = await request(app).post(`/api/pos/bills/${bill1.id}/merge`).set(auth(s.token)).send({
      target_bill_id: bill1.id,
    })
    expect(res.status).toBe(400)
  })
})

describe('ความปลอดภัยและการแยกข้อมูลระหว่างร้าน (Tenant Isolation)', () => {
  it('ย้ายบิลของร้านอื่น -> 404', async () => {
    const s1 = await seedShop()
    const s2 = await seedShop()

    const t1 = s1.tables.get('T-01')!
    const t2 = s2.tables.get('T-02')!

    const billOfShop1 = await s1.openTableBill(t1.id)

    // ร้านที่ 2 พยายามย้ายบิลของร้านที่ 1
    const res = await request(app).post(`/api/pos/bills/${billOfShop1.id}/move`).set(auth(s2.token)).send({
      table_id: t2.id,
    })
    expect(res.status).toBe(404)
  })

  it('ย้ายบิลของตัวเองไปโต๊ะของร้านอื่น -> 404', async () => {
    const s1 = await seedShop()
    const s2 = await seedShop()

    const t1 = s1.tables.get('T-01')!
    const t2OfShop2 = s2.tables.get('T-02')!

    const billOfShop1 = await s1.openTableBill(t1.id)

    // ร้านที่ 1 พยายามย้ายไปโต๊ะของร้านที่ 2
    const res = await request(app).post(`/api/pos/bills/${billOfShop1.id}/move`).set(auth(s1.token)).send({
      table_id: t2OfShop2.id,
    })
    expect(res.status).toBe(404)
  })

  it('รวมบิลของร้านอื่น หรือรวมเข้าบิลของร้านอื่น -> 404', async () => {
    const s1 = await seedShop()
    const s2 = await seedShop()

    const bill1 = await s1.openTableBill(s1.tables.get('T-01')!.id)
    const bill2 = await s2.openTableBill(s2.tables.get('T-01')!.id)

    // ร้านที่ 1 พยายามรวมบิลของร้านที่ 2 เข้าบิลตัวเอง
    const res1 = await request(app).post(`/api/pos/bills/${bill2.id}/merge`).set(auth(s1.token)).send({
      target_bill_id: bill1.id,
    })
    expect(res1.status).toBe(404)

    // ร้านที่ 1 พยายามรวมบิลของตัวเองเข้าบิลร้านที่ 2
    const res2 = await request(app).post(`/api/pos/bills/${bill1.id}/merge`).set(auth(s1.token)).send({
      target_bill_id: bill2.id,
    })
    expect(res2.status).toBe(404)
  })
})
