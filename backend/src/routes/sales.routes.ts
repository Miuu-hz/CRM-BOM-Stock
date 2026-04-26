import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'
import multer from 'multer'
import path from 'path'
import fs from 'fs'

const router = Router()

router.use(authenticate)

// ─── Invoice Attachments Setup ────────────────────────────────────────────────
const invoiceUploadDir = path.join(__dirname, '..', '..', 'uploads', 'invoice-attachments')
if (!fs.existsSync(invoiceUploadDir)) fs.mkdirSync(invoiceUploadDir, { recursive: true })

const invoiceStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, invoiceUploadDir),
  filename: (req, _file, cb) => {
    const ext = path.extname(_file.originalname).toLowerCase() || '.jpg'
    cb(null, `inv-${req.params.id}-${Date.now()}${ext}`)
  },
})
const invoiceUpload = multer({
  storage: invoiceStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
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

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

function generateNumber(prefix: string, tenantId: string, table: string) {
  const count = (db.prepare(`SELECT COUNT(*) as count FROM ${table} WHERE tenant_id = ?`).get(tenantId) as any).count
  const year = new Date().getFullYear()
  return `${prefix}-${year}-${String(count + 1).padStart(5, '0')}`
}

// ─── Accounting helpers ────────────────────────────────────────────────────────

function getOrCreateAccount(tenantId: string, code: string, name: string, type: string, category: string, normalBalance: string): string {
  const existing = db.prepare('SELECT id FROM accounts WHERE tenant_id = ? AND code = ?').get(tenantId, code) as any
  if (existing) return existing.id
  const id = generateId()
  db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, is_active, is_system, level)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0)`).run(id, tenantId, code, name, type, category, normalBalance)
  return id
}

function updateAccountBalance(tenantId: string, accountId: string, debit: number, credit: number) {
  const now = new Date()
  const yr = now.getFullYear()
  const mo = now.getMonth() + 1
  const existing = db.prepare('SELECT id, debit_amount, credit_amount FROM account_balances WHERE tenant_id = ? AND account_id = ? AND fiscal_year = ? AND period = ?').get(tenantId, accountId, yr, mo) as any
  if (existing) {
    const newDebit = (existing.debit_amount || 0) + debit
    const newCredit = (existing.credit_amount || 0) + credit
    db.prepare('UPDATE account_balances SET debit_amount = ?, credit_amount = ?, ending_balance = ? WHERE id = ?')
      .run(newDebit, newCredit, newDebit - newCredit, existing.id)
  } else {
    db.prepare(`INSERT INTO account_balances (id, tenant_id, account_id, fiscal_year, period, beginning_balance, debit_amount, credit_amount, ending_balance)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`).run(generateId(), tenantId, accountId, yr, mo, debit, credit, debit - credit)
  }
}

function createSalesJournal(
  tenantId: string, referenceType: string, referenceId: string,
  description: string, totalAmount: number, taxAmount: number,
  paymentMethod?: string, sourceNumber?: string, soNumber?: string
) {
  try {
    const now = new Date().toISOString()
    const dateStr = now.split('T')[0]
    const yr = new Date().getFullYear()
    const jvCount = (db.prepare("SELECT COUNT(*) as c FROM journal_entries WHERE tenant_id = ? AND strftime('%Y', date) = ?").get(tenantId, yr.toString()) as any).c
    const jvNumber = `JV-${yr}-${String(jvCount + 1).padStart(5, '0')}`

    // Accounts
    const arId   = getOrCreateAccount(tenantId, '1180', 'ลูกหนี้การค้า', 'ASSET', 'CURRENT_ASSET', 'DEBIT')
    const revId  = getOrCreateAccount(tenantId, '4100', 'รายได้จากการขาย', 'REVENUE', 'REVENUE', 'CREDIT')
    const vatId  = getOrCreateAccount(tenantId, '2210', 'ภาษีขายค้างจ่าย', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT')
    const cashId = getOrCreateAccount(tenantId, '1101', 'เงินสด', 'ASSET', 'CURRENT_ASSET', 'DEBIT')
    const bankId = getOrCreateAccount(tenantId, '1102', 'เงินฝากธนาคาร', 'ASSET', 'CURRENT_ASSET', 'DEBIT')

    const entryId = generateId()
    const netRevenue = totalAmount - taxAmount

    if (referenceType === 'INVOICE') {
      // DR ลูกหนี้การค้า / CR รายได้ขาย + CR ภาษีขาย
      db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, source_number, so_number, description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'INVOICE', ?, ?, ?, ?, ?, ?, 1, 1, 'system', ?, ?)`)
        .run(entryId, tenantId, jvNumber, dateStr, referenceId, sourceNumber || null, soNumber || null, description, totalAmount, totalAmount, now, now)

      let lineNum = 1
      db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
        .run(generateId(), tenantId, entryId, arId, lineNum++, description, totalAmount)
      db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
        .run(generateId(), tenantId, entryId, revId, lineNum++, description, netRevenue)
      if (taxAmount > 0) {
        db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
          .run(generateId(), tenantId, entryId, vatId, lineNum++, 'ภาษีขาย', taxAmount)
      }

      updateAccountBalance(tenantId, arId, totalAmount, 0)
      updateAccountBalance(tenantId, revId, 0, netRevenue)
      if (taxAmount > 0) updateAccountBalance(tenantId, vatId, 0, taxAmount)

    } else if (referenceType === 'RECEIPT') {
      // DR เงินสด/ธนาคาร / CR ลูกหนี้การค้า
      const cashAccId = (paymentMethod === 'TRANSFER' || paymentMethod === 'CHEQUE') ? bankId : cashId
      db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, source_number, so_number, description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'PAYMENT', ?, ?, ?, ?, ?, ?, 1, 1, 'system', ?, ?)`)
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

function deductStockForSO(tenantId: string, soId: string, soNumber: string) {
  try {
    const items = db.prepare('SELECT * FROM sales_order_items WHERE sales_order_id = ?').all(soId) as any[]
    for (const item of items) {
      const stockItemId = item.stock_item_id
      if (!stockItemId) continue
      const qty = Math.floor(item.quantity || 0)
      if (qty <= 0) continue
      db.prepare('UPDATE stock_items SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(qty, new Date().toISOString(), stockItemId, tenantId)
      db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
        VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, 'system')`).run(
        generateId(), tenantId, stockItemId, qty, `SO: ${soNumber}`, `ขายสินค้า SO ${soNumber}`, new Date().toISOString())
    }
  } catch (err) {
    console.error('⚠️ deductStockForSO error:', err)
  }
}

// ============================================
// QUOTATIONS
// ============================================

// GET all quotations
router.get('/quotations', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const quotations = db.prepare(`
      SELECT q.*, c.name as customer_name, c.code as customer_code,
        (SELECT COUNT(*) FROM quotation_items WHERE quotation_id = q.id) as item_count
      FROM quotations q
      LEFT JOIN customers c ON q.customer_id = c.id
      WHERE q.tenant_id = ?
      ORDER BY q.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: quotations })
  } catch (error) {
    console.error('Get quotations error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch quotations' })
  }
})

// GET single quotation
router.get('/quotations/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const quotation = db.prepare(`
      SELECT q.*, c.name as customer_name, c.code as customer_code, c.email as customer_email, c.phone as customer_phone
      FROM quotations q
      LEFT JOIN customers c ON q.customer_id = c.id
      WHERE q.id = ? AND q.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!quotation) {
      return res.status(404).json({ success: false, message: 'Quotation not found' })
    }

    const items = db.prepare(`
      SELECT qi.*, p.name as product_name, p.code as product_code
      FROM quotation_items qi
      LEFT JOIN products p ON qi.product_id = p.id
      WHERE qi.quotation_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...quotation, items } })
  } catch (error) {
    console.error('Get quotation error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch quotation' })
  }
})

// POST create quotation
router.post('/quotations', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { customerId, expiryDate, notes, items, taxRate, discountAmount, templateId } = req.body
    
    if (!customerId) {
      return res.status(400).json({ success: false, message: 'Customer is required' })
    }

    const id = generateId()
    const quotationNumber = generateNumber('QT', tenantId, 'quotations')
    const now = new Date().toISOString()

    // Calculate totals
    let subtotal = 0
    if (items && items.length > 0) {
      subtotal = items.reduce((sum: number, item: any) => {
        const itemTotal = item.quantity * item.unitPrice * (1 - (item.discountPercent || 0) / 100)
        return sum + itemTotal
      }, 0)
    }
    const discount = discountAmount || 0
    const tax = taxRate || 0
    const afterDiscount = subtotal - discount
    const taxAmount = afterDiscount * (tax / 100)
    const totalAmount = afterDiscount + taxAmount

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO quotations (id, tenant_id, quotation_number, customer_id, quotation_date, expiry_date,
          subtotal, discount_amount, tax_rate, tax_amount, total_amount, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
      `).run(id, tenantId, quotationNumber, customerId, now, expiryDate || null,
        subtotal, discount, tax, taxAmount, totalAmount, notes || '', now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO quotation_items (id, tenant_id, quotation_id, stock_item_id, product_id, product_name, quantity, unit_price, discount_percent, total_price, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          const itemTotal = item.quantity * item.unitPrice * (1 - (item.discountPercent || 0) / 100)
          insertItem.run(generateId(), tenantId, id,
            item.productId || null, null, item.productName || null,
            item.quantity, item.unitPrice, item.discountPercent || 0, itemTotal, item.notes || '')
        }
      }
    })

    transaction()

    const quotation = db.prepare('SELECT * FROM quotations WHERE id = ?').get(id)
    const quotationItems = db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...quotation, items: quotationItems } })
  } catch (error) {
    console.error('Create quotation error:', error)
    res.status(500).json({ success: false, message: 'Failed to create quotation' })
  }
})

// PUT update quotation status
router.put('/quotations/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED']
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const existing = db.prepare('SELECT id FROM quotations WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Quotation not found' })
    }

    const now = new Date().toISOString()
    db.prepare("UPDATE quotations SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(status, now, req.params.id, tenantId)

    const quotation = db.prepare('SELECT * FROM quotations WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: quotation })
  } catch (error) {
    console.error('Update quotation status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// ============================================
// SALES ORDERS
// ============================================

// GET all sales orders
router.get('/sales-orders', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const salesOrders = db.prepare(`
      SELECT so.*, c.name as customer_name, c.code as customer_code,
        q.quotation_number,
        (SELECT COUNT(*) FROM sales_order_items WHERE sales_order_id = so.id) as item_count,
        (SELECT SUM(quantity - delivered_qty) FROM sales_order_items WHERE sales_order_id = so.id AND quantity > delivered_qty) as pending_qty
      FROM sales_orders so
      LEFT JOIN customers c ON so.customer_id = c.id
      LEFT JOIN quotations q ON so.quotation_id = q.id
      WHERE so.tenant_id = ?
      ORDER BY so.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: salesOrders })
  } catch (error) {
    console.error('Get sales orders error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch sales orders' })
  }
})

// GET single sales order
router.get('/sales-orders/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const salesOrder = db.prepare(`
      SELECT so.*, c.name as customer_name, c.code as customer_code, c.email as customer_email, c.phone as customer_phone,
        q.quotation_number
      FROM sales_orders so
      LEFT JOIN customers c ON so.customer_id = c.id
      LEFT JOIN quotations q ON so.quotation_id = q.id
      WHERE so.id = ? AND so.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!salesOrder) {
      return res.status(404).json({ success: false, message: 'Sales order not found' })
    }

    const items = db.prepare(`
      SELECT soi.*,
        COALESCE(soi.product_name, si.name) as product_name,
        COALESCE(si.sku, si.name) as product_code,
        si.quantity as stock_qty
      FROM sales_order_items soi
      LEFT JOIN stock_items si ON soi.stock_item_id = si.id
      WHERE soi.sales_order_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...salesOrder, items } })
  } catch (error) {
    console.error('Get sales order error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch sales order' })
  }
})

// POST create sales order from quotation
router.post('/sales-orders', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { quotationId, customerId, deliveryDate, notes, items, taxRate, discountAmount } = req.body
    
    if (!customerId) {
      return res.status(400).json({ success: false, message: 'Customer is required' })
    }

    const id = generateId()
    const soNumber = generateNumber('SO', tenantId, 'sales_orders')
    const now = new Date().toISOString()

    // Calculate totals
    let subtotal = 0
    if (items && items.length > 0) {
      subtotal = items.reduce((sum: number, item: any) => {
        const itemTotal = item.quantity * item.unitPrice * (1 - (item.discountPercent || 0) / 100)
        return sum + itemTotal
      }, 0)
    }
    const discount = discountAmount || 0
    const tax = taxRate || 0
    const afterDiscount = subtotal - discount
    const taxAmount = afterDiscount * (tax / 100)
    const totalAmount = afterDiscount + taxAmount

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO sales_orders (id, tenant_id, so_number, quotation_id, customer_id, order_date, delivery_date,
          subtotal, discount_amount, tax_rate, tax_amount, total_amount, status, payment_status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'UNPAID', ?, ?, ?)
      `).run(id, tenantId, soNumber, quotationId || null, customerId, now, deliveryDate || null,
        subtotal, discount, tax, taxAmount, totalAmount, notes || '', now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_id, product_name, quotation_item_id, quantity, unit_price, discount_percent, total_price, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          const itemTotal = item.quantity * item.unitPrice * (1 - (item.discountPercent || 0) / 100)
          insertItem.run(generateId(), tenantId, id,
            item.productId || null, null, item.productName || null,
            item.quotationItemId || null,
            item.quantity, item.unitPrice, item.discountPercent || 0, itemTotal, item.notes || '')
        }
      }

      // Update quotation status if created from quotation
      if (quotationId) {
        db.prepare("UPDATE quotations SET status = 'ACCEPTED', updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(now, quotationId, tenantId)
      }
    })

    transaction()

    const salesOrder = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(id)
    const salesOrderItems = db.prepare('SELECT * FROM sales_order_items WHERE sales_order_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...salesOrder, items: salesOrderItems } })
  } catch (error) {
    console.error('Create sales order error:', error)
    res.status(500).json({ success: false, message: 'Failed to create sales order' })
  }
})

// PUT update sales order status
router.put('/sales-orders/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['DRAFT', 'CONFIRMED', 'PROCESSING', 'READY', 'DELIVERED', 'PARTIAL', 'COMPLETED', 'CANCELLED']
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const existing = db.prepare('SELECT id FROM sales_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Sales order not found' })
    }

    // เช็ค stock ก่อน CONFIRMED
    if (status === 'CONFIRMED') {
      const soItems = db.prepare(`
        SELECT soi.*, si.quantity as stock_qty, COALESCE(soi.product_name, si.name) as item_name
        FROM sales_order_items soi
        LEFT JOIN stock_items si ON soi.stock_item_id = si.id
        WHERE soi.sales_order_id = ?
      `).all(req.params.id) as any[]

      const shortItems = soItems.filter(it => it.stock_item_id && (it.stock_qty ?? 0) < it.quantity)
      if (shortItems.length > 0) {
        const details = shortItems.map((it: any) => `${it.item_name || 'สินค้า'}: ต้องการ ${it.quantity} มีในสต็อก ${it.stock_qty ?? 0}`).join(', ')
        return res.status(400).json({ success: false, message: `สต็อกไม่เพียงพอ: ${details}` })
      }
    }

    const now = new Date().toISOString()
    db.prepare("UPDATE sales_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(status, now, req.params.id, tenantId)

    const salesOrder = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(req.params.id) as any

    // ตัด stock เมื่อยืนยัน SO
    if (status === 'CONFIRMED' && salesOrder) {
      deductStockForSO(tenantId, salesOrder.id, salesOrder.so_number)
    }

    res.json({ success: true, data: salesOrder })
  } catch (error) {
    console.error('Update sales order status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// ============================================
// DELIVERY ORDERS (with Partial Delivery Support)
// ============================================

// GET all delivery orders
router.get('/delivery-orders', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const deliveryOrders = db.prepare(`
      SELECT do.*, c.name as customer_name, c.code as customer_code,
        so.so_number, so.total_amount
      FROM delivery_orders do
      LEFT JOIN customers c ON do.customer_id = c.id
      LEFT JOIN sales_orders so ON do.sales_order_id = so.id
      WHERE do.tenant_id = ?
      ORDER BY do.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: deliveryOrders })
  } catch (error) {
    console.error('Get delivery orders error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch delivery orders' })
  }
})

// GET single delivery order
router.get('/delivery-orders/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const deliveryOrder = db.prepare(`
      SELECT do.*, c.name as customer_name, c.code as customer_code,
        so.so_number, so.total_amount
      FROM delivery_orders do
      LEFT JOIN customers c ON do.customer_id = c.id
      LEFT JOIN sales_orders so ON do.sales_order_id = so.id
      WHERE do.id = ? AND do.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!deliveryOrder) {
      return res.status(404).json({ success: false, message: 'Delivery order not found' })
    }

    const items = db.prepare(`
      SELECT doi.*, p.name as product_name, p.code as product_code, soi.quantity as ordered_qty
      FROM delivery_order_items doi
      LEFT JOIN sales_order_items soi ON doi.sales_order_item_id = soi.id
      LEFT JOIN products p ON doi.product_id = p.id
      WHERE doi.delivery_order_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...deliveryOrder, items } })
  } catch (error) {
    console.error('Get delivery order error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch delivery order' })
  }
})

// POST create delivery order (with partial delivery support)
router.post('/delivery-orders', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { salesOrderId, deliveryDate, deliveryAddress, driverName, vehiclePlate, notes, items, isPartial } = req.body
    
    if (!salesOrderId) {
      return res.status(400).json({ success: false, message: 'Sales order is required' })
    }

    // Get customer from sales order
    const salesOrder = db.prepare('SELECT customer_id FROM sales_orders WHERE id = ? AND tenant_id = ?').get(salesOrderId, tenantId) as any
    if (!salesOrder) {
      return res.status(404).json({ success: false, message: 'Sales order not found' })
    }

    const id = generateId()
    const doNumber = generateNumber('DO', tenantId, 'delivery_orders')
    const now = new Date().toISOString()

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO delivery_orders (id, tenant_id, do_number, sales_order_id, customer_id, delivery_date, delivery_address,
          driver_name, vehicle_plate, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
      `).run(id, tenantId, doNumber, salesOrderId, salesOrder.customer_id, deliveryDate || now, 
        deliveryAddress || '', driverName || '', vehiclePlate || '', notes || '', now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO delivery_order_items (id, tenant_id, delivery_order_id, sales_order_item_id, product_id, quantity, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          insertItem.run(generateId(), tenantId, id, item.salesOrderItemId, item.productId, item.quantity, item.notes || '')
        }
      }

      // If partial delivery, update SO status to PARTIAL
      if (isPartial) {
        db.prepare("UPDATE sales_orders SET status = 'PARTIAL', updated_at = ? WHERE id = ?")
          .run(now, salesOrderId)
      }
    })

    transaction()

    const deliveryOrder = db.prepare('SELECT * FROM delivery_orders WHERE id = ?').get(id)
    const deliveryOrderItems = db.prepare('SELECT * FROM delivery_order_items WHERE delivery_order_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...deliveryOrder, items: deliveryOrderItems } })
  } catch (error) {
    console.error('Create delivery order error:', error)
    res.status(500).json({ success: false, message: 'Failed to create delivery order' })
  }
})

// PUT update delivery order status (and auto update stock)
router.put('/delivery-orders/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['DRAFT', 'READY', 'SHIPPED', 'DELIVERED', 'CANCELLED']
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const deliveryOrder = db.prepare('SELECT * FROM delivery_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!deliveryOrder) {
      return res.status(404).json({ success: false, message: 'Delivery order not found' })
    }

    const now = new Date().toISOString()

    // When delivered, deduct stock
    if (status === 'DELIVERED' && deliveryOrder.status !== 'DELIVERED') {
      const items = db.prepare('SELECT * FROM delivery_order_items WHERE delivery_order_id = ?').all(req.params.id) as any[]

      const transaction = db.transaction(() => {
        db.prepare("UPDATE delivery_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(status, now, req.params.id, tenantId)

        // Update sales order delivered quantity
        for (const item of items) {
          db.prepare('UPDATE sales_order_items SET delivered_qty = delivered_qty + ? WHERE id = ?')
            .run(item.quantity, item.sales_order_item_id)

          // Deduct stock
          const stockItem = db.prepare('SELECT * FROM stock_items WHERE product_id = ? AND tenant_id = ?').get(item.product_id, tenantId) as any
          if (stockItem) {
            db.prepare('UPDATE stock_items SET quantity = quantity - ?, updated_at = ? WHERE id = ?')
              .run(Math.floor(item.quantity), now, stockItem.id)

            // Record stock movement
            db.prepare(`
              INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
              VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, ?)
            `).run(generateId(), tenantId, stockItem.id, Math.floor(item.quantity), `DO: ${deliveryOrder.do_number}`, 
              `Delivered to customer`, now, req.user!.userId)
          }
        }

        // Check if all items delivered and update sales order status
        const salesOrderItems = db.prepare('SELECT * FROM sales_order_items WHERE sales_order_id = ?').all(deliveryOrder.sales_order_id) as any[]
        const allDelivered = salesOrderItems.every((item: any) => item.delivered_qty >= item.quantity)
        if (allDelivered) {
          db.prepare("UPDATE sales_orders SET status = 'DELIVERED', updated_at = ? WHERE id = ?")
            .run(now, deliveryOrder.sales_order_id)
        }
      })

      transaction()
    } else {
      db.prepare("UPDATE delivery_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(status, now, req.params.id, tenantId)
    }

    const updatedDO = db.prepare('SELECT * FROM delivery_orders WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: updatedDO })
  } catch (error) {
    console.error('Update delivery order status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// ============================================
// BACKORDERS (Partial Delivery)
// ============================================

// GET all backorders
router.get('/backorders', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const backorders = db.prepare(`
      SELECT bo.*, c.name as customer_name, c.code as customer_code,
        so.so_number, do.do_number as original_do
      FROM backorders bo
      LEFT JOIN customers c ON bo.customer_id = c.id
      LEFT JOIN sales_orders so ON bo.sales_order_id = so.id
      LEFT JOIN delivery_orders do ON bo.original_do_id = do.id
      WHERE bo.tenant_id = ?
      ORDER BY bo.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: backorders })
  } catch (error) {
    console.error('Get backorders error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch backorders' })
  }
})

// POST create backorder from partial delivery
router.post('/backorders', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { salesOrderId, originalDoId, customerId, notes, items } = req.body
    
    if (!salesOrderId || !items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Sales order and items are required' })
    }

    const id = generateId()
    const boNumber = generateNumber('BO', tenantId, 'backorders')
    const now = new Date().toISOString()

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO backorders (id, tenant_id, bo_number, sales_order_id, original_do_id, customer_id, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
      `).run(id, tenantId, boNumber, salesOrderId, originalDoId || null, customerId, notes || '', now, now)

      const insertItem = db.prepare(`
        INSERT INTO backorder_items (id, tenant_id, backorder_id, sales_order_item_id, product_id, ordered_qty, delivered_qty, remaining_qty, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      for (const item of items) {
        const remaining = item.orderedQty - item.deliveredQty
        insertItem.run(generateId(), tenantId, id, item.salesOrderItemId, item.productId,
          item.orderedQty, item.deliveredQty, remaining, item.notes || '')
      }
    })

    transaction()

    const backorder = db.prepare('SELECT * FROM backorders WHERE id = ?').get(id)
    const backorderItems = db.prepare('SELECT * FROM backorder_items WHERE backorder_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...backorder, items: backorderItems } })
  } catch (error) {
    console.error('Create backorder error:', error)
    res.status(500).json({ success: false, message: 'Failed to create backorder' })
  }
})

// GET pending items for backorder
router.get('/backorders/pending-items/:salesOrderId', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { salesOrderId } = req.params
    
    const items = db.prepare(`
      SELECT soi.*, p.name as product_name, p.code as product_code,
        (soi.quantity - soi.delivered_qty) as remaining_qty
      FROM sales_order_items soi
      LEFT JOIN products p ON soi.product_id = p.id
      WHERE soi.sales_order_id = ? AND soi.quantity > soi.delivered_qty
    `).all(salesOrderId)

    res.json({ success: true, data: items })
  } catch (error) {
    console.error('Get pending items error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch pending items' })
  }
})

// ============================================
// INVOICES
// ============================================

// GET all invoices
router.get('/invoices', async (req: Request, res: Response) => {
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
router.get('/invoices/:id', async (req: Request, res: Response) => {
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
router.post('/invoices', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { salesOrderId, dueDate, notes, items: customItems } = req.body
    
    if (!salesOrderId) {
      return res.status(400).json({ success: false, message: 'Sales order is required' })
    }

    // Get sales order details
    const salesOrder = db.prepare(`
      SELECT so.*, c.id as customer_id
      FROM sales_orders so
      JOIN customers c ON so.customer_id = c.id
      WHERE so.id = ? AND so.tenant_id = ?
    `).get(salesOrderId, tenantId) as any

    if (!salesOrder) {
      return res.status(404).json({ success: false, message: 'Sales order not found' })
    }

    const id = generateId()
    const invoiceNumber = generateNumber('INV', tenantId, 'invoices')
    const now = new Date().toISOString()

    // Get sales order items for invoice items
    const salesOrderItems = db.prepare(`
      SELECT * FROM sales_order_items WHERE sales_order_id = ?
    `).all(salesOrderId) as any[]

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, invoice_date, due_date,
          subtotal, discount_amount, tax_rate, tax_amount, total_amount, balance_amount, status, payment_status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'UNPAID', ?, ?, ?)
      `).run(id, tenantId, invoiceNumber, salesOrderId, salesOrder.customer_id, now, dueDate || null,
        salesOrder.subtotal, salesOrder.discount_amount, salesOrder.tax_rate, salesOrder.tax_amount,
        salesOrder.total_amount, salesOrder.total_amount, notes || '', now, now)

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
    })

    transaction()

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any
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
router.put('/invoices/:id/status', async (req: Request, res: Response) => {
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

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: invoice })
  } catch (error) {
    console.error('Update invoice status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// ============================================
// WITHHOLDING TAX
// ============================================

// POST add withholding tax to invoice
router.post('/invoices/:id/withholding-tax', async (req: Request, res: Response) => {
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
router.get('/invoices/:id/withholding-tax', async (req: Request, res: Response) => {
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

// ============================================
// CREDIT NOTES
// ============================================

// GET all credit notes
router.get('/credit-notes', async (req: Request, res: Response) => {
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
router.get('/credit-notes/:id', async (req: Request, res: Response) => {
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

    const items = db.prepare(`
      SELECT cni.*, p.name as product_name, p.code as product_code
      FROM credit_note_items cni
      LEFT JOIN products p ON cni.product_id = p.id
      WHERE cni.credit_note_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...creditNote, items } })
  } catch (error) {
    console.error('Get credit note error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch credit note' })
  }
})

// POST create credit note
router.post('/credit-notes', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { invoiceId, customerId, reason, notes, items, taxRate } = req.body
    
    if (!invoiceId || !reason) {
      return res.status(400).json({ success: false, message: 'Invoice and reason are required' })
    }

    const id = generateId()
    const cnNumber = generateNumber('CN', tenantId, 'credit_notes')
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
        const insertItem = db.prepare(`
          INSERT INTO credit_note_items (id, tenant_id, credit_note_id, invoice_item_id, product_id, quantity, unit_price, reason, total_price)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          const total = item.quantity * item.unitPrice
          insertItem.run(generateId(), tenantId, id, item.invoiceItemId, item.productId,
            item.quantity, item.unitPrice, item.reason || '', total)
        }
      }

      // Update invoice balance if credit note issued
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any
      if (invoice) {
        const newBalance = Math.max(0, invoice.balance_amount - totalAmount)
        db.prepare('UPDATE invoices SET balance_amount = ?, updated_at = ? WHERE id = ?')
          .run(newBalance, now, invoiceId)
      }
    })

    transaction()

    const creditNote = db.prepare('SELECT * FROM credit_notes WHERE id = ?').get(id)
    const creditNoteItems = db.prepare('SELECT * FROM credit_note_items WHERE credit_note_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...creditNote, items: creditNoteItems } })
  } catch (error) {
    console.error('Create credit note error:', error)
    res.status(500).json({ success: false, message: 'Failed to create credit note' })
  }
})

// ============================================
// RECEIPTS / PAYMENTS
// ============================================

// POST create receipt (payment)
router.post('/receipts', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { invoiceId, receiptDate, paymentMethod, paymentReference, amount, notes } = req.body
    
    if (!invoiceId || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invoice and valid amount are required' })
    }

    // Get invoice details (join SO for so_number cross-reference)
    const invoice = db.prepare(`
      SELECT i.*, so.so_number, i.invoice_number
      FROM invoices i
      LEFT JOIN sales_orders so ON i.sales_order_id = so.id
      WHERE i.id = ? AND i.tenant_id = ?
    `).get(invoiceId, tenantId) as any
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' })
    }

    if (amount > invoice.balance_amount) {
      return res.status(400).json({ success: false, message: 'Payment amount exceeds balance' })
    }

    const id = generateId()
    const receiptNumber = generateNumber('RC', tenantId, 'receipts')
    const now = new Date().toISOString()
    const date = receiptDate || now

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO receipts (id, tenant_id, receipt_number, invoice_id, customer_id, receipt_date, payment_method,
          payment_reference, amount, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tenantId, receiptNumber, invoiceId, invoice.customer_id, date, paymentMethod || 'CASH',
        paymentReference || '', amount, notes || '', now, now)

      // Update invoice paid and balance
      const newPaid = invoice.paid_amount + amount
      const newBalance = invoice.total_amount - newPaid
      let paymentStatus = 'PARTIAL'
      let invoiceStatus = 'PARTIAL'
      
      if (newBalance <= 0) {
        paymentStatus = 'PAID'
        invoiceStatus = 'PAID'
      }

      db.prepare(`
        UPDATE invoices SET paid_amount = ?, balance_amount = ?, payment_status = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(newPaid, newBalance, paymentStatus, invoiceStatus, now, invoiceId)

      // Update sales order payment status
      db.prepare("UPDATE sales_orders SET payment_status = ?, updated_at = ? WHERE id = ?")
        .run(paymentStatus, now, invoice.sales_order_id)
    })

    transaction()

    const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(id) as any
    const updatedInvoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId)

    // Journal: DR เงินสด/ธนาคาร / CR ลูกหนี้การค้า
    createSalesJournal(tenantId, 'RECEIPT', id,
      `รับชำระเงิน ${receiptNumber} (${paymentMethod || 'CASH'})`,
      amount, 0, paymentMethod, receiptNumber, invoice.so_number)

    res.status(201).json({
      success: true,
      data: { receipt, invoice: updatedInvoice },
      message: 'Payment recorded successfully'
    })
  } catch (error) {
    console.error('Create receipt error:', error)
    res.status(500).json({ success: false, message: 'Failed to record payment' })
  }
})

// ============================================
// PRODUCT VARIANTS
// ============================================

// GET all product variants
router.get('/product-variants', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const variants = db.prepare(`
      SELECT pv.*, p.name as product_name, p.code as product_code
      FROM product_variants pv
      LEFT JOIN products p ON pv.product_id = p.id
      WHERE pv.tenant_id = ?
      ORDER BY pv.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: variants })
  } catch (error) {
    console.error('Get product variants error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch product variants' })
  }
})

// GET variants by product
router.get('/product-variants/product/:productId', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const variants = db.prepare(`
      SELECT * FROM product_variants 
      WHERE product_id = ? AND tenant_id = ? AND status = 'ACTIVE'
    `).all(req.params.productId, tenantId)

    res.json({ success: true, data: variants })
  } catch (error) {
    console.error('Get product variants error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch product variants' })
  }
})

// POST create product variant
router.post('/product-variants', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { productId, sku, variantName, attributes, unitPrice, costPrice } = req.body
    
    if (!productId || !sku || !variantName) {
      return res.status(400).json({ success: false, message: 'Product, SKU and variant name are required' })
    }

    const id = generateId()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO product_variants (id, tenant_id, product_id, sku, variant_name, attributes, unit_price, cost_price, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
    `).run(id, tenantId, productId, sku, variantName, JSON.stringify(attributes || {}), unitPrice || 0, costPrice || 0, now, now)

    const variant = db.prepare('SELECT * FROM product_variants WHERE id = ?').get(id)
    res.status(201).json({ success: true, data: variant })
  } catch (error) {
    console.error('Create product variant error:', error)
    res.status(500).json({ success: false, message: 'Failed to create product variant' })
  }
})

// ============================================
// QUOTATION TEMPLATES
// ============================================

// GET all quotation templates
router.get('/quotation-templates', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const templates = db.prepare(`
      SELECT qt.*, 
        (SELECT COUNT(*) FROM quotation_template_items WHERE template_id = qt.id) as item_count
      FROM quotation_templates qt
      WHERE qt.tenant_id = ?
      ORDER BY qt.is_default DESC, qt.name ASC
    `).all(tenantId)

    res.json({ success: true, data: templates })
  } catch (error) {
    console.error('Get quotation templates error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch quotation templates' })
  }
})

// GET single quotation template
router.get('/quotation-templates/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const template = db.prepare(`
      SELECT * FROM quotation_templates WHERE id = ? AND tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' })
    }

    const items = db.prepare(`
      SELECT qti.*, p.name as product_name, p.code as product_code
      FROM quotation_template_items qti
      LEFT JOIN products p ON qti.product_id = p.id
      WHERE qti.template_id = ?
      ORDER BY qti.sort_order ASC
    `).all(req.params.id)

    res.json({ success: true, data: { ...template, items } })
  } catch (error) {
    console.error('Get quotation template error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch quotation template' })
  }
})

// POST create quotation template
router.post('/quotation-templates', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { name, description, expirationDays, headerText, footerText, termsConditions, isDefault, items } = req.body
    
    if (!name) {
      return res.status(400).json({ success: false, message: 'Template name is required' })
    }

    const id = generateId()
    const now = new Date().toISOString()

    const transaction = db.transaction(() => {
      // If setting as default, unset other defaults
      if (isDefault) {
        db.prepare('UPDATE quotation_templates SET is_default = 0 WHERE tenant_id = ?').run(tenantId)
      }

      db.prepare(`
        INSERT INTO quotation_templates (id, tenant_id, name, description, expiration_days, header_text, footer_text, terms_conditions, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tenantId, name, description || '', expirationDays || 30, headerText || '', footerText || '', termsConditions || '', isDefault ? 1 : 0, now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO quotation_template_items (id, tenant_id, template_id, product_id, quantity, unit_price, discount_percent, sort_order, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        items.forEach((item: any, index: number) => {
          insertItem.run(generateId(), tenantId, id, item.productId, item.quantity || 1,
            item.unitPrice || 0, item.discountPercent || 0, index, item.notes || '')
        })
      }
    })

    transaction()

    const template = db.prepare('SELECT * FROM quotation_templates WHERE id = ?').get(id)
    res.status(201).json({ success: true, data: template })
  } catch (error) {
    console.error('Create quotation template error:', error)
    res.status(500).json({ success: false, message: 'Failed to create quotation template' })
  }
})

// PUT update quotation template
router.put('/quotation-templates/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { name, description, expirationDays, headerText, footerText, termsConditions, isDefault } = req.body
    
    const existing = db.prepare('SELECT id FROM quotation_templates WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Template not found' })
    }

    const now = new Date().toISOString()

    const transaction = db.transaction(() => {
      if (isDefault) {
        db.prepare('UPDATE quotation_templates SET is_default = 0 WHERE tenant_id = ?').run(tenantId)
      }

      db.prepare(`
        UPDATE quotation_templates SET
          name = COALESCE(?, name),
          description = COALESCE(?, description),
          expiration_days = COALESCE(?, expiration_days),
          header_text = COALESCE(?, header_text),
          footer_text = COALESCE(?, footer_text),
          terms_conditions = COALESCE(?, terms_conditions),
          is_default = COALESCE(?, is_default),
          updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(name, description, expirationDays, headerText, footerText, termsConditions, isDefault !== undefined ? (isDefault ? 1 : 0) : undefined, now, req.params.id, tenantId)
    })

    transaction()

    const template = db.prepare('SELECT * FROM quotation_templates WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: template })
  } catch (error) {
    console.error('Update quotation template error:', error)
    res.status(500).json({ success: false, message: 'Failed to update quotation template' })
  }
})

// DELETE quotation template
router.delete('/quotation-templates/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const existing = db.prepare('SELECT id FROM quotation_templates WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Template not found' })
    }

    db.prepare('DELETE FROM quotation_templates WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)

    res.json({ success: true, message: 'Template deleted' })
  } catch (error) {
    console.error('Delete quotation template error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete template' })
  }
})

// POST create quotation from template
router.post('/quotations/from-template', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { templateId, customerId, expiryDate, notes } = req.body
    
    if (!templateId || !customerId) {
      return res.status(400).json({ success: false, message: 'Template and customer are required' })
    }

    // Get template
    const template = db.prepare('SELECT * FROM quotation_templates WHERE id = ? AND tenant_id = ?').get(templateId, tenantId) as any
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' })
    }

    // Get template items
    const templateItems = db.prepare('SELECT * FROM quotation_template_items WHERE template_id = ?').all(templateId) as any[]

    const id = generateId()
    const quotationNumber = generateNumber('QT', tenantId, 'quotations')
    const now = new Date().toISOString()
    const expiry = expiryDate || new Date(Date.now() + (template.expiration_days * 24 * 60 * 60 * 1000)).toISOString()

    // Calculate totals
    let subtotal = 0
    for (const item of templateItems) {
      const itemTotal = item.quantity * item.unit_price * (1 - (item.discount_percent || 0) / 100)
      subtotal += itemTotal
    }
    const taxRate = 7
    const taxAmount = subtotal * (taxRate / 100)
    const totalAmount = subtotal + taxAmount

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO quotations (id, tenant_id, quotation_number, customer_id, quotation_date, expiry_date,
          subtotal, discount_amount, tax_rate, tax_amount, total_amount, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
      `).run(id, tenantId, quotationNumber, customerId, now, expiry,
        subtotal, 0, taxRate, taxAmount, totalAmount, notes || template.header_text, now, now)

      const insertItem = db.prepare(`
        INSERT INTO quotation_items (id, tenant_id, quotation_id, product_id, quantity, unit_price, discount_percent, total_price, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of templateItems) {
        const itemTotal = item.quantity * item.unit_price * (1 - (item.discount_percent || 0) / 100)
        insertItem.run(generateId(), tenantId, id, item.product_id, item.quantity,
          item.unit_price, item.discount_percent || 0, itemTotal, item.notes || '')
      }
    })

    transaction()

    const quotation = db.prepare('SELECT * FROM quotations WHERE id = ?').get(id)
    const quotationItems = db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...quotation, items: quotationItems } })
  } catch (error) {
    console.error('Create quotation from template error:', error)
    res.status(500).json({ success: false, message: 'Failed to create quotation from template' })
  }
})

// ============================================
// SALES SUMMARY / STATS
// ============================================

router.get('/summary', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    // Sales order stats
    const soStats = db.prepare(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) as draft_orders,
        SUM(CASE WHEN status IN ('CONFIRMED', 'PROCESSING', 'READY') THEN 1 ELSE 0 END) as processing_orders,
        SUM(CASE WHEN status = 'PARTIAL' THEN 1 ELSE 0 END) as partial_orders,
        SUM(CASE WHEN status IN ('DELIVERED', 'COMPLETED') THEN 1 ELSE 0 END) as completed_orders,
        COALESCE(SUM(total_amount), 0) as total_sales
      FROM sales_orders
      WHERE tenant_id = ?
    `).get(tenantId) as any

    // Invoice stats
    const invStats = db.prepare(`
      SELECT 
        COUNT(*) as total_invoices,
        SUM(CASE WHEN payment_status = 'UNPAID' THEN 1 ELSE 0 END) as unpaid_invoices,
        SUM(CASE WHEN payment_status = 'PARTIAL' THEN 1 ELSE 0 END) as partial_invoices,
        SUM(CASE WHEN payment_status = 'PAID' THEN 1 ELSE 0 END) as paid_invoices,
        COALESCE(SUM(total_amount), 0) as total_invoiced,
        COALESCE(SUM(balance_amount), 0) as outstanding_balance
      FROM invoices
      WHERE tenant_id = ?
    `).get(tenantId) as any

    // Today's receipts
    const todayReceipts = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as today_received
      FROM receipts
      WHERE tenant_id = ? AND DATE(receipt_date) = DATE('now')
    `).get(tenantId) as any

    // Credit notes
    const cnStats = db.prepare(`
      SELECT COUNT(*) as total_cn, COALESCE(SUM(total_amount), 0) as total_cn_amount
      FROM credit_notes
      WHERE tenant_id = ? AND status != 'CANCELLED'
    `).get(tenantId) as any

    // Backorders
    const boStats = db.prepare(`
      SELECT COUNT(*) as pending_backorders
      FROM backorders
      WHERE tenant_id = ? AND status = 'PENDING'
    `).get(tenantId) as any

    res.json({
      success: true,
      data: {
        salesOrders: {
          total: soStats.total_orders,
          draft: soStats.draft_orders,
          processing: soStats.processing_orders,
          partial: soStats.partial_orders,
          completed: soStats.completed_orders,
          totalSales: soStats.total_sales
        },
        invoices: {
          total: invStats.total_invoices,
          unpaid: invStats.unpaid_invoices,
          partial: invStats.partial_invoices,
          paid: invStats.paid_invoices,
          totalInvoiced: invStats.total_invoiced,
          outstanding: invStats.outstanding_balance
        },
        receipts: {
          todayReceived: todayReceipts.today_received
        },
        creditNotes: {
          total: cnStats.total_cn,
          totalAmount: cnStats.total_cn_amount
        },
        backorders: {
          pending: boStats.pending_backorders
        }
      }
    })
  } catch (error) {
    console.error('Get sales summary error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch summary' })
  }
})

// ============================================
// POS DAILY SALES SUMMARY (Z-Report)
// ============================================

// GET all POS daily sales summaries
router.get('/pos-daily-sales', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { date_from, date_to, limit = 50 } = req.query

    let query = `
      SELECT 
        ds.*,
        u.name as closed_by_name,
        COUNT(dsb.id) as bill_count
      FROM pos_daily_sales ds
      LEFT JOIN users u ON ds.closed_by = u.id
      LEFT JOIN pos_daily_sales_bills dsb ON ds.id = dsb.daily_sales_id
      WHERE ds.tenant_id = ?
    `
    const params: any[] = [tenantId]

    if (date_from) {
      query += ' AND ds.sales_date >= ?'
      params.push(date_from)
    }

    if (date_to) {
      query += ' AND ds.sales_date <= ?'
      params.push(date_to)
    }

    query += ' GROUP BY ds.id ORDER BY ds.sales_date DESC LIMIT ?'
    params.push(parseInt(limit as string))

    const summaries = db.prepare(query).all(...params)

    res.json({ success: true, data: summaries })
  } catch (error) {
    console.error('Get POS daily sales error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch daily sales' })
  }
})

// GET pending bills for daily sales (bills not yet included in any summary)
// IMPORTANT: must be defined BEFORE /pos-daily-sales/:id to avoid route collision
router.get('/pos-daily-sales/pending-bills', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const bills = (db.prepare(`
      SELECT
        b.id,
        b.bill_number,
        b.display_name,
        b.total_amount,
        b.closed_at,
        p.payment_method
      FROM pos_running_bills b
      JOIN pos_payments p ON b.id = p.bill_id
      WHERE b.tenant_id = ?
        AND b.status = 'PAID'
        AND b.id NOT IN (
          SELECT bill_id FROM pos_daily_sales_bills
        )
      ORDER BY b.closed_at DESC
      LIMIT 100
    `).all(tenantId) as any[])

    res.json({ success: true, data: bills })
  } catch (error) {
    console.error('Get pending bills error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch pending bills' })
  }
})

// GET single POS daily sales summary with details
router.get('/pos-daily-sales/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    // Get summary
    const summary = db.prepare(`
      SELECT ds.*, u.name as closed_by_name
      FROM pos_daily_sales ds
      LEFT JOIN users u ON ds.closed_by = u.id
      WHERE ds.id = ? AND ds.tenant_id = ?
    `).get(id, tenantId)

    if (!summary) {
      return res.status(404).json({ success: false, message: 'Daily sales summary not found' })
    }

    // Get linked bills
    const bills = db.prepare(`
      SELECT 
        b.bill_number,
        b.display_name,
        b.total_amount,
        b.closed_at,
        p.payment_method
      FROM pos_daily_sales_bills dsb
      JOIN pos_running_bills b ON dsb.bill_id = b.id
      LEFT JOIN pos_payments p ON b.id = p.bill_id
      WHERE dsb.daily_sales_id = ?
      ORDER BY b.closed_at ASC
    `).all(id)

    // Get sales by product
    const products = db.prepare(`
      SELECT 
        bi.product_name,
        SUM(bi.quantity) as total_qty,
        SUM(bi.total_price) as total_amount,
        p.category as product_category
      FROM pos_daily_sales_bills dsb
      JOIN pos_running_bills b ON dsb.bill_id = b.id
      JOIN pos_bill_items bi ON b.id = bi.bill_id
      LEFT JOIN pos_menu_configs pmc ON bi.pos_menu_id = pmc.id
      LEFT JOIN products p ON pmc.product_id = p.id
      WHERE dsb.daily_sales_id = ?
      GROUP BY bi.product_name
      ORDER BY total_amount DESC
    `).all(id)

    // Get payment breakdown
    const payments = db.prepare(`
      SELECT 
        p.payment_method,
        COUNT(*) as count,
        SUM(p.amount) as total_amount
      FROM pos_daily_sales_bills dsb
      JOIN pos_running_bills b ON dsb.bill_id = b.id
      JOIN pos_payments p ON b.id = p.bill_id
      WHERE dsb.daily_sales_id = ?
      GROUP BY p.payment_method
    `).all(id)

    res.json({
      success: true,
      data: {
        ...summary,
        bills,
        products,
        payments
      }
    })
  } catch (error) {
    console.error('Get POS daily sales detail error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch daily sales detail' })
  }
})

// POST create daily sales summary (Close Day)
router.post('/pos-daily-sales', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = req.user!.userId
    const { sales_date, notes } = req.body

    const targetDate = sales_date || new Date().toISOString().split('T')[0]

    // Check if already closed for this date
    const existingCheck = db.prepare(`
      SELECT id FROM pos_daily_sales 
      WHERE tenant_id = ? AND sales_date = ?
    `).get(tenantId, targetDate)

    if (existingCheck) {
      return res.status(400).json({ 
        success: false, 
        message: 'This date has already been closed. Please use a different date.' 
      })
    }

    // Get all paid bills not yet included in any summary (regardless of date)
    // User selects the sales_date for the shift — don't filter by closed_at date
    const bills = db.prepare(`
      SELECT
        b.*,
        p.payment_method,
        p.amount as payment_amount
      FROM pos_running_bills b
      JOIN pos_payments p ON b.id = p.bill_id
      WHERE b.tenant_id = ?
        AND b.status = 'PAID'
        AND b.id NOT IN (
          SELECT bill_id FROM pos_daily_sales_bills
        )
    `).all(tenantId) as any[]

    if (bills.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'ไม่มีบิลที่ชำระแล้วที่รอปิดกะ'
      })
    }

    // Calculate totals
    let totalRevenue = 0
    let totalTax = 0
    let totalServiceCharge = 0
    let totalDiscount = 0
    let estimatedCOGS = 0

    // Payment method breakdown
    const paymentBreakdown: Record<string, number> = {}

    for (const bill of bills) {
      totalRevenue += bill.total_amount
      totalTax += bill.tax_amount || 0
      totalServiceCharge += bill.service_charge_amount || 0
      totalDiscount += bill.discount_amount || 0

      // Calculate estimated COGS from bill items
      const items = db.prepare(`
        SELECT bi.*, pmc.bom_id
        FROM pos_bill_items bi
        LEFT JOIN pos_menu_configs pmc ON bi.pos_menu_id = pmc.id
        WHERE bi.bill_id = ?
      `).all(bill.id) as any[]

      for (const item of items) {
        let itemCost = 0

        if (item.bom_id) {
          const bomItems = db.prepare(`
            SELECT bi.quantity, si.unit_cost
            FROM bom_items bi
            JOIN stock_items si ON bi.material_id = si.id
            WHERE bi.bom_id = ? AND bi.item_type = 'MATERIAL'
          `).all(item.bom_id) as any[]

          for (const bi of bomItems) {
            itemCost += (bi.quantity * bi.unit_cost)
          }
        } else {
          const ingItems = db.prepare(`
            SELECT pmi.quantity_used, si.unit_cost
            FROM pos_menu_ingredients pmi
            JOIN stock_items si ON pmi.stock_item_id = si.id
            WHERE pmi.pos_menu_id = ?
          `).all(item.pos_menu_id) as any[]

          for (const ing of ingItems) {
            itemCost += (ing.quantity_used * ing.unit_cost)
          }
        }

        estimatedCOGS += (itemCost * item.quantity)
      }

      // Payment breakdown
      const method = bill.payment_method || 'CASH'
      paymentBreakdown[method] = (paymentBreakdown[method] || 0) + bill.payment_amount
    }

    const netProfit = totalRevenue - estimatedCOGS

    // Generate summary number
    const count = (db.prepare(`SELECT COUNT(*) as count FROM pos_daily_sales WHERE tenant_id = ?`).get(tenantId) as any).count
    const summaryNumber = `POS-SUM-${targetDate.replace(/-/g, '')}-${String(count + 1).padStart(3, '0')}`

    // Create summary
    const summaryId = generateId()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO pos_daily_sales (
        id, tenant_id, summary_number, sales_date,
        total_revenue, total_tax, total_service_charge, total_discount,
        estimated_cogs, net_profit,
        cash_amount, bank_amount, other_amount,
        bill_count, notes, closed_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      summaryId,
      tenantId,
      summaryNumber,
      targetDate,
      totalRevenue,
      totalTax,
      totalServiceCharge,
      totalDiscount,
      estimatedCOGS,
      netProfit,
      paymentBreakdown['CASH'] || 0,
      paymentBreakdown['QR_CODE'] || paymentBreakdown['TRANSFER'] || 0,
      paymentBreakdown['CREDIT_CARD'] || 0,
      bills.length,
      notes || null,
      userId,
      now
    )

    // Link bills to summary
    const linkStmt = db.prepare(`
      INSERT INTO pos_daily_sales_bills (id, tenant_id, daily_sales_id, bill_id, amount)
      VALUES (?, ?, ?, ?, ?)
    `)

    for (const bill of bills) {
      linkStmt.run(generateId(), tenantId, summaryId, bill.id, bill.total_amount)
    }

    res.json({
      success: true,
      message: 'Daily sales summary created successfully',
      data: {
        id: summaryId,
        summary_number: summaryNumber,
        sales_date: targetDate,
        total_revenue: totalRevenue,
        estimated_cogs: estimatedCOGS,
        net_profit: netProfit,
        bill_count: bills.length
      }
    })
  } catch (error) {
    console.error('Create POS daily sales error:', error)
    res.status(500).json({ success: false, message: 'Failed to create daily sales summary' })
  }
})

// ============================================
// POS SHIFTS (เปิด/ปิดกะ)
// ============================================

// GET current open shift
router.get('/pos-shifts/current', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const shift = db.prepare(`
      SELECT s.*, u.name as opened_by_name
      FROM pos_shifts s
      LEFT JOIN users u ON s.opened_by = u.id
      WHERE s.tenant_id = ? AND s.status = 'OPEN'
      ORDER BY s.opened_at DESC LIMIT 1
    `).get(tenantId) as any

    if (!shift) return res.json({ success: true, data: null })

    // Attach current sales summary from bills since shift opened
    const sales = db.prepare(`
      SELECT
        COUNT(*) as bill_count,
        COALESCE(SUM(b.total_amount), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN p.payment_method = 'CASH' THEN b.total_amount ELSE 0 END), 0) as cash_revenue,
        COALESCE(SUM(CASE WHEN p.payment_method != 'CASH' THEN b.total_amount ELSE 0 END), 0) as bank_revenue
      FROM pos_running_bills b
      LEFT JOIN pos_payments p ON b.id = p.bill_id
      WHERE b.tenant_id = ? AND b.status = 'PAID' AND b.closed_at >= ?
    `).get(tenantId, shift.opened_at) as any

    res.json({ success: true, data: { ...shift, live: sales } })
  } catch (error) {
    console.error('Get current shift error:', error)
    res.status(500).json({ success: false, message: 'Failed to get current shift' })
  }
})

// GET shift list
router.get('/pos-shifts', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { limit = 20 } = req.query
    const shifts = db.prepare(`
      SELECT s.*, uo.name as opened_by_name, uc.name as closed_by_name
      FROM pos_shifts s
      LEFT JOIN users uo ON s.opened_by = uo.id
      LEFT JOIN users uc ON s.closed_by = uc.id
      WHERE s.tenant_id = ?
      ORDER BY s.opened_at DESC
      LIMIT ?
    `).all(tenantId, parseInt(limit as string)) as any[]

    res.json({ success: true, data: shifts })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get shifts' })
  }
})

// POST open shift
router.post('/pos-shifts/open', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = req.user!.userId
    const { opening_cash, notes } = req.body

    if (opening_cash === undefined || opening_cash === null) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุเงินสดเปิดกะ' })
    }

    // Check no open shift already
    const existing = db.prepare(`SELECT id FROM pos_shifts WHERE tenant_id = ? AND status = 'OPEN'`).get(tenantId)
    if (existing) {
      return res.status(400).json({ success: false, message: 'มีกะที่เปิดอยู่แล้ว กรุณาปิดกะก่อน' })
    }

    const count = (db.prepare(`SELECT COUNT(*) as c FROM pos_shifts WHERE tenant_id = ?`).get(tenantId) as any).c
    const shiftNumber = `SHIFT-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`
    const id = generateId()
    const nowStr = new Date().toISOString()

    db.prepare(`
      INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, opening_cash, opened_by, notes, created_at)
      VALUES (?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)
    `).run(id, tenantId, shiftNumber, nowStr, opening_cash, userId, notes || null, nowStr)

    res.json({ success: true, message: 'เปิดกะสำเร็จ', data: { id, shift_number: shiftNumber, opened_at: nowStr } })
  } catch (error) {
    console.error('Open shift error:', error)
    res.status(500).json({ success: false, message: 'Failed to open shift' })
  }
})

// POST close shift
router.post('/pos-shifts/:id/close', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = req.user!.userId
    const { id } = req.params
    const { closing_cash_counted, notes } = req.body

    if (closing_cash_counted === undefined || closing_cash_counted === null) {
      return res.status(400).json({ success: false, message: 'กรุณานับและกรอกเงินสดในลิ้นชัก' })
    }

    const shift = db.prepare(`SELECT * FROM pos_shifts WHERE id = ? AND tenant_id = ? AND status = 'OPEN'`).get(id, tenantId) as any
    if (!shift) return res.status(404).json({ success: false, message: 'ไม่พบกะที่เปิดอยู่' })

    // Calculate sales in this shift
    const sales = db.prepare(`
      SELECT
        COUNT(*) as bill_count,
        COALESCE(SUM(b.total_amount), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN p.payment_method = 'CASH' THEN b.total_amount ELSE 0 END), 0) as cash_revenue,
        COALESCE(SUM(CASE WHEN p.payment_method != 'CASH' THEN b.total_amount ELSE 0 END), 0) as bank_revenue
      FROM pos_running_bills b
      LEFT JOIN pos_payments p ON b.id = p.bill_id
      WHERE b.tenant_id = ? AND b.status = 'PAID' AND b.closed_at >= ?
    `).get(tenantId, shift.opened_at) as any

    const expectedCash = (shift.opening_cash || 0) + (sales.cash_revenue || 0)
    const cashDifference = closing_cash_counted - expectedCash
    const nowStr = new Date().toISOString()

    db.prepare(`
      UPDATE pos_shifts SET
        status = 'CLOSED', closed_at = ?,
        closing_cash_counted = ?, expected_cash = ?, cash_difference = ?,
        total_revenue = ?, cash_revenue = ?, bank_revenue = ?,
        bill_count = ?, closed_by = ?,
        notes = COALESCE(?, notes)
      WHERE id = ?
    `).run(
      nowStr, closing_cash_counted, expectedCash, cashDifference,
      sales.total_revenue, sales.cash_revenue, sales.bank_revenue,
      sales.bill_count, userId, notes || null, id
    )

    res.json({
      success: true,
      message: 'ปิดกะสำเร็จ',
      data: {
        shift_number: shift.shift_number,
        total_revenue: sales.total_revenue,
        cash_revenue: sales.cash_revenue,
        bank_revenue: sales.bank_revenue,
        bill_count: sales.bill_count,
        expected_cash: expectedCash,
        closing_cash_counted,
        cash_difference: cashDifference
      }
    })
  } catch (error) {
    console.error('Close shift error:', error)
    res.status(500).json({ success: false, message: 'Failed to close shift' })
  }
})

// ============================================
// POS BILL VOID
// ============================================

// Void a paid POS bill (only if not yet cleared)
router.post('/pos-running-bills/:id/void', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = req.user!.userId
    const { id } = req.params
    const { reason } = req.body

    const bill = db.prepare(`
      SELECT b.*, p.payment_method
      FROM pos_running_bills b
      LEFT JOIN pos_payments p ON b.id = p.bill_id
      WHERE b.id = ? AND b.tenant_id = ?
    `).get(id, tenantId) as any

    if (!bill) {
      return res.status(404).json({ success: false, message: 'ไม่พบบิล' })
    }
    if (bill.status !== 'PAID') {
      return res.status(400).json({ success: false, message: 'ยกเลิกได้เฉพาะบิลที่ชำระแล้วเท่านั้น' })
    }

    const alreadyCleared = db.prepare(`
      SELECT id FROM pos_clearing_transfer_items WHERE bill_id = ? AND tenant_id = ?
    `).get(id, tenantId)
    if (alreadyCleared) {
      return res.status(400).json({ success: false, message: 'บิลนี้นำเงินเข้าบัญชีแล้ว ไม่สามารถยกเลิกได้' })
    }

    const nowStr = new Date().toISOString()
    const voidNote = reason ? `[VOID] ${reason}` : '[VOID]'

    db.prepare(`
      UPDATE pos_running_bills SET status = 'VOID', updated_at = ? WHERE id = ?
    `).run(nowStr, id)

    // Reversal journal: Dr. Revenue 4100, Cr. Clearing 1180
    const getOrCreate = (code: string, name: string, type: string, category: string, normalBalance: string) => {
      const existing = db.prepare('SELECT id FROM accounts WHERE code = ? AND tenant_id = ?').get(code, tenantId) as any
      if (existing) return existing.id
      const newId = generateId()
      db.prepare(`
        INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, is_active, is_system)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)
      `).run(newId, tenantId, code, name, type, category, normalBalance)
      return newId
    }

    const year = new Date().getFullYear()
    const prefix = `JV-${year}-`
    const last = db.prepare(`
      SELECT entry_number FROM journal_entries
      WHERE tenant_id = ? AND entry_number LIKE ? ORDER BY entry_number DESC LIMIT 1
    `).get(tenantId, `${prefix}%`) as any
    let seq = 1
    if (last) {
      const m = last.entry_number.match(/-(\d+)$/)
      if (m) seq = parseInt(m[1]) + 1
    }
    const entryNumber = `${prefix}${String(seq).padStart(6, '0')}`
    const entryId = generateId()
    const date = nowStr.split('T')[0]

    db.prepare(`
      INSERT INTO journal_entries (
        id, tenant_id, entry_number, date, reference_type, reference_id,
        description, total_debit, total_credit, is_auto_generated, created_by, created_at
      ) VALUES (?, ?, ?, ?, 'POS_VOID', ?, ?, ?, ?, 1, ?, ?)
    `).run(
      entryId, tenantId, entryNumber, date, id,
      `ยกเลิกบิล ${bill.bill_number}${reason ? ' - ' + reason : ''}`,
      bill.total_amount, bill.total_amount, userId, nowStr
    )

    const revenueId = getOrCreate('4100', 'รายได้ขาย', 'REVENUE', 'REVENUE', 'CREDIT')
    const clearingId = getOrCreate('1180', 'ลูกหนี้การค้า-POS', 'ASSET', 'CURRENT_ASSET', 'DEBIT')

    db.prepare(`
      INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
      VALUES (?, ?, ?, ?, 1, ?, ?, 0)
    `).run(generateId(), tenantId, entryId, revenueId, `ยกเลิกบิล ${bill.bill_number}`, bill.total_amount)

    db.prepare(`
      INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
      VALUES (?, ?, ?, ?, 2, ?, 0, ?)
    `).run(generateId(), tenantId, entryId, clearingId, `ยกเลิก Clearing ${bill.bill_number}`, bill.total_amount)

    // Update account balances (reverse)
    const updateBal = (code: string, debit: number, credit: number) => {
      const yr = parseInt(date.split('-')[0])
      const mo = parseInt(date.split('-')[1])
      const acc = db.prepare('SELECT id FROM accounts WHERE code = ? AND tenant_id = ?').get(code, tenantId) as any
      if (!acc) return
      const existing = db.prepare(`
        SELECT id FROM account_balances WHERE account_id = ? AND fiscal_year = ? AND period = ?
      `).get(acc.id, yr, mo)
      if (existing) {
        db.prepare(`
          UPDATE account_balances
          SET debit_amount = debit_amount + ?, credit_amount = credit_amount + ?,
              ending_balance = ending_balance + ? - ?
          WHERE account_id = ? AND fiscal_year = ? AND period = ?
        `).run(debit, credit, debit, credit, acc.id, yr, mo)
      } else {
        db.prepare(`
          INSERT INTO account_balances (id, tenant_id, account_id, fiscal_year, period, beginning_balance, debit_amount, credit_amount, ending_balance)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
        `).run(generateId(), tenantId, acc.id, yr, mo, debit, credit, debit - credit)
      }
    }

    updateBal('4100', bill.total_amount, 0)  // Dr. Revenue (reduces net revenue)
    updateBal('1180', 0, bill.total_amount)  // Cr. Clearing (reduces receivable)

    res.json({
      success: true,
      message: `ยกเลิกบิล ${bill.bill_number} สำเร็จ`,
      data: { bill_id: id, bill_number: bill.bill_number, amount: bill.total_amount, void_note: voidNote }
    })
  } catch (error) {
    console.error('Void bill error:', error)
    res.status(500).json({ success: false, message: 'ยกเลิกบิลไม่สำเร็จ' })
  }
})

// ─── Invoice Attachment Endpoints ─────────────────────────────────────────────

// POST upload attachment
router.post('/invoices/:id/attachments', (req: Request, res: Response, next: any) => {
  invoiceUpload.single('image')(req, res, (err: any) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ success: false, message: 'ไฟล์ใหญ่เกินไป (สูงสุด 10MB)' })
    if (err) return res.status(400).json({ success: false, message: err.message })
    next()
  })
}, async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params
    const file = req.file
    if (!file) return res.status(400).json({ success: false, message: 'ไม่พบไฟล์' })

    const invoice = db.prepare('SELECT id FROM invoices WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' })

    const attachmentId = generateId()
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO invoice_attachments (id, tenant_id, invoice_id, file_path, original_name, file_size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(attachmentId, tenantId, id, file.filename, file.originalname, file.size, now)

    res.json({ success: true, data: { id: attachmentId, file_path: file.filename, original_name: file.originalname, file_size: file.size, created_at: now } })
  } catch (error) {
    console.error('Upload attachment error:', error)
    res.status(500).json({ success: false, message: 'Upload failed' })
  }
})

// DELETE attachment
router.delete('/invoices/:id/attachments/:attachmentId', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { attachmentId } = req.params
    const row = db.prepare('SELECT * FROM invoice_attachments WHERE id = ? AND tenant_id = ?').get(attachmentId, tenantId) as any
    if (!row) return res.status(404).json({ success: false, message: 'Attachment not found' })

    const filePath = path.resolve(invoiceUploadDir, row.file_path)
    if (filePath.startsWith(path.resolve(invoiceUploadDir)) && fs.existsSync(filePath)) fs.unlinkSync(filePath)
    db.prepare('DELETE FROM invoice_attachments WHERE id = ?').run(attachmentId)

    res.json({ success: true })
  } catch (error) {
    console.error('Delete attachment error:', error)
    res.status(500).json({ success: false, message: 'Delete failed' })
  }
})

export default router
