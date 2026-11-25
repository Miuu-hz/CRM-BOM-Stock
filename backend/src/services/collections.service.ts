import db from '../db/sqlite'
import { thaiDateStr } from '../utils/id'
import { STOCK_DEDUCTED_STATUSES } from '../routes/sales/shared'

export type CollectionKind = 'INVOICE' | 'SALES_ORDER' | 'QUOTATION'

export interface CollectionLastFollow {
  note: string
  type: string
  created_at: string
  created_by: string | null
}

export interface CollectionItem {
  kind: CollectionKind
  id: string
  number: string
  customer_id: string
  customer_name: string | null
  customer_phone: string | null
  due_date: string | null
  next_follow_date: string | null
  follow_date: string | null
  days_left: number | null
  amount: number
  last_follow: CollectionLastFollow | null
}

export interface CollectionSummaryBucket {
  count: number
  amount: number
}

export interface CollectionSummary {
  overdue: CollectionSummaryBucket
  today: CollectionSummaryBucket
  soon: CollectionSummaryBucket
}

const r2 = (n: number) => Math.round(n * 100) / 100

function normYmd(v: string | null | undefined): string | null {
  if (!v) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : thaiDateStr(v)
}

function daysBetween(fromStr: string, toStr: string): number {
  const [fy, fm, fd] = fromStr.split('-').map(Number)
  const [ty, tm, td] = toStr.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000)
}

/**
 * รายการติดตามบิล/ค้างชำระของบริษัท (ใบแจ้งหนี้ค้าง, SO ยืนยันที่ยังไม่ออก INV, QT เปิดที่มีวันครบกำหนดชำระ)
 * เรียงตามวันติดตาม (follow_date = next_follow_date ?? due_date) จากเร็วสุดไปช้าสุด และ null อยู่ท้ายสุด
 */
export function collectionItems(
  tenantId: string,
  opts: { today?: string; customerId?: string } = {}
): CollectionItem[] {
  const today = normYmd(opts.today) || thaiDateStr()
  const customerId = opts.customerId || undefined
  const custSql = (alias: string) => (customerId ? `AND ${alias}.customer_id = ?` : '')
  const custArgs = customerId ? [customerId] : []

  const invRows = db.prepare(`
    SELECT i.id, i.invoice_number AS number, i.customer_id,
           c.name AS customer_name, c.phone AS customer_phone,
           i.due_date, i.balance_amount AS amount
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
    WHERE i.tenant_id = ?
      AND i.status != 'CANCELLED' -- DRAFT ก็เป็นหนี้แล้ว: ระบบลงลูกหนี้ตั้งแต่สร้างใบ
      AND COALESCE(i.payment_status, '') != 'PAID'
      AND i.balance_amount > 0
      ${custSql('i')}
  `).all(tenantId, ...custArgs) as any[]

  const soPh = STOCK_DEDUCTED_STATUSES.map(() => '?').join(',')
  const soRows = db.prepare(`
    SELECT so.id, so.so_number AS number, so.customer_id,
           c.name AS customer_name, c.phone AS customer_phone,
           so.due_date, so.total_amount AS amount
    FROM sales_orders so
    LEFT JOIN customers c ON c.id = so.customer_id AND c.tenant_id = so.tenant_id
    WHERE so.tenant_id = ?
      AND so.due_date IS NOT NULL AND so.due_date != ''
      AND so.status IN (${soPh})
      AND COALESCE(so.payment_status, '') != 'PAID'
      AND NOT EXISTS (
        SELECT 1 FROM invoices i
        WHERE i.sales_order_id = so.id AND i.tenant_id = so.tenant_id AND i.status != 'CANCELLED'
      )
      ${custSql('so')}
  `).all(tenantId, ...STOCK_DEDUCTED_STATUSES, ...custArgs) as any[]

  const qtRows = db.prepare(`
    SELECT q.id, q.quotation_number AS number, q.customer_id,
           c.name AS customer_name, c.phone AS customer_phone,
           q.due_date, q.total_amount AS amount
    FROM quotations q
    LEFT JOIN customers c ON c.id = q.customer_id AND c.tenant_id = q.tenant_id
    WHERE q.tenant_id = ?
      AND q.due_date IS NOT NULL AND q.due_date != ''
      AND q.status IN ('DRAFT', 'SENT')
      AND NOT EXISTS (
        SELECT 1 FROM sales_orders so
        WHERE so.quotation_id = q.id AND so.tenant_id = q.tenant_id AND so.status != 'CANCELLED'
      )
      ${custSql('q')}
  `).all(tenantId, ...custArgs) as any[]

  // ดึงความเคลื่อนไหวล่าสุดต่อเอกสารในครั้งเดียว (กัน N+1)
  const followRows = db.prepare(`
    WITH Ranked AS (
      SELECT doc_type, doc_id, note, type, created_at, created_by,
             ROW_NUMBER() OVER (PARTITION BY doc_type, doc_id ORDER BY created_at DESC, rowid DESC) AS rn
      FROM activity_logs
      WHERE tenant_id = ?
        AND doc_type IN ('INVOICE', 'SALES_ORDER', 'QUOTATION')
        AND doc_id IS NOT NULL
        ${customerId ? 'AND customer_id = ?' : ''}
    )
    SELECT doc_type, doc_id, note, type, created_at, created_by
    FROM Ranked WHERE rn = 1
  `).all(tenantId, ...custArgs) as any[]

  // วันนัดตามล่าสุดที่ระบุไว้ — โน้ตใหม่ที่ไม่ใส่วันต้องไม่ล้างนัดเดิม (MAX ทำให้คอลัมน์อื่นมาจากแถวล่าสุด)
  const nextMap = new Map((db.prepare(`
    SELECT doc_type, doc_id, next_follow_date, MAX(created_at) FROM activity_logs
    WHERE tenant_id = ? AND doc_id IS NOT NULL AND next_follow_date IS NOT NULL ${customerId ? 'AND customer_id = ?' : ''}
    GROUP BY doc_type, doc_id
  `).all(tenantId, ...custArgs) as any[]).map(r => [`${r.doc_type}:${r.doc_id}`, r.next_follow_date as string]))

  const followMap = new Map<string, any>()
  for (const f of followRows) {
    followMap.set(`${f.doc_type}:${f.doc_id}`, f)
  }

  const mapRow = (kind: CollectionKind) => (r: any): CollectionItem => {
    const dueDate = normYmd(r.due_date)
    const act = followMap.get(`${kind}:${r.id}`)
    const nextFollow = normYmd(nextMap.get(`${kind}:${r.id}`))
    const followDate = nextFollow ?? dueDate
    const daysLeft = followDate ? daysBetween(today, followDate) : null
    return {
      kind,
      id: r.id,
      number: r.number,
      customer_id: r.customer_id,
      customer_name: r.customer_name ?? null,
      customer_phone: r.customer_phone ?? null,
      due_date: dueDate,
      next_follow_date: nextFollow,
      follow_date: followDate,
      days_left: daysLeft,
      amount: r2(Number(r.amount) || 0),
      last_follow: act
        ? {
            note: act.note,
            type: act.type,
            created_at: act.created_at,
            created_by: act.created_by ?? null,
          }
        : null,
    }
  }

  const items: CollectionItem[] = [
    ...invRows.map(mapRow('INVOICE')),
    ...soRows.map(mapRow('SALES_ORDER')),
    ...qtRows.map(mapRow('QUOTATION')),
  ]

  items.sort((a, b) => {
    if (a.follow_date === null && b.follow_date === null) return b.amount - a.amount || a.number.localeCompare(b.number)
    if (a.follow_date === null) return 1
    if (b.follow_date === null) return -1
    return a.follow_date.localeCompare(b.follow_date) || b.amount - a.amount || a.number.localeCompare(b.number)
  })

  return items
}

/** สรุปยอดติดตามบิล: นับจำนวนรวม QT แต่รวมยอดเงินเฉพาะ INVOICE และ SALES_ORDER (ไม่นับ null) */
export function summarizeCollections(items: CollectionItem[]): CollectionSummary {
  const summary: CollectionSummary = {
    overdue: { count: 0, amount: 0 },
    today: { count: 0, amount: 0 },
    soon: { count: 0, amount: 0 },
  }

  for (const it of items) {
    if (it.days_left === null) continue
    const bucket = it.days_left < 0
      ? summary.overdue
      : it.days_left === 0
        ? summary.today
        : it.days_left <= 3
          ? summary.soon
          : null
    if (!bucket) continue
    bucket.count += 1
    if (it.kind === 'INVOICE' || it.kind === 'SALES_ORDER') {
      bucket.amount = r2(bucket.amount + it.amount)
    }
  }

  return summary
}

export function getCollections(
  tenantId: string,
  opts: { today?: string; customerId?: string } = {}
): { items: CollectionItem[]; summary: CollectionSummary } {
  const items = collectionItems(tenantId, opts)
  return { items, summary: summarizeCollections(items) }
}
