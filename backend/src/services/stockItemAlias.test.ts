import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import { createGoodsReceipt, confirmGoodsReceipt } from './goodsReceipt.service'
import { findAliasTarget, aliasConflictMessage, dropAlias } from './stockItem.service'
import { matchStockItem } from '../mcp/tools/shared'

/**
 * ชื่อรอง: ซื้อ "นมข้นหวาน ตรา B" มาแทน SKU "นมข้นหวาน ตรา A" แล้วยืนยันใบรับของ
 * → ครั้งหน้าซื้อชื่อเดิมเป๊ะ ระบบผูกเข้า A ให้เอง + stock log จดชื่อ B ไว้
 */
function addStock(tenantId: string, name: string, status = 'ACTIVE') {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, ?, 'raw', 0, 'pcs', 'pcs', 10, 'STOCK', ?)
  `).run(id, tenantId, 'SKU-' + id.slice(0, 8), name, status)
  return id
}

/** PO ที่บรรทัดชื่อยี่ห้อ B แต่ผูกกับ SKU A แล้วรับของ + ยืนยัน */
function receiveBrandB(tenantId: string, email: string, stockAId: string, lineName: string) {
  const supplierId = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')")
    .run(supplierId, tenantId, supplierId)
  const poId = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_rate, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'APPROVED', 100, 0, 0, 100, ?, ?)
  `).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, now, now)
  const poItemId = generateId()
  db.prepare(`
    INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty)
    VALUES (?, ?, ?, ?, ?, 10, 'pcs', 10, 100, 0)
  `).run(poItemId, tenantId, poId, stockAId, lineName)
  const created = createGoodsReceipt(tenantId, email, {
    purchaseOrderId: poId,
    items: [{ poItemId, materialId: stockAId, orderedQty: 10, receivedQty: 10, acceptedQty: 10, rejectedQty: 0 }] as any,
  }) as any
  return confirmGoodsReceipt(tenantId, 'u1', created.id) as any
}

describe('ชื่อรองของสินค้า (ยี่ห้อ B ใช้แทน SKU ยี่ห้อ A)', () => {
  it('ยืนยันใบรับของแล้วจำชื่อ B → ครั้งหน้าผูกเข้า A ให้เอง และ stock log มีชื่อ B', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const a = addStock(user.tenantId, 'นมข้นหวาน ตรา A')
    expect(matchStockItem(user.tenantId, 'นมข้นหวาน ตรา B', true).exact).toBeNull()

    const gr = receiveBrandB(user.tenantId, user.email, a, 'นมข้นหวาน ตรา B')

    const m = matchStockItem(user.tenantId, '  นมข้นหวาน  ตรา b ', true)
    expect(m.exact?.id).toBe(a)
    expect(m.viaAlias).toBe(gr.gr_number)

    const log = db.prepare("SELECT notes FROM stock_movements WHERE stock_item_id = ? AND reference LIKE 'GR:%'").get(a) as any
    expect(log.notes).toContain('รับ "นมข้นหวาน ตรา B"')
  })

  it('ฝั่งขายไม่ใช้ชื่อรอง · ชื่อที่ตรงกับ SKU เองไม่ถูกจำเป็นชื่อรอง', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const a = addStock(user.tenantId, 'ไข่ไก่')
    receiveBrandB(user.tenantId, user.email, a, 'ไข่ไก่ ฟาร์ม B')
    receiveBrandB(user.tenantId, user.email, a, 'ไข่ไก่')

    expect(matchStockItem(user.tenantId, 'ไข่ไก่ ฟาร์ม B', false).exact).toBeNull()
    const n = (db.prepare('SELECT COUNT(*) c FROM stock_item_aliases WHERE tenant_id = ?').get(user.tenantId) as any).c
    expect(n).toBe(1)
  })

  it('ชื่อสินค้าหลักที่ตรงเป๊ะชนะชื่อรอง · ปลายทางปิดใช้ = ไม่ผูก', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const a = addStock(user.tenantId, 'น้ำตาล ตรา A')
    receiveBrandB(user.tenantId, user.email, a, 'น้ำตาล ตรา B')
    expect(findAliasTarget(user.tenantId, 'น้ำตาล ตรา B')?.stockItemId).toBe(a)

    const b = addStock(user.tenantId, 'น้ำตาล ตรา B')        // เปิด SKU แยกทีหลัง
    expect(findAliasTarget(user.tenantId, 'น้ำตาล ตรา B')).toBeNull()
    expect(matchStockItem(user.tenantId, 'น้ำตาล ตรา B', true).exact?.id).toBe(b)

    db.prepare("UPDATE stock_items SET status = 'INACTIVE' WHERE id IN (?, ?)").run(a, b)
    expect(findAliasTarget(user.tenantId, 'น้ำตาล ตรา B')).toBeNull()
  })

  it('สร้างสินค้าชื่อเดียวกับชื่อรอง → มีข้อความให้เลือก · เลือกแยกแล้วความจำหาย', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const a = addStock(user.tenantId, 'แป้ง ตรา A')
    receiveBrandB(user.tenantId, user.email, a, 'แป้ง ตรา B')

    expect(aliasConflictMessage(user.tenantId, 'แป้ง ตรา B')).toContain('แป้ง ตรา A')
    expect(aliasConflictMessage(user.tenantId, 'แป้ง ตรา C')).toBeNull()
    dropAlias(user.tenantId, 'แป้ง ตรา B')
    expect(aliasConflictMessage(user.tenantId, 'แป้ง ตรา B')).toBeNull()
  })

  it('ของหมด (status OUT) ยังผูกด้วยชื่อตรงได้ — เดิมกรองแค่ ACTIVE', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const out = addStock(user.tenantId, 'เกลือ', 'OUT')
    expect(matchStockItem(user.tenantId, 'เกลือ', true).exact?.id).toBe(out)
  })
})
