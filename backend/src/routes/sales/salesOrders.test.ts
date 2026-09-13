import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import salesOrdersRouter from './salesOrders'
import { createTestUser } from '../../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/sales-orders', authenticate, salesOrdersRouter)

function seedDraftSO(tenantId: string, amount = 1000) {
  const customerId = generateId()
  db.prepare(`
    INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, tenant_id)
    VALUES (?, ?, 'ลูกค้าทดสอบ', 'RETAIL', 'x', 'x@example.com', '0800000000', 'BKK', ?)
  `).run(customerId, 'CUS-' + customerId.slice(0, 8), tenantId)

  const soId = generateId()
  db.prepare(`
    INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, total_amount, status)
    VALUES (?, ?, ?, ?, ?, 'DRAFT')
  `).run(soId, tenantId, 'SO-TEST-' + soId.slice(0, 8), customerId, amount)

  return soId
}

function openSalesOrderApproval(tenantId: string, role = 'USER', threshold = 0) {
  db.prepare(`
    INSERT INTO approval_settings (id, tenant_id, role, module_type, approval_required, auto_approve_threshold)
    VALUES (?, ?, ?, 'sales_order', 1, ?)
  `).run(generateId(), tenantId, role, threshold)
}

/**
 * เดิมตรรกะนี้ query approval_settings/user_approval_permissions ตรงๆ ในไฟล์นี้เอง
 * (ไม่รู้จัก ADMIN/MASTER/can_bypass ของประตูกลาง) — เทสต์นี้ยืนยันว่าย้ายมาเรียก
 * approvalGate.service แล้วพฤติกรรมเดิม (PENDING_APPROVAL + reference_type ที่ executor รู้จัก)
 * ยังอยู่ครบ พร้อมพฤติกรรมใหม่ที่ควรได้ (ADMIN ผ่านเลย, bypass มี log ประวัติ)
 */
describe('ยืนยันคำสั่งขาย (PUT /sales-orders/:id/status → CONFIRMED) ผ่านประตูอนุมัติกลาง', () => {
  it('USER + หมวดเปิด → ถูกบล็อก, SO เป็น PENDING_APPROVAL, เกิดคำขอ module_type=sales_order/reference_type=sales_orders', async () => {
    const user = createTestUser({ role: 'USER' })
    openSalesOrderApproval(user.tenantId, 'USER')
    const soId = seedDraftSO(user.tenantId, 5000)

    const res = await request(app).put(`/api/sales-orders/${soId}/status`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ status: 'CONFIRMED' })

    expect(res.status).toBe(202)
    expect(res.body.pending_approval).toBe(true)

    const so = db.prepare('SELECT status FROM sales_orders WHERE id = ?').get(soId) as any
    expect(so.status).toBe('PENDING_APPROVAL')

    const reqRow = db.prepare(
      "SELECT * FROM approval_requests WHERE reference_id = ? AND status = 'PENDING'"
    ).get(soId) as any
    expect(reqRow).toBeTruthy()
    expect(reqRow.module_type).toBe('sales_order')
    expect(reqRow.reference_type).toBe('sales_orders')
    expect(reqRow.request_number).toMatch(/^APR/)   // เลขที่ออกจากประตูกลาง ไม่ใช่ 'APR-SO-'+Date.now() แบบเดิม
  })

  it('ADMIN → ผ่านเลย ไม่ถูกบล็อก, SO ถูกยืนยันเป็น CONFIRMED ทันที (ไม่มีคำขอ PENDING ค้าง)', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    openSalesOrderApproval(admin.tenantId, 'ADMIN')   // แม้หมวดเปิดไว้ก็ต้องผ่าน
    const soId = seedDraftSO(admin.tenantId, 5000)

    const res = await request(app).put(`/api/sales-orders/${soId}/status`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'CONFIRMED' })

    expect(res.status).toBe(200)
    const so = db.prepare('SELECT status FROM sales_orders WHERE id = ?').get(soId) as any
    expect(so.status).toBe('CONFIRMED')

    // ADMIN มี bypass ทุกหมวดโดยธรรมชาติ (hasBypass) → recordAutoAction บันทึกเป็นแถว
    // สถานะ AUTO ให้ (ไม่ใช่ PENDING ที่ต้องรออนุมัติ) เพื่อให้ผู้บริหารมองย้อนได้ว่าใครทำอะไร
    const pendingRow = db.prepare(
      "SELECT COUNT(*) c FROM approval_requests WHERE reference_id = ? AND status = 'PENDING'"
    ).get(soId) as any
    expect(pendingRow.c).toBe(0)

    const autoRow = db.prepare(
      "SELECT * FROM approval_requests WHERE reference_id = ? AND status = 'AUTO'"
    ).get(soId) as any
    expect(autoRow).toBeTruthy()
    expect(autoRow.requester_id).toBe(admin.userId)
  })

  it('USER มีสิทธิ์ can_bypass → ผ่านเลยเหมือน ADMIN แต่มี log ประวัติสถานะ AUTO', async () => {
    const user = createTestUser({ role: 'USER' })
    openSalesOrderApproval(user.tenantId, 'USER')
    db.prepare(`
      INSERT INTO user_approval_permissions (id, tenant_id, user_id, module_type, can_bypass)
      VALUES (?, ?, ?, 'sales_order', 1)
    `).run(generateId(), user.tenantId, user.userId)
    const soId = seedDraftSO(user.tenantId, 5000)

    const res = await request(app).put(`/api/sales-orders/${soId}/status`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ status: 'CONFIRMED' })

    expect(res.status).toBe(200)
    const so = db.prepare('SELECT status FROM sales_orders WHERE id = ?').get(soId) as any
    expect(so.status).toBe('CONFIRMED')

    const autoRow = db.prepare(
      "SELECT * FROM approval_requests WHERE reference_id = ? AND status = 'AUTO'"
    ).get(soId) as any
    expect(autoRow).toBeTruthy()
    expect(autoRow.requester_id).toBe(user.userId)
    expect(autoRow.module_type).toBe('sales_order')
  })

  it('ยอดต่ำกว่า auto_approve_threshold → ผ่านเลยไม่ต้องขออนุมัติ (ไม่มีคำขอ)', async () => {
    const user = createTestUser({ role: 'USER' })
    openSalesOrderApproval(user.tenantId, 'USER', 10000)   // เกณฑ์ 10,000
    const soId = seedDraftSO(user.tenantId, 3000)          // ยอด 3,000 ต่ำกว่าเกณฑ์

    const res = await request(app).put(`/api/sales-orders/${soId}/status`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ status: 'CONFIRMED' })

    expect(res.status).toBe(200)
    const reqRow = db.prepare('SELECT COUNT(*) c FROM approval_requests WHERE reference_id = ?').get(soId) as any
    expect(reqRow.c).toBe(0)
  })
})
