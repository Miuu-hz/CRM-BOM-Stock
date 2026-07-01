import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { ok } from './shared'

export function registerFinanceTools(server: IMcpServer, tenantId: string): void {
  // ── 19. get_ar_aging ────────────────────────────────────────────────────────
  server.tool(
    'get_ar_aging',
    `ดูลูกหนี้การค้า (AR Aging) — ลูกค้าใครยังไม่จ่ายเงิน ค้างนานแค่ไหน / Accounts Receivable aging report.
ใช้เมื่อถาม "ลูกค้าใครค้างชำระ" "บิลไหนเกินกำหนด" "ยอดลูกหนี้รวมเท่าไหร่"
แสดง: ชื่อลูกค้า, เลขบิล, ยอดค้าง, วันครบกำหนด, จำนวนวันที่เกิน`,
    {
      overdue_only: z.boolean().optional().describe('true=เฉพาะที่เกินกำหนดแล้ว, false=ทั้งหมดที่ยังไม่จ่าย (default: false)'),
      customer_name: z.string().optional().describe('กรองเฉพาะลูกค้ารายนี้'),
    },
    async (args) => {
      const { overdue_only = false, customer_name } = args

      const overdueFilter = overdue_only ? "AND date(inv.due_date) < date('now')" : ''
      const customerFilter = customer_name ? 'AND c.name LIKE ?' : ''
      const params: any[] = [tenantId]
      if (customer_name) params.push(`%${customer_name}%`)

      const rows = db.prepare(`
        SELECT inv.invoice_number, inv.invoice_date, inv.due_date,
               inv.total_amount, inv.paid_amount, inv.balance_amount,
               inv.payment_status,
               c.name as customer_name, c.phone as customer_phone,
               CAST(julianday('now') - julianday(inv.due_date) AS INTEGER) as days_overdue
        FROM invoices inv
        JOIN customers c ON inv.customer_id = c.id
        WHERE inv.tenant_id = ?
          AND inv.payment_status IN ('UNPAID','PARTIAL')
          ${overdueFilter}
          ${customerFilter}
        ORDER BY days_overdue DESC, inv.due_date ASC
        LIMIT 50
      `).all(...params) as any[]

      const totalBalance = rows.reduce((s, r) => s + (r.balance_amount || 0), 0)
      const overdueCount = rows.filter(r => r.days_overdue > 0).length
      const overdueAmount = rows.filter(r => r.days_overdue > 0).reduce((s, r) => s + (r.balance_amount || 0), 0)

      // Bucket ตาม aging
      const bucket = (days: number) =>
        days <= 0 ? 'ยังไม่ถึงกำหนด' :
        days <= 30 ? '1-30 วัน' :
        days <= 60 ? '31-60 วัน' :
        days <= 90 ? '61-90 วัน' : 'เกิน 90 วัน'

      const buckets = rows.reduce((acc: Record<string, number>, r) => {
        const b = bucket(r.days_overdue)
        acc[b] = (acc[b] || 0) + (r.balance_amount || 0)
        return acc
      }, {})

      return ok({
        summary: { total_unpaid_invoices: rows.length, total_balance: totalBalance, overdue_count: overdueCount, overdue_amount: overdueAmount },
        aging_buckets: buckets,
        invoices: rows,
      })
    }
  )

  // ── 20. get_ap_aging ────────────────────────────────────────────────────────
  server.tool(
    'get_ap_aging',
    `ดูเจ้าหนี้การค้า (AP Aging) — เราค้างจ่าย Supplier ไหน ครบกำหนดแล้วหรือยัง / Accounts Payable aging report.
ใช้เมื่อถาม "เราต้องจ่าย supplier ไหนบ้าง" "บิลซื้อไหนถึงกำหนดแล้ว" "ยอดเจ้าหนี้รวมเท่าไหร่"`,
    {
      overdue_only: z.boolean().optional().describe('true=เฉพาะที่เกินกำหนดแล้ว (default: false)'),
      supplier_name: z.string().optional().describe('กรองเฉพาะ supplier รายนี้'),
    },
    async (args) => {
      const { overdue_only = false, supplier_name } = args

      const overdueFilter = overdue_only ? "AND date(pi.due_date) < date('now')" : ''
      const supplierFilter = supplier_name ? 'AND s.name LIKE ?' : ''
      const params: any[] = [tenantId]
      if (supplier_name) params.push(`%${supplier_name}%`)

      const rows = db.prepare(`
        SELECT pi.pi_number, pi.invoice_date, pi.due_date,
               pi.total_amount, pi.paid_amount, pi.balance_amount,
               pi.payment_status,
               s.name as supplier_name, s.phone as supplier_phone,
               CAST(julianday('now') - julianday(pi.due_date) AS INTEGER) as days_overdue
        FROM purchase_invoices pi
        JOIN suppliers s ON pi.supplier_id = s.id
        WHERE pi.tenant_id = ?
          AND pi.payment_status IN ('UNPAID','PARTIAL')
          ${overdueFilter}
          ${supplierFilter}
        ORDER BY days_overdue DESC, pi.due_date ASC
        LIMIT 50
      `).all(...params) as any[]

      const totalBalance = rows.reduce((s, r) => s + (r.balance_amount || 0), 0)
      const overdueCount = rows.filter(r => r.days_overdue > 0).length
      const overdueAmount = rows.filter(r => r.days_overdue > 0).reduce((s, r) => s + (r.balance_amount || 0), 0)

      const bucket = (days: number) =>
        days <= 0 ? 'ยังไม่ถึงกำหนด' :
        days <= 30 ? '1-30 วัน' :
        days <= 60 ? '31-60 วัน' :
        days <= 90 ? '61-90 วัน' : 'เกิน 90 วัน'

      const buckets = rows.reduce((acc: Record<string, number>, r) => {
        const b = bucket(r.days_overdue)
        acc[b] = (acc[b] || 0) + (r.balance_amount || 0)
        return acc
      }, {})

      return ok({
        summary: { total_unpaid_invoices: rows.length, total_balance: totalBalance, overdue_count: overdueCount, overdue_amount: overdueAmount },
        aging_buckets: buckets,
        invoices: rows,
      })
    }
  )

  // ── 21. get_financial_summary ───────────────────────────────────────────────
  server.tool(
    'get_financial_summary',
    `สรุปภาพรวมการเงิน — รายรับ รายจ่าย กำไรขั้นต้น ยอด AR/AP / Financial P&L and balance summary.
ใช้เมื่อถาม "สรุปบัญชีเดือนนี้" "รายรับรายจ่ายเป็นยังไง" "กำไรเดือนนี้เท่าไหร่" "ภาพรวมการเงิน"`,
    {
      period: z.enum(['7d', '30d', '90d', 'ytd']).optional()
        .describe('ช่วงเวลา: 7d=7วัน, 30d=เดือนนี้, 90d=3เดือน, ytd=ตั้งแต่ต้นปี (default: 30d)'),
    },
    async (args) => {
      const { period = '30d' } = args
      const dateFilter = period === 'ytd'
        ? `date('now','start of year')`
        : `date('now', '-${({ '7d': 7, '30d': 30, '90d': 90 } as Record<string, number>)[period] ?? 30} days')`

      // รายรับจากบิลขาย (invoices ที่ออกในช่วง)
      const revenue = db.prepare(`
        SELECT COALESCE(SUM(total_amount), 0) as total,
               COALESCE(SUM(paid_amount), 0) as collected,
               COALESCE(SUM(balance_amount), 0) as outstanding,
               COUNT(*) as invoice_count
        FROM invoices
        WHERE tenant_id = ? AND invoice_date >= ${dateFilter}
          AND status NOT IN ('CANCELLED','DRAFT')
      `).get(tenantId) as any

      // รายจ่ายจากบิลซื้อ (purchase_invoices)
      const expense = db.prepare(`
        SELECT COALESCE(SUM(total_amount), 0) as total,
               COALESCE(SUM(paid_amount), 0) as paid,
               COALESCE(SUM(balance_amount), 0) as outstanding,
               COUNT(*) as invoice_count
        FROM purchase_invoices
        WHERE tenant_id = ? AND invoice_date >= ${dateFilter}
          AND status NOT IN ('CANCELLED','DRAFT')
      `).get(tenantId) as any

      // ยอด AR รวม (ลูกหนี้ทั้งหมดที่ยังค้างอยู่)
      const arTotal = db.prepare(`
        SELECT COALESCE(SUM(balance_amount), 0) as total,
               COUNT(*) as count
        FROM invoices
        WHERE tenant_id = ? AND payment_status IN ('UNPAID','PARTIAL')
      `).get(tenantId) as any

      // ยอด AP รวม (เจ้าหนี้ทั้งหมดที่ยังค้างอยู่)
      const apTotal = db.prepare(`
        SELECT COALESCE(SUM(balance_amount), 0) as total,
               COUNT(*) as count
        FROM purchase_invoices
        WHERE tenant_id = ? AND payment_status IN ('UNPAID','PARTIAL')
      `).get(tenantId) as any

      // บิลเกินกำหนด
      const arOverdue = db.prepare(`
        SELECT COALESCE(SUM(balance_amount), 0) as total, COUNT(*) as count
        FROM invoices
        WHERE tenant_id = ? AND payment_status IN ('UNPAID','PARTIAL')
          AND due_date IS NOT NULL AND date(due_date) < date('now')
      `).get(tenantId) as any

      const apOverdue = db.prepare(`
        SELECT COALESCE(SUM(balance_amount), 0) as total, COUNT(*) as count
        FROM purchase_invoices
        WHERE tenant_id = ? AND payment_status IN ('UNPAID','PARTIAL')
          AND due_date IS NOT NULL AND date(due_date) < date('now')
      `).get(tenantId) as any

      const grossProfit = revenue.collected - expense.paid

      return ok({
        period,
        income: {
          total_invoiced: revenue.total,
          collected: revenue.collected,
          outstanding: revenue.outstanding,
          invoice_count: revenue.invoice_count,
        },
        expenses: {
          total_invoiced: expense.total,
          paid: expense.paid,
          outstanding: expense.outstanding,
          invoice_count: expense.invoice_count,
        },
        gross_profit: grossProfit,
        accounts_receivable: {
          total_outstanding: arTotal.total,
          invoice_count: arTotal.count,
          overdue_amount: arOverdue.total,
          overdue_count: arOverdue.count,
        },
        accounts_payable: {
          total_outstanding: apTotal.total,
          invoice_count: apTotal.count,
          overdue_amount: apOverdue.total,
          overdue_count: apOverdue.count,
        },
      })
    }
  )
}
