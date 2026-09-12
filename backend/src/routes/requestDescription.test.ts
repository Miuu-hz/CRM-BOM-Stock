import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import stockRouter from './stock.routes'
import posBillRouter from './pos-bill.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/stock', stockRouter)
app.use('/api/pos', posBillRouter)

function openCategory(tenantId: string, category: string) {
  db.prepare(`
    INSERT INTO approval_settings (id, tenant_id, role, module_type, approval_required, auto_approve_threshold)
    VALUES (?, ?, 'USER', ?, 1, 0)
    ON CONFLICT(tenant_id, role, module_type) DO UPDATE SET approval_required = 1
  `).run(generateId(), tenantId, category)
}

function seedItem(tenantId: string, name: string, qty: number) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status, unit_cost, min_stock)
    VALUES (?, ?, ?, ?, 'RAW', ?, 'ชิ้น', 'ชิ้น', 'WH1', 'ACTIVE', 10, 5)
  `).run(id, tenantId, id, name, qty)
  return id
}

const descOf = (refId: string) =>
  (db.prepare("SELECT description FROM approval_requests WHERE reference_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(refId) as any)?.description

/**
 * เจ้าของอ่านลิสต์แจ้งเตือนแล้วต้องเข้าใจได้ในบรรทัดเดียวว่าเกิดอะไรขึ้น
 * โดยไม่ต้องกดเข้าไปดูรายละเอียด
 */
describe('ข้อความในลิสต์แจ้งเตือน', () => {
  it('ปรับสต๊อก — บอกชื่อของ จากเท่าไหร่เป็นเท่าไหร่ และเหตุผล', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openCategory(admin.tenantId, 'stock_adjust')
    const itemId = seedItem(admin.tenantId, 'ผ้าสปันบอนด์', 20)

    await request(app).post('/api/stock/movement')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ stockItemId: itemId, type: 'ADJUST', quantity: 40, unit: 'ชิ้น', notes: 'นับสต๊อกประจำเดือน' })

    expect(descOf(itemId)).toBe('สินค้า ผ้าสปันบอนด์ ถูกปรับ 20 เป็น 40 ชิ้น เนื่องจาก นับสต๊อกประจำเดือน')
  })

  it('รับเข้า — บอกจำนวนที่รับ พร้อมยอดก่อน→หลัง', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openCategory(admin.tenantId, 'stock_adjust')
    const itemId = seedItem(admin.tenantId, 'ใยสังเคราะห์', 100)

    await request(app).post('/api/stock/movement')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ stockItemId: itemId, type: 'IN', quantity: 25, unit: 'ชิ้น', notes: 'รับของจากซัพ' })

    expect(descOf(itemId)).toBe('สินค้า ใยสังเคราะห์ รับเข้า 25 ชิ้น (100 → 125) เนื่องจาก รับของจากซัพ')
  })

  it('ตัดออก — ยอดหลังต้องลดลง', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openCategory(admin.tenantId, 'stock_adjust')
    const itemId = seedItem(admin.tenantId, 'ซิป', 60)

    await request(app).post('/api/stock/movement')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ stockItemId: itemId, type: 'OUT', quantity: 10, unit: 'ชิ้น' })

    expect(descOf(itemId)).toBe('สินค้า ซิป ตัดออก 10 ชิ้น (60 → 50)')
  })

  it('ไม่ใส่เหตุผล — ต้องไม่มีคำว่า "เนื่องจาก" ห้อยท้ายลอย ๆ', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openCategory(admin.tenantId, 'stock_adjust')
    const itemId = seedItem(admin.tenantId, 'กระดุม', 5)

    await request(app).post('/api/stock/movement')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ stockItemId: itemId, type: 'ADJUST', quantity: 8, unit: 'ชิ้น' })

    expect(descOf(itemId)).toBe('สินค้า กระดุม ถูกปรับ 5 เป็น 8 ชิ้น')
  })

  it('ยกเลิกบิล POS — บอกเลขบิล ยอด และเหตุผล', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openCategory(admin.tenantId, 'pos_void')
    const billId = generateId()
    db.prepare(`
      INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, total_amount, subtotal, opened_at, created_by)
      VALUES (?, ?, 'POS-0042', 'โต๊ะ 3', 'PAID', 1250, 1250, ?, 'tester')
    `).run(billId, admin.tenantId, new Date().toISOString())

    await request(app).post(`/api/pos/bills/${billId}/cancel`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ reason: 'ลูกค้าเปลี่ยนใจ' })

    expect(descOf(billId)).toBe('บิล POS-0042 ยอด ฿1,250 ขอยกเลิก เนื่องจาก ลูกค้าเปลี่ยนใจ')
  })

  it('ชื่อผู้ทำถูกเก็บแยกเป็นคอลัมน์ ไม่ยัดซ้ำในข้อความ', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openCategory(admin.tenantId, 'stock_adjust')
    const itemId = seedItem(admin.tenantId, 'ด้าย', 12)

    await request(app).post('/api/stock/movement')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ stockItemId: itemId, type: 'ADJUST', quantity: 30, unit: 'ชิ้น' })

    const row = db.prepare("SELECT description, requester_name FROM approval_requests WHERE reference_id = ?")
      .get(itemId) as any
    expect(row.requester_name).toBe(user.email)
    expect(row.description).not.toContain(user.email)
  })
})
