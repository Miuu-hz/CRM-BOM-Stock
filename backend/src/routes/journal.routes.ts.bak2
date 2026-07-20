import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
import { ACC } from '../config/accountCodes'
import type { JournalEntry, JournalLineWithAccount } from '../types'

const router = Router()

router.use(authenticate)

interface JournalLineInput {
  accountId: string
  description?: string
  debit?: number
  credit?: number
}

// Generate entry number: JV-YYYY-XXXXX
function generateEntryNumber(tenantId: string, date: string): string {
  const year = new Date(date).getFullYear()
  return formatDocumentNumber('JV', tenantId, 'JOURNAL', year, 5)
}

// ============================================
// JOURNAL ENTRIES - สมุดรายวัน
// ============================================

// Get all journal entries
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { startDate, endDate, isPosted, referenceType, accountId } = req.query
    
    let query = `
      SELECT je.*,
             (SELECT COUNT(*) FROM journal_lines WHERE journal_entry_id = je.id) as line_count
      FROM journal_entries je
      WHERE je.tenant_id = ?
    `
    const params: Array<string | number> = [tenantId]

    if (startDate) {
      query += ' AND je.date >= ?'
      params.push(startDate as string)
    }
    
    if (endDate) {
      query += ' AND je.date <= ?'
      params.push(endDate as string)
    }
    
    if (isPosted !== undefined) {
      query += ' AND je.is_posted = ?'
      params.push(isPosted === 'true' ? 1 : 0)
    }
    
    if (referenceType) {
      query += ' AND je.reference_type = ?'
      params.push(referenceType as string)
    }
    
    query += ' ORDER BY je.date DESC, je.created_at DESC'
    
    const entries = db.prepare(query).all(...params) as JournalEntry[]

    // If accountId specified, filter entries that have lines with that account
    let filteredEntries = entries
    if (accountId) {
      const entryIdsWithAccount = db.prepare(`
        SELECT DISTINCT journal_entry_id
        FROM journal_lines
        WHERE account_id = ?
      `).all(accountId as string).map((r: { journal_entry_id: string }) => r.journal_entry_id)
      
      filteredEntries = entries.filter(e => entryIdsWithAccount.includes(e.id))
    }
    
    res.json({
      success: true,
      data: filteredEntries
    })
  } catch (error) {
    console.error('Get journal entries error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch journal entries' })
  }
})

// Get journal entry by ID with lines
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const entry = db.prepare(`
      SELECT * FROM journal_entries WHERE id = ? AND tenant_id = ?
    `).get(req.params.id, tenantId) as JournalEntry | undefined

    if (!entry) {
      return res.status(404).json({ success: false, message: 'Journal entry not found' })
    }
    
    const lines = db.prepare(`
      SELECT jl.*,
             a.code as account_code,
             a.name as account_name,
             a.type as account_type,
             a.normal_balance as account_normal_balance
      FROM journal_lines jl
      JOIN accounts a ON jl.account_id = a.id
      WHERE jl.journal_entry_id = ?
      ORDER BY jl.line_number
    `).all(req.params.id) as JournalLineWithAccount[]
    
    res.json({
      success: true,
      data: {
        ...entry,
        lines
      }
    })
  } catch (error) {
    console.error('Get journal entry error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch journal entry' })
  }
})

// Create journal entry
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = req.user!.userId
    const userName = req.user!.email
    
    const { date, description, referenceType, referenceId, notes, lines } = req.body
    
    // Validation
    if (!date || !description || !lines || lines.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Date, description, and at least 2 journal lines are required'
      })
    }
    
    // Validate lines balance
    const typedLines = lines as JournalLineInput[]
    const totalDebit = typedLines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0)
    const totalCredit = typedLines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0)
    
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return res.status(400).json({
        success: false,
        message: `Journal entry is not balanced. Debit: ${totalDebit}, Credit: ${totalCredit}`
      })
    }
    
    const id = generateId()
    const entryNumber = generateEntryNumber(tenantId, date)
    const now = new Date().toISOString()
    
    const insertTransaction = db.transaction(() => {
      // Insert journal entry
      db.prepare(`
        INSERT INTO journal_entries 
        (id, tenant_id, entry_number, date, reference_type, reference_id, description, 
         total_debit, total_credit, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tenantId, entryNumber, date, referenceType || null, referenceId || null,
             description, totalDebit, totalCredit, notes || null, userName, now, now)
      
      // Insert journal lines
      const insertLine = db.prepare(`
        INSERT INTO journal_lines 
        (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      
      for (let i = 0; i < typedLines.length; i++) {
        const line = typedLines[i]

        // Validate account exists
        const account = db.prepare('SELECT id FROM accounts WHERE id = ? AND tenant_id = ?').get(line.accountId, tenantId)
        if (!account) {
          throw new Error(`Account ${line.accountId} not found`)
        }
        
        // Skip empty lines
        if ((!line.debit || line.debit === 0) && (!line.credit || line.credit === 0)) {
          continue
        }
        
        insertLine.run(
          generateId(), tenantId, id, line.accountId, i + 1, 
          line.description || null, line.debit || 0, line.credit || 0
        )
      }
    })
    
    insertTransaction()
    
    res.json({
      success: true,
      message: 'Journal entry created successfully',
      data: { id, entryNumber }
    })
  } catch (error) {
    console.error('Create journal entry error:', error)
    res.status(500).json({ success: false, message: (error as Error).message || 'Failed to create journal entry' })
  }
})

// Update journal entry (only if not posted)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { date, description, notes, lines } = req.body
    
    const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as JournalEntry | undefined
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Journal entry not found' })
    }
    
    if (entry.is_posted) {
      return res.status(400).json({ success: false, message: 'Cannot edit posted journal entry' })
    }
    
    const now = new Date().toISOString()
    
    const updateTransaction = db.transaction(() => {
      // Update header
      db.prepare(`
        UPDATE journal_entries 
        SET date = COALESCE(?, date),
            description = COALESCE(?, description),
            notes = COALESCE(?, notes),
            updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(date, description, notes, now, req.params.id, tenantId)
      
      // Update lines if provided
      if (lines) {
        // Validate balance
        const typedLines = lines as JournalLineInput[]
        const totalDebit = typedLines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0)
        const totalCredit = typedLines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0)
        
        if (Math.abs(totalDebit - totalCredit) > 0.01) {
          throw new Error(`Journal entry is not balanced. Debit: ${totalDebit}, Credit: ${totalCredit}`)
        }
        
        // Delete old lines
        db.prepare('DELETE FROM journal_lines WHERE journal_entry_id = ? AND tenant_id = ?').run(req.params.id, tenantId)
        
        // Insert new lines
        const insertLine = db.prepare(`
          INSERT INTO journal_lines 
          (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        
        for (let i = 0; i < typedLines.length; i++) {
          const line = typedLines[i]

          if ((!line.debit || line.debit === 0) && (!line.credit || line.credit === 0)) {
            continue
          }

          insertLine.run(
            generateId(), tenantId, req.params.id, line.accountId, i + 1,
            line.description || null, line.debit || 0, line.credit || 0
          )
        }
        
        // Update totals
        db.prepare(`
          UPDATE journal_entries SET total_debit = ?, total_credit = ? WHERE id = ? AND tenant_id = ?
        `).run(totalDebit, totalCredit, req.params.id, tenantId)
      }
    })
    
    updateTransaction()
    
    res.json({ success: true, message: 'Journal entry updated successfully' })
  } catch (error) {
    console.error('Update journal entry error:', error)
    res.status(500).json({ success: false, message: (error as Error).message || 'Failed to update journal entry' })
  }
})

// Post journal entry (confirm and lock)
router.post('/:id/post', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userName = req.user!.email
    
    const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as JournalEntry | undefined
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Journal entry not found' })
    }
    
    if (entry.is_posted) {
      return res.status(400).json({ success: false, message: 'Journal entry already posted' })
    }
    
    const now = new Date().toISOString()
    
    db.prepare(`
      UPDATE journal_entries 
      SET is_posted = 1, posted_at = ?, posted_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(now, userName, now, req.params.id, tenantId)
    
    res.json({ success: true, message: 'Journal entry posted successfully' })
  } catch (error) {
    console.error('Post journal entry error:', error)
    res.status(500).json({ success: false, message: (error as Error).message || 'Failed to post journal entry' })
  }
})

// Unpost journal entry (admin only - for corrections)
router.post('/:id/unpost', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userRole = req.user!.role
    
    // Only admin can unpost
    if (userRole !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Only admin can unpost journal entries' })
    }
    
    const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as JournalEntry | undefined
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Journal entry not found' })
    }
    
    if (!entry.is_posted) {
      return res.status(400).json({ success: false, message: 'Journal entry is not posted' })
    }
    
    const now = new Date().toISOString()
    
    db.prepare(`
      UPDATE journal_entries 
      SET is_posted = 0, posted_at = NULL, posted_by = NULL, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(now, req.params.id, tenantId)
    
    res.json({ success: true, message: 'Journal entry unposted successfully' })
  } catch (error) {
    console.error('Unpost journal entry error:', error)
    res.status(500).json({ success: false, message: (error as Error).message || 'Failed to unpost journal entry' })
  }
})

// Delete journal entry (only if not posted)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as JournalEntry | undefined
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Journal entry not found' })
    }
    
    if (entry.is_posted) {
      return res.status(400).json({ success: false, message: 'Cannot delete posted journal entry' })
    }
    
    const deleteTransaction = db.transaction(() => {
      db.prepare('DELETE FROM journal_lines WHERE journal_entry_id = ? AND tenant_id = ?').run(req.params.id, tenantId)
      db.prepare('DELETE FROM journal_entries WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)
    })
    
    deleteTransaction()
    
    res.json({ success: true, message: 'Journal entry deleted successfully' })
  } catch (error) {
    console.error('Delete journal entry error:', error)
    res.status(500).json({ success: false, message: (error as Error).message || 'Failed to delete journal entry' })
  }
})

// ============================================
// AUTO-GENERATED JOURNALS
// ============================================

// Generate journal from Purchase Order
router.post('/auto/purchase-order', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { purchaseOrderId, date } = req.body
    
    // Get PO details
    const po = db.prepare(`
      SELECT po.*, s.name as supplier_name
      FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
      WHERE po.id = ? AND po.tenant_id = ?
    `).get(purchaseOrderId, tenantId) as (Record<string, unknown> & { supplier_name: string }) | undefined

    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' })
    }
    
    // Get PO items
    const items = db.prepare(`
      SELECT poi.*, m.name as material_name
      FROM purchase_order_items poi
      JOIN materials m ON poi.material_id = m.id
      WHERE poi.purchase_order_id = ?
    `).all(purchaseOrderId) as Record<string, unknown>[]

    // Find accounts
    const inventoryAccount = db.prepare(`SELECT id FROM accounts WHERE code = ? AND tenant_id = ?`).get(ACC.RAW_MATERIAL, tenantId) as { id: string } | undefined // สต็อกวัตถุดิบ
    const vatAccount = db.prepare(`SELECT id FROM accounts WHERE code = ? AND tenant_id = ?`).get(ACC.INPUT_VAT, tenantId) as { id: string } | undefined // ภาษีซื้อ
    const payableAccount = db.prepare(`SELECT id FROM accounts WHERE code = ? AND tenant_id = ?`).get(ACC.AP, tenantId) as { id: string } | undefined // เจ้าหนี้การค้า
    
    if (!inventoryAccount || !vatAccount || !payableAccount) {
      return res.status(400).json({ 
        success: false, 
        message: 'Required accounts not found. Please initialize chart of accounts first.' 
      })
    }
    
    const lines = [
      {
        accountId: inventoryAccount.id,
        description: `สต็อกวัตถุดิบ - PO ${po.po_number}`,
        debit: po.subtotal,
        credit: 0
      },
      {
        accountId: vatAccount.id,
        description: `ภาษีซื้อ - PO ${po.po_number}`,
        debit: po.tax_amount,
        credit: 0
      },
      {
        accountId: payableAccount.id,
        description: `เจ้าหนี้การค้า - ${po.supplier_name} - PO ${po.po_number}`,
        debit: 0,
        credit: po.total_amount
      }
    ]
    
    res.json({
      success: true,
      data: {
        description: `รับสินค้า - PO ${po.po_number}`,
        referenceType: 'PURCHASE_ORDER',
        referenceId: purchaseOrderId,
        lines,
        totalDebit: po.total_amount,
        totalCredit: po.total_amount
      }
    })
  } catch (error) {
    console.error('Generate PO journal error:', error)
    res.status(500).json({ success: false, message: (error as Error).message || 'Failed to generate journal' })
  }
})

// Generate journal from Sales
router.post('/auto/sales', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { orderId } = req.body
    
    // Get order details
    const order = db.prepare(`
      SELECT o.*, c.name as customer_name
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE o.id = ?
    `).get(orderId) as (Record<string, unknown> & { customer_name: string }) | undefined

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' })
    }
    
    // Find accounts
    const receivableAccount = db.prepare(`SELECT id FROM accounts WHERE code = ? AND tenant_id = ?`).get(ACC.AR, tenantId) as { id: string } | undefined // ลูกหนี้การค้า
    const vatAccount = db.prepare(`SELECT id FROM accounts WHERE code = ? AND tenant_id = ?`).get(ACC.OUTPUT_VAT, tenantId) as { id: string } | undefined // ภาษีขาย
    const revenueAccount = db.prepare(`SELECT id FROM accounts WHERE code = ? AND tenant_id = ?`).get(ACC.REVENUE_PRODUCT, tenantId) as { id: string } | undefined // รายได้ขายสินค้า
    const cogsAccount = db.prepare(`SELECT id FROM accounts WHERE code = ? AND tenant_id = ?`).get(ACC.COGS_PRODUCT, tenantId) as { id: string } | undefined // ต้นทุนสินค้าขาย
    const inventoryAccount = db.prepare(`SELECT id FROM accounts WHERE code = ? AND tenant_id = ?`).get(ACC.INVENTORY, tenantId) as { id: string } | undefined // สต็อกสินค้า
    
    if (!receivableAccount || !vatAccount || !revenueAccount) {
      return res.status(400).json({ 
        success: false, 
        message: 'Required accounts not found. Please initialize chart of accounts first.' 
      })
    }
    
    // Calculate amounts (simplified - assuming 7% VAT)
    const taxRate = 0.07
    const subtotal = (order as any).total_amount / (1 + taxRate)
    const taxAmount = (order as any).total_amount - subtotal
    
    // Revenue entry
    const revenueLines = [
      {
        accountId: receivableAccount.id,
        description: `ลูกหนี้การค้า - ${order.customer_name} - Order ${order.order_number}`,
        debit: (order as any).total_amount,
        credit: 0
      },
      {
        accountId: revenueAccount.id,
        description: `รายได้ขายสินค้า - Order ${order.order_number}`,
        debit: 0,
        credit: subtotal
      },
      {
        accountId: vatAccount.id,
        description: `ภาษีขาย - Order ${order.order_number}`,
        debit: 0,
        credit: taxAmount
      }
    ]
    
    res.json({
      success: true,
      data: {
        description: `ขายสินค้า - Order ${order.order_number}`,
        referenceType: 'SALES_ORDER',
        referenceId: orderId,
        lines: revenueLines,
        totalDebit: (order as any).total_amount,
        totalCredit: (order as any).total_amount
      }
    })
  } catch (error) {
    console.error('Generate sales journal error:', error)
    res.status(500).json({ success: false, message: (error as Error).message || 'Failed to generate journal' })
  }
})

export default router
