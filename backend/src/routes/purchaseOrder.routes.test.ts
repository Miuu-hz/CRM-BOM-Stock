import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import '../routes/currency.routes' // side effect only: creates the `currencies` table
import purchaseOrderRouter from './purchaseOrder.routes'
import { createTestUser } from '../test/testAuth'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/purchase-orders', purchaseOrderRouter)
  return app
}

function seedSupplier(tenantId: string) {
  const id = `sup_${Math.random().toString(36).slice(2, 10)}`
  db.prepare(`
    INSERT INTO suppliers (id, tenant_id, code, name, contact_name)
    VALUES (?, ?, ?, 'Test Supplier', 'Contact')
  `).run(id, tenantId, id)
  return id
}

const app = buildApp()

describe('POST /api/purchase-orders (subtotal/tax/total math)', () => {
  it('computes subtotal, tax and total from line items with no currency conversion', async () => {
    const { tenantId, token } = createTestUser()
    const supplierId = seedSupplier(tenantId)

    const res = await request(app)
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        supplierId,
        taxRate: 7,
        items: [
          { quantity: 3, unitPrice: 100 }, // 300
          { quantity: 2, unitPrice: 50 },  // 100
        ],
      })

    expect(res.status).toBe(201)
    expect(res.body.data.subtotal).toBe(400)
    expect(res.body.data.tax_amount).toBeCloseTo(28, 5) // 400 * 7%
    expect(res.body.data.total_amount).toBeCloseTo(428, 5)
    expect(res.body.data.currency_code).toBe('THB')
    expect(res.body.data.items).toHaveLength(2)
    expect(res.body.data.items[0].total_price).toBe(300)
  })

  it('defaults tax to 0 when taxRate is omitted', async () => {
    const { tenantId, token } = createTestUser()
    const supplierId = seedSupplier(tenantId)

    const res = await request(app)
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ supplierId, items: [{ quantity: 1, unitPrice: 250 }] })

    expect(res.status).toBe(201)
    expect(res.body.data.tax_amount).toBe(0)
    expect(res.body.data.total_amount).toBe(250)
  })

  it('converts subtotal/tax/total to THB using the supplied exchange rate, rounded to 2dp', async () => {
    const { tenantId, token } = createTestUser()
    const supplierId = seedSupplier(tenantId)
    db.prepare(`
      INSERT INTO currencies (tenant_id, code, name, exchange_rate, is_active, updated_at)
      VALUES (?, 'USD', 'US Dollar', 35, 1, datetime('now'))
    `).run(tenantId)

    const res = await request(app)
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        supplierId,
        taxRate: 7,
        currencyCode: 'USD',
        exchangeRate: 35.128,
        items: [{ quantity: 1, unitPrice: 100 }], // 100 USD subtotal, 7 tax, 107 total (foreign)
      })

    expect(res.status).toBe(201)
    expect(res.body.data.subtotal).toBeCloseTo(3512.8, 2)   // 100 * 35.128
    expect(res.body.data.tax_amount).toBeCloseTo(245.9, 2)  // 7 * 35.128 = 245.896 -> round2
    expect(res.body.data.total_amount).toBeCloseTo(3758.7, 2) // 107 * 35.128 = 3758.696 -> round2
    expect(res.body.data.foreign_amount).toBeCloseTo(107, 2)
    expect(res.body.data.exchange_rate).toBe(35.128)
  })

  it('rejects an unknown or inactive currency code (400, no PO created)', async () => {
    const { tenantId, token } = createTestUser()
    const supplierId = seedSupplier(tenantId)

    const res = await request(app)
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ supplierId, currencyCode: 'GBP', exchangeRate: 45, items: [{ quantity: 1, unitPrice: 10 }] })

    expect(res.status).toBe(400)
  })

  it('rejects a non-positive exchange rate', async () => {
    const { tenantId, token } = createTestUser()
    const supplierId = seedSupplier(tenantId)
    db.prepare(`
      INSERT INTO currencies (tenant_id, code, name, exchange_rate, is_active, updated_at)
      VALUES (?, 'USD', 'US Dollar', 35, 1, datetime('now'))
    `).run(tenantId)

    const res = await request(app)
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ supplierId, currencyCode: 'USD', exchangeRate: 0, items: [{ quantity: 1, unitPrice: 10 }] })

    expect(res.status).toBe(400)
  })
})
