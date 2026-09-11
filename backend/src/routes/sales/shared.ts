import db from '../../db/sqlite'
import { generateId, formatDocumentNumber } from '../../utils/id'
import { isValidImageFile, isAllowedImageExt, isAllowedImageMimetype, getSafeImageExtension, sanitizeFilename } from '../../utils/upload'
import multer from 'multer'
import { convertQuantityBidirectional, autoUnpackIfNeeded, normalizeUnit } from '../../services/unitConversion.service'
import { roundQty } from '../../utils/qty'
import { ACC, ACC_META, resolveBankAccountGL } from '../../config/accountCodes'
import path from 'path'
import fs from 'fs'

// ─── Invoice Attachments Setup ────────────────────────────────────────────────
export const invoiceUploadDir = path.join(__dirname, '..', '..', '..', 'storage', 'payment-attachments')
if (!fs.existsSync(invoiceUploadDir)) fs.mkdirSync(invoiceUploadDir, { recursive: true })

const invoiceStorage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => cb(null, invoiceUploadDir),
  filename: (req: any, _file: any, cb: any) => {
    const ext = getSafeImageExtension(_file.originalname) || '.jpg'
    cb(null, `inv-${req.params.id}-${Date.now()}${ext}`)
  },
})

export const invoiceUpload = multer({
  storage: invoiceStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req: any, file: any, cb: any) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (isAllowedImageExt(ext) && isAllowedImageMimetype(file.mimetype)) cb(null, true)
    else cb(new Error('Only image files allowed'))
  },
})

// Create invoice_attachments table if not exists
db.prepare(`CREATE TABLE IF NOT EXISTS invoice_attachments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_size INTEGER,
  created_at TEXT NOT NULL
)`).run()

// ─── Accounting helpers ────────────────────────────────────────────────────────

// ตัวจริงอยู่ที่ services/accounting.service — re-export ไว้เพราะ sales/index.ts
// กับ sales/creditNotes.ts import ผ่าน './shared' อยู่เดิม
import { getOrCreateAccount } from '../../services/accounting.service'
import { isServiceItem } from '../../services/stockItem.service'
export { getOrCreateAccount }

export function updateAccountBalance(tenantId: string, accountId: string, debit: number, credit: number) {
  const now = new Date()
  const yr = now.getFullYear()
  const mo = now.getMonth() + 1
  const existing = db.prepare('SELECT id, debit_amount, credit_amount FROM account_balances WHERE tenant_id = ? AND account_id = ? AND fiscal_year = ? AND period = ?').get(tenantId, accountId, yr, mo) as any
  if (existing) {
    const newDebit = (existing.debit_amount || 0) + debit
    const newCredit = (existing.credit_amount || 0) + credit
    db.prepare('UPDATE account_balances SET debit_amount = ?, credit_amount = ?, ending_balance = ? WHERE id = ? AND tenant_id = ?')
      .run(newDebit, newCredit, newDebit - newCredit, existing.id, tenantId)
  } else {
    db.prepare(`INSERT INTO account_balances (id, tenant_id, account_id, fiscal_year, period, beginning_balance, debit_amount, credit_amount, ending_balance)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`).run(generateId(), tenantId, accountId, yr, mo, debit, credit, debit - credit)
  }
}

export function createSalesJournal(
  tenantId: string, referenceType: string, referenceId: string,
  description: string, totalAmount: number, taxAmount: number,
  paymentMethod?: string, sourceNumber?: string, soNumber?: string, bankAccountId?: string | null
) {
  try {
    const now = new Date().toISOString()
    const dateStr = now.split('T')[0]
    const yr = new Date().getFullYear()
    const jvNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', yr, 5)

    // Accounts — using standardized codes from ACC constants
    const arMeta = ACC_META[ACC.AR]!
    const revMeta = ACC_META[ACC.REVENUE_PRODUCT]!
    const vatMeta = ACC_META[ACC.OUTPUT_VAT]!
    const cashMeta = ACC_META[ACC.CASH]!
    const bankMeta = ACC_META[ACC.BANK]!
    const invMeta = ACC_META[ACC.INVENTORY]!
    const cogsMeta = ACC_META[ACC.COGS_PRODUCT]!

    const arId   = getOrCreateAccount(tenantId, ACC.AR, arMeta.name, arMeta.type, arMeta.category, arMeta.normalBalance)
    const revId  = getOrCreateAccount(tenantId, ACC.REVENUE_PRODUCT, revMeta.name, revMeta.type, revMeta.category, revMeta.normalBalance)
    const vatId  = getOrCreateAccount(tenantId, ACC.OUTPUT_VAT, vatMeta.name, vatMeta.type, vatMeta.category, vatMeta.normalBalance)
    const cashId = getOrCreateAccount(tenantId, ACC.CASH, cashMeta.name, cashMeta.type, cashMeta.category, cashMeta.normalBalance)
    const bankId = getOrCreateAccount(tenantId, ACC.BANK, bankMeta.name, bankMeta.type, bankMeta.category, bankMeta.normalBalance)
    const invId  = getOrCreateAccount(tenantId, ACC.INVENTORY, invMeta.name, invMeta.type, invMeta.category, invMeta.normalBalance)
    const cogsId = getOrCreateAccount(tenantId, ACC.COGS_PRODUCT, cogsMeta.name, cogsMeta.type, cogsMeta.category, cogsMeta.normalBalance)

    const entryId = generateId()
    const netRevenue = totalAmount - taxAmount

    if (referenceType === 'INVOICE') {
      // Calculate COGS from invoice items → sales_order_items → stock_items.unit_cost
      let totalCOGS = 0
      try {
        const invoice = db.prepare('SELECT sales_order_id FROM invoices WHERE id = ? AND tenant_id = ?').get(referenceId, tenantId) as any
        if (invoice?.sales_order_id) {
          const soItems = db.prepare(`
            SELECT soi.quantity, soi.unit as so_unit, si.unit_cost, si.unit as stock_unit,
                   si.base_unit as stock_base_unit, si.id as stock_item_id
            FROM sales_order_items soi
            JOIN stock_items si ON soi.stock_item_id = si.id
            WHERE soi.sales_order_id = ?
          `).all(invoice.sales_order_id) as any[]
          for (const it of soItems) {
            let qty = Number(it.quantity || 0)
            const soUnit = it.so_unit || ''
            // stock_items.quantity is always stored in base_unit (the one true unit) —
            // `unit` is the legacy pre-unit-system column, only used as a fallback for
            // old rows where base_unit hasn't been backfilled. Using `unit` here silently
            // priced/matched COGS against the wrong unit for the 23/456 items where
            // unit != base_unit (e.g. shrimp: unit=kg, base_unit=g).
            const stockUnit = it.stock_base_unit || it.stock_unit || ''
            // Convert SO quantity to stock's base unit if different for accurate COGS.
            // Compare via normalizeUnit so equivalent spellings ('กก.' vs 'kg') aren't
            // treated as different units.
            if (soUnit && stockUnit && normalizeUnit(soUnit) !== normalizeUnit(stockUnit)) {
              const converted = convertQuantityBidirectional(qty, soUnit, stockUnit, tenantId, it.stock_item_id)
              if (converted) qty = converted.converted
            }
            totalCOGS += (qty * (it.unit_cost || 0))
          }
        }
      } catch (cogsErr) {
        console.error('⚠️ COGS calculation error:', cogsErr)
      }

      const grandTotal = totalAmount + totalCOGS

      // DR ลูกหนี้การค้า + DR ต้นทุนขาย / CR รายได้ขาย + CR ภาษีขาย + CR สต็อกสินค้า
      db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, source_number, so_number, description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at, business_unit)
        VALUES (?, ?, ?, ?, 'INVOICE', ?, ?, ?, ?, ?, ?, 1, 1, 'system', ?, ?, 'WHOLESALE')`)
        .run(entryId, tenantId, jvNumber, dateStr, referenceId, sourceNumber || null, soNumber || null, description, grandTotal, grandTotal, now, now)

      let lineNum = 1
      db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
        .run(generateId(), tenantId, entryId, arId, lineNum++, description, totalAmount)
      if (totalCOGS > 0) {
        db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
          .run(generateId(), tenantId, entryId, cogsId, lineNum++, `ต้นทุนขาย - ${sourceNumber || ''}`, totalCOGS)
        db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
          .run(generateId(), tenantId, entryId, invId, lineNum++, `ลดสต็อก - ${sourceNumber || ''}`, totalCOGS)
      }
      db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
        .run(generateId(), tenantId, entryId, revId, lineNum++, description, netRevenue)
      if (taxAmount > 0) {
        db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
          .run(generateId(), tenantId, entryId, vatId, lineNum++, 'ภาษีขาย', taxAmount)
      }

      updateAccountBalance(tenantId, arId, totalAmount, 0)
      if (totalCOGS > 0) {
        updateAccountBalance(tenantId, cogsId, totalCOGS, 0)
        updateAccountBalance(tenantId, invId, 0, totalCOGS)
      }
      updateAccountBalance(tenantId, revId, 0, netRevenue)
      if (taxAmount > 0) updateAccountBalance(tenantId, vatId, 0, taxAmount)

    } else if (referenceType === 'RECEIPT') {
      // DR เงินสด/ธนาคาร (บัญชีย่อยที่ผูกไว้ถ้าเลือกบัญชีธนาคาร) / CR ลูกหนี้การค้า
      const linkedAccountId = resolveBankAccountGL(tenantId, bankAccountId)
      // Allowlist: only CASH posts to the cash account. Everything else (TRANSFER,
      // CHEQUE, CREDIT_CARD, QR_CODE, and any future method) posts to bank, matching
      // the purchase side (purchase.routes.ts) and avoiding new methods silently
      // falling through to cash.
      const cashAccId = linkedAccountId || (paymentMethod === 'CASH' ? cashId : bankId)
      db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, source_number, so_number, description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at, business_unit)
        VALUES (?, ?, ?, ?, 'PAYMENT', ?, ?, ?, ?, ?, ?, 1, 1, 'system', ?, ?, 'WHOLESALE')`)
        .run(entryId, tenantId, jvNumber, dateStr, referenceId, sourceNumber || null, soNumber || null, description, totalAmount, totalAmount, now, now)

      let lineNum = 1
      db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
        .run(generateId(), tenantId, entryId, cashAccId, lineNum++, description, totalAmount)
      db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
        .run(generateId(), tenantId, entryId, arId, lineNum++, description, totalAmount)

      updateAccountBalance(tenantId, cashAccId, totalAmount, 0)
      updateAccountBalance(tenantId, arId, 0, totalAmount)
    }
  } catch (err) {
    console.error('⚠️ createSalesJournal error:', err)
    // Non-fatal — don't throw
  }
}

export function deductStockForSO(tenantId: string, soId: string, soNumber: string) {
  const items = db.prepare('SELECT * FROM sales_order_items WHERE sales_order_id = ?').all(soId) as any[]

  // When enabled, confirming an SO is allowed to push stock negative instead of
  // throwing "Insufficient stock" and blocking confirmation.
  const setting = db.prepare('SELECT allow_negative_stock FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
  const allowNegativeStock = !!setting && setting.allow_negative_stock === 1

  const deduct = db.transaction(() => {
    for (const item of items) {
      const stockItemId = item.stock_item_id
      if (!stockItemId) continue
      let qty = Number(item.quantity || 0)
      if (qty <= 0) continue

      // Re-read stock inside the transaction so the deduction is atomic
      const stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
      if (!stockItem) continue
      if (isServiceItem(stockItem)) continue   // ค่าขนส่ง/ค่าแพ็ค ไม่มีของให้ตัด

      const soUnit = item.unit || ''
      // stock_items.quantity is always stored in base_unit — `unit` is the legacy
      // column copied over during the base/sale/display migration and can differ
      // from base_unit (23/456 items today, e.g. shrimp: unit=kg, base_unit=g).
      // Deducting against `unit` silently deducted the wrong amount (5kg sold only
      // took 5g off stock). Fall back to `unit` only when base_unit is empty.
      const stockUnit = stockItem.base_unit || stockItem.unit || ''
      if (soUnit && stockUnit && normalizeUnit(soUnit) !== normalizeUnit(stockUnit)) {
        const converted = convertQuantityBidirectional(qty, soUnit, stockUnit, tenantId, stockItemId)
        if (!converted) {
          // Never deduct the raw SO-unit number: for g -> kg that would take 500 kg
          // off stock for a 500 g line.
          throw new Error(`ไม่พบการแปลงหน่วย ${soUnit} → ${stockUnit} สำหรับ "${stockItem.name || stockItemId}" กรุณาตั้งค่า Unit Conversion ก่อน`)
        }
        qty = converted.converted
      }

      const deductQty = roundQty(qty)

      // Open sealed packs on demand, the way delivery orders and production
      // already do. Without this, confirming an order failed with "insufficient
      // stock" while full unopened packs sat in the warehouse.
      let availableQty = stockItem.quantity
      if (availableQty < deductQty && (stockItem.sealed_qty ?? 0) > 0) {
        const unpack = autoUnpackIfNeeded(stockItem, deductQty, tenantId)
        if (unpack && unpack.unpackedPacks > 0) {
          const released = roundQty(unpack.unpackedPacks * unpack.packFactor)
          db.prepare('UPDATE stock_items SET quantity = ?, sealed_qty = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
            .run(unpack.quantity, unpack.sealed_qty, new Date().toISOString(), stockItemId, tenantId)
          // movement_unit/movement_quantity = หน่วย/จำนวนแพ็คที่ user มองเห็น ให้ตรงกับ
          // แกะแพ็คด้วยมือ (stock.routes.ts POST /:id/unpack) เพื่อ reconcile รายงานได้
          db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
            VALUES (?, ?, ?, 'UNPACK', ?, ?, ?, ?, ?, ?, 'system')`).run(
            generateId(), tenantId, stockItemId, released, stockItem.display_unit || null, unpack.unpackedPacks, `SO: ${soNumber}`,
            `แกะอัตโนมัติ ${unpack.unpackedPacks} ${stockItem.display_unit || ''} → +${released} ${stockUnit}`,
            new Date().toISOString())
          availableQty = unpack.quantity
        }
      }

      if (availableQty < deductQty && !allowNegativeStock) {
        // Say why the packs could not help, so the fix (set the pack rate) is
        // obvious instead of looking like a plain shortage.
        const sealed = stockItem.sealed_qty ?? 0
        const sealedNote = sealed > 0
          ? ` — มีในแพ็คอีก ${sealed} ${stockItem.display_unit || ''} แต่แกะไม่ได้ ยังไม่ได้ตั้งอัตราแปลงหน่วย ${stockItem.display_unit || ''} → ${stockUnit}`
          : ''
        throw new Error(`Insufficient stock for ${stockItem.name || stockItemId}: need ${deductQty} ${stockUnit}, have ${availableQty}${sealedNote}`)
      }

      db.prepare('UPDATE stock_items SET quantity = quantity - ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(deductQty, new Date().toISOString(), stockItemId, tenantId)
      db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
        VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, 'system')`).run(
        generateId(), tenantId, stockItemId, deductQty, `SO: ${soNumber}`, `ขายสินค้า SO ${soNumber}${soUnit !== stockUnit ? ` (แปลง: ${item.quantity} ${soUnit} → ${deductQty} ${stockUnit})` : ''}`, new Date().toISOString())
    }
  })

  deduct()
}

export function restoreStockForSO(tenantId: string, soId: string, soNumber: string) {
  const items = db.prepare('SELECT * FROM sales_order_items WHERE sales_order_id = ?').all(soId) as any[]

  const restore = db.transaction(() => {
    for (const item of items) {
      const stockItemId = item.stock_item_id
      if (!stockItemId) continue
      let qty = Number(item.quantity || 0)
      if (qty <= 0) continue

      // Re-read stock inside the transaction so the restoration is atomic
      const stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
      if (!stockItem) continue
      if (isServiceItem(stockItem)) continue   // ค่าขนส่ง/ค่าแพ็ค ไม่มีของให้ตัด

      const soUnit = item.unit || ''
      // Must mirror deductStockForSO's target-unit choice exactly (base_unit first,
      // `unit` fallback) — otherwise a confirm-then-cancel round trip restores stock
      // in a different unit than it was deducted in and the quantity doesn't match.
      const stockUnit = stockItem.base_unit || stockItem.unit || ''
      if (soUnit && stockUnit && normalizeUnit(soUnit) !== normalizeUnit(stockUnit)) {
        const converted = convertQuantityBidirectional(qty, soUnit, stockUnit, tenantId, stockItemId)
        if (!converted) {
          throw new Error(`ไม่พบการแปลงหน่วย ${soUnit} → ${stockUnit} สำหรับ "${stockItem.name || stockItemId}" จึงคืนสต็อกไม่ได้ กรุณาตั้งค่า Unit Conversion กลับคืนก่อน`)
        }
        qty = converted.converted
      }

      // Mirror deductStockForSO's rounding so the restored quantity exactly
      // matches what was originally deducted for this line.
      const restoreQty = roundQty(qty)
      if (restoreQty <= 0) continue

      db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(restoreQty, new Date().toISOString(), stockItemId, tenantId)
      db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
        VALUES (?, ?, ?, 'RETURN', ?, ?, ?, ?, 'system')`).run(
        generateId(), tenantId, stockItemId, restoreQty, `SO: ${soNumber}`, `ยกเลิก SO ${soNumber} - คืนสต็อก${soUnit !== stockUnit ? ` (แปลง: ${item.quantity} ${soUnit} \u2192 ${restoreQty} ${stockUnit})` : ''}`, new Date().toISOString())
    }
  })

  restore()
}

// Reverses the sales journal originally posted by createSalesJournal() for an
// INVOICE (Dr AR/COGS, Cr Revenue/VAT/Inventory) by inserting a mirror-image
// journal entry with every line's debit/credit swapped, and applying the same
// swap to account_balances so the net effect nets to zero.
//
// Idempotent: if no original 'INVOICE' journal exists (invoice was never
// posted, e.g. cancelled while still DRAFT) this is a no-op. If a reversal
// (reference_type = 'INVOICE_CANCEL') already exists for this invoice, this
// is also a no-op — guards against double-reversal on repeated cancel calls.
export function reverseSalesJournal(tenantId: string, invoiceId: string, invoiceNumber: string, soNumber?: string): boolean {
  try {
    const original = db.prepare(
      "SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = 'INVOICE' AND reference_id = ?"
    ).get(tenantId, invoiceId) as any
    if (!original) return false // nothing was ever posted for this invoice — nothing to reverse

    const alreadyReversed = db.prepare(
      "SELECT id FROM journal_entries WHERE tenant_id = ? AND reference_type = 'INVOICE_CANCEL' AND reference_id = ?"
    ).get(tenantId, invoiceId)
    if (alreadyReversed) return false // already reversed — guard against double reversal

    const originalLines = db.prepare('SELECT * FROM journal_lines WHERE journal_entry_id = ? AND tenant_id = ?').all(original.id, tenantId) as any[]
    if (originalLines.length === 0) return false

    const now = new Date().toISOString()
    const dateStr = now.split('T')[0]
    const yr = new Date().getFullYear()
    const jvNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', yr, 5)
    const entryId = generateId()

    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, source_number, so_number, description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at, business_unit)
        VALUES (?, ?, ?, ?, 'INVOICE_CANCEL', ?, ?, ?, ?, ?, ?, 1, 1, 'system', ?, ?, ?)`)
        .run(entryId, tenantId, jvNumber, dateStr, invoiceId, original.source_number || invoiceNumber || null, original.so_number || soNumber || null,
          `กลับรายการ (ยกเลิกใบแจ้งหนี้) - ${invoiceNumber}`, original.total_credit, original.total_debit, now, now, original.business_unit || 'WHOLESALE')

      for (const line of originalLines) {
        db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(generateId(), tenantId, entryId, line.account_id, line.line_number, `กลับรายการ: ${line.description || ''}`, line.credit || 0, line.debit || 0)

        // Swap debit/credit when re-applying to running balances so the
        // original posting's effect is fully netted out.
        updateAccountBalance(tenantId, line.account_id, line.credit || 0, line.debit || 0)
      }
    })
    tx()
    return true
  } catch (err) {
    console.error('\u26a0\ufe0f reverseSalesJournal error:', err)
    return false
  }
}

// Generic reversal for any sales-side journal (e.g. RECEIPT). Mirrors
// reverseSalesJournal but parameterised on the reference_type so it can back
// out receipt (customer payment) postings too. Idempotent; updates account_balances.
export function reverseSalesJournalByRef(tenantId: string, originalRefType: string, cancelRefType: string, refId: string, description: string): boolean {
  try {
    const original = db.prepare(
      "SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = ? AND reference_id = ?"
    ).get(tenantId, originalRefType, refId) as any
    if (!original) return false
    const alreadyReversed = db.prepare(
      "SELECT id FROM journal_entries WHERE tenant_id = ? AND reference_type = ? AND reference_id = ?"
    ).get(tenantId, cancelRefType, refId)
    if (alreadyReversed) return false
    const originalLines = db.prepare('SELECT * FROM journal_lines WHERE journal_entry_id = ? AND tenant_id = ?').all(original.id, tenantId) as any[]
    if (originalLines.length === 0) return false

    const now = new Date().toISOString()
    const dateStr = now.split('T')[0]
    const yr = new Date().getFullYear()
    const jvNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', yr, 5)
    const entryId = generateId()

    db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, source_number, so_number, description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at, business_unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'system', ?, ?, ?)`)
      .run(entryId, tenantId, jvNumber, dateStr, cancelRefType, refId, original.source_number || null, original.so_number || null,
        description, original.total_credit, original.total_debit, now, now, original.business_unit || 'WHOLESALE')

    for (const line of originalLines) {
      db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(generateId(), tenantId, entryId, line.account_id, line.line_number, `กลับรายการ: ${line.description || ''}`, line.credit || 0, line.debit || 0)
      updateAccountBalance(tenantId, line.account_id, line.credit || 0, line.debit || 0)
    }
    return true
  } catch (err) {
    console.error('reverseSalesJournalByRef error:', err)
    return false
  }
}

// Voids a receipt (customer payment): reverses its RECEIPT journal, restores the
// invoice paid/balance/status and the SO payment_status, then deletes the receipt.
// Caller must wrap in a db.transaction.
export function voidReceipt(tenantId: string, receipt: any): void {
  reverseSalesJournalByRef(tenantId, 'PAYMENT', 'PAYMENT_CANCEL', receipt.id, `กลับรายการรับชำระ ${receipt.receipt_number}`)
  const now = new Date().toISOString()
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(receipt.invoice_id, tenantId) as any
  if (invoice) {
    const newPaid = Math.max(0, (invoice.paid_amount || 0) - receipt.amount)
    const newBalance = invoice.total_amount - newPaid
    const paymentStatus = newPaid <= 0 ? 'UNPAID' : 'PARTIAL'
    const newStatus = invoice.status === 'CANCELLED' ? 'CANCELLED' : (newPaid <= 0 ? 'ISSUED' : 'PARTIAL')
    db.prepare('UPDATE invoices SET paid_amount = ?, balance_amount = ?, payment_status = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run(newPaid, newBalance, paymentStatus, newStatus, now, invoice.id, tenantId)
    if (invoice.sales_order_id) {
      db.prepare("UPDATE sales_orders SET payment_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(paymentStatus, now, invoice.sales_order_id, tenantId)
    }
  }
  db.prepare('DELETE FROM receipts WHERE id = ? AND tenant_id = ?').run(receipt.id, tenantId)
}

export { isValidImageFile, sanitizeFilename }
