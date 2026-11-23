import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, startOfMonth } from 'date-fns'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

// ==================== Types (Contract Sections 3, 5, 6, 7) ====================

export type OnlineGroupBy = 'province' | 'district' | 'product' | 'variant' | 'shop' | 'day' | 'month'
export type OnlineStatusGroup = 'ACTIVE' | 'COMPLETED' | 'RETURNED' | 'CANCELLED' | 'UNPAID'

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

export interface OnlineOrderLineItem {
  productName: string
  variantName: string | null
  qty: number
  qtyReturned: number
  netPrice: number
}

export interface OnlineOrderRow {
  id: string
  platform: string
  shopKey: string
  orderNo: string
  orderDate: string
  orderTime: string | null
  statusRaw: string | null
  statusGroup: OnlineStatusGroup | string
  province: string | null
  district: string | null
  postalCode: string | null
  buyerNameMasked: string | null
  buyerPhoneMasked: string | null
  addressMasked: string | null
  trackingNo: string | null
  paymentMethod: string | null
  shippingOption: string | null
  qty: number
  qtyReturned: number
  netTotal: number
  lines: OnlineOrderLineItem[]
}

export interface UnlinkedLineRow {
  sourceRef: string
  productName: string
  variantName: string | null
  qty: number
  proposedStockItemId: string | null
  proposedSku: string | null
  proposedStockItemName: string | null
  proposedFactor: number | null
}

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
  status: 'PENDING' | 'RESTOCKED' | 'SKIPPED' | string
  detectedAt: string
}

export interface UnattributedReturnRow {
  productName: string
  variantName: string | null
  qtyDelta: number
  monthlyQtyReturned?: number
  orderQtyReturned?: number
}

interface StockItemOption {
  id: string
  sku: string
  name: string
  unit: string
  quantity: number
}

// ==================== Constants ====================

const GROUP_BY_OPTIONS: Array<{ value: OnlineGroupBy; label: string }> = [
  { value: 'province', label: 'จังหวัด' },
  { value: 'district', label: 'อำเภอ' },
  { value: 'product', label: 'สินค้า' },
  { value: 'variant', label: 'ลาย / ตัวเลือก' },
  { value: 'shop', label: 'ร้าน' },
  { value: 'day', label: 'วัน' },
  { value: 'month', label: 'เดือน' },
]

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'ทุกสถานะ' },
  { value: 'ACTIVE', label: 'กำลังดำเนินการ' },
  { value: 'COMPLETED', label: 'สำเร็จ' },
  { value: 'RETURNED', label: 'คืนสินค้า' },
  { value: 'CANCELLED', label: 'ยกเลิก' },
  { value: 'UNPAID', label: 'รอชำระ' },
]

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'กำลังดำเนินการ', cls: 'bg-[var(--primary-soft)] text-[var(--primary)]' },
  COMPLETED: { label: 'สำเร็จ', cls: 'bg-[var(--success-soft)] text-[color:var(--success,#22c55e)]' },
  RETURNED: { label: 'คืนสินค้า', cls: 'bg-[var(--warning)]/15 text-[color:var(--warning,#f59e0b)]' },
  CANCELLED: { label: 'ยกเลิก', cls: 'bg-[var(--danger-soft)] text-[color:var(--danger)]' },
  UNPAID: { label: 'รอชำระ', cls: 'bg-[var(--surface-2)] text-[var(--fg-3)]' },
}

const fmtMoney = (n: number | null | undefined) =>
  `฿${(Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtNum = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })

// ==================== Pure Normalizers ====================

export function normalizeOrderRow(raw: any): OnlineOrderRow {
  const lines: OnlineOrderLineItem[] = Array.isArray(raw.lines)
    ? raw.lines.map((l: any) => ({
        productName: String(l.productName ?? l.product_name ?? ''),
        variantName: l.variantName ?? l.variant_name ?? null,
        qty: Number(l.qty) || 0,
        qtyReturned: Number(l.qtyReturned ?? l.qty_returned) || 0,
        netPrice: Number(l.netPrice ?? l.net_price) || 0,
      }))
    : []
  const lineQty = lines.reduce((s, l) => s + l.qty, 0)
  const lineReturned = lines.reduce((s, l) => s + l.qtyReturned, 0)
  const lineNet = lines.reduce(
    (s, l) => s + (l.qty > 0 ? l.netPrice * (l.qty - l.qtyReturned) / l.qty : l.netPrice),
    0,
  )
  return {
    id: String(raw.id ?? raw.orderNo ?? raw.order_no ?? ''),
    platform: String(raw.platform ?? ''),
    shopKey: String(raw.shopKey ?? raw.shop_key ?? ''),
    orderNo: String(raw.orderNo ?? raw.order_no ?? ''),
    orderDate: String(raw.orderDate ?? raw.order_date ?? ''),
    orderTime: raw.orderTime ?? raw.order_time ?? null,
    statusRaw: raw.statusRaw ?? raw.status_raw ?? null,
    statusGroup: String(raw.statusGroup ?? raw.status_group ?? 'ACTIVE'),
    province: raw.province ?? null,
    district: raw.district ?? null,
    postalCode: raw.postalCode ?? raw.postal_code ?? null,
    // Masked PII fields only — never read raw buyer_name / buyer_phone / full_address
    buyerNameMasked: raw.buyerNameMasked ?? raw.buyer_name_masked ?? null,
    buyerPhoneMasked: raw.buyerPhoneMasked ?? raw.buyer_phone_masked ?? null,
    addressMasked: raw.addressMasked ?? raw.address_masked ?? null,
    trackingNo: raw.trackingNo ?? raw.tracking_no ?? null,
    paymentMethod: raw.paymentMethod ?? raw.payment_method ?? null,
    shippingOption: raw.shippingOption ?? raw.shipping_option ?? null,
    qty: Number(raw.qty ?? raw.totalQty ?? raw.total_qty ?? lineQty) || 0,
    qtyReturned: Number(raw.qtyReturned ?? raw.qty_returned ?? lineReturned) || 0,
    netTotal: Number(raw.netTotal ?? raw.net_total ?? raw.netSales ?? raw.net_sales ?? lineNet) || 0,
    lines,
  }
}

export function normalizeUnlinkedRow(raw: any): UnlinkedLineRow {
  const prop = raw.proposed && typeof raw.proposed === 'object' ? raw.proposed : null
  return {
    sourceRef: String(raw.sourceRef ?? raw.source_ref ?? ''),
    productName: String(raw.productName ?? raw.product_name ?? ''),
    variantName: raw.variantName ?? raw.variant_name ?? null,
    qty: Number(raw.qty) || 0,
    proposedStockItemId: prop?.stockItemId ?? prop?.stock_item_id ?? raw.proposedStockItemId ?? raw.proposed_stock_item_id ?? null,
    proposedSku: prop?.sku ?? raw.proposedSku ?? raw.proposed_sku ?? null,
    proposedStockItemName: prop?.stockItemName ?? prop?.stock_item_name ?? prop?.name ?? raw.proposedStockItemName ?? raw.proposed_stock_item_name ?? null,
    proposedFactor: prop?.factor != null ? Number(prop.factor) : raw.proposedFactor != null ? Number(raw.proposedFactor) : null,
  }
}

export function normalizeReturnEvent(raw: any): ReturnEventRow {
  return {
    id: String(raw.id ?? ''),
    platform: String(raw.platform ?? ''),
    shopKey: String(raw.shopKey ?? raw.shop_key ?? ''),
    orderNo: String(raw.orderNo ?? raw.order_no ?? ''),
    orderMonth: String(raw.orderMonth ?? raw.order_month ?? ''),
    productName: String(raw.productName ?? raw.product_name ?? ''),
    variantName: raw.variantName ?? raw.variant_name ?? null,
    sourceRef: raw.sourceRef ?? raw.source_ref ?? null,
    qtyDelta: Number(raw.qtyDelta ?? raw.qty_delta) || 0,
    status: String(raw.status ?? 'PENDING'),
    detectedAt: String(raw.detectedAt ?? raw.detected_at ?? ''),
  }
}

export function normalizeUnattributedReturn(raw: any): UnattributedReturnRow {
  return {
    productName: String(raw.productName ?? raw.product_name ?? ''),
    variantName: raw.variantName ?? raw.variant_name ?? null,
    qtyDelta: Number(raw.qtyDelta ?? raw.qty_delta ?? raw.unattributedQty ?? raw.unattributed_qty) || 0,
    monthlyQtyReturned: raw.monthlyQtyReturned != null ? Number(raw.monthlyQtyReturned) : raw.monthly_qty_returned != null ? Number(raw.monthly_qty_returned) : undefined,
    orderQtyReturned: raw.orderQtyReturned != null ? Number(raw.orderQtyReturned) : raw.order_qty_returned != null ? Number(raw.order_qty_returned) : undefined,
  }
}

export function summarizeRows(rows: OnlineSummaryRow[]) {
  return rows.reduce(
    (acc, r) => ({
      orders: acc.orders + (Number(r.orders) || 0),
      qty: acc.qty + (Number(r.qty) || 0),
      qtyReturned: acc.qtyReturned + (Number(r.qtyReturned) || 0),
      sales: acc.sales + (Number(r.sales) || 0),
      returnsValue: acc.returnsValue + (Number(r.returnsValue) || 0),
      netSales: acc.netSales + (Number(r.netSales) || 0),
    }),
    { orders: 0, qty: 0, qtyReturned: 0, sales: 0, returnsValue: 0, netSales: 0 },
  )
}

// ==================== Main Component ====================

export default function OnlineOrders({ platform }: { platform: string }) {
  const [from, setFrom] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [to, setTo] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [groupBy, setGroupBy] = useState<OnlineGroupBy>('province')
  const [shopKey, setShopKey] = useState('')
  const [shops, setShops] = useState<string[]>([])

  // Summary
  const [summaryRows, setSummaryRows] = useState<OnlineSummaryRow[]>([])
  const [loadingSummary, setLoadingSummary] = useState(false)

  // Order list
  const [statusFilter, setStatusFilter] = useState('')
  const [queryText, setQueryText] = useState('')
  const [page, setPage] = useState(1)
  const [orders, setOrders] = useState<OnlineOrderRow[]>([])
  const [ordersTotal, setOrdersTotal] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [loadingOrders, setLoadingOrders] = useState(false)

  // Unlinked lines
  const [unlinked, setUnlinked] = useState<UnlinkedLineRow[]>([])
  const [stockItems, setStockItems] = useState<StockItemOption[]>([])
  const [loadingUnlinked, setLoadingUnlinked] = useState(false)
  const [busyMapping, setBusyMapping] = useState(false)

  // Cross-month return events
  const [returnEvents, setReturnEvents] = useState<ReturnEventRow[]>([])
  const [selectedReturnIds, setSelectedReturnIds] = useState<string[]>([])
  const [loadingReturns, setLoadingReturns] = useState(false)
  const [busyRestock, setBusyRestock] = useState(false)

  // Unattributed returns
  const [unattributed, setUnattributed] = useState<UnattributedReturnRow[]>([])
  const [loadingUnattributed, setLoadingUnattributed] = useState(false)

  const targetMonth = to.slice(0, 7)
  const effectiveShopKey = shopKey || shops[0] || ''

  // Load known shop keys from /months + sellable stock items once per platform
  useEffect(() => {
    let active = true
    const loadBootstrap = async () => {
      try {
        const [monthsRes, stockRes] = await Promise.allSettled([
          api.get('/platform-settlement/months', { params: { platform } }),
          api.get('/stock', { params: { sellable: '1' } }),
        ])
        if (!active) return
        if (monthsRes.status === 'fulfilled' && monthsRes.value.data?.success && Array.isArray(monthsRes.value.data.data)) {
          const uniq = Array.from(
            new Set(
              (monthsRes.value.data.data as Array<{ shop_key?: string; platform?: string }>)
                .filter((m) => !m.platform || m.platform === platform)
                .map((m) => m.shop_key)
                .filter((s): s is string => Boolean(s)),
            ),
          )
          setShops(uniq)
        }
        if (stockRes.status === 'fulfilled' && stockRes.value.data?.success && Array.isArray(stockRes.value.data.data)) {
          setStockItems(
            stockRes.value.data.data.map((s: any) => ({
              id: s.id,
              sku: s.sku,
              name: s.name,
              unit: s.base_unit || s.unit || '',
              quantity: Number(s.quantity) || 0,
            })),
          )
        }
      } catch {
        // Non-blocking
      }
    }
    loadBootstrap()
    return () => { active = false }
  }, [platform])

  const loadSummary = useCallback(async () => {
    try {
      setLoadingSummary(true)
      const params: Record<string, string> = { from, to, groupBy, platform }
      if (shopKey) params.shopKey = shopKey
      const res = await api.get('/platform-settlement/online-orders/summary', { params })
      if (res.data?.success) {
        const payload = res.data.data
        const list = Array.isArray(payload) ? payload : Array.isArray(payload?.rows) ? payload.rows : []
        setSummaryRows(list)
      }
    } catch {
      toast.error('โหลดสรุปออเดอร์ออนไลน์ไม่สำเร็จ')
    } finally {
      setLoadingSummary(false)
    }
  }, [from, to, groupBy, platform, shopKey])

  const loadOrders = useCallback(async () => {
    try {
      setLoadingOrders(true)
      const params: Record<string, string | number> = { from, to, page, platform }
      if (statusFilter) params.status = statusFilter
      if (queryText.trim()) params.q = queryText.trim()
      if (shopKey) params.shopKey = shopKey
      const res = await api.get('/platform-settlement/online-orders/list', { params })
      if (res.data?.success) {
        const payload = res.data.data
        if (Array.isArray(payload)) {
          setOrders(payload.map(normalizeOrderRow))
          setOrdersTotal(payload.length)
        } else if (payload && Array.isArray(payload.rows)) {
          setOrders(payload.rows.map(normalizeOrderRow))
          setOrdersTotal(Number(payload.total) || payload.rows.length)
          if (payload.pageSize) setPageSize(Number(payload.pageSize))
        } else {
          setOrders([])
          setOrdersTotal(0)
        }
      }
    } catch {
      toast.error('โหลดรายการออเดอร์ออนไลน์ไม่สำเร็จ')
    } finally {
      setLoadingOrders(false)
    }
  }, [from, to, statusFilter, queryText, page, platform, shopKey])

  const loadUnlinked = useCallback(async () => {
    try {
      setLoadingUnlinked(true)
      const res = await api.get('/platform-settlement/online-orders/unlinked', { params: { platform } })
      if (res.data?.success) {
        const list = Array.isArray(res.data.data) ? res.data.data : []
        setUnlinked(list.map(normalizeUnlinkedRow))
      }
    } catch {
      toast.error('โหลดรายการสินค้าที่ยังไม่ผูกไม่สำเร็จ')
    } finally {
      setLoadingUnlinked(false)
    }
  }, [platform])

  const loadReturns = useCallback(async () => {
    try {
      setLoadingReturns(true)
      const res = await api.get('/platform-settlement/online-orders/returns', { params: { status: 'PENDING' } })
      if (res.data?.success) {
        const list: unknown[] = Array.isArray(res.data.data) ? res.data.data : []
        const normalized: ReturnEventRow[] = list.map(normalizeReturnEvent).filter((r: ReturnEventRow) => !r.platform || r.platform === platform)
        setReturnEvents(normalized)
        setSelectedReturnIds((prev) => prev.filter((id) => normalized.some((r: ReturnEventRow) => r.id === id)))
      }
    } catch {
      toast.error('โหลดรายการรับคืนข้ามเดือนไม่สำเร็จ')
    } finally {
      setLoadingReturns(false)
    }
  }, [platform])

  const loadUnattributed = useCallback(async () => {
    if (!effectiveShopKey || !targetMonth) {
      setUnattributed([])
      return
    }
    try {
      setLoadingUnattributed(true)
      const res = await api.get('/platform-settlement/online-orders/unattributed-returns', {
        params: { platform, shopKey: effectiveShopKey, month: targetMonth },
      })
      if (res.data?.success) {
        const list = Array.isArray(res.data.data) ? res.data.data : []
        setUnattributed(list.map(normalizeUnattributedReturn))
      }
    } catch {
      // Unattributed returns are optional when monthly orders file hasn't been submitted
      setUnattributed([])
    } finally {
      setLoadingUnattributed(false)
    }
  }, [platform, effectiveShopKey, targetMonth])

  useEffect(() => { loadSummary() }, [loadSummary])
  useEffect(() => { loadOrders() }, [loadOrders])
  useEffect(() => { loadUnlinked() }, [loadUnlinked])
  useEffect(() => { loadReturns() }, [loadReturns])
  useEffect(() => { loadUnattributed() }, [loadUnattributed])

  const totals = useMemo(() => summarizeRows(summaryRows), [summaryRows])
  const isOrderCountAdditive = groupBy !== 'product' && groupBy !== 'variant'
  const totalPages = Math.max(1, Math.ceil(ordersTotal / Math.max(pageSize, 1)))
  const hasAnyProposal = unlinked.some((r) => Boolean(r.proposedStockItemId))

  const handleConfirmMapping = async (row: UnlinkedLineRow, stockItemId: string, factor: number) => {
    if (!stockItemId) return
    try {
      setBusyMapping(true)
      const res = await api.post('/platform-settlement/online-orders/mapping/confirm', {
        sourceRef: row.sourceRef,
        stockItemId,
        factor,
      })
      if (res.data?.success) {
        toast.success(`ผูก "${row.productName}${row.variantName ? ` · ${row.variantName}` : ''}" แล้ว`)
        await Promise.all([loadUnlinked(), loadReturns()])
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ผูกสินค้าไม่สำเร็จ')
    } finally {
      setBusyMapping(false)
    }
  }

  const handleAcceptAll = async () => {
    try {
      setBusyMapping(true)
      const res = await api.post('/platform-settlement/online-orders/mapping/accept-all')
      if (res.data?.success) {
        const accepted = res.data.data?.accepted
        toast.success(accepted != null ? `ยืนยันข้อเสนอแล้ว ${accepted} รายการ` : 'ยืนยันข้อเสนอทั้งหมดแล้ว')
        await Promise.all([loadUnlinked(), loadReturns()])
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ยืนยันข้อเสนอทั้งหมดไม่สำเร็จ')
    } finally {
      setBusyMapping(false)
    }
  }

  const toggleReturnSelection = (id: string) => {
    setSelectedReturnIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const toggleSelectAllReturns = () => {
    if (selectedReturnIds.length === returnEvents.length) {
      setSelectedReturnIds([])
    } else {
      setSelectedReturnIds(returnEvents.map((r) => r.id))
    }
  }

  const handleRestock = async () => {
    if (selectedReturnIds.length === 0) return
    try {
      setBusyRestock(true)
      const res = await api.post('/platform-settlement/online-orders/returns/restock', {
        ids: selectedReturnIds,
      })
      if (res.data?.success) {
        toast.success(res.data.message || `รับคืนเข้าสต็อกแล้ว ${selectedReturnIds.length} รายการ`)
        setSelectedReturnIds([])
        await loadReturns()
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'รับคืนเข้าสต็อกไม่สำเร็จ')
    } finally {
      setBusyRestock(false)
    }
  }

  const handleRefreshAll = () => {
    loadSummary()
    loadOrders()
    loadUnlinked()
    loadReturns()
    loadUnattributed()
  }

  return (
    <div className="space-y-5">
      {/* Filter bar */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="online-from" className="text-xs text-[var(--fg-3)]">ตั้งแต่วันที่</label>
            <input
              id="online-from"
              type="date"
              value={from}
              onChange={(e) => { setFrom(e.target.value); setPage(1) }}
              className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="online-to" className="text-xs text-[var(--fg-3)]">ถึงวันที่</label>
            <input
              id="online-to"
              type="date"
              value={to}
              onChange={(e) => { setTo(e.target.value); setPage(1) }}
              className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="online-groupby" className="text-xs text-[var(--fg-3)]">จัดกลุ่มตาม</label>
            <select
              id="online-groupby"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as OnlineGroupBy)}
              className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] text-sm"
            >
              {GROUP_BY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {shops.length > 0 && (
            <div className="flex flex-col gap-1">
              <label htmlFor="online-shop" className="text-xs text-[var(--fg-3)]">ร้าน</label>
              <select
                id="online-shop"
                value={shopKey}
                onChange={(e) => { setShopKey(e.target.value); setPage(1) }}
                className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] text-sm"
              >
                <option value="">ทุกร้าน</option>
                {shops.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          <button
            type="button"
            onClick={handleRefreshAll}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-xs font-medium text-[var(--fg-2)] hover:border-[var(--primary)]"
          >
            <RefreshCw className="w-3.5 h-3.5" /> รีเฟรช
          </button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-[var(--border)]">
          <div className="rounded-lg bg-[var(--bg)] p-3 border border-[var(--border)]/60">
            <p className="text-xs text-[var(--fg-3)]">ยอดขายสุทธิ</p>
            <p className="text-base sm:text-lg font-bold text-[var(--fg-1)] mt-0.5">{fmtMoney(totals.netSales)}</p>
          </div>
          <div className="rounded-lg bg-[var(--bg)] p-3 border border-[var(--border)]/60">
            <p className="text-xs text-[var(--fg-3)]">ยอดขายก่อนคืน</p>
            <p className="text-base sm:text-lg font-bold text-[var(--fg-1)] mt-0.5">{fmtMoney(totals.sales)}</p>
          </div>
          <div className="rounded-lg bg-[var(--bg)] p-3 border border-[var(--border)]/60">
            <p className="text-xs text-[var(--fg-3)]">มูลค่าคืน</p>
            <p className="text-base sm:text-lg font-bold text-[color:var(--warning,#f59e0b)] mt-0.5">{fmtMoney(totals.returnsValue)}</p>
          </div>
          <div className="rounded-lg bg-[var(--bg)] p-3 border border-[var(--border)]/60">
            <p className="text-xs text-[var(--fg-3)]">ชิ้นขาย / คืน</p>
            <p className="text-base sm:text-lg font-bold text-[var(--fg-1)] mt-0.5">
              {fmtNum(totals.qty)} <span className="text-xs font-normal text-[var(--fg-3)]">/ คืน {fmtNum(totals.qtyReturned)}</span>
            </p>
          </div>
        </div>
      </div>

      {/* 1. Summary Table */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--fg-1)]">
            สรุปยอดขายตาม{GROUP_BY_OPTIONS.find((g) => g.value === groupBy)?.label}
          </h2>
          <span className="text-xs text-[var(--fg-4)]">นับเฉพาะออเดอร์ที่ใช้งาน/สำเร็จ/คืน (ไม่รวมยกเลิกและรอชำระ) · ไม่ลงบัญชีอัตโนมัติ</span>
        </div>

        {loadingSummary ? (
          <p className="text-sm text-[var(--fg-3)] py-6 text-center">กำลังโหลด...</p>
        ) : summaryRows.length === 0 ? (
          <p className="text-sm text-[var(--fg-3)] py-6 text-center">ยังไม่มีข้อมูลออเดอร์ออนไลน์ในช่วงวันที่นี้</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--fg-3)]">
                  <th className="py-2 pr-3 text-left font-semibold">{GROUP_BY_OPTIONS.find((g) => g.value === groupBy)?.label}</th>
                  <th className="py-2 px-2 text-right font-semibold">ออเดอร์</th>
                  <th className="py-2 px-2 text-right font-semibold">จำนวน</th>
                  <th className="py-2 px-2 text-right font-semibold">คืน</th>
                  <th className="py-2 px-2 text-right font-semibold">ยอดขาย</th>
                  <th className="py-2 px-2 text-right font-semibold">มูลค่าคืน</th>
                  <th className="py-2 pl-2 text-right font-semibold">ยอดสุทธิ</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((r) => (
                  <tr key={r.key} className="border-b border-[var(--border)]/60 last:border-0 hover:bg-[var(--surface-2)]/50">
                    <td className="py-2 pr-3 font-medium text-[var(--fg-1)]">{r.label || r.key || '(ไม่ระบุ)'}</td>
                    <td className="py-2 px-2 text-right text-[var(--fg-2)]">{fmtNum(r.orders)}</td>
                    <td className="py-2 px-2 text-right text-[var(--fg-2)]">{fmtNum(r.qty)}</td>
                    <td className="py-2 px-2 text-right text-[color:var(--warning,#f59e0b)]">{r.qtyReturned > 0 ? fmtNum(r.qtyReturned) : '–'}</td>
                    <td className="py-2 px-2 text-right text-[var(--fg-2)]">{fmtMoney(r.sales)}</td>
                    <td className="py-2 px-2 text-right text-[color:var(--warning,#f59e0b)]">{r.returnsValue > 0 ? fmtMoney(r.returnsValue) : '–'}</td>
                    <td className="py-2 pl-2 text-right font-semibold text-[var(--fg-1)]">{fmtMoney(r.netSales)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--border)] font-semibold text-[var(--fg-1)]">
                  <td className="py-2 pr-3">รวม</td>
                  <td className="py-2 px-2 text-right">{isOrderCountAdditive ? fmtNum(totals.orders) : '–'}</td>
                  <td className="py-2 px-2 text-right">{fmtNum(totals.qty)}</td>
                  <td className="py-2 px-2 text-right text-[color:var(--warning,#f59e0b)]">{totals.qtyReturned > 0 ? fmtNum(totals.qtyReturned) : '–'}</td>
                  <td className="py-2 px-2 text-right">{fmtMoney(totals.sales)}</td>
                  <td className="py-2 px-2 text-right text-[color:var(--warning,#f59e0b)]">{totals.returnsValue > 0 ? fmtMoney(totals.returnsValue) : '–'}</td>
                  <td className="py-2 pl-2 text-right">{fmtMoney(totals.netSales)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* 2. Orders Table (Masked PII Only) */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[var(--fg-1)]">รายการออเดอร์ ({fmtNum(ordersTotal)})</h2>
            <p className="text-xs text-[var(--fg-4)] flex items-center gap-1 mt-0.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[var(--primary)]" /> แสดงเฉพาะข้อมูลผู้รับแบบมาสก์เท่านั้น
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-56">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-4)]" />
              <input
                value={queryText}
                onChange={(e) => { setQueryText(e.target.value); setPage(1) }}
                placeholder="ค้นหาเลขคำสั่งซื้อ / จังหวัด..."
                className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] text-xs"
              />
            </div>
            <select
              aria-label="กรองสถานะออเดอร์"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
              className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] text-xs"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {loadingOrders ? (
          <p className="text-sm text-[var(--fg-3)] py-6 text-center">กำลังโหลด...</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-[var(--fg-3)] py-6 text-center">ไม่พบออเดอร์ที่ตรงเงื่อนไข</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[680px]">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--fg-3)]">
                    <th className="py-2 pr-3 text-left font-semibold">เลขคำสั่งซื้อ</th>
                    <th className="py-2 px-2 text-left font-semibold">วันที่</th>
                    <th className="py-2 px-2 text-left font-semibold">สถานะ</th>
                    <th className="py-2 px-2 text-left font-semibold">ผู้รับ (มาสก์)</th>
                    <th className="py-2 px-2 text-left font-semibold">จังหวัด / อำเภอ</th>
                    <th className="py-2 px-2 text-right font-semibold">ชิ้น</th>
                    <th className="py-2 pl-2 text-right font-semibold">ยอดสุทธิ</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const badge = STATUS_BADGE[o.statusGroup] || { label: o.statusGroup, cls: 'bg-[var(--surface-2)] text-[var(--fg-3)]' }
                    return (
                      <tr key={o.id} className="border-b border-[var(--border)]/60 last:border-0 align-top hover:bg-[var(--surface-2)]/40">
                        <td className="py-2 pr-3">
                          <p className="font-mono font-medium text-[var(--fg-1)]">{o.orderNo}</p>
                          {o.shopKey && <p className="text-[11px] text-[var(--fg-4)]">{o.shopKey}</p>}
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap text-[var(--fg-2)]">{o.orderDate}</td>
                        <td className="py-2 px-2">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${badge.cls}`}>
                            {badge.label}
                          </span>
                          {o.statusRaw && <p className="text-[11px] text-[var(--fg-4)] mt-0.5">{o.statusRaw}</p>}
                        </td>
                        <td className="py-2 px-2 text-[var(--fg-2)] max-w-[200px]">
                          <p className="font-medium text-[var(--fg-1)]">{o.buyerNameMasked || '–'}</p>
                          {o.buyerPhoneMasked && <p className="text-[11px] text-[var(--fg-3)] font-mono">{o.buyerPhoneMasked}</p>}
                          {o.addressMasked && <p className="text-[11px] text-[var(--fg-4)] truncate" title={o.addressMasked}>{o.addressMasked}</p>}
                        </td>
                        <td className="py-2 px-2 text-[var(--fg-2)]">
                          <p>{o.province || '–'}</p>
                          {o.district && <p className="text-[11px] text-[var(--fg-4)]">{o.district} {o.postalCode || ''}</p>}
                        </td>
                        <td className="py-2 px-2 text-right text-[var(--fg-2)]">
                          {fmtNum(o.qty)}
                          {o.qtyReturned > 0 && (
                            <p className="text-[11px] text-[color:var(--warning,#f59e0b)]">คืน {fmtNum(o.qtyReturned)}</p>
                          )}
                        </td>
                        <td className="py-2 pl-2 text-right font-semibold text-[var(--fg-1)] whitespace-nowrap">{fmtMoney(o.netTotal)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2 border-t border-[var(--border)] text-xs text-[var(--fg-3)]">
                <span>หน้า {page} / {totalPages}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--border)] disabled:opacity-40"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> ก่อนหน้า
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--border)] disabled:opacity-40"
                  >
                    ถัดไป <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 3. Unlinked Products */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-[var(--primary)]" />
            <h2 className="text-sm font-semibold text-[var(--fg-1)]">ยังไม่ผูกสินค้า ({unlinked.length})</h2>
          </div>
          {hasAnyProposal && (
            <button
              type="button"
              onClick={handleAcceptAll}
              disabled={busyMapping}
              className="text-xs font-medium text-[var(--primary)] hover:underline disabled:opacity-50"
            >
              ยอมรับข้อเสนอทั้งหมด
            </button>
          )}
        </div>

        {loadingUnlinked ? (
          <p className="text-sm text-[var(--fg-3)] py-4 text-center">กำลังโหลด...</p>
        ) : unlinked.length === 0 ? (
          <p className="text-xs text-[color:var(--success,#22c55e)] flex items-center gap-1.5 py-2">
            <CheckCircle2 className="w-4 h-4" /> ผูกสินค้าครบทุกรายการแล้ว
          </p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {unlinked.map((row) => (
              <UnlinkedRowItem
                key={row.sourceRef}
                row={row}
                stockItems={stockItems}
                busy={busyMapping}
                onConfirm={(stockItemId, factor) => handleConfirmMapping(row, stockItemId, factor)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 4. Cross-month Returns + Unattributed Returns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cross-month returns */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-[color:var(--warning,#f59e0b)]" />
              <h2 className="text-sm font-semibold text-[var(--fg-1)]">รับคืนข้ามเดือน ({returnEvents.length})</h2>
            </div>
            {returnEvents.length > 0 && (
              <button
                type="button"
                onClick={handleRestock}
                disabled={busyRestock || selectedReturnIds.length === 0}
                className="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-medium disabled:opacity-50"
              >
                {busyRestock ? 'กำลังรับคืน...' : `รับคืนเข้าสต็อก (${selectedReturnIds.length})`}
              </button>
            )}
          </div>
          <p className="text-xs text-[var(--fg-4)]">
            รายการคืนของออเดอร์ที่รอบเดือนนั้นยืนยันการขายแล้ว — กดรับคืนเข้าสต็อกตอนสิ้นเดือน (ไม่ลงบัญชีเพิ่ม)
          </p>

          {loadingReturns ? (
            <p className="text-sm text-[var(--fg-3)] py-4 text-center">กำลังโหลด...</p>
          ) : returnEvents.length === 0 ? (
            <p className="text-xs text-[var(--fg-4)] py-4 text-center">ไม่มีรายการรอรับคืนเข้าสต็อก</p>
          ) : (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-[var(--fg-3)]">
                <input
                  type="checkbox"
                  checked={selectedReturnIds.length === returnEvents.length && returnEvents.length > 0}
                  onChange={toggleSelectAllReturns}
                />
                เลือกทั้งหมด
              </label>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {returnEvents.map((ev) => (
                  <label
                    key={ev.id}
                    className="flex items-start gap-2.5 p-2.5 rounded-lg border border-[var(--border)] hover:bg-[var(--surface-2)]/40 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedReturnIds.includes(ev.id)}
                      onChange={() => toggleReturnSelection(ev.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0 text-xs">
                      <p className="font-medium text-[var(--fg-1)] truncate">
                        {ev.productName}{ev.variantName ? ` · ${ev.variantName}` : ''}
                      </p>
                      <p className="text-[var(--fg-4)]">
                        ออเดอร์ <span className="font-mono">{ev.orderNo}</span> · รอบ {ev.orderMonth} · คืนเพิ่ม {fmtNum(ev.qtyDelta)} ชิ้น
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Unattributed Returns */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[color:var(--warning,#f59e0b)]" />
            <h2 className="text-sm font-semibold text-[var(--fg-1)]">คืนที่ไม่ระบุออเดอร์ ({targetMonth})</h2>
          </div>
          <p className="text-xs text-[var(--fg-4)]">
            ส่วนต่างเมื่อยอดคืนในไฟล์รอบเดือนมากกว่ารายออเดอร์ในเดือนเดียวกัน{effectiveShopKey ? ` (ร้าน ${effectiveShopKey})` : ''}
          </p>

          {loadingUnattributed ? (
            <p className="text-sm text-[var(--fg-3)] py-4 text-center">กำลังโหลด...</p>
          ) : !effectiveShopKey ? (
            <p className="text-xs text-[var(--fg-4)] py-4 text-center">ยังไม่มีข้อมูลร้านรอบเดือนสำหรับเปรียบเทียบ</p>
          ) : unattributed.length === 0 ? (
            <p className="text-xs text-[var(--fg-4)] py-4 text-center">ไม่พบยอดคืนที่ระบุออเดอร์ไม่ได้ในเดือนนี้</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--fg-3)]">
                    <th className="py-1.5 pr-2 text-left font-semibold">สินค้า / ตัวเลือก</th>
                    <th className="py-1.5 text-right font-semibold">คืนไม่ระบุออเดอร์</th>
                  </tr>
                </thead>
                <tbody>
                  {unattributed.map((u, idx) => (
                    <tr key={`${u.productName}-${u.variantName ?? ''}-${idx}`} className="border-b border-[var(--border)]/60 last:border-0">
                      <td className="py-1.5 pr-2 text-[var(--fg-1)]">
                        {u.productName}{u.variantName ? ` · ${u.variantName}` : ''}
                      </td>
                      <td className="py-1.5 text-right font-semibold text-[color:var(--warning,#f59e0b)]">
                        {fmtNum(u.qtyDelta)} ชิ้น
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ==================== Unlinked Row Item ====================

function UnlinkedRowItem({
  row,
  stockItems,
  busy,
  onConfirm,
}: {
  row: UnlinkedLineRow
  stockItems: StockItemOption[]
  busy: boolean
  onConfirm: (stockItemId: string, factor: number) => void
}) {
  const [search, setSearch] = useState('')
  const [stockItemId, setStockItemId] = useState(row.proposedStockItemId || '')
  const [selectedLabel, setSelectedLabel] = useState(
    row.proposedStockItemName ? `${row.proposedSku ? `${row.proposedSku} · ` : ''}${row.proposedStockItemName}` : '',
  )
  const [factor, setFactor] = useState(String(row.proposedFactor || 1))

  const options = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return stockItems
      .filter((s) => s.name.toLowerCase().includes(q) || s.sku.toLowerCase().includes(q))
      .slice(0, 20)
  }, [stockItems, search])

  return (
    <div className="border border-[var(--border)] rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-medium text-[var(--fg-1)]">
            {row.productName}{row.variantName ? ` · ${row.variantName}` : ''}
          </p>
          <p className="text-xs text-[var(--fg-4)]">รวม {fmtNum(row.qty)} ชิ้น</p>
        </div>
        {row.proposedStockItemId && (
          <span className="text-xs text-[color:var(--warning,#f59e0b)]">
            ข้อเสนอ: {row.proposedSku ? `${row.proposedSku} · ` : ''}{row.proposedStockItemName || row.proposedStockItemId}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--fg-4)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={selectedLabel || 'ค้นหาสินค้าในคลัง...'}
            className="w-full pl-7 pr-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] text-xs"
          />
          {search && options.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg max-h-40 overflow-y-auto">
              {options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setStockItemId(opt.id)
                    setSelectedLabel(`${opt.sku} · ${opt.name}`)
                    setSearch('')
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--primary-soft)] text-[var(--fg-1)]"
                >
                  {opt.sku} · {opt.name} ({opt.unit})
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          type="number"
          min={0.0001}
          step="any"
          aria-label="ตัวคูณแพ็ก"
          value={factor}
          onChange={(e) => setFactor(e.target.value)}
          title="ตัวคูณแพ็ก — เช่นตัวเลือกนี้คือ 2 ใบ ให้ใส่ 2"
          className="w-20 px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] text-xs text-right"
        />
        <button
          type="button"
          onClick={() => onConfirm(stockItemId, Number(factor) || 1)}
          disabled={busy || !stockItemId}
          className="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-medium disabled:opacity-50"
        >
          ยืนยัน
        </button>
      </div>
    </div>
  )
}
