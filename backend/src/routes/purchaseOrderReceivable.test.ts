import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import purchaseOrderRouter from './purchaseOrder.routes'
import { createTestUser } from '../test/testAuth'
import { applyPurchaseOrderUpdate } from '../services/purchaseOrderUpdate.service'

const app = express()
app.use(express.json())
app.use('/api/purchase-orders', authenticate, purchaseOrderRouter)

/**
 * 2026-10-01: PO-043 ไม่ผูก SKU 13 บรรทัดแต่อนุมัติผ่าน แล้วไปพังตอนยืนยันใบรับสินค้า
 * กฎ "รับเข้าคลังได้ไหม" ต้องบล็อกตั้งแต่ส่งอนุมัติ/อนุมัติ และแก้ใบที่ออกแล้วให้มีปัญหา = ถอยเป็นร่าง
 */
function seed(tenantId: string, status: string, line: { material?: boolean; unit?: string; skip?: number }) {
  const supplierId = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'ผู้ขาย', 'ค')").run(supplierId, tenantId, supplierId)
  let stockId: string | null = null
  if (line.material) {
    stockId = generateId()
    db.prepare(`
      INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, sealed_qty, unit, base_unit, location, status, unit_cost)
      VALUES (?, ?, ?, 'ชาเขียวทดสอบ', 'RAW', 0, 0, 'pcs', 'pcs', 'WH1', 'ACTIVE', 1)
    `).run(stockId, tenantId, 'MAT-' + stockId.slice(0, 5))
  }
  const poId = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_amount, total_amount, approved_by, approved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 100, 0, 100, ?, ?, ?, ?)
  `).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, status, status === 'APPROVED' ? 'u' : null, status === 'APPROVED' ? now : null, now, now)
  db.prepare(`
    INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, skip_stock)
    VALUES (?, ?, ?, ?, 'ชาเขียว 180g', 1, ?, 100, 100, ?)
  `).run(generateId(), tenantId, poId, stockId, line.unit || 'pcs', line.skip || 0)
  return { poId, stockId }
}

const status = (poId: string) => (db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(poId) as any).status

describe('PO ที่รับเข้าคลังไม่ได้ ห้ามส่งอนุมัติ/อนุมัติ', () => {
  it('บรรทัดไม่ผูกสินค้า → ส่งอนุมัติไม่ได้ 400 + บอกชื่อรายการ', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId } = seed(user.tenantId, 'DRAFT', {})
    const res = await request(app).put(`/api/purchase-orders/${poId}/status`).set('Authorization', `Bearer ${user.token}`).send({ status: 'SUBMITTED' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/ชาเขียว 180g/)
    expect(status(poId)).toBe('DRAFT')
  })

  it('ติ๊กไม่นับสต็อก → ส่งอนุมัติได้', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId } = seed(user.tenantId, 'DRAFT', { skip: 1 })
    const res = await request(app).put(`/api/purchase-orders/${poId}/status`).set('Authorization', `Bearer ${user.token}`).send({ status: 'SUBMITTED' })
    expect(res.status).toBe(200)
  })

  it('หน่วยใน PO ไม่มีกฎแปลงไปหน่วยคลัง → receipt-check เตือน, หน่วยตรงกัน → ไม่เตือน', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { stockId } = seed(user.tenantId, 'DRAFT', { material: true })
    const check = (unit: string) => request(app).post('/api/purchase-orders/receipt-check').set('Authorization', `Bearer ${user.token}`)
      .send({ items: [{ materialId: stockId, unit, description: 'ชาเขียว' }] })
    expect((await check('หน่วยประหลาด')).body.data.issues[0]).toMatch(/กฎแปลงหน่วย/)
    expect((await check('pcs')).body.data.issues).toEqual([])
  })

  it('แก้ใบที่อนุมัติแล้วให้มีบรรทัดไม่ผูกสินค้า → ถอยกลับเป็นร่าง ล้างผู้อนุมัติ', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId } = seed(user.tenantId, 'APPROVED', { material: true })
    const result = applyPurchaseOrderUpdate(user.tenantId, poId, {
      items: [{ description: 'ของใหม่ไม่ผูก', quantity: 1, unit: 'pcs', unitPrice: 10 }] as any,
    })
    expect(result.receipt_issues.length).toBe(1)
    const po = db.prepare('SELECT status, approved_by FROM purchase_orders WHERE id = ?').get(poId) as any
    expect(po).toEqual({ status: 'DRAFT', approved_by: null })
  })
})
