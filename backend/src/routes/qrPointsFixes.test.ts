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
import customerRouter from './customer.routes'
import settingsRouter from './settings.routes'
import { createTestUser } from '../test/testAuth'
import { availablePoints, reservedPoints } from '../services/qrRewards.service'
import { cancelPosBill } from '../services/posBillCancel.service'

const app = express()
app.use(express.json())
app.use(cookieParser())
app.use('/api/pos', posBillRouter)
app.use('/api/pos', posTablesRouter)
app.use('/api/pos/qr-marketing', qrMarketingRouter)
app.use('/api/customers', customerRouter)
app.use('/api/settings', settingsRouter)
app.use('/qr/api', qrPublicRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM pos_kds_ticket_items WHERE ticket_id IN (SELECT id FROM pos_kds_tickets WHERE tenant_id = ?)').run(t)
    for (const tbl of [
      'pos_redemptions', 'pos_rewards', 'pos_promotions', 'pos_ad_slots', 'pos_ad_events', 'pos_member_devices', 'loyalty_transactions',
      'pos_kds_tickets', 'journal_lines', 'journal_entries', 'pos_payments', 'pos_stock_deductions', 'pos_bill_items', 'pos_running_bills', 'pos_tables',
      'pos_shifts', 'pos_menu_configs', 'stock_items', 'customers', 'company_settings', 'accounts', 'users', 'document_sequences'
    ]) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* no tenant_id column */ }
    }
  }
})

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

async function setupShop(customSettings?: { earnRate?: number; redeemRate?: number; minRedeem?: number }) {
  const u = createTestUser()
  tenants.push(u.tenantId)

  const earnRate = customSettings?.earnRate ?? 100
  const redeemRate = customSettings?.redeemRate ?? 10
  const minRedeem = customSettings?.minRedeem ?? 10

  // ปิด VAT/ค่าบริการ ให้ยอดบิล = ราคาเมนู คำนวณแต้มในเทสต์ได้ตรง ๆ
  db.prepare(`
    INSERT INTO company_settings (tenant_id, name, pos_bom_deduct, loyalty_enabled, loyalty_earn_rate, loyalty_redeem_rate, loyalty_min_redeem,
      pos_vat_enabled, pos_service_enabled)
    VALUES (?, 'Test Restaurant', 0, 1, ?, ?, ?, 0, 0)
  `).run(u.tenantId, earnRate, redeemRate, minRedeem)

  db.prepare(`
    INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, opening_cash, opened_by)
    VALUES (?, ?, 'SH-FIX', 'OPEN', ?, 0, 'tester')
  `).run(generateId(), u.tenantId, new Date().toISOString())

  const createMenu = (name: string, price: number) => {
    const pid = generateId(), mid = generateId()
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, unit, location, status) VALUES (?, ?, ?, ?, 'FOOD', 'pcs', 'WH1', 'ACTIVE')`)
      .run(pid, u.tenantId, pid, name)
    db.prepare(`INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price) VALUES (?, ?, ?, ?)`)
      .run(mid, u.tenantId, pid, price)
    return { productId: pid, menuId: mid }
  }

  const addCustomer = (phone: string, points = 0, spent = 0) => {
    const cid = generateId()
    db.prepare(`
      INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, status, loyalty_points, total_spent)
      VALUES (?, ?, ?, 'Member Test', 'INDIVIDUAL', '-', 'test@example.com', ?, '', 'ACTIVE', ?, ?)
    `).run(cid, u.tenantId, 'C-' + cid.slice(0, 6), phone, points, spent)
    return cid
  }

  return { ...u, createMenu, addCustomer }
}

describe('TASK A1: Loyalty points consistency on POS payment', () => {
  it('A1: ตรวจ availablePoints ป้องกันแลกแต้มเกินส่วนที่ไม่ได้จองของแถม (REDEEM_INVALID 400)', async () => {
    const s = await setupShop({ earnRate: 100, redeemRate: 10, minRedeem: 10 })
    const { menuId: foodMenu } = s.createMenu('ข้าวกะเพรา', 200)
    const { menuId: drinkMenu } = s.createMenu('ชาเขียว', 50)
    const custId = s.addCustomer('0811111111', 100) // มี 100 แต้ม

    // สร้าง Reward 80 แต้ม
    const rewardId = generateId()
    db.prepare(`
      INSERT INTO pos_rewards (id, tenant_id, name, points_cost, pos_menu_id, is_active)
      VALUES (?, ?, 'ชาเขียวฟรี', 80, ?, 1)
    `).run(rewardId, s.tenantId, drinkMenu)

    // เปิดบิลที่ 1 ผูกสมาชิก
    const bill1Res = await request(app).post('/api/pos/bills').set(auth(s.token)).send({ customer_id: custId })
    const bill1Id = bill1Res.body.data.id

    // ใส่รายการอาหาร 200 บาท
    await request(app).post(`/api/pos/bills/${bill1Id}/items`).set(auth(s.token)).send({ pos_menu_id: foodMenu, quantity: 1 })

    // จองของแถม 80 แต้มในบิล 1
    const giftItemId = generateId()
    db.prepare(`
      INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price, created_by)
      VALUES (?, ?, ?, ?, '🎁 ชาเขียวฟรี', 1, 0, 0, 'QR')
    `).run(giftItemId, s.tenantId, bill1Id, drinkMenu)
    db.prepare(`
      INSERT INTO pos_redemptions (id, tenant_id, bill_id, customer_id, reward_id, bill_item_id, points, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 80, 'RESERVED', ?)
    `).run(generateId(), s.tenantId, bill1Id, custId, rewardId, giftItemId, new Date().toISOString())

    // แต้มคงเหลือ 100, จองไว้ 80, ว่าง 20
    const ptsInfo = availablePoints(s.tenantId, custId)
    expect(ptsInfo.total).toBe(100)
    expect(ptsInfo.reserved).toBe(80)
    expect(ptsInfo.available).toBe(20)

    // แคชเชียร์พยายามแลก 50 แต้มบนบิล 1 -> ต้องติด REDEEM_INVALID 400 บอกแต้มที่ใช้ได้และจองไว้
    const payTooMuch = await request(app).post(`/api/pos/bills/${bill1Id}/pay`).set(auth(s.token)).send({
      payment_method: 'CASH',
      redeem_points: 50,
    })
    expect(payTooMuch.status).toBe(400)
    expect(payTooMuch.body.code).toBe('REDEEM_INVALID')
    expect(payTooMuch.body.message).toMatch(/20/)
    expect(payTooMuch.body.message).toMatch(/80/)

    // เปิดบิลที่ 2 ของลูกค้ารายเดียวกัน
    const bill2Res = await request(app).post('/api/pos/bills').set(auth(s.token)).send({ customer_id: custId })
    const bill2Id = bill2Res.body.data.id
    await request(app).post(`/api/pos/bills/${bill2Id}/items`).set(auth(s.token)).send({ pos_menu_id: foodMenu, quantity: 1 })

    // บิลที่ 2 พยายามแลก 50 แต้ม -> ต้องติด 400 เช่นกัน เพราะแต้มถูกจองไว้ที่บิล 1
    const payBill2TooMuch = await request(app).post(`/api/pos/bills/${bill2Id}/pay`).set(auth(s.token)).send({
      payment_method: 'CASH',
      redeem_points: 50,
    })
    expect(payBill2TooMuch.status).toBe(400)
    expect(payBill2TooMuch.body.code).toBe('REDEEM_INVALID')

    // จ่ายบิล 1 ด้วยแต้มที่มีสิทธิ์แลก (20 แต้ม) -> สำเร็จ
    const payOk = await request(app).post(`/api/pos/bills/${bill1Id}/pay`).set(auth(s.token)).send({
      payment_method: 'CASH',
      redeem_points: 20,
    })
    expect(payOk.status).toBe(200)
    expect(payOk.body.data.points_redeemed).toBe(100) // 20 แลกส่วนลด + 80 ของแถม
  })

  it('A1: in-transaction guard โยน InsufficientPointsError และแมปเป็น 400 REDEEM_INVALID แทน 500', async () => {
    const s = await setupShop({ earnRate: 100, redeemRate: 10, minRedeem: 10 })
    const { menuId: foodMenu } = s.createMenu('ต้มยำ', 200)
    const { menuId: drinkMenu } = s.createMenu('น้ำเปล่า', 20)
    const custId = s.addCustomer('0822222222', 50)

    const rewardId = generateId()
    db.prepare(`INSERT INTO pos_rewards (id, tenant_id, name, points_cost, pos_menu_id, is_active) VALUES (?, ?, 'น้ำเปล่าฟรี', 50, ?, 1)`)
      .run(rewardId, s.tenantId, drinkMenu)

    const billRes = await request(app).post('/api/pos/bills').set(auth(s.token)).send({ customer_id: custId })
    const billId = billRes.body.data.id
    await request(app).post(`/api/pos/bills/${billId}/items`).set(auth(s.token)).send({ pos_menu_id: foodMenu, quantity: 1 })

    // จอง 50 แต้ม
    const giftItemId = generateId()
    db.prepare(`INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price, created_by) VALUES (?, ?, ?, ?, '🎁 น้ำเปล่าฟรี', 1, 0, 0, 'QR')`)
      .run(giftItemId, s.tenantId, billId, drinkMenu)
    db.prepare(`INSERT INTO pos_redemptions (id, tenant_id, bill_id, customer_id, reward_id, bill_item_id, points, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 50, 'RESERVED', ?)`)
      .run(generateId(), s.tenantId, billId, custId, rewardId, giftItemId, new Date().toISOString())

    // จำลองแต้มถูกหักไปในระบบอื่นจนเหลือ 10 แต้มก่อนกดจ่ายเงิน
    db.prepare('UPDATE customers SET loyalty_points = 10 WHERE id = ?').run(custId)

    // จ่ายเงินโดยไม่แลกแต้มท้ายบิล (redeem_points = 0) แต่ในบิลมีของแถม 50 แต้ม
    const payRes = await request(app).post(`/api/pos/bills/${billId}/pay`).set(auth(s.token)).send({
      payment_method: 'CASH',
    })
    // ต้องได้ 400 REDEEM_INVALID ไม่ใช่ 500!
    expect(payRes.status).toBe(400)
    expect(payRes.body.code).toBe('REDEEM_INVALID')
    expect(payRes.body.message).toMatch(/คะแนนสะสมของลูกค้าไม่เพียงพอ/)
  })
})

describe('TASK A2: Customer loyalty redeem available points check', () => {
  it('A2: POST /customers/:id/loyalty/redeem ปฏิเสธการแลกแต้มที่ถูกจองไว้กับบิล OPEN', async () => {
    const s = await setupShop()
    const { menuId: foodMenu } = s.createMenu('ส้มตำ', 80)
    const { menuId: drinkMenu } = s.createMenu('น้ำส้ม', 40)
    const custId = s.addCustomer('0833333333', 100)

    const rewardId = generateId()
    db.prepare(`INSERT INTO pos_rewards (id, tenant_id, name, points_cost, pos_menu_id, is_active) VALUES (?, ?, 'น้ำส้มฟรี', 60, ?, 1)`)
      .run(rewardId, s.tenantId, drinkMenu)

    const billRes = await request(app).post('/api/pos/bills').set(auth(s.token)).send({ customer_id: custId })
    const billId = billRes.body.data.id
    await request(app).post(`/api/pos/bills/${billId}/items`).set(auth(s.token)).send({ pos_menu_id: foodMenu, quantity: 1 })

    // จอง 60 แต้ม
    const giftItemId = generateId()
    db.prepare(`INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price, created_by) VALUES (?, ?, ?, ?, '🎁 น้ำส้มฟรี', 1, 0, 0, 'QR')`)
      .run(giftItemId, s.tenantId, billId, drinkMenu)
    db.prepare(`INSERT INTO pos_redemptions (id, tenant_id, bill_id, customer_id, reward_id, bill_item_id, points, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 60, 'RESERVED', ?)`)
      .run(generateId(), s.tenantId, billId, custId, rewardId, giftItemId, new Date().toISOString())

    // แต้มมี 100 แต่จอง 60 เหลือว่าง 40 -> พยายามแลก 50 แต้มใน CRM
    const redeemRes = await request(app).post(`/api/customers/${custId}/loyalty/redeem`).set(auth(s.token)).send({
      points: 50,
      note: 'แลกคูปอง',
    })
    expect(redeemRes.status).toBe(400)
    expect(redeemRes.body.code).toBe('INSUFFICIENT_POINTS')
    expect(redeemRes.body.message).toMatch(/40/)
    expect(redeemRes.body.message).toMatch(/60/)

    // แต้มในฐานต้องไม่ลด
    const custBefore = db.prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(custId) as any
    expect(custBefore.loyalty_points).toBe(100)

    // แลก 30 แต้ม (อยู่ในโควตาที่ว่าง) -> สำเร็จ
    const redeemOk = await request(app).post(`/api/customers/${custId}/loyalty/redeem`).set(auth(s.token)).send({
      points: 30,
      note: 'แลกส่วนลด CRM',
    })
    expect(redeemOk.status).toBe(200)
    const custAfter = db.prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(custId) as any
    expect(custAfter.loyalty_points).toBe(70)
  })
})

describe('TASK A3: GET /bills/:id returns customer_reserved_points', () => {
  it('A3: GET /bills/:id ส่งคืน customer_reserved_points ถูกต้อง', async () => {
    const s = await setupShop()
    const { menuId: foodMenu } = s.createMenu('ผัดไทย', 90)
    const custId = s.addCustomer('0844444444', 200)

    const billRes = await request(app).post('/api/pos/bills').set(auth(s.token)).send({ customer_id: custId })
    const billId = billRes.body.data.id
    const itemRes = await request(app).post(`/api/pos/bills/${billId}/items`).set(auth(s.token)).send({ pos_menu_id: foodMenu, quantity: 1 })
    const itemId = itemRes.body.data.id

    // ก่อนจองของแถม: reserved = 0
    const get1 = await request(app).get(`/api/pos/bills/${billId}`).set(auth(s.token))
    expect(get1.status).toBe(200)
    expect(get1.body.data.customer_loyalty_points).toBe(200)
    expect(get1.body.data.customer_reserved_points).toBe(0)

    // จำลองจองของแถม 75 แต้ม
    const rId = generateId()
    db.prepare(`INSERT INTO pos_rewards (id, tenant_id, name, points_cost, pos_menu_id, is_active) VALUES (?, ?, 'ผัดไทยฟรี', 75, ?, 1)`)
      .run(rId, s.tenantId, foodMenu)
    db.prepare(`INSERT INTO pos_redemptions (id, tenant_id, bill_id, customer_id, reward_id, bill_item_id, points, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 75, 'RESERVED', ?)`)
      .run(generateId(), s.tenantId, billId, custId, rId, itemId, new Date().toISOString())

    const get2 = await request(app).get(`/api/pos/bills/${billId}`).set(auth(s.token))
    expect(get2.status).toBe(200)
    expect(get2.body.data.customer_reserved_points).toBe(75)
  })
})

describe('TASK A4: Reward items lock on edit and merge guard', () => {
  it('A4: PUT /bills/:billId/items/:itemId ล็อกห้ามเปลี่ยนจำนวนของแถม (409 REWARD_ITEM_LOCKED) แต่แก้หมายเหตุได้', async () => {
    const s = await setupShop()
    const { menuId: foodMenu } = s.createMenu('ข้าวมันไก่', 60)
    const custId = s.addCustomer('0855555555', 100)

    const billRes = await request(app).post('/api/pos/bills').set(auth(s.token)).send({ customer_id: custId })
    const billId = billRes.body.data.id

    // ของแถม 1 รายการ ผูก pos_redemptions RESERVED
    const giftItemId = generateId()
    db.prepare(`INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price, special_instructions, created_by)
      VALUES (?, ?, ?, ?, '🎁 ข้าวมันไก่ฟรี', 1, 0, 0, 'แลก 50 แต้ม', 'QR')`).run(giftItemId, s.tenantId, billId, foodMenu)

    const rId = generateId()
    db.prepare(`INSERT INTO pos_rewards (id, tenant_id, name, points_cost, pos_menu_id, is_active) VALUES (?, ?, 'ไก่ฟรี', 50, ?, 1)`).run(rId, s.tenantId, foodMenu)
    db.prepare(`INSERT INTO pos_redemptions (id, tenant_id, bill_id, customer_id, reward_id, bill_item_id, points, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 50, 'RESERVED', ?)`).run(generateId(), s.tenantId, billId, custId, rId, giftItemId, new Date().toISOString())

    // แคชเชียร์พยายามเปลี่ยนจำนวนจาก 1 เป็น 2 -> 409 REWARD_ITEM_LOCKED
    const editQty = await request(app).put(`/api/pos/bills/${billId}/items/${giftItemId}`).set(auth(s.token)).send({ quantity: 2 })
    expect(editQty.status).toBe(409)
    expect(editQty.body.code).toBe('REWARD_ITEM_LOCKED')
    expect(editQty.body.message).toMatch(/ลบรายการ/)

    // แคชเชียร์แก้เฉพาะหมายเหตุ (ไม่เปลี่ยนจำนวน) -> ได้
    const editNote = await request(app).put(`/api/pos/bills/${billId}/items/${giftItemId}`).set(auth(s.token)).send({
      special_instructions: 'ไม่เอาหนัง',
    })
    expect(editNote.status).toBe(200)
    const item = db.prepare('SELECT special_instructions, quantity FROM pos_bill_items WHERE id = ?').get(giftItemId) as any
    expect(item.quantity).toBe(1)
    expect(item.special_instructions).toBe('ไม่เอาหนัง')
  })

  it('A4: POST /bills/:id/items จะไม่ merge รายการใหม่เข้ากับแถวที่เป็นของแถม', async () => {
    const s = await setupShop()
    const { menuId: foodMenu } = s.createMenu('เกี๊ยวซ่า', 80)
    const custId = s.addCustomer('0866666666', 100)

    const billRes = await request(app).post('/api/pos/bills').set(auth(s.token)).send({ customer_id: custId })
    const billId = billRes.body.data.id

    // ของแถม 1 รายการ (unit_price 0, sent_to_kds = 0)
    const giftItemId = generateId()
    db.prepare(`INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price, special_instructions, sent_to_kds, created_by)
      VALUES (?, ?, ?, ?, '🎁 เกี๊ยวซ่า', 1, 0, 0, 'กรอบๆ', 0, 'QR')`).run(giftItemId, s.tenantId, billId, foodMenu)

    const rId = generateId()
    db.prepare(`INSERT INTO pos_rewards (id, tenant_id, name, points_cost, pos_menu_id, is_active) VALUES (?, ?, 'เกี๊ยวซ่าฟรี', 50, ?, 1)`).run(rId, s.tenantId, foodMenu)
    db.prepare(`INSERT INTO pos_redemptions (id, tenant_id, bill_id, customer_id, reward_id, bill_item_id, points, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 50, 'RESERVED', ?)`).run(generateId(), s.tenantId, billId, custId, rId, giftItemId, new Date().toISOString())

    // ลูกค้าสั่งเกี๊ยวซ่าเพิ่มแบบจ่ายเงิน โดยใส่หมายเหตุ 'กรอบๆ' เหมือนกัน
    const addItem = await request(app).post(`/api/pos/bills/${billId}/items`).set(auth(s.token)).send({
      pos_menu_id: foodMenu,
      quantity: 1,
      special_instructions: 'กรอบๆ',
    })
    expect(addItem.status).toBe(200)
    expect(addItem.body.data.id).not.toBe(giftItemId)

    // ต้องมี pos_bill_items 2 แถวแยกกัน ชัดเจน
    const items = db.prepare('SELECT id, quantity, unit_price, total_price FROM pos_bill_items WHERE bill_id = ?').all(billId) as any[]
    expect(items.length).toBe(2)
    const gift = items.find(i => i.id === giftItemId)
    expect(gift.quantity).toBe(1)
    expect(gift.total_price).toBe(0)
  })
})

describe('TASK A5: PATCH /bills/:id/member on PAID bill', () => {
  it('A5(a): บิลจ่ายแล้วและมีประวัติแต้ม POS_BILL แล้ว ห้ามเปลี่ยนสมาชิกหรือถอดสมาชิก (409 MEMBER_LOCKED_POINTS)', async () => {
    const s = await setupShop({ earnRate: 50 })
    const { menuId: foodMenu } = s.createMenu('สเต๊ก', 250)
    const cust1 = s.addCustomer('0871111111', 0)
    const cust2 = s.addCustomer('0872222222', 0)

    const billRes = await request(app).post('/api/pos/bills').set(auth(s.token)).send({ customer_id: cust1 })
    const billId = billRes.body.data.id
    await request(app).post(`/api/pos/bills/${billId}/items`).set(auth(s.token)).send({ pos_menu_id: foodMenu, quantity: 1 })

    // จ่ายเงิน -> ได้ 5 แต้ม (250 / 50)
    const pay = await request(app).post(`/api/pos/bills/${billId}/pay`).set(auth(s.token)).send({ payment_method: 'CASH' })
    expect(pay.status).toBe(200)
    expect(pay.body.data.points_earned).toBe(5)

    // แคชเชียร์พยายามเปลี่ยนสมาชิกเป็น cust2
    const changeCust = await request(app).patch(`/api/pos/bills/${billId}/member`).set(auth(s.token)).send({ customer_id: cust2 })
    expect(changeCust.status).toBe(409)
    expect(changeCust.body.code).toBe('MEMBER_LOCKED_POINTS')
    expect(changeCust.body.message).toMatch(/สมาชิกเดิม/)

    // แคชเชียร์พยายามถอดสมาชิกออก (customer_id: null)
    const removeCust = await request(app).patch(`/api/pos/bills/${billId}/member`).set(auth(s.token)).send({ customer_id: null })
    expect(removeCust.status).toBe(409)
    expect(removeCust.body.code).toBe('MEMBER_LOCKED_POINTS')

    // ส่ง cust1 คนเดิม -> สำเร็จ (200) ไม่แจกแต้มซ้ำ
    const sameCust = await request(app).patch(`/api/pos/bills/${billId}/member`).set(auth(s.token)).send({ customer_id: cust1 })
    expect(sameCust.status).toBe(200)
    const pointsAfter = (db.prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(cust1) as any).loyalty_points
    expect(pointsAfter).toBe(5) // ยังคงเป็น 5 แต้มเท่าเดิม
  })

  it('A5(b): บิลจ่ายแล้วที่ไม่ได้ผูกสมาชิก เมื่อมาผูกทีหลัง ต้องแจกแต้มสะสมย้อนหลังและเพิ่ม total_spent แบบ idempotent', async () => {
    const s = await setupShop({ earnRate: 100 })
    const { menuId: foodMenu } = s.createMenu('สุกี้', 250)
    const cust1 = s.addCustomer('0881111111', 10, 500) // เดิมมี 10 แต้ม ยอดซื้อสะสม 500

    // เปิดบิลแบบไม่ผูกสมาชิก
    const billRes = await request(app).post('/api/pos/bills').set(auth(s.token)).send({})
    const billId = billRes.body.data.id
    await request(app).post(`/api/pos/bills/${billId}/items`).set(auth(s.token)).send({ pos_menu_id: foodMenu, quantity: 1 })

    // จ่ายเงิน
    const pay = await request(app).post(`/api/pos/bills/${billId}/pay`).set(auth(s.token)).send({ payment_method: 'CASH' })
    expect(pay.status).toBe(200)
    expect(pay.body.data.points_earned).toBe(0)

    // ลูกค้าขอผูกสมาชิกทีหลัง
    const attach1 = await request(app).patch(`/api/pos/bills/${billId}/member`).set(auth(s.token)).send({ customer_id: cust1 })
    expect(attach1.status).toBe(200)

    // แต้มที่ได้: floor(250 / 100) = 2 แต้ม -> รวมเป็น 10 + 2 = 12 แต้ม, total_spent 500 + 250 = 750
    const custDb1 = db.prepare('SELECT loyalty_points, total_spent FROM customers WHERE id = ?').get(cust1) as any
    expect(custDb1.loyalty_points).toBe(12)
    expect(custDb1.total_spent).toBe(750)

    // มีประวัติ EARN ชนิด POS_BILL
    const tx = db.prepare(`SELECT * FROM loyalty_transactions WHERE reference_type = 'POS_BILL' AND reference_id = ?`).get(billId) as any
    expect(tx).toBeTruthy()
    expect(tx.type).toBe('EARN')
    expect(tx.points).toBe(2)
    expect(tx.balance_after).toBe(12)

    // เรียกซ้ำครั้งที่สอง (idempotent) -> ต้องไม่แจกแต้มซ้ำ
    const attach2 = await request(app).patch(`/api/pos/bills/${billId}/member`).set(auth(s.token)).send({ customer_id: cust1 })
    expect(attach2.status).toBe(200)
    const custDb2 = db.prepare('SELECT loyalty_points, total_spent FROM customers WHERE id = ?').get(cust1) as any
    expect(custDb2.loyalty_points).toBe(12)
    expect(custDb2.total_spent).toBe(750)
  })
})

describe('TASK A6: posBillCancel reverseLoyaltyPoints shortfall note and ledger consistency', () => {
  it('A6: ลูกค้าใช้แต้มไปแล้วจนไม่พอหักคืนเต็มจำนวน ให้บันทึก delta จริงที่หักได้ พร้อมระบุส่วนต่างใน note', async () => {
    const s = await setupShop({ earnRate: 10 })
    const { menuId: foodMenu } = s.createMenu('พิซซ่า', 500)
    const custId = s.addCustomer('0891111111', 0, 0)

    const billRes = await request(app).post('/api/pos/bills').set(auth(s.token)).send({ customer_id: custId })
    const billId = billRes.body.data.id
    await request(app).post(`/api/pos/bills/${billId}/items`).set(auth(s.token)).send({ pos_menu_id: foodMenu, quantity: 1 })

    // จ่ายบิล 500 บาท -> ได้ 50 แต้ม
    await request(app).post(`/api/pos/bills/${billId}/pay`).set(auth(s.token)).send({ payment_method: 'CASH' })
    const custAfterPay = db.prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(custId) as any
    expect(custAfterPay.loyalty_points).toBe(50)

    // ลูกค้านำแต้มไปใช้ 40 แต้ม (เหลือ 10 แต้ม)
    db.prepare('UPDATE customers SET loyalty_points = 10 WHERE id = ?').run(custId)

    // ยกเลิกบิล
    const cancelRes = await cancelPosBill(s.tenantId, s.userId, billId, 'ยกเลิกออเดอร์')
    expect(cancelRes.pointsResult.success).toBe(true)
    expect(cancelRes.pointsResult.delta).toBe(-10) // หักได้จริงแค่ 10 แต้ม

    // แต้มลูกค้าถูก clamp ไว้ที่ 0
    const custAfterCancel = db.prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(custId) as any
    expect(custAfterCancel.loyalty_points).toBe(0)

    // ledger แถว POS_CANCEL ต้องบันทึก points: -10 และ balance_after: 0 (ตรงกับยอดจริง)
    const cancelTx = db.prepare(`SELECT * FROM loyalty_transactions WHERE reference_type = 'POS_CANCEL' AND reference_id = ?`).get(billId) as any
    expect(cancelTx).toBeTruthy()
    expect(cancelTx.points).toBe(-10)
    expect(cancelTx.balance_after).toBe(0)
    expect(cancelTx.note).toMatch(/หักคืนได้ 10 จาก 50 แต้ม \(แต้มไม่พอ\)/)
  })
})
