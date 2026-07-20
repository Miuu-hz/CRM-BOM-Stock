import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

const router = Router()
router.use(authenticate)

// Additive schema migration: wht_form ('PND3' | 'PND53') distinguishes which withholding
// tax return a WHT transaction belongs to. Guarded so it only runs once per fresh DB.
function ensureWhtFormColumn() {
  try {
    const columns = db.prepare("PRAGMA table_info(tax_transactions)").all() as { name: string }[]
    if (!columns.some((c) => c.name === 'wht_form')) {
      db.exec('ALTER TABLE tax_transactions ADD COLUMN wht_form TEXT')
    }
  } catch (error) {
    console.error('Failed to ensure wht_form column:', error)
  }
}
ensureWhtFormColumn()

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

// ponytail: suppliers has no entity-type column, only a purchase category (type: RAW_MATERIAL/PACKAGING/SERVICE).
// Thai practice: 13-digit juristic-person tax IDs start with '0'; personal IDs start 1-8.
// Missing/blank tax_id (common for informal vendors in this data) is treated as an individual -> PND3.
function inferWhtForm(taxId: string | null | undefined): 'PND3' | 'PND53' {
  const id = (taxId || '').trim()
  return id.startsWith('0') ? 'PND53' : 'PND3'
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

// Formal AR invoices (src/routes/sales/invoices.ts) are a separate sales channel from POS bills —
// pos_running_bills has no sales_order_id/invoice_id linkage, so there is no double-count risk here.
function syncVatOutputFromSalesInvoices(tenantId: string) {
  const rows = db.prepare(
    `SELECT i.id, i.invoice_number, i.invoice_date, i.subtotal, i.tax_amount, i.total_amount, i.tax_rate,
            c.name as customer_name
     FROM invoices i
     LEFT JOIN customers c ON i.customer_id = c.id
     WHERE i.tenant_id = ? AND i.status != 'CANCELLED' AND i.tax_amount > 0`
  ).all(tenantId) as any[]

  for (const inv of rows) {
    const docDate = toYMD(inv.invoice_date)
    const periodId = ensurePeriod(tenantId, docDate)
    if (!periodId || transactionExists(tenantId, 'SALES_INVOICE', inv.id)) continue

    db.prepare(
      `INSERT INTO tax_transactions (
         id, tenant_id, period_id, transaction_type, source_type, source_id, document_number, document_date,
         partner_name, description, base_amount, tax_amount, total_amount, tax_rate, is_deductible
       ) VALUES (?, ?, ?, 'VAT_OUTPUT', 'SALES_INVOICE', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      generateId(), tenantId, periodId, inv.id, inv.invoice_number, docDate,
      inv.customer_name || 'ลูกค้า',
      `ภาษีขายจากใบแจ้งหนี้ ${inv.invoice_number}`,
      inv.subtotal ?? 0, inv.tax_amount ?? 0, inv.total_amount ?? 0, inv.tax_rate || 7
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
    const whtForm = inferWhtForm(p.supplier_tax_id)

    db.prepare(
      `INSERT INTO tax_transactions (
         id, tenant_id, period_id, transaction_type, source_type, source_id, document_number, document_date,
         partner_id, partner_name, partner_tax_id, description, base_amount, tax_amount, total_amount,
         tax_rate, wht_rate, wht_form, is_deductible
       ) VALUES (?, ?, ?, 'WHT', 'SUPPLIER_PAYMENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      generateId(), tenantId, periodId, p.id, p.payment_number, toYMD(p.payment_date),
      p.supplier_id ?? null, p.supplier_name || 'ผู้ขาย', p.supplier_tax_id ?? null,
      `ภาษีหัก ณ ที่จ่ายจากการจ่ายเงิน ${p.payment_number}`,
      baseAmount, whtAmount, p.net_amount ?? (baseAmount - whtAmount),
      whtRate, whtRate, whtForm
    )
  }
}

// Tax that CUSTOMERS withheld from US (a CIT prepayment credit), sourced from the withholding_tax
// table (populated via POST /sales/invoices/:id/withholding-tax) keyed to our AR invoices.
// ponytail: no wht_form here — PND3/PND53 filing is the customer's obligation, not ours; we just hold the certificate.
function syncWhtReceivedFromCustomerWht(tenantId: string) {
  const rows = db.prepare(
    `SELECT wt.id, wt.tax_amount, wt.tax_base, wt.tax_rate, wt.tax_type, wt.created_at,
            i.invoice_number, i.invoice_date, i.customer_id,
            c.name as customer_name
     FROM withholding_tax wt
     JOIN invoices i ON wt.invoice_id = i.id
     LEFT JOIN customers c ON i.customer_id = c.id
     WHERE wt.tenant_id = ? AND wt.tax_amount > 0`
  ).all(tenantId) as any[]

  for (const w of rows) {
    const docDate = toYMD(w.invoice_date) || toYMD(w.created_at)
    const periodId = ensurePeriod(tenantId, docDate)
    if (!periodId || transactionExists(tenantId, 'CUSTOMER_WHT', w.id)) continue

    const baseAmount = w.tax_base ?? 0
    const whtAmount = w.tax_amount ?? 0

    db.prepare(
      `INSERT INTO tax_transactions (
         id, tenant_id, period_id, transaction_type, source_type, source_id, document_number, document_date,
         partner_id, partner_name, description, base_amount, tax_amount, total_amount, tax_rate, wht_rate, is_deductible
       ) VALUES (?, ?, ?, 'WHT_RECEIVED', 'CUSTOMER_WHT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      generateId(), tenantId, periodId, w.id, w.invoice_number, docDate,
      w.customer_id ?? null, w.customer_name || 'ลูกค้า',
      `ภาษีหัก ณ ที่จ่ายที่ถูกลูกค้าหักจากใบแจ้งหนี้ ${w.invoice_number}${w.tax_type ? ` (${w.tax_type})` : ''}`,
      baseAmount, whtAmount, baseAmount - whtAmount, w.tax_rate ?? 0, w.tax_rate ?? 0
    )
  }
}

function syncTaxData(tenantId: string) {
  syncVatInputFromPurchaseInvoices(tenantId)
  syncVatOutputFromPosBills(tenantId)
  syncVatOutputFromSalesInvoices(tenantId)
  syncWhtFromSupplierPayments(tenantId)
  syncWhtReceivedFromCustomerWht(tenantId)
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
  const taxRate = 20 // top marginal rate, kept for backward compatibility with old clients
  // ponytail: assumes SME for every tenant (exempt <=300k / 15% up to 3M / 20% above).
  // Wire to a per-tenant company_settings flag if/when non-SME tenants need the flat 20% rate.
  const isSme = true
  const estimatedTax = isSme ? computeSmeCit(netProfit) : Math.max(0, netProfit * (taxRate / 100))
  const effectiveRate = netProfit > 0 ? Math.round((estimatedTax / netProfit) * 1000) / 10 : 0

  return { revenue, expense, netProfit, estimatedTax, taxRate, isSme, effectiveRate }
}

// SME CIT brackets: exempt <= 300,000; 15% from 300,001 - 3,000,000; 20% above 3,000,000
function computeSmeCit(netProfit: number): number {
  if (netProfit <= 0) return 0
  const midBracket = Math.min(Math.max(netProfit - 300000, 0), 2700000) * 0.15
  const topBracket = Math.max(netProfit - 3000000, 0) * 0.2
  return midBracket + topBracket
}

type TaxAlert = { type: 'warning' | 'danger' | 'info'; message: string; action: string }

// Alerts for the selected period plus any still-OPEN periods: overdue filings are danger,
// filings due within 7 days are warnings.
function buildAlerts(tenantId: string, currentPeriodId: string | null | undefined): TaxAlert[] {
  const today = toYMD(new Date().toISOString()) as string
  const soonCutoff = new Date()
  soonCutoff.setDate(soonCutoff.getDate() + 7)
  const soon = toYMD(soonCutoff.toISOString()) as string

  const periods = db.prepare(
    `SELECT id, year, month, vat_due_date, wht_due_date FROM tax_periods
     WHERE tenant_id = ? AND (status = 'OPEN' OR id = ?)`
  ).all(tenantId, currentPeriodId ?? null) as { id: string; year: number; month: number; vat_due_date: string; wht_due_date: string }[]

  const alerts: TaxAlert[] = []

  for (const p of periods) {
    const label = periodMonthKey(p.year, p.month)

    if (p.vat_due_date) {
      if (today > p.vat_due_date) {
        alerts.push({ type: 'danger', message: `เลยกำหนดยื่นภาษีมูลค่าเพิ่ม (ภ.พ.30) งวด ${label} แล้ว`, action: 'ยื่นแบบ ภ.พ.30' })
      } else if (p.vat_due_date <= soon) {
        alerts.push({ type: 'warning', message: `ใกล้ครบกำหนดยื่นภาษีมูลค่าเพิ่ม (ภ.พ.30) งวด ${label} ภายในวันที่ ${p.vat_due_date}`, action: 'ยื่นแบบ ภ.พ.30' })
      }
    }

    if (p.wht_due_date) {
      if (today > p.wht_due_date) {
        alerts.push({ type: 'danger', message: `เลยกำหนดยื่นภาษีหัก ณ ที่จ่าย (ภ.ง.ด.3/53) งวด ${label} แล้ว`, action: 'ยื่นแบบ ภ.ง.ด.3/53' })
      } else if (p.wht_due_date <= soon) {
        alerts.push({ type: 'warning', message: `ใกล้ครบกำหนดยื่นภาษีหัก ณ ที่จ่าย (ภ.ง.ด.3/53) งวด ${label} ภายในวันที่ ${p.wht_due_date}`, action: 'ยื่นแบบ ภ.ง.ด.3/53' })
      }
    }
  }

  return alerts
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
          wht: { collected: 0, paid: 0, pnd3: 0, pnd53: 0 },
          cit: { revenue: 0, expense: 0, netProfit: 0, estimatedTax: 0, taxRate: 20, isSme: true, effectiveRate: 0 },
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
      `SELECT
         SUM(CASE WHEN transaction_type = 'WHT' THEN tax_amount ELSE 0 END) AS wht_paid,
         SUM(CASE WHEN transaction_type = 'WHT_RECEIVED' THEN tax_amount ELSE 0 END) AS wht_collected,
         SUM(CASE WHEN transaction_type = 'WHT' AND wht_form = 'PND3' THEN tax_amount ELSE 0 END) AS wht_pnd3,
         SUM(CASE WHEN transaction_type = 'WHT' AND wht_form = 'PND53' THEN tax_amount ELSE 0 END) AS wht_pnd53
       FROM tax_transactions WHERE tenant_id = ? AND period_id = ?`
    ).get(tenantId, currentPeriodId) as any

    const cit = period
      ? computeCitForPeriod(tenantId, period.start_date, period.end_date)
      : { revenue: 0, expense: 0, netProfit: 0, estimatedTax: 0, taxRate: 20, isSme: true, effectiveRate: 0 }

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
          paid: whtSummary?.wht_paid || 0,
          collected: whtSummary?.wht_collected || 0,
          pnd3: whtSummary?.wht_pnd3 || 0,
          pnd53: whtSummary?.wht_pnd53 || 0
        },
        cit,
        alerts: buildAlerts(tenantId, currentPeriodId)
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

// Toggle whether an input-VAT transaction is deductible (e.g. entertainment expenses are not)
router.patch('/transactions/:id/deductible', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { isDeductible } = req.body

    if (typeof isDeductible !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isDeductible ต้องเป็นค่า true หรือ false' })
    }

    const txn = db.prepare(
      'SELECT id, transaction_type FROM tax_transactions WHERE tenant_id = ? AND id = ?'
    ).get(tenantId, req.params.id) as { id: string; transaction_type: string } | undefined

    if (!txn || !txn.transaction_type.startsWith('VAT_INPUT')) {
      return res.status(404).json({ success: false, message: 'ไม่พบรายการภาษีซื้อที่ต้องการแก้ไข' })
    }

    const newType = isDeductible ? 'VAT_INPUT' : 'VAT_INPUT_UNDEDUCTIBLE'

    db.prepare(
      `UPDATE tax_transactions SET transaction_type = ?, is_deductible = ?, updated_at = datetime('now')
       WHERE tenant_id = ? AND id = ?`
    ).run(newType, isDeductible ? 1 : 0, tenantId, req.params.id)

    const updated = db.prepare('SELECT * FROM tax_transactions WHERE tenant_id = ? AND id = ?').get(tenantId, req.params.id)
    res.json({ success: true, data: updated })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
