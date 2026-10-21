import { Router, Request, Response } from 'express'
import { authenticate, requirePermission } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
import type { JournalEntry, JournalLineWithAccount } from '../types'
import { getAccountIdByCode, getOrCreateAccount } from '../services/accounting.service'
import { ACC } from '../config/accountCodes'

const router = Router()

router.use(authenticate)

// ดูได้ทุกคน · สร้าง/แก้/ลบ/ลงบัญชี ต้องมีสิทธิ์เขียนหมวดบัญชี (Admin, แผนกบัญชี/CEO/IT, ผู้ใช้ระดับสูง)
// เดิมไม่ตรวจเลย พนักงานคนไหนก็ลงสมุดรายวันเองได้ — กระทบงบการเงินตรง (ตรวจสิทธิ์ 2026-09-29)
router.use((req, res, next) => (req.method === 'GET' ? next() : requirePermission('accounting', 'write')(req, res, next)))

interface JournalLineInput {
  accountId: string
  description?: string
  debit?: number
  credit?: number
}

// Period-closing guard: reject writes dated inside a CLOSED tax_period. The year-end closing
// entry itself is written directly by period-closing.routes.ts (not through this endpoint),
// so it never hits this check.
export function closedPeriodLabel(tenantId: string, dateStr: string): string | null {
  const ymd = String(dateStr).includes('T') ? String(dateStr).split('T')[0] : String(dateStr)
  const [year, month] = ymd.split('-').map(Number)
  const period = db.prepare(
    `SELECT status FROM tax_periods WHERE tenant_id = ? AND year = ? AND month = ?`
  ).get(tenantId, year, month) as { status: string } | undefined
  return period?.status === 'CLOSED' ? `${month}/${year}` : null
}

// Generate entry number: JV-YYYY-XXXXX
function generateEntryNumber(tenantId: string, date: string): string {
  const year = new Date(date).getFullYear()
  return formatDocumentNumber('JV', tenantId, 'JOURNAL', year, 5)
}

interface NewJournalEntry {
  date: string
  description: string
  referenceType?: string | null
  referenceId?: string | null
  notes?: string | null
  businessUnit?: string | null
  lines: JournalLineInput[]
  totalDebit: number
  totalCredit: number
}

// บันทึก JE แบบร่าง (is_posted = 0) — ใช้ร่วมกันระหว่างบันทึกเองกับบันทึกเงินเดือน
function insertJournalEntry(tenantId: string, userName: string, e: NewJournalEntry): { id: string; entryNumber: string } {
  const id = generateId()
  const entryNumber = generateEntryNumber(tenantId, e.date)
  const now = new Date().toISOString()

  db.transaction(() => {
    db.prepare(`
      INSERT INTO journal_entries
      (id, tenant_id, entry_number, date, reference_type, reference_id, description,
       total_debit, total_credit, notes, created_by, created_at, updated_at, business_unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, entryNumber, e.date, e.referenceType || null, e.referenceId || null,
           e.description, e.totalDebit, e.totalCredit, e.notes || null, userName, now, now, e.businessUnit || null)

    const insertLine = db.prepare(`
      INSERT INTO journal_lines
      (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (let i = 0; i < e.lines.length; i++) {
      const line = e.lines[i]

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
  })()

  return { id, entryNumber }
}

// ============================================
// PAYROLL - บันทึกจ่ายเงินเดือนเป็น JE (ไม่มีโมดูล HR แยก)
// ============================================

export const PAYROLL_REF = 'PAYROLL'
const BUSINESS_UNITS = ['RETAIL', 'WHOLESALE', 'ONLINE', 'OTHER']
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export class PayrollError extends Error {}

export interface PayrollEmployee {
  name: string
  gross: number          // เงินเดือน/ค่าจ้างก่อนหัก
  ssEmployee?: number    // ประกันสังคมส่วนลูกจ้าง (หักจากเงินเดือน)
  wht?: number           // ภาษีหัก ณ ที่จ่าย
  otherDeduction?: number
}

export interface PayrollInput {
  period: string         // YYYY-MM
  payDate: string        // YYYY-MM-DD
  employees: PayrollEmployee[]   // กรอกยอดรวมก้อนเดียว = ส่งมาคนเดียว
  ssEmployer?: number    // เงินสมทบส่วนนายจ้าง
  payAccountId: string
  otherDeductionAccountId?: string
  businessUnit?: string | null
  notes?: string
}

export interface PayrollAccounts {
  salary: string     // 5301
  ssEmployerExpense: string // 5314 (ไม่มีในผัง → 5301)
  ssPayable: string  // 2106
  whtPayable: string // 2105
  pay: string
  otherDeduction?: string
}

const round2 = (n: number) => Math.round(n * 100) / 100
const fmtBaht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const payrollAmount = (v: unknown, label: string): number => {
  if (v === undefined || v === null || v === '') return 0
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) throw new PayrollError(`${label} ต้องเป็นตัวเลขไม่ติดลบ`)
  return round2(n)
}

export function validatePayroll(raw: Record<string, unknown>): PayrollInput {
  const period = String(raw.period ?? '')
  const payDate = String(raw.payDate ?? '')
  if (!PERIOD_RE.test(period)) throw new PayrollError('งวดเดือนต้องเป็นรูปแบบ YYYY-MM')
  if (!DATE_RE.test(payDate)) throw new PayrollError('วันที่จ่ายต้องเป็นรูปแบบ YYYY-MM-DD')
  if (!raw.payAccountId || typeof raw.payAccountId !== 'string') throw new PayrollError('กรุณาเลือกบัญชีที่จ่ายเงิน')
  if (!Array.isArray(raw.employees) || raw.employees.length === 0) throw new PayrollError('ต้องมีพนักงานอย่างน้อย 1 รายการ')

  const employees = raw.employees.map((item: unknown, i: number): PayrollEmployee => {
    const e = (item ?? {}) as Record<string, unknown>
    const name = normEmployeeName(e.name)
    if (!name) throw new PayrollError(`แถวที่ ${i + 1}: กรุณากรอกชื่อ`)
    const emp = {
      name,
      gross: payrollAmount(e.gross, `${name}: เงินเดือน`),
      ssEmployee: payrollAmount(e.ssEmployee, `${name}: ประกันสังคม`),
      wht: payrollAmount(e.wht, `${name}: ภาษีหัก ณ ที่จ่าย`),
      otherDeduction: payrollAmount(e.otherDeduction, `${name}: หักอื่นๆ`),
    }
    if (emp.gross <= 0) throw new PayrollError(`${name}: เงินเดือนต้องมากกว่า 0`)
    if (emp.ssEmployee + emp.wht + emp.otherDeduction > emp.gross) {
      throw new PayrollError(`${name}: ยอดหักรวมเกินเงินเดือน (สุทธิติดลบ)`)
    }
    return emp
  })

  const businessUnit = raw.businessUnit ? String(raw.businessUnit) : null
  if (businessUnit && !BUSINESS_UNITS.includes(businessUnit)) throw new PayrollError('หน่วยธุรกิจไม่ถูกต้อง')

  const otherTotal = employees.reduce((s, e) => s + (e.otherDeduction ?? 0), 0)
  const otherDeductionAccountId = typeof raw.otherDeductionAccountId === 'string' && raw.otherDeductionAccountId
    ? raw.otherDeductionAccountId : undefined
  if (otherTotal > 0 && !otherDeductionAccountId) throw new PayrollError('มียอดหักอื่นๆ กรุณาเลือกบัญชีรับยอดหักอื่นๆ')

  return {
    period,
    payDate,
    employees,
    ssEmployer: payrollAmount(raw.ssEmployer, 'เงินสมทบประกันสังคมส่วนนายจ้าง'),
    payAccountId: raw.payAccountId,
    otherDeductionAccountId,
    businessUnit,
    notes: typeof raw.notes === 'string' ? raw.notes.trim() : undefined,
  }
}

// สร้างบรรทัด JE เงินเดือน (pure — ไม่แตะ DB):
//   Dr 5301 เงินเดือน (รวมก่อนหัก) + Dr 5301 เงินสมทบนายจ้าง (ผังบัญชียังไม่มีบัญชีค่าใช้จ่ายประกันสังคมแยก)
//   Cr บัญชีจ่าย (สุทธิ) + Cr 2106 ประกันสังคม (ลูกจ้าง+นายจ้าง) + Cr 2105 ภาษีหัก ณ ที่จ่าย + Cr บัญชีหักอื่นๆ
export function buildPayrollLines(input: PayrollInput, acc: PayrollAccounts) {
  const sum = (pick: (e: PayrollEmployee) => number | undefined) =>
    round2(input.employees.reduce((s, e) => s + (pick(e) ?? 0), 0))
  const gross = sum(e => e.gross)
  const ssEe = sum(e => e.ssEmployee)
  const wht = sum(e => e.wht)
  const other = sum(e => e.otherDeduction)
  const ssEr = round2(input.ssEmployer ?? 0)
  const net = round2(gross - ssEe - wht - other)
  if (net < 0) throw new PayrollError('ยอดจ่ายสุทธิติดลบ')

  const [y, m] = input.period.split('-')
  const label = `${Number(m)}/${y}`
  const perPerson = (pick: (e: PayrollEmployee) => number) =>
    input.employees.map(e => `${e.name} ${fmtBaht(pick(e))}`).join('; ')
  const netOf = (e: PayrollEmployee) => round2(e.gross - (e.ssEmployee ?? 0) - (e.wht ?? 0) - (e.otherDeduction ?? 0))

  const lines: JournalLineInput[] = [
    { accountId: acc.salary, debit: gross, description: `เงินเดือน ${label}: ${perPerson(e => e.gross)}` },
    { accountId: acc.ssEmployerExpense, debit: ssEr, description: `เงินสมทบประกันสังคมส่วนนายจ้าง ${label}` },
    { accountId: acc.pay, credit: net, description: `จ่ายสุทธิ ${label}: ${perPerson(netOf)}` },
    { accountId: acc.ssPayable, credit: round2(ssEe + ssEr), description: `ประกันสังคมค้างจ่าย ${label}: ลูกจ้าง ${fmtBaht(ssEe)} + นายจ้าง ${fmtBaht(ssEr)}` },
    { accountId: acc.whtPayable, credit: wht, description: `ภาษีหัก ณ ที่จ่าย ${label}: ${perPerson(e => e.wht ?? 0)}` },
  ]
  if (other > 0) {
    lines.push({ accountId: acc.otherDeduction!, credit: other, description: `หักอื่นๆ ${label}: ${perPerson(e => e.otherDeduction ?? 0)}` })
  }
  const kept = lines.filter(l => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0)
  const totalDebit = round2(kept.reduce((s, l) => s + (l.debit ?? 0), 0))
  const totalCredit = round2(kept.reduce((s, l) => s + (l.credit ?? 0), 0))
  if (Math.abs(totalDebit - totalCredit) > 0.001) throw new PayrollError('ยอดเงินเดือนไม่สมดุล')

  const breakdown = input.employees.map(e =>
    `${e.name}: เงินเดือน ${fmtBaht(e.gross)} | ปกส. ${fmtBaht(e.ssEmployee ?? 0)} | ภาษี ${fmtBaht(e.wht ?? 0)} | หักอื่น ${fmtBaht(e.otherDeduction ?? 0)} | สุทธิ ${fmtBaht(netOf(e))}`
  ).join('\n')

  return {
    lines: kept,
    totalDebit,
    totalCredit,
    description: `บันทึกเงินเดือน งวด ${label} (${input.employees.length} รายการ)`,
    notes: [breakdown, input.notes].filter(Boolean).join('\n'),
    summary: { gross, ssEmployee: ssEe, ssEmployer: ssEr, wht, otherDeduction: other, net },
  }
}

export function createPayrollEntry(tenantId: string, userName: string, input: PayrollInput) {
  const closedLabel = closedPeriodLabel(tenantId, input.payDate)
  if (closedLabel) throw new PayrollError(`งวด ${closedLabel} ปิดแล้ว ไม่สามารถบันทึกรายการได้`)

  const accountOf = (id: string) =>
    db.prepare('SELECT id, type FROM accounts WHERE id = ? AND tenant_id = ?').get(id, tenantId) as { id: string; type: string } | undefined
  const pay = accountOf(input.payAccountId)
  if (!pay || pay.type !== 'ASSET') throw new PayrollError('บัญชีที่จ่ายเงินต้องเป็นบัญชีเงินสด/ธนาคาร (สินทรัพย์)')
  if (input.otherDeductionAccountId && !accountOf(input.otherDeductionAccountId)) {
    throw new PayrollError('ไม่พบบัญชีรับยอดหักอื่นๆ')
  }

  const warnings: string[] = []
  const salary = getOrCreateAccount(tenantId, '5301', 'เงินเดือนและค่าจ้าง', 'EXPENSE', 'SALARY', 'DEBIT')
  // 5314 ถูกเติมให้ทุก tenant ตอน server start (backfillChartOfAccounts) — ถ้ายังไม่มี (เช่นผู้ใช้ลบทิ้ง) ไม่ปั้นเอง ลง 5301 แล้วเตือน
  let ssEmployerExpense = getAccountIdByCode(tenantId, SSO_EMPLOYER_CODE)
  if (!ssEmployerExpense) {
    ssEmployerExpense = salary
    if ((input.ssEmployer ?? 0) > 0) {
      warnings.push(`ไม่พบบัญชี ${SSO_EMPLOYER_CODE} เงินสมทบประกันสังคม (ส่วนนายจ้าง) — ลงเงินสมทบนายจ้างที่ 5301 แทน`)
    }
  }

  const built = buildPayrollLines(input, {
    salary,
    ssEmployerExpense,
    ssPayable: getOrCreateAccount(tenantId, '2106', 'ประกันสังคม', 'LIABILITY', 'PAYABLE', 'CREDIT'),
    whtPayable: getOrCreateAccount(tenantId, ACC.WHT_PAYABLE),
    pay: pay.id,
    otherDeduction: input.otherDeductionAccountId,
  })

  const insertPayrollLine = db.prepare(`
    INSERT INTO payroll_lines (id, tenant_id, journal_entry_id, period, pay_date, employee_name,
      gross, sso_employee, wht, other_deduction, net, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const { id, entryNumber } = db.transaction(() => {
    const je = insertJournalEntry(tenantId, userName, {
      date: input.payDate,
      description: built.description,
      referenceType: PAYROLL_REF,
      referenceId: input.period,
      notes: built.notes,
      businessUnit: input.businessUnit,
      lines: built.lines,
      totalDebit: built.totalDebit,
      totalCredit: built.totalCredit,
    })
    const now = new Date().toISOString()
    for (const e of input.employees) {
      const ss = e.ssEmployee ?? 0, wht = e.wht ?? 0, other = e.otherDeduction ?? 0
      insertPayrollLine.run(generateId(), tenantId, je.id, input.period, input.payDate, e.name,
        e.gross, ss, wht, other, round2(e.gross - ss - wht - other), now)
    }
    return je
  })()
  return { id, entryNumber, summary: built.summary, warnings }
}

// ---------- ประวัติเงินเดือนรายคน (autocomplete + เตือนจ่ายซ้ำงวด) ----------
// ระบบไม่มีธง void บน JE — การยกเลิกคือลบ JE (ร่างลบได้เลย, ยืนยันแล้วต้อง unpost ก่อน)
// payroll_lines หายตาม ON DELETE CASCADE และทุก query ยัง JOIN journal_entries กันแถวกำพร้าซ้ำอีกชั้น
export const SSO_EMPLOYER_CODE = '5314'

export function normEmployeeName(v: unknown): string {
  return String(v ?? '').trim().replace(/\s+/g, ' ')
}

export function listPayrollEmployees(tenantId: string, q?: string) {
  const term = normEmployeeName(q)
  return db.prepare(`
    SELECT pl.employee_name as name, COUNT(*) as count, MAX(pl.pay_date) as lastPayDate
    FROM payroll_lines pl
    JOIN journal_entries je ON je.id = pl.journal_entry_id AND je.tenant_id = pl.tenant_id
    WHERE pl.tenant_id = ? AND (? = '' OR instr(lower(pl.employee_name), lower(?)) > 0)
    GROUP BY lower(pl.employee_name)
    ORDER BY lastPayDate DESC
    LIMIT 50
  `).all(tenantId, term, term) as Array<{ name: string; count: number; lastPayDate: string }>
}

export function payrollHistory(tenantId: string, employee: string, period?: string) {
  const name = normEmployeeName(employee)
  const year = period && PERIOD_RE.test(period) ? period.slice(0, 4) : String(new Date().getFullYear())
  const base = `
    FROM payroll_lines pl
    JOIN journal_entries je ON je.id = pl.journal_entry_id AND je.tenant_id = pl.tenant_id
    WHERE pl.tenant_id = ? AND lower(pl.employee_name) = lower(?)`
  const sumRow = (extra: string, ...p: string[]) => db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(pl.gross), 0) as gross, COALESCE(SUM(pl.net), 0) as net ${base} ${extra}
  `).get(tenantId, name, ...p) as { count: number; gross: number; net: number }

  return {
    employee: name,
    period: period ?? null,
    samePeriod: period ? sumRow('AND pl.period = ?', period) : { count: 0, gross: 0, net: 0 },
    year,
    yearToDate: sumRow(`AND substr(pl.period, 1, 4) = ?`, year),
    recent: db.prepare(`
      SELECT pl.pay_date as payDate, pl.period, pl.gross, pl.net, je.entry_number as entryNumber, je.is_posted as isPosted
      ${base}
      ORDER BY pl.pay_date DESC, pl.created_at DESC
      LIMIT 3
    `).all(tenantId, name) as Array<{ payDate: string; period: string; gross: number; net: number; entryNumber: string; isPosted: number }>,
  }
}

// ============================================
// JOURNAL ENTRIES - สมุดรายวัน
// ============================================

// ---------- ตัวกรองรายการ (ใช้ทั้งหน้า list และนับจำนวนต่อประเภท) ----------
// reference_type ว่าง = บันทึกเองจากหน้าสมุดรายวัน นับรวมเป็นประเภทเดียวกับ 'MANUAL'
export const MANUAL_REF = 'MANUAL'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export class FilterError extends Error {}

export interface JournalListFilter {
  startDate?: string
  endDate?: string
  isPosted?: boolean
  referenceTypes?: string[]
  accountId?: string
  entryNumber?: string
  q?: string
  minDebit?: number
  maxDebit?: number
  minCredit?: number
  maxCredit?: number
}

const qStr = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || undefined
}

const qAmount = (v: unknown, label: string): number | undefined => {
  const s = qStr(v)
  if (s === undefined) return undefined
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) throw new FilterError(`${label} ต้องเป็นตัวเลขไม่ติดลบ`)
  return n
}

export function parseJournalFilter(query: Record<string, unknown>): JournalListFilter {
  const startDate = qStr(query.startDate)
  const endDate = qStr(query.endDate)
  for (const d of [startDate, endDate]) {
    if (d && !DATE_RE.test(d)) throw new FilterError('รูปแบบวันที่ต้องเป็น YYYY-MM-DD')
  }
  // referenceTypes=POS_SALE,PAYROLL (หลายค่า) — referenceType ค่าเดียวแบบเดิมยังใช้ได้
  const types = [qStr(query.referenceTypes), qStr(query.referenceType)]
    .filter((v): v is string => !!v)
    .flatMap(v => v.split(','))
    .map(v => v.trim())
    .filter(Boolean)
  const isPosted = qStr(query.isPosted)
  return {
    startDate,
    endDate,
    isPosted: isPosted === undefined ? undefined : isPosted === 'true',
    referenceTypes: types.length ? [...new Set(types)] : undefined,
    accountId: qStr(query.accountId),
    entryNumber: qStr(query.entryNumber),
    q: qStr(query.q),
    minDebit: qAmount(query.minDebit, 'เดบิตต่ำสุด'),
    maxDebit: qAmount(query.maxDebit, 'เดบิตสูงสุด'),
    minCredit: qAmount(query.minCredit, 'เครดิตต่ำสุด'),
    maxCredit: qAmount(query.maxCredit, 'เครดิตสูงสุด'),
  }
}

// skipTypes: ใช้ตอนนับจำนวนต่อประเภท — ตัวกรองอื่นยังมีผล แต่ไม่ตัดประเภทที่ยังไม่ได้ติ๊กทิ้ง
export function journalWhere(tenantId: string, f: JournalListFilter, skipTypes = false) {
  const conds = ['je.tenant_id = ?']
  const params: Array<string | number> = [tenantId]
  const add = (sql: string, ...p: Array<string | number>) => { conds.push(sql); params.push(...p) }

  if (f.startDate) add('je.date >= ?', f.startDate)
  if (f.endDate) add('je.date <= ?', f.endDate)
  if (f.isPosted !== undefined) add('je.is_posted = ?', f.isPosted ? 1 : 0)
  // instr แทน LIKE จะได้ไม่ต้อง escape % กับ _ ที่ผู้ใช้พิมพ์มา
  if (f.entryNumber) add('instr(lower(je.entry_number), lower(?)) > 0', f.entryNumber)
  if (f.q) {
    add(`(instr(lower(je.description), lower(?)) > 0
          OR instr(lower(COALESCE(je.source_number, '')), lower(?)) > 0
          OR instr(lower(COALESCE(je.notes, '')), lower(?)) > 0)`, f.q, f.q, f.q)
  }
  if (f.accountId) {
    add(`EXISTS (SELECT 1 FROM journal_lines jl
                 WHERE jl.journal_entry_id = je.id AND jl.tenant_id = je.tenant_id AND jl.account_id = ?)`, f.accountId)
  }
  if (f.minDebit !== undefined) add('je.total_debit >= ?', f.minDebit)
  if (f.maxDebit !== undefined) add('je.total_debit <= ?', f.maxDebit)
  if (f.minCredit !== undefined) add('je.total_credit >= ?', f.minCredit)
  if (f.maxCredit !== undefined) add('je.total_credit <= ?', f.maxCredit)
  if (!skipTypes && f.referenceTypes?.length) {
    add(`COALESCE(je.reference_type, '${MANUAL_REF}') IN (${f.referenceTypes.map(() => '?').join(',')})`, ...f.referenceTypes)
  }
  return { where: conds.join(' AND '), params }
}

export function listJournalEntries(tenantId: string, f: JournalListFilter) {
  const { where, params } = journalWhere(tenantId, f)
  const entries = db.prepare(`
    SELECT je.*,
           (SELECT COUNT(*) FROM journal_lines WHERE journal_entry_id = je.id) as line_count
    FROM journal_entries je
    WHERE ${where}
    ORDER BY je.date DESC, je.created_at DESC
  `).all(...params) as JournalEntry[]

  const tc = journalWhere(tenantId, f, true)
  const typeCounts = db.prepare(`
    SELECT COALESCE(je.reference_type, '${MANUAL_REF}') as type, COUNT(*) as count
    FROM journal_entries je
    WHERE ${tc.where}
    GROUP BY COALESCE(je.reference_type, '${MANUAL_REF}')
    ORDER BY count DESC
  `).all(...tc.params) as Array<{ type: string; count: number }>

  return { entries, typeCounts }
}

// Get all journal entries — กรองทั้งหมดใน DB ก่อน หน้าเว็บค่อยแบ่งหน้าจากผลที่กรองแล้ว
router.get('/', async (req: Request, res: Response) => {
  try {
    const filter = parseJournalFilter(req.query as Record<string, unknown>)
    const { entries, typeCounts } = listJournalEntries(req.user!.tenantId, filter)
    res.json({ success: true, data: entries, meta: { typeCounts } })
  } catch (error) {
    if (error instanceof FilterError) {
      return res.status(400).json({ success: false, message: error.message })
    }
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

// ชื่อพนักงานที่เคยบันทึกเงินเดือน (autocomplete)
router.get('/payroll/employees', async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: listPayrollEmployees(req.user!.tenantId, req.query.q as string | undefined) })
  } catch (error) {
    console.error('List payroll employees error:', error)
    res.status(500).json({ success: false, message: 'โหลดรายชื่อพนักงานไม่สำเร็จ' })
  }
})

// คนนี้เคยรับไปแล้วเท่าไร: งวดเดียวกัน / ทั้งปี / 3 รายการล่าสุด
router.get('/payroll/history', async (req: Request, res: Response) => {
  try {
    const employee = normEmployeeName(req.query.employee)
    const period = typeof req.query.period === 'string' ? req.query.period : undefined
    if (!employee) return res.status(400).json({ success: false, message: 'ต้องระบุชื่อพนักงาน' })
    if (period && !PERIOD_RE.test(period)) return res.status(400).json({ success: false, message: 'งวดเดือนต้องเป็นรูปแบบ YYYY-MM' })
    res.json({ success: true, data: payrollHistory(req.user!.tenantId, employee, period) })
  } catch (error) {
    console.error('Payroll history error:', error)
    res.status(500).json({ success: false, message: 'โหลดประวัติเงินเดือนไม่สำเร็จ' })
  }
})

// บันทึกเงินเดือน → JE แบบร่าง reference_type = 'PAYROLL' (ไปกดยืนยันในหน้าสมุดรายวันเหมือน JE อื่น)
router.post('/payroll', async (req: Request, res: Response) => {
  try {
    const input = validatePayroll(req.body ?? {})
    const result = createPayrollEntry(req.user!.tenantId, req.user!.email, input)
    res.json({ success: true, message: 'บันทึกเงินเดือนสำเร็จ', data: result })
  } catch (error) {
    if (error instanceof PayrollError) {
      return res.status(400).json({ success: false, message: error.message })
    }
    console.error('Create payroll entry error:', error)
    res.status(500).json({ success: false, message: 'บันทึกเงินเดือนไม่สำเร็จ' })
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

    const closedLabel = closedPeriodLabel(tenantId, date)
    if (closedLabel) {
      return res.status(400).json({ success: false, message: `งวด ${closedLabel} ปิดแล้ว ไม่สามารถบันทึกรายการได้` })
    }

    const { id, entryNumber } = insertJournalEntry(tenantId, userName, {
      date, description, referenceType, referenceId, notes, lines: typedLines, totalDebit, totalCredit,
    })

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

    const closedLabel = closedPeriodLabel(tenantId, entry.date)
    if (closedLabel) {
      return res.status(400).json({ success: false, message: `งวด ${closedLabel} ปิดแล้ว ไม่สามารถบันทึกรายการได้` })
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

export default router
