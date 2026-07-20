import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
import { ACC } from '../config/accountCodes'

// Auto-posts the accounting entry for two business events that previously had
// no bookkeeping hook at all: a purchase order being marked RECEIVED, and a
// sales order being CONFIRMED. Mirrors the (dead, preview-only, never wired to
// any button) shape that already existed in journal.routes.ts's /auto/* routes,
// but actually persists the entry and is called from the real status-update flows.
//
// Idempotent by design: keyed on (tenant, referenceType, referenceId) so calling
// this twice for the same PO/SO (e.g. a retried request, or the one-off backfill
// script re-run) never double-posts.

interface JournalLineInput {
  accountId: string
  description: string
  debit: number
  credit: number
}

interface PostResult {
  skipped: boolean
  reason?: string
  entryId?: string
}

function getAccountId(tenantId: string, code: string): string | undefined {
  const row = db.prepare('SELECT id FROM accounts WHERE code = ? AND tenant_id = ?').get(code, tenantId) as { id: string } | undefined
  return row?.id
}

function alreadyPosted(tenantId: string, referenceType: string, referenceId: string): boolean {
  return !!db.prepare(
    'SELECT id FROM journal_entries WHERE tenant_id = ? AND reference_type = ? AND reference_id = ?'
  ).get(tenantId, referenceType, referenceId)
}

function insertEntry(
  tenantId: string,
  date: string,
  referenceType: string,
  referenceId: string,
  description: string,
  lines: JournalLineInput[],
  userName: string
): string {
  const id = generateId()
  const entryNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', new Date(date).getFullYear(), 5)
  const now = new Date().toISOString()
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0)
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0)

  const run = db.transaction(() => {
    db.prepare(`
      INSERT INTO journal_entries
      (id, tenant_id, entry_number, date, reference_type, reference_id, description,
       total_debit, total_credit, is_auto_generated, is_posted, posted_at, posted_by,
       is_closing_entry, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, 0, ?, ?, ?, ?)
    `).run(id, tenantId, entryNumber, date, referenceType, referenceId, description, totalDebit, totalCredit, now, userName, null, userName, now, now)

    const insertLine = db.prepare(`
      INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    lines.forEach((l, i) => insertLine.run(generateId(), tenantId, id, l.accountId, i + 1, l.description, l.debit, l.credit))
  })
  run()
  return id
}

// Dr สต็อกวัตถุดิบ + Dr ภาษีซื้อ / Cr เจ้าหนี้การค้า
export function postPurchaseOrderReceived(tenantId: string, poId: string, userName: string, dateOverride?: string): PostResult {
  if (alreadyPosted(tenantId, 'PURCHASE_ORDER', poId)) return { skipped: true, reason: 'already posted' }

  const po = db.prepare(`
    SELECT po.*, s.name as supplier_name
    FROM purchase_orders po JOIN suppliers s ON po.supplier_id = s.id
    WHERE po.id = ? AND po.tenant_id = ?
  `).get(poId, tenantId) as any
  if (!po) return { skipped: true, reason: 'PO not found' }

  const inventoryId = getAccountId(tenantId, ACC.RAW_MATERIAL)
  const vatId = getAccountId(tenantId, ACC.INPUT_VAT)
  const payableId = getAccountId(tenantId, ACC.AP)
  if (!inventoryId || !vatId || !payableId) return { skipped: true, reason: 'required accounts missing (init chart of accounts first)' }

  const lines: JournalLineInput[] = [
    { accountId: inventoryId, description: `สต็อกวัตถุดิบ - PO ${po.po_number}`, debit: po.subtotal, credit: 0 },
  ]
  if (po.tax_amount > 0) {
    lines.push({ accountId: vatId, description: `ภาษีซื้อ - PO ${po.po_number}`, debit: po.tax_amount, credit: 0 })
  }
  lines.push({ accountId: payableId, description: `เจ้าหนี้การค้า - ${po.supplier_name} - PO ${po.po_number}`, debit: 0, credit: po.total_amount })

  const date = dateOverride || po.received_date || po.order_date
  const entryId = insertEntry(tenantId, date, 'PURCHASE_ORDER', poId, `รับสินค้า - PO ${po.po_number}`, lines, userName)
  return { skipped: false, entryId }
}

// Dr ลูกหนี้การค้า / Cr รายได้ขายสินค้า + Cr ภาษีขาย
// Note: does not book COGS/inventory reduction — this codebase has no reliable
// per-unit stock cost to draw from yet, so COGS recognition is left as a gap
// (same gap the original, never-wired /journal/auto/sales preview endpoint had).
export function postSalesOrderConfirmed(tenantId: string, soId: string, userName: string, dateOverride?: string): PostResult {
  if (alreadyPosted(tenantId, 'SALES_ORDER', soId)) return { skipped: true, reason: 'already posted' }

  const so = db.prepare(`
    SELECT so.*, c.name as customer_name
    FROM sales_orders so JOIN customers c ON so.customer_id = c.id
    WHERE so.id = ? AND so.tenant_id = ?
  `).get(soId, tenantId) as any
  if (!so) return { skipped: true, reason: 'SO not found' }

  const arId = getAccountId(tenantId, ACC.AR)
  const vatId = getAccountId(tenantId, ACC.OUTPUT_VAT)
  const revenueId = getAccountId(tenantId, ACC.REVENUE_PRODUCT)
  if (!arId || !vatId || !revenueId) return { skipped: true, reason: 'required accounts missing (init chart of accounts first)' }

  const revenueAmount = so.subtotal - (so.discount_amount || 0)
  const lines: JournalLineInput[] = [
    { accountId: arId, description: `ลูกหนี้การค้า - ${so.customer_name} - SO ${so.so_number}`, debit: so.total_amount, credit: 0 },
    { accountId: revenueId, description: `รายได้ขายสินค้า - SO ${so.so_number}`, debit: 0, credit: revenueAmount },
  ]
  if (so.tax_amount > 0) {
    lines.push({ accountId: vatId, description: `ภาษีขาย - SO ${so.so_number}`, debit: 0, credit: so.tax_amount })
  }

  const date = dateOverride || so.order_date
  const entryId = insertEntry(tenantId, date, 'SALES_ORDER', soId, `ขายสินค้า - SO ${so.so_number}`, lines, userName)
  return { skipped: false, entryId }
}
