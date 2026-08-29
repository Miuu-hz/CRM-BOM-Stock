import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { generateId, formatDocumentNumber } from '../../utils/id'
import { ACC, ACC_META } from '../../config/accountCodes'
import { getOrCreateAccount, updateAccountBalance } from './shared'
import { convertQuantityBidirectional, normalizeUnit } from '../../services/unitConversion.service'
import { roundQty } from '../../utils/qty'

const router = Router()

// ─── Accounting: post reversing GL journal entry when a credit note is ISSUED ──
// Dr Revenue (reduce revenue) + Dr VAT-output (reduce output VAT liability)
// Cr Accounts Receivable (reduce AR) — mirrors createSalesJournal's INVOICE
// posting in shared.ts but in reverse. Idempotent: guarded by a lookup on
// (tenant_id, reference_type='CREDIT_NOTE', reference_id).
function postCreditNoteJournal(tenantId: string, cn: any) {
  try {
    const existing = db.prepare(
      "SELECT id FROM journal_entries WHERE tenant_id = ? AND reference_type = 'CREDIT_NOTE' AND reference_id = ?"
    ).get(tenantId, cn.id)
    if (existing) return // already posted — avoid double-posting

    const now = new Date().toISOString()
    const dateStr = now.split('T')[0]
    const yr = new Date().getFullYear()
    const jvNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', yr, 5)

    const arMeta = ACC_META[ACC.AR]!
    const revMeta = ACC_META[ACC.REVENUE_PRODUCT]!
    const vatMeta = ACC_META[ACC.OUTPUT_VAT]!

    const arId = getOrCreateAccount(tenantId, ACC.AR, arMeta.name, arMeta.type, arMeta.category, arMeta.normalBalance)
    const revId = getOrCreateAccount(tenantId, ACC.REVENUE_PRODUCT, revMeta.name, revMeta.type, revMeta.category, revMeta.normalBalance)
    const vatId = getOrCreateAccount(tenantId, ACC.OUTPUT_VAT, vatMeta.name, vatMeta.type, vatMeta.category, vatMeta.normalBalance)

    const subtotal = cn.subtotal || 0
    const taxAmount = cn.tax_amount || 0
    const totalAmount = cn.total_amount || 0
    const entryId = generateId()
    const description = `ลดหนี้ CN ${cn.cn_number}`

    db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, source_number, so_number, description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at, business_unit)
      VALUES (?, ?, ?, ?, 'CREDIT_NOTE', ?, ?, NULL, ?, ?, ?, 1, 1, 'system', ?, ?, 'WHOLESALE')`)
      .run(entryId, tenantId, jvNumber, dateStr, cn.id, cn.cn_number || null, description, totalAmount, totalAmount, now, now)

    let lineNum = 1
    // Dr Revenue — reduces previously recognized revenue
    db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
      .run(generateId(), tenantId, entryId, revId, lineNum++, description, subtotal)
    // Dr Output VAT — reduces VAT liability owed on the original sale
    if (taxAmount > 0) {
      db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
        .run(generateId(), tenantId, entryId, vatId, lineNum++, `ภาษีขาย - ${description}`, taxAmount)
    }
    // Cr Accounts Receivable — reduces amount owed by customer
    db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
      .run(generateId(), tenantId, entryId, arId, lineNum++, description, totalAmount)

    updateAccountBalance(tenantId, revId, subtotal, 0)
    if (taxAmount > 0) updateAccountBalance(tenantId, vatId, taxAmount, 0)
    updateAccountBalance(tenantId, arId, 0, totalAmount)
  } catch (err) {
    console.error('⚠️ postCreditNoteJournal error:', err)
    // Non-fatal — don't block the status update if journal posting fails
  }
}

// ─── Stock: restore inventory when a credit note (ISSUED) has actual return
// line items ─────────────────────────────────────────────────────────────
// credit_note_items only has rows when the caller supplies `items` (product_id +
// quantity) — today's create-credit-note modal in Sales.tsx never does, it only
// posts { invoiceId, reason, creditDate } (header only, no line items), so an
// ordinary discount/price-adjustment credit note naturally has zero items and
// this restores nothing — correct, since nothing physically came back.
// `reason` is free text with no fixed vocabulary (confirmed via schema: no
// type/kind column on credit_notes or credit_note_items), so there is no
// reliable way to parse "is this a return" out of it — restocking is gated on
// concrete item data instead, the same signal deliveryOrders.ts uses to decide
// stock must move, never on the free-text reason.
// Conceptually mirrors deliveryOrders.ts's DELIVERED stock-deduction / shared.ts's
// restoreStockForSO, but resolves the stock row via invoice_items.stock_item_id
// (not product_id — verified vestigial/always-NULL throughout this schema's real
// sales data) and the return unit via sales_order_items.unit (credit_note_items has
// no unit column), then converts to base_unit via convertQuantityBidirectional and
// records stock_movements exactly like those two. Idempotent: guarded by checking
// for a movement already tagged with this credit note's reference (re-issuing / a
// retried request restores nothing twice). Non-fatal like postCreditNoteJournal
// above — a stock-side problem (e.g. missing unit conversion rule) is logged, not
// allowed to block the credit note from being issued.
function restoreCreditNoteStock(tenantId: string, cn: any, userId: string, now: string) {
  try {
    const items = db.prepare('SELECT * FROM credit_note_items WHERE credit_note_id = ? AND tenant_id = ?').all(cn.id, tenantId) as any[]
    if (items.length === 0) return // nothing returned — pure price/billing adjustment, stock must not move

    const reference = `CN: ${cn.cn_number}`
    const already = db.prepare('SELECT 1 FROM stock_movements WHERE tenant_id = ? AND reference = ? LIMIT 1').get(tenantId, reference)
    if (already) return // already restored once — never double count on re-issue/retry

    // Wrapped in a transaction, same as shared.ts's restoreStockForSO — all lines of this
    // credit note restore atomically or not at all (a mid-loop unit-conversion throw must
    // not leave some stock rows already bumped while others aren't).
    const restore = db.transaction(() => {
      for (const item of items) {
        if (!(item.quantity > 0)) continue

        // credit_note_items.product_id doesn't reliably resolve a stock row in this
        // schema — product_id is vestigial throughout the real sales pipeline (verified:
        // invoice_items.product_id and sales_order_items.product_id are NULL on every real
        // row; stock_items.product_id is NULL on all 492 rows too). The link that's actually
        // populated is stock_item_id, so walk back through the invoice line this credit note
        // item was issued against to find the exact stock item — and sales_order_items.unit
        // for the unit that sale was recorded in, since credit_note_items has no unit column.
        const invItem = db.prepare('SELECT * FROM invoice_items WHERE id = ? AND tenant_id = ?').get(item.invoice_item_id, tenantId) as any
        let stockItem: any = null
        if (invItem?.stock_item_id) {
          stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(invItem.stock_item_id, tenantId)
        }
        if (!stockItem && item.product_id) {
          // Fallback for legacy/edge-case rows that do carry a real product_id link.
          stockItem = db.prepare('SELECT * FROM stock_items WHERE product_id = ? AND tenant_id = ?').get(item.product_id, tenantId)
        }
        if (!stockItem) continue

        let cnUnit = ''
        if (invItem?.sales_order_item_id) {
          const soItem = db.prepare('SELECT unit FROM sales_order_items WHERE id = ?').get(invItem.sales_order_item_id) as any
          cnUnit = soItem?.unit || ''
        }
        // stock_items.quantity is stored in base_unit, not the legacy `unit` column —
        // fall back to `unit` only when base_unit is empty (old rows), same as
        // deliveryOrders.ts / restoreStockForSO.
        const stockUnit = stockItem.base_unit || stockItem.unit || ''
        let addQty = Number(item.quantity)
        let movementNotes = `Returned by customer (CN ${cn.cn_number})`

        if (cnUnit && stockUnit && normalizeUnit(cnUnit) !== normalizeUnit(stockUnit)) {
          const converted = convertQuantityBidirectional(addQty, cnUnit, stockUnit, tenantId, stockItem.id)
          if (!converted) {
            throw new Error(`ไม่พบการแปลงหน่วย ${cnUnit} → ${stockUnit} สำหรับ "${stockItem.name}" กรุณาตั้งค่า Unit Conversion ก่อน`)
          }
          addQty = converted.converted
          movementNotes = `Returned by customer (converted: ${item.quantity} ${cnUnit} → ${converted.converted.toFixed(4)} ${stockUnit}, factor: ${converted.factor})`
        }

        const gained = roundQty(addQty)
        db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(gained, now, stockItem.id, tenantId)

        // type 'RETURN' matches shared.ts's restoreStockForSO — the established
        // convention in this codebase for "stock coming back because a sale is being
        // undone", as opposed to a fresh 'IN' (new stock received).
        db.prepare(`
          INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
          VALUES (?, ?, ?, 'RETURN', ?, ?, ?, ?, ?)
        `).run(generateId(), tenantId, stockItem.id, gained, reference, movementNotes, now, userId)
      }
    })
    restore()
  } catch (err) {
    console.error('⚠️ restoreCreditNoteStock error:', err)
    // Non-fatal — don't block the status update if stock restore fails
  }
}

// GET all credit notes
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const creditNotes = db.prepare(`
      SELECT cn.*, c.name as customer_name, c.code as customer_code,
        i.invoice_number
      FROM credit_notes cn
      LEFT JOIN customers c ON cn.customer_id = c.id
      LEFT JOIN invoices i ON cn.invoice_id = i.id
      WHERE cn.tenant_id = ?
      ORDER BY cn.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: creditNotes })
  } catch (error) {
    console.error('Get credit notes error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch credit notes' })
  }
})

// GET single credit note
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const creditNote = db.prepare(`
      SELECT cn.*, c.name as customer_name, c.code as customer_code,
        i.invoice_number
      FROM credit_notes cn
      LEFT JOIN customers c ON cn.customer_id = c.id
      LEFT JOIN invoices i ON cn.invoice_id = i.id
      WHERE cn.id = ? AND cn.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!creditNote) {
      return res.status(404).json({ success: false, message: 'Credit note not found' })
    }

    // product_id is nullable/unpopulated for real return rows (see migrations.ts's
    // credit_note_items rebuild note) — the item's actual product name/code lives on
    // the invoice line it was returned against (invoice_items.product_name, and
    // stock_items.sku via stock_item_id — invoice_items has no product_code column),
    // so join through invoice_items/stock_items instead of the disconnected products table.
    const items = db.prepare(`
      SELECT cni.*, ii.product_name as product_name, si.sku as product_code
      FROM credit_note_items cni
      LEFT JOIN invoice_items ii ON cni.invoice_item_id = ii.id
      LEFT JOIN stock_items si ON ii.stock_item_id = si.id
      WHERE cni.credit_note_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...creditNote, items } })
  } catch (error) {
    console.error('Get credit note error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch credit note' })
  }
})

// POST create credit note
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { invoiceId, customerId, reason, notes, items, taxRate } = req.body
    
    if (!invoiceId || !reason) {
      return res.status(400).json({ success: false, message: 'Invoice and reason are required' })
    }

    // ─── Validate return items don't exceed what was actually sold ────────────
    // "รับคืนสินค้า" mode sends items (invoiceItemId + quantity); "ลดราคา" mode sends
    // none. For each returned line, cap at (invoice_items.quantity − already credited
    // on this same invoice line across earlier non-CANCELLED credit notes) so a second
    // CN — or a retried request — can't return more than was ever sold.
    if (items && items.length > 0) {
      for (const item of items) {
        if (!item.invoiceItemId || !(item.quantity > 0)) {
          return res.status(400).json({ success: false, message: 'ข้อมูลรายการสินค้าที่คืนไม่ถูกต้อง' })
        }
        const invItem = db.prepare('SELECT * FROM invoice_items WHERE id = ? AND tenant_id = ? AND invoice_id = ?')
          .get(item.invoiceItemId, tenantId, invoiceId) as any
        if (!invItem) {
          return res.status(400).json({ success: false, message: 'ไม่พบรายการสินค้านี้ในใบแจ้งหนี้ที่เลือก' })
        }
        const alreadyCredited = db.prepare(`
          SELECT COALESCE(SUM(cni.quantity), 0) as qty
          FROM credit_note_items cni
          JOIN credit_notes cn ON cn.id = cni.credit_note_id
          WHERE cni.invoice_item_id = ? AND cni.tenant_id = ? AND cn.status != 'CANCELLED'
        `).get(item.invoiceItemId, tenantId) as any
        const remaining = Number(invItem.quantity) - Number(alreadyCredited?.qty || 0)
        if (item.quantity > remaining + 1e-9) {
          return res.status(400).json({
            success: false,
            message: `จำนวนที่คืน (${item.quantity}) เกินจำนวนที่ขายจริง — คืนได้อีกไม่เกิน ${remaining} หน่วย สำหรับ "${invItem.product_name || 'สินค้า'}"`,
          })
        }
      }
    }

    const id = generateId()
    const cnNumber = formatDocumentNumber('CN', tenantId, 'CREDIT_NOTE', new Date().getFullYear(), 5)
    const now = new Date().toISOString()

    // Calculate totals
    let subtotal = 0
    if (items && items.length > 0) {
      subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0)
    }
    const tax = taxRate || 7
    const taxAmount = subtotal * (tax / 100)
    const totalAmount = subtotal + taxAmount

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO credit_notes (id, tenant_id, cn_number, invoice_id, customer_id, credit_date, reason,
          subtotal, tax_rate, tax_amount, total_amount, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
      `).run(id, tenantId, cnNumber, invoiceId, customerId, now, reason,
        subtotal, tax, taxAmount, totalAmount, notes || '', now, now)

      if (items && items.length > 0) {
        // NOTE: credit_note_items has no `unit` column (verified via PRAGMA table_info —
        // never added by any migration); the previous INSERT below referenced one anyway,
        // which would throw "no such column: unit" the moment any caller ever sent items.
        // restoreCreditNoteStock() resolves the return unit from the original invoice/sales
        // order line instead (invoice_item_id → sales_order_items.unit), so nothing is lost.
        const insertItem = db.prepare(`
          INSERT INTO credit_note_items (id, tenant_id, credit_note_id, invoice_item_id, product_id, quantity, unit_price, reason, total_price)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          const total = item.quantity * item.unitPrice
          // product_id is nullable with no FK as of the migrations.ts rebuild — vestigial/
          // always-empty in this schema's real sales data (see restoreCreditNoteStock's note
          // above), so store NULL rather than a fabricated value. better-sqlite3 throws on an
          // undefined bind param (not on null), hence the ?? coercion.
          insertItem.run(generateId(), tenantId, id, item.invoiceItemId, item.productId ?? null,
            item.quantity, item.unitPrice, item.reason || '', total)
        }
      }

      // Update invoice balance if credit note issued
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(invoiceId, tenantId) as any
      if (invoice) {
        const newBalance = Math.max(0, invoice.balance_amount - totalAmount)
        db.prepare('UPDATE invoices SET balance_amount = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(newBalance, now, invoiceId, tenantId)
      }
    })

    transaction()

    const creditNote = db.prepare('SELECT * FROM credit_notes WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    const creditNoteItems = db.prepare('SELECT * FROM credit_note_items WHERE credit_note_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...creditNote, items: creditNoteItems } })
  } catch (error) {
    console.error('Create credit note error:', error)
    res.status(500).json({ success: false, message: 'Failed to create credit note' })
  }
})

// PUT update credit note status
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['DRAFT', 'ISSUED', 'APPLIED', 'CANCELLED']

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const cn = db.prepare('SELECT * FROM credit_notes WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!cn) {
      return res.status(404).json({ success: false, message: 'Credit note not found' })
    }

    const now = new Date().toISOString()
    db.prepare('UPDATE credit_notes SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run(status, now, req.params.id, tenantId)

    if (status === 'ISSUED') {
      const updated = db.prepare('SELECT * FROM credit_notes WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
      postCreditNoteJournal(tenantId, updated)
      restoreCreditNoteStock(tenantId, updated, req.user!.userId, now)
    }

    const creditNote = db.prepare('SELECT * FROM credit_notes WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: creditNote })
  } catch (error) {
    console.error('Update credit note status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update credit note status' })
  }
})

// DELETE credit note (DRAFT only)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const cn = db.prepare('SELECT * FROM credit_notes WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!cn) return res.status(404).json({ success: false, message: 'Credit note not found' })
    if (cn.status !== 'DRAFT') return res.status(400).json({ success: false, message: 'ลบได้เฉพาะใบลดหนี้สถานะ DRAFT เท่านั้น' })
    db.transaction(() => {
      db.prepare('DELETE FROM credit_note_items WHERE credit_note_id = ? AND tenant_id = ?').run(req.params.id, tenantId)
      db.prepare('DELETE FROM credit_notes WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)
      // Restore the invoice balance that was reduced when this credit note was created
      if (cn.invoice_id && cn.total_amount) {
        db.prepare('UPDATE invoices SET balance_amount = balance_amount + ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(cn.total_amount, new Date().toISOString(), cn.invoice_id, tenantId)
      }
    })()
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete credit note' })
  }
})

export default router
