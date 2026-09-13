import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import workOrderRouter from './workOrder.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/work-orders', authenticate, workOrderRouter)

function seedMaterialStock(tenantId: string, quantity = 100) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
    VALUES (?, ?, ?, 'วัตถุดิบทดสอบ', 'RAW', ?, 'kg', 'kg', 'WH1', 'ACTIVE')
  `).run(id, tenantId, 'MAT-' + id.slice(0, 8), quantity)
  return id
}

function seedFinishedStock(tenantId: string, quantity = 0) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
    VALUES (?, ?, ?, 'สินค้าสำเร็จรูปทดสอบ', 'FG', ?, 'pcs', 'pcs', 'WH1', 'ACTIVE')
  `).run(id, tenantId, 'FG-' + id.slice(0, 8), quantity)
  return id
}

function seedWO(tenantId: string, opts: { bomId?: string | null } = {}) {
  const id = generateId()
  db.prepare(`
    INSERT INTO work_orders (id, tenant_id, wo_number, bom_id, product_name, quantity, status)
    VALUES (?, ?, ?, ?, 'สินค้าทดสอบ', 10, 'PLANNED')
  `).run(id, tenantId, 'WO-TEST-' + id.slice(0, 8), opts.bomId || null)
  return id
}

function seedWOMaterial(tenantId: string, woId: string, materialId: string, requiredQty = 20) {
  const id = generateId()
  db.prepare(`
    INSERT INTO work_order_materials (id, tenant_id, work_order_id, material_id, material_name, required_qty, unit, status)
    VALUES (?, ?, ?, ?, 'วัตถุดิบทดสอบ', ?, 'kg', 'PENDING')
  `).run(id, tenantId, woId, materialId, requiredQty)
  return id
}

describe('PUT /work-orders/:id/status — คืนวัตถุดิบตอนยกเลิก (B1) และกันรับสินค้าสำเร็จรูปซ้ำตอน COMPLETED (B2)', () => {
  it('IN_PROGRESS ตัดสต็อกวัตถุดิบ → CANCELLED คืนสต็อกครบ → ยิง CANCELLED ซ้ำ ของไม่งอกเพิ่ม', async () => {
    const user = createTestUser({ role: 'MASTER' })
    const materialId = seedMaterialStock(user.tenantId, 100)
    const woId = seedWO(user.tenantId)
    seedWOMaterial(user.tenantId, woId, materialId, 20)

    // เริ่มผลิต: ตัดสต็อก 20 kg
    const r1 = await request(app).put(`/api/work-orders/${woId}/status`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ status: 'IN_PROGRESS' })
    expect(r1.status).toBe(200)

    let stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(materialId) as any
    expect(stock.quantity).toBe(80) // 100 - 20

    // ยกเลิก: ต้องคืน 20 kg กลับมาเป็น 100
    const r2 = await request(app).put(`/api/work-orders/${woId}/status`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ status: 'CANCELLED' })
    expect(r2.status).toBe(200)

    stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(materialId) as any
    expect(stock.quantity).toBe(100)

    const restockMovements = db.prepare(
      "SELECT * FROM stock_movements WHERE tenant_id = ? AND stock_item_id = ? AND type = 'IN' AND reference = ?"
    ).all(user.tenantId, materialId, `WO-CANCEL: ${db.prepare('SELECT wo_number FROM work_orders WHERE id = ?').get(woId).wo_number}`) as any[]
    expect(restockMovements.length).toBe(1)

    // ยิงยกเลิกซ้ำ: ของต้องไม่งอกเพิ่ม (ยังคง 100 ไม่ใช่ 120)
    const r3 = await request(app).put(`/api/work-orders/${woId}/status`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ status: 'CANCELLED' })
    expect(r3.status).toBe(200)

    stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(materialId) as any
    expect(stock.quantity).toBe(100)

    const materialRow = db.prepare('SELECT issued_qty, status FROM work_order_materials WHERE work_order_id = ?').get(woId) as any
    expect(materialRow.issued_qty).toBe(0)
    expect(materialRow.status).toBe('PENDING')
  })

  it('COMPLETED สองครั้ง → สินค้าสำเร็จรูปเข้าสต็อกครั้งเดียว', async () => {
    const user = createTestUser({ role: 'MASTER' })
    const finishedId = seedFinishedStock(user.tenantId, 0)

    const bomId = generateId()
    db.prepare(`
      INSERT INTO boms (id, tenant_id, product_id, version, status)
      VALUES (?, ?, ?, 'v1', 'ACTIVE')
    `).run(bomId, user.tenantId, finishedId)

    const woId = seedWO(user.tenantId, { bomId })
    // ข้ามตรง IN_PROGRESS ไปเลย ไม่มีวัตถุดิบผูกไว้ (ไม่กระทบผลของเทสต์นี้)

    const r1 = await request(app).put(`/api/work-orders/${woId}/status`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ status: 'COMPLETED' })
    expect(r1.status).toBe(200)

    let stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(finishedId) as any
    expect(stock.quantity).toBe(10) // wo.quantity

    // ยิง COMPLETED ซ้ำ (สถานะเดิมอยู่แล้ว) — ต้องไม่บวกซ้ำ
    const r2 = await request(app).put(`/api/work-orders/${woId}/status`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ status: 'COMPLETED' })
    expect(r2.status).toBe(200)

    stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(finishedId) as any
    expect(stock.quantity).toBe(10) // ยังคง 10 ไม่ใช่ 20

    const inMovements = db.prepare(
      "SELECT COUNT(*) as c FROM stock_movements WHERE tenant_id = ? AND stock_item_id = ? AND type = 'IN' AND notes = 'Finished goods from production'"
    ).get(user.tenantId, finishedId) as any
    expect(inMovements.c).toBe(1)
  })
})
