import db from '../db/sqlite'
import { upsertOrderPii, type OrderPiiRow } from '../db/piiConnection'
import { generateId } from '../utils/id'
import { maskName, maskPhone, maskAddress } from '../utils/piiMask'
import { roundQty } from '../utils/qty'
import {
  normName,
  findPlatformAlias,
  upsertPlatformAlias,
  StockItemRefError,
  isServiceItem,
} from './stockItem.service'
import { sourceRefOf } from './platformMonthSale.service'
import {
  buildProductNameIndex,
  lookupProductByName,
  normShopKey,
  isValidCalendarDate,
  type ProductNameIndex,
  type OrdersPayload,
} from './platformMonth.service'

// ============================================================
// ออเดอร์ออนไลน์รายออเดอร์ (docs/contracts/online-orders.md)
// - Generic ตาม platform (วันนี้รองรับ SHOPEE; ชื่อตาราง/ฟังก์ชันไม่ผูกกับ Shopee)
// - เก็บเฉพาะค่ามาสก์ในฐานหลัก (PII ดิบอยู่ใน pii.db แยกไฟล์)
// - ไม่ลงบัญชี ไม่ตัดสต็อกตอนรับออเดอร์ (บัญชีและสต็อกยังมาจากสายรอบเดือนเดิม)
//   ยกเว้นข้อ 6: รับคืนข้ามเดือน (restockReturnEvents) → stock_movements IN เท่านั้น ไม่ลงบัญชี
// ============================================================

export class OnlineOrderError extends Error {}

export type OnlineStatusGroup = 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'UNPAID' | 'RETURNED'
export type OnlineSummaryGroupBy = 'province' | 'district' | 'product' | 'variant' | 'shop' | 'day' | 'month'

const VALID_STATUS_GROUPS = new Set<OnlineStatusGroup>(['ACTIVE', 'COMPLETED', 'CANCELLED', 'UNPAID', 'RETURNED'])
const DEFAULT_INCLUDE_STATUSES: OnlineStatusGroup[] = ['ACTIVE', 'COMPLETED', 'RETURNED']

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const normVariant = (v?: string | null): string => {
  const n = normName(v || '')
  return n === '-' ? '' : n
}
const fallbackSourceRef = (platform: string, productName: string, variantName?: string | null): string =>
  `${platform.toUpperCase()}:N${normName(productName)}||${normVariant(variantName)}`

const cleanOpt = (v?: string | null): string | null => {
  if (v == null) return null
  const t = String(v).trim()
  return t.length > 0 ? t : null
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&')

/**
 * แปลงสถานะดิบจากแพลตฟอร์มเป็น status_group มาตรฐาน
 * - SHOPEE: ยกเลิก→CANCELLED, ที่ต้องชำระ→UNPAID, คืน หรือ qtyReturnedSum>0→RETURNED, สำเร็จ→COMPLETED, อื่นๆ→ACTIVE
 * - platform อื่น: ยังไม่รองรับ → throw OnlineOrderError
 */
export function statusGroupOf(
  platform: string,
  raw: string | null | undefined,
  qtyReturnedSum = 0,
): OnlineStatusGroup {
  const p = String(platform || '').toUpperCase()
  if (p !== 'SHOPEE') {
    throw new OnlineOrderError(`ยังไม่รองรับแพลตฟอร์ม ${platform}`)
  }
  const s = String(raw || '').trim()
  if (s.includes('ยกเลิก')) return 'CANCELLED'
  if (s.includes('ที่ต้องชำระ')) return 'UNPAID'
  if (s.includes('คืน') || qtyReturnedSum > 0) return 'RETURNED'
  if (s.includes('สำเร็จ')) return 'COMPLETED'
  return 'ACTIVE'
}

/**
 * แปลง order_time (ISO หรือ YYYY-MM-DD HH:mm) เป็น order_date (YYYY-MM-DD ตามเวลาไทย Asia/Bangkok) และ month (YYYY-MM)
 */
export function parseOrderDateThai(orderTime: string): { orderDate: string; month: string } {
  const raw = String(orderTime || '').trim()
  if (!raw) throw new OnlineOrderError('ต้องระบุ order_time')

  // รูปแบบไม่มีโซนเวลา: YYYY-MM-DD หรือ YYYY-MM-DD HH:mm(:ss)? → ถือว่าเป็นเวลาไทย (Shopee export)
  const noZone = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(raw)
  if (noZone) {
    const datePart = noZone[1]
    if (!isValidCalendarDate(datePart)) {
      throw new OnlineOrderError(`order_time ไม่ใช่วันที่จริงในปฏิทิน: ${raw}`)
    }
    if (noZone[2] !== undefined) {
      const hh = Number(noZone[2])
      const mm = Number(noZone[3])
      const ss = Number(noZone[4] ?? 0)
      if (hh > 23 || mm > 59 || ss > 59) {
        throw new OnlineOrderError(`order_time เวลาไม่ถูกต้อง: ${raw}`)
      }
    }
    return { orderDate: datePart, month: datePart.slice(0, 7) }
  }

  // ISO ที่มีโซนเวลา (Z หรือ ±HH:MM / ±HHMM) → แปลงเป็นเวลาไทย (Asia/Bangkok)
  const isoWithZone = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.exec(raw)
  if (isoWithZone) {
    if (!isValidCalendarDate(isoWithZone[1])) {
      throw new OnlineOrderError(`order_time ไม่ใช่วันที่จริงในปฏิทิน: ${raw}`)
    }
    const dt = new Date(raw)
    if (isNaN(dt.getTime())) {
      throw new OnlineOrderError(`order_time รูปแบบไม่ถูกต้อง: ${raw}`)
    }
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(dt)
    const y = parts.find((p) => p.type === 'year')!.value
    const m = parts.find((p) => p.type === 'month')!.value
    const d = parts.find((p) => p.type === 'day')!.value
    const orderDate = `${y}-${m}-${d}`
    return { orderDate, month: `${y}-${m}` }
  }

  throw new OnlineOrderError(`order_time รูปแบบไม่ถูกต้อง (ต้องเป็น ISO หรือ YYYY-MM-DD HH:mm): ${raw}`)
}

// ── ตัวช่วยสร้าง source_ref จาก platform_month_products (ใช้กติกาเดียวกับ matchOrdersToProducts) ──────

interface ShopProductIndices {
  byMonth: Map<string, ProductNameIndex>
  latestMonth: string | null
  latestIndex: ProductNameIndex | null
}

function loadShopProductIndices(tenantId: string, platform: string, shopKey: string): ShopProductIndices {
  const months = db.prepare(`
    SELECT id, month FROM platform_months
    WHERE tenant_id = ? AND platform = ? AND shop_key = ?
    ORDER BY month DESC
  `).all(tenantId, platform, shopKey) as Array<{ id: string; month: string }>

  const byMonth = new Map<string, ProductNameIndex>()
  let latestMonth: string | null = null
  let latestIndex: ProductNameIndex | null = null

  if (months.length === 0) return { byMonth, latestMonth, latestIndex }

  const monthIds = months.map((m) => m.id)
  const placeholders = monthIds.map(() => '?').join(',')
  const allProducts = db.prepare(`
    SELECT * FROM platform_month_products WHERE month_id IN (${placeholders})
  `).all(...monthIds) as any[]

  const rowsByMonthId = new Map<string, any[]>()
  for (const pr of allProducts) {
    const arr = rowsByMonthId.get(pr.month_id) || []
    arr.push(pr)
    rowsByMonthId.set(pr.month_id, arr)
  }

  for (const m of months) {
    const rows = rowsByMonthId.get(m.id)
    if (!rows || rows.length === 0) continue
    const idx = buildProductNameIndex(rows)
    byMonth.set(m.month, idx)
    if (!latestIndex) {
      latestMonth = m.month
      latestIndex = idx
    }
  }

  return { byMonth, latestMonth, latestIndex }
}

function resolveLineSourceRef(
  indices: ShopProductIndices,
  platform: string,
  orderMonth: string,
  productName: string,
  variantName?: string | null,
): string {
  const sameMonthIdx = indices.byMonth.get(orderMonth)
  if (sameMonthIdx) {
    const res = lookupProductByName(sameMonthIdx, productName, variantName)
    if (res.ambiguous) return fallbackSourceRef(platform, productName, variantName)
    if (res.match) return sourceRefOf(platform, res.match)
  }

  if (indices.latestIndex && indices.latestMonth !== orderMonth) {
    const res = lookupProductByName(indices.latestIndex, productName, variantName)
    if (res.ambiguous) return fallbackSourceRef(platform, productName, variantName)
    if (res.match) return sourceRefOf(platform, res.match)
  }

  return fallbackSourceRef(platform, productName, variantName)
}

function loadActiveAliasRefs(tenantId: string): Set<string> {
  const rows = db.prepare(`
    SELECT a.source_ref FROM stock_item_aliases a
    JOIN stock_items s ON s.id = a.stock_item_id AND s.tenant_id = a.tenant_id AND s.status != 'INACTIVE'
    WHERE a.tenant_id = ? AND a.source_ref IS NOT NULL
  `).all(tenantId) as Array<{ source_ref: string }>
  return new Set(rows.map((r) => r.source_ref))
}

// ── Submit online orders ──────────────────────────────────────────────────────────────────

export interface OnlineOrderInputRow {
  orderNo: string
  orderTime: string
  status: string
  buyerName?: string | null
  buyerPhone?: string | null
  fullAddress?: string | null
  province?: string | null
  district?: string | null
  postalCode?: string | null
  productName: string
  variantName?: string | null
  qty: number
  qtyReturned?: number
  listPrice?: number | null
  netPrice: number
  trackingNo?: string | null
  paymentMethod?: string | null
  shippingOption?: string | null
}

export interface SubmitOnlineOrdersInput {
  platform: string
  shopKey: string
  rows: OnlineOrderInputRow[]
}

export interface SubmitOnlineOrdersResult {
  batchId: string
  ordersInserted: number
  ordersUpdated: number
  linesUnlinked: number
  returnEvents: number
  unlinkedNames: string[]
}

/**
 * รับแถวออเดอร์ออนไลน์รายบรรทัด (group ตาม order_no)
 * ลำดับเขียน: PII ลง pii.db ก่อน (upsert) → ฐานหลักใน transaction เดียว
 * ไม่แตะตารางบัญชี/สต็อก/ใบสั่งขายใดๆ ทั้งสิ้น
 */
export function submitOnlineOrders(
  tenantId: string,
  input: SubmitOnlineOrdersInput,
  userId = 'mcp-agent',
): SubmitOnlineOrdersResult {
  const platform = String(input.platform || '').toUpperCase()
  // ตรวจ platform ที่รองรับก่อนเริ่มทำอะไร
  statusGroupOf(platform, '', 0)

  const shopKey = normShopKey(input.shopKey)
  if (!shopKey) throw new OnlineOrderError('ต้องระบุ shopKey')
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new OnlineOrderError('ต้องมีอย่างน้อย 1 แถว')
  }

  // Group rows ตาม order_no พร้อมตรวจความถูกต้องของทุกแถวก่อนเขียน DB ใดๆ
  const grouped = new Map<string, OnlineOrderInputRow[]>()
  for (let i = 0; i < input.rows.length; i++) {
    const r = input.rows[i]
    const orderNo = String(r.orderNo || '').trim()
    if (!orderNo) throw new OnlineOrderError(`แถวที่ ${i + 1}: ต้องระบุ order_no`)
    const productName = String(r.productName || '').trim()
    if (!productName) throw new OnlineOrderError(`แถวที่ ${i + 1}: ต้องระบุ product_name`)
    const qty = Number(r.qty)
    if (!Number.isFinite(qty) || qty <= 0) throw new OnlineOrderError(`แถวที่ ${i + 1}: qty ต้องมากกว่า 0`)
    const qtyReturned = Number(r.qtyReturned ?? 0)
    if (!Number.isFinite(qtyReturned) || qtyReturned < 0) {
      throw new OnlineOrderError(`แถวที่ ${i + 1}: qty_returned ต้องไม่ติดลบ`)
    }
    if (qtyReturned > qty) {
      throw new OnlineOrderError(`แถวที่ ${i + 1}: qty_returned (${qtyReturned}) เกิน qty (${qty})`)
    }
    const netPrice = Number(r.netPrice)
    if (!Number.isFinite(netPrice)) throw new OnlineOrderError(`แถวที่ ${i + 1}: net_price ไม่ถูกต้อง`)
    if (r.listPrice != null && !Number.isFinite(Number(r.listPrice))) {
      throw new OnlineOrderError(`แถวที่ ${i + 1}: list_price ไม่ถูกต้อง`)
    }

    const list = grouped.get(orderNo) || []
    list.push({ ...r, orderNo, productName, qty, qtyReturned, netPrice })
    grouped.set(orderNo, list)
  }

  // เตรียมข้อมูลระดับออเดอร์ + PII และ validate วันที่/สถานะก่อนเขียน
  interface PreparedOrder {
    orderNo: string
    orderTime: string
    orderDate: string
    month: string
    statusRaw: string
    statusGroup: OnlineStatusGroup
    province: string | null
    district: string | null
    postalCode: string | null
    paymentMethod: string | null
    shippingOption: string | null
    trackingNo: string | null
    buyerNameProvided: boolean
    buyerPhoneProvided: boolean
    fullAddressProvided: boolean
    buyerNameMasked: string
    buyerPhoneMasked: string
    addressMasked: string
    lines: OnlineOrderInputRow[]
  }

  const prepared: PreparedOrder[] = []
  const piiRows: OrderPiiRow[] = []

  const firstNonEmpty = (rows: OnlineOrderInputRow[], pick: (r: OnlineOrderInputRow) => string | null | undefined): string | null => {
    for (const r of rows) {
      const v = cleanOpt(pick(r))
      if (v != null) return v
    }
    return null
  }

  for (const [orderNo, orderRows] of grouped) {
    const orderTime = firstNonEmpty(orderRows, (r) => r.orderTime)
    if (!orderTime) throw new OnlineOrderError(`ออเดอร์ ${orderNo}: ต้องระบุ order_time`)
    const { orderDate, month } = parseOrderDateThai(orderTime)

    const statusRaw = firstNonEmpty(orderRows, (r) => r.status) ?? ''
    const qtyReturnedSum = orderRows.reduce((s, r) => s + (r.qtyReturned ?? 0), 0)
    const statusGroup = statusGroupOf(platform, statusRaw, qtyReturnedSum)

    const buyerName = firstNonEmpty(orderRows, (r) => r.buyerName)
    const buyerPhone = firstNonEmpty(orderRows, (r) => r.buyerPhone)
    const fullAddress = firstNonEmpty(orderRows, (r) => r.fullAddress)
    const postalCode = firstNonEmpty(orderRows, (r) => r.postalCode)

    const buyerNameProvided = orderRows.some((r) => r.buyerName !== undefined)
    const buyerPhoneProvided = orderRows.some((r) => r.buyerPhone !== undefined)
    const fullAddressProvided = orderRows.some((r) => r.fullAddress !== undefined)

    prepared.push({
      orderNo,
      orderTime,
      orderDate,
      month,
      statusRaw,
      statusGroup,
      province: firstNonEmpty(orderRows, (r) => r.province),
      district: firstNonEmpty(orderRows, (r) => r.district),
      postalCode,
      paymentMethod: firstNonEmpty(orderRows, (r) => r.paymentMethod),
      shippingOption: firstNonEmpty(orderRows, (r) => r.shippingOption),
      trackingNo: firstNonEmpty(orderRows, (r) => r.trackingNo),
      buyerNameProvided,
      buyerPhoneProvided,
      fullAddressProvided,
      buyerNameMasked: maskName(buyerName),
      buyerPhoneMasked: maskPhone(buyerPhone),
      addressMasked: maskAddress(fullAddress),
      lines: orderRows,
    })

    if (buyerName || buyerPhone || fullAddress || postalCode) {
      piiRows.push({
        tenantId,
        platform,
        shopKey,
        orderNo,
        buyerName,
        buyerPhone,
        fullAddress,
        postalCode,
      })
    }
  }

  // ลำดับเขียนตามสัญญาข้อ 2.2: PII ก่อน (upsert) แล้วค่อยฐานหลัก (transaction เดียว)
  if (piiRows.length > 0) {
    upsertOrderPii(piiRows)
  }

  return db.transaction((): SubmitOnlineOrdersResult => {
    const batchId = generateId()
    const now = new Date().toISOString()
    const indices = loadShopProductIndices(tenantId, platform, shopKey)
    const linkedRefs = loadActiveAliasRefs(tenantId)

    let ordersInserted = 0
    let ordersUpdated = 0
    let linesUnlinked = 0
    let returnEvents = 0
    const unlinkedNameSet = new Set<string>()

    const findOrder = db.prepare(`
      SELECT id, buyer_name_masked, buyer_phone_masked, address_masked
      FROM online_orders
      WHERE tenant_id = ? AND platform = ? AND shop_key = ? AND order_no = ?
    `)
    const selectOldLines = db.prepare(`
      SELECT product_name, variant_name, qty_returned FROM online_order_lines WHERE order_id = ?
    `)
    const insertOrder = db.prepare(`
      INSERT INTO online_orders (
        id, tenant_id, platform, shop_key, order_no, order_time, order_date, month,
        status_raw, status_group, province, district, postal_code, payment_method,
        shipping_option, tracking_no, buyer_name_masked, buyer_phone_masked, address_masked,
        first_seen_at, updated_at, last_batch_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const updateOrder = db.prepare(`
      UPDATE online_orders SET
        order_time = ?, order_date = ?, month = ?, status_raw = ?, status_group = ?,
        province = COALESCE(?, province), district = COALESCE(?, district),
        postal_code = COALESCE(?, postal_code), payment_method = COALESCE(?, payment_method),
        shipping_option = COALESCE(?, shipping_option), tracking_no = COALESCE(?, tracking_no),
        buyer_name_masked = ?, buyer_phone_masked = ?, address_masked = ?,
        updated_at = ?, last_batch_id = ?
      WHERE id = ?
    `)
    const deleteLines = db.prepare(`DELETE FROM online_order_lines WHERE order_id = ?`)
    const insertLine = db.prepare(`
      INSERT INTO online_order_lines (
        id, tenant_id, order_id, line_no, product_name, variant_name,
        qty, qty_returned, list_price, net_price, source_ref
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertReturnEvent = db.prepare(`
      INSERT INTO online_return_events (
        id, tenant_id, platform, shop_key, order_no, order_month,
        product_name, variant_name, source_ref, qty_delta, status, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `)

    for (const o of prepared) {
      const resolvedLines = o.lines.map((l) => {
        const variantClean = cleanOpt(l.variantName)
        const sourceRef = resolveLineSourceRef(indices, platform, o.month, l.productName, variantClean)
        return { ...l, variantClean, sourceRef }
      })

      const existing = findOrder.get(tenantId, platform, shopKey, o.orderNo) as any
      let orderId: string

      if (existing) {
        ordersUpdated++
        orderId = existing.id

        // ก่อนแทนที่บรรทัด: เทียบ qty_returned เดิมต่อ (product_name, variant_name)
        const oldLines = selectOldLines.all(orderId) as Array<{
          product_name: string
          variant_name: string | null
          qty_returned: number
        }>
        const oldReturnedByKey = new Map<string, number>()
        for (const ol of oldLines) {
          const k = `${normName(ol.product_name)}||${normVariant(ol.variant_name)}`
          oldReturnedByKey.set(k, (oldReturnedByKey.get(k) || 0) + (Number(ol.qty_returned) || 0))
        }

        const newReturnedByKey = new Map<
          string,
          { qtyReturned: number; productName: string; variantName: string | null; sourceRef: string }
        >()
        for (const nl of resolvedLines) {
          const k = `${normName(nl.productName)}||${normVariant(nl.variantClean)}`
          const prev = newReturnedByKey.get(k)
          const qRet = Number(nl.qtyReturned) || 0
          if (prev) {
            prev.qtyReturned += qRet
          } else {
            newReturnedByKey.set(k, {
              qtyReturned: qRet,
              productName: nl.productName,
              variantName: nl.variantClean,
              sourceRef: nl.sourceRef,
            })
          }
        }

        for (const [k, info] of newReturnedByKey) {
          const prevQty = oldReturnedByKey.get(k) || 0
          const delta = roundQty(info.qtyReturned - prevQty)
          if (delta > 0) {
            insertReturnEvent.run(
              generateId(),
              tenantId,
              platform,
              shopKey,
              o.orderNo,
              o.month,
              info.productName,
              info.variantName,
              info.sourceRef,
              delta,
              now,
            )
            returnEvents++
          }
        }

        const nextNameMasked = o.buyerNameProvided ? o.buyerNameMasked : (existing.buyer_name_masked ?? '')
        const nextPhoneMasked = o.buyerPhoneProvided ? o.buyerPhoneMasked : (existing.buyer_phone_masked ?? '')
        const nextAddrMasked = o.fullAddressProvided ? o.addressMasked : (existing.address_masked ?? '')

        updateOrder.run(
          o.orderTime,
          o.orderDate,
          o.month,
          o.statusRaw,
          o.statusGroup,
          o.province,
          o.district,
          o.postalCode,
          o.paymentMethod,
          o.shippingOption,
          o.trackingNo,
          nextNameMasked,
          nextPhoneMasked,
          nextAddrMasked,
          now,
          batchId,
          orderId,
        )
        deleteLines.run(orderId)
      } else {
        ordersInserted++
        orderId = generateId()
        insertOrder.run(
          orderId,
          tenantId,
          platform,
          shopKey,
          o.orderNo,
          o.orderTime,
          o.orderDate,
          o.month,
          o.statusRaw,
          o.statusGroup,
          o.province,
          o.district,
          o.postalCode,
          o.paymentMethod,
          o.shippingOption,
          o.trackingNo,
          o.buyerNameMasked,
          o.buyerPhoneMasked,
          o.addressMasked,
          now,
          now,
          batchId,
        )
      }

      resolvedLines.forEach((line, idx) => {
        insertLine.run(
          generateId(),
          tenantId,
          orderId,
          idx + 1,
          line.productName,
          line.variantClean,
          line.qty,
          line.qtyReturned ?? 0,
          line.listPrice != null ? Number(line.listPrice) : null,
          line.netPrice,
          line.sourceRef,
        )
        if (!linkedRefs.has(line.sourceRef)) {
          linesUnlinked++
          const label = [line.productName, line.variantClean].filter(Boolean).join(' · ')
          unlinkedNameSet.add(label)
        }
      })
    }

    db.prepare(`
      INSERT INTO online_import_batches (
        id, tenant_id, platform, shop_key, rows_received,
        orders_inserted, orders_updated, lines_unlinked, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      batchId,
      tenantId,
      platform,
      shopKey,
      input.rows.length,
      ordersInserted,
      ordersUpdated,
      linesUnlinked,
      userId,
      now,
    )

    return {
      batchId,
      ordersInserted,
      ordersUpdated,
      linesUnlinked,
      returnEvents,
      unlinkedNames: [...unlinkedNameSet],
    }
  })()
}

// ── Relink :N source_ref หลังมีไฟล์ products ใหม่ ──────────────────────────────────────────

export function relinkOnlineLines(tenantId: string, platform: string, shopKey: string): { updated: number } {
  const p = String(platform || '').toUpperCase()
  const sk = normShopKey(shopKey)
  const fallbackPrefix = `${p}:N%`

  const pendingLines = db.prepare(`
    SELECT l.id, l.product_name, l.variant_name, l.source_ref, o.month, o.order_no
    FROM online_order_lines l
    JOIN online_orders o ON o.id = l.order_id
    WHERE o.tenant_id = ? AND o.platform = ? AND o.shop_key = ? AND l.source_ref LIKE ?
  `).all(tenantId, p, sk, fallbackPrefix) as Array<{
    id: string
    product_name: string
    variant_name: string | null
    source_ref: string
    month: string
    order_no: string
  }>

  if (pendingLines.length === 0) return { updated: 0 }

  const indices = loadShopProductIndices(tenantId, p, sk)
  if (!indices.latestIndex) return { updated: 0 }

  return db.transaction(() => {
    const updLine = db.prepare(`UPDATE online_order_lines SET source_ref = ? WHERE id = ?`)
    const updReturnEvent = db.prepare(`
      UPDATE online_return_events SET source_ref = ?
      WHERE tenant_id = ? AND platform = ? AND shop_key = ? AND order_no = ?
        AND source_ref = ? AND status = 'PENDING'
    `)

    let updated = 0
    for (const line of pendingLines) {
      const nextRef = resolveLineSourceRef(indices, p, line.month, line.product_name, line.variant_name)
      if (nextRef !== line.source_ref) {
        updLine.run(nextRef, line.id)
        updReturnEvent.run(nextRef, tenantId, p, sk, line.order_no, line.source_ref)
        updated++
      }
    }
    return { updated }
  })()
}

// ── Summary / Analytics ──────────────────────────────────────────────────────────────────

export interface OnlineSummaryFilter {
  from?: string
  to?: string
  platform?: string
  shopKey?: string
  groupBy: OnlineSummaryGroupBy
  includeStatuses?: OnlineStatusGroup[]
}

export interface OnlineSummaryRow {
  key: string
  label: string
  orders: number
  qty: number
  qtyReturned: number
  sales: number
  returnsValue: number
  netSales: number
}

export function getOnlineSummary(tenantId: string, filter: OnlineSummaryFilter): OnlineSummaryRow[] {
  let keyExpr: string
  let labelExpr: string
  let orderByClause: string

  switch (filter.groupBy) {
    case 'province':
      keyExpr = `COALESCE(NULLIF(TRIM(o.province), ''), '(ไม่ระบุ)')`
      labelExpr = keyExpr
      orderByClause = 'ORDER BY netSales DESC, orders DESC'
      break
    case 'district':
      keyExpr = `COALESCE(NULLIF(TRIM(o.province), ''), '(ไม่ระบุ)') || ' / ' || COALESCE(NULLIF(TRIM(o.district), ''), '(ไม่ระบุ)')`
      labelExpr = keyExpr
      orderByClause = 'ORDER BY netSales DESC, orders DESC'
      break
    case 'product':
      keyExpr = `l.product_name`
      labelExpr = `l.product_name`
      orderByClause = 'ORDER BY netSales DESC, orders DESC'
      break
    case 'variant':
      keyExpr = `l.product_name || '||' || COALESCE(l.variant_name, '')`
      labelExpr = `CASE WHEN l.variant_name IS NOT NULL AND TRIM(l.variant_name) != '' AND TRIM(l.variant_name) != '-' THEN l.product_name || ' · ' || l.variant_name ELSE l.product_name END`
      orderByClause = 'ORDER BY netSales DESC, orders DESC'
      break
    case 'shop':
      keyExpr = `o.platform || ':' || o.shop_key`
      labelExpr = `o.platform || ' · ' || o.shop_key`
      orderByClause = 'ORDER BY netSales DESC, orders DESC'
      break
    case 'day':
      keyExpr = `o.order_date`
      labelExpr = `o.order_date`
      orderByClause = 'ORDER BY grp_key ASC'
      break
    case 'month':
      keyExpr = `o.month`
      labelExpr = `o.month`
      orderByClause = 'ORDER BY grp_key ASC'
      break
    default:
      throw new OnlineOrderError(`groupBy ไม่ถูกต้อง: ${String((filter as any).groupBy)}`)
  }

  const statuses = (filter.includeStatuses && filter.includeStatuses.length > 0
    ? filter.includeStatuses
    : DEFAULT_INCLUDE_STATUSES
  ).filter((s) => VALID_STATUS_GROUPS.has(s))

  if (statuses.length === 0) return []

  const where: string[] = ['o.tenant_id = ?']
  const params: any[] = [tenantId]

  if (filter.from) {
    where.push('o.order_date >= ?')
    params.push(filter.from)
  }
  if (filter.to) {
    where.push('o.order_date <= ?')
    params.push(filter.to)
  }
  if (filter.platform) {
    where.push('o.platform = ?')
    params.push(String(filter.platform).toUpperCase())
  }
  if (filter.shopKey) {
    where.push('o.shop_key = ?')
    params.push(normShopKey(filter.shopKey))
  }
  where.push(`o.status_group IN (${statuses.map(() => '?').join(',')})`)
  params.push(...statuses)

  const rows = db.prepare(`
    SELECT
      ${keyExpr} AS grp_key,
      ${labelExpr} AS grp_label,
      COUNT(DISTINCT o.id) AS orders,
      COALESCE(SUM(l.qty), 0) AS qty,
      COALESCE(SUM(l.qty_returned), 0) AS qtyReturned,
      COALESCE(SUM(l.net_price), 0) AS sales,
      COALESCE(SUM(CASE WHEN l.qty > 0 THEN (l.net_price * l.qty_returned) / l.qty ELSE 0 END), 0) AS returnsValue,
      COALESCE(SUM(l.net_price) - SUM(CASE WHEN l.qty > 0 THEN (l.net_price * l.qty_returned) / l.qty ELSE 0 END), 0) AS netSales
    FROM online_orders o
    JOIN online_order_lines l ON l.order_id = o.id
    WHERE ${where.join(' AND ')}
    GROUP BY grp_key, grp_label
    ${orderByClause}
  `).all(...params) as any[]

  return rows.map((r) => {
    const sales = r2(r.sales)
    const returnsValue = r2(r.returnsValue)
    return {
      key: String(r.grp_key ?? ''),
      label: String(r.grp_label ?? ''),
      orders: Number(r.orders) || 0,
      qty: roundQty(Number(r.qty) || 0),
      qtyReturned: roundQty(Number(r.qtyReturned) || 0),
      sales,
      returnsValue,
      netSales: r2(sales - returnsValue),
    }
  })
}

// ── List orders (ค่ามาสก์เท่านั้น — ห้ามอ่าน pii.db) ─────────────────────────────────────────

export interface OnlineOrdersListFilter {
  from?: string
  to?: string
  platform?: string
  shopKey?: string
  status?: string
  q?: string
  page?: number
  limit?: number
}

export function listOnlineOrders(tenantId: string, filter: OnlineOrdersListFilter = {}) {
  const page = Math.max(1, Number(filter.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(filter.limit) || 50))
  const offset = (page - 1) * limit

  const where: string[] = ['o.tenant_id = ?']
  const params: any[] = [tenantId]

  if (filter.from) {
    where.push('o.order_date >= ?')
    params.push(filter.from)
  }
  if (filter.to) {
    where.push('o.order_date <= ?')
    params.push(filter.to)
  }
  if (filter.platform) {
    where.push('o.platform = ?')
    params.push(String(filter.platform).toUpperCase())
  }
  if (filter.shopKey) {
    where.push('o.shop_key = ?')
    params.push(normShopKey(filter.shopKey))
  }
  if (filter.status) {
    where.push('o.status_group = ?')
    params.push(String(filter.status).toUpperCase())
  }
  if (filter.q && filter.q.trim()) {
    const like = `%${escapeLike(filter.q.trim())}%`
    where.push(`(
      o.order_no LIKE ? ESCAPE '\\'
      OR COALESCE(o.tracking_no, '') LIKE ? ESCAPE '\\'
      OR COALESCE(o.province, '') LIKE ? ESCAPE '\\'
      OR COALESCE(o.district, '') LIKE ? ESCAPE '\\'
      OR COALESCE(o.buyer_name_masked, '') LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM online_order_lines lx
        WHERE lx.order_id = o.id
          AND (lx.product_name LIKE ? ESCAPE '\\' OR COALESCE(lx.variant_name, '') LIKE ? ESCAPE '\\')
      )
    )`)
    params.push(like, like, like, like, like, like, like)
  }

  const whereSql = where.join(' AND ')
  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM online_orders o WHERE ${whereSql}`).get(...params) as any
  const total = Number(totalRow?.c) || 0

  const orders = db.prepare(`
    SELECT
      o.id, o.platform, o.shop_key, o.order_no, o.order_time, o.order_date, o.month,
      o.status_raw, o.status_group, o.province, o.district, o.postal_code,
      o.payment_method, o.shipping_option, o.tracking_no,
      o.buyer_name_masked, o.buyer_phone_masked, o.address_masked,
      o.first_seen_at, o.updated_at
    FROM online_orders o
    WHERE ${whereSql}
    ORDER BY o.order_date DESC, o.order_time DESC, o.order_no DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[]

  if (orders.length === 0) {
    return { items: [], total, page, limit }
  }

  const orderIds = orders.map((o) => o.id)
  const lines = db.prepare(`
    SELECT id, order_id, line_no, product_name, variant_name, qty, qty_returned, list_price, net_price, source_ref
    FROM online_order_lines
    WHERE order_id IN (${orderIds.map(() => '?').join(',')})
    ORDER BY line_no ASC
  `).all(...orderIds) as any[]

  // ผูกสต็อกคำนวณตอนอ่าน (ไม่เก็บในคอลัมน์) แบบ batch query เดียว ไม่มี N+1
  const sourceRefs = [...new Set(lines.map((l) => l.source_ref).filter(Boolean))] as string[]
  const aliasByRef = new Map<string, { stockItemId: string; sku: string; stockItemName: string; factor: number }>()
  if (sourceRefs.length > 0) {
    const aliasRows = db.prepare(`
      SELECT a.source_ref, a.stock_item_id, a.factor, s.sku, s.name AS stock_item_name
      FROM stock_item_aliases a
      JOIN stock_items s ON s.id = a.stock_item_id AND s.tenant_id = a.tenant_id AND s.status != 'INACTIVE'
      WHERE a.tenant_id = ? AND a.source_ref IN (${sourceRefs.map(() => '?').join(',')})
    `).all(tenantId, ...sourceRefs) as any[]
    for (const ar of aliasRows) {
      aliasByRef.set(ar.source_ref, {
        stockItemId: ar.stock_item_id,
        sku: ar.sku,
        stockItemName: ar.stock_item_name,
        factor: Number(ar.factor) > 0 ? Number(ar.factor) : 1,
      })
    }
  }

  const linesByOrderId = new Map<string, any[]>()
  for (const l of lines) {
    const alias = l.source_ref ? aliasByRef.get(l.source_ref) : undefined
    const arr = linesByOrderId.get(l.order_id) || []
    arr.push({
      id: l.id,
      lineNo: l.line_no,
      productName: l.product_name,
      variantName: l.variant_name,
      qty: Number(l.qty) || 0,
      qtyReturned: Number(l.qty_returned) || 0,
      listPrice: l.list_price != null ? Number(l.list_price) : null,
      netPrice: Number(l.net_price) || 0,
      sourceRef: l.source_ref,
      mapped: !!alias,
      stockItemId: alias?.stockItemId ?? null,
      sku: alias?.sku ?? null,
      stockItemName: alias?.stockItemName ?? null,
      factor: alias?.factor ?? null,
    })
    linesByOrderId.set(l.order_id, arr)
  }

  const items = orders.map((o) => {
    const orderLines = linesByOrderId.get(o.id) || []
    const totalQty = roundQty(orderLines.reduce((s, l) => s + l.qty, 0))
    const totalQtyReturned = roundQty(orderLines.reduce((s, l) => s + l.qtyReturned, 0))
    const totalSales = r2(orderLines.reduce((s, l) => s + l.netPrice, 0))
    const returnsValue = r2(orderLines.reduce((s, l) => s + (l.qty > 0 ? (l.netPrice * l.qtyReturned) / l.qty : 0), 0))
    return {
      id: o.id,
      platform: o.platform,
      shopKey: o.shop_key,
      orderNo: o.order_no,
      orderTime: o.order_time,
      orderDate: o.order_date,
      month: o.month,
      statusRaw: o.status_raw,
      statusGroup: o.status_group,
      province: o.province,
      district: o.district,
      postalCode: o.postal_code,
      paymentMethod: o.payment_method,
      shippingOption: o.shipping_option,
      trackingNo: o.tracking_no,
      buyerNameMasked: o.buyer_name_masked,
      buyerPhoneMasked: o.buyer_phone_masked,
      addressMasked: o.address_masked,
      firstSeenAt: o.first_seen_at,
      updatedAt: o.updated_at,
      totalQty,
      totalQtyReturned,
      totalSales,
      returnsValue,
      netSales: r2(totalSales - returnsValue),
      lines: orderLines,
    }
  })

  return { items, total, page, limit }
}

// ── Unlinked lines & SKU Mapping ──────────────────────────────────────────────────────────

export interface UnlinkedLinesFilter {
  from?: string
  to?: string
  platform?: string
  shopKey?: string
}

export interface UnlinkedLineRow {
  sourceRef: string
  productName: string
  variantName: string | null
  qty: number
  proposed?: {
    stockItemId: string
    sku: string
    stockItemName: string
    factor: number
  }
}

export function getUnlinkedLines(tenantId: string, filter: UnlinkedLinesFilter = {}): UnlinkedLineRow[] {
  const where: string[] = [
    'o.tenant_id = ?',
    'l.source_ref IS NOT NULL',
    `NOT EXISTS (
      SELECT 1 FROM stock_item_aliases a
      JOIN stock_items s ON s.id = a.stock_item_id AND s.tenant_id = a.tenant_id AND s.status != 'INACTIVE'
      WHERE a.tenant_id = o.tenant_id AND a.source_ref = l.source_ref
    )`,
  ]
  const params: any[] = [tenantId]

  if (filter.from) {
    where.push('o.order_date >= ?')
    params.push(filter.from)
  }
  if (filter.to) {
    where.push('o.order_date <= ?')
    params.push(filter.to)
  }
  if (filter.platform) {
    where.push('o.platform = ?')
    params.push(String(filter.platform).toUpperCase())
  }
  if (filter.shopKey) {
    where.push('o.shop_key = ?')
    params.push(normShopKey(filter.shopKey))
  }

  const rows = db.prepare(`
    SELECT
      l.source_ref AS sourceRef,
      MIN(l.product_name) AS productName,
      MIN(l.variant_name) AS variantName,
      COALESCE(SUM(l.qty), 0) AS qty
    FROM online_order_lines l
    JOIN online_orders o ON o.id = l.order_id
    WHERE ${where.join(' AND ')}
    GROUP BY l.source_ref
    ORDER BY qty DESC, productName ASC
  `).all(...params) as any[]

  if (rows.length === 0) return []

  const refs = rows.map((r) => r.sourceRef)
  const proposals = db.prepare(`
    SELECT p.source_ref, p.stock_item_id, p.factor, s.sku, s.name AS stock_item_name
    FROM platform_sku_proposals p
    JOIN stock_items s ON s.id = p.stock_item_id AND s.tenant_id = p.tenant_id AND s.status != 'INACTIVE'
    WHERE p.tenant_id = ? AND p.source_ref IN (${refs.map(() => '?').join(',')})
  `).all(tenantId, ...refs) as any[]

  const propMap = new Map<string, UnlinkedLineRow['proposed']>()
  for (const p of proposals) {
    propMap.set(p.source_ref, {
      stockItemId: p.stock_item_id,
      sku: p.sku,
      stockItemName: p.stock_item_name,
      factor: Number(p.factor) > 0 ? Number(p.factor) : 1,
    })
  }

  return rows.map((r) => {
    const proposed = propMap.get(r.sourceRef)
    const out: UnlinkedLineRow = {
      sourceRef: r.sourceRef,
      productName: r.productName,
      variantName: r.variantName ?? null,
      qty: roundQty(Number(r.qty) || 0),
    }
    if (proposed) out.proposed = proposed
    return out
  })
}

export interface OnlineProposePair {
  sourceRef: string
  sku?: string
  stockItemId?: string
  factor?: number
}

/**
 * เสนอคู่จับคู่ SKU จาก MCP (ยังไม่ผูกจริง รอคนยืนยันที่หน้าเว็บ — ใช้ตาราง platform_sku_proposals เดิม)
 */
export function proposeOnlineMapping(
  tenantId: string,
  pairs: OnlineProposePair[],
  userId = 'mcp-agent',
): { accepted: number; rejected: Array<{ pair: OnlineProposePair; reason: string }> } {
  let accepted = 0
  const rejected: Array<{ pair: OnlineProposePair; reason: string }> = []
  const now = new Date().toISOString()

  const upsert = db.prepare(`
    INSERT INTO platform_sku_proposals (id, tenant_id, source_ref, stock_item_id, factor, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, source_ref) DO UPDATE SET
      stock_item_id = excluded.stock_item_id,
      factor = excluded.factor,
      created_by = excluded.created_by,
      created_at = excluded.created_at
  `)

  for (const pair of pairs) {
    try {
      const sourceRef = String(pair.sourceRef || '').trim()
      if (!sourceRef) throw new OnlineOrderError('ต้องระบุ source_ref')

      let stockItemId = pair.stockItemId ? String(pair.stockItemId).trim() : ''
      if (!stockItemId && pair.sku) {
        const found = db.prepare(`SELECT id FROM stock_items WHERE tenant_id = ? AND sku = ? AND status != 'INACTIVE'`).get(tenantId, pair.sku) as any
        if (!found) throw new OnlineOrderError(`ไม่พบ SKU "${pair.sku}" ในคลัง`)
        stockItemId = found.id
      }
      if (!stockItemId) throw new OnlineOrderError('ต้องระบุ sku หรือ stock_item_id')
      if (!db.prepare(`SELECT 1 FROM stock_items WHERE id = ? AND tenant_id = ? AND status != 'INACTIVE'`).get(stockItemId, tenantId)) {
        throw new OnlineOrderError('ไม่พบสินค้าในคลังของเทแนนต์นี้')
      }

      const factor = pair.factor == null ? 1 : Number(pair.factor)
      if (!Number.isFinite(factor) || factor <= 0) {
        throw new OnlineOrderError('ตัวคูณ (factor) ต้องมากกว่า 0')
      }

      upsert.run(generateId(), tenantId, sourceRef, stockItemId, factor, userId, now)
      accepted++
    } catch (err: any) {
      rejected.push({ pair, reason: err?.message || String(err) })
    }
  }

  return { accepted, rejected }
}

/**
 * ยืนยันการผูก sourceRef (รวม :N refs) เข้า stock_item_aliases โดยไม่ต้องมี monthId
 * name = product · variant ของบรรทัด
 */
export function confirmOnlineMapping(
  tenantId: string,
  input: { sourceRef: string; stockItemId: string; factor?: number },
  userId: string,
): void {
  const sourceRef = String(input.sourceRef || '').trim()
  if (!sourceRef) throw new OnlineOrderError('ต้องระบุ sourceRef')

  const line = db.prepare(`
    SELECT product_name, variant_name FROM online_order_lines
    WHERE tenant_id = ? AND source_ref = ?
    LIMIT 1
  `).get(tenantId, sourceRef) as { product_name: string; variant_name: string | null } | undefined

  const name = line
    ? [line.product_name, line.variant_name].filter(Boolean).join(' · ')
    : sourceRef

  const item = db.prepare(`
    SELECT COALESCE(NULLIF(base_unit, ''), unit) AS base
    FROM stock_items WHERE id = ? AND tenant_id = ? AND status != 'INACTIVE'
  `).get(input.stockItemId, tenantId) as { base: string } | undefined
  if (!item) throw new StockItemRefError('ไม่พบสินค้าในคลัง')

  const factor = input.factor == null ? 1 : Number(input.factor)
  upsertPlatformAlias(
    tenantId,
    { sourceRef, name, stockItemId: input.stockItemId, unit: item.base || 'pcs', factor },
    userId,
  )
  db.prepare(`DELETE FROM platform_sku_proposals WHERE tenant_id = ? AND source_ref = ?`).run(tenantId, sourceRef)
}

/**
 * ยืนยันข้อเสนอจับคู่ SKU ที่เสนอไว้ทั้งหมดสำหรับบรรทัดออนไลน์ที่ยังไม่ผูก (ทำใน transaction เดียว)
 */
export function acceptAllOnlineProposals(tenantId: string, userId: string): { accepted: number } {
  return db.transaction(() => {
    const unlinked = getUnlinkedLines(tenantId)
    let accepted = 0
    for (const row of unlinked) {
      if (row.proposed) {
        confirmOnlineMapping(
          tenantId,
          { sourceRef: row.sourceRef, stockItemId: row.proposed.stockItemId, factor: row.proposed.factor },
          userId,
        )
        accepted++
      }
    }
    return { accepted }
  })()
}

// ── Unattributed returns (คืนที่ไม่ระบุออเดอร์ — คำนวณสด ไม่เก็บ) ─────────────────────────────

export interface UnattributedReturnRow {
  productName: string
  variantName: string | null
  monthlyQtyReturned: number
  onlineQtyReturned: number
  unattributedQty: number
}

export function getUnattributedReturns(
  tenantId: string,
  platform: string,
  shopKey: string,
  month: string,
): UnattributedReturnRow[] {
  const p = String(platform || '').toUpperCase()
  const sk = normShopKey(shopKey)

  const pm = db.prepare(`
    SELECT orders_json FROM platform_months
    WHERE tenant_id = ? AND platform = ? AND shop_key = ? AND month = ?
  `).get(tenantId, p, sk, month) as { orders_json: string | null } | undefined

  if (!pm?.orders_json) return []

  let payload: OrdersPayload
  try {
    payload = JSON.parse(pm.orders_json)
  } catch {
    return []
  }

  const monthlyByKey = new Map<string, { productName: string; variantName: string | null; qtyReturned: number }>()
  for (const r of payload.rows || []) {
    const vn = normVariant(r.variant_name)
    const key = `${normName(r.product_name)}||${vn}`
    const q = Number(r.qty_returned) || 0
    const prev = monthlyByKey.get(key)
    if (prev) {
      prev.qtyReturned += q
    } else {
      monthlyByKey.set(key, {
        productName: r.product_name,
        variantName: vn ? cleanOpt(r.variant_name) : null,
        qtyReturned: q,
      })
    }
  }

  const onlineLines = db.prepare(`
    SELECT l.product_name, l.variant_name, l.qty_returned
    FROM online_order_lines l
    JOIN online_orders o ON o.id = l.order_id
    WHERE o.tenant_id = ? AND o.platform = ? AND o.shop_key = ? AND o.month = ?
      AND o.status_group != 'CANCELLED'
  `).all(tenantId, p, sk, month) as Array<{
    product_name: string
    variant_name: string | null
    qty_returned: number
  }>

  const onlineByKey = new Map<string, number>()
  for (const ol of onlineLines) {
    const key = `${normName(ol.product_name)}||${normVariant(ol.variant_name)}`
    onlineByKey.set(key, (onlineByKey.get(key) || 0) + (Number(ol.qty_returned) || 0))
  }

  const result: UnattributedReturnRow[] = []
  for (const [key, m] of monthlyByKey) {
    const onlineQty = roundQty(onlineByKey.get(key) || 0)
    const monthlyQty = roundQty(m.qtyReturned)
    const diff = roundQty(monthlyQty - onlineQty)
    if (diff > 0) {
      result.push({
        productName: m.productName,
        variantName: m.variantName,
        monthlyQtyReturned: monthlyQty,
        onlineQtyReturned: onlineQty,
        unattributedQty: diff,
      })
    }
  }

  return result.sort((a, b) => b.unattributedQty - a.unattributedQty)
}

// ── ข้อ 6: รับคืนข้ามเดือน (Return Events & Restock) ─────────────────────────────────────────

export interface ReturnEventRow {
  id: string
  platform: string
  shopKey: string
  orderNo: string
  orderMonth: string
  productName: string
  variantName: string | null
  sourceRef: string | null
  qtyDelta: number
  status: string
  detectedAt: string
  resolvedAt: string | null
  resolvedBy: string | null
  stockMovementId: string | null
  monthConfirmed: boolean
  mapped: boolean
  stockItemId: string | null
  stockItemName: string | null
  factor: number | null
}

export function listReturnEvents(tenantId: string, status?: string): ReturnEventRow[] {
  const where = ['tenant_id = ?']
  const params: any[] = [tenantId]
  if (status) {
    where.push('status = ?')
    params.push(String(status).toUpperCase())
  }

  const events = db.prepare(`
    SELECT * FROM online_return_events
    WHERE ${where.join(' AND ')}
    ORDER BY detected_at DESC
  `).all(...params) as any[]

  if (events.length === 0) return []

  // Batch check sale_confirmed_at ของ platform_months
  const pmRows = db.prepare(`
    SELECT platform, shop_key, month, sale_confirmed_at
    FROM platform_months
    WHERE tenant_id = ?
  `).all(tenantId) as Array<{ platform: string; shop_key: string; month: string; sale_confirmed_at: string | null }>
  const confirmedMonths = new Set(
    pmRows
      .filter((r) => r.sale_confirmed_at != null && r.sale_confirmed_at !== '')
      .map((r) => `${r.platform}||${r.shop_key}||${r.month}`),
  )

  // Batch load aliases สำหรับ source_ref ที่ปรากฏใน events
  const refs = [...new Set(events.map((e) => e.source_ref).filter(Boolean))] as string[]
  const aliasMap = new Map<string, { stockItemId: string; stockItemName: string; factor: number }>()
  if (refs.length > 0) {
    const aliasRows = db.prepare(`
      SELECT a.source_ref, a.stock_item_id, a.factor, s.name AS stock_item_name
      FROM stock_item_aliases a
      JOIN stock_items s ON s.id = a.stock_item_id AND s.tenant_id = a.tenant_id AND s.status != 'INACTIVE'
      WHERE a.tenant_id = ? AND a.source_ref IN (${refs.map(() => '?').join(',')})
    `).all(tenantId, ...refs) as any[]
    for (const ar of aliasRows) {
      aliasMap.set(ar.source_ref, {
        stockItemId: ar.stock_item_id,
        stockItemName: ar.stock_item_name,
        factor: Number(ar.factor) > 0 ? Number(ar.factor) : 1,
      })
    }
  }

  return events.map((e) => {
    const alias = e.source_ref ? aliasMap.get(e.source_ref) : undefined
    return {
      id: e.id,
      platform: e.platform,
      shopKey: e.shop_key,
      orderNo: e.order_no,
      orderMonth: e.order_month,
      productName: e.product_name,
      variantName: e.variant_name ?? null,
      sourceRef: e.source_ref ?? null,
      qtyDelta: Number(e.qty_delta) || 0,
      status: e.status,
      detectedAt: e.detected_at,
      resolvedAt: e.resolved_at ?? null,
      resolvedBy: e.resolved_by ?? null,
      stockMovementId: e.stock_movement_id ?? null,
      monthConfirmed: confirmedMonths.has(`${e.platform}||${e.shop_key}||${e.order_month}`),
      mapped: !!alias,
      stockItemId: alias?.stockItemId ?? null,
      stockItemName: alias?.stockItemName ?? null,
      factor: alias?.factor ?? null,
    }
  })
}

export interface RestockResult {
  restocked: Array<{
    id: string
    orderNo: string
    stockItemId: string
    stockItemName: string
    qtyIn: number
    unitCost: number
    costAmount: number
    stockMovementId: string
  }>
  skipped: Array<{ id: string; orderNo: string; reason: string }>
  errors: Array<{ id: string; orderNo?: string; reason: string }>
}

/**
 * รับคืนข้ามเดือนเข้าสต็อก (เฉพาะ event ที่ PENDING + รอบเดือน order_month ยืนยันการขายแล้ว + ผูก alias แล้ว)
 * - รอบเดือนยังไม่ยืนยัน → เปลี่ยนเป็น SKIPPED พร้อมเหตุผล "จะหักในรอบเดือนนั้นเอง" (ไม่สร้าง stock_movements)
 * - รอบเดือนยืนยันแล้ว + ผูก alias แล้ว → สร้าง stock_movements IN ด้วย qty_delta × factor, reference 'ONLINE_RETURN:<id>'
 *   ต้นทุนตาม stock_items.unit_cost แบบเดียวกับ confirmSale → เปลี่ยนเป็น RESTOCKED
 * - ทำใน transaction เดียว และห้ามลงบัญชี (ยอดเงินคืนอยู่ใน income ของ Shopee เดือนถัดไปแล้ว)
 */
export function restockReturnEvents(tenantId: string, ids: string[], userId: string): RestockResult {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { restocked: [], skipped: [], errors: [] }
  }

  return db.transaction((): RestockResult => {
    const now = new Date().toISOString()
    const restocked: RestockResult['restocked'] = []
    const skipped: RestockResult['skipped'] = []
    const errors: RestockResult['errors'] = []

    const getEvent = db.prepare(`SELECT * FROM online_return_events WHERE id = ? AND tenant_id = ?`)
    const getMonth = db.prepare(`
      SELECT id, sale_confirmed_at FROM platform_months
      WHERE tenant_id = ? AND platform = ? AND shop_key = ? AND month = ?
    `)
    const getStockItem = db.prepare(`
      SELECT id, name, category, quantity, unit, base_unit, unit_cost
      FROM stock_items WHERE id = ? AND tenant_id = ? AND status != 'INACTIVE'
    `)
    const markSkipped = db.prepare(`
      UPDATE online_return_events SET status = 'SKIPPED', resolved_at = ?, resolved_by = ?
      WHERE id = ? AND tenant_id = ? AND status = 'PENDING'
    `)
    const markRestocked = db.prepare(`
      UPDATE online_return_events SET status = 'RESTOCKED', resolved_at = ?, resolved_by = ?, stock_movement_id = ?
      WHERE id = ? AND tenant_id = ? AND status = 'PENDING'
    `)
    const addStock = db.prepare(`
      UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ? AND tenant_id = ?
    `)
    const insertMovement = db.prepare(`
      INSERT INTO stock_movements (
        id, tenant_id, stock_item_id, type, quantity, movement_unit,
        movement_quantity, reference, notes, created_at, created_by
      ) VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const id of ids) {
      const ev = getEvent.get(id, tenantId) as any
      if (!ev) {
        errors.push({ id, reason: 'ไม่พบรายการคืนนี้' })
        continue
      }
      if (ev.status !== 'PENDING') {
        skipped.push({ id: ev.id, orderNo: ev.order_no, reason: `รายการนี้อยู่ในสถานะ ${ev.status} แล้ว` })
        continue
      }

      // ตรวจว่ารอบเดือนของออเดอร์นี้ยืนยันการขายแล้วหรือยัง
      const pm = getMonth.get(tenantId, ev.platform, ev.shop_key, ev.order_month) as any
      if (!pm || !pm.sale_confirmed_at) {
        markSkipped.run(now, userId, ev.id, tenantId)
        skipped.push({ id: ev.id, orderNo: ev.order_no, reason: 'จะหักในรอบเดือนนั้นเอง' })
        continue
      }

      if (!ev.source_ref) {
        errors.push({ id: ev.id, orderNo: ev.order_no, reason: 'ยังไม่มี source_ref' })
        continue
      }
      const alias = findPlatformAlias(tenantId, ev.source_ref)
      if (!alias) {
        errors.push({ id: ev.id, orderNo: ev.order_no, reason: 'ยังไม่ผูกสินค้าในคลัง (alias)' })
        continue
      }

      const item = getStockItem.get(alias.stockItemId, tenantId) as any
      if (!item) {
        errors.push({ id: ev.id, orderNo: ev.order_no, reason: 'ไม่พบสินค้าในคลัง' })
        continue
      }

      if (isServiceItem(item)) {
        markSkipped.run(now, userId, ev.id, tenantId)
        skipped.push({ id: ev.id, orderNo: ev.order_no, reason: 'รายการบริการไม่มีสต็อกให้รับคืน' })
        continue
      }

      const qtyIn = roundQty((Number(ev.qty_delta) || 0) * (alias.factor || 1))
      if (!(qtyIn > 0)) {
        errors.push({ id: ev.id, orderNo: ev.order_no, reason: 'จำนวนที่รับคืนต้องมากกว่า 0' })
        continue
      }

      const unitCost = Number(item.unit_cost) || 0
      const costAmount = r2(qtyIn * unitCost)
      const movementId = generateId()
      const reference = `ONLINE_RETURN:${ev.id}`
      const baseUnit = item.base_unit || item.unit

      const upd = markRestocked.run(now, userId, movementId, ev.id, tenantId)
      if (upd.changes !== 1) {
        skipped.push({ id: ev.id, orderNo: ev.order_no, reason: 'รายการนี้ถูกดำเนินการไปแล้ว' })
        continue
      }

      addStock.run(qtyIn, now, item.id, tenantId)
      insertMovement.run(
        movementId,
        tenantId,
        item.id,
        qtyIn,
        baseUnit,
        qtyIn,
        reference,
        `รับคืนข้ามเดือน ${ev.platform} ออเดอร์ ${ev.order_no} (รอบ ${ev.order_month}) ต้นทุน ${unitCost}/หน่วย รวม ${costAmount}`,
        now,
        userId,
      )

      restocked.push({
        id: ev.id,
        orderNo: ev.order_no,
        stockItemId: item.id,
        stockItemName: item.name,
        qtyIn,
        unitCost,
        costAmount,
        stockMovementId: movementId,
      })
    }

    return { restocked, skipped, errors }
  })()
}
