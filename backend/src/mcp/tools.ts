// MCP tool handlers for mini-ERP
// SQL queries reuse the same patterns as agent/commands.ts

import { z } from 'zod'
import db from '../db/sqlite'
import { IMcpServer } from './sdk-compat'

type ToolResult = { content: Array<{ type: 'text'; text: string }> }
const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
})

export function registerTools(server: IMcpServer, tenantId: string): void {
  server.tool(
    'query_stock',
    'ค้นหาสินค้าในคลัง / Search inventory stock levels',
    {
      keyword: z.string().optional().describe('ชื่อสินค้าหรือ SKU'),
      low_stock_only: z.boolean().optional().describe('แสดงเฉพาะสินค้าที่ต่ำกว่า min_stock'),
    },
    async (args) => {
      const keyword = args.keyword ?? ''
      const lowOnly = args.low_stock_only ?? false
      const term = `%${keyword}%`
      const where = lowOnly ? 'AND quantity <= min_stock' : ''
      const rows = db.prepare(
        `SELECT sku, name, quantity, unit, min_stock, unit_cost, location
         FROM stock_items WHERE tenant_id = ? AND (name LIKE ? OR sku LIKE ?) ${where}
         ORDER BY name LIMIT 30`
      ).all(tenantId, term, term)
      return ok({ count: rows.length, items: rows })
    }
  )

  server.tool(
    'query_sales',
    'ดูยอดขายและรายได้ / Query sales and revenue summary',
    {
      period: z.enum(['7d', '30d', '90d']).optional().describe('ช่วงเวลา: 7d/30d/90d'),
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
      return ok({ period, total_revenue: total, days_data: rows })
    }
  )

  server.tool(
    'get_executive_summary',
    'ดูภาพรวม ERP: สต็อก ยอดขาย PO ใบสั่งผลิต / Full ERP dashboard snapshot',
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

      return ok({
        stock: { totalItems: stock.total_items, lowStock: stock.low_stock, stockValue: stock.stock_value },
        sales_30d: { orders: sales.orders, revenue: sales.revenue },
        purchase: { openPOs: purchase.pos, committedSpend: purchase.committed },
        production: { activeWorkOrders: work.active_wo },
      })
    }
  )

  server.tool(
    'create_purchase_request',
    'สร้างใบขอซื้อวัตถุดิบ / Create a purchase request (PR)',
    {
      description: z.string().describe('รายละเอียดการขอซื้อ'),
      items: z.array(z.object({
        name: z.string(),
        qty: z.number(),
        unit: z.string(),
      })).optional().describe('รายการวัตถุดิบ'),
    },
    async (args) => {
      const desc = args.description ?? ''
      const id = crypto.randomUUID().replace(/-/g, '').substring(0, 25)
      const count = (db.prepare('SELECT COUNT(*) as c FROM purchase_requests').get() as { c: number }).c
      const prNumber = `PR-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO purchase_requests (id, tenant_id, pr_number, status, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'DRAFT', ?, 'mcp-agent', ?, ?)`
      ).run(id, tenantId, prNumber, desc, now, now)
      return ok({ prNumber, prId: id, status: 'DRAFT' })
    }
  )

  server.tool(
    'query_bom',
    'ค้นหาสูตรผลิตภัณฑ์ BOM / Query Bill of Materials and ingredient list',
    {
      product_name: z.string().optional().describe('ชื่อสินค้าหรือ BOM ที่ต้องการค้นหา'),
    },
    async (args) => {
      const name = args.product_name ?? ''
      const term = `%${name}%`
      const boms = db.prepare(
        `SELECT b.id, b.name, b.status, b.total_cost, b.yield_qty, b.yield_unit
         FROM boms b WHERE b.tenant_id = ? AND b.name LIKE ? LIMIT 5`
      ).all(tenantId, term) as Array<{ id: string; name: string; status: string; total_cost: number; yield_qty: number; yield_unit: string }>

      const result = boms.map((bom) => {
        const items = db.prepare(
          `SELECT bi.quantity, bi.unit,
                  COALESCE(m.name, p.name, 'Unknown') as material_name,
                  COALESCE(m.unit_cost, 0) as unit_cost
           FROM bom_items bi
           LEFT JOIN materials m ON bi.material_id = m.id
           LEFT JOIN products p ON bi.product_id = p.id
           WHERE bi.bom_id = ?`
        ).all(bom.id)
        return { ...bom, items }
      })
      return ok({ boms: result, count: result.length })
    }
  )

  server.tool(
    'query_customers',
    'ค้นหาข้อมูลลูกค้า / Search customer records',
    {
      keyword: z.string().optional().describe('ชื่อ เบอร์โทร หรือรหัสลูกค้า'),
    },
    async (args) => {
      const keyword = args.keyword ?? ''
      const term = `%${keyword}%`
      const rows = db.prepare(
        `SELECT code, name, phone, email, credit_limit, status
         FROM customers WHERE tenant_id = ? AND (name LIKE ? OR phone LIKE ? OR code LIKE ?) LIMIT 10`
      ).all(tenantId, term, term, term)
      return ok({ count: rows.length, customers: rows })
    }
  )

  server.tool(
    'get_work_orders',
    'ดูใบสั่งผลิต / View work orders status',
    {
      status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional()
        .describe('กรองตามสถานะ (ไม่ระบุ = แสดงที่กำลังดำเนินการ)'),
    },
    async (args) => {
      const status = args.status
      const rows = status
        ? db.prepare(
            `SELECT wo.wo_number, p.name as product, wo.quantity, wo.status, wo.planned_start, wo.notes
             FROM work_orders wo LEFT JOIN products p ON wo.product_id = p.id
             WHERE wo.tenant_id = ? AND wo.status = ? ORDER BY wo.created_at DESC LIMIT 20`
          ).all(tenantId, status)
        : db.prepare(
            `SELECT wo.wo_number, p.name as product, wo.quantity, wo.status, wo.planned_start, wo.notes
             FROM work_orders wo LEFT JOIN products p ON wo.product_id = p.id
             WHERE wo.tenant_id = ? AND wo.status IN ('PLANNED','IN_PROGRESS')
             ORDER BY wo.created_at DESC LIMIT 20`
          ).all(tenantId)
      return ok({ count: rows.length, work_orders: rows })
    }
  )

  server.tool(
    'query_purchases',
    'ดูสถานะใบสั่งซื้อ PO / View purchase orders',
    {
      status: z.enum(['DRAFT', 'PENDING', 'APPROVED', 'PARTIAL', 'RECEIVED', 'CANCELLED']).optional()
        .describe('กรองตามสถานะ (ไม่ระบุ = แสดงที่รอดำเนินการ)'),
    },
    async (args) => {
      const status = args.status
      const rows = status
        ? db.prepare(
            `SELECT po.po_number, s.name as supplier, po.total_amount, po.status, po.expected_date
             FROM purchase_orders po LEFT JOIN suppliers s ON po.supplier_id = s.id
             WHERE po.tenant_id = ? AND po.status = ? ORDER BY po.created_at DESC LIMIT 20`
          ).all(tenantId, status)
        : db.prepare(
            `SELECT po.po_number, s.name as supplier, po.total_amount, po.status, po.expected_date
             FROM purchase_orders po LEFT JOIN suppliers s ON po.supplier_id = s.id
             WHERE po.tenant_id = ? AND po.status IN ('PENDING','APPROVED','PARTIAL')
             ORDER BY po.created_at DESC LIMIT 20`
          ).all(tenantId)
      return ok({ count: rows.length, purchase_orders: rows })
    }
  )
}
