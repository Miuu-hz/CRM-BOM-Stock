import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { generateId, formatDocumentNumber } from '../../utils/id'
import { createSalesJournal, reverseSalesJournal, voidReceipt } from './shared'
import { getOrCreateReceiptToken, buildReceiptUrl, buildReceiptQr } from '../../utils/receiptToken'
import { createInvoiceFromSO, SalesBillingError } from '../../services/salesBilling.service'
import { canHandleBilling } from '../../services/rbac.service'

// Additive multi-currency columns. Guarded so it only runs once per fresh DB, same
// pattern as tax.routes.ts's wht_form column.
function ensureInvoiceCurrencyColumns() {
  try {
    const columns = db.prepare('PRAGMA table_info(invoices)').all() as { name: string }[]
    const names = new Set(columns.map((c) => c.name))
    if (!names.has('currency_code')) db.exec("ALTER TABLE invoices ADD COLUMN currency_code TEXT DEFAULT 'THB'")
    if (!names.has('exchange_rate')) db.exec('ALTER TABLE invoices ADD COLUMN exchange_rate REAL DEFAULT 1')
    if (!names.has('foreign_amount')) db.exec('ALTER TABLE invoices ADD COLUMN foreign_amount REAL')
  } catch (error) {
    console.error('Failed to ensure invoice currency columns:', error)
  }
}
ensureInvoiceCurrencyColumns()

const router = Router()

// GET all invoices
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const invoices = db.prepare(`
      SELECT i.*, c.name as customer_name, c.code as customer_code,
        so.so_number
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      LEFT JOIN sales_orders so ON i.sales_order_id = so.id
      WHERE i.tenant_id = ?
      ORDER BY i.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: invoices })
  } catch (error) {
    console.error('Get invoices error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch invoices' })
  }
})

// GET single invoice
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const invoice = db.prepare(`
      SELECT i.*, c.name as customer_name, c.code as customer_code, c.tax_id as customer_tax_id, c.address as customer_address, c.email as customer_email, c.phone as customer_phone,
        c.address as customer_address, so.so_number
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      LEFT JOIN sales_orders so ON i.sales_order_id = so.id
      WHERE i.id = ? AND i.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' })
    }

    const items = db.prepare(`
      -- ห้ามใช้ p.name as product_name เฉย ๆ: ชื่อคอลัมน์ซ้ำกับ ii.* แล้วตัวหลังทับตัวหน้า
      -- = เอา null ไปทับชื่อสินค้าจริงในแถว (invoice_items ไม่มีคอลัมน์อื่นให้ fallback)
      SELECT ii.*, COALESCE(si.name, ii.product_name) as product_name, si.sku as product_code
      FROM invoice_items ii
      LEFT JOIN stock_items si ON ii.stock_item_id = si.id AND si.tenant_id = ii.tenant_id
      WHERE ii.invoice_id = ?
    `).all(req.params.id)

    const receipts = db.prepare(`
      SELECT r.* FROM receipts r WHERE r.invoice_id = ? ORDER BY r.created_at DESC
    `).all(req.params.id)

    const withholdingTax = db.prepare(`
      SELECT * FROM withholding_tax WHERE invoice_id = ?
    `).all(req.params.id)

    const attachments = db.prepare(`
      SELECT * FROM invoice_attachments WHERE invoice_id = ? ORDER BY created_at ASC
    `).all(req.params.id)

    // Paperless receipt: lazily mint/reuse a public share token + QR for this invoice
    const receiptToken = getOrCreateReceiptToken('invoice', req.params.id, tenantId)
    const receipt_url = buildReceiptUrl(receiptToken)
    const receipt_qr = await buildReceiptQr(receiptToken)

    res.json({ success: true, data: { ...invoice, items, receipts, withholdingTax, attachments, receipt_url, receipt_qr } })
  } catch (error) {
    console.error('Get invoice error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch invoice' })
  }
})

// Map SalesBillingError codes → HTTP status. DUPLICATE_INVOICE uses 409 (conflict) so
// the frontend can tell "already exists" apart from a plain validation error (400).
const INVOICE_ERROR_STATUS: Record<string, number> = {
  SO_NOT_FOUND: 404,
  DUPLICATE_INVOICE: 409,
  CURRENCY_NOT_FOUND: 400,
  INVALID_EXCHANGE_RATE: 400,
}

// POST create invoice from sales order
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canHandleBilling(req.user!, 'sales')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ทำรายการนี้ — ต้องอยู่ฝ่ายขาย/ฝ่ายบัญชี หรือเป็น ADMIN/MASTER' })
    }
    const { salesOrderId, dueDate, notes, currencyCode, exchangeRate, foreignAmount } = req.body

    if (!salesOrderId) {
      return res.status(400).json({ success: false, message: 'Sales order is required' })
    }

    // ตรรกะจริงอยู่ที่ services/salesBilling.service.ts (ใช้ร่วมกับ MCP create_sales_invoice)
    // รวมถึงการกันออกใบแจ้งหนี้ซ้ำจาก SO เดิม (บั๊กที่ยืนยันแล้ว 2026-09-14)
    const { invoice, items } = createInvoiceFromSO(tenantId, {
      salesOrderId, dueDate, notes, currencyCode, exchangeRate, foreignAmount,
    })

    res.status(201).json({ success: true, data: { ...invoice, items } })
  } catch (error) {
    if (error instanceof SalesBillingError) {
      return res.status(INVOICE_ERROR_STATUS[error.code] || 400).json({ success: false, message: error.message })
    }
    console.error('Create invoice error:', error)
    res.status(500).json({ success: false, message: 'Failed to create invoice' })
  }
})

// PUT update invoice status
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['DRAFT', 'ISSUED', 'PAID', 'PARTIAL', 'OVERDUE', 'CANCELLED']

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const existing = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Invoice not found' })
    }

    if (status === 'CANCELLED' && !['ADMIN', 'MANAGER', 'MASTER'].includes(req.user!.role)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ยกเลิกใบแจ้งหนี้ — ต้องเป็น ADMIN/MANAGER/MASTER' })
    }

    // ── Cancellation: reverse the posted sales journal (swap Dr/Cr of every line) ──
    // so AR/revenue/COGS/inventory are backed out. reverseSalesJournal() is a no-op
    // if this invoice never had a journal posted, or if it was already reversed
    // (guards against double-reversal from repeated CANCELLED calls).
    if (status === 'CANCELLED' && existing.status !== 'CANCELLED') {
      const so = existing.sales_order_id
        ? (db.prepare('SELECT so_number FROM sales_orders WHERE id = ? AND tenant_id = ?').get(existing.sales_order_id, tenantId) as any)
        : null
      const receiptRows = db.prepare('SELECT * FROM receipts WHERE invoice_id = ? AND tenant_id = ?').all(req.params.id, tenantId) as any[]
      db.transaction(() => {
        for (const rc of receiptRows) voidReceipt(tenantId, rc)  // reverse customer payments first (end-to-end cancel)
        reverseSalesJournal(tenantId, req.params.id, existing.invoice_number, so?.so_number)
      })()
    }

    const now = new Date().toISOString()
    db.prepare("UPDATE invoices SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(status, now, req.params.id, tenantId)

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: invoice })
  } catch (error) {
    console.error('Update invoice status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// POST add withholding tax to invoice
router.post('/:id/withholding-tax', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { taxType, taxRate, taxBase, description } = req.body

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' })
    }

    const id = generateId()
    const taxAmount = taxBase * (taxRate / 100)
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO withholding_tax (id, tenant_id, invoice_id, tax_type, tax_rate, tax_base, tax_amount, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, req.params.id, taxType, taxRate, taxBase, taxAmount, description || '', now)

    // Update invoice net amount (deduct withholding tax)
    const whtTotal = (db.prepare('SELECT COALESCE(SUM(tax_amount), 0) as total FROM withholding_tax WHERE invoice_id = ?').get(req.params.id) as any).total
    const netAmount = invoice.total_amount - whtTotal

    res.json({
      success: true,
      data: {
        withholdingTax: { id, taxType, taxRate, taxBase, taxAmount },
        invoiceTotal: invoice.total_amount,
        withholdingTaxTotal: whtTotal,
        netAmount: netAmount
      }
    })
  } catch (error) {
    console.error('Add withholding tax error:', error)
    res.status(500).json({ success: false, message: 'Failed to add withholding tax' })
  }
})

// GET withholding tax for invoice
router.get('/:id/withholding-tax', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const wht = db.prepare(`
      SELECT * FROM withholding_tax WHERE invoice_id = ? AND tenant_id = ?
    `).all(req.params.id, tenantId)

    res.json({ success: true, data: wht })
  } catch (error) {
    console.error('Get withholding tax error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch withholding tax' })
  }
})

export default router
