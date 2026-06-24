import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

const router = Router()
router.use(authenticate)

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

function toYMD(dateValue: string | null | undefined): string | null {
  if (!dateValue) return null
  const str = String(dateValue)
  if (str.includes('T')) return str.split('T')[0]
  return str
}

function parseYMD(dateStr: string) {
  const [year, month, day] = dateStr.split('-').map(Number)
  return { year, month, day: day || 1 }
}

function periodMonthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function periodDates(year: number, month: number) {
  const start = `${periodMonthKey(year, month)}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${periodMonthKey(year, month)}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

function vatDueDate(year: number, month: number) {
  const d = new Date(year, month - 1 + 1, 15)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`
}

function whtDueDate(year: number, month: number) {
  const d = new Date(year, month - 1 + 1, 7)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-07`
}

function ensurePeriod(tenantId: string, dateValue: string | null | undefined): string | null {
  const dateStr = toYMD(dateValue)
  if (!dateStr) return null
  const { year, month } = parseYMD(dateStr)

  let period = db.prepare(
    'SELECT id FROM tax_periods WHERE tenant_id = ? AND year = ? AND month = ?'
  ).get(tenantId, year, month) as { id: string } | undefined

  if (!period) {
    const id = generateId()
    const { start, end } = periodDates(year, month)
    db.prepare(
      `INSERT INTO tax_periods (id, tenant_id, year, month, period_type, start_date, end_date, vat_due_date, wht_due_date, status)
       VALUES (?, ?, ?, ?, 'MONTHLY', ?, ?, ?, ?, 'OPEN')`
    ).run(id, tenantId, year, month, start, end, vatDueDate(year, month), whtDueDate(year, month))
    period = { id }
  }

  return period.id
}

function transactionExists(tenantId: string, sourceType: string, sourceId: string): boolean {
  const row = db.prepare(
    'SELECT id FROM tax_transactions WHERE tenant_id = ? AND source_type = ? AND source_id = ?'
  ).get(tenantId, sourceType, sourceId) as { id: string } | undefined
  return !!row
}

function syncVatInputFromPurchaseInvoices(tenantId: string) {
  const rows = db.prepare(
    `SELECT pi.id, pi.pi_number, pi.invoice_date, pi.subtotal, pi.tax_amount, pi.total_amount, pi.tax_rate,
            s.id as supplier_id, s.name as supplier_name, s.tax_id as supplier_tax_id
     FROM purchase_invoices pi
     LEFT JOIN suppliers s ON pi.supplier_id = s.id
     WHERE pi.tenant_id = ? AND pi.status != 'CANCELLED' AND pi.tax_amount > 0`
  ).all(tenantId) as any[]

  for (const pi of rows) {
    const periodId = ensurePeriod(tenantId, pi.invoice_date)
    if (!periodId || transactionExists(tenantId, 'PURCHASE_INVOICE', pi.id)) continue

    db.prepare(
      `INSERT INTO tax_transactions (
         id, tenant_id, period_id, transaction_type, source_type, source_id, document_number, document_date,
         partner_id, partner_name, partner_tax_id, description, base_amount, tax_amount, total_amount, tax_rate, is_deductible
       ) VALUES (?, ?, ?, 'VAT_INPUT', 'PURCHASE_INVOICE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(
      generateId(), tenantId, periodId, pi.id, pi.pi_number, toYMD(pi.invoice_date),
      pi.supplier_id ?? null, pi.supplier_name || 'ผู้ขาย', pi.supplier_tax_id ?? null,
      `ภาษีซื้อจากใบซื้อ ${pi.pi_number}`,
      pi.subtotal ?? 0, pi.tax_amount ?? 0, pi.total_amount ?? 0, pi.tax_rate || 7
    )
  }
}

function syncVatOutputFromPosBills(tenantId: string) {
  const rows = db.prepare(
    `SELECT id, bill_number, opened_at, closed_at, subtotal, tax_amount, total_amount, tax_rate,
            customer_name, display_name
     FROM pos_running_bills
     WHERE tenant_id = ? AND status = 'PAID' AND tax_amount > 0`
  ).all(tenantId) as any[]

  for (const bill of rows) {
    const docDate = toYMD(bill.closed_at) || toYMD(bill.opened_at)
    const periodId = ensurePeriod(tenantId, docDate)
    if (!periodId || transactionExists(tenantId, 'POS_BILL', bill.id)) continue

    db.prepare(
      `INSERT INTO tax_transactions (
         id, tenant_id, period_id, transaction_type, source_type, source_id, document_number, document_date,
         partner_name, description, base_amount, tax_amount, total_amount, tax_rate, is_deductible
       ) VALUES (?, ?, ?, 'VAT_OUTPUT', 'POS_BILL', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      generateId(), tenantId, periodId, bill.id, bill.bill_number, docDate,
      bill.customer_name || bill.display_name || 'ลูกค้าเงินสด',
      `ภาษีขายจากบิล POS ${bill.bill_number}`,
      bill.subtotal ?? 0, bill.tax_amount ?? 0, bill.total_amount ?? 0, bill.tax_rate || 7
    )
  }
}

function syncWhtFromSupplierPayments(tenantId: string) {
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='supplier_payments'"
  ).get() as { name: string } | undefined
  if (!tableExists) return

  const rows = db.prepare(
    `SELECT sp.id, sp.payment_number, sp.payment_date, sp.amount, sp.withholding_tax, sp.net_amount,
            s.id as supplier_id, s.name as supplier_name, s.tax_id as supplier_tax_id
     FROM supplier_payments sp
     LEFT JOIN suppliers s ON sp.supplier_id = s.id
     WHERE sp.tenant_id = ? AND sp.withholding_tax > 0`
  ).all(tenantId) as any[]

  for (const p of rows) {
    const periodId = ensurePeriod(tenantId, p.payment_date)
    if (!periodId || transactionExists(tenantId, 'SUPPLIER_PAYMENT', p.id)) continue

    const baseAmount = p.amount ?? 0
    const whtAmount = p.withholding_tax ?? 0
    const whtRate = baseAmount > 0 ? Math.round((whtAmount / baseAmount) * 1000) / 10 : 0

    db.prepare(
      `INSERT INTO tax_transactions (
         id, tenant_id, period_id, transaction_type, source_type, source_id, document_number, document_date,
         partner_id, partner_name, partner_tax_id, description, base_amount, tax_amount, total_amount,
         tax_rate, wht_rate, is_deductible
       ) VALUES (?, ?, ?, 'WHT', 'SUPPLIER_PAYMENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      generateId(), tenantId, periodId, p.id, p.payment_number, toYMD(p.payment_date),
      p.supplier_id ?? null, p.supplier_name || 'ผู้ขาย', p.supplier_tax_id ?? null,
      `ภาษีหัก ณ ที่จ่ายจากการจ่ายเงิน ${p.payment_number}`,
      baseAmount, whtAmount, p.net_amount ?? (baseAmount - whtAmount),
      whtRate, whtRate
    )
  }
}

function syncTaxData(tenantId: string) {
  syncVatInputFromPurchaseInvoices(tenantId)
  syncVatOutputFromPosBills(tenantId)
  syncWhtFromSupplierPayments(tenantId)
}

function computeCitForPeriod(tenantId: string, startDate: string, endDate: string) {
  const cit = db.prepare(
    `SELECT
       SUM(CASE WHEN a.type = 'REVENUE' THEN jl.credit - jl.debit ELSE 0 END) AS revenue,
       SUM(CASE WHEN a.type IN ('EXPENSE', 'COGS') THEN jl.debit - jl.credit ELSE 0 END) AS expense
     FROM journal_lines jl
     JOIN accounts a ON jl.account_id = a.id
     JOIN journal_entries je ON jl.journal_entry_id = je.id
     WHERE jl.tenant_id = ? AND je.tenant_id = ? AND je.is_posted = 1
       AND je.date >= ? AND je.date <= ?`
  ).get(tenantId, tenantId, startDate, endDate) as any

  const revenue = cit?.revenue || 0
  const expense = cit?.expense || 0
  const netProfit = revenue - expense
  const taxRate = 20
  const estimatedTax = Math.max(0, netProfit * (taxRate / 100))

  return { revenue, expense, netProfit, estimatedTax, taxRate }
}

// Force re-sync tax data from source documents
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    syncTaxData(tenantId)
    res.json({ success: true, message: 'ซิงค์ข้อมูลภาษีเรียบร้อยแล้ว' })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// Get Tax Dashboard
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    syncTaxData(tenantId)

    const { periodId } = req.query
    let currentPeriodId = periodId as string | undefined

    if (!currentPeriodId) {
      const currentPeriod = db.prepare(
        'SELECT id FROM tax_periods WHERE tenant_id = ? ORDER BY year DESC, month DESC LIMIT 1'
      ).get(tenantId) as { id: string } | undefined
      currentPeriodId = currentPeriod?.id
    }

    if (!currentPeriodId) {
      return res.json({
        success: true,
        data: {
          periodId: null,
          vat: { output: 0, input: 0, net: 0, undeductible: 0 },
          wht: { collected: 0, paid: 0 },
          cit: { revenue: 0, expense: 0, netProfit: 0, estimatedTax: 0, taxRate: 20 },
          alerts: []
        }
      })
    }

    const period = db.prepare(
      'SELECT start_date, end_date FROM tax_periods WHERE tenant_id = ? AND id = ?'
    ).get(tenantId, currentPeriodId) as { start_date: string; end_date: string } | undefined

    const vatSummary = db.prepare(
      `SELECT
         SUM(CASE WHEN transaction_type = 'VAT_OUTPUT' THEN tax_amount ELSE 0 END) AS output_vat,
         SUM(CASE WHEN transaction_type = 'VAT_INPUT' AND is_deductible = 1 THEN tax_amount ELSE 0 END) AS input_vat,
         SUM(CASE WHEN transaction_type = 'VAT_INPUT_UNDEDUCTIBLE' THEN tax_amount ELSE 0 END) AS undeductible_vat
       FROM tax_transactions WHERE tenant_id = ? AND period_id = ?`
    ).get(tenantId, currentPeriodId) as any

    const whtSummary = db.prepare(
      `SELECT SUM(tax_amount) AS wht_total
       FROM tax_transactions WHERE tenant_id = ? AND period_id = ? AND transaction_type = 'WHT'`
    ).get(tenantId, currentPeriodId) as any

    const cit = period
      ? computeCitForPeriod(tenantId, period.start_date, period.end_date)
      : { revenue: 0, expense: 0, netProfit: 0, estimatedTax: 0, taxRate: 20 }

    const outputVat = vatSummary?.output_vat || 0
    const inputVat = vatSummary?.input_vat || 0

    res.json({
      success: true,
      data: {
        periodId: currentPeriodId,
        vat: {
          output: outputVat,
          input: inputVat,
          undeductible: vatSummary?.undeductible_vat || 0,
          net: outputVat - inputVat
        },
        wht: {
          paid: whtSummary?.wht_total || 0,
          collected: 0
        },
        cit,
        alerts: []
      }
    })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// Get Tax Periods
router.get('/periods', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    syncTaxData(tenantId)

    const periods = db.prepare(
      `SELECT p.*,
        COALESCE((SELECT SUM(tax_amount) FROM tax_transactions WHERE tenant_id = p.tenant_id AND period_id = p.id AND transaction_type = 'VAT_OUTPUT'), 0) AS output_vat,
        COALESCE((SELECT SUM(tax_amount) FROM tax_transactions WHERE tenant_id = p.tenant_id AND period_id = p.id AND transaction_type = 'VAT_INPUT' AND is_deductible = 1), 0) AS input_vat,
        COALESCE((SELECT SUM(tax_amount) FROM tax_transactions WHERE tenant_id = p.tenant_id AND period_id = p.id AND transaction_type = 'WHT'), 0) AS wht_amount,
        COALESCE((SELECT SUM(tax_amount) FROM tax_transactions WHERE tenant_id = p.tenant_id AND period_id = p.id AND transaction_type = 'VAT_INPUT_UNDEDUCTIBLE'), 0) AS undeductible_vat
       FROM tax_periods p
       WHERE p.tenant_id = ?
       ORDER BY p.year DESC, p.month DESC`
    ).all(tenantId)

    res.json({ success: true, data: periods })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// Get Tax Transactions
router.get('/transactions', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    syncTaxData(tenantId)

    const { type, periodId } = req.query

    let query = 'SELECT * FROM tax_transactions WHERE tenant_id = ?'
    const params: any[] = [tenantId]

    if (type) {
      if (type === 'VAT') {
        query += " AND transaction_type LIKE 'VAT%'"
      } else {
        query += ' AND transaction_type = ?'
        params.push(type)
      }
    }

    if (periodId) {
      query += ' AND period_id = ?'
      params.push(periodId)
    }

    query += ' ORDER BY document_date DESC LIMIT 500'

    const transactions = db.prepare(query).all(...params)
    res.json({ success: true, data: transactions })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
