import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { ok } from './shared'

export function registerSummaryTools(server: IMcpServer, tenantId: string): void {
  // ── 2. get_summary ─────────────────────────────────────────────────────────
  server.tool(
    'get_summary',
    'ดูภาพรวม ERP: สต็อก ยอดขาย PO ใบสั่งผลิต / Full ERP dashboard snapshot. ใช้เมื่อถามสรุปภาพรวม สถานการณ์ทั้งหมด หรือ dashboard',
    {},
    async () => {
      const stock = db.prepare(
        `SELECT COUNT(*) as total_items,
                SUM(CASE WHEN quantity <= min_stock THEN 1 ELSE 0 END) as low_stock,
                COALESCE(SUM(quantity * unit_cost), 0) as stock_value
         FROM stock_items WHERE tenant_id = ?`
      ).get(tenantId) as { total_items: number; low_stock: number; stock_value: number }

      const sales = db.prepare(
        `SELECT COUNT(*) as orders, COALESCE(SUM(total_amount), 0) as revenue
         FROM sales_orders
         WHERE tenant_id = ? AND created_at >= date('now', '-30 days') AND status != 'CANCELLED'`
      ).get(tenantId) as { orders: number; revenue: number }

      const purchase = db.prepare(
        `SELECT COUNT(*) as pos, COALESCE(SUM(total_amount), 0) as committed
         FROM purchase_orders WHERE tenant_id = ? AND status IN ('APPROVED','PARTIAL')`
      ).get(tenantId) as { pos: number; committed: number }

      const work = db.prepare(
        `SELECT COUNT(*) as active_wo
         FROM work_orders WHERE tenant_id = ? AND status IN ('PLANNED','IN_PROGRESS')`
      ).get(tenantId) as { active_wo: number }

      const lowStockItems = db.prepare(
        `SELECT name, quantity, unit, min_stock FROM stock_items
         WHERE tenant_id = ? AND quantity <= min_stock ORDER BY (quantity - min_stock) LIMIT 5`
      ).all(tenantId)

      return ok({
        stock: {
          totalItems: stock.total_items,
          lowStock: stock.low_stock,
          stockValue: stock.stock_value,
          lowStockItems,
        },
        sales_30d: { orders: sales.orders, revenue: sales.revenue },
        purchase: { openPOs: purchase.pos, committedSpend: purchase.committed },
        production: { activeWorkOrders: work.active_wo },
      })
    }
  )

  // ── 3. get_sales ───────────────────────────────────────────────────────────
  server.tool(
    'get_sales',
    'ดูยอดขายและรายได้แยกตามช่วงเวลา / Query sales revenue over a time period. ใช้เมื่อถามยอดขาย รายได้ ออเดอร์',
    {
      period: z.enum(['7d', '30d', '90d']).optional()
        .describe('ช่วงเวลา: 7d=7วัน 30d=เดือนนี้ 90d=3เดือน (default: 30d)'),
    },
    async (args) => {
      const period = args.period ?? '30d'
      const days = ({ '7d': 7, '30d': 30, '90d': 90 } as Record<string, number>)[period] ?? 30
      const rows = db.prepare(
        `SELECT strftime('%Y-%m-%d', created_at) as date,
                COUNT(*) as order_count,
                COALESCE(SUM(total_amount), 0) as revenue
         FROM sales_orders
         WHERE tenant_id = ? AND created_at >= date('now', ?) AND status != 'CANCELLED'
         GROUP BY date ORDER BY date`
      ).all(tenantId, `-${days} days`) as Array<{ date: string; order_count: number; revenue: number }>
      const total = rows.reduce((s, r) => s + r.revenue, 0)
      const totalOrders = rows.reduce((s, r) => s + r.order_count, 0)
      return ok({ period, total_revenue: total, total_orders: totalOrders, daily: rows })
    }
  )

  // ── 4. get_orders ──────────────────────────────────────────────────────────
  server.tool(
    'get_orders',
    `ดูใบสั่งผลิต (WO) และใบสั่งซื้อ (PO) / View work orders and purchase orders.
ใช้เมื่อถามเกี่ยวกับการผลิต ใบสั่งซื้อ หรือสถานะออเดอร์
type: "wo"=ใบสั่งผลิต "po"=ใบสั่งซื้อ ไม่ระบุ=ทั้งคู่`,
    {
      type: z.enum(['wo', 'po']).optional().describe('"wo"=work orders, "po"=purchase orders, ไม่ระบุ=ทั้งคู่'),
      status: z.string().optional().describe('สถานะ: WO=PLANNED/IN_PROGRESS/COMPLETED/CANCELLED, PO=DRAFT/PENDING/APPROVED/PARTIAL/RECEIVED/CANCELLED'),
    },
    async (args) => {
      const { type, status } = args
      const result: Record<string, unknown> = {}

      if (!type || type === 'wo') {
        const statusFilter = status
          ? 'AND wo.status = ?'
          : "AND wo.status IN ('PLANNED','IN_PROGRESS')"
        const params = status ? [tenantId, status] : [tenantId]
        result.work_orders = db.prepare(
          `SELECT wo.wo_number, wo.product_name as product, wo.quantity, wo.status,
                  wo.start_date as planned_start, wo.due_date as planned_end, wo.notes
           FROM work_orders wo
           WHERE wo.tenant_id = ? ${statusFilter}
           ORDER BY wo.created_at DESC LIMIT 20`
        ).all(...params)
      }

      if (!type || type === 'po') {
        const statusFilter = status
          ? 'AND po.status = ?'
          : "AND po.status IN ('PENDING','APPROVED','PARTIAL')"
        const params = status ? [tenantId, status] : [tenantId]
        result.purchase_orders = db.prepare(
          `SELECT po.po_number, s.name as supplier, po.total_amount, po.status,
                  po.expected_date, po.notes
           FROM purchase_orders po LEFT JOIN suppliers s ON po.supplier_id = s.id
           WHERE po.tenant_id = ? ${statusFilter}
           ORDER BY po.created_at DESC LIMIT 20`
        ).all(...params)
      }

      return ok(result)
    }
  )
}
