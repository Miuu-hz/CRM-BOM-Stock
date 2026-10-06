import { z } from 'zod'
import db from '../../db/sqlite'
import { IMcpServer } from '../sdk-compat'
import { ok } from './shared'
import { normName } from '../../services/stockItem.service'

const DAY_MS = 86_400_000

// ── หากิจกรรมล่าสุดของลูกค้าทุกคน (SO/ใบแจ้งหนี้/บิล POS/บันทึกกิจกรรม) ───────────
// ponytail: รวมผลด้วย JS แทน SQL window function — จำนวนแถวต่อ tenant ไม่มาก
// (ลูกค้า+เอกสารทั้งหมด) พอจะวน reduce ได้ตรงไปตรงมากว่า query ซ้อน
function lastActivityByCustomer(tenantId: string): Map<string, { d: string; kind: string }> {
  const rows = db.prepare(`
    SELECT customer_id, created_at AS d, 'ใบสั่งขาย' AS kind FROM sales_orders WHERE tenant_id = ? AND customer_id IS NOT NULL
    UNION ALL
    SELECT customer_id, created_at AS d, 'ใบแจ้งหนี้' AS kind FROM invoices WHERE tenant_id = ? AND customer_id IS NOT NULL
    UNION ALL
    SELECT customer_id, opened_at AS d, 'บิล POS' AS kind FROM pos_running_bills WHERE tenant_id = ? AND customer_id IS NOT NULL
    UNION ALL
    SELECT customer_id, created_at AS d, 'บันทึกกิจกรรม' AS kind FROM activity_logs WHERE tenant_id = ? AND customer_id IS NOT NULL
  `).all(tenantId, tenantId, tenantId, tenantId) as Array<{ customer_id: string; d: string | null; kind: string }>

  const last = new Map<string, { d: string; kind: string }>()
  for (const r of rows) {
    if (!r.d) continue
    const cur = last.get(r.customer_id)
    if (!cur || r.d > cur.d) last.set(r.customer_id, { d: r.d, kind: r.kind })
  }
  return last
}

// ยอดขายต่อลูกค้า จากใบแจ้งหนี้ (ตัวแทนยอดขายจริงที่ออกบิลแล้ว ไม่ใช้ customers.total_spent
// เพราะคอลัมน์นั้นอัปเดตจากฝั่ง POS cash เท่านั้น — ลูกค้า B2B ที่ไม่ได้จ่ายผ่าน POS จะเป็น 0 เสมอ)
function invoicedSpendByCustomer(tenantId: string, sinceDate?: string): Map<string, number> {
  const dateFilter = sinceDate ? 'AND invoice_date >= ?' : ''
  const params = sinceDate ? [tenantId, sinceDate] : [tenantId]
  const rows = db.prepare(`
    SELECT customer_id, COALESCE(SUM(total_amount), 0) AS spend FROM invoices
    WHERE tenant_id = ? AND customer_id IS NOT NULL AND status NOT IN ('CANCELLED', 'DRAFT') ${dateFilter}
    GROUP BY customer_id
  `).all(...params) as Array<{ customer_id: string; spend: number }>
  return new Map(rows.map(r => [r.customer_id, r.spend]))
}

// ── จับคู่ลูกค้าจาก id/code/ชื่อ — ตรงเป๊ะเท่านั้นถึงเลือกให้เอง ไม่ตรงเป๊ะ/เจอหลายคน → คืน candidates ──
// (กฎเดียวกับ matchStockItem ใน shared.ts: ห้ามเดาแทนผู้ใช้)
function findCustomer(tenantId: string, q: string): { customer?: any; candidates?: any[]; error?: string } {
  const query = q.trim()
  if (!query) return { error: 'ต้องระบุ customer (รหัส/ชื่อ/id ลูกค้า)' }

  const byId = db.prepare('SELECT * FROM customers WHERE tenant_id = ? AND id = ?').get(tenantId, query) as any
  if (byId) return { customer: byId }

  const byCode = db.prepare('SELECT * FROM customers WHERE tenant_id = ? AND LOWER(code) = LOWER(?)').get(tenantId, query) as any
  if (byCode) return { customer: byCode }

  const want = normName(query)
  const rows = db.prepare(`
    SELECT * FROM customers WHERE tenant_id = ? AND (name LIKE ? OR code LIKE ? OR phone LIKE ?)
    ORDER BY CASE WHEN LOWER(TRIM(name)) = ? THEN 0 ELSE 1 END, name
    LIMIT 10
  `).all(tenantId, `%${query}%`, `%${query}%`, `%${query}%`, want) as any[]

  if (rows.length === 0) return { error: `ไม่พบลูกค้าที่ตรงกับ "${query}"` }
  const exact = rows.filter(r => normName(r.name) === want)
  if (exact.length === 1) return { customer: exact[0] }
  if (rows.length === 1) return { customer: rows[0] }
  // เจอหลายคน/ไม่มีตัวที่ตรงเป๊ะเดียว — ให้ผู้ใช้เลือกเอง ห้ามเดา
  return { candidates: rows.map(r => ({ id: r.id, code: r.code, name: r.name, phone: r.phone })) }
}

function dormantCustomers(tenantId: string, days: number) {
  const customers = db.prepare(
    `SELECT id, code, name, phone FROM customers WHERE tenant_id = ? AND status = 'ACTIVE'`
  ).all(tenantId) as Array<{ id: string; code: string; name: string; phone: string | null }>

  const lastActivity = lastActivityByCustomer(tenantId)
  const spend = invoicedSpendByCustomer(tenantId)
  const now = Date.now()

  const rows = customers.map(c => {
    const a = lastActivity.get(c.id)
    const daysSilent = a ? Math.floor((now - new Date(a.d).getTime()) / DAY_MS) : null
    return {
      code: c.code,
      name: c.name,
      phone: c.phone,
      last_activity_date: a?.d ?? null,
      last_activity_kind: a?.kind ?? null,
      days_silent: daysSilent, // null = ไม่เคยมีกิจกรรมเลยตั้งแต่เป็นลูกค้า
      lifetime_spend: spend.get(c.id) ?? 0,
    }
  }).filter(r => r.days_silent === null || r.days_silent >= days)
    .sort((x, y) => (y.days_silent ?? Infinity) - (x.days_silent ?? Infinity))

  return ok({
    mode: 'dormant',
    days,
    total_dormant: rows.length,
    customers: rows.slice(0, 50),
  })
}

function customerProfile(tenantId: string, customerQuery?: string) {
  if (!customerQuery) return ok({ error: 'ต้องระบุ customer (รหัส/ชื่อ/id ลูกค้า) เมื่อ mode=profile' })
  const found = findCustomer(tenantId, customerQuery)
  if (found.error) return ok({ error: found.error })
  if (found.candidates) return ok({ ambiguous: true, candidates: found.candidates })

  const c = found.customer
  const since90 = new Date(Date.now() - 90 * DAY_MS).toISOString()

  const lifetimeSpend = (db.prepare(
    `SELECT COALESCE(SUM(total_amount), 0) AS v FROM invoices
     WHERE tenant_id = ? AND customer_id = ? AND status NOT IN ('CANCELLED', 'DRAFT')`
  ).get(tenantId, c.id) as any).v

  const spend90d = (db.prepare(
    `SELECT COALESCE(SUM(total_amount), 0) AS v FROM invoices
     WHERE tenant_id = ? AND customer_id = ? AND status NOT IN ('CANCELLED', 'DRAFT') AND invoice_date >= ?`
  ).get(tenantId, c.id, since90) as any).v

  const orderCount = (db.prepare(
    `SELECT COUNT(*) AS v FROM sales_orders WHERE tenant_id = ? AND customer_id = ? AND status != 'CANCELLED'`
  ).get(tenantId, c.id) as any).v

  // ponytail: อ่านจาก sales_order_items ไม่ใช่ invoice_items — invoice_items มีข้อมูลแค่ 19 แถว
  // ทั้งฐาน (ใบแจ้งหนี้ส่วนใหญ่ไม่มี line item แนบ) ขณะที่ sales_order_items มีครบทุกใบสั่งขาย
  const topProducts = db.prepare(`
    SELECT soi.product_name, SUM(soi.quantity) AS qty, SUM(soi.total_price) AS total
    FROM sales_order_items soi
    JOIN sales_orders so ON so.id = soi.sales_order_id
    WHERE so.tenant_id = ? AND so.customer_id = ? AND so.status != 'CANCELLED'
    GROUP BY soi.product_name ORDER BY total DESC LIMIT 5
  `).all(tenantId, c.id)

  const outstanding = (db.prepare(
    `SELECT COALESCE(SUM(balance_amount), 0) AS v FROM invoices
     WHERE tenant_id = ? AND customer_id = ? AND status NOT IN ('CANCELLED', 'DRAFT') AND payment_status != 'PAID'`
  ).get(tenantId, c.id) as any).v

  const recentActivity = db.prepare(
    `SELECT type, note, created_at FROM activity_logs WHERE tenant_id = ? AND customer_id = ? ORDER BY created_at DESC LIMIT 5`
  ).all(tenantId, c.id)

  const openQuotations = db.prepare(
    `SELECT quotation_number, quotation_date, expiry_date, total_amount, status FROM quotations
     WHERE tenant_id = ? AND customer_id = ? AND status IN ('DRAFT', 'SENT') ORDER BY quotation_date DESC`
  ).all(tenantId, c.id)

  const pendingRecommendations = db.prepare(
    `SELECT product_name, reason, priority, status FROM customer_recommendations
     WHERE tenant_id = ? AND customer_id = ? AND status = 'PENDING' ORDER BY priority DESC, created_at DESC`
  ).all(tenantId, c.id)

  return ok({
    mode: 'profile',
    contact: {
      code: c.code, name: c.name, contact_name: c.contact_name, email: c.email, phone: c.phone,
      address: c.address, city: c.city, tax_id: c.tax_id, credit_limit: c.credit_limit, status: c.status,
    },
    lifetime_spend: lifetimeSpend,
    spend_last_90d: spend90d,
    order_count: orderCount,
    top_products: topProducts,
    outstanding_balance: outstanding,
    loyalty_points: c.loyalty_points,
    recent_activity: recentActivity,
    open_quotations: openQuotations,
    pending_recommendations: pendingRecommendations,
  })
}

export function registerCrmTools(server: IMcpServer, tenantId: string): void {
  server.tool(
    'get_customer_insights',
    `วิเคราะห์ลูกค้า (CRM) — หาลูกค้าที่เงียบไปนาน หรือสรุปประวัติลูกค้าก่อนเข้าพบ / อ่านอย่างเดียว ไม่แก้ข้อมูล
mode="dormant": ลูกค้าที่ยังใช้งานอยู่แต่ไม่มีความเคลื่อนไหว (ใบสั่งขาย/ใบแจ้งหนี้/บิล POS/บันทึกกิจกรรม) เกิน days วัน หรือไม่เคยมีเลย
  ใช้เมื่อถาม "ลูกค้ารายไหนเงียบไปนานเกินเดือนแล้ว" "ลูกค้าที่ควรติดต่อกลับ"
mode="profile" (ต้องระบุ customer): สรุปก่อนเข้าพบลูกค้า — ข้อมูลติดต่อ ยอดซื้อสะสม/90วัน สินค้าที่ซื้อบ่อย ยอดค้างชำระ
  ประวัติติดต่อ 5 ครั้งล่าสุด ใบเสนอราคาที่ยังเปิดอยู่ สินค้าที่แนะนำไว้ แต้มสะสม
  ใช้เมื่อถาม "สรุปประวัติลูกค้ารายนี้ก่อนเข้าพบให้หน่อย"
  customer รับได้ทั้ง id/รหัส/ชื่อ — ถ้าชื่อไม่ตรงเป๊ะและเจอหลายคน จะได้ candidates กลับมาให้เลือก (ไม่เดาให้)`,
    {
      mode: z.enum(['dormant', 'profile']).describe('dormant=หาลูกค้าเงียบ, profile=สรุปประวัติลูกค้ารายเดียว'),
      days: z.number().int().positive().optional().describe('ใช้กับ mode=dormant: เงียบเกินกี่วัน (default 30)'),
      customer: z.string().optional().describe('ใช้กับ mode=profile: id/รหัส/ชื่อลูกค้า (จำเป็นต้องระบุ)'),
    },
    async (args) => {
      if (args.mode === 'dormant') return dormantCustomers(tenantId, args.days ?? 30)
      return customerProfile(tenantId, args.customer)
    }
  )

  server.tool(
    'get_quotations',
    `ดูใบเสนอราคา (Quotations) — ค้างปิดอยู่เท่าไหร่ ใกล้หมดอายุหรือยัง / อ่านอย่างเดียว ไม่แก้ข้อมูล
ใช้เมื่อถาม "ใบเสนอราคาเดือนนี้ค้างปิดอยู่เท่าไหร่" "มีใบเสนอราคาใกล้หมดอายุไหม"
status: ไม่ระบุ/"open"=DRAFT+SENT (ที่ยังไม่ปิด), หรือระบุสถานะเดียว เช่น ACCEPTED/REJECTED/EXPIRED
month: YYYY-MM กรองตามวันที่ใบเสนอราคา (default เดือนปัจจุบัน), หรือ "all"=ทุกเดือน`,
    {
      status: z.string().optional().describe('DRAFT/SENT/ACCEPTED/REJECTED/EXPIRED หรือ "open"=DRAFT+SENT (default)'),
      month: z.string().optional().describe('เดือน YYYY-MM (default เดือนปัจจุบัน) หรือ "all"=ทุกเดือน'),
    },
    async (args) => {
      const statusArg = (args.status || 'open').toUpperCase()
      const monthArg = args.month === 'all' ? null
        : args.month && /^\d{4}-\d{2}$/.test(args.month) ? args.month
        : new Date().toISOString().slice(0, 7)

      const params: unknown[] = [tenantId]
      let where = 'q.tenant_id = ?'
      if (statusArg === 'OPEN') where += ` AND q.status IN ('DRAFT', 'SENT')`
      else { where += ' AND q.status = ?'; params.push(statusArg) }
      if (monthArg) { where += ` AND strftime('%Y-%m', q.quotation_date) = ?`; params.push(monthArg) }

      const rows = db.prepare(`
        SELECT q.quotation_number, c.name AS customer_name, q.quotation_date, q.expiry_date, q.total_amount, q.status
        FROM quotations q LEFT JOIN customers c ON c.id = q.customer_id AND c.tenant_id = q.tenant_id
        WHERE ${where}
        ORDER BY q.quotation_date DESC
      `).all(...params) as Array<{
        quotation_number: string; customer_name: string | null; quotation_date: string
        expiry_date: string | null; total_amount: number; status: string
      }>

      const now = Date.now()
      const list = rows.map(r => ({
        ...r,
        days_to_expiry: r.expiry_date ? Math.ceil((new Date(r.expiry_date).getTime() - now) / DAY_MS) : null,
      }))
      const expiringWithin7Days = list.filter(q => q.days_to_expiry !== null && q.days_to_expiry >= 0 && q.days_to_expiry <= 7).length

      return ok({
        filter: { status: statusArg, month: monthArg ?? 'all' },
        totals: {
          count: list.length,
          sum_total_amount: list.reduce((s, q) => s + q.total_amount, 0),
          expiring_within_7_days: expiringWithin7Days,
        },
        quotations: list,
      })
    }
  )
}
