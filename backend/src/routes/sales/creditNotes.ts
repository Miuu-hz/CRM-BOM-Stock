import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { generateId, formatDocumentNumber } from '../../utils/id'
import { ACC, ACC_META } from '../../config/accountCodes'
import { getOrCreateAccount, updateAccountBalance } from './shared'

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
