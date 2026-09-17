import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
import { convertQuantityBidirectional, autoUnpackIfNeeded, normalizeUnit, getUnitDisplayName } from './unitConversion.service'
import { roundQty, roundPackQty } from '../utils/qty'
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
  /** เหตุผลที่ปรับ (ของเสีย/ของหาย/นับผิด...) เก็บลงทะเบียน stock_adjustments */
  adjustReason?: string | null
}

/** ข้อผิดพลาดที่ผู้เรียกต้องแปลงเป็นข้อความให้ผู้ใช้ (ไม่ใช่ 500) */
// อ่านแค่ db เหมือนกัน ไม่ได้ import ไฟล์นี้กลับ จึงไม่เกิด import วงกลม
import { getCostBasis } from './stockCostBasis.service'

export class StockMovementError extends Error {
  constructor(
    public code:
      | 'STOCK_ITEM_NOT_FOUND'
      | 'INSUFFICIENT_STOCK'
      | 'NO_CONVERSION'
      | 'NO_PACK_UNIT'
      | 'INSUFFICIENT_SEALED'
      | 'SEALED_CHANGED',
    message: string
  ) {
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
  const { stockItemId, type, quantity, unit, reference, notes, unitCost, adjustReason } = payload

  // id ของทะเบียนที่เพิ่งสร้าง — คืนออกไปให้หน้าเว็บผูกไฟล์แนบ (รูปของจริงตอนนับ)
  let adjustmentId: string | null = null

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

    // Auto-journal + ทะเบียนการปรับสต็อก
    if (type === 'ADJUST') {
      const oldQty = currentItem.quantity || 0
      const diffQty = newQuantity - oldQty
      // ตีมูลค่าส่วนต่างด้วยทุนเฉลี่ยถ่วงน้ำหนักจากทุกครั้งที่ซื้อของชิ้นนี้เข้ามา
      // เดิมใช้ stock_items.unit_cost ซึ่งถูกทับด้วยราคาครั้งล่าสุดทุกครั้งที่รับของ
      // ของในคลังคละล็อตคละเจ้า ตีด้วยราคาเจ้าเดียวแล้วบัญชีเพี้ยนตาม
      // ไม่เคยรับเข้าผ่านใบรับสินค้าเลย -> getCostBasis คืน basis 'fallback' = unit_cost เดิม
      const basis = getCostBasis(tenantId, stockItemId)
      const itemUnitCost = basis.weightedAvg || Number(currentItem.unit_cost || 0)
      const diffValue = diffQty * itemUnitCost
      // ทะเบียนการปรับสต็อก — ตารางนี้มีโครงครบมาตลอดแต่ไม่เคยมีใครเขียนลงไปเลย (0 แถว)
      // ไม่มีทะเบียนก็ย้อนไม่ได้ว่าใครปรับอะไร เพราะอะไร มูลค่าเท่าไร
      // เขียนทุกครั้งที่ปรับ ไม่ว่ามูลค่าจะเป็นศูนย์หรือไม่ (นับผิดรอบก่อนก็ต้องมีร่องรอย)
      try {
        // เลขทะเบียนต้องมาจาก document_sequences เหมือนเอกสารอื่นทั้งระบบ
        // เคยใช้ COUNT(*)+1 ซึ่งพังทันทีที่มีคนลบแถว — เลขจะวนกลับมาชนของเดิม
        const adjNumber = formatDocumentNumber('ADJ', tenantId, 'STOCK_ADJUSTMENT', new Date(now).getFullYear(), 5)
        adjustmentId = generateId()
        db.prepare(`
          INSERT INTO stock_adjustments (id, tenant_id, adjustment_number, stock_item_id, adjustment_type,
            quantity_before, quantity_after, quantity_adjusted, unit_cost, total_value, reason,
            reference_type, reference_id, status, notes, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stock_movements', ?, 'EXECUTED', ?, ?, ?, ?)
        `).run(
          adjustmentId, tenantId, adjNumber,
          stockItemId, diffQty >= 0 ? 'INCREASE' : 'DECREASE',
          oldQty, newQuantity, diffQty, itemUnitCost, Math.abs(diffValue),
          adjustReason || notes || '', movementId,
          basis.basis === 'fallback' ? 'ตีมูลค่าด้วยต้นทุนที่บันทึกไว้ (ไม่มีประวัติรับเข้า)' : `ตีมูลค่าด้วยทุนเฉลี่ยถ่วงน้ำหนักจาก ${basis.sources.length} ครั้งที่ซื้อ`,
          createdBy, now, now)
      } catch (regErr) {
        // ทะเบียนพังต้องไม่ทำให้การปรับสต็อกพังตาม ของขยับไปแล้วจริง
        adjustmentId = null
        console.error('⚠️ stock_adjustments register error:', regErr)
      }

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
  // แนบ adjustmentId ไปกับผลลัพธ์ ไม่เปลี่ยนรูปร่างเดิมของ stock_items
  // ผู้เรียกที่ไม่สนใจก็ไม่กระทบ (ฟิลด์เกินมาเฉย ๆ)
  return adjustmentId ? { ...updatedItem, adjustmentId } : updatedItem
}

export interface ManualUnpackPayload {
  stockItemId: string
  packs: number
}

export interface ManualUnpackResult {
  item: any
  packFactor: number
  baseUnit: string
  displayUnit: string
}

/**
 * แกะแพ็คด้วยมือ: ย้าย sealed_qty (แพ็คที่ยังไม่เปิด) มาเป็น quantity (ของที่ใช้ได้จริง)
 *
 * ยกออกมาจาก routes/stock.routes.ts POST /:id/unpack ด้วยเหตุผลเดียวกับ applyStockMovement —
 * ต้องเรียกได้จาก 2 ที่: route เอง (ตอนไม่ต้องขออนุมัติ) และ executeApprovedAction() ตอน
 * เจ้าของกดอนุมัติคำขอที่พนักงานตั้งไว้ ถ้าปล่อยไว้ใน handler ต้อง copy ตรรกะไปอีกชุด
 */
export function applyManualUnpack(
  tenantId: string,
  createdBy: string,
  payload: ManualUnpackPayload
): ManualUnpackResult {
  const { stockItemId, packs } = payload

  const item = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
  if (!item) {
    throw new StockMovementError('STOCK_ITEM_NOT_FOUND', 'ไม่พบสินค้านี้ในคลัง')
  }

  const baseUnit = item.base_unit || item.unit
  const displayUnit = item.display_unit || item.unit
  if (!baseUnit || !displayUnit || normalizeUnit(baseUnit) === normalizeUnit(displayUnit)) {
    throw new StockMovementError(
      'NO_PACK_UNIT',
      `"${item.name}" ยังไม่ได้ตั้งหน่วยบรรจุ (เช่น แพ็ค/ลัง) ที่ต่างจากหน่วยฐาน จึงแกะแพ็คไม่ได้ — ตั้งค่าได้ที่คลังสินค้า > แก้ไขสินค้า`
    )
  }

  const converted = convertQuantityBidirectional(1, displayUnit, baseUnit, tenantId, item.id)
  const packFactor = converted && converted.factor > 0 ? roundQty(converted.factor) : null
  if (packFactor === null) {
    throw new StockMovementError(
      'NO_CONVERSION',
      `ไม่พบอัตราแปลงหน่วย "${getUnitDisplayName(displayUnit)}" → "${getUnitDisplayName(baseUnit)}" สำหรับ "${item.name}" กรุณาตั้งค่าที่ Settings > การแปลงหน่วย`
    )
  }

  const sealed = Number(item.sealed_qty || 0)
  if (packs > sealed) {
    throw new StockMovementError(
      'INSUFFICIENT_SEALED',
      `มีแพ็คที่ยังไม่แกะเพียง ${sealed} ${getUnitDisplayName(displayUnit)} แกะ ${packs} ไม่ได้`
    )
  }

  const now = new Date().toISOString()
  const gained = roundQty(packs * packFactor)
  let updatedItem: any

  const doUnpack = db.transaction(() => {
    // Re-read inside the transaction: a concurrent receipt or sale may have
    // moved sealed_qty since the check above.
    const current = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
    if (!current) throw new StockMovementError('STOCK_ITEM_NOT_FOUND', 'ไม่พบสินค้านี้ในคลัง')
    const currentSealed = Number(current.sealed_qty || 0)
    if (packs > currentSealed) {
      throw new StockMovementError('SEALED_CHANGED', 'จำนวนแพ็คเปลี่ยนไประหว่างดำเนินการ กรุณาลองใหม่')
    }

    const newSealed = roundPackQty(currentSealed - packs, `manual unpack ${item.sku}`)
    const newQuantity = roundQty(Number(current.quantity || 0) + gained)

    db.prepare('UPDATE stock_items SET quantity = ?, sealed_qty = ?, unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run(newQuantity, newSealed, now, stockItemId, tenantId)

    db.prepare(`
      INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
      VALUES (?, ?, ?, 'UNPACK', ?, ?, ?, ?, ?, ?, ?)
    `).run(generateId(), tenantId, stockItemId, gained, displayUnit, packs, 'MANUAL',
      `แกะแพ็ค: ${packs} ${getUnitDisplayName(displayUnit)} → +${gained} ${getUnitDisplayName(baseUnit)}`,
      now, createdBy)

    updatedItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId)
  })

  doUnpack()
  return { item: updatedItem, packFactor, baseUnit, displayUnit }
}

/**
 * ลำดับสถานะของใบสั่งผลิตที่อนุญาต — เดิมมีอยู่ใน mcp/tools/production.ts ฝั่งเดียว
 * ส่วน REST (workOrder.routes.ts) ตรวจแค่ว่าเป็นค่าที่รู้จักไหม ยิงข้ามขั้นได้ เช่น
 * DRAFT -> COMPLETED (ได้สินค้าสำเร็จรูปโดยไม่เคยเบิกวัตถุดิบ) — ย้ายมาไว้ที่เดียว 2026-09-14
 */
export const WORK_ORDER_NEXT_STATUS: Record<string, string[]> = {
  DRAFT:       ['PLANNED', 'CANCELLED'],
  PLANNED:     ['IN_PROGRESS', 'CANCELLED', 'ON_HOLD'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED', 'ON_HOLD'],
  ON_HOLD:     ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED:   [],
  CANCELLED:   [],
}

/** คืนข้อความบอกเหตุถ้าเปลี่ยนสถานะนี้ไม่ได้ / คืน null ถ้าเปลี่ยนได้ */
export function workOrderStatusError(from: string, to: string): string | null {
  if (from === to) return null
  const allowed = WORK_ORDER_NEXT_STATUS[from] ?? []
  if (allowed.includes(to)) return null
  return `ไม่สามารถเปลี่ยนสถานะจาก ${from} เป็น ${to} ได้ (อนุญาต: ${allowed.join(', ') || 'ไม่มี'})`
}

/**
 * เช็คว่าคืนวัตถุดิบของ WO ที่ยกเลิกแล้วเข้าสต็อกไปหรือยัง (กันคืนซ้ำ)
 *
 * ดูหลักฐานจริงใน stock_movements เหมือน soStockAlreadyDeducted() ใน
 * routes/sales/shared.ts — ไม่เดาจาก work_orders.status เพราะยิง PUT status=CANCELLED
 * ซ้ำ (สถานะเดิมอยู่แล้ว) ยังไหลลงมาถึงจุดคืนสต็อกได้ถ้าเช็คแค่สถานะ
 */
export function woMaterialsRestocked(tenantId: string, woNumber: string): boolean {
  return !!db.prepare("SELECT 1 FROM stock_movements WHERE tenant_id = ? AND type = 'IN' AND reference = ? LIMIT 1")
    .get(tenantId, `WO-CANCEL: ${woNumber}`)
}

/**
 * คืนวัตถุดิบที่เบิกไปแล้วเข้าสต็อกตอนยกเลิก WO — ยกออกมาให้ workOrder.routes.ts
 * และ mcp/tools/production.ts เรียกร่วมกัน (เดิมทั้งคู่ตัดสต็อกตอน IN_PROGRESS
 * แต่ไม่มีใครคืนตอน CANCELLED เลย ของหายถาวร)
 *
 * อ่านจำนวนที่ต้องคืนจาก stock_movements (type='OUT', reference=`WO: <wo_number>`)
 * แทนที่จะใช้ work_order_materials.issued_qty ตรงๆ เพราะ issued_qty เก็บเป็นหน่วย
 * ของ WO material เอง ซึ่งอาจคนละหน่วยกับ stock_items ถ้ามีการแปลงหน่วยตอนเบิก —
 * ส่วน stock_movements.quantity คือจำนวนจริงที่ถูกตัดออกจากสต็อกเป็นหน่วยฐานเสมอ
 */
export function restockCancelledWorkOrderMaterials(
  tenantId: string,
  createdBy: string,
  wo: { id: string; wo_number: string }
): void {
  if (woMaterialsRestocked(tenantId, wo.wo_number)) return

  const issued = db.prepare(`
    SELECT stock_item_id, SUM(quantity) as total
    FROM stock_movements
    WHERE tenant_id = ? AND type = 'OUT' AND reference = ?
    GROUP BY stock_item_id
  `).all(tenantId, `WO: ${wo.wo_number}`) as { stock_item_id: string; total: number }[]

  if (issued.length === 0) return

  const now = new Date().toISOString()
  const restock = db.transaction(() => {
    for (const row of issued) {
      const qty = roundQty(Number(row.total))
      if (qty <= 0) continue
      db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(qty, now, row.stock_item_id, tenantId)
      db.prepare(`
        INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
        VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, ?)
      `).run(generateId(), tenantId, row.stock_item_id, qty, `WO-CANCEL: ${wo.wo_number}`, 'Material returned from cancelled work order', now, createdBy)
      db.prepare("UPDATE work_order_materials SET issued_qty = 0, status = 'PENDING' WHERE work_order_id = ? AND material_id = ?")
        .run(wo.id, row.stock_item_id)
    }
  })
  restock()
}
