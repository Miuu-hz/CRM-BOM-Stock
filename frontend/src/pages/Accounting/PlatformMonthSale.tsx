import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, AlertTriangle, Search, Undo2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'

// ==================== Types (ตรงกับ backend /api/platform-settlement เฟส 2) ====================

interface MonthRow {
  id: string
  platform: string
  shop_key: string
  month: string
  status: string
  cogs_amount: number | null
  sale_confirmed_at: string | null
}

interface MappingRow {
  sourceRef: string
  productName: string | null
  variantName: string | null
  qtyConfirmed: number
  mapped: boolean
  stockItemId: string | null
  sku: string | null
  stockItemName: string | null
  unit: string | null
  unitCost: number | null
  quantity: number | null
  hasBom: boolean
  factor: number | null
  proposed: boolean
  proposedStockItemId: string | null
  proposedSku: string | null
  proposedStockItemName: string | null
  proposedFactor: number | null
}

interface StockItemOption {
  id: string
  sku: string
  name: string
  unit: string
  quantity: number
}

type Filter = 'all' | 'unmapped' | 'proposed' | 'mapped'

const fmt = (n: number | null | undefined) => `฿${(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ==================== Main ====================

export default function PlatformMonthSale() {
  const [months, setMonths] = useState<MonthRow[]>([])
  const [monthId, setMonthId] = useState<string>('')
  const [rows, setRows] = useState<MappingRow[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stockItems, setStockItems] = useState<StockItemOption[]>([])
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Record<string, { stockItemId: string; factor: string }>>({})

  const selectedMonth = months.find((m) => m.id === monthId) || null

  const loadMonths = async () => {
    try {
      const res = await api.get('/platform-settlement/months')
      if (res.data.success) {
        setMonths(res.data.data)
        if (!monthId && res.data.data.length > 0) setMonthId(res.data.data[0].id)
      }
    } catch {
      toast.error('โหลดรายการรอบเดือนไม่สำเร็จ')
    }
  }

  const loadMapping = async (id: string) => {
    if (!id) return
    try {
      setLoading(true)
      const res = await api.get(`/platform-settlement/months/${id}/mapping`)
      if (res.data.success) setRows(res.data.data)
    } catch {
      toast.error('โหลดรายการจับคู่ SKU ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  // รายการสินค้าขายได้ทั้งหมด (sellable=1 เหมือน picker เมนู POS/ใบขาย) — โหลดครั้งเดียว กรองฝั่งหน้าเว็บ
  const loadStockItems = async () => {
    try {
      const res = await api.get('/stock', { params: { sellable: '1' } })
      if (res.data.success) {
        setStockItems(res.data.data.map((s: any) => ({
          id: s.id, sku: s.sku, name: s.name, unit: s.base_unit || s.unit, quantity: Number(s.quantity) || 0,
        })))
      }
    } catch {
      // ช่องค้นหาพัง ไม่ควรขวางหน้าอื่น
    }
  }

  useEffect(() => { loadMonths(); loadStockItems() }, [])
  useEffect(() => { if (monthId) loadMapping(monthId) }, [monthId])

  const stockOptions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return stockItems.filter((s) => s.name.toLowerCase().includes(q) || s.sku.toLowerCase().includes(q)).slice(0, 20)
  }, [stockItems, search])

  const filtered = useMemo(() => {
    if (filter === 'unmapped') return rows.filter((r) => !r.mapped && !r.proposed)
    if (filter === 'proposed') return rows.filter((r) => r.proposed)
    if (filter === 'mapped') return rows.filter((r) => r.mapped)
    return rows
  }, [rows, filter])

  const unmappedCount = rows.filter((r) => !r.mapped).length
  const allMapped = rows.length > 0 && unmappedCount === 0

  const handleConfirmMapping = async (row: MappingRow, stockItemId: string, factor: number) => {
    if (!monthId || !stockItemId) return
    try {
      setBusy(true)
      const res = await api.post(`/platform-settlement/months/${monthId}/mapping/confirm`, {
        sourceRef: row.sourceRef, stockItemId, factor,
      })
      if (res.data.success) {
        toast.success(`ผูก "${row.productName} · ${row.variantName}" แล้ว`)
        setRows(res.data.data)
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ผูก SKU ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const handleAcceptAll = async () => {
    if (!monthId) return
    try {
      setBusy(true)
      const res = await api.post(`/platform-settlement/months/${monthId}/mapping/accept-all`)
      if (res.data.success) {
        toast.success(`ยืนยันข้อเสนอแล้ว ${res.data.data.accepted} รายการ`)
        setRows(res.data.data.rows)
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ยืนยันข้อเสนอทั้งหมดไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmSale = async () => {
    if (!monthId) return
    try {
      setBusy(true)
      const res = await api.post(`/platform-settlement/months/${monthId}/confirm-sale`)
      if (res.data.success) {
        toast.success(res.data.message || 'ยืนยันการขายแล้ว')
        loadMonths()
        loadMapping(monthId)
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ยืนยันการขายไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const handleCancelSale = async () => {
    if (!monthId) return
    try {
      setBusy(true)
      const res = await api.post(`/platform-settlement/months/${monthId}/cancel-sale`)
      if (res.data.success) {
        toast.success('ยกเลิกการยืนยันแล้ว คืนสต็อกทั้งหมด')
        loadMonths()
        loadMapping(monthId)
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ยกเลิกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  if (months.length === 0) return null // ยังไม่มีรอบเดือนไหนส่งไฟล์เข้ามาเลย — ไม่ต้องโชว์ส่วนนี้

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-[var(--fg-1)]">จับคู่ SKU + ยืนยันการขาย (ตัดสต็อก)</h2>
        <select
          value={monthId}
          onChange={(e) => setMonthId(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] text-sm"
        >
          {months.map((m) => (
            <option key={m.id} value={m.id}>{m.platform} · {m.shop_key} · {m.month} ({m.status})</option>
          ))}
        </select>
      </div>

      {selectedMonth?.status === 'SALE_CONFIRMED' ? (
        <div className="border border-[var(--success)] bg-[var(--success-soft)] rounded-lg p-4 space-y-2">
          <p className="text-sm font-medium text-success flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4" /> ยืนยันการขายแล้ว ตัดสต็อกเรียบร้อย — ต้นทุนรวม {fmt(selectedMonth.cogs_amount)}
          </p>
          <button
            onClick={handleCancelSale}
            disabled={busy}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--fg-3)] text-xs hover:text-[var(--fg-1)] disabled:opacity-50"
          >
            <Undo2 className="w-3.5 h-3.5" /> ยกเลิกการยืนยัน (คืนสต็อก)
          </button>
        </div>
      ) : (
        <>
          {/* filter แท็บ */}
          <div className="flex items-center gap-2 text-xs">
            {(['all', 'unmapped', 'proposed', 'mapped'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full border ${filter === f ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--fg-1)]' : 'border-[var(--border)] text-[var(--fg-3)]'}`}
              >
                {f === 'all' ? `ทั้งหมด (${rows.length})` : f === 'unmapped' ? `ยังไม่ผูก (${rows.filter(r => !r.mapped).length})` : f === 'proposed' ? `มีข้อเสนอ (${rows.filter(r => r.proposed).length})` : `ผูกแล้ว (${rows.filter(r => r.mapped).length})`}
              </button>
            ))}
            {rows.some((r) => r.proposed) && (
              <button onClick={handleAcceptAll} disabled={busy} className="ml-auto text-[var(--primary)] hover:underline disabled:opacity-50">
                ยืนยันข้อเสนอทั้งหมด
              </button>
            )}
          </div>

          {loading ? (
            <p className="text-sm text-[var(--fg-3)] py-4 text-center">กำลังโหลด...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-[var(--fg-3)] py-4 text-center">ไม่มีรายการในหมวดนี้</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filtered.map((r) => (
                <MappingRowItem
                  key={r.sourceRef}
                  row={r}
                  stockOptions={stockOptions}
                  search={search}
                  setSearch={setSearch}
                  picked={picked[r.sourceRef]}
                  setPicked={(v) => setPicked({ ...picked, [r.sourceRef]: v })}
                  onConfirm={(stockItemId, factor) => handleConfirmMapping(r, stockItemId, factor)}
                  busy={busy}
                />
              ))}
            </div>
          )}

          <div className="border-t border-[var(--border)] pt-3 flex items-center justify-between">
            {!allMapped && rows.length > 0 && (
              <p className="text-xs text-warning flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> ยังไม่ผูก {unmappedCount} รายการ — ยืนยันการขายไม่ได้จนกว่าจะผูกครบ
              </p>
            )}
            <button
              onClick={handleConfirmSale}
              disabled={busy || !allMapped}
              className="ml-auto px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-medium disabled:opacity-50"
            >
              {busy ? 'กำลังดำเนินการ...' : 'ยืนยันการขาย (ตัดสต็อก)'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ==================== 1 แถวจับคู่ ====================

function MappingRowItem({
  row, stockOptions, search, setSearch, picked, setPicked, onConfirm, busy,
}: {
  row: MappingRow
  stockOptions: StockItemOption[]
  search: string
  setSearch: (v: string) => void
  picked?: { stockItemId: string; factor: string }
  setPicked: (v: { stockItemId: string; factor: string }) => void
  onConfirm: (stockItemId: string, factor: number) => void
  busy: boolean
}) {
  const [editing, setEditing] = useState(false)
  const current = picked || { stockItemId: row.proposedStockItemId || '', factor: String(row.proposedFactor || row.factor || 1) }

  return (
    <div className="border border-[var(--border)] rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-medium text-[var(--fg-1)]">{row.productName} {row.variantName ? `· ${row.variantName}` : ''}</p>
          <p className="text-xs text-[var(--fg-4)]">ขายแล้ว {row.qtyConfirmed} ชิ้น (ยืนยัน)</p>
        </div>
        {row.mapped ? (
          <span className="text-xs text-success flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> {row.sku} · {row.stockItemName} {row.hasBom ? '(มีสูตร BOM)' : ''}
            {row.factor && row.factor !== 1 ? ` · ×${row.factor}` : ''}
          </span>
        ) : row.proposed && !editing ? (
          <span className="text-xs text-warning">ข้อเสนอ: {row.proposedSku} · {row.proposedStockItemName}</span>
        ) : null}
        {(!row.mapped || editing) && (
          <button onClick={() => setEditing((v) => !v)} className="text-xs text-[var(--primary)] hover:underline">
            {editing ? 'ปิด' : row.proposed ? 'แก้/ยืนยันเอง' : 'ผูก SKU'}
          </button>
        )}
        {row.mapped && !editing && (
          <button onClick={() => setEditing(true)} className="text-xs text-[var(--fg-4)] hover:text-[var(--fg-1)]">แก้</button>
        )}
      </div>

      {(editing || (!row.mapped && !row.proposed)) && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--fg-4)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาสินค้าในคลัง..."
              className="w-full pl-7 pr-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] text-xs"
            />
            {search && stockOptions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {stockOptions.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => { setPicked({ stockItemId: opt.id, factor: current.factor }); setSearch('') }}
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
            value={current.factor}
            onChange={(e) => setPicked({ stockItemId: current.stockItemId, factor: e.target.value })}
            title="ตัวคูณแพ็ก — เช่นตัวเลือกนี้คือ 2 ใบ ให้ใส่ 2"
            className="w-20 px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-1)] text-xs text-right"
          />
          <button
            onClick={() => { onConfirm(current.stockItemId, Number(current.factor) || 1); setEditing(false) }}
            disabled={busy || !current.stockItemId}
            className="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-medium disabled:opacity-50"
          >
            ยืนยัน
          </button>
        </div>
      )}
    </div>
  )
}
