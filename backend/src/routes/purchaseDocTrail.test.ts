import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import purchaseRouter from './purchase.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/purchase', authenticate, purchaseRouter)

/**
 * 2026-10-01: PI-014 รวมบิล 2 PO แต่เส้นทางเอกสารดูแค่หัวใบ — PO ที่ถูกรวมมองไม่เห็นบิล
 * และขั้นรับสินค้าไม่รู้ว่าอีก PO ยังไม่มี GR เลย (ใบร่างก็นับเป็น "รับแล้ว")
 */
function seedPo(tenantId: string, supplierId: string, qty: number) {
  const poId = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'APPROVED', 100, 0, 100, ?, ?)
  `).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, now, now)
  db.prepare(`
    INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, description, quantity, unit_price, total_price, received_qty)
    VALUES (?, ?, ?, 'ของ', ?, 10, 100, 0)
  `).run(generateId(), tenantId, poId, qty)
  return poId
}

describe('GET /purchase/doc-trail/:poId — บิลรวมหลาย PO', () => {
  it('PO ที่ถูกรวมเห็นบิล + GR ของทุก PO + เตือน PO ที่ยังรับไม่ครบ', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const t = user.tenantId
    const supplierId = generateId()
    db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'ผู้ขาย', 'ค')").run(supplierId, t, supplierId)
    const poA = seedPo(t, supplierId, 5)
    const poB = seedPo(t, supplierId, 5)
    const now = new Date().toISOString()

    // PO B มีแค่ใบรับร่าง — ร่างยังไม่เข้าคลัง ต้องยังถือว่ารับไม่ครบ
    db.prepare(`
      INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, received_by, status, created_at, updated_at)
      VALUES (?, ?, 'GR-DRAFT-B', ?, ?, 'tester', 'DRAFT', ?, ?)
    `).run(generateId(), t, poB, supplierId, now, now)
    // บิลหัวใบเป็น A แต่รวม B ไว้ด้วย
    db.prepare(`
      INSERT INTO purchase_invoices (id, tenant_id, pi_number, supplier_id, purchase_order_id, purchase_order_ids,
        invoice_date, total_amount, balance_amount, status, created_at, updated_at)
      VALUES (?, ?, 'PI-COMBINED', ?, ?, ?, ?, 200, 200, 'ISSUED', ?, ?)
    `).run(generateId(), t, supplierId, poA, JSON.stringify([poA, poB]), now, now, now)

    const res = await request(app).get(`/api/purchase/doc-trail/${poB}`).set('Authorization', `Bearer ${user.token}`)
    expect(res.status).toBe(200)
    const stage = (k: string) => res.body.data.stages.find((s: any) => s.key === k)

    expect(stage('invoice').docNumber).toBe('PI-COMBINED')        // เดิม: null เพราะดูแค่หัวใบ
    expect(stage('order').count).toBe(2)
    expect(stage('receipt').docs.map((d: any) => d.gr_number)).toEqual(['GR-DRAFT-B'])
    expect(stage('receipt').done).toBe(false)
    expect(stage('receipt').gaps).toHaveLength(2)                 // A ไม่มี GR, B มีแค่ร่าง

    // ยืนยันรับครบทั้งสองใบ → ไม่เตือนแล้ว
    db.prepare('UPDATE purchase_order_items SET received_qty = quantity WHERE purchase_order_id IN (?, ?)').run(poA, poB)
    db.prepare("UPDATE goods_receipts SET status = 'CONFIRMED' WHERE purchase_order_id = ?").run(poB)
    const after = await request(app).get(`/api/purchase/doc-trail/${poA}`).set('Authorization', `Bearer ${user.token}`)
    const r = after.body.data.stages.find((s: any) => s.key === 'receipt')
    expect(r.gaps).toHaveLength(0)
    expect(r.done).toBe(true)
  })
})
