import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'

const router = Router()
router.use(authenticate)

function toISO(d: string) {
  return d.substring(0, 10)
}

function daysBetween(dateStr: string): number {
  const d = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - d.getTime()) / 86400000)
}

router.get('/summary', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const now = new Date()
    const startDate = (req.query.startDate as string) || new Date(now.getFullYear(), 0, 1).toISOString().substring(0, 10)
    const endDate = (req.query.endDate as string) || now.toISOString().substring(0, 10)

    // Previous period (same duration)
    const durationMs = new Date(endDate).getTime() - new Date(startDate).getTime()
    const prevEnd = new Date(new Date(startDate).getTime() - 86400000).toISOString().substring(0, 10)
    const prevStart = new Date(new Date(startDate).getTime() - durationMs - 86400000).toISOString().substring(0, 10)

    // ── KPIs ──────────────────────────────────────────────────────────────────
    const revRow = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as revenue
      FROM orders
      WHERE status != 'CANCELLED' AND date(order_date) BETWEEN ? AND ?
    `).get(startDate, endDate) as { revenue: number }

    const costRow = db.prepare(`
      SELECT COALESCE(SUM(poi.total_price), 0) as cost
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      WHERE po.status = 'RECEIVED' AND date(po.order_date) BETWEEN ? AND ?
    `).get(startDate, endDate) as { cost: number }

    const prevRevRow = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as revenue
      FROM orders
      WHERE status != 'CANCELLED' AND date(order_date) BETWEEN ? AND ?
    `).get(prevStart, prevEnd) as { revenue: number }

    const prevCostRow = db.prepare(`
      SELECT COALESCE(SUM(poi.total_price), 0) as cost
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      WHERE po.status = 'RECEIVED' AND date(po.order_date) BETWEEN ? AND ?
    `).get(prevStart, prevEnd) as { cost: number }

    // Net profit via journal (revenue - expense accounts for tenant)
    const netRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN a.type = 'REVENUE' THEN jl.credit - jl.debit ELSE 0 END), 0) as revenue_net,
        COALESCE(SUM(CASE WHEN a.type = 'EXPENSE' THEN jl.debit - jl.credit ELSE 0 END), 0) as expense_net
      FROM journal_lines jl
      JOIN journal_entries je ON jl.journal_entry_id = je.id
      JOIN accounts a ON jl.account_id = a.id
      WHERE je.tenant_id = ? AND je.is_posted = 1
        AND date(je.date) BETWEEN ? AND ?
    `).get(tenantId, startDate, endDate) as { revenue_net: number; expense_net: number }

    const revenue = Number(revRow.revenue)
    const cost = Number(costRow.cost)
    const prevRevenue = Number(prevRevRow.revenue)
    const prevCost = Number(prevCostRow.cost)
    const grossProfit = revenue - cost
    const prevGrossProfit = prevRevenue - prevCost
    const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0
    const netProfit = Number(netRow.revenue_net) - Number(netRow.expense_net)

    // ── 12-month revenue chart ────────────────────────────────────────────────
    const revenueChart: Array<{ month: string; revenue: number; cost: number; grossProfit: number }> = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const mStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      const mEnd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
      const label = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`

      const mRev = db.prepare(`SELECT COALESCE(SUM(total_amount),0) as v FROM orders WHERE status!='CANCELLED' AND date(order_date) BETWEEN ? AND ?`).get(mStart, mEnd) as { v: number }
      const mCost = db.prepare(`SELECT COALESCE(SUM(poi.total_price),0) as v FROM purchase_order_items poi JOIN purchase_orders po ON poi.purchase_order_id=po.id WHERE po.status='RECEIVED' AND date(po.order_date) BETWEEN ? AND ?`).get(mStart, mEnd) as { v: number }
      const r = Number(mRev.v)
      const c = Number(mCost.v)
      revenueChart.push({ month: label, revenue: r, cost: c, grossProfit: r - c })
    }

    // ── P&L table (by month in selected period) ───────────────────────────────
    const plTable: Array<{ month: string; revenue: number; cogs: number; grossProfit: number; netProfit: number; margin: number }> = []
    const pStart = new Date(startDate)
    const pEnd = new Date(endDate)
    let cur = new Date(pStart.getFullYear(), pStart.getMonth(), 1)
    while (cur <= pEnd) {
      const mLabel = `${cur.getFullYear()}/${String(cur.getMonth() + 1).padStart(2, '0')}`
      const mS = cur.toISOString().substring(0, 10)
      const lastD = new Date(cur.getFullYear(), cur.getMonth() + 1, 0)
      const mE = lastD.toISOString().substring(0, 10)

      const r2 = db.prepare(`SELECT COALESCE(SUM(total_amount),0) as v FROM orders WHERE status!='CANCELLED' AND date(order_date) BETWEEN ? AND ?`).get(mS, mE) as { v: number }
      const c2 = db.prepare(`SELECT COALESCE(SUM(poi.total_price),0) as v FROM purchase_order_items poi JOIN purchase_orders po ON poi.purchase_order_id=po.id WHERE po.status='RECEIVED' AND date(po.order_date) BETWEEN ? AND ?`).get(mS, mE) as { v: number }
      const n2 = db.prepare(`SELECT COALESCE(SUM(CASE WHEN a.type='REVENUE' THEN jl.credit-jl.debit ELSE 0 END),0)-COALESCE(SUM(CASE WHEN a.type='EXPENSE' THEN jl.debit-jl.credit ELSE 0 END),0) as v FROM journal_lines jl JOIN journal_entries je ON jl.journal_entry_id=je.id JOIN accounts a ON jl.account_id=a.id WHERE je.tenant_id=? AND je.is_posted=1 AND date(je.date) BETWEEN ? AND ?`).get(tenantId, mS, mE) as { v: number }

      const rev = Number(r2.v)
      const cogs = Number(c2.v)
      const gp = rev - cogs
      const np = Number(n2.v)
      plTable.push({ month: mLabel, revenue: rev, cogs, grossProfit: gp, netProfit: np, margin: rev > 0 ? (gp / rev) * 100 : 0 })
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    }

    // ── AR Aging (outstanding orders) ─────────────────────────────────────────
    const arOrders = db.prepare(`
      SELECT order_date, total_amount FROM orders
      WHERE status NOT IN ('COMPLETED','CANCELLED','DELIVERED')
    `).all() as Array<{ order_date: string; total_amount: number }>

    const arAging = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 }
    for (const o of arOrders) {
      const days = daysBetween(o.order_date)
      const amt = Number(o.total_amount)
      if (days <= 30) arAging.current += amt
      else if (days <= 60) arAging.days30 += amt
      else if (days <= 90) arAging.days60 += amt
      else if (days <= 120) arAging.days90 += amt
      else arAging.over90 += amt
    }

    // ── AP Aging (outstanding purchase orders) ────────────────────────────────
    const apOrders = db.prepare(`
      SELECT order_date, total_amount FROM purchase_orders
      WHERE status NOT IN ('RECEIVED','CANCELLED')
    `).all() as Array<{ order_date: string; total_amount: number }>

    const apAging = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 }
    for (const o of apOrders) {
      const days = daysBetween(o.order_date)
      const amt = Number(o.total_amount)
      if (days <= 30) apAging.current += amt
      else if (days <= 60) apAging.days30 += amt
      else if (days <= 90) apAging.days60 += amt
      else if (days <= 120) apAging.days90 += amt
      else apAging.over90 += amt
    }

    // ── Customer Intelligence ─────────────────────────────────────────────────
    const custRows = db.prepare(`
      SELECT c.id, c.name, c.credit_limit,
        COALESCE(SUM(CASE WHEN date(o.order_date) BETWEEN ? AND ? THEN o.total_amount ELSE 0 END), 0) as curr_rev,
        COALESCE(SUM(CASE WHEN date(o.order_date) BETWEEN ? AND ? THEN o.total_amount ELSE 0 END), 0) as prev_rev,
        MAX(o.order_date) as last_order
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id AND o.status != 'CANCELLED'
      WHERE c.status = 'ACTIVE'
      GROUP BY c.id, c.name, c.credit_limit
      HAVING curr_rev > 0 OR prev_rev > 0
      ORDER BY curr_rev DESC
      LIMIT 20
    `).all(startDate, endDate, prevStart, prevEnd) as Array<{
      id: string; name: string; credit_limit: number
      curr_rev: number; prev_rev: number; last_order: string | null
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

      // Credit used = total outstanding AR for this customer
      const usedRow = db.prepare(`
        SELECT COALESCE(SUM(total_amount), 0) as used
        FROM orders WHERE customer_id = ? AND status NOT IN ('COMPLETED','CANCELLED','DELIVERED')
      `).get(c.id) as { used: number }
      const creditUsed = Number(usedRow.used)

      return { id: c.id, name: c.name, currentRevenue: curr, prevRevenue: prev, trend, tier, lastOrderDays, creditLimit: Number(c.credit_limit), creditUsed }
    })

    // ── Stock Alerts ──────────────────────────────────────────────────────────
    const stockAlerts = (db.prepare(`
      SELECT id, name, quantity, min_stock, unit FROM stock_items
      WHERE quantity <= min_stock AND status = 'ACTIVE'
      ORDER BY (quantity * 1.0 / CASE WHEN min_stock=0 THEN 1 ELSE min_stock END) ASC
      LIMIT 10
    `).all() as Array<{ id: string; name: string; quantity: number; min_stock: number; unit: string }>).map(s => ({
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
      WHERE date(created_at) BETWEEN ? AND ?
      GROUP BY status
    `).all(startDate, endDate) as Array<{ status: string; cnt: number; est: number; act: number }>

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
    const marginDiff = grossMarginPct - (prevRevenue > 0 ? ((prevGrossProfit / prevRevenue) * 100) : 0)
    const arOver90Pct = (arAging.current + arAging.days30 + arAging.days60 + arAging.days90 + arAging.over90) > 0
      ? (arAging.over90 / (arAging.current + arAging.days30 + arAging.days60 + arAging.days90 + arAging.over90)) * 100 : 0

    // Supplier concentration
    const supplierConc = db.prepare(`
      SELECT supplier_id, SUM(total_amount) as total
      FROM purchase_orders WHERE status != 'CANCELLED'
      GROUP BY supplier_id ORDER BY total DESC LIMIT 1
    `).get() as { supplier_id: string; total: number } | undefined
    const totalPO = db.prepare(`SELECT COALESCE(SUM(total_amount),0) as t FROM purchase_orders WHERE status!='CANCELLED'`).get() as { t: number }
    const supplierConcPct = totalPO.t > 0 && supplierConc ? (Number(supplierConc.total) / Number(totalPO.t)) * 100 : 0

    // Top 3 customer churn risk
    const top3Days = customers.slice(0, 3).map(c => c.lastOrderDays)
    const churnRisk = top3Days.some(d => d > 30)

    const earlyWarnings = [
      {
        id: 'revenue_growth',
        label: 'Revenue Growth',
        status: revGrowth >= 5 ? 'ok' : revGrowth >= -5 ? 'warn' : 'danger',
        value: revGrowth.toFixed(1) + '%',
        detail: `vs previous period`
      },
      {
        id: 'margin',
        label: 'Gross Margin Trend',
        status: marginDiff >= -2 ? 'ok' : marginDiff >= -5 ? 'warn' : 'danger',
        value: grossMarginPct.toFixed(1) + '%',
        detail: `${marginDiff >= 0 ? '+' : ''}${marginDiff.toFixed(1)}% vs prev`
      },
      {
        id: 'ar_aging',
        label: 'AR Risk (90+ days)',
        status: arOver90Pct < 10 ? 'ok' : arOver90Pct < 20 ? 'warn' : 'danger',
        value: arOver90Pct.toFixed(1) + '%',
        detail: 'of total AR outstanding'
      },
      {
        id: 'supplier_conc',
        label: 'Supplier Concentration',
        status: supplierConcPct < 30 ? 'ok' : supplierConcPct < 40 ? 'warn' : 'danger',
        value: supplierConcPct.toFixed(1) + '%',
        detail: 'top supplier share of PO'
      },
      {
        id: 'churn_risk',
        label: 'Top Customer Churn',
        status: !churnRisk ? 'ok' : top3Days.some(d => d > 60) ? 'danger' : 'warn',
        value: churnRisk ? `${Math.max(...top3Days)}d` : 'OK',
        detail: 'days since top 3 last ordered'
      },
      {
        id: 'stock_out',
        label: 'Stock-Out Risk',
        status: stockAlerts.length === 0 ? 'ok' : stockAlerts.length <= 3 ? 'warn' : 'danger',
        value: stockAlerts.length.toString(),
        detail: 'items at or below min stock'
      }
    ]

    res.json({
      success: true,
      data: {
        period: { start: startDate, end: endDate },
        kpis: { revenue, cost, grossProfit, netProfit, grossMarginPct, prevRevenue, prevGrossProfit },
        revenueChart,
        plTable,
        arAging,
        apAging,
        customers,
        stockAlerts,
        workOrders,
        earlyWarnings
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
    const now = new Date()
    const startDate = (req.query.startDate as string) || new Date(now.getFullYear(), 0, 1).toISOString().substring(0, 10)
    const endDate = (req.query.endDate as string) || now.toISOString().substring(0, 10)

    // ── Zone 1: Channel Performance ─────────────────────────────────────────
    const channelByPlatform = db.prepare(`
      SELECT s.platform, COALESCE(SUM(mm.sales), 0) as revenue, COALESCE(SUM(mm.orders), 0) as orders
      FROM marketing_metrics mm JOIN shops s ON mm.shop_id = s.id
      WHERE mm.tenant_id = ? AND date(mm.date) BETWEEN ? AND ?
      GROUP BY s.platform ORDER BY revenue DESC
    `).all(tenantId, startDate, endDate) as Array<{ platform: string; revenue: number; orders: number }>

    const onlineTotal = channelByPlatform.reduce((s, r) => s + Number(r.revenue), 0)
    const onlineOrders = channelByPlatform.reduce((s, r) => s + Number(r.orders), 0)

    const offlineRow = db.prepare(
      "SELECT COALESCE(SUM(total_amount), 0) as revenue, COUNT(*) as orders FROM orders WHERE status != 'CANCELLED' AND date(order_date) BETWEEN ? AND ?"
    ).get(startDate, endDate) as { revenue: number; orders: number }

    const orderTrend: Array<{ month: string; online: number; offline: number }> = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i)
      const mS = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().substring(0, 10)
      const mE = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().substring(0, 10)
      const mn = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const onR = db.prepare("SELECT COALESCE(SUM(orders), 0) as orders FROM marketing_metrics WHERE tenant_id = ? AND date(date) BETWEEN ? AND ?").get(tenantId, mS, mE) as { orders: number }
      const ofR = db.prepare("SELECT COUNT(*) as orders FROM orders WHERE status != 'CANCELLED' AND date(order_date) BETWEEN ? AND ?").get(mS, mE) as { orders: number }
      orderTrend.push({ month: mn, online: Number(onR.orders), offline: Number(ofR.orders) })
    }

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
    const cogsByCat = db.prepare(`
      SELECT COALESCE(mc.name, 'ไม่ระบุหมวด') as category, COALESCE(SUM(poi.total_price), 0) as amount
      FROM purchase_order_items poi JOIN purchase_orders po ON poi.purchase_order_id = po.id
      LEFT JOIN materials m ON poi.material_id = m.id
      LEFT JOIN material_categories mc ON m.category_id = mc.id
      WHERE po.tenant_id = ? AND po.status = 'RECEIVED' AND date(po.order_date) BETWEEN ? AND ?
      GROUP BY mc.name ORDER BY amount DESC
    `).all(tenantId, startDate, endDate) as Array<{ category: string; amount: number }>

    const expByCat = db.prepare(`
      SELECT COALESCE(a.category, 'ค่าใช้จ่ายอื่น') as category, COALESCE(SUM(jl.debit - jl.credit), 0) as amount
      FROM journal_lines jl JOIN journal_entries je ON jl.journal_entry_id = je.id JOIN accounts a ON jl.account_id = a.id
      WHERE je.tenant_id = ? AND a.type = 'EXPENSE' AND je.is_posted = 1 AND date(je.date) BETWEEN ? AND ?
      GROUP BY a.category HAVING amount > 0 ORDER BY amount DESC
    `).all(tenantId, startDate, endDate) as Array<{ category: string; amount: number }>

    const revRow2 = db.prepare("SELECT COALESCE(SUM(total_amount), 0) as rev FROM orders WHERE status != 'CANCELLED' AND date(order_date) BETWEEN ? AND ?").get(startDate, endDate) as { rev: number }
    const totalExp = expByCat.reduce((s, r) => s + Number(r.amount), 0)
    const expenseRatio = Number(revRow2.rev) > 0 ? (totalExp / Number(revRow2.rev)) * 100 : 0

    const woVar = db.prepare(`
      SELECT COALESCE(SUM(estimated_cost), 0) as estimated, COALESCE(SUM(actual_cost), 0) as actual, COUNT(*) as count
      FROM work_orders WHERE tenant_id = ? AND status = 'COMPLETED' AND date(COALESCE(completed_date, updated_at)) BETWEEN ? AND ?
    `).get(tenantId, startDate, endDate) as { estimated: number; actual: number; count: number }

    const costTrend: Array<{ month: string; cogs: number; opex: number }> = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i)
      const mS = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().substring(0, 10)
      const mE = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().substring(0, 10)
      const mn = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const cogsR = db.prepare("SELECT COALESCE(SUM(poi.total_price), 0) as cogs FROM purchase_order_items poi JOIN purchase_orders po ON poi.purchase_order_id = po.id WHERE po.tenant_id = ? AND po.status = 'RECEIVED' AND date(po.order_date) BETWEEN ? AND ?").get(tenantId, mS, mE) as { cogs: number }
      const expR = db.prepare("SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as exp FROM journal_lines jl JOIN journal_entries je ON jl.journal_entry_id = je.id JOIN accounts a ON jl.account_id = a.id WHERE je.tenant_id = ? AND a.type = 'EXPENSE' AND je.is_posted = 1 AND date(je.date) BETWEEN ? AND ?").get(tenantId, mS, mE) as { exp: number }
      costTrend.push({ month: mn, cogs: Number(cogsR.cogs), opex: Math.max(0, Number(expR.exp)) })
    }

    // ── Zone 4: Product Profitability ────────────────────────────────────────
    const prodRevList = db.prepare(`
      SELECT p.id, p.name, p.code,
        COALESCE(SUM(oi.total_price), 0) as revenue, COALESCE(SUM(oi.quantity), 0) as unitsSold,
        COUNT(DISTINCT oi.order_id) as orderCount
      FROM order_items oi JOIN products p ON oi.product_id = p.id JOIN orders o ON oi.order_id = o.id
      WHERE p.tenant_id = ? AND o.status != 'CANCELLED' AND date(o.order_date) BETWEEN ? AND ?
      GROUP BY p.id ORDER BY revenue DESC
    `).all(tenantId, startDate, endDate) as Array<{ id: string; name: string; code: string; revenue: number; unitsSold: number; orderCount: number }>

    const productsWithMargin = prodRevList.map(p => {
      const bom = db.prepare("SELECT id FROM boms WHERE tenant_id = ? AND product_id = ? AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1").get(tenantId, p.id) as { id: string } | undefined
      let bomCost = 0
      if (bom) {
        const bc = db.prepare("SELECT COALESCE(SUM(bi.quantity * m.unit_cost), 0) as cost FROM bom_items bi JOIN materials m ON bi.material_id = m.id WHERE bi.bom_id = ? AND bi.item_type = 'MATERIAL'").get(bom.id) as { cost: number }
        bomCost = Number(bc.cost) * Number(p.unitsSold)
      }
      const rev = Number(p.revenue)
      const margin = rev > 0 ? ((rev - bomCost) / rev) * 100 : 0
      return { id: p.id, name: p.name, code: p.code, revenue: rev, unitsSold: Number(p.unitsSold), orderCount: Number(p.orderCount), bomCost, margin: Math.round(margin * 10) / 10 }
    })

    const totalProdRev = productsWithMargin.reduce((s, p) => s + p.revenue, 0)
    const top5Rev = productsWithMargin.slice(0, 5).reduce((s, p) => s + p.revenue, 0)
    const concentrationRisk = totalProdRev > 0 ? Math.round((top5Rev / totalProdRev) * 1000) / 10 : 0

    // ── Zone 5: Working Capital ──────────────────────────────────────────────
    const getBalance = (types: string[], codePfx?: string): number => {
      let q = `SELECT COALESCE(SUM(CASE WHEN a.normal_balance='DEBIT' THEN jl.debit-jl.credit ELSE jl.credit-jl.debit END),0) as bal FROM journal_lines jl JOIN journal_entries je ON jl.journal_entry_id=je.id JOIN accounts a ON jl.account_id=a.id WHERE je.tenant_id=? AND je.is_posted=1 AND date(je.date)<=? AND a.type IN (${types.map(() => '?').join(',')})`
      const params: (string | number)[] = [tenantId, endDate, ...types]
      if (codePfx) { q += ' AND a.code LIKE ?'; params.push(codePfx + '%') }
      return Number((db.prepare(q).get(...params) as { bal: number }).bal) || 0
    }

    const currentAssets = getBalance(['ASSET'], '1')
    const currentLiab = getBalance(['LIABILITY'], '2')
    const cashBal = getBalance(['ASSET'], '11')
    const arBal = getBalance(['ASSET'], '13')
    const currentRatio = currentLiab > 0 ? Math.round((currentAssets / currentLiab) * 100) / 100 : 0
    const quickRatio = currentLiab > 0 ? Math.round(((cashBal + arBal) / currentLiab) * 100) / 100 : 0

    const burnArr: number[] = []
    for (let i = 0; i < 3; i++) {
      const d = new Date(); d.setMonth(d.getMonth() - i)
      const mS = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().substring(0, 10)
      const mE = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().substring(0, 10)
      const r = db.prepare("SELECT COALESCE(SUM(jl.debit-jl.credit),0) as exp FROM journal_lines jl JOIN journal_entries je ON jl.journal_entry_id=je.id JOIN accounts a ON jl.account_id=a.id WHERE je.tenant_id=? AND a.type='EXPENSE' AND je.is_posted=1 AND date(je.date) BETWEEN ? AND ?").get(tenantId, mS, mE) as { exp: number }
      burnArr.push(Math.max(0, Number(r.exp)))
    }
    const cashBurnRate = burnArr.reduce((s, v) => s + v, 0) / 3

    const wcTrend: Array<{ month: string; currentRatio: number; quickRatio: number }> = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i)
      const mn = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const mA = getBalance(['ASSET'], '1')
      const mL = getBalance(['LIABILITY'], '2')
      const mC = getBalance(['ASSET'], '11')
      const mAR = getBalance(['ASSET'], '13')
      wcTrend.push({
        month: mn,
        currentRatio: mL > 0 ? Math.round((mA / mL) * 100) / 100 : 0,
        quickRatio: mL > 0 ? Math.round(((mC + mAR) / mL) * 100) / 100 : 0
      })
    }

    // ── Zone 6: Outsource Production (Phase 3 — ส่งวัตถุดิบออกไปผลิตข้างนอก) ─────────────────
    const inHouseStockValue = (db.prepare(
      `SELECT COALESCE(SUM(quantity * unit_cost), 0) as v FROM stock_items WHERE tenant_id = ?`
    ).get(tenantId) as any).v

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
        channel: { byPlatform: channelByPlatform, onlineTotal, onlineOrders, offlineRevenue: Number(offlineRow.revenue), offlineOrders: Number(offlineRow.orders), orderTrend },
        adsROI: {
          totals: { impressions: adImpr, clicks: adClicks, orders: adOrders, revenue: adRev, adCost, roas: adCost > 0 ? Math.round((adRev / adCost) * 100) / 100 : 0, cpc: adClicks > 0 ? Math.round((adCost / adClicks) * 100) / 100 : 0, cpo: adOrders > 0 ? Math.round((adCost / adOrders) * 100) / 100 : 0, ctr: adImpr > 0 ? Math.round((adClicks / adImpr) * 10000) / 100 : 0, orderRate: adClicks > 0 ? Math.round((adOrders / adClicks) * 10000) / 100 : 0, revenuePerAdBaht: adCost > 0 ? Math.round((adRev / adCost) * 100) / 100 : 0 },
          byPlatform: adByPlatform.map(p => ({ platform: p.platform, impressions: Number(p.impressions), clicks: Number(p.clicks), orders: Number(p.orders), revenue: Number(p.revenue), adCost: Number(p.adCost), roas: Number(p.adCost) > 0 ? Math.round((Number(p.revenue) / Number(p.adCost)) * 100) / 100 : 0, cpc: Number(p.clicks) > 0 ? Math.round((Number(p.adCost) / Number(p.clicks)) * 100) / 100 : 0, cpo: Number(p.orders) > 0 ? Math.round((Number(p.adCost) / Number(p.orders)) * 100) / 100 : 0 }))
        },
        costStructure: { cogsByCategory: cogsByCat.map(r => ({ ...r, amount: Number(r.amount) })), expenseByCategory: expByCat.map(r => ({ ...r, amount: Number(r.amount) })), expenseRatio: Math.round(expenseRatio * 10) / 10, productionVariance: { estimated: Number(woVar.estimated), actual: Number(woVar.actual), variancePct: Number(woVar.estimated) > 0 ? Math.round(((Number(woVar.actual) - Number(woVar.estimated)) / Number(woVar.estimated)) * 1000) / 10 : 0, count: Number(woVar.count) }, costTrend },
        products: { top10: productsWithMargin.slice(0, 10), bottom10: [...productsWithMargin].sort((a, b) => a.margin - b.margin).slice(0, 10), concentrationRisk, totalRevenue: totalProdRev },
        workingCapital: { currentAssets, currentLiabilities: currentLiab, cash: cashBal, ar: arBal, currentRatio, quickRatio, cashBurnRate, wcTrend },
        outsourceProduction
      }
    })
  } catch (err: any) {
    console.error('Extended board error:', err)
    res.status(500).json({ success: false, message: 'Failed to load extended data' })
  }
})

export default router
