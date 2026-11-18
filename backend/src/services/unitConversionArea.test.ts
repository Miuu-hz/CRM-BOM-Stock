import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import { resolveConversion, createConversion, invalidateConversionGraphCache, normalizeUnit } from './unitConversion.service'

/**
 * ผ้าซื้อเป็นม้วน/เมตร แต่ BOM ตัดเป็น "ตร.นิ้ว" · ใยซื้อเป็นแผ่น แต่ BOM ใช้เป็นกรัม
 * พื้นที่ ↔ ความยาว ต้องรู้หน้ากว้างผ้า จึงเป็นกฎรายสินค้า (m → in2) ไม่ใช่มาตราสากล
 */

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['unit_conversions', 'stock_items', 'users']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* ข้าม */ }
    }
    invalidateConversionGraphCache(t)
  }
})

function seedItem(tenantId: string, unit: string) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, 'ทดสอบ', 'RAW', 0, ?, ?, 0, 'MAIN', 'ACTIVE')
  `).run(id, tenantId, 'T-' + id.slice(0, 6), unit, unit)
  return id
}

describe('หน่วยพื้นที่ + ผ้าหน้ากว้าง', () => {
  it('มาตราสากล: ตร.นิ้ว → ตร.ซม. = 6.4516, หลา → เมตร = 0.9144', () => {
    const { tenantId } = createTestUser({ role: 'ADMIN' })
    tenants.push(tenantId)
    expect(normalizeUnit('ตร.นิ้ว')).toBe('in2')
    expect(resolveConversion('ตร.นิ้ว', 'cm2', tenantId)!.factor).toBeCloseTo(6.4516, 10)
    expect(resolveConversion('cm2', 'ตารางนิ้ว', tenantId)!.factor).toBeCloseTo(1 / 6.4516, 10)
    expect(resolveConversion('ตร.ม.', 'in2', tenantId)!.factor).toBeCloseTo(10000 / 6.4516, 6)
    expect(resolveConversion('หลา', 'm', tenantId)!.factor).toBeCloseTo(0.9144, 10)
  })

  it('ผ้าหน้ากว้าง 220 ซม.: m → in2 รายสินค้า แปลงได้ทั้งสองทิศ และต่อลูกโซ่จากม้วน', () => {
    const { tenantId } = createTestUser({ role: 'ADMIN' })
    tenants.push(tenantId)
    const fabric = seedItem(tenantId, 'm')
    const other = seedItem(tenantId, 'm')
    const mToIn2 = 220 * 100 / 6.4516 // 1 m × 2.20 m = 22000 cm² ≈ 3410.0068 in²
    createConversion(tenantId, { material_id: fabric, from_unit: 'm', to_unit: 'ตร.นิ้ว', conversion_factor: mToIn2 })
    createConversion(tenantId, { from_unit: 'roll', to_unit: 'yard', conversion_factor: 100 })
    invalidateConversionGraphCache(tenantId)

    // BOM ใช้ 6514.45 ตร.นิ้ว → ตัดสต็อกเป็นเมตร (ทิศกลับของกฎ)
    expect(resolveConversion('ตร.นิ้ว', 'm', tenantId, fabric)!.factor * 6514.45).toBeCloseTo(1.9104, 4)
    expect(resolveConversion('m', 'in2', tenantId, fabric)!.factor).toBeCloseTo(3410.0068, 4)
    // ม้วน 100 หลา = 91.44 m = 311,811 ตร.นิ้ว (roll → yard → m → in2)
    expect(resolveConversion('roll', 'ตร.นิ้ว', tenantId, fabric)!.factor).toBeCloseTo(91.44 * mToIn2, 3)
    // กฎรายสินค้าไม่รั่วไปผ้าตัวอื่นที่ยังไม่ได้ตั้งหน้ากว้าง
    expect(resolveConversion('in2', 'm', tenantId, other)).toBeNull()
  })

  it('ใยแผ่น 900 กรัม: sheet → g รายสินค้า ทำให้ BOM ที่ใช้กรัมแปลงเป็นแผ่นได้', () => {
    const { tenantId } = createTestUser({ role: 'ADMIN' })
    tenants.push(tenantId)
    const fiber = seedItem(tenantId, 'sheet')
    createConversion(tenantId, { material_id: fiber, from_unit: 'bag', to_unit: 'sheet', conversion_factor: 8 })
    createConversion(tenantId, { material_id: fiber, from_unit: 'sheet', to_unit: 'g', conversion_factor: 900 })
    invalidateConversionGraphCache(tenantId)

    expect(resolveConversion('กรัม', 'sheet', tenantId, fiber)!.factor * 900).toBeCloseTo(1, 10)
    expect(resolveConversion('kg', 'sheet', tenantId, fiber)!.factor).toBeCloseTo(1000 / 900, 10)
    expect(resolveConversion('bag', 'kg', tenantId, fiber)!.factor).toBeCloseTo(7.2, 10)
  })
})
