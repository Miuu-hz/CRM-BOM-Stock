import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import posStockService from './pos-stock.service'

/**
 * เมนู POS ผูกกับ `stock_items` ตรง ๆ (`pos_menu_configs.product_id` = `stock_items.id`)
 * แต่โค้ดเดิม `JOIN products` ซึ่งเป็นตารางที่เลิกใช้แล้ว (เหลือ 12 แถวของ Testshop)
 * ⇒ คิวรีไม่คืนแถวเลย: เช็คของพอขายไหม → throw 'Menu not found' · เตือนของใกล้หมด → ว่างตลอด
 *
 * เทสต์นี้ **ไม่แตะตาราง products เลยสักแถว** — ถ้าผ่านแปลว่าเลิกพึ่งตารางตายได้จริง
 */
function seedMenuWithBom(opts: { materialQty: number; minStock: number }) {
  const tenantId = 'tn' + generateId().slice(0, 10)

  const mkStock = (name: string, qty: number, minStock = 0) => {
    const id = generateId()
    db.prepare(`
      INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, min_stock, unit, base_unit, location, status)
      VALUES (?, ?, ?, ?, 'raw', ?, ?, 'g', 'g', 'STOCK', 'ACTIVE')
    `).run(id, tenantId, 'SKU-' + id.slice(0, 8), name, qty, minStock)
    return id
  }

  const menuProductId = mkStock('ข้าวผัดทดสอบ', 0)
  const materialId = mkStock('ข้าวสารทดสอบ', opts.materialQty, opts.minStock)

  const bomId = generateId()
  db.prepare(`INSERT INTO boms (id, tenant_id, product_id, version, status) VALUES (?, ?, ?, 'v1', 'ACTIVE')`)
    .run(bomId, tenantId, menuProductId)
  db.prepare(`
    INSERT INTO bom_items (id, tenant_id, bom_id, material_id, item_type, quantity, unit)
    VALUES (?, ?, ?, ?, 'MATERIAL', 100, 'g')
  `).run(generateId(), tenantId, bomId, materialId)

  const menuId = generateId()
  db.prepare(`
    INSERT INTO pos_menu_configs (id, tenant_id, product_id, bom_id, pos_price, is_available, is_pos_enabled)
    VALUES (?, ?, ?, ?, 50, 1, 1)
  `).run(menuId, tenantId, menuProductId, bomId)

  return { tenantId, menuId, menuProductId, materialId }
}

describe('เมนู POS ต้องอ่านชื่อสินค้าจาก stock_items ไม่ใช่ตาราง products ที่ตายแล้ว', () => {
  it('เช็คว่าเมนูนี้ของพอขายไหม — ต้องไม่ throw "Menu not found" และคืนชื่อเมนูถูก', async () => {
    const { tenantId, menuId } = seedMenuWithBom({ materialQty: 1000, minStock: 0 })

    const result = await posStockService.checkStockAvailability(menuId, 1, tenantId)

    expect(result).toBeTruthy()
    expect(result.menuName).toBe("ข้าวผัดทดสอบ")
    // วัตถุดิบ 1000 g ใช้ครั้งละ 100 g → ขายได้ 10 จาน (menuName ต้องมาจาก stock_items)
    expect(result.canFulfill).toBe(true)
    expect(result.maxAvailable).toBe(10)
  })

  it('เตือนวัตถุดิบเมนูใกล้หมด — ต้องเจอเมนูที่วัตถุดิบต่ำกว่า min_stock', async () => {
    const { tenantId } = seedMenuWithBom({ materialQty: 50, minStock: 100 })

    const low = await posStockService.getLowStockMenus(tenantId)

    expect(low.length).toBeGreaterThan(0)
    expect(low[0].product_name).toBe('ข้าวผัดทดสอบ')      // ชื่อมาจาก stock_items
    expect(low[0].stock_item_name).toBe('ข้าวสารทดสอบ')
  })

  it('ของบริษัทอื่นต้องไม่หลุดข้ามมา (ด่าน tenant_id ที่เพิ่งเติมตอนเปลี่ยน join)', async () => {
    const a = seedMenuWithBom({ materialQty: 50, minStock: 100 })
    const b = seedMenuWithBom({ materialQty: 50, minStock: 100 })

    const lowA = await posStockService.getLowStockMenus(a.tenantId)
    const lowB = await posStockService.getLowStockMenus(b.tenantId)

    expect(lowA.length).toBe(1)
    expect(lowB.length).toBe(1)
    expect(lowA[0].menu_id).toBe(a.menuId)
    expect(lowB[0].menu_id).toBe(b.menuId)
  })

  it('ตาราง products ต้องไม่ถูกใช้เลย — ลบทิ้งชั่วคราวแล้วยังทำงานได้', async () => {
    const { tenantId, menuId } = seedMenuWithBom({ materialQty: 500, minStock: 0 })

    // พิสูจน์ว่าไม่พึ่ง products จริง: ไม่มีแถวไหนใน products ที่ตรงกับ product_id ของเมนูนี้
    const hit = db.prepare('SELECT COUNT(*) c FROM products p JOIN pos_menu_configs m ON m.product_id = p.id WHERE m.tenant_id = ?')
      .get(tenantId) as any
    expect(hit.c).toBe(0)

    const result = await posStockService.checkStockAvailability(menuId, 1, tenantId)
    expect(result.canFulfill).toBe(true)
  })
})
