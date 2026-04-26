// ─── Lean Analytics Routes ──────────────────────────────────────────────────
// Read-only executive insights for Paperclip agents (and humans).

import { Router, Request, Response } from 'express'
import db from '../db/sqlite'

const router = Router()

// Helper to assert tenant
function getTenant(req: Request): string {
  return (req as any).user?.tenantId ?? ''
}

// GET /api/analytics/executive-summary
router.get('/executive-summary', (req: Request, res: Response) => {
  try {
    const tenantId = getTenant(req)
    if (!tenantId) return res.status(401).json({ success: false, message: 'Unauthorized' })

    const stock = db.prepare(
      `SELECT COUNT(*) as total_items,
              SUM(CASE WHEN quantity <= min_stock THEN 1 ELSE 0 END) as low_stock,
              COALESCE(SUM(quantity * unit_cost), 0) as stock_value
       FROM stock_items WHERE tenant_id = ?`
    ).get(tenantId) as any

    const sales = db.prepare(
      `SELECT COUNT(*) as orders,
              COALESCE(SUM(total_amount), 0) as revenue
       FROM sales_orders
       WHERE tenant_id = ? AND created_at >= date('now', '-30 days') AND status != 'CANCELLED'`
    ).get(tenantId) as any

    const purchase = db.prepare(
      `SELECT COUNT(*) as pos,
              COALESCE(SUM(total_amount), 0) as committed
       FROM purchase_orders
       WHERE tenant_id = ? AND status IN ('APPROVED', 'PARTIAL')`
    ).get(tenantId) as any

    const work = db.prepare(
      `SELECT COUNT(*) as active_wo
       FROM work_orders WHERE tenant_id = ? AND status IN ('PLANNED', 'IN_PROGRESS')`
    ).get(tenantId) as any

    res.json({
      success: true,
      data: {
        stock: { totalItems: stock.total_items, lowStock: stock.low_stock, stockValue: stock.stock_value },
        sales: { orders30d: sales.orders, revenue30d: sales.revenue },
        purchase: { openPOs: purchase.pos, committedSpend: purchase.committed },
        production: { activeWorkOrders: work.active_wo },
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error('Executive summary error:', err)
    res.status(500).json({ success: false, message: 'Failed to generate summary' })
  }
})

// GET /api/analytics/trends
router.get('/trends', (req: Request, res: Response) => {
  try {
    const tenantId = getTenant(req)
    if (!tenantId) return res.status(401).json({ success: false, message: 'Unauthorized' })

    const { period = '6' } = req.query as { period?: string }
    const months = Math.min(parseInt(period) || 6, 24)

    const salesTrend = db.prepare(
      `SELECT strftime('%Y-%m', created_at) as month,
              COUNT(*) as orders,
              COALESCE(SUM(total_amount), 0) as revenue
       FROM sales_orders
       WHERE tenant_id = ? AND status != 'CANCELLED'
         AND created_at >= date('now', '-${months} months')
       GROUP BY month ORDER BY month`
    ).all(tenantId)

    const purchaseTrend = db.prepare(
      `SELECT strftime('%Y-%m', created_at) as month,
              COUNT(*) as pos,
              COALESCE(SUM(total_amount), 0) as spend
       FROM purchase_orders
       WHERE tenant_id = ? AND status IN ('APPROVED', 'PARTIAL', 'COMPLETED')
         AND created_at >= date('now', '-${months} months')
       GROUP BY month ORDER BY month`
    ).all(tenantId)

    res.json({
      success: true,
      data: { months, sales: salesTrend, purchase: purchaseTrend },
    })
  } catch (err) {
    console.error('Trends error:', err)
    res.status(500).json({ success: false, message: 'Failed to fetch trends' })
  }
})

// GET /api/analytics/export/:entity
router.get('/export/:entity', (req: Request, res: Response) => {
  try {
    const tenantId = getTenant(req)
    if (!tenantId) return res.status(401).json({ success: false, message: 'Unauthorized' })

    const { entity } = req.params
    const { from, to } = req.query as { from?: string; to?: string }

    const allowedEntities = ['customers', 'sales_orders', 'purchase_orders', 'stock_items', 'invoices', 'work_orders']
    if (!allowedEntities.includes(entity)) {
      return res.status(400).json({ success: false, message: `Allowed: ${allowedEntities.join(', ')}` })
    }

    let sql = `SELECT * FROM ${entity} WHERE tenant_id = ?`
    const params: any[] = [tenantId]

    if (from) { sql += ' AND created_at >= ?'; params.push(from) }
    if (to)   { sql += ' AND created_at <= ?'; params.push(to) }
    sql += ' ORDER BY created_at DESC LIMIT 10000'

    const rows = db.prepare(sql).all(...params)
    res.json({ success: true, count: rows.length, data: rows })
  } catch (err) {
    console.error('Export error:', err)
    res.status(500).json({ success: false, message: 'Export failed' })
  }
})

export default router
