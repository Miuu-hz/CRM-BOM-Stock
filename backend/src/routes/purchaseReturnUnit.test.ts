import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import purchaseRouter from './purchase.routes'
import { createTestUser } from '../test/testAuth'
import { createConversion } from '../services/unitConversion.service'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/purchase', purchaseRouter)
  return app
}

const app = buildApp()

/** Seeds a supplier + DRAFT PO (just enough for POST /purchase/returns' FK checks) and a
 * stock item sold/stocked in `baseUnit`. */
function seedOrderAndItem(tenantId: string, baseUnit: string, quantity: number) {
  const supplierId = generateId()
  db.prepare(`
    INSERT INTO suppliers (id, tenant_id, code, name, contact_name, status)
    VALUES (?, ?, ?, 'Test Supplier', 'Somchai', 'ACTIVE')
  `).run(supplierId, tenantId, supplierId)

  const poId = generateId()
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status)
    VALUES (?, ?, ?, ?, 'RECEIVED')
  `).run(poId, tenantId, `PO-${poId}`, supplierId)

  const stockItemId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, 'Returnable Item', 'RAW', ?, ?, ?, 10, 'WH1', 'ACTIVE')
  `).run(stockItemId, tenantId, stockItemId, quantity, baseUnit, baseUnit)

  return { poId, stockItemId }
}

/** Create → submit → approve a return so it's ready for PUT /confirm (mirrors the real UI flow). */
async function createApprovedReturn(token: string, poId: string, items: any[]) {
  const createRes = await request(app)
    .post('/api/purchase/returns')
    .set('Authorization', `Bearer ${token}`)
    .send({ purchaseOrderId: poId, reason: 'สินค้าชำรุด', items })
  expect(createRes.status).toBe(201)
  const id = createRes.body.data.id

  await request(app).put(`/api/purchase/returns/${id}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'SUBMITTED' })
  await request(app).put(`/api/purchase/returns/${id}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'APPROVED' })

  return { id, item: createRes.body.data.items[0] }
}

describe('PUT /api/purchase/returns/:id/confirm — unit conversion', () => {
  it('persists the chosen unit on create and converts it to base unit before deducting stock (1 case → 12 pcs, not 1 pcs)', async () => {
    const { tenantId, token } = createTestUser()
    const { poId, stockItemId } = seedOrderAndItem(tenantId, 'pcs', 50)
    createConversion(tenantId, { material_id: stockItemId, from_unit: 'case', to_unit: 'pcs', conversion_factor: 12 })

    const { id, item } = await createApprovedReturn(token, poId, [
      { materialId: stockItemId, quantity: 1, unit: 'case', unitPrice: 100, reason: 'ชำรุด' },
    ])

    // บรรทัดบันทึกหน่วย "case" ไว้จริง (บั๊กเดิม: ตาราง purchase_return_items ไม่มีคอลัมน์ unit เลย)
    expect(item.unit).toBe('case')

    const confirmRes = await request(app)
      .put(`/api/purchase/returns/${id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
    expect(confirmRes.status).toBe(200)

    // คืน 1 case = 12 pcs — สต็อกต้องลดลง 12 ไม่ใช่ 1 (บั๊กเดิม: ตัดด้วยเลขดิบ ไม่แปลงหน่วย)
    const row = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockItemId) as any
    expect(row.quantity).toBe(50 - 12)

    const movement = db.prepare(`SELECT * FROM stock_movements WHERE stock_item_id = ? AND type = 'OUT' ORDER BY created_at DESC LIMIT 1`).get(stockItemId) as any
    expect(movement.quantity).toBe(12)
    expect(movement.movement_unit).toBe('case')
    expect(movement.movement_quantity).toBe(1)
  })

  it('refuses to confirm (400, Thai message) when the line unit has no conversion rule, and leaves stock untouched', async () => {
    const { tenantId, token } = createTestUser()
    const { poId, stockItemId } = seedOrderAndItem(tenantId, 'pcs', 50)
    // ไม่สร้างกฎแปลงหน่วยให้ "mysteryunit" เลย

    const { id } = await createApprovedReturn(token, poId, [
      { materialId: stockItemId, quantity: 1, unit: 'mysteryunit', unitPrice: 100, reason: 'ชำรุด' },
    ])

    const confirmRes = await request(app)
      .put(`/api/purchase/returns/${id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
    expect(confirmRes.status).toBe(400)
    expect(confirmRes.body.success).toBe(false)
    expect(confirmRes.body.message).toContain('ไม่พบการแปลงหน่วย')

    // สต็อกต้องไม่ถูกแตะเลย — ธุรกรรมต้อง rollback ทั้งก้อน (ไม่ใช่ตัดไปครึ่งทาง)
    const row = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockItemId) as any
    expect(row.quantity).toBe(50)

    const ret = db.prepare('SELECT status FROM purchase_returns WHERE id = ?').get(id) as any
    expect(ret.status).toBe('APPROVED') // ไม่กลายเป็น CONFIRMED
  })
})
