import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { convertQuantityBidirectional, normalizeUnit } from '../services/unitConversion.service'

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

const pad2 = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
// เซิร์ฟเวอร์รัน UTC — ก่อน 7 โมงเช้าไทย new Date() ยังเป็น "เมื่อวาน" ทำให้แท็บวันนี้โชว์ยอดเมื่อวาน
// ทุกช่วงเวลาบนแดชบอร์ดจึงต้องคิดจากเวลาไทย
export const thaiNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))

// ช่วงเวลาปัจจุบัน (offset=0) และช่วงเทียบก่อนหน้า (offset=1) — ต้อง "ยาวเท่ากันเสมอ"
// ทั้งสองฝั่ง ไม่งั้น % เปลี่ยนแปลงจะเพี้ยน (บั๊ก B3 เดิม: 'month' เทียบเดือนปฏิทิน
// ปัจจุบันที่ยังไม่จบกับเดือนก่อนที่จบเต็มเดือน). ป้ายบนหน้าเว็บคือ
// วันนี้/7 วัน/30 วัน/ปีนี้ ดังนั้น 'week'/'month' ต้องเป็น rolling window ย้อนหลังจริง
// ไม่ใช่สัปดาห์/เดือนปฏิทิน — ตรงกับสิ่งที่ผู้ใช้เห็นบนแท็บ
export function getRange(period: string, offset: number = 0): { start: string; end: string } {
  const now = thaiNow()
  if (period === 'day') {
    const d = new Date(now); d.setDate(d.getDate() - offset)
    const s = ymd(d)
    return { start: s, end: s }
  } else if (period === 'week') {
    // 7 วันล่าสุด (รวมวันนี้), ช่วงก่อนหน้า = 7 วันก่อนหน้านั้น (ยาวเท่ากัน)
    const end = new Date(now); end.setDate(end.getDate() - offset * 7)
    const start = new Date(end); start.setDate(start.getDate() - 6)
    return { start: ymd(start), end: ymd(end) }
  } else if (period === 'month') {
    // 30 วันล่าสุด (รวมวันนี้), ช่วงก่อนหน้า = 30 วันก่อนหน้านั้น (ยาวเท่ากัน)
    const end = new Date(now); end.setDate(end.getDate() - offset * 30)
    const start = new Date(end); start.setDate(start.getDate() - 29)
    return { start: ymd(start), end: ymd(end) }
  } else { // year: year-to-date เทียบกับช่วงเดียวกันของปีก่อน (ไม่ใช่ทั้งปีเต็ม)
    const y = now.getFullYear() - offset
    const start = new Date(y, 0, 1)
    const end = new Date(y, now.getMonth(), now.getDate())
    return { start: ymd(start), end: ymd(end) }
  }
}

// ยอดขาย/ต้นทุนขายจริง — คำนวณจาก journal_lines (ledger) แบบเดียวกับ
// GET /reports/profit-loss ทุกประการ (type=REVENUE / EXPENSE+category=COGS,
// is_posted=1, level>=1) เพื่อให้ Dashboard กับหน้า P&L Report ไม่มีวันเลขไม่ตรงกัน
// อีก — เดิม Dashboard คำนวณจาก orders/invoices/purchase_orders คนละตารางกัน 3 จุด
// (บั๊ก B1/B2/B4) ส่วน journal ครอบคลุมทั้งใบแจ้งหนี้ (reference_type=INVOICE) และ
// ขาย POS ที่ผ่านบัญชีจริง (reference_type=POS_SALE) โดยไม่นับซ้ำ เพราะ POS ไม่ได้
// สร้างแถวใน invoices/orders เลย (ตรวจโค้ด sales/pos.routes.ts แล้ว)
// startDate/endDate เป็นรูปแบบ 'YYYY-MM-DD' ตรงกับ journal_entries.date เป๊ะ (ไม่มีเวลา)
function getLedgerTotals(tenantId: string, startDate: string, endDate: string): { revenue: number; cogs: number } {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN a.type = 'REVENUE' THEN
        CASE WHEN a.normal_balance = 'DEBIT' THEN jl.debit - jl.credit ELSE jl.credit - jl.debit END
      ELSE 0 END), 0) as revenue,
      COALESCE(SUM(CASE WHEN a.type = 'EXPENSE' AND a.category = 'COGS' THEN
        CASE WHEN a.normal_balance = 'DEBIT' THEN jl.debit - jl.credit ELSE jl.credit - jl.debit END
      ELSE 0 END), 0) as cogs
    FROM journal_lines jl
    JOIN journal_entries je ON jl.journal_entry_id = je.id
    JOIN accounts a ON jl.account_id = a.id
    WHERE a.tenant_id = ?
      AND jl.tenant_id = ?
      AND je.tenant_id = ?
      AND a.is_active = 1 AND a.level >= 1
      AND je.is_posted = 1
      AND (je.is_closing_entry = 0 OR je.is_closing_entry IS NULL)
      AND je.date >= ? AND je.date <= ?
  `).get(tenantId, tenantId, tenantId, startDate, endDate) as any
  return { revenue: row?.revenue || 0, cogs: row?.cogs || 0 }
}

// Get low stock items
router.get('/low-stock', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const rows = db.prepare(`
      SELECT id, name, sku, quantity, min_stock, unit, base_unit, display_unit, sealed_qty
      FROM stock_items
      WHERE tenant_id = ? AND quantity <= min_stock AND min_stock > 0
    `).all(tenantId) as any[]

    // An unopened pack is still stock. Items whose loose quantity is low but
    // that still hold sealed packs are not actually short, so drop them here
    // instead of nagging the owner to reorder what is already on the shelf.
    const items = rows
      .map((r: any) => {
        const baseUnit = r.base_unit || r.unit
        const displayUnit = r.display_unit || r.unit
        let packFactor: number | null = null
        if (baseUnit && displayUnit && normalizeUnit(baseUnit) !== normalizeUnit(displayUnit)) {
          const c = convertQuantityBidirectional(1, displayUnit, baseUnit, tenantId, r.id)
          if (c && c.factor > 0) packFactor = c.factor
        }
        const available = r.quantity + (packFactor ? (r.sealed_qty || 0) * packFactor : 0)
        return { ...r, minStock: r.min_stock, available, pack_factor: packFactor }
      })
      .filter((r: any) => r.available <= r.min_stock)
      .sort((a: any, b: any) => (a.available / (a.min_stock || 1)) - (b.available / (b.min_stock || 1)))

    // total = จำนวนจริงทั้งหมด (เดิมการ์ดโชว์ length ของรายการที่ตัดเหลือ 8 → ขึ้น "8 รายการ" ตลอดทั้งที่ขาด 363)
    res.json({ success: true, data: items.slice(0, 8), total: items.length })
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

    const cur = getRange(period, 0)
    const prev = getRange(period, 1)

    // รายได้/ต้นทุนขาย: ledger-based (getLedgerTotals) — เดียวกับ /reports/profit-loss
    // เป๊ะ แก้บั๊ก B1 (ต้นทุนขายเดิมเอายอด PO ที่รับของมาใช้ผิด) และ B2 (ไม่นับ POS)
    // ไปพร้อมกัน เพราะ ledger รวมทั้งใบแจ้งหนี้และ POS ที่ผ่านบัญชีจริงอยู่แล้ว
    const curTotals  = getLedgerTotals(tenantId, cur.start, cur.end)
    const prevTotals = getLedgerTotals(tenantId, prev.start, prev.end)
    const curRev = curTotals.revenue, prevRev = prevTotals.revenue
    const curCost = curTotals.cogs, prevCost = prevTotals.cogs

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

    const now = thaiNow()
    const todayStr = ymd(now)
    const week7  = new Date(now); week7.setDate(now.getDate() + 7)
    const month30 = new Date(now); month30.setDate(now.getDate() + 30)
    const week7Str  = ymd(week7)
    const month30Str = ymd(month30)

    // AR: unpaid invoices
    const arRows = db.prepare(`
      SELECT i.id, i.invoice_number as doc_number,
        i.due_date, i.balance_amount as amount,
        c.name as party_name
      FROM invoices i JOIN customers c ON i.customer_id = c.id
      WHERE c.tenant_id = ?
        AND i.tenant_id = ?
        AND i.payment_status NOT IN ('PAID')
        AND i.status NOT IN ('CANCELLED','DRAFT')
        AND i.balance_amount > 0
      ORDER BY i.due_date ASC
    `).all(tenantId, tenantId) as any[]

    // AP: หนี้การค้าจริงจาก purchase_invoices ที่ยังค้างจ่าย
    // (เดิมใช้ purchase_orders ซึ่งเป็นแค่ใบสั่งซื้อ ยังไม่ใช่ภาระหนี้ และนับยอดเต็มใบ
    //  ทั้งที่รับของ/จ่ายบางส่วนไปแล้ว ทำให้ AP สูงเกินจริง)
    const apRows = db.prepare(`
      SELECT pi.id, pi.pi_number as doc_number,
        pi.due_date, pi.balance_amount as amount,
        s.name as party_name
      FROM purchase_invoices pi JOIN suppliers s ON pi.supplier_id = s.id
      WHERE pi.tenant_id = ?
        AND pi.status NOT IN ('CANCELLED','DRAFT')
        AND pi.payment_status <> 'PAID'
        AND pi.balance_amount > 0
      ORDER BY pi.due_date ASC
    `).all(tenantId) as any[]

    // เอกสารที่ไม่ได้ระบุ due_date ถือว่า "ต้องจ่าย/เก็บวันนี้" ตามนโยบายที่เจ้าของ
    // ระบบเลือกเอง (ซ่อนไว้ผู้ใช้จะลืม ต้องโชว์ขึ้นมาเลย) — แต่ต้องติด dueUnspecified=true
    // ไปกับแถวเสมอ เพื่อให้ UI แยกแยะจาก due_date ที่ตรงกับวันนี้จริงๆ ห้ามลบ flag นี้
    // ไม่งั้นจะกลายเป็นข้อมูลเท็จบนเอกสารการเงิน ใช้ร่วมกันทั้ง AR/AP เพราะ classify()
    // เป็นฟังก์ชันร่วม (ดูสั่งงานแก้บั๊ก 2026-09-09: หนี้ due_date ว่างหายจากทุกแท็บ)
    const classify = (rows: any[]) => {
      const groups: Record<string, any[]> = { overdue: [], today: [], week: [], month: [], later: [] }
      let total = 0
      for (const r of rows) {
        const due = r.due_date ? r.due_date.slice(0, 10) : null
        total += r.amount || 0
        if (!due)               { groups.today.push({ ...r, dueUnspecified: true }); continue }
        if (due < todayStr)     { groups.overdue.push(r) }
        else if (due === todayStr) { groups.today.push(r) }
        else if (due <= week7Str)  { groups.week.push(r) }
        else if (due <= month30Str){ groups.month.push(r) }
        else                       { groups.later.push(r) }
      }
      const sum = (arr: any[]) => arr.reduce((s, r) => s + (r.amount||0), 0)
      // later = ครบกำหนดเกิน 30 วันข้างหน้าจริง (ไม่ใช่ due_date ว่างอีกต่อไป) —
      // total ยังนับรวมทุกกลุ่มเหมือนเดิม ดังนั้น total ต้อง = ผลบวกทุกแท็บที่ UI แสดง
      // (overdue+today+week+month+later) เสมอ มิฉะนั้นยอดหัวมุมจะไม่ตรงกับที่ผู้ใช้กดดูทีละแท็บ
      return {
        ...groups,
        total,
        weekTotal: sum(groups.overdue)+sum(groups.today)+sum(groups.week),
        monthTotal: sum(groups.overdue)+sum(groups.today)+sum(groups.week)+sum(groups.month),
        laterTotal: sum(groups.later),
      }
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
      FROM sales_orders WHERE tenant_id = ? AND status IN ('CONFIRMED','PROCESSING','READY','PARTIAL')
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

    const range = getRange(period, 0)

    const rows = db.prepare(`
      SELECT c.id, c.name, COUNT(i.id) as invoice_count,
        COALESCE(SUM(i.total_amount), 0) as revenue
      FROM invoices i JOIN customers c ON i.customer_id = c.id
      WHERE c.tenant_id = ?
        AND i.tenant_id = ?
        AND i.status NOT IN ('CANCELLED','DRAFT')
        AND date(i.invoice_date) >= ? AND date(i.invoice_date) <= ?
      GROUP BY c.id ORDER BY revenue DESC LIMIT 5
    `).all(tenantId, tenantId, range.start, range.end)

    res.json({ success: true, data: rows })
  } catch (error) {
    console.error('Dashboard top-customers error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch top customers' })
  }
})

// ใบเสนอราคาที่ถือว่า "แพ้" แล้ว — ไม่นับรวมในไปป์ไลน์ที่ยังเปิดอยู่
const LOST_QUOTATION_STATUSES = new Set(['REJECTED', 'EXPIRED', 'CANCELLED'])
const PIPELINE_MONTHS = 6

// GET /dashboard/pipeline — ไปป์ไลน์การขายที่เดินตามสายเอกสารจริง
//
// ต่างจาก /funnel เดิมที่นับ QT / SO / INV แยกกันคนละ query แล้วเอามาวางซ้อนกัน
// เป็นรูปกรวย ทั้งที่ไม่ได้ผูกกันจริง endpoint นี้ไล่ตาม quotation_id จริง
// จึงบอกได้ว่าใบเสนอราคาใบไหนกลายเป็นออเดอร์ และมี SO เท่าไรที่ข้ามใบเสนอราคาไปเลย
router.get('/pipeline', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const quotations = db.prepare(`
      SELECT q.id, q.status, q.total_amount,
        EXISTS(SELECT 1 FROM sales_orders so WHERE so.quotation_id = q.id AND so.status NOT IN ('CANCELLED')) AS has_so
      FROM quotations q WHERE q.tenant_id = ? AND q.status <> 'DRAFT'
    `).all(tenantId) as any[]

    const stages = {
      quoting:  { count: 0, value: 0 }, // ยื่นไปแล้ว ยังไม่รู้ผล
      awaiting: { count: 0, value: 0 }, // ลูกค้าตอบรับแล้ว แต่ยังไม่เปิดออเดอร์
      won:      { count: 0, value: 0 }, // มีใบสั่งขายผูกแล้ว
      lost:     { count: 0, value: 0 }, // ปฏิเสธ / หมดอายุ
    }

    for (const q of quotations) {
      const key = q.has_so
        ? 'won'
        : LOST_QUOTATION_STATUSES.has(q.status)
          ? 'lost'
          : q.status === 'ACCEPTED'
            ? 'awaiting'
            : 'quoting'
      stages[key as keyof typeof stages].count += 1
      stages[key as keyof typeof stages].value += q.total_amount || 0
    }

    const decided = stages.won.count + stages.lost.count
    const winRate = decided > 0 ? (stages.won.count / decided) * 100 : null

    // ออเดอร์ที่เปิดตรงโดยไม่ผ่านใบเสนอราคา ทำให้ไปป์ไลน์อ่านต่ำกว่าความจริง
    // จึงรายงานออกมาตรง ๆ แทนที่จะซ่อนไว้
    const linkage = db.prepare(`
      SELECT COUNT(*) AS soTotal,
        COALESCE(SUM(CASE WHEN quotation_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS soFromQuotation
      FROM sales_orders WHERE tenant_id = ? AND status <> 'CANCELLED'
    `).get(tenantId) as any

    // เงินไหลถึงไหนแล้ว: รับออเดอร์ → วางบิล → เก็บเงินได้จริง
    const ordered = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) AS value
      FROM sales_orders WHERE tenant_id = ? AND status NOT IN ('CANCELLED','DRAFT')
    `).get(tenantId) as any

    const billing = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) AS invoiced,
             COALESCE(SUM(paid_amount), 0) AS collected,
             COALESCE(SUM(balance_amount), 0) AS outstanding
      FROM invoices WHERE tenant_id = ? AND status NOT IN ('CANCELLED','DRAFT')
    `).get(tenantId) as any

    const orderedByMonth = db.prepare(`
      SELECT substr(order_date, 1, 7) AS month, COALESCE(SUM(total_amount), 0) AS value
      FROM sales_orders
      WHERE tenant_id = ? AND status NOT IN ('CANCELLED','DRAFT') AND order_date IS NOT NULL
      GROUP BY month
    `).all(tenantId) as any[]

    const invoicedByMonth = db.prepare(`
      SELECT substr(invoice_date, 1, 7) AS month, COALESCE(SUM(total_amount), 0) AS value
      FROM invoices
      WHERE tenant_id = ? AND status NOT IN ('CANCELLED','DRAFT') AND invoice_date IS NOT NULL
      GROUP BY month
    `).all(tenantId) as any[]

    const orderedMap = new Map(orderedByMonth.map(r => [r.month, r.value]))
    const invoicedMap = new Map(invoicedByMonth.map(r => [r.month, r.value]))

    const anchor = thaiNow()
    anchor.setDate(1)
    const monthly: any[] = []
    for (let back = PIPELINE_MONTHS - 1; back >= 0; back--) {
      const cursor = new Date(anchor)
      cursor.setMonth(anchor.getMonth() - back)
      const month = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
      monthly.push({
        month,
        ordered: orderedMap.get(month) || 0,
        invoiced: invoicedMap.get(month) || 0,
      })
    }

    const soTotal = linkage.soTotal || 0
    const soFromQuotation = linkage.soFromQuotation || 0

    res.json({
      success: true,
      data: {
        stages,
        winRate,
        openPipelineValue: stages.quoting.value + stages.awaiting.value,
        linkage: {
          soTotal,
          soFromQuotation,
          soDirect: soTotal - soFromQuotation,
          linkedPercent: soTotal > 0 ? (soFromQuotation / soTotal) * 100 : 0,
        },
        waterfall: {
          ordered: ordered.value || 0,
          invoiced: billing.invoiced || 0,
          collected: billing.collected || 0,
          outstanding: billing.outstanding || 0,
        },
        monthly,
      },
    })
  } catch (error) {
    console.error('Dashboard pipeline error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch pipeline' })
  }
})

// Recent sales orders
router.get('/recent-orders', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const limit = Math.min(Number(req.query.limit) || 5, 50)

    const rows = db.prepare(`
      SELECT so.id, so.so_number, so.order_date, so.delivery_date,
             so.total_amount, so.status, so.payment_status,
             c.id as customer_id, c.name as customer_name
      FROM sales_orders so
      LEFT JOIN customers c ON so.customer_id = c.id
      WHERE so.tenant_id = ?
      ORDER BY so.created_at DESC, so.order_date DESC
      LIMIT ?
    `).all(tenantId, limit)

    res.json({ success: true, data: rows })
  } catch (error) {
    console.error('Dashboard recent-orders error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch recent orders' })
  }
})

// Production / Work Order status summary
router.get('/production', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const rows = db.prepare(`
      SELECT 
        status,
        COUNT(*) as count,
        COALESCE(SUM(quantity), 0) as total_qty,
        COALESCE(SUM(completed_qty), 0) as completed_qty
      FROM work_orders
      WHERE tenant_id = ?
      GROUP BY status
    `).all(tenantId) as any[]

    const summary: Record<string, number> = {
      draft: 0,
      planned: 0,
      inProgress: 0,
      completed: 0,
      cancelled: 0,
      total: 0,
    }

    let totalQuantity = 0
    let totalCompletedQuantity = 0

    for (const r of rows) {
      const c = Number(r.count) || 0
      summary.total += c
      totalQuantity += Number(r.total_qty) || 0
      totalCompletedQuantity += Number(r.completed_qty) || 0
      if (r.status === 'DRAFT') summary.draft = c
      else if (r.status === 'PLANNED') summary.planned = c
      else if (r.status === 'IN_PROGRESS') summary.inProgress = c
      else if (r.status === 'COMPLETED') summary.completed = c
      else if (r.status === 'CANCELLED') summary.cancelled = c
    }

    res.json({
      success: true,
      data: {
        ...summary,
        totalQuantity,
        totalCompletedQuantity,
        byStatus: rows
      }
    })
  } catch (error) {
    console.error('Dashboard production summary error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch production summary' })
  }
})

export default router
