import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { recalculateBillTotals } from './pos-bill.routes'

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
    const menuId = seedMenu(tenantId, 33)
    const billId = seedOpenBill(tenantId)
    addBillItem(tenantId, billId, menuId, 3, 33) // subtotal 99 (forces rounding)

    recalculateBillTotals(billId)

    const bill = db.prepare('SELECT * FROM pos_running_bills WHERE id = ?').get(billId) as any
    expect(bill.subtotal).toBe(99)
    expect(bill.service_charge_amount).toBe(Math.round((99 * 10) / 100)) // 10
    expect(bill.tax_amount).toBe(Math.round((99 * 7) / 100)) // 7
    expect(bill.total_amount).toBe(99 + 10 + 7) // 116, subtotal + service + VAT (not compounded)
  })

  it('honours per-tenant company_settings overrides, including VAT/service disabled entirely', () => {
    const tenantId = generateId()
    db.prepare(`
      INSERT INTO company_settings (tenant_id, pos_vat_enabled, pos_vat_rate, pos_service_enabled, pos_service_rate)
      VALUES (?, 0, 15, 0, 20)
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
      INSERT INTO company_settings (tenant_id, pos_vat_enabled, pos_vat_rate, pos_service_enabled, pos_service_rate)
      VALUES (?, 1, 15, 1, 5)
    `).run(tenantId)

    const menuId = seedMenu(tenantId, 100)
    const billId = seedOpenBill(tenantId)
    addBillItem(tenantId, billId, menuId, 1, 100) // subtotal 100

    recalculateBillTotals(billId)

    const bill = db.prepare('SELECT * FROM pos_running_bills WHERE id = ?').get(billId) as any
    expect(bill.tax_amount).toBe(15)   // 100 * 15%
    expect(bill.service_charge_amount).toBe(5) // 100 * 5%
    expect(bill.total_amount).toBe(120)
  })

  it('recomputes from the current item set every call (no drift when items change)', () => {
    const tenantId = generateId()
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
    expect(bill.total_amount).toBe(150 + Math.round(150 * 0.1) + Math.round(150 * 0.07))
  })
})
