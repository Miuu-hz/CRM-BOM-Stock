import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import posMenuRouter from './pos-menu.routes'
import { createTestUser } from '../test/testAuth'

/**
 * POST /pos-menu/menu-configs เดิมไม่เช็คหมวดสินค้าเลย — ตั้งเมนู POS ผูกกับวัตถุดิบ (raw)
 * ได้ ทั้งที่ isSellableItem() (stockItem.service.ts) บอกว่าขายไม่ได้ (FINISHED/WIP/SERVICE
 * เท่านั้น) ผลคือเมนูแบบนี้ไปพังตอนตัดสต็อก/คิดต้นทุนทีหลัง ไม่ใช่ตอนสร้าง
 */
function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/pos-menu', posMenuRouter)
  return app
}
const app = buildApp()

function seedStockItem(tenantId: string, category: string) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, unit, location, status)
    VALUES (?, ?, ?, 'วัตถุดิบทดสอบ', ?, 'pcs', 'WH1', 'ACTIVE')
  `).run(id, tenantId, id, category)
  return id
}

describe('POST /api/pos-menu/menu-configs — การ์ดสินค้าขายไม่ได้', () => {
  it('product_id เป็นหมวด raw (วัตถุดิบ) → 400 ITEM_NOT_SELLABLE', async () => {
    const { tenantId, token } = createTestUser()
    const productId = seedStockItem(tenantId, 'raw')

    const res = await request(app)
      .post('/api/pos-menu/menu-configs')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: productId, pos_price: 20 })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('ITEM_NOT_SELLABLE')
    expect(res.body.message).toContain('วัตถุดิบทดสอบ')

    const created = db.prepare('SELECT id FROM pos_menu_configs WHERE product_id = ?').get(productId)
    expect(created).toBeUndefined()
  })

  it('product_id เป็นหมวด FINISHED → สร้างเมนูได้ตามปกติ', async () => {
    const { tenantId, token } = createTestUser()
    const productId = seedStockItem(tenantId, 'FINISHED')

    const res = await request(app)
      .post('/api/pos-menu/menu-configs')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: productId, pos_price: 20 })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})
