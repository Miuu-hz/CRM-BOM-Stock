import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import workOrderRouter from './workOrder.routes'
import { createTestUser } from '../test/testAuth'

/**
 * เทสต์ใหม่สำหรับ fix ชุด 2026-10-05 ของ Work Order (REST):
 *   1) PLANNED→IN_PROGRESS เบิกวัตถุดิบครั้งเดียว / IN_PROGRESS→ON_HOLD→IN_PROGRESS ไม่เบิกซ้ำ
 *   2) role ที่ไม่มีสิทธิ์ (USER) โดน 403 ตอน CANCELLED/COMPLETED, ADMIN/MANAGER ทำได้
 *   3) COMPLETED ถูกบล็อกเมื่อ tenant เปิด qc_gate_enabled แล้วยังไม่มี PASS inspection
 *   4) completed_qty / สต็อกสินค้าสำเร็จรูปที่เข้า = min(requested, SUM(passed_qty))
 *   5) POST /work-orders ปฏิเสธ quantity ที่ไม่ถูกต้อง (0, -1, 'abc')
 *
 * ไฟล์นี้ไม่แก้ไข workOrder.routes.test.ts เดิม — สร้างไฟล์ใหม่ตามคำสั่ง (มี session อื่น
 * แก้ไฟล์เดิม + routes.ts มีฟีเจอร์ MASTER cross-tenant จาก session อื่นปนอยู่ด้วย)
 */

const app = express()
app.use(express.json())
app.use('/api/work-orders', authenticate, workOrderRouter)

function seedMaterialStock(tenantId: string, quantity = 100) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
    VALUES (?, ?, ?, 'วัตถุดิบทดสอบ fixes1005', 'RAW', ?, 'kg', 'kg', 'WH1', 'ACTIVE')
  `).run(id, tenantId, 'MAT-F1005-' + id.slice(0, 8), quantity)
  return id
}

function seedFinishedStock(tenantId: string, quantity = 0) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
    VALUES (?, ?, ?, 'สินค้าสำเร็จรูปทดสอบ fixes1005', 'FG', ?, 'pcs', 'pcs', 'WH1', 'ACTIVE')
  `).run(id, tenantId, 'FG-F1005-' + id.slice(0, 8), quantity)
  return id
}

function seedBom(tenantId: string, productId: string) {
  const id = generateId()
  db.prepare(`
    INSERT INTO boms (id, tenant_id, product_id, version, status)
    VALUES (?, ?, ?, 'v1', 'ACTIVE')
  `).run(id, tenantId, productId)
  return id
}

function seedWO(tenantId: string, opts: { bomId?: string | null; status?: string; quantity?: number; completedQty?: number; unit?: string } = {}) {
  const id = generateId()
  db.prepare(`
    INSERT INTO work_orders (id, tenant_id, wo_number, bom_id, product_name, quantity, status, completed_qty, unit)
    VALUES (?, ?, ?, ?, 'สินค้าทดสอบ fixes1005', ?, ?, ?, ?)
  `).run(id, tenantId, 'WO-F1005-' + id.slice(0, 8), opts.bomId || null, opts.quantity ?? 10, opts.status || 'PLANNED', opts.completedQty ?? 0, opts.unit || null)
  return id
}

function seedWOMaterial(tenantId: string, woId: string, materialId: string, requiredQty = 20) {
  const id = generateId()
  db.prepare(`
    INSERT INTO work_order_materials (id, tenant_id, work_order_id, material_id, material_name, required_qty, unit, status)
    VALUES (?, ?, ?, ?, 'วัตถุดิบทดสอบ fixes1005', ?, 'kg', 'PENDING')
  `).run(id, tenantId, woId, materialId, requiredQty)
  return id
}

function setQcGate(tenantId: string, enabled: boolean) {
  db.prepare('INSERT INTO company_settings (tenant_id, name, qc_gate_enabled) VALUES (?, ?, ?)')
    .run(tenantId, 'tenant-f1005', enabled ? 1 : 0)
}

function seedQcInspection(tenantId: string, woId: string, status: 'PASS' | 'FAIL', passedQty: number) {
  const id = generateId()
  db.prepare(`
    INSERT INTO qc_inspections (id, tenant_id, checklist_id, checklist_name, work_order_id, status, passed_qty)
    VALUES (?, ?, 'chk-f1005', 'Checklist fixes1005', ?, ?, ?)
  `).run(id, tenantId, woId, status, passedQty)
  return id
}

const tenants: string[] = []
function trackTenant(t: string) { tenants.push(t); return t }

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM qc_inspections WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_movements WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM work_order_materials WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM work_orders WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM boms WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM company_settings WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM users WHERE tenant_id = ?').run(t)
  }
})

describe('fixes1005 REST — PLANNED→IN_PROGRESS เบิกครั้งเดียว, ON_HOLD round-trip ไม่เบิกซ้ำ', () => {
  it('resume จาก ON_HOLD กลับไป IN_PROGRESS ต้องไม่หักสต็อก/ไม่สร้าง OUT ซ้ำ', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    trackTenant(user.tenantId)
    const materialId = seedMaterialStock(user.tenantId, 100)
    const woId = seedWO(user.tenantId, { quantity: 10 })
    seedWOMaterial(user.tenantId, woId, materialId, 20)

    const r1 = await request(app).put(`/api/work-orders/${woId}/status`)
      .set('Authorization', `Bearer ${user.token}`).send({ status: 'IN_PROGRESS' })
    expect(r1.status).toBe(200)

    let stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(materialId) as any
    expect(stock.quantity).toBe(80) // 100 - 20

    const r2 = await request(app).put(`/api/work-orders/${woId}/status`)
      .set('Authorization', `Bearer ${user.token}`).send({ status: 'ON_HOLD' })
    expect(r2.status).toBe(200)

    const r3 = await request(app).put(`/api/work-orders/${woId}/status`)
      .set('Authorization', `Bearer ${user.token}`).send({ status: 'IN_PROGRESS' })
    expect(r3.status).toBe(200)

    stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(materialId) as any
    expect(stock.quantity).toBe(80) // ต้องไม่หักซ้ำ ยังคง 80 ไม่ใช่ 60

    const outCount = db.prepare(
      "SELECT COUNT(*) as c FROM stock_movements WHERE tenant_id = ? AND stock_item_id = ? AND type = 'OUT'"
    ).get(user.tenantId, materialId) as any
    expect(outCount.c).toBe(1)
  })
})

describe('fixes1005 REST — RBAC: USER ไม่มีสิทธิ์ CANCELLED/COMPLETED, ADMIN/MANAGER ทำได้', () => {
  it('USER โดน 403 ตอน CANCELLED และสถานะไม่เปลี่ยน', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const staff = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const woId = seedWO(admin.tenantId, { status: 'PLANNED' })

    const res = await request(app).put(`/api/work-orders/${woId}/status`)
      .set('Authorization', `Bearer ${staff.token}`).send({ status: 'CANCELLED' })
    expect(res.status).toBe(403)

    const wo = db.prepare('SELECT status FROM work_orders WHERE id = ?').get(woId) as any
    expect(wo.status).toBe('PLANNED')
  })

  it('USER โดน 403 ตอน COMPLETED', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const staff = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const woId = seedWO(admin.tenantId, { status: 'IN_PROGRESS' })

    const res = await request(app).put(`/api/work-orders/${woId}/status`)
      .set('Authorization', `Bearer ${staff.token}`).send({ status: 'COMPLETED' })
    expect(res.status).toBe(403)

    const wo = db.prepare('SELECT status FROM work_orders WHERE id = ?').get(woId) as any
    expect(wo.status).toBe('IN_PROGRESS')
  })

  it('MANAGER ยกเลิกใบสั่งผลิตได้ปกติ (ไม่ติด 403)', async () => {
    const manager = createTestUser({ role: 'MANAGER' })
    trackTenant(manager.tenantId)
    const woId = seedWO(manager.tenantId, { status: 'PLANNED' })

    const res = await request(app).put(`/api/work-orders/${woId}/status`)
      .set('Authorization', `Bearer ${manager.token}`).send({ status: 'CANCELLED' })
    expect(res.status).toBe(200)
  })
})

describe('fixes1005 REST — QC gate บล็อก COMPLETED เมื่อยังไม่มี PASS inspection', () => {
  it('ปิดงานไม่ได้ (400) จนกว่าจะมี PASS inspection, ของสำเร็จรูปไม่เข้าสต็อกจนกว่าจะผ่าน', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    setQcGate(admin.tenantId, true)

    const finishedId = seedFinishedStock(admin.tenantId, 0)
    const bomId = seedBom(admin.tenantId, finishedId)
    const woId = seedWO(admin.tenantId, { bomId, quantity: 10, status: 'IN_PROGRESS' })

    const r1 = await request(app).put(`/api/work-orders/${woId}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'COMPLETED' })
    expect(r1.status).toBe(400)
    expect(r1.body.message).toContain('QC')

    let stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(finishedId) as any
    expect(stock.quantity).toBe(0)

    seedQcInspection(admin.tenantId, woId, 'PASS', 10)

    const r2 = await request(app).put(`/api/work-orders/${woId}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'COMPLETED' })
    expect(r2.status).toBe(200)

    stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(finishedId) as any
    expect(stock.quantity).toBe(10)
  })
})

describe('fixes1005 REST — completed_qty/สต็อกสินค้าสำเร็จรูป = min(requested, SUM(passed_qty))', () => {
  it('QC รวมน้อยกว่าที่สั่ง → ปิดงานได้แค่ยอด QC จริง', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const finishedId = seedFinishedStock(admin.tenantId, 0)
    const bomId = seedBom(admin.tenantId, finishedId)
    const woId = seedWO(admin.tenantId, { bomId, quantity: 10, status: 'IN_PROGRESS' })

    seedQcInspection(admin.tenantId, woId, 'PASS', 4)
    seedQcInspection(admin.tenantId, woId, 'PASS', 3)

    const res = await request(app).put(`/api/work-orders/${woId}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'COMPLETED' })
    expect(res.status).toBe(200)
    expect(res.body.data.completed_qty).toBe(7)

    const stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(finishedId) as any
    expect(stock.quantity).toBe(7)
  })

  it('QC รวมเกินที่สั่ง → ครอบไว้ที่ requestedQty', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const finishedId = seedFinishedStock(admin.tenantId, 0)
    const bomId = seedBom(admin.tenantId, finishedId)
    const woId = seedWO(admin.tenantId, { bomId, quantity: 10, status: 'IN_PROGRESS' })

    seedQcInspection(admin.tenantId, woId, 'PASS', 8)
    seedQcInspection(admin.tenantId, woId, 'PASS', 8)

    const res = await request(app).put(`/api/work-orders/${woId}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'COMPLETED' })
    expect(res.status).toBe(200)
    expect(res.body.data.completed_qty).toBe(10)

    const stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(finishedId) as any
    expect(stock.quantity).toBe(10)
  })
})

describe('fixes1005 REST — POST /work-orders ปฏิเสธ quantity ที่ไม่ถูกต้อง', () => {
  it('quantity = 0 → 400', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const res = await request(app).post('/api/work-orders')
      .set('Authorization', `Bearer ${admin.token}`).send({ productName: 'ทดสอบ fixes1005', quantity: 0 })
    expect(res.status).toBe(400)
  })

  it('quantity = -1 → 400', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const res = await request(app).post('/api/work-orders')
      .set('Authorization', `Bearer ${admin.token}`).send({ productName: 'ทดสอบ fixes1005', quantity: -1 })
    expect(res.status).toBe(400)
  })

  it("quantity = 'abc' → 400", async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const res = await request(app).post('/api/work-orders')
      .set('Authorization', `Bearer ${admin.token}`).send({ productName: 'ทดสอบ fixes1005', quantity: 'abc' })
    expect(res.status).toBe(400)
  })
})
