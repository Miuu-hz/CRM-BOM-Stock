import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import {
  sourceRefOf,
  getMappingRows,
  proposeSkuMapping,
  acceptAllProposals,
} from './platformMonthSale.service'

const tenants: string[] = []

function setupTenant() {
  const t = 'test_pms_' + generateId()
  tenants.push(t)
  db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock) VALUES (?, ?, 0)').run(t, 'test')
  return t
}

function seedMonth(tenantId: string, month = '2026-10') {
  const monthId = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO platform_months (id, tenant_id, platform, shop_key, month, status, created_at, updated_at)
    VALUES (?, ?, 'SHOPEE', 'shop1', ?, 'COLLECTING', ?, ?)
  `).run(monthId, tenantId, month, now, now)
  return monthId
}

function seedProductRow(
  tenantId: string,
  monthId: string,
  opts: { productId: string; variantId?: string | null; level: 'parent' | 'variant'; productName: string; variantName?: string | null; qtyNet: number },
) {
  db.prepare(`
    INSERT INTO platform_month_products (id, tenant_id, month_id, level, product_id, variant_id, product_name, variant_name, qty_net)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(generateId(), tenantId, monthId, opts.level, opts.productId, opts.variantId ?? null, opts.productName, opts.variantName ?? null, opts.qtyNet)
}

function seedStockItem(tenantId: string, opts: { sku: string; name: string; unit?: string; baseUnit?: string; unitCost?: number; quantity?: number; status?: string }) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, ?, 'FINISHED', ?, ?, ?, ?, 'MAIN', ?)
  `).run(id, tenantId, opts.sku, opts.name, opts.quantity ?? 50, opts.unit ?? 'pcs', opts.baseUnit ?? null, opts.unitCost ?? 12.5, opts.status ?? 'ACTIVE')
  return id
}

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM platform_sku_proposals WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_item_aliases WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM platform_month_products WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM platform_months WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM company_settings WHERE tenant_id = ?').run(t)
  }
})

describe('platformMonthSale.service (B9, B10, B11)', () => {
  it('B9: sourceRefOf throw เมื่อไม่มีทั้ง variant_id และ product_id และ proposeSkuMapping ปฏิเสธคู่ที่ไม่มี id', () => {
    expect(() => sourceRefOf('SHOPEE', {})).toThrow()
    expect(() => sourceRefOf('SHOPEE', { product_id: null, variant_id: null })).toThrow()
    expect(() => sourceRefOf('SHOPEE', { product_id: '', variant_id: '' })).toThrow()
    expect(sourceRefOf('SHOPEE', { product_id: '100', variant_id: null })).toBe('SHOPEE:P100')
    expect(sourceRefOf('SHOPEE', { product_id: '100', variant_id: '200' })).toBe('SHOPEE:200')

    const t = setupTenant()
    seedMonth(t, '2026-10')
    const itemId = seedStockItem(t, { sku: 'SKU-1', name: 'สินค้า 1' })
    const res = proposeSkuMapping(t, {
      platform: 'SHOPEE',
      shopKey: 'shop1',
      month: '2026-10',
      pairs: [{ stockItemId: itemId, factor: 1 }],
    }, 'u1')
    expect(res.accepted).toBe(0)
    expect(res.rejected).toHaveLength(1)
  })

  it('B11: getMappingRows คืนค่าทุกฟิลด์ครบถ้วนตรงเดิม (mapped, proposed, unmapped, inactive alias)', () => {
    const t = setupTenant()
    const monthId = seedMonth(t, '2026-10')

    // 1) mapped row (variant)
    seedProductRow(t, monthId, { productId: 'P1', variantId: 'V1', level: 'variant', productName: 'เสื้อ', variantName: 'แดง', qtyNet: 5 })
    const mappedItemId = seedStockItem(t, { sku: 'SKU-M', name: 'เสื้อแดง', unit: 'pcs', baseUnit: 'ชิ้น', unitCost: 45, quantity: 100 })
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO stock_item_aliases (id, tenant_id, name_norm, name, stock_item_id, source_ref, unit, factor, created_by, created_at, updated_at)
      VALUES (?, ?, '__platform__:shopee:v1', 'เสื้อ · แดง', ?, 'SHOPEE:V1', 'ชิ้น', 2, 'u1', ?, ?)
    `).run(generateId(), t, mappedItemId, now, now)

    // 2) proposed row (parent without variants)
    seedProductRow(t, monthId, { productId: 'P2', variantId: null, level: 'parent', productName: 'หมวก', variantName: null, qtyNet: 3 })
    const propItemId = seedStockItem(t, { sku: 'SKU-P', name: 'หมวกแก๊ป' })
    db.prepare(`
      INSERT INTO platform_sku_proposals (id, tenant_id, source_ref, stock_item_id, factor, created_by, created_at)
      VALUES (?, ?, 'SHOPEE:PP2', ?, 3, 'u1', ?)
    `).run(generateId(), t, propItemId, now)

    // 3) unmapped row
    seedProductRow(t, monthId, { productId: 'P3', variantId: 'V3', level: 'variant', productName: 'ถุงเท้า', variantName: 'ขาว', qtyNet: 7 })

    // 4) alias ชี้ไปสินค้า INACTIVE + มี proposal → ต้องไม่ถือว่า mapped และต้องแสดงเป็น proposed
    seedProductRow(t, monthId, { productId: 'P4', variantId: 'V4', level: 'variant', productName: 'เข็มขัด', variantName: 'ดำ', qtyNet: 2 })
    const inactiveItemId = seedStockItem(t, { sku: 'SKU-OLD', name: 'เข็มขัดเก่า', status: 'INACTIVE' })
    db.prepare(`
      INSERT INTO stock_item_aliases (id, tenant_id, name_norm, name, stock_item_id, source_ref, unit, factor, created_by, created_at, updated_at)
      VALUES (?, ?, '__platform__:shopee:v4', 'เข็มขัด · ดำ', ?, 'SHOPEE:V4', 'pcs', 1, 'u1', ?, ?)
    `).run(generateId(), t, inactiveItemId, now, now)
    db.prepare(`
      INSERT INTO platform_sku_proposals (id, tenant_id, source_ref, stock_item_id, factor, created_by, created_at)
      VALUES (?, ?, 'SHOPEE:V4', ?, 1.5, 'u1', ?)
    `).run(generateId(), t, propItemId, now)

    const rows = getMappingRows(t, monthId)
    expect(rows).toEqual([
      {
        sourceRef: 'SHOPEE:V1',
        productId: 'P1',
        variantId: 'V1',
        level: 'variant',
        productName: 'เสื้อ',
        variantName: 'แดง',
        qtyNet: 5,
        mapped: true,
        stockItemId: mappedItemId,
        sku: 'SKU-M',
        stockItemName: 'เสื้อแดง',
        unit: 'ชิ้น',
        unitCost: 45,
        quantity: 100,
        factor: 2,
        proposed: false,
        proposedStockItemId: null,
        proposedSku: null,
        proposedStockItemName: null,
        proposedFactor: null,
      },
      {
        sourceRef: 'SHOPEE:PP2',
        productId: 'P2',
        variantId: null,
        level: 'parent',
        productName: 'หมวก',
        variantName: null,
        qtyNet: 3,
        mapped: false,
        stockItemId: null,
        sku: null,
        stockItemName: null,
        unit: null,
        unitCost: null,
        quantity: null,
        factor: null,
        proposed: true,
        proposedStockItemId: propItemId,
        proposedSku: 'SKU-P',
        proposedStockItemName: 'หมวกแก๊ป',
        proposedFactor: 3,
      },
      {
        sourceRef: 'SHOPEE:V3',
        productId: 'P3',
        variantId: 'V3',
        level: 'variant',
        productName: 'ถุงเท้า',
        variantName: 'ขาว',
        qtyNet: 7,
        mapped: false,
        stockItemId: null,
        sku: null,
        stockItemName: null,
        unit: null,
        unitCost: null,
        quantity: null,
        factor: null,
        proposed: false,
        proposedStockItemId: null,
        proposedSku: null,
        proposedStockItemName: null,
        proposedFactor: null,
      },
      {
        sourceRef: 'SHOPEE:V4',
        productId: 'P4',
        variantId: 'V4',
        level: 'variant',
        productName: 'เข็มขัด',
        variantName: 'ดำ',
        qtyNet: 2,
        mapped: false,
        stockItemId: null,
        sku: null,
        stockItemName: null,
        unit: null,
        unitCost: null,
        quantity: null,
        factor: null,
        proposed: true,
        proposedStockItemId: propItemId,
        proposedSku: 'SKU-P',
        proposedStockItemName: 'หมวกแก๊ป',
        proposedFactor: 1.5,
      },
    ])
  })

  it('B10: acceptAllProposals ทำงานใน transaction เดียว — ถ้าแถวหลังพัง ต้อง rollback แถวก่อนหน้าทั้งหมด', () => {
    const t = setupTenant()
    const monthId = seedMonth(t, '2026-10')
    seedProductRow(t, monthId, { productId: 'P1', variantId: 'V1', level: 'variant', productName: 'สินค้า A', variantName: null, qtyNet: 1 })
    seedProductRow(t, monthId, { productId: 'P2', variantId: 'V2', level: 'variant', productName: 'สินค้า B', variantName: null, qtyNet: 1 })

    const activeId = seedStockItem(t, { sku: 'SKU-A', name: 'สินค้า A', status: 'ACTIVE' })
    const inactiveId = seedStockItem(t, { sku: 'SKU-B', name: 'สินค้า B', status: 'INACTIVE' })
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO platform_sku_proposals (id, tenant_id, source_ref, stock_item_id, factor, created_by, created_at)
      VALUES (?, ?, 'SHOPEE:V1', ?, 1, 'u1', ?)
    `).run(generateId(), t, activeId, now)
    db.prepare(`
      INSERT INTO platform_sku_proposals (id, tenant_id, source_ref, stock_item_id, factor, created_by, created_at)
      VALUES (?, ?, 'SHOPEE:V2', ?, 1, 'u1', ?)
    `).run(generateId(), t, inactiveId, now)

    expect(() => acceptAllProposals(t, monthId, 'u1')).toThrow()

    // แถวแรกต้องไม่ถูกผูกค้าง (rollback แล้ว)
    const aliases = db.prepare('SELECT * FROM stock_item_aliases WHERE tenant_id = ?').all(t)
    const proposals = db.prepare('SELECT * FROM platform_sku_proposals WHERE tenant_id = ?').all(t)
    expect(aliases).toHaveLength(0)
    expect(proposals).toHaveLength(2)
  })
})
