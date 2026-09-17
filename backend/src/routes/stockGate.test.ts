import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import stockRouter from './stock.routes'
import { createTestUser } from '../test/testAuth'

/**
 * ประตูอนุมัติของการปรับสต็อกเคยเทียบวงเงินกับเลข 0 เสมอ
 * เพราะ gateArgs ไม่เคยส่ง amount ไปเลย — ตั้งวงเงินไว้เท่าไรการปรับสต็อกก็ผ่านหมด
 * เทสต์นี้กันไม่ให้เงียบแบบนั้นอีก: มูลค่าเกินวงเงินต้องเด้งเป็นคำขออนุมัติ
 */
const app = express()
app.use(express.json())
app.use('/api/stock', stockRouter)

function seedItem(tenantId: string, qty: number, unitCost: number) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, 'ของทดสอบประตูอนุมัติ', 'raw', ?, 'ชิ้น', 'ชิ้น', ?, 'STOCK', 'ACTIVE')
  `).run(id, tenantId, 'SKU-' + id.slice(0, 8), qty, unitCost)
  return id
}

function setGate(tenantId: string, threshold: number) {
  db.prepare(`
    INSERT INTO approval_settings (id, tenant_id, module_type, role, approval_required, auto_approve_threshold, created_at, updated_at)
    VALUES (?, ?, 'stock_adjust', 'USER', 1, ?, datetime('now'), datetime('now'))
  `).run(generateId(), tenantId, threshold)
}

describe('ปรับสต็อก — วงเงินในประตูอนุมัติ', () => {
  it('มูลค่าส่วนต่างเกินวงเงิน ต้องกลายเป็นคำขออนุมัติ ของยังไม่ขยับ', async () => {
    const user = createTestUser({ role: 'USER' })
    setGate(user.tenantId, 1000)
    const itemId = seedItem(user.tenantId, 100, 20)   // ปรับเหลือ 0 = ฿2,000

    const res = await request(app)
      .post('/api/stock/movement')
      .set('Authorization', 'Bearer ' + user.token)
      .send({ stockItemId: itemId, type: 'ADJUST', quantity: 0, adjustReason: 'ของหาย' })

    expect(res.status).toBe(202)
    expect(res.body.pending_approval).toBe(true)
    const after = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(itemId) as any
    expect(after.quantity).toBe(100)
  })

  it('มูลค่าต่ำกว่าวงเงิน ผ่านได้เลย และต้องมีแถวในทะเบียน', async () => {
    const user = createTestUser({ role: 'USER' })
    setGate(user.tenantId, 1000)
    const itemId = seedItem(user.tenantId, 100, 1)    // ปรับเหลือ 95 = ฿5

    const res = await request(app)
      .post('/api/stock/movement')
      .set('Authorization', 'Bearer ' + user.token)
      .send({ stockItemId: itemId, type: 'ADJUST', quantity: 95, adjustReason: 'นับผิดรอบก่อน' })

    expect(res.status).toBe(200)
    const after = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(itemId) as any
    expect(after.quantity).toBe(95)

    const reg = db.prepare('SELECT * FROM stock_adjustments WHERE stock_item_id = ?').get(itemId) as any
    expect(reg).toBeTruthy()
    expect(reg.reason).toBe('นับผิดรอบก่อน')
    expect(reg.total_value).toBeCloseTo(5, 2)
  })
})

describe('ทะเบียนการปรับสต็อก — GET /stock/adjustments', () => {
  it('คืนเฉพาะของเทแนนต์ตัวเอง พร้อมชื่อสินค้าและยอดรวมแยกขึ้น/ลง', async () => {
    const mine = createTestUser({ role: 'ADMIN' })
    const other = createTestUser({ role: 'ADMIN' })

    const a = seedItem(mine.tenantId, 100, 10)        // ปรับลด 10 ชิ้น = ฿100
    const b = seedItem(mine.tenantId, 100, 10)        // ปรับเพิ่ม 5 ชิ้น = ฿50
    const theirs = seedItem(other.tenantId, 100, 10)

    const post = (u: typeof mine, itemId: string, qty: number, reason: string) =>
      request(app).post('/api/stock/movement').set('Authorization', 'Bearer ' + u.token)
        .send({ stockItemId: itemId, type: 'ADJUST', quantity: qty, adjustReason: reason })

    await post(mine, a, 90, 'ของเสีย/หมดอายุ')
    await post(mine, b, 105, 'รับเพิ่มไม่ผ่านใบ')
    await post(other, theirs, 50, 'ของหาย')

    const res = await request(app)
      .get('/api/stock/adjustments')
      .set('Authorization', 'Bearer ' + mine.token)

    expect(res.status).toBe(200)
    const rows = res.body.data as any[]
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.item_name === 'ของทดสอบประตูอนุมัติ')).toBe(true)
    expect(rows.some((r) => r.stock_item_id === theirs)).toBe(false)
    expect(res.body.summary.totalDown).toBeCloseTo(100, 2)
    expect(res.body.summary.totalUp).toBeCloseTo(50, 2)
  })
})
