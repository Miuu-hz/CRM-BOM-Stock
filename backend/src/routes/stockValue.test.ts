import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import stockRouter from './stock.routes'
import { createTestUser } from '../test/testAuth'
import { createConversion } from '../services/unitConversion.service'
import { totalStockValue } from '../services/stockValue.service'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/stock', stockRouter)
  return app
}

const app = buildApp()

/** Seeds a stock item that is sold loose (pcs) but also sits on the shelf in sealed boxes. */
function seedPackedItem(tenantId: string, opts: { quantity: number; sealedQty: number; unitCost: number; packFactor: number }) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, display_unit, sealed_qty, unit_cost, location, status)
    VALUES (?, ?, ?, 'Packed Item', 'RAW', ?, 'pcs', 'pcs', 'box', ?, ?, 'WH1', 'ACTIVE')
  `).run(id, tenantId, id, opts.quantity, opts.sealedQty, opts.unitCost)
  createConversion(tenantId, { material_id: id, from_unit: 'box', to_unit: 'pcs', conversion_factor: opts.packFactor })
  return id
}

describe('GET /api/stock/stats — total value', () => {
  it('is > 0 and counts sealed packs, not just loose quantity (bug: used to always be ฿0)', async () => {
    const { tenantId, token } = createTestUser()
    // 5 loose pcs + 2 sealed boxes of 12 pcs each, unit_cost ฿10/pcs
    // expected value = (5 + 2*12) * 10 = 290
    seedPackedItem(tenantId, { quantity: 5, sealedQty: 2, unitCost: 10, packFactor: 12 })

    const res = await request(app)
      .get('/api/stock/stats')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.totalValue).toBeGreaterThan(0)
    expect(res.body.data.totalValue).toBe(290)
  })

  it('matches totalStockValue() — the one shared helper used by stats/analytics/agent/mcp/phopy-board', async () => {
    const { tenantId, token } = createTestUser()
    seedPackedItem(tenantId, { quantity: 3, sealedQty: 1, unitCost: 25, packFactor: 6 })
    seedPackedItem(tenantId, { quantity: 0, sealedQty: 0, unitCost: 99, packFactor: 6 })

    const res = await request(app)
      .get('/api/stock/stats')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.totalValue).toBe(totalStockValue(tenantId))
  })
})

describe('POST /api/stock — create item with purchase unit that has no conversion to base unit', () => {
  it('returns 201 with the item created, unit_cost 0, and a warning (not a 400 catch-22)', async () => {
    const { tenantId, token } = createTestUser()
    const sku = generateId()

    const res = await request(app)
      .post('/api/stock')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sku,
        name: 'Mystery Unit Item',
        category: 'RAW',
        unit: 'pcs',
        baseUnit: 'pcs',
        purchasePrice: 500,
        purchaseUnit: 'crate-of-unknown-size', // no conversion rule exists anywhere for this
      })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.unit_cost).toBe(0)
    expect(res.body.warning).toBe('ตั้งกฎแปลงหน่วยแล้วแก้ราคาซื้ออีกครั้งเพื่อคำนวณต้นทุน')

    // item really exists — this is the whole point of the fix (create-then-fix, not blocked)
    const row = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(res.body.data.id) as any
    expect(row).toBeTruthy()
    expect(row.purchase_price).toBe(500)
    expect(row.purchase_unit).toBe('crate-of-unknown-size')
  })
})
