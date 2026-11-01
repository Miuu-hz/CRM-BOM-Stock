import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import posBillRouter from './pos-bill.routes'
import { createTestUser } from '../test/testAuth'
import { ACC } from '../config/accountCodes'

const app = express()
app.use(express.json())
app.use('/api/pos', posBillRouter)

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

function seed() {
  const admin = createTestUser({ role: 'ADMIN' })
  const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
  // ปิด VAT/ค่าบริการ เปิด pos_bom_deduct และ allow_negative_stock เพื่อทดสอบการตัดสต็อก
  db.prepare(`
    INSERT INTO company_settings (tenant_id, pos_bom_deduct, allow_negative_stock, pos_vat_enabled, pos_service_enabled)
    VALUES (?, 1, 1, 0, 0)
  `).run(admin.tenantId)
  db.prepare(`
    INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, opening_cash, opened_by)
    VALUES (?, ?, 'SH-TEST', 'OPEN', ?, 0, 'tester')
  `).run(generateId(), admin.tenantId, new Date().toISOString())
  return { admin, user, tenantId: admin.tenantId }
}

function createMenuItem(tenantId: string, name: string, posPrice: number) {
  const productId = generateId()
  const menuId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, unit, location, status)
    VALUES (?, ?, ?, ?, 'FOOD', 'pcs', 'WH1', 'ACTIVE')
  `).run(productId, tenantId, productId, name)
  db.prepare(`
    INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price)
    VALUES (?, ?, ?, ?)
  `).run(menuId, tenantId, productId, posPrice)
  return { productId, menuId }
}

async function openBill(t: ReturnType<typeof seed>) {
  const billRes = await request(app)
    .post('/api/pos/bills')
    .set(auth(t.user.token))
    .send({})
  expect(billRes.status).toBe(200)
  return billRes.body.data.id as string
}

async function addItem(t: ReturnType<typeof seed>, billId: string, menuId: string, quantity = 1) {
  const res = await request(app)
    .post(`/api/pos/bills/${billId}/items`)
    .set(auth(t.user.token))
    .send({ pos_menu_id: menuId, quantity })
  expect(res.status).toBe(200)
  return res.body.data.id as string
}

describe('POS Price Override (ปรับราคาขายรายรายการหน้าร้าน)', () => {
  it('1. ปรับราคาสำเร็จ: บันทึก DB ถูกต้อง, ยอดบิล recalculate, และ GET /bills/:id คืนคอลัมน์ใหม่', async () => {
    const t = seed()
    const billId = await openBill(t)
    const { menuId } = createMenuItem(t.tenantId, 'ชาเย็น', 100)
    const itemId = await addItem(t, billId, menuId, 2)

    // บิลเริ่มต้น: 100 * 2 = 200
    let bill = db.prepare('SELECT subtotal, total_amount FROM pos_running_bills WHERE id = ?').get(billId) as any
    expect(bill.subtotal).toBe(200)
    expect(bill.total_amount).toBe(200)

    // แคชเชียร์ปรับราคาเป็น 80 บาท/ชิ้น
    const patchRes = await request(app)
      .patch(`/api/pos/bills/${billId}/items/${itemId}/price`)
      .set(auth(t.user.token))
      .send({ unit_price: 80, reason: 'ลูกค้าประจำ ลดราคาพิเศษ' })

    expect(patchRes.status).toBe(200)
    expect(patchRes.body).toEqual({
      success: true,
      data: {
        id: itemId,
        unit_price: 80,
        original_price: 100,
        total_price: 160,
      },
    })

    // ตรวจสอบใน DB
    const itemDb = db.prepare('SELECT * FROM pos_bill_items WHERE id = ?').get(itemId) as any
    expect(itemDb.unit_price).toBe(80)
    expect(itemDb.original_price).toBe(100)
    expect(itemDb.total_price).toBe(160)
    expect(itemDb.price_override_reason).toBe('ลูกค้าประจำ ลดราคาพิเศษ')
    expect(itemDb.price_overridden_by).toBe(t.user.email)
    expect(itemDb.price_overridden_at).toBeTruthy()

    // ยอดรวมบิลต้องอัปเดตเป็น 160
    bill = db.prepare('SELECT subtotal, total_amount FROM pos_running_bills WHERE id = ?').get(billId) as any
    expect(bill.subtotal).toBe(160)
    expect(bill.total_amount).toBe(160)

    // ตรวจสอบ GET /api/pos/bills/:id
    const getRes = await request(app)
      .get(`/api/pos/bills/${billId}`)
      .set(auth(t.user.token))
    expect(getRes.status).toBe(200)
    const returnedItem = getRes.body.data.items.find((i: any) => i.id === itemId)
    expect(returnedItem.unit_price).toBe(80)
    expect(returnedItem.original_price).toBe(100)
    expect(returnedItem.price_override_reason).toBe('ลูกค้าประจำ ลดราคาพิเศษ')
    expect(returnedItem.price_overridden_by).toBe(t.user.email)
    expect(returnedItem.price_overridden_at).toBeTruthy()
  })

  it('2. บันทึก AUTO approval timeline พร้อม severity ถูกต้อง', async () => {
    const t = seed()
    const billId = await openBill(t)
    const { menuId } = createMenuItem(t.tenantId, 'กาแฟสด', 100)
    const itemId = await addItem(t, billId, menuId, 3)

    // ลดราคาจาก 100 เป็น 75 (ลด 25% >= 20% -> severity 'high')
    const patchRes = await request(app)
      .patch(`/api/pos/bills/${billId}/items/${itemId}/price`)
      .set(auth(t.user.token))
      .send({ unit_price: 75, reason: 'เทศกาลเปิดร้าน' })
    expect(patchRes.status).toBe(200)

    const apr = db.prepare(`
      SELECT * FROM approval_requests
      WHERE tenant_id = ? AND module_type = 'pos_price_override' AND reference_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(t.tenantId, billId) as any

    expect(apr).toBeTruthy()
    expect(apr.status).toBe('AUTO')
    expect(apr.reference_type).toBe('pos_running_bills')
    expect(apr.amount).toBe(75) // |75 - 100| * 3 = 75
    expect(apr.description).toContain('กาแฟสด')
    expect(apr.description).toContain('฿100 → ฿75')
    expect(apr.description).toContain('เทศกาลเปิดร้าน')

    const payload = JSON.parse(apr.payload)
    expect(payload).toMatchObject({
      severity: 'high',
      billId,
      itemId,
      oldPrice: 100,
      newPrice: 75,
      originalPrice: 100,
      reason: 'เทศกาลเปิดร้าน',
    })
  })

  it('3. การปรับราคาเท่ากับ original_price เป็นการคืนค่าเดิม (clear override เป็น NULL)', async () => {
    const t = seed()
    const billId = await openBill(t)
    const { menuId } = createMenuItem(t.tenantId, 'โกโก้', 60)
    const itemId = await addItem(t, billId, menuId, 1)

    // ปรับลดเป็น 50
    await request(app)
      .patch(`/api/pos/bills/${billId}/items/${itemId}/price`)
      .set(auth(t.user.token))
      .send({ unit_price: 50, reason: 'ส่วนลดเพื่อน' })

    let itemDb = db.prepare('SELECT original_price FROM pos_bill_items WHERE id = ?').get(itemId) as any
    expect(itemDb.original_price).toBe(60)

    // ปรับกลับเป็น 60 (เท่ากับ original_price)
    const resetRes = await request(app)
      .patch(`/api/pos/bills/${billId}/items/${itemId}/price`)
      .set(auth(t.user.token))
      .send({ unit_price: 60, reason: 'ยกเลิกราคาพิเศษ คืนราคาเดิม' })

    expect(resetRes.status).toBe(200)
    expect(resetRes.body.data.unit_price).toBe(60)
    expect(resetRes.body.data.original_price).toBeNull()

    itemDb = db.prepare('SELECT * FROM pos_bill_items WHERE id = ?').get(itemId) as any
    expect(itemDb.unit_price).toBe(60)
    expect(itemDb.original_price).toBeNull()
    expect(itemDb.price_override_reason).toBeNull()
    expect(itemDb.price_overridden_by).toBeNull()
    expect(itemDb.price_overridden_at).toBeNull()
  })

  it('4. รายการของแถมจากการแลกแต้ม (pos_redemptions) ติดล็อก ห้ามปรับราคา (409 REWARD_ITEM_LOCKED)', async () => {
    const t = seed()
    const billId = await openBill(t)
    const { menuId } = createMenuItem(t.tenantId, 'เค้กช็อกโกแลต', 90)
    const itemId = await addItem(t, billId, menuId, 1)

    // จำลองการแลกแต้มของขวัญ
    db.prepare(`
      INSERT INTO pos_redemptions (id, tenant_id, bill_id, customer_id, reward_id, bill_item_id, points, status, created_at)
      VALUES (?, ?, ?, 'cust-1', 'rew-1', ?, 50, 'RESERVED', ?)
    `).run(generateId(), t.tenantId, billId, itemId, new Date().toISOString())

    const patchRes = await request(app)
      .patch(`/api/pos/bills/${billId}/items/${itemId}/price`)
      .set(auth(t.user.token))
      .send({ unit_price: 0, reason: 'ฟรี' })

    expect(patchRes.status).toBe(409)
    expect(patchRes.body.code).toBe('REWARD_ITEM_LOCKED')

    const itemDb = db.prepare('SELECT unit_price, original_price FROM pos_bill_items WHERE id = ?').get(itemId) as any
    expect(itemDb.unit_price).toBe(90)
    expect(itemDb.original_price).toBeNull()
  })

  it('5. บิลที่ปิดแล้ว (PAID) ปรับราคาไม่ได้ (409 BILL_NOT_OPEN)', async () => {
    const t = seed()
    const billId = await openBill(t)
    const { menuId } = createMenuItem(t.tenantId, 'น้ำส้ม', 40)
    const itemId = await addItem(t, billId, menuId, 1)

    // เปลี่ยนสถานะบิลเป็น PAID
    db.prepare("UPDATE pos_running_bills SET status = 'PAID' WHERE id = ?").run(billId)

    const patchRes = await request(app)
      .patch(`/api/pos/bills/${billId}/items/${itemId}/price`)
      .set(auth(t.user.token))
      .send({ unit_price: 30, reason: 'ขอแก้หลังปิดบิล' })

    expect(patchRes.status).toBe(409)
    expect(patchRes.body.message).toContain('บิลปิด/ยกเลิกไปแล้ว')
  })

  it('6. Validation ตรวจสอบราคาติดลบและเหตุผลว่าง', async () => {
    const t = seed()
    const billId = await openBill(t)
    const { menuId } = createMenuItem(t.tenantId, 'น้ำเปล่า', 15)
    const itemId = await addItem(t, billId, menuId, 1)

    // ราคาติดลบ
    const r1 = await request(app)
      .patch(`/api/pos/bills/${billId}/items/${itemId}/price`)
      .set(auth(t.user.token))
      .send({ unit_price: -10, reason: 'ราคาติดลบ' })
    expect(r1.status).toBe(400)

    // ไม่มีเหตุผล
    const r2 = await request(app)
      .patch(`/api/pos/bills/${billId}/items/${itemId}/price`)
      .set(auth(t.user.token))
      .send({ unit_price: 10, reason: '   ' })
    expect(r2.status).toBe(400)

    // เหตุผลยาวเกิน 200 ตัวอักษร
    const r3 = await request(app)
      .patch(`/api/pos/bills/${billId}/items/${itemId}/price`)
      .set(auth(t.user.token))
      .send({ unit_price: 10, reason: 'ก'.repeat(201) })
    expect(r3.status).toBe(400)
  })

  it('7. Merge guard: รายการที่ปรับราคาแล้ว ต้องไม่ถูกรวมจำนวนตอนกดเพิ่มเมนูเดิมซ้ำ (สร้างแถวใหม่)', async () => {
    const t = seed()
    const billId = await openBill(t)
    const { menuId } = createMenuItem(t.tenantId, 'ข้าวผัด', 60)
    const itemId1 = await addItem(t, billId, menuId, 1)

    // ปรับราคาแถวแรกเป็น 50
    await request(app)
      .patch(`/api/pos/bills/${billId}/items/${itemId1}/price`)
      .set(auth(t.user.token))
      .send({ unit_price: 50, reason: 'โปรพิเศษ' })

    // สั่งข้าวผัดเพิ่มอีก 1 จาน
    const itemId2 = await addItem(t, billId, menuId, 1)

    // ต้องได้แถวใหม่ ไม่รวมเข้า itemId1
    expect(itemId2).not.toBe(itemId1)

    const items = db.prepare('SELECT id, unit_price, original_price, quantity FROM pos_bill_items WHERE bill_id = ? ORDER BY added_at ASC').all(billId) as any[]
    expect(items.length).toBe(2)
    expect(items[0]).toMatchObject({ id: itemId1, unit_price: 50, original_price: 60, quantity: 1 })
    expect(items[1]).toMatchObject({ id: itemId2, unit_price: 60, original_price: null, quantity: 1 })

    // ถ้าสั่งเพิ่มอีกรอบ ควร merge เข้า itemId2 (แถวที่ไม่ได้ปรับราคา)
    await addItem(t, billId, menuId, 1)
    const itemsAfter = db.prepare('SELECT id, unit_price, original_price, quantity FROM pos_bill_items WHERE bill_id = ? ORDER BY added_at ASC').all(billId) as any[]
    expect(itemsAfter.length).toBe(2)
    expect(itemsAfter[1]).toMatchObject({ id: itemId2, unit_price: 60, original_price: null, quantity: 2 })
  })

  it('8. แยกแถวตอนส่งครัว (sent_to_kds split) คัดลอกคอลัมน์ price override ไปด้วย', async () => {
    const t = seed()
    const billId = await openBill(t)
    const { menuId } = createMenuItem(t.tenantId, 'สเต็กหมู', 150)
    const itemId = await addItem(t, billId, menuId, 1)

    // ปรับราคาเป็น 130
    await request(app)
      .patch(`/api/pos/bills/${billId}/items/${itemId}/price`)
      .set(auth(t.user.token))
      .send({ unit_price: 130, reason: 'ลดให้ลูกค้า' })

    // จำลองว่าส่งครัวไปแล้ว
    db.prepare('UPDATE pos_bill_items SET sent_to_kds = 1 WHERE id = ?').run(itemId)

    // กด + เพิ่มจำนวนเป็น 2 จาน ผ่าน PUT
    const putRes = await request(app)
      .put(`/api/pos/bills/${billId}/items/${itemId}`)
      .set(auth(t.user.token))
      .send({ quantity: 2 })
    expect(putRes.status).toBe(200)

    // ต้องมีแถวใหม่เพิ่มขึ้นมา 1 แถว และคัดลอก original_price, price_override_reason ไปด้วย
    const allItems = db.prepare('SELECT * FROM pos_bill_items WHERE bill_id = ? ORDER BY added_at ASC').all(billId) as any[]
    expect(allItems.length).toBe(2)
    expect(allItems[1].unit_price).toBe(130)
    expect(allItems[1].original_price).toBe(150)
    expect(allItems[1].price_override_reason).toBe('ลดให้ลูกค้า')
    expect(allItems[1].quantity).toBe(1)
  })

  it('9. ชำระเงิน: รายได้ในบัญชี (POS_SALE) คำนวณจากราคาที่ปรับ และ stock_movements บันทึกหมายเหตุปรับราคา', async () => {
    const t = seed()
    const billId = await openBill(t)
    const { menuId, productId } = createMenuItem(t.tenantId, 'พิซซ่า', 200)
    const itemId = await addItem(t, billId, menuId, 2)

    // ปรับราคาจาก 200 เป็น 180 (ยอดรวม = 360 แทนที่จะเป็น 400)
    await request(app)
      .patch(`/api/pos/bills/${billId}/items/${itemId}/price`)
      .set(auth(t.user.token))
      .send({ unit_price: 180, reason: 'โปรโมชั่นวันเกิด' })

    // จ่ายเงินสด
    const payRes = await request(app)
      .post(`/api/pos/bills/${billId}/pay`)
      .set(auth(t.user.token))
      .send({ payment_method: 'CASH', amount: 360 })
    expect(payRes.status).toBe(200)

    // ตรวจสอบ Journal Entry
    const journalId = payRes.body.data.journal_entry_id
    expect(journalId).toBeTruthy()

    const journal = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(journalId) as any
    expect(journal.description).toContain('(มีปรับราคา)')

    const lines = db.prepare(`
      SELECT jl.account_id, a.code, jl.debit, jl.credit
      FROM journal_lines jl
      JOIN accounts a ON a.id = jl.account_id
      WHERE jl.journal_entry_id = ?
    `).all(journalId) as any[]

    const clearingLine = lines.find(l => l.code === ACC.POS_CLEARING)
    const revenueLine = lines.find(l => l.code === ACC.REVENUE_PRODUCT)

    expect(clearingLine.debit).toBe(360)
    expect(revenueLine.credit).toBe(360)

    // ตรวจสอบ stock_movements บันทึก (ปรับราคา ฿200→฿180)
    const movement = db.prepare(`
      SELECT * FROM stock_movements
      WHERE stock_item_id = ? AND type = 'SALE'
      ORDER BY created_at DESC LIMIT 1
    `).get(productId) as any
    expect(movement).toBeTruthy()
    expect(movement.notes).toContain('พิซซ่า')
    expect(movement.notes).toContain('(ปรับราคา ฿200→฿180)')

    // ตรวจสอบการยกเลิกบิล (Cancel) ย้อนกลับยอดรายได้ที่ 360 บาท
    const cancelRes = await request(app)
      .post(`/api/pos/bills/${billId}/cancel`)
      .set(auth(t.admin.token))
      .send({ reason: 'ลูกค้าขอคืนเงิน' })
    expect(cancelRes.status).toBe(200)

    const cancelJournal = db.prepare(`
      SELECT * FROM journal_entries
      WHERE tenant_id = ? AND reference_type = 'POS_CANCEL' AND reference_id = ?
    `).get(t.tenantId, billId) as any
    expect(cancelJournal).toBeTruthy()

    const cancelLines = db.prepare(`
      SELECT jl.account_id, a.code, jl.debit, jl.credit
      FROM journal_lines jl
      JOIN accounts a ON a.id = jl.account_id
      WHERE jl.journal_entry_id = ?
    `).all(cancelJournal.id) as any[]

    const salesReturnLine = cancelLines.find(l => l.code === ACC.SALES_RETURN)
    expect(salesReturnLine.debit).toBe(360)

    // ตรวจสอบ stock_movements ฝั่ง RETURN
    const returnMovement = db.prepare(`
      SELECT * FROM stock_movements
      WHERE stock_item_id = ? AND type = 'RETURN'
      ORDER BY created_at DESC LIMIT 1
    `).get(productId) as any
    expect(returnMovement).toBeTruthy()
    expect(returnMovement.notes).toContain('(ปรับราคา ฿200→฿180)')
  })
})
