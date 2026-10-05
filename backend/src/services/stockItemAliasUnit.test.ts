import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import { createGoodsReceipt, confirmGoodsReceipt } from './goodsReceipt.service'
import { saveAlias, findAliasTarget, rememberAlias, listAliases, aliasConflictMessage, StockItemRefError } from './stockItem.service'
import { createConversion, convertQuantityBidirectional } from './unitConversion.service'
import { deductStockForSO, restoreStockForSO } from '../routes/sales/shared'
import { matchStockItem } from '../mcp/tools/shared'

/**
 * ชื่อเรียกแทน SKU ผูกหน่วย: SKU "น้ำดื่ม" (หน่วยฐาน ขวด, กฎของสินค้า 1 แพ็ค = 12 ขวด)
 *   "น้ำดื่มสิงห์"  1 แพ็ค = 15 ขวด  (ชื่อเรียกแทนผูกหน่วย)
 *   "น้ำดื่มทั่วไป" ไม่ผูกหน่วย → ใช้กฎของสินค้า 12 ขวด
 * + สวิตช์ปิดทั้งบริษัท (company_settings.stock_alias_enabled = 0) → เหลือแค่ชื่อ SKU ตรงเป๊ะ
 */
function setup(opts: { aliasEnabled?: boolean; category?: string; displayUnit?: string | null } = {}) {
  const user = createTestUser({ role: 'ADMIN' })
  const t = user.tenantId
  db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock, stock_alias_enabled) VALUES (?, ?, 0, ?)')
    .run(t, 'test', opts.aliasEnabled === false ? 0 : 1)
  const water = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, display_unit, unit_cost, unit_price, location, status)
    VALUES (?, ?, ?, 'น้ำดื่ม', ?, 1000, 'bottle', 'bottle', ?, 5, 7, 'STOCK', 'ACTIVE')
  `).run(water, t, 'SKU-' + water.slice(0, 8), opts.category ?? 'FINISHED', opts.displayUnit ?? null)
  createConversion(t, { material_id: water, from_unit: 'pack', to_unit: 'bottle', conversion_factor: 12 })
  return { user, t, water }
}

function qtyOf(id: string) {
  return (db.prepare('SELECT quantity, sealed_qty FROM stock_items WHERE id = ?').get(id) as any)
}

function soWith(t: string, stockId: string, lines: Array<{ name: string; qty: number; unit: string }>) {
  const customerId = generateId()
  db.prepare(`INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, status, created_at, updated_at)
              VALUES (?, ?, ?, 'ลูกค้า', 'RETAIL', '-', '', '', '', 'ACTIVE', datetime('now'), datetime('now'))`)
    .run(customerId, t, 'CUS-' + customerId.slice(0, 6))
  const soId = generateId()
  const soNumber = 'SO-AL-' + soId.slice(0, 6)
  db.prepare(`
    INSERT INTO sales_orders (id, tenant_id, so_number, quotation_id, customer_id, order_date, delivery_date,
      subtotal, discount_amount, tax_rate, tax_amount, total_amount, status, payment_status, notes, created_at, updated_at)
    VALUES (?, ?, ?, NULL, ?, datetime('now'), NULL, 0, 0, 0, 0, 0, 'CONFIRMED', 'UNPAID', '', datetime('now'), datetime('now'))
  `).run(soId, t, soNumber, customerId)
  for (const l of lines) {
    db.prepare(`
      INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_id, product_name, quantity, unit, unit_price, discount_percent, total_price, notes)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 100, 0, 100, '')
    `).run(generateId(), t, soId, stockId, l.name, l.qty, l.unit)
  }
  return { soId, soNumber }
}

function receive(t: string, email: string, stockId: string, lineName: string, qty: number, unit: string) {
  const supplierId = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')").run(supplierId, t, supplierId)
  const poId = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_rate, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'APPROVED', 100, 0, 0, 100, ?, ?)
  `).run(poId, t, 'PO-' + poId.slice(0, 6), supplierId, now, now)
  const poItemId = generateId()
  db.prepare(`
    INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty)
    VALUES (?, ?, ?, ?, ?, ?, ?, 90, ?, 0)
  `).run(poItemId, t, poId, stockId, lineName, qty, unit, qty * 90)
  const created = createGoodsReceipt(t, email, {
    purchaseOrderId: poId,
    items: [{ poItemId, materialId: stockId, orderedQty: qty, receivedQty: qty, acceptedQty: qty, rejectedQty: 0 }] as any,
  }) as any
  return confirmGoodsReceipt(t, 'u1', created.id) as any
}

describe('ชื่อเรียกแทน SKU ผูกหน่วย (น้ำดื่มสิงห์ 1 แพ็ค = 15 ขวด)', () => {
  it('แปลงหน่วยด้วยตัวคูณของชื่อเรียกแทนก่อนกฎของสินค้า · ชื่ออื่น/ไม่ส่งชื่อ ใช้กฎสินค้า', () => {
    const { user, t, water } = setup()
    saveAlias(t, { name: 'น้ำดื่มสิงห์', stockItemId: water, unit: 'pack', factor: 15 }, user.userId)
    saveAlias(t, { name: 'น้ำดื่มทั่วไป', stockItemId: water }, user.userId)

    expect(convertQuantityBidirectional(2, 'pack', 'bottle', t, water, ' น้ำดื่มสิงห์ ')?.converted).toBe(30)
    expect(convertQuantityBidirectional(30, 'bottle', 'pack', t, water, 'น้ำดื่มสิงห์')?.converted).toBeCloseTo(2)
    expect(convertQuantityBidirectional(2, 'pack', 'bottle', t, water, 'น้ำดื่มทั่วไป')?.converted).toBe(24)
    expect(convertQuantityBidirectional(2, 'pack', 'bottle', t, water)?.converted).toBe(24)
    expect(findAliasTarget(t, 'น้ำดื่มสิงห์')).toMatchObject({ stockItemId: water, unit: 'pack', factor: 15 })
    expect(listAliases(t, water).map((a: any) => a.name).sort()).toEqual(['น้ำดื่มทั่วไป', 'น้ำดื่มสิงห์'])
  })

  it('ยืนยันใบสั่งขาย: ตัดสต็อกตามขนาดแพ็คของแต่ละชื่อ · จดชื่อที่ขายใน stock log · ยกเลิกคืนเท่าที่ตัด', () => {
    const { user, t, water } = setup()
    saveAlias(t, { name: 'น้ำดื่มสิงห์', stockItemId: water, unit: 'pack', factor: 15 }, user.userId)
    const { soId, soNumber } = soWith(t, water, [
      { name: 'น้ำดื่มสิงห์', qty: 2, unit: 'pack' },
      { name: 'น้ำดื่มทั่วไป', qty: 1, unit: 'pack' },
    ])

    deductStockForSO(t, soId, soNumber)
    expect(qtyOf(water).quantity).toBe(1000 - 30 - 12)
    const notes = (db.prepare("SELECT notes FROM stock_movements WHERE stock_item_id = ? AND type = 'OUT'").all(water) as any[]).map(r => r.notes)
    expect(notes.some(n => n.startsWith('ขาย "น้ำดื่มสิงห์"'))).toBe(true)
    expect(notes.some(n => n.startsWith('ขาย "น้ำดื่มทั่วไป"'))).toBe(true)

    // ขายชื่อใหม่ครั้งแรก → จำเป็นชื่อรอง (ไม่มีหน่วยผูก) ครั้งหน้า MCP ฝั่งขายผูกให้เอง
    const m = matchStockItem(t, 'น้ำดื่มทั่วไป')
    expect(m.exact?.id).toBe(water)
    expect(m.viaAlias).toBe(soNumber)
    expect(matchStockItem(t, 'น้ำดื่มสิงห์').aliasUnit).toBe('pack')

    restoreStockForSO(t, soId, soNumber)
    expect(qtyOf(water).quantity).toBe(1000)
  })

  it('ยืนยันใบรับของด้วยชื่อที่ผูกหน่วย ไม่เข้าทางแพ็คปิดผนึกของ SKU (คนละขนาด) — แตกเป็นขวดตามตัวคูณของชื่อ', () => {
    const { user, t, water } = setup({ displayUnit: 'pack' })
    saveAlias(t, { name: 'น้ำดื่มสิงห์', stockItemId: water, unit: 'pack', factor: 15 }, user.userId)

    receive(t, user.email, water, 'น้ำดื่มสิงห์', 2, 'pack')
    expect(qtyOf(water)).toMatchObject({ quantity: 1030, sealed_qty: 0 })
    // ต้นทุนต่อหน่วยฐาน = 90 บาท/แพ็ค ÷ 15 ขวด
    expect((db.prepare('SELECT unit_cost FROM stock_items WHERE id = ?').get(water) as any).unit_cost).toBeCloseTo(6)

    // ชื่อ SKU เอง (ไม่ใช่ชื่อเรียกแทน) ยังเข้าทางแพ็คปิดผนึกตามเดิม
    receive(t, user.email, water, 'น้ำดื่ม', 1, 'pack')
    expect(qtyOf(water)).toMatchObject({ quantity: 1030, sealed_qty: 1 })
  })

  it('ฝั่งขายไม่ผูกชื่อรองที่ชี้วัตถุดิบ (ขายไม่ได้อยู่แล้ว) แต่ฝั่งซื้อยังผูก', () => {
    const { user, t, water } = setup({ category: 'raw' })
    rememberAlias(t, 'น้ำดื่ม ตรา B', water, 'GR-X', user.userId)
    expect(matchStockItem(t, 'น้ำดื่ม ตรา B', true).exact?.id).toBe(water)
    expect(matchStockItem(t, 'น้ำดื่ม ตรา B', false).exact).toBeNull()
  })

  it('ย้ายชื่อรองไปชี้ SKU อื่น → ทิ้งหน่วยที่ผูกกับ SKU เดิม', () => {
    const { user, t, water } = setup()
    const other = generateId()
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
                VALUES (?, ?, ?, 'โซดา', 'FINISHED', 0, 'bottle', 'bottle', 5, 'STOCK', 'ACTIVE')`).run(other, t, 'SKU-' + other.slice(0, 8))
    saveAlias(t, { name: 'สิงห์', stockItemId: water, unit: 'pack', factor: 15 }, user.userId)
    rememberAlias(t, 'สิงห์', water, 'SO-1', user.userId)
    expect(findAliasTarget(t, 'สิงห์')?.factor).toBe(15)            // ปลายทางเดิม — หน่วยยังอยู่
    rememberAlias(t, 'สิงห์', other, 'SO-2', user.userId)
    expect(findAliasTarget(t, 'สิงห์')).toMatchObject({ stockItemId: other, unit: null, factor: null })
  })

  it('saveAlias ตรวจกติกา: ชื่อซ้ำชื่อ SKU / ตัวคูณไม่ถูก', () => {
    const { user, t, water } = setup()
    expect(() => saveAlias(t, { name: 'น้ำดื่ม', stockItemId: water }, user.userId)).toThrow(StockItemRefError)
    expect(() => saveAlias(t, { name: 'น้ำแพ็ค', stockItemId: water, unit: 'pack', factor: 0 }, user.userId)).toThrow(/มากกว่า 0/)
    saveAlias(t, { name: 'น้ำขวด', stockItemId: water, unit: 'bottle', factor: 99 }, user.userId) // หน่วยฐาน = ไม่ผูก
    expect(findAliasTarget(t, 'น้ำขวด')).toMatchObject({ unit: null, factor: null })
  })

  it('ปิดสวิตช์ "ชื่อเรียกแทน SKU" → ไม่จับคู่/ไม่จำ/ไม่ใช้ตัวคูณ เหลือแค่ชื่อ SKU ตรงเป๊ะ', () => {
    const { user, t, water } = setup()
    saveAlias(t, { name: 'น้ำดื่มสิงห์', stockItemId: water, unit: 'pack', factor: 15 }, user.userId)
    db.prepare('UPDATE company_settings SET stock_alias_enabled = 0 WHERE tenant_id = ?').run(t)

    expect(findAliasTarget(t, 'น้ำดื่มสิงห์')).toBeNull()
    expect(matchStockItem(t, 'น้ำดื่มสิงห์', true).exact).toBeNull()
    expect(matchStockItem(t, 'น้ำดื่ม').exact?.id).toBe(water)
    expect(convertQuantityBidirectional(2, 'pack', 'bottle', t, water, 'น้ำดื่มสิงห์')?.converted).toBe(24)
    expect(rememberAlias(t, 'น้ำดื่มใหม่', water, 'SO-1', user.userId)).toBe(false)
    expect(aliasConflictMessage(t, 'น้ำดื่มสิงห์')).toBeNull()
    expect(listAliases(t)).toEqual([])
    expect(() => saveAlias(t, { name: 'อีกชื่อ', stockItemId: water }, user.userId)).toThrow(/ปิดใช้/)

    // ขายด้วยชื่อที่ไม่ตรง SKU → ตัดตามกฎสินค้า ไม่จดชื่อรอง
    const { soId, soNumber } = soWith(t, water, [{ name: 'น้ำดื่มสิงห์', qty: 1, unit: 'pack' }])
    deductStockForSO(t, soId, soNumber)
    expect(qtyOf(water).quantity).toBe(1000 - 12)
    const n = (db.prepare("SELECT notes FROM stock_movements WHERE stock_item_id = ? AND type = 'OUT'").get(water) as any).notes
    expect(n.startsWith('ขาย "')).toBe(false)

    // เปิดกลับ → ข้อมูลเดิมยังอยู่
    db.prepare('UPDATE company_settings SET stock_alias_enabled = 1 WHERE tenant_id = ?').run(t)
    expect(findAliasTarget(t, 'น้ำดื่มสิงห์')?.factor).toBe(15)
  })

  it('ไม่มีแถว company_settings = เปิด (ค่าเริ่มต้นตามพฤติกรรมเดิม)', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const id = generateId()
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
                VALUES (?, ?, ?, 'ไข่', 'raw', 0, 'pcs', 'pcs', 1, 'STOCK', 'ACTIVE')`).run(id, user.tenantId, 'SKU-' + id.slice(0, 8))
    expect(rememberAlias(user.tenantId, 'ไข่ฟาร์ม B', id, 'GR-1', user.userId)).toBe(true)
  })
})
