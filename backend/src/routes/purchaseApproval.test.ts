import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import purchaseRouter from './purchase.routes'
import purchaseOrderRouter from './purchaseOrder.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/purchase', authenticate, purchaseRouter)
app.use('/api/purchase-orders', authenticate, purchaseOrderRouter)

/**
 * ปุ่ม "อนุมัติ" ที่หน้าจัดซื้อยิง PUT .../status ซึ่งเดิมไม่เช็คสิทธิ์อะไรเลย
 * (เช็คเฉพาะตอน CANCELLED) user ธรรมดาจึงสร้าง PR แล้วกดอนุมัติเอง → convert เป็น PO ได้
 * ส่วน endpoint /approve ที่เช็คครบ ไม่มีหน้าไหนเรียก
 */
function seedPR(tenantId: string, amount = 5000) {
  const id = generateId()
  db.prepare(`
    INSERT INTO purchase_requests (id, tenant_id, pr_number, requester_id, requester_name, status, total_amount, request_date)
    VALUES (?, ?, ?, 'u', 'ผู้ขอทดสอบ', 'PENDING', ?, ?)
  `).run(id, tenantId, 'PR-TEST-' + id.slice(0, 8), amount, new Date().toISOString())
  return id
}

function seedPO(tenantId: string, amount = 5000) {
  const supplierId = generateId()
  db.prepare(`
    INSERT INTO suppliers (id, tenant_id, code, name, contact_name, email, phone)
    VALUES (?, ?, ?, 'ผู้ขายทดสอบ', 'x', 'x@example.com', '0800000000')
  `).run(supplierId, tenantId, 'SUP-' + supplierId.slice(0, 8))

  const id = generateId()
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, total_amount, order_date)
    VALUES (?, ?, ?, ?, 'SUBMITTED', ?, ?)
  `).run(id, tenantId, 'PO-TEST-' + id.slice(0, 8), supplierId, amount, new Date().toISOString())
  return id
}

describe('สิทธิ์อนุมัติ PR/PO ผ่านปุ่มจริง (PUT .../status)', () => {
  it('USER อนุมัติ PR ของตัวเองไม่ได้', async () => {
    const user = createTestUser({ role: 'USER' })
    const prId = seedPR(user.tenantId)

    const res = await request(app).put(`/api/purchase/requests/${prId}/status`)
      .set('Authorization', `Bearer ${user.token}`).send({ status: 'APPROVED' })

    expect(res.status).toBe(403)
    expect(db.prepare('SELECT status FROM purchase_requests WHERE id = ?').get(prId)).toMatchObject({ status: 'PENDING' })
  })

  it('USER ที่ถูกมอบสิทธิ์ can_approve แต่วงเงินไม่ถึง → ยังถูกบล็อก', async () => {
    const user = createTestUser({ role: 'USER' })
    db.prepare(`
      INSERT INTO user_approval_permissions (id, tenant_id, user_id, module_type, can_approve, can_approve_unlimited, approval_limit)
      VALUES (?, ?, ?, 'purchase_request', 1, 0, 1000)
    `).run(generateId(), user.tenantId, user.userId)
    const prId = seedPR(user.tenantId, 5000)

    const res = await request(app).put(`/api/purchase/requests/${prId}/status`)
      .set('Authorization', `Bearer ${user.token}`).send({ status: 'APPROVED' })

    expect(res.status).toBe(403)
    expect(res.body.message).toContain('วงเงิน')
  })

  it('USER ที่มีสิทธิ์และวงเงินพอ → อนุมัติได้', async () => {
    const user = createTestUser({ role: 'USER' })
    db.prepare(`
      INSERT INTO user_approval_permissions (id, tenant_id, user_id, module_type, can_approve, can_approve_unlimited, approval_limit)
      VALUES (?, ?, ?, 'purchase_request', 1, 0, 10000)
    `).run(generateId(), user.tenantId, user.userId)
    const prId = seedPR(user.tenantId, 5000)

    const res = await request(app).put(`/api/purchase/requests/${prId}/status`)
      .set('Authorization', `Bearer ${user.token}`).send({ status: 'APPROVED' })

    expect(res.status).toBe(200)
    expect(db.prepare('SELECT status FROM purchase_requests WHERE id = ?').get(prId)).toMatchObject({ status: 'APPROVED' })
  })

  it('ADMIN อนุมัติ PR ได้เสมอ ไม่ต้องตั้งค่าอะไร', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const prId = seedPR(admin.tenantId)

    const res = await request(app).put(`/api/purchase/requests/${prId}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'APPROVED' })

    expect(res.status).toBe(200)
    expect(db.prepare('SELECT status FROM purchase_requests WHERE id = ?').get(prId)).toMatchObject({ status: 'APPROVED' })
  })

  it('USER อนุมัติ PO ไม่ได้ / ADMIN ได้', async () => {
    const user = createTestUser({ role: 'USER' })
    const poId = seedPO(user.tenantId)

    const denied = await request(app).put(`/api/purchase-orders/${poId}/status`)
      .set('Authorization', `Bearer ${user.token}`).send({ status: 'APPROVED' })
    expect(denied.status).toBe(403)
    expect(db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(poId)).toMatchObject({ status: 'SUBMITTED' })

    const admin = createTestUser({ role: 'ADMIN', tenantId: user.tenantId })
    const ok = await request(app).put(`/api/purchase-orders/${poId}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'APPROVED' })
    expect(ok.status).toBe(200)
    expect(db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(poId)).toMatchObject({ status: 'APPROVED' })
  })
})
