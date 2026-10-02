import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'

const router = Router()

router.use(authenticate)

// ============================================
// FINANCIAL REPORTS - รายงานทางการเงิน
// ============================================

// Trial Balance - งบทดลอง
// แยกออกจาก route เพื่อให้เทสต์ได้ และให้ MCP get_trial_balance (แผนใน carbontome.md) เรียกตัวเดียวกัน
export function buildTrialBalance(tenantId: string, startDate?: string, endDate?: string) {
    // Get all active accounts with balances
    const accounts = db.prepare(`
      SELECT a.*
      FROM accounts a
      WHERE a.tenant_id = ? AND a.is_active = 1
      ORDER BY a.code
    `).all(tenantId) as any[]
    
    const results = accounts.map(account => {
      // ยอดยกมา = ก่อน startDate เท่านั้น ไม่มี startDate = ไม่มียอดยกมา (ความเคลื่อนไหวนับตั้งแต่ต้นอยู่แล้ว)
      // เดิม query นี้รันโดยไม่มีเงื่อนไขวันที่ → นับทุกรายการซ้ำสองรอบ ยอดคงเหลือเป็น 2 เท่า
      const openingBalance = startDate
        ? db.prepare(`
            SELECT COALESCE(SUM(debit), 0) as total_debit, COALESCE(SUM(credit), 0) as total_credit
            FROM journal_lines jl
            JOIN journal_entries je ON jl.journal_entry_id = je.id
            WHERE jl.account_id = ? AND je.is_posted = 1 AND je.date < ?
          `).get(account.id, startDate) as any
        : { total_debit: 0, total_credit: 0 }

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
      
      // ยอดสุทธิ (Dr − Cr) แล้ววางตามเครื่องหมาย ไม่ใช่ตาม normal_balance — เดิมยอดที่อยู่ผิดฝั่ง
      // (เช่น เงินฝากติดลบ) ถูกปัดเป็น 0 ทั้งสองฝั่ง หายไปจากงบทดลองและยอดรวม Dr/Cr ไม่เท่ากัน
      const openingNet = Number(openingBalance.total_debit) - Number(openingBalance.total_credit)
      const movementDebit = Number(activity.total_debit)
      const movementCredit = Number(activity.total_credit)
      const endingNet = openingNet + movementDebit - movementCredit

      return {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        category: account.category,
        normalBalance: account.normal_balance,
        openingDebit: openingNet > 0 ? openingNet : 0,
        openingCredit: openingNet < 0 ? -openingNet : 0,
        debit: movementDebit,
        credit: movementCredit,
        endingDebit: endingNet > 0 ? endingNet : 0,
        endingCredit: endingNet < 0 ? -endingNet : 0
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

    return { startDate, endDate, accounts: filteredResults, totals }
}

router.get('/trial-balance', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string }
    res.json({ success: true, data: buildTrialBalance(req.user!.tenantId, startDate, endDate) })
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

    // แยกกำไรตามหน่วยธุรกิจ — ขายผ่านแพลตฟอร์มลง business_unit='ONLINE', POS หน้าร้านลง 'STORE'
    // ไม่ส่งมา = รวมทุกหน่วย (พฤติกรรมเดิม) · entry เก่าที่ยังไม่มีค่าจะถูกกรองออกเมื่อเลือกหน่วยใดหน่วยหนึ่ง
    const businessUnit = (req.query.businessUnit as string) || null

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
               AND (? IS NULL OR je.business_unit = ?)
             ), 0) as balance
      FROM accounts a
      WHERE a.tenant_id = ? AND a.is_active = 1 
        AND a.type IN ('REVENUE', 'EXPENSE') AND a.level >= 1
      ORDER BY a.code
    `).all(startDate, endDate, businessUnit, businessUnit, tenantId) as any[]
    
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
    `).get(...cashAccountIds, startDate) as any
    
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

// แยกออกจาก route ให้ MCP get_ledger เรียกตัวเดียวกัน · ไม่พบบัญชีในเทแนนต์นี้ = null
export function buildLedger(tenantId: string, accountId: string, startDate?: string, endDate?: string) {
    // accounts table columns are snake_case; alias to camelCase so this
    // response matches the frontend's Account type
    const account = db.prepare(`
      SELECT id, code, name, name_en as nameEn, type, category, parent_id as parentId, level,
             is_active as isActive, is_system as isSystem, normal_balance as normalBalance,
             description, tax_related as taxRelated
      FROM accounts WHERE id = ? AND tenant_id = ?
    `).get(accountId, tenantId) as any
    if (!account) return null

    // ยอดยกมา = ก่อน startDate เท่านั้น ไม่มี startDate = 0 (รายการนับตั้งแต่ต้นอยู่แล้ว)
    // เดิมรัน query นี้โดยไม่มีเงื่อนไขวันที่ → ยอดยกมารวมทุกรายการแล้วบวกรายการซ้ำอีกรอบ ยอดปิดเป็น 2 เท่า (บั๊กเดียวกับงบทดลอง)
    const openingBalance = startDate
      ? Number((db.prepare(`
          SELECT COALESCE(SUM(CASE WHEN ? = 'DEBIT' THEN debit - credit ELSE credit - debit END), 0) as balance
          FROM journal_lines jl
          JOIN journal_entries je ON jl.journal_entry_id = je.id
          WHERE jl.account_id = ? AND je.is_posted = 1 AND je.date < ?
        `).get(account.normalBalance, accountId, startDate) as any).balance)
      : 0

    // Get transactions
    let transactionsQuery = `
      SELECT
        je.date,
        je.id as journalEntryId,
        je.source_number as sourceNumber,
        je.entry_number as entryNumber,
        je.description as entryDescription,
        je.reference_type as referenceType,
        je.reference_id as referenceId,
        jl.debit,
        jl.credit,
        jl.description as lineDescription
      FROM journal_lines jl
      JOIN journal_entries je ON jl.journal_entry_id = je.id
      WHERE jl.account_id = ? AND je.is_posted = 1
    `
    const transactionsParams: any[] = [accountId]

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
    let runningBalance = openingBalance
    const transactionsWithBalance = transactions.map(t => {
      if (account.normalBalance === 'DEBIT') {
        runningBalance += (t.debit - t.credit)
      } else {
        runningBalance += (t.credit - t.debit)
      }
      return { ...t, balance: runningBalance }
    })

    return { account, openingBalance, transactions: transactionsWithBalance, closingBalance: runningBalance }
}

// Account Ledger - รายละเอียดบัญชี
router.get('/ledger/:accountId', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string }
    const data = buildLedger(req.user!.tenantId, req.params.accountId, startDate, endDate)
    if (!data) {
      return res.status(404).json({ success: false, message: 'Account not found' })
    }
    res.json({ success: true, data })
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
