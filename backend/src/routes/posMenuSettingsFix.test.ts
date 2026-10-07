import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import posMenuRouter from './pos-menu.routes'
import lineBotRouter from './line-bot.routes'
import { createTestUser } from '../test/testAuth'

/**
 * บั๊กที่แก้: pos-menu.routes.ts ไม่เช็ค role เลย (ทุก mutating route เปิดให้ USER ยิงได้),
 * GET /line/config เปิดให้ทุก role อ่าน token LINE, available-products ค้นหาด้วยคอลัมน์ที่ไม่มี
 * (p.code) ทำ 500, และ pos_price/cost_price ไม่เช็คค่าติดลบ/0
 */
function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/pos-menu', posMenuRouter)
  app.use('/api/line', lineBotRouter)
  return app
}
const app = buildApp()

const tenantIds: string[] = []
function trackTenant(tenantId: string) {
  tenantIds.push(tenantId)
  return tenantId
}

afterEach(() => {
  while (tenantIds.length) {
    const tenantId = tenantIds.pop()!
    db.prepare('DELETE FROM pos_menu_configs WHERE tenant_id = ?').run(tenantId)
    db.prepare('DELETE FROM stock_items WHERE tenant_id = ?').run(tenantId)
    db.prepare('DELETE FROM users WHERE tenant_id = ?').run(tenantId)
  }
})

function seedSellableProduct(tenantId: string) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, unit, location, status)
    VALUES (?, ?, ?, 'เมนูทดสอบ', 'FINISHED', 'pcs', 'WH1', 'ACTIVE')
  `).run(id, tenantId, id)
  return id
}

function seedMenuConfig(tenantId: string, productId: string) {
  const id = generateId()
  db.prepare(`
    INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price, cost_price, is_available, is_pos_enabled, display_order)
    VALUES (?, ?, ?, 20, 0, 1, 1, 0)
  `).run(id, tenantId, productId)
  return id
}

describe('role gate: mutating pos-menu routes', () => {
  it('USER → PUT /menu-configs/:id = 403', async () => {
    const { tenantId, token } = createTestUser({ role: 'USER' })
    trackTenant(tenantId)
    const productId = seedSellableProduct(tenantId)
    const menuId = seedMenuConfig(tenantId, productId)

    const res = await request(app)
      .put(`/api/pos-menu/menu-configs/${menuId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ pos_price: 25 })

    expect(res.status).toBe(403)
  })

  it('ADMIN → PUT /menu-configs/:id = 200', async () => {
    const { tenantId, token } = createTestUser({ role: 'ADMIN' })
    trackTenant(tenantId)
    const productId = seedSellableProduct(tenantId)
    const menuId = seedMenuConfig(tenantId, productId)

    const res = await request(app)
      .put(`/api/pos-menu/menu-configs/${menuId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ pos_price: 25 })

    expect(res.status).toBe(200)
  })
})

describe('role gate: GET /api/line/config', () => {
  it('USER → 403', async () => {
    const { tenantId, token } = createTestUser({ role: 'USER' })
    trackTenant(tenantId)

    const res = await request(app)
      .get('/api/line/config')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })

  it('ADMIN → 200', async () => {
    const { tenantId, token } = createTestUser({ role: 'ADMIN' })
    trackTenant(tenantId)

    const res = await request(app)
      .get('/api/line/config')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
  })
})

describe('pos_price / cost_price validation', () => {
  it('POST /menu-configs ราคาติดลบ → 400', async () => {
    const { tenantId, token } = createTestUser({ role: 'ADMIN' })
    trackTenant(tenantId)
    const productId = seedSellableProduct(tenantId)

    const res = await request(app)
      .post('/api/pos-menu/menu-configs')
      .set('Authorization', `Bearer ${token}`)
      .send({ product_id: productId, pos_price: -5 })

    expect(res.status).toBe(400)
  })

  it('PUT /menu-configs/:id ต้นทุนติดลบ → 400', async () => {
    const { tenantId, token } = createTestUser({ role: 'ADMIN' })
    trackTenant(tenantId)
    const productId = seedSellableProduct(tenantId)
    const menuId = seedMenuConfig(tenantId, productId)

    const res = await request(app)
      .put(`/api/pos-menu/menu-configs/${menuId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cost_price: -1 })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/pos-menu/available-products', () => {
  it('search ด้วยคำค้น → 200 (เดิมค้นด้วย p.code ที่ไม่มีคอลัมน์นี้ → 500)', async () => {
    const { tenantId, token } = createTestUser({ role: 'ADMIN' })
    trackTenant(tenantId)
    seedSellableProduct(tenantId)

    const res = await request(app)
      .get('/api/pos-menu/available-products?search=x')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})
