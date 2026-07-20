import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { generateId, formatDocumentNumber } from '../../utils/id'
import { createSalesJournal } from './shared'

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
      SELECT i.*, c.name as customer_name, c.code as customer_code, c.email as customer_email, c.phone as customer_phone,
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
      SELECT ii.*, p.name as product_name, p.code as product_code
      FROM invoice_items ii
      LEFT JOIN products p ON ii.product_id = p.id
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

    res.json({ success: true, data: { ...invoice, items, receipts, withholdingTax, attachments } })
  } catch (error) {
    console.error('Get invoice error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch invoice' })
  }
})

// POST create invoice from sales order
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { salesOrderId, dueDate, notes, items: customItems, currencyCode, exchangeRate, foreignAmount } = req.body

    if (!salesOrderId) {
      return res.status(400).json({ success: false, message: 'Sales order is required' })
    }

    // ponytail: invoice totals (subtotal/tax/total) are derived from the linked sales order,
    // not entered ad hoc — so unlike PO creation, there's no "foreign line total" to convert
    // here. Currency is stored as pass-through metadata computed by the frontend; the THB
    // fields below stay authoritative and untouched, keeping THB invoices byte-identical to
    // before this feature existed.
    let currency_code = 'THB'
    let exchange_rate = 1
    let foreign_amount: number | null = null
    if (currencyCode && currencyCode !== 'THB') {
      const currency = db.prepare('SELECT code FROM currencies WHERE tenant_id = ? AND code = ? AND is_active = 1')
        .get(tenantId, currencyCode) as { code: string } | undefined
      if (!currency) {
        return res.status(400).json({ success: false, message: 'ไม่พบสกุลเงินที่ระบุ หรือสกุลเงินถูกปิดใช้งาน' })
      }
      const rate = Number(exchangeRate)
      if (!Number.isFinite(rate) || rate <= 0) {
        return res.status(400).json({ success: false, message: 'อัตราแลกเปลี่ยนไม่ถูกต้อง' })
      }
      currency_code = currencyCode
      exchange_rate = rate
      const fa = Number(foreignAmount)
      foreign_amount = Number.isFinite(fa) ? fa : null
    }

    // Get sales order details
    const salesOrder = db.prepare(`
      SELECT so.*, c.id as customer_id, c.name as customer_name
      FROM sales_orders so
      JOIN customers c ON so.customer_id = c.id
      WHERE so.id = ? AND so.tenant_id = ?
    `).get(salesOrderId, tenantId) as any

    if (!salesOrder) {
      return res.status(404).json({ success: false, message: 'Sales order not found' })
    }

    const id = generateId()
    const invoiceNumber = formatDocumentNumber('INV', tenantId, 'INVOICE', new Date().getFullYear(), 5)
    const now = new Date().toISOString()

    // Get sales order items for invoice items
    const salesOrderItems = db.prepare(`
      SELECT * FROM sales_order_items WHERE sales_order_id = ?
    `).all(salesOrderId) as any[]

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, invoice_date, due_date,
          subtotal, discount_amount, tax_rate, tax_amount, total_amount, balance_amount, status, payment_status, notes, created_at, updated_at,
          currency_code, exchange_rate, foreign_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'UNPAID', ?, ?, ?, ?, ?, ?)
      `).run(id, tenantId, invoiceNumber, salesOrderId, salesOrder.customer_id, now, dueDate || null,
        salesOrder.subtotal, salesOrder.discount_amount, salesOrder.tax_rate, salesOrder.tax_amount,
        salesOrder.total_amount, salesOrder.total_amount, notes || '', now, now,
        currency_code, exchange_rate, foreign_amount)

      // Create invoice items from sales order items
      const insertItem = db.prepare(`
        INSERT INTO invoice_items (id, tenant_id, invoice_id, sales_order_item_id, stock_item_id, product_id, product_name, quantity, unit_price, total_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of salesOrderItems) {
        insertItem.run(generateId(), tenantId, id, item.id,
          item.stock_item_id || null, null, item.product_name || null,
          item.quantity, item.unit_price, item.total_price)
      }

      // VAT Entry (Output VAT)
      if ((salesOrder.tax_amount || 0) > 0) {
        db.prepare(`
          INSERT INTO vat_entries (id, tenant_id, document_type, document_id, document_number, document_date, party_name, party_tax_id, base_amount, vat_rate, vat_amount, total_amount, is_input_vat, is_output_vat, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
        `).run(generateId(), tenantId, 'INVOICE', id, invoiceNumber, now.substring(0, 10),
          salesOrder.customer_name || '', null,
          salesOrder.subtotal, salesOrder.tax_rate || 7, salesOrder.tax_amount, salesOrder.total_amount, now)
      }
    })

    transaction()

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
    const invoiceItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(id)

    // Journal: DR ลูกหนี้การค้า / CR รายได้ขาย + ภาษีขาย
    createSalesJournal(tenantId, 'INVOICE', id,
      `ขายสินค้า INV ${invoiceNumber}`,
      salesOrder.total_amount, salesOrder.tax_amount || 0,
      undefined, invoiceNumber, salesOrder.so_number)

    res.status(201).json({ success: true, data: { ...invoice, items: invoiceItems } })
  } catch (error) {
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

    const existing = db.prepare('SELECT id FROM invoices WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Invoice not found' })
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
