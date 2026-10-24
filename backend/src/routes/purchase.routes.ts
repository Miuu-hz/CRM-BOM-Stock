import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { lineBotService } from '../services/line-bot.service'
import { approvalDenyReason, recordAutoAction } from '../services/approvalGate.service'
import { canHandleBilling, userCan, isBasicUser, canReceivePurchase as canConfirmGoodsReceipt } from '../services/rbac.service'
import { gatePurchaseCancel, pendingPurchaseCancelBody, PurchaseCancelError } from '../services/purchaseCancel.service'
import { resolveSupplierId, PurchaseOrderUpdateError } from '../services/purchaseOrderUpdate.service'
import { randomUUID } from 'crypto'
import { formatDocumentNumber, docYear } from '../utils/id'
import { convertQuantityBidirectional, normalizeUnit, findConversionChain, autoUnpackIfNeeded } from '../services/unitConversion.service'
import { roundQty, roundPackQty } from '../utils/qty'

// กันเลขทศนิยมลอยตัว (2.9999999 ต้องนับเป็น 3 แพ็ค ไม่ใช่ 2)
const PACK_EPS = 1e-9
import { ACC, ACC_META } from '../config/accountCodes'
import { getOrCreateAccount, isVatRegistered, rememberContactVatMode, postJournal } from '../services/accounting.service'
import {
  createGoodsReceipt,
  confirmGoodsReceipt,
  GoodsReceiptError,
  type CreateGoodsReceiptLine,
} from '../services/goodsReceipt.service'
import { calcVat } from '../utils/vat'
import { closedPeriodLabel } from './journal.routes'
import { resolveStockItemId, StockItemRefError, findAliasTarget } from '../services/stockItem.service'
import {
  createPurchaseInvoice,
  updatePurchaseInvoice,
  paySupplier,
  listPosCashUnmatched,
  PurchaseBillingError,
} from '../services/purchaseBilling.service'

const router = Router()

router.use(authenticate)

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

// Resolve a PR/PO line item material_id to a valid stock_items.id, or null.
// ทะเบียนของเหลือชุดเดียวแล้ว (stock_items) แต่ผู้เรียก (รวมทั้ง MCP) ยังส่งมาได้
// หลายแบบ — id, รหัส (sku) หรือชื่อ — จึงยังต้องแปลงให้ตรงก่อนบันทึก
// หาไม่เจอแบบมั่นใจ = เก็บเป็นข้อความอิสระ (material_id null) ไม่เดาให้
function resolveMaterialId(tenantId: string, item: any): string | null {
  const materialById = db.prepare('SELECT id FROM stock_items WHERE id = ? AND tenant_id = ?')
  const materialByCode = db.prepare('SELECT id FROM stock_items WHERE sku = ? AND tenant_id = ?')
  const materialByName = db.prepare('SELECT id FROM stock_items WHERE name = ? AND tenant_id = ?')
  const raw = item && item.materialId ? String(item.materialId) : null
  if (raw && materialById.get(raw, tenantId)) return raw
  const code = item && item.materialCode ? String(item.materialCode).trim() : ''
  if (code) { const m = materialByCode.get(code, tenantId) as any; if (m) return m.id }
  const desc = item && item.description ? String(item.description).trim() : ''
  if (desc) {
    let m = materialByCode.get(desc, tenantId) as any
    if (m) return m.id
    m = materialByName.get(desc, tenantId) as any
    if (m) return m.id
    // ชื่อรองที่เคยยืนยันตอนรับของ (ยี่ห้อ B → SKU ยี่ห้อ A)
    const alias = findAliasTarget(tenantId, desc)
    if (alias) return alias.stockItemId
  }
  return null
}

// งานฝ่ายจัดซื้อ (แปลง PR→PO, สร้าง/ส่งใบคืนสินค้า) — ผู้ใช้พื้นฐาน (D2) ไม่ผ่าน
const canManagePurchase = (user: Parameters<typeof userCan>[0]) => userCan(user, 'purchase', 'write')

// ดึงข้อความ error ตัวแรกจาก zod มาแปลงเป็นข้อความไทยที่บอกบรรทัดที่ผิด
function firstItemZodError(error: z.ZodError): string {
  const issue = error.issues[0]
  if (typeof issue.path[0] === 'number') {
    return `รายการที่ ${(issue.path[0] as number) + 1}: ${issue.message}`
  }
  return issue.message
}

// ตรวจจำนวน/ราคาต่อหน่วยของบรรทัดสินค้าในใบขอซื้อก่อนบันทึก — กันจำนวน/ราคาติดลบหรือ 0 หลุดเข้า DB ตรง ๆ
// รองรับทั้ง estimatedUnitPrice (camelCase, endpoint แก้ไข) และ estimated_unit_price (snake_case,
// หน้าเว็บปุ่ม "สร้างใบขอซื้อ" ส่งแบบนี้จริง) ราคา 0 อนุญาต (ของแถม) แต่ติดลบไม่ได้
const PurchaseRequestItemsSchema = z.array(
  z.object({
    quantity: z.coerce.number({ invalid_type_error: 'จำนวนต้องเป็นตัวเลข' }).positive('จำนวนต้องมากกว่า 0'),
    estimatedUnitPrice: z.coerce.number({ invalid_type_error: 'ราคาต่อหน่วยต้องเป็นตัวเลข' }).min(0, 'ราคาต่อหน่วยต้องไม่ติดลบ').optional(),
    estimated_unit_price: z.coerce.number({ invalid_type_error: 'ราคาต่อหน่วยต้องเป็นตัวเลข' }).min(0, 'ราคาต่อหน่วยต้องไม่ติดลบ').optional(),
  }).passthrough()
).min(1, 'ต้องมีอย่างน้อย 1 รายการ')

// ยอดใบขอซื้อคิดฝั่งเซิร์ฟเวอร์ = จำนวน × ราคาต่อหน่วย — เดิมเชื่อ estimatedTotalPrice จาก body ส่ง 0 มาก็ผ่านวงเงินอนุมัติ
const prUnitPrice = (item: any) => Number(item.estimatedUnitPrice ?? item.estimated_unit_price) || 0
const prLineTotal = (item: any) => (Number(item.quantity) || 0) * prUnitPrice(item)

function generateNumber(prefix: string, tenantId: string, table: string, docDate?: string | Date | null) {
  const year = docYear(docDate)
  const docTypeMap: Record<string, string> = {
    purchase_requests: 'PURCHASE_REQUEST',
    purchase_orders: 'PO',
    goods_receipts: 'GOODS_RECEIPT',
    purchase_invoices: 'PURCHASE_INVOICE',
    supplier_payments: 'SUPPLIER_PAYMENT',
    purchase_returns: 'PURCHASE_RETURN',
  }
  const docType = docTypeMap[table]
  if (!docType) {
    throw new Error('Invalid table for number generation')
  }
  return formatDocumentNumber(prefix, tenantId, docType, year, 5, docDate)
}

function generateEntryNumber(tenantId: string, date: string): string {
  const year = new Date(date).getFullYear()
  return formatDocumentNumber('JV', tenantId, 'JOURNAL', year, 5, date)
}


// ============================================
// CANCELLATION REVERSAL HELPERS (accounting + stock)
// Used by the goods-receipt and purchase-invoice CANCELLED transitions below.
// Reversals are recorded as brand-new rows (never mutate/delete the original
// posting) so the ledger and stock_movements stay a full audit trail.
// ============================================

// True if a reversal has already been recorded against this reference — guards
// against double-reversal if a cancel request is retried/replayed.
function hasReversalJournal(tenantId: string, reversalReferenceType: string, referenceId: string): boolean {
  const row = db.prepare(
    'SELECT id FROM journal_entries WHERE tenant_id = ? AND reference_type = ? AND reference_id = ?'
  ).get(tenantId, reversalReferenceType, referenceId) as any
  return !!row
}

// Mirror the journal entry posted for (originalReferenceType, referenceId) with every
// line's debit/credit swapped, filed under reversalReferenceType so it's traceable and
// double-reversal-safe. Returns the new journal entry id, or null if there was nothing
// posted to reverse (e.g. GR confirm never posts a journal) or it was already reversed.
export function reverseJournalEntryForReference(
  tenantId: string,
  originalReferenceType: string,
  reversalReferenceType: string,
  referenceId: string,
  description: string,
  actorEmail: string,
  date: string
): string | null {
  const original = db.prepare(
    'SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = ? AND reference_id = ?'
  ).get(tenantId, originalReferenceType, referenceId) as any
  if (!original) return null

  if (hasReversalJournal(tenantId, reversalReferenceType, referenceId)) return null

  const lines = db.prepare('SELECT * FROM journal_lines WHERE journal_entry_id = ?').all(original.id) as any[]
  if (lines.length === 0) return null

  const journalId = generateId()
  const journalNumber = generateEntryNumber(tenantId, date)
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id,
      description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at, business_unit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
  `).run(journalId, tenantId, journalNumber, date, reversalReferenceType, referenceId,
    description, original.total_credit, original.total_debit, original.is_posted ? 1 : 0, actorEmail, now, now, original.business_unit ?? null)

  const insertLine = db.prepare(`
    INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  let lineNo = 1
  for (const line of lines) {
    insertLine.run(generateId(), tenantId, journalId, line.account_id, lineNo++,
      `กลับรายการ: ${line.description || ''}`, line.credit, line.debit)
  }

  return journalId
}

// Reverse the stock effects of a previously-CONFIRMED goods receipt: mirrors the
// stock-increase logic in PUT /goods-receipts/:id/confirm (unit conversion / sealed-qty
// handling included) and subtracts back out. Also rolls back purchase_order_items
// received_qty and recomputes the parent PO's status. Caller must ensure this only
// runs once per GR (guarded by gr.status !== 'CANCELLED' before calling).
function reverseGoodsReceiptStock(tenantId: string, gr: any, userId: string, now: string) {
  const items = db.prepare('SELECT * FROM goods_receipt_items WHERE goods_receipt_id = ?').all(gr.id) as any[]

  for (const item of items) {
    if (!(item.accepted_qty > 0)) continue
    // ยืนยันบวก received_qty ให้ทุกบรรทัด (รวม skip_stock/ไม่ผูกสินค้า) — ยกเลิกต้องคืนทุกบรรทัดเหมือนกัน
    // เดิมคืนเฉพาะบรรทัดที่เข้าคลัง PO จึงค้างสถานะรับแล้วทั้งที่ GR ถูกยกเลิก
    db.prepare('UPDATE purchase_order_items SET received_qty = MAX(0, received_qty - ?) WHERE id = ? AND tenant_id = ? AND purchase_order_id = ?')
      .run(item.accepted_qty, item.purchase_order_item_id, tenantId, gr.purchase_order_id)
    if (!item.material_id) continue

    const poItem = db.prepare('SELECT unit_price, unit, skip_stock FROM purchase_order_items WHERE id = ? AND tenant_id = ? AND purchase_order_id = ?').get(item.purchase_order_item_id, tenantId, gr.purchase_order_id) as any
    // ไม่นับสต็อก (แม้ผูกสินค้าไว้) ไม่เคยเข้าคลังตอนยืนยัน — ไม่มีอะไรให้คืน
    if (poItem?.skip_stock && (item.stock_qty === null || item.stock_qty === undefined)) continue
    const poUnit = normalizeUnit(poItem?.unit || '')

    let stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
    if (!stockItem) {
      stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
    }
    if (!stockItem) continue // nothing we can trace the original stock increase to

    let stockQty = 0
    let sealedQty = 0
    let addToSealed = false
    let packFactor = Number(item.stock_factor) || 1
    // stock_items.quantity is always stored in base_unit (the single source of truth) —
    // targeting the legacy `unit` column here silently applied the wrong conversion for
    // the ~23 items where `unit` != `base_unit` (unit is a pre-unit-system leftover that
    // migration copied `unit`'s value into as a starting point, not the real base unit).
    // Fall back to `unit` only for rows where base_unit was never backfilled.
    const stockUnit = normalizeUnit(stockItem?.base_unit || stockItem?.unit || '')
    const displayUnit = normalizeUnit(stockItem?.display_unit || '')

    // Preferred path: reverse exactly the amount the confirm step recorded. Immune to
    // the conversion rule being edited or deleted between receipt and cancellation.
    const hasSnapshot = item.stock_qty !== null && item.stock_qty !== undefined
    if (hasSnapshot) {
      stockQty = roundQty(Number(item.stock_qty) || 0)
      sealedQty = roundPackQty(Number(item.stock_sealed_qty) || 0, `GR ${gr.gr_number} cancel`)
      // ใบเดียวอาจมีทั้งแพ็คเต็มและเศษ ต้องคืนทั้งคู่ (ค่าที่ไม่ได้ใช้เป็น 0 อยู่แล้ว)
      addToSealed = sealedQty > 0
      if (item.stock_item_id) {
        const recorded = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(item.stock_item_id, tenantId) as any
        if (recorded) stockItem = recorded
      }
    } else {
      // Legacy receipt confirmed before the snapshot columns existed — re-derive, but
      // refuse to guess. Mirrors the confirm side, which also throws here: silently
      // falling back to the raw accepted_qty used to subtract 500 kg for a 500 g
      // receipt once the g→kg rule was removed.
      stockQty = roundQty(Number(item.accepted_qty))
      // Sealed/unopened-pack path only makes sense if display_unit is actually a pack
      // that can later be unpacked into base_unit. If display_unit == base_unit (e.g. both
      // "bottle"), there is nothing to unpack — autoUnpackIfNeeded() has its own guard that
      // returns null in exactly that case, so anything parked in sealed_qty here would be
      // stuck forever (received but unsellable). Mirror the confirm-side check: same unit
      // AND a real display->base conversion path exists.
      const canUnpackDisplay = !!displayUnit && displayUnit !== stockUnit
        && !!findConversionChain(displayUnit, stockUnit, tenantId, item.material_id)
      // ต้องแยกส่วนแบบเดียวกับตอนยืนยันเป๊ะ ๆ ไม่งั้นยกเลิกแล้วคืนของคนละก้อนกับที่รับเข้า
      if (poUnit && displayUnit && poUnit === displayUnit && canUnpackDisplay) {
        addToSealed = true
        const chain = findConversionChain(displayUnit, stockUnit, tenantId, item.material_id)
        packFactor = chain?.factor ?? 1
        sealedQty = Math.floor(Number(item.accepted_qty) + PACK_EPS)
        stockQty = roundQty((Number(item.accepted_qty) - sealedQty) * packFactor)
      } else if (poUnit && poUnit !== stockUnit) {
        const converted = convertQuantityBidirectional(Number(item.accepted_qty), poUnit, stockUnit, tenantId, item.material_id)
        if (!converted) {
          const materialName = (db.prepare('SELECT name FROM stock_items WHERE id = ?').get(item.material_id) as any)?.name
            || stockItem.name
            || item.material_id
          throw new Error(`ไม่พบการแปลงหน่วย ${poUnit} → ${stockUnit} สำหรับ "${materialName}" จึงยกเลิกใบรับของนี้ไม่ได้ (ถ้าตัดสต็อกด้วยตัวเลขดิบจะทำให้สต็อกผิด) กรุณาตั้งค่า Unit Conversion ${poUnit} → ${stockUnit} กลับคืนก่อน แล้วค่อยยกเลิกอีกครั้ง`)
        }
        stockQty = roundQty(converted.converted)
      }
    }

    if (addToSealed) {
      // unit = COALESCE(base_unit, unit): opportunistically keep the legacy `unit` column
      // synced to base_unit on every write so it can never drift again (see "เลิกใช้ unit
      // legacy" task) — this update doesn't touch unit_cost, only quantity/sealed_qty.
      // หักทั้งแพ็คเต็มและเศษ เพราะใบเดียวอาจรับเข้ามาทั้งสองแบบ
      // แพ็คที่ถูกแกะไปแล้ว (sealed เหลือไม่พอ) ย้ายไปอยู่ใน quantity เป็นหน่วยฐาน — ต้องหักจาก quantity แทน
      const openedPacks = Math.max(0, sealedQty - (Number(stockItem.sealed_qty) || 0))
      db.prepare('UPDATE stock_items SET sealed_qty = MAX(0, COALESCE(sealed_qty, 0) - ?), quantity = quantity - ?, unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(sealedQty, roundQty(stockQty + openedPacks * packFactor), now, stockItem.id, tenantId)
    } else {
      db.prepare('UPDATE stock_items SET quantity = quantity - ?, unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(stockQty, now, stockItem.id, tenantId)
    }

    db.prepare(`
      INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
      VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, ?)
    `).run(generateId(), tenantId, stockItem.id,
      addToSealed ? roundQty(sealedQty * packFactor + stockQty) : stockQty, `GR-CANCEL: ${gr.gr_number}`,
      `Reversed on cancellation of goods receipt ${gr.gr_number}`, now, userId)

    // ต้นทุนต่อหน่วย: GR นี้ตั้งราคาล่าสุดทับไว้ ถ้ายังไม่มี GR อื่นมาทับต่อ คืนต้นทุนก่อนรับ
    // (เดิมยกเลิก GR ที่กรอกราคาผิดแล้วต้นทุนผิดค้างอยู่ใน COGS ต่อไป)
    if (item.set_unit_cost != null && item.prev_unit_cost != null) {
      db.prepare('UPDATE stock_items SET unit_cost = ? WHERE id = ? AND tenant_id = ? AND ABS(COALESCE(unit_cost, 0) - ?) < 1e-9')
        .run(item.prev_unit_cost, stockItem.id, tenantId, item.set_unit_cost)
    }

    // Clear the snapshot so a re-confirm / re-cancel cycle cannot double-reverse.
    try {
      db.prepare('UPDATE goods_receipt_items SET stock_qty = NULL, stock_sealed_qty = NULL WHERE id = ?').run(item.id)
    } catch (e) { /* migration pending */ }
  }

  // Recompute the parent PO's status from what's left after the rollback — mirrors
  // the confirm-side logic (RECEIVED if fully received, PARTIAL if partially, else
  // back to APPROVED so it's receivable again).
  const poItems = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(gr.purchase_order_id) as any[]
  const anyReceived = poItems.some((i: any) => i.received_qty > 0)
  const allReceived = poItems.length > 0 && poItems.every((i: any) => i.received_qty >= i.quantity)
  if (allReceived) {
    db.prepare("UPDATE purchase_orders SET status = 'RECEIVED', updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(now, gr.purchase_order_id, tenantId)
  } else if (anyReceived) {
    db.prepare("UPDATE purchase_orders SET status = 'PARTIAL', updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(now, gr.purchase_order_id, tenantId)
  } else {
    db.prepare("UPDATE purchase_orders SET status = 'APPROVED', updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(now, gr.purchase_order_id, tenantId)
  }
}

// ============================================
// PURCHASE REQUESTS (PR)
// ============================================

// GET all purchase requests
router.get('/requests', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const requests = db.prepare(`
      SELECT pr.*, 
        (SELECT COUNT(*) FROM purchase_request_items WHERE purchase_request_id = pr.id) as item_count
      FROM purchase_requests pr
      WHERE pr.tenant_id = ?
      ORDER BY pr.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: requests })
  } catch (error) {
    console.error('Get purchase requests error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch purchase requests' })
  }
})

// GET single purchase request
router.get('/requests/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const request = db.prepare(`
      SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!request) {
      return res.status(404).json({ success: false, message: 'Purchase request not found' })
    }

    const items = db.prepare(`
      SELECT pri.*, m.name as material_name, m.sku as material_code
      FROM purchase_request_items pri
      LEFT JOIN stock_items m ON pri.material_id = m.id AND m.tenant_id = pri.tenant_id
      WHERE pri.purchase_request_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...request, items } })
  } catch (error) {
    console.error('Get purchase request error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch purchase request' })
  }
})

// DELETE purchase request (DRAFT only)
router.delete('/requests/:id', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!pr) return res.status(404).json({ success: false, message: 'Purchase request not found' })
    if (pr.status !== 'DRAFT') return res.status(400).json({ success: false, message: 'Only DRAFT requests can be deleted' })
    // ได้เลขเอกสารไปแล้ว = ห้ามหาย → ยกเลิกแทนการลบ เก็บใบและรายการไว้ให้ตรวจย้อนได้ (เลขไม่ขาดช่วง)
    db.prepare("UPDATE purchase_requests SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(new Date().toISOString(), req.params.id, tenantId)
    res.json({ success: true, message: 'ยกเลิกใบขอซื้อแล้ว (เก็บเลขที่ไว้)' })
  } catch (error) {
    console.error('Delete purchase request error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete purchase request' })
  }
})

// POST create purchase request
router.post('/requests', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { department, requiredDate, priority, notes, items } = req.body

    const itemsCheck = PurchaseRequestItemsSchema.safeParse(items)
    if (!itemsCheck.success) {
      return res.status(400).json({ success: false, message: firstItemZodError(itemsCheck.error) })
    }
    
    const id = generateId()
    const prNumber = generateNumber('PR', tenantId, 'purchase_requests')
    const now = new Date().toISOString()

    const totalAmount = items.reduce((sum: number, item: any) => sum + prLineTotal(item), 0)

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO purchase_requests (id, tenant_id, pr_number, requester_id, requester_name, department, 
          request_date, required_date, total_amount, status, priority, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)
      `).run(id, tenantId, prNumber, req.user!.userId, req.user!.email, department || '', 
        now, requiredDate || null, totalAmount, priority || 'NORMAL', notes || '', now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO purchase_request_items (id, tenant_id, purchase_request_id, material_id, description, 
            quantity, unit, estimated_unit_price, estimated_total_price, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          insertItem.run(generateId(), tenantId, id, resolveMaterialId(tenantId, item), item.description,
            item.quantity, item.unit || '', prUnitPrice(item), prLineTotal(item), item.notes || '')
        }
      }
    })

    transaction()

    const request = db.prepare('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    const requestItems = db.prepare('SELECT * FROM purchase_request_items WHERE purchase_request_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...request, items: requestItems } })
  } catch (error) {
    console.error('Create purchase request error:', error)
    res.status(500).json({ success: false, message: 'Failed to create purchase request' })
  }
})

// PUT update PR content (DRAFT/PENDING only — keeps current status unless explicitly changed)
router.put('/requests/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { department, requiredDate, priority, notes, items } = req.body
    const now = new Date().toISOString()

    const existing = db.prepare('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!existing) return res.status(404).json({ success: false, message: 'Purchase request not found' })
    if (!['DRAFT', 'PENDING'].includes(existing.status)) {
      return res.status(400).json({ success: false, message: 'ไม่สามารถแก้ไขได้ — สถานะต้องเป็น DRAFT หรือ PENDING เท่านั้น' })
    }

    if (items) {
      const itemsCheck = PurchaseRequestItemsSchema.safeParse(items)
      if (!itemsCheck.success) return res.status(400).json({ success: false, message: firstItemZodError(itemsCheck.error) })
    }
    const totalAmount = items ? items.reduce((sum: number, item: any) => sum + prLineTotal(item), 0) : (existing.total_amount || 0)

    const transaction = db.transaction(() => {
      db.prepare(`
        UPDATE purchase_requests
        SET department = COALESCE(?, department), required_date = COALESCE(?, required_date),
            priority = COALESCE(?, priority), notes = COALESCE(?, notes),
            total_amount = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(department ?? null, requiredDate ?? null, priority ?? null, notes ?? null, totalAmount, now, req.params.id, tenantId)

      if (items) {
        db.prepare('DELETE FROM purchase_request_items WHERE purchase_request_id = ?').run(req.params.id)
        const insertItem = db.prepare(`
          INSERT INTO purchase_request_items (id, tenant_id, purchase_request_id, material_id, description,
            quantity, unit, estimated_unit_price, estimated_total_price, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          insertItem.run(
            generateId(), tenantId, req.params.id,
            resolveMaterialId(tenantId, item), item.description || '',
            item.quantity, item.unit || '', prUnitPrice(item), prLineTotal(item), item.notes || ''
          )
        }
      }
    })

    transaction()

    const request = db.prepare('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    const requestItems = db.prepare('SELECT * FROM purchase_request_items WHERE purchase_request_id = ?').all(req.params.id)
    res.json({ success: true, data: { ...request, items: requestItems } })
  } catch (error) {
    console.error('Update PR error:', error)
    res.status(500).json({ success: false, message: 'Failed to update purchase request' })
  }
})

// สถานะที่ไปต่อได้ — CONVERTED/CANCELLED จบแล้ว (เดิมตั้ง CONVERTED กลับเป็น APPROVED แล้วแปลงเป็น PO ซ้ำได้)
const PR_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
  PENDING: ['DRAFT', 'APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['CANCELLED'],
  REJECTED: ['DRAFT', 'CANCELLED'],
}

// PUT update PR status (approve/reject)
router.put('/requests/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const existing = db.prepare('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Purchase request not found' })
    }

    if (!(PR_TRANSITIONS[existing.status] || []).includes(status)) {
      return res.status(400).json({ success: false, message: `เปลี่ยนสถานะใบขอซื้อจาก ${existing.status} เป็น ${status} ไม่ได้` })
    }
    // D2: ผู้ใช้พื้นฐานทำได้แค่ร่าง — ส่งอนุมัติ/อนุมัติ/ปฏิเสธไม่ได้
    if (status !== 'CANCELLED' && status !== 'DRAFT' && isBasicUser(req.user!)) {
      return res.status(403).json({ success: false, message: 'ผู้ใช้ทั่วไปบันทึกได้แค่ร่าง — ให้ฝ่ายจัดซื้อส่งอนุมัติ' })
    }

    // อนุมัติ/ปฏิเสธ = การตัดสินใจ ต้องผ่านเกณฑ์เดียวกับ POST /purchase-requests/:id/approve
    if (status === 'APPROVED' || status === 'REJECTED') {
      const denied = approvalDenyReason(tenantId, req.user!, 'purchase_request', existing.total_amount || 0, 'PR')
      if (denied) return res.status(403).json({ success: false, message: denied })
    }

    if (status === 'CANCELLED' && !['ADMIN', 'MANAGER', 'MASTER', 'POWERUSER'].includes(req.user!.role)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ยกเลิกใบขอซื้อ — ต้องเป็น ADMIN/MANAGER/MASTER/POWERUSER' })
    }

    const now = new Date().toISOString()
    const updates: any = { status, updated_at: now }
    
    if (status === 'APPROVED') {
      updates.approved_by = req.user!.userId
      updates.approved_date = now
    }

    db.prepare(`
      UPDATE purchase_requests SET status = ?, approved_by = ?, approved_date = ?, approved_at = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(status, updates.approved_by || null, updates.approved_date || null, updates.approved_date || null, now, req.params.id, tenantId)

    const request = db.prepare('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any

    // ตอบกลับผู้ขอทาง LINE — เดิมโค้ดนี้อยู่แต่ใน POST /purchase-requests/:id/approve|reject
    // ซึ่งไม่มีหน้าไหนเรียกแล้ว คนสั่งซื้อผ่าน LINE bot จึงไม่เคยได้รับคำตอบกลับเลย
    // ย้ายมาไว้เส้นทางที่หน้าเว็บใช้จริง · ล้มเหลวไม่ให้กระทบการอนุมัติ
    if (status === 'APPROVED' || status === 'REJECTED') {
      try {
        const approver = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user!.userId) as any
        await lineBotService.notifyPRStatus(tenantId, {
          id: request.id, prNumber: request.pr_number, supplierName: request.supplier_name || '-',
          status, requesterLineUserId: request.requester_line_user_id,
          sourceGroupId: request.source_group_id,
          approverName: approver?.name || req.user!.email || 'ผู้อนุมัติ',
          rejectionReason: request.rejection_reason || undefined,
        })
      } catch (e) { console.error('notifyPRStatus failed (ไม่กระทบการอนุมัติ):', e) }
    }

    res.json({ success: true, data: request })
  } catch (error) {
    console.error('Update PR status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// POST create PO from PR
router.post('/requests/:id/convert-to-po', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canManagePurchase(req.user!)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์แปลงใบขอซื้อเป็นใบสั่งซื้อ — ต้องเป็นฝ่ายจัดซื้อ หรือ ADMIN/MASTER' })
    }
    const { expectedDate } = req.body
    let supplierId: string | null
    try {
      supplierId = resolveSupplierId(tenantId, req.body.supplierId)  // ผู้ขายต้องเป็นของ tenant นี้
    } catch (e) {
      if (e instanceof PurchaseOrderUpdateError) return res.status(400).json({ success: false, message: e.message })
      throw e
    }

    // Get PR
    const pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!pr) {
      return res.status(404).json({ success: false, message: 'Purchase request not found' })
    }

    if (pr.status !== 'APPROVED') {
      return res.status(400).json({ success: false, message: 'Purchase request must be approved first' })
    }

    const prItems = db.prepare('SELECT * FROM purchase_request_items WHERE purchase_request_id = ?').all(req.params.id) as any[]
    
    const now = new Date().toISOString()
    const poId = generateId()
    const poNumber = generateNumber('PO', tenantId, 'purchase_orders')

    // Calculate totals
    let subtotal = 0
    for (const item of prItems) {
      subtotal += item.estimated_unit_price * item.quantity
    }
    // เดิมฝัง 7 ตายตัว — ต้องตามค่าของกิจการ
    const vatCfg = db.prepare('SELECT pos_vat_rate, vat_inclusive FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
    const taxRate = vatCfg?.pos_vat_rate ?? 7
    const poCalc = calcVat(subtotal, { rate: taxRate, inclusive: vatCfg?.vat_inclusive === 1 })
    const { taxAmount, totalAmount } = poCalc
    subtotal = poCalc.subtotal

    const transaction = db.transaction(() => {
      // Create PO
      db.prepare(`
        INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, order_date, expected_date,
          subtotal, tax_rate, tax_amount, total_amount, notes, linked_pr_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(poId, tenantId, poNumber, supplierId, now, expectedDate || null,
        subtotal, taxRate, taxAmount, totalAmount,
        // หมายเหตุที่กรอกในโมดัลแปลง PR (เดิมหลุดทิ้ง) + อ้างอิง PR ต้นทาง
        [typeof req.body.notes === 'string' ? req.body.notes.trim() : '', `Created from PR: ${pr.pr_number}`].filter(Boolean).join('\n'),
        pr.id, now, now)

      // Create PO items
      const insertItem = db.prepare(`
        INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, 
          quantity, unit, unit_price, total_price, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of prItems) {
        const total = item.estimated_unit_price * item.quantity
        insertItem.run(generateId(), tenantId, poId, item.material_id, item.description,
          item.quantity, item.unit || '', item.estimated_unit_price, total, item.notes || '')
      }

      // Update PR status
      db.prepare("UPDATE purchase_requests SET status = 'CONVERTED', updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(now, req.params.id, tenantId)
    })

    transaction()

    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(poId, tenantId)
    const poItems = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(poId)

    res.status(201).json({ 
      success: true, 
      data: { ...po, items: poItems },
      message: 'Purchase order created successfully'
    })
  } catch (error) {
    console.error('Convert PR to PO error:', error)
    res.status(500).json({ success: false, message: 'Failed to convert to purchase order' })
  }
})

// ============================================
// GOODS RECEIPTS (GRN)
// ============================================

// GET all goods receipts
router.get('/goods-receipts', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const receipts = db.prepare(`
      SELECT gr.*, s.name as supplier_name, s.code as supplier_code,
        po.po_number,
        (SELECT COUNT(*) FROM goods_receipt_items WHERE goods_receipt_id = gr.id) as item_count
      FROM goods_receipts gr
      LEFT JOIN suppliers s ON gr.supplier_id = s.id AND s.tenant_id = gr.tenant_id
      LEFT JOIN purchase_orders po ON gr.purchase_order_id = po.id
      WHERE gr.tenant_id = ?
      ORDER BY gr.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: receipts })
  } catch (error) {
    console.error('Get goods receipts error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch goods receipts' })
  }
})

// GET pending PO items for GR
router.get('/goods-receipts/pending-items/:poId', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    // `unit` ต้องเป็นหน่วยซื้อ (poi.unit) — quantity/pending_qty/unit_price ทุกตัวอยู่ในหน่วยนี้
    // และ confirmGoodsReceipt ก็อ่าน poItem.unit เป็นหน่วยตั้งต้นตอนแปลงเข้าคลัง
    // เดิมตรงนี้คืน COALESCE(si.base_unit, si.unit) = หน่วย "นับสต็อก" ซึ่งคนละตัว
    // ของจริงมี 88 บรรทัดที่สองหน่วยนี้ไม่ตรงกัน เช่น ซื้อกุ้ง 1.148 kg ที่ ฿219
    // จอรับของโชว์ "฿219 · กรัม" อ่านได้ว่ากรัมละ 219 บาท ผิดไป 1,000 เท่า
    const items = db.prepare(`
      SELECT
        poi.id, poi.purchase_order_id, poi.material_id,
        poi.description, poi.quantity, poi.unit_price, poi.total_price,
        poi.received_qty,
        (poi.quantity - poi.received_qty) AS pending_qty,
        si.name  AS material_name,
        si.sku   AS material_code,
        COALESCE(NULLIF(TRIM(poi.unit), ''), si.base_unit, si.unit) AS unit,
        COALESCE(si.base_unit, si.unit) AS stock_unit
      FROM purchase_order_items poi
      LEFT JOIN stock_items si ON poi.material_id = si.id
      LEFT JOIN purchase_orders po ON poi.purchase_order_id = po.id
      WHERE poi.purchase_order_id = ?
        AND po.tenant_id = ?
        AND poi.quantity > poi.received_qty
    `).all(req.params.poId, tenantId) as any[]

    // หน่วยซื้อกับหน่วยคลังต่างกัน = คนกรอกควรเห็นก่อนกดว่าของจะเข้าคลังเป็นเท่าไร
    // แปลงไม่ได้ก็บอกไปตรง ๆ (stock_factor = null) ดีกว่าปล่อยให้ไปเจอ error ตอนกดยืนยัน
    for (const it of items) {
      const buy = normalizeUnit(it.unit || '')
      const keep = normalizeUnit(it.stock_unit || '')
      it.stock_factor = null
      if (buy && keep && buy !== keep && it.material_id) {
        const conv = convertQuantityBidirectional(1, buy, keep, tenantId, it.material_id, it.description)
        if (conv) it.stock_factor = conv.factor
      }
    }

    res.json({ success: true, data: items })
  } catch (error) {
    console.error('Get pending items error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch pending items' })
  }
})

// GET single goods receipt
router.get('/goods-receipts/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const receipt = db.prepare(`
      SELECT gr.*, s.name as supplier_name, s.code as supplier_code, s.email as supplier_email,
        s.tax_id as supplier_tax_id, s.address as supplier_address, s.phone as supplier_phone,
        po.po_number
      FROM goods_receipts gr
      LEFT JOIN suppliers s ON gr.supplier_id = s.id AND s.tenant_id = gr.tenant_id
      LEFT JOIN purchase_orders po ON gr.purchase_order_id = po.id
      WHERE gr.id = ? AND gr.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!receipt) {
      return res.status(404).json({ success: false, message: 'Goods receipt not found' })
    }

    const items = db.prepare(`
      SELECT
        gri.*,
        poi.description,
        poi.unit_price,
        poi.unit as po_unit,
        si.name as material_name,
        si.sku as material_code,
        COALESCE(si.base_unit, si.unit) as unit
      FROM goods_receipt_items gri
      LEFT JOIN purchase_order_items poi ON gri.purchase_order_item_id = poi.id
      LEFT JOIN stock_items si ON gri.material_id = si.id
      WHERE gri.goods_receipt_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...receipt, items } })
  } catch (error) {
    console.error('Get goods receipt error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch goods receipt' })
  }
})

// POST create goods receipt from PO
router.post('/goods-receipts', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canConfirmGoodsReceipt(req.user!)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์รับสินค้า — ต้องเป็นฝ่ายจัดซื้อ/ฝ่ายคลัง' })
    }
    const { purchaseOrderId, receiptDate, receivedBy, notes, items, deliveryNoteNo } = req.body

    if (!purchaseOrderId) {
      return res.status(400).json({ success: false, message: 'Purchase order is required' })
    }

    const lines: CreateGoodsReceiptLine[] | undefined = items && items.length > 0
      ? items.map((item: any) => ({
          poItemId: item.poItemId,
          materialId: item.materialId || null,
          orderedQty: item.orderedQty,
          receivedQty: item.receivedQty,
          acceptedQty: item.acceptedQty ?? item.receivedQty,
          rejectedQty: item.rejectedQty || 0,
          lotNumber: item.lotNumber || null,
          location: item.location || null,
          notes: item.notes || '',
        }))
      : undefined

    const receipt = createGoodsReceipt(tenantId, req.user!.email, {
      purchaseOrderId, receiptDate, receivedBy, notes, deliveryNoteNo, items: lines,
    })

    res.status(201).json({ success: true, data: receipt })
  } catch (error: any) {
    if (error instanceof GoodsReceiptError) {
      const status = error.code === 'PO_NOT_FOUND' ? 404 : 400
      return res.status(status).json({ success: false, message: error.message })
    }
    console.error('Create goods receipt error:', error)
    res.status(500).json({ success: false, message: 'Failed to create goods receipt' })
  }
})

// DELETE GR (DRAFT only)
router.delete('/goods-receipts/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canConfirmGoodsReceipt(req.user!)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์รับสินค้า — ต้องเป็นฝ่ายจัดซื้อ/ฝ่ายคลัง' })
    }
    const gr = db.prepare('SELECT * FROM goods_receipts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!gr) return res.status(404).json({ success: false, message: 'Not found' })
    if (gr.status !== 'DRAFT') return res.status(400).json({ success: false, message: 'ลบได้เฉพาะ GR ที่ยังเป็นร่างเท่านั้น' })
    // ได้เลขเอกสารไปแล้ว = ห้ามหาย → ยกเลิกแทนการลบ เก็บใบและรายการไว้ให้ตรวจย้อนได้ (เลขไม่ขาดช่วง)
    db.prepare("UPDATE goods_receipts SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(new Date().toISOString(), req.params.id, tenantId)
    res.json({ success: true, message: 'ยกเลิกใบรับสินค้าแล้ว (เก็บเลขที่ไว้)' })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete goods receipt' })
  }
})

// PUT confirm goods receipt (update stock)
router.put('/goods-receipts/:id/confirm', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canConfirmGoodsReceipt(req.user!)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ยืนยันรับสินค้า — ต้องเป็นฝ่ายจัดซื้อ/ฝ่ายคลัง หรือ ADMIN/MANAGER/MASTER/POWERUSER' })
    }
    const receipt = confirmGoodsReceipt(tenantId, req.user!.userId, req.params.id) as any
    const skipped: string[] = receipt.skippedLines || []
    res.json({
      success: true,
      data: receipt,
      skippedLines: skipped,
      message: skipped.length > 0
        ? `ยืนยันรับสินค้าแล้ว — แต่ ${skipped.length} รายการไม่ได้เพิ่มเข้าสต็อก เพราะไม่ได้ผูกกับสินค้าในคลัง: ${skipped.join(', ')}`
        : 'Goods receipt confirmed and stock updated',
    })
  } catch (error: any) {
    if (error instanceof GoodsReceiptError) {
      const status = error.code === 'GR_NOT_FOUND' ? 404 : 400
      return res.status(status).json({ success: false, message: error.message })
    }
    console.error('Confirm goods receipt error:', error)
    res.status(500).json({ success: false, message: 'Failed to confirm goods receipt' })
  }
})

// ยกเลิกใบรับสินค้า (คืนสต็อก + กลับรายการ GRNI ถ้ายืนยันไปแล้ว) — ใช้ทั้งตอนกดเองและตอนอนุมัติคำขอ purchase_cancel
export function cancelGoodsReceiptNow(tenantId: string, grId: string, actor: { userId: string; email: string }) {
  const gr = db.prepare('SELECT * FROM goods_receipts WHERE id = ? AND tenant_id = ?').get(grId, tenantId) as any
  if (!gr) throw new PurchaseCancelError(404, 'Goods receipt not found')
  if (gr.status === 'CANCELLED') throw new PurchaseCancelError(400, 'Goods receipt already cancelled')

  // Block if an active purchase invoice already references this GR — its AP
  // journal would then refer to stock that no longer exists.
  const linkedInvoice = db.prepare(`
    SELECT id, pi_number FROM purchase_invoices
    WHERE tenant_id = ? AND status != 'CANCELLED'
      AND (goods_receipt_id = ? OR goods_receipt_ids LIKE ?)
  `).get(tenantId, gr.id, `%${gr.id}%`) as any
  if (linkedInvoice) {
    throw new PurchaseCancelError(400, `ไม่สามารถยกเลิกใบรับสินค้าได้ — มีใบแจ้งหนี้ ${linkedInvoice.pi_number} อ้างอิงอยู่ กรุณายกเลิกใบแจ้งหนี้ก่อน`)
  }

  // คืนสินค้าที่ยืนยันแล้วตัดสต็อกไปแล้ว — ยกเลิก GR จะคืนสต็อกทั้งใบซ้ำอีกรอบ
  const linkedReturn = db.prepare(`SELECT DISTINCT pr.pr_number FROM purchase_returns pr
    JOIN purchase_return_items pri ON pri.purchase_return_id = pr.id
    JOIN goods_receipt_items gri ON gri.id = pri.goods_receipt_item_id
    WHERE pr.tenant_id = ? AND pr.status != 'CANCELLED' AND gri.goods_receipt_id = ?`).get(tenantId, gr.id) as any
  if (linkedReturn) {
    throw new PurchaseCancelError(400, `ไม่สามารถยกเลิกใบรับสินค้าได้ — มีใบคืนสินค้า ${linkedReturn.pr_number} อ้างอิงอยู่`)
  }

  const now = new Date().toISOString()
  const wasConfirmed = gr.status === 'CONFIRMED'

  const transaction = db.transaction(() => {
    if (wasConfirmed) {
      reverseGoodsReceiptStock(tenantId, gr, actor.userId, now)
      // ยืนยัน GR ตั้งค้างรับของไว้ (Dr สต็อก / Cr 2109) ยกเลิกแล้วต้องกลับรายการด้วย
      // ไม่งั้นของออกจากคลังแต่มูลค่ายังค้างอยู่ในงบ — helper มี guard กันกลับซ้ำในตัว
      reverseJournalEntryForReference(
        tenantId, 'GOODS_RECEIPT', 'GOODS_RECEIPT_CANCEL', gr.id,
        `กลับรายการรับสินค้า ${gr.gr_number}`, actor.email, now.substring(0, 10)
      )
    }
    db.prepare("UPDATE goods_receipts SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(now, grId, tenantId)
  })
  transaction()
  return { wasConfirmed, gr: db.prepare('SELECT * FROM goods_receipts WHERE id = ? AND tenant_id = ?').get(grId, tenantId) }
}

// PUT cancel goods receipt (reverse stock if it had been CONFIRMED)
router.put('/goods-receipts/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body

    if (status !== 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'This endpoint only supports cancelling a goods receipt' })
    }

    const gr = db.prepare('SELECT * FROM goods_receipts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!gr) {
      return res.status(404).json({ success: false, message: 'Goods receipt not found' })
    }
    if (gr.status === 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'Goods receipt already cancelled' })
    }

    const { pending, gateArgs } = gatePurchaseCancel({ tenantId, user: req.user!, kind: 'goods_receipt', refId: gr.id, docNumber: gr.gr_number })
    if (pending) return res.status(202).json(pendingPurchaseCancelBody(pending, gr.gr_number))

    const { wasConfirmed, gr: updated } = cancelGoodsReceiptNow(tenantId, gr.id, req.user!)
    recordAutoAction(gateArgs)
    res.json({
      success: true,
      data: updated,
      message: wasConfirmed ? 'Goods receipt cancelled and stock reversed' : 'Goods receipt cancelled',
    })
  } catch (error: any) {
    if (error instanceof PurchaseCancelError) return res.status(error.status).json({ success: false, message: error.message })
    console.error('Cancel goods receipt error:', error)
    res.status(500).json({ success: false, message: 'Failed to cancel goods receipt' })
  }
})

// ============================================
// PURCHASE INVOICES
// ============================================

// GET all purchase invoices
router.get('/invoices', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const invoices = db.prepare(`
      SELECT pi.*, s.name as supplier_name, s.code as supplier_code,
        po.po_number, gr.gr_number
      FROM purchase_invoices pi
      LEFT JOIN suppliers s ON pi.supplier_id = s.id AND s.tenant_id = pi.tenant_id
      LEFT JOIN purchase_orders po ON pi.purchase_order_id = po.id
      LEFT JOIN goods_receipts gr ON pi.goods_receipt_id = gr.id
      WHERE pi.tenant_id = ?
      ORDER BY pi.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: invoices })
  } catch (error) {
    console.error('Get purchase invoices error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch purchase invoices' })
  }
})

// GET GR ที่ยืนยันแล้ว ยังไม่ถูกใช้ออกใบแจ้งหนี้ — ให้หน้าออกใบแจ้งหนี้ (ใหม่ = GR-centric) เลือกได้
// ต้องประกาศก่อน '/invoices/:id' ไม่งั้น express จะจับ 'billable-receipts' เป็นค่า :id ไปก่อน
router.get('/invoices/billable-receipts', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const supplierId = typeof req.query.supplierId === 'string' ? req.query.supplierId : undefined

    const grRows = db.prepare(`
      SELECT gr.id, gr.gr_number, gr.receipt_date, gr.purchase_order_id,
        po.po_number, po.supplier_id, po.tax_rate as po_tax_rate, po.is_paid as po_is_paid,
        s.name as supplier_name, s.tax_id as supplier_tax_id
      FROM goods_receipts gr
      JOIN purchase_orders po ON po.id = gr.purchase_order_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
      WHERE gr.tenant_id = ? AND gr.status = 'CONFIRMED' AND gr.invoiced_at IS NULL
        ${supplierId ? 'AND po.supplier_id = ?' : ''}
      ORDER BY gr.receipt_date ASC
    `).all(...(supplierId ? [tenantId, supplierId] : [tenantId])) as any[]

    const grIds = grRows.map(r => r.id)
    const itemsByGr = new Map<string, any[]>()
    if (grIds.length > 0) {
      const ph = grIds.map(() => '?').join(',')
      const itemRows = db.prepare(`
        SELECT gri.id as grItemId, gri.goods_receipt_id, gri.accepted_qty as quantity,
          poi.unit_price as unitPrice, poi.unit, poi.description
        FROM goods_receipt_items gri
        JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id
        WHERE gri.goods_receipt_id IN (${ph}) AND gri.accepted_qty > 0
      `).all(...grIds) as any[]
      for (const row of itemRows) {
        const arr = itemsByGr.get(row.goods_receipt_id) || []
        arr.push({ grItemId: row.grItemId, description: row.description, quantity: row.quantity, unit: row.unit, unitPrice: row.unitPrice })
        itemsByGr.set(row.goods_receipt_id, arr)
      }
    }

    const data = grRows.map(r => {
      const items = itemsByGr.get(r.id) || []
      const amount = items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0)
      return {
        id: r.id, gr_number: r.gr_number, receipt_date: r.receipt_date,
        purchase_order_id: r.purchase_order_id, po_number: r.po_number,
        supplier_id: r.supplier_id, supplier_name: r.supplier_name, supplier_tax_id: r.supplier_tax_id,
        po_tax_rate: r.po_tax_rate, po_is_paid: r.po_is_paid,
        amount, items,
      }
    })

    res.json({ success: true, data })
  } catch (error) {
    console.error('Get billable receipts error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch billable receipts' })
  }
})

// GET single purchase invoice
router.get('/invoices/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const invoice = db.prepare(`
      SELECT pi.*, s.name as supplier_name, s.code as supplier_code, s.tax_id as supplier_tax_id,
        po.po_number, gr.gr_number
      FROM purchase_invoices pi
      LEFT JOIN suppliers s ON pi.supplier_id = s.id AND s.tenant_id = pi.tenant_id
      LEFT JOIN purchase_orders po ON pi.purchase_order_id = po.id
      LEFT JOIN goods_receipts gr ON pi.goods_receipt_id = gr.id
      WHERE pi.id = ? AND pi.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Purchase invoice not found' })
    }

    const items = db.prepare(`
      SELECT pii.*, si.name as material_name, si.sku as material_code
      FROM purchase_invoice_items pii
      LEFT JOIN stock_items si ON pii.material_id = si.id
      WHERE pii.purchase_invoice_id = ?
    `).all(req.params.id)

    const payments = db.prepare(`
      SELECT * FROM supplier_payments WHERE purchase_invoice_id = ?
        AND (status IS NULL OR status != 'CANCELLED') ORDER BY payment_date DESC
    `).all(req.params.id)

    res.json({ success: true, data: { ...invoice, items, payments } })
  } catch (error) {
    console.error('Get purchase invoice error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch purchase invoice' })
  }
})

// POST create purchase invoice from GR — logic lives in services/purchaseBilling.service.ts
// (shared with the MCP tool create_purchase_invoice, see mcp/tools/purchaseBilling.ts)
router.post('/invoices', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canHandleBilling(req.user!, 'purchase')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ทำรายการนี้ — ต้องอยู่ฝ่ายจัดซื้อ/ฝ่ายบัญชี หรือเป็น ADMIN/MASTER' })
    }
    const { purchaseOrderId, goodsReceiptId, goodsReceiptIds, supplierInvoiceNumber, invoiceDate, dueDate, notes, items, drAccountId, crAccountId, taxRate: reqTaxRate, autoPay, paymentMethod, paymentReference, bankAccountId, posCashMovementId } = req.body

    const invoice = createPurchaseInvoice(tenantId, req.user!.email, {
      purchaseOrderId,
      // รวมหลายใบสั่งซื้อไว้ในบิลเดียว — service เป็นคนบังคับว่าต้องผู้ขายรายเดียวกัน
      purchaseOrderIds: req.body.purchaseOrderIds,
      goodsReceiptId,
      goodsReceiptIds,
      crAccountId,
      supplierInvoiceNumber,
      invoiceDate,
      dueDate,
      notes,
      items,
      drAccountId,
      taxRate: reqTaxRate,
      discountAmount: req.body.discountAmount,  // เดิมหลุด: หน้าเว็บส่งส่วนลดมาแต่ไม่ถูกส่งต่อ
      autoPay,
      posCashMovementId,
      paymentMethod,
      paymentReference,
      bankAccountId,
    })

    res.status(201).json({ success: true, data: invoice })
  } catch (error: any) {
    if (error instanceof PurchaseBillingError) {
      const status = error.code === 'GR_NOT_FOUND' ? 404 : 400
      return res.status(status).json({ success: false, message: error.message })
    }
    console.error('Create purchase invoice error:', error)
    res.status(500).json({ success: false, message: 'Failed to create purchase invoice' })
  }
})

// PUT edit purchase invoice — header-only fields update ตรง ๆ, ฟิลด์การเงิน reverse+repost journal
// ทั้งใบ (logic อยู่ที่ services/purchaseBilling.service.ts updatePurchaseInvoice — ไม่มีสำเนาที่สอง)
// ชุด GR ที่ผูกไว้แก้ไม่ได้ทางนี้ — ยกเลิกแล้วออกใหม่แทนถ้าต้องเปลี่ยน GR
router.put('/invoices/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canHandleBilling(req.user!, 'purchase')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ทำรายการนี้ — ต้องอยู่ฝ่ายจัดซื้อ/ฝ่ายบัญชี หรือเป็น ADMIN/MASTER' })
    }
    const { supplierInvoiceNumber, dueDate, notes, items, invoiceDate, taxRate, discountAmount, drAccountId, crAccountId, vatInclusive } = req.body

    const invoice = updatePurchaseInvoice(tenantId, req.user!.email, req.params.id, {
      supplierInvoiceNumber, dueDate, notes, items, invoiceDate, taxRate, discountAmount, drAccountId, crAccountId, vatInclusive,
    })

    res.json({ success: true, data: invoice })
  } catch (error: any) {
    if (error instanceof PurchaseBillingError) {
      const status = error.code === 'INVOICE_NOT_FOUND' ? 404 : 400
      return res.status(status).json({ success: false, message: error.message })
    }
    console.error('Update purchase invoice error:', error)
    res.status(500).json({ success: false, message: 'Failed to update purchase invoice' })
  }
})

// PUT cancel purchase invoice (reverse its AP journal + reported input VAT)
export function reverseSupplierPayment(tenantId: string, payment: any, actorEmail: string, date: string) {
  reverseJournalEntryForReference(
    tenantId, 'SUPPLIER_PAYMENT', 'SUPPLIER_PAYMENT_CANCEL', payment.id,
    `กลับรายการจ่ายชำระ ${payment.payment_number}`, actorEmail, date
  )
  if (payment.purchase_invoice_id) {
    const pi = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(payment.purchase_invoice_id, tenantId) as any
    if (pi) {
      const newPaid = Math.max(0, Math.round(((pi.paid_amount || 0) - payment.amount) * 100) / 100)
      const newBalance = Math.round((pi.total_amount - newPaid) * 100) / 100
      const paymentStatus = newPaid <= 0.005 ? 'UNPAID' : 'PARTIAL'
      db.prepare('UPDATE purchase_invoices SET paid_amount = ?, balance_amount = ?, payment_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(newPaid, newBalance, paymentStatus, new Date().toISOString(), pi.id, tenantId)
    }
  }
  // soft-cancel: เก็บแถวไว้ให้ journal ที่กลับรายการยังตามรอยกลับมาหาใบจ่ายเงินได้
  // (เดิม DELETE ทิ้ง บัญชียังดุลเพราะมีคู่กลับรายการ แต่ร่องรอยว่าเป็นใบไหนหายไปเลย)
  db.prepare("UPDATE supplier_payments SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND tenant_id = ?")
    .run(new Date().toISOString(), payment.id, tenantId)
}

// DELETE /payments/:id — reverse (void) a supplier payment: reverses its journal
// and restores the linked purchase invoice's paid/balance/payment_status.
export function voidSupplierPaymentNow(tenantId: string, paymentId: string, actorEmail: string) {
  const payment = db.prepare('SELECT * FROM supplier_payments WHERE id = ? AND tenant_id = ?').get(paymentId, tenantId) as any
  if (!payment) throw new PurchaseCancelError(404, 'Payment not found')
  if (payment.status === 'CANCELLED') throw new PurchaseCancelError(400, 'การจ่ายเงินนี้ถูกยกเลิกไปแล้ว')
  const today = new Date().toISOString().substring(0, 10)
  db.transaction(() => { reverseSupplierPayment(tenantId, payment, actorEmail, today) })()
}

router.delete('/payments/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const payment = db.prepare('SELECT * FROM supplier_payments WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' })
    if (payment.status === 'CANCELLED') return res.status(400).json({ success: false, message: 'การจ่ายเงินนี้ถูกยกเลิกไปแล้ว' })
    const { pending, gateArgs } = gatePurchaseCancel({
      tenantId, user: req.user!, kind: 'supplier_payment', refId: payment.id, docNumber: payment.payment_number, amount: payment.amount,
    })
    if (pending) return res.status(202).json(pendingPurchaseCancelBody(pending, payment.payment_number))
    voidSupplierPaymentNow(tenantId, payment.id, req.user!.email)
    recordAutoAction(gateArgs)
    res.json({ success: true, message: 'Supplier payment reversed' })
  } catch (error: any) {
    if (error instanceof PurchaseCancelError) return res.status(error.status).json({ success: false, message: error.message })
    console.error('Reverse supplier payment error:', error)
    res.status(500).json({ success: false, message: 'Failed to reverse payment' })
  }
})

// ยกเลิกใบแจ้งหนี้ซื้อ (กลับ AP journal + ภาษีซื้อ + void ใบจ่ายเงิน + ปล่อย GR) — ใช้ทั้งตอนกดเองและตอนอนุมัติ purchase_cancel
export function cancelPurchaseInvoiceNow(tenantId: string, piId: string, actorEmail: string) {
  const pi = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(piId, tenantId) as any
  if (!pi) throw new PurchaseCancelError(404, 'Purchase invoice not found')
  if (pi.status === 'CANCELLED') throw new PurchaseCancelError(400, 'Purchase invoice already cancelled')
  const now = new Date().toISOString()
  const today = now.substring(0, 10)

  const transaction = db.transaction(() => {
    // Reverse any supplier payments applied to this PI first (end-to-end cancel)
    const pays = db.prepare("SELECT * FROM supplier_payments WHERE purchase_invoice_id = ? AND tenant_id = ? AND (status IS NULL OR status != 'CANCELLED')").all(pi.id, tenantId) as any[]
    for (const pay of pays) reverseSupplierPayment(tenantId, pay, actorEmail, today)

    const reversalJournalId = reverseJournalEntryForReference(
      tenantId, 'PURCHASE_INVOICE', 'PURCHASE_INVOICE_CANCEL', pi.id,
      `ยกเลิกใบแจ้งหนี้ซื้อ ${pi.pi_number}`, actorEmail, today
    )

    // Best-effort reversal of the input VAT reported at invoice creation.
    const vatEntry = db.prepare(
      "SELECT * FROM vat_entries WHERE tenant_id = ? AND document_type = 'PURCHASE_INVOICE' AND document_id = ?"
    ).get(tenantId, pi.id) as any
    if (vatEntry) {
      const alreadyReversed = db.prepare(
        "SELECT id FROM vat_entries WHERE tenant_id = ? AND document_type = 'PURCHASE_INVOICE_CANCEL' AND document_id = ?"
      ).get(tenantId, pi.id)
      if (!alreadyReversed) {
        db.prepare(`
          INSERT INTO vat_entries (id, tenant_id, document_type, document_id, document_number, document_date,
            party_name, party_tax_id, base_amount, vat_rate, vat_amount, total_amount, is_input_vat, is_output_vat, journal_entry_id, created_at)
          VALUES (?, ?, 'PURCHASE_INVOICE_CANCEL', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
        `).run(generateId(), tenantId, pi.id, pi.pi_number, today,
          vatEntry.party_name, vatEntry.party_tax_id, -vatEntry.base_amount, vatEntry.vat_rate,
          -vatEntry.vat_amount, -vatEntry.total_amount, reversalJournalId, now)
      }
    }

    db.prepare("UPDATE purchase_invoices SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(now, piId, tenantId)

    // Cancelling frees up the goods receipts this invoice had locked so they can be invoiced again
    let grIdsToRelease: string[] = []
    try { grIdsToRelease = JSON.parse(pi.goods_receipt_ids || '[]') } catch { /* legacy row */ }
    if (pi.goods_receipt_id && !grIdsToRelease.includes(pi.goods_receipt_id)) grIdsToRelease.push(pi.goods_receipt_id)
    if (grIdsToRelease.length > 0) {
      const releaseGr = db.prepare('UPDATE goods_receipts SET invoiced_at = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?')
      for (const grId of grIdsToRelease) releaseGr.run(now, grId, tenantId)
    }
  })
  transaction()
  return db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(piId, tenantId)
}

router.put('/invoices/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body

    if (status !== 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'This endpoint only supports cancelling a purchase invoice' })
    }

    const pi = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!pi) {
      return res.status(404).json({ success: false, message: 'Purchase invoice not found' })
    }
    if (pi.status === 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'Purchase invoice already cancelled' })
    }
    const { pending, gateArgs } = gatePurchaseCancel({
      tenantId, user: req.user!, kind: 'purchase_invoice', refId: pi.id, docNumber: pi.pi_number, amount: pi.total_amount,
    })
    if (pending) return res.status(202).json(pendingPurchaseCancelBody(pending, pi.pi_number))

    const updated = cancelPurchaseInvoiceNow(tenantId, pi.id, req.user!.email)
    recordAutoAction(gateArgs)
    res.json({ success: true, data: updated, message: 'Purchase invoice cancelled and journal reversed' })
  } catch (error: any) {
    if (error instanceof PurchaseCancelError) return res.status(error.status).json({ success: false, message: error.message })
    console.error('Cancel purchase invoice error:', error)
    res.status(500).json({ success: false, message: 'Failed to cancel purchase invoice' })
  }
})

// ============================================
// DOC TRAIL — เส้นทางเอกสารของใบสั่งซื้อใบเดียว
// ใบขอซื้อ → ใบสั่งซื้อ → รับสินค้า → ใบแจ้งหนี้ → จ่ายเงิน (+ คืนสินค้าถ้ามี)
// คู่ขนานกับ /receivables/deal-timeline/:soId ของฝั่งขาย ให้ทั้งสองฝั่งอ่านเหมือนกัน
// ============================================
router.get('/doc-trail/:poId', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { poId } = req.params

    const po = db.prepare(`
      SELECT po.*, s.name AS supplier_name
      FROM purchase_orders po
      LEFT JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
      WHERE po.id = ? AND po.tenant_id = ?
    `).get(poId, tenantId) as any
    if (!po) return res.status(404).json({ success: false, message: 'Purchase order not found' })

    const pr = po.linked_pr_id
      ? db.prepare('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(po.linked_pr_id, tenantId) as any
      : null

    // ใบแจ้งหนี้รวมบิลเก็บ PO อื่นไว้ใน purchase_order_ids — ต้องนับด้วย ไม่งั้น PO ที่ถูกรวมมองไม่เห็นบิลตัวเอง
    const invoices = db.prepare(`
      SELECT id, pi_number, supplier_invoice_number, invoice_date, due_date,
             total_amount, paid_amount, balance_amount, status, payment_status, purchase_order_id, purchase_order_ids
      FROM purchase_invoices
      WHERE tenant_id = ? AND (purchase_order_id = ? OR purchase_order_ids LIKE ?)
      ORDER BY invoice_date ASC
    `).all(tenantId, poId, `%"${poId}"%`) as any[]
    const liveInvoices = invoices.filter((i: any) => i.status !== 'CANCELLED')

    // PO ทุกใบที่อยู่ในบิลเดียวกัน — ขั้นรับสินค้าต้องดูครบทุกใบ ไม่ใช่แค่ใบที่เปิดอยู่
    const poIds = new Set<string>([poId])
    for (const inv of liveInvoices) {
      if (inv.purchase_order_id) poIds.add(inv.purchase_order_id)
      try { for (const id of JSON.parse(inv.purchase_order_ids || '[]')) poIds.add(id) } catch { /* JSON เสีย = ใช้แค่หัวใบ */ }
    }
    const poIdList = [...poIds]
    const inPOs = poIdList.map(() => '?').join(', ')
    const relatedPOs = db.prepare(`
      SELECT id, po_number, total_amount FROM purchase_orders
      WHERE tenant_id = ? AND id IN (${inPOs}) AND status != 'CANCELLED'
    `).all(tenantId, ...poIdList) as any[]

    const receipts = db.prepare(`
      SELECT gr.id, gr.gr_number, gr.receipt_date, gr.status, gr.invoiced_at, po.po_number
      FROM goods_receipts gr LEFT JOIN purchase_orders po ON po.id = gr.purchase_order_id
      WHERE gr.tenant_id = ? AND gr.purchase_order_id IN (${inPOs})
      ORDER BY gr.receipt_date ASC
    `).all(tenantId, ...poIdList) as any[]
    const liveReceipts = receipts.filter((r: any) => r.status !== 'CANCELLED')

    // received_qty ขยับเฉพาะตอนยืนยัน GR — ใบร่างยังไม่นับว่ารับ · บรรทัด skip_stock ไม่ต้องรับเข้าคลัง
    const receiptGaps = db.prepare(`
      SELECT po.po_number, COUNT(*) AS pending_lines
      FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id
      WHERE poi.tenant_id = ? AND poi.purchase_order_id IN (${inPOs}) AND po.status != 'CANCELLED'
        AND COALESCE(poi.skip_stock, 0) = 0 AND COALESCE(poi.received_qty, 0) < poi.quantity
      GROUP BY po.id ORDER BY po.po_number
    `).all(tenantId, ...poIdList) as any[]

    const invIds = liveInvoices.map((i: any) => i.id)
    const payments = invIds.length
      ? db.prepare(`
          SELECT id, payment_number, payment_date, amount, net_amount, payment_method, purchase_invoice_id, status
          FROM supplier_payments
          WHERE tenant_id = ? AND purchase_invoice_id IN (${invIds.map(() => '?').join(', ')})
          ORDER BY payment_date ASC
        `).all(tenantId, ...invIds) as any[]
      : []
    const livePayments = payments.filter((p: any) => p.status !== 'CANCELLED')

    const returns = db.prepare(`
      SELECT id, pr_number, return_date, total_amount, status
      FROM purchase_returns WHERE purchase_order_id = ? AND tenant_id = ?
      ORDER BY return_date ASC
    `).all(poId, tenantId) as any[]

    const sum = (rows: any[], key: string) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0)
    const invoicedAmount = sum(liveInvoices, 'total_amount')
    const paidAmount = sum(livePayments, 'net_amount')
    const outstanding = sum(liveInvoices, 'balance_amount')

    const stages: any[] = [
      {
        key: 'request', done: !!pr, docNumber: pr?.pr_number ?? null, date: pr?.request_date ?? null,
        amount: pr?.total_amount ?? null, status: pr?.status ?? null, count: pr ? 1 : 0,
        skipped: !pr,   // สั่งซื้อตรงโดยไม่ผ่านใบขอซื้อ = ข้ามขั้นนี้ ไม่ใช่ค้าง
      },
      {
        key: 'order', done: true, docNumber: po.po_number, date: po.order_date,
        amount: relatedPOs.length > 1 ? sum(relatedPOs, 'total_amount') : po.total_amount,
        status: po.status, count: relatedPOs.length || 1,
      },
      {
        // ครบ = ทุก PO ในบิลรับของ (ยืนยันแล้ว) ครบทุกบรรทัด · มีใบรับแต่ยังขาด = ส้ม
        key: 'receipt', done: liveReceipts.length > 0 && receiptGaps.length === 0,
        partial: liveReceipts.length > 0 && receiptGaps.length > 0,
        docNumber: liveReceipts[0]?.gr_number ?? null, date: liveReceipts[0]?.receipt_date ?? null,
        amount: null, status: liveReceipts[0]?.status ?? null, count: liveReceipts.length,
        docs: liveReceipts, gaps: receiptGaps,
      },
      {
        key: 'invoice', done: liveInvoices.length > 0,
        docNumber: liveInvoices[0]?.pi_number ?? null, date: liveInvoices[0]?.invoice_date ?? null,
        amount: invoicedAmount || null, status: liveInvoices[0]?.status ?? null, count: liveInvoices.length,
      },
      {
        key: 'payment', done: livePayments.length > 0 && outstanding <= 0.01,
        partial: livePayments.length > 0 && outstanding > 0.01,
        docNumber: livePayments[0]?.payment_number ?? null, date: livePayments[0]?.payment_date ?? null,
        amount: paidAmount || null, status: liveInvoices[0]?.payment_status ?? null, count: livePayments.length,
      },
    ]
    // คืนสินค้าเป็นทางแยก ไม่ใช่ขั้นตอนปกติ — โชว์เฉพาะตอนมีจริง
    if (returns.length > 0) {
      stages.push({
        key: 'return', done: true, docNumber: returns[0].pr_number, date: returns[0].return_date,
        amount: sum(returns, 'total_amount'), status: returns[0].status, count: returns.length,
      })
    }

    res.json({
      success: true,
      data: {
        stages,
        summary: { invoicedAmount, paidAmount, outstanding, poTotal: po.total_amount },
        supplierName: po.supplier_name,
      },
    })
  } catch (error) {
    console.error('Purchase doc trail error:', error)
    res.status(500).json({ success: false, message: 'Failed to build document trail' })
  }
})

// ============================================
// SUPPLIER PAYMENTS
// ============================================

// GET all supplier payments
router.get('/payments', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const payments = db.prepare(`
      SELECT sp.*, s.name as supplier_name, s.code as supplier_code,
        pi.pi_number,
        je.entry_number as journal_entry_number, je.id as journal_entry_id,
        ba.bank_name, ba.account_number as bank_account_number
      FROM supplier_payments sp
      LEFT JOIN suppliers s ON sp.supplier_id = s.id AND s.tenant_id = sp.tenant_id
      LEFT JOIN purchase_invoices pi ON sp.purchase_invoice_id = pi.id
      -- supplier_payments ไม่มีคอลัมน์ journal_entry_id ต้องไล่จาก reference ของใบสำคัญแทน
      -- ไม่ join ตัวนี้มา หน้าเว็บจะขึ้นว่า "ยังไม่ลงบัญชี" ทั้งที่ลงจริงครบทุกใบ
      LEFT JOIN journal_entries je ON je.tenant_id = sp.tenant_id
        AND je.reference_type = 'SUPPLIER_PAYMENT' AND je.reference_id = sp.id
      LEFT JOIN bank_accounts ba ON ba.id = sp.bank_account_id AND ba.tenant_id = sp.tenant_id
      WHERE sp.tenant_id = ? AND (sp.status IS NULL OR sp.status != 'CANCELLED')
      ORDER BY sp.payment_date DESC
    `).all(tenantId)

    res.json({ success: true, data: payments })
  } catch (error) {
    console.error('Get supplier payments error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch supplier payments' })
  }
})

// GET เงินออกจากลิ้นชัก POS ที่ยังไม่ได้จับคู่บิล — ตัวเลือกของวิธีจ่าย "เงินจาก POS"
// (path ไม่อยู่ใต้ /payments/ เพราะจะชนกับ /payments/:id ด้านล่าง)
router.get('/pos-cash-unmatched', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const list = listPosCashUnmatched(tenantId)
    // ?include=<id> — โหมดดู/แก้ใบที่จับคู่ครบแล้ว ยังต้องแสดงชื่อรายการนั้นได้
    const include = typeof req.query.include === 'string' ? req.query.include : ''
    if (include && !list.some(m => m.id === include)) list.push(...listPosCashUnmatched(tenantId, include))
    res.json({ success: true, data: list })
  } catch (error) {
    console.error('Get unmatched POS cash error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch unmatched POS cash' })
  }
})

// GET single supplier payment
router.get('/payments/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const payment = db.prepare(`
      SELECT sp.*, s.name as supplier_name, s.code as supplier_code,
        pi.pi_number, pi.supplier_invoice_number
      FROM supplier_payments sp
      LEFT JOIN suppliers s ON sp.supplier_id = s.id AND s.tenant_id = sp.tenant_id
      LEFT JOIN purchase_invoices pi ON sp.purchase_invoice_id = pi.id
      WHERE sp.id = ? AND sp.tenant_id = ?
    `).get(req.params.id, tenantId)
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' })
    res.json({ success: true, data: payment })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch payment' })
  }
})

// POST create supplier payment — logic lives in services/purchaseBilling.service.ts
// (shared with the MCP tool pay_supplier, see mcp/tools/purchaseBilling.ts)
router.post('/payments', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canHandleBilling(req.user!, 'purchase')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ทำรายการนี้ — ต้องอยู่ฝ่ายจัดซื้อ/ฝ่ายบัญชี หรือเป็น ADMIN/MASTER' })
    }
    const { supplierId, purchaseInvoiceId, paymentDate, paymentMethod, paymentReference, amount, withholdingTax, notes, bankAccountId, posCashMovementId } = req.body

    const payment = paySupplier(tenantId, req.user!.email, {
      posCashMovementId,
      supplierId,
      purchaseInvoiceId,
      paymentDate,
      paymentMethod,
      paymentReference,
      amount,
      withholdingTax,
      notes,
      bankAccountId,
    })

    res.status(201).json({ success: true, data: payment, message: 'Payment recorded successfully' })
  } catch (error: any) {
    if (error instanceof PurchaseBillingError) {
      const status = error.code === 'INVOICE_NOT_FOUND' ? 404 : 400
      return res.status(status).json({ success: false, message: error.message })
    }
    console.error('Create supplier payment error:', error)
    res.status(500).json({ success: false, message: 'Failed to record payment' })
  }
})

// ============================================
// PURCHASE RETURNS
// ============================================

// GET all purchase returns
router.get('/returns', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const returns = db.prepare(`
      SELECT pr.*, s.name as supplier_name, s.code as supplier_code,
        po.po_number
      FROM purchase_returns pr
      LEFT JOIN suppliers s ON pr.supplier_id = s.id AND s.tenant_id = pr.tenant_id
      LEFT JOIN purchase_orders po ON pr.purchase_order_id = po.id
      WHERE pr.tenant_id = ?
      ORDER BY pr.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: returns })
  } catch (error) {
    console.error('Get purchase returns error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch purchase returns' })
  }
})

// GET single purchase return
router.get('/returns/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const ret = db.prepare(`
      SELECT pr.*, s.name as supplier_name, s.code as supplier_code,
        po.po_number
      FROM purchase_returns pr
      LEFT JOIN suppliers s ON pr.supplier_id = s.id AND s.tenant_id = pr.tenant_id
      LEFT JOIN purchase_orders po ON pr.purchase_order_id = po.id
      WHERE pr.id = ? AND pr.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!ret) {
      return res.status(404).json({ success: false, message: 'Purchase return not found' })
    }

    const items = db.prepare(`
      SELECT pri.*, m.name as material_name, m.code as material_code
      FROM purchase_return_items pri
      LEFT JOIN stock_items m ON pri.material_id = m.id AND m.tenant_id = pri.tenant_id
      WHERE pri.purchase_return_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...ret, items } })
  } catch (error) {
    console.error('Get purchase return error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch purchase return' })
  }
})

// POST create purchase return
router.post('/returns', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canManagePurchase(req.user!)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ทำใบคืนสินค้า — ต้องเป็นฝ่ายจัดซื้อ' })
    }
    const { purchaseOrderId, goodsReceiptId, reason, notes, items } = req.body
    
    if (!purchaseOrderId || !reason) {
      return res.status(400).json({ success: false, message: 'Purchase order and reason are required' })
    }

    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(purchaseOrderId, tenantId) as any
    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' })
    }

    try {
      for (const item of items || []) item.materialId = resolveStockItemId(tenantId, item.materialId, item.description)
    } catch (e) {
      if (e instanceof StockItemRefError) return res.status(400).json({ success: false, message: e.message })
      throw e
    }

    // หน่วยของแต่ละบรรทัด: ผู้ใช้เลือกจาก UnitPicker ส่งมาเองอยู่แล้ว — เผื่อผู้เรียกไม่ส่งมา
    // (เรียก API ตรง) ลองหาจากบรรทัด PO ที่ตรงสินค้านี้ก่อน ไม่เจอก็ปล่อยเป็น base_unit ของสินค้า
    // (เท่ากับไม่แปลงหน่วยตอนยืนยัน ปลอดภัยกว่าเดาหน่วยผิด)
    const poUnitByMaterial = new Map(
      (db.prepare('SELECT material_id, unit FROM purchase_order_items WHERE purchase_order_id = ? AND tenant_id = ?')
        .all(purchaseOrderId, tenantId) as any[]).map((i: any) => [i.material_id, i.unit])
    )
    for (const item of items || []) {
      if (!item.unit) {
        item.unit = poUnitByMaterial.get(item.materialId)
          || (db.prepare('SELECT COALESCE(base_unit, unit) as u FROM stock_items WHERE id = ? AND tenant_id = ?').get(item.materialId, tenantId) as any)?.u
          || null
      }
    }

    // ราคา/จำนวนต้องมาจากบรรทัดใบรับสินค้าที่ยืนยันแล้ว ไม่ใช่ตัวเลขจาก client — คืนได้ไม่เกินที่รับมาลบที่คืนไปแล้ว
    // shortcut: ราคาคืน = ราคาบนบรรทัด PO (ไม่หักส่วนลดท้ายบิล/ราคาที่แก้ในใบแจ้งหนี้) — ถ้าต้องตรงบิลผู้ขายให้ทำใบลดหนี้แยก
    const grLines = db.prepare(`
      SELECT gri.id, gri.goods_receipt_id, gri.material_id, gri.accepted_qty, poi.unit AS po_unit, poi.unit_price
      FROM goods_receipt_items gri
      JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
      JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id
      WHERE gr.tenant_id = ? AND gr.purchase_order_id = ? AND gr.status = 'CONFIRMED' AND gri.accepted_qty > 0
        ${goodsReceiptId ? 'AND gr.id = ?' : ''}
      ORDER BY gr.receipt_date, gr.created_at
    `).all(tenantId, purchaseOrderId, ...(goodsReceiptId ? [goodsReceiptId] : [])) as any[]
    const returnedQty = db.prepare(`SELECT COALESCE(SUM(pri.po_unit_qty), 0) AS q FROM purchase_return_items pri
      JOIN purchase_returns pr ON pr.id = pri.purchase_return_id WHERE pri.goods_receipt_item_id = ? AND pr.status != 'CANCELLED'`)
    const usedNow = new Map<string, number>()
    const leftOf = (l: any) => l.accepted_qty - (returnedQty.get(l.id) as any).q - (usedNow.get(l.id) || 0)
    const grOfReturn = new Set<string>()
    for (const item of items || []) {
      const qty = Number(item.quantity)
      if (!(qty > 0)) return res.status(400).json({ success: false, message: 'จำนวนคืนต้องมากกว่า 0' })
      const line = item.grItemId
        ? grLines.find(l => l.id === item.grItemId)
        : (grLines.find(l => l.material_id === item.materialId && leftOf(l) > 1e-9) || grLines.find(l => l.material_id === item.materialId))
      if (!line) {
        return res.status(400).json({ success: false, message: `ไม่พบรายการ "${item.description || item.materialId}" ในใบรับสินค้าที่ยืนยันแล้วของใบสั่งซื้อนี้ — คืนได้เฉพาะของที่รับเข้ามาแล้ว` })
      }
      const poUnit = normalizeUnit(line.po_unit || '')
      const retUnit = normalizeUnit(item.unit || line.po_unit || '')
      let poQty = qty
      if (poUnit && retUnit && retUnit !== poUnit) {
        const conv = convertQuantityBidirectional(qty, retUnit, poUnit, tenantId, line.material_id)
        if (!conv) return res.status(400).json({ success: false, message: `ไม่พบการแปลงหน่วย ${retUnit} → ${poUnit} (หน่วยของใบสั่งซื้อ) กรุณาตั้งค่า Unit Conversion ก่อน` })
        poQty = conv.converted
      }
      if (poQty > leftOf(line) + 1e-9) {
        return res.status(400).json({ success: false, message: `คืนเกินจำนวนที่รับมา — คืนได้อีก ${roundQty(Math.max(0, leftOf(line)))} ${line.po_unit || ''}` })
      }
      usedNow.set(line.id, (usedNow.get(line.id) || 0) + poQty)
      grOfReturn.add(line.goods_receipt_id)
      item.grItemId = line.id
      item.poUnitQty = roundQty(poQty)
      item.unitPrice = (Number(line.unit_price) || 0) * poQty / qty // ราคาต่อหน่วยที่คืน
    }
    // ใบคืนหนึ่งใบผูกใบรับสินค้าใบเดียว — ใช้ตัดสินว่าคืนก่อน/หลังออกใบแจ้งหนี้ (2109 หรือเจ้าหนี้)
    if (grOfReturn.size > 1) {
      return res.status(400).json({ success: false, message: 'รายการที่คืนมาจากใบรับสินค้าหลายใบ — แยกใบคืนตามใบรับสินค้า' })
    }
    const returnGrId = [...grOfReturn][0] || goodsReceiptId || null

    const id = generateId()
    const prNumber = generateNumber('PRT', tenantId, 'purchase_returns')
    const now = new Date().toISOString()

    // VAT ตามใบสั่งซื้อ (เดิมฝัง 7% แยกนอกเสมอ — ผู้ขายไม่จด VAT ก็ได้ภาษีซื้อปลอมกลับมา)
    const subtotalRaw = (items || []).reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0)
    const taxRate = po.tax_rate ?? 7
    const poInclusive = po.vat_inclusive === 1
    const { subtotal, taxAmount, totalAmount } = calcVat(subtotalRaw, { rate: taxRate, inclusive: poInclusive })

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO purchase_returns (id, tenant_id, pr_number, purchase_order_id, goods_receipt_id, 
          supplier_id, return_date, reason, subtotal, tax_rate, tax_amount, total_amount, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
      `).run(id, tenantId, prNumber, purchaseOrderId, returnGrId, po.supplier_id,
        now, reason, subtotal, taxRate, taxAmount, totalAmount, notes || '', now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO purchase_return_items (id, tenant_id, purchase_return_id, goods_receipt_item_id,
            material_id, quantity, unit, unit_price, reason, total_price, po_unit_qty)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          const total = item.quantity * item.unitPrice
          insertItem.run(generateId(), tenantId, id, item.grItemId || null, item.materialId || null,
            item.quantity, item.unit || null, item.unitPrice, item.reason || '', total, item.poUnitQty)
        }
      }
    })

    transaction()

    rememberContactVatMode(tenantId, 'supplier', po.supplier_id, taxRate, poInclusive)

    const ret = db.prepare('SELECT * FROM purchase_returns WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    const retItems = db.prepare('SELECT * FROM purchase_return_items WHERE purchase_return_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...ret, items: retItems } })
  } catch (error) {
    console.error('Create purchase return error:', error)
    res.status(500).json({ success: false, message: 'Failed to create purchase return' })
  }
})

// PUT update return status (DRAFT→SUBMITTED, SUBMITTED→APPROVED)
// DELETE purchase return (DRAFT only)
router.delete('/returns/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canManagePurchase(req.user!)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ทำใบคืนสินค้า — ต้องเป็นฝ่ายจัดซื้อ' })
    }
    const ret = db.prepare('SELECT * FROM purchase_returns WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!ret) return res.status(404).json({ success: false, message: 'Not found' })
    if (ret.status !== 'DRAFT') return res.status(400).json({ success: false, message: 'ลบได้เฉพาะใบคืนสินค้าที่ยังเป็นร่างเท่านั้น' })
    // ได้เลขเอกสารไปแล้ว = ห้ามหาย → ยกเลิกแทนการลบ เก็บใบและรายการไว้ให้ตรวจย้อนได้ (เลขไม่ขาดช่วง)
    db.prepare("UPDATE purchase_returns SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(new Date().toISOString(), req.params.id, tenantId)
    res.json({ success: true, message: 'ยกเลิกใบคืนสินค้าแล้ว (เก็บเลขที่ไว้)' })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete purchase return' })
  }
})

// สถานะใบคืนสินค้าที่ไปต่อได้ — CONFIRMED/CANCELLED จบแล้ว (เดิม CANCELLED → APPROVED → ยืนยันตัดสต็อกได้)
const RETURN_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'CANCELLED'],
  APPROVED: ['CANCELLED'],
}

export function cancelPurchaseReturnNow(tenantId: string, returnId: string) {
  const ret = db.prepare('SELECT status FROM purchase_returns WHERE id = ? AND tenant_id = ?').get(returnId, tenantId) as any
  if (!ret) throw new PurchaseCancelError(404, 'Not found')
  if (!(RETURN_TRANSITIONS[ret.status] || []).includes('CANCELLED')) {
    throw new PurchaseCancelError(409, `ใบคืนสินค้าสถานะ ${ret.status} ยกเลิกไม่ได้`)
  }
  db.prepare("UPDATE purchase_returns SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND tenant_id = ?")
    .run(new Date().toISOString(), returnId, tenantId)
}

router.put('/returns/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const ret = db.prepare('SELECT * FROM purchase_returns WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!ret) return res.status(404).json({ success: false, message: 'Not found' })
    if (!(RETURN_TRANSITIONS[ret.status] || []).includes(status)) {
      return res.status(400).json({ success: false, message: `เปลี่ยนสถานะใบคืนสินค้าจาก ${ret.status} เป็น ${status} ไม่ได้` })
    }
    if (status === 'SUBMITTED' && !canManagePurchase(req.user!)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ส่งใบคืนสินค้า — ต้องเป็นฝ่ายจัดซื้อ' })
    }
    if (status === 'APPROVED' && !userCan(req.user!, 'purchase', 'approve')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์อนุมัติใบคืนสินค้า' })
    }
    if (status === 'CANCELLED') {
      const { pending, gateArgs } = gatePurchaseCancel({
        tenantId, user: req.user!, kind: 'purchase_return', refId: ret.id, docNumber: ret.pr_number, amount: ret.total_amount,
      })
      if (pending) return res.status(202).json(pendingPurchaseCancelBody(pending, ret.pr_number))
      cancelPurchaseReturnNow(tenantId, ret.id)
      recordAutoAction(gateArgs)
    } else {
      db.prepare('UPDATE purchase_returns SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(status, new Date().toISOString(), req.params.id, tenantId)
    }

    res.json({ success: true, data: { id: req.params.id, status } })
  } catch (error) {
    if (error instanceof PurchaseCancelError) return res.status(error.status).json({ success: false, message: error.message })
    res.status(500).json({ success: false, message: 'Failed to update return status' })
  }
})

// โยนตอนยืนยันคืนสินค้าแล้วแปลงหน่วย/ตัดสต็อกไม่ได้ (ไม่มีกฎแปลงหน่วย, สต็อกไม่พอ) — จับคู่กับ
// catch ด้านล่างเพื่อตอบ 400 เป็นข้อความไทย ไม่ใช่ 500 ทั่วไป เหมือน GoodsReceiptError/StockItemRefError
class PurchaseReturnStockError extends Error {}

// PUT confirm return (deduct stock) — requires APPROVED status
router.put('/returns/:id/confirm', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canConfirmGoodsReceipt(req.user!)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ยืนยันคืนสินค้า — ต้องเป็นฝ่ายจัดซื้อ/ฝ่ายคลัง หรือ ADMIN/MANAGER/MASTER/POWERUSER' })
    }
    
    const ret = db.prepare('SELECT * FROM purchase_returns WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!ret) {
      return res.status(404).json({ success: false, message: 'Purchase return not found' })
    }

    if (ret.status === 'CONFIRMED') {
      return res.status(400).json({ success: false, message: 'Purchase return already confirmed' })
    }
    if (ret.status !== 'APPROVED') {
      return res.status(400).json({ success: false, message: 'ต้องอนุมัติใบคืนสินค้าก่อนยืนยัน' })
    }

    const items = db.prepare('SELECT * FROM purchase_return_items WHERE purchase_return_id = ?').all(req.params.id) as any[]
    const now = new Date().toISOString()
    const closedLabel = closedPeriodLabel(tenantId, ret.return_date || now)
    if (closedLabel) return res.status(400).json({ success: false, message: `งวด ${closedLabel} ปิดแล้ว ยืนยันคืนสินค้าวันที่นี้ไม่ได้` })

    // === Accounting: mirror of the PURCHASE_INVOICE posting, debits/credits swapped ===
    // Amounts come straight off purchase_returns (subtotal / tax_amount / total_amount are
    // stored at create time), so nothing is inferred or recomputed here.
    const retSubtotal = Number(ret.subtotal) || 0
    const retTax      = Number(ret.tax_amount) || 0
    const retTotal    = Number(ret.total_amount) || (retSubtotal + retTax)
    // Double-post guard: status !== 'CONFIRMED' already blocks a replay, but check the
    // ledger too so a manually re-opened return can't post the same journal twice.
    const alreadyPosted = hasReversalJournal(tenantId, 'PURCHASE_RETURN', ret.id)
    const shouldPost    = retTotal > 0 && !alreadyPosted
    // ยังไม่จด VAT: ตอนซื้อ VAT ถูกรวมเข้าต้นทุนของ ตอนคืนจึงลดต้นทุนของเต็มยอด ไม่ใช่ลด 1110
    const vatClaimable   = isVatRegistered(tenantId)
    const stockValue     = vatClaimable ? Math.round((retTotal - retTax) * 100) / 100 : retTotal
    // คืนก่อนออกใบแจ้งหนี้: ยังไม่มีเจ้าหนี้/ภาษีซื้อ ของยังค้างอยู่ใน 2109 → Dr 2109 / Cr สต็อก
    // ใบแจ้งหนี้ที่ออกทีหลังจะคิดเฉพาะของที่เหลือ (deriveItemsFromGoodsReceipts หักส่วนที่คืน)
    const retGr = ret.goods_receipt_id
      ? db.prepare('SELECT invoiced_at FROM goods_receipts WHERE id = ? AND tenant_id = ?').get(ret.goods_receipt_id, tenantId) as any
      : null
    const grniReturn = !!retGr && !retGr.invoiced_at
    const supplier = db.prepare('SELECT name, tax_id FROM suppliers WHERE id = ? AND tenant_id = ?').get(ret.supplier_id, tenantId) as any

    const negSetting = db.prepare('SELECT allow_negative_stock FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
    const allowNegativeStock = !!negSetting && negSetting.allow_negative_stock === 1

    const transaction = db.transaction(() => {
      // Update return status
      db.prepare("UPDATE purchase_returns SET status = 'CONFIRMED', updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(now, req.params.id, tenantId)

      // Deduct stock — item.quantity is in item.unit (what the user picked on the return
      // form, e.g. "ลัง"), not necessarily stock_items' base_unit, so it has to go through
      // the same convert + auto-unpack path every other deduction uses (sales/shared.ts,
      // stockMovement.service.ts) instead of subtracting the raw number straight off
      // quantity like before (1 "ลัง" of a bottle-based item used to remove 1 bottle).
      for (const item of items) {
        if (item.material_id && item.quantity > 0) {
          // item.material_id is a stock_items.id (see the migration note on the
          // purchase_return_items FK rebuild) — fall back to the legacy
          // stock_items.material_id lookup too, same dual-lookup pattern as
          // reverseGoodsReceiptStock() above, in case any pre-fix rows stored a
          // real materials.id instead.
          let stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
          if (!stockItem) {
            stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
          }

          if (stockItem) {
            const stockUnit = normalizeUnit(stockItem.base_unit || stockItem.unit || '')
            // แถวเก่าก่อนมีคอลัมน์ unit ไม่มีหน่วยบันทึกไว้ — ถือว่าหน่วยเดียวกับสต็อก (ไม่แปลง)
            // ให้พฤติกรรมเดิมคงที่ ไม่ทำย้อนหลังพัง
            const retUnit = normalizeUnit(item.unit || stockUnit)
            let deductQty = roundQty(Number(item.quantity))
            if (retUnit && stockUnit && retUnit !== stockUnit) {
              const converted = convertQuantityBidirectional(Number(item.quantity), retUnit, stockUnit, tenantId, item.material_id)
              if (!converted) {
                throw new PurchaseReturnStockError(
                  `ไม่พบการแปลงหน่วย ${retUnit} → ${stockUnit} สำหรับ "${stockItem.name || item.material_id}" กรุณาตั้งค่า Unit Conversion ก่อนจึงยืนยันคืนสินค้าได้`
                )
              }
              deductQty = roundQty(converted.converted)
            }

            // เปิดแพ็คที่ยังไม่แกะอัตโนมัติถ้าของหลวม (loose) ไม่พอ — เหมือนทุกจุดตัดสต็อกอื่น
            let availableQty = stockItem.quantity
            if (availableQty < deductQty && (stockItem.sealed_qty ?? 0) > 0) {
              const unpack = autoUnpackIfNeeded(stockItem, deductQty, tenantId)
              if (unpack && unpack.unpackedPacks > 0) {
                const released = roundQty(unpack.unpackedPacks * unpack.packFactor)
                db.prepare('UPDATE stock_items SET quantity = ?, sealed_qty = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
                  .run(unpack.quantity, unpack.sealed_qty, now, stockItem.id, tenantId)
                db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
                  VALUES (?, ?, ?, 'UNPACK', ?, ?, ?, ?, ?, ?, ?)`).run(
                  generateId(), tenantId, stockItem.id, released, stockItem.display_unit || null, unpack.unpackedPacks, `PRT: ${ret.pr_number}`,
                  `แกะอัตโนมัติ ${unpack.unpackedPacks} ${stockItem.display_unit || ''} → +${released} ${stockUnit}`, now, req.user!.userId)
                availableQty = unpack.quantity
                stockItem.quantity = unpack.quantity
                stockItem.sealed_qty = unpack.sealed_qty
              }
            }

            if (availableQty < deductQty && !allowNegativeStock) {
              throw new PurchaseReturnStockError(
                `สต็อก "${stockItem.name || item.material_id}" ไม่พอให้คืนสินค้า — ต้องการ ${deductQty} ${stockUnit} แต่มีอยู่ ${availableQty} ${stockUnit}`
              )
            }

            db.prepare('UPDATE stock_items SET quantity = quantity - ?, unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ? AND tenant_id = ?')
              .run(deductQty, now, stockItem.id, tenantId)

            // Record stock movement — movement_unit/movement_quantity จำหน่วย/จำนวนตามที่ผู้ใช้
            // กรอกบนใบคืน (ก่อนแปลง) ไว้ด้วย เหมือนทุกจุดตัดสต็อกอื่นที่แปลงหน่วย
            db.prepare(`
              INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
              VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, ?, ?, ?)
            `).run(generateId(), tenantId, stockItem.id, deductQty, item.unit || null, Number(item.quantity), `PRT: ${ret.pr_number}`,
              `Returned to supplier: ${ret.reason}${retUnit !== stockUnit ? ` (แปลง: ${item.quantity} ${retUnit} → ${deductQty} ${stockUnit})` : ''}`,
              now, req.user!.userId)
          }
        }
      }

      // === POST JOURNAL ENTRY ===
      // คืนหลังออกใบแจ้งหนี้: Dr เจ้าหนี้ (รวม VAT) / Cr สต็อก (= ยอด − ภาษี) / Cr ภาษีซื้อ
      // คืนก่อนออกใบแจ้งหนี้: Dr 2109 / Cr สต็อก (มูลค่าเดียวกับที่ GR ตั้งค้างไว้ ไม่มีภาษีให้กลับ)
      db.prepare('UPDATE purchase_returns SET grni_return = ? WHERE id = ? AND tenant_id = ?').run(grniReturn ? 1 : 0, ret.id, tenantId)
      if (shouldPost) {
        const entryDate = (ret.return_date || now).substring(0, 10)
        const taxBack = !grniReturn && vatClaimable && retTax > 0
        const journalId = postJournal({
          tenantId, date: entryDate, referenceType: 'PURCHASE_RETURN', referenceId: ret.id,
          description: `คืนสินค้าผู้ขาย ${ret.pr_number}`, notes: ret.notes || null, createdBy: req.user!.email,
          lines: grniReturn
            ? [
                { code: ACC.GRNI, description: `ลดค้างรับใบแจ้งหนี้ - ${ret.pr_number}`, debit: stockValue },
                { code: ACC.RAW_MATERIAL, description: `สต็อกวัตถุดิบ - ${ret.pr_number}`, credit: stockValue },
              ]
            : [
                { code: ACC.AP, description: `เจ้าหนี้การค้า - ${ret.pr_number}`, debit: retTotal },
                { code: ACC.RAW_MATERIAL, description: `สต็อกวัตถุดิบ - ${ret.pr_number}`, credit: stockValue },
                ...(taxBack ? [{ code: ACC.INPUT_VAT, description: `ภาษีซื้อ - ${ret.pr_number}`, credit: retTax }] : []),
              ],
        })

        // Negative input-VAT entry so the VAT report doesn't keep claiming tax on
        // goods that went back to the supplier (same shape as the PI-cancel reversal).
        if (taxBack) db.prepare(`
          INSERT INTO vat_entries (id, tenant_id, document_type, document_id, document_number, document_date,
            party_name, party_tax_id, base_amount, vat_rate, vat_amount, total_amount, is_input_vat, is_output_vat, journal_entry_id, created_at)
          VALUES (?, ?, 'PURCHASE_RETURN', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
        `).run(generateId(), tenantId, ret.id, ret.pr_number, entryDate,
          supplier?.name || '', supplier?.tax_id || null,
          -stockValue, Number(ret.tax_rate) || 0, -retTax, -retTotal, journalId, now)
      }
    })

    transaction()

    const updated = db.prepare('SELECT * FROM purchase_returns WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: updated, message: 'Purchase return confirmed and stock deducted' })
  } catch (error: any) {
    if (error instanceof PurchaseReturnStockError) {
      return res.status(400).json({ success: false, message: error.message })
    }
    console.error('Confirm purchase return error:', error)
    res.status(500).json({ success: false, message: 'Failed to confirm purchase return' })
  }
})

// ============================================
// PURCHASE BADGE COUNTS (sidebar + tab notification dots)
// ============================================
// One lightweight endpoint so the Purchase page (all tabs, on page load) and
// the Sidebar (poll every 60s) can both learn "how much is waiting for me in
// each tab" without opening every tab first, and without each caller running
// six separate queries of its own. Every query below is a plain COUNT(*)
// filtered by tenant_id (+ status/payment_status), no joins, so it stays
// cheap enough to poll.
//
// Criteria chosen per tab (based on the real status values actually present
// in the DB — checked via PRAGMA table_info + GROUP BY status before writing
// this, not guessed):
//   requests  — purchase_requests.status = 'PENDING'
//               The only status meaning "someone is waiting on an approval
//               decision". DRAFT is still being edited by its author;
//               APPROVED/REJECTED/CONVERTED are already done.
//   orders    — purchase_orders.status NOT IN ('RECEIVED', 'CANCELLED')
//               DRAFT/SUBMITTED/APPROVED/PARTIAL all still need further
//               action (submit, approve, or receive the rest); RECEIVED and
//               CANCELLED are terminal.
//   receipts  — goods_receipts.status = 'DRAFT'
//               A GR row is created DRAFT and needs a human to hit "confirm"
//               before it posts to stock; CONFIRMED/CANCELLED are done.
//   invoices  — purchase_invoices.payment_status IN ('UNPAID', 'PARTIAL')
//               AND status != 'CANCELLED' — still owe the supplier money.
//   payments  — supplier_payments has NO status column: every row in it is
//               already a completed, posted payment (there is no
//               draft/pending payment concept in this schema — see PRAGMA
//               table_info(supplier_payments)). The "to-do" that actually
//               drives someone to open the Payments tab is "which invoices
//               still need a payment run", so this reuses the same
//               unpaid/partial invoice count as `invoices` rather than
//               reporting a meaningless 0 for a table that has nothing
//               in-flight. NOTE: `total` below deliberately does NOT add
//               `payments` on top of `invoices` — they describe the same
//               underlying unpaid invoices, and summing both would
//               double-count them in the sidebar total.
//   returns   — purchase_returns.status NOT IN ('CONFIRMED', 'CANCELLED')
//               DRAFT/SUBMITTED/APPROVED are still open; CONFIRMED/CANCELLED
//               are done.
router.get('/badge-counts', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const requests = (db.prepare(
      `SELECT COUNT(*) as cnt FROM purchase_requests WHERE tenant_id = ? AND status = 'PENDING'`
    ).get(tenantId) as any).cnt as number

    const orders = (db.prepare(
      `SELECT COUNT(*) as cnt FROM purchase_orders WHERE tenant_id = ? AND status NOT IN ('RECEIVED', 'CANCELLED')`
    ).get(tenantId) as any).cnt as number

    const receipts = (db.prepare(
      `SELECT COUNT(*) as cnt FROM goods_receipts WHERE tenant_id = ? AND status = 'DRAFT'`
    ).get(tenantId) as any).cnt as number

    const invoices = (db.prepare(
      `SELECT COUNT(*) as cnt FROM purchase_invoices WHERE tenant_id = ? AND payment_status IN ('UNPAID', 'PARTIAL') AND status != 'CANCELLED'`
    ).get(tenantId) as any).cnt as number

    // payments intentionally mirrors invoices — see comment block above
    const payments = invoices

    const returns = (db.prepare(
      `SELECT COUNT(*) as cnt FROM purchase_returns WHERE tenant_id = ? AND status NOT IN ('CONFIRMED', 'CANCELLED')`
    ).get(tenantId) as any).cnt as number

    // payments excluded here on purpose (see comment above) — it is not a
    // distinct queue, it is the same unpaid invoices already counted once.
    const total = requests + orders + receipts + invoices + returns

    res.json({
      success: true,
      data: { requests, orders, receipts, invoices, payments, returns, total }
    })
  } catch (error) {
    console.error('Get purchase badge counts error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch purchase badge counts' })
  }
})

// ============================================
// PURCHASE SUMMARY / STATS
// ============================================

router.get('/summary', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    // PR Stats
    const prStats = db.prepare(`
      SELECT 
        COUNT(*) as total_requests,
        SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) as draft_requests,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending_requests,
        SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approved_requests,
        COALESCE(SUM(total_amount), 0) as total_request_amount
      FROM purchase_requests
      WHERE tenant_id = ?
    `).get(tenantId) as any

    // PO Stats
    const poStats = db.prepare(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) as draft_orders,
        SUM(CASE WHEN status IN ('SUBMITTED', 'APPROVED') THEN 1 ELSE 0 END) as pending_orders,
        SUM(CASE WHEN status = 'RECEIVED' THEN 1 ELSE 0 END) as received_orders,
        SUM(CASE WHEN status = 'PARTIAL' THEN 1 ELSE 0 END) as partial_orders,
        COALESCE(SUM(total_amount), 0) as total_order_amount
      FROM purchase_orders
      WHERE tenant_id = ?
    `).get(tenantId) as any

    // GR Stats
    const grStats = db.prepare(`
      SELECT COUNT(*) as total_receipts
      FROM goods_receipts
      WHERE tenant_id = ? AND status = 'CONFIRMED'
    `).get(tenantId) as any

    // Invoice Stats
    const invStats = db.prepare(`
      SELECT 
        COUNT(*) as total_invoices,
        SUM(CASE WHEN payment_status = 'UNPAID' THEN 1 ELSE 0 END) as unpaid_invoices,
        SUM(CASE WHEN payment_status = 'PARTIAL' THEN 1 ELSE 0 END) as partial_invoices,
        SUM(CASE WHEN payment_status = 'PAID' THEN 1 ELSE 0 END) as paid_invoices,
        COALESCE(SUM(total_amount), 0) as total_invoiced,
        COALESCE(SUM(balance_amount), 0) as outstanding_balance
      FROM purchase_invoices
      WHERE tenant_id = ?
    `).get(tenantId) as any

    // Payment Stats
    const paymentStats = db.prepare(`
      SELECT 
        COUNT(*) as total_payments,
        COALESCE(SUM(amount), 0) as total_paid,
        COALESCE(SUM(withholding_tax), 0) as total_wht
      FROM supplier_payments
      WHERE tenant_id = ? AND (status IS NULL OR status != 'CANCELLED')
    `).get(tenantId) as any

    // Return Stats
    const returnStats = db.prepare(`
      SELECT COUNT(*) as total_returns, COALESCE(SUM(total_amount), 0) as total_return_amount
      FROM purchase_returns
      WHERE tenant_id = ? AND status = 'CONFIRMED'
    `).get(tenantId) as any

    // ความเคลื่อนไหวล่าสุดของทั้งโมดูล — รวม 5 ตารางแล้วเรียงตามเวลาที่ขยับล่าสุด
    // ใบขอซื้อไม่มี supplier_id (ผูกกับแผนก/ผู้ขอ ไม่ใช่ผู้ขาย) จึงใช้ department เป็นคู่กรณีแทน
    // ครอบ try แยกไว้ ถ้าคิวรีนี้พังต้องไม่ทำให้สถิติทั้งก้อนล่มตาม
    let recentActivity: any[] = []
    try {
      recentActivity = db.prepare(`
        SELECT 'PR' AS kind, id, pr_number AS doc, department AS party, total_amount AS amount, status, updated_at
          FROM purchase_requests WHERE tenant_id = ?
        UNION ALL
        SELECT 'PO', po.id, po.po_number, s.name, po.total_amount, po.status, po.updated_at
          FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
         WHERE po.tenant_id = ?
        UNION ALL
        SELECT 'GR', gr.id, gr.gr_number, s.name, NULL, gr.status, gr.updated_at
          FROM goods_receipts gr LEFT JOIN suppliers s ON s.id = gr.supplier_id AND s.tenant_id = gr.tenant_id
         WHERE gr.tenant_id = ?
        UNION ALL
        SELECT 'INV', pi.id, pi.pi_number, s.name, pi.total_amount, pi.payment_status, pi.updated_at
          FROM purchase_invoices pi LEFT JOIN suppliers s ON s.id = pi.supplier_id AND s.tenant_id = pi.tenant_id
         WHERE pi.tenant_id = ?
        UNION ALL
        SELECT 'PAY', sp.id, sp.payment_number, s.name, sp.net_amount, sp.status, sp.updated_at
          FROM supplier_payments sp LEFT JOIN suppliers s ON s.id = sp.supplier_id AND s.tenant_id = sp.tenant_id
         WHERE sp.tenant_id = ?
        ORDER BY updated_at DESC LIMIT 12
      `).all(tenantId, tenantId, tenantId, tenantId, tenantId) as any[]
    } catch (e) {
      console.error('recentActivity query error (ไม่กระทบสถิติส่วนอื่น):', e)
    }

    res.json({
      success: true,
      data: {
        recentActivity,
        purchaseRequests: {
          total: prStats.total_requests,
          draft: prStats.draft_requests,
          pending: prStats.pending_requests,
          approved: prStats.approved_requests,
          totalAmount: prStats.total_request_amount
        },
        purchaseOrders: {
          total: poStats.total_orders,
          draft: poStats.draft_orders,
          pending: poStats.pending_orders,
          received: poStats.received_orders,
          partial: poStats.partial_orders,
          totalAmount: poStats.total_order_amount
        },
        goodsReceipts: {
          confirmed: grStats.total_receipts
        },
        invoices: {
          total: invStats.total_invoices,
          unpaid: invStats.unpaid_invoices,
          partial: invStats.partial_invoices,
          paid: invStats.paid_invoices,
          totalInvoiced: invStats.total_invoiced,
          outstanding: invStats.outstanding_balance
        },
        payments: {
          total: paymentStats.total_payments,
          totalPaid: paymentStats.total_paid,
          totalWHT: paymentStats.total_wht
        },
        returns: {
          total: returnStats.total_returns,
          totalAmount: returnStats.total_return_amount
        }
      }
    })
  } catch (error) {
    console.error('Get purchase summary error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch summary' })
  }
})

export default router
