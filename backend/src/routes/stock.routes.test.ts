import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import stockRouter from './stock.routes'
import { createTestUser } from '../test/testAuth'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/stock', stockRouter)
  return app
}

const app = buildApp()

function seedStockItem(tenantId: string, quantity: number, unitCost = 0) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, location, status, unit_cost)
    VALUES (?, ?, ?, 'Test Item', 'RAW', ?, 'pcs', 'WH1', 'ACTIVE', ?)
  `).run(id, tenantId, id, quantity, unitCost)
  return id
}

describe('POST /api/stock/movement (quantity math)', () => {
  it('IN adds quantity and records a matching stock_movements row', async () => {
    const { tenantId, token } = createTestUser()
    const stockItemId = seedStockItem(tenantId, 10)

    const res = await request(app)
      .post('/api/stock/movement')
      .set('Authorization', `Bearer ${token}`)
      .send({ stockItemId, type: 'IN', quantity: 5, unit: 'pcs' })

    expect(res.status).toBe(200)
    expect(res.body.data.quantity).toBe(15)

    const movement = db.prepare(`
      SELECT * FROM stock_movements WHERE stock_item_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(stockItemId) as any
    expect(movement.type).toBe('IN')
    expect(movement.quantity).toBe(5)
  })

  it('OUT subtracts quantity when stock is sufficient', async () => {
    const { tenantId, token } = createTestUser()
    const stockItemId = seedStockItem(tenantId, 10)

    const res = await request(app)
      .post('/api/stock/movement')
      .set('Authorization', `Bearer ${token}`)
      .send({ stockItemId, type: 'OUT', quantity: 4, unit: 'pcs' })

    expect(res.status).toBe(200)
    expect(res.body.data.quantity).toBe(6)
  })

  it('OUT rejects with 400 and leaves quantity unchanged when stock is insufficient (no pack to auto-unpack)', async () => {
    const { tenantId, token } = createTestUser()
    const stockItemId = seedStockItem(tenantId, 3)

    const res = await request(app)
      .post('/api/stock/movement')
      .set('Authorization', `Bearer ${token}`)
      .send({ stockItemId, type: 'OUT', quantity: 10, unit: 'pcs' })

    expect(res.status).toBe(400)

    const item = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockItemId) as any
    expect(item.quantity).toBe(3) // unchanged — the failed movement must not partially apply
  })

  it('ADJUST sets the absolute quantity (not additive)', async () => {
    const { tenantId, token } = createTestUser()
    const stockItemId = seedStockItem(tenantId, 10)

    const res = await request(app)
      .post('/api/stock/movement')
      .set('Authorization', `Bearer ${token}`)
      .send({ stockItemId, type: 'ADJUST', quantity: 7, unit: 'pcs' })

    expect(res.status).toBe(200)
    expect(res.body.data.quantity).toBe(7)
  })

  it('ADJUST books an auto-journal entry sized to the quantity delta * unit cost', async () => {
    const { tenantId, token } = createTestUser()
    const stockItemId = seedStockItem(tenantId, 5, 10) // unit_cost = 10

    const res = await request(app)
      .post('/api/stock/movement')
      .set('Authorization', `Bearer ${token}`)
      .send({ stockItemId, type: 'ADJUST', quantity: 8, unit: 'pcs' }) // +3 units * 10 = 30

    expect(res.status).toBe(200)

    const entry = db.prepare(`
      SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = 'STOCK_ADJUST' AND reference_id = ?
    `).get(tenantId, stockItemId) as any
    expect(entry).toBeTruthy()
    expect(entry.total_debit).toBe(30)
    expect(entry.total_credit).toBe(30)

    const lines = db.prepare('SELECT * FROM journal_lines WHERE journal_entry_id = ? ORDER BY line_number').all(entry.id) as any[]
    expect(lines).toHaveLength(2)
    expect(lines[0].debit).toBe(30) // Dr Inventory (adjust up)
    expect(lines[1].credit).toBe(30) // Cr Other Income
  })

  it('returns 404 for a stock item that does not belong to the caller tenant', async () => {
    const { tenantId, token } = createTestUser()
    const otherTenantId = generateId()
    const stockItemId = seedStockItem(otherTenantId, 10)

    const res = await request(app)
      .post('/api/stock/movement')
      .set('Authorization', `Bearer ${token}`)
      .send({ stockItemId, type: 'IN', quantity: 1, unit: 'pcs' })

    expect(res.status).toBe(404)
  })
})
