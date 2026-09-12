import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import purchaseRouter from './purchase.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/purchase', purchaseRouter)

/**
 * อกไก่ซื้อเป็น kg แต่นับสต็อกเป็น g — รับ 1.285 kg ไม่ใช่ "1 แพ็ค"
 * ต้องได้ แพ็คเต็ม 1 + เศษ 285 g ไม่ใช่ปัดทิ้งหรือปัดขึ้น
 */
function seed(tenantId: string, opts: { qty: number }) {
  const supplierId = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')")
    .run(supplierId, tenantId, supplierId)

  const materialId = generateId()
  db.prepare("INSERT INTO materials (id, tenant_id, code, name, unit, unit_cost) VALUES (?, ?, ?, 'อกไก่', 'g', 0.2)")
    .run(materialId, tenantId, 'MAT-' + materialId.slice(0, 5))

  const stockId = materialId  // ให้ stock_item ผูกกับ material ตรง ๆ
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, material_id, quantity, sealed_qty,
                             unit, base_unit, display_unit, location, status, unit_cost)
    VALUES (?, ?, ?, 'อกไก่', 'RAW', ?, 0, 0, 'g', 'g', 'kg', 'WH1', 'ACTIVE', 0.2)
  `).run(stockId, tenantId, 'SKU-' + stockId.slice(0, 5), materialId)

  const poId = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'APPROVED', 100, 0, 100, ?, ?)
  `).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, now, now)

  const poItemId = generateId()
  db.prepare(`
    INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty)
    VALUES (?, ?, ?, ?, 'อกไก่', ?, 'kg', 100, 100, 0)
  `).run(poItemId, tenantId, poId, materialId, opts.qty)

  const grId = generateId()
  db.prepare(`
    INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, receipt_date, status, created_at)
    VALUES (?, ?, ?, ?, ?, date('now'), 'DRAFT', ?)
  `).run(grId, tenantId, 'GR-' + grId.slice(0, 6), poId, supplierId, now)

  db.prepare(`
    INSERT INTO goods_receipt_items (id, tenant_id, goods_receipt_id, purchase_order_item_id, material_id, ordered_qty, received_qty, accepted_qty, rejected_qty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(generateId(), tenantId, grId, poItemId, materialId, opts.qty, opts.qty, opts.qty)

  return { grId, stockId }
}

const stockOf = (id: string) =>
  db.prepare('SELECT quantity, sealed_qty FROM stock_items WHERE id = ?').get(id) as any

describe('รับของที่ไม่ลงตัวเป็นแพ็ค', () => {
  it('1.285 kg → แพ็คเต็ม 1 + เศษ 285 g (ไม่ใช่ปัดทิ้ง 285 g)', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const { grId, stockId } = seed(admin.tenantId, { qty: 1.285 })

    const res = await request(app).put(`/api/purchase/goods-receipts/${grId}/confirm`)
      .set('Authorization', `Bearer ${admin.token}`).send({})
    expect(res.status).toBe(200)

    const s = stockOf(stockId)
    expect(s.sealed_qty).toBe(1)
    expect(s.quantity).toBeCloseTo(285, 6)
  })

  it('1.6 kg → แพ็คเต็ม 1 + เศษ 600 g (ไม่ใช่ปัดขึ้นเป็น 2 แพ็ค)', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const { grId, stockId } = seed(admin.tenantId, { qty: 1.6 })

    await request(app).put(`/api/purchase/goods-receipts/${grId}/confirm`)
      .set('Authorization', `Bearer ${admin.token}`).send({})

    const s = stockOf(stockId)
    expect(s.sealed_qty).toBe(1)
    expect(s.quantity).toBeCloseTo(600, 6)
  })

  it('0.505 kg → ไม่ถึงแพ็ค ลงเป็นเศษล้วน 505 g', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const { grId, stockId } = seed(admin.tenantId, { qty: 0.505 })

    await request(app).put(`/api/purchase/goods-receipts/${grId}/confirm`)
      .set('Authorization', `Bearer ${admin.token}`).send({})

    const s = stockOf(stockId)
    expect(s.sealed_qty).toBe(0)
    expect(s.quantity).toBeCloseTo(505, 6)
  })

  it('3 kg ลงตัว → 3 แพ็คเต็ม ไม่มีเศษ (พฤติกรรมเดิมไม่เปลี่ยน)', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const { grId, stockId } = seed(admin.tenantId, { qty: 3 })

    await request(app).put(`/api/purchase/goods-receipts/${grId}/confirm`)
      .set('Authorization', `Bearer ${admin.token}`).send({})

    const s = stockOf(stockId)
    expect(s.sealed_qty).toBe(3)
    expect(s.quantity).toBeCloseTo(0, 6)
  })

  it('รับแล้วยกเลิก → สต็อกกลับมาเป็น 0 เป๊ะ ทั้งแพ็คและเศษ', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const { grId, stockId } = seed(admin.tenantId, { qty: 2.35 })

    await request(app).put(`/api/purchase/goods-receipts/${grId}/confirm`)
      .set('Authorization', `Bearer ${admin.token}`).send({})
    const mid = stockOf(stockId)
    expect(mid.sealed_qty).toBe(2)
    expect(mid.quantity).toBeCloseTo(350, 6)

    const cancel = await request(app).put(`/api/purchase/goods-receipts/${grId}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'CANCELLED' })
    expect(cancel.status).toBe(200)

    const after = stockOf(stockId)
    expect(after.sealed_qty).toBe(0)
    expect(after.quantity).toBeCloseTo(0, 6)
  })
})
