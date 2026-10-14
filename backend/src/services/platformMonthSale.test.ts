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
import { rememberAlias } from './stockItem.service'

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
    db.prepare(`DELETE FROM goods_receipt_items WHERE tenant_id = ?`).run(t)
    db.prepare(`DELETE FROM goods_receipts WHERE tenant_id = ?`).run(t)
    db.prepare(`DELETE FROM purchase_order_items WHERE tenant_id = ?`).run(t)
    db.prepare(`DELETE FROM purchase_orders WHERE tenant_id = ?`).run(t)
    db.prepare(`DELETE FROM suppliers WHERE tenant_id = ?`).run(t)
    db.prepare(`DELETE FROM stock_items WHERE tenant_id = ?`).run(t)
    db.prepare(`DELETE FROM platform_months WHERE tenant_id = ?`).run(t)
  }
})

function newTenant() {
  const t = 'test_platform_sale_' + generateId()
  tenants.push(t)
  return t
}

function makeStockItem(tenantId: string, opts: { name: string; category: string; quantity: number; unitCost: number; unit?: string; sealedQty?: number; displayUnit?: string; baseUnit?: string }) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, sealed_qty, unit, base_unit, display_unit, unit_cost, location, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WH1', 'ACTIVE')
  `).run(id, tenantId, id, opts.name, opts.category, opts.quantity, opts.sealedQty || 0, opts.unit || 'pcs', opts.baseUnit || opts.unit || 'pcs', opts.displayUnit || null, opts.unitCost)
  return id
}

function makeMonth(tenantId: string, opts: { platform?: string; shopKey?: string; month?: string; periodEnd?: string; noOrders?: boolean } = {}) {
  const id = generateId()
  // orders_json: เทสต์ในไฟล์นี้ seed platform_month_products ตรงๆ ด้วย SQL (bypass submitFile) อยู่แล้ว —
  // ใส่ไฟล์ orders ปลอมให้ confirmSale ไม่บล็อก (ไฟล์ orders บังคับแล้ว — ดู confirmSale) ยกเว้นเทสต์ที่ตั้งใจ
  // เช็คการบล็อกเอง (noOrders: true)
  db.prepare(`INSERT INTO platform_months (id, tenant_id, platform, shop_key, month, status, period_start, period_end, orders_json) VALUES (?, ?, ?, ?, ?, 'COLLECTING', ?, ?, ?)`)
    .run(id, tenantId, opts.platform || 'SHOPEE', opts.shopKey || 'ร้านหลัก', opts.month || '2026-10', opts.periodEnd ? opts.periodEnd.slice(0, 7) + '-01' : null, opts.periodEnd || null, opts.noOrders ? null : '{}')
  return id
}

function addVariantRow(tenantId: string, monthId: string, opts: { productId: string | null; variantId: string | null; productName: string; variantName: string; qtyConfirmed: number; qtyNet?: number; level?: 'parent' | 'variant' }) {
  db.prepare(`
    INSERT INTO platform_month_products (id, month_id, tenant_id, product_id, variant_id, level, product_name, variant_name, qty_confirmed, qty_net)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(generateId(), monthId, tenantId, opts.productId, opts.variantId, opts.level || 'variant', opts.productName, opts.variantName, opts.qtyConfirmed, opts.qtyNet ?? opts.qtyConfirmed)
}

describe('platformMonthSale — จับคู่ SKU + ยืนยันการขาย (เฟส 2)', () => {
  // finding #9b: unit_cost=0 (ของจริงมีต้นทุน แค่ยังไม่กรอกในคลัง — ร้านนี้มีต้นทุนแค่ 97/1,024 รายการ) ไม่บล็อก
  // การยืนยันการขาย แต่ต้องส่ง warnings กลับมาชื่อสินค้าที่ unit_cost=0 ให้คนตามไปกรอก
  it('ต้นทุนต่อหน่วยเป็น 0 (ยังไม่กรอกในคลัง) → ไม่บล็อก แต่ส่ง warnings กลับมาชื่อสินค้านั้น', () => {
    const tenantId = newTenant()
    const stockItemId = makeStockItem(tenantId, { name: 'ของยังไม่กรอกต้นทุน', category: 'FINISHED', quantity: 50, unitCost: 0 })
    const monthId = makeMonth(tenantId)
    const sourceRef = sourceRefOf('SHOPEE', { variant_id: 'V1' })
    addVariantRow(tenantId, monthId, { productId: 'P1', variantId: 'V1', productName: 'ของยังไม่กรอกต้นทุน', variantName: '', qtyConfirmed: 3 })
    confirmMapping(tenantId, { monthId, sourceRef, stockItemId, factor: 1 }, 'tester')

    const result = confirmSale(tenantId, monthId, 'tester')
    expect(result.cogsAmount).toBe(0)
    expect(result.warnings).toContain('ของยังไม่กรอกต้นทุน')
  })

  it('ต้นทุนต่อหน่วยไม่เป็น 0 → ไม่มี warnings', () => {
    const tenantId = newTenant()
    const stockItemId = makeStockItem(tenantId, { name: 'ของมีต้นทุนแล้ว', category: 'FINISHED', quantity: 50, unitCost: 15 })
    const monthId = makeMonth(tenantId)
    const sourceRef = sourceRefOf('SHOPEE', { variant_id: 'V1' })
    addVariantRow(tenantId, monthId, { productId: 'P1', variantId: 'V1', productName: 'ของมีต้นทุนแล้ว', variantName: '', qtyConfirmed: 3 })
    confirmMapping(tenantId, { monthId, sourceRef, stockItemId, factor: 1 }, 'tester')

    const result = confirmSale(tenantId, monthId, 'tester')
    expect(result.warnings).toHaveLength(0)
  })
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

  // #4 + #10: ไม่แตก BOM แล้ว — ตัดสต็อกตัวสินค้าสำเร็จที่ผูกไว้ตรงๆ เหมือน deductStockForSO
  // (เทแนนต์นี้ผลิตของสำเร็จเข้าสต็อกผ่าน WO ก่อนขาย แตก BOM จะตัดวัตถุดิบซ้ำสองโดยสต็อกสำเร็จไม่ลดเลย)
  it('สินค้าที่มี BOM ยังตัดสต็อกตัวสินค้าสำเร็จเอง ไม่แตก BOM (เหมือน SO)', () => {
    const tenantId = newTenant()
    const ingredientId = makeStockItem(tenantId, { name: 'ผ้าฝ้าย', category: 'RAW', quantity: 1000, unitCost: 10 })
    const productId = makeStockItem(tenantId, { name: 'หมอนอิง', category: 'FINISHED', quantity: 10, unitCost: 80 })
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
    expect(result.breakdown).toHaveLength(1)
    expect(result.breakdown[0].stockItemId).toBe(productId)
    expect(result.breakdown[0].qty).toBe(2)
    expect(result.breakdown[0].unitCost).toBe(80)
    expect(result.breakdown[0].inventoryAccount).toBe('1106')

    const product = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(productId) as any
    expect(product.quantity).toBe(8) // 10 - 2 ไม่ใช่ตัดวัตถุดิบ

    const ingredient = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(ingredientId) as any
    expect(ingredient.quantity).toBe(1000) // ไม่ถูกแตะเลย — ไม่แตก BOM
  })

  // #9: cogs ใช้ unit_cost เหมือน POS/dashboard ไม่ใช่ weightedAvg จากประวัติรับของ
  it('ต้นทุนขายใช้ stock_items.unit_cost ไม่ใช่ weightedAvg จากประวัติรับของ', () => {
    const tenantId = newTenant()
    const stockItemId = makeStockItem(tenantId, { name: 'กระเป๋าผ้า', category: 'FINISHED', quantity: 50, unitCost: 80 })
    // ประวัติรับของ 50 หน่วย @10 บาท → weightedAvg = 10 ถ้าโค้ดยังเรียก getCostBasis จะได้ cogs ผิด (5*10=50 ไม่ใช่ 5*80=400)
    const supplierId = generateId()
    db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')").run(supplierId, tenantId, supplierId)
    const poId = generateId()
    const nowIso = new Date().toISOString()
    db.prepare(`INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_amount, total_amount, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'APPROVED', 500, 0, 500, ?, ?)`).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, nowIso, nowIso)
    const poItemId = generateId()
    db.prepare(`INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty)
      VALUES (?, ?, ?, ?, 'กระเป๋าผ้า', 50, 'pcs', 10, 500, 50)`).run(poItemId, tenantId, poId, stockItemId)
    const grId = generateId()
    db.prepare(`INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, receipt_date, status, created_at)
      VALUES (?, ?, ?, ?, ?, date('now'), 'CONFIRMED', ?)`).run(grId, tenantId, 'GR-' + grId.slice(0, 6), poId, supplierId, nowIso)
    db.prepare(`INSERT INTO goods_receipt_items (id, tenant_id, goods_receipt_id, purchase_order_item_id, material_id, stock_item_id, ordered_qty, received_qty, accepted_qty, rejected_qty, stock_qty)
      VALUES (?, ?, ?, ?, ?, ?, 50, 50, 50, 0, 50)`).run(generateId(), tenantId, grId, poItemId, stockItemId, stockItemId)

    const monthId = makeMonth(tenantId)
    const sourceRef = sourceRefOf('SHOPEE', { variant_id: 'V1' })
    addVariantRow(tenantId, monthId, { productId: 'P1', variantId: 'V1', productName: 'กระเป๋าผ้า', variantName: '', qtyConfirmed: 5 })
    confirmMapping(tenantId, { monthId, sourceRef, stockItemId, factor: 1 }, 'tester')

    const result = confirmSale(tenantId, monthId, 'tester')
    expect(result.breakdown[0].unitCost).toBe(80)
    expect(result.cogsAmount).toBe(400) // 5 * 80 ไม่ใช่ 5 * 10 (weightedAvg จาก GR)
  })

  // #8: แกะแพ็คอัตโนมัติ + ข้ามรายการบริการ (SERVICE) + ลงวันที่ปลายรอบ ไม่ใช่เวลาคลิก
  it('ตัดสต็อกตรง: แกะแพ็คอัตโนมัติเมื่อของพอดีรวมที่ปิดผนึก + ข้ามรายการบริการ + created_at = period_end', () => {
    const tenantId = newTenant()
    const stockItemId = makeStockItem(tenantId, { name: 'ผ้าห่มแพ็ค', category: 'FINISHED', quantity: 500, unitCost: 1, sealedQty: 2, baseUnit: 'g', displayUnit: 'kg' })
    const serviceItemId = makeStockItem(tenantId, { name: 'ค่าส่ง Shopee', category: 'SERVICE', quantity: 0, unitCost: 0 })

    const monthId = makeMonth(tenantId, { periodEnd: '2026-10-31' })
    addVariantRow(tenantId, monthId, { productId: 'P1', variantId: 'V1', productName: 'ผ้าห่ม', variantName: 'แพ็ค', qtyConfirmed: 2.5 })
    addVariantRow(tenantId, monthId, { productId: 'P2', variantId: 'V2', productName: 'ค่าส่ง', variantName: '', qtyConfirmed: 1 })
    confirmMapping(tenantId, { monthId, sourceRef: sourceRefOf('SHOPEE', { variant_id: 'V1' }), stockItemId, factor: 1000 }, 'tester')
    confirmMapping(tenantId, { monthId, sourceRef: sourceRefOf('SHOPEE', { variant_id: 'V2' }), stockItemId: serviceItemId, factor: 1 }, 'tester')

    const result = confirmSale(tenantId, monthId, 'tester')
    expect(result.breakdown).toHaveLength(1) // รายการบริการถูกข้าม
    expect(result.breakdown[0].stockItemId).toBe(stockItemId)
    expect(result.breakdown[0].qty).toBe(2500) // 2.5 * factor 1000 = 2500 g

    const item = db.prepare('SELECT quantity, sealed_qty FROM stock_items WHERE id = ?').get(stockItemId) as any
    expect(item.quantity).toBe(0) // 500 (เดิม) + 2000 (แกะ 2 แพ็ค kg) - 2500 = 0
    expect(item.sealed_qty).toBe(0) // แกะทั้ง 2 แพ็คที่ปิดผนึกไว้

    const movement = db.prepare(`SELECT created_at FROM stock_movements WHERE tenant_id = ? AND stock_item_id = ? AND type = 'OUT'`).get(tenantId, stockItemId) as any
    expect(movement.created_at.startsWith('2026-10-31')).toBe(true) // ลงวันที่ปลายรอบ ไม่ใช่ตอนนี้

    // finding #8: แถว UNPACK (แกะแพ็คอัตโนมัติ) ต้องลงวันที่ปลายรอบเดียวกับ OUT — เดิมใช้ now (เวลาคลิก)
    // ทำสต็อก ณ สิ้นเดือนติดลบชั่วคราวถ้ากดยืนยันข้ามเดือน (แกะทีหลัง OUT ตามเวลาจริง แต่ OUT ลงวันที่ย้อนไป)
    const unpackMovement = db.prepare(`SELECT created_at FROM stock_movements WHERE tenant_id = ? AND stock_item_id = ? AND type = 'UNPACK'`).get(tenantId, stockItemId) as any
    expect(unpackMovement.created_at.startsWith('2026-10-31')).toBe(true)
  })

  // #7: NOT IN เดิมกับเซ็ตย่อยที่มี NULL ทำ parent ที่ไม่มีตัวเลือกหลุดจากรายการตัดสต็อกทั้งหมด
  it('variant ที่ product_id เป็น NULL ไม่ทำให้ parent รายอื่นที่ไม่มีตัวเลือกหลุดจากรายการ', () => {
    const tenantId = newTenant()
    const monthId = makeMonth(tenantId)
    addVariantRow(tenantId, monthId, { productId: null, variantId: 'VX', productName: 'สินค้า X', variantName: 'ตัวเลือกพัง', qtyConfirmed: 1, level: 'variant' })
    addVariantRow(tenantId, monthId, { productId: 'P2', variantId: null, productName: 'สินค้า Y', variantName: '', qtyConfirmed: 3, level: 'parent' })

    const rows = getMappingRows(tenantId, monthId)
    // ของเดิม (NOT IN) จะเหลือแค่ 1 แถว (VX) เพราะ NOT IN ชนกับ NULL กลายเป็น NULL ทั้งนิพจน์ ทำให้ P2 หลุดไปเงียบๆ
    expect(rows).toHaveLength(2)
    expect(rows.some(r => r.productId === 'P2' && r.level === 'parent')).toBe(true)
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

  it('ยืนยัน→ยกเลิก→ยืนยัน→ยกเลิก ไม่คืนสต็อกซ้ำ', () => {
    const tenantId = newTenant()
    const stockItemId = makeStockItem(tenantId, { name: 'หมอน', category: 'FINISHED', quantity: 50, unitCost: 20 })
    const monthId = makeMonth(tenantId)
    const sourceRef = sourceRefOf('SHOPEE', { variant_id: 'V1' })
    addVariantRow(tenantId, monthId, { productId: 'P1', variantId: 'V1', productName: 'หมอน', variantName: 'ขาว', qtyConfirmed: 7 })
    confirmMapping(tenantId, { monthId, sourceRef, stockItemId, factor: 1 }, 'tester')
    for (let i = 0; i < 2; i++) {
      confirmSale(tenantId, monthId, 'tester')
      expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockItemId) as any).quantity).toBe(43)
      cancelSale(tenantId, monthId, 'tester')
      expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockItemId) as any).quantity).toBe(50)
    }
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

  // #1 CRITICAL: ยืนยันซ้ำหลังโพสต์บัญชีแล้ว (เฟส 3) ต้องถูกบล็อก ไม่ตัดสต็อกซ้ำ/ไม่ย้อนสถานะทิ้ง JV ที่ลงไปแล้วให้ลอย
  it('ยืนยันซ้ำหลัง POSTED ต้องถูกบล็อก ไม่ตัดสต็อกซ้ำ ไม่ย้อนสถานะ', () => {
    const tenantId = newTenant()
    const stockItemId = makeStockItem(tenantId, { name: 'เสื่อ', category: 'FINISHED', quantity: 100, unitCost: 20 })
    const monthId = makeMonth(tenantId)
    const sourceRef = sourceRefOf('SHOPEE', { variant_id: 'V1' })
    addVariantRow(tenantId, monthId, { productId: 'P1', variantId: 'V1', productName: 'เสื่อ', variantName: '', qtyConfirmed: 10 })
    confirmMapping(tenantId, { monthId, sourceRef, stockItemId, factor: 1 }, 'tester')
    confirmSale(tenantId, monthId, 'tester')

    // จำลองเฟส 3 ลงบัญชีแล้ว (agent B ทำจริงผ่าน platformMonthPosting.service.ts) — ตั้ง posted_at/journal_ids ตรงๆ
    db.prepare(`UPDATE platform_months SET status = 'POSTED', posted_at = ?, posted_by = 'tester', journal_ids = '["jv1"]' WHERE id = ?`)
      .run(new Date().toISOString(), monthId)

    expect(() => confirmSale(tenantId, monthId, 'tester')).toThrow(PlatformMonthError)
    const item = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockItemId) as any
    expect(item.quantity).toBe(90) // ตัดแค่รอบแรก ไม่ตัดซ้ำเป็น 80

    const month = db.prepare('SELECT status, posted_at, journal_ids FROM platform_months WHERE id = ?').get(monthId) as any
    expect(month.status).toBe('POSTED') // สถานะไม่ถูกย้อนกลับ SALE_CONFIRMED
    expect(month.journal_ids).toBe('["jv1"]') // ยังอยู่ ไม่ได้ถูกเขียนทับ/ลอยหาย

    // แม้ถูกเรียกตรงๆ cancelSale ก็ต้องถูกบล็อกเพราะ posted_at/journal_ids ไม่ว่าง (การ์ดชั้นที่ 2)
    expect(() => cancelSale(tenantId, monthId, 'tester')).toThrow(PlatformMonthError)
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

  // #11: เดิมผูกคู่ที่ 2 ไม่ได้เลยเพราะ UNIQUE(tenant_id, name_norm) ชนกับคู่แรกที่ "ชื่อรวม" เหมือนกัน
  // (Shopee มีได้ถึง 945 ตัวเลือก ชื่อซ้ำกันไม่ใช่เรื่องแปลก) — คีย์ใหม่ด้วย source_ref ต้องผูกได้ทั้งคู่
  it('ชื่อรวม (product · variant) ชนกันระหว่างคนละ source_ref ต้องผูกได้ทั้งคู่ ไม่ทับกัน', () => {
    const tenantId = newTenant()
    const stockItemA = makeStockItem(tenantId, { name: 'ผ้าห่ม A', category: 'FINISHED', quantity: 10, unitCost: 100 })
    const stockItemB = makeStockItem(tenantId, { name: 'ผ้าห่ม B', category: 'FINISHED', quantity: 10, unitCost: 100 })
    const monthId = makeMonth(tenantId)
    // สองตัวเลือกคนละ variant_id แต่ชื่อรวม (product_name · variant_name) เหมือนกันเป๊ะ
    addVariantRow(tenantId, monthId, { productId: 'P1', variantId: 'V1', productName: 'ผ้าห่ม', variantName: 'สีฟ้า', qtyConfirmed: 1 })
    addVariantRow(tenantId, monthId, { productId: 'P2', variantId: 'V2', productName: 'ผ้าห่ม', variantName: 'สีฟ้า', qtyConfirmed: 1 })

    const sourceRefA = sourceRefOf('SHOPEE', { variant_id: 'V1' })
    const sourceRefB = sourceRefOf('SHOPEE', { variant_id: 'V2' })
    confirmMapping(tenantId, { monthId, sourceRef: sourceRefA, stockItemId: stockItemA, factor: 1 }, 'tester')
    expect(() => confirmMapping(tenantId, { monthId, sourceRef: sourceRefB, stockItemId: stockItemB, factor: 1 }, 'tester')).not.toThrow()

    const rows = getMappingRows(tenantId, monthId)
    const rowA = rows.find(r => r.variantId === 'V1')!
    const rowB = rows.find(r => r.variantId === 'V2')!
    expect(rowA.stockItemId).toBe(stockItemA)
    expect(rowB.stockItemId).toBe(stockItemB) // ไม่ถูกคู่แรกทับ
  })

  // #11: ชื่อรองฝั่งซื้อ (GR) ที่บังเอิญชื่อตรงกับชื่อรวมฝั่งแพลตฟอร์ม ต้องไม่ไปทับคู่ Shopee ที่ผูกไว้แล้ว
  it('ชื่อรองฝั่งซื้อชื่อเดียวกับชื่อรวมฝั่งแพลตฟอร์ม ไม่ทับคู่ Shopee ที่ผูกไว้', () => {
    const tenantId = newTenant()
    const platformStockItem = makeStockItem(tenantId, { name: 'ของฝั่ง Shopee', category: 'FINISHED', quantity: 10, unitCost: 100 })
    const otherStockItem = makeStockItem(tenantId, { name: 'ของอีกตัวฝั่งซื้อ', category: 'RAW', quantity: 5, unitCost: 1 })
    const monthId = makeMonth(tenantId)
    addVariantRow(tenantId, monthId, { productId: 'P1', variantId: 'V1', productName: 'สินค้า', variantName: 'ชื่อชนกัน', qtyConfirmed: 1 })
    const sourceRef = sourceRefOf('SHOPEE', { variant_id: 'V1' })
    confirmMapping(tenantId, { monthId, sourceRef, stockItemId: platformStockItem, factor: 1 }, 'tester')

    // rememberAlias ฝั่งซื้อ (goodsReceipt.service.ts เรียกแบบไม่ใส่ onlyIfAbsent) ด้วยชื่อที่ตรงกับ
    // "product_name · variant_name" ของแถวข้างบนเป๊ะ (rowNameOf join ด้วย ' · ') — ต้องไม่ไปทับ source_ref เดิม
    rememberAlias(tenantId, 'สินค้า · ชื่อชนกัน', otherStockItem, 'GR-999', 'tester')

    const alias = (db.prepare('SELECT stock_item_id, source_ref, factor FROM stock_item_aliases WHERE tenant_id = ? AND source_ref = ?').get(tenantId, sourceRef)) as any
    expect(alias.stock_item_id).toBe(platformStockItem) // ไม่ถูกทับเป็น otherStockItem
    expect(Number(alias.factor)).toBe(1)
  })
})

  // ไฟล์ orders บังคับก่อนยืนยันการขายเสมอ — ยอด "ยืนยันแล้ว" ของ Shopee ยังรวมออเดอร์ที่ยกเลิกหลังยืนยัน
  it('ยืนยันการขายไม่ได้ถ้ายังไม่ส่งไฟล์ orders (ถึงจะผูก SKU ครบแล้วก็ตาม)', () => {
    const tenantId = newTenant()
    const stockItemId = makeStockItem(tenantId, { name: 'หมวก', category: 'FINISHED', quantity: 50, unitCost: 20 })
    const monthId = makeMonth(tenantId, { noOrders: true })
    const sourceRef = sourceRefOf('SHOPEE', { variant_id: 'V1' })
    addVariantRow(tenantId, monthId, { productId: 'P1', variantId: 'V1', productName: 'หมวก', variantName: 'ฟรีไซส์', qtyConfirmed: 10, qtyNet: 10 })
    confirmMapping(tenantId, { monthId, sourceRef, stockItemId, factor: 1 }, 'tester')

    expect(() => confirmSale(tenantId, monthId, 'tester')).toThrow(/orders/)
    const item = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockItemId) as any
    expect(item.quantity).toBe(50) // ไม่ถูกตัดเลย
  })

  // qty_net = qty_confirmed - cancelled - returned (คำนวณจากไฟล์ orders) ไม่ใช่ qty_confirmed ดิบ
  it('ยืนยันการขายตัดสต็อกตาม qty_net ไม่ใช่ qty_confirmed: ยืนยัน 10 ยกเลิก 2 คืน 1 → ตัดแค่ 7', () => {
    const tenantId = newTenant()
    const stockItemId = makeStockItem(tenantId, { name: 'กระติกน้ำ', category: 'FINISHED', quantity: 100, unitCost: 30 })
    const monthId = makeMonth(tenantId)
    const sourceRef = sourceRefOf('SHOPEE', { variant_id: 'V1' })
    // qty_confirmed ดิบของ Shopee = 10 แต่สุทธิหลังหักยกเลิก 2 + คืน 1 (ไฟล์ orders คำนวณไว้แล้ว) = 7
    addVariantRow(tenantId, monthId, { productId: 'P1', variantId: 'V1', productName: 'กระติกน้ำ', variantName: 'สีเงิน', qtyConfirmed: 10, qtyNet: 7 })
    confirmMapping(tenantId, { monthId, sourceRef, stockItemId, factor: 1 }, 'tester')

    const result = confirmSale(tenantId, monthId, 'tester')
    expect(result.breakdown).toHaveLength(1)
    expect(result.breakdown[0].qty).toBe(7)
    expect(result.cogsAmount).toBe(210) // 7 * 30

    const item = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockItemId) as any
    expect(item.quantity).toBe(93) // 100 - 7 ไม่ใช่ 100 - 10
  })
