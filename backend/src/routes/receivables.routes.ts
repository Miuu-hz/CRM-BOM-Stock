import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

const DAY_MS = 86_400_000

// Aging buckets วัดเป็น "จำนวนวันที่เลยกำหนดชำระ" — เอกสารที่ยังไม่ถึงกำหนด
// และเอกสารที่ไม่มีวันครบกำหนด จะถูกจัดอยู่ใน current
const BUCKET_KEYS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90plus'] as const
type BucketKey = (typeof BUCKET_KEYS)[number]

const bucketFor = (daysOverdue: number | null): BucketKey => {
  if (daysOverdue === null || daysOverdue <= 0) return 'current'
  if (daysOverdue <= 30) return 'd1_30'
  if (daysOverdue <= 60) return 'd31_60'
  if (daysOverdue <= 90) return 'd61_90'
  return 'd90plus'
}

interface AgingRow {
  id: string
  doc_number: string
  doc_date: string | null
  due_date: string | null
  total_amount: number
  balance_amount: number
  party_id: string
  party_name: string
  party_email: string | null
  party_phone: string | null
}

interface Bucket {
  amount: number
  count: number
}

const emptyBuckets = (): Record<BucketKey, Bucket> =>
  BUCKET_KEYS.reduce((acc, key) => {
    acc[key] = { amount: 0, count: 0 }
    return acc
  }, {} as Record<BucketKey, Bucket>)

const startOfDayMs = (dateStr: string) => new Date(`${dateStr.slice(0, 10)}T00:00:00`).getTime()

function buildAging(rows: AgingRow[], asOf: string) {
  const asOfMs = startOfDayMs(asOf)
  const buckets = emptyBuckets()
  const parties = new Map<string, any>()

  let outstanding = 0
  let overdue = 0
  let overdueCount = 0
  let docCount = 0
  let oldestDays = 0

  for (const row of rows) {
    const balance = row.balance_amount || 0
    if (balance <= 0) continue
    docCount += 1

    const daysOverdue = row.due_date
      ? Math.floor((asOfMs - startOfDayMs(row.due_date)) / DAY_MS)
      : null
    const bucket = bucketFor(daysOverdue)
    const isOverdue = bucket !== 'current'

    outstanding += balance
    buckets[bucket].amount += balance
    buckets[bucket].count += 1

    if (isOverdue) {
      overdue += balance
      overdueCount += 1
      if (daysOverdue !== null && daysOverdue > oldestDays) oldestDays = daysOverdue
    }

    let party = parties.get(row.party_id)
    if (!party) {
      party = {
        id: row.party_id,
        name: row.party_name,
        email: row.party_email || null,
        phone: row.party_phone || null,
        total: 0,
        overdue: 0,
        oldestDays: 0,
        buckets: emptyBuckets(),
        docs: [] as any[],
      }
      parties.set(row.party_id, party)
    }

    party.total += balance
    party.buckets[bucket].amount += balance
    party.buckets[bucket].count += 1
    if (isOverdue) {
      party.overdue += balance
      if (daysOverdue !== null && daysOverdue > party.oldestDays) party.oldestDays = daysOverdue
    }

    party.docs.push({
      id: row.id,
      docNumber: row.doc_number,
      docDate: row.doc_date,
      dueDate: row.due_date,
      totalAmount: row.total_amount || 0,
      balance,
      daysOverdue,
      bucket,
    })
  }

  const partyList = [...parties.values()].sort((a, b) => b.total - a.total)
  for (const party of partyList) {
    party.docs.sort((a: any, b: any) => (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1))
  }

  return {
    asOf,
    totals: {
      outstanding,
      overdue,
      current: outstanding - overdue,
      overduePercent: outstanding > 0 ? (overdue / outstanding) * 100 : 0,
      docCount,
      overdueCount,
      partyCount: partyList.length,
      oldestDays,
    },
    buckets,
    parties: partyList,
  }
}

// asOf เป็น optional query param — ถ้าไม่ส่งมาหรือรูปแบบไม่ถูกต้อง ใช้วันนี้
const resolveAsOf = (req: Request): string => {
  const raw = (req.query.asOf as string) || ''
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10)
}

// GET /api/receivables/ar-aging — ลูกหนี้การค้าแยกตามอายุหนี้
// หมายเหตุ: ยังไม่หักลดหนี้ (credit notes) ออกจากยอดค้าง — balance_amount
// บน invoice คือแหล่งความจริงเดียวที่ระบบใช้อยู่ตอนนี้
router.get('/ar-aging', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const asOf = resolveAsOf(req)

    const rows = db.prepare(`
      SELECT i.id, i.invoice_number AS doc_number, i.invoice_date AS doc_date,
             i.due_date, i.total_amount, i.balance_amount,
             c.id AS party_id, c.name AS party_name,
             c.email AS party_email, c.phone AS party_phone
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id
      WHERE i.tenant_id = ?
        AND i.status NOT IN ('CANCELLED', 'DRAFT')
        AND i.payment_status <> 'PAID'
        AND i.balance_amount > 0
    `).all(tenantId) as AgingRow[]

    res.json({ success: true, data: buildAging(rows, asOf) })
  } catch (error) {
    console.error('AR aging error:', error)
    res.status(500).json({ success: false, message: 'Failed to build AR aging' })
  }
})

// GET /api/receivables/ap-aging — เจ้าหนี้การค้าแยกตามอายุหนี้
// ใช้ purchase_invoices (หนี้จริงที่ตั้งไว้แล้ว) ไม่ใช่ purchase_orders ที่เป็นแค่ใบสั่งซื้อ
router.get('/ap-aging', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const asOf = resolveAsOf(req)

    const rows = db.prepare(`
      SELECT pi.id, pi.pi_number AS doc_number, pi.invoice_date AS doc_date,
             pi.due_date, pi.total_amount, pi.balance_amount,
             s.id AS party_id, s.name AS party_name,
             s.email AS party_email, s.phone AS party_phone
      FROM purchase_invoices pi
      JOIN suppliers s ON s.id = pi.supplier_id
      WHERE pi.tenant_id = ?
        AND pi.status NOT IN ('CANCELLED', 'DRAFT')
        AND pi.payment_status <> 'PAID'
        AND pi.balance_amount > 0
    `).all(tenantId) as AgingRow[]

    res.json({ success: true, data: buildAging(rows, asOf) })
  } catch (error) {
    console.error('AP aging error:', error)
    res.status(500).json({ success: false, message: 'Failed to build AP aging' })
  }
})

// GET /api/receivables/collections?months=6 — วางบิลไปเท่าไร เก็บเงินได้จริงเท่าไร
router.get('/collections', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const months = Math.min(Math.max(parseInt(req.query.months as string, 10) || 6, 1), 24)

    const invoiced = db.prepare(`
      SELECT substr(invoice_date, 1, 7) AS month,
             COALESCE(SUM(total_amount), 0) AS amount,
             COUNT(*) AS count
      FROM invoices
      WHERE tenant_id = ? AND status NOT IN ('CANCELLED', 'DRAFT') AND invoice_date IS NOT NULL
      GROUP BY month
    `).all(tenantId) as any[]

    const collected = db.prepare(`
      SELECT substr(receipt_date, 1, 7) AS month,
             COALESCE(SUM(amount), 0) AS amount,
             COUNT(*) AS count
      FROM receipts
      WHERE tenant_id = ? AND receipt_date IS NOT NULL
      GROUP BY month
    `).all(tenantId) as any[]

    const invoicedBy = new Map(invoiced.map(row => [row.month, row]))
    const collectedBy = new Map(collected.map(row => [row.month, row]))

    const anchor = new Date()
    anchor.setDate(1)
    const series: any[] = []
    for (let back = months - 1; back >= 0; back--) {
      const cursor = new Date(anchor)
      cursor.setMonth(anchor.getMonth() - back)
      const month = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
      const inv = invoicedBy.get(month)
      const col = collectedBy.get(month)
      series.push({
        month,
        invoiced: inv?.amount || 0,
        invoicedCount: inv?.count || 0,
        collected: col?.amount || 0,
        collectedCount: col?.count || 0,
      })
    }

    res.json({ success: true, data: { months, series } })
  } catch (error) {
    console.error('Collections series error:', error)
    res.status(500).json({ success: false, message: 'Failed to build collections series' })
  }
})

// GET /api/receivables/deal-timeline/:soId — เส้นทางเอกสารของดีลเดียว
// ใบเสนอราคา → ใบสั่งขาย → ใบส่งของ → ใบแจ้งหนี้ → ใบเสร็จรับเงิน
router.get('/deal-timeline/:soId', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { soId } = req.params

    const so = db.prepare(`
      SELECT so.*, c.name AS customer_name
      FROM sales_orders so
      LEFT JOIN customers c ON c.id = so.customer_id
      WHERE so.id = ? AND so.tenant_id = ?
    `).get(soId, tenantId) as any

    if (!so) {
      return res.status(404).json({ success: false, message: 'Sales order not found' })
    }

    const quotation = so.quotation_id
      ? db.prepare('SELECT * FROM quotations WHERE id = ? AND tenant_id = ?').get(so.quotation_id, tenantId) as any
      : null

    const deliveries = db.prepare(`
      SELECT id, do_number, delivery_date, status
      FROM delivery_orders WHERE sales_order_id = ? AND tenant_id = ?
      ORDER BY delivery_date ASC
    `).all(soId, tenantId) as any[]

    const invoices = db.prepare(`
      SELECT id, invoice_number, invoice_date, due_date, total_amount,
             paid_amount, balance_amount, status, payment_status
      FROM invoices WHERE sales_order_id = ? AND tenant_id = ?
      ORDER BY invoice_date ASC
    `).all(soId, tenantId) as any[]

    const invoiceIds = invoices.map(inv => inv.id)
    const receipts = invoiceIds.length
      ? db.prepare(`
          SELECT id, receipt_number, receipt_date, amount, payment_method, invoice_id
          FROM receipts
          WHERE tenant_id = ? AND invoice_id IN (${invoiceIds.map(() => '?').join(', ')})
          ORDER BY receipt_date ASC
        `).all(tenantId, ...invoiceIds) as any[]
      : []

    const sumOf = (rows: any[], key: string) => rows.reduce((total, row) => total + (row[key] || 0), 0)
    const invoicedAmount = sumOf(invoices, 'total_amount')
    const collectedAmount = sumOf(receipts, 'amount')
    const outstandingAmount = sumOf(invoices, 'balance_amount')

    const stages = [
      {
        key: 'quotation',
        done: !!quotation,
        docNumber: quotation?.quotation_number ?? null,
        date: quotation?.quotation_date ?? null,
        amount: quotation?.total_amount ?? null,
        status: quotation?.status ?? null,
        count: quotation ? 1 : 0,
      },
      {
        key: 'salesOrder',
        done: true,
        docNumber: so.so_number,
        date: so.order_date,
        amount: so.total_amount,
        status: so.status,
        count: 1,
      },
      {
        key: 'delivery',
        done: deliveries.length > 0,
        docNumber: deliveries[0]?.do_number ?? null,
        date: deliveries[0]?.delivery_date ?? null,
        amount: null,
        status: deliveries[0]?.status ?? null,
        count: deliveries.length,
      },
      {
        key: 'invoice',
        done: invoices.length > 0,
        docNumber: invoices[0]?.invoice_number ?? null,
        date: invoices[0]?.invoice_date ?? null,
        amount: invoicedAmount || null,
        status: invoices[0]?.payment_status ?? null,
        count: invoices.length,
      },
      {
        key: 'receipt',
        // ดีลจบก็ต่อเมื่อเก็บเงินครบ ไม่ใช่แค่มีใบเสร็จใบแรก
        done: invoices.length > 0 && outstandingAmount <= 0,
        docNumber: receipts[0]?.receipt_number ?? null,
        date: receipts[0]?.receipt_date ?? null,
        amount: collectedAmount || null,
        status: outstandingAmount > 0 ? 'PARTIAL' : receipts.length ? 'PAID' : null,
        count: receipts.length,
      },
    ]

    res.json({
      success: true,
      data: {
        salesOrder: {
          id: so.id,
          soNumber: so.so_number,
          customerName: so.customer_name,
          totalAmount: so.total_amount,
        },
        stages,
        summary: {
          orderedAmount: so.total_amount || 0,
          invoicedAmount,
          collectedAmount,
          outstandingAmount,
        },
        deliveries,
        invoices,
        receipts,
      },
    })
  } catch (error) {
    console.error('Deal timeline error:', error)
    res.status(500).json({ success: false, message: 'Failed to build deal timeline' })
  }
})

export default router
