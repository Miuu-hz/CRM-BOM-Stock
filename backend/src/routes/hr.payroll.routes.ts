import { Router, Request, Response } from 'express'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { authenticate, requirePermission } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import { ACC } from '../config/accountCodes'
import { getOrCreateAccount, getAccountIdByCode } from '../services/accounting.service'
import {
  calculatePayroll, DEFAULT_HR_SETTINGS, HrSettings, EmploymentType,
  OtEntry, PayItem, OtherDeduction, TaxAllowances, PayrollCalcResult, round2, roundBaht,
} from '../services/hr/payrollCalc'
import { insertJournalEntry, closedPeriodLabel, reverseJournalEntry, JournalLineInput } from './journal.routes'

const router = Router()
router.use(authenticate, subscriptionGate('hr'))

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const VALID_CALC_TYPES = ['FIXED', 'PER_DAY'] as const
const nowIso = () => new Date().toISOString()

function getPeriodBounds(period: string): { startDate: string; endDate: string } {
  const [yStr, mStr] = period.split('-')
  const lastDay = new Date(Date.UTC(Number(yStr), Number(mStr), 0)).getUTCDate()
  return { startDate: `${period}-01`, endDate: `${period}-${String(lastDay).padStart(2, '0')}` }
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

export function getTenantHrSettings(tenantId: string): HrSettings {
  const row = db.prepare('SELECT settings FROM hr_settings WHERE tenant_id = ?').get(tenantId) as { settings: string } | undefined
  const overrides = safeJsonParse<Partial<HrSettings>>(row?.settings, {})
  const merged: HrSettings = { ...DEFAULT_HR_SETTINGS, ...overrides }
  if (overrides.ssoDeductionCapPerYear === undefined) {
    merged.ssoDeductionCapPerYear = roundBaht(merged.ssoMaxBase * merged.ssoRate) * 12
  }
  return merged
}

export interface LineInputs {
  daysWorked: number; hoursWorked: number; unpaidLeaveDays: number; lateMinutes: number
  ot: OtEntry[]; extraPayItems: PayItem[]; otherDeductions: OtherDeduction[]; disabledPayItemIds?: string[]
}

const DEFAULT_LINE_INPUTS: LineInputs = {
  daysWorked: 0, hoursWorked: 0, unpaidLeaveDays: 0, lateMinutes: 0,
  ot: [], extraPayItems: [], otherDeductions: [], disabledPayItemIds: [],
}

function normalizeLineInputs(raw: any): LineInputs {
  const nonNeg = (v: unknown, label: string) => {
    const n = v !== undefined ? Number(v) : 0
    if (!Number.isFinite(n) || n < 0) throw new Error(`${label}ต้องเป็นตัวเลขไม่ติดลบ`)
    return n
  }
  const daysWorked = nonNeg(raw?.daysWorked, 'จำนวนวันทำงาน')
  const hoursWorked = nonNeg(raw?.hoursWorked, 'จำนวนชั่วโมงทำงาน')
  const unpaidLeaveDays = nonNeg(raw?.unpaidLeaveDays, 'จำนวนวันลาไม่รับค่าจ้าง')
  const lateMinutes = nonNeg(raw?.lateMinutes, 'นาทีมาสาย')
  const ot: OtEntry[] = Array.isArray(raw?.ot) ? raw.ot.map((o: any) => ({ hours: Number(o?.hours ?? 0), kind: o?.kind })) : []
  const rawExtra = Array.isArray(raw?.extraPayItems) ? raw.extraPayItems : Array.isArray(raw?.payItems) ? raw.payItems : []
  const extraPayItems: PayItem[] = rawExtra.map((p: any) => ({
    name: String(p?.name ?? '').trim(), amount: Number(p?.amount ?? 0),
    taxable: p?.taxable !== undefined ? Boolean(p.taxable) : true,
    ssoable: p?.ssoable !== undefined ? Boolean(p.ssoable) : false,
  }))
  const otherDeductions: OtherDeduction[] = Array.isArray(raw?.otherDeductions)
    ? raw.otherDeductions.map((d: any) => ({ name: String(d?.name ?? '').trim(), amount: Number(d?.amount ?? 0) })) : []
  const disabledPayItemIds: string[] = Array.isArray(raw?.disabledPayItemIds) ? raw.disabledPayItemIds.map((id: any) => String(id)) : []
  return { daysWorked, hoursWorked, unpaidLeaveDays, lateMinutes, ot, extraPayItems, otherDeductions, disabledPayItemIds }
}

interface EmployeeRecurringItemRow {
  pay_item_id: string; amount: number | null; name: string
  taxable: number; ssoable: number; calc: 'FIXED' | 'PER_DAY'; default_amount: number
}

function getEmployeeRecurringItems(tenantId: string, employeeId: string): EmployeeRecurringItemRow[] {
  return db.prepare(
    `SELECT epi.pay_item_id, epi.amount, pi.name, pi.taxable, pi.ssoable, pi.calc, pi.default_amount
     FROM employee_pay_items epi JOIN pay_items pi ON pi.id = epi.pay_item_id AND pi.tenant_id = epi.tenant_id
     WHERE epi.tenant_id = ? AND epi.employee_id = ? AND pi.is_active = 1 ORDER BY pi.created_at ASC, pi.name ASC`
  ).all(tenantId, employeeId) as EmployeeRecurringItemRow[]
}

function computeEmployeeLine(
  tenantId: string,
  emp: { id: string; employment_type: EmploymentType; base_wage: number; sso_enrolled: number; tax_allowances: string },
  inputs: LineInputs,
  settings: HrSettings
): PayrollCalcResult {
  const disabledSet = new Set(inputs.disabledPayItemIds ?? [])
  const recurringPayItems: PayItem[] = []
  for (const item of getEmployeeRecurringItems(tenantId, emp.id)) {
    if (disabledSet.has(item.pay_item_id)) continue
    const rate = item.amount !== null && item.amount !== undefined ? Number(item.amount) : Number(item.default_amount)
    const computedAmount = item.calc === 'PER_DAY' ? round2(rate * inputs.daysWorked) : round2(rate)
    if (computedAmount > 0) {
      recurringPayItems.push({ name: item.name, amount: computedAmount, taxable: Boolean(item.taxable), ssoable: Boolean(item.ssoable) })
    }
  }
  return calculatePayroll({
    employmentType: emp.employment_type, baseWage: Number(emp.base_wage),
    daysWorked: inputs.daysWorked, hoursWorked: inputs.hoursWorked,
    unpaidLeaveDays: inputs.unpaidLeaveDays, lateMinutes: inputs.lateMinutes, ot: inputs.ot,
    payItems: [...recurringPayItems, ...(inputs.extraPayItems ?? [])],
    otherDeductions: inputs.otherDeductions, ssoEnrolled: Boolean(emp.sso_enrolled),
    taxAllowances: safeJsonParse<TaxAllowances>(emp.tax_allowances, {}),
  }, settings)
}

function formatRunLine(tenantId: string, row: any) {
  const inputs = safeJsonParse<LineInputs>(row.inputs, DEFAULT_LINE_INPUTS)
  const result = safeJsonParse<PayrollCalcResult>(row.result, {
    basePay: 0, lateDeduction: 0, otPay: 0, payItemsTotal: 0, gross: 0, ssoBase: 0,
    ssoEmployee: 0, ssoEmployer: 0, taxableMonthly: 0, wht: 0, otherDeductionsTotal: 0, net: 0, lines: [],
  })
  const recurring = getEmployeeRecurringItems(tenantId, row.employee_id).map((r: EmployeeRecurringItemRow) => ({
    pay_item_id: r.pay_item_id, name: r.name, calc: r.calc,
    rate: round2(r.amount !== null && r.amount !== undefined ? Number(r.amount) : Number(r.default_amount)),
    taxable: Boolean(r.taxable), ssoable: Boolean(r.ssoable),
  }))
  const firstName = row.first_name ?? ''
  const lastName = row.last_name ?? ''
  const code = row.code ?? row.employee_code ?? ''
  const fullName = `${firstName} ${lastName}`.trim()
  return {
    id: row.id, tenant_id: row.tenant_id, run_id: row.run_id, employee_id: row.employee_id,
    code, employee_code: code, first_name: firstName, last_name: lastName, nickname: row.nickname ?? null,
    employee_name: fullName, full_name: fullName, national_id: row.national_id ?? null,
    employment_type: row.employment_type ?? 'MONTHLY', base_wage: round2(Number(row.base_wage ?? 0)),
    sso_enrolled: Boolean(row.sso_enrolled ?? 1), org_unit_id: row.org_unit_id ?? null,
    org_unit_name: row.org_unit_name ?? null, business_unit: row.business_unit ?? null,
    position: row.position ?? null, bank_name: row.bank_name ?? null, bank_account: row.bank_account ?? null,
    inputs, recurring_pay_items: recurring, result,
    base_pay: round2(Number(result.basePay ?? 0)), ot_pay: round2(Number(result.otPay ?? 0)),
    pay_items_total: round2(Number(result.payItemsTotal ?? 0)), sso_base: round2(Number(result.ssoBase ?? 0)),
    taxable_monthly: round2(Number(result.taxableMonthly ?? 0)),
    gross: round2(Number(row.gross ?? 0)), late: round2(Number(row.late ?? 0)),
    sso_employee: round2(Number(row.sso_employee ?? 0)), sso_employer: round2(Number(row.sso_employer ?? 0)),
    wht: round2(Number(row.wht ?? 0)), other_deduction: round2(Number(row.other_deduction ?? 0)),
    net: round2(Number(row.net ?? 0)),
  }
}

type FormattedRunLine = ReturnType<typeof formatRunLine>

function computeRunTotals(lines: FormattedRunLine[]) {
  const sum = (fn: (l: FormattedRunLine) => number) => round2(lines.reduce((s: number, l: FormattedRunLine) => s + fn(l), 0))
  return {
    employee_count: lines.length,
    base_pay: sum(l => l.base_pay), ot_pay: sum(l => l.ot_pay), pay_items_total: sum(l => l.pay_items_total),
    gross: sum(l => l.gross), late: sum(l => l.late), sso_employee: sum(l => l.sso_employee),
    sso_employer: sum(l => l.sso_employer), wht: sum(l => l.wht), other_deduction: sum(l => l.other_deduction),
    net: sum(l => l.net),
  }
}

const RUN_LINE_SELECT = `
  SELECT prl.*, e.code, e.code as employee_code, e.first_name, e.last_name, e.nickname,
         e.national_id, e.employment_type, e.base_wage, e.sso_enrolled,
         e.org_unit_id, e.position, e.bank_name, e.bank_account,
         ou.name as org_unit_name, ou.business_unit as business_unit
  FROM payroll_run_lines prl
  JOIN employees e ON e.id = prl.employee_id AND e.tenant_id = prl.tenant_id
  LEFT JOIN org_units ou ON ou.id = e.org_unit_id AND ou.tenant_id = e.tenant_id`

function getRunDetail(tenantId: string, runId: string) {
  const run = db.prepare('SELECT * FROM payroll_runs WHERE id = ? AND tenant_id = ?').get(runId, tenantId) as any
  if (!run) return null
  const rawLines = db.prepare(`${RUN_LINE_SELECT} WHERE prl.run_id = ? AND prl.tenant_id = ? ORDER BY e.code ASC, e.first_name ASC`).all(runId, tenantId) as any[]
  const lines = rawLines.map((r: any) => formatRunLine(tenantId, r))
  return { ...run, accrual_je_ids: safeJsonParse<string[]>(run.accrual_je_ids, []), lines, totals: computeRunTotals(lines) }
}

// ==================== HR SETTINGS ====================

router.get('/settings', requirePermission('hr', 'read'), (req: Request, res: Response) => {
  res.json(getTenantHrSettings(req.user!.tenantId))
})

router.put('/settings', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const raw = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : req.body
  if (!raw || typeof raw !== 'object') return res.status(400).json({ error: 'ข้อมูลตั้งค่าไม่ถูกต้อง' })

  const current = getTenantHrSettings(tenantId)
  const next: Partial<HrSettings> = {}
  const numericChecks: Array<{ key: keyof HrSettings; label: string; min: number; max?: number; strictPositive?: boolean }> = [
    { key: 'ssoRate', label: 'อัตราประกันสังคม', min: 0, max: 1 },
    { key: 'ssoMinBase', label: 'ฐานประกันสังคมขั้นต่ำ', min: 0 },
    { key: 'ssoMaxBase', label: 'ฐานประกันสังคมสูงสุด', min: 0 },
    { key: 'workHoursPerDay', label: 'ชั่วโมงทำงานต่อวัน', min: 0, strictPositive: true },
    { key: 'daysPerMonthForRate', label: 'จำนวนวันต่อเดือนสำหรับคิดอัตรา', min: 0, strictPositive: true },
    { key: 'expenseDeductionRate', label: 'อัตราหักค่าใช้จ่าย', min: 0, max: 1 },
    { key: 'expenseDeductionCap', label: 'เพดานหักค่าใช้จ่าย', min: 0 },
    { key: 'personalAllowance', label: 'ค่าลดหย่อนส่วนตัว', min: 0 },
    { key: 'ssoDeductionCapPerYear', label: 'เพดานลดหย่อนประกันสังคมต่อปี', min: 0 },
  ]
  for (const chk of numericChecks) {
    if (raw[chk.key] !== undefined) {
      const val = Number(raw[chk.key])
      if (!Number.isFinite(val) || (chk.strictPositive ? val <= chk.min : val < chk.min) || (chk.max !== undefined && val > chk.max)) {
        return res.status(400).json({ error: `${chk.label}ไม่ถูกต้อง` })
      }
      ;(next as any)[chk.key] = val
    }
  }
  if ((next.ssoMaxBase ?? current.ssoMaxBase) < (next.ssoMinBase ?? current.ssoMinBase)) {
    return res.status(400).json({ error: 'ฐานประกันสังคมสูงสุดต้องไม่น้อยกว่าฐานขั้นต่ำ' })
  }
  if (raw.ssoIncludesOT !== undefined) next.ssoIncludesOT = Boolean(raw.ssoIncludesOT)
  if (raw.taxBrackets !== undefined) {
    if (!Array.isArray(raw.taxBrackets) || raw.taxBrackets.length === 0) return res.status(400).json({ error: 'ตารางขั้นภาษีไม่ถูกต้อง' })
    for (const b of raw.taxBrackets) {
      if (typeof b?.min !== 'number' || !Number.isFinite(b.min) || b.min < 0 ||
          (b.max !== null && (typeof b.max !== 'number' || !Number.isFinite(b.max) || b.max <= b.min)) ||
          typeof b?.rate !== 'number' || !Number.isFinite(b.rate) || b.rate < 0 || b.rate > 1) {
        return res.status(400).json({ error: 'ตารางขั้นภาษีไม่ถูกต้อง' })
      }
    }
    next.taxBrackets = raw.taxBrackets
  }

  const existingRow = db.prepare('SELECT settings FROM hr_settings WHERE tenant_id = ?').get(tenantId) as { settings: string } | undefined
  const mergedOverrides = { ...safeJsonParse<Partial<HrSettings>>(existingRow?.settings, {}), ...next }
  db.prepare(
    `INSERT INTO hr_settings (tenant_id, settings, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(tenant_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`
  ).run(tenantId, JSON.stringify(mergedOverrides), nowIso())
  res.json(getTenantHrSettings(tenantId))
})

// ==================== PAY ITEMS & EMPLOYEE PAY ITEMS ====================

const formatPayItemRow = (r: any) => ({
  id: r.id, tenant_id: r.tenant_id, name: r.name, taxable: Number(r.taxable), ssoable: Number(r.ssoable),
  calc: r.calc as 'FIXED' | 'PER_DAY', default_amount: round2(Number(r.default_amount ?? 0)),
  is_active: Number(r.is_active), created_at: r.created_at,
})

router.get('/pay-items', requirePermission('hr', 'read'), (req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM pay_items WHERE tenant_id = ? ORDER BY created_at ASC, name ASC').all(req.user!.tenantId) as any[]
  res.json(rows.map(formatPayItemRow))
})

router.post('/pay-items', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const { name, taxable = 1, ssoable = 0, calc = 'FIXED', default_amount = 0, is_active = 1 } = req.body || {}
  if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อรายการเงินได้' })
  if (!VALID_CALC_TYPES.includes(calc)) return res.status(400).json({ error: 'วิธีคำนวณต้องเป็น FIXED หรือ PER_DAY' })
  const amt = Number(default_amount)
  if (!Number.isFinite(amt) || amt < 0) return res.status(400).json({ error: 'จำนวนเงินเริ่มต้นต้องเป็นตัวเลขไม่ติดลบ' })

  const trimmedName = name.trim()
  if (db.prepare('SELECT id FROM pay_items WHERE tenant_id = ? AND name = ?').get(tenantId, trimmedName)) {
    return res.status(409).json({ error: 'มีรายการเงินได้ชื่อนี้อยู่แล้ว' })
  }
  const id = generateId()
  db.prepare(
    `INSERT INTO pay_items (id, tenant_id, name, taxable, ssoable, calc, default_amount, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, tenantId, trimmedName, taxable ? 1 : 0, ssoable ? 1 : 0, calc, round2(amt), is_active ? 1 : 0, nowIso())
  res.status(201).json(formatPayItemRow(db.prepare('SELECT * FROM pay_items WHERE id = ? AND tenant_id = ?').get(id, tenantId)))
})

router.put('/pay-items/:id', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const { id } = req.params
  const existing = db.prepare('SELECT * FROM pay_items WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
  if (!existing) return res.status(404).json({ error: 'ไม่พบรายการเงินได้' })

  const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name
  if (!name) return res.status(400).json({ error: 'กรุณาระบุชื่อรายการเงินได้' })
  const calc = req.body?.calc !== undefined ? req.body.calc : existing.calc
  if (!VALID_CALC_TYPES.includes(calc)) return res.status(400).json({ error: 'วิธีคำนวณต้องเป็น FIXED หรือ PER_DAY' })
  const amt = req.body?.default_amount !== undefined ? Number(req.body.default_amount) : Number(existing.default_amount)
  if (!Number.isFinite(amt) || amt < 0) return res.status(400).json({ error: 'จำนวนเงินเริ่มต้นต้องเป็นตัวเลขไม่ติดลบ' })
  if (db.prepare('SELECT id FROM pay_items WHERE tenant_id = ? AND name = ? AND id <> ?').get(tenantId, name, id)) {
    return res.status(409).json({ error: 'มีรายการเงินได้ชื่อนี้อยู่แล้ว' })
  }

  db.prepare('UPDATE pay_items SET name = ?, taxable = ?, ssoable = ?, calc = ?, default_amount = ?, is_active = ? WHERE id = ? AND tenant_id = ?').run(
    name,
    req.body?.taxable !== undefined ? (req.body.taxable ? 1 : 0) : existing.taxable,
    req.body?.ssoable !== undefined ? (req.body.ssoable ? 1 : 0) : existing.ssoable,
    calc, round2(amt),
    req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active,
    id, tenantId
  )
  res.json(formatPayItemRow(db.prepare('SELECT * FROM pay_items WHERE id = ? AND tenant_id = ?').get(id, tenantId)))
})

router.post('/pay-items/starter', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const now = nowIso()
  const starterItems: Array<{ name: string; calc: 'FIXED' | 'PER_DAY'; taxable: number; ssoable: number }> = [
    { name: 'ค่าอาหาร', calc: 'PER_DAY', taxable: 1, ssoable: 0 },
    { name: 'ค่าเดินทาง', calc: 'FIXED', taxable: 1, ssoable: 0 },
    { name: 'เบี้ยขยัน', calc: 'FIXED', taxable: 1, ssoable: 1 },
    { name: 'ค่าที่พัก', calc: 'FIXED', taxable: 1, ssoable: 0 },
  ]
  db.transaction(() => {
    const stmt = db.prepare(`INSERT OR IGNORE INTO pay_items (id, tenant_id, name, taxable, ssoable, calc, default_amount, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)`)
    for (const item of starterItems) stmt.run(generateId(), tenantId, item.name, item.taxable, item.ssoable, item.calc, now)
  })()
  const rows = db.prepare('SELECT * FROM pay_items WHERE tenant_id = ? ORDER BY created_at ASC, name ASC').all(tenantId) as any[]
  res.status(201).json(rows.map(formatPayItemRow))
})

function listEmployeePayItems(tenantId: string, employeeId: string) {
  const rows = db.prepare(
    `SELECT epi.id, epi.tenant_id, epi.employee_id, epi.pay_item_id, epi.amount,
            pi.name, pi.taxable, pi.ssoable, pi.calc, pi.default_amount, pi.is_active
     FROM employee_pay_items epi JOIN pay_items pi ON pi.id = epi.pay_item_id AND pi.tenant_id = epi.tenant_id
     WHERE epi.tenant_id = ? AND epi.employee_id = ? ORDER BY pi.created_at ASC, pi.name ASC`
  ).all(tenantId, employeeId) as any[]
  return rows.map((r: any) => ({
    id: r.id, tenant_id: r.tenant_id, employee_id: r.employee_id, pay_item_id: r.pay_item_id,
    amount: r.amount !== null && r.amount !== undefined ? round2(Number(r.amount)) : null,
    name: r.name, taxable: Number(r.taxable), ssoable: Number(r.ssoable), calc: r.calc,
    default_amount: round2(Number(r.default_amount ?? 0)),
    effective_amount: round2(Number(r.amount !== null && r.amount !== undefined ? r.amount : (r.default_amount ?? 0))),
    is_active: Number(r.is_active),
  }))
}

router.get('/employees/:id/pay-items', requirePermission('hr', 'read'), (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  if (!db.prepare('SELECT id FROM employees WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)) {
    return res.status(404).json({ error: 'ไม่พบข้อมูลพนักงาน' })
  }
  res.json(listEmployeePayItems(tenantId, req.params.id))
})

router.put('/employees/:id/pay-items', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const { id } = req.params
  if (!db.prepare('SELECT id FROM employees WHERE id = ? AND tenant_id = ?').get(id, tenantId)) {
    return res.status(404).json({ error: 'ไม่พบข้อมูลพนักงาน' })
  }
  const rawItems = Array.isArray(req.body) ? req.body : req.body?.items
  if (!Array.isArray(rawItems)) return res.status(400).json({ error: 'รูปแบบรายการสวัสดิการไม่ถูกต้อง' })

  for (const item of rawItems) {
    if (!item?.pay_item_id || typeof item.pay_item_id !== 'string') return res.status(400).json({ error: 'กรุณาระบุ pay_item_id' })
    if (!db.prepare('SELECT id FROM pay_items WHERE id = ? AND tenant_id = ?').get(item.pay_item_id, tenantId)) {
      return res.status(400).json({ error: 'ไม่พบรายการเงินได้ที่เลือกในกิจการนี้' })
    }
    if (item.amount !== null && item.amount !== undefined && item.amount !== '') {
      const amt = Number(item.amount)
      if (!Number.isFinite(amt) || amt < 0) return res.status(400).json({ error: 'จำนวนเงินต้องเป็นตัวเลขไม่ติดลบ' })
    }
  }

  db.transaction(() => {
    db.prepare('DELETE FROM employee_pay_items WHERE tenant_id = ? AND employee_id = ?').run(tenantId, id)
    const insertStmt = db.prepare('INSERT INTO employee_pay_items (id, tenant_id, employee_id, pay_item_id, amount) VALUES (?, ?, ?, ?, ?)')
    const seen = new Set<string>()
    for (const item of rawItems) {
      if (seen.has(item.pay_item_id)) continue
      seen.add(item.pay_item_id)
      const amt = item.amount !== null && item.amount !== undefined && item.amount !== '' ? round2(Number(item.amount)) : null
      insertStmt.run(generateId(), tenantId, id, item.pay_item_id, amt)
    }
  })()
  res.json(listEmployeePayItems(tenantId, id))
})

// ==================== PND1 TAX EXPORT (must be registered before /payroll-runs/:id) ====================

router.get('/payroll-runs/tax/pnd1', requirePermission('hr', 'read'), (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const period = String(req.query.period ?? '').trim()
  if (!PERIOD_RE.test(period)) return res.status(400).json({ error: 'กรุณาระบุงวด (period) ในรูปแบบ YYYY-MM' })

  const run = db.prepare(
    `SELECT id, period, status, pay_date FROM payroll_runs WHERE tenant_id = ? AND period = ? AND status IN ('POSTED', 'PAID') ORDER BY updated_at DESC LIMIT 1`
  ).get(tenantId, period) as { id: string; period: string; status: string; pay_date: string | null } | undefined

  const rawRows = run
    ? (db.prepare(
        `SELECT prl.*, e.code, e.code as employee_code, e.first_name, e.last_name, e.national_id
         FROM payroll_run_lines prl JOIN employees e ON e.id = prl.employee_id AND e.tenant_id = prl.tenant_id
         WHERE prl.tenant_id = ? AND prl.run_id = ? ORDER BY e.code ASC, e.first_name ASC`
      ).all(tenantId, run.id) as any[])
    : []

  const rows = rawRows.map((r: any) => {
    const calcRes = safeJsonParse<Partial<PayrollCalcResult>>(r.result, {})
    const income = round2(calcRes.taxableMonthly !== undefined ? Number(calcRes.taxableMonthly) : Number(r.gross ?? 0) - Number(r.late ?? 0))
    return {
      employee_id: r.employee_id, code: r.code ?? '', employee_code: r.employee_code ?? '',
      national_id: r.national_id ?? '', name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(),
      income, gross: round2(Number(r.gross ?? 0)), wht: round2(Number(r.wht ?? 0)),
    }
  })

  if (req.query.format === 'csv') {
    const csvLines = [
      'เลขบัตรประชาชน,ชื่อ-สกุล,เงินได้พึงประเมิน,ภาษีหัก ณ ที่จ่าย',
      ...rows.map(r => `"${String(r.national_id).replace(/"/g, '""')}","${String(r.name).replace(/"/g, '""')}",${r.income.toFixed(2)},${r.wht.toFixed(2)}`),
    ]
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="pnd1-${period}.csv"`)
    return res.send('\uFEFF' + csvLines.join('\n'))
  }

  res.json({
    period, run_id: run?.id ?? null, status: run?.status ?? null, pay_date: run?.pay_date ?? null, rows,
    totals: {
      employee_count: rows.length,
      income: round2(rows.reduce((s: number, r) => s + r.income, 0)),
      gross: round2(rows.reduce((s: number, r) => s + r.gross, 0)),
      wht: round2(rows.reduce((s: number, r) => s + r.wht, 0)),
    },
  })
})

// ==================== PAYROLL RUNS ====================

router.get('/payroll-runs', requirePermission('hr', 'read'), (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const runs = db.prepare('SELECT * FROM payroll_runs WHERE tenant_id = ? ORDER BY period DESC, created_at DESC').all(tenantId) as any[]
  res.json(runs.map((r: any) => {
    const agg = db.prepare(
      `SELECT COUNT(*) as employee_count, COALESCE(SUM(gross), 0) as gross, COALESCE(SUM(late), 0) as late,
              COALESCE(SUM(sso_employee), 0) as sso_employee, COALESCE(SUM(sso_employer), 0) as sso_employer,
              COALESCE(SUM(wht), 0) as wht, COALESCE(SUM(other_deduction), 0) as other_deduction, COALESCE(SUM(net), 0) as net
       FROM payroll_run_lines WHERE run_id = ? AND tenant_id = ?`
    ).get(r.id, tenantId) as any
    return {
      ...r, accrual_je_ids: safeJsonParse<string[]>(r.accrual_je_ids, []),
      totals: {
        employee_count: Number(agg?.employee_count ?? 0),
        gross: round2(Number(agg?.gross ?? 0)), late: round2(Number(agg?.late ?? 0)),
        sso_employee: round2(Number(agg?.sso_employee ?? 0)), sso_employer: round2(Number(agg?.sso_employer ?? 0)),
        wht: round2(Number(agg?.wht ?? 0)), other_deduction: round2(Number(agg?.other_deduction ?? 0)),
        net: round2(Number(agg?.net ?? 0)),
      },
    }
  }))
})

router.post('/payroll-runs', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const period = String(req.body?.period ?? '').trim()
  if (!PERIOD_RE.test(period)) return res.status(400).json({ error: 'กรุณาระบุงวด (period) ในรูปแบบ YYYY-MM' })
  if (db.prepare("SELECT id FROM payroll_runs WHERE tenant_id = ? AND period = ? AND status <> 'VOID'").get(tenantId, period)) {
    return res.status(409).json({ error: `มีรอบเงินเดือนงวด ${period} อยู่แล้ว` })
  }

  const { startDate, endDate } = getPeriodBounds(period)
  const settings = getTenantHrSettings(tenantId)
  const activeEmployees = db.prepare(
    `SELECT id, employment_type, base_wage, sso_enrolled, tax_allowances FROM employees
     WHERE tenant_id = ? AND start_date <= ? AND ((end_date IS NULL AND status = 'ACTIVE') OR (end_date IS NOT NULL AND end_date >= ?))
     ORDER BY code ASC, first_name ASC`
  ).all(tenantId, endDate, startDate) as Array<{ id: string; employment_type: EmploymentType; base_wage: number; sso_enrolled: number; tax_allowances: string }>

  const runId = generateId()
  const now = nowIso()
  db.transaction(() => {
    db.prepare(`INSERT INTO payroll_runs (id, tenant_id, period, status, accrual_je_ids, created_by, created_at, updated_at) VALUES (?, ?, ?, 'DRAFT', '[]', ?, ?, ?)`)
      .run(runId, tenantId, period, req.user!.userId, now, now)
    const insertLine = db.prepare(
      `INSERT INTO payroll_run_lines (id, tenant_id, run_id, employee_id, inputs, result, gross, late, sso_employee, sso_employer, wht, other_deduction, net) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const emp of activeEmployees) {
      const inputs: LineInputs = { ...DEFAULT_LINE_INPUTS }
      const c = computeEmployeeLine(tenantId, emp, inputs, settings)
      insertLine.run(generateId(), tenantId, runId, emp.id, JSON.stringify(inputs), JSON.stringify(c),
        c.gross, c.lateDeduction, c.ssoEmployee, c.ssoEmployer, c.wht, c.otherDeductionsTotal, c.net)
    }
  })()
  res.status(201).json(getRunDetail(tenantId, runId))
})

router.get('/payroll-runs/:id', requirePermission('hr', 'read'), (req: Request, res: Response) => {
  const detail = getRunDetail(req.user!.tenantId, req.params.id)
  if (!detail) return res.status(404).json({ error: 'ไม่พบรอบเงินเดือน' })
  res.json(detail)
})

router.put('/payroll-runs/:id/lines/:lineId', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const { id, lineId } = req.params
  const run = db.prepare('SELECT id, status FROM payroll_runs WHERE id = ? AND tenant_id = ?').get(id, tenantId) as { id: string; status: string } | undefined
  if (!run) return res.status(404).json({ error: 'ไม่พบรอบเงินเดือน' })
  if (run.status !== 'DRAFT') return res.status(400).json({ error: 'แก้ไขได้เฉพาะรอบเงินเดือนที่มีสถานะ DRAFT เท่านั้น' })

  const lineRow = db.prepare('SELECT * FROM payroll_run_lines WHERE id = ? AND run_id = ? AND tenant_id = ?').get(lineId, id, tenantId) as any
  if (!lineRow) return res.status(404).json({ error: 'ไม่พบบรรทัดเงินเดือนพนักงาน' })

  const emp = db.prepare('SELECT id, employment_type, base_wage, sso_enrolled, tax_allowances FROM employees WHERE id = ? AND tenant_id = ?')
    .get(lineRow.employee_id, tenantId) as any
  if (!emp) return res.status(404).json({ error: 'ไม่พบข้อมูลพนักงาน' })

  const prevInputs = safeJsonParse<LineInputs>(lineRow.inputs, DEFAULT_LINE_INPUTS)
  const rawInputPayload = req.body?.inputs && typeof req.body.inputs === 'object' ? req.body.inputs : req.body

  let nextInputs: LineInputs
  let calcResult: PayrollCalcResult
  try {
    nextInputs = normalizeLineInputs({ ...prevInputs, ...rawInputPayload })
    calcResult = computeEmployeeLine(tenantId, emp, nextInputs, getTenantHrSettings(tenantId))
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'ไม่สามารถคำนวณเงินเดือนได้' })
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE payroll_run_lines SET inputs = ?, result = ?, gross = ?, late = ?, sso_employee = ?, sso_employer = ?, wht = ?, other_deduction = ?, net = ?
       WHERE id = ? AND run_id = ? AND tenant_id = ?`
    ).run(JSON.stringify(nextInputs), JSON.stringify(calcResult), calcResult.gross, calcResult.lateDeduction,
      calcResult.ssoEmployee, calcResult.ssoEmployer, calcResult.wht, calcResult.otherDeductionsTotal, calcResult.net, lineId, id, tenantId)
    db.prepare('UPDATE payroll_runs SET updated_at = ? WHERE id = ? AND tenant_id = ?').run(nowIso(), id, tenantId)
  })()

  const updatedRow = db.prepare(`${RUN_LINE_SELECT} WHERE prl.id = ? AND prl.run_id = ? AND prl.tenant_id = ?`).get(lineId, id, tenantId)
  res.json(formatRunLine(tenantId, updatedRow))
})

router.post('/payroll-runs/:id/approve', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const { id } = req.params
  const run = db.prepare('SELECT * FROM payroll_runs WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
  if (!run) return res.status(404).json({ error: 'ไม่พบรอบเงินเดือน' })
  if (run.status !== 'DRAFT') return res.status(400).json({ error: 'อนุมัติได้เฉพาะรอบเงินเดือนที่มีสถานะ DRAFT เท่านั้น' })

  const now = nowIso()
  db.prepare("UPDATE payroll_runs SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
    .run(req.user!.userId, now, now, id, tenantId)
  res.json(getRunDetail(tenantId, id))
})

function createRunPaymentJe(
  tenantId: string, actor: string, run: { id: string; period: string },
  payDate: string, payAccountId: string, totalNet: number, employeeCount: number
): string {
  const [yStr, mStr] = run.period.split('-')
  const periodLabel = `${mStr}/${yStr}`
  const accruedAccountId = getOrCreateAccount(tenantId, ACC.ACCRUED)
  const amt = round2(totalNet)
  const now = nowIso()
  const je = insertJournalEntry(tenantId, actor, {
    date: payDate,
    description: `จ่ายเงินเดือน งวด ${periodLabel} · ${employeeCount} คน`,
    referenceType: 'PAYROLL_RUN',
    referenceId: run.id,
    notes: `จ่ายเงินเดือนสุทธิ งวด ${periodLabel} จำนวน ${employeeCount} คน`,
    totalDebit: amt,
    totalCredit: amt,
    lines: [
      { accountId: accruedAccountId, debit: amt, credit: 0, description: `ตัดจ่ายเงินเดือนค้างจ่าย งวด ${periodLabel}` },
      { accountId: payAccountId, debit: 0, credit: amt, description: `จ่ายเงินเดือนพนักงาน งวด ${periodLabel}` },
    ],
  })
  db.prepare('UPDATE journal_entries SET is_posted = 1, posted_at = ?, posted_by = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
    .run(now, actor, now, je.id, tenantId)
  return je.id
}

router.post('/payroll-runs/:id/post', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const actor = req.user!.email || req.user!.userId
  const { id } = req.params

  const run = db.prepare('SELECT * FROM payroll_runs WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
  if (!run) return res.status(404).json({ error: 'ไม่พบรอบเงินเดือน' })
  if (run.status !== 'APPROVED') return res.status(400).json({ error: 'ลงบัญชีได้เฉพาะรอบเงินเดือนที่อนุมัติแล้ว (APPROVED) เท่านั้น' })

  const { endDate: periodEndDate } = getPeriodBounds(run.period)
  const payDate = req.body?.payDate ? String(req.body.payDate).trim() : periodEndDate
  if (!ISO_DATE_RE.test(payDate)) return res.status(400).json({ error: 'รูปแบบวันที่จ่ายเงินไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)' })

  const closedPeriod = closedPeriodLabel(tenantId, periodEndDate) || closedPeriodLabel(tenantId, payDate)
  if (closedPeriod) return res.status(400).json({ error: `งวดบัญชี ${closedPeriod} ปิดแล้ว ไม่สามารถลงบัญชีได้` })

  const payAccountId = req.body?.payAccountId ? String(req.body.payAccountId).trim() : null
  const payNow = Boolean(req.body?.payNow)
  if (payNow && !payAccountId) return res.status(400).json({ error: 'กรุณาเลือกบัญชีจ่ายเงิน (เงินสด/เงินฝากธนาคาร)' })
  if (payAccountId) {
    const payAcc = db.prepare('SELECT id, type FROM accounts WHERE id = ? AND tenant_id = ?').get(payAccountId, tenantId) as { id: string; type: string } | undefined
    if (!payAcc || payAcc.type !== 'ASSET') return res.status(400).json({ error: 'บัญชีจ่ายเงินต้องเป็นหมวดสินทรัพย์ (ASSET) ของกิจการ' })
  }

  const detail = getRunDetail(tenantId, id)!
  if (detail.lines.length === 0) return res.status(400).json({ error: 'ไม่มีรายการพนักงานในรอบเงินเดือนนี้' })

  const totalOtherDed = round2(detail.lines.reduce((s: number, l: FormattedRunLine) => s + l.other_deduction, 0))
  const otherDeductionAccountId = req.body?.otherDeductionAccountId ? String(req.body.otherDeductionAccountId).trim() : null
  if (totalOtherDed > 0) {
    if (!otherDeductionAccountId) return res.status(400).json({ error: 'กรุณาเลือกบัญชีสำหรับรายการหักอื่นๆ' })
    if (!db.prepare('SELECT id FROM accounts WHERE id = ? AND tenant_id = ?').get(otherDeductionAccountId, tenantId)) {
      return res.status(400).json({ error: 'ไม่พบบัญชีสำหรับรายการหักอื่นๆ ในกิจการนี้' })
    }
  }

  const groups = new Map<string | null, FormattedRunLine[]>()
  for (const line of detail.lines) {
    const bu = line.business_unit ? String(line.business_unit) : null
    if (!groups.has(bu)) groups.set(bu, [])
    groups.get(bu)!.push(line)
  }

  const [yStr, mStr] = run.period.split('-')
  const periodLabel = `${mStr}/${yStr}`
  const warnings: string[] = []
  const accrualJeIds: string[] = []
  let paymentJeId: string | null = null

  try {
    db.transaction(() => {
      const salaryAccountId = getOrCreateAccount(tenantId, ACC.SALARY)
      const ssoExpenseAccountId = getAccountIdByCode(tenantId, ACC.SSO_EXPENSE)
      if (!ssoExpenseAccountId) warnings.push('ไม่พบบัญชี 5314 (ประกันสังคมส่วนนายจ้าง) — รวมเข้า 5301 เงินเดือนและค่าจ้าง')
      const accruedAccountId = getOrCreateAccount(tenantId, ACC.ACCRUED)
      const ssoPayableAccountId = getOrCreateAccount(tenantId, ACC.SSO_PAYABLE)
      const whtPayableAccountId = getOrCreateAccount(tenantId, ACC.WHT_PAYABLE)
      const now = nowIso()

      for (const [bu, groupLines] of groups.entries()) {
        const count = groupLines.length
        const sumG = (fn: (l: FormattedRunLine) => number) => round2(groupLines.reduce((s: number, l: FormattedRunLine) => s + fn(l), 0))
        const wagesExpense = round2(sumG(l => l.gross) - sumG(l => l.late))
        const ssoEmp = sumG(l => l.sso_employee)
        const ssoEmpr = sumG(l => l.sso_employer)
        const wht = sumG(l => l.wht)
        const otherDed = sumG(l => l.other_deduction)
        const net = sumG(l => l.net)
        if (wagesExpense <= 0 && ssoEmpr <= 0 && net <= 0) continue

        const jeLines: JournalLineInput[] = []
        if (wagesExpense > 0) jeLines.push({ accountId: salaryAccountId, debit: wagesExpense, credit: 0, description: `เงินเดือนและค่าจ้าง งวด ${periodLabel}` })
        if (ssoEmpr > 0) jeLines.push({ accountId: ssoExpenseAccountId ?? salaryAccountId, debit: ssoEmpr, credit: 0, description: `เงินสมทบประกันสังคมส่วนนายจ้าง งวด ${periodLabel}` })
        if (net > 0) jeLines.push({ accountId: accruedAccountId, debit: 0, credit: net, description: `ค่าใช้จ่ายค้างจ่าย-เงินเดือนรอนำจ่าย งวด ${periodLabel}` })
        const totalSso = round2(ssoEmp + ssoEmpr)
        if (totalSso > 0) jeLines.push({ accountId: ssoPayableAccountId, debit: 0, credit: totalSso, description: `ประกันสังคมค้างจ่าย (ลูกจ้าง+นายจ้าง) งวด ${periodLabel}` })
        if (wht > 0) jeLines.push({ accountId: whtPayableAccountId, debit: 0, credit: wht, description: `ภาษีหัก ณ ที่จ่ายค้างจ่าย (ภ.ง.ด.1) งวด ${periodLabel}` })
        if (otherDed > 0 && otherDeductionAccountId) jeLines.push({ accountId: otherDeductionAccountId, debit: 0, credit: otherDed, description: `รายการหักอื่นๆ งวด ${periodLabel}` })

        const totalDebit = round2(jeLines.reduce((s: number, l: JournalLineInput) => s + (l.debit ?? 0), 0))
        const totalCredit = round2(jeLines.reduce((s: number, l: JournalLineInput) => s + (l.credit ?? 0), 0))
        const buSuffix = bu ? ` · ${bu}` : ''
        const je = insertJournalEntry(tenantId, actor, {
          date: periodEndDate,
          description: `เงินเดือน งวด ${periodLabel}${buSuffix} · ${count} คน`,
          referenceType: 'PAYROLL_RUN',
          referenceId: run.id,
          businessUnit: bu,
          notes: `ตั้งค้างจ่ายเงินเดือน งวด ${periodLabel}${buSuffix} จำนวน ${count} คน`,
          lines: jeLines,
          totalDebit,
          totalCredit,
        })
        db.prepare('UPDATE journal_entries SET is_posted = 1, posted_at = ?, posted_by = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(now, actor, now, je.id, tenantId)
        accrualJeIds.push(je.id)
      }

      if (payNow && payAccountId && detail.totals.net > 0) {
        paymentJeId = createRunPaymentJe(tenantId, actor, { id: run.id, period: run.period }, payDate, payAccountId, detail.totals.net, detail.lines.length)
      }

      db.prepare(
        `UPDATE payroll_runs SET status = ?, pay_date = ?, pay_account_id = ?, other_deduction_account_id = ?, accrual_je_ids = ?, payment_je_id = ?, posted_at = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`
      ).run(payNow ? 'PAID' : 'POSTED', payDate, payAccountId, otherDeductionAccountId, JSON.stringify(accrualJeIds), paymentJeId, now, now, id, tenantId)
    })()
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'ไม่สามารถลงบัญชีเงินเดือนได้' })
  }

  res.json({ ...getRunDetail(tenantId, id), warnings })
})

router.post('/payroll-runs/:id/pay', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const actor = req.user!.email || req.user!.userId
  const { id } = req.params

  const run = db.prepare('SELECT * FROM payroll_runs WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
  if (!run) return res.status(404).json({ error: 'ไม่พบรอบเงินเดือน' })
  if (run.status !== 'POSTED') return res.status(400).json({ error: 'บันทึกจ่ายเงินได้เฉพาะรอบเงินเดือนที่ลงบัญชีตั้งค้างจ่ายแล้ว (POSTED) เท่านั้น' })

  const payDate = req.body?.payDate ? String(req.body.payDate).trim() : run.pay_date
  if (!payDate || !ISO_DATE_RE.test(payDate)) return res.status(400).json({ error: 'กรุณาระบุวันที่จ่ายเงิน (YYYY-MM-DD)' })

  const closedPay = closedPeriodLabel(tenantId, payDate)
  if (closedPay) return res.status(400).json({ error: `งวดบัญชี ${closedPay} ปิดแล้ว ไม่สามารถลงบัญชีได้` })

  const payAccountId = req.body?.payAccountId ? String(req.body.payAccountId).trim() : run.pay_account_id
  if (!payAccountId) return res.status(400).json({ error: 'กรุณาเลือกบัญชีจ่ายเงิน (หมวดสินทรัพย์)' })
  const payAcc = db.prepare('SELECT id, type FROM accounts WHERE id = ? AND tenant_id = ?').get(payAccountId, tenantId) as { id: string; type: string } | undefined
  if (!payAcc || payAcc.type !== 'ASSET') return res.status(400).json({ error: 'บัญชีจ่ายเงินต้องเป็นหมวดสินทรัพย์ (ASSET) ของกิจการ' })

  const detail = getRunDetail(tenantId, id)!
  try {
    db.transaction(() => {
      const paymentJeId = detail.totals.net > 0
        ? createRunPaymentJe(tenantId, actor, { id: run.id, period: run.period }, payDate, payAccountId, detail.totals.net, detail.lines.length)
        : null
      db.prepare("UPDATE payroll_runs SET status = 'PAID', pay_date = ?, pay_account_id = ?, payment_je_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(payDate, payAccountId, paymentJeId, nowIso(), id, tenantId)
    })()
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'ไม่สามารถบันทึกจ่ายเงินเดือนได้' })
  }

  res.json(getRunDetail(tenantId, id))
})

router.post('/payroll-runs/:id/void', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const actor = req.user!.email || req.user!.userId
  const { id } = req.params

  const run = db.prepare('SELECT * FROM payroll_runs WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
  if (!run) return res.status(404).json({ error: 'ไม่พบรอบเงินเดือน' })
  if (run.status !== 'POSTED' && run.status !== 'PAID') {
    return res.status(400).json({ error: 'ยกเลิกรอบที่มีการกลับรายการบัญชีได้เฉพาะสถานะ POSTED หรือ PAID เท่านั้น' })
  }

  const allJeIds = [...safeJsonParse<string[]>(run.accrual_je_ids, []), ...(run.payment_je_id ? [run.payment_je_id] : [])]
  const today = thaiDateStr()
  const reason = req.body?.reason ? String(req.body.reason).trim() : `ยกเลิกรอบเงินเดือน ${run.period}`
  const reversalIds: string[] = []

  try {
    db.transaction(() => {
      for (const jeId of allJeIds) {
        const entryRow = db.prepare('SELECT id, date FROM journal_entries WHERE id = ? AND tenant_id = ?').get(jeId, tenantId) as { id: string; date: string } | undefined
        if (!entryRow) continue
        const entryDate = String(entryRow.date).slice(0, 10)
        const rev = reverseJournalEntry(tenantId, actor, jeId, reason, entryDate > today ? entryDate : today)
        reversalIds.push(rev.id)
      }
      db.prepare("UPDATE payroll_runs SET status = 'VOID', updated_at = ? WHERE id = ? AND tenant_id = ?").run(nowIso(), id, tenantId)
    })()
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'ไม่สามารถยกเลิกรอบเงินเดือนได้' })
  }

  res.json({ ...getRunDetail(tenantId, id), reversal_je_ids: reversalIds })
})

router.delete('/payroll-runs/:id', requirePermission('hr', 'write'), (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const { id } = req.params
  const run = db.prepare('SELECT id, status FROM payroll_runs WHERE id = ? AND tenant_id = ?').get(id, tenantId) as { id: string; status: string } | undefined
  if (!run) return res.status(404).json({ error: 'ไม่พบรอบเงินเดือน' })
  if (run.status !== 'DRAFT') return res.status(400).json({ error: 'ลบได้เฉพาะรอบเงินเดือนที่มีสถานะ DRAFT เท่านั้น' })

  db.transaction(() => {
    db.prepare('DELETE FROM payroll_run_lines WHERE run_id = ? AND tenant_id = ?').run(id, tenantId)
    db.prepare('DELETE FROM payroll_runs WHERE id = ? AND tenant_id = ?').run(id, tenantId)
  })()
  res.json({ ok: true })
})

// ==================== SLIPS & SSO EXPORT ====================

router.get('/payroll-runs/:id/slips', requirePermission('hr', 'read'), (req: Request, res: Response) => {
  const detail = getRunDetail(req.user!.tenantId, req.params.id)
  if (!detail) return res.status(404).json({ error: 'ไม่พบรอบเงินเดือน' })
  res.json({ run_id: detail.id, period: detail.period, status: detail.status, pay_date: detail.pay_date, slips: detail.lines })
})

router.get('/me/slips', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const rawRows = db.prepare(
    `SELECT prl.*, pr.period, pr.status as run_status, pr.pay_date,
            e.code, e.code as employee_code, e.first_name, e.last_name, e.nickname,
            e.national_id, e.employment_type, e.base_wage, e.sso_enrolled,
            e.org_unit_id, e.position, e.bank_name, e.bank_account,
            ou.name as org_unit_name, ou.business_unit as business_unit
     FROM payroll_run_lines prl
     JOIN payroll_runs pr ON pr.id = prl.run_id AND pr.tenant_id = prl.tenant_id
     JOIN employees e ON e.id = prl.employee_id AND e.tenant_id = prl.tenant_id
     LEFT JOIN org_units ou ON ou.id = e.org_unit_id AND ou.tenant_id = e.tenant_id
     WHERE prl.tenant_id = ? AND e.user_id = ? AND pr.status IN ('POSTED', 'PAID')
     ORDER BY pr.period DESC`
  ).all(tenantId, req.user!.userId) as any[]

  res.json(rawRows.map((r: any) => ({ ...formatRunLine(tenantId, r), period: r.period, status: r.run_status, pay_date: r.pay_date ?? null })))
})

router.get('/payroll-runs/:id/export/sso', requirePermission('hr', 'read'), (req: Request, res: Response) => {
  const detail = getRunDetail(req.user!.tenantId, req.params.id)
  if (!detail) return res.status(404).json({ error: 'ไม่พบรอบเงินเดือน' })

  // ponytail: CSV export for SSO — the official สปส.1-10 135-char fixed-width e-filing text format comes later when portal upload is needed
  const csvLines = [
    'เลขบัตรประชาชน,คำนำหน้า-ชื่อ-สกุล,ค่าจ้าง,เงินสมทบ',
    ...detail.lines.map((l: FormattedRunLine) => `"${String(l.national_id ?? '').replace(/"/g, '""')}","${String(l.full_name).replace(/"/g, '""')}",${l.sso_base.toFixed(2)},${l.sso_employee.toFixed(2)}`),
  ]
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="sso-${detail.period}.csv"`)
  res.send('\uFEFF' + csvLines.join('\n'))
})

export default router
