import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import materialsRouter from './materials.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/materials', authenticate, materialsRouter)

function mkCategory(tenantId: string | null) {
  const id = generateId()
  db.prepare(`INSERT INTO material_categories (id, tenant_id, code, name, default_unit) VALUES (?, ?, ?, 'หมวดทดสอบ', 'kg')`)
    .run(id, tenantId, 'C-' + id.slice(0, 8))
  return id
}

describe('วัตถุดิบ — รหัสซ้ำ', () => {
  it('สร้างด้วยรหัสซ้ำ → 409 SKU_DUPLICATE พร้อมชื่อของที่ใช้รหัสอยู่ (เดิม 400 ภาษาอังกฤษ)', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const auth = `Bearer ${u.token}`
    const categoryId = mkCategory(u.tenantId)
    const first = await request(app).post('/api/materials').set('Authorization', auth)
      .send({ code: 'RM-001', name: 'แป้งสาลี', categoryId, unitCost: 10 })
    expect(first.status).toBe(200)

    const again = await request(app).post('/api/materials').set('Authorization', auth)
      .send({ code: 'RM-001', name: 'แป้งข้าวเจ้า', categoryId, unitCost: 10 })
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('SKU_DUPLICATE')
    expect(again.body.message).toContain('แป้งสาลี')
  })

  it('แก้รหัสไปชนของอื่น → 409 · บันทึกรหัสเดิมของตัวเองได้', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const auth = `Bearer ${u.token}`
    const categoryId = mkCategory(u.tenantId)
    const a = await request(app).post('/api/materials').set('Authorization', auth).send({ code: 'RM-A', name: 'เกลือ', categoryId, unitCost: 1 })
    await request(app).post('/api/materials').set('Authorization', auth).send({ code: 'RM-B', name: 'น้ำตาล', categoryId, unitCost: 1 })

    const clash = await request(app).put(`/api/materials/${a.body.data.id}`).set('Authorization', auth).send({ code: 'RM-B' })
    expect(clash.status).toBe(409)
    expect(clash.body.code).toBe('SKU_DUPLICATE')
    const same = await request(app).put(`/api/materials/${a.body.data.id}`).set('Authorization', auth).send({ code: 'RM-A', name: 'เกลือป่น' })
    expect(same.status).toBe(200)
  })
})

describe('หมวดหมู่วัตถุดิบ', () => {
  it('รหัสหมวดหมู่ซ้ำ → 409 (เดิม 500)', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const auth = `Bearer ${u.token}`
    const body = { code: 'CAT-1', name: 'แป้ง', defaultUnit: 'kg' }
    expect((await request(app).post('/api/materials/categories').set('Authorization', auth).send(body)).status).toBe(200)
    const dup = await request(app).post('/api/materials/categories').set('Authorization', auth).send(body)
    expect(dup.status).toBe(409)
    expect(dup.body.code).toBe('CATEGORY_CODE_DUPLICATE')
  })

  it('สร้างด้วยหน่วย mg ได้เหมือนตอนแก้ (เดิมสองรายการไม่ตรงกัน)', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const res = await request(app).post('/api/materials/categories').set('Authorization', `Bearer ${u.token}`)
      .send({ code: 'CAT-MG', name: 'สารปรุง', defaultUnit: 'mg' })
    expect(res.status).toBe(200)
  })

  it('หมวดหมู่ส่วนกลาง (tenant_id ว่าง) ร้านไหนก็แก้/ลบไม่ได้', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const auth = `Bearer ${u.token}`
    const id = mkCategory(null)
    const put = await request(app).put(`/api/materials/categories/${id}`).set('Authorization', auth).send({ name: 'ถูกแก้', defaultUnit: 'kg' })
    expect(put.status).toBe(403)
    const del = await request(app).delete(`/api/materials/categories/${id}`).set('Authorization', auth)
    expect(del.status).toBe(403)
    const row = db.prepare('SELECT name FROM material_categories WHERE id = ?').get(id) as any
    expect(row.name).toBe('หมวดทดสอบ')
    db.prepare('DELETE FROM material_categories WHERE id = ?').run(id)
  })
})

describe('กฎแปลงหน่วย', () => {
  it('factor ไม่ใช่ตัวเลข → 400 · แก้แค่ notes แล้ว factor ไม่หาย (เดิมกลายเป็น NULL)', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const auth = `Bearer ${u.token}`
    const bad = await request(app).post('/api/materials/unit-conversions').set('Authorization', auth)
      .send({ from_unit: 'box', to_unit: 'pcs', conversion_factor: 'abc' })
    expect(bad.status).toBe(400)

    const ok = await request(app).post('/api/materials/unit-conversions').set('Authorization', auth)
      .send({ from_unit: 'box', to_unit: 'pcs', conversion_factor: 12, force: true })
    expect(ok.status).toBe(201)
    const put = await request(app).put(`/api/materials/unit-conversions/${ok.body.data.id}`).set('Authorization', auth)
      .send({ notes: 'กล่องใหญ่' })
    expect(put.status).toBe(200)
    expect(put.body.data.conversion_factor).toBe(12)
    expect(put.body.data.notes).toBe('กล่องใหญ่')
  })
})

// เดิมเส้นนี้เขียน stock_items/stock_movements ตรง ๆ ข้ามแปลงหน่วย/ต้นทุน/บัญชี/ประตูอนุมัติ
// ตอนนี้ส่งต่อให้ POST /stock/movement ตัวเดียวกัน
describe('ปรับสต็อกวัตถุดิบ — ผ่านเส้นเดียวกับ /stock/movement', () => {
  const mkMat = async (auth: string, tenantId: string, code: string) => {
    const categoryId = mkCategory(tenantId)
    const m = await request(app).post('/api/materials').set('Authorization', auth)
      .send({ code, name: 'ไข่ไก่', categoryId, unitCost: 3, initialStock: 5, unit: 'pcs' })
    return m.body.data.id as string
  }

  it('quantity เป็นสตริงตัวเลข → บวกเป็นตัวเลข · บันทึกคนทำ · type แปลก/ติดลบ → 400', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const auth = `Bearer ${u.token}`
    const id = await mkMat(auth, u.tenantId, 'RM-Q')

    const inn = await request(app).post(`/api/materials/${id}/stock`).set('Authorization', auth).send({ type: 'IN', quantity: '3' })
    expect(inn.status).toBe(200)
    expect(inn.body.data.quantity).toBe(8)
    const mv = db.prepare(`SELECT created_by FROM stock_movements WHERE stock_item_id = ? AND type = 'IN'`).get(id) as any
    expect(mv.created_by).toBe(u.email)

    const weird = await request(app).post(`/api/materials/${id}/stock`).set('Authorization', auth).send({ type: 'MOVE', quantity: 1 })
    expect(weird.status).toBe(400)
    const neg = await request(app).post(`/api/materials/${id}/stock`).set('Authorization', auth).send({ type: 'IN', quantity: -2 })
    expect(neg.status).toBe(400)
  })

  it('เปิดประตูอนุมัติหมวดปรับสต็อกไว้ → 202 รออนุมัติ ของยังไม่ขยับ (เดิมข้ามด่านได้)', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const id = await mkMat(`Bearer ${admin.token}`, admin.tenantId, 'RM-G')
    db.prepare(`INSERT INTO approval_settings (id, tenant_id, role, module_type, approval_required, auto_approve_threshold)
      VALUES (?, ?, 'USER', 'stock_adjust', 1, 0)`).run(generateId(), admin.tenantId)

    const res = await request(app).post(`/api/materials/${id}/stock`).set('Authorization', `Bearer ${user.token}`)
      .send({ type: 'ADJUST', quantity: 1 })
    expect(res.status).toBe(202)
    expect(res.body.pending_approval).toBe(true)
    expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(id) as any).quantity).toBe(5)
  })
})
