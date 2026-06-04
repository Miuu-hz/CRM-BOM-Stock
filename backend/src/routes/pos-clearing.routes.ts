import { Router } from 'express'
import db from '../db/sqlite'

const router = Router()

// Helper: Generate ID (24-char hex)
const generateId = () => {
  const chars = '0123456789abcdef'
  let id = ''
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

const now = () => new Date().toISOString()

// ==================== CLEARING BALANCE ====================

// Get current clearing balance summary
router.get('/clearing/balance', (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    
    // Get total pending in clearing
    const pendingStmt = db.prepare(`
      SELECT 
        COUNT(*) as bill_count,
        SUM(total_amount) as total_amount
      FROM pos_running_bills
      WHERE tenant_id = ? AND status = 'PAID'
        AND id NOT IN (
          SELECT DISTINCT bill_id FROM pos_clearing_transfer_items 
          WHERE tenant_id = ?
        )
    `)
    const pending = pendingStmt.get(tenantId, tenantId)
    
    // Get already transferred
    const transferredStmt = db.prepare(`
      SELECT 
        COUNT(*) as transfer_count,
        SUM(total_amount) as total_transferred
      FROM pos_clearing_transfers
      WHERE tenant_id = ?
    `)
    const transferred = transferredStmt.get(tenantId)
    
    // Get recent transfers
    const recentStmt = db.prepare(`
      SELECT 
        t.*,
        u.name as created_by_name
      FROM pos_clearing_transfers t
      LEFT JOIN users u ON t.created_by = u.id
      WHERE t.tenant_id = ?
      ORDER BY t.transfer_date DESC
      LIMIT 10
    `)
    const recentTransfers = recentStmt.all(tenantId)
    
    res.json({
      success: true,
      data: {
        pending: {
          billCount: pending?.bill_count || 0,
          totalAmount: pending?.total_amount || 0
        },
        transferred: {
          transferCount: transferred?.transfer_count || 0,
          totalAmount: transferred?.total_transferred || 0
        },
        recentTransfers
      }
    })
  } catch (error) {
    console.error('Error fetching clearing balance:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch clearing balance' })
  }
})

// Get pending bills for transfer (optionally filtered by date)
router.get('/clearing/pending-bills', (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const { date } = req.query as { date?: string }

    let query = `
      SELECT
        b.*,
        p.payment_method
      FROM pos_running_bills b
      LEFT JOIN pos_payments p ON b.id = p.bill_id
      WHERE b.tenant_id = ?
        AND b.status = 'PAID'
        AND b.id NOT IN (
          SELECT DISTINCT bill_id FROM pos_clearing_transfer_items
          WHERE tenant_id = ?
        )
    `
    const params: any[] = [tenantId, tenantId]

    if (date) {
      query += ' AND DATE(b.closed_at) = ?'
      params.push(date)
    }

    query += ' ORDER BY b.closed_at ASC'

    const bills = db.prepare(query).all(...params)
    res.json({ success: true, data: bills })
  } catch (error) {
    console.error('Error fetching pending bills:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch pending bills' })
  }
})

// ==================== CLEARING TRANSFER ====================

// Create transfer (End of Day close)
router.post('/clearing/transfer', (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const userId = (req as any).user?.id || 'system'
    const { 
      transfer_date, 
      cash_amount, 
      bank_amount, 
      bill_ids,
      reference,
      notes 
    } = req.body
    
    if (!transfer_date || (cash_amount === undefined && bank_amount === undefined)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Transfer date and at least one amount (cash or bank) required' 
      })
    }
    
    const totalAmount = (cash_amount || 0) + (bank_amount || 0)

    // Validate bill_ids if provided, compute billsTotal for clearing credit
    let billsTotal = totalAmount // default: no bills provided → use entered amount
    if (bill_ids && bill_ids.length > 0) {
      const checkStmt = db.prepare(`
        SELECT id, total_amount FROM pos_running_bills
        WHERE id IN (${bill_ids.map(() => '?').join(',')})
          AND tenant_id = ?
          AND status = 'PAID'
      `)
      const validBills = checkStmt.all(...bill_ids, tenantId) as any[]

      if (validBills.length !== bill_ids.length) {
        return res.status(400).json({
          success: false,
          message: 'Some bills are invalid or not paid'
        })
      }

      billsTotal = validBills.reduce((sum: number, b: any) => sum + b.total_amount, 0)
      // Difference (totalAmount - billsTotal) is allowed — recorded as over/short in journal
    }

    const cashDifference = totalAmount - billsTotal  // + = over, - = short

    // Create transfer record
    const transferId = generateId()
    db.prepare(`
      INSERT INTO pos_clearing_transfers (
        id, tenant_id, transfer_date, total_amount,
        cash_amount, bank_amount, original_clearing_amount, cash_difference,
        reference, notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      transferId, tenantId, transfer_date, totalAmount,
      cash_amount || 0, bank_amount || 0, billsTotal, cashDifference,
      reference || null, notes || null, userId, now()
    )

    // Link bills to transfer
    if (bill_ids && bill_ids.length > 0) {
      const linkStmt = db.prepare(`
        INSERT INTO pos_clearing_transfer_items (id, tenant_id, transfer_id, bill_id, amount)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const billId of bill_ids) {
        const bill = db.prepare('SELECT total_amount FROM pos_running_bills WHERE id = ?').get(billId) as any
        linkStmt.run(generateId(), tenantId, transferId, billId, bill?.total_amount || 0)
      }
    }

    // Dr. Cash/Bank (entered amount) ± Dr/Cr 5901 (over/short), Cr. Clearing (billsTotal)
    createTransferJournalEntries(transferId, tenantId, userId, transfer_date, cash_amount || 0, bank_amount || 0, billsTotal, reference)

    res.json({
      success: true,
      message: 'Transfer recorded successfully',
      data: {
        transfer_id: transferId,
        total_amount: totalAmount,
        cash_amount: cash_amount || 0,
        bank_amount: bank_amount || 0,
        bills_total: billsTotal,
        cash_difference: cashDifference
      }
    })
  } catch (error) {
    console.error('Error creating transfer:', error)
    res.status(500).json({ success: false, message: 'Failed to create transfer' })
  }
})

// Get transfer details
router.get('/clearing/transfers/:id', (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const { id } = req.params
    
    // Get transfer
    const transferStmt = db.prepare(`
      SELECT t.*, u.name as created_by_name
      FROM pos_clearing_transfers t
      LEFT JOIN users u ON t.created_by = u.id
      WHERE t.id = ? AND t.tenant_id = ?
    `)
    const transfer = transferStmt.get(id, tenantId)
    
    if (!transfer) {
      return res.status(404).json({ success: false, message: 'Transfer not found' })
    }
    
    // Get linked bills
    const billsStmt = db.prepare(`
      SELECT 
        b.bill_number,
        b.display_name,
        b.total_amount,
        b.closed_at
      FROM pos_clearing_transfer_items cti
      JOIN pos_running_bills b ON cti.bill_id = b.id
      WHERE cti.transfer_id = ?
    `)
    const bills = billsStmt.all(id)
    
    res.json({
      success: true,
      data: { ...transfer, bills }
    })
  } catch (error) {
    console.error('Error fetching transfer:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch transfer' })
  }
})

// Get all transfers
router.get('/clearing/transfers', (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default'
    const { date_from, date_to, limit = 50 } = req.query
    
    let query = `
      SELECT 
        t.*,
        u.name as created_by_name,
        COUNT(cti.id) as bill_count
      FROM pos_clearing_transfers t
      LEFT JOIN users u ON t.created_by = u.id
      LEFT JOIN pos_clearing_transfer_items cti ON t.id = cti.transfer_id
      WHERE t.tenant_id = ?
    `
    const params: any[] = [tenantId]
    
    if (date_from) {
      query += ' AND t.transfer_date >= ?'
      params.push(date_from)
    }
    
    if (date_to) {
      query += ' AND t.transfer_date <= ?'
      params.push(date_to)
    }
    
    query += ' GROUP BY t.id ORDER BY t.transfer_date DESC LIMIT ?'
    params.push(parseInt(limit as string))
    
    const stmt = db.prepare(query)
    const transfers = stmt.all(...params)
    
    res.json({ success: true, data: transfers })
  } catch (error) {
    console.error('Error fetching transfers:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch transfers' })
  }
})

// ==================== HELPERS ====================

function createTransferJournalEntries(
  transferId: string,
  tenantId: string,
  userId: string,
  date: string,
  cashAmount: number,
  bankAmount: number,
  billsTotal: number,
  reference?: string
) {
  const getAccountId = (code: string, name: string, type: string, category: string) => {
    const stmt = db.prepare('SELECT id FROM accounts WHERE code = ? AND tenant_id = ?')
    let account = stmt.get(code, tenantId) as any
    
    if (!account) {
      const newId = generateId()
      const createStmt = db.prepare(`
        INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, is_active, is_system)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)
      `)
      createStmt.run(newId, tenantId, code, name, type, category, type === 'ASSET' ? 'DEBIT' : 'CREDIT')
      return newId
    }
    return account.id
  }
  
  const enteredTotal = cashAmount + bankAmount
  const difference = enteredTotal - billsTotal  // + = over, - = short
  // Journal totals must balance: debit side = credit side
  // Short: Dr.Cash(entered) + Dr.5901(|diff|) = Cr.Clearing(billsTotal)  → total = billsTotal
  // Over:  Dr.Cash(entered) = Cr.Clearing(billsTotal) + Cr.5901(diff)    → total = enteredTotal
  const journalTotal = Math.abs(difference) < 0.01 ? enteredTotal : Math.max(enteredTotal, billsTotal)

  // Get next entry number
  const year = new Date().getFullYear()
  const prefix = `JV-${year}-`
  const last = db.prepare(`
    SELECT entry_number FROM journal_entries
    WHERE tenant_id = ? AND entry_number LIKE ?
    ORDER BY entry_number DESC LIMIT 1
  `).get(tenantId, `${prefix}%`) as { entry_number: string } | undefined
  let seq = 1
  if (last) {
    const match = last.entry_number.match(/-(\d+)$/)
    if (match) seq = parseInt(match[1]) + 1
  }
  const entryNumber = `${prefix}${String(seq).padStart(6, '0')}`

  const entryId = generateId()
  db.prepare(`
    INSERT INTO journal_entries (
      id, tenant_id, entry_number, date, reference_type, reference_id,
      description, total_debit, total_credit, is_auto_generated, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    entryId, tenantId, entryNumber, date,
    'POS_CLEARING_TRANSFER', transferId,
    `โอนยอด POS Clearing - ${reference || transferId}`,
    journalTotal, journalTotal, userId, now()
  )

  const insertLine = (accountId: string, lineNo: number, desc: string, debit: number, credit: number) => {
    db.prepare(`
      INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(generateId(), tenantId, entryId, accountId, lineNo, desc, debit, credit)
  }

  let lineNumber = 1

  // Dr. Cash (entered)
  if (cashAmount > 0) {
    const id = getAccountId('1101', 'เงินสด', 'ASSET', 'CURRENT_ASSET')
    insertLine(id, lineNumber++, 'เงินสดจาก POS', cashAmount, 0)
  }
  // Dr. Bank (entered)
  if (bankAmount > 0) {
    const id = getAccountId('1102', 'เงินฝากธนาคาร', 'ASSET', 'CURRENT_ASSET')
    insertLine(id, lineNumber++, 'เงินโอน/ธนาคารจาก POS', bankAmount, 0)
  }
  // Dr. 5901 if short (entered < bills)
  if (difference < -0.01) {
    const id = getAccountId('5901', 'เงินขาด/เงินเกิน', 'EXPENSE', 'OTHER_EXPENSE')
    insertLine(id, lineNumber++, 'เงินขาดจาก POS Clearing', Math.abs(difference), 0)
  }
  // Cr. Clearing (billsTotal — full clearing amount)
  const clearingId = getAccountId('1180', 'ลูกหนี้การค้า-POS', 'ASSET', 'CURRENT_ASSET')
  insertLine(clearingId, lineNumber++, 'โอนยอดจาก Clearing', 0, billsTotal)
  // Cr. 5901 if over (entered > bills)
  if (difference > 0.01) {
    const id = getAccountId('5901', 'เงินขาด/เงินเกิน', 'EXPENSE', 'OTHER_EXPENSE')
    insertLine(id, lineNumber++, 'เงินเกินจาก POS Clearing', 0, difference)
  }

  // Update account balances
  const updateBalance = (accountCode: string, debit: number, credit: number) => {
    const yr = parseInt(date.split('-')[0])
    const month = parseInt(date.split('-')[1])
    const account = db.prepare('SELECT id FROM accounts WHERE code = ? AND tenant_id = ?').get(accountCode, tenantId) as any
    if (!account) return
    const existing = db.prepare(`
      SELECT id FROM account_balances WHERE account_id = ? AND fiscal_year = ? AND period = ?
    `).get(account.id, yr, month)
    if (existing) {
      db.prepare(`
        UPDATE account_balances
        SET debit_amount = debit_amount + ?, credit_amount = credit_amount + ?,
            ending_balance = ending_balance + ? - ?
        WHERE account_id = ? AND fiscal_year = ? AND period = ?
      `).run(debit, credit, debit, credit, account.id, yr, month)
    } else {
      db.prepare(`
        INSERT INTO account_balances (id, tenant_id, account_id, fiscal_year, period, beginning_balance, debit_amount, credit_amount, ending_balance)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
      `).run(generateId(), tenantId, account.id, yr, month, debit, credit, debit - credit)
    }
  }

  updateBalance('1101', cashAmount, 0)
  updateBalance('1102', bankAmount, 0)
  updateBalance('1180', 0, billsTotal)
  if (Math.abs(difference) > 0.01) {
    // Short → Dr. 5901 (expense debit increases); Over → Cr. 5901 (expense credit decreases)
    updateBalance('5901', difference < 0 ? Math.abs(difference) : 0, difference > 0 ? difference : 0)
  }
}

export default router
