import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { HEALTH } from '../config/thresholds'
import { closeChecklist } from '../services/closeChecklist.service'
import { previousPeriod } from '../services/monthClose.service'
import { totalStockValue } from '../services/stockValue.service'
import {
  NON_CLOSING, THAI_DATE, r2, thaiToday, monthRange,
  addDaysStr, diffDaysStr, firstPostedDate, cashBalanceAt, cashOutflow,
  ledgerRevenue, ledgerCogs, ledgerOpex, ledgerLabour, accountBalances,
  businessUnitPL, cogsAnalysis, apAging, arAging, posSales, cashDrawer, AgingResult,
  trendSeries, TrendGrain,
} from '../services/phopyBoard.service'

const router = Router()
router.use(authenticate)

function daysBetween(dateStr: string): number {
  return Math.floor((Date.parse(thaiToday()) - Date.parse(String(dateStr).substring(0, 10))) / 86400000)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** ช่วงวันที่จาก query — ไม่ส่งมา = ต้นปีถึงวันนี้ (เวลาไทย) ; รูปแบบผิด = null */
function parsePeriod(req: Request): { startDate: string; endDate: string } | null {
  const today = thaiToday()
  const startDate = (req.query.startDate as string) || `${today.substring(0, 4)}-01-01`
  const endDate = (req.query.endDate as string) || today
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate) || startDate > endDate) return null
  return { startDate, endDate }
}

/** 12 เดือนล่าสุดถึงเดือนปัจจุบัน (เวลาไทย) */
function last12Months(): Array<{ start: string; end: string; label: string }> {
  const t = thaiToday()
  const y = Number(t.substring(0, 4)), m = Number(t.substring(5, 7)) - 1
  return Array.from({ length: 12 }, (_, i) => monthRange(y, m - 11 + i))
}

/** เดือนที่อยู่ในช่วงที่เลือก (ตัดหัวท้ายให้อยู่ในช่วง) */
function monthsInPeriod(start: string, end: string): Array<{ start: string; end: string; label: string }> {
  const out: Array<{ start: string; end: string; label: string }> = []
  let y = Number(start.substring(0, 4)), m = Number(start.substring(5, 7)) - 1
  for (;;) {
    const mr = monthRange(y, m)
    if (mr.start > end) break
    out.push({ ...mr, start: mr.start < start ? start : mr.start, end: mr.end > end ? end : mr.end })
    m++
  }
  return out
}

function agingTotal(a: AgingResult['buckets']) { return a.current + a.days30 + a.days60 + a.days90 + a.over90 }

router.get('/summary', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const period = parsePeriod(req)
    if (!period) return res.status(400).json({ success: false, message: 'startDate/endDate ต้องเป็น YYYY-MM-DD และ startDate ≤ endDate' })
    const { startDate, endDate } = period
    const today = thaiToday()

    // Previous period (same duration)
    const durationMs = Date.parse(endDate) - Date.parse(startDate)
    const prevEnd = new Date(Date.parse(startDate) - 86400000).toISOString().substring(0, 10)
    const prevStart = new Date(Date.parse(startDate) - durationMs - 86400000).toISOString().substring(0, 10)

    // ── KPIs (ledger-based: revenue = REVENUE accounts, cost = real COGS) ──────
    const revenue = ledgerRevenue(tenantId, startDate, endDate)
    const cost = ledgerCogs(tenantId, startDate, endDate)
    const opex = ledgerOpex(tenantId, startDate, endDate)
    const prevRevenue = ledgerRevenue(tenantId, prevStart, prevEnd)
    const prevCost = ledgerCogs(tenantId, prevStart, prevEnd)
    const labour = ledgerLabour(tenantId, startDate, endDate)

    const grossProfit = revenue - cost
    const prevGrossProfit = prevRevenue - prevCost
    const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0
    const netProfit = revenue - cost - opex

    const businessUnits = businessUnitPL(tenantId, startDate, endDate)

    // ── 12-month revenue chart ────────────────────────────────────────────────
    const revenueChart = last12Months().map(mr => {
      const r = ledgerRevenue(tenantId, mr.start, mr.end)
      const c = ledgerCogs(tenantId, mr.start, mr.end)
      return { month: mr.label, revenue: r, cost: c, grossProfit: r - c }
    })

    // ── P&L table (by month in selected period) — เงินเดือน/ค่าแรงแยกบรรทัด ────
    const plTable = monthsInPeriod(startDate, endDate).map(mr => {
      const rev = ledgerRevenue(tenantId, mr.start, mr.end)
      const cogs = ledgerCogs(tenantId, mr.start, mr.end)
      const ox = ledgerOpex(tenantId, mr.start, mr.end)
      const lab = ledgerLabour(tenantId, mr.start, mr.end)
      const gp = rev - cogs
      return {
        month: mr.label, revenue: rev, cogs, grossProfit: gp,
        labour: lab.total, otherOpex: r2(ox - lab.total), netProfit: r2(gp - ox),
        margin: rev > 0 ? (gp / rev) * 100 : 0,
      }
    })

    // ── AR / AP Aging — จากเอกสารค้างชำระจริง + ยอดบัญชีคุมไว้เทียบ ───────────
    const ar = arAging(tenantId, today)
    const ap = apAging(tenantId, today)
    const bal = accountBalances(tenantId, today, ['1104', '1105', '1180', '1182', '2101', '2102', '2109'])
    const arDetail = { ...ar, ledger: { tradeAR: bal['1104'], otherAR: bal['1105'], posClearing: bal['1180'], posPayoutPending: bal['1182'] } }
    const apDetail = { ...ap, ledger: { tradeAP: bal['2101'], otherAP: bal['2102'], grni: bal['2109'] } }

    // ── Customer Intelligence (ใบสั่งขาย sales_orders — ตาราง orders เป็นของเก่าไม่มีใครเขียนแล้ว) ──
    const custRows = db.prepare(`
      SELECT c.id, c.name, c.credit_limit,
        COALESCE(SUM(CASE WHEN date(so.order_date) BETWEEN ? AND ? THEN so.total_amount ELSE 0 END), 0) as curr_rev,
        COALESCE(SUM(CASE WHEN date(so.order_date) BETWEEN ? AND ? THEN so.total_amount ELSE 0 END), 0) as prev_rev,
        MAX(so.order_date) as last_order,
        (SELECT COALESCE(SUM(i.balance_amount), 0) FROM invoices i
          WHERE i.tenant_id = c.tenant_id AND i.customer_id = c.id AND i.status NOT IN ('CANCELLED', 'DRAFT')) as credit_used
      FROM customers c
      LEFT JOIN sales_orders so ON so.customer_id = c.id AND so.tenant_id = c.tenant_id AND so.status NOT IN ('CANCELLED', 'DRAFT')
      WHERE c.status = 'ACTIVE' AND c.tenant_id = ?
      GROUP BY c.id, c.name, c.credit_limit
      HAVING curr_rev > 0 OR prev_rev > 0
      ORDER BY curr_rev DESC
      LIMIT 20
    `).all(startDate, endDate, prevStart, prevEnd, tenantId) as Array<{
      id: string; name: string; credit_limit: number
      curr_rev: number; prev_rev: number; last_order: string | null; credit_used: number
    }>

    const customers = custRows.map(c => {
      const curr = Number(c.curr_rev)
      const prev = Number(c.prev_rev)
      const lastOrderDays = c.last_order ? daysBetween(c.last_order) : 999
      const trend = curr > prev * 1.05 ? 'up' : curr < prev * 0.95 ? 'down' : 'stable'

      // RFM tier based on recency + revenue
      let tier: string
      if (lastOrderDays <= 30 && curr >= revenue * 0.1) tier = 'Champion'
      else if (lastOrderDays <= 60 && curr > 0) tier = 'Loyal'
      else if (lastOrderDays <= 90) tier = 'At-Risk'
      else tier = 'Lost'

      return { id: c.id, name: c.name, currentRevenue: curr, prevRevenue: prev, trend, tier, lastOrderDays, creditLimit: Number(c.credit_limit), creditUsed: r2(c.credit_used) }
    })

    // ── Stock Alerts ──────────────────────────────────────────────────────────
    const stockAlerts = (db.prepare(`
      SELECT id, name, quantity, min_stock, unit FROM stock_items
      WHERE quantity <= min_stock AND status = 'ACTIVE' AND tenant_id = ?
      ORDER BY (quantity * 1.0 / CASE WHEN min_stock=0 THEN 1 ELSE min_stock END) ASC
      LIMIT 10
    `).all(tenantId) as Array<{ id: string; name: string; quantity: number; min_stock: number; unit: string }>).map(s => ({
      id: s.id, name: s.name, quantity: s.quantity, minStock: s.min_stock, unit: s.unit,
      daysRemaining: s.quantity <= 0 ? 0 : Math.floor(s.quantity / Math.max(s.min_stock / 30, 1))
    }))

    // ── Work Orders ───────────────────────────────────────────────────────────
    const woRows = db.prepare(`
      SELECT status,
        COUNT(*) as cnt,
        COALESCE(SUM(estimated_cost), 0) as est,
        COALESCE(SUM(actual_cost), 0) as act
      FROM work_orders
      WHERE date(created_at) BETWEEN ? AND ? AND tenant_id = ?
      GROUP BY status
    `).all(startDate, endDate, tenantId) as Array<{ status: string; cnt: number; est: number; act: number }>

    const workOrders = { draft: 0, planned: 0, inProgress: 0, completed: 0, cancelled: 0, costVariance: 0 }
    let totalEst = 0, totalAct = 0
    for (const w of woRows) {
      const cnt = Number(w.cnt)
      if (w.status === 'DRAFT') workOrders.draft = cnt
      else if (w.status === 'PLANNED') workOrders.planned = cnt
      else if (w.status === 'IN_PROGRESS') workOrders.inProgress = cnt
      else if (w.status === 'COMPLETED') workOrders.completed = cnt
      else if (w.status === 'CANCELLED') workOrders.cancelled = cnt
      totalEst += Number(w.est)
      totalAct += Number(w.act)
    }
    workOrders.costVariance = totalEst > 0 ? ((totalAct - totalEst) / totalEst) * 100 : 0

    // ── Early Warning Signals ─────────────────────────────────────────────────
    const revGrowth = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : 0
    const prevMarginPct = prevRevenue > 0 ? (prevGrossProfit / prevRevenue) * 100 : 0
    const marginDiff = grossMarginPct - prevMarginPct
    const arTotal = agingTotal(ar.buckets)
    const arOver90Pct = arTotal > 0 ? (ar.buckets.over90 / arTotal) * 100 : 0

    // Supplier concentration — ใบแจ้งหนี้ซื้อในงวดที่เลือก (ช่วงเดียวกับรายได้) ไม่ใช่ PO ทั้งหมดตลอดกาล
    const supplierRows = db.prepare(`
      SELECT pi.supplier_id, COALESCE(s.name, '-') as name, COALESCE(SUM(pi.total_amount), 0) as total
      FROM purchase_invoices pi LEFT JOIN suppliers s ON s.id = pi.supplier_id
      WHERE pi.tenant_id = ? AND pi.status NOT IN ('CANCELLED', 'DRAFT') AND date(pi.invoice_date) BETWEEN ? AND ?
      GROUP BY pi.supplier_id ORDER BY total DESC
    `).all(tenantId, startDate, endDate) as Array<{ supplier_id: string; name: string; total: number }>
    const totalPurchases = supplierRows.reduce((s, r) => s + Number(r.total), 0)
    const topSupplier = supplierRows[0]
    const supplierConcPct = totalPurchases > 0 && topSupplier ? (Number(topSupplier.total) / totalPurchases) * 100 : 0

    // Top 3 customer churn risk
    const top3Days = customers.slice(0, 3).map(c => c.lastOrderDays)
    const churnRisk = top3Days.some(d => d > 30)

    const earlyWarnings = [
      {
        id: 'revenue_growth',
        label: 'Revenue Growth',
        status: revGrowth >= 5 ? 'ok' : revGrowth >= -5 ? 'warn' : 'danger',
        value: revGrowth.toFixed(1) + '%',
        detail: prevRevenue > 0 ? `vs ${prevStart} – ${prevEnd}` : 'งวดก่อนไม่มีรายได้ในบัญชี',
        hint: {
          what: 'รายได้งวดนี้โตขึ้นหรือลดลงเท่าไรเทียบงวดก่อนที่ยาวเท่ากัน',
          calc: `(รายได้งวดนี้ − รายได้งวดก่อน) ÷ รายได้งวดก่อน · รายได้ = บัญชีหมวดรายได้ (4xxx) ที่ post แล้ว · งวดก่อน = ${prevStart} ถึง ${prevEnd}`,
          thresholds: 'เขียว ≥ +5% · เหลือง −5% ถึง +5% · แดง < −5% (งวดก่อนไม่มีรายได้ = แสดง 0%)',
          action: 'ดูว่าลดที่ช่องทางไหน (หน้าร้าน/ขายส่ง/ออนไลน์) จำนวนบิลลดหรือค่าเฉลี่ยต่อบิลลด แล้วแก้ตรงจุด เช่น โปรโมชัน เมนูขายดีหมด วันเปิดร้านน้อยลง',
        },
      },
      {
        id: 'margin',
        label: 'Gross Margin Trend',
        status: marginDiff >= -2 ? 'ok' : marginDiff >= -5 ? 'warn' : 'danger',
        value: grossMarginPct.toFixed(1) + '%',
        detail: `${marginDiff >= 0 ? '+' : ''}${marginDiff.toFixed(1)}% vs prev`,
        hint: {
          what: 'สัดส่วนกำไรขั้นต้นต่อรายได้ และเปลี่ยนไปเท่าไรจากงวดก่อน',
          calc: '(รายได้ − ต้นทุนขายในบัญชี) ÷ รายได้ · ต้นทุนขาย = บัญชีหมวด COGS (5101/5102) ซึ่งรวมต้นทุนตามสูตร + ปรับยอดนับสต็อก + ของซื้อใช้ตรง',
          thresholds: 'เทียบกับงวดก่อน: เขียว ลดไม่เกิน 2 จุด · เหลือง ลด 2–5 จุด · แดง ลดเกิน 5 จุด',
          action: 'ดูกล่อง "ต้นทุนขาย 2 มุม" ว่าต้นทุนเพิ่มจากสูตร (ราคาวัตถุดิบขึ้น → ปรับราคาขาย/สูตร) หรือจากของเสีย/สูญหาย (นับสต็อกบ่อยขึ้น คุมการเบิก)',
        },
      },
      {
        id: 'ar_aging',
        label: 'AR Risk (120+ days)',
        status: arOver90Pct < 10 ? 'ok' : arOver90Pct < 20 ? 'warn' : 'danger',
        value: arOver90Pct.toFixed(1) + '%',
        detail: `of ฿${Math.round(arTotal).toLocaleString('th-TH')} AR outstanding`,
        hint: {
          what: 'ลูกหนี้ที่ค้างนานเกิน 120 วัน คิดเป็นกี่ % ของลูกหนี้ค้างทั้งหมด',
          calc: 'ยอดค้าง (balance_amount) ของใบแจ้งหนี้ขายที่ยังไม่ยกเลิก แบ่งตามอายุนับจากวันที่ใบแจ้งหนี้ถึงวันนี้',
          thresholds: 'เขียว < 10% · เหลือง 10–20% · แดง ≥ 20%',
          action: 'โทรตาม/ส่งใบทวงถามลูกหนี้ที่ค้างนาน หยุดให้เครดิตเพิ่มจนกว่าจะชำระ และพิจารณาตั้งค่าเผื่อหนี้สูญ',
        },
      },
      {
        id: 'supplier_conc',
        label: 'Supplier Concentration',
        status: supplierConcPct < 30 ? 'ok' : supplierConcPct < 40 ? 'warn' : 'danger',
        value: supplierConcPct.toFixed(1) + '%',
        detail: topSupplier ? `${topSupplier.name} · ใบแจ้งหนี้ซื้อในงวด` : 'ไม่มีใบแจ้งหนี้ซื้อในงวด',
        hint: {
          what: 'ซื้อจากผู้ขายรายใหญ่สุดกี่ % ของยอดซื้อทั้งหมดในงวด — พึ่งเจ้าเดียวมากเสี่ยงของขาด/ถูกขึ้นราคา',
          calc: 'ยอดใบแจ้งหนี้ซื้อ (ไม่นับที่ยกเลิก) ของผู้ขายรายใหญ่สุด ÷ ยอดใบแจ้งหนี้ซื้อทั้งหมด ในช่วงวันที่ที่เลือก · ผู้ขายชื่อซ้ำกัน (เช่น แม็คโครหลายชื่อ) นับแยกกัน',
          thresholds: 'เขียว < 30% · เหลือง 30–40% · แดง ≥ 40%',
          action: 'หาแหล่งซื้อสำรองสำหรับวัตถุดิบหลัก เทียบราคาอย่างน้อย 2 เจ้า และรวมชื่อผู้ขายที่ซ้ำกันในทะเบียนผู้ขายให้เป็นรายเดียว',
        },
      },
      {
        id: 'churn_risk',
        label: 'Top Customer Churn',
        status: !churnRisk ? 'ok' : top3Days.some(d => d > 60) ? 'danger' : 'warn',
        value: churnRisk ? `${Math.max(...top3Days)}d` : 'OK',
        detail: customers.length > 0 ? 'days since top 3 last ordered' : 'ไม่มีลูกค้าใบสั่งขายในงวด',
        hint: {
          what: 'ลูกค้าขายส่ง 3 อันดับแรกหายไปนานแค่ไหนแล้ว (ไม่รวมลูกค้าหน้าร้าน POS)',
          calc: 'จำนวนวันจากใบสั่งขาย (sales order) ล่าสุดของลูกค้า 3 รายที่ซื้อมากที่สุดในงวด ถึงวันนี้',
          thresholds: 'เขียว ทุกรายสั่งภายใน 30 วัน · เหลือง มีรายที่เกิน 30 วัน · แดง มีรายที่เกิน 60 วัน',
          action: 'ติดต่อลูกค้าที่หายไป ถามเหตุผล (ราคา/คุณภาพ/คู่แข่ง) และเสนอโปรหรือเงื่อนไขพิเศษ',
        },
      },
      {
        id: 'stock_out',
        label: 'Stock-Out Risk',
        status: stockAlerts.length === 0 ? 'ok' : stockAlerts.length <= 3 ? 'warn' : 'danger',
        value: stockAlerts.length.toString(),
        detail: 'items at or below min stock',
        hint: {
          what: 'จำนวนวัตถุดิบ/สินค้าที่คงเหลือต่ำกว่าหรือเท่ากับจุดสั่งซื้อขั้นต่ำ (min stock)',
          calc: 'นับรายการ stock_items ที่ใช้งานอยู่และ quantity ≤ min_stock (ตามจำนวนในระบบ ณ ตอนนี้)',
          thresholds: 'เขียว 0 รายการ · เหลือง 1–3 รายการ · แดง มากกว่า 3 รายการ',
          action: 'เปิดใบขอซื้อ/ใบสั่งซื้อสำหรับรายการที่ใกล้หมด และตรวจว่าจำนวนในระบบตรงกับของจริง (นับสต็อก)',
        },
      },
    ]

    res.json({
      success: true,
      data: {
        period: { start: startDate, end: endDate },
        kpis: { revenue, cost, grossProfit, netProfit, grossMarginPct, prevRevenue, prevGrossProfit, opex, labour: labour.total },
        businessUnits,
        revenueChart,
        plTable,
        arAging: ar.buckets,
        apAging: ap.buckets,
        arDetail,
        apDetail,
        customers,
        stockAlerts,
        workOrders,
        earlyWarnings,
        cogsAnalysis: cogsAnalysis(tenantId, startDate, endDate),
        posSales: posSales(tenantId, startDate, endDate),
        cashDrawer: cashDrawer(tenantId, startDate, endDate),
        labour,
      }
    })
  } catch (err: any) {
    console.error('Phopy Board error:', err)
    res.status(500).json({ success: false, message: 'Failed to load board data' })
  }
})


router.get('/extended', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const period = parsePeriod(req)
    if (!period) return res.status(400).json({ success: false, message: 'startDate/endDate ต้องเป็น YYYY-MM-DD และ startDate ≤ endDate' })
    const { startDate, endDate } = period
    const months = last12Months()

    // ── Zone 1: Channel Performance ─────────────────────────────────────────
    const channelByPlatform = db.prepare(`
      SELECT s.platform, COALESCE(SUM(mm.sales), 0) as revenue, COALESCE(SUM(mm.orders), 0) as orders
      FROM marketing_metrics mm JOIN shops s ON mm.shop_id = s.id
      WHERE mm.tenant_id = ? AND date(mm.date) BETWEEN ? AND ?
      GROUP BY s.platform ORDER BY revenue DESC
    `).all(tenantId, startDate, endDate) as Array<{ platform: string; revenue: number; orders: number }>

    const onlineTotal = channelByPlatform.reduce((s, r) => s + Number(r.revenue), 0)
    const onlineOrders = channelByPlatform.reduce((s, r) => s + Number(r.orders), 0)

    // ขายส่ง = ใบสั่งขาย sales_orders (ตาราง orders เดิมไม่มีระบบไหนเขียนแล้ว)
    const wholesaleSql = "SELECT COALESCE(SUM(total_amount), 0) as revenue, COUNT(*) as orders FROM sales_orders WHERE tenant_id = ? AND status NOT IN ('CANCELLED', 'DRAFT') AND date(order_date) BETWEEN ? AND ?"
    const retailSql = `SELECT COALESCE(SUM(total_amount), 0) as revenue, COUNT(*) as bills FROM pos_running_bills WHERE tenant_id = ? AND status = 'PAID' AND ${THAI_DATE('COALESCE(closed_at, opened_at)')} BETWEEN ? AND ?`
    const offlineRow = db.prepare(wholesaleSql).get(tenantId, startDate, endDate) as { revenue: number; orders: number }
    const retailRow = db.prepare(retailSql).get(tenantId, startDate, endDate) as { revenue: number; bills: number }

    const orderTrend = months.map(mr => {
      const onR = db.prepare("SELECT COALESCE(SUM(orders), 0) as orders FROM marketing_metrics WHERE tenant_id = ? AND date(date) BETWEEN ? AND ?").get(tenantId, mr.start, mr.end) as { orders: number }
      const wsR = db.prepare(wholesaleSql).get(tenantId, mr.start, mr.end) as { orders: number }
      const rtR = db.prepare(retailSql).get(tenantId, mr.start, mr.end) as { bills: number }
      // offline = ขายส่ง + บิลหน้าร้าน (คงชื่อเดิมไว้ให้หน้าจอเก่า)
      return { month: mr.label.replace('/', '-'), online: Number(onR.orders), wholesale: Number(wsR.orders), retail: Number(rtR.bills), offline: Number(wsR.orders) + Number(rtR.bills) }
    })

    // ── Zone 2: Ads ROI ──────────────────────────────────────────────────────
    const adTot = db.prepare(`
      SELECT COALESCE(SUM(impressions), 0) as impressions, COALESCE(SUM(clicks), 0) as clicks,
        COALESCE(SUM(orders), 0) as orders, COALESCE(SUM(sales), 0) as revenue, COALESCE(SUM(ad_cost), 0) as adCost
      FROM marketing_metrics WHERE tenant_id = ? AND date(date) BETWEEN ? AND ?
    `).get(tenantId, startDate, endDate) as { impressions: number; clicks: number; orders: number; revenue: number; adCost: number }

    const adCost = Number(adTot.adCost), adRev = Number(adTot.revenue)
    const adClicks = Number(adTot.clicks), adImpr = Number(adTot.impressions), adOrders = Number(adTot.orders)

    const adByPlatform = db.prepare(`
      SELECT s.platform, COALESCE(SUM(mm.impressions), 0) as impressions, COALESCE(SUM(mm.clicks), 0) as clicks,
        COALESCE(SUM(mm.orders), 0) as orders, COALESCE(SUM(mm.sales), 0) as revenue, COALESCE(SUM(mm.ad_cost), 0) as adCost
      FROM marketing_metrics mm JOIN shops s ON mm.shop_id = s.id
      WHERE mm.tenant_id = ? AND date(mm.date) BETWEEN ? AND ?
      GROUP BY s.platform ORDER BY revenue DESC
    `).all(tenantId, startDate, endDate) as Array<{ platform: string; impressions: number; clicks: number; orders: number; revenue: number; adCost: number }>

    // ── Zone 3: Cost Structure ────────────────────────────────────────────────
    // ยอดซื้อตามหมวดวัตถุดิบ (PO ที่รับของแล้ว) — เป็น "ยอดซื้อ" ไม่ใช่ต้นทุนขาย ติดป้ายชัดที่หน้าจอ
    // skip_stock บรรทัด (ของไม่นับสต็อก) ลง journal เป็นค่าใช้จ่ายต่อบัญชีอยู่แล้ว ไม่นับซ้ำที่นี่
    const purchaseSql = `
      FROM purchase_order_items poi JOIN purchase_orders po ON poi.purchase_order_id = po.id
      WHERE po.tenant_id = ? AND po.status = 'RECEIVED' AND date(po.order_date) BETWEEN ? AND ?
        AND COALESCE(poi.skip_stock, 0) = 0`
    const cogsByCat = db.prepare(`
      SELECT COALESCE(mc.name, 'ไม่ระบุหมวด') as category, COALESCE(SUM(poi.total_price), 0) as amount
      FROM purchase_order_items poi JOIN purchase_orders po ON poi.purchase_order_id = po.id
      LEFT JOIN stock_items m ON poi.material_id = m.id AND m.tenant_id = poi.tenant_id
      LEFT JOIN material_categories mc ON m.category_id = mc.id
      WHERE po.tenant_id = ? AND po.status = 'RECEIVED' AND date(po.order_date) BETWEEN ? AND ?
        AND COALESCE(poi.skip_stock, 0) = 0
      GROUP BY mc.name ORDER BY amount DESC
    `).all(tenantId, startDate, endDate) as Array<{ category: string; amount: number }>

    // ค่าใช้จ่ายตามบัญชี (ไม่รวมต้นทุนขาย ซึ่งแสดงแยก) — แยกต่อบัญชี ไม่รวมตาม category
    // เพราะ category เดียวกันปนบัญชีที่ติดลบได้ (5901 เงินเกิน กับ 5902 ปรับเพิ่มสต็อก หักกันเอง)
    const expByCat = (db.prepare(`
      SELECT a.code, a.name, COALESCE(SUM(jl.debit - jl.credit), 0) as amount
      FROM journal_lines jl JOIN journal_entries je ON jl.journal_entry_id = je.id JOIN accounts a ON jl.account_id = a.id
      WHERE je.tenant_id = ? AND a.type = 'EXPENSE' AND COALESCE(a.category, '') != 'COGS' AND je.is_posted = 1
        AND date(je.date) BETWEEN ? AND ? ${NON_CLOSING}
      GROUP BY a.code, a.name HAVING ABS(amount) >= 0.01 ORDER BY amount DESC
    `).all(tenantId, startDate, endDate) as Array<{ code: string; name: string; amount: number }>)
      .map(r => ({ category: `${r.code} ${r.name}`, code: r.code, amount: r2(r.amount) }))

    const ledgerRev = ledgerRevenue(tenantId, startDate, endDate)
    const totalExp = expByCat.reduce((s, r) => s + r.amount, 0)
    // Expense ratio = OpEx ÷ รายได้ในบัญชี (เดิมหารด้วยยอด orders เก่าที่ไม่มีใครเขียนแล้ว)
    const expenseRatio = ledgerRev > 0 ? (totalExp / ledgerRev) * 100 : 0
    const ledgerCogsTotal = ledgerCogs(tenantId, startDate, endDate)

    const woVar = db.prepare(`
      SELECT COALESCE(SUM(estimated_cost), 0) as estimated, COALESCE(SUM(actual_cost), 0) as actual, COUNT(*) as count
      FROM work_orders WHERE tenant_id = ? AND status = 'COMPLETED' AND date(COALESCE(completed_date, updated_at)) BETWEEN ? AND ?
    `).get(tenantId, startDate, endDate) as { estimated: number; actual: number; count: number }

    // cogs = ต้นทุนขายในบัญชี, opex = ค่าใช้จ่ายอื่น (ไม่ทับกัน), purchases = ยอดซื้อ PO (เส้นอ้างอิง)
    const costTrend = months.map(mr => {
      const purchasesR = db.prepare(`SELECT COALESCE(SUM(poi.total_price), 0) as v ${purchaseSql}`).get(tenantId, mr.start, mr.end) as { v: number }
      return {
        month: mr.label.replace('/', '-'),
        cogs: r2(ledgerCogs(tenantId, mr.start, mr.end)),
        opex: r2(ledgerOpex(tenantId, mr.start, mr.end)),
        purchases: r2(purchasesR.v),
      }
    })

    // ── Zone 4: Product Profitability — เมนู POS + ใบสั่งขาย (ตาราง products/orders เดิมเป็นแคตตาล็อกตาย) ──
    // ponytail: ต้นทุน POS = ของที่ตัดตามสูตรจริง × ราคาทุนปัจจุบัน (ไม่ใช่ราคาทุน ณ วันขาย) ; ต้นทุน SO = issued_unit_cost × จำนวน
    // ถ้าต้องตรงบัญชีเป๊ะต้องเก็บต้นทุนต่อบรรทัดบิลตอนตัดสต็อก
    const posProducts = db.prepare(`
      SELECT 'POS:' || bi.pos_menu_id as id, MAX(bi.product_name) as name, '' as code,
        COALESCE(SUM(bi.total_price), 0) as revenue, COALESCE(SUM(bi.quantity), 0) as unitsSold,
        COUNT(DISTINCT bi.bill_id) as orderCount,
        COALESCE(SUM((SELECT SUM(d.quantity_deducted * COALESCE(si.unit_cost, 0)) FROM pos_stock_deductions d
          JOIN stock_items si ON si.id = d.stock_item_id WHERE d.bill_item_id = bi.id AND COALESCE(d.returned, 0) = 0)), 0) as cost
      FROM pos_bill_items bi JOIN pos_running_bills b ON b.id = bi.bill_id
      WHERE b.tenant_id = ? AND b.status = 'PAID' AND ${THAI_DATE('COALESCE(b.closed_at, b.opened_at)')} BETWEEN ? AND ?
      GROUP BY bi.pos_menu_id
    `).all(tenantId, startDate, endDate) as Array<{ id: string; name: string; code: string; revenue: number; unitsSold: number; orderCount: number; cost: number }>
    const soProducts = db.prepare(`
      SELECT 'SO:' || soi.product_id as id, COALESCE(MAX(si.name), soi.product_id) as name, COALESCE(MAX(si.sku), '') as code,
        COALESCE(SUM(soi.total_price), 0) as revenue, COALESCE(SUM(soi.quantity), 0) as unitsSold,
        COUNT(DISTINCT so.id) as orderCount,
        COALESCE(SUM(soi.quantity * COALESCE(soi.issued_unit_cost, si.unit_cost, 0)), 0) as cost
      FROM sales_order_items soi JOIN sales_orders so ON so.id = soi.sales_order_id
      LEFT JOIN stock_items si ON si.id = soi.product_id AND si.tenant_id = so.tenant_id
      WHERE so.tenant_id = ? AND so.status NOT IN ('CANCELLED', 'DRAFT') AND date(so.order_date) BETWEEN ? AND ?
      GROUP BY soi.product_id
    `).all(tenantId, startDate, endDate) as typeof posProducts

    const productsWithMargin = [...posProducts, ...soProducts].map(p => {
      const rev = Number(p.revenue), bomCost = r2(p.cost)
      const margin = rev > 0 ? ((rev - bomCost) / rev) * 100 : 0
      return { id: p.id, name: p.name, code: p.code, revenue: r2(rev), unitsSold: Number(p.unitsSold), orderCount: Number(p.orderCount), bomCost, margin: Math.round(margin * 10) / 10 }
    }).sort((a, b) => b.revenue - a.revenue)

    const totalProdRev = productsWithMargin.reduce((s, p) => s + p.revenue, 0)
    const top5Rev = productsWithMargin.slice(0, 5).reduce((s, p) => s + p.revenue, 0)
    const concentrationRisk = totalProdRev > 0 ? Math.round((top5Rev / totalProdRev) * 1000) / 10 : 0

    // ── Zone 5: Working Capital ──────────────────────────────────────────────
    // หมุนเวียน = 11xx / 21xx เท่านั้น (เดิมใช้ 1%/2% ปนสินทรัพย์ถาวร/หนี้ระยะยาว และ "เงินสด" ใช้ 11% ซึ่งรวมสต็อก/ลูกหนี้)
    const wcAt = (asOf: string) => {
      const row = db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN a.type = 'ASSET' AND a.code LIKE '11%' THEN jl.debit - jl.credit ELSE 0 END), 0) as ca,
          COALESCE(SUM(CASE WHEN a.type = 'LIABILITY' AND a.code LIKE '21%' THEN jl.credit - jl.debit ELSE 0 END), 0) as cl,
          COALESCE(SUM(CASE WHEN a.type = 'ASSET' AND a.category = 'CASH' THEN jl.debit - jl.credit ELSE 0 END), 0) as cash,
          COALESCE(SUM(CASE WHEN a.type = 'ASSET' AND a.category = 'RECEIVABLE' THEN jl.debit - jl.credit ELSE 0 END), 0) as ar
        FROM journal_lines jl JOIN journal_entries je ON jl.journal_entry_id = je.id JOIN accounts a ON jl.account_id = a.id
        WHERE je.tenant_id = ? AND je.is_posted = 1 AND date(je.date) <= ? ${NON_CLOSING}
      `).get(tenantId, asOf) as { ca: number; cl: number; cash: number; ar: number }
      const ca = r2(row.ca), cl = r2(row.cl), cash = r2(row.cash), ar = r2(row.ar)
      return {
        ca, cl, cash, ar,
        currentRatio: cl > 0 ? Math.round((ca / cl) * 100) / 100 : 0,
        quickRatio: cl > 0 ? Math.round(((cash + ar) / cl) * 100) / 100 : 0,
      }
    }
    const wcNow = wcAt(endDate)

    // ค่าใช้จ่ายรวมตามบัญชี (ต้นทุนขาย + OpEx) เฉลี่ย 3 เดือนล่าสุด — ตามเกณฑ์คงค้าง ไม่ใช่เงินสดจ่ายจริง
    const cashBurnRate = r2(months.slice(-3).reduce((s, mr) => s + Math.max(0, ledgerCogs(tenantId, mr.start, mr.end) + ledgerOpex(tenantId, mr.start, mr.end)), 0) / 3)

    // แต่ละเดือนใช้ยอด ณ สิ้นเดือนนั้น (เดิมทุกเดือนใช้ endDate เดียวกัน เส้นเลยแบนราบ)
    const today = thaiToday()
    const wcTrend = months.map(mr => {
      const w = wcAt(mr.end < today ? mr.end : today)
      return { month: mr.label.replace('/', '-'), currentRatio: w.currentRatio, quickRatio: w.quickRatio }
    })

    // ── Zone 6: Outsource Production (Phase 3 — ส่งวัตถุดิบออกไปผลิตข้างนอก) ─────────────────
    // totalStockValue() นับของที่ยังปิดห่อ (sealed_qty) ด้วย — สูตรเดียวกับ /stock/stats
    const inHouseStockValue = totalStockValue(tenantId)

    const offsiteStockValue = (db.prepare(
      `SELECT COALESCE(SUM(total_value), 0) as v FROM subcon_stock WHERE tenant_id = ?`
    ).get(tenantId) as any).v

    const suppliersWithStock = db.prepare(`
      SELECT supplier_id, supplier_name, COALESCE(SUM(total_value), 0) as value, COUNT(*) as items
      FROM subcon_stock WHERE tenant_id = ? AND quantity > 0
      GROUP BY supplier_id, supplier_name
      ORDER BY value DESC
    `).all(tenantId) as Array<{ supplier_id: string; supplier_name: string; value: number; items: number }>

    const overdueContracts = db.prepare(`
      SELECT sc.id, sc.contract_number, sc.supplier_id, sc.supplier_name, sc.due_date, sc.status,
        MAX(sc.labor_amount - sc.paid_amount, 0) as outstanding_amount
      FROM wo_subcontracts sc
      WHERE sc.tenant_id = ? AND sc.contract_type = 'OUTSOURCE'
        AND sc.status NOT IN ('SETTLED', 'CANCELLED', 'CLOSED')
        AND sc.due_date IS NOT NULL AND sc.due_date != '' AND date(sc.due_date) < date('now')
      ORDER BY sc.due_date ASC
    `).all(tenantId) as Array<{ id: string; contract_number: string; supplier_id: string; supplier_name: string; due_date: string; status: string; outstanding_amount: number }>

    const yieldRow = db.prepare(`
      SELECT COALESCE(SUM(sr.received_qty), 0) as good, COALESCE(SUM(sr.scrap_qty), 0) as scrap, COALESCE(SUM(sr.shortage_qty), 0) as shortage
      FROM subcon_receipts sr
      JOIN wo_subcontracts sc ON sr.subcontract_id = sc.id
      WHERE sr.tenant_id = ? AND sc.contract_type = 'OUTSOURCE'
    `).get(tenantId) as { good: number; scrap: number; shortage: number }

    const yieldGood = Number(yieldRow.good), yieldScrap = Number(yieldRow.scrap), yieldShortage = Number(yieldRow.shortage)
    const yieldTotal = yieldGood + yieldScrap + yieldShortage
    const yieldByContract = db.prepare(`
      SELECT sc.id as contract_id, sc.contract_number, sc.supplier_name,
        COALESCE(SUM(sr.received_qty), 0) as good, COALESCE(SUM(sr.scrap_qty), 0) as scrap, COALESCE(SUM(sr.shortage_qty), 0) as shortage
      FROM wo_subcontracts sc
      JOIN subcon_receipts sr ON sr.subcontract_id = sc.id
      WHERE sc.tenant_id = ? AND sc.contract_type = 'OUTSOURCE'
      GROUP BY sc.id
      ORDER BY sc.created_at DESC
    `).all(tenantId) as Array<{ contract_id: string; contract_number: string; supplier_name: string; good: number; scrap: number; shortage: number }>

    const outsourceProduction = {
      stockValue: { inHouse: Number(inHouseStockValue), offsite: Number(offsiteStockValue) },
      suppliersWithStock: suppliersWithStock.map(s => ({ ...s, value: Number(s.value) })),
      overdueContracts: overdueContracts.map(c => ({ ...c, outstanding_amount: Number(c.outstanding_amount) })),
      yield: {
        good: yieldGood, scrap: yieldScrap, shortage: yieldShortage,
        goodPct: yieldTotal > 0 ? Math.round((yieldGood / yieldTotal) * 1000) / 10 : 0,
        scrapPct: yieldTotal > 0 ? Math.round((yieldScrap / yieldTotal) * 1000) / 10 : 0,
        shortagePct: yieldTotal > 0 ? Math.round((yieldShortage / yieldTotal) * 1000) / 10 : 0,
        byContract: yieldByContract.map(c => {
          const total = Number(c.good) + Number(c.scrap) + Number(c.shortage)
          return {
            ...c, good: Number(c.good), scrap: Number(c.scrap), shortage: Number(c.shortage),
            goodPct: total > 0 ? Math.round((Number(c.good) / total) * 1000) / 10 : 0
          }
        })
      }
    }

    res.json({
      success: true,
      data: {
        channel: {
          byPlatform: channelByPlatform, onlineTotal, onlineOrders,
          offlineRevenue: Number(offlineRow.revenue), offlineOrders: Number(offlineRow.orders),
          orderTrend,
          retailRevenue: Number(retailRow.revenue), retailBills: Number(retailRow.bills),
          channels: [
            { unit: 'RETAIL', label: 'หน้าร้าน', revenue: Number(retailRow.revenue), orders: Number(retailRow.bills) },
            { unit: 'WHOLESALE', label: 'ขายส่ง', revenue: Number(offlineRow.revenue), orders: Number(offlineRow.orders) },
            { unit: 'ONLINE', label: 'ออนไลน์', revenue: onlineTotal, orders: onlineOrders }
          ]
        },
        adsROI: {
          totals: { impressions: adImpr, clicks: adClicks, orders: adOrders, revenue: adRev, adCost, roas: adCost > 0 ? Math.round((adRev / adCost) * 100) / 100 : 0, cpc: adClicks > 0 ? Math.round((adCost / adClicks) * 100) / 100 : 0, cpo: adOrders > 0 ? Math.round((adCost / adOrders) * 100) / 100 : 0, ctr: adImpr > 0 ? Math.round((adClicks / adImpr) * 10000) / 100 : 0, orderRate: adClicks > 0 ? Math.round((adOrders / adClicks) * 10000) / 100 : 0, revenuePerAdBaht: adCost > 0 ? Math.round((adRev / adCost) * 100) / 100 : 0 },
          byPlatform: adByPlatform.map(p => ({ platform: p.platform, impressions: Number(p.impressions), clicks: Number(p.clicks), orders: Number(p.orders), revenue: Number(p.revenue), adCost: Number(p.adCost), roas: Number(p.adCost) > 0 ? Math.round((Number(p.revenue) / Number(p.adCost)) * 100) / 100 : 0, cpc: Number(p.clicks) > 0 ? Math.round((Number(p.adCost) / Number(p.clicks)) * 100) / 100 : 0, cpo: Number(p.orders) > 0 ? Math.round((Number(p.adCost) / Number(p.orders)) * 100) / 100 : 0 }))
        },
        costStructure: { cogsByCategory: cogsByCat.map(r => ({ ...r, amount: Number(r.amount) })), expenseByCategory: expByCat, expenseRatio: Math.round(expenseRatio * 10) / 10, productionVariance: { estimated: Number(woVar.estimated), actual: Number(woVar.actual), variancePct: Number(woVar.estimated) > 0 ? Math.round(((Number(woVar.actual) - Number(woVar.estimated)) / Number(woVar.estimated)) * 1000) / 10 : 0, count: Number(woVar.count) }, costTrend, ledgerCogsTotal, ledgerRevenue: ledgerRev },
        products: { top10: productsWithMargin.slice(0, 10), bottom10: [...productsWithMargin].sort((a, b) => a.margin - b.margin).slice(0, 10), concentrationRisk, totalRevenue: totalProdRev },
        workingCapital: { currentAssets: wcNow.ca, currentLiabilities: wcNow.cl, cash: wcNow.cash, ar: wcNow.ar, currentRatio: wcNow.currentRatio, quickRatio: wcNow.quickRatio, cashBurnRate, wcTrend },
        outsourceProduction
      }
    })
  } catch (err: any) {
    console.error('Extended board error:', err)
    res.status(500).json({ success: false, message: 'Failed to load extended data' })
  }
})

// ── C2: GET /phopy-board/trend & GET /phopy-board/cfo-summary ──────────────

const VALID_GRAINS = new Set<TrendGrain>(['week', 'month', 'quarter', 'year'])

function isValidIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

router.get('/trend', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const rawGrain = (req.query.grain as string) || 'month'
    if (!VALID_GRAINS.has(rawGrain as TrendGrain)) {
      return res.status(400).json({
        success: false,
        message: 'ขนาดแท่ง (grain) ไม่ถูกต้อง กรุณาเลือก week, month, quarter หรือ year',
      })
    }
    const grain = rawGrain as TrendGrain
    const from = (req.query.from as string) || undefined
    const to = (req.query.to as string) || undefined
    if ((from && !isValidIsoDate(from)) || (to && !isValidIsoDate(to))) {
      return res.status(400).json({
        success: false,
        message: 'รูปแบบวันที่ไม่ถูกต้อง กรุณาใช้ YYYY-MM-DD เช่น 2026-10-01',
      })
    }
    const effTo = to || thaiToday()
    if (from && from > effTo) {
      return res.status(400).json({
        success: false,
        message: 'วันเริ่มต้น (from) ต้องไม่เกินวันสิ้นสุด (to)',
      })
    }

    let warmup: number | undefined
    if (req.query.warmup !== undefined && req.query.warmup !== '') {
      const rawWarmup = String(req.query.warmup)
      if (!/^\d+$/.test(rawWarmup)) {
        return res.status(400).json({
          success: false,
          message: 'ค่า warmup ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป',
        })
      }
      warmup = Number(rawWarmup)
    }

    res.json({
      success: true,
      data: trendSeries(tenantId, grain, from, effTo, warmup),
    })
  } catch (err: any) {
    console.error('Phopy Board trend error:', err)
    res.status(500).json({ success: false, message: 'ไม่สามารถโหลดข้อมูลแนวโน้มได้ กรุณาลองใหม่อีกครั้ง' })
  }
})

// เกณฑ์กฎสำหรับบทสรุป CFO (C2) — อ้างอิงร่วมกับ HEALTH สำหรับเงินพอใช้และลูกหนี้เกินกำหนด
const CFO_RULES = {
  revGrowthPct: 5,
  gmDropPoints: 2,
  gmStablePoints: 1,
  runwayLowDays: HEALTH.runwayDays.yellow, // 21
  runwayExcessDays: 90,
  excessReserveDays: 60,
  arOverdueRatio: HEALTH.arOverdueRatio.yellow, // 0.25
} as const

const fmtBaht = (v: number) => `${v < 0 ? '-' : ''}฿${Math.round(Math.abs(v)).toLocaleString('th-TH')}`

function shiftYearMinus1(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const maxD = new Date(Date.UTC(y - 1, m, 0)).getUTCDate()
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, maxD)).padStart(2, '0')}`
}

router.get('/cfo-summary', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const today = thaiToday()
    const startDate = (req.query.startDate as string) || `${today.slice(0, 7)}-01`
    const endDate = (req.query.endDate as string) || today
    if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) {
      return res.status(400).json({
        success: false,
        message: 'ช่วงวันที่ไม่ถูกต้อง กรุณาระบุ startDate/endDate เป็น YYYY-MM-DD และ startDate ≤ endDate',
      })
    }

    const compareMode = (req.query.compare as string) || 'yoy'
    if (compareMode !== 'yoy' && compareMode !== 'prev') {
      return res.status(400).json({
        success: false,
        message: 'ตัวเลือกเปรียบเทียบ (compare) ไม่ถูกต้อง กรุณาเลือก yoy หรือ prev',
      })
    }

    const lenDays = diffDaysStr(startDate, endDate) + 1
    const cmpStart = compareMode === 'yoy' ? shiftYearMinus1(startDate) : addDaysStr(startDate, -lenDays)
    const cmpEnd = compareMode === 'yoy' ? shiftYearMinus1(endDate) : addDaysStr(startDate, -1)
    const cmpLabel = compareMode === 'yoy' ? 'ช่วงเดียวกันปีก่อน' : 'งวดก่อนหน้า'

    const hasCmpData = !!db.prepare(`
      SELECT 1 FROM journal_entries je
      WHERE je.tenant_id = ? AND je.is_posted = 1 ${NON_CLOSING}
        AND date(je.date) BETWEEN ? AND ?
      LIMIT 1
    `).get(tenantId, cmpStart, cmpEnd)

    const revenue = r2(ledgerRevenue(tenantId, startDate, endDate))
    const cogs = r2(ledgerCogs(tenantId, startDate, endDate))
    const opex = r2(ledgerOpex(tenantId, startDate, endDate))
    const netProfit = r2(revenue - cogs - opex)
    const grossMarginPct = revenue > 0 ? r2(((revenue - cogs) / revenue) * 100) : 0
    const cashEnd = cashBalanceAt(tenantId, endDate)
    const outflow = cashOutflow(tenantId, startDate, endDate)
    const runwayDays = outflow.avgPerDay > 0 ? r2(cashEnd / outflow.avgPerDay) : null
    const cashNote = runwayDays !== null ? `พอใช้ ${Math.round(runwayDays)} วัน` : 'ยังไม่มีรายการเงินออก'

    let prevRev: number | null = null
    let prevNet: number | null = null
    let prevGmPct: number | null = null
    let prevCash: number | null = null
    let revDeltaPct: number | null = null
    let netDeltaPct: number | null = null
    let gmDeltaPct: number | null = null
    let cashDeltaPct: number | null = null

    if (hasCmpData) {
      prevRev = r2(ledgerRevenue(tenantId, cmpStart, cmpEnd))
      const prevCogs = r2(ledgerCogs(tenantId, cmpStart, cmpEnd))
      const prevOpex = r2(ledgerOpex(tenantId, cmpStart, cmpEnd))
      prevNet = r2(prevRev - prevCogs - prevOpex)
      prevGmPct = prevRev > 0 ? r2(((prevRev - prevCogs) / prevRev) * 100) : 0
      prevCash = cashBalanceAt(tenantId, cmpEnd)

      revDeltaPct = prevRev > 0 ? r2(((revenue - prevRev) / prevRev) * 100) : null
      netDeltaPct = prevNet !== 0 ? r2(((netProfit - prevNet) / Math.abs(prevNet)) * 100) : null
      gmDeltaPct = prevRev > 0 && revenue > 0 ? r2(grossMarginPct - prevGmPct) : null
      cashDeltaPct = prevCash !== 0 ? r2(((cashEnd - prevCash) / Math.abs(prevCash)) * 100) : null
    }

    const kpis = [
      { key: 'revenue', label: 'ยอดขาย', value: revenue, prev: prevRev, deltaPct: revDeltaPct, format: 'baht' },
      { key: 'netProfit', label: 'กำไรสุทธิ (ก่อนภาษี)', value: netProfit, prev: prevNet, deltaPct: netDeltaPct, format: 'baht' },
      { key: 'grossMarginPct', label: '% กำไรขั้นต้น', value: grossMarginPct, prev: prevGmPct, deltaPct: gmDeltaPct, format: 'pct' },
      { key: 'cashEnd', label: 'เงินสดสิ้นงวด', value: cashEnd, prev: prevCash, deltaPct: cashDeltaPct, format: 'baht', note: cashNote },
    ]

    const strengths: Array<{ text: string; from: string }> = []
    const cautions: Array<{ text: string; from: string }> = []
    const decisions: Array<{ text: string; from: string }> = []

    // 1. Revenue growth vs compare period (only when compare has data)
    if (hasCmpData && revDeltaPct !== null) {
      if (revDeltaPct >= CFO_RULES.revGrowthPct) {
        strengths.push({ text: `ยอดขายโต ${revDeltaPct.toFixed(1)}% เทียบ${cmpLabel}`, from: 'ยอดขาย · บท 3' })
      } else if (revDeltaPct <= -CFO_RULES.revGrowthPct) {
        cautions.push({ text: `ยอดขายลดลง ${Math.abs(revDeltaPct).toFixed(1)}% เทียบ${cmpLabel}`, from: 'ยอดขาย · บท 3' })
      }
    }

    // 2. Gross margin change vs compare period
    if (hasCmpData && gmDeltaPct !== null && prevGmPct !== null) {
      if (gmDeltaPct < -CFO_RULES.gmDropPoints) {
        cautions.push({
          text: `% กำไรขั้นต้นลดลง ${Math.abs(gmDeltaPct).toFixed(1)} จุด (${grossMarginPct.toFixed(1)}% จาก ${prevGmPct.toFixed(1)}%)`,
          from: 'ต้นทุนขาย ÷ รายได้ · บท 3',
        })
      } else if (Math.abs(gmDeltaPct) <= CFO_RULES.gmStablePoints) {
        strengths.push({
          text: `% กำไรขั้นต้น ${grossMarginPct.toFixed(1)}% ทรงตัวใกล้เคียงงวดเทียบ (${prevGmPct.toFixed(1)}%)`,
          from: 'ต้นทุนขาย ÷ รายได้ · บท 3',
        })
      }
    }

    // 3. Net profit < 0
    if (netProfit < 0) {
      cautions.push({ text: `ขาดทุนสุทธิ ${fmtBaht(Math.abs(netProfit))}`, from: 'งบกำไรขาดทุน · บท 3' })
    }

    // 4. Runway (< 21 days → caution; ≥ 90 days → decision)
    if (runwayDays !== null) {
      if (runwayDays < CFO_RULES.runwayLowDays) {
        cautions.push({
          text: `เงินสดสิ้นงวดพอใช้เพียง ${Math.round(runwayDays)} วัน (ต่ำกว่าเกณฑ์ ${CFO_RULES.runwayLowDays} วัน)`,
          from: 'เงินสดและสภาพคล่อง · บท 2',
        })
      } else if (runwayDays >= CFO_RULES.runwayExcessDays) {
        const excess = Math.round((cashEnd - CFO_RULES.excessReserveDays * outflow.avgPerDay) / 1000) * 1000
        decisions.push({
          text: `เงินสดเกินความต้องการ 60 วันราว ${fmtBaht(excess)} จะฝากประจำ ลดหนี้ หรือเก็บไว้ลงทุน`,
          from: 'เงินสดสิ้นงวด − เงินใช้ 60 วัน · บท 2',
        })
      }
    }

    // 5. AR overdue ratio > 25%
    const ar = arAging(tenantId, endDate)
    if (ar.total > 0 && (ar.overdue / ar.total) > CFO_RULES.arOverdueRatio) {
      cautions.push({
        text: `ลูกหนี้เกินกำหนด ${((ar.overdue / ar.total) * 100).toFixed(1)}% (${fmtBaht(ar.overdue)} จาก ${fmtBaht(ar.total)})`,
        from: 'อายุลูกหนี้ · บท 2',
      })
    }

    // 6. Budgets table has no rows for tenant/year of endDate
    const endYear = Number(endDate.slice(0, 4))
    const hasBudget = !!db.prepare('SELECT 1 FROM budgets WHERE tenant_id = ? AND year = ? LIMIT 1').get(tenantId, endYear)
    if (!hasBudget) {
      decisions.push({
        text: `ตั้งงบประมาณปี ${endYear + 1 + 543} เพื่อให้บท 7 มีตัวเทียบ`,
        from: 'ตาราง budgets ยังว่าง · บท 7',
      })
    }

    // 7. Previous-period checklist has blocks
    const checkPeriod = endDate.slice(0, 7) >= today.slice(0, 7) ? previousPeriod(today.slice(0, 7)) : endDate.slice(0, 7)
    const ck = closeChecklist(tenantId, checkPeriod)
    if (ck.blocks > 0) {
      cautions.push({
        text: `ตัวเลขยังเชื่อได้ไม่เต็มที่: ด่านตรวจไม่ผ่าน ${ck.blocks} ข้อ`,
        from: 'ด่านตรวจปิดงวด · บท 6',
      })
    }

    // 8. Data shorter than the compare window
    const dataSince = firstPostedDate(tenantId)
    const dataDays = dataSince && dataSince <= endDate ? diffDaysStr(dataSince, endDate) + 1 : 0
    if (!dataSince || dataSince > cmpStart) {
      cautions.push({
        text: `ข้อมูลมี ${dataDays} วัน การเทียบยังไม่สมบูรณ์`,
        from: 'วันที่มีข้อมูลวันแรก · บท 6',
      })
    }

    res.json({
      success: true,
      data: {
        period: { start: startDate, end: endDate },
        compare: { mode: compareMode, start: cmpStart, end: cmpEnd, label: cmpLabel, hasData: hasCmpData },
        kpis,
        strengths,
        cautions,
        decisions,
        confidence: { period: ck.period, label: ck.label, passed: ck.passed, total: ck.total },
      },
    })
  } catch (err: any) {
    console.error('Phopy Board CFO summary error:', err)
    res.status(500).json({ success: false, message: 'ไม่สามารถโหลดบทสรุป CFO ได้ กรุณาลองใหม่อีกครั้ง' })
  }
})

export default router
