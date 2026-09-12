import db from '../db/sqlite'
import { generateId } from '../utils/id'

/**
 * ตรรกะ "แก้ไข PO ที่ออกไปแล้ว" ยกออกมาจาก routes/purchaseOrder.routes.ts PUT /:id
 *
 * ต้องเรียกได้จาก 2 ที่: ตัว route เอง (ตอนไม่ต้องขออนุมัติ) และ executeApprovedAction()
 * ในตอนเจ้าของกดอนุมัติ draft ที่พนักงานเสนอไว้ — เหมือนที่ stockMovement.service.ts ทำไว้ให้
 * หมวดปรับสต็อก ห้ามมีตรรกะซ้ำสองชุด
 */

export interface PurchaseOrderUpdatePayload {
  supplierId?: string | null
  expectedDate?: string | null
  notes?: string | null
  items?: Array<{
    materialId?: string | null
    description?: string
    quantity: number
    unit?: string
    unitPrice: number
    notes?: string
  }>
  taxRate?: number
}

export function applyPurchaseOrderUpdate(tenantId: string, poId: string, payload: PurchaseOrderUpdatePayload) {
  const { supplierId, expectedDate, notes, items, taxRate } = payload
  const now = new Date().toISOString()

  let subtotal = 0
  if (items && items.length > 0) {
    subtotal = items.reduce((sum: number, item) => sum + (item.quantity * item.unitPrice), 0)
  }
  const tax = taxRate || 0
  const taxAmount = subtotal * (tax / 100)
  const totalAmount = subtotal + taxAmount

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE purchase_orders SET supplier_id = COALESCE(?, supplier_id), expected_date = ?,
      subtotal = ?, tax_rate = ?, tax_amount = ?, total_amount = ?, notes = COALESCE(?, notes), updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(supplierId, expectedDate || null, subtotal, tax, taxAmount, totalAmount, notes, now, poId, tenantId)

    if (items) {
      db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id = ?').run(poId)
      const insertItem = db.prepare(`
        INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description,
          quantity, unit, unit_price, total_price, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of items) {
        insertItem.run(
          generateId(), tenantId, poId, item.materialId || null, item.description || '',
          item.quantity, item.unit || '', item.unitPrice, item.quantity * item.unitPrice,
          item.notes || ''
        )
      }
    }
  })

  transaction()

  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(poId, tenantId)
  const poItems = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(poId)
  return { ...(po as any), items: poItems }
}
