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

/**
 * ยุบตาราง materials เข้ากับ stock_items — วัตถุดิบ 1 ตัว = stock_items 1 แถว
 * เดิมสร้างคู่กัน 2 แถว ทำให้ของชิ้นเดียวกันมี id 2 แบบ แล้ว join ไม่เคยแมตช์
 * (ต้นทุน BOM เป็น 0 ทุกใบ · ป้าย "ใช้ใน BOM" เป็น 0 ตลอด)
 */
function mkMaterial(tenantId: string, name: string, unitCost = 5, category = 'RAW_MATERIAL') {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, ?, ?, 100, 'g', 'g', ?, 'WH1', 'ACTIVE')
  `).run(id, tenantId, 'MAT-' + id.slice(0, 8), name, category, unitCost)
  return id
}

function mkBomUsing(tenantId: string, materialId: string, qty = 3) {
  const productId = mkMaterial(tenantId, 'สินค้าสำเร็จรูป', 0, 'finished')
  const bomId = generateId()
  db.prepare(`INSERT INTO boms (id, tenant_id, product_id, version, status) VALUES (?, ?, ?, 'v1', 'ACTIVE')`)
    .run(bomId, tenantId, productId)
  db.prepare(`INSERT INTO bom_items (id, tenant_id, bom_id, material_id, item_type, quantity, unit)
    VALUES (?, ?, ?, ?, 'MATERIAL', ?, 'g')`).run(generateId(), tenantId, bomId, materialId, qty)
  return bomId
}

describe('ยุบ materials เข้ากับ stock_items', () => {
  it('ตาราง materials ต้องไม่มีอยู่แล้ว', () => {
    const n = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='materials'").get() as any
    expect(n.c).toBe(0)
  })

  it('ป้าย "ใช้ใน BOM" ต้องนับได้จริง (เดิมเป็น 0 ตลอดเพราะนับคนละ id)', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const matId = mkMaterial(user.tenantId, 'พริกไทยทดสอบ')
    mkBomUsing(user.tenantId, matId)
    mkBomUsing(user.tenantId, matId)

    const res = await request(app).get('/api/materials').set('Authorization', `Bearer ${user.token}`)
    expect(res.status).toBe(200)
    const row = (res.body.data as any[]).find(m => m.id === matId)
    expect(row).toBeTruthy()
    expect(row.usedInBOMs).toBe(2)
  })

  it('ต้นทุน BOM คำนวณจาก stock_items ได้ (เดิมเป็น 0 ทุกใบ)', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const matId = mkMaterial(user.tenantId, 'น้ำตาลทดสอบ', 4)
    const bomId = mkBomUsing(user.tenantId, matId, 3)

    const cost = db.prepare(`SELECT COALESCE(SUM(bi.quantity * m.unit_cost), 0) as cost
      FROM bom_items bi JOIN stock_items m ON bi.material_id = m.id
      WHERE bi.bom_id = ? AND bi.item_type = 'MATERIAL'`).get(bomId) as any
    expect(cost.cost).toBe(12)   // 3 หน่วย × 4 บาท
  })

  it('FK กันกรอก material_id ที่ไม่มีอยู่จริง', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const prId = generateId()
    db.prepare(`INSERT INTO purchase_requests (id, tenant_id, pr_number, requester_id, requester_name, status, total_amount)
      VALUES (?, ?, ?, ?, 'ผู้ขอทดสอบ', 'DRAFT', 0)`).run(prId, user.tenantId, 'PR-' + prId.slice(0, 6), user.userId)

    const insert = () => db.prepare(`INSERT INTO purchase_request_items
      (id, tenant_id, purchase_request_id, material_id, description, quantity)
      VALUES (?, ?, ?, 'ไม่มีของชิ้นนี้อยู่จริง', 'ของมั่ว', 1)`)
      .run(generateId(), user.tenantId, prId)
    expect(insert).toThrow(/FOREIGN KEY/i)
  })

  it('สร้างวัตถุดิบใหม่ = stock_items แถวเดียว ไม่สร้างของซ้อน', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const catId = generateId()
    db.prepare(`INSERT INTO material_categories (id, tenant_id, code, name, default_unit)
      VALUES (?, ?, 'TST', 'หมวดทดสอบ', 'g')`).run(catId, user.tenantId)

    const code = 'NEW-' + generateId().slice(0, 6)
    const res = await request(app).post('/api/materials').set('Authorization', `Bearer ${user.token}`)
      .send({ code, name: 'วัตถุดิบใหม่', categoryId: catId, unitCost: 7, minStock: 2, initialStock: 50 })
    expect(res.status).toBe(200)

    const rows = db.prepare('SELECT * FROM stock_items WHERE tenant_id = ? AND sku = ?').all(user.tenantId, code) as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('วัตถุดิบใหม่')       // ไม่ใช่ "Stock: วัตถุดิบใหม่" แบบเดิม
    expect(rows[0].category_id).toBe(catId)          // หมวดจาก catalog ผูกมาด้วย
    expect(rows[0].quantity).toBe(50)
    expect(db.prepare('SELECT COUNT(*) c FROM stock_items WHERE tenant_id = ? AND sku = ?')
      .get(user.tenantId, 'STK-' + code) as any).toEqual({ c: 0 })
  })

  it('หมวดหมู่ที่ยังมีของใช้อยู่ ลบไม่ได้', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const catId = generateId()
    db.prepare(`INSERT INTO material_categories (id, tenant_id, code, name, default_unit)
      VALUES (?, ?, 'USED', 'หมวดที่มีของ', 'pcs')`).run(catId, user.tenantId)
    const matId = mkMaterial(user.tenantId, 'ของในหมวดนี้')
    db.prepare('UPDATE stock_items SET category_id = ? WHERE id = ?').run(catId, matId)

    const res = await request(app).delete('/api/materials/categories/' + catId)
      .set('Authorization', `Bearer ${user.token}`)
    expect(res.status).toBe(400)
  })
})
