import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import stockRouter from './stock.routes'
import approvalRouter from './approval.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/stock', stockRouter)
app.use('/api/approval', approvalRouter)

function seedStockItem(tenantId: string, quantity: number) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status, unit_cost, min_stock)
    VALUES (?, ?, ?, 'สินค้าทดสอบ', 'RAW', ?, 'ชิ้น', 'ชิ้น', 'WH1', 'ACTIVE', 10, 5)
  `).run(id, tenantId, id, quantity)
  return id
}

function openStockApproval(tenantId: string, role = 'USER') {
  db.prepare(`
    INSERT INTO approval_settings (id, tenant_id, role, module_type, approval_required, auto_approve_threshold)
    VALUES (?, ?, ?, 'stock_adjust', 1, 0)
    ON CONFLICT(tenant_id, role, module_type) DO UPDATE SET approval_required = 1
  `).run(generateId(), tenantId, role)
}

const qtyOf = (id: string) =>
  (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(id) as any).quantity

function seedPackedStockItem(tenantId: string, opts: { quantity?: number; sealedQty?: number; packFactor?: number } = {}) {
  const { quantity = 0, sealedQty = 2, packFactor = 12 } = opts
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, sealed_qty, unit, base_unit, display_unit, location, status, unit_cost, min_stock)
    VALUES (?, ?, ?, 'สินค้าแพ็ค', 'RAW', ?, ?, 'ชิ้น', 'ชิ้น', 'แพ็ค', 'WH1', 'ACTIVE', 10, 5)
  `).run(id, tenantId, id, quantity, sealedQty)
  db.prepare(`
    INSERT INTO unit_conversions (id, tenant_id, material_id, from_unit, to_unit, conversion_factor)
    VALUES (?, ?, ?, 'pack', 'pcs', ?)
  `).run(generateId(), tenantId, id, packFactor)
  return id
}

const sealedOf = (id: string) =>
  (db.prepare('SELECT sealed_qty FROM stock_items WHERE id = ?').get(id) as any).sealed_qty

describe('หมวดปรับสต็อก — ต้องผ่านการอนุมัติก่อน', () => {
  it('พนักงานกดปรับสต๊อก → สต๊อกยังไม่ขยับ และมีคำขอเข้า inbox ของเจ้าของ', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openStockApproval(admin.tenantId)
    const itemId = seedStockItem(admin.tenantId, 100)

    const res = await request(app).post('/api/stock/movement')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ stockItemId: itemId, type: 'ADJUST', quantity: 7, unit: 'ชิ้น' })

    expect(res.status).toBe(202)
    expect(res.body.pending_approval).toBe(true)
    expect(res.body.message).toContain('ส่งคำขออนุมัติแล้ว')
    expect(qtyOf(itemId)).toBe(100)          // ของยังไม่ขยับ

    const moves = db.prepare('SELECT COUNT(*) c FROM stock_movements WHERE stock_item_id = ?').get(itemId) as any
    expect(moves.c).toBe(0)                   // ยังไม่มีรายการเคลื่อนไหว

    const inbox = await request(app).get('/api/approval/pending')
      .set('Authorization', `Bearer ${admin.token}`)
    expect(inbox.body.data.some((r: any) => r.reference_id === itemId)).toBe(true)
  })

  it('เจ้าของกดอนุมัติ → สต๊อกเปลี่ยนจริงตามที่ขอ', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openStockApproval(admin.tenantId)
    const itemId = seedStockItem(admin.tenantId, 100)

    await request(app).post('/api/stock/movement')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ stockItemId: itemId, type: 'ADJUST', quantity: 7, unit: 'ชิ้น' })

    const pending = db.prepare(
      "SELECT id FROM approval_requests WHERE reference_id = ? AND status = 'PENDING'"
    ).get(itemId) as any

    const res = await request(app).put(`/api/approval/requests/${pending.id}/decision`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'APPROVED', level: 1 })

    expect(res.status).toBe(200)
    expect(qtyOf(itemId)).toBe(7)             // ปรับเป็น 7 แล้วจริง
    const moves = db.prepare("SELECT type, created_by FROM stock_movements WHERE stock_item_id = ?").all(itemId) as any[]
    expect(moves).toHaveLength(1)
    expect(moves[0].type).toBe('ADJUST')
    expect(moves[0].created_by).toBe(user.email)   // เครดิตคนขอ ไม่ใช่คนอนุมัติ
  })

  it('ปฏิเสธ → สต๊อกไม่ขยับ', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openStockApproval(admin.tenantId)
    const itemId = seedStockItem(admin.tenantId, 100)

    await request(app).post('/api/stock/movement')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ stockItemId: itemId, type: 'OUT', quantity: 3, unit: 'ชิ้น' })

    const pending = db.prepare(
      "SELECT id FROM approval_requests WHERE reference_id = ? AND status = 'PENDING'"
    ).get(itemId) as any
    await request(app).put(`/api/approval/requests/${pending.id}/decision`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'REJECTED', comment: 'ไม่อนุมัติ', level: 1 })

    expect(qtyOf(itemId)).toBe(100)
  })

  it('ADMIN กดเอง → ทำทันที ไม่ต้องขออนุมัติตัวเอง', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    openStockApproval(admin.tenantId, 'ADMIN')
    const itemId = seedStockItem(admin.tenantId, 100)

    const res = await request(app).post('/api/stock/movement')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ stockItemId: itemId, type: 'IN', quantity: 5, unit: 'ชิ้น' })

    expect(res.status).toBe(200)
    expect(qtyOf(itemId)).toBe(105)
  })

  it('หมวดปิดอยู่ → พนักงานทำได้ตามปกติ (พฤติกรรมเดิมไม่เปลี่ยน)', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const itemId = seedStockItem(admin.tenantId, 100)   // ไม่เปิดหมวด

    const res = await request(app).post('/api/stock/movement')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ stockItemId: itemId, type: 'IN', quantity: 5, unit: 'ชิ้น' })

    expect(res.status).toBe(200)
    expect(qtyOf(itemId)).toBe(105)
  })

  it('ตัดออกเกินของที่มี → ยังฟ้องเหมือนเดิม ไม่กลายเป็น 500', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const itemId = seedStockItem(admin.tenantId, 2)

    const res = await request(app).post('/api/stock/movement')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ stockItemId: itemId, type: 'OUT', quantity: 50, unit: 'ชิ้น' })

    expect(res.status).toBe(400)
    expect(qtyOf(itemId)).toBe(2)
  })

  it('พนักงานมีสิทธิ์ bypass → ปรับสต๊อกได้ทันทีแม้หมวดเปิดอนุมัติไว้ และมีแถว AUTO ในประวัติ', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openStockApproval(admin.tenantId)
    db.prepare(`
      INSERT INTO user_approval_permissions (id, tenant_id, user_id, module_type, can_bypass)
      VALUES (?, ?, ?, 'stock_adjust', 1)
    `).run(generateId(), admin.tenantId, user.userId)
    const itemId = seedStockItem(admin.tenantId, 100)

    const res = await request(app).post('/api/stock/movement')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ stockItemId: itemId, type: 'IN', quantity: 5, unit: 'ชิ้น' })

    expect(res.status).toBe(200)          // ไม่ถูกบล็อกเหมือนพนักงานทั่วไป
    expect(qtyOf(itemId)).toBe(105)       // ของขยับจริงทันที

    const auto = db.prepare(
      "SELECT * FROM approval_requests WHERE reference_id = ? AND status = 'AUTO'"
    ).get(itemId) as any
    expect(auto).toBeTruthy()             // แต่ยังมีร่องรอยในประวัติให้เจ้าของเห็น
    expect(auto.requester_id).toBe(user.userId)
  })
})

describe('หมวดแกะแพ็ค — ต้องผ่านการอนุมัติก่อนเหมือนปรับสต๊อก', () => {
  it('เปิดหมวดแล้ว USER กดแกะแพ็ค → สต๊อกยังไม่ขยับ และมีคำขอเข้า inbox', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openStockApproval(admin.tenantId)
    const itemId = seedPackedStockItem(admin.tenantId, { quantity: 0, sealedQty: 5, packFactor: 12 })

    const res = await request(app).post(`/api/stock/${itemId}/unpack`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ packs: 2 })

    expect(res.status).toBe(202)
    expect(res.body.pending_approval).toBe(true)
    expect(qtyOf(itemId)).toBe(0)              // ของยังไม่ขยับ
    expect(sealedOf(itemId)).toBe(5)            // แพ็คยังไม่ถูกแกะ

    const moves = db.prepare('SELECT COUNT(*) c FROM stock_movements WHERE stock_item_id = ?').get(itemId) as any
    expect(moves.c).toBe(0)

    const inbox = await request(app).get('/api/approval/pending')
      .set('Authorization', `Bearer ${admin.token}`)
    expect(inbox.body.data.some((r: any) => r.reference_id === itemId)).toBe(true)
  })

  it('ADMIN กดแกะเอง → ทำทันที ไม่ต้องขออนุมัติ', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    openStockApproval(admin.tenantId, 'ADMIN')
    const itemId = seedPackedStockItem(admin.tenantId, { quantity: 0, sealedQty: 5, packFactor: 12 })

    const res = await request(app).post(`/api/stock/${itemId}/unpack`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ packs: 2 })

    expect(res.status).toBe(200)
    expect(qtyOf(itemId)).toBe(24)
    expect(sealedOf(itemId)).toBe(3)
  })

  it('เจ้าของกดอนุมัติ → สต๊อกแกะแพ็คจริงตามที่ขอ', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openStockApproval(admin.tenantId)
    const itemId = seedPackedStockItem(admin.tenantId, { quantity: 0, sealedQty: 5, packFactor: 12 })

    await request(app).post(`/api/stock/${itemId}/unpack`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ packs: 2 })

    const pending = db.prepare(
      "SELECT id FROM approval_requests WHERE reference_id = ? AND status = 'PENDING'"
    ).get(itemId) as any

    const res = await request(app).put(`/api/approval/requests/${pending.id}/decision`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'APPROVED', level: 1 })

    expect(res.status).toBe(200)
    expect(qtyOf(itemId)).toBe(24)              // 2 แพ็ค x 12 = 24 ชิ้น
    expect(sealedOf(itemId)).toBe(3)             // เหลือ 5 - 2 = 3 แพ็ค

    const moves = db.prepare("SELECT type, created_by FROM stock_movements WHERE stock_item_id = ?").all(itemId) as any[]
    expect(moves).toHaveLength(1)
    expect(moves[0].type).toBe('UNPACK')
    expect(moves[0].created_by).toBe(user.email)   // เครดิตคนขอ ไม่ใช่คนอนุมัติ
  })
})
