import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import salesOrdersRouter from './salesOrders'
import { createSalesJournal } from './shared'
import { applyStockMovement, StockMovementError } from '../../services/stockMovement.service'
import { ACC } from '../../config/accountCodes'
import { createTestUser } from '../../test/testAuth'

// ค่าขนส่ง/ค่าแพ็ค (หมวด SERVICE) ของโรงงานที่นอน: สต็อก 0 หน่วย rob แต่บรรทัดขายเป็น pcs
// เดิมเช็คสต็อกก่อนยืนยัน SO ไม่ข้ามบริการ → "สต็อกไม่เพียงพอ" ยืนยันไม่ได้ทั้งใบ
const app = express()
app.use(express.json())
app.use('/api/sales-orders', authenticate, salesOrdersRouter)

function addItem(tenantId: string, category: string, qty: number, unit: string) {
  const id = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10, 'MAIN', 'ACTIVE')`).run(id, tenantId, id, category, category, qty, unit, unit)
  return id
}

function seedSO(tenantId: string) {
  db.prepare('INSERT OR IGNORE INTO company_settings (tenant_id, name, allow_negative_stock) VALUES (?, ?, 0)').run(tenantId, 'test')
  const customerId = generateId()
  db.prepare(`INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, tenant_id)
    VALUES (?, ?, 'ลูกค้า', 'RETAIL', 'x', 'x@example.com', '0800000000', 'BKK', ?)`).run(customerId, 'C-' + customerId.slice(0, 8), tenantId)
  const goods = addItem(tenantId, 'finished', 50, 'pcs')
  const shipping = addItem(tenantId, 'SERVICE', 0, 'rob')
  const soId = generateId()
  const soNumber = 'SO-SVC-' + soId.slice(0, 8)
  db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, total_amount, status) VALUES (?, ?, ?, ?, 1100, 'DRAFT')`)
    .run(soId, tenantId, soNumber, customerId)
  const line = db.prepare(`INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_name, quantity, unit_price, total_price, unit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pcs')`)
  line.run(generateId(), tenantId, soId, goods, 'หมอน', 10, 100, 1000)
  line.run(generateId(), tenantId, soId, shipping, 'ค่าขนส่ง', 1, 100, 100)
  return { soId, soNumber, goods, shipping, customerId }
}

const qtyOf = (id: string) => (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(id) as any).quantity

describe('รายการบริการในใบสั่งขาย', () => {
  it('ยืนยัน SO ที่มีค่าขนส่ง (สต็อก 0, หน่วยไม่ตรง) + สินค้าที่มีของ ผ่าน · ไม่มี movement ของบริการ', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const { soId, goods, shipping } = seedSO(admin.tenantId)

    const detail = await request(app).get(`/api/sales-orders/${soId}`).set('Authorization', `Bearer ${admin.token}`)
    const svcLine = detail.body.data.items.find((i: any) => i.stock_item_id === shipping)
    expect(svcLine.stock_qty, 'หน้ายืนยันต้องไม่ขึ้น "ของหมด" ให้ค่าขนส่ง').toBeNull()

    const res = await request(app).put(`/api/sales-orders/${soId}/status`).set('Authorization', `Bearer ${admin.token}`).send({ status: 'CONFIRMED' })
    expect(res.status, res.body.message).toBe(200)
    expect((db.prepare('SELECT status FROM sales_orders WHERE id = ?').get(soId) as any).status).toBe('CONFIRMED')
    expect(qtyOf(goods)).toBe(40)
    expect(qtyOf(shipping)).toBe(0)
    expect((db.prepare('SELECT COUNT(*) c FROM stock_movements WHERE stock_item_id = ?').get(shipping) as any).c).toBe(0)
  })

  it('สินค้าจริงที่ของไม่พอยังถูกบล็อก', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const { soId, goods } = seedSO(admin.tenantId)
    db.prepare('UPDATE stock_items SET quantity = 5 WHERE id = ?').run(goods)
    const res = await request(app).put(`/api/sales-orders/${soId}/status`).set('Authorization', `Bearer ${admin.token}`).send({ status: 'CONFIRMED' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/สต็อกไม่เพียงพอ: หมอน/)
    expect(res.body.message).not.toMatch(/ค่าขนส่ง/)
  })

  it('ใบแจ้งหนี้: ค่าขนส่งลง 4201 รายได้ค่าบริการ ที่เหลือ 4101', () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const t = admin.tenantId
    const { soId, goods, shipping, customerId } = seedSO(t)
    const invId = generateId()
    db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, total_amount) VALUES (?, ?, ?, ?, ?, 1177)`)
      .run(invId, t, 'INV-' + invId.slice(0, 8), soId, customerId)
    const ii = db.prepare(`INSERT INTO invoice_items (id, tenant_id, invoice_id, stock_item_id, product_name, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, 'x', 1, ?, ?)`)
    ii.run(generateId(), t, invId, goods, 1000, 1000)
    ii.run(generateId(), t, invId, shipping, 100, 100)

    createSalesJournal(t, 'INVOICE', invId, 'test', 1177, 77)
    const lines = db.prepare(`SELECT a.code, jl.credit FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
      JOIN accounts a ON a.id = jl.account_id WHERE je.reference_id = ? AND jl.credit > 0`).all(invId) as any[]
    const credit = (code: string) => lines.filter(l => l.code === code).reduce((s, l) => s + l.credit, 0)
    expect(credit(ACC.REVENUE_SERVICE)).toBe(100)
    expect(credit(ACC.REVENUE_PRODUCT)).toBe(1000)
  })

  it('รับเข้า/ปรับสต็อกรายการบริการไม่ได้', () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const shipping = addItem(admin.tenantId, 'SERVICE', 0, 'rob')
    expect(() => applyStockMovement(admin.tenantId, 'x', { stockItemId: shipping, type: 'IN', quantity: 5 } as any))
      .toThrow(StockMovementError)
    expect(qtyOf(shipping)).toBe(0)
  })
})
