import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import { applyPurchaseOrderUpdate, PurchaseOrderUpdateError } from './purchaseOrderUpdate.service'

/**
 * แก้ไขใบสั่งซื้อแล้วได้ 500 "FOREIGN KEY constraint failed" (PO-2026-00033 · 2026-09-18)
 * สองโรคซ้อนกัน:
 *  1) ฟอร์มส่ง supplierId เป็นสตริงว่าง → COALESCE('' , supplier_id) เขียน '' ทับ → FK ระเบิด
 *  2) INSERT purchase_order_items บอกคอลัมน์ 10 ตัวแต่ยัดค่า 11 ตัว (ลืม skip_stock)
 *     → พอแก้ข้อ 1 แล้วจะไประเบิดต่อเป็น RangeError ทันที
 */
function seedPo(tenantId: string) {
  const supplierId = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'ผู้ขายทดสอบ', 'ค')")
    .run(supplierId, tenantId, supplierId)

  const stockId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, sealed_qty, unit, base_unit, location, status, unit_cost)
    VALUES (?, ?, ?, 'วัตถุดิบทดสอบ', 'RAW', 0, 0, 'pcs', 'pcs', 'WH1', 'ACTIVE', 1)
  `).run(stockId, tenantId, 'MAT-' + stockId.slice(0, 5))

  const poId = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'DRAFT', 100, 0, 100, ?, ?)
  `).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, now, now)

  return { poId, supplierId, stockId }
}

describe('applyPurchaseOrderUpdate — บันทึกแก้ไขใบสั่งซื้อ', () => {
  it('supplierId เป็นสตริงว่าง ต้องไม่ไปเขียนทับผู้ขายเดิมจนชน FK', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId, supplierId } = seedPo(user.tenantId)

    expect(() => applyPurchaseOrderUpdate(user.tenantId, poId, { supplierId: '', notes: 'แก้ไข' })).not.toThrow()

    const po = db.prepare('SELECT supplier_id, notes FROM purchase_orders WHERE id = ?').get(poId) as any
    expect(po.supplier_id).toBe(supplierId)
  })

  it('supplierId ที่ไม่มีอยู่จริง ต้องได้ข้อความบอกเหตุผล ไม่ใช่ FK พังกลางทาง', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId } = seedPo(user.tenantId)

    expect(() => applyPurchaseOrderUpdate(user.tenantId, poId, { supplierId: 'ไม่มีผู้ขายนี้' }))
      .toThrow(PurchaseOrderUpdateError)
  })

  it('บันทึกรายการสินค้าได้ครบ พร้อมธง skip_stock (คอลัมน์เคยขาดไปตัวหนึ่ง)', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId, stockId } = seedPo(user.tenantId)

    applyPurchaseOrderUpdate(user.tenantId, poId, {
      items: [
        { materialId: stockId, description: 'ของเข้าคลัง', quantity: 2, unit: 'pcs', unitPrice: 30, notes: 'หมายเหตุ' },
        { materialId: '', description: 'ค่าขนส่ง', quantity: 1, unit: 'pcs', unitPrice: 50, skipStock: true },
      ],
      taxRate: 0,
    })

    const rows = db.prepare(
      'SELECT material_id, description, skip_stock, notes, total_price FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY description'
    ).all(poId) as any[]
    expect(rows).toHaveLength(2)

    const service = rows.find(r => r.description === 'ค่าขนส่ง')
    expect(service.material_id).toBeNull()      // '' ต้องกลายเป็น NULL ไม่ใช่ id ผี
    expect(service.skip_stock).toBe(1)

    const goods = rows.find(r => r.description === 'ของเข้าคลัง')
    expect(goods.material_id).toBe(stockId)
    expect(goods.skip_stock).toBe(0)
    expect(goods.notes).toBe('หมายเหตุ')        // เดิม skip_stock ถูกยัดลงช่อง notes
    expect(goods.total_price).toBe(60)

    const po = db.prepare('SELECT subtotal, total_amount FROM purchase_orders WHERE id = ?').get(poId) as any
    expect(po.subtotal).toBe(110)
    expect(po.total_amount).toBe(110)
  })

  it('materialId ที่ไม่มีในคลัง ต้องบอกว่าแถวไหน ไม่ใช่ 500 เปล่า', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId } = seedPo(user.tenantId)

    expect(() => applyPurchaseOrderUpdate(user.tenantId, poId, {
      items: [{ materialId: 'ghost-id', description: 'ของผี', quantity: 1, unitPrice: 1 }],
    })).toThrow(/ของผี/)
  })
})

/**
 * ใบที่เคยรับของ/วางบิลแล้ว (ถึงจะยกเลิกเอกสารนั้นไปแล้ว แถวใน goods_receipt_items ยังอยู่)
 * แก้ไขไม่ได้เลย เพราะโค้ดเดิม "ลบรายการทั้งใบแล้วใส่ใหม่" ชน FK → 500 (PO-2026-00033)
 */
function seedReceivedLine(tenantId: string, poId: string, supplierId: string, stockId: string, qty = 3) {
  const poItemId = generateId()
  db.prepare(`
    INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description,
      quantity, unit, unit_price, total_price, received_qty)
    VALUES (?, ?, ?, ?, 'ของที่รับมาแล้ว', 10, 'pcs', 10, 100, ?)
  `).run(poItemId, tenantId, poId, stockId, qty)

  const grId = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, received_by, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'tester', 'CANCELLED', ?, ?)
  `).run(grId, tenantId, 'GR-' + grId.slice(0, 6), poId, supplierId, now, now)

  db.prepare(`
    INSERT INTO goods_receipt_items (id, tenant_id, goods_receipt_id, purchase_order_item_id, material_id, ordered_qty, received_qty)
    VALUES (?, ?, ?, ?, ?, 10, ?)
  `).run(generateId(), tenantId, grId, poItemId, stockId, qty)

  return { poItemId, grId }
}

describe('applyPurchaseOrderUpdate — ใบที่มีใบรับของอ้างอยู่', () => {
  it('แก้ไขรายการเดิมได้ ไม่ชน FK และ received_qty ต้องไม่ถูกล้าง', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId, supplierId, stockId } = seedPo(user.tenantId)
    const { poItemId } = seedReceivedLine(user.tenantId, poId, supplierId, stockId, 3)

    applyPurchaseOrderUpdate(user.tenantId, poId, {
      items: [{ id: poItemId, materialId: stockId, description: 'ของที่รับมาแล้ว', quantity: 12, unit: 'pcs', unitPrice: 11 }],
      taxRate: 0,
    })

    const row = db.prepare('SELECT id, quantity, unit_price, received_qty FROM purchase_order_items WHERE purchase_order_id = ?').get(poId) as any
    expect(row.id).toBe(poItemId)          // ต้องเป็นแถวเดิม ไม่ใช่แถวใหม่
    expect(row.quantity).toBe(12)
    expect(row.unit_price).toBe(11)
    expect(row.received_qty).toBe(3)       // เดิมโดนล้างเป็น 0 เพราะ insert แถวใหม่
  })

  it('ไม่ส่ง id มา (ฟอร์มรุ่นเก่า/MCP) ก็ต้องจับคู่แถวเดิมได้ ไม่ใช่ลบทิ้ง', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId, supplierId, stockId } = seedPo(user.tenantId)
    const { poItemId } = seedReceivedLine(user.tenantId, poId, supplierId, stockId, 2)

    applyPurchaseOrderUpdate(user.tenantId, poId, {
      items: [{ materialId: stockId, description: 'ของที่รับมาแล้ว', quantity: 10, unit: 'pcs', unitPrice: 12 }],
      taxRate: 0,
    })

    const rows = db.prepare('SELECT id, unit_price FROM purchase_order_items WHERE purchase_order_id = ?').all(poId) as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(poItemId)
    expect(rows[0].unit_price).toBe(12)
  })

  it('ลบรายการที่มีใบรับของอ้างอยู่ ต้องบอกเหตุผล ไม่ใช่ 500', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId, supplierId, stockId } = seedPo(user.tenantId)
    seedReceivedLine(user.tenantId, poId, supplierId, stockId, 1)

    expect(() => applyPurchaseOrderUpdate(user.tenantId, poId, {
      items: [{ materialId: stockId, description: 'รายการใหม่คนละตัว', quantity: 1, unit: 'pcs', unitPrice: 5 }],
      taxRate: 0,
    })).toThrow(/ใบรับสินค้า/)

    // ล้มแล้วต้องไม่ทิ้งของครึ่ง ๆ กลาง ๆ — transaction ต้อง rollback ทั้งก้อน
    const rows = db.prepare('SELECT description FROM purchase_order_items WHERE purchase_order_id = ?').all(poId) as any[]
    expect(rows.map(r => r.description)).toEqual(['ของที่รับมาแล้ว'])
  })

  it('ลดจำนวนสั่งต่ำกว่าที่รับมาแล้วไม่ได้', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const { poId, supplierId, stockId } = seedPo(user.tenantId)
    const { poItemId } = seedReceivedLine(user.tenantId, poId, supplierId, stockId, 5)

    expect(() => applyPurchaseOrderUpdate(user.tenantId, poId, {
      items: [{ id: poItemId, materialId: stockId, description: 'ของที่รับมาแล้ว', quantity: 2, unit: 'pcs', unitPrice: 10 }],
      taxRate: 0,
    })).toThrow(/รับของมาแล้ว/)
  })
})
