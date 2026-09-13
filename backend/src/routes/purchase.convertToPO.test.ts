import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import purchaseRouter from './purchase.routes'
import { createTestUser } from '../test/testAuth'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/purchase', purchaseRouter)
  return app
}

const app = buildApp()

function seedSupplier(tenantId: string) {
  const id = `sup_${Math.random().toString(36).slice(2, 10)}`
  db.prepare(`
    INSERT INTO suppliers (id, tenant_id, code, name, contact_name)
    VALUES (?, ?, ?, 'Test Supplier', 'Contact')
  `).run(id, tenantId, id)
  return id
}

// PR ที่ APPROVED แล้ว พร้อม 1 รายการ — สร้างตรงลง DB แทนการยิง POST /requests
// เพราะเป้าหมายของเทสต์นี้คือ endpoint convert-to-po เท่านั้น
function seedApprovedPR(tenantId: string, userId: string, email: string) {
  const id = generateId()
  db.prepare(`
    INSERT INTO purchase_requests (id, tenant_id, pr_number, requester_id, requester_name, status, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'APPROVED', 100, datetime('now'), datetime('now'))
  `).run(id, tenantId, `PR-TEST-${id.slice(0, 8)}`, userId, email)
  db.prepare(`
    INSERT INTO purchase_request_items (id, tenant_id, purchase_request_id, description, quantity, unit, estimated_unit_price, estimated_total_price)
    VALUES (?, ?, ?, 'Test item', 10, 'pcs', 10, 100)
  `).run(generateId(), tenantId, id)
  return id
}

describe('POST /api/purchase/requests/:id/convert-to-po', () => {
  it('links the created PO back to the source PR via linked_pr_id and marks the PR CONVERTED', async () => {
    const { tenantId, userId, email, token } = createTestUser()
    const supplierId = seedSupplier(tenantId)
    const prId = seedApprovedPR(tenantId, userId, email)

    const res = await request(app)
      .post(`/api/purchase/requests/${prId}/convert-to-po`)
      .set('Authorization', `Bearer ${token}`)
      .send({ supplierId })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.linked_pr_id).toBe(prId)

    // ต้องดึงกลับได้จาก DB ตรง ๆ ด้วย ไม่ใช่แค่ response payload
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(res.body.data.id) as any
    expect(po.linked_pr_id).toBe(prId)

    const pr = db.prepare('SELECT status FROM purchase_requests WHERE id = ?').get(prId) as any
    expect(pr.status).toBe('CONVERTED')
  })

  it('rejects converting a PR that is not APPROVED', async () => {
    const { tenantId, userId, email, token } = createTestUser()
    const supplierId = seedSupplier(tenantId)
    const prId = generateId()
    db.prepare(`
      INSERT INTO purchase_requests (id, tenant_id, pr_number, requester_id, requester_name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'DRAFT', datetime('now'), datetime('now'))
    `).run(prId, tenantId, `PR-TEST-${prId.slice(0, 8)}`, userId, email)

    const res = await request(app)
      .post(`/api/purchase/requests/${prId}/convert-to-po`)
      .set('Authorization', `Bearer ${token}`)
      .send({ supplierId })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })
})
