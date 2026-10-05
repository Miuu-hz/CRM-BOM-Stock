import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import stockRouter from './stock.routes'
import { createTestUser } from '../test/testAuth'
import { createConversion } from '../services/unitConversion.service'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/stock', stockRouter)
  return app
}

const app = buildApp()

function seedZeroStockItem(tenantId: string, baseUnit: string) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status, unit_cost)
    VALUES (?, ?, ?, 'Adjust Unit Item', 'RAW', 0, ?, ?, 'WH1', 'ACTIVE', 0)
  `).run(id, tenantId, id, baseUnit, baseUnit)
  return id
}

describe('POST /api/stock/movement ADJUST — converts the entered unit to base unit', () => {
  it('ADJUST 10 bag on an item stored in ml (1 bag = 1000 ml, zero stock) sets quantity to 10000 ml and records the entered unit/qty', async () => {
    const { tenantId, token } = createTestUser()
    const stockItemId = seedZeroStockItem(tenantId, 'ml')
    createConversion(tenantId, { material_id: stockItemId, from_unit: 'bag', to_unit: 'ml', conversion_factor: 1000 })

    const res = await request(app)
      .post('/api/stock/movement')
      .set('Authorization', `Bearer ${token}`)
      .send({ stockItemId, type: 'ADJUST', quantity: 10, unit: 'bag' })

    expect(res.status).toBe(200)
    expect(res.body.data.quantity).toBe(10000) // base unit (ml), not the 10 that was typed

    const movement = db.prepare(`
      SELECT * FROM stock_movements WHERE stock_item_id = ? AND type = 'ADJUST' ORDER BY created_at DESC LIMIT 1
    `).get(stockItemId) as any
    expect(movement.quantity).toBe(10000)      // base unit column
    expect(movement.movement_unit).toBe('bag') // unit exactly as the user entered it
    expect(movement.movement_quantity).toBe(10) // quantity exactly as the user entered it
  })

  it('ADJUST with a unit that has no conversion path to base unit fails with 400 (not silently wrong)', async () => {
    const { tenantId, token } = createTestUser()
    const stockItemId = seedZeroStockItem(tenantId, 'ml')
    // no conversion rule registered for 'barrel' -> 'ml' anywhere (global or per-item)

    const res = await request(app)
      .post('/api/stock/movement')
      .set('Authorization', `Bearer ${token}`)
      .send({ stockItemId, type: 'ADJUST', quantity: 3, unit: 'barrel' })

    expect(res.status).toBe(400)

    const item = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockItemId) as any
    expect(item.quantity).toBe(0) // rejected movement must not touch stock
  })
})
