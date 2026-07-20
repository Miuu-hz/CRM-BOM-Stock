import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

// New table: monthly budget per account. An annual budget in the UI is just
// the same amount spread across 12 rows (or entered per-month directly).
db.prepare(`CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  month INTEGER NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, year, month, account_id)
)`).run()

// Defensive re-guard for is_closing_entry — same additive column period-closing.routes.ts
// creates. Idempotent PRAGMA-guarded ALTER, safe to repeat across route files (see
// tax.routes.ts / period-closing.routes.ts for the same pattern) so this route doesn't
// depend on import order to find the column when computing actuals below.
function ensureClosingEntryColumn() {
  try {
    const columns = db.prepare('PRAGMA table_info(journal_entries)').all() as { name: string }[]
    if (!columns.some((c) => c.name === 'is_closing_entry')) {
      db.exec('ALTER TABLE journal_entries ADD COLUMN is_closing_entry INTEGER DEFAULT 0')
    }
  } catch (error) {
    console.error('Failed to ensure is_closing_entry column:', error)
  }
}
ensureClosingEntryColumn()

const router = Router()
router.use(authenticate)

// Only revenue/expense/COGS accounts can carry a budget — asset/liability/equity balances
// aren't "spent" against a monthly plan the way P&L accounts are.
const BUDGETABLE_TYPES = ['REVENUE', 'EXPENSE', 'COGS']

function isValidYear(year: number) {
  return Number.isInteger(year) && year >= 2000 && year <= 2100
}

function fetchBudgetRows(tenantId: string, year: number) {
  return db.prepare(`
    SELECT b.id, b.year, b.month, b.amount, b.account_id,
           a.code as account_code, a.name as account_name, a.type as account_type
    FROM budgets b
    JOIN accounts a ON b.account_id = a.id
    WHERE b.tenant_id = ? AND b.year = ?
    ORDER BY a.code, b.month
  `).all(tenantId, year)
}

// GET /api/budgets/:year — all budget rows for the year
router.get('/:year', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const year = Number(req.params.year)
    if (!isValidYear(year)) return res.status(400).json({ success: false, message: 'ปีไม่ถูกต้อง' })

    res.json({ success: true, data: fetchBudgetRows(tenantId, year) })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// PUT /api/budgets/:year — bulk upsert { items: [{ accountId, month, amount }] }
router.put('/:year', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const year = Number(req.params.year)
    if (!isValidYear(year)) return res.status(400).json({ success: false, message: 'ปีไม่ถูกต้อง' })

    const items = req.body?.items
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'ไม่มีรายการงบประมาณที่จะบันทึก' })
    }

    for (const item of items) {
      if (!item || typeof item.accountId !== 'string' || !item.accountId) {
        return res.status(400).json({ success: false, message: 'ระบุบัญชีไม่ถูกต้อง' })
      }
      if (!Number.isInteger(item.month) || item.month < 1 || item.month > 12) {
        return res.status(400).json({ success: false, message: `เดือนไม่ถูกต้อง: ${item.month}` })
      }
      if (typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount < 0) {
        return res.status(400).json({ success: false, message: 'จำนวนเงินงบประมาณต้องเป็นตัวเลขที่ไม่ติดลบ' })
      }
    }

    const accountIds = [...new Set(items.map((i: any) => i.accountId))] as string[]
    const placeholders = accountIds.map(() => '?').join(',')
    const accounts = db.prepare(
      `SELECT id, type FROM accounts WHERE tenant_id = ? AND id IN (${placeholders})`
    ).all(tenantId, ...accountIds) as { id: string; type: string }[]
    const accountTypeById = new Map(accounts.map((a) => [a.id, a.type]))

    for (const accountId of accountIds) {
      const type = accountTypeById.get(accountId)
      if (!type) {
        return res.status(400).json({ success: false, message: 'ไม่พบบัญชีที่ระบุในผังบัญชี' })
      }
      if (!BUDGETABLE_TYPES.includes(type)) {
        return res.status(400).json({ success: false, message: 'สามารถตั้งงบประมาณได้เฉพาะบัญชีรายได้ ค่าใช้จ่าย และต้นทุนขายเท่านั้น' })
      }
    }

    const now = new Date().toISOString()
    const upsert = db.prepare(`
      INSERT INTO budgets (id, tenant_id, year, account_id, month, amount, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, year, month, account_id) DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at
    `)

    const run = db.transaction(() => {
      for (const item of items) {
        upsert.run(generateId(), tenantId, year, item.accountId, item.month, item.amount, now, now)
      }
    })
    run()

    res.json({ success: true, data: fetchBudgetRows(tenantId, year) })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

interface VarianceResult {
  variance: number
  variancePct: number | null
}

// variance = actual - budget (positive = over budget for expense/COGS, over target for revenue).
// variancePct is null when budget is 0 — a percentage against zero is meaningless.
function calcVariance(budget: number, actual: number): VarianceResult {
  const variance = Math.round((actual - budget) * 100) / 100
  const variancePct = budget !== 0 ? Math.round((variance / Math.abs(budget)) * 1000) / 10 : null
  return { variance, variancePct }
}

// GET /api/budgets/:year/vs-actual — budget vs actual per account per month, plus totals
router.get('/:year/vs-actual', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const year = Number(req.params.year)
    if (!isValidYear(year)) return res.status(400).json({ success: false, message: 'ปีไม่ถูกต้อง' })

    const budgetRows = db.prepare(`
      SELECT b.account_id, b.month, b.amount,
             a.code as account_code, a.name as account_name, a.type as account_type
      FROM budgets b
      JOIN accounts a ON b.account_id = a.id
      WHERE b.tenant_id = ? AND b.year = ?
    `).all(tenantId, year) as any[]

    // Actual is normal-balance-adjusted: REVENUE is credit-normal (credit - debit),
    // EXPENSE/COGS is debit-normal (debit - credit) — same convention as period-closing.routes.ts.
    // is_closing_entry rows are excluded so the year-end zeroing JE doesn't wipe out the
    // very actuals it's meant to summarize.
    const actualRows = db.prepare(`
      SELECT jl.account_id, CAST(strftime('%m', je.date) AS INTEGER) as month,
             a.code as account_code, a.name as account_name, a.type as account_type,
             SUM(CASE WHEN a.type = 'REVENUE' THEN jl.credit - jl.debit ELSE jl.debit - jl.credit END) as actual
      FROM journal_lines jl
      JOIN journal_entries je ON jl.journal_entry_id = je.id
      JOIN accounts a ON jl.account_id = a.id
      WHERE jl.tenant_id = ? AND je.tenant_id = ? AND je.is_posted = 1
        AND (je.is_closing_entry IS NULL OR je.is_closing_entry != 1)
        AND strftime('%Y', je.date) = ?
        AND a.type IN ('REVENUE', 'EXPENSE', 'COGS')
      GROUP BY jl.account_id, month
    `).all(tenantId, tenantId, String(year)) as any[]

    type AccEntry = {
      accountId: string
      code: string
      name: string
      type: string
      months: Map<number, { budget: number; actual: number }>
    }
    const accounts = new Map<string, AccEntry>()

    const getAcc = (accountId: string, code: string, name: string, type: string): AccEntry => {
      let entry = accounts.get(accountId)
      if (!entry) {
        entry = { accountId, code, name, type, months: new Map() }
        accounts.set(accountId, entry)
      }
      return entry
    }
    const getMonth = (entry: AccEntry, month: number) => {
      let m = entry.months.get(month)
      if (!m) {
        m = { budget: 0, actual: 0 }
        entry.months.set(month, m)
      }
      return m
    }

    for (const row of budgetRows) {
      const entry = getAcc(row.account_id, row.account_code, row.account_name, row.account_type)
      getMonth(entry, row.month).budget = row.amount
    }
    for (const row of actualRows) {
      const entry = getAcc(row.account_id, row.account_code, row.account_name, row.account_type)
      getMonth(entry, row.month).actual = row.actual || 0
    }

    const monthlyTotals = new Map<number, { budget: number; actual: number }>()
    const typeTotals = new Map<string, { budget: number; actual: number }>()

    const accountResults = [...accounts.values()]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((entry) => {
        const months = Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
          const m = entry.months.get(month) || { budget: 0, actual: 0 }
          const mt = monthlyTotals.get(month) || { budget: 0, actual: 0 }
          mt.budget += m.budget
          mt.actual += m.actual
          monthlyTotals.set(month, mt)

          const tt = typeTotals.get(entry.type) || { budget: 0, actual: 0 }
          tt.budget += m.budget
          tt.actual += m.actual
          typeTotals.set(entry.type, tt)

          return { month, budget: m.budget, actual: m.actual, ...calcVariance(m.budget, m.actual) }
        })
        const totalBudget = months.reduce((s, m) => s + m.budget, 0)
        const totalActual = months.reduce((s, m) => s + m.actual, 0)

        return {
          accountId: entry.accountId,
          code: entry.code,
          name: entry.name,
          type: entry.type,
          months,
          totalBudget,
          totalActual,
          ...calcVariance(totalBudget, totalActual),
        }
      })

    const monthlyTotalsResult = Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
      const t = monthlyTotals.get(month) || { budget: 0, actual: 0 }
      return { month, budget: t.budget, actual: t.actual, ...calcVariance(t.budget, t.actual) }
    })

    const typeTotalsResult = [...typeTotals.entries()].map(([type, t]) => ({
      type,
      budget: t.budget,
      actual: t.actual,
      ...calcVariance(t.budget, t.actual),
    }))

    res.json({
      success: true,
      data: { year, accounts: accountResults, monthlyTotals: monthlyTotalsResult, typeTotals: typeTotalsResult },
    })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
