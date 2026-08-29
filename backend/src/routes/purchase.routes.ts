import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'
import { formatDocumentNumber } from '../utils/id'
import { convertQuantityBidirectional, normalizeUnit, findConversionChain } from '../services/unitConversion.service'
import { roundQty, roundPackQty } from '../utils/qty'
import { ACC, ACC_META, resolveBankAccountGL } from '../config/accountCodes'
import { updateAccountBalance } from './sales/shared'

const router = Router()

router.use(authenticate)

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

// stock_items.unit_cost MUST always be the price per 1 BASE UNIT (stock_items.base_unit),
// never per the unit the PO/GR line was written in. quantity is already forced into
// base_unit (see stockUnit/stockQty conversion above each call site); price used to be
// left at face value, which silently multiplied cost by the pack/kg factor wherever
// base_unit differs from the purchased unit (e.g. shrimp bought at 215 บาท/kg with
// base_unit=g priced stock at 215 บาท/g — 1000x too high). Convert with:
//   unit_cost = pricePerPurchasedUnit / factor
// where factor = how many base units are in 1 purchased unit (the same `factor` that
// convertQuantityBidirectional()/findConversionChain() return when converting FROM the
// purchased unit TO base_unit).
function priceToBaseUnitCost(pricePerPurchasedUnit: number, factor: number, context: string): number {
  if (!Number.isFinite(factor) || factor <= 0) {
    console.warn(`[unit_cost] invalid conversion factor (${factor}) for ${context} — keeping price un-converted to avoid corrupting cost`)
    return pricePerPurchasedUnit
  }
  return pricePerPurchasedUnit / factor
}

// Resolve a PR/PO line item material_id to a valid materials.id, or null.
// Callers (incl. the MCP) may send a real materials.id, a stock_items.id for
// the same logical item (different id but matching code/sku), or a stale value.
// Map it to the right material so the FK insert never fails; with no confident
// match the item is stored as free-text (material_id null).
function resolveMaterialId(tenantId: string, item: any): string | null {
  const materialById = db.prepare('SELECT id FROM materials WHERE id = ? AND tenant_id = ?')
  const materialByCode = db.prepare('SELECT id FROM materials WHERE code = ? AND tenant_id = ?')
  const materialByName = db.prepare('SELECT id FROM materials WHERE name = ? AND tenant_id = ?')
  const raw = item && item.materialId ? String(item.materialId) : null
  if (raw) {
    if (materialById.get(raw, tenantId)) return raw
    const stock = db.prepare('SELECT material_id, sku, name FROM stock_items WHERE id = ? AND tenant_id = ?').get(raw, tenantId) as any
    if (stock) {
      if (stock.material_id && materialById.get(stock.material_id, tenantId)) return stock.material_id
      if (stock.sku) { const m = materialByCode.get(stock.sku, tenantId) as any; if (m) return m.id }
      if (stock.name) { const m = materialByName.get(stock.name, tenantId) as any; if (m) return m.id }
    }
  }
  const code = item && item.materialCode ? String(item.materialCode).trim() : ''
  if (code) { const m = materialByCode.get(code, tenantId) as any; if (m) return m.id }
  const desc = item && item.description ? String(item.description).trim() : ''
  if (desc) {
    let m = materialByCode.get(desc, tenantId) as any
    if (m) return m.id
    m = materialByName.get(desc, tenantId) as any
    if (m) return m.id
  }
  return null
}

function generateNumber(prefix: string, tenantId: string, table: string) {
  const year = new Date().getFullYear()
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
  return formatDocumentNumber(prefix, tenantId, docType, year, 5)
}

function generateEntryNumber(tenantId: string, date: string): string {
  const year = new Date(date).getFullYear()
  return formatDocumentNumber('JV', tenantId, 'JOURNAL', year, 5)
}

function getOrCreateAccount(tenantId: string, code: string, name: string, type: string, category: string, normalBalance: string): string {
  const existing = db.prepare('SELECT id FROM accounts WHERE code = ? AND tenant_id = ?').get(code, tenantId) as any
  if (existing) return existing.id
  const id = generateId()
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, tenantId, code, name, type, category, normalBalance, now, now)
  return id
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
function reverseJournalEntryForReference(
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
      description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(journalId, tenantId, journalNumber, date, reversalReferenceType, referenceId,
    description, original.total_credit, original.total_debit, original.is_posted ? 1 : 0, actorEmail, now, now)

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
    if (!item.material_id || !(item.accepted_qty > 0)) continue

    let poItem: any
    try {
      poItem = db.prepare('SELECT unit_price, unit FROM purchase_order_items WHERE id = ?').get(item.purchase_order_item_id) as any
    } catch (e) {
      poItem = db.prepare('SELECT unit_price FROM purchase_order_items WHERE id = ?').get(item.purchase_order_item_id) as any
    }
    const poUnit = normalizeUnit(poItem?.unit || '')

    let stockItem = db.prepare('SELECT * FROM stock_items WHERE material_id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
    if (!stockItem) {
      stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
    }
    if (!stockItem) continue // nothing we can trace the original stock increase to

    let stockQty = 0
    let sealedQty = 0
    let addToSealed = false
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
      addToSealed = sealedQty > 0 && stockQty === 0
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
      if (poUnit && displayUnit && poUnit === displayUnit && canUnpackDisplay) {
        addToSealed = true
        sealedQty = roundPackQty(Number(item.accepted_qty), `GR ${gr.gr_number} cancel`)
        stockQty = 0
      } else if (poUnit && poUnit !== stockUnit) {
        const converted = convertQuantityBidirectional(Number(item.accepted_qty), poUnit, stockUnit, tenantId, item.material_id)
        if (!converted) {
          const materialName = (db.prepare('SELECT name FROM materials WHERE id = ?').get(item.material_id) as any)?.name
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
      db.prepare('UPDATE stock_items SET sealed_qty = MAX(0, COALESCE(sealed_qty, 0) - ?), unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(sealedQty, now, stockItem.id, tenantId)
    } else {
      db.prepare('UPDATE stock_items SET quantity = quantity - ?, unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(stockQty, now, stockItem.id, tenantId)
    }

    db.prepare(`
      INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
      VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, ?)
    `).run(generateId(), tenantId, stockItem.id, addToSealed ? sealedQty : stockQty, `GR-CANCEL: ${gr.gr_number}`,
      `Reversed on cancellation of goods receipt ${gr.gr_number}`, now, userId)

    // Clear the snapshot so a re-confirm / re-cancel cycle cannot double-reverse.
    try {
      db.prepare('UPDATE goods_receipt_items SET stock_qty = NULL, stock_sealed_qty = NULL WHERE id = ?').run(item.id)
    } catch (e) { /* migration pending */ }

    db.prepare('UPDATE purchase_order_items SET received_qty = MAX(0, received_qty - ?) WHERE id = ? AND tenant_id = ?')
      .run(item.accepted_qty, item.purchase_order_item_id, tenantId)
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
      SELECT pri.*, m.name as material_name, m.code as material_code
      FROM purchase_request_items pri
      LEFT JOIN materials m ON pri.material_id = m.id
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
    db.transaction(() => {
      db.prepare('DELETE FROM purchase_request_items WHERE purchase_request_id = ? AND tenant_id = ?').run(req.params.id, tenantId)
      db.prepare('DELETE FROM purchase_requests WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)
    })()
    res.json({ success: true, message: 'Purchase request deleted' })
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
    
    const id = generateId()
    const prNumber = generateNumber('PR', tenantId, 'purchase_requests')
    const now = new Date().toISOString()

    // Calculate total
    let totalAmount = 0
    if (items && items.length > 0) {
      totalAmount = items.reduce((sum: number, item: any) => sum + (item.estimatedTotalPrice || 0), 0)
    }

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
            item.quantity, item.unit || '', item.estimatedUnitPrice || 0, item.estimatedTotalPrice || 0, item.notes || '')
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

    let totalAmount = 0
    if (items && items.length > 0) {
      totalAmount = items.reduce((sum: number, item: any) => sum + (item.estimatedTotalPrice || (item.quantity || 0) * (item.estimatedUnitPrice || 0)), 0)
    }

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
          const qty = item.quantity || 0
          const price = item.estimatedUnitPrice || 0
          insertItem.run(
            generateId(), tenantId, req.params.id,
            resolveMaterialId(tenantId, item), item.description || '',
            qty, item.unit || '', price, item.estimatedTotalPrice || qty * price, item.notes || ''
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

// PUT update PR status (approve/reject)
router.put('/requests/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const existing = db.prepare('SELECT id FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Purchase request not found' })
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
      UPDATE purchase_requests SET status = ?, approved_by = ?, approved_date = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(status, updates.approved_by || null, updates.approved_date || null, now, req.params.id, tenantId)

    const request = db.prepare('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
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
    const { supplierId, expectedDate } = req.body
    
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
    const taxRate = 7
    const taxAmount = subtotal * (taxRate / 100)
    const totalAmount = subtotal + taxAmount

    const transaction = db.transaction(() => {
      // Create PO
      db.prepare(`
        INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, order_date, expected_date,
          subtotal, tax_rate, tax_amount, total_amount, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(poId, tenantId, poNumber, supplierId, now, expectedDate || null,
        subtotal, taxRate, taxAmount, totalAmount, `Created from PR: ${pr.pr_number}`, now, now)

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
      LEFT JOIN suppliers s ON gr.supplier_id = s.id
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

    const items = db.prepare(`
      SELECT
        poi.id, poi.purchase_order_id, poi.material_id,
        poi.description, poi.quantity, poi.unit_price, poi.total_price,
        poi.received_qty,
        (poi.quantity - poi.received_qty) AS pending_qty,
        si.name  AS material_name,
        si.sku   AS material_code,
        COALESCE(si.base_unit, si.unit) AS unit
      FROM purchase_order_items poi
      LEFT JOIN stock_items si ON poi.material_id = si.id
      LEFT JOIN purchase_orders po ON poi.purchase_order_id = po.id
      WHERE poi.purchase_order_id = ?
        AND po.tenant_id = ?
        AND poi.quantity > poi.received_qty
    `).all(req.params.poId, tenantId)

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
        po.po_number
      FROM goods_receipts gr
      LEFT JOIN suppliers s ON gr.supplier_id = s.id
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
    const { purchaseOrderId, receiptDate, receivedBy, notes, items, deliveryNoteNo } = req.body
    console.log('[GR DEBUG] body:', { purchaseOrderId, receiptDate, receivedBy, deliveryNoteNo, notes, itemCount: items?.length })
    
    if (!purchaseOrderId) {
      console.log('[GR DEBUG] 400: missing purchaseOrderId')
      return res.status(400).json({ success: false, message: 'Purchase order is required' })
    }

    // Get PO details
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(purchaseOrderId, tenantId) as any
    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' })
    }

    // Block if PO already fully received
    if (po.status === 'RECEIVED') {
      return res.status(400).json({ success: false, message: 'ใบสั่งซื้อนี้รับสินค้าครบแล้ว' })
    }

    // Block if there is already a DRAFT GR waiting to be confirmed for this PO
    const existingDraft = db.prepare(
      "SELECT id, gr_number FROM goods_receipts WHERE purchase_order_id = ? AND tenant_id = ? AND status = 'DRAFT'"
    ).get(purchaseOrderId, tenantId) as any
    if (existingDraft) {
      return res.status(400).json({
        success: false,
        message: `มีใบรับสินค้าร่าง ${existingDraft.gr_number} รออยู่ — กรุณายืนยันหรือลบก่อนสร้างใหม่`,
      })
    }

    const id = generateId()
    const grNumber = generateNumber('GR', tenantId, 'goods_receipts')
    const now = new Date().toISOString()

    const transaction = db.transaction(() => {
      // Create GR
      db.prepare(`
        INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, receipt_date,
          received_by, status, notes, delivery_note_no, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)
      `).run(id, tenantId, grNumber, purchaseOrderId, po.supplier_id, receiptDate || now,
        receivedBy || req.user!.email, notes || '', deliveryNoteNo || null, now, now)

      // Create GR items
      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO goods_receipt_items (id, tenant_id, goods_receipt_id, purchase_order_item_id, material_id,
            ordered_qty, received_qty, accepted_qty, rejected_qty, lot_number, location, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          insertItem.run(
            generateId(), tenantId, id, item.poItemId, item.materialId || null,
            item.orderedQty, item.receivedQty, item.acceptedQty || item.receivedQty,
            item.rejectedQty || 0, item.lotNumber || null, item.location || null, item.notes || ''
          )
        }
      }
    })

    transaction()

    const receipt = db.prepare('SELECT * FROM goods_receipts WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    const receiptItems = db.prepare('SELECT * FROM goods_receipt_items WHERE goods_receipt_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...receipt, items: receiptItems } })
  } catch (error) {
    console.error('Create goods receipt error:', error)
    res.status(500).json({ success: false, message: 'Failed to create goods receipt' })
  }
})

// DELETE GR (DRAFT only)
router.delete('/goods-receipts/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const gr = db.prepare('SELECT * FROM goods_receipts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!gr) return res.status(404).json({ success: false, message: 'Not found' })
    if (gr.status !== 'DRAFT') return res.status(400).json({ success: false, message: 'ลบได้เฉพาะ GR ที่ยังเป็นร่างเท่านั้น' })
    db.transaction(() => {
      db.prepare('DELETE FROM goods_receipt_items WHERE goods_receipt_id = ? AND tenant_id = ?').run(req.params.id, tenantId)
      db.prepare('DELETE FROM goods_receipts WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)
    })()
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete goods receipt' })
  }
})

// PUT confirm goods receipt (update stock)
router.put('/goods-receipts/:id/confirm', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const gr = db.prepare('SELECT * FROM goods_receipts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!gr) {
      return res.status(404).json({ success: false, message: 'Goods receipt not found' })
    }

    if (gr.status === 'CONFIRMED') {
      return res.status(400).json({ success: false, message: 'Goods receipt already confirmed' })
    }

    const items = db.prepare('SELECT * FROM goods_receipt_items WHERE goods_receipt_id = ?').all(req.params.id) as any[]
    const now = new Date().toISOString()

    const transaction = db.transaction(() => {
      // Update GR status
      db.prepare("UPDATE goods_receipts SET status = 'CONFIRMED', updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(now, req.params.id, tenantId)

      // Update stock and PO received qty
      for (const item of items) {
        if (item.material_id && item.accepted_qty > 0) {
          // Get PO item details (unit + unit_price)
          let poItem: any
          try {
            poItem = db.prepare('SELECT unit_price, unit FROM purchase_order_items WHERE id = ?').get(item.purchase_order_item_id) as any
          } catch (e) {
            // Fallback if 'unit' column hasn't been migrated yet
            poItem = db.prepare('SELECT unit_price FROM purchase_order_items WHERE id = ?').get(item.purchase_order_item_id) as any
          }
          const unitPrice = poItem?.unit_price || 0
          const poUnit = normalizeUnit(poItem?.unit || '')

          // Find stock item: first by material_id (BOM flow), then directly by id (standalone stock flow)
          let stockItem = db.prepare('SELECT * FROM stock_items WHERE material_id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
          if (!stockItem) {
            stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
          }

          let stockQty = roundQty(Number(item.accepted_qty))
          let movementNotes = `Received from purchase`
          let addToSealed = false
          let appliedFactor = 1

          // stock_items.quantity is always stored in base_unit — targeting the legacy
          // `unit` column here silently applied the wrong conversion for the ~23 items
          // where `unit` != `base_unit`. Fall back to `unit` only when base_unit is empty.
          const stockUnit = normalizeUnit(stockItem?.base_unit || stockItem?.unit || '')
          const displayUnit = normalizeUnit(stockItem?.display_unit || '')

          // ถ้า PO unit ตรงกับ display_unit → เก็บเป็น sealed_qty (ยังไม่แกะ) แต่ต้องเช็คด้วยว่า
          // display_unit ต่างจาก base_unit จริง และแปลง display->base ได้จริง ไม่งั้นถ้า
          // display_unit == base_unit (เช่น ทั้งคู่เป็น bottle) ของจะไปค้างเป็น sealed_qty
          // ตลอดกาล เพราะ autoUnpackIfNeeded() มี guard เดียวกันนี้อยู่ (return null เมื่อ
          // display==base) ทำให้แกะไม่ได้ ขายไม่ได้ (ของหายเข้ากลีบเมฆ)
          const displayToBaseChain = (!!displayUnit && displayUnit !== stockUnit)
            ? findConversionChain(displayUnit, stockUnit, tenantId, item.material_id)
            : null
          const canUnpackDisplay = !!displayToBaseChain
          if (stockItem && poUnit && displayUnit && poUnit === displayUnit && canUnpackDisplay) {
            addToSealed = true
            movementNotes = `Received as sealed ${poUnit}: ${item.accepted_qty} ${poUnit} (ยังไม่แกะ)`
          } else if (stockItem && poUnit && poUnit !== stockUnit) {
            // Unit conversion: PO unit → Stock base unit
            const converted = convertQuantityBidirectional(Number(item.accepted_qty), poUnit, stockUnit, tenantId, item.material_id)
            if (!converted) {
              const materialName = (db.prepare('SELECT name FROM materials WHERE id = ?').get(item.material_id) as any)?.name
                || stockItem.name
                || item.material_id
              throw new Error(`ไม่พบการแปลงหน่วย ${poUnit} → ${stockUnit} สำหรับ "${materialName}" กรุณาตั้งค่า Unit Conversion ก่อน`)
            }
            stockQty = roundQty(converted.converted)
            appliedFactor = converted.factor
            movementNotes = `Received from purchase (converted: ${item.accepted_qty} ${poUnit} → ${stockQty} ${stockUnit}, factor: ${converted.factor})`
          }

          if (stockItem) {
            if (addToSealed) {
              // Sealed path stores qty in display_unit (unopened pack), but unit_cost is
              // ALWAYS per base_unit regardless of what unit the stock quantity happens to
              // be parked in right now — so still divide by the poUnit(=displayUnit)→base
              // factor here, not the raw pack price.
              const sealedCostFactor = displayToBaseChain?.factor ?? 1
              const sealedUnitCost = unitPrice
                ? priceToBaseUnitCost(unitPrice, sealedCostFactor, `sealed ${poUnit}→${stockUnit} (material ${item.material_id})`)
                : stockItem.unit_cost
              db.prepare('UPDATE stock_items SET sealed_qty = COALESCE(sealed_qty, 0) + ?, unit_cost = ?, purchase_price = COALESCE(?, purchase_price), purchase_unit = COALESCE(?, purchase_unit), unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ? AND tenant_id = ?')
                .run(roundPackQty(Number(item.accepted_qty), `GR ${gr.gr_number} sealed ${poUnit}`), sealedUnitCost, unitPrice || null, unitPrice ? (poUnit || null) : null, now, stockItem.id, tenantId)
            } else {
              // Update quantity + unit_cost (latest purchase price, converted to price-per-
              // base-unit using the same factor that converted the quantity above — see
              // priceToBaseUnitCost() comment for why this division is required).
              const newUnitCost = unitPrice
                ? priceToBaseUnitCost(unitPrice, appliedFactor, `${poUnit || stockUnit}→${stockUnit} (material ${item.material_id})`)
                : stockItem.unit_cost
              db.prepare('UPDATE stock_items SET quantity = quantity + ?, unit_cost = ?, purchase_price = COALESCE(?, purchase_price), purchase_unit = COALESCE(?, purchase_unit), unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ? AND tenant_id = ?')
                .run(stockQty, newUnitCost, unitPrice || null, unitPrice ? (poUnit || stockUnit || null) : null, now, stockItem.id, tenantId)
            }
          } else {
            // Create new stock item (BOM material not yet in stock). materials has only a
            // single `unit` column (no base/display split), so that becomes this row's
            // base_unit too — write both `unit` and `base_unit` the same to keep them in
            // sync from creation (see "เลิกใช้ unit legacy" task).
            const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(item.material_id) as any
            if (material) {
              const newStockId = generateId()
              const newItemUnit = normalizeUnit(material.unit || 'pcs')
              // unit_cost must be price per base unit (newItemUnit), same rule as the
              // update-existing-item branch above.
              // NOTE: stockQty above was computed against `stockUnit` derived from the
              // (nonexistent, since stockItem is null here) existing stock item, so it is
              // NOT converted from poUnit to newItemUnit — that is a separate, pre-existing
              // gap outside this fix's scope (unit_cost only per task boundaries); flagged
              // in the report. Deliberately not touched here.
              let newItemCostFactor = 1
              if (poUnit && newItemUnit && poUnit !== newItemUnit) {
                const conv = convertQuantityBidirectional(1, poUnit, newItemUnit, tenantId, item.material_id)
                if (conv && conv.factor > 0) {
                  newItemCostFactor = conv.factor
                } else {
                  console.warn(`[unit_cost] no conversion ${poUnit}→${newItemUnit} for new stock item (material ${item.material_id}); storing price un-converted`)
                }
              }
              const newUnitCost = priceToBaseUnitCost(unitPrice, newItemCostFactor, `new stock item ${poUnit}→${newItemUnit} (material ${item.material_id})`)
              db.prepare(`
                INSERT INTO stock_items (id, tenant_id, sku, name, category, material_id, quantity, unit, base_unit, unit_cost, location, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'STOCK', 'ACTIVE', ?, ?)
              `).run(newStockId, tenantId, material.code, material.name, 'RAW_MATERIAL', item.material_id,
                stockQty, newItemUnit, newItemUnit, newUnitCost, now, now)
              stockItem = { id: newStockId }
            }
          }

          if (stockItem) {
            // Record stock movement
            db.prepare(`
              INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
              VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, ?)
            `).run(generateId(), tenantId, stockItem.id, addToSealed ? roundPackQty(Number(item.accepted_qty)) : stockQty, `GR: ${gr.gr_number}`,
              movementNotes, now, req.user!.userId)

            // Persist exactly what hit stock. Cancellation reads these back instead of
            // re-running the conversion, so editing or deleting a unit-conversion rule
            // after receipt can no longer make the reversal subtract a different amount.
            try {
              db.prepare(`UPDATE goods_receipt_items
                SET stock_item_id = ?, stock_qty = ?, stock_sealed_qty = ?, stock_factor = ?
                WHERE id = ?`).run(
                stockItem.id,
                addToSealed ? 0 : stockQty,
                addToSealed ? roundPackQty(Number(item.accepted_qty)) : 0,
                appliedFactor,
                item.id
              )
            } catch (e) {
              console.error('⚠️ could not record GR stock snapshot (migration pending?):', e)
            }
          }

        }

        // Update PO item received qty (in PO unit) — independent of material_id so free-text lines still count as received
        if (item.accepted_qty > 0) {
          db.prepare('UPDATE purchase_order_items SET received_qty = received_qty + ? WHERE id = ? AND tenant_id = ?')
            .run(item.accepted_qty, item.purchase_order_item_id, tenantId)
        }
      }

      // Check if PO fully received
      const poItems = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(gr.purchase_order_id) as any[]
      const allReceived = poItems.every((item: any) => item.received_qty >= item.quantity)
      
      if (allReceived) {
        db.prepare("UPDATE purchase_orders SET status = 'RECEIVED', received_date = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(now, now, gr.purchase_order_id, tenantId)
      } else {
        db.prepare("UPDATE purchase_orders SET status = 'PARTIAL', updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(now, gr.purchase_order_id, tenantId)
      }
    })

    transaction()

    const receipt = db.prepare('SELECT * FROM goods_receipts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: receipt, message: 'Goods receipt confirmed and stock updated' })
  } catch (error: any) {
    console.error('Confirm goods receipt error:', error)
    const message = error?.message || 'Failed to confirm goods receipt'
    // Validation errors (missing unit conversion) should return 400, not 500
    if (message.includes('ไม่พบการแปลงหน่วย') || message.includes('Unit Conversion')) {
      return res.status(400).json({ success: false, message })
    }
    res.status(500).json({ success: false, message })
  }
})

// PUT cancel goods receipt (reverse stock if it had been CONFIRMED)
router.put('/goods-receipts/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body

    if (status !== 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'This endpoint only supports cancelling a goods receipt' })
    }
    if (!['ADMIN', 'MANAGER', 'MASTER', 'POWERUSER'].includes(req.user!.role)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ยกเลิกใบรับสินค้า — ต้องเป็น ADMIN/MANAGER/MASTER/POWERUSER' })
    }

    const gr = db.prepare('SELECT * FROM goods_receipts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!gr) {
      return res.status(404).json({ success: false, message: 'Goods receipt not found' })
    }
    if (gr.status === 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'Goods receipt already cancelled' })
    }

    // Block if an active purchase invoice already references this GR — its AP
    // journal would then refer to stock that no longer exists.
    const linkedInvoice = db.prepare(`
      SELECT id, pi_number FROM purchase_invoices
      WHERE tenant_id = ? AND status != 'CANCELLED'
        AND (goods_receipt_id = ? OR goods_receipt_ids LIKE ?)
    `).get(tenantId, gr.id, `%${gr.id}%`) as any
    if (linkedInvoice) {
      return res.status(400).json({
        success: false,
        message: `ไม่สามารถยกเลิกใบรับสินค้าได้ — มีใบแจ้งหนี้ ${linkedInvoice.pi_number} อ้างอิงอยู่ กรุณายกเลิกใบแจ้งหนี้ก่อน`,
      })
    }

    const now = new Date().toISOString()
    const wasConfirmed = gr.status === 'CONFIRMED'

    const transaction = db.transaction(() => {
      if (wasConfirmed) {
        reverseGoodsReceiptStock(tenantId, gr, req.user!.userId, now)
      }
      db.prepare("UPDATE goods_receipts SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(now, req.params.id, tenantId)
    })
    transaction()

    const updated = db.prepare('SELECT * FROM goods_receipts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({
      success: true,
      data: updated,
      message: wasConfirmed ? 'Goods receipt cancelled and stock reversed' : 'Goods receipt cancelled',
    })
  } catch (error: any) {
    console.error('Cancel goods receipt error:', error)
    res.status(500).json({ success: false, message: error?.message || 'Failed to cancel goods receipt' })
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
      LEFT JOIN suppliers s ON pi.supplier_id = s.id
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

// GET single purchase invoice
router.get('/invoices/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const invoice = db.prepare(`
      SELECT pi.*, s.name as supplier_name, s.code as supplier_code,
        po.po_number, gr.gr_number
      FROM purchase_invoices pi
      LEFT JOIN suppliers s ON pi.supplier_id = s.id
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
      SELECT * FROM supplier_payments WHERE purchase_invoice_id = ? ORDER BY payment_date DESC
    `).all(req.params.id)

    res.json({ success: true, data: { ...invoice, items, payments } })
  } catch (error) {
    console.error('Get purchase invoice error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch purchase invoice' })
  }
})

// POST create purchase invoice from GR
router.post('/invoices', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { purchaseOrderId, goodsReceiptId, goodsReceiptIds, supplierInvoiceNumber, invoiceDate, dueDate, notes, items, drAccountId, taxRate: reqTaxRate } = req.body
    // Support both multi-select (goodsReceiptIds array) and legacy single (goodsReceiptId)
    const grIds: string[] = Array.isArray(goodsReceiptIds) && goodsReceiptIds.length > 0
      ? goodsReceiptIds
      : (goodsReceiptId ? [goodsReceiptId] : [])
    const grIdsJson = JSON.stringify(grIds)
    
    if (!purchaseOrderId) {
      return res.status(400).json({ success: false, message: 'Purchase order is required' })
    }

    // Get PO and Supplier
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(purchaseOrderId, tenantId) as any
    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' })
    }
    const supplier = db.prepare('SELECT name, tax_id FROM suppliers WHERE id = ? AND tenant_id = ?').get(po.supplier_id, tenantId) as any

    // A goods receipt (or a no-GR whole-PO invoice) must not be pulled into a second
    // invoice — previously unenforced, so the same PO/GR could be invoiced twice.
    if (grIds.length > 0) {
      const placeholders = grIds.map(() => '?').join(',')
      const grRows = db.prepare(
        `SELECT id, status, invoiced_at, purchase_order_id FROM goods_receipts WHERE tenant_id = ? AND id IN (${placeholders})`
      ).all(tenantId, ...grIds) as any[]
      for (const grId of grIds) {
        const row = grRows.find((r: any) => r.id === grId)
        if (!row || row.purchase_order_id !== purchaseOrderId) {
          return res.status(400).json({ success: false, message: 'ใบรับสินค้าที่เลือกไม่ตรงกับใบสั่งซื้อนี้' })
        }
        if (row.status !== 'CONFIRMED') {
          return res.status(400).json({ success: false, message: 'ใบรับสินค้าต้องยืนยันแล้วก่อนสร้างใบแจ้งหนี้' })
        }
        if (row.invoiced_at) {
          return res.status(400).json({ success: false, message: 'ใบรับสินค้านี้ถูกใช้สร้างใบแจ้งหนี้ไปแล้ว กรุณาเลือกใบอื่นหรือยกเลิกใบแจ้งหนี้เดิมก่อน' })
        }
      }
    } else {
      const existingInvoice = db.prepare(
        `SELECT id FROM purchase_invoices WHERE tenant_id = ? AND purchase_order_id = ? AND status != 'CANCELLED' AND (goods_receipt_ids IS NULL OR goods_receipt_ids = '[]')`
      ).get(tenantId, purchaseOrderId) as any
      if (existingInvoice) {
        return res.status(400).json({ success: false, message: 'ใบสั่งซื้อนี้มีใบแจ้งหนี้อยู่แล้ว' })
      }
    }

    const id = generateId()
    const piNumber = generateNumber('PI', tenantId, 'purchase_invoices')
    const now = new Date().toISOString()

    // Calculate totals from items or use PO totals
    let subtotal = 0
    if (items && items.length > 0) {
      subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0)
    } else {
      subtotal = po.subtotal
    }
    
    const taxRate = reqTaxRate != null ? Number(reqTaxRate) : (po.tax_rate ?? 7)
    const taxAmount = subtotal * (taxRate / 100)
    const totalAmount = subtotal + taxAmount

    // Resolve accounts before transaction (auto-create if not yet in chart of accounts)
    // drAccountId: optional override — if supplied, use it; otherwise default to 1107 สต็อกวัตถุดิบ
    const resolvedDrAccId = drAccountId
      ? (db.prepare('SELECT id FROM accounts WHERE id = ? AND tenant_id = ?').get(drAccountId, tenantId) as any)?.id ?? null
      : null
    const inventoryAccId = resolvedDrAccId
      ?? getOrCreateAccount(tenantId, ACC.RAW_MATERIAL, ACC_META[ACC.RAW_MATERIAL]!.name, ACC_META[ACC.RAW_MATERIAL]!.type, ACC_META[ACC.RAW_MATERIAL]!.category, ACC_META[ACC.RAW_MATERIAL]!.normalBalance)
    const payableAccId   = getOrCreateAccount(tenantId, ACC.AP, ACC_META[ACC.AP]!.name, ACC_META[ACC.AP]!.type, ACC_META[ACC.AP]!.category, ACC_META[ACC.AP]!.normalBalance)
    const vatAccId       = taxAmount > 0 ? getOrCreateAccount(tenantId, ACC.INPUT_VAT, ACC_META[ACC.INPUT_VAT]!.name, ACC_META[ACC.INPUT_VAT]!.type, ACC_META[ACC.INPUT_VAT]!.category, ACC_META[ACC.INPUT_VAT]!.normalBalance) : null
    const journalId      = generateId()
    const journalNumber  = generateEntryNumber(tenantId, invoiceDate || now)

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO purchase_invoices (id, tenant_id, pi_number, supplier_invoice_number, purchase_order_id,
          supplier_id, goods_receipt_id, goods_receipt_ids, invoice_date, due_date, subtotal, tax_rate, tax_amount, total_amount,
          balance_amount, status, payment_status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', 'UNPAID', ?, ?, ?)
      `).run(id, tenantId, piNumber, supplierInvoiceNumber || '', purchaseOrderId, po.supplier_id,
        grIds[0] || null, grIdsJson, invoiceDate || now, dueDate || null, subtotal, taxRate, taxAmount,
        totalAmount, totalAmount, notes || '', now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO purchase_invoice_items (id, tenant_id, purchase_invoice_id, purchase_order_item_id,
            material_id, quantity, unit_price, total_price)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          const total = item.quantity * item.unitPrice
          insertItem.run(generateId(), tenantId, id, item.poItemId, item.materialId || null,
            item.quantity, item.unitPrice, total)
        }
      }

      // Lock the goods receipts this invoice draws on so they can't be pulled into another one
      if (grIds.length > 0) {
        const markInvoiced = db.prepare('UPDATE goods_receipts SET invoiced_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        for (const grId of grIds) markInvoiced.run(now, now, grId, tenantId)
      }

      // === POST JOURNAL ENTRY ===
      // Dr สต็อกวัตถุดิบ (1107)   + Dr ภาษีซื้อ (1110) if VAT
      // Cr เจ้าหนี้การค้า (2101)
      db.prepare(`
        INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id,
          description, total_debit, total_credit, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'PURCHASE_INVOICE', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(journalId, tenantId, journalNumber, (invoiceDate || now).substring(0, 10),
        id, `รับใบแจ้งหนี้ซื้อ ${piNumber}`, totalAmount, totalAmount, notes || null,
        req.user!.email, now, now)

      const insertLine = db.prepare(`
        INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      let lineNo = 1
      const drAccLabel = resolvedDrAccId
        ? (db.prepare('SELECT name FROM accounts WHERE id = ?').get(resolvedDrAccId) as any)?.name ?? 'ค่าใช้จ่าย'
        : 'สต็อกวัตถุดิบ'
      insertLine.run(generateId(), tenantId, journalId, inventoryAccId, lineNo++, `${drAccLabel} - ${piNumber}`, subtotal, 0)
      if (vatAccId && taxAmount > 0) {
        insertLine.run(generateId(), tenantId, journalId, vatAccId, lineNo++, `ภาษีซื้อ - ${piNumber}`, taxAmount, 0)
      }
      insertLine.run(generateId(), tenantId, journalId, payableAccId, lineNo++, `เจ้าหนี้การค้า - ${piNumber}`, 0, totalAmount)

      // VAT Entry (Input VAT)
      if (taxAmount > 0) {
        db.prepare(`
          INSERT INTO vat_entries (id, tenant_id, document_type, document_id, document_number, document_date, party_name, party_tax_id, base_amount, vat_rate, vat_amount, total_amount, is_input_vat, is_output_vat, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
        `).run(generateId(), tenantId, 'PURCHASE_INVOICE', id, piNumber, (invoiceDate || now).substring(0, 10),
          supplier?.name || '', supplier?.tax_id || null,
          subtotal, taxRate, taxAmount, totalAmount, now)
      }
    })

    transaction()

    const invoice = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    const invoiceItems = db.prepare('SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...invoice, items: invoiceItems } })
  } catch (error) {
    console.error('Create purchase invoice error:', error)
    res.status(500).json({ success: false, message: 'Failed to create purchase invoice' })
  }
})

// PUT cancel purchase invoice (reverse its AP journal + reported input VAT)
function reverseSupplierPayment(tenantId: string, payment: any, actorEmail: string, date: string) {
  reverseJournalEntryForReference(
    tenantId, 'SUPPLIER_PAYMENT', 'SUPPLIER_PAYMENT_CANCEL', payment.id,
    `กลับรายการจ่ายชำระ ${payment.payment_number}`, actorEmail, date
  )
  if (payment.purchase_invoice_id) {
    const pi = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(payment.purchase_invoice_id, tenantId) as any
    if (pi) {
      const newPaid = Math.max(0, (pi.paid_amount || 0) - payment.amount)
      const newBalance = pi.total_amount - newPaid
      const paymentStatus = newPaid <= 0 ? 'UNPAID' : 'PARTIAL'
      db.prepare('UPDATE purchase_invoices SET paid_amount = ?, balance_amount = ?, payment_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(newPaid, newBalance, paymentStatus, new Date().toISOString(), pi.id, tenantId)
    }
  }
  db.prepare('DELETE FROM supplier_payments WHERE id = ? AND tenant_id = ?').run(payment.id, tenantId)
}

// DELETE /payments/:id — reverse (void) a supplier payment: reverses its journal
// and restores the linked purchase invoice's paid/balance/payment_status.
router.delete('/payments/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!['ADMIN', 'MANAGER', 'MASTER', 'POWERUSER'].includes(req.user!.role)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ยกเลิกการจ่ายเงิน — ต้องเป็น ADMIN/MANAGER/MASTER/POWERUSER' })
    }
    const payment = db.prepare('SELECT * FROM supplier_payments WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' })
    const today = new Date().toISOString().substring(0, 10)
    db.transaction(() => { reverseSupplierPayment(tenantId, payment, req.user!.email, today) })()
    res.json({ success: true, message: 'Supplier payment reversed' })
  } catch (error: any) {
    console.error('Reverse supplier payment error:', error)
    res.status(500).json({ success: false, message: error?.message || 'Failed to reverse payment' })
  }
})

router.put('/invoices/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body

    if (status !== 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'This endpoint only supports cancelling a purchase invoice' })
    }
    if (!['ADMIN', 'MANAGER', 'MASTER', 'POWERUSER'].includes(req.user!.role)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ยกเลิกใบแจ้งหนี้ซื้อ — ต้องเป็น ADMIN/MANAGER/MASTER/POWERUSER' })
    }

    const pi = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!pi) {
      return res.status(404).json({ success: false, message: 'Purchase invoice not found' })
    }
    if (pi.status === 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'Purchase invoice already cancelled' })
    }
    const now = new Date().toISOString()
    const today = now.substring(0, 10)

    const transaction = db.transaction(() => {
      // Reverse any supplier payments applied to this PI first (end-to-end cancel)
      const pays = db.prepare('SELECT * FROM supplier_payments WHERE purchase_invoice_id = ? AND tenant_id = ?').all(pi.id, tenantId) as any[]
      for (const pay of pays) reverseSupplierPayment(tenantId, pay, req.user!.email, today)

      const reversalJournalId = reverseJournalEntryForReference(
        tenantId, 'PURCHASE_INVOICE', 'PURCHASE_INVOICE_CANCEL', pi.id,
        `ยกเลิกใบแจ้งหนี้ซื้อ ${pi.pi_number}`, req.user!.email, today
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
        .run(now, req.params.id, tenantId)

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

    const updated = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: updated, message: 'Purchase invoice cancelled and journal reversed' })
  } catch (error: any) {
    console.error('Cancel purchase invoice error:', error)
    res.status(500).json({ success: false, message: error?.message || 'Failed to cancel purchase invoice' })
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
        pi.pi_number
      FROM supplier_payments sp
      LEFT JOIN suppliers s ON sp.supplier_id = s.id
      LEFT JOIN purchase_invoices pi ON sp.purchase_invoice_id = pi.id
      WHERE sp.tenant_id = ?
      ORDER BY sp.payment_date DESC
    `).all(tenantId)

    res.json({ success: true, data: payments })
  } catch (error) {
    console.error('Get supplier payments error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch supplier payments' })
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
      LEFT JOIN suppliers s ON sp.supplier_id = s.id
      LEFT JOIN purchase_invoices pi ON sp.purchase_invoice_id = pi.id
      WHERE sp.id = ? AND sp.tenant_id = ?
    `).get(req.params.id, tenantId)
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' })
    res.json({ success: true, data: payment })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch payment' })
  }
})

// POST create supplier payment
router.post('/payments', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { supplierId, purchaseInvoiceId, paymentDate, paymentMethod, paymentReference, amount, withholdingTax, notes, bankAccountId } = req.body
    
    if (!supplierId || !amount) {
      return res.status(400).json({ success: false, message: 'Supplier and amount are required' })
    }

    // Check invoice if provided
    let invoice: any = null
    if (purchaseInvoiceId) {
      invoice = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(purchaseInvoiceId, tenantId)
      if (!invoice) {
        return res.status(404).json({ success: false, message: 'Purchase invoice not found' })
      }
      if (amount > invoice.balance_amount) {
        return res.status(400).json({ success: false, message: 'Payment amount exceeds invoice balance' })
      }
    }

    const id = generateId()
    const paymentNumber = generateNumber('SP', tenantId, 'supplier_payments')
    const now = new Date().toISOString()
    const wht = withholdingTax || 0
    const netAmount = amount - wht

    // Resolve accounts before transaction
    const payableAccId = getOrCreateAccount(tenantId, ACC.AP, ACC_META[ACC.AP]!.name, ACC_META[ACC.AP]!.type, ACC_META[ACC.AP]!.category, ACC_META[ACC.AP]!.normalBalance)
    // Dr/Cr the specific bank account's linked GL sub-account when one was selected;
    // otherwise fall back to CASH for cash payments, BANK for everything else
    // (was previously always CASH regardless of paymentMethod).
    const linkedAccountId = resolveBankAccountGL(tenantId, bankAccountId)
    const cashAccId = linkedAccountId || getOrCreateAccount(
      tenantId,
      (paymentMethod || 'TRANSFER') === 'CASH' ? ACC.CASH : ACC.BANK,
      (paymentMethod || 'TRANSFER') === 'CASH' ? ACC_META[ACC.CASH]!.name : ACC_META[ACC.BANK]!.name,
      (paymentMethod || 'TRANSFER') === 'CASH' ? ACC_META[ACC.CASH]!.type : ACC_META[ACC.BANK]!.type,
      (paymentMethod || 'TRANSFER') === 'CASH' ? ACC_META[ACC.CASH]!.category : ACC_META[ACC.BANK]!.category,
      (paymentMethod || 'TRANSFER') === 'CASH' ? ACC_META[ACC.CASH]!.normalBalance : ACC_META[ACC.BANK]!.normalBalance
    )
    const whtAccId     = wht > 0 ? getOrCreateAccount(tenantId, ACC.WHT_PAYABLE, ACC_META[ACC.WHT_PAYABLE]!.name, ACC_META[ACC.WHT_PAYABLE]!.type, ACC_META[ACC.WHT_PAYABLE]!.category, ACC_META[ACC.WHT_PAYABLE]!.normalBalance) : null
    const journalId    = generateId()
    const journalNumber = generateEntryNumber(tenantId, paymentDate || now)

    const transaction = db.transaction(() => {
      // Create payment
      db.prepare(`
        INSERT INTO supplier_payments (id, tenant_id, payment_number, supplier_id, purchase_invoice_id,
          payment_date, payment_method, payment_reference, amount, withholding_tax, net_amount, notes, bank_account_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tenantId, paymentNumber, supplierId, purchaseInvoiceId || null, paymentDate || now,
        paymentMethod || 'TRANSFER', paymentReference || '', amount, wht, netAmount, notes || '', bankAccountId || null, now, now)

      // Update invoice if provided
      if (invoice) {
        const newPaid = invoice.paid_amount + amount
        const newBalance = invoice.total_amount - newPaid
        let paymentStatus = 'PARTIAL'
        if (newBalance <= 0) paymentStatus = 'PAID'

        db.prepare(`
          UPDATE purchase_invoices SET paid_amount = ?, balance_amount = ?, payment_status = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ?
        `).run(newPaid, newBalance, paymentStatus, now, purchaseInvoiceId, tenantId)
      }

      // === POST JOURNAL ENTRY ===
      // Dr เจ้าหนี้การค้า (2101)
      // Cr เงินสด/ธนาคาร (1101)   + Cr ภาษีหัก ณ ที่จ่าย (2180) if WHT > 0
      db.prepare(`
        INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id,
          description, total_debit, total_credit, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'SUPPLIER_PAYMENT', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(journalId, tenantId, journalNumber, (paymentDate || now).substring(0, 10),
        id, `จ่ายชำระ ${paymentNumber}`, amount, amount, notes || null,
        req.user!.email, now, now)

      const insertLine = db.prepare(`
        INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      let lineNo = 1
      insertLine.run(generateId(), tenantId, journalId, payableAccId, lineNo++, `เจ้าหนี้การค้า - ${paymentNumber}`, amount, 0)
      insertLine.run(generateId(), tenantId, journalId, cashAccId, lineNo++, `จ่ายเงิน - ${paymentNumber}`, 0, netAmount)
      if (whtAccId && wht > 0) {
        insertLine.run(generateId(), tenantId, journalId, whtAccId, lineNo++, `ภาษีหัก ณ ที่จ่าย - ${paymentNumber}`, 0, wht)
      }
    })

    transaction()

    const payment = db.prepare('SELECT * FROM supplier_payments WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    res.status(201).json({ success: true, data: payment, message: 'Payment recorded successfully' })
  } catch (error) {
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
      LEFT JOIN suppliers s ON pr.supplier_id = s.id
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
      LEFT JOIN suppliers s ON pr.supplier_id = s.id
      LEFT JOIN purchase_orders po ON pr.purchase_order_id = po.id
      WHERE pr.id = ? AND pr.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!ret) {
      return res.status(404).json({ success: false, message: 'Purchase return not found' })
    }

    const items = db.prepare(`
      SELECT pri.*, m.name as material_name, m.code as material_code
      FROM purchase_return_items pri
      LEFT JOIN materials m ON pri.material_id = m.id
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
    const { purchaseOrderId, goodsReceiptId, reason, notes, items } = req.body
    
    if (!purchaseOrderId || !reason) {
      return res.status(400).json({ success: false, message: 'Purchase order and reason are required' })
    }

    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(purchaseOrderId, tenantId) as any
    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' })
    }

    const id = generateId()
    const prNumber = generateNumber('PRT', tenantId, 'purchase_returns')
    const now = new Date().toISOString()

    // Calculate totals
    let subtotal = 0
    if (items && items.length > 0) {
      subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0)
    }
    const taxRate = 7
    const taxAmount = subtotal * (taxRate / 100)
    const totalAmount = subtotal + taxAmount

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO purchase_returns (id, tenant_id, pr_number, purchase_order_id, goods_receipt_id, 
          supplier_id, return_date, reason, subtotal, tax_rate, tax_amount, total_amount, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
      `).run(id, tenantId, prNumber, purchaseOrderId, goodsReceiptId || null, po.supplier_id,
        now, reason, subtotal, taxRate, taxAmount, totalAmount, notes || '', now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO purchase_return_items (id, tenant_id, purchase_return_id, goods_receipt_item_id, 
            material_id, quantity, unit_price, reason, total_price)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          const total = item.quantity * item.unitPrice
          insertItem.run(generateId(), tenantId, id, item.grItemId || null, item.materialId || null,
            item.quantity, item.unitPrice, item.reason || '', total)
        }
      }
    })

    transaction()

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
    const ret = db.prepare('SELECT * FROM purchase_returns WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!ret) return res.status(404).json({ success: false, message: 'Not found' })
    if (ret.status !== 'DRAFT') return res.status(400).json({ success: false, message: 'ลบได้เฉพาะใบคืนสินค้าที่ยังเป็นร่างเท่านั้น' })
    db.transaction(() => {
      db.prepare('DELETE FROM purchase_return_items WHERE purchase_return_id = ? AND tenant_id = ?').run(req.params.id, tenantId)
      db.prepare('DELETE FROM purchase_returns WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)
    })()
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete purchase return' })
  }
})

router.put('/returns/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const allowed = ['SUBMITTED', 'APPROVED', 'CANCELLED']
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }
    const ret = db.prepare('SELECT * FROM purchase_returns WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!ret) return res.status(404).json({ success: false, message: 'Not found' })
    if (ret.status === 'CONFIRMED') return res.status(400).json({ success: false, message: 'Already confirmed' })

    db.prepare('UPDATE purchase_returns SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run(status, new Date().toISOString(), req.params.id, tenantId)

    res.json({ success: true, data: { id: req.params.id, status } })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update return status' })
  }
})

// PUT confirm return (deduct stock) — requires APPROVED status
router.put('/returns/:id/confirm', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
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

    // === Accounting: mirror of the PURCHASE_INVOICE posting, debits/credits swapped ===
    // Amounts come straight off purchase_returns (subtotal / tax_amount / total_amount are
    // stored at create time), so nothing is inferred or recomputed here.
    const retSubtotal = Number(ret.subtotal) || 0
    const retTax      = Number(ret.tax_amount) || 0
    const retTotal    = Number(ret.total_amount) || (retSubtotal + retTax)
    // Double-post guard: status !== 'CONFIRMED' already blocks a replay, but check the
    // ledger too so a manually re-opened return can't post the same journal twice.
    const alreadyPosted = hasReversalJournal(tenantId, 'PURCHASE_RETURN', ret.id)
    const postJournal   = retTotal > 0 && !alreadyPosted
    const inventoryAccId = getOrCreateAccount(tenantId, ACC.RAW_MATERIAL, ACC_META[ACC.RAW_MATERIAL]!.name, ACC_META[ACC.RAW_MATERIAL]!.type, ACC_META[ACC.RAW_MATERIAL]!.category, ACC_META[ACC.RAW_MATERIAL]!.normalBalance)
    const payableAccId   = getOrCreateAccount(tenantId, ACC.AP, ACC_META[ACC.AP]!.name, ACC_META[ACC.AP]!.type, ACC_META[ACC.AP]!.category, ACC_META[ACC.AP]!.normalBalance)
    const vatAccId       = retTax > 0 ? getOrCreateAccount(tenantId, ACC.INPUT_VAT, ACC_META[ACC.INPUT_VAT]!.name, ACC_META[ACC.INPUT_VAT]!.type, ACC_META[ACC.INPUT_VAT]!.category, ACC_META[ACC.INPUT_VAT]!.normalBalance) : null
    const journalId      = generateId()
    const journalNumber  = generateEntryNumber(tenantId, ret.return_date || now)
    const supplier = db.prepare('SELECT name, tax_id FROM suppliers WHERE id = ? AND tenant_id = ?').get(ret.supplier_id, tenantId) as any

    const transaction = db.transaction(() => {
      // Update return status
      db.prepare("UPDATE purchase_returns SET status = 'CONFIRMED', updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(now, req.params.id, tenantId)

      // Deduct stock
      for (const item of items) {
        if (item.material_id && item.quantity > 0) {
          // item.material_id is a stock_items.id (see the migration note on the
          // purchase_return_items FK rebuild) — fall back to the legacy
          // stock_items.material_id lookup too, same dual-lookup pattern as
          // reverseGoodsReceiptStock() above, in case any pre-fix rows stored a
          // real materials.id instead.
          let stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
          if (!stockItem) {
            stockItem = db.prepare('SELECT * FROM stock_items WHERE material_id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
          }
          
          if (stockItem) {
            db.prepare('UPDATE stock_items SET quantity = quantity - ?, unit = COALESCE(base_unit, unit), updated_at = ? WHERE id = ? AND tenant_id = ?')
              .run(roundQty(Number(item.quantity)), now, stockItem.id, tenantId)

            // Record stock movement
            db.prepare(`
              INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
              VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, ?)
            `).run(generateId(), tenantId, stockItem.id, roundQty(Number(item.quantity)), `PRT: ${ret.pr_number}`, 
              `Returned to supplier: ${ret.reason}`, now, req.user!.userId)
          }
        }
      }

      // === POST JOURNAL ENTRY ===
      // Dr เจ้าหนี้การค้า (2101)  = มูลค่าคืนรวม VAT   (หนี้ที่ต้องจ่ายซัพพลายเออร์ลดลง)
      // Cr สต็อกวัตถุดิบ (1107)   = มูลค่าคืนก่อน VAT
      // Cr ภาษีซื้อ (1110)        = VAT ที่คืน
      if (postJournal) {
        const entryDate = (ret.return_date || now).substring(0, 10)
        db.prepare(`
          INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id,
            description, total_debit, total_credit, is_auto_generated, is_posted, notes, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'PURCHASE_RETURN', ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)
        `).run(journalId, tenantId, journalNumber, entryDate, ret.id,
          `คืนสินค้าผู้ขาย ${ret.pr_number}`, retTotal, retTotal, ret.notes || null,
          req.user!.email, now, now)

        const insertLine = db.prepare(`
          INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        let lineNo = 1
        insertLine.run(generateId(), tenantId, journalId, payableAccId, lineNo++, `เจ้าหนี้การค้า - ${ret.pr_number}`, retTotal, 0)
        updateAccountBalance(tenantId, payableAccId, retTotal, 0)
        if (retSubtotal > 0) {
          insertLine.run(generateId(), tenantId, journalId, inventoryAccId, lineNo++, `สต็อกวัตถุดิบ - ${ret.pr_number}`, 0, retSubtotal)
          updateAccountBalance(tenantId, inventoryAccId, 0, retSubtotal)
        }
        if (vatAccId && retTax > 0) {
          insertLine.run(generateId(), tenantId, journalId, vatAccId, lineNo++, `ภาษีซื้อ - ${ret.pr_number}`, 0, retTax)
          updateAccountBalance(tenantId, vatAccId, 0, retTax)

          // Negative input-VAT entry so the VAT report doesn't keep claiming tax on
          // goods that went back to the supplier (same shape as the PI-cancel reversal).
          db.prepare(`
            INSERT INTO vat_entries (id, tenant_id, document_type, document_id, document_number, document_date,
              party_name, party_tax_id, base_amount, vat_rate, vat_amount, total_amount, is_input_vat, is_output_vat, journal_entry_id, created_at)
            VALUES (?, ?, 'PURCHASE_RETURN', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
          `).run(generateId(), tenantId, ret.id, ret.pr_number, entryDate,
            supplier?.name || '', supplier?.tax_id || null,
            -retSubtotal, Number(ret.tax_rate) || 0, -retTax, -retTotal, journalId, now)
        }
      }
    })

    transaction()

    const updated = db.prepare('SELECT * FROM purchase_returns WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: updated, message: 'Purchase return confirmed and stock deducted' })
  } catch (error) {
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
      WHERE tenant_id = ?
    `).get(tenantId) as any

    // Return Stats
    const returnStats = db.prepare(`
      SELECT COUNT(*) as total_returns, COALESCE(SUM(total_amount), 0) as total_return_amount
      FROM purchase_returns
      WHERE tenant_id = ? AND status = 'CONFIRMED'
    `).get(tenantId) as any

    res.json({
      success: true,
      data: {
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
