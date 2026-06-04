// ─── Lean Command Registry ──────────────────────────────────────────────────
// Plain object of functions. No classes, no decorators, no DI.

import { AgentContext, AgentCommand } from './types'

const commands: Record<string, AgentCommand> = {
  // ── Queries ──────────────────────────────────────────────────────────────
  async query_stock(ctx: AgentContext, payload: { query?: string; limit?: number }) {
    const term = `%${payload.query ?? ''}%`
    const limit = payload.limit ?? 20
    const rows = ctx.db.prepare(
      `SELECT id, sku, name, category, quantity, unit, min_stock, max_stock, location, status
       FROM stock_items WHERE tenant_id = ? AND (name LIKE ? OR sku LIKE ?)
       ORDER BY name LIMIT ?`
    ).all(ctx.tenantId, term, term, limit)
    return { type: 'stock_list', count: rows.length, items: rows }
  },

  async query_sales(ctx: AgentContext, payload: { period?: '7d' | '30d' | '90d' | '1y' }) {
    const period = payload.period ?? '30d'
    const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }
    const days = daysMap[period] ?? 30
    const rows = ctx.db.prepare(
      `SELECT strftime('%Y-%m', created_at) as month,
              COUNT(*) as order_count,
              COALESCE(SUM(total_amount), 0) as revenue
       FROM sales_orders
       WHERE tenant_id = ? AND created_at >= date('now', '-${days} days') AND status != 'CANCELLED'
       GROUP BY month ORDER BY month`
    ).all(ctx.tenantId)
    return { type: 'sales_summary', period, data: rows }
  },

  async get_executive_summary(ctx: AgentContext) {
    const stock = ctx.db.prepare(
      `SELECT COUNT(*) as total_items,
              SUM(CASE WHEN quantity <= min_stock THEN 1 ELSE 0 END) as low_stock,
              COALESCE(SUM(quantity * unit_cost), 0) as stock_value
       FROM stock_items WHERE tenant_id = ?`
    ).get(ctx.tenantId) as any

    const sales = ctx.db.prepare(
      `SELECT COUNT(*) as orders,
              COALESCE(SUM(total_amount), 0) as revenue
       FROM sales_orders
       WHERE tenant_id = ? AND created_at >= date('now', '-30 days') AND status != 'CANCELLED'`
    ).get(ctx.tenantId) as any

    const purchase = ctx.db.prepare(
      `SELECT COUNT(*) as pos,
              COALESCE(SUM(total_amount), 0) as committed
       FROM purchase_orders
       WHERE tenant_id = ? AND status IN ('APPROVED', 'PARTIAL')`
    ).get(ctx.tenantId) as any

    const work = ctx.db.prepare(
      `SELECT COUNT(*) as active_wo
       FROM work_orders WHERE tenant_id = ? AND status IN ('PLANNED', 'IN_PROGRESS')`
    ).get(ctx.tenantId) as any

    return {
      type: 'executive_summary',
      tenantId: ctx.tenantId,
      stock: { totalItems: stock.total_items, lowStock: stock.low_stock, stockValue: stock.stock_value },
      sales: { orders30d: sales.orders, revenue30d: sales.revenue },
      purchase: { openPOs: purchase.pos, committedSpend: purchase.committed },
      production: { activeWorkOrders: work.active_wo },
    }
  },

  // ── Mutations ────────────────────────────────────────────────────────────
  async create_pr(ctx: AgentContext, payload: { description: string; items?: Array<{ name: string; qty: number; unit: string }> }) {
    const id = crypto.randomUUID().replace(/-/g, '').substring(0, 25)
    const prNumber = `PR-${new Date().getFullYear()}-${String(ctx.db.prepare('SELECT COUNT(*) as c FROM purchase_requests').get().c + 1).padStart(5, '0')}`
    const now = new Date().toISOString()
    ctx.db.prepare(
      `INSERT INTO purchase_requests (id, tenant_id, pr_number, status, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'DRAFT', ?, 'ai-agent', ?, ?)`
    ).run(id, ctx.tenantId, prNumber, payload.description ?? '', now, now)
    return { type: 'pr_created', prId: id, prNumber }
  },

  async create_wo(ctx: AgentContext, payload: { description: string; productId?: string; quantity?: number }) {
    const id = crypto.randomUUID().replace(/-/g, '').substring(0, 25)
    const woNumber = `WO-${new Date().getFullYear()}-${String(ctx.db.prepare('SELECT COUNT(*) as c FROM work_orders').get().c + 1).padStart(5, '0')}`
    const now = new Date().toISOString()
    ctx.db.prepare(
      `INSERT INTO work_orders (id, tenant_id, wo_number, product_id, quantity, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'PLANNED', ?, ?, ?)`
    ).run(id, ctx.tenantId, woNumber, payload.productId ?? null, payload.quantity ?? 1, payload.description ?? '', now, now)
    return { type: 'wo_created', woId: id, woNumber }
  },

  async approve_po(ctx: AgentContext, payload: { poId: string }) {
    const existing = ctx.db.prepare('SELECT id, status FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(payload.poId, ctx.tenantId) as any
    if (!existing) throw new Error('PO not found')
    if (existing.status === 'APPROVED') return { type: 'po_approve', status: 'already_approved', poId: payload.poId }
    ctx.db.prepare(`UPDATE purchase_orders SET status = 'APPROVED', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), payload.poId)
    return { type: 'po_approved', poId: payload.poId }
  },
}

export default commands
