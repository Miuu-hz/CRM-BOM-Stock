import db from '../../db/sqlite'
import { generateId, formatDocumentNumber } from '../../utils/id'
import { isValidImageFile, isAllowedImageExt, isAllowedImageMimetype, getSafeImageExtension, sanitizeFilename } from '../../utils/upload'
import multer from 'multer'
import { convertQuantityBidirectional, autoUnpackIfNeeded } from '../../services/unitConversion.service'
import { ACC, ACC_META } from '../../config/accountCodes'
import path from 'path'
import fs from 'fs'

// ─── Invoice Attachments Setup ────────────────────────────────────────────────
export const invoiceUploadDir = path.join(__dirname, '..', '..', 'uploads', 'invoice-attachments')
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

export function getOrCreateAccount(tenantId: string, code: string, name: string, type: string, category: string, normalBalance: string): string {
  const existing = db.prepare('SELECT id FROM accounts WHERE tenant_id = ? AND code = ?').get(tenantId, code) as any
  if (existing) return existing.id
  const id = generateId()
  db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, is_active, is_system, level)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0)`).run(id, tenantId, code, name, type, category, normalBalance)
  return id
}

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
  paymentMethod?: string, sourceNumber?: string, soNumber?: string
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
            SELECT soi.quantity, soi.unit as so_unit, si.unit_cost, si.unit as stock_unit, si.id as stock_item_id
            FROM sales_order_items soi
            JOIN stock_items si ON soi.stock_item_id = si.id
            WHERE soi.sales_order_id = ?
          `).all(invoice.sales_order_id) as any[]
          for (const it of soItems) {
            let qty = Number(it.quantity || 0)
            const soUnit = it.so_unit || ''
            const stockUnit = it.stock_unit || ''
            // Convert SO quantity to stock unit if different for accurate COGS
            if (soUnit && stockUnit && soUnit !== stockUnit) {
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
      // DR เงินสด/ธนาคาร / CR ลูกหนี้การค้า
      const cashAccId = (paymentMethod === 'TRANSFER' || paymentMethod === 'CHEQUE') ? bankId : cashId
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

  const deduct = db.transaction(() => {
    for (const item of items) {
      const stockItemId = item.stock_item_id
      if (!stockItemId) continue
      let qty = Number(item.quantity || 0)
      if (qty <= 0) continue

      // Re-read stock inside the transaction so the deduction is atomic
      const stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
      if (!stockItem) continue

      const soUnit = item.unit || ''
      const stockUnit = stockItem.unit || ''
      if (soUnit && stockUnit && soUnit !== stockUnit) {
        const converted = convertQuantityBidirectional(qty, soUnit, stockUnit, tenantId, stockItemId)
        if (converted) {
          qty = converted.converted
        }
      }

      const deductQty = Math.floor(qty)
      if (stockItem.quantity < deductQty) {
        throw new Error(`Insufficient stock for ${stockItem.name || stockItemId}: need ${deductQty} ${stockUnit}, have ${stockItem.quantity}`)
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

export { isValidImageFile, sanitizeFilename }
