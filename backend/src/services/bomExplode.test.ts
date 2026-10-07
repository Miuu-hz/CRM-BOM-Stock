import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { getBomIngredientsRecursive, resolveMenuBomId } from './pos-stock.service'

// สูตรซ้อน: จาน → [ข้าว 100g, ไข่ต้ม 1 (MATERIAL แต่มี BOM กึ่งสำเร็จ), น้ำยำ 1 (CHILD_BOM), น้ำยำ 1 (ซ้ำอีกบรรทัด), ขนมจีน 50g (มี BOM แต่ไม่ใช่กึ่งสำเร็จ)]
const T = 'test_bom_explode_' + Date.now()
const ids: Record<string, string> = {}

function item(key: string, unit: string) {
  ids[key] = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
    VALUES (?, ?, ?, ?, 'RAW', 100, ?, ?, 'WH1', 'ACTIVE')`).run(ids[key], T, ids[key], key, unit, unit)
}
function bom(key: string, product: string, semi: number, outQty = 1, outUnit: string | null = null) {
  ids[key] = generateId()
  db.prepare(`INSERT INTO boms (id, tenant_id, product_id, version, status, level, is_semi_finished, output_qty, output_unit, created_at, updated_at)
    VALUES (?, ?, ?, 'standard', 'ACTIVE', 0, ?, ?, ?, datetime('now'), datetime('now'))`).run(ids[key], T, ids[product], semi, outQty, outUnit)
}
function line(bomKey: string, type: string, mat: string, qty: number, unit: string, child: string | null = null) {
  db.prepare(`INSERT INTO bom_items (id, tenant_id, bom_id, item_type, material_id, child_bom_id, quantity, unit, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`).run(generateId(), T, ids[bomKey], type, ids[mat], child ? ids[child] : null, qty, unit)
}

afterEach(() => {
  db.prepare('DELETE FROM bom_items WHERE tenant_id = ?').run(T)
  db.prepare('DELETE FROM boms WHERE tenant_id = ?').run(T)
  db.prepare('DELETE FROM stock_items WHERE tenant_id = ?').run(T)
})

describe('แตก BOM พวงต่อกัน (POS ตัดสต็อก)', () => {
  it('แตก CHILD_BOM + MATERIAL กึ่งสำเร็จ, BOM ลูกซ้ำ 2 บรรทัดนับทั้งคู่, ของที่ไม่ใช่กึ่งสำเร็จตัดตรง', () => {
    for (const [k, u] of [['dish', 'plate'], ['rice', 'g'], ['egg_boiled', 'pcs'], ['egg', 'pcs'],
      ['yum', 'serving'], ['chili', 'g'], ['noodle', 'g'], ['flour', 'g']] as const) item(k, u)
    bom('B_dish', 'dish', 0, 1, 'plate')
    bom('B_egg', 'egg_boiled', 1)               // ไข่ต้ม = ทำทีละจาน
    bom('B_yum', 'yum', 1, 1, 'serving')
    bom('B_noodle', 'noodle', 0)                // ขนมจีนซื้อมาเป็นสต็อก ไม่แตก
    line('B_egg', 'MATERIAL', 'egg', 1, 'pcs')
    line('B_yum', 'MATERIAL', 'chili', 2, 'g')
    line('B_noodle', 'MATERIAL', 'flour', 999, 'g')
    line('B_dish', 'MATERIAL', 'rice', 100, 'g')
    line('B_dish', 'MATERIAL', 'egg_boiled', 1, 'pcs')
    line('B_dish', 'CHILD_BOM', 'yum', 1, 'serving', 'B_yum')
    line('B_dish', 'CHILD_BOM', 'yum', 1, 'serving', 'B_yum')
    line('B_dish', 'MATERIAL', 'noodle', 50, 'g')

    const got = getBomIngredientsRecursive(ids.B_dish, T, 1)
    const used = (k: string) => got.filter(g => g.stock_item_id === ids[k]).reduce((s, g) => s + g.quantity_used, 0)
    expect(used('rice')).toBe(100)
    expect(used('egg')).toBe(1)          // แตกไข่ต้ม → ไข่
    expect(used('egg_boiled')).toBe(0)
    expect(used('chili')).toBe(4)        // น้ำยำ 2 บรรทัด × 2g (เดิมบรรทัดที่ 2 หายเงียบ)
    expect(used('yum')).toBe(0)
    expect(used('noodle')).toBe(50)      // ไม่ใช่กึ่งสำเร็จ → ตัดสต็อกตรง
    expect(used('flour')).toBe(0)
  })

  it('เมนูที่ bom_id ว่าง ใช้ BOM ACTIVE ของสินค้าแทน', () => {
    item('dish', 'plate')
    bom('B_dish', 'dish', 0)
    expect(resolveMenuBomId(T, null, ids.dish)).toBe(ids.B_dish)
    expect(resolveMenuBomId(T, 'explicit', ids.dish)).toBe('explicit')
    expect(resolveMenuBomId(T, null, null)).toBeNull()
  })
})
