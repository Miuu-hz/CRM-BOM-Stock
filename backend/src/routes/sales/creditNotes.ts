import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { generateId, formatDocumentNumber } from '../../utils/id'

const router = Router()

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
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { invoiceId, customerId, reason, notes, items, taxRate } = req.body
    
    if (!invoiceId || !reason) {
      return res.status(400).json({ success: false, message: 'Invoice and reason are required' })
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
        const insertItem = db.prepare(`
          INSERT INTO credit_note_items (id, tenant_id, credit_note_id, invoice_item_id, product_id, quantity, unit, unit_price, reason, total_price)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          const total = item.quantity * item.unitPrice
          insertItem.run(generateId(), tenantId, id, item.invoiceItemId, item.productId,
            item.quantity, item.unit || '', item.unitPrice, item.reason || '', total)
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

export default router
