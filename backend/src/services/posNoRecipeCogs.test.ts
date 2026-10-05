import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import posAccountingService from './pos-accounting.service'
import { ACC } from '../config/accountCodes'

/**
 * calculateCOGS() เดิมมีแค่ 2 สาขา (bom_id / pos_menu_ingredients) — เมนูที่ไม่มีทั้งคู่เลย
 * (pos-stock.service.ts ~L254-261 ตัดสต็อกตรงจาก pos_menu_configs.product_id) ไม่เคยถูกคิด
 * ต้นทุนเลย ทำให้ POS_SALE มี journal แต่ POS_COGS ไม่เกิดขึ้น (totalCost = 0 ตลอด)
 */

function seedNoRecipeMenu(opts: { unitCost: number; saleUnit?: string | null; baseUnit?: string }) {
  const tenantId = 'tn' + generateId().slice(0, 10)
  const productId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, 'โซดาทดสอบ', 'FINISHED', 100, ?, ?, ?, 'STOCK', 'ACTIVE')
  `).run(productId, tenantId, 'SKU-' + productId.slice(0, 8), opts.baseUnit || 'pcs', opts.baseUnit || 'pcs', opts.unitCost)

  const menuId = generateId()
  db.prepare(`
    INSERT INTO pos_menu_configs (id, tenant_id, product_id, bom_id, pos_price, is_available, is_pos_enabled, sale_unit)
    VALUES (?, ?, ?, NULL, 20, 1, 1, ?)
  `).run(menuId, tenantId, productId, opts.saleUnit ?? null)

  return { tenantId, menuId, productId }
}

function seedBillItem(tenantId: string, menuId: string, quantity: number) {
  const billId = generateId()
  const itemId = generateId()
  db.prepare(`
    INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, total_amount)
    VALUES (?, ?, ?, 'โต๊ะ 1', 'OPEN', ?)
  `).run(billId, tenantId, 'B-' + billId.slice(0, 6), quantity * 20)
  db.prepare(`
    INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price, status)
    VALUES (?, ?, ?, ?, 'โซดาทดสอบ', ?, 20, ?, 'SERVED')
  `).run(itemId, tenantId, billId, menuId, quantity, quantity * 20)
  return billId
}

function cogsLines(journalEntryId: string) {
  return db.prepare(`
    SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id
    WHERE jl.journal_entry_id = ?
    ORDER BY jl.line_number
  `).all(journalEntryId) as Array<{ code: string; debit: number; credit: number }>
}

describe('POS COGS — เมนูไม่มีสูตร (ไม่มี bom_id และไม่มี pos_menu_ingredients)', () => {
  it('1 โซดา unit_cost 8 ไม่มี sale_unit → POS_COGS ต้อง Dr COGS 8 / Cr สต็อก 8', async () => {
    const { tenantId, menuId } = seedNoRecipeMenu({ unitCost: 8 })
    const billId = seedBillItem(tenantId, menuId, 1)

    const res = await posAccountingService.recordSale(
      { id: billId, bill_number: 'B-' + billId.slice(0, 6), display_name: 'โต๊ะ 1', subtotal: 20, service_charge_amount: 0, tax_rate: 0, tax_amount: 0, total_amount: 20 } as any,
      { payment_method: 'CASH', amount: 20 } as any,
      tenantId,
      'u1'
    )
    expect(res.success, res.errors.join()).toBe(true)
    expect(res.cogsEntryId).toBeTruthy()

    const lines = cogsLines(res.cogsEntryId!)
    const cogsLine = lines.find(l => l.code === ACC.COGS_PRODUCT)
    const invLine = lines.find(l => l.code === ACC.INVENTORY)
    expect(cogsLine?.debit).toBe(8)
    expect(invLine?.credit).toBe(8)
  })

  it('sale_unit = pack, 1 pack = 6 pcs (unit_cost 2/pcs) → ต้นทุน 1 pack ที่ขาย = 12', async () => {
    const { tenantId, menuId, productId } = seedNoRecipeMenu({ unitCost: 2, saleUnit: 'pack', baseUnit: 'pcs' })
    db.prepare(`
      INSERT INTO unit_conversions (id, tenant_id, material_id, from_unit, to_unit, conversion_factor)
      VALUES (?, ?, ?, 'pack', 'pcs', 6)
    `).run(generateId(), tenantId, productId)

    const billId = seedBillItem(tenantId, menuId, 1)

    const res = await posAccountingService.recordSale(
      { id: billId, bill_number: 'B-' + billId.slice(0, 6), display_name: 'โต๊ะ 1', subtotal: 20, service_charge_amount: 0, tax_rate: 0, tax_amount: 0, total_amount: 20 } as any,
      { payment_method: 'CASH', amount: 20 } as any,
      tenantId,
      'u1'
    )
    expect(res.success, res.errors.join()).toBe(true)
    expect(res.cogsEntryId).toBeTruthy()

    const lines = cogsLines(res.cogsEntryId!)
    const cogsLine = lines.find(l => l.code === ACC.COGS_PRODUCT)
    expect(cogsLine?.debit).toBe(12)
  })

  it('เมนูไม่มีสูตร แต่ product เป็นหมวด SERVICE → ไม่ลง POS_COGS (ไม่มีต้นทุนสต็อกจริง)', async () => {
    const tenantId = 'tn' + generateId().slice(0, 10)
    const productId = generateId()
    db.prepare(`
      INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
      VALUES (?, ?, ?, 'ค่าบริการทดสอบ', 'SERVICE', 0, 'pcs', 'pcs', 50, 'STOCK', 'ACTIVE')
    `).run(productId, tenantId, 'SKU-' + productId.slice(0, 8))
    const menuId = generateId()
    db.prepare(`
      INSERT INTO pos_menu_configs (id, tenant_id, product_id, bom_id, pos_price, is_available, is_pos_enabled)
      VALUES (?, ?, ?, NULL, 50, 1, 1)
    `).run(menuId, tenantId, productId)
    const billId = seedBillItem(tenantId, menuId, 1)

    const res = await posAccountingService.recordSale(
      { id: billId, bill_number: 'B-' + billId.slice(0, 6), display_name: 'โต๊ะ 1', subtotal: 50, service_charge_amount: 0, tax_rate: 0, tax_amount: 0, total_amount: 50 } as any,
      { payment_method: 'CASH', amount: 50 } as any,
      tenantId,
      'u1'
    )
    expect(res.success, res.errors.join()).toBe(true)
    expect(res.cogsEntryId).toBeUndefined()
  })

  it('ยกเลิกบิล → POS_CANCEL ต้องกลับรายการ POS_COGS ด้วย (Cr COGS / Dr สต็อก)', async () => {
    const { tenantId, menuId } = seedNoRecipeMenu({ unitCost: 8 })
    const billId = seedBillItem(tenantId, menuId, 1)
    const bill = { id: billId, bill_number: 'B-' + billId.slice(0, 6), display_name: 'โต๊ะ 1', subtotal: 20, service_charge_amount: 0, tax_rate: 0, tax_amount: 0, total_amount: 20 }

    const sale = await posAccountingService.recordSale(bill as any, { payment_method: 'CASH', amount: 20 } as any, tenantId, 'u1')
    expect(sale.success, sale.errors.join()).toBe(true)

    const cancel = await posAccountingService.recordCancelledSale(bill as any, tenantId, 'u1', 'ทดสอบ')
    expect(cancel.success, cancel.errors.join()).toBe(true)
    expect(cancel.journalEntryId).toBeTruthy()

    const lines = cogsLines(cancel.journalEntryId!)
    const invLine = lines.find(l => l.code === ACC.INVENTORY)
    const cogsLine = lines.find(l => l.code === ACC.COGS_PRODUCT)
    // กลับรายการ: ของเดิม Dr COGS 8 / Cr สต็อก 8 → ยกเลิกต้อง Dr สต็อก 8 / Cr COGS 8
    expect(invLine?.debit).toBe(8)
    expect(cogsLine?.credit).toBe(8)
  })
})
