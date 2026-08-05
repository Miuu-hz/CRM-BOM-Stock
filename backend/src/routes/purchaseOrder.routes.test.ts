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

describe('POST /api/purchase-orders/:id/approve (approval-limit math)', () => {
  async function createSubmittedPO(token: string, supplierId: string, unitPrice: number) {
    const createRes = await request(app)
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ supplierId, items: [{ quantity: 1, unitPrice }] })
    const poId = createRes.body.data.id
    db.prepare(`UPDATE purchase_orders SET status = 'SUBMITTED' WHERE id = ?`).run(poId)
    return poId
  }

  it('auto-approves a non-admin when PO amount is within the role auto_approve_threshold', async () => {
    const { tenantId, token } = createTestUser({ role: 'USER' })
    const supplierId = seedSupplier(tenantId)
    const poId = await createSubmittedPO(token, supplierId, 500) // total = 500

    db.prepare(`
      INSERT INTO approval_settings (id, tenant_id, role, module_type, auto_approve_threshold)
      VALUES (?, ?, 'USER', 'purchase_order', 1000)
    `).run(`as_${poId}`, tenantId)

    const res = await request(app)
      .post(`/api/purchase-orders/${poId}/approve`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('APPROVED')
  })

  it('rejects with 403 when the non-admin has no approval permission row and no auto-approve threshold covers it', async () => {
    const { tenantId, token } = createTestUser({ role: 'USER' })
    const supplierId = seedSupplier(tenantId)
    const poId = await createSubmittedPO(token, supplierId, 5000)

    const res = await request(app)
      .post(`/api/purchase-orders/${poId}/approve`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)

    const po = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(poId) as any
    expect(po.status).toBe('SUBMITTED') // unchanged
  })

  it('rejects with 403 when PO amount exceeds the user approval_limit', async () => {
    const { userId, tenantId, token } = createTestUser({ role: 'USER' })
    const supplierId = seedSupplier(tenantId)
    const poId = await createSubmittedPO(token, supplierId, 5000)

    db.prepare(`
      INSERT INTO user_approval_permissions (id, tenant_id, user_id, module_type, can_approve, can_approve_unlimited, approval_limit)
      VALUES (?, ?, ?, 'purchase_order', 1, 0, 1000)
    `).run(`uap_${poId}`, tenantId, userId)

    const res = await request(app)
      .post(`/api/purchase-orders/${poId}/approve`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.message).toContain('วงเงิน')
  })

  it('approves when the user permission row has can_approve_unlimited, regardless of amount', async () => {
    const { userId, tenantId, token } = createTestUser({ role: 'USER' })
    const supplierId = seedSupplier(tenantId)
    const poId = await createSubmittedPO(token, supplierId, 999999)

    db.prepare(`
      INSERT INTO user_approval_permissions (id, tenant_id, user_id, module_type, can_approve, can_approve_unlimited, approval_limit)
      VALUES (?, ?, ?, 'purchase_order', 1, 1, 0)
    `).run(`uap2_${poId}`, tenantId, userId)

    const res = await request(app)
      .post(`/api/purchase-orders/${poId}/approve`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('APPROVED')
  })

  it('MASTER can always approve, bypassing approval_settings/permissions entirely', async () => {
    const { tenantId, token } = createTestUser({ role: 'MASTER' })
    const supplierId = seedSupplier(tenantId)
    const poId = await createSubmittedPO(token, supplierId, 999999)

    const res = await request(app)
      .post(`/api/purchase-orders/${poId}/approve`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('APPROVED')
  })
})
