import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { normName } from './stockItem.service'

// ============================================================
// รอบเดือนช่องทางขายแพลตฟอร์ม (Shopee ตอนนี้ — Lazada ตามมาทีหลัง) — เฟส 1
// รับ 6 ไฟล์ต่อรอบผ่าน MCP (ไม่อัปโหลด CSV อีกต่อไป): income, balance, products, ads, stats, orders
// เก็บยอดเต็มตามที่ไฟล์สรุปให้มา ไม่คำนวณเลขเอง — ตรวจแค่ว่าตัวเลขที่ส่งมาสมการตรงกันเองและข้ามไฟล์
//
// กติกาเครื่องหมาย (คุยกับเจ้าของแล้ว): ค่าธรรมเนียม/รายจ่าย/เงินออกทุกตัว Shopee ให้มาเป็น "ค่าลบ" อยู่แล้ว
// ในไฟล์ของเขาเอง ระบบนี้จึง "บวกตรงๆ" เสมอ ไม่มีการใส่เครื่องหมายลบเพิ่มในสมการใดๆ
// (ดูชัดจากเลขจริง: total_income + total_expense(ลบ) = total_transferred,
//  opening + money_in + money_out(ลบ) = closing, order_income_in + order_income_out(ลบ) = total_transferred)
// ============================================================

export class PlatformMonthError extends Error {}

const TOL = 1 // บาท — ความคลาดเคลื่อนที่ยอมรับได้จากการปัดเศษของแพลตฟอร์ม
const r2 = (n: number) => Math.round((n || 0) * 100) / 100
const near = (a: number, b: number) => Math.abs(r2(a) - r2(b)) <= TOL

// #2: trim + ยุบช่องว่างซ้อนให้เหลือ 1 ช่อง (เคส 'ร้านหลัก ' vs 'ร้านหลัก' ที่ทำให้สร้างรอบแยกกัน — opening
// ถูกลงบัญชีซ้ำสองรอบ) คงตัวพิมพ์เดิมไว้ (ชื่อร้านไทยไม่มีเคสให้สลับ ไม่ทำเกินที่ต้องใช้จริงตอนนี้)
export function normShopKey(shopKey: string): string {
  return String(shopKey || '').trim().replace(/\s+/g, ' ')
}

// #13: วันที่ปฎิทินจริง — กัน 2026-02-30 / 2026-10-45 ที่ regex รูปแบบเฉยๆ ปล่อยผ่านได้ (Date parse แบบ
// native จะ "เลื่อนวัน" ให้เองเงียบๆ เช่น 2026-02-30 → 2026-03-02) round-trip ผ่าน Date.UTC แล้วเทียบ Y-M-D กลับ
export function isValidCalendarDate(dateStr: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '')
  if (!m) return false
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

export type PlatformFileType = 'income' | 'balance' | 'products' | 'ads' | 'stats' | 'orders'

export interface IncomePayload {
  period_start: string
  period_end: string
  order_count: number
  product_list_price: number
  seller_discount: number
  refund_to_buyer: number
  shopee_product_discount: number
  product_sales: number
  total_income: number
  shipping_buyer_paid: number
  shipping_shopee_subsidy: number
  shipping_charged: number
  shipping_return: number
  commission: number
  ams_commission: number
  service_fee: number
  infrastructure_fee: number
  transaction_fee: number
  ads_topup_from_escrow: number
  other_fees?: number
  total_expense: number
  total_transferred: number
  adjustments: { total: number; marketing: number; shipping_claim: number; refund_after_complete: number; other: number }
}

export interface BalancePayload {
  period_start: string
  period_end: string
  opening: number
  closing: number
  money_in: number
  money_out: number
  order_income_in: number
  order_income_out: number
  adjustments_in: number
  adjustments_out: number
  withdrawals: Array<{ date: string; amount: number }>
  withdrawals_total: number
}

export interface ProductRow {
  level: 'parent' | 'variant'
  product_id?: string | null
  variant_id?: string | null
  product_name?: string
  variant_name?: string
  sales_all?: number
  sales_confirmed?: number
  orders_all?: number
  orders_confirmed?: number
  qty_all?: number
  qty_confirmed?: number
  visitors?: number
  cart_visitors?: number
  buyers_confirmed?: number
  clicks?: number
  impressions?: number
  repeat_rate?: number
}
export interface ProductsPayload {
  rows: ProductRow[]
}

// ไฟล์ orders (คำสั่งซื้อของฉัน > ส่งออก ทุกสถานะ) — กันยอด sales_confirmed/qty_confirmed ของ Shopee ที่ยัง
// รวมออเดอร์ที่ถูกยกเลิกหลังยืนยัน + คืนสินค้า ไม่มี product_id/variant_id ในไฟล์นี้ (ร้านไม่มีรหัส SKU) จับคู่
// ด้วยชื่อ (product_name, variant_name) กับแถวของไฟล์ products ของรอบเดียวกันเท่านั้น — ดู matchOrdersToProducts
export interface OrderRow {
  product_name: string
  variant_name?: string
  qty_ordered: number
  qty_cancelled: number
  qty_unpaid: number
  qty_returned: number
  sales_net: number
}
export interface OrdersPayload {
  period_start: string
  period_end: string
  rows: OrderRow[]
  orders_total: number
  orders_cancelled: number
}

export interface AdsCampaign {
  name: string
  ad_type: string
  status: string
  product_id?: string | null
  impressions: number
  clicks: number
  orders: number
  direct_orders: number
  items_sold: number
  sales: number
  direct_sales: number
  cost: number
}
export interface AdsPayload {
  period_start: string
  period_end: string
  campaigns: AdsCampaign[]
  total_cost: number
}

export interface DayRow {
  date: string
  sales_all: number
  orders_all: number
  sales_confirmed: number
  orders_confirmed: number
  visitors: number
  clicks: number
  cancelled_orders: number
  cancelled_sales: number
  buyers: number
  new_buyers: number
  existing_buyers: number
  potential_buyers: number
}
export interface StatsPayload {
  period_start: string
  period_end: string
  totals: {
    sales_all: number
    sales_confirmed: number
    orders_all: number
    orders_confirmed: number
    visitors: number
    clicks: number
    cancelled_orders: number
    cancelled_sales: number
    buyers: number
    new_buyers: number
    existing_buyers: number
    potential_buyers: number
    repeat_rate: number
  }
  daily: DayRow[]
  sources: { product_page: number; live: number; video: number; partner: number; ads_attributed: number }
}

export type PlatformFilePayload = IncomePayload | BalancePayload | ProductsPayload | AdsPayload | StatsPayload | OrdersPayload

export interface SubmitFileInput {
  platform: string
  shopKey: string
  month: string // YYYY-MM
  fileType: PlatformFileType
  data: PlatformFilePayload
}

export interface CheckResult {
  name: string
  expected: number | null
  actual: number | null
  pass: boolean
}

export interface SubmitFileResult {
  monthId: string
  fileType: PlatformFileType
  status: string
  checks: CheckResult[]
}

const mk = (name: string, expected: number | null, actual: number | null): CheckResult => ({
  name,
  expected: expected == null ? null : r2(expected),
  actual: actual == null ? null : r2(actual),
  pass: expected != null && actual != null && near(expected, actual),
})

// ── เช็คภายในไฟล์เดียว (ก่อนบันทึก) — พังข้อไหนบอกชื่อฟิลด์เป็นภาษาไทย reject ทันที ────────────
function assertIncomeInternal(d: IncomePayload): void {
  const productSales = r2((d.product_list_price || 0) + (d.seller_discount || 0) + (d.refund_to_buyer || 0))
  if (!near(productSales, d.product_sales)) {
    throw new PlatformMonthError(
      `ไฟล์ income: product_list_price + seller_discount + refund_to_buyer ควรเท่า product_sales (คำนวณได้ ${productSales} แต่ไฟล์ให้ ${d.product_sales})`
    )
  }
  const totalIncome = r2((d.product_sales || 0) + (d.shopee_product_discount || 0))
  if (!near(totalIncome, d.total_income)) {
    throw new PlatformMonthError(
      `ไฟล์ income: product_sales + shopee_product_discount ควรเท่า total_income (คำนวณได้ ${totalIncome} แต่ไฟล์ให้ ${d.total_income})`
    )
  }
  const transferred = r2((d.total_income || 0) + (d.total_expense || 0))
  if (!near(transferred, d.total_transferred)) {
    throw new PlatformMonthError(
      `ไฟล์ income: total_income + total_expense ควรเท่า total_transferred (คำนวณได้ ${transferred} แต่ไฟล์ให้ ${d.total_transferred})`
    )
  }
  if (d.adjustments) {
    const adjSum = r2(
      (d.adjustments.marketing || 0) + (d.adjustments.shipping_claim || 0) +
      (d.adjustments.refund_after_complete || 0) + (d.adjustments.other || 0)
    )
    if (!near(adjSum, d.adjustments.total)) {
      throw new PlatformMonthError(
        `ไฟล์ income: adjustments.marketing + shipping_claim + refund_after_complete + other ควรเท่า adjustments.total (คำนวณได้ ${adjSum} แต่ไฟล์ให้ ${d.adjustments.total})`
      )
    }
  }
}

// เดือนปฏิทินของรอบ (month, YYYY-MM) อาจไม่ตรงพอดีกับ period_start/end ของไฟล์ (คอมเมนต์ต้นไฟล์อธิบายไว้)
// แต่วันที่ใช้เป็น JV date จริง (period_end) และวันที่ถอนเงินแต่ละใบ ต้องไม่หลุดไปไกลเกินเดือนก่อน/หลังติดกัน
// — กันรูปแบบวันที่ที่ parse ผิด (เช่น dd/mm/yyyy ที่ยัง pass regex YYYY-MM-DD ได้ถ้าสลับผิดแบบพอดี) หลุด
// มาเป็นวันที่ JV ที่ผิดเดือนไปไกลๆ (finding #13)
function monthKeyOf(dateStr: string): string {
  return (dateStr || '').slice(0, 7)
}
function assertDateNearMonth(dateStr: string | undefined | null, month: string, label: string): void {
  if (!dateStr) return
  if (!isValidCalendarDate(dateStr)) {
    throw new PlatformMonthError(`${label}: วันที่ "${dateStr}" ไม่ใช่วันที่จริงในปฏิทิน`)
  }
  const key = monthKeyOf(dateStr)
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return
  const prevD = new Date(y, m - 2, 1)
  const nextD = new Date(y, m, 1)
  const prevKey = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`
  const nextKey = `${nextD.getFullYear()}-${String(nextD.getMonth() + 1).padStart(2, '0')}`
  if (key !== month && key !== prevKey && key !== nextKey) {
    throw new PlatformMonthError(`${label}: วันที่ ${dateStr} ไม่อยู่ในช่วงรอบเดือน ${month} (หรือเดือนก่อน/หลังติดกัน) — ตรวจรูปแบบวันที่`)
  }
}

function assertBalanceInternal(d: BalancePayload): void {
  const closing = r2((d.opening || 0) + (d.money_in || 0) + (d.money_out || 0))
  if (!near(closing, d.closing)) {
    throw new PlatformMonthError(
      `ไฟล์ balance: opening + money_in + money_out ควรเท่า closing (คำนวณได้ ${closing} แต่ไฟล์ให้ ${d.closing})`
    )
  }
  const wSum = r2((d.withdrawals || []).reduce((s, w) => s + (w.amount || 0), 0))
  if (!near(wSum, d.withdrawals_total)) {
    throw new PlatformMonthError(
      `ไฟล์ balance: ผลรวมของ withdrawals ควรเท่า withdrawals_total (คำนวณได้ ${wSum} แต่ไฟล์ให้ ${d.withdrawals_total})`
    )
  }
}

// ไฟล์ ads: ผลรวม cost ของทุกแคมเปญ ควรเท่า total_cost (ถ้ามีแคมเปญมาด้วย) ──────────────────────
function assertAdsInternal(d: AdsPayload): void {
  if (!d.campaigns || d.campaigns.length === 0) {
    if (!near(0, d.total_cost)) {
      throw new PlatformMonthError(`ไฟล์ ads: ไม่มีแคมเปญเลย แต่ total_cost ไม่เป็น 0 (ได้ ${d.total_cost})`)
    }
    return
  }
  const sum = r2(d.campaigns.reduce((s, c) => s + (c.cost || 0), 0))
  if (!near(sum, d.total_cost)) {
    throw new PlatformMonthError(`ไฟล์ ads: ผลรวม cost ของแคมเปญทั้งหมด ควรเท่า total_cost (คำนวณได้ ${sum} แต่ไฟล์ให้ ${d.total_cost})`)
  }
}

// ไฟล์ stats: ผลรวมรายวัน (daily) ของฟิลด์ที่เป็น "จำนวนนับต่อวัน" ควรเท่า totals ของฟิลด์เดียวกัน
// (เฉพาะฟิลด์ที่บวกกันได้จริงตามความหมาย — ไม่รวม visitors/buyers/repeat_rate ที่เป็น unique count รายเดือน
// ซึ่งการรวมรายวันไม่มีความหมายทางบัญชี ไม่ใช่ว่าลืมเช็ค) ──────────────────────────────────────
const STATS_DAILY_SUM_FIELDS = ['sales_all', 'sales_confirmed', 'orders_all', 'orders_confirmed', 'cancelled_orders', 'cancelled_sales'] as const
function assertStatsInternal(d: StatsPayload): void {
  const daily = d.daily || []
  if (daily.length === 0) {
    const anyNonZero = STATS_DAILY_SUM_FIELDS.some((f) => Number((d.totals as any)?.[f]) !== 0)
    if (anyNonZero) {
      throw new PlatformMonthError('ไฟล์ stats: totals มีค่าไม่เป็นศูนย์ แต่ daily ไม่มีข้อมูลเลย — ต้องส่ง daily มาด้วย')
    }
    return
  }
  const seenDates = new Set<string>()
  for (const day of daily) {
    if (seenDates.has(day.date)) {
      throw new PlatformMonthError(`ไฟล์ stats: daily มีวันที่ซ้ำกัน (${day.date})`)
    }
    seenDates.add(day.date)
    if (day.date < d.period_start || day.date > d.period_end) {
      throw new PlatformMonthError(`ไฟล์ stats: daily วันที่ ${day.date} อยู่นอกช่วง period_start..period_end (${d.period_start}..${d.period_end})`)
    }
  }
  for (const field of STATS_DAILY_SUM_FIELDS) {
    const sum = r2(daily.reduce((s, day) => s + (Number((day as any)[field]) || 0), 0))
    const total = (d.totals as any)?.[field]
    if (!near(sum, total)) {
      throw new PlatformMonthError(`ไฟล์ stats: ผลรวม ${field} ของ daily ทั้งหมด ควรเท่า totals.${field} (คำนวณได้ ${sum} แต่ไฟล์ให้ ${total})`)
    }
  }
}

// ไฟล์ products: ผลรวมแถว variant ของสินค้าเดียวกัน ควรเท่าแถว parent ของสินค้านั้น (เฉพาะสินค้าที่มีทั้ง
// parent และ variant มาด้วย — สินค้าไม่มีตัวเลือกไม่มีแถว variant ให้เทียบอยู่แล้ว) sales ปัดเศษ ±1 บาท,
// qty ต้องตรงเป๊ะ (จำนวนหน่วยนับ ไม่มีเศษปัดจากแพลตฟอร์ม) ────────────────────────────────────────
const PRODUCTS_SUM_FIELDS: Array<{ key: keyof ProductRow; exact: boolean }> = [
  { key: 'sales_all', exact: false },
  { key: 'sales_confirmed', exact: false },
  { key: 'qty_all', exact: true },
  { key: 'qty_confirmed', exact: true },
]
function assertProductsInternal(rows: ProductRow[]): void {
  const byProduct = new Map<string, { parent?: ProductRow; variants: ProductRow[] }>()
  for (const row of rows) {
    if (!row.product_id) continue
    const entry = byProduct.get(row.product_id) || { variants: [] }
    if (row.level === 'parent') entry.parent = row
    else entry.variants.push(row)
    byProduct.set(row.product_id, entry)
  }
  for (const [productId, { parent, variants }] of byProduct) {
    if (!parent || variants.length === 0) continue
    for (const { key, exact } of PRODUCTS_SUM_FIELDS) {
      const anyVariantHasField = variants.some((v) => v[key] !== undefined && v[key] !== null)
      if (!anyVariantHasField) continue // คอลัมน์นี้ไม่มีระดับ variant ในไฟล์ต้นฉบับ — ไม่มีอะไรให้เทียบ
      const sum = r2(variants.reduce((s, v) => s + (Number(v[key]) || 0), 0))
      const parentVal = r2(Number(parent[key]) || 0)
      const okay = exact ? sum === parentVal : near(sum, parentVal)
      if (!okay) {
        throw new PlatformMonthError(`ไฟล์ products: สินค้า ${productId} ผลรวม ${key} ของตัวเลือกทั้งหมด (${sum}) ไม่เท่ากับแถวสรุป (${parentVal})`)
      }
    }
  }
}

// ไฟล์ orders: ต่อแถว qty_cancelled+qty_unpaid ต้องไม่เกิน qty_ordered, qty_returned ต้องไม่เกินส่วนที่เหลือ
// หลังหักยกเลิก/ที่ต้องชำระ — ทั้งหมดเป็นจำนวนนับ (ไม่ใช่เงิน) จึงเทียบตรงๆ ไม่ปัดเศษ (±0)
function assertOrdersInternal(d: OrdersPayload): void {
  for (const row of d.rows || []) {
    const cancelledPlusUnpaid = (row.qty_cancelled || 0) + (row.qty_unpaid || 0)
    if (cancelledPlusUnpaid > (row.qty_ordered || 0)) {
      throw new PlatformMonthError(
        `ไฟล์ orders: "${row.product_name}${row.variant_name ? ' · ' + row.variant_name : ''}" qty_cancelled+qty_unpaid (${cancelledPlusUnpaid}) เกิน qty_ordered (${row.qty_ordered})`
      )
    }
    const remaining = (row.qty_ordered || 0) - cancelledPlusUnpaid
    if ((row.qty_returned || 0) > remaining) {
      throw new PlatformMonthError(
        `ไฟล์ orders: "${row.product_name}${row.variant_name ? ' · ' + row.variant_name : ''}" qty_returned (${row.qty_returned}) เกินจำนวนที่เหลือหลังหักยกเลิก/ที่ต้องชำระ (${remaining})`
      )
    }
  }
  if ((d.orders_cancelled || 0) > (d.orders_total || 0)) {
    throw new PlatformMonthError(`ไฟล์ orders: orders_cancelled (${d.orders_cancelled}) เกิน orders_total (${d.orders_total})`)
  }
}

// ── จับคู่ชื่อ orders ↔ products ของรอบเดียวกัน — ไม่มี product_id/variant_id ในไฟล์ orders ─────────────
// variant_name ว่าง/'-' = จับคู่กับแถว parent ของสินค้าที่ไม่มีตัวเลือกเลย ไม่ใช่ parent ของสินค้าที่มีตัวเลือก
// (สินค้ามีตัวเลือก ยอดต้องอยู่ที่แถว variant เท่านั้น — เหมือน assertProductsInternal ที่แยก parent/variant)
function matchOrdersToProducts(orderRows: OrderRow[], productRows: any[]): { matchOf: Map<number, any>; unmatchedNames: string[]; ambiguousNames: string[] } {
  const groups = new Map<string, { parent?: any; variants: any[] }>()
  for (const pr of productRows) {
    if (!pr.product_id) continue
    const g = groups.get(pr.product_id) || { variants: [] }
    if (pr.level === 'parent') g.parent = pr
    else g.variants.push(pr)
    groups.set(pr.product_id, g)
  }
  const variantMap = new Map<string, any>()
  const parentNoVariantMap = new Map<string, any>()
  // #1: สองสินค้า/ตัวเลือกคนละ product_id/variant_id แต่ชื่อรวม (normalize แล้ว) ชนกันเป๊ะ — จับคู่กับ
  // orders ไม่ได้แน่ชัดว่าเป็นตัวไหน เก็บไว้ปฏิเสธ ไม่จับคู่มั่วเอาแถวแรกที่เจอ
  const ambiguousKeys = new Set<string>()
  const ambiguousNames: string[] = []
  for (const g of groups.values()) {
    const productName = g.parent?.product_name ?? g.variants.find((v) => v.product_name)?.product_name ?? ''
    if (g.variants.length > 0) {
      for (const v of g.variants) {
        const key = normName(v.product_name || productName) + '||' + normName(v.variant_name || '')
        if (variantMap.has(key)) {
          if (!ambiguousKeys.has(key)) { ambiguousKeys.add(key); ambiguousNames.push([v.product_name || productName, v.variant_name].filter(Boolean).join(' · ')) }
        } else {
          variantMap.set(key, v)
        }
      }
    } else if (g.parent) {
      const key = normName(productName)
      if (parentNoVariantMap.has(key)) {
        if (!ambiguousKeys.has(key)) { ambiguousKeys.add(key); ambiguousNames.push(productName) }
      } else {
        parentNoVariantMap.set(key, g.parent)
      }
    }
  }
  const matchOf = new Map<number, any>()
  const unmatchedNames: string[] = []
  orderRows.forEach((o, idx) => {
    const vn = normName(o.variant_name || '')
    const isNoVariant = vn === '' || vn === '-'
    const match = isNoVariant ? parentNoVariantMap.get(normName(o.product_name)) : variantMap.get(normName(o.product_name) + '||' + vn)
    if (match) matchOf.set(idx, match)
    else unmatchedNames.push([o.product_name, o.variant_name].filter(Boolean).join(' · '))
  })
  return { matchOf, unmatchedNames, ambiguousNames }
}

// คำนวณ qty_net/sales_net ต่อแถวของ platform_month_products จากไฟล์ orders ที่จับคู่ได้ — รันทุกครั้งที่
// products หรือ orders ถูกส่ง/ส่งซ้ำ (products resubmit ลบแถวเดิมทั้งก้อน ต้องคำนวณใหม่เสมอ) แถวที่ไม่มีใน
// orders เลย = ไม่มียอดขายสุทธิ (qty_net/sales_net = 0) ไม่ใช่ null (null คือ "ยังไม่มีไฟล์ orders เลย")
function applyOrdersDerivation(monthId: string): void {
  const month = db.prepare(`SELECT orders_json FROM platform_months WHERE id = ?`).get(monthId) as any
  if (!month?.orders_json) return // ยังไม่มีไฟล์ orders — รอมาก่อนค่อยคำนวณ ไม่ reject ตอนนี้
  const orders = JSON.parse(month.orders_json) as OrdersPayload
  const productRows = db.prepare(`SELECT * FROM platform_month_products WHERE month_id = ?`).all(monthId) as any[]
  if (productRows.length === 0) return // ยังไม่มีไฟล์ products — รอมาก่อนค่อยจับคู่

  const { matchOf, unmatchedNames, ambiguousNames } = matchOrdersToProducts(orders.rows || [], productRows)
  if (ambiguousNames.length > 0) {
    throw new PlatformMonthError(
      `ไฟล์ products: ชื่อสินค้า/ตัวเลือกชนกัน (คนละรหัสแต่ชื่อเหมือนกัน) จับคู่กับไฟล์ orders ไม่ได้แน่ชัด ${ambiguousNames.length} รายการ: ${ambiguousNames.slice(0, 10).join(', ')}${ambiguousNames.length > 10 ? ' ...' : ''}`
    )
  }
  if (unmatchedNames.length > 0) {
    throw new PlatformMonthError(
      `ไฟล์ orders: จับคู่ชื่อกับสินค้าในไฟล์ products ไม่ได้ ${unmatchedNames.length} รายการ: ${unmatchedNames.slice(0, 10).join(', ')}${unmatchedNames.length > 10 ? ' ...' : ''}`
    )
  }

  // #1: สอง order row จับคู่ไปที่แถว product เดียวกันได้ (ชื่อต่างกันแค่เว้นวรรค/ตัวพิมพ์ normalize แล้ว
  // เหมือนกัน) — ต้องรวมยอด ไม่ใช่ set ทับ (set ทับเคยทำให้ qty_net/sales_net ตัดหายไปครึ่งหนึ่งเงียบๆ)
  const netByRowId = new Map<string, { qtyNet: number; salesNet: number }>()
  matchOf.forEach((productRow, orderIdx) => {
    const o = orders.rows[orderIdx]
    const qtyNet = (o.qty_ordered || 0) - (o.qty_cancelled || 0) - (o.qty_unpaid || 0) - (o.qty_returned || 0)
    const prev = netByRowId.get(productRow.id)
    if (prev) { prev.qtyNet += qtyNet; prev.salesNet += (o.sales_net || 0) }
    else netByRowId.set(productRow.id, { qtyNet, salesNet: o.sales_net || 0 })
  })
  const update = db.prepare(`UPDATE platform_month_products SET qty_net = ?, sales_net = ? WHERE id = ?`)
  for (const pr of productRows) {
    const net = netByRowId.get(pr.id)
    update.run(net ? net.qtyNet : 0, net ? net.salesNet : 0, pr.id)
  }

  // parent ของสินค้าที่มีตัวเลือก = sum(qty_net/sales_net ของตัวเลือกทั้งหมด) — อ่านค่าที่เพิ่ง UPDATE ไปสดๆ
  const byProductId = new Map<string, { parent?: any; variantIds: string[] }>()
  for (const pr of productRows) {
    if (!pr.product_id) continue
    const g = byProductId.get(pr.product_id) || { variantIds: [] }
    if (pr.level === 'parent') g.parent = pr
    else g.variantIds.push(pr.id)
    byProductId.set(pr.product_id, g)
  }
  for (const { parent, variantIds } of byProductId.values()) {
    if (!parent || variantIds.length === 0) continue
    const placeholders = variantIds.map(() => '?').join(',')
    const sums = db.prepare(`SELECT SUM(qty_net) AS q, SUM(sales_net) AS s FROM platform_month_products WHERE id IN (${placeholders})`).get(...variantIds) as any
    db.prepare(`UPDATE platform_month_products SET qty_net = ?, sales_net = ? WHERE id = ?`).run(sums?.q || 0, sums?.s || 0, parent.id)
  }
}

// ── เช็คข้ามไฟล์ — ใช้ทั้งตอน submit (reject ถ้าพัง) และตอน getMonthStatus (แสดงผลรวม) ───────────
function runChecks(row: any, productsSumConfirmedParent: number | null): CheckResult[] {
  const checks: CheckResult[] = []
  const income: IncomePayload | null = row.income_json ? JSON.parse(row.income_json) : null
  const balance: BalancePayload | null = row.balance_json ? JSON.parse(row.balance_json) : null
  const stats: StatsPayload | null = row.stats_json ? JSON.parse(row.stats_json) : null

  if (income) {
    const productSales = r2((income.product_list_price || 0) + (income.seller_discount || 0) + (income.refund_to_buyer || 0))
    checks.push(mk('income: product_list_price+seller_discount+refund_to_buyer = product_sales', productSales, income.product_sales))
    const totalIncome = r2((income.product_sales || 0) + (income.shopee_product_discount || 0))
    checks.push(mk('income: product_sales+shopee_product_discount = total_income', totalIncome, income.total_income))
    const transferred = r2((income.total_income || 0) + (income.total_expense || 0))
    checks.push(mk('income: total_income+total_expense = total_transferred', transferred, income.total_transferred))
  }

  if (balance) {
    const closing = r2((balance.opening || 0) + (balance.money_in || 0) + (balance.money_out || 0))
    checks.push(mk('balance: opening+money_in+money_out = closing', closing, balance.closing))
    const wSum = r2((balance.withdrawals || []).reduce((s, w) => s + (w.amount || 0), 0))
    checks.push(mk('balance: sum(withdrawals) = withdrawals_total', wSum, balance.withdrawals_total))
  }

  if (income && balance) {
    const transferredFromBalance = r2((balance.order_income_in || 0) + (balance.order_income_out || 0))
    checks.push(mk('income.total_transferred = balance.order_income_in+order_income_out', income.total_transferred, transferredFromBalance))
    const adjFromBalance = r2((balance.adjustments_in || 0) + (balance.adjustments_out || 0))
    checks.push(mk('income.adjustments.total = balance.adjustments_in+adjustments_out', income.adjustments?.total ?? null, adjFromBalance))
  }

  if (stats && productsSumConfirmedParent != null) {
    checks.push(mk('sum(products.sales_confirmed, level=parent) = stats.totals.sales_confirmed', productsSumConfirmedParent, stats.totals?.sales_confirmed ?? null))
  }

  return checks
}

function sumParentSalesConfirmed(monthId: string): number | null {
  const row = db.prepare(`
    SELECT SUM(sales_confirmed) AS s, COUNT(*) AS c FROM platform_month_products WHERE month_id = ? AND level = 'parent'
  `).get(monthId) as any
  if (!row || !row.c) return null
  return r2(row.s || 0)
}

function getOrCreateMonth(tenantId: string, platform: string, shopKey: string, month: string): any {
  let row = db.prepare(`
    SELECT * FROM platform_months WHERE tenant_id = ? AND platform = ? AND shop_key = ? AND month = ?
  `).get(tenantId, platform, shopKey, month) as any
  if (row) return row

  const id = generateId()
  db.prepare(`
    INSERT INTO platform_months (id, tenant_id, platform, shop_key, month, status) VALUES (?, ?, ?, ?, ?, 'COLLECTING')
  `).run(id, tenantId, platform, shopKey, month)
  return db.prepare(`SELECT * FROM platform_months WHERE id = ?`).get(id)
}

/**
 * บันทึกไฟล์หนึ่งไฟล์ของรอบเดือน — ส่งซ้ำ = เขียนทับของเดือนนั้น (products/stats แทนที่แถวลูกทั้งก้อน)
 * ทั้งหมดอยู่ในทรานแซกชันเดียว: ถ้าตรวจพบว่าไฟล์นี้ทำให้สมการ (ภายในไฟล์ หรือข้ามไฟล์กับไฟล์ที่มีอยู่แล้ว) ไม่ตรง
 * จะ throw แล้ว rollback ทั้งก้อน — ไม่บันทึกไฟล์ที่ทำให้ข้อมูลขัดกันเอง
 */
export function submitFile(tenantId: string, input: SubmitFileInput): SubmitFileResult {
  const { platform, month, fileType, data } = input
  // #2: 'ร้านหลัก ' (เว้นวรรคท้าย) เคยสร้างรอบแยกจาก 'ร้านหลัก' ทำให้ opening ถูกลงบัญชีซ้ำสองรอบ — normalize
  // ที่ชั้น service (จุดเข้าที่เชื่อถือได้เสมอ) แม้ MCP จะ trim มาให้แล้วก็ตาม
  const shopKey = normShopKey(input.shopKey)
  if (!/^\d{4}-\d{2}$/.test(month)) throw new PlatformMonthError('รูปแบบ month ต้องเป็น YYYY-MM')

  return db.transaction(() => {
    const row = getOrCreateMonth(tenantId, platform, shopKey, month)

    if (row.status !== 'COLLECTING') {
      throw new PlatformMonthError(`รอบเดือนนี้ปิดแล้ว (status = ${row.status}) ส่งไฟล์เพิ่ม/แก้ไม่ได้`)
    }

    if (fileType === 'income') {
      assertIncomeInternal(data as IncomePayload)
      assertDateNearMonth((data as IncomePayload).period_start, month, 'ไฟล์ income period_start')
      assertDateNearMonth((data as IncomePayload).period_end, month, 'ไฟล์ income period_end')
    }
    if (fileType === 'balance') {
      assertBalanceInternal(data as BalancePayload)
      const bd = data as BalancePayload
      assertDateNearMonth(bd.period_start, month, 'ไฟล์ balance period_start')
      assertDateNearMonth(bd.period_end, month, 'ไฟล์ balance period_end')
      for (const w of bd.withdrawals || []) assertDateNearMonth(w.date, month, `ไฟล์ balance withdrawal วันที่ ${w.date}`)
    }
    if (fileType === 'ads') {
      assertAdsInternal(data as AdsPayload)
      const ad = data as AdsPayload
      assertDateNearMonth(ad.period_start, month, 'ไฟล์ ads period_start')
      assertDateNearMonth(ad.period_end, month, 'ไฟล์ ads period_end')
    }
    if (fileType === 'stats') {
      assertStatsInternal(data as StatsPayload)
      const sd = data as StatsPayload
      assertDateNearMonth(sd.period_start, month, 'ไฟล์ stats period_start')
      assertDateNearMonth(sd.period_end, month, 'ไฟล์ stats period_end')
    }
    if (fileType === 'products') assertProductsInternal((data as ProductsPayload).rows || [])
    if (fileType === 'orders') {
      assertOrdersInternal(data as OrdersPayload)
      const od = data as OrdersPayload
      assertDateNearMonth(od.period_start, month, 'ไฟล์ orders period_start')
      assertDateNearMonth(od.period_end, month, 'ไฟล์ orders period_end')
    }

    // #13: เฉพาะไฟล์บัญชี (income/balance) เท่านั้นที่กำหนด period_start/end ของรอบได้ — ads/stats/orders/
    // products ก็มี period_start/end ในไฟล์เหมือนกัน แต่ COALESCE เดิมให้ไฟล์ไหนมาถึงก่อน "ชนะ" ค้างตลอดรอบ
    // (ถ้า ads ถูกส่งก่อน income คนละปี จะทับช่วงที่ถูกไปแบบถาวร) income/balance คือยอดอ้างอิงบัญชีจริงของรอบ
    const isAccountingFile = fileType === 'income' || fileType === 'balance'
    const periodStart = isAccountingFile ? ((data as any).period_start ?? row.period_start) : row.period_start
    const periodEnd = isAccountingFile ? ((data as any).period_end ?? row.period_end) : row.period_end

    if (fileType === 'products') {
      const rows = (data as ProductsPayload).rows || []
      db.prepare(`DELETE FROM platform_month_products WHERE month_id = ?`).run(row.id)
      const insert = db.prepare(`
        INSERT INTO platform_month_products
          (id, month_id, tenant_id, product_id, variant_id, level, product_name, variant_name,
           sales_all, sales_confirmed, orders_all, orders_confirmed, qty_all, qty_confirmed,
           visitors, cart_visitors, buyers_confirmed, clicks, impressions, repeat_rate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const r of rows) {
        insert.run(
          generateId(), row.id, tenantId, r.product_id ?? null, r.variant_id ?? null, r.level,
          r.product_name ?? null, r.variant_name ?? null,
          r.sales_all ?? 0, r.sales_confirmed ?? 0, r.orders_all ?? 0, r.orders_confirmed ?? 0,
          r.qty_all ?? 0, r.qty_confirmed ?? 0, r.visitors ?? 0, r.cart_visitors ?? 0,
          r.buyers_confirmed ?? 0, r.clicks ?? 0, r.impressions ?? 0, r.repeat_rate ?? 0
        )
      }
      db.prepare(`
        UPDATE platform_months SET products_received = 1, period_start = COALESCE(period_start, ?),
          period_end = COALESCE(period_end, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(periodStart, periodEnd, row.id)
    } else if (fileType === 'stats') {
      const payload = data as StatsPayload
      const daily = payload.daily || []
      db.prepare(`DELETE FROM platform_days WHERE month_id = ?`).run(row.id)
      const insertDay = db.prepare(`
        INSERT INTO platform_days
          (id, month_id, tenant_id, date, sales_all, orders_all, sales_confirmed, orders_confirmed,
           visitors, clicks, cancelled_orders, cancelled_sales, buyers, new_buyers, existing_buyers, potential_buyers)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const d of daily) {
        insertDay.run(
          generateId(), row.id, tenantId, d.date, d.sales_all ?? 0, d.orders_all ?? 0,
          d.sales_confirmed ?? 0, d.orders_confirmed ?? 0, d.visitors ?? 0, d.clicks ?? 0,
          d.cancelled_orders ?? 0, d.cancelled_sales ?? 0, d.buyers ?? 0, d.new_buyers ?? 0,
          d.existing_buyers ?? 0, d.potential_buyers ?? 0
        )
      }
      db.prepare(`
        UPDATE platform_months SET stats_json = ?, period_start = COALESCE(period_start, ?),
          period_end = COALESCE(period_end, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(JSON.stringify(payload), periodStart, periodEnd, row.id)
    } else {
      const col = fileType === 'income' ? 'income_json' : fileType === 'balance' ? 'balance_json' : fileType === 'orders' ? 'orders_json' : 'ads_json'
      db.prepare(`
        UPDATE platform_months SET ${col} = ?, period_start = COALESCE(period_start, ?),
          period_end = COALESCE(period_end, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(JSON.stringify(data), periodStart, periodEnd, row.id)
    }

    if (fileType === 'products' || fileType === 'orders') applyOrdersDerivation(row.id)

    const fresh = db.prepare(`SELECT * FROM platform_months WHERE id = ?`).get(row.id) as any
    const productsSum = sumParentSalesConfirmed(row.id)
    const checks = runChecks(fresh, productsSum)
    const failed = checks.filter(c => !c.pass)
    if (failed.length > 0) {
      throw new PlatformMonthError(
        `ไฟล์นี้ทำให้สมการไม่ตรง: ${failed.map(f => `${f.name} (คาด ${f.expected} ได้ ${f.actual})`).join('; ')}`
      )
    }

    return { monthId: row.id, fileType, status: fresh.status, checks }
  })()
}

export interface MonthStatus {
  found: boolean
  monthId?: string
  status?: string
  filesReceived: { income: boolean; balance: boolean; products: boolean; ads: boolean; stats: boolean; orders: boolean }
  receivedCount: number
  checks: CheckResult[]
  allChecksPass: boolean
}

export function getMonthStatus(tenantId: string, platform: string, shopKey: string, month: string): MonthStatus {
  const row = db.prepare(`
    SELECT * FROM platform_months WHERE tenant_id = ? AND platform = ? AND shop_key = ? AND month = ?
  `).get(tenantId, platform, normShopKey(shopKey), month) as any

  if (!row) {
    return {
      found: false,
      filesReceived: { income: false, balance: false, products: false, ads: false, stats: false, orders: false },
      receivedCount: 0,
      checks: [],
      allChecksPass: false,
    }
  }

  const filesReceived = {
    income: !!row.income_json,
    balance: !!row.balance_json,
    products: !!row.products_received,
    ads: !!row.ads_json,
    stats: !!row.stats_json,
    orders: !!row.orders_json,
  }
  const productsSum = sumParentSalesConfirmed(row.id)
  const checks = runChecks(row, productsSum)

  return {
    found: true,
    monthId: row.id,
    status: row.status,
    filesReceived,
    receivedCount: Object.values(filesReceived).filter(Boolean).length,
    checks,
    allChecksPass: checks.length > 0 && checks.every(c => c.pass),
  }
}
