import db from '../db/sqlite'
import { ACC } from '../config/accountCodes'
import { moneyAccounts } from './monthClose.service'
import { totalStockValue } from './stockValue.service'

// ─────────────────────────────────────────────────────────────────────────
// ตัวเลขเงินของ Phopy Board — แยกจาก route เพื่อให้ test ได้และอธิบายได้ว่ามาจากบัญชีไหน
// กติกาเดียวกันทุกฟังก์ชัน: ใช้เฉพาะ journal ที่ is_posted = 1 และไม่นับรายการปิดงวด (is_closing_entry)
// ─────────────────────────────────────────────────────────────────────────

export const NON_CLOSING = "AND (je.is_closing_entry IS NULL OR je.is_closing_entry = 0)"
const POSTED = `je.tenant_id = ? AND je.is_posted = 1 ${NON_CLOSING}`
const LEDGER_FROM = `FROM journal_lines jl
  JOIN journal_entries je ON jl.journal_entry_id = je.id
  JOIN accounts a ON jl.account_id = a.id`

export const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100

// วันที่ไทยของ timestamp UTC ในตาราง POS (closed_at/created_at เก็บเป็น UTC) — journal ลงวันที่ไทย
export const THAI_DATE = (col: string) => `date(${col}, '+7 hours')`

/** วันนี้ตามเวลาไทย (YYYY-MM-DD) — เซิร์ฟเวอร์รัน UTC */
export function thaiToday(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600000).toISOString().substring(0, 10)
}

/** ช่วงวันที่ของเดือน (y, m เริ่ม 0) แบบ string ล้วน ไม่ผ่าน toISOString ที่เลื่อนวันตาม timezone */
export function monthRange(y: number, m: number): { start: string; end: string; label: string } {
  const d = new Date(Date.UTC(y, m, 1))
  const yy = d.getUTCFullYear(), mm = d.getUTCMonth()
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate()
  const p = (n: number) => String(n).padStart(2, '0')
  return { start: `${yy}-${p(mm + 1)}-01`, end: `${yy}-${p(mm + 1)}-${p(last)}`, label: `${yy}/${p(mm + 1)}` }
}

// ── Ledger P&L ────────────────────────────────────────────────────────────

export function ledgerRevenue(tenantId: string, start: string, end: string): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(jl.credit - jl.debit), 0) as v ${LEDGER_FROM}
    WHERE ${POSTED} AND date(je.date) BETWEEN ? AND ? AND a.type = 'REVENUE'
  `).get(tenantId, start, end) as { v: number }
  return Number(row.v)
}

/** ต้นทุนขายจริงตามบัญชี (accounts.category = 'COGS') ไม่ใช่ยอดซื้อในงวด */
export function ledgerCogs(tenantId: string, start: string, end: string): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as v ${LEDGER_FROM}
    WHERE ${POSTED} AND date(je.date) BETWEEN ? AND ? AND a.type = 'EXPENSE' AND a.category = 'COGS'
  `).get(tenantId, start, end) as { v: number }
  return Number(row.v)
}

/** ค่าใช้จ่ายที่ไม่ใช่ต้นทุนขาย (OpEx) ตามบัญชี */
export function ledgerOpex(tenantId: string, start: string, end: string): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as v ${LEDGER_FROM}
    WHERE ${POSTED} AND date(je.date) BETWEEN ? AND ? AND a.type = 'EXPENSE' AND COALESCE(a.category, '') != 'COGS'
  `).get(tenantId, start, end) as { v: number }
  return Number(row.v)
}

/** เงินเดือน (SALARY 5301) และค่าแรงตรง (DIRECT_LABOR 5103) — ฟอร์มเงินเดือนลง journal PAYROLL เดบิต 5301 */
export function ledgerLabour(tenantId: string, start: string, end: string): { salary: number; directLabor: number; total: number } {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN a.category = 'SALARY' THEN jl.debit - jl.credit ELSE 0 END), 0) as salary,
      COALESCE(SUM(CASE WHEN a.category = 'DIRECT_LABOR' THEN jl.debit - jl.credit ELSE 0 END), 0) as direct_labor
    ${LEDGER_FROM}
    WHERE ${POSTED} AND date(je.date) BETWEEN ? AND ? AND a.type = 'EXPENSE'
  `).get(tenantId, start, end) as { salary: number; direct_labor: number }
  const salary = r2(row.salary), directLabor = r2(row.direct_labor)
  return { salary, directLabor, total: r2(salary + directLabor) }
}

/** ยอดคงเหลือบัญชี ณ วันที่ (รวมทุกงวดก่อนหน้า) — normal balance ตามประเภทบัญชี */
export function accountBalances(tenantId: string, asOf: string, codes: string[]): Record<string, number> {
  if (codes.length === 0) return {}
  const rows = db.prepare(`
    SELECT a.code, COALESCE(SUM(CASE WHEN a.normal_balance = 'CREDIT' THEN jl.credit - jl.debit ELSE jl.debit - jl.credit END), 0) as bal
    ${LEDGER_FROM}
    WHERE ${POSTED} AND date(je.date) <= ? AND a.code IN (${codes.map(() => '?').join(',')})
    GROUP BY a.code
  `).all(tenantId, asOf, ...codes) as Array<{ code: string; bal: number }>
  const map = new Map(rows.map(r => [r.code, r2(r.bal)]))
  return Object.fromEntries(codes.map(c => [c, map.get(c) ?? 0]))
}

// ── หน่วยธุรกิจ ────────────────────────────────────────────────────────────
// รายการ POS_* (ขาย/ต้นทุน/ปิดกะ/เงินออกลิ้นชัก) เกิดที่หน้าร้านเสมอ แต่บางตัวลงหัว journal เป็น OTHER/NULL
// (เช่น POS_CASH_MOVEMENT) — บอร์ดจัดเข้า RETAIL ให้ ส่วนที่เหลือที่ไม่ระบุจริงๆ = ส่วนกลาง (OTHER)
export const BU_SQL = `CASE
  WHEN je.business_unit IN ('RETAIL', 'WHOLESALE', 'ONLINE') THEN je.business_unit
  WHEN je.reference_type LIKE 'POS!_%' ESCAPE '!' THEN 'RETAIL'
  ELSE 'OTHER' END`

// บัญชี 59xx = เงินขาด/เกินจากนับเงิน (5901) และปรับปรุงสต็อก/ของเสีย/สูญหาย (5902-5904)
// แยกออกจาก "ค่าใช้จ่าย" ปกติ เพราะเป็นยอดสุทธิที่ติดลบได้ (เงินเกิน/ปรับเพิ่มสต็อก = กำไร)
const ADJUST_ACCOUNT_SQL = "a.code LIKE '59%'"

export const REF_LABELS: Record<string, string> = {
  POS_SALE: 'ขาย POS', POS_COGS: 'ต้นทุนตามสูตร POS', POS_CANCEL: 'ยกเลิกบิล POS',
  POS_SHIFT_CLOSE: 'ปิดกะ (เงินขาด/เกิน)', POS_CASH_MOVEMENT: 'เงินออกจากลิ้นชัก',
  GOODS_RECEIPT: 'รับของเข้าคลัง', PURCHASE_INVOICE: 'ใบแจ้งหนี้ซื้อ (ลงค่าใช้จ่ายตรง)',
  PURCHASE_INVOICE_RECLASS: 'ย้ายของไม่นับสต็อกออกจากสต็อก', PURCHASE_INVOICE_EDIT: 'แก้ใบแจ้งหนี้ซื้อ',
  PURCHASE_INVOICE_SUPERSEDED: 'ใบแจ้งหนี้ซื้อถูกแทนที่', STOCK_ADJUST: 'ปรับยอด/นับสต็อก',
  ADJUSTMENT: 'รายการปรับปรุง', MANUAL: 'บันทึกบัญชีเอง', INVOICE: 'ใบแจ้งหนี้ขาย', SO_COGS: 'ต้นทุนขายส่ง',
  SUPPLIER_PAYMENT: 'จ่ายเจ้าหนี้', EXPENSE: 'บันทึกค่าใช้จ่าย', PAYROLL: 'เงินเดือน', NONE: 'ไม่มีเอกสารอ้างอิง',
}

export interface BusinessUnitRow {
  unit: 'RETAIL' | 'WHOLESALE' | 'ONLINE' | 'OTHER'
  revenue: number; cogs: number; expense: number; adjust: number; netProfit: number
  breakdown: Array<{ referenceType: string; label: string; revenue: number; cogs: number; expense: number; adjust: number }>
}

export function businessUnitPL(tenantId: string, start: string, end: string): BusinessUnitRow[] {
  const rows = db.prepare(`
    SELECT ${BU_SQL} as unit, COALESCE(je.reference_type, 'NONE') as ref,
      COALESCE(SUM(CASE WHEN a.type = 'REVENUE' THEN jl.credit - jl.debit ELSE 0 END), 0) as revenue,
      COALESCE(SUM(CASE WHEN a.type = 'EXPENSE' AND a.category = 'COGS' THEN jl.debit - jl.credit ELSE 0 END), 0) as cogs,
      COALESCE(SUM(CASE WHEN a.type = 'EXPENSE' AND COALESCE(a.category, '') != 'COGS' AND NOT (${ADJUST_ACCOUNT_SQL}) THEN jl.debit - jl.credit ELSE 0 END), 0) as expense,
      COALESCE(SUM(CASE WHEN a.type = 'EXPENSE' AND COALESCE(a.category, '') != 'COGS' AND ${ADJUST_ACCOUNT_SQL} THEN jl.debit - jl.credit ELSE 0 END), 0) as adjust
    ${LEDGER_FROM}
    WHERE ${POSTED} AND date(je.date) BETWEEN ? AND ? AND a.type IN ('REVENUE', 'EXPENSE')
    GROUP BY 1, 2
  `).all(tenantId, start, end) as Array<{ unit: string; ref: string; revenue: number; cogs: number; expense: number; adjust: number }>

  return (['RETAIL', 'WHOLESALE', 'ONLINE', 'OTHER'] as const).map(unit => {
    const mine = rows.filter(r => r.unit === unit)
    const sum = (k: 'revenue' | 'cogs' | 'expense' | 'adjust') => r2(mine.reduce((s, r) => s + Number(r[k]), 0))
    const revenue = sum('revenue'), cogs = sum('cogs'), expense = sum('expense'), adjust = sum('adjust')
    const breakdown = mine
      .map(r => ({ referenceType: r.ref, label: REF_LABELS[r.ref] || r.ref, revenue: r2(r.revenue), cogs: r2(r.cogs), expense: r2(r.expense), adjust: r2(r.adjust) }))
      .filter(b => b.revenue || b.cogs || b.expense || b.adjust)
      .sort((a, b) => Math.abs(b.cogs + b.expense + b.adjust) - Math.abs(a.cogs + a.expense + a.adjust))
    return { unit, revenue, cogs, expense, adjust, netProfit: r2(revenue - cogs - expense - adjust), breakdown }
  })
}

// ── ต้นทุนขาย 2 มุม: ตามสูตร vs ตามการเปลี่ยนแปลงสต็อก ─────────────────────

export type CogsSource = 'RECIPE' | 'ADJUST' | 'PURCHASE'

/** ที่มาของบรรทัด COGS/สต็อก ตาม reference_type ของ journal */
export function cogsSourceOf(ref: string | null | undefined): CogsSource {
  if (!ref || ref === 'NONE') return 'ADJUST' // JV ลงมือ ไม่มีเอกสาร
  if (ref === 'GOODS_RECEIPT' || ref.startsWith('PURCHASE_')) return 'PURCHASE'
  if (ref === 'STOCK_ADJUST' || ref === 'STOCK_OUT' || ref === 'ADJUSTMENT' || ref === 'MANUAL') return 'ADJUST'
  return 'RECIPE' // POS_COGS, POS_CANCEL, SO_COGS, INVOICE, CREDIT_NOTE_COGS ... = ตัดตามสูตรตอนขาย
}

export interface CogsLedgerRow { ref: string; inventory: number; cogs: number }

export interface CogsAnalysis {
  recipe: number          // (ก) ต้นทุนตามสูตร — ตัดสต็อกตามสูตรตอนขาย
  stockAdjust: number     // ปรับยอด/นับสต็อกที่ลงบัญชีต้นทุนขาย (5101/5102)
  directPurchase: number  // ซื้อของไม่นับสต็อกแล้วลงต้นทุนขายตรง (skip_stock → 5102)
  ledger: number          // ต้นทุนขายในบัญชี = recipe + stockAdjust + directPurchase (ใช้ใน P&L)
  stock: {
    opening: number           // มูลค่าสต็อกต้นงวด (บัญชีหมวด INVENTORY)
    purchasesToStock: number  // ซื้อเข้าสต็อกในงวด (สุทธิหลังย้ายของไม่นับสต็อกออก)
    directPurchase: number    // ซื้อแล้วใช้ตรงไม่ผ่านสต็อก
    closing: number           // มูลค่าสต็อกปลายงวด (บัญชีหมวด INVENTORY)
    cogs: number              // (ข) = ต้นงวด + ซื้อ − ปลายงวด
  }
  variance: number          // ข − ก = ของเสีย/สูญหาย/ใช้โดยไม่ผ่านบิล + ของซื้อใช้ตรง
  varianceCount: number     // ส่วนที่มาจากปรับยอด/นับสต็อก (สุทธิ)
  notInLedgerCogs: number   // ข − ต้นทุนขายในบัญชี: ปรับสต็อกที่ลงบัญชีอื่น (เช่นปรับเพิ่มลง 5902/2102)
  systemStock: { value: number | null; diff: number | null } // มูลค่าตามจำนวนในระบบ (stock_items) เทียบบัญชีปลายงวด
}

/** pure — รวมบรรทัด journal ตามที่มา แล้วคิดต้นทุนขายแบบสต็อก */
export function buildCogsAnalysis(rows: CogsLedgerRow[], opening: number, closing: number, systemStockValue: number | null): CogsAnalysis {
  const by = { RECIPE: 0, ADJUST: 0, PURCHASE: 0 }
  let purchasesToStock = 0
  for (const r of rows) {
    const src = cogsSourceOf(r.ref)
    by[src] += Number(r.cogs) || 0
    if (src === 'PURCHASE') purchasesToStock += Number(r.inventory) || 0
  }
  const recipe = r2(by.RECIPE), stockAdjust = r2(by.ADJUST), directPurchase = r2(by.PURCHASE)
  const ledger = r2(recipe + stockAdjust + directPurchase)
  const stockCogs = r2(opening + purchasesToStock + directPurchase - closing)
  const variance = r2(stockCogs - recipe)
  return {
    recipe, stockAdjust, directPurchase, ledger,
    stock: { opening: r2(opening), purchasesToStock: r2(purchasesToStock), directPurchase, closing: r2(closing), cogs: stockCogs },
    variance,
    varianceCount: r2(variance - directPurchase),
    notInLedgerCogs: r2(stockCogs - ledger),
    systemStock: { value: systemStockValue === null ? null : r2(systemStockValue), diff: systemStockValue === null ? null : r2(systemStockValue - closing) },
  }
}

function inventoryBalance(tenantId: string, beforeOrOn: 'before' | 'on', date: string): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as v ${LEDGER_FROM}
    WHERE ${POSTED} AND a.type = 'ASSET' AND a.category = 'INVENTORY' AND date(je.date) ${beforeOrOn === 'before' ? '<' : '<='} ?
  `).get(tenantId, date) as { v: number }
  return Number(row.v)
}

export function cogsAnalysis(tenantId: string, start: string, end: string): CogsAnalysis {
  const rows = db.prepare(`
    SELECT COALESCE(je.reference_type, 'NONE') as ref,
      COALESCE(SUM(CASE WHEN a.type = 'ASSET' AND a.category = 'INVENTORY' THEN jl.debit - jl.credit ELSE 0 END), 0) as inventory,
      COALESCE(SUM(CASE WHEN a.type = 'EXPENSE' AND a.category = 'COGS' THEN jl.debit - jl.credit ELSE 0 END), 0) as cogs
    ${LEDGER_FROM}
    WHERE ${POSTED} AND date(je.date) BETWEEN ? AND ?
      AND ((a.type = 'ASSET' AND a.category = 'INVENTORY') OR (a.type = 'EXPENSE' AND a.category = 'COGS'))
    GROUP BY 1
  `).all(tenantId, start, end) as CogsLedgerRow[]
  // จำนวนของในระบบมีแค่ "ตอนนี้" — เทียบได้เฉพาะงวดที่ปลายงวดคือวันนี้หรืออนาคต
  // stock_movements ย้อนหลังใช้ประเมินไม่ได้ (ADJUST เก็บยอดที่นับได้ ไม่ใช่ส่วนต่าง, ไม่มีราคาทุน ณ วันนั้น)
  const systemValue = end >= thaiToday()
    ? totalStockValue(tenantId) + Number((db.prepare('SELECT COALESCE(SUM(total_value), 0) as v FROM subcon_stock WHERE tenant_id = ?').get(tenantId) as { v: number }).v)
    : null
  return buildCogsAnalysis(rows, inventoryBalance(tenantId, 'before', start), inventoryBalance(tenantId, 'on', end), systemValue)
}

// ── อายุหนี้ AR / AP ─────────────────────────────────────────────────────

export type AgingBuckets = { current: number; days30: number; days60: number; days90: number; over90: number }

/** pure — แบ่งยอดค้างตามอายุนับจากวันที่เอกสารถึง asOf (ช่อง 0-30 / 31-60 / 61-90 / 91-120 / 120+) */
export function ageBuckets(rows: Array<{ date: string; amount: number }>, asOf: string): AgingBuckets {
  const asOfMs = Date.parse(asOf.substring(0, 10))
  const b: AgingBuckets = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 }
  for (const r of rows) {
    const days = Math.floor((asOfMs - Date.parse(String(r.date).substring(0, 10))) / 86400000)
    const k: keyof AgingBuckets = days <= 30 ? 'current' : days <= 60 ? 'days30' : days <= 90 ? 'days60' : days <= 120 ? 'days90' : 'over90'
    b[k] = r2(b[k] + Number(r.amount))
  }
  return b
}

export interface AgingResult { buckets: AgingBuckets; total: number; overdue: number; count: number }

function agingFrom(rows: Array<{ date: string; due_date: string | null; amount: number }>, asOf: string): AgingResult {
  const buckets = ageBuckets(rows, asOf)
  const overdue = r2(rows.filter(r => r.due_date && r.due_date.substring(0, 10) < asOf).reduce((s, r) => s + Number(r.amount), 0))
  return { buckets, total: r2(rows.reduce((s, r) => s + Number(r.amount), 0)), overdue, count: rows.length }
}

/** เจ้าหนี้จริง = ใบแจ้งหนี้ซื้อที่ยังค้างชำระ (balance_amount) ไม่ใช่ใบสั่งซื้อที่ยังไม่รับของ */
export function apAging(tenantId: string, asOf: string): AgingResult {
  const rows = db.prepare(`
    SELECT invoice_date as date, due_date, balance_amount as amount FROM purchase_invoices
    WHERE tenant_id = ? AND status NOT IN ('CANCELLED', 'DRAFT') AND balance_amount > 0.005
  `).all(tenantId) as Array<{ date: string; due_date: string | null; amount: number }>
  return agingFrom(rows, asOf)
}

/** ลูกหนี้จริง = ใบแจ้งหนี้ขายที่ยังค้างรับ (ตาราง orders เป็นของเก่าที่ไม่มีระบบไหนเขียนแล้ว) */
export function arAging(tenantId: string, asOf: string): AgingResult {
  const rows = db.prepare(`
    SELECT invoice_date as date, due_date, balance_amount as amount FROM invoices
    WHERE tenant_id = ? AND status NOT IN ('CANCELLED', 'DRAFT') AND balance_amount > 0.005
  `).all(tenantId) as Array<{ date: string; due_date: string | null; amount: number }>
  return agingFrom(rows, asOf)
}

// ── ยอดขาย POS ───────────────────────────────────────────────────────────

const PAYMENT_LABELS: Record<string, string> = { CASH: 'เงินสด', QR_CODE: 'QR พร้อมเพย์', TRANSFER: 'โอน', CREDIT_CARD: 'บัตร' }

export interface PosSales {
  revenue: number; bills: number; avgBill: number; discount: number
  byMethod: Array<{ method: string; label: string; amount: number; count: number }>
  cancelled: { bills: number; amount: number }
  ledger: { sales: number; cancels: number; other: number; net: number }
  diff: number // รายได้หน้าร้านในบัญชี − ยอดบิลชำระแล้ว
}

export function posSales(tenantId: string, start: string, end: string): PosSales {
  const billWhere = `b.tenant_id = ? AND ${THAI_DATE('COALESCE(b.closed_at, b.opened_at)')} BETWEEN ? AND ?`
  const paid = db.prepare(`
    SELECT COUNT(*) as bills, COALESCE(SUM(b.total_amount), 0) as revenue, COALESCE(SUM(b.discount_amount), 0) as discount
    FROM pos_running_bills b WHERE ${billWhere} AND b.status = 'PAID'
  `).get(tenantId, start, end) as { bills: number; revenue: number; discount: number }
  const cancelled = db.prepare(`
    SELECT COUNT(*) as bills, COALESCE(SUM(b.total_amount), 0) as amount
    FROM pos_running_bills b WHERE ${billWhere} AND b.status = 'CANCELLED'
  `).get(tenantId, start, end) as { bills: number; amount: number }
  const byMethod = (db.prepare(`
    SELECT p.payment_method as method, COUNT(*) as count, COALESCE(SUM(p.amount), 0) as amount
    FROM pos_payments p JOIN pos_running_bills b ON b.id = p.bill_id
    WHERE ${billWhere} AND b.status = 'PAID'
    GROUP BY p.payment_method ORDER BY amount DESC
  `).all(tenantId, start, end) as Array<{ method: string; count: number; amount: number }>)
    .map(m => ({ method: m.method, label: PAYMENT_LABELS[m.method] || m.method, amount: r2(m.amount), count: Number(m.count) }))

  const led = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN je.reference_type = 'POS_SALE' THEN jl.credit - jl.debit ELSE 0 END), 0) as sales,
      COALESCE(SUM(CASE WHEN je.reference_type = 'POS_CANCEL' THEN jl.credit - jl.debit ELSE 0 END), 0) as cancels,
      COALESCE(SUM(jl.credit - jl.debit), 0) as net
    ${LEDGER_FROM}
    WHERE ${POSTED} AND date(je.date) BETWEEN ? AND ? AND a.type = 'REVENUE' AND (${BU_SQL}) = 'RETAIL'
  `).get(tenantId, start, end) as { sales: number; cancels: number; net: number }

  const revenue = r2(paid.revenue), bills = Number(paid.bills)
  const ledger = { sales: r2(led.sales), cancels: r2(led.cancels), other: r2(led.net - led.sales - led.cancels), net: r2(led.net) }
  return {
    revenue, bills, avgBill: bills > 0 ? r2(revenue / bills) : 0, discount: r2(paid.discount), byMethod,
    cancelled: { bills: Number(cancelled.bills), amount: r2(cancelled.amount) },
    ledger, diff: r2(ledger.net - revenue),
  }
}

// ── เงินสดในลิ้นชัก: เงินออก / เงินหายระหว่างกะ / เงินขาดเกิน ───────────────

export type DrawerCategory = 'EXPENSE' | 'PURCHASE' | 'OWNER' | 'CASH_IN' | 'OTHER'

/** pure — จัดหมวดเงินออก/เข้าลิ้นชักตามบัญชีที่ผู้ใช้เลือกตอนบันทึก */
export function classifyDrawerMovement(m: { type: string; accountType?: string | null; accountCode?: string | null }): DrawerCategory {
  if (m.type === 'CASH_IN') return 'CASH_IN'
  if (m.accountType === 'EXPENSE') return 'EXPENSE'           // จ่ายค่าใช้จ่ายหน้าร้าน (น้ำแข็ง แก๊ส)
  if (m.accountType === 'EQUITY') return 'OWNER'              // เจ้าของถอนเงิน
  if (m.accountCode === '1182' || m.accountType === 'LIABILITY') return 'PURCHASE' // ซื้อของ/จ่ายเจ้าหนี้ รอจับคู่บิลซื้อ
  return 'OTHER'
}

/**
 * pure — เงินที่หายระหว่างปิดกะกับเปิดกะถัดไป (ยอดนับตอนปิด − เงินตั้งต้นกะถัดไป) ที่ไม่มีรายการ
 * OPENING_GAP อธิบาย = เงินถูกเอาออกจากลิ้นชักโดยไม่ได้บันทึก (เจ้าของหยิบ/นำฝาก/หาย)
 */
export function untrackedDrawerGaps(
  shifts: Array<{ id: string; shift_number: string; opening_cash: number; closing_cash_counted: number | null }>,
  explainedByShift: Record<string, number>,
): Array<{ shiftNumber: string; previousShift: string; amount: number }> {
  const gaps: Array<{ shiftNumber: string; previousShift: string; amount: number }> = []
  for (let i = 1; i < shifts.length; i++) {
    const prev = shifts[i - 1], cur = shifts[i]
    if (prev.closing_cash_counted == null) continue
    const amount = r2(Number(prev.closing_cash_counted) - Number(cur.opening_cash) - (explainedByShift[cur.id] || 0))
    if (Math.abs(amount) >= 0.01) gaps.push({ shiftNumber: cur.shift_number, previousShift: prev.shift_number, amount })
  }
  return gaps
}

export interface CashDrawer {
  movements: Array<{ date: string; shiftNumber: string; type: string; reason: string; amount: number; category: DrawerCategory; accountCode: string; accountName: string; posted: boolean }>
  totals: Record<DrawerCategory, number>
  unposted: { count: number; amount: number }
  untrackedGaps: Array<{ shiftNumber: string; previousShift: string; amount: number }>
  overShort: { over: number; short: number; net: number; ledger: number }
}

export function cashDrawer(tenantId: string, start: string, end: string): CashDrawer {
  const mv = db.prepare(`
    SELECT m.id, m.shift_id, m.type, m.amount, COALESCE(m.reason, '') as reason, m.created_at,
      s.shift_number, a.code as account_code, a.name as account_name, a.type as account_type,
      EXISTS (SELECT 1 FROM journal_entries je WHERE je.tenant_id = m.tenant_id AND je.reference_type = 'POS_CASH_MOVEMENT'
              AND je.reference_id = m.id AND je.is_posted = 1) as posted
    FROM pos_shift_cash_movements m
    LEFT JOIN pos_shifts s ON s.id = m.shift_id
    LEFT JOIN accounts a ON a.id = m.account_id
    WHERE m.tenant_id = ? AND ${THAI_DATE('m.created_at')} BETWEEN ? AND ?
    ORDER BY m.created_at
  `).all(tenantId, start, end) as any[]

  const movements = mv.map(m => ({
    date: String(m.created_at), shiftNumber: m.shift_number || '', type: m.type, reason: m.reason, amount: r2(m.amount),
    category: classifyDrawerMovement({ type: m.type, accountType: m.account_type, accountCode: m.account_code }),
    accountCode: m.account_code || '', accountName: m.account_name || '', posted: !!m.posted,
  }))
  const totals: Record<DrawerCategory, number> = { EXPENSE: 0, PURCHASE: 0, OWNER: 0, CASH_IN: 0, OTHER: 0 }
  for (const m of movements) totals[m.category] = r2(totals[m.category] + m.amount)
  const unpostedRows = movements.filter(m => !m.posted)

  // กะที่ปิดในงวด + กะก่อนหน้า 1 กะ เพื่อเทียบยอดส่งต่อของกะแรกในงวด
  const shifts = db.prepare(`
    SELECT id, shift_number, opening_cash, closing_cash_counted, cash_difference, opened_at, closed_at
    FROM pos_shifts WHERE tenant_id = ? AND status = 'CLOSED' ORDER BY opened_at
  `).all(tenantId) as any[]
  const inPeriod = (s: any) => { const d = thaiDateOf(s.opened_at); return d >= start && d <= end }
  const firstIdx = shifts.findIndex(inPeriod)
  const window = firstIdx < 0 ? [] : shifts.slice(Math.max(0, firstIdx - 1)).filter((s, i) => i === 0 || inPeriod(s))
  const explained: Record<string, number> = {}
  for (const m of mv) if (m.type === 'OPENING_GAP') explained[m.shift_id] = (explained[m.shift_id] || 0) + Number(m.amount)
  const untrackedGaps = untrackedDrawerGaps(window, explained).filter(g => window.some(s => s.shift_number === g.shiftNumber && inPeriod(s)))

  const closedInPeriod = shifts.filter(s => s.closed_at && thaiDateOf(s.closed_at) >= start && thaiDateOf(s.closed_at) <= end)
  const over = r2(closedInPeriod.reduce((t, s) => t + Math.max(0, Number(s.cash_difference) || 0), 0))
  const short = r2(closedInPeriod.reduce((t, s) => t + Math.min(0, Number(s.cash_difference) || 0), 0))
  // บัญชี 5901 เป็นบัญชีค่าใช้จ่าย: เครดิต = เงินเกิน → แปลงเป็น "เกินสุทธิ" ให้ทิศเดียวกับ over+short
  const ledger5901 = db.prepare(`
    SELECT COALESCE(SUM(jl.credit - jl.debit), 0) as v ${LEDGER_FROM}
    WHERE ${POSTED} AND date(je.date) BETWEEN ? AND ? AND a.code = '5901'
  `).get(tenantId, start, end) as { v: number }

  return {
    movements, totals,
    unposted: { count: unpostedRows.length, amount: r2(unpostedRows.reduce((t, m) => t + m.amount, 0)) },
    untrackedGaps,
    overShort: { over, short, net: r2(over + short), ledger: r2(ledger5901.v) },
  }
}

function thaiDateOf(ts: string): string {
  const ms = Date.parse(ts.includes('T') || ts.endsWith('Z') ? ts : ts.replace(' ', 'T') + 'Z')
  return Number.isNaN(ms) ? String(ts).substring(0, 10) : thaiToday(new Date(ms))
}

// ── Shared helpers for Dashboard "ชีพจรเช้านี้" & Phopy Board Trend / CFO ──

const p2 = (n: number) => String(n).padStart(2, '0')

export function fmtUtcDate(d: Date): string {
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
}

/** บวก/ลบวันบนสตริง YYYY-MM-DD แบบปฏิทินล้วน ไม่เพี้ยนตาม timezone */
export function addDaysStr(iso: string, delta: number): string {
  const [y, m, d] = iso.substring(0, 10).split('-').map(Number)
  return fmtUtcDate(new Date(Date.UTC(y, m - 1, d + delta)))
}

/** จำนวนวันจาก from ถึง to (to − from) */
export function diffDaysStr(from: string, to: string): number {
  return Math.round((Date.parse(`${to.substring(0, 10)}T00:00:00Z`) - Date.parse(`${from.substring(0, 10)}T00:00:00Z`)) / 86400000)
}

/** ยิ่งสูงยิ่งดี: v ≥ green → G, v ≥ yellow → Y, else R */
export function gradeHigh(v: number, green: number, yellow: number): 'G' | 'Y' | 'R' {
  if (!Number.isFinite(v)) return 'R'
  return v >= green ? 'G' : v >= yellow ? 'Y' : 'R'
}

/** ยิ่งต่ำยิ่งดี: v ≤ green (หรือ < green เมื่อ strictGreen=true เช่น AR < 10%) → G, v ≤ yellow → Y, else R */
export function gradeLow(v: number, green: number, yellow: number, strictGreen = false): 'G' | 'Y' | 'R' {
  if (!Number.isFinite(v)) return 'R'
  return (strictGreen ? v < green : v <= green) ? 'G' : v <= yellow ? 'Y' : 'R'
}

/** วันแรกที่มีรายการบัญชี post แล้ว (ไม่นับปิดงวด) — ไม่มี = null */
export function firstPostedDate(tenantId: string): string | null {
  const row = db.prepare(`SELECT MIN(date(je.date)) as d FROM journal_entries je WHERE ${POSTED}`).get(tenantId) as { d: string | null }
  return row?.d ?? null
}

/** ชุดบัญชีเงินสด/ธนาคาร (moneyAccounts) + บัญชีพักรับ POS (1180) */
export function cashAccountIds(tenantId: string): string[] {
  const ids = new Set(moneyAccounts(tenantId).map(a => a.id))
  const pos = db.prepare('SELECT id FROM accounts WHERE tenant_id = ? AND code = ?').all(tenantId, ACC.POS_CLEARING) as { id: string }[]
  for (const r of pos) ids.add(r.id)
  return [...ids]
}

/** ยอดคงเหลือชุดเงินสด (เดบิต − เครดิต) ณ สิ้นวัน asOf (หรือก่อนวัน asOf เมื่อ before=true) */
export function cashBalanceAt(tenantId: string, asOf: string, before = false): number {
  const ids = cashAccountIds(tenantId)
  if (ids.length === 0) return 0
  const row = db.prepare(`
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as v
    FROM journal_lines jl JOIN journal_entries je ON jl.journal_entry_id = je.id
    WHERE ${POSTED} AND date(je.date) ${before ? '<' : '<='} ? AND jl.account_id IN (${ids.map(() => '?').join(',')})
  `).get(tenantId, asOf, ...ids) as { v: number }
  return r2(row.v)
}

/**
 * เงินออกรายวัน = Σ ต่อ journal entry ของ max(0, −netCashEffect(entry))
 * โอนภายในชุดเงินสด (เช่น ปิดกะย้าย 1180 → ธนาคาร/เงินสด) สุทธิเป็น 0 จึงไม่นับเป็นเงินออก
 */
export function cashOutflow(tenantId: string, from: string, to: string): {
  total: number; days: number; avgPerDay: number; dataSince: string | null; byDay: Record<string, number>
} {
  const dataSince = firstPostedDate(tenantId)
  if (!dataSince || from > to || dataSince > to) {
    return { total: 0, days: 0, avgPerDay: 0, dataSince, byDay: {} }
  }
  const effFrom = from > dataSince ? from : dataSince
  const days = diffDaysStr(effFrom, to) + 1
  const ids = cashAccountIds(tenantId)
  if (ids.length === 0) return { total: 0, days, avgPerDay: 0, dataSince, byDay: {} }

  const rows = db.prepare(`
    SELECT je.id, date(je.date) as d, COALESCE(SUM(jl.debit - jl.credit), 0) as net
    FROM journal_lines jl JOIN journal_entries je ON jl.journal_entry_id = je.id
    WHERE ${POSTED} AND date(je.date) BETWEEN ? AND ? AND jl.account_id IN (${ids.map(() => '?').join(',')})
    GROUP BY je.id, date(je.date)
  `).all(tenantId, effFrom, to, ...ids) as Array<{ id: string; d: string; net: number }>

  const byDay: Record<string, number> = {}
  let total = 0
  for (const r of rows) {
    const out = Math.max(0, -Number(r.net))
    if (out > 0) {
      byDay[r.d] = r2((byDay[r.d] || 0) + out)
      total += out
    }
  }
  total = r2(total)
  return { total, days, avgPerDay: days > 0 ? r2(total / days) : 0, dataSince, byDay }
}

export interface DailyPoint {
  date: string
  rev: number
  exp: number
  cashOpen: number
  cashClose: number
  cashHi: number
  cashLo: number
}

/**
 * ซีรีส์รายวันตั้งแต่ max(from, dataSince) ถึง to
 * เงินคงเหลือสูงสุด/ต่ำสุดระหว่างวันไล่ตามลำดับ journal_entries.created_at แล้วตาม jl.id เริ่มจากยอดก่อนวันแรก
 */
export function dailySeries(tenantId: string, from: string, to: string): DailyPoint[] {
  const dataSince = firstPostedDate(tenantId)
  if (!dataSince || from > to || dataSince > to) return []
  const start = from > dataSince ? from : dataSince

  const plRows = db.prepare(`
    SELECT date(je.date) as d,
      COALESCE(SUM(CASE WHEN a.type = 'REVENUE' THEN jl.credit - jl.debit ELSE 0 END), 0) as rev,
      COALESCE(SUM(CASE WHEN a.type = 'EXPENSE' THEN jl.debit - jl.credit ELSE 0 END), 0) as exp
    ${LEDGER_FROM}
    WHERE ${POSTED} AND date(je.date) BETWEEN ? AND ? AND a.type IN ('REVENUE', 'EXPENSE')
    GROUP BY d
  `).all(tenantId, start, to) as Array<{ d: string; rev: number; exp: number }>
  const revByDay = new Map(plRows.map(r => [r.d, r2(r.rev)]))
  const expByDay = new Map(plRows.map(r => [r.d, r2(r.exp)]))

  const cashIds = cashAccountIds(tenantId)
  const cashDeltasByDay = new Map<string, number[]>()
  if (cashIds.length > 0) {
    const lineRows = db.prepare(`
      SELECT date(je.date) as d, (jl.debit - jl.credit) as delta
      FROM journal_lines jl JOIN journal_entries je ON jl.journal_entry_id = je.id
      WHERE ${POSTED} AND date(je.date) BETWEEN ? AND ? AND jl.account_id IN (${cashIds.map(() => '?').join(',')})
      ORDER BY date(je.date) ASC, je.created_at ASC, jl.id ASC
    `).all(tenantId, start, to, ...cashIds) as Array<{ d: string; delta: number }>
    for (const r of lineRows) {
      let arr = cashDeltasByDay.get(r.d)
      if (!arr) { arr = []; cashDeltasByDay.set(r.d, arr) }
      arr.push(Number(r.delta) || 0)
    }
  }

  let cash = cashBalanceAt(tenantId, start, true)
  const out: DailyPoint[] = []
  for (let cur = start; cur <= to; cur = addDaysStr(cur, 1)) {
    const cashOpen = r2(cash)
    let run = cashOpen, hi = cashOpen, lo = cashOpen
    const deltas = cashDeltasByDay.get(cur)
    if (deltas) {
      for (const delta of deltas) {
        run = r2(run + delta)
        if (run > hi) hi = run
        if (run < lo) lo = run
      }
    }
    cash = run
    out.push({
      date: cur,
      rev: revByDay.get(cur) ?? 0,
      exp: expByDay.get(cur) ?? 0,
      cashOpen,
      cashClose: run,
      cashHi: hi,
      cashLo: lo,
    })
  }
  return out
}

export interface Candle {
  o: number
  c: number
  h: number
  l: number
  tot: number
}

export interface TrendPeriod {
  key: string
  from: string
  to: string
  days: number
  partial?: boolean
  rev: Candle
  exp: Candle
  cash: { c: number; hi: number; lo: number } | null
}

/** วันจันทร์ของสัปดาห์ ISO (จันทร์–อาทิตย์) */
export function weekKey(iso: string): string {
  const [y, m, d] = iso.substring(0, 10).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7))
  return fmtUtcDate(dt)
}

export const monthKey = (iso: string): string => iso.substring(0, 7)
export const quarterKey = (iso: string): string => `${iso.substring(0, 4)}-Q${Math.floor((Number(iso.substring(5, 7)) - 1) / 3) + 1}`
export const yearKey = (iso: string): string => iso.substring(0, 4)

function fullPeriodDays(key: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return 7
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split('-').map(Number)
    return new Date(Date.UTC(y, m, 0)).getUTCDate()
  }
  if (/^\d{4}-Q[1-4]$/.test(key)) {
    const y = Number(key.slice(0, 4)), q = Number(key.slice(-1))
    const m0 = (q - 1) * 3 + 1
    return new Date(Date.UTC(y, m0, 0)).getUTCDate()
      + new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
      + new Date(Date.UTC(y, m0 + 2, 0)).getUTCDate()
  }
  if (/^\d{4}$/.test(key)) {
    const y = Number(key)
    return (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365
  }
  return 7
}

/** pure — รวมรายวันตาม key เป็นแท่งเทียนอัตราต่อวัน (O = C งวดก่อน, งวดแรก O = C ตัวเอง, H/L คลุม O และ C เสมอ) */
export function buildCandles(
  days: Array<{ date: string; rev: number; exp: number; cashOpen?: number; cashClose?: number; cashHi?: number; cashLo?: number }>,
  keyOf: (date: string) => string,
): TrendPeriod[] {
  const groups: Array<{
    key: string; from: string; to: string; revs: number[]; exps: number[]
    cashHi: number; cashLo: number; cashClose: number; hasCash: boolean
  }> = []

  for (const d of days) {
    const key = keyOf(d.date)
    const hasCash = d.cashClose !== undefined
    const cClose = Number(d.cashClose ?? 0)
    const cHi = Number(d.cashHi ?? cClose)
    const cLo = Number(d.cashLo ?? cClose)
    let g = groups[groups.length - 1]
    if (!g || g.key !== key) {
      g = { key, from: d.date, to: d.date, revs: [], exps: [], cashHi: cHi, cashLo: cLo, cashClose: cClose, hasCash }
      groups.push(g)
    }
    g.to = d.date
    g.revs.push(Number(d.rev) || 0)
    g.exps.push(Number(d.exp) || 0)
    if (hasCash) {
      g.hasCash = true
      g.cashHi = Math.max(g.cashHi, cHi)
      g.cashLo = Math.min(g.cashLo, cLo)
      g.cashClose = cClose
    }
  }

  const makeCandle = (vals: number[], prevC: number | null): Candle => {
    const tot = r2(vals.reduce((a, b) => a + b, 0))
    const c = r2(tot / vals.length)
    const o = prevC ?? c
    const h = r2(Math.max(o, c, ...vals))
    const l = r2(Math.min(o, c, ...vals))
    return { o, c, h, l, tot }
  }

  let prevRev: number | null = null
  let prevExp: number | null = null
  return groups.map(g => {
    const rev = makeCandle(g.revs, prevRev)
    const exp = makeCandle(g.exps, prevExp)
    prevRev = rev.c
    prevExp = exp.c
    const n = g.revs.length
    return {
      key: g.key,
      from: g.from,
      to: g.to,
      days: n,
      partial: n < fullPeriodDays(g.key),
      rev,
      exp,
      cash: g.hasCash ? { c: r2(g.cashClose), hi: r2(g.cashHi), lo: r2(g.cashLo) } : null,
    }
  })
}

export type TrendGrain = 'week' | 'month' | 'quarter' | 'year'

export const GRAIN_MA: Record<TrendGrain, [number, number]> = {
  week: [4, 13],
  month: [3, 12],
  quarter: [2, 4],
  year: [2, 3],
}

export interface TrendSeriesResult {
  grain: TrendGrain
  requestedGrain: TrendGrain
  note?: string
  ma: [number, number]
  warmup: number
  dataSince: string | null
  periods: TrendPeriod[]
}

function defaultFromForGrain(grain: TrendGrain, to: string): string {
  const y = Number(to.slice(0, 4)), m0 = Number(to.slice(5, 7)) - 1
  if (grain === 'week') return addDaysStr(weekKey(to), -51 * 7)
  if (grain === 'month') return monthRange(y, m0 - 11).start
  if (grain === 'quarter') {
    const qStartMonth = Math.floor(m0 / 3) * 3
    return monthRange(y, qStartMonth - 7 * 3).start
  }
  return `${y - 4}-01-01`
}

function stepBackPeriods(grain: TrendGrain, from: string, count: number): string {
  const y = Number(from.slice(0, 4)), m0 = Number(from.slice(5, 7)) - 1
  if (grain === 'week') return addDaysStr(weekKey(from), -count * 7)
  if (grain === 'month') return monthRange(y, m0 - count).start
  if (grain === 'quarter') {
    const qStartMonth = Math.floor(m0 / 3) * 3
    return monthRange(y, qStartMonth - count * 3).start
  }
  return `${y - count}-01-01`
}

/**
 * ซีรีส์แท่งเทียนสำหรับทั้ง Dashboard และ Phopy Board (ใช้ฟังก์ชันเดียวร่วมกัน)
 * ถ้าระบุ grain = 'year' แต่ข้อมูลตั้งแต่วันแรกถึง to ยังไม่ถึง 3 ปี จะลดเป็น 'quarter' พร้อม note
 */
export function trendSeries(
  tenantId: string,
  grain: TrendGrain = 'month',
  from?: string,
  to?: string,
  warmup?: number,
): TrendSeriesResult {
  const end = to || thaiToday()
  const dataSince = firstPostedDate(tenantId)
  const spanDays = dataSince && dataSince <= end ? diffDaysStr(dataSince, end) + 1 : 0
  const fallback = grain === 'year' && spanDays < 365 * 3
  const effGrain: TrendGrain = fallback ? 'quarter' : grain
  const ma = GRAIN_MA[effGrain]
  const effWarmup = warmup !== undefined ? warmup : ma[1] - 1
  const start = from || defaultFromForGrain(effGrain, end)
  const warmupFrom = stepBackPeriods(effGrain, start, effWarmup)
  const keyOf = effGrain === 'week' ? weekKey : effGrain === 'month' ? monthKey : effGrain === 'quarter' ? quarterKey : yearKey

  const days = dailySeries(tenantId, warmupFrom, end)
  const allPeriods = buildCandles(days, keyOf)
  const targetKey = keyOf(start)
  const firstIdx = allPeriods.findIndex(p => p.key >= targetKey)
  const periods = firstIdx > effWarmup ? allPeriods.slice(firstIdx - effWarmup) : allPeriods
  // จำนวนงวด warm-up ที่มีอยู่จริง (ข้อมูลเริ่มทีหลังก็มีน้อยกว่าที่ขอ) — หน้าเว็บใช้เป็น visibleFrom ห้ามเกินของจริง
  const actualWarmup = periods.filter(p => p.key < targetKey).length

  const result: TrendSeriesResult = {
    grain: effGrain,
    requestedGrain: grain,
    ma,
    warmup: actualWarmup,
    dataSince,
    periods,
  }
  if (fallback) result.note = 'ข้อมูลยังไม่ถึง 3 ปี แสดงเป็นรายไตรมาส'
  return result
}
