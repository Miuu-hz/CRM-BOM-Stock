import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import posBillRouter from './pos-bill.routes'
import approvalRouter from './approval.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/pos', posBillRouter)
app.use('/api/approval', approvalRouter)

function seedPaidBill(tenantId: string, total = 500) {
  const id = generateId()
  db.prepare(`
    INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, total_amount, subtotal, opened_at, created_by)
    VALUES (?, ?, ?, 'Test Bill', 'PAID', ?, ?, ?, 'tester')
  `).run(id, tenantId, 'POS-' + id.slice(0, 6), total, total, new Date().toISOString())
  return id
}

function openPosApproval(tenantId: string, role = 'USER', threshold = 0) {
  db.prepare(`
    INSERT INTO approval_settings (id, tenant_id, role, module_type, approval_required, auto_approve_threshold)
    VALUES (?, ?, ?, 'pos_void', 1, ?)
    ON CONFLICT(tenant_id, role, module_type) DO UPDATE SET
      approval_required = 1, auto_approve_threshold = excluded.auto_approve_threshold
  `).run(generateId(), tenantId, role, threshold)
}

const statusOf = (id: string) =>
  (db.prepare('SELECT status FROM pos_running_bills WHERE id = ?').get(id) as any).status

describe('หมวดยกเลิกบิล POS — ต้องผ่านการอนุมัติก่อน', () => {
  it('พนักงานกดยกเลิก → บิลยังไม่ถูกยกเลิก และมีคำขอเข้า inbox', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openPosApproval(admin.tenantId)
    const billId = seedPaidBill(admin.tenantId)

    const res = await request(app).post(`/api/pos/bills/${billId}/cancel`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ reason: 'ลูกค้าเปลี่ยนใจ' })

    expect(res.status).toBe(202)
    expect(res.body.pending_approval).toBe(true)
    expect(statusOf(billId)).toBe('PAID')      // บิลยังไม่ถูกแตะ

    const inbox = await request(app).get('/api/approval/pending')
      .set('Authorization', `Bearer ${admin.token}`)
    const mine = inbox.body.data.find((r: any) => r.reference_id === billId)
    expect(mine).toBeTruthy()
    expect(mine.description).toContain('ขอยกเลิก')
  })

  it('เจ้าของอนุมัติ → บิลถูกยกเลิกจริง', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openPosApproval(admin.tenantId)
    const billId = seedPaidBill(admin.tenantId)

    await request(app).post(`/api/pos/bills/${billId}/cancel`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ reason: 'ลูกค้าเปลี่ยนใจ' })

    const pending = db.prepare(
      "SELECT id FROM approval_requests WHERE reference_id = ? AND status = 'PENDING'"
    ).get(billId) as any

    const res = await request(app).put(`/api/approval/requests/${pending.id}/decision`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'APPROVED', level: 1 })

    expect(res.status).toBe(200)
    expect(statusOf(billId)).toBe('CANCELLED')
  })

  it('ปฏิเสธ → บิลยังอยู่เหมือนเดิม', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openPosApproval(admin.tenantId)
    const billId = seedPaidBill(admin.tenantId)

    await request(app).post(`/api/pos/bills/${billId}/cancel`)
      .set('Authorization', `Bearer ${user.token}`).send({ reason: 'x' })
    const pending = db.prepare(
      "SELECT id FROM approval_requests WHERE reference_id = ? AND status = 'PENDING'"
    ).get(billId) as any
    await request(app).put(`/api/approval/requests/${pending.id}/decision`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'REJECTED', comment: 'ไม่อนุมัติ', level: 1 })

    expect(statusOf(billId)).toBe('PAID')
  })

  it('บิลยอดต่ำกว่าวงเงินอนุมัติอัตโนมัติ → ยกเลิกได้เลย', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openPosApproval(admin.tenantId, 'USER', 1000)
    const billId = seedPaidBill(admin.tenantId, 200)

    const res = await request(app).post(`/api/pos/bills/${billId}/cancel`)
      .set('Authorization', `Bearer ${user.token}`).send({ reason: 'ยอดน้อย' })

    expect(res.status).toBe(200)
    expect(statusOf(billId)).toBe('CANCELLED')
  })

  it('หมวดปิดอยู่ → ยกเลิกได้ตามปกติ (พฤติกรรมเดิม)', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const billId = seedPaidBill(admin.tenantId)

    const res = await request(app).post(`/api/pos/bills/${billId}/cancel`)
      .set('Authorization', `Bearer ${user.token}`).send({ reason: 'x' })

    expect(res.status).toBe(200)
    expect(statusOf(billId)).toBe('CANCELLED')
  })
})
