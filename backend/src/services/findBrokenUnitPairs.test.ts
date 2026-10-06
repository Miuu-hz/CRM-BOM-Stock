import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import { findBrokenUnitPairs, createConversion, invalidateConversionGraphCache } from './unitConversion.service'

/**
 * ครอบคลุม: สินค้าหน่วยฐาน kg + บรรทัด BOM ใช้ "ถุง" (bag) ที่ยังไม่มีกฎแปลง → ต้องเจอว่า broken
 * ตั้งกฎแปลงแล้ว → ต้องไม่เจอ (ไม่ broken อีก) · เทแนนต์อื่นห้ามโผล่มาปนกัน
 */

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['bom_items', 'boms', 'unit_conversions', 'stock_items', 'users']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* ข้ามตารางที่ไม่มี tenant_id */ }
    }
    invalidateConversionGraphCache(t)
  }
})

function seedBrokenBom(tenantId: string) {
  const stockId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, 'ผงแป้งทดสอบ', 'RAW', 0, 'kg', 'kg', 0, 'MAIN', 'ACTIVE')
  `).run(stockId, tenantId, 'MAT-' + stockId.slice(0, 6))

  // boms.product_id FK ชี้ stock_items(id) (ไม่ใช่ตาราง products ที่ตายแล้ว) — ใช้ stockId เดิมพอ
  const bomId = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO boms (id, tenant_id, product_id, version, status, level, created_at, updated_at)
    VALUES (?, ?, ?, '1', 'ACTIVE', 0, ?, ?)
  `).run(bomId, tenantId, stockId, now, now)

  const bomItemId = generateId()
  db.prepare(`
    INSERT INTO bom_items (id, tenant_id, bom_id, item_type, material_id, quantity, unit)
    VALUES (?, ?, ?, 'material', ?, 2, 'ถุง')
  `).run(bomItemId, tenantId, bomId, stockId)

  return { stockId, bomId, bomItemId }
}

describe('findBrokenUnitPairs', () => {
  it('เจอคู่ (สินค้า, หน่วย) ที่ใช้จริงใน BOM แต่แปลงกลับหน่วยฐานไม่ได้ — หลังตั้งกฎแล้วต้องไม่เจออีก', () => {
    const { tenantId } = createTestUser({ role: 'ADMIN' })
    tenants.push(tenantId)
    const { stockId } = seedBrokenBom(tenantId)

    const before = findBrokenUnitPairs(tenantId)
    const hit = before.find((b) => b.stock_item_id === stockId)
    expect(hit).toBeTruthy()
    expect(hit!.unit).toBe('bag') // normalizeUnit('ถุง') === 'bag'
    expect(hit!.base_unit).toBe('kg')
    expect(hit!.used_in).toContain('bom')
    expect(hit!.count).toBe(1)

    // ตั้งกฎแปลงหน่วยให้ (1 ถุง = 5 กก.) — ผ่าน service เดียวกับที่ REST/MCP ใช้ ไม่ใช่ INSERT ตรง
    // เพราะ createConversion() เป็นตัว invalidate graph cache ให้ด้วย
    createConversion(tenantId, { material_id: stockId, from_unit: 'bag', to_unit: 'kg', conversion_factor: 5 })

    const after = findBrokenUnitPairs(tenantId)
    expect(after.find((b) => b.stock_item_id === stockId)).toBeUndefined()
  })

  it('เทแนนต์อื่นไม่โผล่มาปน', () => {
    const { tenantId: tenantA } = createTestUser({ role: 'ADMIN' })
    const { tenantId: tenantB } = createTestUser({ role: 'ADMIN' })
    tenants.push(tenantA, tenantB)

    seedBrokenBom(tenantA)
    const { stockId: stockB } = seedBrokenBom(tenantB)

    const resultA = findBrokenUnitPairs(tenantA)
    expect(resultA.some((b) => b.stock_item_id === stockB)).toBe(false)
  })
})
