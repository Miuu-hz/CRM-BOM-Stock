import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import purchaseOrderRouter from './purchaseOrder.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/purchase-orders', authenticate, purchaseOrderRouter)

/**
 * ปุ่ม "ย้อนคืนเป็นร่าง" ต้องไม่ปล่อยให้ใบที่รับของ/วางบิลไปแล้วย้อนกลับได้
 * เพราะมันไม่ได้คืนสต็อก/บัญชีให้ (และไม่ควรคืนเอง — ต้องยกเลิกเอกสารลูกก่อน)
 */
function seedApprovedPo(tenantId: string) {
  const supplierId = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'ผู้ขาย', 'ค')")
    .run(supplierId, tenantId, supplierId)

  const poId = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'APPROVED', 100, 0, 100, ?, ?)
  `).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, now, now)

  return { poId, supplierId }
}

function seedInvoice(tenantId: string, supplierId: string, opts: { headerPoId: string; alsoCoversPoIds?: string[]; status?: string }) {
  const piId = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO purchase_invoices (id, tenant_id, pi_number, supplier_id, purchase_order_id, purchase_order_ids,
      invoice_date, total_amount, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 100, ?, ?, ?)
  `).run(piId, tenantId, 'PI-' + piId.slice(0, 6), supplierId, opts.headerPoId,
    JSON.stringify([opts.headerPoId, ...(opts.alsoCoversPoIds || [])]), now, opts.status || 'ISSUED', now, now)
  return piId
}

describe('POST /purchase-orders/:id/reopen — ย้อนคืนเป็นร่าง', () => {
  it('ใบสะอาดย้อนได้ และล้าง GR DRAFT ที่ค้างอยู่ให้ด้วย', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId, supplierId } = seedApprovedPo(user.tenantId)

    const grId = generateId()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, received_by, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'tester', 'DRAFT', ?, ?)
    `).run(grId, user.tenantId, 'GR-' + grId.slice(0, 6), poId, supplierId, now, now)

    const res = await request(app).post(`/api/purchase-orders/${poId}/reopen`).set('Authorization', `Bearer ${user.token}`).send({})
    expect(res.status).toBe(200)

    const po = db.prepare('SELECT status, approved_by, approved_at FROM purchase_orders WHERE id = ?').get(poId) as any
    expect(po.status).toBe('DRAFT')
    expect(po.approved_by).toBeNull()
    expect(db.prepare('SELECT COUNT(*) c FROM goods_receipts WHERE id = ?').get(grId)).toEqual({ c: 0 })
  })

  it('มีใบรับสินค้าที่ยืนยันแล้ว ย้อนไม่ได้ — สต็อกเข้าไปแล้วต้องยกเลิกใบรับของก่อน', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId, supplierId } = seedApprovedPo(user.tenantId)

    const grId = generateId()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, received_by, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'tester', 'CONFIRMED', ?, ?)
    `).run(grId, user.tenantId, 'GR-' + grId.slice(0, 6), poId, supplierId, now, now)

    const res = await request(app).post(`/api/purchase-orders/${poId}/reopen`).set('Authorization', `Bearer ${user.token}`).send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/ใบรับสินค้า/)
    expect((db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(poId) as any).status).toBe('APPROVED')
  })

  it('ใบแจ้งหนี้ที่รวมหลาย PO ต้องล็อกใบที่เป็น "ใบที่สอง" ด้วย', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const headPo = seedApprovedPo(user.tenantId)
    const secondPo = seedApprovedPo(user.tenantId)
    // ใบแจ้งหนี้ออกในนาม PO ใบแรก แต่กินบรรทัดของใบที่สองด้วย
    seedInvoice(user.tenantId, headPo.supplierId, { headerPoId: headPo.poId, alsoCoversPoIds: [secondPo.poId] })

    const res = await request(app).post(`/api/purchase-orders/${secondPo.poId}/reopen`).set('Authorization', `Bearer ${user.token}`).send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/ใบแจ้งหนี้/)
    expect((db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(secondPo.poId) as any).status).toBe('APPROVED')
  })

  it('USER ธรรมดาย้อนคืนไม่ได้', async () => {
    const user = createTestUser({ role: 'USER' })
    const { poId } = seedApprovedPo(user.tenantId)

    const res = await request(app).post(`/api/purchase-orders/${poId}/reopen`).set('Authorization', `Bearer ${user.token}`).send({})
    expect(res.status).toBe(403)
  })
})

describe('PUT /purchase-orders/:id/status — ประตูหลังที่เคยข้ามด่านได้ทั้งหมด', () => {
  it('ส่ง status=DRAFT ตรง ๆ ต้องถูกปฏิเสธ ให้ไปใช้ปุ่มย้อนคืนแทน', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId, supplierId } = seedApprovedPo(user.tenantId)

    const grId = generateId()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, received_by, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'tester', 'CONFIRMED', ?, ?)
    `).run(grId, user.tenantId, 'GR-' + grId.slice(0, 6), poId, supplierId, now, now)

    const res = await request(app).put(`/api/purchase-orders/${poId}/status`).set('Authorization', `Bearer ${user.token}`).send({ status: 'DRAFT' })
    expect(res.status).toBe(400)
    expect((db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(poId) as any).status).toBe('APPROVED')
  })

  it('ยกเลิกใบที่มีใบแจ้งหนี้รวมหลาย PO อ้างอยู่ ต้องถูกบล็อกเหมือนกัน', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const headPo = seedApprovedPo(user.tenantId)
    const secondPo = seedApprovedPo(user.tenantId)
    seedInvoice(user.tenantId, headPo.supplierId, { headerPoId: headPo.poId, alsoCoversPoIds: [secondPo.poId] })

    const res = await request(app).put(`/api/purchase-orders/${secondPo.poId}/status`).set('Authorization', `Bearer ${user.token}`).send({ status: 'CANCELLED' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/ใบแจ้งหนี้/)
  })
})

describe('เข้าใบแจ้งหนี้แล้ว = หมดสิทธิ์ย้อนคืนเป็นร่าง (กฎเจ้าของ 2026-09-18)', () => {
  it('ใบแจ้งหนี้ที่ยกเลิกไปแล้ว ก็ยังย้อนคืนไม่ได้', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId, supplierId } = seedApprovedPo(user.tenantId)
    seedInvoice(user.tenantId, supplierId, { headerPoId: poId, status: 'CANCELLED' })

    const res = await request(app).post(`/api/purchase-orders/${poId}/reopen`).set('Authorization', `Bearer ${user.token}`).send({})
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/เคยออกใบแจ้งหนี้/)
    expect((db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(poId) as any).status).toBe('APPROVED')
  })

  it('แต่ยกเลิกใบสั่งซื้อยังทำได้ — ปิดใบไม่ใช่เปิดกลับมาแก้', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId, supplierId } = seedApprovedPo(user.tenantId)
    seedInvoice(user.tenantId, supplierId, { headerPoId: poId, status: 'CANCELLED' })

    const res = await request(app).put(`/api/purchase-orders/${poId}/status`).set('Authorization', `Bearer ${user.token}`).send({ status: 'CANCELLED' })
    expect(res.status).toBe(200)
    expect((db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(poId) as any).status).toBe('CANCELLED')
  })
})

describe('สิทธิ์ย้อนคืนเป็นร่าง — เฉพาะ ADMIN/MASTER (กฎเจ้าของ 2026-09-18)', () => {
  it('MANAGER และ POWERUSER ย้อนคืนไม่ได้ ถึงจะยกเลิกใบได้ก็ตาม', async () => {
    for (const role of ['MANAGER', 'POWERUSER'] as const) {
      const user = createTestUser({ role })
      const { poId } = seedApprovedPo(user.tenantId)

      const res = await request(app).post(`/api/purchase-orders/${poId}/reopen`).set('Authorization', `Bearer ${user.token}`).send({})
      expect(res.status, role + ' ต้องถูกปฏิเสธ').toBe(403)
      expect((db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(poId) as any).status).toBe('APPROVED')

      // แต่ยกเลิกใบยังทำได้ตามเดิม
      const cancel = await request(app).put(`/api/purchase-orders/${poId}/status`).set('Authorization', `Bearer ${user.token}`).send({ status: 'CANCELLED' })
      expect(cancel.status, role + ' ยังยกเลิกใบได้').toBe(200)
    }
  })

  it('MASTER ย้อนคืนได้', async () => {
    const user = createTestUser({ role: 'MASTER' })
    const { poId } = seedApprovedPo(user.tenantId)

    const res = await request(app).post(`/api/purchase-orders/${poId}/reopen`).set('Authorization', `Bearer ${user.token}`).send({})
    expect(res.status).toBe(200)
    expect((db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(poId) as any).status).toBe('DRAFT')
  })
})
