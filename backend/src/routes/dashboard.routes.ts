import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

// Get dashboard statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    // Count active customers for this tenant
    const customerStats = db.prepare(`
      SELECT COUNT(*) as total_customers,
        SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as active_customers
      FROM customers
      WHERE tenant_id = ?
    `).get(tenantId) as any

    // Count active orders for this tenant
    const activeOrders = (db.prepare(`
      SELECT COUNT(*) as count FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE c.tenant_id = ? AND o.status IN ('PENDING', 'PROCESSING')
    `).get(tenantId) as any).count

    // Count stock items for this tenant
    const stockItems = (db.prepare(`
      SELECT COUNT(*) as count FROM stock_items WHERE tenant_id = ?
    `).get(tenantId) as any).count

    // Calculate monthly revenue (current month) for this tenant
    const currentMonth = new Date().getMonth()
    const currentYear = new Date().getFullYear()
    const monthlyRevenue = db.prepare(`
      SELECT COALESCE(SUM(o.total_amount), 0) as revenue
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE c.tenant_id = ? 
        AND strftime('%m', o.order_date) = ?
        AND strftime('%Y', o.order_date) = ?
    `).get(tenantId, String(currentMonth + 1).padStart(2, '0'), String(currentYear)) as any

    res.json({
      success: true,
      data: {
        totalCustomers: customerStats.active_customers || 0,
        activeOrders: activeOrders || 0,
        stockItems: stockItems || 0,
        monthlyRevenue: monthlyRevenue?.revenue || 0,
      },
    })
  } catch (error) {
    console.error('Dashboard stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stats' })
  }
})

// Get recent activities
router.get('/activities', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    // Get recent orders for this tenant
    const activities = db.prepare(`
      SELECT o.id, o.order_number, o.created_at, o.total_amount,
        c.name as customer_name
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE c.tenant_id = ?
      ORDER BY o.created_at DESC
      LIMIT 10
    `).all(tenantId) as any[]

    const formattedActivities = activities.map((order) => ({
      id: order.id,
      type: 'order',
      message: `New order ${order.order_number} from ${order.customer_name || 'Unknown'}`,
      timestamp: order.created_at,
    }))

    res.json({
      success: true,
      data: formattedActivities,
    })
  } catch (error) {
    console.error('Dashboard activities error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch activities' })
  }
})

// Get monthly sales chart data (last 6 months)
router.get('/charts', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const months: { month: string; label: string; revenue: number; orders: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const yyyy = String(d.getFullYear())
      const label = d.toLocaleString('th-TH', { month: 'short', year: '2-digit' })

      const row = db.prepare(`
        SELECT COALESCE(SUM(o.total_amount), 0) as revenue, COUNT(*) as orders
        FROM orders o
        JOIN customers c ON o.customer_id = c.id
        WHERE c.tenant_id = ?
          AND strftime('%m', o.order_date) = ?
          AND strftime('%Y', o.order_date) = ?
      `).get(tenantId, mm, yyyy) as any

      months.push({ month: `${yyyy}-${mm}`, label, revenue: row.revenue || 0, orders: row.orders || 0 })
    }

    res.json({ success: true, data: months })
  } catch (error) {
    console.error('Dashboard charts error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch chart data' })
  }
})

// Get low stock items
router.get('/low-stock', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const items = db.prepare(`
      SELECT id, name, sku, quantity, min_stock, unit
      FROM stock_items
      WHERE tenant_id = ? AND quantity <= min_stock
      ORDER BY (quantity * 1.0 / NULLIF(min_stock, 0)) ASC
      LIMIT 8
    `).all(tenantId)

    res.json({ success: true, data: items })
  } catch (error) {
    console.error('Dashboard low-stock error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch low stock' })
  }
})

// Revenue & Gross Profit comparison by period
router.get('/revenue', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const period = (req.query.period as string) || 'month'

    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')

    // Build date range strings for current and previous period
    const getRange = (offset: number): { start: string; end: string } => {
      const d = new Date(now)
      if (period === 'day') {
        d.setDate(d.getDate() - offset)
        const s = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
        return { start: s + 'T00:00:00', end: s + 'T23:59:59' }
      } else if (period === 'week') {
        const day = d.getDay() || 7
        d.setDate(d.getDate() - day + 1 - offset * 7)
        const start = new Date(d)
        const end = new Date(d); end.setDate(end.getDate() + 6)
        return {
          start: `${start.getFullYear()}-${pad(start.getMonth()+1)}-${pad(start.getDate())}T00:00:00`,
          end: `${end.getFullYear()}-${pad(end.getMonth()+1)}-${pad(end.getDate())}T23:59:59`
        }
      } else if (period === 'month') {
        const y = offset === 0 ? d.getFullYear() : (d.getMonth() === 0 ? d.getFullYear()-1 : d.getFullYear())
        const m = offset === 0 ? d.getMonth() : (d.getMonth() === 0 ? 11 : d.getMonth() - 1)
        const lastDay = new Date(y, m+1, 0).getDate()
        return {
          start: `${y}-${pad(m+1)}-01T00:00:00`,
          end: `${y}-${pad(m+1)}-${pad(lastDay)}T23:59:59`
        }
      } else { // year
        const y = d.getFullYear() - offset
        return { start: `${y}-01-01T00:00:00`, end: `${y}-12-31T23:59:59` }
      }
    }

    const cur = getRange(0)
    const prev = getRange(1)

    const revenueQuery = `
      SELECT COALESCE(SUM(i.total_amount), 0) as revenue
      FROM invoices i JOIN customers c ON i.customer_id = c.id
      WHERE c.tenant_id = ? AND i.status NOT IN ('CANCELLED','DRAFT')
        AND i.invoice_date >= ? AND i.invoice_date <= ?`

    const costQuery = `
      SELECT COALESCE(SUM(po.total_amount), 0) as cost
      FROM purchase_orders po
      WHERE po.tenant_id = ? AND po.status = 'RECEIVED'
        AND po.received_date >= ? AND po.received_date <= ?`

    const curRev  = (db.prepare(revenueQuery).get(tenantId, cur.start, cur.end) as any).revenue
    const prevRev = (db.prepare(revenueQuery).get(tenantId, prev.start, prev.end) as any).revenue
    const curCost  = (db.prepare(costQuery).get(tenantId, cur.start, cur.end) as any).cost
    const prevCost = (db.prepare(costQuery).get(tenantId, prev.start, prev.end) as any).cost

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

// Cash flow forecast — AR and AP grouped by due date
router.get('/cashflow-forecast', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    const week7  = new Date(today); week7.setDate(today.getDate() + 7)
    const month30 = new Date(today); month30.setDate(today.getDate() + 30)
    const week7Str  = week7.toISOString().slice(0, 10)
    const month30Str = month30.toISOString().slice(0, 10)

    // AR: unpaid invoices
    const arRows = db.prepare(`
      SELECT i.id, i.invoice_number as doc_number,
        i.due_date, i.balance_amount as amount,
        c.name as party_name
      FROM invoices i JOIN customers c ON i.customer_id = c.id
      WHERE c.tenant_id = ? AND i.payment_status NOT IN ('PAID')
        AND i.status NOT IN ('CANCELLED','DRAFT')
        AND i.balance_amount > 0
      ORDER BY i.due_date ASC
    `).all(tenantId) as any[]

    // AP: purchase orders not fully received
    const apRows = db.prepare(`
      SELECT po.id, po.po_number as doc_number,
        po.expected_date as due_date, po.total_amount as amount,
        s.name as party_name
      FROM purchase_orders po JOIN suppliers s ON po.supplier_id = s.id
      WHERE po.tenant_id = ? AND po.status IN ('APPROVED','ORDERED','PARTIAL')
      ORDER BY po.expected_date ASC
    `).all(tenantId) as any[]

    const classify = (rows: any[]) => {
      const groups: Record<string, any[]> = { overdue: [], today: [], week: [], month: [], later: [] }
      let total = 0
      for (const r of rows) {
        const due = r.due_date ? r.due_date.slice(0, 10) : null
        total += r.amount || 0
        if (!due)               { groups.later.push(r); continue }
        if (due < todayStr)     { groups.overdue.push(r) }
        else if (due === todayStr) { groups.today.push(r) }
        else if (due <= week7Str)  { groups.week.push(r) }
        else if (due <= month30Str){ groups.month.push(r) }
        else                       { groups.later.push(r) }
      }
      const sum = (arr: any[]) => arr.reduce((s, r) => s + (r.amount||0), 0)
      return { ...groups, total, weekTotal: sum(groups.overdue)+sum(groups.today)+sum(groups.week), monthTotal: sum(groups.overdue)+sum(groups.today)+sum(groups.week)+sum(groups.month) }
    }

    const ar = classify(arRows)
    const ap = classify(apRows)

    res.json({
      success: true,
      data: {
        ar,
        ap,
        netCashflow: {
          week: ar.weekTotal - ap.weekTotal,
          month: ar.monthTotal - ap.monthTotal,
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
      FROM sales_orders WHERE tenant_id = ? AND status IN ('CONFIRMED','PROCESSING','APPROVED')
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

    const now = new Date()
    let dateFilter = ''
    if (period === 'day') {
      dateFilter = `AND date(i.invoice_date) = date('now')`
    } else if (period === 'week') {
      dateFilter = `AND i.invoice_date >= date('now', '-7 days')`
    } else if (period === 'month') {
      dateFilter = `AND strftime('%Y-%m', i.invoice_date) = '${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}'`
    } else {
      dateFilter = `AND strftime('%Y', i.invoice_date) = '${now.getFullYear()}'`
    }

    const rows = db.prepare(`
      SELECT c.id, c.name, COUNT(i.id) as invoice_count,
        COALESCE(SUM(i.total_amount), 0) as revenue
      FROM invoices i JOIN customers c ON i.customer_id = c.id
      WHERE c.tenant_id = ? AND i.status NOT IN ('CANCELLED','DRAFT')
        ${dateFilter}
      GROUP BY c.id ORDER BY revenue DESC LIMIT 5
    `).all(tenantId)

    res.json({ success: true, data: rows })
  } catch (error) {
    console.error('Dashboard top-customers error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch top customers' })
  }
})

export default router
