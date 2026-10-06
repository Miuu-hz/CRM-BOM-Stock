import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import creditNotesRouter from './creditNotes'
import deliveryOrdersRouter from './deliveryOrders'
import { createTestUser } from '../../test/testAuth'
import { ACC } from '../../config/accountCodes'
import { createConversion } from '../../services/unitConversion.service'
import { saveAlias } from '../../services/stockItem.service'
import { deductStockForSO, restoreStockForSO, issuedBasePerUnit } from './shared'

/**
 * movement ขาย/ส่งของ/คืน ผูกบรรทัด SO (stock_movements.source_line_id) — ใบลดหนี้คืนตามตัวคูณที่ตัดจริงรายบรรทัด
 * แม้สินค้าเดียวกันหลายบรรทัด (ชื่อเรียกแทนคนละขนาดแพ็ค) หรือของออกผ่านใบส่งของ
 * + ยกเลิก SO เอกสารเก่า (ไม่มี movement OUT) ไม่คืนซ้ำ/ไม่กลับต้นทุนซ้ำกับที่ใบลดหนี้ทำไปแล้ว
 * + ใบส่งของที่ส่งแล้ว/ยกเลิกแล้ว ย้อนสถานะไม่ได้
 */
const app = express()
app.use(express.json())
app.use('/api/sales/credit-notes', authenticate, creditNotesRouter)
app.use('/api/sales/delivery-orders', authenticate, deliveryOrdersRouter)

const stockQty = (id: string) => (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(id) as any).quantity
function balanceOf(tenantId: string, code: string) {
  const row = db.prepare(`SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS bal
    FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.tenant_id = ? AND a.code = ?`).get(tenantId, code) as any
  return Math.round((row.bal || 0) * 100) / 100
}

/** สินค้า "น้ำดื่ม" หน่วยฐานขวด ต้นทุน 5 · กฎสินค้า 1 แพ็ค = 12 · ชื่อเรียกแทน "น้ำดื่มสิงห์" 1 แพ็ค = 15 */
function setup(base: { unit: string; cost: number; qty: number } = { unit: 'bottle', cost: 5, qty: 1000 }) {
  const user = createTestUser({ role: 'ADMIN' })
  const t = user.tenantId
  db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock, stock_alias_enabled) VALUES (?, ?, 0, 1)').run(t, 'test')
  const stockId = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, unit_price, location, status)
    VALUES (?, ?, ?, 'น้ำดื่ม', 'FINISHED', ?, ?, ?, ?, 7, 'STOCK', 'ACTIVE')`)
    .run(stockId, t, 'SKU-' + stockId.slice(0, 8), base.qty, base.unit, base.unit, base.cost)
  createConversion(t, { material_id: stockId, from_unit: 'pack', to_unit: 'bottle', conversion_factor: 12 })
  saveAlias(t, { name: 'น้ำดื่มสิงห์', stockItemId: stockId, unit: 'pack', factor: 15 }, user.userId)
  const customerId = generateId()
  db.prepare(`INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city)
    VALUES (?, ?, ?, 'ลูกค้า', 'RETAIL', '-', '-', '-', '-')`).run(customerId, t, 'C-' + customerId.slice(0, 6))
  return { user, t, stockId, customerId }
}

function soWith(s: ReturnType<typeof setup>, lines: Array<{ name: string; qty: number; unit: string }>, status = 'CONFIRMED') {
  const soId = generateId()
  const soNumber = 'SO-LL-' + soId.slice(0, 6)
  db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, status) VALUES (?, ?, ?, ?, ?)`)
    .run(soId, s.t, soNumber, s.customerId, status)
  const lineIds = lines.map(l => {
    const id = generateId()
    db.prepare(`INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_name, quantity, unit, unit_price, total_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, 100, ?)`).run(id, s.t, soId, s.stockId, l.name, l.qty, l.unit, l.qty * 100)
    return id
  })
  return { soId, soNumber, lineIds }
}

/** ออกใบแจ้งหนี้ของ SO + ใบลดหนี้รับคืน (qty ในหน่วยของบรรทัด) แล้วกด ISSUED ผ่าน API */
async function returnViaCreditNote(s: ReturnType<typeof setup>, soId: string, returns: Array<{ lineId: string; qty: number }>) {
  const invoiceId = generateId()
  db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id) VALUES (?, ?, ?, ?, ?)`)
    .run(invoiceId, s.t, 'INV-' + invoiceId.slice(0, 6), soId, s.customerId)
  const cnId = generateId()
  db.prepare(`INSERT INTO credit_notes (id, tenant_id, cn_number, invoice_id, customer_id, credit_date, reason, subtotal, tax_rate, tax_amount, total_amount, status)
    VALUES (?, ?, ?, ?, ?, ?, 'รับคืนสินค้า', 0, 0, 0, 0, 'DRAFT')`)
    .run(cnId, s.t, 'CN-' + cnId.slice(0, 6), invoiceId, s.customerId, new Date().toISOString())
  for (const r of returns) {
    const line = db.prepare('SELECT * FROM sales_order_items WHERE id = ?').get(r.lineId) as any
    const invItemId = generateId()
    db.prepare(`INSERT INTO invoice_items (id, tenant_id, invoice_id, sales_order_item_id, stock_item_id, product_name, quantity, unit_price, total_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, 100, ?)`).run(invItemId, s.t, invoiceId, r.lineId, s.stockId, line.product_name, line.quantity, line.quantity * 100)
    db.prepare(`INSERT INTO credit_note_items (id, tenant_id, credit_note_id, invoice_item_id, quantity, unit_price, total_price)
      VALUES (?, ?, ?, ?, ?, 100, ?)`).run(generateId(), s.t, cnId, invItemId, r.qty, r.qty * 100)
  }
  const res = await request(app).put(`/api/sales/credit-notes/${cnId}/status`)
    .set('Authorization', `Bearer ${s.user.token}`).send({ status: 'ISSUED' })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
}

function doFor(t: string, soId: string, qtyByLine?: Record<string, number>) {
  const so = db.prepare('SELECT customer_id FROM sales_orders WHERE id = ?').get(soId) as any
  const doId = generateId()
  db.prepare(`INSERT INTO delivery_orders (id, tenant_id, do_number, sales_order_id, customer_id, status) VALUES (?, ?, ?, ?, ?, 'SHIPPED')`)
    .run(doId, t, 'DO-LL-' + doId.slice(0, 6), soId, so.customer_id)
  for (const line of db.prepare('SELECT id, quantity FROM sales_order_items WHERE sales_order_id = ?').all(soId) as any[]) {
    db.prepare('INSERT INTO delivery_order_items (id, tenant_id, delivery_order_id, sales_order_item_id, quantity) VALUES (?, ?, ?, ?, ?)')
      .run(generateId(), t, doId, line.id, qtyByLine?.[line.id] ?? line.quantity)
  }
  return doId
}
const setDoStatus = (token: string, doId: string, status: string) =>
  request(app).put(`/api/sales/delivery-orders/${doId}/status`).set('Authorization', `Bearer ${token}`).send({ status })

describe('ใบลดหนี้คืนตามตัวคูณที่ตัดจริงรายบรรทัด (source_line_id)', () => {
  it('SO 2 บรรทัดสินค้าเดียวกันคนละขนาดแพ็ค → แก้ตัวคูณ → CN คืนบรรทัดละตัวคูณเดิม · ยกเลิกคืนส่วนที่เหลือ · งบตรง', async () => {
    const s = setup()
    const so = soWith(s, [
      { name: 'น้ำดื่มสิงห์', qty: 2, unit: 'pack' },   // 2 × 15 = 30
      { name: 'น้ำดื่มทั่วไป', qty: 1, unit: 'pack' },  // 1 × 12 = 12
    ])
    deductStockForSO(s.t, so.soId, so.soNumber)
    expect(stockQty(s.stockId)).toBe(958)

    saveAlias(s.t, { name: 'น้ำดื่มสิงห์', stockItemId: s.stockId, unit: 'pack', factor: 12 }, s.user.userId)
    expect(issuedBasePerUnit(s.t, so.lineIds[0]), 'บรรทัดสิงห์ตัดไป 15/แพ็ค').toBe(15)
    expect(issuedBasePerUnit(s.t, so.lineIds[1]), 'บรรทัดทั่วไปตัดไป 12/แพ็ค').toBe(12)

    await returnViaCreditNote(s, so.soId, [{ lineId: so.lineIds[0], qty: 1 }, { lineId: so.lineIds[1], qty: 1 }])
    expect(stockQty(s.stockId), 'คืน 15 + 12 ไม่ใช่ 12 + 12').toBe(985)
    expect(issuedBasePerUnit(s.t, so.lineIds[0]), 'คืนบางส่วนแล้วตัวคูณคงเดิม').toBe(15)
    expect(issuedBasePerUnit(s.t, so.lineIds[1]), 'คืนครบ = ไม่มีของค้าง → แปลงแบบเดิม').toBeNull()

    restoreStockForSO(s.t, so.soId, so.soNumber)
    expect(stockQty(s.stockId), 'ยกเลิกคืนเฉพาะ 15 ที่ยังค้าง').toBe(1000)
    const rets = db.prepare(`SELECT source_line_id, quantity FROM stock_movements WHERE tenant_id = ? AND type = 'RETURN' AND reference = ?`)
      .all(s.t, 'SO: ' + so.soNumber) as any[]
    expect(rets).toEqual([{ source_line_id: so.lineIds[0], quantity: 15 }])
    expect(balanceOf(s.t, ACC.INVENTORY), 'สต็อกในงบกลับครบ (ขาย 210 / CN 135 / ยกเลิก 75)').toBe(0)
    expect(balanceOf(s.t, ACC.COGS_PRODUCT)).toBe(0)
  })

  it('ของออกผ่านใบส่งของ (ส่ง 1 จาก 2 แพ็ค) → แก้ตัวคูณ → CN คืนเท่าที่ออกจริง 15 ไม่ใช่ 12 หรือ 7.5', async () => {
    const s = setup()
    const so = soWith(s, [{ name: 'น้ำดื่มสิงห์', qty: 2, unit: 'pack' }], 'DRAFT')
    const doId = doFor(s.t, so.soId, { [so.lineIds[0]]: 1 })
    expect((await setDoStatus(s.user.token, doId, 'DELIVERED')).status).toBe(200)
    expect(stockQty(s.stockId)).toBe(985)

    saveAlias(s.t, { name: 'น้ำดื่มสิงห์', stockItemId: s.stockId, unit: 'pack', factor: 12 }, s.user.userId)
    expect(issuedBasePerUnit(s.t, so.lineIds[0]), 'หารด้วยจำนวนที่ส่งจริง ไม่ใช่จำนวนบรรทัด').toBe(15)

    await returnViaCreditNote(s, so.soId, [{ lineId: so.lineIds[0], qty: 1 }])
    expect(stockQty(s.stockId)).toBe(1000)
    restoreStockForSO(s.t, so.soId, so.soNumber)
    expect(stockQty(s.stockId), 'ยกเลิก SO หลังคืนครบ ไม่คืนเพิ่ม').toBe(1000)
  })
})

describe('ใบส่งของตัดสต็อก (SO ยังไม่ยืนยัน) ลงต้นทุนขาย · สต็อกในงบ = สต็อกจริงทุกขั้น', () => {
  it('ส่ง 2 รอบต้นทุนต่างกัน (5 แล้ว 7) → CN คืน 1 แพ็ค → ยกเลิก SO: กลับต้นทุนพอดี', async () => {
    const s = setup()
    const so = soWith(s, [{ name: 'น้ำดื่มสิงห์', qty: 2, unit: 'pack' }], 'DRAFT')
    const gl = (inv: number, label: string) => {
      expect(balanceOf(s.t, ACC.INVENTORY) + inv, label).toBe(0)
      expect(balanceOf(s.t, ACC.COGS_PRODUCT), label).toBe(inv)
    }
    expect((await setDoStatus(s.user.token, doFor(s.t, so.soId, { [so.lineIds[0]]: 1 }), 'DELIVERED')).status).toBe(200)
    expect(stockQty(s.stockId)).toBe(985); gl(75, 'DO1: 15 × 5')

    db.prepare('UPDATE stock_items SET unit_cost = 7 WHERE id = ?').run(s.stockId) // รับของล็อตใหม่ทุนขยับ
    expect((await setDoStatus(s.user.token, doFor(s.t, so.soId, { [so.lineIds[0]]: 1 }), 'DELIVERED')).status).toBe(200)
    expect(stockQty(s.stockId)).toBe(970); gl(180, 'DO2: + 15 × 7')
    expect((db.prepare('SELECT issued_unit_cost FROM sales_order_items WHERE id = ?').get(so.lineIds[0]) as any).issued_unit_cost).toBe(6)

    await returnViaCreditNote(s, so.soId, [{ lineId: so.lineIds[0], qty: 1 }])
    expect(stockQty(s.stockId)).toBe(985); gl(90, 'CN คืน 15 × ทุนเฉลี่ย 6')
    restoreStockForSO(s.t, so.soId, so.soNumber)
    expect(stockQty(s.stockId)).toBe(1000); gl(0, 'ยกเลิก SO')
  })

  it('ส่งของบน SO ร่าง 1 จาก 2 แพ็ค แล้วยืนยัน SO → ตัดแค่ส่วนที่เหลือ ต้นทุนไม่ลงซ้ำ · ส่งต่อหลังยืนยันไม่ตัดซ้ำ', async () => {
    const s = setup()
    const so = soWith(s, [{ name: 'น้ำดื่มสิงห์', qty: 2, unit: 'pack' }], 'DRAFT')
    expect((await setDoStatus(s.user.token, doFor(s.t, so.soId, { [so.lineIds[0]]: 1 }), 'DELIVERED')).status).toBe(200)
    expect(stockQty(s.stockId)).toBe(985)

    deductStockForSO(s.t, so.soId, so.soNumber)
    expect(stockQty(s.stockId), 'ไม่ตัด 30 ซ้ำ — ตัดแค่ 15 ที่เหลือ').toBe(970)
    expect(balanceOf(s.t, ACC.INVENTORY)).toBe(-150)
    expect(balanceOf(s.t, ACC.COGS_PRODUCT)).toBe(150)
    deductStockForSO(s.t, so.soId, so.soNumber) // เรียกซ้ำ: ของออกครบแล้ว ไม่ตัด ไม่ลงต้นทุน
    expect(stockQty(s.stockId)).toBe(970)
    expect(balanceOf(s.t, ACC.INVENTORY)).toBe(-150)

    expect((await setDoStatus(s.user.token, doFor(s.t, so.soId, { [so.lineIds[0]]: 1 }), 'DELIVERED')).status).toBe(200)
    expect(stockQty(s.stockId), 'SO ตัดแล้ว DO ไม่ตัด').toBe(970)

    restoreStockForSO(s.t, so.soId, so.soNumber)
    expect(stockQty(s.stockId)).toBe(1000)
    expect(balanceOf(s.t, ACC.INVENTORY)).toBe(0)
    expect(balanceOf(s.t, ACC.COGS_PRODUCT)).toBe(0)
  })
})

describe('ออกใบลดหนี้รับคืนแต่คืนสต็อกไม่ได้ → ล้มทั้งใบ', () => {
  it('ไม่มีการแปลงหน่วย → 422 ข้อความไทยบอกที่ตั้ง · ใบยังเป็น DRAFT · ไม่ลงบัญชี · สต็อกไม่ขยับ', async () => {
    const s = setup()
    createConversion(s.t, { material_id: s.stockId, from_unit: 'box', to_unit: 'bottle', conversion_factor: 6 })
    const so = soWith(s, [{ name: 'น้ำดื่ม', qty: 2, unit: 'box' }])
    deductStockForSO(s.t, so.soId, so.soNumber)
    expect(stockQty(s.stockId)).toBe(988)
    // เอกสารเก่า (movement ไม่ผูกบรรทัด) + ลบกฎแปลงหน่วยทิ้ง → ไม่มีทางรู้ว่า 1 box = กี่ขวด
    db.prepare("UPDATE stock_movements SET source_line_id = NULL WHERE tenant_id = ?").run(s.t)
    db.prepare("DELETE FROM unit_conversions WHERE tenant_id = ? AND from_unit = 'box'").run(s.t)
    db.prepare("INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_name, quantity, unit, unit_price, total_price) VALUES (?, ?, ?, ?, 'น้ำดื่ม', 1, 'bottle', 7, 7)")
      .run(generateId(), s.t, so.soId, s.stockId) // บรรทัดพี่น้อง → ทางสำรองหาตัวคูณจาก SO ไม่ได้

    const invoiceId = generateId()
    db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id) VALUES (?, ?, ?, ?, ?)`)
      .run(invoiceId, s.t, 'INV-' + invoiceId.slice(0, 6), so.soId, s.customerId)
    const invItemId = generateId()
    db.prepare(`INSERT INTO invoice_items (id, tenant_id, invoice_id, sales_order_item_id, stock_item_id, product_name, quantity, unit_price, total_price)
      VALUES (?, ?, ?, ?, ?, 'น้ำดื่ม', 2, 100, 200)`).run(invItemId, s.t, invoiceId, so.lineIds[0], s.stockId)
    const cnId = generateId()
    db.prepare(`INSERT INTO credit_notes (id, tenant_id, cn_number, invoice_id, customer_id, credit_date, reason, subtotal, tax_rate, tax_amount, total_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, 'รับคืนสินค้า', 100, 0, 0, 100, 'DRAFT')`).run(cnId, s.t, 'CN-' + cnId.slice(0, 6), invoiceId, s.customerId, new Date().toISOString())
    db.prepare(`INSERT INTO credit_note_items (id, tenant_id, credit_note_id, invoice_item_id, quantity, unit_price, total_price)
      VALUES (?, ?, ?, ?, 1, 100, 100)`).run(generateId(), s.t, cnId, invItemId)

    const res = await request(app).put(`/api/sales/credit-notes/${cnId}/status`)
      .set('Authorization', `Bearer ${s.user.token}`).send({ status: 'ISSUED' })
    expect(res.status).toBe(422)
    expect(res.body.message).toContain('ไม่พบการแปลงหน่วย box')
    expect(res.body.message).toContain('การแปลงหน่วย')
    expect((db.prepare('SELECT status FROM credit_notes WHERE id = ?').get(cnId) as any).status).toBe('DRAFT')
    expect(db.prepare("SELECT 1 FROM journal_entries WHERE tenant_id = ? AND reference_id = ?").get(s.t, cnId)).toBeUndefined()
    expect(stockQty(s.stockId)).toBe(988)
  })
})

describe('ยกเลิก SO เอกสารเก่า (ไม่มี movement OUT) นับที่ใบลดหนี้คืนไปแล้ว', () => {
  it('ขาย 10 @100 → (movement OUT หาย) → CN คืน 4 → ยกเลิก: คืน 6 · กลับต้นทุน 600 ไม่ใช่ 1000', async () => {
    const s = setup({ unit: 'pcs', cost: 100, qty: 100 })
    const so = soWith(s, [{ name: 'น้ำดื่ม', qty: 10, unit: 'pcs' }])
    deductStockForSO(s.t, so.soId, so.soNumber)
    db.prepare(`DELETE FROM stock_movements WHERE tenant_id = ? AND reference = ?`).run(s.t, 'SO: ' + so.soNumber) // เอกสารยุคก่อนมี movement
    await returnViaCreditNote(s, so.soId, [{ lineId: so.lineIds[0], qty: 4 }])
    expect(stockQty(s.stockId)).toBe(94)

    restoreStockForSO(s.t, so.soId, so.soNumber)
    expect(stockQty(s.stockId), 'ไม่คืนซ้ำ 4 ที่ CN คืนแล้ว').toBe(100)
    const cancel = db.prepare(`SELECT total_debit FROM journal_entries WHERE tenant_id = ? AND reference_type = 'SO_COGS_CANCEL'`).all(s.t) as any[]
    expect(cancel.map(c => c.total_debit)).toEqual([600])
    expect(balanceOf(s.t, ACC.INVENTORY)).toBe(0)
    expect(balanceOf(s.t, ACC.COGS_PRODUCT)).toBe(0)
  })
})

describe('ใบส่งของที่ส่งแล้ว/ยกเลิกแล้ว ย้อนสถานะไม่ได้', () => {
  it('DELIVERED → CANCELLED/DRAFT = 409 สต็อกไม่ขยับ · กด DELIVERED ซ้ำไม่ตัดซ้ำ · ใบยกเลิกแล้วปลุกไม่ได้', async () => {
    const s = setup()
    const so = soWith(s, [{ name: 'น้ำดื่มสิงห์', qty: 1, unit: 'pack' }], 'DRAFT')
    const doId = doFor(s.t, so.soId)
    expect((await setDoStatus(s.user.token, doId, 'DELIVERED')).status).toBe(200)
    expect(stockQty(s.stockId)).toBe(985)

    const cancel = await setDoStatus(s.user.token, doId, 'CANCELLED')
    expect(cancel.status).toBe(409)
    expect(cancel.body.message).toContain('ใบลดหนี้')
    expect((await setDoStatus(s.user.token, doId, 'DRAFT')).status).toBe(409)
    expect((await setDoStatus(s.user.token, doId, 'DELIVERED')).status).toBe(200)
    expect(stockQty(s.stockId), 'ไม่ตัดซ้ำ').toBe(985)
    expect((db.prepare('SELECT delivered_qty FROM sales_order_items WHERE id = ?').get(so.lineIds[0]) as any).delivered_qty).toBe(1)

    const doId2 = doFor(s.t, so.soId)
    expect((await setDoStatus(s.user.token, doId2, 'CANCELLED')).status).toBe(200)
    expect((await setDoStatus(s.user.token, doId2, 'DELIVERED')).status).toBe(409)
    expect(stockQty(s.stockId)).toBe(985)
  })
})
