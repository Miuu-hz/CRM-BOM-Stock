import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
import { convertQuantityBidirectional, autoUnpackIfNeeded } from './unitConversion.service'
import { roundQty } from '../utils/qty'
import { ACC, ACC_META } from '../config/accountCodes'
import { getOrCreateAccount } from './accounting.service'

/**
 * ตรรกะ "ขยับสต็อกจริง" ยกออกมาจาก routes/stock.routes.ts POST /movement
 *
 * ต้องเรียกได้จาก 2 ที่: ตัว route เอง และ executeApprovedAction() ตอนเจ้าของกดอนุมัติ
 * คำขอที่พนักงานตั้งไว้ — ถ้าปล่อยไว้ใน handler ต้อง copy ตรรกะบัญชี/แกะแพ็คไปอีกชุด
 */

// stock_items.unit_cost MUST always be the price per 1 BASE UNIT (stock_items.base_unit),
// never per whatever unit a movement/receipt happened to be entered in.
//   unit_cost = pricePerEnteredUnit / factor
// where factor = how many base units are in 1 entered unit.
export function priceToBaseUnitCost(pricePerEnteredUnit: number, factor: number, context: string): number {
  if (!Number.isFinite(factor) || factor <= 0) {
    console.warn(`[unit_cost] invalid conversion factor (${factor}) for ${context} — keeping price un-converted to avoid corrupting cost`)
    return pricePerEnteredUnit
  }
  return pricePerEnteredUnit / factor
}

export interface StockMovementPayload {
  stockItemId: string
  type: 'IN' | 'OUT' | 'ADJUST'
  quantity: number
  unit?: string
  reference?: string
  notes?: string
  unitCost?: number | null
}

/** ข้อผิดพลาดที่ผู้เรียกต้องแปลงเป็นข้อความให้ผู้ใช้ (ไม่ใช่ 500) */
export class StockMovementError extends Error {
  constructor(public code: 'STOCK_ITEM_NOT_FOUND' | 'INSUFFICIENT_STOCK' | 'NO_CONVERSION', message: string) {
    super(message)
  }
}

/**
 * ขยับสต็อก + บันทึก stock_movements + ลง journal (เฉพาะ ADJUST) ในทรานแซกชันเดียว
 * คืน stock_items แถวที่อัปเดตแล้ว (ยังไม่ enrich — ผู้เรียกจัดการเอง)
 */
export function applyStockMovement(
  tenantId: string,
  createdBy: string,
  payload: StockMovementPayload
): any {
  const { stockItemId, type, quantity, unit, reference, notes, unitCost } = payload

  const item = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
  if (!item) {
    throw new StockMovementError('STOCK_ITEM_NOT_FOUND', 'Stock item not found')
  }

  const baseUnit = item.base_unit || item.unit
  // Legacy `unit` fallback only kicks in when the caller omits `unit` in the request AND
  // base_unit itself hasn't been backfilled yet.
  const movementUnit = unit || item.base_unit || item.unit
  let convertedQuantity = Number(quantity)
  // Base units per 1 `movementUnit` — also reused below to convert unitCost (which the
  // caller enters per movementUnit, same as quantity) into price-per-base-unit.
  let qtyConversionFactor = 1

  if (movementUnit !== baseUnit) {
    const conversion = convertQuantityBidirectional(Number(quantity), movementUnit, baseUnit, tenantId, stockItemId)
    if (!conversion) {
      throw new StockMovementError(
        'NO_CONVERSION',
        `ไม่พบการแปลงหน่วยจาก "${movementUnit}" เป็น "${baseUnit}" กรุณาตั้งค่าการแปลงหน่วยใน Settings > การแปลงหน่วย`
      )
    }
    convertedQuantity = conversion.converted
    qtyConversionFactor = conversion.factor
  }

  const now = new Date().toISOString()

  // ponytail: read-modify-write stock + movement + journal must be atomic.
  let updatedItem: any
  const recordMovement = db.transaction(() => {
    const currentItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
    if (!currentItem) {
      throw new StockMovementError('STOCK_ITEM_NOT_FOUND', 'Stock item not found')
    }

    let newQuantity = currentItem.quantity
    let newSealedQty = currentItem.sealed_qty ?? 0

    if (type === 'IN') {
      newQuantity += convertedQuantity
    } else if (type === 'OUT') {
      // auto-unpack ถ้า quantity ไม่พอ แต่มี sealed_qty
      if (currentItem.quantity < convertedQuantity) {
        const unpack = autoUnpackIfNeeded(currentItem, convertedQuantity, tenantId)
        if (!unpack) {
          throw new StockMovementError('INSUFFICIENT_STOCK', 'Insufficient stock')
        }
        if (unpack.unpackedPacks > 0) {
          // quantity ของ stock_movements ต้องเป็น base unit เสมอ (ตาม schema comment)
          const gained = roundQty(unpack.unpackedPacks * unpack.packFactor)
          db.prepare(`
            INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
            VALUES (?, ?, ?, 'UNPACK', ?, ?, ?, ?, ?, ?, ?)
          `).run(generateId(), tenantId, stockItemId,
            gained,
            currentItem.display_unit || null,
            unpack.unpackedPacks,
            reference || 'AUTO',
            `แกะอัตโนมัติ ${unpack.unpackedPacks} ${currentItem.display_unit} → ${gained} ${baseUnit}`,
            now, createdBy)
          db.prepare('UPDATE stock_items SET sealed_qty = ?, unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ? AND tenant_id = ?')
            .run(unpack.sealed_qty, now, stockItemId, tenantId)
          newSealedQty = unpack.sealed_qty
          newQuantity = unpack.quantity
        }
      }
      if (newQuantity < convertedQuantity) {
        throw new StockMovementError('INSUFFICIENT_STOCK', 'Insufficient stock')
      }
      newQuantity -= convertedQuantity
    } else if (type === 'ADJUST') {
      newQuantity = convertedQuantity
    }

    if (type === 'IN' && unitCost !== undefined && unitCost !== null) {
      const newUnitCost = priceToBaseUnitCost(Number(unitCost), qtyConversionFactor, `movement ${movementUnit}→${baseUnit} (stock item ${stockItemId})`)
      db.prepare('UPDATE stock_items SET quantity = ?, unit_cost = ?, unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(newQuantity, newUnitCost, now, stockItemId, tenantId)
    } else {
      db.prepare('UPDATE stock_items SET quantity = ?, unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ? AND tenant_id = ?').run(newQuantity, now, stockItemId, tenantId)
    }

    const movementId = generateId()
    db.prepare(`
      INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(movementId, tenantId, stockItemId, type, convertedQuantity, movementUnit, Number(quantity), reference || '', notes || '', now, createdBy)

    // Auto-journal for ADJUST stock movements
    if (type === 'ADJUST') {
      const oldQty = currentItem.quantity || 0
      const diffQty = newQuantity - oldQty
      const itemUnitCost = Number(currentItem.unit_cost || 0)
      const diffValue = diffQty * itemUnitCost
      if (Math.abs(diffValue) > 0.01) {
        try {
          const invAccId = getOrCreateAccount(tenantId, ACC.RAW_MATERIAL, ACC_META[ACC.RAW_MATERIAL]!.name, ACC_META[ACC.RAW_MATERIAL]!.type, ACC_META[ACC.RAW_MATERIAL]!.category, ACC_META[ACC.RAW_MATERIAL]!.normalBalance)
          const yr = new Date().getFullYear()
          const jvNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', yr, 5)
          const entryId = generateId()

          if (diffValue > 0) {
            // Adjust up: Dr Inventory / Cr Other Income
            const incomeAccId = getOrCreateAccount(tenantId, ACC.OTHER_REVENUE)
            db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'STOCK_ADJUST', ?, ?, ?, ?, 1, 1, ?, ?, ?)`)
              .run(entryId, tenantId, jvNumber, now.substring(0, 10), stockItemId, `ปรับเพิ่มสต็อก ${currentItem.name}`, diffValue, diffValue, createdBy, now, now)
            db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
              .run(generateId(), tenantId, entryId, invAccId, 1, `ปรับเพิ่มสต็อก ${currentItem.name}`, diffValue)
            db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
              .run(generateId(), tenantId, entryId, incomeAccId, 2, `ปรับเพิ่มสต็อก ${currentItem.name}`, diffValue)
          } else {
            // Adjust down: Dr Stock Adjustment Expense / Cr Inventory
            const adjExpAccId = getOrCreateAccount(tenantId, ACC.STOCK_ADJUSTMENT)
            const absValue = Math.abs(diffValue)
            db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'STOCK_ADJUST', ?, ?, ?, ?, 1, 1, ?, ?, ?)`)
              .run(entryId, tenantId, jvNumber, now.substring(0, 10), stockItemId, `ปรับลดสต็อก ${currentItem.name}`, absValue, absValue, createdBy, now, now)
            db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
              .run(generateId(), tenantId, entryId, adjExpAccId, 1, `ปรับลดสต็อก ${currentItem.name}`, absValue)
            db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
              .run(generateId(), tenantId, entryId, invAccId, 2, `ปรับลดสต็อก ${currentItem.name}`, absValue)
          }
        } catch (journalErr) {
          console.error('⚠️ Stock adjust journal error:', journalErr)
        }
      }
    }

    updatedItem = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(stockItemId)
  })

  recordMovement()
  return updatedItem
}
