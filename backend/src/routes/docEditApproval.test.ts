import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import poRouter from './purchaseOrder.routes'
import approvalRouter from './approval.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/purchase-orders', poRouter)
app.use('/api/approval', approvalRouter)

function seedSupplier(tenantId: string) {
  const id = generateId()
  db.prepare(`
    INSERT INTO suppliers (id, tenant_id, code, name, contact_name)
    VALUES (?, ?, ?, 'Test Supplier', 'Contact')
  `).run(id, tenantId, id)
  return id
}

function seedPO(tenantId: string, status: string) {
  const id = generateId()
  const supplierId = seedSupplier(tenantId)
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1000, 70, 1070, ?, ?)
  `).run(id, tenantId, 'PO-' + id.slice(0, 6), supplierId, status, new Date().toISOString(), new Date().toISOString())
  return { id, supplierId }
}

function openDocEdit(tenantId: string, role = 'USER') {
  db.prepare(`
    INSERT INTO approval_settings (id, tenant_id, role, module_type, approval_required, auto_approve_threshold)
    VALUES (?, ?, ?, 'doc_edit', 1, 0)
    ON CONFLICT(tenant_id, role, module_type) DO UPDATE SET approval_required = 1
  `).run(generateId(), tenantId, role)
}

const totalOf = (id: string) =>
  (db.prepare('SELECT total_amount FROM purchase_orders WHERE id = ?').get(id) as any).total_amount

const edit = (token: string, po: { id: string; supplierId: string }) =>
  request(app).put(`/api/purchase-orders/${po.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ supplierId: po.supplierId, items: [{ quantity: 2, unitPrice: 5000 }], taxRate: 0 })

const pendingOf = (poId: string) =>
  db.prepare("SELECT * FROM approval_requests WHERE reference_id = ? AND status = 'PENDING'").get(poId) as any

describe('หมวดแก้เอกสารที่ออกไปแล้ว — draft รออนุมัติ (โหมดเดียวกับหมวดปรับสต็อก/ยกเลิกบิล POS)', () => {
  it('ใบที่ออกไปแล้ว: พนักงานกดแก้ → เก็บเป็น draft รออนุมัติ ของจริงยังไม่เปลี่ยน', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openDocEdit(admin.tenantId)
    const po = seedPO(admin.tenantId, 'APPROVED')

    const res = await edit(user.token, po)

    expect(res.status).toBe(202)
    expect(res.body.pending_approval).toBe(true)
    expect(res.body.message).toContain('ส่งคำขออนุมัติแล้ว')
    expect(totalOf(po.id)).toBe(1070)          // ยังไม่ถูกแก้

    const pending = pendingOf(po.id)
    expect(pending).toBeTruthy()
    const stored = JSON.parse(pending.payload)
    expect(stored.before.header.total_amount).toBe(1070)   // เก็บก่อน-แก้ไว้เทียบทีหลัง
    expect(stored.update.items[0].unitPrice).toBe(5000)    // ค่าที่พนักงานเสนอ
  })

  it('เจ้าของอนุมัติ draft → PO เปลี่ยนค่าตามที่พนักงานเสนอไว้เป๊ะ', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openDocEdit(admin.tenantId)
    const po = seedPO(admin.tenantId, 'APPROVED')

    await edit(user.token, po)
    const pending = pendingOf(po.id)

    const res = await request(app).put(`/api/approval/requests/${pending.id}/decision`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'APPROVED', level: 1 })

    expect(res.status).toBe(200)
    expect(totalOf(po.id)).toBe(10000)         // แก้ติดแล้ว ตรงกับ draft เป๊ะ
  })

  it('เจ้าของปฏิเสธ draft → PO ไม่เปลี่ยนแปลง', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openDocEdit(admin.tenantId)
    const po = seedPO(admin.tenantId, 'APPROVED')

    await edit(user.token, po)
    const pending = pendingOf(po.id)
    await request(app).put(`/api/approval/requests/${pending.id}/decision`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'REJECTED', comment: 'ไม่อนุมัติ', level: 1 })

    expect(totalOf(po.id)).toBe(1070)
  })

  it('กดแก้ซ้ำ ๆ ไม่สร้างคำขอท่วม inbox', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openDocEdit(admin.tenantId)
    const po = seedPO(admin.tenantId, 'SUBMITTED')

    await edit(user.token, po)
    const second = await edit(user.token, po)

    expect(second.status).toBe(202)
    const count = db.prepare("SELECT COUNT(*) c FROM approval_requests WHERE reference_id = ?").get(po.id) as any
    expect(count.c).toBe(1)
  })

  it('ใบร่างยังแก้ได้อิสระ ไม่ต้องขออนุมัติ', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    openDocEdit(admin.tenantId)
    const po = seedPO(admin.tenantId, 'DRAFT')

    const res = await edit(user.token, po)
    expect(res.status).toBe(200)
    expect(totalOf(po.id)).toBe(10000)
  })

  it('ADMIN แก้ได้เลยไม่ต้องขอใคร', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    openDocEdit(admin.tenantId, 'ADMIN')
    const po = seedPO(admin.tenantId, 'RECEIVED')

    const res = await edit(admin.token, po)
    expect(res.status).toBe(200)
  })

  it('หมวดปิดอยู่ → พฤติกรรมเดิม (แก้ได้ทันที)', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const po = seedPO(admin.tenantId, 'APPROVED')   // ไม่เปิดหมวด

    const res = await edit(user.token, po)
    expect(res.status).toBe(200)
  })
})
