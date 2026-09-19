import db from '../db/sqlite'
import { generateId } from '../utils/id'

/**
 * ตรรกะ "แก้ไข PO ที่ออกไปแล้ว" ยกออกมาจาก routes/purchaseOrder.routes.ts PUT /:id
 */

/** ข้อมูลที่ส่งมาไม่ผ่าน — ต้องตอบ 400 พร้อมบอกว่าอะไรผิด ไม่ใช่ 500 เปล่า ๆ */
export class PurchaseOrderUpdateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PurchaseOrderUpdateError'
  }
}

/**
 * ช่อง id ที่ฟอร์มส่งมาเป็นสตริงว่าง แปลว่า "ไม่ได้เลือก" ไม่ใช่ "ให้ล้างค่า"
 * ปล่อยผ่านแล้ว COALESCE(?, supplier_id) จะเขียน '' ทับของเดิม → FOREIGN KEY constraint failed
 * เป็น 500 ตอนกดบันทึก (เจอจริง PO-2026-00033 · 2026-09-18)
 */
const blankToNull = (v: unknown): string | null => {
  if (typeof v !== 'string') return (v ?? null) as string | null
  const t = v.trim()
  return t === '' ? null : t
}

/** ผู้ขายต้องมีอยู่จริงในเทแนนต์นี้ ไม่งั้น FK จะระเบิดเป็น 500 ที่อ่านไม่รู้เรื่อง */
export function resolveSupplierId(tenantId: string, supplierId: unknown): string | null {
  const id = blankToNull(supplierId)
  if (!id) return null
  const found = db.prepare(
    'SELECT 1 FROM suppliers WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)'
  ).get(id, tenantId)
  if (!found) throw new PurchaseOrderUpdateError('ไม่พบผู้ขายที่เลือก — เลือกผู้ขายอีกครั้งก่อนบันทึก')
  return id
}

export interface PurchaseOrderUpdatePayload {
  supplierId?: string | null
  expectedDate?: string | null
  notes?: string | null
  items?: Array<{
    /** id ของแถวเดิมใน purchase_order_items — มีแล้วจะ "แก้แถวเดิม" แทนการลบทิ้งแล้วสร้างใหม่ */
    id?: string | null
    materialId?: string | null
    description?: string
    quantity: number
    unit?: string
    unitPrice: number
    skipStock?: boolean | number
    skip_stock?: boolean | number
    notes?: string
  }>
  taxRate?: number
  paymentMethod?: string | null
  paymentReference?: string | null
  bankAccountId?: string | null
  isPaid?: number | boolean | null
  paidAmount?: number | null
}

/**
 * เอกสารลูกที่ยัง "มีชีวิต" และล็อกใบสั่งซื้อนี้ไว้ — ใช้ร่วมกันทั้งยกเลิกและย้อนคืนเป็นร่าง
 *
 * ⚠️ ใบแจ้งหนี้รวมได้หลาย PO (`purchase_order_ids` เป็น JSON array) เดิมเช็คแค่
 * `purchase_order_id` ของหัวใบ ใบที่ PO นี้เป็น "ใบที่สอง" จึงมองไม่เห็น
 * ของจริง: PO-2026-00032 ย้อนกลับเป็นร่างได้ทั้งที่ PI-2026-00009 (ISSUED, ลง JV ฿522 แล้ว)
 * กินบรรทัดของมันอยู่ครบทั้ง 7 แถว
 */
export function poBlockingDocuments(
  tenantId: string,
  poId: string,
  /**
   * `anyInvoiceEver` = เคยเข้าใบแจ้งหนี้แล้วถือว่าจบ ถึงใบนั้นจะยกเลิกไปแล้วก็ตาม
   * ใช้กับ "ย้อนคืนเป็นร่าง" เท่านั้น — เจ้าของตั้งกฎไว้ 2026-09-18 ว่าเข้าใบแจ้งหนี้
   * เมื่อไรคือหมดสิทธิ์ย้อน เพราะใบที่ยกเลิกแล้วยังเป็นประวัติที่อ้างบรรทัดของ PO อยู่
   * (ยกเลิก PO ยังทำได้ตามเดิม — นั่นคือปิดใบ ไม่ใช่เปิดกลับมาแก้)
   */
  opts: { anyInvoiceEver?: boolean } = {}
): { message: string } | null {
  const confirmedGR = db.prepare(
    "SELECT gr_number FROM goods_receipts WHERE tenant_id = ? AND purchase_order_id = ? AND status = 'CONFIRMED' LIMIT 1"
  ).get(tenantId, poId) as any
  if (confirmedGR) {
    return { message: `มีใบรับสินค้า ${confirmedGR.gr_number} ที่ยืนยันแล้ว กรุณายกเลิกใบรับสินค้าก่อน` }
  }

  // ใบที่ยังไม่ยกเลิกมาก่อนเสมอ ข้อความจะได้ชี้ไปที่ใบที่ยังมีชีวิตอยู่จริง
  const invoice = db.prepare(`
    SELECT pi_number, status FROM purchase_invoices
    WHERE tenant_id = ?
      AND (purchase_order_id = ? OR purchase_order_ids LIKE ?)
      AND (? = 1 OR status != 'CANCELLED')
    ORDER BY CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END
    LIMIT 1
  `).get(tenantId, poId, '%' + poId + '%', opts.anyInvoiceEver ? 1 : 0) as any
  if (invoice) {
    return {
      message: invoice.status === 'CANCELLED'
        ? `ใบนี้เคยออกใบแจ้งหนี้ ${invoice.pi_number} ไปแล้ว (ถึงจะยกเลิกไปแล้วก็ตาม) — เข้าใบแจ้งหนี้แล้วย้อนกลับเป็นร่างไม่ได้`
        : `มีใบแจ้งหนี้ ${invoice.pi_number} อ้างอิงอยู่ กรุณายกเลิกใบแจ้งหนี้ก่อน`,
    }
  }

  return null
}

export function applyPurchaseOrderUpdate(tenantId: string, poId: string, payload: PurchaseOrderUpdatePayload) {
  const { expectedDate, notes, items, taxRate, paymentMethod, paymentReference, isPaid, paidAmount } = payload
  const now = new Date().toISOString()

  // ตรวจก่อนแตะ DB: ค่าที่ทำ FK พังต้องกลายเป็น 400 ที่บอกเหตุผล ไม่ใช่ 500 กลางทาง
  const supplierId = resolveSupplierId(tenantId, payload.supplierId)
  const bankAccountId = blankToNull(payload.bankAccountId)
  if (items) {
    for (const item of items) {
      const mid = blankToNull(item.materialId)
      if (mid && !db.prepare('SELECT 1 FROM stock_items WHERE id = ?').get(mid)) {
        throw new PurchaseOrderUpdateError(
          `ไม่พบสินค้าในคลังของรายการ "${item.description || mid}" — เลือกสินค้าใหม่อีกครั้ง`
        )
      }
    }
  }

  let subtotal = 0
  if (items && items.length > 0) {
    subtotal = items.reduce((sum: number, item) => sum + (item.quantity * item.unitPrice), 0)
  }
  const tax = taxRate || 0
  const taxAmount = subtotal * (tax / 100)
  const totalAmount = subtotal + taxAmount

  const isPaidInt = isPaid !== undefined && isPaid !== null ? (isPaid ? 1 : 0) : null
  const paidAmt = paidAmount !== undefined ? paidAmount : (isPaidInt === 1 ? totalAmount : null)

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE purchase_orders SET
        supplier_id = COALESCE(?, supplier_id),
        expected_date = ?,
        subtotal = ?,
        tax_rate = ?,
        tax_amount = ?,
        total_amount = ?,
        notes = COALESCE(?, notes),
        payment_method = COALESCE(?, payment_method),
        payment_reference = COALESCE(?, payment_reference),
        bank_account_id = COALESCE(?, bank_account_id),
        is_paid = COALESCE(?, is_paid),
        paid_amount = COALESCE(?, paid_amount),
        updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(
      supplierId, expectedDate || null, subtotal, tax, taxAmount, totalAmount, notes,
      paymentMethod, paymentReference, bankAccountId, isPaidInt, paidAmt,
      now, poId, tenantId
    )

    if (items) {
      // เดิมลบรายการทั้งใบแล้ว INSERT ใหม่หมด ซึ่งพังสองทาง:
      //  1) ใบรับสินค้า/ใบแจ้งหนี้ชี้มาที่ purchase_order_items.id (FK NO ACTION)
      //     ใบที่เคยรับของหรือวางบิล (ถึงจะยกเลิกไปแล้ว แถวยังอยู่) จึงลบไม่ได้ → 500 FK
      //  2) แถวใหม่ได้ id ใหม่ + received_qty กลับเป็น 0 = ประวัติรับของขาดสายเงียบ ๆ
      // ตอนนี้จับคู่แถวเดิมแล้ว "แก้ที่แถวเดิม" · ลบเฉพาะแถวที่ถูกเอาออกจริงและไม่มีใครอ้างถึง
      const existing = db.prepare(
        'SELECT id, material_id, description, received_qty FROM purchase_order_items WHERE purchase_order_id = ?'
      ).all(poId) as Array<{ id: string; material_id: string | null; description: string; received_qty: number }>

      const byId = new Map(existing.map(r => [r.id, r]))
      // ฟอร์มรุ่นเก่า/MCP ไม่ส่ง id มา — จับคู่ด้วยสินค้า+ชื่อรายการแทน จะได้ไม่ลบทิ้งทั้งใบ
      const unused = new Map<string, string[]>()
      for (const r of existing) {
        const key = (r.material_id || '') + '|' + (r.description || '')
        if (!unused.has(key)) unused.set(key, [])
        unused.get(key)!.push(r.id)
      }

      const updateItem = db.prepare(`
        UPDATE purchase_order_items SET material_id = ?, description = ?, quantity = ?, unit = ?,
          unit_price = ?, total_price = ?, skip_stock = ?, notes = ?
        WHERE id = ? AND purchase_order_id = ?
      `)
      const insertItem = db.prepare(`
        INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description,
          quantity, unit, unit_price, total_price, skip_stock, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const kept = new Set<string>()
      for (const item of items) {
        const materialId = blankToNull(item.materialId)
        const description = item.description || ''
        const skipStock = (item.skipStock || item.skip_stock) ? 1 : 0
        const total = item.quantity * item.unitPrice

        let rowId = blankToNull(item.id)
        if (!rowId || !byId.has(rowId) || kept.has(rowId)) {
          const pool = unused.get((materialId || '') + '|' + description)
          rowId = pool?.find(id => !kept.has(id)) ?? null
        }

        if (rowId) {
          const prev = byId.get(rowId)!
          // รับของมาแล้วเท่าไร ลดจำนวนสั่งต่ำกว่านั้นไม่ได้ ไม่งั้นค้างรับติดลบ
          if (Number(prev.received_qty || 0) > item.quantity) {
            throw new PurchaseOrderUpdateError(
              `รายการ "${description || prev.description}" รับของมาแล้ว ${prev.received_qty} — ลดจำนวนเหลือ ${item.quantity} ไม่ได้`
            )
          }
          updateItem.run(
            materialId, description, item.quantity, item.unit || '',
            item.unitPrice, total, skipStock, item.notes || '', rowId, poId
          )
          kept.add(rowId)
        } else {
          const newId = generateId()
          insertItem.run(
            newId, tenantId, poId, materialId, description,
            item.quantity, item.unit || '', item.unitPrice, total, skipStock, item.notes || ''
          )
          kept.add(newId)
        }
      }

      const countGr = db.prepare('SELECT COUNT(*) AS c FROM goods_receipt_items WHERE purchase_order_item_id = ?')
      const countInv = db.prepare('SELECT COUNT(*) AS c FROM purchase_invoice_items WHERE purchase_order_item_id = ?')
      const deleteItem = db.prepare('DELETE FROM purchase_order_items WHERE id = ?')
      for (const row of existing) {
        if (kept.has(row.id)) continue
        const used = (countGr.get(row.id) as any).c + (countInv.get(row.id) as any).c
        if (used > 0) {
          throw new PurchaseOrderUpdateError(
            `ลบรายการ "${row.description}" ไม่ได้ เพราะมีใบรับสินค้า/ใบแจ้งหนี้อ้างถึงอยู่ — ยกเลิกเอกสารนั้นก่อน หรือแก้จำนวนแทนการลบ`
          )
        }
        deleteItem.run(row.id)
      }
    }
  })

  transaction()

  const po = db.prepare(`
    SELECT po.*, s.name as supplier_name, s.code as supplier_code,
      ba.bank_name, ba.account_number as bank_account_number
    FROM purchase_orders po
    LEFT JOIN suppliers s ON po.supplier_id = s.id
    LEFT JOIN bank_accounts ba ON po.bank_account_id = ba.id
    WHERE po.id = ? AND po.tenant_id = ?
  `).get(poId, tenantId)
  const poItems = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(poId)
  return { ...(po as any), items: poItems }
}
