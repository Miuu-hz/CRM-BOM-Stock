import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import { listAliases, deleteAliasById, upsertPlatformAlias, findPlatformAlias, deletePlatformAlias } from './stockItem.service'

// ============================================================
// บั๊กใหม่ (review item A/B): คู่ Shopee (name_norm = '__platform__:...') โผล่ในช่องค้นหาชื่อรอง
// ของหน้าซื้อ/ขาย (ผ่าน GET /stock/aliases → listAliases) พร้อม factor ของ Shopee เอง — ถ้าเลือกใช้ จะได้
// ตัวคูณที่ UI เอาไปตั้งราคาไม่ตรงกับตัวคูณที่ตัดสต็อกจริงใช้ (findAliasTarget หาไม่เจอเพราะคีย์คนละ namespace)
// แก้: listAliases + deleteAliasById ต้องไม่เห็น/ไม่แตะแถวที่ name_norm ขึ้นต้น '__platform__:' เลย —
// ผูก/ลบคู่แพลตฟอร์มได้ทางเดียวคือ findPlatformAlias/upsertPlatformAlias/deletePlatformAlias เท่านั้น
// ============================================================

function addStock(tenantId: string, name: string) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, ?, 'FINISHED', 0, 'pcs', 'pcs', 10, 'STOCK', 'ACTIVE')
  `).run(id, tenantId, 'SKU-' + id.slice(0, 8), name)
  return id
}

describe('คู่ Shopee ไม่ใช่ชื่อรองทั่วไป — ซ่อนจากช่องค้นหา/ลบไม่ได้ทางทั่วไป', () => {
  it('listAliases (ช่องค้นหารวมหน้าซื้อ/ขาย) ไม่คืนคู่แพลตฟอร์ม', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const t = user.tenantId
    const a = addStock(t, 'เสื้อยืดสีแดง')
    upsertPlatformAlias(t, { sourceRef: 'SHOPEE:123', name: 'เสื้อยืดสีแดง · ไซส์ M', stockItemId: a, unit: 'ตัว', factor: 2 }, user.userId)

    const all = listAliases(t)
    expect(all.find((x: any) => x.source_ref === 'SHOPEE:123')).toBeUndefined()

    // ฟังก์ชันเฉพาะฝั่งแพลตฟอร์มยังทำงานปกติ ไม่ถูกแตะ
    expect(findPlatformAlias(t, 'SHOPEE:123')?.stockItemId).toBe(a)
  })

  it('listAliases(stockItemId) (มุมมองสินค้าเดี่ยวหน้าสต็อก) ก็ไม่โชว์คู่แพลตฟอร์ม', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const t = user.tenantId
    const a = addStock(t, 'กางเกงยีนส์')
    upsertPlatformAlias(t, { sourceRef: 'SHOPEE:456', name: 'กางเกงยีนส์ · ไซส์ L', stockItemId: a, unit: 'ตัว', factor: 3 }, user.userId)

    const forItem = listAliases(t, a)
    expect(forItem.find((x: any) => x.source_ref === 'SHOPEE:456')).toBeUndefined()
  })

  it('deleteAliasById ลบคู่แพลตฟอร์มไม่ได้ — ต้องใช้ deletePlatformAlias เท่านั้น', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const t = user.tenantId
    const a = addStock(t, 'กระเป๋า')
    upsertPlatformAlias(t, { sourceRef: 'SHOPEE:789', name: 'กระเป๋า · สีดำ', stockItemId: a, unit: 'ใบ', factor: 1 }, user.userId)
    const row = db.prepare(`SELECT id FROM stock_item_aliases WHERE tenant_id = ? AND source_ref = ?`).get(t, 'SHOPEE:789') as any

    expect(deleteAliasById(t, row.id)).toBe(false)
    expect(findPlatformAlias(t, 'SHOPEE:789')?.stockItemId).toBe(a) // ยังอยู่ ไม่ถูกลบ

    deletePlatformAlias(t, 'SHOPEE:789')
    expect(findPlatformAlias(t, 'SHOPEE:789')).toBeNull()
  })
})
