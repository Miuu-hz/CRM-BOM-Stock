import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { convertQuantityBidirectional, normalizeUnit } from '../services/unitConversion.service'
import { HEALTH } from '../config/thresholds'
import { closeChecklist } from '../services/closeChecklist.service'
import { previousPeriod } from '../services/monthClose.service'
import {
  r2, addDaysStr, diffDaysStr, gradeHigh, gradeLow,
  firstPostedDate, cashBalanceAt, cashOutflow,
  ledgerRevenue, ledgerCogs, arAging, weekKey, trendSeries,
} from '../services/phopyBoard.service'

export { gradeHigh, gradeLow }

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

const pad2 = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
// เซิร์ฟเวอร์รัน UTC — ก่อน 7 โมงเช้าไทย new Date() ยังเป็น "เมื่อวาน" ทำให้แท็บวันนี้โชว์ยอดเมื่อวาน
// ทุกช่วงเวลาบนแดชบอร์ดจึงต้องคิดจากเวลาไทย
export const thaiNow = () => {
  const now = new Date()
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000)
  return new Date(utc + (7 * 3600000))
}

function isFinancialAllowed(user: any): boolean {
  if (!user) return false
  if (user.role === 'MASTER' || user.role === 'ADMIN' || user.role === 'MANAGER' || user.role === 'POWERUSER') return true
  const deps = user.departments || (user.department ? [user.department] : [])
  if (deps.some((d: string) => ['CEO', 'CTO', 'IT', 'ACCOUNTING', 'SALES'].includes(d))) return true
  return false
}

// ช่วงเวลาปัจจุบัน (offset=0) และช่วงเทียบก่อนหน้า (offset=1) — ต้อง "ยาวเท่ากันเสมอ"
// ทั้งสองฝั่ง ไม่งั้น % เปลี่ยนแปลงจะเพี้ยน (บั๊ก B3 เดิม: 'month' เทียบเดือนปฏิทิน
// ปัจจุบันที่ยังไม่จบกับเดือนก่อนที่จบเต็มเดือน). ป้ายบนหน้าเว็บคือ
// วันนี้/7 วัน/30 วัน/ปีนี้ ดังนั้น 'week'/'month' ต้องเป็น rolling window ย้อนหลังจริง
// ไม่ใช่สัปดาห์/เดือนปฏิทิน — ตรงกับสิ่งที่ผู้ใช้เห็นบนแท็บ
export function getRange(period: string, offset: number = 0): { start: string; end: string } {
  const now = thaiNow()
  if (period === 'day') {
    const d = new Date(now); d.setDate(d.getDate() - offset)
    const s = ymd(d)
    return { start: s, end: s }
  } else if (period === 'week') {
    // 7 วันล่าสุด (รวมวันนี้), ช่วงก่อนหน้า = 7 วันก่อนหน้านั้น (ยาวเท่ากัน)
    const end = new Date(now); end.setDate(end.getDate() - offset * 7)
    const start = new Date(end); start.setDate(start.getDate() - 6)
    return { start: ymd(start), end: ymd(end) }
  } else if (period === 'month') {
    // 30 วันล่าสุด (รวมวันนี้), ช่วงก่อนหน้า = 30 วันก่อนหน้านั้น (ยาวเท่ากัน)
    const end = new Date(now); end.setDate(end.getDate() - offset * 30)
    const start = new Date(end); start.setDate(start.getDate() - 29)
    return { start: ymd(start), end: ymd(end) }
  } else { // year: year-to-date เทียบกับช่วงเดียวกันของปีก่อน (ไม่ใช่ทั้งปีเต็ม)
    const y = now.getFullYear() - offset
    const start = new Date(y, 0, 1)
    const maxDays = new Date(y, now.getMonth() + 1, 0).getDate()
    const day = Math.min(now.getDate(), maxDays)
    const end = new Date(y, now.getMonth(), day)
    return { start: ymd(start), end: ymd(end) }
  }
}

// ยอดขาย/ต้นทุนขายจริง — คำนวณจาก journal_lines (ledger) แบบเดียวกับ
// GET /reports/profit-loss ทุกประการ (type=REVENUE / EXPENSE+category=COGS,
// is_posted=1, level>=1) เพื่อให้ Dashboard กับหน้า P&L Report ไม่มีวันเลขไม่ตรงกัน
// อีก — เดิม Dashboard คำนวณจาก orders/invoices/purchase_orders คนละตารางกัน 3 จุด
// (บั๊ก B1/B2/B4) ส่วน journal ครอบคลุมทั้งใบแจ้งหนี้ (reference_type=INVOICE) และ
// ขาย POS ที่ผ่านบัญชีจริง (reference_type=POS_SALE) โดยไม่นับซ้ำ เพราะ POS ไม่ได้
// สร้างแถวใน invoices/orders เลย (ตรวจโค้ด sales/pos.routes.ts แล้ว)
// startDate/endDate เป็นรูปแบบ 'YYYY-MM-DD' ตรงกับ journal_entries.date เป๊ะ (ไม่มีเวลา)
function getLedgerTotals(tenantId: string, startDate: string, endDate: string): { revenue: number; cogs: number } {
  const row = db.prepare(`
    SELECT
      -- เครื่องหมายตาม type: ส่วนลดขาย/รับคืน (REVENUE แต่ normal_balance=DEBIT) ต้องหักออกจากยอดขาย ไม่ใช่บวกเพิ่ม
      COALESCE(SUM(CASE WHEN a.type = 'REVENUE' THEN jl.credit - jl.debit ELSE 0 END), 0) as revenue,
      COALESCE(SUM(CASE WHEN a.type = 'EXPENSE' AND a.category = 'COGS' THEN jl.debit - jl.credit ELSE 0 END), 0) as cogs
    FROM journal_lines jl
    JOIN journal_entries je ON jl.journal_entry_id = je.id
    JOIN accounts a ON jl.account_id = a.id
    WHERE a.tenant_id = ?
      AND jl.tenant_id = ?
      AND je.tenant_id = ?
      AND a.is_active = 1 AND a.level >= 1
      AND je.is_posted = 1
      AND (je.is_closing_entry = 0 OR je.is_closing_entry IS NULL)
      AND je.date >= ? AND je.date <= ?
  `).get(tenantId, tenantId, tenantId, startDate, endDate) as any
  return { revenue: row?.revenue || 0, cogs: row?.cogs || 0 }
}

const OPEX_TOP_N = 8
const ym = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`

// รายจ่ายประจำ (ค่าใช้จ่ายดำเนินงาน) = EXPENSE ที่ category ≠ COGS — ตัวกรองเดียวกับ
// operatingExpenses ใน /reports/profit-loss (category ว่างก็นับ) · เดือนปฏิทินไทย:
// เดือนนี้ (ถึงวันนี้) เทียบเดือนก่อนทั้งเดือน
// "ประจำ" = บัญชีที่มียอดอย่างน้อย 2 ใน 3 เดือนล่าสุด (รวมเดือนนี้) — ถ้าในช่วงนั้นมีข้อมูล
// บัญชีไม่ถึง 2 เดือน (เพิ่งเริ่มใช้ระบบ) แยกไม่ได้ ให้ isRecurring = null ทุกบัญชี
export function getOpexSummary(tenantId: string, now: Date = thaiNow()) {
  const y = now.getFullYear(), m = now.getMonth()
  const months = [ym(new Date(y, m, 1)), ym(new Date(y, m - 1, 1)), ym(new Date(y, m - 2, 1))] // [เดือนนี้, เดือนก่อน, 2 เดือนก่อน]
  const start = `${months[2]}-01`
  const today = ymd(now)

  const rows = db.prepare(`
    SELECT a.code, a.name, substr(je.date, 1, 7) as month,
      COALESCE(SUM(jl.debit - jl.credit), 0) as amount
    FROM journal_lines jl
    JOIN journal_entries je ON jl.journal_entry_id = je.id
    JOIN accounts a ON jl.account_id = a.id
    WHERE a.tenant_id = ? AND jl.tenant_id = ? AND je.tenant_id = ?
      AND a.is_active = 1 AND a.level >= 1
      AND a.type = 'EXPENSE' AND IFNULL(a.category, '') <> 'COGS'
      AND je.is_posted = 1
      AND (je.is_closing_entry = 0 OR je.is_closing_entry IS NULL)
      AND je.date >= ? AND je.date <= ?
    GROUP BY a.code, a.name, month
  `).all(tenantId, tenantId, tenantId, start, today) as { code: string; name: string; month: string; amount: number }[]

  // เดือนที่มีข้อมูลบัญชีจริง (entry ใดก็ได้) — ใช้ตัดสินว่าประวัติพอจะแยกประจำ/ครั้งคราวไหม
  const dataMonths = new Set((db.prepare(`
    SELECT DISTINCT substr(date, 1, 7) as month FROM journal_entries
    WHERE tenant_id = ? AND is_posted = 1
      AND (is_closing_entry = 0 OR is_closing_entry IS NULL)
      AND date >= ? AND date <= ?
  `).all(tenantId, start, today) as { month: string }[]).map(r => r.month))
  const hasEnoughHistory = dataMonths.size >= 2

  const byAcc = new Map<string, { code: string; name: string; amounts: Record<string, number> }>()
  for (const r of rows) {
    const acc = byAcc.get(r.code) ?? { code: r.code, name: r.name, amounts: {} }
    byAcc.set(r.code, { ...acc, amounts: { ...acc.amounts, [r.month]: r.amount } })
  }
  const nonZero = (n: number | undefined) => Math.abs(n || 0) >= 0.005

  const all = [...byAcc.values()]
    .map(a => ({
      code: a.code,
      name: a.name,
      current: a.amounts[months[0]] || 0,
      previous: a.amounts[months[1]] || 0,
      amounts: a.amounts,
      isRecurring: hasEnoughHistory ? months.filter(mo => nonZero(a.amounts[mo])).length >= 2 : null,
    }))
    .filter(a => nonZero(a.current) || nonZero(a.previous))
    .sort((a, b) => (b.current - a.current) || (b.previous - a.previous) || a.code.localeCompare(b.code))

  const sum = (list: typeof all, key: 'current' | 'previous') => list.reduce((s, a) => s + a[key], 0)
  const recurringList = all.filter(a => a.isRecurring)
  const top = all.slice(0, OPEX_TOP_N)
  const rest = all.slice(OPEX_TOP_N)

  // ค่าเฉลี่ยต่อเดือนสำหรับพยากรณ์เงินออก: บัญชีประจำ เฉลี่ยจากเดือนที่จบแล้วและมีข้อมูล
  // (เดือนนี้ยังไม่จบ ใส่ไปจะดึงค่าเฉลี่ยต่ำ) · ประวัติไม่พอ → ใช้ยอดเดือนนี้ทั้งหมดเป็นค่าประมาณ
  const closedMonths = months.slice(1).filter(mo => dataMonths.has(mo))
  const monthlyRecurringAvg = hasEnoughHistory && closedMonths.length > 0
    ? recurringList.reduce((s, a) => s + closedMonths.reduce((t, mo) => t + (a.amounts[mo] || 0), 0), 0) / closedMonths.length
    : sum(all, 'current')

  const curTotals = getLedgerTotals(tenantId, `${months[0]}-01`, today)
  const prevEnd = ymd(new Date(y, m, 0)) // วันสุดท้ายของเดือนก่อน
  const prevTotals = getLedgerTotals(tenantId, `${months[1]}-01`, prevEnd)
  const curTotal = sum(all, 'current'), prevTotal = sum(all, 'previous')

  return {
    month: months[0],
    prevMonth: months[1],
    hasEnoughHistory,
    current: {
      total: curTotal,
      recurring: sum(recurringList, 'current'),
      revenue: curTotals.revenue,
      cogs: curTotals.cogs,
      netProfit: curTotals.revenue - curTotals.cogs - curTotal,
    },
    previous: {
      total: prevTotal,
      recurring: sum(recurringList, 'previous'),
      revenue: prevTotals.revenue,
      cogs: prevTotals.cogs,
      netProfit: prevTotals.revenue - prevTotals.cogs - prevTotal,
    },
    accounts: top.map(({ amounts, ...a }) => a),
    others: { count: rest.length, current: sum(rest, 'current'), previous: sum(rest, 'previous') },
    monthlyRecurringAvg,
  }
}

export function getLowStockItems(tenantId: string) {
  const rows = db.prepare(`
    SELECT id, name, sku, quantity, min_stock, unit, base_unit, display_unit, sealed_qty
    FROM stock_items
    WHERE tenant_id = ? AND quantity <= min_stock AND min_stock > 0
  `).all(tenantId) as any[]

  // An unopened pack is still stock. Items whose loose quantity is low but
  // that still hold sealed packs are not actually short, so drop them here
  // instead of nagging the owner to reorder what is already on the shelf.
  // Preload conversions for tenant to prevent N+1 queries
  const conversions = db.prepare(`
    SELECT from_unit, to_unit, conversion_factor, material_id
    FROM unit_conversions
    WHERE tenant_id = ? OR is_global = 1
  `).all(tenantId) as any[]
  const convMap = new Map<string, number>()
  for (const c of conversions) {
    convMap.set(`${c.material_id || '*'}:${normalizeUnit(c.from_unit)}->${normalizeUnit(c.to_unit)}`, Number(c.conversion_factor))
  }

  return rows
    .map((r: any) => {
      const baseUnit = r.base_unit || r.unit
      const displayUnit = r.display_unit || r.unit
      let packFactor: number | null = null
      if (baseUnit && displayUnit && normalizeUnit(baseUnit) !== normalizeUnit(displayUnit)) {
        const normFrom = normalizeUnit(displayUnit)
        const normTo = normalizeUnit(baseUnit)
        const matFactor = convMap.get(`${r.id}:${normFrom}->${normTo}`)
        const globFactor = convMap.get(`*:${normFrom}->${normTo}`)
        packFactor = matFactor ?? globFactor ?? null
        if (!packFactor) {
          const c = convertQuantityBidirectional(1, displayUnit, baseUnit, tenantId, r.id)
          if (c && c.factor > 0) packFactor = c.factor
        }
      }
      const available = r.quantity + (packFactor ? (r.sealed_qty || 0) * packFactor : 0)
      return { ...r, minStock: r.min_stock, available, pack_factor: packFactor }
    })
    .filter((r: any) => r.available <= r.min_stock)
    .sort((a: any, b: any) => (a.available / (a.min_stock || 1)) - (b.available / (b.min_stock || 1)))
}

const TH_DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
const fmtBaht = (v: number) => `${v < 0 ? '-' : ''}฿${Math.round(Math.abs(v)).toLocaleString('th-TH')}`

export function getDashboardHealth(tenantId: string, financial: boolean, now: Date = thaiNow()) {
  const today = ymd(now)
  const asOf = addDaysStr(today, -1)
  const due7Str = addDaysStr(today, HEALTH.forecastHorizonDays)

  const lowStock = getLowStockItems(tenantId).length
  const pendingDelivery = Number((db.prepare(`
    SELECT COUNT(*) as c FROM sales_orders
    WHERE tenant_id = ? AND status IN ('CONFIRMED','PROCESSING','READY','PARTIAL')
  `).get(tenantId) as { c: number }).c)
  const pendingApprovals = Number((db.prepare(`
    SELECT COUNT(*) as c FROM approval_requests
    WHERE tenant_id = ? AND status = 'PENDING'
  `).get(tenantId) as { c: number }).c)
  const arDue7Row = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(balance_amount), 0) as amount
    FROM invoices
    WHERE tenant_id = ?
      AND status NOT IN ('CANCELLED', 'DRAFT')
      AND COALESCE(payment_status, '') <> 'PAID'
      AND balance_amount > 0
      AND (due_date IS NULL OR due_date = '' OR date(due_date) <= ?)
  `).get(tenantId, due7Str) as { count: number; amount: number }

  const ops = {
    lowStock,
    pendingDelivery,
    pendingApprovals,
    arDue7: {
      count: Number(arDue7Row.count),
      amount: financial ? r2(arDue7Row.amount) : null,
    },
  }

  if (!financial) {
    return {
      financial: false,
      asOf,
      today,
      dataSince: null,
      dataDays: 0,
      overall: null,
      confidence: null,
      signals: [],
      chart: null,
      ops,
    }
  }

  const dataSince = firstPostedDate(tenantId)
  const dataDays = dataSince && dataSince <= asOf ? diffDaysStr(dataSince, asOf) + 1 : 0
  const cashAsOf = cashBalanceAt(tenantId, asOf)

  // 1. runway ("เงินพอใช้")
  const outflowFrom = addDaysStr(asOf, -(HEALTH.runwayLookbackDays - 1))
  const outflow = cashOutflow(tenantId, outflowFrom, asOf)
  const dataDaysNote = outflow.days > 0 && outflow.days < HEALTH.runwayLookbackDays ? ` (ข้อมูล ${outflow.days} วัน)` : ''
  const runwayDays = outflow.avgPerDay > 0 ? r2(cashAsOf / outflow.avgPerDay) : null
  const runwaySignal = runwayDays !== null ? {
    id: 'runway' as const,
    label: 'เงินพอใช้',
    status: gradeHigh(runwayDays, HEALTH.runwayDays.green, HEALTH.runwayDays.yellow),
    value: runwayDays,
    display: `${Math.round(runwayDays)} วัน`,
    compare: `เงินคงเหลือ ${fmtBaht(cashAsOf)} · ใช้เฉลี่ยวันละ ${fmtBaht(outflow.avgPerDay)}${dataDaysNote}`,
    rule: `เขียว ≥ ${HEALTH.runwayDays.green} วัน · เหลือง ${HEALTH.runwayDays.yellow}–${HEALTH.runwayDays.green - 1} · แดง < ${HEALTH.runwayDays.yellow}`,
    source: `บัญชีเงินสด + เงินฝาก + 1180 · เงินออกเฉลี่ย ${HEALTH.runwayLookbackDays} วัน`,
    action: 'ดูรายจ่ายก้อนใหญ่ที่จะถึงรอบ และเร่งเก็บลูกหนี้',
    link: '/accounting/phopy-board?chapter=2',
  } : {
    id: 'runway' as const,
    label: 'เงินพอใช้',
    status: 'NA' as const,
    value: null,
    display: 'ไม่มีข้อมูล',
    compare: outflow.days === 0 ? 'ยังไม่มีรายการบัญชีที่บันทึกแล้ว' : `เงินคงเหลือ ${fmtBaht(cashAsOf)} · ยังไม่มีรายการเงินออก${dataDaysNote}`,
    rule: `เขียว ≥ ${HEALTH.runwayDays.green} วัน · เหลือง ${HEALTH.runwayDays.yellow}–${HEALTH.runwayDays.green - 1} · แดง < ${HEALTH.runwayDays.yellow}`,
    source: `บัญชีเงินสด + เงินฝาก + 1180 · เงินออกเฉลี่ย ${HEALTH.runwayLookbackDays} วัน`,
    action: 'ดูรายจ่ายก้อนใหญ่ที่จะถึงรอบ และเร่งเก็บลูกหนี้',
    link: '/accounting/phopy-board?chapter=2',
  }

  // 2. salesYesterday ("ยอดขายเมื่อวาน")
  const revYesterday = r2(ledgerRevenue(tenantId, asOf, asOf))
  const dow = new Date(`${asOf}T00:00:00Z`).getUTCDay()
  const dowName = TH_DOW[dow]
  const sameDowDates: string[] = []
  if (dataSince) {
    for (let k = 1; k <= HEALTH.salesSameWeekdayWeeks; k++) {
      const d = addDaysStr(asOf, -7 * k)
      if (d >= dataSince) sameDowDates.push(d)
    }
  }
  const sameDowAvg = sameDowDates.length > 0
    ? sameDowDates.reduce((s, d) => s + ledgerRevenue(tenantId, d, d), 0) / sameDowDates.length
    : 0
  const salesRatio = sameDowAvg > 0 ? revYesterday / sameDowAvg : null
  const salesSignal = salesRatio !== null ? {
    id: 'salesYesterday' as const,
    label: 'ยอดขายเมื่อวาน',
    status: gradeHigh(salesRatio, HEALTH.salesVsSameWeekday.green, HEALTH.salesVsSameWeekday.yellow),
    value: revYesterday,
    display: fmtBaht(revYesterday),
    compare: `${Math.round(salesRatio * 100)}% ของวัน${dowName}ปกติ (${fmtBaht(sameDowAvg)})`,
    rule: `เทียบวันเดียวกัน ${HEALTH.salesSameWeekdayWeeks} สัปดาห์ก่อน · เขียว ≥ ${Math.round(HEALTH.salesVsSameWeekday.green * 100)}% · แดง < ${Math.round(HEALTH.salesVsSameWeekday.yellow * 100)}%`,
    source: 'บิล POS ที่จ่ายแล้ว + ใบแจ้งหนี้ขาย',
    action: 'ตรวจจำนวนบิลและค่าเฉลี่ยต่อบิลเมื่อวานเทียบสัปดาห์ก่อน',
    link: '/accounting/phopy-board?chapter=3',
  } : {
    id: 'salesYesterday' as const,
    label: 'ยอดขายเมื่อวาน',
    status: 'NA' as const,
    value: null,
    display: 'ไม่มีข้อมูล',
    compare: `ยังไม่มีฐานยอดขายวัน${dowName}ของสัปดาห์ก่อนหน้า`,
    rule: `เทียบวันเดียวกัน ${HEALTH.salesSameWeekdayWeeks} สัปดาห์ก่อน · เขียว ≥ ${Math.round(HEALTH.salesVsSameWeekday.green * 100)}% · แดง < ${Math.round(HEALTH.salesVsSameWeekday.yellow * 100)}%`,
    source: 'บิล POS ที่จ่ายแล้ว + ใบแจ้งหนี้ขาย',
    action: 'ตรวจจำนวนบิลและค่าเฉลี่ยต่อบิลเมื่อวานเทียบสัปดาห์ก่อน',
    link: '/accounting/phopy-board?chapter=3',
  }

  // 3. cogs7 ("ต้นทุนวัตถุดิบ 7 วัน")
  const cogs7Start = addDaysStr(asOf, -(HEALTH.cogsShortDays - 1))
  const cogs90Start = addDaysStr(asOf, -(HEALTH.cogsLongDays - 1))
  const rev7 = ledgerRevenue(tenantId, cogs7Start, asOf)
  const rev90 = ledgerRevenue(tenantId, cogs90Start, asOf)
  const cogs7Val = ledgerCogs(tenantId, cogs7Start, asOf)
  const cogs90Val = ledgerCogs(tenantId, cogs90Start, asOf)
  const cogsSignal = rev7 > 0 && rev90 > 0 ? (() => {
    const pct7 = (cogs7Val / rev7) * 100
    const pct90 = (cogs90Val / rev90) * 100
    const drift = r2(pct7 - pct90)
    return {
      id: 'cogs7' as const,
      label: 'ต้นทุนวัตถุดิบ 7 วัน',
      status: gradeLow(drift, HEALTH.cogsDriftPoints.green, HEALTH.cogsDriftPoints.yellow),
      value: drift,
      display: `${pct7.toFixed(1)}%`,
      compare: `${drift >= 0 ? 'สูงกว่า' : 'ต่ำกว่า'}ค่าเฉลี่ย ${HEALTH.cogsLongDays} วัน ${Math.abs(drift).toFixed(1)} จุด`,
      rule: `เขียว ≤ +${HEALTH.cogsDriftPoints.green} จุด · เหลือง +${HEALTH.cogsDriftPoints.green} ถึง +${HEALTH.cogsDriftPoints.yellow} · แดง > +${HEALTH.cogsDriftPoints.yellow}`,
      source: 'ต้นทุนขาย (บัญชีหมวด COGS) ÷ รายได้',
      action: 'ดูราคาซื้อวัตถุดิบหลัก 7 วันล่าสุด และของเสียจากการปรับสต็อก',
      link: '/accounting/phopy-board?chapter=4',
    }
  })() : {
    id: 'cogs7' as const,
    label: 'ต้นทุนวัตถุดิบ 7 วัน',
    status: 'NA' as const,
    value: null,
    display: 'ไม่มีข้อมูล',
    compare: `ยังไม่มีรายได้ในช่วง ${HEALTH.cogsShortDays} หรือ ${HEALTH.cogsLongDays} วันที่ผ่านมา`,
    rule: `เขียว ≤ +${HEALTH.cogsDriftPoints.green} จุด · เหลือง +${HEALTH.cogsDriftPoints.green} ถึง +${HEALTH.cogsDriftPoints.yellow} · แดง > +${HEALTH.cogsDriftPoints.yellow}`,
    source: 'ต้นทุนขาย (บัญชีหมวด COGS) ÷ รายได้',
    action: 'ดูราคาซื้อวัตถุดิบหลัก 7 วันล่าสุด และของเสียจากการปรับสต็อก',
    link: '/accounting/phopy-board?chapter=4',
  }

  // 4. forecast7 ("เงินคาดการณ์อีก 7 วัน")
  const rev28RawStart = addDaysStr(asOf, -(HEALTH.salesAvgLookbackDays - 1))
  const rev28Start = dataSince ? (rev28RawStart > dataSince ? rev28RawStart : dataSince) : null
  const rev28Days = rev28Start && rev28Start <= asOf ? diffDaysStr(rev28Start, asOf) + 1 : 0
  const avgDailyRev28 = rev28Days > 0 ? ledgerRevenue(tenantId, rev28Start!, asOf) / rev28Days : 0
  const apDue7 = Number((db.prepare(`
    SELECT COALESCE(SUM(balance_amount), 0) as v
    FROM purchase_invoices
    WHERE tenant_id = ?
      AND status NOT IN ('CANCELLED', 'DRAFT')
      AND COALESCE(payment_status, '') <> 'PAID'
      AND balance_amount > 0
      AND (due_date IS NULL OR due_date = '' OR date(due_date) <= ?)
  `).get(tenantId, due7Str) as { v: number }).v)
  const opex7 = getOpexSummary(tenantId, now).monthlyRecurringAvg * HEALTH.forecastHorizonDays / 30
  const forecastBaht = r2(cashAsOf + avgDailyRev28 * HEALTH.forecastHorizonDays - apDue7 - opex7)
  const forecastDays = outflow.avgPerDay > 0 ? r2(forecastBaht / outflow.avgPerDay) : null
  const forecastSignal = forecastDays !== null ? {
    id: 'forecast7' as const,
    label: 'เงินคาดการณ์อีก 7 วัน',
    status: gradeHigh(forecastDays, HEALTH.forecastDays.green, HEALTH.forecastDays.yellow),
    value: forecastBaht,
    display: fmtBaht(forecastBaht),
    compare: `พอใช้ ${Math.round(forecastDays)} วัน หลังจ่ายเจ้าหนี้ครบกำหนด ${fmtBaht(apDue7)} และรายจ่ายประจำ ${fmtBaht(opex7)}`,
    rule: `เขียว ≥ ${HEALTH.forecastDays.green} วัน · เหลือง ${HEALTH.forecastDays.yellow}–${HEALTH.forecastDays.green - 1} · แดง < ${HEALTH.forecastDays.yellow}`,
    source: 'เงินคงเหลือ + ยอดขายเฉลี่ย − ใบแจ้งหนี้ซื้อครบกำหนด − รายจ่ายประจำที่ถึงรอบ',
    action: 'เลื่อนจ่ายผู้ขายที่ยังไม่ครบกำหนด หรือเร่งเก็บลูกหนี้ที่ถึงกำหนด',
    link: '/accounting/phopy-board?chapter=2',
  } : {
    id: 'forecast7' as const,
    label: 'เงินคาดการณ์อีก 7 วัน',
    status: 'NA' as const,
    value: null,
    display: 'ไม่มีข้อมูล',
    compare: `คาดการณ์ ${fmtBaht(forecastBaht)} · ยังไม่มีฐานเงินออกเฉลี่ย`,
    rule: `เขียว ≥ ${HEALTH.forecastDays.green} วัน · เหลือง ${HEALTH.forecastDays.yellow}–${HEALTH.forecastDays.green - 1} · แดง < ${HEALTH.forecastDays.yellow}`,
    source: 'เงินคงเหลือ + ยอดขายเฉลี่ย − ใบแจ้งหนี้ซื้อครบกำหนด − รายจ่ายประจำที่ถึงรอบ',
    action: 'เลื่อนจ่ายผู้ขายที่ยังไม่ครบกำหนด หรือเร่งเก็บลูกหนี้ที่ถึงกำหนด',
    link: '/accounting/phopy-board?chapter=2',
  }

  // 5. arOverdue ("ลูกหนี้เกินกำหนด")
  const ar = arAging(tenantId, asOf)
  const arSignal = ar.total > 0 ? (() => {
    const ratio = ar.overdue / ar.total
    return {
      id: 'arOverdue' as const,
      label: 'ลูกหนี้เกินกำหนด',
      status: gradeLow(ratio, HEALTH.arOverdueRatio.green, HEALTH.arOverdueRatio.yellow, true),
      value: r2(ratio * 100),
      display: `${(ratio * 100).toFixed(1)}%`,
      compare: `${fmtBaht(ar.overdue)} จากลูกหนี้ทั้งหมด ${fmtBaht(ar.total)}`,
      rule: `เขียว < ${Math.round(HEALTH.arOverdueRatio.green * 100)}% · เหลือง ${Math.round(HEALTH.arOverdueRatio.green * 100)}–${Math.round(HEALTH.arOverdueRatio.yellow * 100)}% · แดง > ${Math.round(HEALTH.arOverdueRatio.yellow * 100)}% · ไม่มีลูกหนี้ = ไม่นับ`,
      source: 'ใบแจ้งหนี้ขายที่ค้างรับ',
      action: 'ติดตามลูกหนี้ที่เกินกำหนดชำระก่อนให้เครดิตเพิ่ม',
      link: '/accounting/phopy-board?chapter=2',
    }
  })() : {
    id: 'arOverdue' as const,
    label: 'ลูกหนี้เกินกำหนด',
    status: 'NA' as const,
    value: null,
    display: 'ไม่มีข้อมูล',
    compare: 'ไม่มีลูกหนี้คงค้าง',
    rule: `เขียว < ${Math.round(HEALTH.arOverdueRatio.green * 100)}% · เหลือง ${Math.round(HEALTH.arOverdueRatio.green * 100)}–${Math.round(HEALTH.arOverdueRatio.yellow * 100)}% · แดง > ${Math.round(HEALTH.arOverdueRatio.yellow * 100)}% · ไม่มีลูกหนี้ = ไม่นับ`,
    source: 'ใบแจ้งหนี้ขายที่ค้างรับ',
    action: 'ติดตามลูกหนี้ที่เกินกำหนดชำระก่อนให้เครดิตเพิ่ม',
    link: '/accounting/phopy-board?chapter=2',
  }

  // 6. control ("การควบคุม")
  const currentMonth = today.slice(0, 7)
  const prevMonth = previousPeriod(currentMonth)
  const curCheck = closeChecklist(tenantId, currentMonth)
  const dailyItems = curCheck.items.filter(i => i.daily)
  const failedDaily = dailyItems.filter(i => i.status !== 'pass' && i.status !== 'na')
  const item1Or6Block = dailyItems.some(i => (i.id === 1 || i.id === 6) && i.status === 'block')

  const drawerDiff = r2((db.prepare(`
    SELECT COALESCE(SUM(ABS(cash_difference)), 0) as v
    FROM pos_shifts
    WHERE tenant_id = ? AND status = 'CLOSED' AND date(closed_at, '+7 hours') = ?
  `).get(tenantId, asOf) as { v: number }).v)

  const [prevY, prevM] = prevMonth.split('-').map(Number)
  const dayOfMonth = Number(today.slice(8, 10))
  const prevTaxRow = db.prepare(`
    SELECT status FROM tax_periods
    WHERE tenant_id = ? AND year = ? AND month = ?
    ORDER BY CASE WHEN period_type = 'MONTHLY' THEN 0 ELSE 1 END LIMIT 1
  `).get(tenantId, prevY, prevM) as { status: string } | undefined
  const prevMonthLate = dayOfMonth > 15 && prevTaxRow?.status !== 'CLOSED'

  const controlIssues: string[] = []
  if (drawerDiff > HEALTH.drawerDiffBaht.green) controlIssues.push(`เงินลิ้นชักต่าง ${fmtBaht(drawerDiff)}`)
  for (const it of failedDaily) controlIssues.push(it.title || it.detail || `ด่านข้อ ${it.id}`)
  if (prevMonthLate) controlIssues.push(`งวด ${prevMonth} ยังไม่ปิด`)

  const controlStatus: 'G' | 'Y' | 'R' =
    (drawerDiff > HEALTH.drawerDiffBaht.red || item1Or6Block) ? 'R'
      : (drawerDiff <= HEALTH.drawerDiffBaht.green && failedDaily.length === 0 && !prevMonthLate) ? 'G'
      : 'Y'

  const controlSignal = {
    id: 'control' as const,
    label: 'การควบคุม',
    status: controlStatus,
    value: controlIssues.length,
    display: `${controlIssues.length} เรื่อง`,
    compare: controlIssues.length > 0 ? controlIssues.join(' · ') : `เงินลิ้นชักต่าง ${fmtBaht(drawerDiff)} · ไม่พบรายการค้าง`,
    rule: `เขียว: ขาด/เกิน ≤ ฿${HEALTH.drawerDiffBaht.green} และไม่มีรายการค้าง · แดง: ขาด/เกิน > ฿${HEALTH.drawerDiffBaht.red} หรือด่าน 1/6 บล็อก`,
    source: 'ปิดกะเมื่อวาน · สมุดรายวัน · ด่านตรวจปิดงวด',
    action: 'ตรวจรายการค้างในสมุดรายวันและปิดงวดบัญชีที่ครบกำหนด',
    link: '/accounting/period-closing',
  }

  const signals = [runwaySignal, salesSignal, cogsSignal, forecastSignal, arSignal, controlSignal]

  const red = signals.filter(s => s.status === 'R').length
  const yellow = signals.filter(s => s.status === 'Y').length
  const na = signals.filter(s => s.status === 'NA').length
  const overallStatus: 'G' | 'Y' | 'R' = red > 0 ? 'R' : yellow > 0 ? 'Y' : 'G'
  const overallHeadline = overallStatus === 'R'
    ? `แดง · ต้องสั่งการ ${red} เรื่อง`
    : overallStatus === 'Y'
      ? `เหลือง · ไปต่อได้ เฝ้าดู ${red + yellow} เรื่อง`
      : 'เขียว · ไปต่อได้'

  const prevCheck = closeChecklist(tenantId, prevMonth)
  const confidence = {
    period: prevCheck.period,
    label: prevCheck.label,
    passed: prevCheck.passed,
    total: prevCheck.total,
    blocks: prevCheck.blocks,
  }

  const chartFrom = addDaysStr(weekKey(today), -51 * 7)
  const trend = trendSeries(tenantId, 'week', chartFrom, today, 12)
  const chart = {
    grain: 'week' as const,
    ma: trend.ma,
    warmup: trend.warmup,
    periods: trend.periods,
  }

  return {
    financial: true,
    asOf,
    today,
    dataSince,
    dataDays,
    overall: { status: overallStatus, headline: overallHeadline, red, yellow, na },
    confidence,
    signals,
    chart,
    ops,
  }
}

// GET /dashboard/health — ชีพจรเช้านี้ (6 สัญญาณ + กราฟแท่งเทียนรายสัปดาห์ + แถบงานปฏิบัติการ)
router.get('/health', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const financial = isFinancialAllowed(req.user)
    res.json({ success: true, data: getDashboardHealth(tenantId, financial) })
  } catch (error) {
    console.error('Dashboard health error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถโหลดข้อมูลสุขภาพธุรกิจได้ กรุณาลองใหม่อีกครั้ง' })
  }
})

// Get low stock items
router.get('/low-stock', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const items = getLowStockItems(tenantId)

    // total = จำนวนจริงทั้งหมด (เดิมการ์ดโชว์ length ของรายการที่ตัดเหลือ 8 → ขึ้น "8 รายการ" ตลอดทั้งที่ขาด 363)
    res.json({ success: true, data: items.slice(0, 8), total: items.length })
  } catch (error) {
    console.error('Dashboard low-stock error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch low stock' })
  }
})

// Revenue & Gross Profit comparison by period
router.get('/revenue', async (req: Request, res: Response) => {
  try {
    if (!isFinancialAllowed(req.user)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึงข้อมูลการเงินของระบบ' })
    }
    const tenantId = req.user!.tenantId
    const period = (req.query.period as string) || 'month'

    const cur = getRange(period, 0)
    const prev = getRange(period, 1)

    // รายได้/ต้นทุนขาย: ledger-based (getLedgerTotals) — เดียวกับ /reports/profit-loss
    // เป๊ะ แก้บั๊ก B1 (ต้นทุนขายเดิมเอายอด PO ที่รับของมาใช้ผิด) และ B2 (ไม่นับ POS)
    // ไปพร้อมกัน เพราะ ledger รวมทั้งใบแจ้งหนี้และ POS ที่ผ่านบัญชีจริงอยู่แล้ว
    const curTotals  = getLedgerTotals(tenantId, cur.start, cur.end)
    const prevTotals = getLedgerTotals(tenantId, prev.start, prev.end)
    const curRev = curTotals.revenue, prevRev = prevTotals.revenue
    const curCost = curTotals.cogs, prevCost = prevTotals.cogs

    const revenueChange = prevRev > 0 ? ((curRev - prevRev) / prevRev) * 100 : null
    const curGross = curRev - curCost
    const prevGross = prevRev - prevCost
    const grossChange = prevGross > 0 ? ((curGross - prevGross) / prevGross) * 100 : null

    res.json({
      success: true,
      data: {
        period,
        current: { revenue: curRev, grossProfit: curGross, cost: curCost },
        previous: { revenue: prevRev, grossProfit: prevGross, cost: prevCost },
        revenueChangePercent: revenueChange,
        grossChangePercent: grossChange,
        grossMargin: curRev > 0 ? (curGross / curRev) * 100 : 0,
      }
    })
  } catch (error) {
    console.error('Dashboard revenue error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch revenue' })
  }
})

// รายจ่ายประจำ เดือนนี้ vs เดือนก่อน + กำไรหลังหักรายจ่าย
router.get('/opex', async (req: Request, res: Response) => {
  try {
    if (!isFinancialAllowed(req.user)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึงข้อมูลการเงินของระบบ' })
    }
    res.json({ success: true, data: getOpexSummary(req.user!.tenantId) })
  } catch (error) {
    console.error('Dashboard opex error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch operating expenses' })
  }
})

// Cash flow forecast — AR and AP grouped by due date
router.get('/cashflow-forecast', async (req: Request, res: Response) => {
  try {
    if (!isFinancialAllowed(req.user)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึงข้อมูลการเงินของระบบ' })
    }
    const tenantId = req.user!.tenantId

    const now = thaiNow()
    const todayStr = ymd(now)
    const week7  = new Date(now); week7.setDate(now.getDate() + 7)
    const month30 = new Date(now); month30.setDate(now.getDate() + 30)
    const week7Str  = ymd(week7)
    const month30Str = ymd(month30)

    // AR: unpaid invoices
    const arRows = db.prepare(`
      SELECT i.id, i.invoice_number as doc_number,
        i.due_date, i.balance_amount as amount,
        c.name as party_name
      FROM invoices i JOIN customers c ON i.customer_id = c.id
      WHERE c.tenant_id = ?
        AND i.tenant_id = ?
        AND i.payment_status NOT IN ('PAID')
        AND i.status NOT IN ('CANCELLED','DRAFT')
        AND i.balance_amount > 0
      ORDER BY i.due_date ASC
    `).all(tenantId, tenantId) as any[]

    // AP: หนี้การค้าจริงจาก purchase_invoices ที่ยังค้างจ่าย
    // (เดิมใช้ purchase_orders ซึ่งเป็นแค่ใบสั่งซื้อ ยังไม่ใช่ภาระหนี้ และนับยอดเต็มใบ
    //  ทั้งที่รับของ/จ่ายบางส่วนไปแล้ว ทำให้ AP สูงเกินจริง)
    const apRows = db.prepare(`
      SELECT pi.id, pi.pi_number as doc_number,
        pi.due_date, pi.balance_amount as amount,
        s.name as party_name
      FROM purchase_invoices pi JOIN suppliers s ON pi.supplier_id = s.id AND s.tenant_id = pi.tenant_id
      WHERE pi.tenant_id = ?
        AND pi.status NOT IN ('CANCELLED','DRAFT')
        AND pi.payment_status <> 'PAID'
        AND pi.balance_amount > 0
      ORDER BY pi.due_date ASC
    `).all(tenantId) as any[]

    // เอกสารที่ไม่ได้ระบุ due_date ถือว่า "ต้องจ่าย/เก็บวันนี้" ตามนโยบายที่เจ้าของ
    // ระบบเลือกเอง (ซ่อนไว้ผู้ใช้จะลืม ต้องโชว์ขึ้นมาเลย) — แต่ต้องติด dueUnspecified=true
    // ไปกับแถวเสมอ เพื่อให้ UI แยกแยะจาก due_date ที่ตรงกับวันนี้จริงๆ ห้ามลบ flag นี้
    // ไม่งั้นจะกลายเป็นข้อมูลเท็จบนเอกสารการเงิน ใช้ร่วมกันทั้ง AR/AP เพราะ classify()
    // เป็นฟังก์ชันร่วม (ดูสั่งงานแก้บั๊ก 2026-09-09: หนี้ due_date ว่างหายจากทุกแท็บ)
    const classify = (rows: any[]) => {
      const groups: Record<string, any[]> = { overdue: [], today: [], week: [], month: [], later: [] }
      let total = 0
      for (const r of rows) {
        const due = r.due_date ? r.due_date.slice(0, 10) : null
        total += r.amount || 0
        if (!due)               { groups.today.push({ ...r, dueUnspecified: true }); continue }
        if (due < todayStr)     { groups.overdue.push(r) }
        else if (due === todayStr) { groups.today.push(r) }
        else if (due <= week7Str)  { groups.week.push(r) }
        else if (due <= month30Str){ groups.month.push(r) }
        else                       { groups.later.push(r) }
      }
      const sum = (arr: any[]) => arr.reduce((s, r) => s + (r.amount||0), 0)
      // later = ครบกำหนดเกิน 30 วันข้างหน้าจริง (ไม่ใช่ due_date ว่างอีกต่อไป) —
      // total ยังนับรวมทุกกลุ่มเหมือนเดิม ดังนั้น total ต้อง = ผลบวกทุกแท็บที่ UI แสดง
      // (overdue+today+week+month+later) เสมอ มิฉะนั้นยอดหัวมุมจะไม่ตรงกับที่ผู้ใช้กดดูทีละแท็บ
      return {
        ...groups,
        total,
        weekTotal: sum(groups.overdue)+sum(groups.today)+sum(groups.week),
        monthTotal: sum(groups.overdue)+sum(groups.today)+sum(groups.week)+sum(groups.month),
        laterTotal: sum(groups.later),
      }
    }

    const ar = classify(arRows)
    const ap = classify(apRows)

    // AP นับแค่หนี้ที่ลงบิลแล้ว ไม่มีค่าเช่า/น้ำไฟ/เงินเดือนงวดหน้าที่ยังไม่เกิด —
    // ใส่ค่าเฉลี่ยรายจ่ายประจำต่อเดือนเป็นเงินออกที่คาดการณ์ (7 วัน = สัดส่วน 7/30)
    const opex = getOpexSummary(tenantId, now)
    const recurringOpex = {
      monthlyAvg: opex.monthlyRecurringAvg,
      week: opex.monthlyRecurringAvg * 7 / 30,
      month: opex.monthlyRecurringAvg,
      estimated: !opex.hasEnoughHistory,
    }

    res.json({
      success: true,
      data: {
        ar,
        ap,
        recurringOpex,
        netCashflow: {
          week: ar.weekTotal - ap.weekTotal - recurringOpex.week,
          month: ar.monthTotal - ap.monthTotal - recurringOpex.month,
        }
      }
    })
  } catch (error) {
    console.error('Dashboard cashflow error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch cashflow forecast' })
  }
})

// Sales funnel: QT → SO → INV pipeline
router.get('/funnel', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const qt = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount),0) as value
      FROM quotations WHERE tenant_id = ? AND status NOT IN ('CANCELLED','REJECTED')
    `).get(tenantId) as any

    const so = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount),0) as value
      FROM sales_orders WHERE tenant_id = ? AND status NOT IN ('CANCELLED')
    `).get(tenantId) as any

    const inv = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount),0) as value
      FROM invoices WHERE tenant_id = ? AND status NOT IN ('CANCELLED')
    `).get(tenantId) as any

    const pending = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount),0) as value
      FROM sales_orders WHERE tenant_id = ? AND status IN ('CONFIRMED','PROCESSING','READY','PARTIAL')
    `).get(tenantId) as any

    res.json({
      success: true,
      data: {
        quotations:      { count: qt.count,      value: qt.value },
        salesOrders:     { count: so.count,      value: so.value },
        invoices:        { count: inv.count,      value: inv.value },
        pendingDelivery: { count: pending.count,  value: pending.value },
      }
    })
  } catch (error) {
    console.error('Dashboard funnel error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch funnel' })
  }
})

// Top 5 customers by revenue
router.get('/top-customers', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const period = (req.query.period as string) || 'month'

    const range = getRange(period, 0)

    // รวมบิล POS ที่ผูกสมาชิก CRM ด้วย — เดิมนับแต่ใบแจ้งหนี้ ลูกค้าหน้าร้านจึงไม่เคยติดอันดับ
    // (POS ไม่สร้างแถวใน invoices จึงไม่นับซ้ำ) ยอดทั้งสองฝั่งรวม VAT เหมือนกัน
    const rows = db.prepare(`
      SELECT c.id, c.name, COUNT(*) as invoice_count, COALESCE(SUM(s.amount), 0) as revenue
      FROM (
        SELECT customer_id, total_amount as amount FROM invoices
        WHERE tenant_id = ? AND status NOT IN ('CANCELLED','DRAFT')
          AND date(invoice_date) >= ? AND date(invoice_date) <= ?
        UNION ALL
        SELECT customer_id, total_amount FROM pos_running_bills
        WHERE tenant_id = ? AND status = 'PAID' AND customer_id IS NOT NULL
          AND date(closed_at, '+7 hours') >= ? AND date(closed_at, '+7 hours') <= ?
      ) s JOIN customers c ON s.customer_id = c.id AND c.tenant_id = ?
      GROUP BY c.id ORDER BY revenue DESC LIMIT 5
    `).all(tenantId, range.start, range.end, tenantId, range.start, range.end, tenantId)

    res.json({ success: true, data: rows })
  } catch (error) {
    console.error('Dashboard top-customers error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch top customers' })
  }
})

// ใบเสนอราคาที่ถือว่า "แพ้" แล้ว — ไม่นับรวมในไปป์ไลน์ที่ยังเปิดอยู่
const LOST_QUOTATION_STATUSES = new Set(['REJECTED', 'EXPIRED', 'CANCELLED'])
const PIPELINE_MONTHS = 6

// GET /dashboard/pipeline — ไปป์ไลน์การขายที่เดินตามสายเอกสารจริง
//
// ต่างจาก /funnel เดิมที่นับ QT / SO / INV แยกกันคนละ query แล้วเอามาวางซ้อนกัน
// เป็นรูปกรวย ทั้งที่ไม่ได้ผูกกันจริง endpoint นี้ไล่ตาม quotation_id จริง
// จึงบอกได้ว่าใบเสนอราคาใบไหนกลายเป็นออเดอร์ และมี SO เท่าไรที่ข้ามใบเสนอราคาไปเลย
router.get('/pipeline', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const quotations = db.prepare(`
      SELECT q.id, q.status, q.total_amount,
        EXISTS(SELECT 1 FROM sales_orders so WHERE so.quotation_id = q.id AND so.tenant_id = ? AND so.status NOT IN ('CANCELLED')) AS has_so
      FROM quotations q WHERE q.tenant_id = ? AND q.status <> 'DRAFT'
    `).all(tenantId, tenantId) as any[]

    const stages = {
      quoting:  { count: 0, value: 0 }, // ยื่นไปแล้ว ยังไม่รู้ผล
      awaiting: { count: 0, value: 0 }, // ลูกค้าตอบรับแล้ว แต่ยังไม่เปิดออเดอร์
      won:      { count: 0, value: 0 }, // มีใบสั่งขายผูกแล้ว
      lost:     { count: 0, value: 0 }, // ปฏิเสธ / หมดอายุ
    }

    for (const q of quotations) {
      const key = q.has_so
        ? 'won'
        : LOST_QUOTATION_STATUSES.has(q.status)
          ? 'lost'
          : q.status === 'ACCEPTED'
            ? 'awaiting'
            : 'quoting'
      stages[key as keyof typeof stages].count += 1
      stages[key as keyof typeof stages].value += q.total_amount || 0
    }

    const decided = stages.won.count + stages.lost.count
    const winRate = decided > 0 ? (stages.won.count / decided) * 100 : null

    // ออเดอร์ที่เปิดตรงโดยไม่ผ่านใบเสนอราคา ทำให้ไปป์ไลน์อ่านต่ำกว่าความจริง
    // จึงรายงานออกมาตรง ๆ แทนที่จะซ่อนไว้
    const linkage = db.prepare(`
      SELECT COUNT(*) AS soTotal,
        COALESCE(SUM(CASE WHEN quotation_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS soFromQuotation
      FROM sales_orders WHERE tenant_id = ? AND status <> 'CANCELLED'
    `).get(tenantId) as any

    // เงินไหลถึงไหนแล้ว: รับออเดอร์ → วางบิล → เก็บเงินได้จริง
    const ordered = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) AS value
      FROM sales_orders WHERE tenant_id = ? AND status NOT IN ('CANCELLED','DRAFT')
    `).get(tenantId) as any

    const billing = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) AS invoiced,
             COALESCE(SUM(paid_amount), 0) AS collected,
             COALESCE(SUM(balance_amount), 0) AS outstanding
      FROM invoices WHERE tenant_id = ? AND status NOT IN ('CANCELLED','DRAFT')
    `).get(tenantId) as any

    const orderedByMonth = db.prepare(`
      SELECT substr(order_date, 1, 7) AS month, COALESCE(SUM(total_amount), 0) AS value
      FROM sales_orders
      WHERE tenant_id = ? AND status NOT IN ('CANCELLED','DRAFT') AND order_date IS NOT NULL
      GROUP BY month
    `).all(tenantId) as any[]

    const invoicedByMonth = db.prepare(`
      SELECT substr(invoice_date, 1, 7) AS month, COALESCE(SUM(total_amount), 0) AS value
      FROM invoices
      WHERE tenant_id = ? AND status NOT IN ('CANCELLED','DRAFT') AND invoice_date IS NOT NULL
      GROUP BY month
    `).all(tenantId) as any[]

    const orderedMap = new Map(orderedByMonth.map(r => [r.month, r.value]))
    const invoicedMap = new Map(invoicedByMonth.map(r => [r.month, r.value]))

    const anchor = thaiNow()
    anchor.setDate(1)
    const monthly: any[] = []
    for (let back = PIPELINE_MONTHS - 1; back >= 0; back--) {
      const cursor = new Date(anchor)
      cursor.setMonth(anchor.getMonth() - back)
      const month = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
      monthly.push({
        month,
        ordered: orderedMap.get(month) || 0,
        invoiced: invoicedMap.get(month) || 0,
      })
    }

    const soTotal = linkage.soTotal || 0
    const soFromQuotation = linkage.soFromQuotation || 0

    res.json({
      success: true,
      data: {
        stages,
        winRate,
        openPipelineValue: stages.quoting.value + stages.awaiting.value,
        linkage: {
          soTotal,
          soFromQuotation,
          soDirect: soTotal - soFromQuotation,
          linkedPercent: soTotal > 0 ? (soFromQuotation / soTotal) * 100 : 0,
        },
        waterfall: {
          ordered: ordered.value || 0,
          invoiced: billing.invoiced || 0,
          collected: billing.collected || 0,
          outstanding: billing.outstanding || 0,
        },
        monthly,
      },
    })
  } catch (error) {
    console.error('Dashboard pipeline error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch pipeline' })
  }
})

// Recent sales orders
router.get('/recent-orders', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const rawLimit = Number(req.query.limit)
    const limit = (!isNaN(rawLimit) && rawLimit > 0) ? Math.min(rawLimit, 50) : 5

    const rows = db.prepare(`
      SELECT so.id, so.so_number, so.order_date, so.delivery_date,
             so.total_amount, so.status, so.payment_status,
             c.id as customer_id, c.name as customer_name
      FROM sales_orders so
      LEFT JOIN customers c ON so.customer_id = c.id AND c.tenant_id = ?
      WHERE so.tenant_id = ?
      ORDER BY so.created_at DESC, so.order_date DESC
      LIMIT ?
    `).all(tenantId, tenantId, limit)

    res.json({ success: true, data: rows })
  } catch (error) {
    console.error('Dashboard recent-orders error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch recent orders' })
  }
})

// Production / Work Order status summary
router.get('/production', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const rows = db.prepare(`
      SELECT 
        status,
        COUNT(*) as count,
        COALESCE(SUM(quantity), 0) as total_qty,
        COALESCE(SUM(completed_qty), 0) as completed_qty
      FROM work_orders
      WHERE tenant_id = ?
      GROUP BY status
    `).all(tenantId) as any[]

    const summary: Record<string, number> = {
      draft: 0,
      planned: 0,
      inProgress: 0,
      completed: 0,
      cancelled: 0,
      total: 0,
    }

    let totalQuantity = 0
    let totalCompletedQuantity = 0

    for (const r of rows) {
      const c = Number(r.count) || 0
      summary.total += c
      totalQuantity += Number(r.total_qty) || 0
      totalCompletedQuantity += Number(r.completed_qty) || 0
      if (r.status === 'DRAFT') summary.draft = c
      else if (r.status === 'PLANNED') summary.planned = c
      else if (r.status === 'IN_PROGRESS') summary.inProgress = c
      else if (r.status === 'COMPLETED') summary.completed = c
      else if (r.status === 'CANCELLED') summary.cancelled = c
    }

    res.json({
      success: true,
      data: {
        ...summary,
        totalQuantity,
        totalCompletedQuantity,
        byStatus: rows
      }
    })
  } catch (error) {
    console.error('Dashboard production summary error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch production summary' })
  }
})

export default router
