import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import express from 'express'
import request from 'supertest'
import posBillRouter, { recalculateBillTotals } from './pos-bill.routes'
import { createTestUser } from '../test/testAuth'

function seedMenu(tenantId: string, posPrice: number) {
  // ponytail: schema.ts declares pos_menu_configs.product_id -> products(id), but the
  // live runtime FK (confirmed via PRAGMA foreign_key_list) actually points at
  // stock_items(id) — another spot where a later migration diverged from schema.ts's
  // CREATE TABLE. Seed stock_items to match what the DB really enforces.
  const productId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, unit, location, status)
    VALUES (?, ?, ?, 'Test Product', 'FOOD', 'pcs', 'WH1', 'ACTIVE')
  `).run(productId, tenantId, productId)
  const menuId = generateId()
  db.prepare(`INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price) VALUES (?, ?, ?, ?)`)
    .run(menuId, tenantId, productId, posPrice)
  return menuId
}

function seedOpenBill(tenantId: string) {
  const billId = generateId()
  db.prepare(`
    INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, created_by)
    VALUES (?, ?, ?, 'Test Bill', 'OPEN', 'tester')
  `).run(billId, tenantId, `POS-TEST-${billId}`)
  return billId
}

function addBillItem(tenantId: string, billId: string, menuId: string, quantity: number, unitPrice: number) {
  db.prepare(`
    INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price)
    VALUES (?, ?, ?, ?, 'Item', ?, ?, ?)
  `).run(generateId(), tenantId, billId, menuId, quantity, unitPrice, quantity * unitPrice)
}

describe('recalculateBillTotals (POS bill subtotal/VAT/service-charge math)', () => {
  it('applies the default 10% service charge and 7% VAT on top of subtotal, each independently rounded', () => {
    const tenantId = generateId()
    // กิจการต้องจด VAT ก่อนถึงจะคิดภาษีได้ — ไม่ใส่อัตรา ใช้ค่าตั้งต้น 7/10
    db.prepare('INSERT INTO company_settings (tenant_id, tax_id) VALUES (?, ?)').run(tenantId, '0105561234567')
    const menuId = seedMenu(tenantId, 33)
    const billId = seedOpenBill(tenantId)
    addBillItem(tenantId, billId, menuId, 3, 33) // subtotal 99 (forces rounding)

    recalculateBillTotals(billId)

    const bill = db.prepare('SELECT * FROM pos_running_bills WHERE id = ?').get(billId) as any
    expect(bill.subtotal).toBe(99)
    expect(bill.service_charge_amount).toBe(Math.round((99 * 10) / 100)) // 10
    // ฐานภาษีคือทุกอย่างที่เรียกเก็บจากลูกค้า ค่าบริการจึงอยู่ในฐานด้วย: (99 + 10) × 7%
    expect(bill.tax_amount).toBe(Math.round((109 * 7) / 100)) // 8
    expect(bill.total_amount).toBe(99 + 10 + 8) // 117
  })

  it('honours per-tenant company_settings overrides, including VAT/service disabled entirely', () => {
    const tenantId = generateId()
    db.prepare(`
      INSERT INTO company_settings (tenant_id, tax_id, pos_vat_enabled, pos_vat_rate, pos_service_enabled, pos_service_rate)
      VALUES (?, '0105561234567', 0, 15, 0, 20)
    `).run(tenantId)

    const menuId = seedMenu(tenantId, 100)
    const billId = seedOpenBill(tenantId)
    addBillItem(tenantId, billId, menuId, 2, 100) // subtotal 200

    recalculateBillTotals(billId)

    const bill = db.prepare('SELECT * FROM pos_running_bills WHERE id = ?').get(billId) as any
    expect(bill.subtotal).toBe(200)
    expect(bill.tax_amount).toBe(0)
    expect(bill.service_charge_amount).toBe(0)
    expect(bill.total_amount).toBe(200)
  })

  it('applies a custom VAT/service rate from company_settings when enabled', () => {
    const tenantId = generateId()
    db.prepare(`
      INSERT INTO company_settings (tenant_id, tax_id, pos_vat_enabled, pos_vat_rate, pos_service_enabled, pos_service_rate)
      VALUES (?, '0105561234567', 1, 15, 1, 5)
    `).run(tenantId)

    const menuId = seedMenu(tenantId, 100)
    const billId = seedOpenBill(tenantId)
    addBillItem(tenantId, billId, menuId, 1, 100) // subtotal 100

    recalculateBillTotals(billId)

    const bill = db.prepare('SELECT * FROM pos_running_bills WHERE id = ?').get(billId) as any
    expect(bill.service_charge_amount).toBe(5) // 100 * 5%
    expect(bill.tax_amount).toBe(16)   // (100 + 5) * 15%
    expect(bill.total_amount).toBe(121)
  })

  it('recomputes from the current item set every call (no drift when items change)', () => {
    const tenantId = generateId()
    db.prepare('INSERT INTO company_settings (tenant_id, tax_id) VALUES (?, ?)').run(tenantId, '0105561234567')
    const menuId = seedMenu(tenantId, 50)
    const billId = seedOpenBill(tenantId)
    addBillItem(tenantId, billId, menuId, 1, 50)

    recalculateBillTotals(billId)
    let bill = db.prepare('SELECT * FROM pos_running_bills WHERE id = ?').get(billId) as any
    expect(bill.subtotal).toBe(50)

    addBillItem(tenantId, billId, menuId, 2, 50) // +100

    recalculateBillTotals(billId)
    bill = db.prepare('SELECT * FROM pos_running_bills WHERE id = ?').get(billId) as any
    expect(bill.subtotal).toBe(150)
    const service = Math.round(150 * 0.1)
    expect(bill.total_amount).toBe(150 + service + Math.round((150 + service) * 0.07))
  })

  it('ค่าขนส่งและส่วนลดบนบิลต้องอยู่ในฐานภาษี ไม่ใช่บวก/ลบทีหลัง', () => {
    const tenantId = generateId()
    db.prepare(`
      INSERT INTO company_settings (tenant_id, tax_id, pos_vat_enabled, pos_vat_rate, pos_service_enabled, pos_service_rate)
      VALUES (?, '0105561234567', 1, 7, 0, 0)
    `).run(tenantId)

    const menuId = seedMenu(tenantId, 100)
    const billId = seedOpenBill(tenantId)
    addBillItem(tenantId, billId, menuId, 1, 100)
    db.prepare('UPDATE pos_running_bills SET extra_charge_amount = 50, discount_amount = 20 WHERE id = ?').run(billId)

    recalculateBillTotals(billId)

    const bill = db.prepare('SELECT * FROM pos_running_bills WHERE id = ?').get(billId) as any
    expect(bill.tax_amount).toBe(9)  // (100 + 50 − 20) × 7% ไม่ใช่ 7
    expect(bill.total_amount).toBe(139)
    expect(bill.subtotal + bill.extra_charge_amount - bill.discount_amount + bill.tax_amount)
      .toBe(bill.total_amount)
  })
})

describe('แก้รายการบิล POS — ได้เฉพาะบิล OPEN ของ tenant ตัวเอง', () => {
  const app = express()
  app.use(express.json())
  app.use('/api/pos', posBillRouter)

  it('บิลที่จ่ายแล้ว: เพิ่ม/แก้/ลบรายการไม่ได้ ยอดบิลต้องไม่ขยับ', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const menuId = seedMenu(user.tenantId, 100)
    const billId = seedOpenBill(user.tenantId)
    addBillItem(user.tenantId, billId, menuId, 1, 100)
    recalculateBillTotals(billId)
    db.prepare(`UPDATE pos_running_bills SET status = 'PAID' WHERE id = ?`).run(billId)
    const before = (db.prepare('SELECT total_amount FROM pos_running_bills WHERE id = ?').get(billId) as any).total_amount
    const itemId = (db.prepare('SELECT id FROM pos_bill_items WHERE bill_id = ?').get(billId) as any).id
    const auth = { Authorization: `Bearer ${user.token}` }

    expect((await request(app).post(`/api/pos/bills/${billId}/items`).set(auth).send({ pos_menu_id: menuId, quantity: 2 })).status).toBe(409)
    expect((await request(app).put(`/api/pos/bills/${billId}/items/${itemId}`).set(auth).send({ quantity: 5 })).status).toBe(409)
    expect((await request(app).delete(`/api/pos/bills/${billId}/items/${itemId}`).set(auth)).status).toBe(409)

    const after = (db.prepare('SELECT total_amount FROM pos_running_bills WHERE id = ?').get(billId) as any).total_amount
    expect(after).toBe(before)
  })

  it('บิล OPEN ของ tenant อื่น: เพิ่มรายการไม่ได้', async () => {
    const owner = createTestUser({ role: 'ADMIN' })
    const other = createTestUser({ role: 'ADMIN' })
    const billId = seedOpenBill(owner.tenantId)
    const menuId = seedMenu(other.tenantId, 50)
    const res = await request(app).post(`/api/pos/bills/${billId}/items`)
      .set('Authorization', `Bearer ${other.token}`).send({ pos_menu_id: menuId, quantity: 1 })
    expect(res.status).toBe(409)
  })
})
