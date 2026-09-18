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
type ColumnKey = 'image' | 'name' | 'sku' | 'category' | 'quantity' | 'displayQty' | 'baseUnit' | 'displayUnit' | 'minmax' | 'purchasePrice' | 'unitPrice' | 'location' | 'status'

const COLUMN_LABELS: Record<ColumnKey, string> = {
  image: 'รูปภาพ',
  name: 'ชื่อสินค้า',
  sku: 'SKU',
  category: 'ประเภท',
  quantity: 'จำนวน',
  displayQty: 'จำนวนบรรจุ',
  baseUnit: 'หน่วยฐาน',
  displayUnit: 'หน่วยบรรจุ',
  minmax: 'Min/Max',
  purchasePrice: 'ราคาที่ซื้อมา',
  unitPrice: 'ราคาขาย/หน่วยฐาน',
  location: 'สถานที่',
  status: 'สถานะ',
}
// คำอธิบายสั้น ๆ ใต้ชื่อคอลัมน์ — แต่ละร้านดูตัวเลขคนละชุด ต้องรู้ว่าแต่ละอันคืออะไรก่อนเลือก
const COLUMN_HINTS: Partial<Record<ColumnKey, string>> = {
  image: 'เห็นของก่อนอ่านชื่อ เร็วกว่ามาก',
  sku: 'รหัสสินค้าที่ใช้อ้างอิงในเอกสาร',
  category: 'วัตถุดิบ / สำเร็จรูป / บริการ',
  quantity: 'ปิดไม่ได้ — เป็นหัวใจของหน้านี้',
  displayQty: 'จำนวนตามหน่วยบรรจุ เช่น 3 ลัง',
  baseUnit: 'หน่วยที่ระบบใช้ตัดสต็อกจริง',
  displayUnit: 'หน่วยที่คนใช้เรียกกันหน้างาน',
  minmax: 'จุดสั่งซื้อและเพดานที่ตั้งไว้',
  purchasePrice: 'ราคาล่าสุดที่ซื้อเข้ามา',
  unitPrice: 'ราคาขายต่อหน่วยฐาน',
  location: 'ชั้นวาง / ตู้แช่',
  status: 'หมด / ใกล้หมด / ปกติ',
}
const ALWAYS_VISIBLE: ColumnKey[] = ['name', 'quantity', 'status']

function getDefaultCols(): Record<ColumnKey, boolean> {
  const saved = localStorage.getItem('stock_columns')
  if (saved) return JSON.parse(saved)
  return { image: true, name: true, sku: true, category: true, quantity: true, displayQty: false, baseUnit: false, displayUnit: false, minmax: false, purchasePrice: true, unitPrice: true, location: false, status: true }
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
    localStorage.setItem('stock_columns', JSON.stringify(next))
  }

  const colSpanCount = (Object.keys(visibleCols) as ColumnKey[]).filter(k => visibleCols[k]).length + 1 // +1 for actions

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(50)

  // Sort states
  const [sortKey, setSortKey] = useState<ColumnKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const handleSort = (key: ColumnKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

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
      case 'sku': aVal = a.sku; bVal = b.sku; break
      case 'category': aVal = getCategoryGroup(a.category); bVal = getCategoryGroup(b.category); break
      case 'quantity': aVal = a.quantity; bVal = b.quantity; break
      case 'displayQty': aVal = a.sealedQty ?? 0; bVal = b.sealedQty ?? 0; break
      case 'baseUnit': aVal = a.baseUnit || a.unit || ''; bVal = b.baseUnit || b.unit || ''; break
      case 'displayUnit': aVal = a.displayUnit || a.unit || ''; bVal = b.displayUnit || b.unit || ''; break
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

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`ยืนยันลบ ${selectedIds.size} รายการ? การกระทำนี้ไม่สามารถย้อนกลับได้`)) return
    try {
      await Promise.all([...selectedIds].map(id => stockService.delete(id)))
      toast.success(`ลบ ${selectedIds.size} รายการเรียบร้อย`)
      setSelectedIds(new Set())
      loadData()
    } catch {
      toast.error('ลบบางรายการไม่สำเร็จ กรุณาลองใหม่')
    }
  }

  const handleSelectAll = () => {
    if (selectedIds.size === paginatedItems.length && paginatedItems.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(paginatedItems.map(i => i.id)))
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
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {/* แบบร่างให้สรุปทุกอย่างไว้บรรทัดเดียวใต้หัวเรื่อง แทนการ์ดใหญ่ 4-5 ใบ
              ที่กินความสูงจนตารางเหลือพื้นที่น้อย — ตัวเลขชุดเดียวกันเป๊ะ แค่ย้ายที่ */}
          <h1 className="text-2xl leading-8 font-bold text-[var(--fg-1)] mb-1">คลังสินค้า</h1>
          <p className="text-[var(--fg-3)] text-sm">
            {(stats?.totalItems ?? 0).toLocaleString('th-TH')} รายการ
            <span className="mx-1.5 text-[var(--fg-4)]">·</span>
            มูลค่ารวม ฿{(stats?.totalValue ?? 0).toLocaleString('th-TH')}
            {(stats?.lowStockCount ?? 0) > 0 && (
              <><span className="mx-1.5 text-[var(--fg-4)]">·</span>
              <span className="text-warning">ใกล้หมด {(stats?.lowStockCount ?? 0).toLocaleString('th-TH')}</span></>
            )}
            {(stats?.criticalCount ?? 0) > 0 && (
              <><span className="mx-1.5 text-[var(--fg-4)]">·</span>
              <span className="text-danger">วิกฤต {(stats?.criticalCount ?? 0).toLocaleString('th-TH')}</span></>
            )}
            {showSubconStockWidget && (
              <><span className="mx-1.5 text-[var(--fg-4)]">·</span>
              ผู้รับเหมา ฿{(subconStock?.summary.total_value ?? 0).toLocaleString('th-TH')}</>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end items-center">
          {/* Utility */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleExport}
            className="phopy-btn-secondary flex items-center gap-2 text-sm"
          >
            <FileDown className="w-4 h-4" />
            Export
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowImportModal(true)}
            className="phopy-btn-secondary flex items-center gap-2 text-sm"
          >
            <Upload className="w-4 h-4" />
            Import
          </motion.button>

          {/* Divider */}
          <div className="w-px h-8 bg-[var(--border)]" />

          {/* Stock movement group */}
          <div className="flex rounded-xl overflow-hidden border border-[var(--border)]">
            <button
              onClick={() => setAdjustModal({ open: true, item: null })}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-colors"
              title="ปรับสต๊อก"
            >
              <SlidersHorizontal className="w-4 h-4" />
              ปรับสต๊อก
            </button>
            <button
              onClick={() => setAdjLogModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-[var(--fg-2)] hover:bg-[var(--bg)] transition-colors border-l border-[var(--border)]"
              title="ทะเบียนการปรับสต็อก — ใครปรับอะไร เพราะอะไร เป็นเงินเท่าไร"
            >
              <History className="w-4 h-4" />
              ทะเบียนปรับ
            </button>
          </div>

          {/* Add Item — primary CTA */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowAddModal(true)}
            className="phopy-btn-primary flex items-center gap-2 text-sm"
          >
            <Plus className="w-4 h-4" />
            เพิ่มสินค้า
          </motion.button>
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
      {/* Filters */}
      <div className="phopy-card rounded-[14px] p-6">
        <div className="flex flex-col gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-3)]" aria-hidden="true" />
            <input
              type="search"
              placeholder="ค้นชื่อ หรือรหัสสินค้า…"
              aria-label="ค้นหาสินค้า"
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="phopy-input pl-10 w-full"
            />
          </div>

          {/* แถบกรองแถวเดียว — เดิมเป็น 2 บล็อกซ้อนกันพร้อมหัวข้อกำกับ สูงรวมราว 110px
              ชิปมันอ่านออกด้วยตัวเองอยู่แล้ว หัวข้อจึงเป็นแค่ที่กินพื้นที่เปล่า ๆ
              พ่วงจำนวนไว้ท้ายชิปด้วย จะได้รู้ว่ากดแล้วเจออะไรก่อนกด */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1.5 flex-wrap">
              <FilterButton label="ทั้งหมด" count={chipCounts.cat.all} active={selectedCategory === 'all'} onClick={() => handleCategoryChange('all')} />
              <FilterButton label="วัตถุดิบ" count={chipCounts.cat.raw} active={selectedCategory === 'raw'} onClick={() => handleCategoryChange('raw')} />
              <FilterButton label="กึ่งสำเร็จรูป" count={chipCounts.cat.wip} active={selectedCategory === 'wip'} onClick={() => handleCategoryChange('wip')} />
              <FilterButton label="สำเร็จรูป" count={chipCounts.cat.finished} active={selectedCategory === 'finished'} onClick={() => handleCategoryChange('finished')} />
              <FilterButton label="บริการ" count={chipCounts.cat.service} active={selectedCategory === 'service'} onClick={() => handleCategoryChange('service')} />
              <FilterButton label="วัสดุ/อื่นๆ" count={chipCounts.cat.material} active={selectedCategory === 'material'} onClick={() => handleCategoryChange('material')} />
            </div>
            <span className="hidden sm:block w-px h-6 bg-[var(--border)] shrink-0" />
            <div className="flex gap-1.5 flex-wrap">
              <FilterButton label="ทุกสถานะ" count={chipCounts.st.all} active={selectedStatus === 'all'} onClick={() => handleStatusChange('all')} />
              <FilterButton label="หมด" tone="danger" count={chipCounts.st.out} active={selectedStatus === 'out'} onClick={() => handleStatusChange('out')} />
              <FilterButton label="วิกฤต" tone="danger" count={chipCounts.st.critical} active={selectedStatus === 'critical'} onClick={() => handleStatusChange('critical')} />
              <FilterButton label="ต่ำ" tone="warning" count={chipCounts.st.low} active={selectedStatus === 'low'} onClick={() => handleStatusChange('low')} />
              <FilterButton label="ใกล้หมด" tone="warning" count={chipCounts.st.nearLow} active={selectedStatus === 'nearLow'} onClick={() => handleStatusChange('nearLow')} />
              <FilterButton label="ยังไม่แกะ" count={chipCounts.st.sealed} active={selectedStatus === 'sealed'} onClick={() => handleStatusChange('sealed')} />
              <FilterButton label="เกิน" count={chipCounts.st.overstock} active={selectedStatus === 'overstock'} onClick={() => handleStatusChange('overstock')} />
            </div>
          </div>
        </div>
      </div>

      {/* Stock List */}
      <div className="phopy-card rounded-2xl p-6">
        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 mb-3 p-3 bg-phopy-indigo/10 border border-phopy-indigo/30 rounded-xl">
            <span className="text-[var(--primary)] text-sm font-semibold">{selectedIds.size} รายการที่เลือก</span>
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--danger-soft)] text-danger border border-danger/30 rounded-lg text-sm hover:bg-[var(--danger-soft)] transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              ลบที่เลือก
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-[var(--fg-3)] hover:text-[var(--fg-2)] transition-colors ml-auto"
            >
              ยกเลิก
            </button>
          </div>
        )}

        {/* Table toolbar */}
        <div className="flex items-center justify-end mb-3 relative">
          <button
            onClick={() => setShowColumnPicker(v => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors ${showColumnPicker ? 'border-phopy-indigo text-[var(--primary)] bg-phopy-indigo/10' : 'border-[var(--border)] text-[var(--fg-3)] hover:border-phopy-indigo/50 hover:text-[var(--fg-2)]'}`}
          >
            <Settings2 className="w-4 h-4" />
            ปรับคอลัมน์
            <span className="px-1.5 py-0.5 rounded-md bg-[var(--surface-2)] text-[var(--fg-3)] text-xs tabular-nums">
              {Object.values(visibleCols).filter(Boolean).length}/{Object.keys(COLUMN_LABELS).length}
            </span>
          </button>

          {/* Column picker dropdown */}
          {showColumnPicker && (
            <div
              className="absolute top-10 right-0 z-30 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl p-3 w-[268px]"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-xs text-[var(--fg-3)] mb-2 px-1">เลือกคอลัมน์ที่อยากเห็น</p>
              <p className="text-[10px] text-[var(--fg-4)] mb-2 px-1">จำไว้ให้เป็นรายคน — เปิดครั้งหน้าได้ชุดเดิม</p>
              {(Object.keys(COLUMN_LABELS) as ColumnKey[]).map((key) => {
                const always = ALWAYS_VISIBLE.includes(key)
                const active = visibleCols[key]
                return (
                  <button
                    key={key}
                    onClick={() => toggleCol(key)}
                    disabled={always}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-left transition-colors mb-0.5 ${
                      always ? 'opacity-50 cursor-not-allowed' :
                      active ? 'bg-phopy-indigo/10 text-[var(--primary)]' : 'text-[var(--fg-3)] hover:bg-[var(--bg)] hover:text-[var(--fg-2)]'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${active ? 'bg-phopy-indigo border-phopy-indigo' : 'border-[var(--border-strong)]'}`}>
                      {active && <Check className="w-3 h-3 text-black" />}
                    </span>
                    <span className="flex-1 min-w-0 text-left">
                      <span className="block">{COLUMN_LABELS[key]}</span>
                      {COLUMN_HINTS[key] && (
                        <span className="block text-[11px] leading-[15px] text-[var(--fg-4)] font-normal">{COLUMN_HINTS[key]}</span>
                      )}
                    </span>
                    {always && <Lock className="w-3 h-3 text-[var(--fg-4)] shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="overflow-x-auto" onClick={() => setShowColumnPicker(false)}>
          <table className="phopy-table">
            <thead>
              <tr>
                <th className="w-10">
                  <label className="relative cursor-pointer flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={paginatedItems.length > 0 && selectedIds.size === paginatedItems.length}
                      onChange={handleSelectAll}
                      className="sr-only"
                      aria-label="เลือกทั้งหมด"
                    />
                    {(() => {
                      const allSel = paginatedItems.length > 0 && selectedIds.size === paginatedItems.length
                      const someSel = selectedIds.size > 0 && selectedIds.size < paginatedItems.length
                      const active = allSel || someSel
                      return (
                        <div className={`w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-all duration-150 ${active ? 'bg-[var(--primary)] border-[var(--primary)]' : 'bg-transparent border-[var(--border)] hover:border-[var(--primary)]/60'}`}>
                          <motion.div initial={false} animate={{ scale: active ? 1 : 0, opacity: active ? 1 : 0 }} transition={{ duration: 0.12, type: 'spring', stiffness: 400, damping: 20 }}>
                            {someSel && !allSel
                              ? <div className="w-2 h-0.5 bg-white rounded-full" />
                              : <Check className="w-2.5 h-2.5 text-white" strokeWidth={3.5} />}
                          </motion.div>
                        </div>
                      )
                    })()}
                  </label>
                </th>
                {visibleCols.image && <th className="w-14"></th>}
                {visibleCols.name && <SortTh label="ชื่อสินค้า" colKey="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.sku && <SortTh label="SKU" colKey="sku" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.category && <SortTh label="ประเภท" colKey="category" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.quantity && <SortTh label="จำนวน" colKey="quantity" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} hint={t('stock.unpack.looseHint')} />}
                {visibleCols.baseUnit && <SortTh label="หน่วยฐาน" colKey="baseUnit" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.displayQty && <SortTh label="จำนวนบรรจุ" colKey="displayQty" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} hint={t('stock.unpack.sealedHint')} />}
                {visibleCols.displayUnit && <SortTh label="หน่วยบรรจุ" colKey="displayUnit" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.minmax && <th>Min / Max</th>}
                {visibleCols.purchasePrice && <SortTh label="ราคาที่ซื้อมา" colKey="purchasePrice" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.unitPrice && <SortTh label="ราคาขาย/หน่วย" colKey="unitPrice" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.location && <SortTh label="สถานที่" colKey="location" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.status && <SortTh label="สถานะ" colKey="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={colSpanCount + 1} className="text-center py-8 text-[var(--fg-4)]">
                    ไม่พบสินค้าที่ค้นหา
                  </td>
                </tr>
              ) : (
                paginatedItems.map((item, index) => {
                  const status = getItemStatus(item)
                  const purchasePrice = item.purchasePrice ?? 0
                  const price = item.unitPrice ?? 0
                  const isSelected = selectedIds.has(item.id)
                  return (
                    <motion.tr
                      key={item.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(index * 0.03, 0.3) }}
                      className={isSelected ? 'bg-phopy-indigo/5' : ''}
                    >
                      <td className="w-10">
                        <label className="relative cursor-pointer flex items-center justify-center" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelect(item.id)}
                            className="sr-only"
                            aria-label={`เลือก ${item.name}`}
                          />
                          <div className={`w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-all duration-150 ${isSelected ? 'bg-[var(--primary)] border-[var(--primary)]' : 'bg-transparent border-[var(--border)] hover:border-[var(--primary)]/60 hover:bg-[var(--primary)]/5'}`}>
                            <motion.div initial={false} animate={{ scale: isSelected ? 1 : 0, opacity: isSelected ? 1 : 0 }} transition={{ duration: 0.12, type: 'spring', stiffness: 400, damping: 20 }}>
                              <Check className="w-2.5 h-2.5 text-white" strokeWidth={3.5} />
                            </motion.div>
                          </div>
                        </label>
                      </td>
                      {visibleCols.image && (
                        <td className="w-14">
                          {/* ไม่มีรูปก็กดเพิ่มตรงนี้ได้เลย เดิมต้องเข้าโมดัลแก้ไขก่อน
                              ซึ่งไม่มีใครทำ สินค้าเลยไม่มีรูปกันเกือบทั้งคลัง */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRowImage(item) }}
                            aria-label={item.imageUrl ? `ดูรูป ${item.name}` : `เพิ่มรูป ${item.name}`}
                            title={item.imageUrl ? item.name : `เพิ่มรูป ${item.name}`}
                            className="w-10 h-10 rounded-lg border border-[var(--border)] overflow-hidden flex items-center justify-center bg-[var(--bg)] hover:border-phopy-indigo transition-colors cursor-pointer"
                          >
                            {item.imageUrl
                              ? <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                              : <Plus className="w-4 h-4 text-[var(--fg-4)]" />}
                          </button>
                        </td>
                      )}

                      {visibleCols.name && (
                        <td>
                          {/* คลิกชื่อ = เปิดรายละเอียด แทนไอคอนรูปตาที่เอาออกแล้ว
                              กฎเดียวกับหน้าจัดซื้อที่คลิกเลขที่เอกสารเพื่อเปิดใบ */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleOpenDetail(item) }}
                            className="text-left font-medium text-[var(--primary)] hover:underline cursor-pointer"
                          >
                            {item.name}
                          </button>
                        </td>
                      )}
                      {visibleCols.sku && (
                        <td>
                          <span className="text-[var(--fg-3)] font-mono text-sm">{item.sku}</span>
                        </td>
                      )}
                      {visibleCols.category && (
                        <td><CategoryBadge category={item.category} /></td>
                      )}
                      {visibleCols.quantity && (
                        <td>
                          <div className="flex flex-col gap-0.5">
                            {/* แกะแล้ว พร้อมใช้ทันที = หน่วยฐาน */}
                            <span
                              className={`font-semibold ${item.quantity === 0 ? 'text-danger' : 'text-[var(--primary)]'}`}
                              title={t('stock.unpack.looseHint')}
                            >
                              {item.quantity} {unitLabel(item.baseUnit || item.unit)}
                            </span>
                            {/* ถ้ามีแพ็คยังไม่แกะ ให้แสดงเป็น secondary info + ยอดรวมทั้งหมด */}
                            {(item.sealedQty ?? 0) > 0 && (
                              <>
                                {item.canUnpack ? (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setUnpackModal({ open: true, item }) }}
                                    className="text-xs text-[var(--warning)] hover:underline text-left flex items-center gap-1"
                                    title="แกะแพ็คเพื่อนำมาใช้"
                                  >
                                    <PackageOpen className="w-3 h-3 shrink-0" />
                                    ยังไม่แกะ {item.sealedQty} {unitLabel(item.displayUnit || item.unit)}
                                  </button>
                                ) : (
                                  <span className="text-xs text-[var(--warning)]" title="ยังตั้งหน่วยบรรจุไม่ครบ จึงแกะแพ็คไม่ได้">
                                    ยังไม่แกะ {item.sealedQty} {unitLabel(item.displayUnit || item.unit)}
                                  </span>
                                )}
                                <span
                                  className="text-[10px] text-[var(--fg-4)]"
                                  title={t('stock.unpack.totalHint')}
                                >
                                  {t('stock.unpack.totalInline', { value: availableOf(item), unit: unitLabel(item.baseUnit || item.unit) })}
                                </span>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                      {visibleCols.baseUnit && (
                        <td>
                          <span className="text-[var(--fg-2)] text-sm">{unitLabel(item.baseUnit || item.unit)}</span>
                        </td>
                      )}
                      {visibleCols.displayQty && (
                        <td>
                          <span className={`font-semibold ${(item.sealedQty ?? 0) === 0 ? 'text-[var(--fg-4)]' : 'text-[var(--primary)]'}`}>
                            {item.sealedQty ?? 0} {unitLabel(item.displayUnit || item.unit)}
                          </span>
                        </td>
                      )}
                      {visibleCols.displayUnit && (
                        <td>
                          <span className="text-[var(--fg-2)] text-sm">{unitLabel(item.displayUnit || item.unit)}</span>
                        </td>
                      )}
                      {visibleCols.minmax && (
                        <td>
                          <span className="text-[var(--fg-3)] text-sm">{item.minStock} / {item.maxStock}</span>
                        </td>
                      )}
                      {visibleCols.purchasePrice && (
                        <td>
                          <span className="text-amber-400 text-sm font-medium">
                            {purchasePrice ? `฿${Number(purchasePrice).toLocaleString()}/${unitLabel(item.purchaseUnit || item.baseUnit || item.unit || 'หน่วย')}` : '-'}
                          </span>
                        </td>
                      )}
                      {visibleCols.unitPrice && (
                        <td>
                          <span className="text-success text-sm font-medium">
                            {price ? `฿${Number(price).toLocaleString()}/${unitLabel(item.baseUnit || item.unit || 'หน่วย')}` : '-'}
                          </span>
                        </td>
                      )}
                      {visibleCols.location && (
                        <td>
                          <span className="text-[var(--fg-3)] text-sm">{item.location || '-'}</span>
                        </td>
                      )}
                      {visibleCols.status && (
                        <td><StatusBadge status={status} /></td>
                      )}
                      <td>
                        <div className="flex items-center gap-1">

                          <button
                            onClick={() => setEditModal({ open: true, item })}
                            className="p-2 text-[var(--fg-3)] hover:text-warning hover:bg-[var(--warning-soft)] rounded-lg transition-colors cursor-pointer"
                            aria-label={`แก้ไข ${item.name}`}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setAdjustModal({ open: true, item })}
                            className="p-2 text-[var(--fg-3)] hover:text-blue-400 hover:bg-blue-400/10 rounded-lg transition-colors cursor-pointer"
                            aria-label={`ปรับสต๊อก ${item.name}`}
                            title="ปรับสต๊อก"
                          >
                            <SlidersHorizontal className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-[var(--border)]">
          <div className="flex items-center gap-4">
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
              className="px-3 py-1 text-sm rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-2)] hover:border-phopy-indigo disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
              className="px-3 py-1 text-sm rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-2)] hover:border-phopy-indigo disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              หน้าสุดท้าย
            </button>
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      <DetailModal
        open={detailModal.open}
        item={detailModal.item}
        onClose={() => setDetailModal({ open: false, item: null })}
        onUnpack={(it) => {
          setDetailModal({ open: false, item: null })
          setUnpackModal({ open: true, item: it })
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
  item,
  onClose,
}: {
  open: boolean
  onUnpack?: (item: StockItem) => void
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
  useEffect(() => {
    if (!open || !item) return
    setPics(item.imageUrl ? [item.imageUrl] : [])
    api.get(`/stock/${item.id}/cost-basis`)
      .then(r => setCostBasis(r.data?.data ?? null))
      .catch(() => setCostBasis(null))
  }, [open, item?.id])
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
                    <p className="text-xs text-[var(--fg-4)]">{c.label}</p>
                    <p className="text-lg font-bold text-[var(--fg-1)] leading-tight tabular-nums">{c.value}</p>
                    <p className="text-[11px] text-[var(--fg-4)] mt-0.5 leading-tight">{c.sub}</p>
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
      </div>
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
  const [activeTab, setActiveTab] = useState<'general' | 'units'>(initialTab)
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
      setActiveTab(initialTab)
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

  return (
    <>
      <div
        className="fixed inset-0 bg-[var(--fg-1)]/60 flex items-center justify-center z-50 p-4 animate-fadeIn"
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="phopy-card w-full max-w-lg flex flex-col animate-scaleIn"
          style={{ maxHeight: 'calc(100vh - 2rem)' }}
        >
          {/* Header — sticky */}
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between flex-shrink-0">
            <div>
              <h2 className="text-lg font-bold text-[var(--fg-1)]">แก้ไขสินค้า</h2>
              <p className="text-xs text-[var(--fg-4)] mt-0.5">{item.sku} · {item.name}</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg transition-colors">
              <X className="w-5 h-5 text-[var(--fg-3)]" />
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-[var(--border)] flex-shrink-0">
            {(['general', 'units'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === tab
                    ? 'text-[var(--primary)] border-phopy-indigo'
                    : 'text-[var(--fg-4)] border-transparent hover:text-[var(--fg-2)]'
                }`}
              >
                {tab === 'general' ? 'ทั่วไป' : 'หน่วย'}
              </button>
            ))}
          </div>

          {/* Scrollable body */}
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

              {/* ── GENERAL TAB ── */}
              {activeTab === 'general' && (
                <>
                  {/* Image + Name row */}
                  <div className="flex gap-3 items-start">
                    <label className="cursor-pointer flex-shrink-0">
                      <div className="w-20 h-20 rounded-xl border-2 border-dashed border-[var(--border)] hover:border-phopy-indigo/60 flex items-center justify-center overflow-hidden bg-[var(--bg)] transition-colors relative group">
                        {imagePreview ? (
                          <>
                            <img src={imagePreview} alt="preview" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-[var(--fg-1)]/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <Upload className="w-5 h-5 text-white" />
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col items-center gap-1">
                            <ImagePlus className="w-6 h-6 text-[var(--fg-4)]" />
                            <span className="text-[10px] text-[var(--fg-4)]">อัปโหลด</span>
                          </div>
                        )}
                      </div>
                      <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                    </label>
                    <div className="flex-1">
                      <label className="block text-xs text-[var(--fg-3)] mb-1.5">ชื่อสินค้า <span className="text-danger">*</span></label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="phopy-input w-full"
                        required
                      />
                      {imagePreview && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (!item) return
                            if (confirm('ลบรูปภาพ?')) {
                              await stockService.deleteImage(item.id)
                              setImagePreview(null)
                              setImageFile(null)
                              onSave()
                            }
                          }}
                          className="mt-1.5 text-xs text-danger hover:text-red-300 flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" /> ลบรูปภาพ
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Category */}
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1.5">ประเภท</label>
                    <select
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      className="phopy-input w-full"
                      required
                    >
                      <option value="raw">วัตถุดิบ (Raw)</option>
                      <option value="wip">กำลังผลิต (WIP)</option>
                      <option value="finished">สำเร็จรูป (Finished)</option>
                      <option value="material">วัสดุสิ้นเปลือง</option>
                    </select>
                  </div>

                  {/* Cost + Price */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[var(--fg-3)] mb-1.5">
                        ราคาที่ซื้อมา (฿)
                      </label>
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
                        ราคาขาย/หน่วยฐาน (฿)
                        <span className="ml-1 text-success/70">ต่อ {unitLabel(formData.baseUnit || formData.unit || 'หน่วยฐาน')}</span>
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

                  {/* Min/Max Stock */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[var(--fg-3)] mb-1.5">สต็อกขั้นต่ำ</label>
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
                      <label className="block text-xs text-[var(--fg-3)] mb-1.5">สต็อกสูงสุด</label>
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

                  {/* Location + Barcode */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[var(--fg-3)] mb-1.5">สถานที่เก็บ</label>
                      <input
                        type="text"
                        value={formData.location}
                        onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                        className="phopy-input w-full"
                        placeholder="เช่น คลังหลัก"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--fg-3)] mb-1.5">GS1 Barcode</label>
                      <input
                        type="text"
                        value={formData.gs1Barcode}
                        onChange={(e) => setFormData({ ...formData, gs1Barcode: e.target.value })}
                        className="phopy-input w-full"
                        placeholder="ไม่บังคับ"
                      />
                    </div>
                  </div>

                  {/* POS toggle */}
                  <label className="flex items-center gap-3 p-3 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] cursor-pointer hover:border-phopy-indigo/50 transition-colors">
                    <input
                      type="checkbox"
                      id="isPosEnabled"
                      checked={formData.isPosEnabled}
                      onChange={(e) => setFormData({ ...formData, isPosEnabled: e.target.checked })}
                      className="w-5 h-5 rounded border-[var(--border)] bg-[var(--bg)] text-[var(--primary)] focus:ring-phopy-indigo"
                    />
                    <div className="flex-1">
                      <p className="text-sm text-[var(--fg-2)] font-medium">แสดงใน POS</p>
                      <p className="text-xs text-[var(--fg-4)]">เพิ่มสินค้านี้เข้าเมนูขาย</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${formData.isPosEnabled ? 'bg-[var(--success-soft)] text-success' : 'bg-[var(--surface-2)] text-[var(--fg-3)]'}`}>
                      {formData.isPosEnabled ? 'เปิด' : 'ปิด'}
                    </span>
                  </label>
                </>
              )}

              {/* ── UNITS TAB ── */}
              {activeTab === 'units' && (
                <>
                  {/* สายหน่วยทั้งเส้น — ซื้อมาเป็นอะไร เก็บเป็นอะไร (หน่วยซื้อแก้ได้ที่แท็บทั่วไป คู่กับราคา) */}
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
                    <p className="text-xs text-[var(--fg-3)] mb-2">สายหน่วยของสินค้านี้</p>
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="px-2.5 py-1 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-1)]">
                        ซื้อเป็น {formData.purchaseUnit ? ul(formData.purchaseUnit) : '—'}
                      </span>
                      <span className="text-[var(--fg-4)]">→</span>
                      <span className="px-2.5 py-1 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-1)]">
                        เก็บเป็น {formData.displayUnit ? ul(formData.displayUnit) : '—'}
                      </span>
                      <span className="text-[var(--fg-4)]">→</span>
                      <span className="px-2.5 py-1 rounded-lg bg-[var(--primary)]/10 border border-[var(--primary)]/30 text-[var(--primary)] font-medium">
                        นับเป็น {formData.baseUnit ? ul(formData.baseUnit) : '—'}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--fg-4)] mt-2">
                      ทุกช่วงที่หน่วยเปลี่ยน ต้องมีสูตรแปลงด้านล่าง ไม่งั้นระบบรับของเข้าคลังไม่ได้
                      · หน่วยซื้อแก้ได้ที่แท็บ "ทั่วไป" คู่กับราคาที่ซื้อมา
                    </p>
                  </div>

                  {/* ช่อง "หน่วยสินค้า (Legacy)" ถูกเอาออกแล้ว — คอลัมน์ stock_items.unit เป็นของเก่า
    ก่อนมีระบบหน่วย ตอนนี้ backend sync ให้เท่ากับ base_unit อัตโนมัติทุกครั้งที่บันทึก
    การเปิดช่องนี้ให้แก้ทำให้ค่าถูกเขียนทับสวนทางกับหน่วยฐานจนสต็อกคิดผิด */}

                  {/* Base Unit + Display Unit */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[var(--fg-3)] mb-1.5">
                        หน่วยที่คลังนับ <span className="text-[var(--fg-4)]">หน่วยย่อยสุด</span>
                      </label>
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
                      <p className="text-xs text-[var(--fg-4)] mt-1">ตัวเลขสต็อกทั้งระบบนับเป็นหน่วยนี้ · เช่น กรัม ชิ้น มิลลิลิตร</p>
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--fg-3)] mb-1.5">
                        หน่วยบรรจุ <span className="text-[var(--fg-4)]">ที่ยังไม่แกะ</span>
                      </label>
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
                      <p className="text-xs text-[var(--fg-4)] mt-1">ของที่มาเป็นแพ็คแล้วต้องแกะก่อนใช้ · เช่น ลัง กล่อง ถุง</p>
                    </div>
                  </div>

                  {/* Conversion Warning */}
                  {conversionWarning && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm text-amber-300">{conversionWarning}</p>
                        <button
                          type="button"
                          onClick={() => setConvExpanded(true)}
                          className="text-xs text-amber-400 hover:text-amber-300 underline mt-1"
                        >
                          คลิกเพื่อเพิ่มการแปลงหน่วย
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Unit Conversions (per-material) */}
                  <div className="rounded-xl border border-[var(--border)] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setConvExpanded(v => !v)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-[var(--surface-2)] hover:bg-[var(--bg)]/70 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <ArrowUpCircle className="w-4 h-4 text-purple-400" style={{ transform: 'rotate(90deg)' }} />
                        <span className="text-sm font-medium text-[var(--fg-2)]">การแปลงหน่วยเฉพาะสินค้านี้</span>
                        {itemConversions.length > 0 && (
                          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 text-xs rounded-full">
                            {itemConversions.length} รายการ
                          </span>
                        )}
                      </div>
                      {convExpanded
                        ? <ChevronUp className="w-4 h-4 text-[var(--fg-4)]" />
                        : <ChevronDown className="w-4 h-4 text-[var(--fg-4)]" />}
                    </button>

                    {convExpanded && (
                      <div className="p-3 space-y-2 bg-[var(--bg)]/20">
                        {itemConversions.length > 0 && (
                          <div className="space-y-1">
                            {itemConversions.map(c => (
                              <div key={c.id} className="flex items-center gap-2 px-3 py-2 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg">
                                <span className="text-xs font-mono text-[var(--fg-1)]">1 {ul(c.from_unit)}</span>
                                <span className="text-[var(--fg-4)] text-xs">=</span>
                                <span className="text-xs font-mono font-semibold text-[var(--primary)]">{c.conversion_factor} {ul(c.to_unit)}</span>
                                <span className="text-[var(--fg-4)] text-xs font-mono">({c.from_unit}→{c.to_unit})</span>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteConversion(c.id)}
                                  className="ml-auto p-1 text-[var(--fg-4)] hover:text-danger transition-colors"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-2 items-end">
                          <div className="flex-1">
                            <p className="text-[10px] text-[var(--fg-4)] mb-1">1 หน่วยของ</p>
                            <select
                              value={convForm.from_unit}
                              onChange={e => setConvForm(f => ({ ...f, from_unit: e.target.value }))}
                              className="w-full px-2.5 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
                            >
                              <option value="">เลือกหน่วย</option>
                              {availableUnits.map((u) => (
                                <option key={u.value} value={u.value}>{u.label} ({u.value})</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex-1">
                            <p className="text-[10px] text-[var(--fg-4)] mb-1">เท่ากับหน่วย</p>
                            <select
                              value={convForm.to_unit}
                              onChange={e => setConvForm(f => ({ ...f, to_unit: e.target.value }))}
                              className="w-full px-2.5 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs text-[var(--fg-1)] focus:outline-none focus:border-[var(--primary)]"
                            >
                              <option value="">เลือกหน่วย</option>
                              {availableUnits.map((u) => (
                                <option key={u.value} value={u.value}>{u.label} ({u.value})</option>
                              ))}
                            </select>
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
                            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1 flex-shrink-0"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            เพิ่ม
                          </button>
                        </div>
                        {convForm.from_unit && convForm.to_unit && convForm.conversion_factor && Number(convForm.conversion_factor) > 0 && (
                          <p className="text-xs text-[var(--fg-3)] text-center">
                            1 {ul(convForm.from_unit)} = {convForm.conversion_factor} {ul(convForm.to_unit)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Chain Editor button */}
                  <button
                    type="button"
                    onClick={() => setShowChainEditor(true)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 border border-purple-500/40 bg-purple-500/5 hover:bg-purple-500/10 text-purple-300 rounded-xl text-sm transition-colors"
                  >
                    <Network className="w-4 h-4" />
                    เปิด Chain Editor (ผังหน่วยแบบ Visual)
                  </button>
                </>
              )}

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
                disabled={saving || uploadingImage}
                className="flex-1 phopy-btn-primary flex items-center justify-center gap-2 text-sm py-2"
              >
                {(saving || uploadingImage) ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> กำลังบันทึก...</>
                ) : (
                  <><Edit2 className="w-4 h-4" /> บันทึก</>
                )}
              </button>
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
}: {
  label: string
  active: boolean
  onClick: () => void
  count?: number
  tone?: 'neutral' | 'warning' | 'danger'
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
}: {
  label: string
  colKey: ColumnKey
  sortKey: ColumnKey | null
  sortDir: 'asc' | 'desc'
  onSort: (key: ColumnKey) => void
  /** Optional tooltip clarifying an ambiguous column (e.g. loose qty vs. sealed packs). */
  hint?: string
}) {
  const active = sortKey === colKey
  return (
    <th
      onClick={() => onSort(colKey)}
      className="cursor-pointer select-none hover:text-[var(--primary)] transition-colors"
      title={hint}
    >
      <span className="flex items-center gap-1">
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
