import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { ok } from './shared'
import { arAging, apAging } from '../../routes/receivables.routes'
import { buildTrialBalance, buildLedger } from '../../routes/reports.routes'

// ตัวเลขบัญชีทั้งเล่ม — ให้เห็นเฉพาะเจ้าของ (MASTER = master key) และ ADMIN
const LEDGER_ROLES = ['MASTER', 'ADMIN']
const YMD = /^\d{4}-\d{2}-\d{2}$/

export function registerFinanceTools(server: IMcpServer, tenantId: string, callerRole = 'USER'): void {
  // ── 19–20. get_ar_aging / get_ap_aging ──────────────────────────────────────
  // เรียก arAging/apAging ตัวเดียวกับ REST /api/receivables — เดิมเขียน SQL ซ้ำเองแล้วหลุด:
  // นับใบ DRAFT/CANCELLED, ตัดที่ LIMIT 50, bucket ไม่ตรง REST, ไม่มีที่อยู่/เลขภาษี (แก้ 2026-09-27)
  const agingArgs = (partyLabel: string) => ({
    overdue_only: z.boolean().optional().describe('true=เฉพาะบิลที่เกินกำหนดแล้ว (default: false)'),
    [`${partyLabel}_name`]: z.string().optional().describe(`กรองเฉพาะ ${partyLabel} ที่ชื่อมีคำนี้`),
    as_of: z.string().regex(YMD).optional().describe('นับอายุหนี้ ณ วันที่ YYYY-MM-DD (default: วันนี้)'),
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
    `สรุปภาพรวมการเงินจากบิลขาย/บิลซื้อ — ยอดออกบิล เงินรับ เงินจ่าย ยอด AR/AP / Invoice-based cash & balance summary.
ใช้เมื่อถาม "สรุปบัญชีเดือนนี้" "รายรับรายจ่ายเป็นยังไง" "ภาพรวมการเงิน" "เงินเข้าออกเท่าไหร่"
net_cash_flow = เงินรับจากบิลขาย − เงินจ่ายบิลซื้อ (เกณฑ์เงินสด) — ไม่ใช่กำไรทางบัญชี เพราะไม่ได้หักต้นทุนขาย/ค่าใช้จ่ายที่ไม่ผ่านบิลซื้อ
ถ้าผู้ใช้ถามว่า "เดือนนี้" ให้ใช้ period=mtd (ไม่ใช่ 30d)`,
    {
      period: z.enum(['7d', '30d', '90d', 'mtd', 'ytd']).optional()
        .describe('ช่วงเวลา: 7d/30d/90d = ย้อนหลัง 7/30/90 วันจากวันนี้, mtd=ตั้งแต่วันที่ 1 ของเดือนนี้, ytd=ตั้งแต่ต้นปี (default: 30d)'),
    },
    async (args) => {
      const { period = '30d' } = args
      const dateFilter = period === 'ytd' ? `date('now','start of year')`
        : period === 'mtd' ? `date('now','start of month')`
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

      // เกณฑ์เงินสด: เงินรับ − เงินจ่าย (เดิมชื่อ gross_profit ทำให้ AI ตอบว่าเป็นกำไร)
      const netCashFlow = revenue.collected - expense.paid

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
        net_cash_flow: netCashFlow,
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

  // ── get_trial_balance / get_ledger — ไม่ลงทะเบียนเลยถ้า role ไม่ถึง (AI ของ USER มองไม่เห็น tool นี้) ──
  if (!LEDGER_ROLES.includes(callerRole)) return

  const company = () => db.prepare(
    'SELECT name, address, tax_id, tax_branch, phone, email FROM company_settings WHERE tenant_id = ?'
  ).get(tenantId) ?? null
  const dateArg = (d: string) => z.string().regex(YMD).optional().describe(d)

  server.tool(
    'get_trial_balance',
    `งบทดลอง (Trial Balance) จากสมุดรายวันที่ผ่านรายการแล้ว / Trial balance from posted journals.
ใช้เมื่อถาม "งบทดลองดุลไหม" "ยอดคงเหลือแต่ละบัญชี" หรือทำงานตรวจงบทดลอง/กระดาษทำการ/วิเคราะห์งบการเงิน
แสดง: รายบัญชี (รหัส ชื่อ ประเภท หมวด) ยอดยกมา Dr/Cr, ความเคลื่อนไหว, ยอดคงเหลือ Dr/Cr + ยอดรวม + ข้อมูลบริษัท
ไม่ระบุ start_date = ไม่มียอดยกมา (นับทุกรายการตั้งแต่ต้น)`,
    {
      start_date: dateArg('วันเริ่มงวด YYYY-MM-DD (ยอดก่อนวันนี้เป็นยอดยกมา)'),
      end_date: dateArg('วันสิ้นงวด YYYY-MM-DD'),
    },
    async (args) => ok({ company: company(), ...buildTrialBalance(tenantId, args.start_date, args.end_date) })
  )

  server.tool(
    'get_ledger',
    `บัญชีแยกประเภท (General Ledger) ของบัญชีเดียว / Ledger of one account with running balance.
ใช้เมื่อถาม "บัญชีเงินฝากเคลื่อนไหวอะไรบ้าง" "ลูกหนี้การค้าเดือนนี้" หรือทำงบพิสูจน์ยอดเงินฝาก
account_code คือรหัสบัญชี เช่น 1102 (เงินฝากธนาคาร), 1104 (ลูกหนี้การค้า), 2101 (เจ้าหนี้การค้า)`,
    {
      account_code: z.string().describe('รหัสบัญชี เช่น 1102 หรือ 1102-01'),
      start_date: dateArg('วันเริ่ม YYYY-MM-DD (ยอดก่อนวันนี้เป็นยอดยกมา)'),
      end_date: dateArg('วันสิ้นสุด YYYY-MM-DD'),
    },
    async (args) => {
      const acc = db.prepare('SELECT id FROM accounts WHERE code = ? AND tenant_id = ?').get(args.account_code.trim(), tenantId) as any
      const data = acc && buildLedger(tenantId, acc.id, args.start_date, args.end_date)
      if (!data) return ok({ success: false, message: `ไม่พบรหัสบัญชี ${args.account_code}` })
      return ok({ company: company(), ...data })
    }
  )
}
