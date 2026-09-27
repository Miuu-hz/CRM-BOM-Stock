import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { ok } from './shared'
import { arAging, apAging } from '../../routes/receivables.routes'

export function registerFinanceTools(server: IMcpServer, tenantId: string): void {
  // ── 19–20. get_ar_aging / get_ap_aging ──────────────────────────────────────
  // เรียก arAging/apAging ตัวเดียวกับ REST /api/receivables — เดิมเขียน SQL ซ้ำเองแล้วหลุด:
  // นับใบ DRAFT/CANCELLED, ตัดที่ LIMIT 50, bucket ไม่ตรง REST, ไม่มีที่อยู่/เลขภาษี (แก้ 2026-09-27)
  const agingArgs = (partyLabel: string) => ({
    overdue_only: z.boolean().optional().describe('true=เฉพาะบิลที่เกินกำหนดแล้ว (default: false)'),
    [`${partyLabel}_name`]: z.string().optional().describe(`กรองเฉพาะ ${partyLabel} ที่ชื่อมีคำนี้`),
    as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('นับอายุหนี้ ณ วันที่ YYYY-MM-DD (default: วันนี้)'),
  })

  const agingHandler = (build: typeof arAging, partyLabel: string) => async (args: any) => {
    const asOf = args.as_of ?? new Date().toISOString().slice(0, 10)
    const nameFilter = (args[`${partyLabel}_name`] ?? '').toLowerCase()
    const data = build(tenantId, asOf)
    if (!nameFilter && !args.overdue_only) return ok(data)

    // กรองบนผลลัพธ์ แล้วคำนวณยอดรวมใหม่จากบิลที่เหลือ (ยอดรวมต้องตรงกับรายการที่แสดง)
    const parties = data.parties
      .filter((p: any) => !nameFilter || String(p.name).toLowerCase().includes(nameFilter))
      .map((p: any) => {
        const docs = args.overdue_only ? p.docs.filter((d: any) => d.bucket !== 'current') : p.docs
        return { ...p, docs, total: docs.reduce((s: number, d: any) => s + d.balance, 0) }
      })
      .filter((p: any) => p.docs.length > 0)
    const docs = parties.flatMap((p: any) => p.docs)
    const outstanding = docs.reduce((s: number, d: any) => s + d.balance, 0)
    const overdue = docs.filter((d: any) => d.bucket !== 'current').reduce((s: number, d: any) => s + d.balance, 0)
    return ok({
      asOf,
      filter: { name: nameFilter || null, overdue_only: !!args.overdue_only },
      totals: { outstanding, overdue, docCount: docs.length, partyCount: parties.length },
      parties,
    })
  }

  server.tool(
    'get_ar_aging',
    `ดูลูกหนี้การค้า (AR Aging) — ลูกค้าใครยังไม่จ่ายเงิน ค้างนานแค่ไหน / Accounts Receivable aging report.
ใช้เมื่อถาม "ลูกค้าใครค้างชำระ" "บิลไหนเกินกำหนด" "ยอดลูกหนี้รวมเท่าไหร่" หรือทำจดหมายยืนยันยอด/ติดตามหนี้
แสดง: ยอดรวม, bucket อายุหนี้, รายลูกค้า (ที่อยู่, เลขผู้เสียภาษี, บิลแต่ละใบ พร้อมจำนวนวันที่เกินกำหนด)`,
    agingArgs('customer'),
    agingHandler(arAging, 'customer')
  )

  server.tool(
    'get_ap_aging',
    `ดูเจ้าหนี้การค้า (AP Aging) — เราค้างจ่าย Supplier ไหน ครบกำหนดแล้วหรือยัง / Accounts Payable aging report.
ใช้เมื่อถาม "เราต้องจ่าย supplier ไหนบ้าง" "บิลซื้อไหนถึงกำหนดแล้ว" "ยอดเจ้าหนี้รวมเท่าไหร่" หรือทำจดหมายยืนยันยอดเจ้าหนี้`,
    agingArgs('supplier'),
    agingHandler(apAging, 'supplier')
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
          AND status NOT IN ('CANCELLED','DRAFT')
      `).get(tenantId) as any

      // ยอด AP รวม (เจ้าหนี้ทั้งหมดที่ยังค้างอยู่)
      const apTotal = db.prepare(`
        SELECT COALESCE(SUM(balance_amount), 0) as total,
               COUNT(*) as count
        FROM purchase_invoices
        WHERE tenant_id = ? AND payment_status IN ('UNPAID','PARTIAL')
          AND status NOT IN ('CANCELLED','DRAFT')
      `).get(tenantId) as any

      // บิลเกินกำหนด
      const arOverdue = db.prepare(`
        SELECT COALESCE(SUM(balance_amount), 0) as total, COUNT(*) as count
        FROM invoices
        WHERE tenant_id = ? AND payment_status IN ('UNPAID','PARTIAL')
          AND status NOT IN ('CANCELLED','DRAFT')
          AND due_date IS NOT NULL AND date(due_date) < date('now')
      `).get(tenantId) as any

      const apOverdue = db.prepare(`
        SELECT COALESCE(SUM(balance_amount), 0) as total, COUNT(*) as count
        FROM purchase_invoices
        WHERE tenant_id = ? AND payment_status IN ('UNPAID','PARTIAL')
          AND status NOT IN ('CANCELLED','DRAFT')
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
