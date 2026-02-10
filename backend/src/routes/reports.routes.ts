import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'

const router = Router()

router.use(authenticate)

// ============================================
// FINANCIAL REPORTS - รายงานทางการเงิน
// ============================================

// Trial Balance - งบทดลอง
router.get('/trial-balance', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { startDate, endDate } = req.query
    
    // Get all active accounts with balances
    const accounts = db.prepare(`
      SELECT a.*
      FROM accounts a
      WHERE a.tenant_id = ? AND a.is_active = 1
      ORDER BY a.code
    `).all(tenantId) as any[]
    
    const results = accounts.map(account => {
      // Get opening balance (before startDate)
      let openingQuery = `
        SELECT COALESCE(SUM(debit), 0) as total_debit, COALESCE(SUM(credit), 0) as total_credit
        FROM journal_lines jl
        JOIN journal_entries je ON jl.journal_entry_id = je.id
        WHERE jl.account_id = ? AND je.is_posted = 1
      `
      const params: any[] = [account.id]
      
      if (startDate) {
        openingQuery += ' AND je.date < ?'
        params.push(startDate)
      }
      
      const openingBalance = db.prepare(openingQuery).get(...params) as any
      
      // Get period activity (between startDate and endDate)
      let activityQuery = `
        SELECT COALESCE(SUM(debit), 0) as total_debit, COALESCE(SUM(credit), 0) as total_credit
        FROM journal_lines jl
        JOIN journal_entries je ON jl.journal_entry_id = je.id
        WHERE jl.account_id = ? AND je.is_posted = 1
      `
      const activityParams: any[] = [account.id]
      
      if (startDate) {
        activityQuery += ' AND je.date >= ?'
        activityParams.push(startDate)
      }
      if (endDate) {
        activityQuery += ' AND je.date <= ?'
        activityParams.push(endDate)
      }
      
      const activity = db.prepare(activityQuery).get(...activityParams) as any
      
      // Calculate balances
      const openingDebit = account.normal_balance === 'DEBIT' 
        ? Number(openingBalance.total_debit) - Number(openingBalance.total_credit)
        : 0
      const openingCredit = account.normal_balance === 'CREDIT'
        ? Number(openingBalance.total_credit) - Number(openingBalance.total_debit)
        : 0
      
      const movementDebit = Number(activity.total_debit)
      const movementCredit = Number(activity.total_credit)
      
      let endingBalance = 0
      if (account.normal_balance === 'DEBIT') {
        endingBalance = (openingDebit - openingCredit) + movementDebit - movementCredit
      } else {
        endingBalance = (openingCredit - openingDebit) + movementCredit - movementDebit
      }
      
      return {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        category: account.category,
        normalBalance: account.normal_balance,
        openingDebit: openingDebit > 0 ? openingDebit : 0,
        openingCredit: openingCredit > 0 ? openingCredit : 0,
        debit: movementDebit,
        credit: movementCredit,
        endingDebit: account.normal_balance === 'DEBIT' && endingBalance > 0 ? endingBalance : 0,
        endingCredit: account.normal_balance === 'CREDIT' && endingBalance > 0 ? endingBalance : 0
      }
    })
    
    // Filter out accounts with no activity if specified
    const filteredResults = results.filter(r => 
      r.debit !== 0 || r.credit !== 0 || r.openingDebit !== 0 || r.openingCredit !== 0
    )
    
    // Calculate totals
    const totals = filteredResults.reduce((acc, r) => ({
      openingDebit: acc.openingDebit + r.openingDebit,
      openingCredit: acc.openingCredit + r.openingCredit,
      debit: acc.debit + r.debit,
      credit: acc.credit + r.credit,
      endingDebit: acc.endingDebit + r.endingDebit,
      endingCredit: acc.endingCredit + r.endingCredit
    }), { openingDebit: 0, openingCredit: 0, debit: 0, credit: 0, endingDebit: 0, endingCredit: 0 })
    
    res.json({
      success: true,
      data: {
        startDate,
        endDate,
        accounts: filteredResults,
        totals
      }
    })
  } catch (error) {
    console.error('Trial balance error:', error)
    res.status(500).json({ success: false, message: 'Failed to generate trial balance' })
  }
})

// Balance Sheet - งบดุล
router.get('/balance-sheet', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { asOfDate } = req.query
    const date = asOfDate || new Date().toISOString().split('T')[0]
    
    // Get account balances
    const accounts = db.prepare(`
      SELECT a.*,
             COALESCE((
               SELECT SUM(CASE 
                 WHEN a.normal_balance = 'DEBIT' THEN jl.debit - jl.credit
                 ELSE jl.credit - jl.debit
               END)
               FROM journal_lines jl
               JOIN journal_entries je ON jl.journal_entry_id = je.id
               WHERE jl.account_id = a.id AND je.is_posted = 1 AND je.date <= ?
             ), 0) as balance
      FROM accounts a
      WHERE a.tenant_id = ? AND a.is_active = 1 AND a.level >= 1
      ORDER BY a.code
    `).all(date, tenantId) as any[]
    
    // Group by type
    const assets = accounts.filter(a => a.type === 'ASSET')
    const liabilities = accounts.filter(a => a.type === 'LIABILITY')
    const equity = accounts.filter(a => a.type === 'EQUITY')
    
    // Calculate totals
    const totalAssets = assets.reduce((sum, a) => sum + Number(a.balance), 0)
    const totalLiabilities = liabilities.reduce((sum, a) => sum + Number(a.balance), 0)
    const totalEquity = equity.reduce((sum, a) => sum + Number(a.balance), 0)
    
    // Group by category for better display
    const groupByCategory = (items: any[]) => {
      const grouped: Record<string, any[]> = {}
      items.forEach(item => {
        if (!grouped[item.category]) grouped[item.category] = []
        grouped[item.category].push(item)
      })
      return grouped
    }
    
    res.json({
      success: true,
      data: {
        asOfDate: date,
        assets: {
          items: assets,
          grouped: groupByCategory(assets),
          total: totalAssets
        },
        liabilities: {
          items: liabilities,
          grouped: groupByCategory(liabilities),
          total: totalLiabilities
        },
        equity: {
          items: equity,
          grouped: groupByCategory(equity),
          total: totalEquity
        },
        totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
        balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01
      }
    })
  } catch (error) {
    console.error('Balance sheet error:', error)
    res.status(500).json({ success: false, message: 'Failed to generate balance sheet' })
  }
})

// Profit & Loss - งบกำไรขาดทุน
router.get('/profit-loss', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { startDate, endDate } = req.query
    
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Start date and end date are required' })
    }
    
    // Get revenue and expense accounts with balances
    const accounts = db.prepare(`
      SELECT a.*,
             COALESCE((
               SELECT SUM(CASE 
                 WHEN a.normal_balance = 'DEBIT' THEN jl.debit - jl.credit
                 ELSE jl.credit - jl.debit
               END)
               FROM journal_lines jl
               JOIN journal_entries je ON jl.journal_entry_id = je.id
               WHERE jl.account_id = a.id AND je.is_posted = 1 
               AND je.date >= ? AND je.date <= ?
             ), 0) as balance
      FROM accounts a
      WHERE a.tenant_id = ? AND a.is_active = 1 
        AND a.type IN ('REVENUE', 'EXPENSE') AND a.level >= 1
      ORDER BY a.code
    `).all(startDate, endDate, tenantId) as any[]
    
    const revenues = accounts.filter(a => a.type === 'REVENUE')
    const expenses = accounts.filter(a => a.type === 'EXPENSE')
    
    // Calculate totals
    const totalRevenue = revenues.reduce((sum, a) => sum + Number(a.balance), 0)
    const totalExpenses = expenses.reduce((sum, a) => sum + Number(a.balance), 0)
    const netProfit = totalRevenue - totalExpenses
    
    // Group by category
    const groupByCategory = (items: any[]) => {
      const grouped: Record<string, any[]> = {}
      items.forEach(item => {
        if (!grouped[item.category]) grouped[item.category] = []
        grouped[item.category].push(item)
      })
      return grouped
    }
    
    // Calculate gross profit (if we have COGS)
    const cogs = expenses.filter(e => e.category === 'COGS').reduce((sum, e) => sum + Number(e.balance), 0)
    const grossProfit = totalRevenue - cogs
    
    // Calculate operating profit
    const operatingExpenses = expenses.filter(e => e.category !== 'COGS').reduce((sum, e) => sum + Number(e.balance), 0)
    const operatingProfit = grossProfit - operatingExpenses
    
    res.json({
      success: true,
      data: {
        period: { startDate, endDate },
        revenue: {
          items: revenues,
          grouped: groupByCategory(revenues),
          total: totalRevenue
        },
        cogs: {
          items: expenses.filter(e => e.category === 'COGS'),
          total: cogs
        },
        grossProfit,
        operatingExpenses: {
          items: expenses.filter(e => e.category !== 'COGS'),
          grouped: groupByCategory(expenses.filter(e => e.category !== 'COGS')),
          total: operatingExpenses
        },
        operatingProfit,
        netProfit,
        margin: totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(2) : 0
      }
    })
  } catch (error) {
    console.error('Profit & loss error:', error)
    res.status(500).json({ success: false, message: 'Failed to generate profit & loss' })
  }
})

// Cash Flow - งบกระแสเงินสด (simplified)
router.get('/cash-flow', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { startDate, endDate } = req.query
    
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Start date and end date are required' })
    }
    
    // Get cash accounts
    const cashAccounts = db.prepare(`
      SELECT id FROM accounts 
      WHERE tenant_id = ? AND code IN ('1101', '1102') AND is_active = 1
    `).all(tenantId) as any[]
    
    const cashAccountIds = cashAccounts.map(a => a.id)
    
    if (cashAccountIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Cash accounts not found' })
    }
    
    // Get cash transactions
    const placeholders = cashAccountIds.map(() => '?').join(',')
    
    const transactions = db.prepare(`
      SELECT 
        jl.*,
        je.date,
        je.description as entry_description,
        je.reference_type,
        je.reference_id,
        a.name as account_name,
        a.code as account_code
      FROM journal_lines jl
      JOIN journal_entries je ON jl.journal_entry_id = je.id
      JOIN accounts a ON jl.account_id = a.id
      WHERE jl.account_id IN (${placeholders})
        AND je.is_posted = 1
        AND je.date >= ? AND je.date <= ?
      ORDER BY je.date, je.created_at
    `).all(...cashAccountIds, startDate, endDate) as any[]
    
    // Calculate opening balance
    const openingBalance = db.prepare(`
      SELECT COALESCE(SUM(debit - credit), 0) as balance
      FROM journal_lines jl
      JOIN journal_entries je ON jl.journal_entry_id = je.id
      WHERE jl.account_id IN (${placeholders})
        AND je.is_posted = 1
        AND je.date < ?
    `).all(...cashAccountIds, startDate) as any
    
    // Categorize transactions
    const operating = transactions.filter(t => 
      ['SALES_ORDER', 'PURCHASE_ORDER', 'EXPENSE'].includes(t.reference_type)
    )
    const investing = transactions.filter(t => 
      ['ASSET_PURCHASE', 'ASSET_SALE'].includes(t.reference_type)
    )
    const financing = transactions.filter(t => 
      ['LOAN', 'EQUITY'].includes(t.reference_type)
    )
    
    const calcFlow = (items: any[]) => items.reduce((sum, t) => sum + (t.debit - t.credit), 0)
    
    const operatingFlow = calcFlow(operating)
    const investingFlow = calcFlow(investing)
    const financingFlow = calcFlow(financing)
    
    const opening = Number(openingBalance.balance)
    const netChange = operatingFlow + investingFlow + financingFlow
    const closing = opening + netChange
    
    res.json({
      success: true,
      data: {
        period: { startDate, endDate },
        openingBalance: opening,
        operating: {
          items: operating,
          total: operatingFlow
        },
        investing: {
          items: investing,
          total: investingFlow
        },
        financing: {
          items: financing,
          total: financingFlow
        },
        netChange,
        closingBalance: closing
      }
    })
  } catch (error) {
    console.error('Cash flow error:', error)
    res.status(500).json({ success: false, message: 'Failed to generate cash flow' })
  }
})

// Account Ledger - รายละเอียดบัญชี
router.get('/ledger/:accountId', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { startDate, endDate } = req.query
    
    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND tenant_id = ?').get(req.params.accountId, tenantId) as any
    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' })
    }
    
    // Calculate opening balance
    let openingQuery = `
      SELECT COALESCE(SUM(CASE 
        WHEN ? = 'DEBIT' THEN debit - credit
        ELSE credit - debit
      END), 0) as balance
      FROM journal_lines jl
      JOIN journal_entries je ON jl.journal_entry_id = je.id
      WHERE jl.account_id = ? AND je.is_posted = 1
    `
    const openingParams: any[] = [account.normal_balance, req.params.accountId]
    
    if (startDate) {
      openingQuery += ' AND je.date < ?'
      openingParams.push(startDate)
    }
    
    const openingBalance = db.prepare(openingQuery).get(...openingParams) as any
    
    // Get transactions
    let transactionsQuery = `
      SELECT 
        je.date,
        je.entry_number,
        je.description,
        je.reference_type,
        je.reference_id,
        jl.debit,
        jl.credit,
        jl.description as line_description
      FROM journal_lines jl
      JOIN journal_entries je ON jl.journal_entry_id = je.id
      WHERE jl.account_id = ? AND je.is_posted = 1
    `
    const transactionsParams: any[] = [req.params.accountId]
    
    if (startDate) {
      transactionsQuery += ' AND je.date >= ?'
      transactionsParams.push(startDate)
    }
    if (endDate) {
      transactionsQuery += ' AND je.date <= ?'
      transactionsParams.push(endDate)
    }
    
    transactionsQuery += ' ORDER BY je.date, je.created_at'
    
    const transactions = db.prepare(transactionsQuery).all(...transactionsParams) as any[]
    
    // Calculate running balance
    let runningBalance = Number(openingBalance.balance)
    const transactionsWithBalance = transactions.map(t => {
      if (account.normal_balance === 'DEBIT') {
        runningBalance += (t.debit - t.credit)
      } else {
        runningBalance += (t.credit - t.debit)
      }
      return { ...t, balance: runningBalance }
    })
    
    res.json({
      success: true,
      data: {
        account,
        openingBalance: Number(openingBalance.balance),
        transactions: transactionsWithBalance,
        closingBalance: runningBalance
      }
    })
  } catch (error) {
    console.error('Ledger error:', error)
    res.status(500).json({ success: false, message: 'Failed to generate ledger' })
  }
})

// VAT Report - รายงานภาษีมูลค่าเพิ่ม
router.get('/vat', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { startDate, endDate, type } = req.query
    
    let query = 'SELECT * FROM vat_entries WHERE tenant_id = ?'
    const params: any[] = [tenantId]
    
    if (startDate) {
      query += ' AND document_date >= ?'
      params.push(startDate)
    }
    if (endDate) {
      query += ' AND document_date <= ?'
      params.push(endDate)
    }
    if (type === 'input') {
      query += ' AND is_input_vat = 1'
    } else if (type === 'output') {
      query += ' AND is_output_vat = 1'
    }
    
    query += ' ORDER BY document_date'
    
    const entries = db.prepare(query).all(...params) as any[]
    
    const summary = {
      inputVAT: entries.filter(e => e.is_input_vat).reduce((sum, e) => sum + e.vat_amount, 0),
      outputVAT: entries.filter(e => e.is_output_vat).reduce((sum, e) => sum + e.vat_amount, 0),
      netVAT: 0
    }
    summary.netVAT = summary.outputVAT - summary.inputVAT
    
    res.json({
      success: true,
      data: {
        entries,
        summary
      }
    })
  } catch (error) {
    console.error('VAT report error:', error)
    res.status(500).json({ success: false, message: 'Failed to generate VAT report' })
  }
})

export default router
