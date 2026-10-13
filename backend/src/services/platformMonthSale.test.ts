import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { submitFile, PlatformMonthError } from './platformMonth.service'
import {
  getMappingRows,
  confirmMapping,
  confirmSale,
  cancelSale,
  sourceRefOf,
} from './platformMonthSale.service'
import { StockItemRefError } from './stockItem.service'

// ============================================================
// เฟส 2: จับคู่ SKU + ยืนยันการขาย (ตัดสต็อกจริง) — ไม่ลงบัญชี (เฟส 3 ค่อยทำ)
// สร้างแถว platform_months / platform_month_products ตรงๆ (bypass submitFile — เทสต์นี้
// โฟกัสเฉพาะตรรกะจับคู่/ตัดสต็อก ไม่ใช่สมการ 5 ไฟล์ ซึ่งมี platformMonth.test.ts คุมอยู่แล้ว)
// ============================================================

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    const monthIds = (db.prepare(`SELECT id FROM platform_months WHERE tenant_id = ?`).all(t) as any[]).map(r => r.id)
    for (const id of monthIds) {
      db.prepare(`DELETE FROM platform_month_products WHERE month_id = ?`).run(id)
    }
    db.prepare(`DELETE FROM stock_movements WHERE tenant_id = ?`).run(t)
    db.prepare(`DELETE FROM platform_sku_proposals WHERE tenant_id = ?`).run(t)
    db.prepare(`DELETE FROM stock_item_aliases WHERE tenant_id = ?`).run(t)
    db.prepare(`DELETE FROM bom_items WHERE tenant_id = ?`).run(t)
    db.prepare(`DELETE FROM boms WHERE tenant_id = ?`).run(t)
    db.prepare(`DELETE FROM stock_items WHERE tenant_id = ?`).run(t)
    db.prepare(`DELETE FROM platform_months WHERE tenant_id = ?`).run(t)
  }
})

function newTenant() {
  const t = 'test_platform_sale_' + generateId()
  tenants.push(t)
  return t
}

function makeStockItem(tenantId: string, opts: { name: string; category: string; quantity: number; unitCost: number; unit?: string }) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'WH1', 'ACTIVE')
  `).run(id, tenantId, id, opts.name, opts.category, opts.quantity, opts.unit || 'pcs', opts.unit || 'pcs', opts.unitCost)
  return id
}

function makeMonth(tenantId: string, platform = 'SHOPEE', shopKey = 'ร้านหลัก', month = '2026-10') {
  const id = generateId()
  db.prepare(`INSERT INTO platform_months (id, tenant_id, platform, shop_key, month, status) VALUES (?, ?, ?, ?, ?, 'COLLECTING')`)
    .run(id, tenantId, platform, shopKey, month)
  return id
}

function addVariantRow(tenantId: string, monthId: string, opts: { productId: string; variantId: string; productName: string; variantName: string; qtyConfirmed: number }) {
  db.prepare(`
    INSERT INTO platform_month_products (id, month_id, tenant_id, product_id, variant_id, level, product_name, variant_name, qty_confirmed)
    VALUES (?, ?, ?, ?, ?, 'variant', ?, ?, ?)
  `).run(generateId(), monthId, tenantId, opts.productId, opts.variantId, opts.productName, opts.variantName, opts.qtyConfirmed)
}

describe('platformMonthSale — จับคู่ SKU + ยืนยันการขาย (เฟส 2)', () => {
  it('ยืนยันการขายไม่ได้ถ้ายังไม่ผูก SKU ครบ', () => {
    const tenantId = newTenant()
    const monthId = makeMonth(tenantId)
    addVariantRow(tenantId, monthId, { productId: 'P1', variantId: 'V1', productName: 'หมอน', variantName: 'ใบใหญ่', qtyConfirmed: 5 })

    expect(() => confirmSale(tenantId, monthId, 'tester')).toThrow(PlatformMonthError)
    const rows = getMappingRows(tenantId, monthId)
    expect(rows[0].mapped).toBe(false)
  })

  it('factor คูณจำนวนที่ตัดสต็อกจริง (ไม่มี BOM)', () => {
    const tenantId = newTenant()
    const stockItemId = makeStockItem(tenantId, { name: 'หมอน', category: 'FINISHED', quantity: 100, unitCost: 50 })
    const monthId = makeMonth(tenantId)
    const sourceRef = sourceRefOf('SHOPEE', { variant_id: 'V1' })
    addVariantRow(tenantId, monthId, { productId: 'P1', variantId: 'V1', productName: 'หมอน', variantName: 'แพ็ค 2 ใบ', qtyConfirmed: 5 })
    confirmMapping(tenantId, { monthId, sourceRef, stockItemId, factor: 2 }, 'tester')

    const result = confirmSale(tenantId, monthId, 'tester')
    expect(result.breakdown).toHaveLength(1)
    expect(result.breakdown[0].qty).toBe(10) // 5 * factor 2
    expect(result.breakdown[0].inventoryAccount).toBe('1106') // FINISHED → สต็อกสินค้า
    expect(result.cogsAmount).toBe(500) // 10 * 50

    const item = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockItemId) as any
    expect(item.quantity).toBe(90)
  })

  it('แตก BOM เป็นวัตถุดิบ แทนตัดสต็อกตัวสินค้าสำเร็จเอง', () => {
    const tenantId = newTenant()
    const ingredientId = makeStockItem(tenantId, { name: 'ผ้าฝ้าย', category: 'RAW', quantity: 1000, unitCost: 10 })
    const productId = makeStockItem(tenantId, { name: 'หมอนอิง', category: 'FINISHED', quantity: 0, unitCost: 0 })
    const bomId = generateId()
    db.prepare(`INSERT INTO boms (id, tenant_id, product_id, version, status, level, is_semi_finished, output_qty, created_at, updated_at)
      VALUES (?, ?, ?, 'standard', 'ACTIVE', 0, 0, 1, datetime('now'), datetime('now'))`).run(bomId, tenantId, productId)
    db.prepare(`INSERT INTO bom_items (id, tenant_id, bom_id, item_type, material_id, quantity, unit)
      VALUES (?, ?, ?, 'MATERIAL', ?, 3, 'pcs')`).run(generateId(), tenantId, bomId, ingredientId)

    const monthId = makeMonth(tenantId)
    const sourceRef = sourceRefOf('SHOPEE', { variant_id: 'V1' })
    addVariantRow(tenantId, monthId, { productId: 'P1', variantId: 'V1', productName: 'หมอนอิง', variantName: 'สีฟ้า', qtyConfirmed: 2 })
    confirmMapping(tenantId, { monthId, sourceRef, stockItemId: productId, factor: 1 }, 'tester')

    const result = confirmSale(tenantId, monthId, 'tester')
    // ตัด 2 ชิ้น x 3 ต่อชิ้น = 6 หน่วยวัตถุดิบ ไม่ใช่ตัวหมอนอิงเอง (ไม่มีสต็อก)
    expect(result.breakdown).toHaveLength(1)
    expect(result.breakdown[0].stockItemId).toBe(ingredientId)
    expect(result.breakdown[0].qty).toBe(6)
    expect(result.breakdown[0].inventoryAccount).toBe('1107') // RAW → สต็อกวัตถุดิบ

    const ingredient = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(ingredientId) as any
    expect(ingredient.quantity).toBe(994)
  })

  it('ยกเลิกยืนยันการขายคืนสต็อกเป๊ะ + กลับสถานะ COLLECTING', () => {
    const tenantId = newTenant()
    const stockItemId = makeStockItem(tenantId, { name: 'กระเป๋า', category: 'FINISHED', quantity: 50, unitCost: 20 })
    const monthId = makeMonth(tenantId)
    const sourceRef = sourceRefOf('SHOPEE', { variant_id: 'V1' })
    addVariantRow(tenantId, monthId, { productId: 'P1', variantId: 'V1', productName: 'กระเป๋า', variantName: 'สีดำ', qtyConfirmed: 7 })
    confirmMapping(tenantId, { monthId, sourceRef, stockItemId, factor: 1 }, 'tester')
    confirmSale(tenantId, monthId, 'tester')

    let item = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockItemId) as any
    expect(item.quantity).toBe(43)

    cancelSale(tenantId, monthId, 'tester')

    item = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockItemId) as any
    expect(item.quantity).toBe(50)
    const month = db.prepare('SELECT status, cogs_amount FROM platform_months WHERE id = ?').get(monthId) as any
    expect(month.status).toBe('COLLECTING')
    expect(month.cogs_amount).toBe(0)
  })

  it('ยืนยันการขายแล้ว ส่งไฟล์ใหม่เข้ารอบเดิมต้องถูกบล็อก (status != COLLECTING)', () => {
    const tenantId = newTenant()
    const stockItemId = makeStockItem(tenantId, { name: 'เสื้อ', category: 'FINISHED', quantity: 50, unitCost: 20 })
    const monthId = makeMonth(tenantId)
    const sourceRef = sourceRefOf('SHOPEE', { variant_id: 'V1' })
    addVariantRow(tenantId, monthId, { productId: 'P1', variantId: 'V1', productName: 'เสื้อ', variantName: 'S', qtyConfirmed: 1 })
    confirmMapping(tenantId, { monthId, sourceRef, stockItemId, factor: 1 }, 'tester')
    confirmSale(tenantId, monthId, 'tester')

    expect(() => submitFile(tenantId, {
      platform: 'SHOPEE', shopKey: 'ร้านหลัก', month: '2026-10', fileType: 'ads',
      data: { period_start: '2026-10-01', period_end: '2026-10-31', campaigns: [], total_cost: 0 },
    })).toThrow(PlatformMonthError)
  })

  it('การจับคู่แยก tenant — ผูกใน tenant หนึ่งไม่กระทบอีก tenant', () => {
    const tenantA = newTenant()
    const tenantB = newTenant()
    const stockItemA = makeStockItem(tenantA, { name: 'หมวก', category: 'FINISHED', quantity: 10, unitCost: 30 })
    makeStockItem(tenantB, { name: 'หมวก', category: 'FINISHED', quantity: 10, unitCost: 30 })

    const monthA = makeMonth(tenantA)
    const monthB = makeMonth(tenantB)
    const sourceRef = sourceRefOf('SHOPEE', { variant_id: 'V1' })
    addVariantRow(tenantA, monthA, { productId: 'P1', variantId: 'V1', productName: 'หมวก', variantName: 'ฟรีไซส์', qtyConfirmed: 1 })
    addVariantRow(tenantB, monthB, { productId: 'P1', variantId: 'V1', productName: 'หมวก', variantName: 'ฟรีไซส์', qtyConfirmed: 1 })

    confirmMapping(tenantA, { monthId: monthA, sourceRef, stockItemId: stockItemA, factor: 1 }, 'tester')

    // tenant A ผูกแล้ว ยืนยันการขายได้
    expect(() => confirmSale(tenantA, monthA, 'tester')).not.toThrow()
    // tenant B ไม่เคยผูก (คนละแถวใน stock_item_aliases) ต้องยังถูกบล็อก
    expect(() => confirmSale(tenantB, monthB, 'tester')).toThrow(PlatformMonthError)
  })

  it('ชื่อรวม (product · variant) ชนกันระหว่างคนละ source_ref ต้องถูกปฏิเสธด้วยข้อความไทยชัด', () => {
    const tenantId = newTenant()
    const stockItemA = makeStockItem(tenantId, { name: 'ผ้าห่ม A', category: 'FINISHED', quantity: 10, unitCost: 100 })
    const stockItemB = makeStockItem(tenantId, { name: 'ผ้าห่ม B', category: 'FINISHED', quantity: 10, unitCost: 100 })
    const monthId = makeMonth(tenantId)
    // สองตัวเลือกคนละ variant_id แต่ชื่อรวม (product_name · variant_name) เหมือนกันเป๊ะ
    addVariantRow(tenantId, monthId, { productId: 'P1', variantId: 'V1', productName: 'ผ้าห่ม', variantName: 'สีฟ้า', qtyConfirmed: 1 })
    addVariantRow(tenantId, monthId, { productId: 'P2', variantId: 'V2', productName: 'ผ้าห่ม', variantName: 'สีฟ้า', qtyConfirmed: 1 })

    confirmMapping(tenantId, { monthId, sourceRef: sourceRefOf('SHOPEE', { variant_id: 'V1' }), stockItemId: stockItemA, factor: 1 }, 'tester')
    expect(() => confirmMapping(tenantId, { monthId, sourceRef: sourceRefOf('SHOPEE', { variant_id: 'V2' }), stockItemId: stockItemB, factor: 1 }, 'tester'))
      .toThrow(StockItemRefError)
  })
})
