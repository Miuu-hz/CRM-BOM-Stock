import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Package,
  PackageOpen,
  Search,
  AlertTriangle,
  ArrowUpCircle,
  ArrowDownCircle,
  X,
  Lock,
  Edit2,
  Loader2,
  Clock,
  MapPin,
  Plus,
  Upload,
  RefreshCw,
  MoreHorizontal,
  DollarSign,
  History,
  ImagePlus,
  Trash2,
  Settings2,
  Check,
  FileDown,
  SlidersHorizontal,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Network,
  ArrowRight,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import toast from 'react-hot-toast'
import { useApprovalGate } from '../components/common/ApprovalGate'
import api from '../services/api'
import stockService, { StockItem, StockStats } from '../services/stock'
import subcontractService, { SubconStockRow, SubconStockSummary } from '../services/subcontract'
import companySettingsService from '../services/companySettings.service'
import { SearchableDropdown } from '../components/common/SearchableDropdown'
import ImportModal from '../components/common/ImportModal'
import UnitChainEditor from '../components/common/UnitChainEditor'
import { UnitPicker } from '../components/common/UnitPicker'
import { unitLabel } from '../hooks/useUnits'
import { useModalClose } from '../hooks/useModalClose'
import { useUnits, invalidateUnitsCache, UNIT_LABELS as UNIT_LABELS_MAP } from '../hooks/useUnits'
import { normalizeUnit } from '../utils/unitNormalize'
import { useTranslation } from 'react-i18next'

/**
 * Stock that is actually usable: loose quantity plus whatever is still sealed
 * inside unopened packs. Judging stock levels on `quantity` alone reported a
 * full shelf as running out, because receiving in pack units parks the goods
 * in sealed_qty until something opens them.
 *
 * The backend sends availableTotal; the local fallback keeps this page honest
 * against a backend that predates that field.
 */
function availableOf(item: StockItem): number {
  if (typeof item.availableTotal === 'number') return item.availableTotal
  const packFactor = item.packFactor
  const sealed = item.sealedQty ?? 0
  if (packFactor && sealed > 0) return item.quantity + sealed * packFactor
  return item.quantity
}
type ColumnKey = 'image' | 'category' | 'quantity' | 'purchasePrice' | 'unitPrice' | 'value' | 'location' | 'status'

const COLUMN_LABELS: Record<ColumnKey, string> = {
  image: 'รูปสินค้า',
  category: 'ประเภท',
  quantity: 'คงเหลือ',
  purchasePrice: 'ทุน/หน่วย',
  unitPrice: 'ราคาขาย/หน่วย',
  value: 'มูลค่ารวม',
  location: 'ที่เก็บ',
  status: 'สถานะ',
}
// คำอธิบายสั้น ๆ ใต้ชื่อคอลัมน์ — แต่ละร้านดูตัวเลขคนละชุด ต้องรู้ว่าแต่ละอันคืออะไรก่อนเลือก
const COLUMN_HINTS: Partial<Record<ColumnKey, string>> = {
  image: 'เห็นของก่อนอ่านชื่อ เร็วกว่ามาก',
  category: 'วัตถุดิบ / สำเร็จรูป / บริการ',
  quantity: 'ปิดไม่ได้ — เป็นหัวใจของหน้านี้',
  purchasePrice: 'ราคาล่าสุดที่ซื้อเข้ามา',
  unitPrice: 'ราคาขายต่อหน่วยฐาน',
  value: 'คงเหลือ × ทุน — ปิดไว้ตอนแรก',
  location: 'ชั้นวาง / ตู้แช่',
  status: 'หมด / ใกล้หมด / ปกติ',
}
const ALWAYS_VISIBLE: ColumnKey[] = ['quantity', 'status']
// ชื่อสินค้าโชว์เสมอ เลยไม่ใช่คอลัมน์ที่ปิดได้ แต่ยังต้องเรียงตามชื่อได้อยู่
type SortKey = ColumnKey | 'name'

// คีย์ v2: ชุดคอลัมน์เปลี่ยนไปจากเดิม (SKU ย้ายไปอยู่ใต้ชื่อ หน่วยไปอยู่กับตัวเลข)
// ของที่ localStorage เก่าเก็บไว้จึงมีคีย์ที่ไม่มีอยู่แล้ว ทำให้ตัวนับ "กี่/กี่" เพี้ยน
function getDefaultCols(): Record<ColumnKey, boolean> {
  const fallback: Record<ColumnKey, boolean> = {
    image: true, category: true, quantity: true, purchasePrice: true,
    unitPrice: false, value: false, location: false, status: true,
  }
  const saved = localStorage.getItem('stock_columns_v2')
  if (!saved) return fallback
  try {
    const parsed = JSON.parse(saved)
    // รับเฉพาะคีย์ที่รู้จัก กันค่าเก่า/ค่าขยะหลุดเข้ามาแล้วนับผิด
    const out = { ...fallback }
    for (const k of Object.keys(fallback) as ColumnKey[]) {
      if (typeof parsed?.[k] === 'boolean') out[k] = parsed[k]
    }
    return out
  } catch { return fallback }
}

function Stock() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [stats, setStats] = useState<StockStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('all')
  const [showColumnPicker, setShowColumnPicker] = useState(false)

  const [visibleCols, setVisibleCols] = useState<Record<ColumnKey, boolean>>(getDefaultCols)

  const toggleCol = (key: ColumnKey) => {
    if (ALWAYS_VISIBLE.includes(key)) return
    const next = { ...visibleCols, [key]: !visibleCols[key] }
    setVisibleCols(next)
    localStorage.setItem('stock_columns_v2', JSON.stringify(next))
  }


  // Pagination states
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(50)

  // Sort states
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  // เมนู "…" ของหัวหน้าจอ (ทะเบียนปรับ/นำเข้า/ส่งออก) และของแต่ละแถว
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  // เมนูแถวลอยแบบ fixed เพราะตารางมี overflow-x-auto ซึ่งจะตัดเมนูที่ absolute ทิ้ง
  const [rowMenu, setRowMenu] = useState<{ item: StockItem; x: number; y: number } | null>(null)

  // Adjust modal
  const approvalGate = useApprovalGate()
  const [adjustModal, setAdjustModal] = useState<{ open: boolean; item: StockItem | null }>({
    open: false,
    item: null,
  })

  // Modal states
  const [detailModal, setDetailModal] = useState<{ open: boolean; item: StockItem | null }>({
    open: false,
    item: null,
  })
  const [editModal, setEditModal] = useState<{ open: boolean; item: StockItem | null }>({
    open: false,
    item: null,
  })
  // Add New Item Modal
  // Unpack Modal — open sealed packs by hand
  const [unpackModal, setUnpackModal] = useState<{ open: boolean; item: StockItem | null }>({ open: false, item: null })

  const [showAddModal, setShowAddModal] = useState(false)
  const [adjLogModal, setAdjLogModal] = useState(false)

  // Import Modal
  const [showImportModal, setShowImportModal] = useState(false)

  useEffect(() => {
    loadData()
    companySettingsService.get().then(d => {
      const enabled = Number(d.show_subcon_stock_widget) !== 0
      setShowSubconStockWidget(enabled)
      if (enabled) loadSubconStock()
    }).catch(() => {
      // ถ้าดึง settings ไม่ได้ ให้ยึด default (เปิด) ไว้ก่อน
      loadSubconStock()
    })
  }, [])

  // Phase 3: สต็อกวัตถุดิบที่อยู่นอกบริษัท (ที่ผู้รับเหมา) — สรุปมูลค่าไว้แสดงเป็นการ์ดสถิติ คลิกเพื่อดูรายละเอียดที่ /stock/subcontractors
  const [subconStock, setSubconStock] = useState<{ rows: SubconStockRow[]; summary: SubconStockSummary } | null>(null)
  const [subconStockLoading, setSubconStockLoading] = useState(false)
  const [showSubconStockWidget, setShowSubconStockWidget] = useState(true)
  const loadSubconStock = async () => {
    setSubconStockLoading(true)
    try {
      const data = await subcontractService.getSubconStock()
      setSubconStock(data)
    } catch (err) {
      console.error('Failed to load subcon stock:', err)
    } finally {
      setSubconStockLoading(false)
    }
  }

  const loadData = async () => {
    setLoading(true)
    try {
      const [itemsData, statsData] = await Promise.all([
        stockService.getAll(),
        stockService.getStats(),
      ])
      setStockItems(itemsData)
      setStats(statsData)
    } catch (err) {
      console.error('Failed to load stock data:', err)
    } finally {
      setLoading(false)
    }
  }

  const getItemStatus = (item: StockItem): 'adequate' | 'nearLow' | 'low' | 'critical' | 'overstock' | 'out' | 'sealed' => {
    const hasSealed = (item.sealedQty ?? 0) > 0
    const available = availableOf(item)
    if (item.quantity === 0 && !hasSealed) return 'out'
    // Loose stock is gone (or below the reorder point) but unopened packs still
    // cover it: that is a "go open a pack" state, not the red out-of-stock one.
    if (hasSealed && item.quantity <= 0) return 'sealed'
    if (hasSealed && item.quantity <= item.minStock && available > item.minStock) return 'sealed'
    if (available <= item.minStock * 0.3) return 'critical'
    if (available <= item.minStock) return 'low'
    // Early warning: still above the reorder point, but close enough that an
    // order placed today arrives before the shelf is empty.
    // ponytail: fixed 1.5x. Make it a company setting if lead times differ per product.
    if (item.minStock > 0 && available <= item.minStock * 1.5) return 'nearLow'
    if (item.maxStock > 0 && available >= item.maxStock) return 'overstock'
    return 'adequate'
  }

  // จำนวนต่อชิป — นับจากรายการทั้งหมดเสมอ ไม่ใช่ของที่กรองแล้ว
  // ไม่งั้นพอกดชิปนึง ตัวเลขชิปอื่นจะกลายเป็น 0 หมดจนกดต่อไม่ถูก
  const chipCounts = useMemo(() => {
    const cat: Record<string, number> = { all: 0, raw: 0, wip: 0, finished: 0, service: 0, material: 0 }
    const st: Record<string, number> = { all: 0, out: 0, sealed: 0, critical: 0, low: 0, nearLow: 0, overstock: 0 }
    for (const item of stockItems || []) {
      cat.all++; st.all++
      const g = getCategoryGroup(item.category)
      if (g in cat) cat[g]++
      const s = getItemStatus(item)
      if (s in st) st[s]++
    }
    return { cat, st }
  }, [stockItems])
  const filteredItems = useMemo(() => (stockItems || []).filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCategory =
      selectedCategory === 'all' || getCategoryGroup(item.category) === selectedCategory
    const status = getItemStatus(item)
    const matchesStatus = selectedStatus === 'all' || status === selectedStatus
    return matchesSearch && matchesCategory && matchesStatus
  }), [stockItems, searchTerm, selectedCategory, selectedStatus])

  const sortedItems = useMemo(() => sortKey ? [...filteredItems].sort((a, b) => {
    let aVal: any, bVal: any
    switch (sortKey) {
      case 'name': aVal = a.name; bVal = b.name; break
      case 'category': aVal = getCategoryGroup(a.category); bVal = getCategoryGroup(b.category); break
      case 'quantity': aVal = availableOf(a); bVal = availableOf(b); break
      case 'value': aVal = availableOf(a) * (a.purchasePrice ?? 0); bVal = availableOf(b) * (b.purchasePrice ?? 0); break
      case 'purchasePrice': aVal = a.purchasePrice ?? 0; bVal = b.purchasePrice ?? 0; break
      case 'unitPrice': aVal = a.unitPrice ?? 0; bVal = b.unitPrice ?? 0; break
      case 'location': aVal = a.location || ''; bVal = b.location || ''; break
      case 'status': aVal = getItemStatus(a); bVal = getItemStatus(b); break
      default: return 0
    }
    if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal, 'th') : bVal.localeCompare(aVal, 'th')
    return sortDir === 'asc' ? aVal - bVal : bVal - aVal
  }) : filteredItems, [filteredItems, sortKey, sortDir])

  const totalItems = sortedItems.length
  const totalPages = Math.ceil(totalItems / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedItems = useMemo(
    () => sortedItems.slice(startIndex, endIndex),
    [sortedItems, startIndex, endIndex],
  )

  // Reset to page 1 when filters change
  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    setCurrentPage(1)
  }

  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value)
    setCurrentPage(1)
  }

  const handleStatusChange = (value: string) => {
    setSelectedStatus(value)
    setCurrentPage(1)
  }

  const handleExport = () => {
    const rows = sortedItems.map(item => ({
      'SKU': item.sku,
      'ชื่อสินค้า': item.name,
      'GS1 Barcode': item.gs1Barcode || '',
      'ประเภท': item.category,
      'จำนวน': item.quantity,
      'หน่วย': item.unit,
      'Min Stock': item.minStock,
      'Max Stock': item.maxStock,
      'ราคาที่ซื้อมา (฿)': item.purchasePrice ?? 0,
      'หน่วยที่ซื้อ': unitLabel(item.purchaseUnit || item.baseUnit || item.unit || ''),
      'ราคาขาย/หน่วยฐาน (฿)': item.unitPrice ?? 0,
      'สถานที่': item.location || '',
      'สถานะ': getItemStatus(item),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Stock')
    XLSX.writeFile(wb, `stock_export_${new Date().toISOString().slice(0, 10)}.xlsx`)
    toast.success(`ส่งออก ${rows.length} รายการเรียบร้อย`)
  }

  const handleDeleteItem = async (item: StockItem) => {
    if (!confirm(`ยืนยันลบ "${item.name}"? การกระทำนี้ไม่สามารถย้อนกลับได้`)) return
    try {
      await stockService.delete(item.id)
      toast.success('ลบแล้ว')
      loadData()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'ลบไม่สำเร็จ')
    }
  }

  // กดรูปในแถว: มีรูปแล้วเปิดดูรูปเต็ม · ยังไม่มีก็เปิดตัวเลือกไฟล์แล้วอัปทันที
  // จำกัดชนิดไฟล์ให้ตรงกับ allowlist ฝั่ง server ไม่เสนอสิ่งที่ server ไม่รับ
  const handleRowImage = (item: StockItem) => {
    if (item.imageUrl) { setImageViewer(item); return }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      if (file.size > 10 * 1024 * 1024) { toast.error('ไฟล์ใหญ่เกิน 10 MB'); return }
      try {
        await stockService.uploadImage(item.id, file)
        toast.success('เพิ่มรูปแล้ว')
        loadData()
      } catch { toast.error('อัปโหลดรูปไม่สำเร็จ') }
    }
    input.click()
  }
  // รูปเต็มจอเวลากดดูรูปจากแถว
  const [imageViewer, setImageViewer] = useState<StockItem | null>(null)
  const handleOpenDetail = async (item: StockItem) => {
    try {
      const movements = await stockService.getMovements(item.id)
      setDetailModal({ open: true, item: { ...item, movements } })
    } catch (err) {
      console.error('Failed to load movements:', err)
      setDetailModal({ open: true, item })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-[var(--primary)] animate-spin" />
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          {/* แบบร่างให้สรุปทุกอย่างไว้บรรทัดเดียวใต้หัวเรื่อง แทนการ์ดใหญ่ 4-5 ใบ
              ที่กินความสูงจนตารางเหลือพื้นที่น้อย — ตัวเลขชุดเดียวกันเป๊ะ แค่ย้ายที่ */}
          <h1 className="text-2xl leading-8 font-bold text-[var(--fg-1)] mb-0.5">คลังสินค้า</h1>
          <p className="text-[var(--fg-3)] text-sm">
            {(stats?.totalItems ?? 0).toLocaleString('th-TH')} รายการ
            <span className="mx-1.5 text-[var(--fg-4)]">·</span>
            มูลค่ารวม ฿{(stats?.totalValue ?? 0).toLocaleString('th-TH')}
            {(stats?.lowStockCount ?? 0) > 0 && (
              <><span className="mx-1.5 text-[var(--fg-4)]">·</span>
              <span className="text-[var(--warning-strong)]">ใกล้หมด {(stats?.lowStockCount ?? 0).toLocaleString('th-TH')}</span></>
            )}
            {(stats?.criticalCount ?? 0) > 0 && (
              <><span className="mx-1.5 text-[var(--fg-4)]">·</span>
              <span className="text-danger">หมด {(stats?.criticalCount ?? 0).toLocaleString('th-TH')}</span></>
            )}
            {showSubconStockWidget && (
              <><span className="mx-1.5 text-[var(--fg-4)]">·</span>
              ผู้รับเหมา ฿{(subconStock?.summary.total_value ?? 0).toLocaleString('th-TH')}</>
            )}
          </p>
        </div>

        {/* เหลือ 2 ปุ่มที่ใช้ทุกวัน ที่เหลือยุบไปอยู่ใต้ "…" — เดิมมี 5 ปุ่มเรียงกัน
            จนปุ่มที่กดบ่อยที่สุดกับปุ่มที่กดปีละครั้งดูสำคัญเท่ากัน */}
        <div className="flex items-center gap-2 shrink-0">
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setAdjustModal({ open: true, item: null })}
            className="flex items-center gap-2 h-11 px-4 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-sm font-semibold text-[var(--fg-2)] hover:border-[var(--primary)] transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            ปรับสต็อก
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 h-11 px-4.5 rounded-xl bg-[var(--primary)] text-white text-sm font-semibold hover:bg-[var(--primary-hover)] transition-colors"
          >
            <Plus className="w-4 h-4" strokeWidth={2.4} />
            เพิ่มสินค้า
          </motion.button>

          <div className="relative">
            <button
              onClick={() => setShowMoreMenu(v => !v)}
              aria-label="เครื่องมืออื่น"
              aria-expanded={showMoreMenu}
              className={`w-11 h-11 flex items-center justify-center rounded-xl border transition-colors ${showMoreMenu ? 'bg-[var(--surface-2)] border-[var(--border-strong)] text-[var(--fg-1)]' : 'bg-[var(--surface)] border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--fg-1)]'}`}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {showMoreMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowMoreMenu(false)} />
                <div role="menu" className="absolute top-12 right-0 z-40 w-60 rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-2 overflow-hidden">
                  {[
                    { icon: History, label: 'ทะเบียนการปรับสต็อก', hint: 'ใครปรับอะไร เพราะอะไร เป็นเงินเท่าไร', go: () => setAdjLogModal(true) },
                    { icon: Upload, label: 'นำเข้าจากไฟล์', hint: 'Excel / CSV', go: () => setShowImportModal(true) },
                    { icon: FileDown, label: 'ส่งออกเป็น Excel', hint: 'ตามตัวกรองที่เลือกอยู่', go: handleExport },
                  ].map(m => (
                    <button
                      key={m.label}
                      onClick={() => { setShowMoreMenu(false); m.go() }}
                      className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-[var(--bg)] transition-colors"
                    >
                      <m.icon className="w-4 h-4 text-[var(--fg-3)] mt-0.5 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-[var(--fg-1)]">{m.label}</span>
                        <span className="block text-[11px] leading-4 text-[var(--fg-4)]">{m.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ดูรูปสินค้าเต็มจอ — กดที่ไหนก็ปิด */}
      {imageViewer?.imageUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
          onClick={() => setImageViewer(null)}
          role="dialog"
          aria-label={`รูป ${imageViewer.name}`}
        >
          <img src={imageViewer.imageUrl} alt={imageViewer.name} className="max-w-full max-h-full rounded-2xl object-contain" />
        </div>
      )}
      {/* แถบกรองแถวเดียว — เดิมเป็น 2 บล็อกซ้อนกันพร้อมหัวข้อกำกับ สูงรวมราว 110px
          ชิปมันอ่านออกด้วยตัวเองอยู่แล้ว หัวข้อจึงเป็นแค่ที่กินพื้นที่เปล่า ๆ
          ชิปที่นับได้ 0 ถูกซ่อน — ไม่มีของให้กรองก็ไม่ต้องกินที่ */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-2.5 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] basis-full sm:basis-60">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--fg-4)]" aria-hidden="true" />
          <input
            type="search"
            placeholder="ค้นชื่อ หรือรหัสสินค้า…"
            aria-label="ค้นหาสินค้า"
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-[10px] bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--fg-1)] placeholder-[var(--fg-4)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>

        {/* บนมือถือให้ชิปเลื่อนแนวนอนแทนที่จะตกบรรทัดจนเต็มจอ */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto sm:flex-wrap sm:overflow-visible -mx-0.5 px-0.5 py-0.5">
          <FilterButton label="ทั้งหมด" count={chipCounts.cat.all} active={selectedCategory === 'all'} onClick={() => handleCategoryChange('all')} />
          {([
            ['วัตถุดิบ', 'raw', chipCounts.cat.raw],
            ['กึ่งสำเร็จรูป', 'wip', chipCounts.cat.wip],
            ['สำเร็จรูป', 'finished', chipCounts.cat.finished],
            ['บริการ', 'service', chipCounts.cat.service],
            ['วัสดุ/อื่นๆ', 'material', chipCounts.cat.material],
          ] as const).filter(([, key, n]) => n > 0 || selectedCategory === key).map(([label, key, n]) => (
            <FilterButton key={key} label={label} count={n} active={selectedCategory === key} onClick={() => handleCategoryChange(key)} />
          ))}

          <span className="w-px h-6 bg-[var(--border)] shrink-0 mx-0.5" />

          <FilterButton label="ทั้งหมด" count={chipCounts.st.all} active={selectedStatus === 'all'} onClick={() => handleStatusChange('all')} />
          {([
            ['หมด', 'out', chipCounts.st.out, 'danger'],
            ['วิกฤต', 'critical', chipCounts.st.critical, 'danger'],
            ['ต่ำ', 'low', chipCounts.st.low, 'warning'],
            ['ใกล้หมด', 'nearLow', chipCounts.st.nearLow, 'warning'],
            ['ยังไม่แกะ', 'sealed', chipCounts.st.sealed, 'neutral'],
            ['เกิน', 'overstock', chipCounts.st.overstock, 'neutral'],
          ] as const).filter(([, key, n]) => n > 0 || selectedStatus === key).map(([label, key, n, tone]) => (
            <FilterButton key={key} label={label} count={n} tone={tone} dot active={selectedStatus === key} onClick={() => handleStatusChange(key)} />
          ))}
        </div>

        {/* เลือกคอลัมน์: แต่ละร้านดูตัวเลขคนละชุด ไม่ต้องยัดทุกคอลัมน์ให้ทุกคน */}
        <div className="relative ml-auto shrink-0">
          <button
            onClick={() => setShowColumnPicker(v => !v)}
            aria-expanded={showColumnPicker}
            className={`flex items-center gap-1.5 h-9 px-3 rounded-[10px] border text-sm font-semibold transition-colors ${showColumnPicker ? 'bg-[var(--surface-2)] border-[var(--border-strong)] text-[var(--fg-1)]' : 'bg-[var(--bg)] border-[var(--border)] text-[var(--fg-2)] hover:border-[var(--primary)]'}`}
          >
            <Settings2 className="w-4 h-4" />
            <span className="hidden sm:inline">คอลัมน์</span>
            <span className="text-[11px] tabular-nums opacity-65">
              {Object.values(visibleCols).filter(Boolean).length}/{Object.keys(COLUMN_LABELS).length}
            </span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          {showColumnPicker && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowColumnPicker(false)} />
              <div role="menu" className="absolute top-11 right-0 z-40 w-[264px] rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-2 overflow-hidden">
                <p className="px-3.5 pt-3 pb-2 text-[11px] font-semibold text-[var(--fg-3)] border-b border-[var(--border)]">เลือกคอลัมน์ที่อยากเห็น</p>
                {(Object.keys(COLUMN_LABELS) as ColumnKey[]).map((key) => {
                  const always = ALWAYS_VISIBLE.includes(key)
                  const active = visibleCols[key]
                  return (
                    <button
                      key={key}
                      onClick={() => toggleCol(key)}
                      disabled={always}
                      role="menuitemcheckbox"
                      aria-checked={active}
                      className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left transition-colors ${always ? 'opacity-60 cursor-not-allowed' : 'hover:bg-[var(--bg)]'}`}
                    >
                      <span className={`w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center flex-shrink-0 ${active ? 'bg-[var(--primary)] border-[var(--primary)]' : 'bg-[var(--surface)] border-[var(--border-strong)]'}`}>
                        {active && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3.4} />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-medium text-[var(--fg-1)]">{COLUMN_LABELS[key]}</span>
                        {COLUMN_HINTS[key] && (
                          <span className="block text-[11px] leading-[15px] text-[var(--fg-4)]">{COLUMN_HINTS[key]}</span>
                        )}
                      </span>
                      {always && <Lock className="w-3 h-3 text-[var(--fg-4)] shrink-0" />}
                    </button>
                  )
                })}
                <p className="px-3.5 py-2.5 text-[11px] leading-4 text-[var(--fg-3)] border-t border-[var(--border)]">จำไว้ให้เป็นรายคน — เปิดครั้งหน้าได้ชุดเดิม</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ตาราง — ชุดคอลัมน์ตามแบบร่าง: รูป · สินค้า(+SKU ใต้ชื่อ) · ประเภท · คงเหลือ · ทุน/หน่วย · สถานะ · จัดการ
          บนมือถือคอลัมน์รองถูกซ่อน เหลือรูป/ชื่อ/คงเหลือ/จัดการ จะได้ไม่ต้องเลื่อนซ้ายขวา */}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-1 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="phopy-table stock-grid w-full">
            <thead>
              <tr className="bg-[var(--surface-2)]">
                {visibleCols.image && <th className="w-[52px]">รูป</th>}
                <SortTh label="สินค้า" colKey="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                {visibleCols.category && <SortTh label="ประเภท" colKey="category" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="hidden md:table-cell" />}
                <SortTh label="คงเหลือ" colKey="quantity" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" hint={t('stock.unpack.looseHint')} />
                {visibleCols.purchasePrice && <SortTh label="ทุน/หน่วย" colKey="purchasePrice" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" className="hidden md:table-cell" />}
                {visibleCols.value && <SortTh label="มูลค่ารวม" colKey="value" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" className="hidden lg:table-cell" />}
                {visibleCols.unitPrice && <SortTh label="ราคาขาย/หน่วย" colKey="unitPrice" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" className="hidden lg:table-cell" />}
                {visibleCols.location && <SortTh label="ที่เก็บ" colKey="location" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="hidden lg:table-cell" />}
                {visibleCols.status && <SortTh label="สถานะ" colKey="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="hidden sm:table-cell" />}
                <th className="text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-center py-10 text-[var(--fg-4)]">
                    ไม่พบสินค้าที่ค้นหา
                  </td>
                </tr>
              ) : (
                paginatedItems.map((item) => {
                  const status = getItemStatus(item)
                  const available = availableOf(item)
                  const baseUnit = unitLabel(item.baseUnit || item.unit)
                  const cost = item.purchasePrice ?? 0
                  const price = item.unitPrice ?? 0
                  // แถบระดับสต็อก: เทียบเพดานที่ตั้งไว้ · ไม่ได้ตั้งเพดานก็เทียบจุดสั่งซื้อ x2
                  // ไม่ได้ตั้งอะไรเลย = ไม่มีอะไรให้เทียบ ถือว่าของที่มีอยู่คือเต็ม
                  // (แถบว่างเปล่าทั้งคอลัมน์ดูเหมือนของหมดทั้งคลัง ทั้งที่แค่ยังไม่ได้ตั้งเพดาน)
                  const ceiling = item.maxStock > 0 ? item.maxStock : (item.minStock > 0 ? item.minStock * 2 : 0)
                  const pct = available <= 0 ? 0
                    : ceiling > 0 ? Math.max(4, Math.min(100, (available / ceiling) * 100))
                      : 100
                  const num = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 })
                  const barTitle = available <= 0
                    ? `ไม่มีของคงเหลือ`
                    : item.maxStock > 0
                      ? `${num(available)} / ${num(item.maxStock)} ${baseUnit} (${Math.round(pct)}%) · เทียบเพดานที่ตั้งไว้`
                      : item.minStock > 0
                        ? `${num(available)} / ${num(ceiling)} ${baseUnit} (${Math.round(pct)}%) · เทียบ 2 เท่าของจุดสั่งซื้อ ${num(item.minStock)} — ยังไม่ได้ตั้งเพดาน`
                        : `${num(available)} ${baseUnit} · ยังไม่ได้ตั้งเพดานสต็อก จึงถือว่าเต็ม`
                  return (
                    <tr key={item.id} className="hover:bg-[var(--bg)] transition-colors">
                      {visibleCols.image && (
                        <td className="w-[52px]">
                          {/* ไม่มีรูปก็กดเพิ่มตรงนี้ได้เลย เดิมต้องเข้าโมดัลแก้ไขก่อน
                              ซึ่งไม่มีใครทำ สินค้าเลยไม่มีรูปกันเกือบทั้งคลัง */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRowImage(item) }}
                            aria-label={item.imageUrl ? `ดูรูป ${item.name}` : `เพิ่มรูป ${item.name}`}
                            title={item.imageUrl ? item.name : `เพิ่มรูป ${item.name}`}
                            className={`w-10 h-10 rounded-[10px] overflow-hidden flex items-center justify-center transition-colors cursor-pointer ${item.imageUrl ? 'bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--primary)]' : 'border-[1.5px] border-dashed border-[var(--border-strong)] hover:border-[var(--primary)]'}`}
                          >
                            {item.imageUrl
                              ? <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                              : <Plus className="w-4 h-4 text-[var(--fg-4)]" />}
                          </button>
                        </td>
                      )}

                      <td className="min-w-0">
                        {/* คลิกชื่อ = เปิดรายละเอียด แทนไอคอนรูปตาที่เอาออกแล้ว
                            SKU ย้ายมาอยู่ใต้ชื่อ ประหยัดไปได้ทั้งคอลัมน์ */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleOpenDetail(item) }}
                          title={item.name}
                          className="block text-left text-sm font-semibold leading-6 text-[var(--primary)] hover:underline cursor-pointer truncate max-w-[52vw] sm:max-w-none sm:whitespace-normal"
                        >
                          {item.name}
                        </button>
                        <span className="block font-mono text-[11px] text-[var(--fg-4)]">{item.sku}</span>
                        {/* บนมือถือไม่มีคอลัมน์สถานะ เลยย้ายมาเกาะใต้ชื่อแทน */}
                        <span className="sm:hidden mt-1 inline-block"><StatusBadge status={status} /></span>
                      </td>

                      {visibleCols.category && (
                        <td className="hidden md:table-cell"><CategoryBadge category={item.category} /></td>
                      )}

                      <td className="text-right whitespace-nowrap">
                        <span className={`text-sm font-semibold tabular-nums ${available === 0 ? 'text-danger' : 'text-[var(--fg-1)]'}`} title={t('stock.unpack.looseHint')}>
                          {item.quantity.toLocaleString('th-TH')}
                        </span>
                        <span className="text-xs text-[var(--fg-3)]"> {baseUnit}</span>
                        {(item.sealedQty ?? 0) > 0 && (
                          <span className="block mt-0.5">
                            {item.canUnpack ? (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setUnpackModal({ open: true, item }) }}
                                className="text-[11px] text-[var(--warning-strong)] hover:underline inline-flex items-center gap-1"
                                title="แกะแพ็คเพื่อนำมาใช้"
                              >
                                <PackageOpen className="w-3 h-3 shrink-0" />
                                ยังไม่แกะ {item.sealedQty} {unitLabel(item.displayUnit || item.unit)}
                              </button>
                            ) : (
                              <span className="text-[11px] text-[var(--warning-strong)]" title="ยังตั้งหน่วยบรรจุไม่ครบ จึงแกะแพ็คไม่ได้">
                                ยังไม่แกะ {item.sealedQty} {unitLabel(item.displayUnit || item.unit)}
                              </span>
                            )}
                          </span>
                        )}
                      </td>

                      {visibleCols.purchasePrice && (
                        <td className="hidden md:table-cell text-right whitespace-nowrap">
                          <span className={`text-[13px] tabular-nums ${cost ? 'text-[var(--fg-1)]' : 'text-[var(--fg-4)]'}`}>
                            {cost ? `฿${Number(cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : '—'}
                          </span>
                          {cost > 0 && item.purchaseUnit && item.purchaseUnit !== (item.baseUnit || item.unit) && (
                            <span className="block text-[10px] text-[var(--fg-4)]">/{unitLabel(item.purchaseUnit)}</span>
                          )}
                        </td>
                      )}

                      {visibleCols.value && (
                        <td className="hidden lg:table-cell text-right whitespace-nowrap">
                          <span className={`text-[13px] tabular-nums ${cost ? 'text-[var(--fg-1)]' : 'text-[var(--fg-4)]'}`}>
                            {cost ? `฿${(available * cost).toLocaleString('th-TH', { maximumFractionDigits: 0 })}` : '—'}
                          </span>
                        </td>
                      )}

                      {visibleCols.unitPrice && (
                        <td className="hidden lg:table-cell text-right whitespace-nowrap">
                          <span className={`text-[13px] tabular-nums ${price ? 'text-[var(--success-strong)]' : 'text-[var(--fg-4)]'}`}>
                            {price ? `฿${Number(price).toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : '—'}
                          </span>
                        </td>
                      )}

                      {visibleCols.location && (
                        <td className="hidden lg:table-cell">
                          <span className="text-[13px] text-[var(--fg-3)]">{item.location || '—'}</span>
                        </td>
                      )}

                      {visibleCols.status && (
                        <td className="hidden sm:table-cell">
                          <div className="flex items-center gap-1.5" title={barTitle}>
                            {/* แถบสั้น ๆ ให้กวาดตาเห็นระดับของทั้งคอลัมน์ได้โดยไม่ต้องอ่านตัวเลขทีละแถว */}
                            <span className="inline-block w-[42px] h-[5px] rounded-full bg-[var(--surface-sunken)] overflow-hidden shrink-0">
                              <span className={`block h-full rounded-full ${STATUS_BAR[status]}`} style={{ width: `${pct}%` }} />
                            </span>
                            <StatusBadge status={status} />
                          </div>
                        </td>
                      )}

                      <td>
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            onClick={() => setAdjustModal({ open: true, item })}
                            className="w-9 h-9 flex items-center justify-center rounded-[9px] text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-[var(--bg)] transition-colors cursor-pointer"
                            aria-label={`ปรับสต็อก ${item.name}`}
                            title="ปรับสต็อก"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setEditModal({ open: true, item })}
                            className="w-9 h-9 flex items-center justify-center rounded-[9px] text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-[var(--bg)] transition-colors cursor-pointer"
                            aria-label={`แก้ไข ${item.name}`}
                            title="แก้ไขสินค้า"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                              setRowMenu(rowMenu?.item.id === item.id ? null : { item, x: r.right, y: r.bottom })
                            }}
                            className="w-9 h-9 flex items-center justify-center rounded-[9px] text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:bg-[var(--bg)] transition-colors cursor-pointer"
                            aria-label={`ตัวเลือกเพิ่มเติม ${item.name}`}
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-3 py-3 border-t border-[var(--border)]">
          <div className="flex items-center gap-3 flex-wrap justify-center">
            <span className="text-[var(--fg-3)] text-sm">
              แสดง <span className="text-[var(--primary)] font-semibold">{startIndex + 1}-{Math.min(endIndex, totalItems)}</span> จาก <span className="text-[var(--primary)] font-semibold">{totalItems}</span> รายการ
            </span>

            {/* Items Per Page Selector */}
            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value))
                setCurrentPage(1)
              }}
              className="phopy-input text-sm py-1 px-2"
            >
              <option value={20}>20 / หน้า</option>
              <option value={50}>50 / หน้า</option>
              <option value={100}>100 / หน้า</option>
            </select>
          </div>

          {/* Page Navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="hidden sm:block px-3 py-1 text-sm rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-2)] hover:border-[var(--primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              หน้าแรก
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-2)] hover:border-phopy-indigo disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              ก่อนหน้า
            </button>

            <span className="px-4 py-1 text-sm text-[var(--primary)] font-semibold bg-phopy-indigo/10 rounded border border-phopy-indigo/30">
              หน้า {currentPage} / {totalPages || 1}
            </span>

            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages || totalPages === 0}
              className="px-3 py-1 text-sm rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-2)] hover:border-phopy-indigo disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              ถัดไป
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages || totalPages === 0}
              className="hidden sm:block px-3 py-1 text-sm rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-2)] hover:border-[var(--primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              หน้าสุดท้าย
            </button>
          </div>
        </div>
      </div>

      {/* เมนู "…" ของแถว — วางเป็น fixed เพราะกล่องตารางมี overflow-x-auto ที่จะตัดเมนูทิ้ง */}
      {rowMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setRowMenu(null)} />
          <div
            role="menu"
            className="fixed z-50 w-52 rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-2 overflow-hidden"
            style={{ top: Math.min(rowMenu.y + 6, window.innerHeight - 190), left: Math.max(12, rowMenu.x - 208) }}
          >
            <button
              onClick={() => { const it = rowMenu.item; setRowMenu(null); handleOpenDetail(it) }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-[var(--fg-1)] hover:bg-[var(--bg)] transition-colors"
            >
              <Package className="w-4 h-4 text-[var(--fg-3)]" />
              ดูรายละเอียด
            </button>
            {rowMenu.item.canUnpack && (
              <button
                onClick={() => { const it = rowMenu.item; setRowMenu(null); setUnpackModal({ open: true, item: it }) }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-[var(--fg-1)] hover:bg-[var(--bg)] transition-colors"
              >
                <PackageOpen className="w-4 h-4 text-[var(--fg-3)]" />
                แกะแพ็ค
              </button>
            )}
            <button
              onClick={() => { const it = rowMenu.item; setRowMenu(null); handleDeleteItem(it) }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-danger hover:bg-[var(--danger-soft)] transition-colors border-t border-[var(--border)]"
            >
              <Trash2 className="w-4 h-4" />
              ลบสินค้า
            </button>
          </div>
        </>
      )}

      {/* Detail Modal */}
      <DetailModal
        open={detailModal.open}
        item={detailModal.item}
        onClose={() => setDetailModal({ open: false, item: null })}
        onUnpack={(it) => {
          setDetailModal({ open: false, item: null })
          setUnpackModal({ open: true, item: it })
        }}
        onAdjust={(it) => {
          setDetailModal({ open: false, item: null })
          setAdjustModal({ open: true, item: it })
        }}
        onEdit={(it) => {
          setDetailModal({ open: false, item: null })
          setEditModal({ open: true, item: it })
        }}
      />

      {/* Edit Modal */}
      <EditModal
        open={editModal.open}
        item={editModal.item}
        onClose={() => setEditModal({ open: false, item: null })}
        onSave={loadData}
      />

      {approvalGate.modal}

      {/* Adjust Modal */}
      <AdjustModal
        open={adjustModal.open}
        item={adjustModal.item}
        stockItems={stockItems}
        onClose={() => setAdjustModal({ open: false, item: null })}
        onSave={loadData}
        onPending={approvalGate.handleResponse}
      />

      {/* ทะเบียนการปรับสต็อก */}
      <AdjustLogModal open={adjLogModal} onClose={() => setAdjLogModal(false)} />

      {/* Add New Item Modal */}
      <AddStockModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSave={() => {
          setShowAddModal(false)
          loadData()
        }}
      />

      {/* Unpack Modal */}
      <UnpackModal
        open={unpackModal.open}
        item={unpackModal.item}
        onClose={() => setUnpackModal({ open: false, item: null })}
        onSaved={loadData}
        onPending={approvalGate.handleResponse}
      />
      {/* Import Modal */}
      <ImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        type="stock"
        onSuccess={loadData}
      />
    </motion.div>
  )
}

// Unpack Modal — release the contents of N sealed packs into loose stock.
// Shows the resulting split before committing, because "open 2 packs" means
// nothing to the user unless they can see it is 60 eggs.
function UnpackModal({ open, item, onClose, onSaved, onPending }: {
  open: boolean
  item: StockItem | null
  onClose: () => void
  onSaved: () => void
  onPending?: (data: any) => boolean
}) {
  useModalClose(onClose)
  const { t } = useTranslation()
  const [packs, setPacks] = useState(1)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) setPacks(1) }, [open, item?.id])
  if (!open || !item) return null
  const sealed = item.sealedQty ?? 0
  const factor = item.packFactor ?? 0
  const baseUnit = item.baseUnit || item.unit
  const displayUnit = item.displayUnit || item.unit
  const gained = packs * factor
  const valid = Number.isInteger(packs) && packs > 0 && packs <= sealed && factor > 0
  const submit = async () => {
    if (!valid || saving) return
    setSaving(true)
    try {
      const res: any = await stockService.unpack(item.id, packs)
      // ติดด่านอนุมัติ: ยังไม่มีอะไรเปลี่ยน แค่แจ้งผู้ใช้ว่าส่งคำขอแล้ว (เหมือน AdjustModal)
      if (onPending?.(res)) { onClose(); return }
      toast.success(`แกะ ${res.unpackedPacks} ${res.displayLabel} → ได้ ${res.unpackedPacks * res.packFactor} ${res.baseLabel}`)
      onSaved()
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'แกะแพ็คไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div
      className="fixed inset-0 bg-[var(--fg-1)]/50 flex items-center justify-center z-50 p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="phopy-card w-full max-w-md animate-scaleIn"
      >
        <div className="p-6 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PackageOpen className="w-5 h-5 text-[var(--primary)]" />
            <h2 className="text-lg font-bold text-[var(--fg-1)]">แกะแพ็ค</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg transition-colors">
            <X className="w-5 h-5 text-[var(--fg-3)]" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <p className="font-medium text-[var(--fg-1)]">{item.name}</p>
            <p className="text-xs text-[var(--fg-3)] font-mono">{item.sku}</p>
          </div>
          <div className="text-sm text-[var(--fg-3)]">
            1 {displayUnit} = <span className="text-[var(--fg-1)] font-semibold">{factor}</span> {baseUnit}
            <span className="mx-2 text-[var(--border)]">|</span>
            ยังไม่แกะ <span className="text-[var(--fg-1)] font-semibold">{sealed}</span> {displayUnit}
          </div>
          <div>
            <label className="block text-xs text-[var(--fg-3)] mb-1">จำนวนแพ็คที่จะแกะ</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPacks(p => Math.max(1, p - 1))}
                disabled={packs <= 1}
                className="w-9 h-9 rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--bg)] disabled:opacity-40 transition-colors"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                max={sealed}
                value={packs}
                onChange={(e) => setPacks(Math.floor(Number(e.target.value) || 0))}
                className="flex-1 px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-1)] text-center"
              />
              <button
                type="button"
                onClick={() => setPacks(p => Math.min(sealed, p + 1))}
                disabled={packs >= sealed}
                className="w-9 h-9 rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--bg)] disabled:opacity-40 transition-colors"
              >
                +
              </button>
            </div>
          </div>
          <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-3 space-y-1 text-sm">
            <p className="text-[var(--fg-2)]">
              แกะ {packs} {displayUnit} →{" "}
              <span className="text-[var(--primary)] font-semibold">ได้ {gained} {baseUnit}</span>
            </p>
            <p className="text-xs text-[var(--fg-3)]">
              คงเหลือในแพ็ค {sealed - packs} {displayUnit} · แกะแล้วรวม {item.quantity + gained} {baseUnit}
            </p>
            <p className="text-xs text-[var(--fg-4)]" title={t('stock.unpack.totalHint')}>
              {t('stock.unpack.totalUnchangedHint', { value: availableOf(item), unit: baseUnit })}
            </p>
          </div>
          {!valid && (
            <p className="text-xs text-[var(--danger)]">
              {factor <= 0
                ? 'ยังไม่ได้ตั้งอัตราแปลงหน่วยของสินค้านี้'
                : `จำนวนแพ็คต้องเป็นจำนวนเต็ม 1–${sealed}`}
            </p>
          )}
        </div>
        <div className="p-6 border-t border-[var(--border)] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[var(--fg-2)] hover:bg-[var(--bg)] transition-colors"
          >
            ยกเลิก
          </button>
          <button
            onClick={submit}
            disabled={!valid || saving}
            className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white font-medium hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            แกะแพ็ค
          </button>
        </div>
      </div>
    </div>
  )
}
// Detail Modal Component
function DetailModal({
  open,
  onUnpack,
  onAdjust,
  onEdit,
  item,
  onClose,
}: {
  open: boolean
  onUnpack?: (item: StockItem) => void
  onAdjust?: (item: StockItem) => void
  onEdit?: (item: StockItem) => void
  item: StockItem | null
  onClose: () => void
}) {
  useModalClose(onClose)
  const { t } = useTranslation()
  // ต้องประกาศเหนือ early return ด้านล่าง ไม่งั้นผิดกฎ hooks ของ React
  const [costBasis, setCostBasis] = useState<any>(null)
  const [logTab, setLogTab] = useState<'buy' | 'sell'>('buy')
  const [logRows, setLogRows] = useState<any[]>([])
  const [logLoading, setLogLoading] = useState(false)
  const [pics, setPics] = useState<string[]>([])
  // กฎ "เฉพาะสินค้านี้" เท่านั้น — ตัวเดียวกับที่ EditModal ใช้ ไม่ดึงกฎกลางมาปน
  const [convs, setConvs] = useState<Array<{ id: string; from_unit: string; to_unit: string; conversion_factor: number }>>([])
  const [showChain, setShowChain] = useState(false)
  // คำตอบจาก backend ว่าแต่ละช่วงของสายหน่วยแปลงได้จริงไหม · key = 'from>to'
  // source: 'item' = มีกฎเฉพาะสินค้านี้ · 'shared' = ได้ด้วยกฎรวมของเทแนนต์ · null = แปลงไม่ได้จริง
  // 3 สถานะ: ไม่มี key = ยังตรวจไม่เสร็จ · null = แปลงไม่ได้จริง · object = แปลงได้
  const [paths, setPaths] = useState<Record<string, { factor: number; source: 'item' | 'shared' } | null | undefined>>({})
  const { units: chainUnits } = useUnits(item?.id)

  // โหลดกฎใหม่หลังแก้ในผัง — ตัวเลขบนการ์ดต้องขยับตามทันที ไม่ใช่ต้องปิดเปิดหน้าต่างเอง
  const reloadConvs = async () => {
    if (!item) return
    try {
      const r = await api.get(`/materials/unit-conversions?materialId=${item.id}`)
      setConvs(r.data?.data ?? [])
    } catch { /* ผังยังโชว์ของเดิมได้ ไม่ต้องล้มทั้งหน้าต่าง */ }
  }
  useEffect(() => {
    if (!open || !item) return
    setPics(item.imageUrl ? [item.imageUrl] : [])
    api.get(`/stock/${item.id}/cost-basis`)
      .then(r => setCostBasis(r.data?.data ?? null))
      .catch(() => setCostBasis(null))
    api.get(`/materials/unit-conversions?materialId=${item.id}`)
      .then(r => setConvs(r.data?.data ?? []))
      .catch(() => setConvs([]))
  }, [open, item?.id])

  useEffect(() => {
    if (!open || !item) return
    const base = item.baseUnit || item.unit || ''
    const seq: string[] = []
    for (const u of [item.purchaseUnit || '', item.displayUnit || '', base]) {
      if (u && !seq.includes(u)) seq.push(u)
    }
    let cancelled = false
    Promise.all(seq.slice(0, -1).map((from, i) => {
      const to = seq[i + 1]
      return api.post('/materials/unit-conversions/check-path', { from_unit: from, to_unit: to, material_id: item.id })
        .then(r => {
          const d = r.data?.data
          if (!d?.found) return [from + '>' + to, null] as const
          // กฎของสินค้านี้เองไหม หรืออาศัยกฎรวม — ต่างกันตรงที่ลบ/แก้ได้จากผังหรือเปล่า
          const own = convs.some(c =>
            (c.from_unit === from && c.to_unit === to) || (c.from_unit === to && c.to_unit === from))
          return [from + '>' + to, { factor: d.factor, source: own ? 'item' : 'shared' }] as const
        })
        .catch(() => [from + '>' + to, null] as const)
    })).then(entries => { if (!cancelled) setPaths(Object.fromEntries(entries)) })
    return () => { cancelled = true }
  }, [open, item?.id, convs])
  useEffect(() => {
    if (!open || !item) return
    setLogLoading(true)
    api.get(`/stock/${item.id}/price-log`, { params: { side: logTab } })
      .then(r => setLogRows(r.data?.data?.rows ?? []))
      .catch(() => setLogRows([]))
      .finally(() => setLogLoading(false))
  }, [open, item?.id, logTab])
  if (!open || !item) return null

  return (
    <div
      className="fixed inset-0 bg-[var(--fg-1)]/50 flex items-center justify-center z-50 p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="phopy-card w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-scaleIn"
      >
        <div className="p-6 border-b border-[var(--border)] flex items-center justify-between">
          <div className="min-w-0">
            {/* เดิมหัวเขียนว่า "Stock Item Details" เหมือนกันทุกใบ ไม่บอกอะไรเลย */}
            <h2 className="text-xl font-bold text-[var(--fg-1)] truncate">{item.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs font-mono text-[var(--fg-4)]">{item.sku}</span>
              <CategoryBadge category={item.category} />
              <StatusBadge status={item.status} />
            </div>
          </div>

          {/* รูปสินค้าเก็บและดูได้จากหัวหน้าต่างเลย ไม่ต้องเข้าหน้าแก้ไข */}
          <div className="flex items-center gap-2 shrink-0">
            {pics.map((url, i) => (
              <span key={url} className="relative">
                <img src={url} alt={item.name}
                  className={`w-11 h-11 rounded-lg object-cover border ${i === 0 ? 'border-phopy-indigo' : 'border-[var(--border)]'}`} />
                {i === 0 && <span className="absolute -bottom-1.5 left-0 right-0 text-[9px] text-center text-[var(--primary)]">รูปหลัก</span>}
              </span>
            ))}
            <label className="w-11 h-11 rounded-lg border border-dashed border-[var(--border-strong)] flex items-center justify-center cursor-pointer hover:border-phopy-indigo transition-colors"
              title="เพิ่มรูปสินค้า">
              <Plus className="w-4 h-4 text-[var(--fg-4)]" />
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]; e.target.value = ''
                  if (!f) return
                  if (f.size > 10 * 1024 * 1024) { toast.error('ไฟล์ใหญ่เกิน 10 MB'); return }
                  try {
                    const res: any = await stockService.uploadImage(item.id, f)
                    const url = res?.imageUrl || res?.data?.imageUrl
                    if (url) setPics(p => [...p, url])
                    toast.success('เพิ่มรูปแล้ว')
                  } catch { toast.error('อัปโหลดรูปไม่สำเร็จ') }
                }} />
            </label>
            <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg transition-colors" aria-label="ปิด">
              <X className="w-5 h-5 text-[var(--fg-3)]" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* ตัวเลขที่ต้องรู้ก่อนอย่างอื่น — เดิมต้องไล่อ่านตารางฟิลด์เอาเอง */}
          {(() => {
            const avg = costBasis?.weightedAvg ?? 0
            const last = item.purchasePrice ?? 0
            const sell = item.unitPrice ?? 0
            const margin = sell > 0 && avg > 0 ? ((sell - avg) / sell) * 100 : null
            const low = item.minStock > 0 && item.quantity <= item.minStock
            const fmt = (n: number) => n >= 1 ? n.toLocaleString('th-TH', { maximumFractionDigits: 2 }) : n.toFixed(4)
            const cards = [
              { label: 'คงเหลือ', value: `${item.quantity.toLocaleString('th-TH')}`,
                sub: `${item.baseUnit || item.unit}${low ? ` · ต่ำกว่าจุดสั่ง ${item.minStock}` : ''}`,
                tone: low ? 'warn' : 'plain' },
              { label: 'ทุนล่าสุด', value: last ? `฿${fmt(last)}` : '—',
                sub: 'ราคาครั้งที่ซื้อล่าสุด', tone: 'plain' },
              { label: 'ทุนเฉลี่ย', value: avg ? `฿${fmt(avg)}` : '—',
                sub: costBasis?.basis === 'weighted'
                  ? `ถ่วงน้ำหนักจาก ${costBasis.sources.length} ครั้งที่ซื้อ`
                  : 'ยังไม่มีประวัติรับเข้า — ใช้ค่าสำรอง',
                tone: costBasis?.basis === 'fallback' ? 'warn' : 'plain' },
              { label: 'กำไร/หน่วย', value: margin === null ? '—' : `${sell - avg >= 0 ? '+' : ''}฿${fmt(sell - avg)}`,
                sub: margin === null ? 'ยังไม่ได้ตั้งราคาขาย' : `ขาย ฿${fmt(sell)} · ${margin.toFixed(1)}%`,
                tone: margin === null ? 'plain' : margin >= 0 ? 'good' : 'bad' },
            ]
            return (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {cards.map(c => (
                  <div key={c.label} className={`rounded-xl border px-3 py-2.5 ${
                    c.tone === 'warn' ? 'bg-[var(--warning-soft)] border-warning/35'
                      : c.tone === 'good' ? 'bg-[var(--success-soft)] border-success/30'
                        : c.tone === 'bad' ? 'bg-[var(--danger-soft)] border-danger/30'
                          : 'bg-[var(--bg)] border-[var(--border)]'}`}>
                    <p className="text-xs leading-4 text-[var(--fg-4)]">{c.label}</p>
                    <p className="text-lg font-bold text-[var(--fg-1)] leading-7 tabular-nums">{c.value}</p>
                    <p className="text-[11px] leading-4 text-[var(--fg-4)] mt-0.5">{c.sub}</p>
                  </div>
                ))}
              </div>
            )
          })()}
          {/* ประวัติราคา — เจ้าของขอไว้ว่าอยากเห็นทั้งฝั่งซื้อและฝั่งขายในที่เดียว */}
          <div>
            <div className="flex items-center gap-1 mb-2 bg-[var(--bg)] rounded-xl p-1 w-fit">
              {([['ราคาซื้อ', 'buy'], ['ราคาขาย', 'sell']] as const).map(([label, key]) => (
                <button key={key} onClick={() => setLogTab(key)}
                  className={`h-8 px-4 rounded-lg text-sm font-semibold transition-colors ${
                    logTab === key ? 'bg-[var(--surface)] text-[var(--fg-1)] shadow-sm' : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'}`}>
                  {label}
                </button>
              ))}
            </div>
            {logLoading ? (
              <div className="h-20 rounded-xl bg-[var(--bg)] animate-pulse" />
            ) : logRows.length === 0 ? (
              <p className="text-sm text-[var(--fg-4)] py-6 text-center border border-dashed border-[var(--border)] rounded-xl">
                {logTab === 'buy' ? 'ยังไม่เคยรับของชิ้นนี้เข้าคลังผ่านใบรับสินค้า' : 'ยังไม่เคยขายของชิ้นนี้'}
              </p>
            ) : (
              <div className="border border-[var(--border)] rounded-xl overflow-hidden">
                {logRows.map((r, i) => {
                  // %เปลี่ยนเทียบกับครั้งก่อนหน้า (แถวถัดลงไป เพราะเรียงใหม่->เก่า)
                  const prev = logRows[i + 1]
                  const diff = r.price != null && prev?.price ? ((r.price - prev.price) / prev.price) * 100 : null
                  return (
                    <div key={`${r.doc}-${i}`} className="grid grid-cols-[88px_1fr_96px_92px_64px] gap-2 items-center px-3 py-2 text-xs border-b border-[var(--border)]/50 last:border-b-0">
                      <span className="text-[var(--fg-3)]">{new Date(r.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
                      <span className="min-w-0">
                        <span className="block text-[var(--fg-2)] truncate">{r.party || (r.kind === 'pos' ? 'หน้าร้าน (POS)' : '-')}</span>
                        <span className="block font-mono text-[10px] text-[var(--fg-4)] truncate">{r.doc}</span>
                      </span>
                      <span className="text-right text-[var(--fg-2)] tabular-nums">{r.qty.toLocaleString('th-TH')} {r.unit || ''}</span>
                      <span className="text-right font-semibold text-[var(--fg-1)] tabular-nums">
                        {r.price == null ? <span className="text-[var(--fg-4)] font-normal">ราคาอยู่ที่เมนู</span> : `฿${r.price.toLocaleString('th-TH', { maximumFractionDigits: 4 })}`}
                      </span>
                      <span className={`text-right tabular-nums ${diff === null ? 'text-[var(--fg-4)]' : diff > 0 ? 'text-danger' : diff < 0 ? 'text-success' : 'text-[var(--fg-4)]'}`}>
                        {diff === null ? '—' : `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
            {logTab === 'sell' && (
              <p className="text-[11px] text-[var(--fg-4)] mt-1.5">
                ขายผ่านหน้าร้านเก็บราคาไว้ที่ระดับเมนู ไม่ใช่ระดับวัตถุดิบ แถวพวกนั้นจึงไม่มีราคาต่อหน่วยให้แสดง
              </p>
            )}
          </div>
          {/* ── ผังหน่วย ── สายหน่วยของสินค้าตัวนี้ตัวเดียว ไม่เกี่ยวกับสินค้าตัวอื่น */}
          {(() => {
            const base = item.baseUnit || item.unit || ''
            const pack = item.displayUnit || ''
            const buy = item.purchaseUnit || ''
            // เรียง ซื้อ → บรรจุ → นับ แล้วตัดตัวซ้ำออก หน่วยนับอยู่ท้ายเสมอ (เป็นปลายทางของการแปลง)
            const chain: Array<{ unit: string; role: string }> = []
            for (const [u, role] of [[buy, 'ซื้อ'], [pack, 'บรรจุ'], [base, 'นับ']] as const) {
              if (u && !chain.some(c => c.unit === u)) chain.push({ unit: u, role })
            }
            // ถาม backend แล้วว่าแปลงได้ไหม (รองรับหลายทอด + กฎรวมของเทแนนต์)
            // ห้ามเดาเองจาก convs เพราะ convs มีแค่กฎของสินค้านี้ จะฟันธงว่า "แปลงไม่ได้" ทั้งที่ได้
            const gaps = chain.slice(0, -1).map((c, i) => {
              const to = chain[i + 1].unit
              return { from: c.unit, to, path: paths[c.unit + '>' + to] }
            })
            const missing = gaps.filter(g => g.path === null)   // เฉพาะที่ตอบกลับมาแล้วว่าไม่มีจริง
            return (
              <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-[var(--fg-1)]">ผังหน่วย</p>
                  <button
                    type="button"
                    onClick={() => setShowChain(true)}
                    className="flex items-center gap-1.5 text-xs text-[var(--primary)] hover:underline"
                  >
                    <Network className="w-3.5 h-3.5" />
                    เปิดผังเต็มจอ
                  </button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {chain.length === 0 ? (
                    <p className="text-xs text-[var(--fg-4)]">ยังไม่ได้ตั้งหน่วยให้สินค้านี้</p>
                  ) : chain.map((c, i) => (
                    <span key={c.unit} className="flex items-center gap-2">
                      <span className={'px-3 py-1.5 rounded-lg border text-center ' + (c.role === 'นับ'
                        ? 'bg-[var(--primary)]/10 border-[var(--primary)]/40'
                        : 'bg-[var(--surface)] border-[var(--border)]')}>
                        <span className={'block text-sm font-semibold ' + (c.role === 'นับ' ? 'text-[var(--primary)]' : 'text-[var(--fg-1)]')}>
                          {unitLabel(c.unit)}
                        </span>
                        <span className="block text-[10px] text-[var(--fg-4)]">หน่วย{c.role}</span>
                      </span>
                      {i < chain.length - 1 && (
                        <span className="flex flex-col items-center">
                          <span className={'text-[10px] font-mono ' + (gaps[i].path === null ? 'text-danger' : 'text-[var(--fg-3)]')}>
                            {gaps[i].path === undefined
                              ? '…'
                              : gaps[i].path === null
                                ? 'ไม่มีสูตร'
                                : '×' + Number(gaps[i].path!.factor).toLocaleString('th-TH', { maximumFractionDigits: 4 })}
                          </span>
                          <ArrowRight className={'w-4 h-4 ' + (gaps[i].path === null ? 'text-danger' : 'text-[var(--fg-4)]')} />
                          {/* ได้จากกฎรวมของทั้งระบบ = ลบ/แก้จากผังของสินค้านี้ไม่ได้ ต้องรู้ก่อนจะไปหาปุ่มลบ */}
                          {gaps[i].path?.source === 'shared' && (
                            <span className="text-[9px] text-[var(--fg-4)] whitespace-nowrap">กฎรวม</span>
                          )}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-[var(--fg-4)] mt-2">
                  ตัวเลขสต็อกทั้งระบบนับเป็น{chain.length ? ' "' + unitLabel(chain[chain.length - 1].unit) + '"' : 'หน่วยนับ'} · หน่วยอื่นต้องแปลงกลับมาที่หน่วยนี้เสมอ
                </p>
                {missing.length > 0 && (
                  <p className="text-xs text-danger mt-1.5">
                    ขาดสูตรแปลง {missing.map(g => unitLabel(g.from) + ' → ' + unitLabel(g.to)).join(', ')}
                    {' '}— รับของหรือขายด้วยหน่วยนั้นจะตัดสต็อกผิดทันที
                  </p>
                )}
                {missing.length === 0 && gaps.some(g => g.path?.source === 'shared') && (
                  <p className="text-[11px] text-[var(--fg-4)] mt-1.5">
                    ช่วงที่เขียนว่า "กฎรวม" ใช้สูตรกลางของทั้งระบบ ไม่ใช่ของสินค้าตัวนี้ —
                    แปลงได้ปกติ ไม่ต้องเพิ่มซ้ำ · อยากให้สินค้านี้ใช้ตัวเลขต่างจากกฎกลาง ค่อยเพิ่มกฎเฉพาะทับ
                  </p>
                )}
              </div>
            )
          })()}

          {/* ── จุดเตือน ── รวมเกณฑ์ไว้ที่เดียว เดิมกระจายปนอยู่ในตารางข้อมูลทั่วไป */}
          <div className="mb-6 rounded-xl border border-[var(--border)] p-4">
            <p className="text-sm font-semibold text-[var(--fg-1)] mb-3">จุดเตือน</p>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-[var(--fg-4)] mb-0.5">จุดสั่งซื้อ</p>
                <p className={(item.quantity <= (item.minStock ?? 0) ? 'text-danger font-semibold' : 'text-[var(--fg-2)]')}>
                  {(item.minStock ?? 0).toLocaleString('th-TH')} {unitLabel(item.baseUnit || item.unit)}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--fg-4)] mb-0.5">เก็บสูงสุด</p>
                <p className="text-[var(--fg-2)]">{(item.maxStock ?? 0).toLocaleString('th-TH')} {unitLabel(item.baseUnit || item.unit)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--fg-4)] mb-0.5">ที่เก็บ</p>
                <p className="text-[var(--fg-2)] truncate">{item.location || '-'}</p>
              </div>
            </div>
          </div>

          {/* Item Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">ชื่อสินค้า</p>
              <p className="text-[var(--fg-2)] font-medium">{item.name}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">รหัสสินค้า</p>
              <p className="text-[var(--fg-2)] font-mono">{item.sku}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">ประเภท</p>
              <CategoryBadge category={item.category} />
            </div>
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1" title={t('stock.unpack.looseHint')}>ของที่หยิบใช้ได้ตอนนี้</p>
              <p className={`font-bold text-lg ${item.quantity === 0 ? 'text-danger' : 'text-[var(--primary)]'}`}>
                {item.quantity} {unitLabel(item.baseUnit || item.unit)}
                {item.quantity === 0 && (
                  <span className="ml-2 text-xs bg-[var(--danger-soft)] text-danger px-2 py-1 rounded">
                    ของหมด
                  </span>
                )}
              </p>
              {(item.sealedQty ?? 0) > 0 && (
                <div className="mt-1 space-y-1">
                  <p className="text-xs text-[var(--warning)]" title={t('stock.unpack.sealedHint')}>
                    ยังไม่แกะ {item.sealedQty} {unitLabel(item.displayUnit || item.unit)}
                    {item.packFactor ? ` × ${item.packFactor} ${unitLabel(item.baseUnit || item.unit)} = ${(item.sealedQty ?? 0) * item.packFactor} ${unitLabel(item.baseUnit || item.unit)}` : ''}
                  </p>
                  {item.packFactor ? (
                    <p className="text-xs text-[var(--fg-3)]" title={t('stock.unpack.totalHint')}>
                      รวมใช้ได้ {availableOf(item)} {unitLabel(item.baseUnit || item.unit)} = แกะแล้ว {item.quantity} + ในแพ็ค {(item.sealedQty ?? 0) * item.packFactor}
                    </p>
                  ) : (
                    <p className="text-xs text-[var(--danger)]">
                      ยังไม่ได้ตั้งอัตราแปลงหน่วย {unitLabel(item.displayUnit || item.unit)} → {unitLabel(item.baseUnit || item.unit)} ระบบจึงแกะแพ็คให้อัตโนมัติไม่ได้
                    </p>
                  )}
                  {item.canUnpack && onUnpack && (
                    <button
                      type="button"
                      onClick={() => onUnpack(item)}
                      className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-xs font-medium hover:opacity-90 transition-opacity"
                    >
                      <PackageOpen className="w-3.5 h-3.5" />
                      แกะแพ็ค
                    </button>
                  )}
                </div>
              )}
            </div>
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">หน่วยฐาน (Base)</p>
              <p className="text-[var(--fg-2)]">{unitLabel(item.baseUnit || item.unit)} {item.baseUnit && item.baseUnit !== item.unit ? `(หน่วยเดิม: ${unitLabel(item.unit)})` : ''}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">หน่วยบรรจุ (Packaging)</p>
              <p className="text-[var(--fg-2)]">{unitLabel(item.displayUnit || '-')}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">ต่ำกว่านี้ต้องสั่งเพิ่ม</p>
              <p className="text-[var(--fg-2)]">{item.minStock} {unitLabel(item.baseUnit || item.unit)}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">เก็บได้มากสุด</p>
              <p className="text-[var(--fg-2)]">{item.maxStock} {unitLabel(item.baseUnit || item.unit)}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">ราคาที่ซื้อมา</p>
              <p className="text-amber-400 font-semibold">
                {item.purchasePrice
                  ? `฿${Number(item.purchasePrice).toLocaleString()}/${unitLabel(item.purchaseUnit || item.baseUnit || item.unit || 'หน่วย')}`
                  : 'ไม่ระบุ'}
              </p>
            </div>
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">ราคาขาย/หน่วยฐาน ({unitLabel(item.baseUnit || item.unit)})</p>
              <p className="text-success font-semibold">
                {item.unitPrice
                  ? `฿${Number(item.unitPrice).toLocaleString()}/${unitLabel(item.baseUnit || item.unit || 'หน่วย')}`
                  : 'ไม่ระบุ'}
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-sm text-[var(--fg-3)] mb-1">สถานที่เก็บ</p>
              <div className="flex items-center gap-2 text-[var(--fg-2)]">
                <MapPin className="w-4 h-4 text-[var(--primary)]" />
                {item.location || 'Not specified'}
              </div>
            </div>
          </div>

          {/* Related Material/Product */}
          {item.material && (
            <div className="p-4 bg-[var(--surface-2)] rounded-lg">
              <p className="text-sm text-[var(--fg-3)] mb-2">วัตถุดิบที่เกี่ยวข้อง</p>
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-[var(--fg-2)] font-medium">{item.material.name}</p>
                  <p className="text-[var(--fg-3)] text-sm">{item.material.code}</p>
                </div>
                <p className="text-success font-semibold">
                  ฿{Number(item.material.unitCost).toLocaleString()}/unit
                </p>
              </div>
            </div>
          )}

          {/* Movement History */}
          <div>
            <h3 className="text-lg font-semibold text-[var(--fg-2)] mb-3 flex items-center gap-2">
              <History className="w-5 h-5 text-[var(--primary)]" />
              ประวัติการเคลื่อนไหว
            </h3>
            {item.movements && item.movements.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {item.movements.map((movement) => (
                  <div
                    key={movement.id}
                    className="flex items-center justify-between p-3 bg-[var(--surface-2)] rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      {movement.type === 'IN' ? (
                        <ArrowUpCircle className="w-5 h-5 text-success flex-shrink-0" />
                      ) : movement.type === 'OUT' ? (
                        <ArrowDownCircle className="w-5 h-5 text-danger flex-shrink-0" />
                      ) : movement.type === 'PRICE_CHANGE' ? (
                        <DollarSign className="w-5 h-5 text-warning flex-shrink-0" />
                      ) : (
                        <Package className="w-5 h-5 text-blue-400 flex-shrink-0" />
                      )}
                      <div>
                        <p className={`font-medium ${
                          movement.type === 'IN' ? 'text-success' :
                          movement.type === 'OUT' ? 'text-danger' :
                          movement.type === 'PRICE_CHANGE' ? 'text-warning' : 'text-blue-400'
                        }`}>
                          {movement.type === 'IN' ? `+${movement.quantity} ${unitLabel(movement.movementUnit || item.baseUnit || item.unit)}` :
                           movement.type === 'OUT' ? `-${movement.quantity} ${unitLabel(movement.movementUnit || item.baseUnit || item.unit)}` :
                           movement.type === 'PRICE_CHANGE' ? 'เปลี่ยนราคา' :
                           `${movement.quantity} ${unitLabel(movement.movementUnit || item.baseUnit || item.unit)}`}
                          {movement.movementQuantity !== undefined && movement.movementQuantity !== movement.quantity && movement.movementUnit && (
                            <span className="text-xs text-[var(--fg-4)] ml-1">(นับ {movement.movementQuantity} {unitLabel(movement.movementUnit)})</span>
                          )}
                        </p>
                        {movement.notes && (
                          <p className="text-[var(--fg-3)] text-xs mt-0.5">{movement.notes}</p>
                        )}
                        {movement.reference && (
                          <p className="text-[var(--fg-4)] text-xs font-mono">{movement.reference}</p>
                        )}
                      </div>
                    </div>
                    <div className="text-right text-xs text-[var(--fg-3)] flex-shrink-0">
                      <p className="flex items-center gap-1 justify-end">
                        <Clock className="w-3 h-3" />
                        {new Date(movement.createdAt).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </p>
                      <p className="text-[var(--fg-4)]">{new Date(movement.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[var(--fg-4)] text-sm text-center py-4">ไม่มีประวัติการเคลื่อนไหว</p>
            )}
          </div>
        </div>

        {/* ── แถบปุ่มท้ายหน้าต่าง ── เดิมดูได้อย่างเดียว ต้องปิดแล้วไปหาแถวเดิมในตารางถึงจะแก้ได้ */}
        <div className="px-6 py-3 border-t border-[var(--border)] flex items-center gap-3 flex-wrap">
          <p className="text-[11px] text-[var(--fg-4)] flex-1 min-w-[180px]">
            ราคาทั้งหมดมาจากเอกสารจริง ไม่ได้กรอกมือ
          </p>
          <button
            type="button"
            onClick={() => onAdjust?.(item)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--fg-2)] hover:border-[var(--primary)] transition-colors"
          >
            <SlidersHorizontal className="w-4 h-4" />
            ปรับสต็อก
          </button>
          <button
            type="button"
            onClick={() => onEdit?.(item)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:bg-[var(--primary)]/90 transition-colors"
          >
            <Edit2 className="w-4 h-4" />
            แก้ไขสินค้า
          </button>
        </div>
      </div>

      {/* ผังเต็มจอ — ใช้ตัวเดิมที่มีอยู่แล้ว ไม่สร้าง UI แก้ไขชุดที่สอง */}
      {showChain && (
        <UnitChainEditor
          conversions={convs}
          availableUnits={chainUnits}
          onAdd={async (from, to, factor) => {
            await api.post('/materials/unit-conversions', {
              material_id: item.id, from_unit: from, to_unit: to, conversion_factor: factor,
            })
            await reloadConvs()
            invalidateUnitsCache()
          }}
          onDelete={async (convId) => {
            await api.delete(`/materials/unit-conversions/${convId}`)
            await reloadConvs()
            invalidateUnitsCache()
          }}
          onClose={() => setShowChain(false)}
          baseUnit={item.baseUnit || item.unit || ''}
          displayUnit={item.displayUnit || ''}
        />
      )}
    </div>
  )
}

// Edit Modal Component
export function EditModal({
  open,
  item,
  onClose,
  onSave,
  initialTab = 'general',
  initialConvForm,
}: {
  open: boolean
  item: StockItem | null
  onClose: () => void
  onSave: () => void
  initialTab?: 'general' | 'units'
  initialConvForm?: { from_unit: string; to_unit: string }
}) {
  useModalClose(onClose)
  const [formData, setFormData] = useState({
    name: '',
    gs1Barcode: '',
    category: '',
    unit: 'pcs',
    baseUnit: '',
    displayUnit: '',
    minStock: 0,
    maxStock: 0,
    location: '',
    isPosEnabled: false,
    purchasePrice: 0,
    purchaseUnit: '',
    unitPrice: 0,
  })
  const [saving, setSaving] = useState(false)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)

  // Load units from API (global + per-material conversions)
  const { units: availableUnits } = useUnits(item?.id)

  // Per-material unit conversions
  const [showChainEditor, setShowChainEditor] = useState(false)
  const [convExpanded, setConvExpanded] = useState(false)
  const [itemConversions, setItemConversions] = useState<Array<{ id: string; from_unit: string; to_unit: string; conversion_factor: number; notes?: string }>>([])
  const [standardConversions, setStandardConversions] = useState<Array<{ from_unit: string; to_unit: string; factor: number }>>([])
  const [convForm, setConvForm] = useState({ from_unit: '', to_unit: '', conversion_factor: '' })
  const [convSaving, setConvSaving] = useState(false)
  const [conversionWarning, setConversionWarning] = useState<string | null>(null)

  const ul = (u: string) => UNIT_LABELS_MAP[u] ?? u

  const fetchItemConversions = async (itemId: string) => {
    try {
      const res = await api.get(`/materials/unit-conversions?materialId=${itemId}`)
      setItemConversions(res.data.data ?? [])
    } catch { /* silent */ }
  }

  const fetchStandardConversions = async () => {
    try {
      const res = await api.get('/materials/unit-conversions/standards')
      setStandardConversions(res.data.data ?? [])
    } catch { /* silent */ }
  }

  const handleAddConversion = async () => {
    if (!item || !convForm.from_unit || !convForm.to_unit || !convForm.conversion_factor) return
    if (convForm.from_unit === convForm.to_unit) { toast.error('หน่วยต้นทางและปลายทางต้องไม่เหมือนกัน'); return }
    if (Number(convForm.conversion_factor) <= 0) { toast.error('ค่าแปลงต้องมากกว่า 0'); return }
    setConvSaving(true)
    try {
      await api.post('/materials/unit-conversions', {
        material_id: item.id,
        from_unit: convForm.from_unit.trim().toLowerCase(),
        to_unit: convForm.to_unit.trim().toLowerCase(),
        conversion_factor: Number(convForm.conversion_factor),
      })
      setConvForm({ from_unit: '', to_unit: '', conversion_factor: '' })
      fetchItemConversions(item.id)
      invalidateUnitsCache()
      toast.success('เพิ่มการแปลงหน่วยแล้ว')
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'เกิดข้อผิดพลาด')
    } finally {
      setConvSaving(false)
    }
  }

  const handleDeleteConversion = async (convId: string) => {
    try {
      await api.delete(`/materials/unit-conversions/${convId}`)
      setItemConversions(prev => prev.filter(c => c.id !== convId))
      invalidateUnitsCache()
      toast.success('ลบแล้ว')
    } catch { toast.error('ลบไม่สำเร็จ') }
  }

  useEffect(() => {
    if (item) {
      setFormData({
        name: item.name || '',
        gs1Barcode: item.gs1Barcode || '',
        category: item.category || '',
        unit: item.unit || 'pcs',
        baseUnit: item.baseUnit || '',
        displayUnit: item.displayUnit || '',
        minStock: item.minStock ?? 0,
        maxStock: item.maxStock ?? 0,
        location: item.location || '',
        isPosEnabled: !!item.isPosEnabled,
        purchasePrice: item.purchasePrice ?? 0,
        purchaseUnit: item.purchaseUnit || item.displayUnit || item.baseUnit || item.unit || '',
        unitPrice: item.unitPrice ?? 0,
      })
      setImagePreview(item.imageUrl || null)
      setImageFile(null)
      setConvForm(initialConvForm
        ? { from_unit: initialConvForm.from_unit, to_unit: initialConvForm.to_unit, conversion_factor: '' }
        : { from_unit: '', to_unit: '', conversion_factor: '' }
      )
      setShowChainEditor(false)
      setConvExpanded(initialTab === 'units')
      setItemConversions([])
      setStandardConversions([])
      setConversionWarning(null)
      fetchItemConversions(item.id)
      fetchStandardConversions()
    }
  }, [item])

  // Check if a conversion PATH exists (BFS, supports chain) when baseUnit ≠ displayUnit
  useEffect(() => {
    if (!item || !formData.baseUnit || !formData.displayUnit) {
      setConversionWarning(null)
      return
    }
    if (formData.baseUnit === formData.displayUnit) {
      setConversionWarning(null)
      return
    }
    // Build undirected adjacency graph from all known conversions
    const adj: Record<string, Set<string>> = {}
    const addEdge = (a: string, b: string) => {
      const na = normalizeUnit(a); const nb = normalizeUnit(b)
      if (!adj[na]) adj[na] = new Set()
      if (!adj[nb]) adj[nb] = new Set()
      adj[na].add(nb)
      adj[nb].add(na)
    }
    itemConversions.forEach(c => addEdge(c.from_unit, c.to_unit))
    standardConversions.forEach(c => addEdge(c.from_unit, c.to_unit))

    // BFS from displayUnit → check if baseUnit is reachable (normalize to handle Thai names)
    const from = normalizeUnit(formData.displayUnit)
    const to = normalizeUnit(formData.baseUnit)
    const visited = new Set<string>([from])
    const queue = [from]
    let found = false
    while (queue.length > 0) {
      const cur = queue.shift()!
      if (cur === to) { found = true; break }
      for (const next of (adj[cur] ?? [])) {
        if (!visited.has(next)) { visited.add(next); queue.push(next) }
      }
    }

    if (!found) {
      setConversionWarning(`ยังไม่มีสูตรแปลง "${ul(from)}" เป็น "${ul(to)}" — ระบบจะคิดสต๊อกของสินค้านี้ไม่ได้`)
    } else {
      setConversionWarning(null)
    }
  }, [formData.baseUnit, formData.displayUnit, itemConversions, standardConversions])

  // เปลี่ยน "หน่วยที่คลังนับ" แล้วหน่วยซื้อ/หน่วยบรรจุที่เคยเป็นตัวเดียวกันต้องขยับตามทันที
  // ไม่งั้น ชิ้น→ขีด จะเหลือหน่วยซื้อค้างเป็น "ชิ้น" = สายขาดสูตรแปลง แล้ว backend ตีกลับ
  // 400 UNIT_CONVERSION_MISSING ตอนกดบันทึก ทั้งที่บนจอดูเหมือนเปลี่ยนครบแล้ว
  const changeBaseUnit = (next: string) => {
    setFormData(prev => {
      const prevBase = normalizeUnit(prev.baseUnit || prev.unit)
      const out = { ...prev, baseUnit: next }
      if (prev.purchaseUnit && normalizeUnit(prev.purchaseUnit) === prevBase) out.purchaseUnit = next
      if (prev.displayUnit && normalizeUnit(prev.displayUnit) === prevBase) out.displayUnit = next
      return out
    })
  }
  const changeDisplayUnit = (next: string) => {
    setFormData(prev => {
      const prevPack = prev.displayUnit ? normalizeUnit(prev.displayUnit) : ''
      const out = { ...prev, displayUnit: next }
      if (prevPack && prev.purchaseUnit && normalizeUnit(prev.purchaseUnit) === prevPack) out.purchaseUnit = next
      return out
    })
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!item) return

    setSaving(true)
    try {
      await stockService.update(item.id, formData)
      // Upload image if selected
      if (imageFile) {
        setUploadingImage(true)
        await stockService.uploadImage(item.id, imageFile)
        setUploadingImage(false)
      }
      onSave()
      onClose()
    } catch (err) {
      console.error('Failed to update stock item:', err)
      toast.error((err as any)?.response?.data?.message || 'บันทึกไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setSaving(false)
    }
  }

  if (!open || !item) return null

  // ── สายหน่วย: ลากตามกฎแปลงจริง ชุดเดียวกับผังเต็มจอ ──
  // เดิมโชว์แค่หน่วยที่ตั้งไว้ 3 ช่อง คนเลยเห็น "ลัง → กรัม" ทั้งที่ผังเต็มจอมี "กิโลกรัม" คั่นอยู่
  // และไม่มีตัวคูณให้ดูเลย — สองจอบอกคนละเรื่องทั้งที่เป็นข้อมูลชุดเดียวกัน
  const uGraph: Record<string, Array<{ to: string; factor: number; shared: boolean }>> = {}
  const addUnitEdge = (a: string, b: string, f: number, shared: boolean) => {
    if (!a || !b || !f || f <= 0 || !isFinite(f)) return
    const na = normalizeUnit(a); const nb = normalizeUnit(b)
    if (na === nb) return
    if (!uGraph[na]) uGraph[na] = []
    if (!uGraph[nb]) uGraph[nb] = []
    uGraph[na].push({ to: nb, factor: f, shared })
    uGraph[nb].push({ to: na, factor: 1 / f, shared })
  }
  itemConversions.forEach(c => addUnitEdge(c.from_unit, c.to_unit, Number(c.conversion_factor), false))
  standardConversions.forEach(c => addUnitEdge(c.from_unit, c.to_unit, Number(c.factor), true))

  // เส้นทางน้อยทอดที่สุดจาก a ไป b พร้อมตัวคูณรายช่วง · null = แปลงไม่ได้จริง
  const pathBetween = (from: string, to: string): Array<{ unit: string; factor: number; shared: boolean }> | null => {
    const a = normalizeUnit(from); const b = normalizeUnit(to)
    if (!a || !b) return null
    if (a === b) return []
    const prev: Record<string, { unit: string; factor: number; shared: boolean }> = {}
    const seen = new Set<string>([a])
    const queue = [a]
    while (queue.length > 0) {
      const cur = queue.shift()!
      if (cur === b) break
      for (const e of uGraph[cur] ?? []) {
        if (seen.has(e.to)) continue
        seen.add(e.to)
        prev[e.to] = { unit: cur, factor: e.factor, shared: e.shared }
        queue.push(e.to)
      }
    }
    if (!seen.has(b)) return null
    const out: Array<{ unit: string; factor: number; shared: boolean }> = []
    let cur = b
    while (cur !== a) {
      const step = prev[cur]
      out.unshift({ unit: cur, factor: step.factor, shared: step.shared })
      cur = step.unit
    }
    return out
  }

  // หน่วยเดียวอาจสวมหลายบทบาท (ซื้อเป็นลัง เก็บเป็นลัง) — ต้องเขียนรวมไว้ที่โหนดเดียว
  const roleOf: Record<string, string[]> = {}
  const anchors: string[] = []
  for (const [u, role] of [
    [formData.purchaseUnit, 'หน่วยซื้อ'],
    [formData.displayUnit, 'หน่วยบรรจุ'],
    [formData.baseUnit || formData.unit, 'หน่วยนับ'],
  ] as const) {
    if (!u) continue
    const k = normalizeUnit(u)
    if (!roleOf[k]) roleOf[k] = []
    if (!roleOf[k].includes(role)) roleOf[k].push(role)
    if (!anchors.some(a => normalizeUnit(a) === k)) anchors.push(u)
  }

  const chain: Array<{ unit: string; roles: string[]; factor: number | null; missing: boolean; shared: boolean }> = []
  if (anchors.length > 0) {
    chain.push({ unit: normalizeUnit(anchors[0]), roles: roleOf[normalizeUnit(anchors[0])] ?? [], factor: null, missing: false, shared: false })
    for (let i = 0; i < anchors.length - 1; i++) {
      const seg = pathBetween(anchors[i], anchors[i + 1])
      const nextKey = normalizeUnit(anchors[i + 1])
      if (seg === null) {
        chain.push({ unit: nextKey, roles: roleOf[nextKey] ?? [], factor: null, missing: true, shared: false })
      } else {
        for (const st of seg) {
          chain.push({ unit: st.unit, roles: roleOf[st.unit] ?? [], factor: st.factor, missing: false, shared: st.shared })
        }
      }
    }
  }
  const fmtFactor = (f: number) => '×' + Number(f.toFixed(6)).toLocaleString('th-TH', { maximumFractionDigits: 6 })
  // ช่วงที่ขาดสูตรจริง ๆ ในสาย — ตัวนี้แหละที่ทำให้ backend ตีกลับตอนบันทึกราคา
  const gapIdx = chain.findIndex(c => c.missing)
  const chainGapMsg = gapIdx > 0
    ? `ยังไม่มีสูตรแปลง "${ul(chain[gapIdx - 1].unit)}" → "${ul(chain[gapIdx].unit)}" — บันทึกราคาที่ซื้อมาไม่ได้จนกว่าจะเพิ่มสูตรด้านล่าง`
    : null

  const cost = Number(formData.purchasePrice) || 0
  const sell = Number(formData.unitPrice) || 0
  const available = availableOf(item)
  const baseLabel = unitLabel(formData.baseUnit || formData.unit)
  const money = (n: number) => '฿' + n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  // การ์ดสรุปแบบเดียวกับหน้ารายละเอียด แต่คิดจากค่าที่กำลังพิมพ์อยู่ จะได้เห็นผลก่อนกดบันทึก
  const kpis = [
    { label: 'คงเหลือ', value: available.toLocaleString('th-TH'), sub: baseLabel, tone: available === 0 ? 'bad' : available <= formData.minStock ? 'warn' : 'plain' },
    { label: 'ทุน/หน่วย', value: cost ? money(cost) : '—', sub: formData.purchaseUnit ? 'ต่อ ' + unitLabel(formData.purchaseUnit) : 'ยังไม่ได้ตั้งหน่วยซื้อ', tone: 'plain' },
    { label: 'ราคาขาย', value: sell ? money(sell) : '—', sub: 'ต่อ ' + baseLabel, tone: 'plain' },
    {
      label: 'กำไร/หน่วย',
      value: sell && cost ? (sell - cost >= 0 ? '+' : '') + money(sell - cost) : '—',
      sub: sell && cost ? ((sell - cost) / sell * 100).toFixed(1) + '%' : 'ยังตั้งราคาไม่ครบ',
      tone: !sell || !cost ? 'plain' : sell - cost >= 0 ? 'good' : 'bad',
    },
  ]

  return (
    <>
      <div
        className="fixed inset-0 bg-[var(--fg-1)]/60 flex items-center justify-center z-50 p-3 sm:p-4 animate-fadeIn"
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-[640px] flex flex-col rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-2 overflow-hidden animate-scaleIn"
          style={{ maxHeight: 'calc(100vh - 1.5rem)' }}
        >
          {/* หัวหน้าต่างชุดเดียวกับหน้ารายละเอียด — เปิดจากปุ่มดินสอแล้วต้องไม่รู้สึกว่าไปโผล่คนละแอป */}
          <div className="flex items-start justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-[var(--border)] flex-shrink-0">
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold text-[var(--fg-1)] truncate">{formData.name || item.name}</h2>
              <div className="flex items-center gap-2 flex-wrap mt-1">
                <span className="text-xs font-mono text-[var(--fg-3)]">{item.sku}</span>
                <CategoryBadge category={formData.category || item.category} />
                <StatusBadge status={item.status} />
              </div>
            </div>

            {/* รูปสินค้าจัดการได้จากหัวหน้าต่างเลย ไม่ต้องหาช่องอัปโหลดในฟอร์ม */}
            <div className="flex items-center gap-1.5 shrink-0">
              {imagePreview ? (
                <span className="relative">
                  <img src={imagePreview} alt={item.name} className="w-11 h-11 rounded-[10px] object-cover border border-[var(--primary)]" />
                  <span className="absolute bottom-0.5 inset-x-0.5 rounded bg-[var(--fg-1)]/70 text-white text-[8px] font-semibold text-center">รูปหลัก</span>
                  <button
                    type="button"
                    aria-label="ลบรูปนี้"
                    onClick={async () => {
                      if (!confirm('ลบรูปภาพ?')) return
                      try {
                        if (item.imageUrl) await stockService.deleteImage(item.id)
                        setImagePreview(null)
                        setImageFile(null)
                        onSave()
                      } catch { toast.error('ลบรูปไม่สำเร็จ') }
                    }}
                    className="absolute top-0.5 right-0.5 w-[17px] h-[17px] flex items-center justify-center rounded-[5px] bg-[var(--fg-1)]/70 text-white"
                  >
                    <X className="w-2.5 h-2.5" strokeWidth={3} />
                  </button>
                </span>
              ) : (
                <label
                  className="w-11 h-11 rounded-[10px] border-[1.5px] border-dashed border-[var(--border-strong)] hover:border-[var(--primary)] flex items-center justify-center cursor-pointer transition-colors"
                  title="เพิ่มรูปสินค้า"
                >
                  <ImagePlus className="w-4 h-4 text-[var(--fg-3)]" />
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageChange} className="hidden" />
                </label>
              )}
              <span className="w-px h-7 bg-[var(--border)] mx-0.5" />
              <button type="button" onClick={onClose} aria-label="ปิด" className="w-10 h-10 flex items-center justify-center rounded-[10px] hover:bg-[var(--bg)] transition-colors">
                <X className="w-5 h-5 text-[var(--fg-3)]" />
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-3.5">

              {/* ตัวเลขสรุป — ขยับตามที่พิมพ์ทันที */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                {kpis.map(k => (
                  <div key={k.label} className={`rounded-xl border px-3 py-2.5 ${
                    k.tone === 'warn' ? 'bg-[var(--warning-soft)] border-warning/35'
                      : k.tone === 'good' ? 'bg-[var(--success-soft)] border-success/30'
                        : k.tone === 'bad' ? 'bg-[var(--danger-soft)] border-danger/30'
                          : 'bg-[var(--bg)] border-[var(--border)]'}`}>
                    <p className="text-[11px] leading-4 text-[var(--fg-3)]">{k.label}</p>
                    <p className="text-base sm:text-[17px] font-bold text-[var(--fg-1)] leading-7 tabular-nums">{k.value}</p>
                    <p className="text-[10px] leading-4 text-[var(--fg-4)] mt-0.5 truncate">{k.sub}</p>
                  </div>
                ))}
              </div>

              {/* ── ข้อมูลสินค้า ── */}
              <div className="rounded-2xl border border-[var(--border)] p-3.5 space-y-3">
                <p className="text-xs font-semibold text-[var(--fg-2)]">ข้อมูลสินค้า</p>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1.5">ชื่อสินค้า <span className="text-danger">*</span></label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="phopy-input w-full"
                    required
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1.5">ประเภท</label>
                    <select
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      className="phopy-input w-full"
                      required
                    >
                      <option value="raw">วัตถุดิบ</option>
                      <option value="wip">กึ่งสำเร็จรูป</option>
                      <option value="finished">สำเร็จรูป</option>
                      <option value="material">วัสดุสิ้นเปลือง</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1.5">บาร์โค้ด GS1 <span className="text-[var(--fg-4)]">ไม่บังคับ</span></label>
                    <input
                      type="text"
                      value={formData.gs1Barcode}
                      onChange={(e) => setFormData({ ...formData, gs1Barcode: e.target.value })}
                      className="phopy-input w-full"
                      placeholder="—"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-3 p-2.5 bg-[var(--bg)] rounded-xl border border-[var(--border)] cursor-pointer hover:border-[var(--primary)]/50 transition-colors">
                  <input
                    type="checkbox"
                    id="isPosEnabled"
                    checked={formData.isPosEnabled}
                    onChange={(e) => setFormData({ ...formData, isPosEnabled: e.target.checked })}
                    className="w-5 h-5 rounded border-[var(--border)] bg-[var(--surface)] text-[var(--primary)]"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-[var(--fg-1)]">แสดงในหน้าขาย (POS)</span>
                    <span className="block text-[11px] text-[var(--fg-4)]">เพิ่มสินค้านี้เข้าเมนูขาย</span>
                  </span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${formData.isPosEnabled ? 'bg-[var(--success-soft)] text-[var(--success-strong)]' : 'bg-[var(--surface-2)] text-[var(--fg-3)]'}`}>
                    {formData.isPosEnabled ? 'เปิด' : 'ปิด'}
                  </span>
                </label>
              </div>

              {/* ── ราคา ── */}
              <div className="rounded-2xl border border-[var(--border)] p-3.5 space-y-3">
                <p className="text-xs font-semibold text-[var(--fg-2)]">ราคา</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1.5">ราคาที่ซื้อมา (฿)</label>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        value={formData.purchasePrice}
                        onChange={(e) => setFormData({ ...formData, purchasePrice: parseFloat(e.target.value) || 0 })}
                        onFocus={(e) => e.target.select()}
                        className="phopy-input flex-1 min-w-0"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                      />
                      <div className="w-24 shrink-0">
                        <UnitPicker
                          value={formData.purchaseUnit}
                          onChange={(unit) => setFormData({ ...formData, purchaseUnit: unit })}
                          materialId={item?.id}
                          baseUnit={formData.baseUnit || formData.unit}
                          restrict="warn"
                          size="sm"
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1.5">
                      ราคาขาย (฿) <span className="text-[var(--fg-4)]">ต่อ {baseLabel}</span>
                    </label>
                    <input
                      type="number"
                      value={formData.unitPrice}
                      onChange={(e) => setFormData({ ...formData, unitPrice: parseFloat(e.target.value) || 0 })}
                      onFocus={(e) => e.target.select()}
                      className="phopy-input w-full"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>

              {/* ── ผังหน่วย ── อ่านง่ายก่อน แก้ได้ในที่เดียวกัน */}
              <div className="rounded-2xl border border-[var(--border)] p-3.5">
                <div className="flex items-center justify-between gap-3 mb-2.5">
                  <p className="text-xs font-semibold text-[var(--fg-2)]">ผังหน่วย <span className="font-normal text-[var(--fg-4)]">สายหน่วยของสินค้านี้</span></p>
                  <button
                    type="button"
                    onClick={() => setConvExpanded(v => !v)}
                    className={`h-8 px-2.5 flex items-center gap-1.5 rounded-[9px] border text-xs font-semibold transition-colors ${convExpanded ? 'bg-[var(--primary-soft)] border-[var(--primary)] text-[var(--primary)]' : 'bg-[var(--surface)] border-[var(--border)] text-[var(--fg-2)]'}`}
                  >
                    <Edit2 className="w-3 h-3" />
                    {convExpanded ? 'เสร็จแล้ว' : 'แก้ไขหน่วย'}
                  </button>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap px-3 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--border)]">
                  {chain.length === 0 ? (
                    <p className="text-xs text-[var(--fg-4)]">ยังไม่ได้ตั้งหน่วยให้สินค้านี้</p>
                  ) : chain.map((c, i) => {
                    const isBase = c.roles.includes('หน่วยนับ')
                    const isBuy = c.roles.includes('หน่วยซื้อ')
                    const isPack = c.roles.includes('หน่วยบรรจุ')
                    return (
                      <span key={c.unit + i} className="flex items-center gap-1.5">
                        {i > 0 && (
                          <span className="flex flex-col items-center leading-4">
                            <span className={`text-[10px] font-mono ${c.missing ? 'text-danger' : 'text-[var(--primary)]'}`}>
                              {c.missing ? 'ไม่มีสูตร' : fmtFactor(c.factor ?? 1)}
                            </span>
                            <ArrowRight className={`w-3.5 h-3.5 ${c.missing ? 'text-danger' : 'text-[var(--fg-4)]'}`} />
                            {c.shared && (
                              <span className="text-[9px] text-[var(--fg-4)] whitespace-nowrap" title="ใช้สูตรกลางของทั้งระบบ ไม่ใช่กฎเฉพาะสินค้านี้ จึงไม่มีในรายการข้างล่าง">กฎรวม</span>
                            )}
                          </span>
                        )}
                        <span className={`px-2.5 py-1.5 rounded-[10px] border text-center ${
                          isBase ? 'bg-[var(--success-soft)] border-success/30'
                            : isBuy ? 'bg-[var(--primary-soft)] border-[var(--primary)]/30'
                              : isPack ? 'bg-[var(--warning-soft)] border-warning/35'
                                : 'bg-[var(--surface)] border-[var(--border)]'}`}>
                          <span className={`block text-[13px] font-bold leading-5 ${
                            isBase ? 'text-[var(--success-strong)]'
                              : isBuy ? 'text-[var(--primary)]'
                                : isPack ? 'text-[var(--warning-strong)]' : 'text-[var(--fg-2)]'}`}>
                            {ul(c.unit)}
                          </span>
                          <span className="block text-[10px] leading-4 text-[var(--fg-3)]">
                            {c.roles.length > 0 ? c.roles.join(' · ') : 'หน่วยกลาง'}
                          </span>
                        </span>
                      </span>
                    )
                  })}
                </div>
                <p className="text-[11px] leading-4 text-[var(--fg-3)] mt-2">
                  ซื้อเป็น {formData.purchaseUnit ? ul(formData.purchaseUnit) : '—'} ·
                  เก็บเป็น {formData.displayUnit ? ul(formData.displayUnit) : '—'} ·
                  นับเป็น {formData.baseUnit ? ul(formData.baseUnit) : '—'} — ตัวเลขสต็อกทั้งระบบนับเป็นหน่วยนับเสมอ
                </p>

                {(chainGapMsg || conversionWarning) && (
                  <div role="alert" className="mt-2.5 flex items-start gap-2 p-2.5 rounded-xl bg-[var(--danger-soft)] border border-danger/30">
                    <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                    <p className="text-xs leading-[17px] text-[var(--danger-strong)]">
                      {chainGapMsg || conversionWarning} — รับของหรือขายด้วยหน่วยนั้นจะตัดสต็อกผิดทันที
                    </p>
                  </div>
                )}

                {convExpanded && (
                  <div className="mt-3 space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-[var(--fg-3)] mb-1.5">หน่วยที่คลังนับ <span className="text-[var(--fg-4)]">หน่วยย่อยสุด</span></label>
                        <UnitPicker
                          value={formData.baseUnit || ''}
                          onChange={changeBaseUnit}
                          materialId={item?.id}
                          restrict="none"
                          placeholder="เลือกหน่วย — พิมพ์ค้นได้"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--fg-3)] mb-1.5">หน่วยบรรจุ <span className="text-[var(--fg-4)]">ที่ยังไม่แกะ</span></label>
                        <UnitPicker
                          value={formData.displayUnit || ''}
                          onChange={changeDisplayUnit}
                          materialId={item?.id}
                          baseUnit={formData.baseUnit || formData.unit}
                          restrict="warn"
                          placeholder="เลือกหน่วย — พิมพ์ค้นได้"
                        />
                      </div>
                    </div>

                    {itemConversions.length > 0 && (
                      <div className="space-y-1.5">
                        {itemConversions.map(c => (
                          <div key={c.id} className="flex items-center gap-2 px-2.5 py-2 rounded-[10px] bg-[var(--bg)] border border-[var(--border)]">
                            <span className="text-xs font-mono text-[var(--fg-2)]">1 {ul(c.from_unit)} =</span>
                            <span className="text-xs font-mono font-semibold text-[var(--primary)]">{c.conversion_factor} {ul(c.to_unit)}</span>
                            <button
                              type="button"
                              onClick={() => handleDeleteConversion(c.id)}
                              aria-label="ลบกฎนี้"
                              className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg text-[var(--fg-4)] hover:text-danger hover:bg-[var(--danger-soft)] transition-colors shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 items-end">
                      <div className="flex-1 min-w-[120px]">
                        <p className="text-[10px] text-[var(--fg-4)] mb-1">1 หน่วยของ</p>
                        <UnitPicker
                          value={convForm.from_unit}
                          onChange={(u) => setConvForm(f => ({ ...f, from_unit: u }))}
                          materialId={item?.id}
                          restrict="none"
                          size="sm"
                          placeholder="เลือกหน่วย"
                        />
                      </div>
                      <div className="flex-1 min-w-[120px]">
                        <p className="text-[10px] text-[var(--fg-4)] mb-1">เท่ากับหน่วย</p>
                        <UnitPicker
                          value={convForm.to_unit}
                          onChange={(u) => setConvForm(f => ({ ...f, to_unit: u }))}
                          materialId={item?.id}
                          restrict="none"
                          size="sm"
                          placeholder="เลือกหน่วย"
                        />
                      </div>
                      <div className="w-20">
                        <p className="text-[10px] text-[var(--fg-4)] mb-1">กี่หน่วย</p>
                        <input
                          type="number"
                          value={convForm.conversion_factor}
                          onChange={e => setConvForm(f => ({ ...f, conversion_factor: e.target.value }))}
                          placeholder="24"
                          min="0.000001"
                          step="any"
                          className="w-full px-2.5 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs text-[var(--fg-1)] placeholder-[var(--fg-4)] focus:outline-none focus:border-[var(--primary)]"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleAddConversion}
                        disabled={convSaving || !convForm.from_unit || !convForm.to_unit || !convForm.conversion_factor}
                        className="h-[34px] px-3 flex items-center gap-1 rounded-lg bg-[var(--primary)] text-white text-xs font-semibold disabled:opacity-40 hover:bg-[var(--primary-hover)] transition-colors shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        เพิ่มกฎ
                      </button>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setShowChainEditor(true)}
                        className="h-9 px-3 flex items-center gap-1.5 rounded-[10px] bg-[var(--surface)] border border-[var(--border)] text-xs font-semibold text-[var(--fg-2)] hover:border-[var(--primary)] transition-colors"
                      >
                        <Network className="w-3.5 h-3.5" />
                        เปิดผังเต็มจอ
                      </button>
                      <span className="text-[11px] leading-4 text-[var(--fg-3)]">
                        แก้ตัวคูณแล้วมีผลกับทุกใบที่ใช้หน่วยนี้ · เอกสารเก่ายังใช้ตัวคูณ ณ ตอนนั้น
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* ── จุดเตือน ── */}
              <div className="rounded-2xl border border-[var(--border)] p-3.5">
                <p className="text-xs font-semibold text-[var(--fg-2)] mb-2.5">จุดเตือน</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1.5">จุดสั่งซื้อ <span className="text-[var(--fg-4)]">{baseLabel}</span></label>
                    <input
                      type="number"
                      value={formData.minStock}
                      onChange={(e) => setFormData({ ...formData, minStock: parseInt(e.target.value) || 0 })}
                      onFocus={(e) => e.target.select()}
                      className="phopy-input w-full"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1.5">เก็บสูงสุด <span className="text-[var(--fg-4)]">{baseLabel}</span></label>
                    <input
                      type="number"
                      value={formData.maxStock}
                      onChange={(e) => setFormData({ ...formData, maxStock: parseInt(e.target.value) || 0 })}
                      onFocus={(e) => e.target.select()}
                      className="phopy-input w-full"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1.5">ที่เก็บ</label>
                    <input
                      type="text"
                      value={formData.location}
                      onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                      className="phopy-input w-full"
                      placeholder="เช่น คลังหลัก"
                    />
                  </div>
                </div>
              </div>

            </div>

            {/* แถบปุ่มท้ายหน้าต่าง */}
            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-t border-[var(--border)] bg-[var(--bg)] flex-shrink-0">
              <p className="hidden sm:block text-[11px] text-[var(--fg-3)] flex-1 min-w-0">
                ประวัติราคาซื้อ/ขายและการเคลื่อนไหว ดูได้ที่หน้ารายละเอียด (คลิกชื่อสินค้า)
              </p>
              <div className="flex gap-2 flex-1 sm:flex-none">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 sm:flex-none h-10 px-4 rounded-[11px] bg-[var(--surface)] border border-[var(--border)] text-sm font-semibold text-[var(--fg-2)] hover:border-[var(--border-strong)] transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={saving || uploadingImage}
                  className="flex-1 sm:flex-none h-10 px-4 rounded-[11px] bg-[var(--primary)] text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 hover:bg-[var(--primary-hover)] transition-colors"
                >
                  {(saving || uploadingImage)
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> กำลังบันทึก…</>
                    : 'บันทึก'}
                </button>
              </div>
            </div>
          </form>

        </div>
      </div>

      {/* Chain Editor overlay */}
      {showChainEditor && item && (
        <UnitChainEditor
          conversions={itemConversions}
          availableUnits={availableUnits}
          onAdd={async (from, to, factor) => {
            await api.post('/materials/unit-conversions', {
              material_id: item.id,
              from_unit: from,
              to_unit: to,
              conversion_factor: factor,
            })
            await fetchItemConversions(item.id)
            invalidateUnitsCache()
          }}
          onDelete={handleDeleteConversion}
          onClose={() => setShowChainEditor(false)}
          baseUnit={formData.baseUnit}
          displayUnit={formData.displayUnit}
        />
      )}
    </>
  )
}

// Movement Modal Component
function FilterButton({
  label,
  active,
  onClick,
  count,
  tone = 'neutral',
  dot = false,
}: {
  label: string
  active: boolean
  onClick: () => void
  count?: number
  tone?: 'neutral' | 'warning' | 'danger'
  /** จุดสีนำหน้าชิปสถานะ — กวาดตาแยกหมด/ใกล้หมดได้โดยไม่ต้องอ่าน */
  dot?: boolean
}) {
  const empty = count === 0
  const activeCls =
    tone === 'danger' ? 'bg-[var(--danger-soft)] text-danger border-danger/40'
      : tone === 'warning' ? 'bg-[var(--warning-soft)] text-warning border-warning/40'
        : 'bg-[var(--primary)] text-white border-[var(--primary)]'
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm whitespace-nowrap transition-colors ${
        active ? activeCls
          : `bg-transparent border-[var(--border)] hover:border-phopy-indigo/30 ${empty ? 'text-[var(--fg-4)]' : 'text-[var(--fg-3)]'}`
      }`}
    >
      {dot && (
        <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${
          tone === 'danger' ? 'bg-[var(--danger)]' : tone === 'warning' ? 'bg-[var(--warning)]' : 'bg-[var(--fg-4)]'
        }`} />
      )}
      {label}
      {count !== undefined && (
        <span className={`text-[11px] tabular-nums ${active ? 'opacity-70' : 'text-[var(--fg-4)]'}`}>{count}</span>
      )}
    </button>
  )
}

// Map any category value (Thai or English) to a display group
function getCategoryGroup(category: string): 'raw' | 'wip' | 'finished' | 'service' | 'material' {
  const raw = ['[วัตถุดิบ]', '[วัสดุย่อย]', 'raw', 'raw material']
  const wip = ['[สินค้ากึ่งสำเร็จรูป]', 'wip', 'semi-finished']
  const finished = ['[สินค้าสำเร็จรูป]', '[สินค้า]', '[สินค้าไม่มีตัวตน]', 'finished', 'finish']
  // ค่าขนส่ง/ค่าแพ็ค — ขายได้แต่ไม่มีของ ไม่ถูกตัดสต็อก (services/stockItem.service.ts)
  const service = ['service', 'บริการ']
  const c = category.toLowerCase()
  if (raw.includes(c)) return 'raw'
  if (wip.includes(c)) return 'wip'
  if (finished.includes(c)) return 'finished'
  if (service.includes(c)) return 'service'
  return 'material'
}

function CategoryBadge({ category }: { category: string }) {
  const config: Record<string, { label: string; color: string }> = {
    raw:      { label: 'วัตถุดิบ',       color: 'text-blue-400 bg-[var(--info-soft)] border-info/30' },
    wip:      { label: 'กึ่งสำเร็จรูป', color: 'text-warning bg-[var(--warning-soft)] border-warning/30' },
    finished: { label: 'สินค้าสำเร็จรูป', color: 'text-success bg-[var(--success-soft)] border-success/30' },
    service:  { label: 'บริการ',        color: 'text-cyan-400 bg-cyan-500/20 border-cyan-500/30' },
    material: { label: 'วัสดุ/อื่นๆ',   color: 'text-purple-400 bg-purple-500/20 border-purple-500/30' },
  }
  const selected = config[getCategoryGroup(category)]
  return (
    <span className={`status-badge ${selected.color}`} title={category}>{selected.label}</span>
  )
}

// สีของแถบระดับสต็อกในตาราง — ชุดเดียวกับป้ายสถานะ จะได้ไม่เพี้ยนกันเอง
const STATUS_BAR: Record<string, string> = {
  out: 'bg-[var(--danger)]',
  critical: 'bg-[var(--danger)]',
  low: 'bg-[var(--warning)]',
  nearLow: 'bg-[var(--warning)]',
  adequate: 'bg-[var(--success)]',
  overstock: 'bg-[var(--primary)]',
  sealed: 'bg-[var(--fg-4)]',
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    adequate: {
      label: 'ปกติ',
      className: 'bg-[var(--success-soft)] text-success border-success/30',
    },
    nearLow: {
      label: 'ใกล้หมด',
      className: 'bg-transparent text-warning border-warning/60',
    },
    low: {
      label: 'สต๊อกต่ำ',
      className: 'bg-[var(--warning-soft)] text-warning border-warning/30',
    },
    critical: {
      label: 'วิกฤต',
      className: 'bg-[var(--danger-soft)] text-danger border-danger/30',
    },
    overstock: {
      label: 'สต๊อกเกิน',
      className: 'bg-[var(--primary-soft)] text-[var(--primary)] border-[var(--primary)]/30',
    },
    out: {
      label: 'หมด',
      className: 'bg-[var(--danger)] text-white border-transparent',
    },
    sealed: {
      label: 'ยังไม่แกะ',
      className: 'bg-[var(--warning-soft)] text-[var(--warning)] border-[var(--warning)]/40',
    },
  }

  const selected = config[status] || config.adequate

  return (
    <span className={`status-badge ${selected.className}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      {selected.label}
    </span>
  )
}

// Sortable table header helper
function SortTh({
  label,
  colKey,
  sortKey,
  sortDir,
  onSort,
  hint,
  align = 'left',
  className = '',
}: {
  label: string
  colKey: SortKey
  sortKey: SortKey | null
  sortDir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
  /** Optional tooltip clarifying an ambiguous column (e.g. loose qty vs. sealed packs). */
  hint?: string
  align?: 'left' | 'right'
  /** ให้ซ่อนคอลัมน์รองบนจอเล็กได้ เช่น "hidden md:table-cell" */
  className?: string
}) {
  const active = sortKey === colKey
  return (
    <th
      onClick={() => onSort(colKey)}
      className={`cursor-pointer select-none hover:text-[var(--primary)] transition-colors ${className}`}
      title={hint}
    >
      <span className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        {active ? (
          sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-[var(--primary)]" /> : <ChevronDown className="w-3.5 h-3.5 text-[var(--primary)]" />
        ) : (
          <ChevronsUpDown className="w-3.5 h-3.5 text-[var(--fg-4)]" />
        )}
      </span>
    </th>
  )
}

// Stock Adjustment Modal
// หัวข้อบอกขั้นตอนในโมดัลปรับสต็อก — ต้องอยู่ระดับไฟล์
// ถ้าประกาศในตัว component มันจะเป็นคอมโพเนนต์ตัวใหม่ทุก render แล้ว React ถอด-ประกอบใหม่ทุกครั้ง
const AdjustStep = ({ n, title, hint }: { n: number; title: string; hint?: string }) => (
  <div className="flex items-baseline gap-2.5">
    <span className="shrink-0 w-5 h-5 rounded-full bg-phopy-indigo/15 text-[var(--primary)] text-[11px] font-bold flex items-center justify-center">{n}</span>
    <div className="min-w-0">
      <h3 className="text-sm font-semibold text-[var(--fg-1)] leading-tight">{title}</h3>
      {hint && <p className="text-xs text-[var(--fg-4)] mt-0.5">{hint}</p>}
    </div>
  </div>
)

function AdjustModal({
  open,
  item,
  stockItems,
  onClose,
  onSave,
  onPending,
}: {
  open: boolean
  item: StockItem | null
  stockItems: StockItem[]
  onClose: () => void
  onSave: () => void
  onPending?: (data: any) => boolean
}) {
  useModalClose(onClose)
  const [selectedItemId, setSelectedItemId] = useState('')
  const [countText, setCountText] = useState('')
  const [unit, setUnit] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [costBasis, setCostBasis] = useState<any>(null)
  // null = ยังไม่รู้ (โหลดไม่สำเร็จ) ให้ใช้ค่าสำรอง · ตัวเลขจริงมาจาก approval_settings ของบริษัทนี้
  const [gateLimit, setGateLimit] = useState<number | null>(null)
  // หมวดนี้เปิดด่านอนุมัติไว้กับ role ของคนนี้หรือเปล่า — ใช้บอกว่า "ของจะขยับทันที" หรือ "ต้องรอ"
  const [gateRequired, setGateRequired] = useState(false)
  const [showSources, setShowSources] = useState(false)
  // รูปของจริงตอนนับ — ใบยังไม่เกิดตอนกรอก จึงเก็บไฟล์ค้างไว้ก่อน
  // แล้วอัปโหลดผูกกับทะเบียนที่เพิ่งสร้างหลังบันทึกสำเร็จ (แนวเดียวกับสลิปจ่ายเงิน)
  const [shots, setShots] = useState<Array<{ file: File; url: string }>>([])
  const clearShots = () => { shots.forEach(s => URL.revokeObjectURL(s.url)); setShots([]) }

  const selectedItem = stockItems.find(i => i.id === selectedItemId)
  const { units: availableUnits } = useUnits(selectedItem?.id)

  useEffect(() => {
    if (item) {
      setSelectedItemId(item.id)
      setCountText(String(item.quantity))
      setUnit(item.baseUnit || item.unit || '')
    } else {
      setSelectedItemId('')
      setCountText('')
      setUnit('')
    }
    setReason('')
    setNotes('')
    setShowSources(false)
    clearShots()
  }, [item, open])

  useEffect(() => {
    if (selectedItem && !item) {
      setCountText(String(selectedItem.quantity))
      setUnit(selectedItem.baseUnit || selectedItem.unit || '')
    }
  }, [selectedItemId])

  // ค่ากลางที่ใช้ตีมูลค่าส่วนต่าง — ดึงจาก backend ตัวเดียวกับที่ลง journal จริง
  // จะได้ไม่มีทางที่ตัวเลขบนจอกับตัวเลขที่ลงบัญชีไม่ตรงกัน
  useEffect(() => {
    if (!open || !selectedItemId) { setCostBasis(null); return }
    api.get('/stock/' + selectedItemId + '/cost-basis')
      .then(r => setCostBasis(r.data?.data ?? null))
      .catch(() => setCostBasis(null))
  }, [open, selectedItemId])

  // วงเงินของบริษัทนี้เอง (Settings > การอนุมัติ) — อ่านจากตัวบังคับจริง ไม่คิดกฎเองซ้ำ
  useEffect(() => {
    if (!open) return
    api.get('/approval/check-required', { params: { moduleType: 'stock_adjust', amount: 0 } })
      .then(r => {
        setGateLimit(Number(r.data?.data?.autoApproveThreshold) || 0)
        setGateRequired(!!r.data?.data?.required)
      })
      .catch(() => { setGateLimit(null); setGateRequired(false) })
  }, [open])

  const physicalCount = Number(countText)
  const countInvalid = countText.trim() === '' || !isFinite(physicalCount) || physicalCount < 0

  const baseQuantity = useMemo(() => {
    if (!selectedItem || !unit || unit === (selectedItem.baseUnit || selectedItem.unit)) return physicalCount
    if (unit === selectedItem.displayUnit && selectedItem.displayQuantity !== undefined && selectedItem.displayQuantity !== null && selectedItem.displayQuantity > 0) {
      const ratio = selectedItem.quantity / selectedItem.displayQuantity
      if (!isFinite(ratio) || ratio <= 0) return physicalCount
      return Math.round(physicalCount * ratio * 1000) / 1000
    }
    return physicalCount
  }, [physicalCount, unit, selectedItem])

  const systemQty = selectedItem?.quantity ?? 0
  const baseUnitLabel = unitLabel(selectedItem?.baseUnit || selectedItem?.unit || '')
  const diff = countInvalid ? 0 : baseQuantity - systemQty
  const avgCost = costBasis?.weightedAvg ?? 0
  const diffValue = diff * avgCost
  // เกณฑ์ "ถามซ้ำก่อนกด" ใช้วงเงินที่บริษัทตั้งไว้เอง ไม่ใช่เลขตายตัวในโค้ด
  // ตั้ง 0 (= ทุกใบต้องขออนุมัติ) ก็ยังถามซ้ำเมื่อมีส่วนต่าง เพราะ ADMIN ข้ามด่านอนุมัติได้
  // ถามซ้ำจึงเป็นการ์ดใบสุดท้ายของคนที่ไม่มีใครคอยเบรก
  const warnOver = gateLimit === null ? 1000 : gateLimit
  const bigLoss = Math.abs(diffValue) > warnOver
  // เกินเกณฑ์เตือน กับ ต้องรออนุมัติจริง เป็นคนละเรื่อง — ADMIN เกินเกณฑ์ก็ยังทำเองได้
  const needsBoss = bigLoss && gateRequired
  const photoMissing = bigLoss && shots.length === 0
  const blockReason =
    !selectedItemId ? 'ยังไม่ได้เลือกสินค้า'
    : countInvalid ? 'ยังไม่ได้กรอกจำนวนที่นับได้'
    : diff === 0 ? 'จำนวนตรงกับระบบแล้ว ไม่มีอะไรต้องปรับ'
    : !reason ? 'ยังไม่ได้เลือกเหตุผล'
    : photoMissing ? 'ส่วนต่างเกินวงเงิน ต้องแนบรูปก่อน'
    : ''
  const canSubmit = !blockReason
  const money = (n: number) => '฿' + Math.abs(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // เหตุผลเป็นตัวบอกว่าเงินก้อนนี้ควรไปลงบัญชีไหน จึงบังคับให้เลือกเมื่อของไม่ตรง
  // ช่องที่ 4 = บัญชีที่เงินก้อนนี้จะไปลง ต้องตรงกับ ADJUST_REASON_ACCOUNT ฝั่ง backend
  const REASONS: Array<[string, string, string, string]> = [
    ['ของเสีย/หมดอายุ', 'ทิ้งไปแล้ว ลงเป็นผลขาดทุน', 'down', 'ผลขาดทุนของเสีย'],
    ['ของหาย', 'หาไม่เจอ ไม่รู้ไปไหน', 'down', 'ผลขาดทุนสินค้าสูญหาย'],
    ['แตก/ชำรุด', 'เสียหายระหว่างเก็บ', 'down', 'ผลขาดทุนของเสีย'],
    ['นับผิดรอบก่อน', 'ของครบ แต่ตัวเลขเดิมผิด', 'any', 'ค่าใช้จ่ายปรับปรุงสต็อก'],
    ['รับเพิ่มไม่ผ่านใบ', 'ของเกิน เพิ่งเจอ', 'up', 'รายได้อื่น'],
    ['เบิกใช้ไม่ได้บันทึก', 'เอาไปใช้แล้วลืมลง', 'down', 'ต้นทุนวัตถุดิบใช้ไป'],
  ]
  // ไม่เลือกเหตุผลก็ยังส่งไม่ได้อยู่แล้ว ค่า fallback ไว้กันจอว่างระหว่างยังไม่เลือก
  const reasonAccount = REASONS.find(([label]) => label === reason)?.[3] || (diff > 0 ? 'รายได้อื่น' : 'ค่าใช้จ่ายปรับปรุงสต็อก')
  const visibleReasons = REASONS.filter(([, , dir]) =>
    diff === 0 ? dir === 'any' : diff > 0 ? dir !== 'down' : dir !== 'up')

  // แก้จำนวนจนทิศทางกลับด้าน เหตุผลที่เลือกไว้อาจใช้ไม่ได้แล้ว ต้องล้างทิ้ง
  // ไม่งั้นส่งเหตุผล "ของหาย" ไปกับการปรับ "เพิ่ม" ได้ แล้วเงินไปลงบัญชีผิดฝั่ง
  useEffect(() => {
    if (reason && !visibleReasons.some(([label]) => label === reason)) setReason('')
  }, [diff])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedItemId) { toast.error('กรุณาเลือกสินค้า'); return }
    if (countInvalid) { toast.error('กรอกจำนวนที่นับได้ให้ถูกต้อง'); return }
    if (diff === 0) { toast('จำนวนเท่าเดิม ไม่มีการเปลี่ยนแปลง'); onClose(); return }
    if (!reason) { toast.error('เลือกเหตุผลก่อน — เหตุผลเป็นตัวบอกว่าเงินก้อนนี้ลงบัญชีไหน'); return }
    // ของมูลค่าสูงหายไปโดยไม่มีรูปเป็นหลักฐาน = ตรวจย้อนหลังไม่ได้เลย
    if (photoMissing) { toast.error('แนบรูปของจริงอย่างน้อย 1 รูปก่อน — ส่วนต่างเกินวงเงินที่บริษัทตั้งไว้'); return }
    if (bigLoss && !confirm(
      'ส่วนต่างคิดเป็นเงิน ' + money(diffValue) +
      ' เกินวงเงินที่บริษัทตั้งไว้ (' + money(warnOver) + ') ยืนยันว่านับถูกแล้ว?'
    )) return

    setSaving(true)
    try {
      const moveResult = await stockService.recordMovement({
        stockItemId: selectedItemId,
        type: 'ADJUST',
        quantity: baseQuantity,
        unit: selectedItem?.baseUnit || selectedItem?.unit || undefined,
        adjustReason: reason,
        notes: notes || (reason + ': ' + systemQty + ' → ' + baseQuantity + ' ' + baseUnitLabel),
      })
      if (onPending?.(moveResult)) {
        // ติดด่านอนุมัติ = ทะเบียนยังไม่เกิด จึงยังไม่มี id ให้ผูกไฟล์
        if (shots.length > 0) toast('รูปยังแนบไม่ได้จนกว่าจะมีคนอนุมัติ — เปิดใบแล้วแนบได้ทีหลัง')
        onClose(); return
      }
      // ทะเบียนเพิ่งเกิด ถึงจะมี id ให้ผูกไฟล์
      // อัปไม่ผ่านก็ไม่ย้อนการปรับสต็อก ของขยับไปแล้วจริง แค่บอกให้ไปแนบซ้ำ
      const adjId = (moveResult as any)?.adjustmentId
      if (shots.length > 0 && adjId) {
        try {
          for (const sh of shots) {
            const fd = new FormData()
            fd.append('file', sh.file)
            await api.post('/attachments/STOCK_ADJUSTMENT/' + adjId, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
          }
        } catch {
          toast.error('ปรับสต็อกแล้ว แต่แนบรูปไม่สำเร็จ')
        }
      }
      clearShots()
      onSave()
      onClose()
      toast.success('ปรับสต๊อกเรียบร้อย')
    } catch {
      toast.error('ปรับสต๊อกไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null


  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/50 flex items-center justify-center z-50 p-4 animate-fadeIn" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="phopy-card w-full max-w-lg flex flex-col max-h-[90vh] animate-scaleIn">
        <div className="p-5 border-b border-[var(--border)] flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold text-[var(--fg-1)]">ปรับสต็อกให้ตรงของจริง</h2>
          <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg transition-colors" aria-label="ปิด">
            <X className="w-5 h-5 text-[var(--fg-3)]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-5 space-y-5 flex-1">
          <div className="space-y-2">
            <AdjustStep n={1} title="นับสินค้าตัวไหน" />
            {item ? (
              <div className="px-3 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--border)]">
                <p className="text-sm font-medium text-[var(--fg-1)]">{selectedItem?.name}</p>
                <p className="text-xs text-[var(--fg-4)] font-mono">{selectedItem?.sku}{selectedItem?.location ? ' · ' + selectedItem.location : ''}</p>
              </div>
            ) : (
              <SearchableDropdown
                options={stockItems.map(i => ({ id: i.id, label: i.name + ' (' + i.sku + ')', searchText: i.sku }))}
                value={selectedItemId}
                onChange={setSelectedItemId}
                placeholder="ค้นชื่อ หรือรหัสสินค้า…"
              />
            )}
          </div>

          {selectedItem && (
            <div className="space-y-2">
              <AdjustStep n={2} title="เทียบตัวเลข" hint="ระบบจำได้เท่าไร เทียบกับที่นับได้จริง" />
              <div className="grid grid-cols-2 gap-3">
                <div className="px-3 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--border)]">
                  <p className="text-xs text-[var(--fg-4)]">ระบบบอกว่ามี</p>
                  <p className="text-lg font-bold text-[var(--fg-1)] tabular-nums">{systemQty.toLocaleString('th-TH')} <span className="text-sm font-normal text-[var(--fg-3)]">{baseUnitLabel}</span></p>
                </div>
                <div className="px-3 py-2 rounded-xl bg-[var(--surface)] border border-phopy-indigo/40">
                  <label className="text-xs text-[var(--fg-4)] block mb-0.5">นับได้จริง</label>
                  <div className="flex items-center gap-2">
                    <input type="number" step="any" min="0" value={countText} autoFocus
                      onChange={(e) => setCountText(e.target.value)}
                      className="w-full bg-transparent text-lg font-bold text-[var(--fg-1)] tabular-nums focus:outline-none" />
                    <UnitPicker value={unit} onChange={setUnit} materialId={selectedItem?.id} baseUnit={selectedItem?.baseUnit || selectedItem?.unit} restrict="warn" size="sm" />
                  </div>
                </div>
              </div>

              {!countInvalid && diff !== 0 && (
                <div className={'rounded-xl border px-3 py-2.5 space-y-2 ' + (bigLoss ? 'bg-[var(--danger-soft)] border-danger/40' : 'bg-[var(--warning-soft)] border-warning/35')}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-semibold text-[var(--fg-1)]">
                      ส่วนต่าง {diff > 0 ? '+' : '−'}{Math.abs(diff).toLocaleString('th-TH')} {baseUnitLabel}
                    </span>
                    <span className={'text-sm font-bold tabular-nums ' + (diff > 0 ? 'text-success' : 'text-danger')}>
                      {diff > 0 ? '+' : '−'}{money(diffValue)}
                    </span>
                  </div>
                  {/* ค่ากลางมาจากไหนต้องกดดูได้ ไม่งั้นคนไม่เชื่อตัวเลขแล้วไม่กล้ากดยืนยัน */}
                  <button type="button" onClick={() => setShowSources(v => !v)}
                    className="text-xs text-[var(--primary)] hover:underline flex items-center gap-1">
                    ค่ากลาง ฿{avgCost.toLocaleString('th-TH', { maximumFractionDigits: 4 })}/{baseUnitLabel}
                    {costBasis?.basis === 'weighted'
                      ? ' (ถ่วงน้ำหนักจาก ' + costBasis.sources.length + ' ครั้งที่ซื้อ)'
                      : ' (ยังไม่มีประวัติรับเข้า ใช้ต้นทุนที่บันทึกไว้)'}
                    <ChevronDown className={'w-3 h-3 transition-transform ' + (showSources ? 'rotate-180' : '')} />
                  </button>
                  {showSources && costBasis?.sources?.length > 0 && (
                    <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] divide-y divide-[var(--border)]/50">
                      {/* หัวคอลัมน์ — เดิมไม่มีเลย ตัวเลข 3 ก้อนเรียงกันโดยไม่บอกว่าก้อนไหนคืออะไร */}
                      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2.5 py-1.5 text-[10px] text-[var(--fg-4)] bg-[var(--bg)]">
                        <span>ซื้อจาก</span>
                        <span className="text-right">จำนวน</span>
                        <span className="text-right">ราคา/หน่วย</span>
                        <span className="text-right">มูลค่า</span>
                      </div>
                      {costBasis.sources.slice(0, 6).map((s: any) => (
                        <div key={s.doc} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2.5 py-1.5 text-[11px] items-center">
                          <span className="truncate text-[var(--fg-3)]">{s.supplier || '-'} <span className="font-mono text-[var(--fg-4)]">{s.doc}</span></span>
                          <span className="text-[var(--fg-3)] tabular-nums text-right">{s.qty} {s.unit}</span>
                          <span className="text-[var(--fg-3)] tabular-nums text-right">฿{s.unitPrice}</span>
                          <span className="text-[var(--fg-1)] font-semibold tabular-nums text-right">{money(s.value)}</span>
                        </div>
                      ))}
                      {/* เดิมตัดเหลือ 6 แถวเงียบ ๆ คนเห็นยอดรวมไม่ตรงกับแถวที่โชว์แล้วนึกว่าโปรแกรมคิดผิด */}
                      {costBasis.sources.length > 6 && (
                        <div className="px-2.5 py-1.5 text-[10px] text-[var(--fg-4)]">
                          แสดง 6 จาก {costBasis.sources.length} ครั้งที่ซื้อ — ยอดรวมด้านล่างนับครบทุกครั้ง
                        </div>
                      )}
                      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2.5 py-1.5 text-[11px] bg-[var(--bg)]">
                        <span className="text-[var(--fg-3)]">รวม</span>
                        <span className="text-[var(--fg-2)] tabular-nums text-right">{costBasis.totalBaseQty.toLocaleString('th-TH')} {baseUnitLabel}</span>
                        <span className="text-[var(--fg-4)] text-right">เฉลี่ย</span>
                        <span className="text-[var(--fg-1)] font-semibold tabular-nums text-right">{money(costBasis.totalValue)}</span>
                      </div>
                      {/* กางสูตรให้เห็น ไม่งั้นคนไม่เชื่อว่าเลขนี้ไม่ได้ลากราคาล่าสุดมามั่ว ๆ */}
                      <div className="px-2.5 py-2 text-[10px] text-[var(--fg-4)] leading-relaxed">
                        {money(costBasis.totalValue)} ÷ {costBasis.totalBaseQty.toLocaleString('th-TH')} {baseUnitLabel}
                        {' = '}฿{avgCost.toLocaleString('th-TH', { maximumFractionDigits: 4 })}/{baseUnitLabel}
                        {' — ค่านี้คือตัวที่เอาไปลงบัญชี ไม่ใช่ราคาครั้งล่าสุด'}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {selectedItem && !countInvalid && diff !== 0 && (
            <div className="space-y-2">
              <AdjustStep n={3} title="ทำไมถึงไม่ตรง" hint="เหตุผลเป็นตัวบอกว่าเงินก้อนนี้ลงบัญชีตัวไหน" />
              {diff !== 0 && !reason && (
                <p className="text-xs text-danger">
                  ยังไม่ได้เลือกเหตุผล — ปรับสต็อกโดยไม่บอกสาเหตุ เดือนหน้าจะไม่มีใครรู้ว่าของหายไปไหน
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                {visibleReasons.map(([label, hint, , accName]) => (
                  <button key={label} type="button" onClick={() => setReason(label)} aria-pressed={reason === label}
                    className={'flex flex-col gap-0.5 px-3 py-2 rounded-xl border text-left transition-colors ' + (
                      reason === label
                        ? 'bg-phopy-indigo/10 border-phopy-indigo text-[var(--primary)]'
                        : 'bg-[var(--surface)] border-[var(--border)] text-[var(--fg-2)] hover:border-phopy-indigo/40')}>
                    <span className="text-sm font-medium">{label}</span>
                    <span className="text-[11px] text-[var(--fg-4)] leading-tight">{hint}</span>
                    <span className="text-[10px] text-[var(--fg-3)] leading-tight">ลงบัญชี: {accName}</span>
                  </button>
                ))}
              </div>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                placeholder="อธิบายเพิ่ม (ไม่บังคับ)"
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--fg-1)] resize-none focus:outline-none focus:border-phopy-indigo" />
            </div>
          )}

          {selectedItem && !countInvalid && diff !== 0 && (
            <div className="space-y-2">
              <AdjustStep
                n={4}
                title={'ถ่ายรูปของจริง' + (bigLoss ? ' (จำเป็น)' : '')}
                hint={bigLoss
                  ? 'ส่วนต่างเกินวงเงินที่บริษัทตั้งไว้ — ต้องแนบรูปอย่างน้อย 1 รูปก่อนส่ง · .jpg .jpeg .png ไม่เกิน 5 MB'
                  : 'รับเฉพาะ .jpg .jpeg .png · ไม่เกิน 5 MB · ไม่บังคับ แต่ของหายมูลค่าสูงควรมี'}
              />
              {photoMissing && (
                <p className="text-xs text-danger">
                  ส่วนต่างมูลค่า {money(diffValue)} เกินวงเงิน {money(warnOver)} — ต้องแนบรูปของจริงอย่างน้อย 1 รูปก่อนส่ง
                </p>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {shots.map((sh, i) => (
                  <span key={sh.url} className="relative">
                    <img src={sh.url} alt={sh.file.name} className="w-16 h-16 rounded-xl object-cover border border-[var(--border)]" />
                    <button type="button" aria-label="ลบรูป"
                      onClick={() => { URL.revokeObjectURL(sh.url); setShots(p => p.filter((_, j) => j !== i)) }}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--danger-soft)] text-danger border border-danger/40 flex items-center justify-center">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                {shots.length < 4 && (
                  <label className="w-16 h-16 rounded-xl border border-dashed border-[var(--border-strong)] flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:border-phopy-indigo transition-colors">
                    <Plus className="w-4 h-4 text-[var(--fg-4)]" />
                    <span className="text-[10px] text-[var(--fg-4)]">เพิ่มรูป</span>
                    <input type="file" accept="image/jpeg,image/png" className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0]; e.target.value = ''
                        if (!f) return
                        if (f.size > 5 * 1024 * 1024) { toast.error('ไฟล์ใหญ่เกิน 5 MB'); return }
                        setShots(p => [...p, { file: f, url: URL.createObjectURL(f) }])
                      }} />
                  </label>
                )}
              </div>
            </div>
          )}

          {selectedItem && !countInvalid && diff !== 0 && (
            <div className="space-y-2">
              <AdjustStep
                n={5}
                title="ผลที่จะเกิด"
                hint={needsBoss ? 'ส่งแล้วยังไม่ขยับ ต้องรอผู้มีสิทธิ์อนุมัติก่อน' : 'กดยืนยันแล้วระบบปรับและลงบัญชีให้ทันที'}
              />
              <ul className="space-y-1 text-xs text-[var(--fg-3)]">
                <li>• สต็อกเปลี่ยนจาก {systemQty.toLocaleString('th-TH')} เป็น {baseQuantity.toLocaleString('th-TH')} {baseUnitLabel}</li>
                <li>• บันทึกเป็นรายการเคลื่อนไหว และขึ้นในทะเบียนการปรับสต็อกพร้อมเหตุผล</li>
                <li className={needsBoss ? 'text-warning' : 'text-success'}>
                  {needsBoss
                    ? '• มูลค่า ' + money(diffValue) + ' เกินวงเงิน ' + money(warnOver) + ' จึงต้องให้ผู้มีสิทธิ์อนุมัติก่อน สต็อกจะยังไม่ขยับจนกว่าจะอนุมัติ'
                    : '• อยู่ในวงเงินที่คุณทำเองได้ ปรับทันทีหลังกดส่ง'}
                </li>
              </ul>
              <div className="rounded-xl border border-[var(--border)] overflow-hidden text-xs">
                <div className="flex items-center justify-between px-3 py-2 bg-[var(--bg)] border-b border-[var(--border)]">
                  <span className="text-[var(--fg-3)]">สต็อก</span>
                  <span className="font-semibold text-[var(--fg-1)] tabular-nums">
                    {systemQty.toLocaleString('th-TH')} → {baseQuantity.toLocaleString('th-TH')} {baseUnitLabel}
                  </span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
                  <span className="shrink-0 w-[58px] text-[10px] font-bold text-center py-1 rounded-md bg-[var(--success-soft)] text-success">เดบิต</span>
                  <span className="flex-1 min-w-0 text-[var(--fg-2)] truncate">{diff > 0 ? 'สินค้าคงเหลือ' : reasonAccount}</span>
                  <span className="font-semibold text-[var(--fg-1)] tabular-nums">{money(diffValue)}</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="shrink-0 w-[58px] text-[10px] font-bold text-center py-1 rounded-md bg-[var(--warning-soft)] text-warning">เครดิต</span>
                  <span className="flex-1 min-w-0 text-[var(--fg-2)] truncate">{diff > 0 ? reasonAccount : 'สินค้าคงเหลือ'}</span>
                  <span className="font-semibold text-warning tabular-nums">{money(diffValue)}</span>
                </div>
              </div>
            </div>
          )}
        </form>

        <div className="p-5 border-t border-[var(--border)] flex justify-end gap-3 shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm">ยกเลิก</button>
          <button onClick={handleSubmit} disabled={saving || !canSubmit} title={blockReason || undefined}
            className="px-6 py-2.5 bg-phopy-indigo text-white font-semibold rounded-xl hover:bg-phopy-indigo/80 disabled:opacity-50 flex items-center gap-2 text-sm">
            {saving && <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
            {blockReason ? 'กรอกให้ครบก่อน' : needsBoss ? 'ส่งขออนุมัติ' : 'ยืนยันปรับสต็อก'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Add New Stock Item Modal
// ทะเบียนการปรับสต็อก — เฟส 3 เขียน stock_adjustments ทุกครั้งที่ปรับ แต่ไม่เคยมีทางอ่านกลับ
// ของที่ต้องตอบให้ได้: ใครปรับ ของอะไร จากเท่าไรเป็นเท่าไร เพราะอะไร คิดเป็นเงินเท่าไร
function AdjustLogModal({ open, onClose, itemId }: {
  open: boolean
  onClose: () => void
  itemId?: string
}) {
  useModalClose(onClose)
  const [rows, setRows] = useState<any[]>([])
  const [summary, setSummary] = useState<{ count: number; totalDown: number; totalUp: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setQ('')
    api.get('/stock/adjustments', { params: itemId ? { itemId } : {} })
      .then((r) => {
        setRows(r.data?.data || [])
        setSummary(r.data?.summary || null)
      })
      .catch((e: any) => toast.error(e?.response?.data?.message || 'โหลดทะเบียนการปรับสต็อกไม่สำเร็จ'))
      .finally(() => setLoading(false))
  }, [open, itemId])

  if (!open) return null

  const money = (n: number) => '฿' + Math.abs(Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const qty = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 4 })
  const when = (iso: string) => {
    if (!iso) return '-'
    const d = new Date(String(iso).replace(' ', 'T'))
    if (isNaN(d.getTime())) return String(iso)
    return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' }) + ' ' +
      d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
  }
  const needle = q.trim().toLowerCase()
  const visible = needle
    ? rows.filter((r) => [r.adjustment_number, r.item_name, r.item_sku, r.reason, r.created_by_name, r.created_by]
        .some((v) => String(v || '').toLowerCase().includes(needle)))
    : rows

  return (
    <div
      className="fixed inset-0 bg-[var(--fg-1)]/50 flex items-center justify-center z-50 p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="phopy-card w-full max-w-5xl max-h-[88vh] flex flex-col animate-scaleIn"
      >
        <div className="p-6 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-[var(--primary)]" />
            <div>
              <h2 className="text-lg font-bold text-[var(--fg-1)]">ทะเบียนการปรับสต็อก</h2>
              <p className="text-xs text-[var(--fg-3)]">ทุกครั้งที่มีคนปรับของให้ตรงกับที่นับได้ จะมีแถวอยู่ที่นี่</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg transition-colors">
            <X className="w-5 h-5 text-[var(--fg-3)]" />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-[var(--border)] flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-[var(--fg-4)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นเลขที่ · ชื่อสินค้า · เหตุผล · คนปรับ"
              className="phopy-input w-full pl-9 py-2 text-sm"
            />
          </div>
          {summary && (
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2.5 py-1.5 rounded-lg bg-[var(--bg)] text-[var(--fg-2)]">
                {summary.count.toLocaleString('th-TH')} รายการ
              </span>
              <span className="px-2.5 py-1.5 rounded-lg bg-[var(--danger-soft)] text-danger">
                ปรับลด {money(summary.totalDown)}
              </span>
              <span className="px-2.5 py-1.5 rounded-lg bg-[var(--success-soft)] text-success">
                ปรับเพิ่ม {money(summary.totalUp)}
              </span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-[var(--fg-3)] gap-2">
              <Loader2 className="w-5 h-5 animate-spin" /> กำลังโหลด...
            </div>
          ) : visible.length === 0 ? (
            <div className="text-center py-16 px-6">
              <History className="w-10 h-10 text-[var(--fg-4)] mx-auto mb-3" />
              <p className="text-[var(--fg-2)] font-medium">
                {rows.length === 0 ? 'ยังไม่มีการปรับสต็อก' : 'ไม่พบรายการที่ค้นหา'}
              </p>
              <p className="text-xs text-[var(--fg-4)] mt-1">
                {rows.length === 0
                  ? 'พอมีคนกดปรับสต๊อกให้ของตรงกับที่นับได้ รายการจะขึ้นที่นี่ทันที'
                  : 'ลองพิมพ์คำอื่น หรือล้างช่องค้นหา'}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[var(--bg-2)] text-xs text-[var(--fg-3)] z-10">
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left font-medium px-4 py-2.5">เลขที่</th>
                  <th className="text-left font-medium px-4 py-2.5">เมื่อไร</th>
                  <th className="text-left font-medium px-4 py-2.5">สินค้า</th>
                  <th className="text-right font-medium px-4 py-2.5">ก่อน → หลัง</th>
                  <th className="text-right font-medium px-4 py-2.5">ส่วนต่าง</th>
                  <th className="text-right font-medium px-4 py-2.5">คิดเป็นเงิน</th>
                  <th className="text-left font-medium px-4 py-2.5">เพราะอะไร</th>
                  <th className="text-left font-medium px-4 py-2.5">ใครปรับ</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const down = Number(r.quantity_adjusted) < 0
                  return (
                    <tr key={r.id} className="border-b border-[var(--border)] hover:bg-[var(--bg)]">
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--fg-2)]">{r.adjustment_number}</td>
                      <td className="px-4 py-2.5 text-xs text-[var(--fg-3)] whitespace-nowrap">{when(r.created_at)}</td>
                      <td className="px-4 py-2.5">
                        <div className="text-[var(--fg-1)]">{r.item_name || '(สินค้าถูกลบแล้ว)'}</div>
                        {r.item_sku && <div className="text-[10px] font-mono text-[var(--fg-4)]">{r.item_sku}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-[var(--fg-3)] whitespace-nowrap">
                        {qty(r.quantity_before)} → <span className="text-[var(--fg-1)]">{qty(r.quantity_after)}</span>
                        <span className="text-[var(--fg-4)]"> {r.base_unit || ''}</span>
                      </td>
                      <td className={'px-4 py-2.5 text-right font-medium whitespace-nowrap ' + (down ? 'text-danger' : 'text-success')}>
                        {down ? '−' : '+'}{qty(Math.abs(Number(r.quantity_adjusted) || 0))}
                      </td>
                      <td className={'px-4 py-2.5 text-right whitespace-nowrap ' + (down ? 'text-danger' : 'text-success')}>
                        {money(r.total_value)}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--fg-2)]">{r.reason || '-'}</td>
                      <td className="px-4 py-2.5 text-xs text-[var(--fg-3)]">{r.created_by_name || r.created_by || '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 border-t border-[var(--border)] text-[10px] text-[var(--fg-4)]">
          มูลค่าตีด้วยทุนเฉลี่ยถ่วงน้ำหนัก ณ ตอนที่ปรับ · ตัวเลขนี้คือยอดเดียวกับที่ลงบัญชีในสมุดรายวัน
        </div>
      </div>
    </div>
  )
}

function AddStockModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: () => void
}) {
  useModalClose(onClose)
  const [formData, setFormData] = useState({
    sku: '',
    name: '',
    gs1Barcode: '',
    category: 'raw',
    unit: 'pcs',
    baseUnit: '',
    displayUnit: '',
    quantity: 0,
    minStock: 10,
    maxStock: 100,
    location: '',
    isPosEnabled: false,
    purchasePrice: 0,
    purchaseUnit: '',
    unitPrice: 0,
  })
  const [saving, setSaving] = useState(false)
  const { units: availableUnits } = useUnits()

  const addConversionWarning = (() => {
    if (!formData.baseUnit || !formData.displayUnit) return null
    if (formData.baseUnit === formData.displayUnit) return null
    return `หน่วยนับ (${UNIT_LABELS_MAP[formData.baseUnit] || formData.baseUnit}) กับหน่วยบรรจุ (${UNIT_LABELS_MAP[formData.displayUnit] || formData.displayUnit}) ต่างกัน — สร้างสินค้าเสร็จแล้วอย่าลืมไปตั้งสูตรแปลงหน่วยที่แท็บ "หน่วย"`
  })()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.sku || !formData.name) {
      toast.error('Please enter SKU and Name')
      return
    }

    setSaving(true)
    try {
      await stockService.create({
        sku: formData.sku,
        name: formData.name,
        gs1Barcode: formData.gs1Barcode || undefined,
        category: formData.category,
        unit: formData.unit,
        baseUnit: formData.baseUnit || undefined,
        displayUnit: formData.displayUnit || undefined,
        quantity: formData.quantity,
        minStock: formData.minStock,
        maxStock: formData.maxStock,
        location: formData.location || 'Main Warehouse',
        isPosEnabled: formData.isPosEnabled,
        purchasePrice: formData.purchasePrice || undefined,
        purchaseUnit: formData.purchaseUnit || undefined,
        unitPrice: formData.unitPrice || undefined,
      })
      onSave()
      // Reset form
      setFormData({
        sku: '',
        name: '',
        gs1Barcode: '',
        category: 'raw',
        unit: 'pcs',
        baseUnit: '',
        displayUnit: '',
        quantity: 0,
        minStock: 10,
        maxStock: 100,
        location: '',
        isPosEnabled: false,
        purchasePrice: 0,
        purchaseUnit: '',
        unitPrice: 0,
      })
    } catch (err: any) {
      console.error('Failed to create stock item:', err)
      toast.error(err?.response?.data?.message || 'Failed to create stock item')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-[var(--fg-1)]/50 flex items-center justify-center z-50 p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="phopy-card w-full max-w-lg flex flex-col animate-scaleIn"
        style={{ maxHeight: 'calc(100vh - 2rem)' }}
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between bg-success/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Package className="w-5 h-5 text-success" />
            <h2 className="text-lg font-bold text-[var(--fg-1)]">เพิ่มสินค้าใหม่</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--bg)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[var(--fg-3)]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

            {/* ── Section: ข้อมูลพื้นฐาน ── */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-[var(--fg-4)] uppercase tracking-wider">ข้อมูลพื้นฐาน</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">SKU *</label>
                  <input
                    type="text"
                    value={formData.sku}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    className="phopy-input w-full"
                    placeholder="RAW-001"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">ประเภทสินค้า</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="phopy-input w-full"
                  >
                    <option value="raw">วัตถุดิบ</option>
                    <option value="wip">กึ่งสำเร็จรูป</option>
                    <option value="finished">สำเร็จรูป</option>
                    <option value="material">วัสดุ/อื่นๆ</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--fg-3)] mb-1">ชื่อสินค้า *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="phopy-input w-full"
                  placeholder="กรอกชื่อสินค้า"
                  required
                />
              </div>
            </div>

            {/* ── Section: หน่วยนับ ── */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-[var(--fg-4)] uppercase tracking-wider">หน่วยนับ</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">หน่วยบรรจุ</label>
                  <select
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    className="phopy-input w-full"
                  >
                    {availableUnits.map((u) => (
                      <option key={u.value} value={u.value}>{u.label} ({u.value})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">จำนวนเริ่มต้น</label>
                  <input
                    type="number"
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 })}
                    onFocus={(e) => e.target.select()}
                    className="phopy-input w-full"
                    min="0"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">หน่วยฐาน</label>
                  <select
                    value={formData.baseUnit || ''}
                    onChange={(e) => setFormData({ ...formData, baseUnit: e.target.value })}
                    className="phopy-input w-full"
                  >
                    <option value="">— ยังไม่ได้เลือก —</option>
                    {availableUnits.map((u) => (
                      <option key={u.value} value={u.value}>{u.label} ({u.value})</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-[var(--fg-4)] mt-1">เช่น ขวด, pcs, g, ml</p>
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">หน่วยบรรจุ</label>
                  <select
                    value={formData.displayUnit || ''}
                    onChange={(e) => setFormData({ ...formData, displayUnit: e.target.value })}
                    className="phopy-input w-full"
                  >
                    <option value="">— ยังไม่ได้เลือก —</option>
                    {availableUnits.map((u) => (
                      <option key={u.value} value={u.value}>{u.label} ({u.value})</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-[var(--fg-4)] mt-1">เช่น ลัง, กล่อง, ถุง</p>
                </div>
              </div>
              {addConversionWarning && (
                <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-300">{addConversionWarning}</p>
                </div>
              )}
            </div>

            {/* ── Section: ราคา & สต๊อก ── */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-[var(--fg-4)] uppercase tracking-wider">ราคา & สต๊อก</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">ราคาที่ซื้อมา (฿)</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      value={formData.purchasePrice}
                      onChange={(e) => setFormData({ ...formData, purchasePrice: parseFloat(e.target.value) || 0 })}
                      onFocus={(e) => e.target.select()}
                      className="phopy-input flex-1 min-w-0"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                    />
                    <div className="w-24 shrink-0">
                      <UnitPicker
                        value={formData.purchaseUnit}
                        onChange={(unit) => setFormData({ ...formData, purchaseUnit: unit })}
                        baseUnit={formData.baseUnit || formData.unit}
                        restrict="warn"
                        size="sm"
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">ราคาขาย/หน่วยฐาน (฿)</label>
                  <input
                    type="number"
                    value={formData.unitPrice}
                    onChange={(e) => setFormData({ ...formData, unitPrice: parseFloat(e.target.value) || 0 })}
                    onFocus={(e) => e.target.select()}
                    className="phopy-input w-full"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">ต่ำกว่านี้ต้องสั่งเพิ่ม</label>
                  <input
                    type="number"
                    value={formData.minStock}
                    onChange={(e) => setFormData({ ...formData, minStock: parseInt(e.target.value) || 0 })}
                    onFocus={(e) => e.target.select()}
                    className="phopy-input w-full"
                    min="0"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">เก็บได้มากสุด</label>
                  <input
                    type="number"
                    value={formData.maxStock}
                    onChange={(e) => setFormData({ ...formData, maxStock: parseInt(e.target.value) || 0 })}
                    onFocus={(e) => e.target.select()}
                    className="phopy-input w-full"
                    min="0"
                  />
                </div>
              </div>
            </div>

            {/* ── Section: อื่นๆ ── */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-[var(--fg-4)] uppercase tracking-wider">อื่นๆ</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">สถานที่เก็บ</label>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className="phopy-input w-full"
                    placeholder="คลังหลัก, A-12"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1">GS1 Barcode</label>
                  <input
                    type="text"
                    value={formData.gs1Barcode}
                    onChange={(e) => setFormData({ ...formData, gs1Barcode: e.target.value })}
                    className="phopy-input w-full"
                    placeholder="ไม่บังคับ"
                  />
                </div>
              </div>
              <label className="flex items-center gap-3 p-2.5 bg-[var(--surface-2)] rounded-lg border border-[var(--border)] cursor-pointer hover:border-phopy-indigo/50 transition-colors">
                <input
                  type="checkbox"
                  id="isPosEnabledAdd"
                  checked={formData.isPosEnabled}
                  onChange={(e) => setFormData({ ...formData, isPosEnabled: e.target.checked })}
                  className="w-4 h-4 rounded border-[var(--border)] bg-[var(--bg)] text-[var(--primary)] focus:ring-phopy-indigo"
                />
                <div className="flex-1">
                  <p className="text-sm text-[var(--fg-2)] font-medium">แสดงใน POS</p>
                  <p className="text-[10px] text-[var(--fg-4)]">เพิ่มสินค้านี้เข้าเมนูขาย</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${formData.isPosEnabled ? 'bg-[var(--success-soft)] text-success' : 'bg-[var(--surface-2)] text-[var(--fg-3)]'}`}>
                  {formData.isPosEnabled ? 'เปิด' : 'ปิด'}
                </span>
              </label>
            </div>

          </div>

          {/* Footer — sticky */}
          <div className="px-5 py-3 border-t border-[var(--border)] flex gap-3 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-3)] hover:text-[var(--fg-2)] hover:border-[var(--border-strong)] transition-colors text-sm"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 phopy-btn-primary flex items-center justify-center gap-2 text-sm py-2"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              สร้างรายการ
            </button>
          </div>
        </form>

      </div>
    </div>
  )
}

export default Stock
