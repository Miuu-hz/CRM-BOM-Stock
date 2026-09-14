import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import purchaseRouter from '../routes/purchase.routes'
import { createTestUser } from '../test/testAuth'
import { createGoodsReceipt, confirmGoodsReceipt, GoodsReceiptError } from './goodsReceipt.service'

const app = express()
app.use(express.json())
app.use('/api/purchase', authenticate, purchaseRouter)

/**
 * เทสต์ตรง service ที่ยกออกมาจาก routes/purchase.routes.ts (ตัวที่ REST/MCP เรียกร่วมกันแล้ว)
 * ครอบคลุมบั๊ก #3 (ยืนยัน GR ที่ CANCELLED ซ้ำได้), #4 (รับเกินยอดค้าง), unit conversion,
 * snapshot, และ cancel คืนสต็อกเป๊ะ — ผ่าน REST route จริงเพื่อคุมทั้งเส้นทาง
 */

function seedPoWithMaterial(tenantId: string, opts: { poUnit?: string; stockUnit?: string; qty?: number } = {}) {
  const supplierId = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')")
    .run(supplierId, tenantId, supplierId)

  const materialId = generateId()
  db.prepare("INSERT INTO materials (id, tenant_id, code, name, unit, unit_cost) VALUES (?, ?, ?, 'วัตถุดิบทดสอบ', ?, 1)")
    .run(materialId, tenantId, 'MAT-' + materialId.slice(0, 5), opts.stockUnit || 'pcs')

  const stockId = materialId
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, material_id, quantity, sealed_qty,
                             unit, base_unit, location, status, unit_cost)
    VALUES (?, ?, ?, 'วัตถุดิบทดสอบ', 'RAW', ?, 0, 0, ?, ?, 'WH1', 'ACTIVE', 1)
  `).run(stockId, tenantId, 'SKU-' + stockId.slice(0, 5), materialId, opts.stockUnit || 'pcs', opts.stockUnit || 'pcs')

  const poId = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'APPROVED', 100, 0, 100, ?, ?)
  `).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, now, now)

  const poItemId = generateId()
  db.prepare(`
    INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty)
    VALUES (?, ?, ?, ?, 'วัตถุดิบทดสอบ', ?, ?, 10, 10, 0)
  `).run(poItemId, tenantId, poId, materialId, opts.qty ?? 5, opts.poUnit || 'pcs')

  return { poId, poItemId, materialId, stockId }
}

describe('goodsReceipt.service — createGoodsReceipt', () => {
  it('รับเกินยอดค้างไม่ได้ (Bug #4)', () => {
    const { tenantId, email } = createTestUser({ role: 'ADMIN' })
    const { poId, poItemId } = seedPoWithMaterial(tenantId, { qty: 5 })

    expect(() =>
      createGoodsReceipt(tenantId, email, {
        purchaseOrderId: poId,
        items: [{ poItemId, orderedQty: 5, receivedQty: 999, acceptedQty: 999 }],
      })
    ).toThrow(GoodsReceiptError)

    try {
      createGoodsReceipt(tenantId, email, {
        purchaseOrderId: poId,
        items: [{ poItemId, orderedQty: 5, receivedQty: 999, acceptedQty: 999 }],
      })
    } catch (e: any) {
      expect(e.code).toBe('OVER_PENDING_QTY')
    }
  })

  it('รับพอดียอดค้างสร้างได้ปกติ', () => {
    const { tenantId, email } = createTestUser({ role: 'ADMIN' })
    const { poId, poItemId } = seedPoWithMaterial(tenantId, { qty: 5 })

    const gr = createGoodsReceipt(tenantId, email, {
      purchaseOrderId: poId,
      items: [{ poItemId, orderedQty: 5, receivedQty: 5, acceptedQty: 5 }],
    }) as any
    expect(gr.status).toBe('DRAFT')
    expect(gr.items).toHaveLength(1)
  })

  it('มี DRAFT ค้างอยู่แล้ว สร้างซ้ำไม่ได้', () => {
    const { tenantId, email } = createTestUser({ role: 'ADMIN' })
    const { poId, poItemId } = seedPoWithMaterial(tenantId, { qty: 5 })
    createGoodsReceipt(tenantId, email, { purchaseOrderId: poId, items: [{ poItemId, orderedQty: 5, receivedQty: 2, acceptedQty: 2 }] })

    expect(() =>
      createGoodsReceipt(tenantId, email, { purchaseOrderId: poId, items: [{ poItemId, orderedQty: 5, receivedQty: 1, acceptedQty: 1 }] })
    ).toThrow(GoodsReceiptError)
  })
})

describe('goodsReceipt.service — confirmGoodsReceipt', () => {
  it('ยืนยัน GR ที่ถูกยกเลิกแล้วซ้ำไม่ได้ (Bug #3 — เดิมเช็คแค่ === CONFIRMED)', () => {
    const { tenantId, userId, email } = createTestUser({ role: 'ADMIN' })
    const { poId, poItemId, materialId, stockId } = seedPoWithMaterial(tenantId, { qty: 5 })
    const gr = createGoodsReceipt(tenantId, email, { purchaseOrderId: poId, items: [{ poItemId, materialId, orderedQty: 5, receivedQty: 5, acceptedQty: 5 }] }) as any

    confirmGoodsReceipt(tenantId, userId, gr.id)
    expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockId) as any).quantity).toBeCloseTo(5, 6)

    // ยกเลิกตรงๆ ในฐานข้อมูล (จำลองสถานะ CANCELLED โดยไม่ผ่าน reverse — พอสำหรับเช็ค guard การยืนยันซ้ำ)
    db.prepare("UPDATE goods_receipts SET status = 'CANCELLED' WHERE id = ?").run(gr.id)

    expect(() => confirmGoodsReceipt(tenantId, userId, gr.id)).toThrow(GoodsReceiptError)
    try {
      confirmGoodsReceipt(tenantId, userId, gr.id)
    } catch (e: any) {
      expect(e.code).toBe('NOT_DRAFT')
    }
    // สต็อกต้องไม่ถูกบวกซ้ำรอบสอง
    expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockId) as any).quantity).toBeCloseTo(5, 6)
  })

  it('ยืนยัน GR ที่ CONFIRMED แล้วซ้ำไม่ได้ (ของเดิมยังต้องกันได้เหมือนก่อน)', () => {
    const { tenantId, userId, email } = createTestUser({ role: 'ADMIN' })
    const { poId, poItemId, materialId } = seedPoWithMaterial(tenantId, { qty: 5 })
    const gr = createGoodsReceipt(tenantId, email, { purchaseOrderId: poId, items: [{ poItemId, materialId, orderedQty: 5, receivedQty: 5, acceptedQty: 5 }] }) as any
    confirmGoodsReceipt(tenantId, userId, gr.id)

    try {
      confirmGoodsReceipt(tenantId, userId, gr.id)
      throw new Error('should have thrown')
    } catch (e: any) {
      expect(e.code).toBe('NOT_DRAFT')
    }
  })

  it('แปลงหน่วยถูก: ซื้อเป็น kg เข้าสต็อกเป็น g ตามอัตราแปลงมาตรฐาน 1000', () => {
    const { tenantId, userId, email } = createTestUser({ role: 'ADMIN' })
    const { poId, poItemId, materialId, stockId } = seedPoWithMaterial(tenantId, { poUnit: 'kg', stockUnit: 'g', qty: 2 })
    const gr = createGoodsReceipt(tenantId, email, { purchaseOrderId: poId, items: [{ poItemId, materialId, orderedQty: 2, receivedQty: 2, acceptedQty: 2 }] }) as any

    confirmGoodsReceipt(tenantId, userId, gr.id)

    const stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockId) as any
    expect(stock.quantity).toBeCloseTo(2000, 6) // 2 kg → 2000 g

    // snapshot ต้องถูกเขียนไว้ให้ cancel อ่านกลับ
    const griRow = db.prepare('SELECT stock_item_id, stock_qty, stock_factor FROM goods_receipt_items WHERE goods_receipt_id = ?').get(gr.id) as any
    expect(griRow.stock_item_id).toBe(stockId)
    expect(griRow.stock_qty).toBeCloseTo(2000, 6)
    expect(griRow.stock_factor).toBeCloseTo(1000, 6)
  })

  it('ยกเลิก GR ที่ยืนยันแล้ว → สต็อกกลับเท่าเดิมเป๊ะ (ผ่าน REST cancel เพราะ reverse ยังอยู่ที่ routes)', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId, poItemId, materialId, stockId } = seedPoWithMaterial(user.tenantId, { poUnit: 'kg', stockUnit: 'g', qty: 3 })
    const gr = createGoodsReceipt(user.tenantId, user.email, { purchaseOrderId: poId, items: [{ poItemId, materialId, orderedQty: 3, receivedQty: 3, acceptedQty: 3 }] }) as any

    confirmGoodsReceipt(user.tenantId, user.userId, gr.id)
    expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockId) as any).quantity).toBeCloseTo(3000, 6)

    const cancel = await request(app).put(`/api/purchase/goods-receipts/${gr.id}/status`)
      .set('Authorization', `Bearer ${user.token}`).send({ status: 'CANCELLED' })
    expect(cancel.status).toBe(200)

    const after = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockId) as any
    expect(after.quantity).toBeCloseTo(0, 6)
  })
})
