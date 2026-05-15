import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Package,
  Search,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ArrowUpCircle,
  ArrowDownCircle,
  X,
  Eye,
  Edit2,
  Loader2,
  Clock,
  MapPin,
  AlertCircle,
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
import api from '../services/api'
import stockService, { StockItem, StockStats } from '../services/stock'
import { SearchableDropdown } from '../components/common/SearchableDropdown'
import ImportModal from '../components/common/ImportModal'
import UnitChainEditor from '../components/common/UnitChainEditor'
import { useModalClose } from '../hooks/useModalClose'
import { useUnits, invalidateUnitsCache, UNIT_LABELS as UNIT_LABELS_MAP } from '../hooks/useUnits'

type ColumnKey = 'image' | 'name' | 'sku' | 'category' | 'quantity' | 'displayQty' | 'baseUnit' | 'displayUnit' | 'minmax' | 'unitCost' | 'unitPrice' | 'location' | 'status'

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
  unitCost: 'ต้นทุน/หน่วยซื้อ',
  unitPrice: 'ราคาขาย/หน่วยฐาน',
  location: 'สถานที่',
  status: 'สถานะ',
}
const ALWAYS_VISIBLE: ColumnKey[] = ['name', 'quantity', 'status']

function getDefaultCols(): Record<ColumnKey, boolean> {
  const saved = localStorage.getItem('stock_columns')
  if (saved) return JSON.parse(saved)
  return { image: true, name: true, sku: true, category: true, quantity: true, displayQty: false, baseUnit: false, displayUnit: false, minmax: false, unitCost: true, unitPrice: true, location: false, status: true }
}

function Stock() {
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
  const [movementModal, setMovementModal] = useState<{
    open: boolean
    type: 'IN' | 'OUT'
    item: StockItem | null
  }>({ open: false, type: 'IN', item: null })

  // Add New Item Modal
  const [showAddModal, setShowAddModal] = useState(false)

  // Import Modal
  const [showImportModal, setShowImportModal] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

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

  const getItemStatus = (item: StockItem): 'adequate' | 'low' | 'critical' | 'overstock' | 'out' => {
    if (item.quantity === 0) return 'out'
    if (item.quantity <= item.minStock * 0.3) return 'critical'
    if (item.quantity <= item.minStock) return 'low'
    if (item.quantity >= item.maxStock) return 'overstock'
    return 'adequate'
  }

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
      case 'unitCost': aVal = a.unitCost ?? 0; bVal = b.unitCost ?? 0; break
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
      'ต้นทุน/หน่วยซื้อ (฿)': item.unitCost ?? 0,
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

  const handleOpenDetail = async (item: StockItem) => {
    try {
      const movements = await stockService.getMovements(item.id)
      setDetailModal({ open: true, item: { ...item, movements } })
    } catch (err) {
      console.error('Failed to load movements:', err)
      setDetailModal({ open: true, item })
    }
  }

  const handleStockMovement = (type: 'IN' | 'OUT', item: StockItem) => {
    if (type === 'OUT' && item.quantity === 0) {
      toast.error('สต๊อกหมด ไม่สามารถทำ Stock Out ได้')
      return
    }
    setMovementModal({ open: true, type, item })
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
          <h1 className="text-3xl font-bold text-[var(--fg-1)] mb-2">
            <span className="text-[var(--fg-1)]">จัดการสต๊อกสินค้า</span>
          </h1>
          <p className="text-[var(--fg-3)]">ติดตามและจัดการระดับสต๊อกสินค้า</p>
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
              onClick={() => setMovementModal({ open: true, type: 'IN', item: null })}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-success hover:bg-success/10 transition-colors border-r border-[var(--border)]"
              title="Stock In"
            >
              <ArrowUpCircle className="w-4 h-4" />
              รับเข้า
            </button>
            <button
              onClick={() => setMovementModal({ open: true, type: 'OUT', item: null })}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-danger hover:bg-[var(--danger-soft)] transition-colors border-r border-[var(--border)]"
              title="Stock Out"
            >
              <ArrowDownCircle className="w-4 h-4" />
              ตัดออก
            </button>
            <button
              onClick={() => setAdjustModal({ open: true, item: null })}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-blue-400 hover:bg-blue-400/10 transition-colors"
              title="ปรับสต๊อก"
            >
              <SlidersHorizontal className="w-4 h-4" />
              ปรับสต๊อก
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

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          label="สินค้าทั้งหมด"
          value={(stats?.totalItems ?? 0).toString()}
          icon={Package}
          color="primary"
        />
        <StatCard
          label="สต๊อกวิกฤต"
          value={(stats?.criticalCount ?? 0).toString()}
          icon={AlertTriangle}
          color="red"
        />
        <StatCard
          label="สต๊อกต่ำ"
          value={(stats?.lowStockCount ?? 0).toString()}
          icon={TrendingDown}
          color="yellow"
        />
        <StatCard
          label="มูลค่ารวม"
          value={`฿${(stats?.totalValue ?? 0).toLocaleString()}`}
          icon={TrendingUp}
          color="green"
        />
      </div>

      {/* Filters */}
      <div className="phopy-card p-6">
        <div className="flex flex-col gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-3)]" aria-hidden="true" />
            <input
              type="search"
              placeholder="ค้นหาชื่อสินค้า หรือ SKU..."
              aria-label="ค้นหาสินค้า"
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="phopy-input pl-10 w-full"
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            {/* Category Filter */}
            <div className="flex flex-col gap-2">
              <p className="text-xs text-[var(--fg-4)] font-medium uppercase tracking-wider">ประเภทสินค้า</p>
              <div className="flex gap-2 flex-wrap">
                <FilterButton label="ทั้งหมด" active={selectedCategory === 'all'} onClick={() => handleCategoryChange('all')} />
                <FilterButton label="วัตถุดิบ" active={selectedCategory === 'raw'} onClick={() => handleCategoryChange('raw')} />
                <FilterButton label="กึ่งสำเร็จรูป" active={selectedCategory === 'wip'} onClick={() => handleCategoryChange('wip')} />
                <FilterButton label="สินค้าสำเร็จรูป" active={selectedCategory === 'finished'} onClick={() => handleCategoryChange('finished')} />
              </div>
            </div>

            {/* Divider */}
            <div className="hidden sm:block w-px bg-[var(--border)] self-stretch" />

            {/* Status Filter */}
            <div className="flex flex-col gap-2">
              <p className="text-xs text-[var(--fg-4)] font-medium uppercase tracking-wider">สถานะสต๊อก</p>
              <div className="flex gap-2 flex-wrap">
                <FilterButton label="ทั้งหมด" active={selectedStatus === 'all'} onClick={() => handleStatusChange('all')} />
                <FilterButton label="หมด" active={selectedStatus === 'out'} onClick={() => handleStatusChange('out')} />
                <FilterButton label="วิกฤต" active={selectedStatus === 'critical'} onClick={() => handleStatusChange('critical')} />
                <FilterButton label="ต่ำ" active={selectedStatus === 'low'} onClick={() => handleStatusChange('low')} />
                <FilterButton label="เกิน" active={selectedStatus === 'overstock'} onClick={() => handleStatusChange('overstock')} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stock List */}
      <div className="phopy-card p-6">
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
          </button>

          {/* Column picker dropdown */}
          {showColumnPicker && (
            <div
              className="absolute top-10 right-0 z-30 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl p-3 min-w-[180px]"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-xs text-[var(--fg-3)] mb-2 px-1">เลือกคอลัมน์ที่แสดง</p>
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
                    {COLUMN_LABELS[key]}
                    {always && <span className="ml-auto text-[10px] text-[var(--fg-4)]">บังคับ</span>}
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
                  <input
                    type="checkbox"
                    checked={paginatedItems.length > 0 && selectedIds.size === paginatedItems.length}
                    onChange={handleSelectAll}
                    className="w-4 h-4 rounded border-[var(--border)] bg-[var(--bg)] text-[var(--primary)] cursor-pointer"
                    aria-label="เลือกทั้งหมด"
                  />
                </th>
                {visibleCols.image && <th className="w-14"></th>}
                {visibleCols.name && <SortTh label="ชื่อสินค้า" colKey="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.sku && <SortTh label="SKU" colKey="sku" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.category && <SortTh label="ประเภท" colKey="category" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.quantity && <SortTh label="จำนวน" colKey="quantity" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.baseUnit && <SortTh label="หน่วยฐาน" colKey="baseUnit" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.displayQty && <SortTh label="จำนวนบรรจุ" colKey="displayQty" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.displayUnit && <SortTh label="หน่วยบรรจุ" colKey="displayUnit" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.minmax && <th>Min / Max</th>}
                {visibleCols.unitCost && <SortTh label="ต้นทุน/หน่วย" colKey="unitCost" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
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
                  const cost = item.unitCost ?? 0
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
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(item.id)}
                          className="w-4 h-4 rounded border-[var(--border)] bg-[var(--bg)] text-[var(--primary)] cursor-pointer"
                          aria-label={`เลือก ${item.name}`}
                        />
                      </td>
                      {visibleCols.image && (
                        <td className="w-14">
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt={item.name}
                              className="w-10 h-10 rounded-lg object-cover border border-[var(--border)]"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center">
                              <Package className="w-4 h-4 text-[var(--fg-4)]" />
                            </div>
                          )}
                        </td>
                      )}
                      {visibleCols.name && (
                        <td>
                          <span className="text-[var(--fg-2)] font-medium">{item.name}</span>
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
                            {/* จำนวนสต็อกหลัก = หน่วยฐาน */}
                            <span className={`font-semibold ${item.quantity === 0 ? 'text-danger' : 'text-[var(--primary)]'}`}>
                              {item.quantity} {item.baseUnit || item.unit}
                            </span>
                            {/* ถ้ามีแพ็คยังไม่แกะ ให้แสดงเป็น secondary info */}
                            {(item.sealedQty ?? 0) > 0 && (
                              <span className="text-xs text-amber-500/80">
                                ยังไม่แกะ {item.sealedQty} {item.displayUnit || item.unit}
                              </span>
                            )}
                          </div>
                        </td>
                      )}
                      {visibleCols.baseUnit && (
                        <td>
                          <span className="text-[var(--fg-2)] text-sm">{item.baseUnit || item.unit}</span>
                        </td>
                      )}
                      {visibleCols.displayQty && (
                        <td>
                          <span className={`font-semibold ${(item.sealedQty ?? 0) === 0 ? 'text-[var(--fg-4)]' : 'text-[var(--primary)]'}`}>
                            {item.sealedQty ?? 0} {item.displayUnit || item.unit}
                          </span>
                        </td>
                      )}
                      {visibleCols.displayUnit && (
                        <td>
                          <span className="text-[var(--fg-2)] text-sm">{item.displayUnit || item.unit}</span>
                        </td>
                      )}
                      {visibleCols.minmax && (
                        <td>
                          <span className="text-[var(--fg-3)] text-sm">{item.minStock} / {item.maxStock}</span>
                        </td>
                      )}
                      {visibleCols.unitCost && (
                        <td>
                          <span className="text-amber-400 text-sm font-medium">
                            {cost ? `฿${Number(cost).toLocaleString()}/${item.displayUnit || item.unit || 'หน่วย'}` : '-'}
                          </span>
                        </td>
                      )}
                      {visibleCols.unitPrice && (
                        <td>
                          <span className="text-success text-sm font-medium">
                            {price ? `฿${Number(price).toLocaleString()}/${item.baseUnit || item.unit || 'หน่วย'}` : '-'}
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
                            onClick={() => handleOpenDetail(item)}
                            className="p-2 text-[var(--fg-3)] hover:text-[var(--primary)] hover:bg-phopy-indigo/10 rounded-lg transition-colors cursor-pointer"
                            aria-label={`ดูรายละเอียด ${item.name}`}
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setEditModal({ open: true, item })}
                            className="p-2 text-[var(--fg-3)] hover:text-warning hover:bg-[var(--warning-soft)] rounded-lg transition-colors cursor-pointer"
                            aria-label={`แก้ไข ${item.name}`}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleStockMovement('IN', item)}
                            className="p-2 text-[var(--fg-3)] hover:text-success hover:bg-success/10 rounded-lg transition-colors cursor-pointer"
                            aria-label={`รับสินค้าเข้า ${item.name}`}
                          >
                            <ArrowUpCircle className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleStockMovement('OUT', item)}
                            disabled={item.quantity === 0}
                            className={`p-2 rounded-lg transition-colors ${item.quantity === 0
                              ? 'text-[var(--fg-4)] cursor-not-allowed'
                              : 'text-[var(--fg-3)] hover:text-danger hover:bg-[var(--danger-soft)] cursor-pointer'
                              }`}
                            aria-label={item.quantity === 0 ? `${item.name} สต๊อกหมด` : `ตัดสินค้าออก ${item.name}`}
                          >
                            <ArrowDownCircle className="w-4 h-4" />
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
      />

      {/* Edit Modal */}
      <EditModal
        open={editModal.open}
        item={editModal.item}
        onClose={() => setEditModal({ open: false, item: null })}
        onSave={loadData}
      />

      {/* Movement Modal */}
      <MovementModal
        open={movementModal.open}
        type={movementModal.type}
        item={movementModal.item}
        stockItems={stockItems}
        onClose={() => setMovementModal({ open: false, type: 'IN', item: null })}
        onSave={loadData}
        setShowAddModal={setShowAddModal}
      />

      {/* Adjust Modal */}
      <AdjustModal
        open={adjustModal.open}
        item={adjustModal.item}
        stockItems={stockItems}
        onClose={() => setAdjustModal({ open: false, item: null })}
        onSave={loadData}
      />

      {/* Add New Item Modal */}
      <AddStockModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSave={() => {
          setShowAddModal(false)
          loadData()
        }}
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

// Detail Modal Component
function DetailModal({
  open,
  item,
  onClose,
}: {
  open: boolean
  item: StockItem | null
  onClose: () => void
}) {
  useModalClose(onClose)
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
          <h2 className="text-xl font-bold text-[var(--fg-1)]">Stock Item Details</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--bg)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[var(--fg-3)]" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Item Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">Name</p>
              <p className="text-[var(--fg-2)] font-medium">{item.name}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">SKU</p>
              <p className="text-[var(--fg-2)] font-mono">{item.sku}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">Category</p>
              <CategoryBadge category={item.category} />
            </div>
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">Current Stock (Base)</p>
              <p className={`font-bold text-lg ${item.quantity === 0 ? 'text-danger' : 'text-[var(--primary)]'}`}>
                {item.quantity} {item.baseUnit || item.unit}
                {item.quantity === 0 && (
                  <span className="ml-2 text-xs bg-[var(--danger-soft)] text-danger px-2 py-1 rounded">
                    OUT OF STOCK
                  </span>
                )}
              </p>
              {(item.sealedQty ?? 0) > 0 && (
                <p className="text-xs text-amber-500/80">ยังไม่แกะ {item.sealedQty} {item.displayUnit || item.unit}</p>
              )}
            </div>
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">หน่วยฐาน (Base)</p>
              <p className="text-[var(--fg-2)]">{item.baseUnit || item.unit} {item.baseUnit && item.baseUnit !== item.unit ? `(หน่วยเดิม: ${item.unit})` : ''}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">หน่วยบรรจุ (Packaging)</p>
              <p className="text-[var(--fg-2)]">{item.displayUnit || '-'}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">Min Stock</p>
              <p className="text-[var(--fg-2)]">{item.minStock} {item.baseUnit || item.unit}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">Max Stock</p>
              <p className="text-[var(--fg-2)]">{item.maxStock} {item.baseUnit || item.unit}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">ราคาต้นทุน/หน่วยซื้อ ({item.displayUnit || item.unit})</p>
              <p className="text-amber-400 font-semibold">
                {item.unitCost
                  ? `฿${Number(item.unitCost).toLocaleString()}/${item.displayUnit || item.unit || 'หน่วย'}`
                  : 'ไม่ระบุ'}
              </p>
            </div>
            <div>
              <p className="text-sm text-[var(--fg-3)] mb-1">ราคาขาย/หน่วยฐาน ({item.baseUnit || item.unit})</p>
              <p className="text-success font-semibold">
                {item.unitPrice
                  ? `฿${Number(item.unitPrice).toLocaleString()}/${item.baseUnit || item.unit || 'หน่วย'}`
                  : 'ไม่ระบุ'}
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-sm text-[var(--fg-3)] mb-1">Location</p>
              <div className="flex items-center gap-2 text-[var(--fg-2)]">
                <MapPin className="w-4 h-4 text-[var(--primary)]" />
                {item.location || 'Not specified'}
              </div>
            </div>
          </div>

          {/* Related Material/Product */}
          {item.material && (
            <div className="p-4 bg-[var(--surface-2)] rounded-lg">
              <p className="text-sm text-[var(--fg-3)] mb-2">Related Material</p>
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
                          {movement.type === 'IN' ? `+${movement.quantity} ${movement.movementUnit || item.baseUnit || item.unit}` :
                           movement.type === 'OUT' ? `-${movement.quantity} ${movement.movementUnit || item.baseUnit || item.unit}` :
                           movement.type === 'PRICE_CHANGE' ? 'เปลี่ยนราคา' :
                           `${movement.quantity} ${movement.movementUnit || item.baseUnit || item.unit}`}
                          {movement.movementQuantity !== undefined && movement.movementQuantity !== movement.quantity && movement.movementUnit && (
                            <span className="text-xs text-[var(--fg-4)] ml-1">(นับ {movement.movementQuantity} {movement.movementUnit})</span>
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
function EditModal({
  open,
  item,
  onClose,
  onSave,
}: {
  open: boolean
  item: StockItem | null
  onClose: () => void
  onSave: () => void
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
    unitCost: 0,
    unitPrice: 0,
  })
  const [saving, setSaving] = useState(false)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)

  // Load units from API (global + per-material conversions)
  const { units: availableUnits } = useUnits(item?.id)

  // Per-material unit conversions
  const [activeTab, setActiveTab] = useState<'general' | 'units'>('general')
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
        unitCost: item.unitCost ?? 0,
        unitPrice: item.unitPrice ?? 0,
      })
      setImagePreview(item.imageUrl || null)
      setImageFile(null)
      setActiveTab('general')
      setShowChainEditor(false)
      setConvExpanded(false)
      setItemConversions([])
      setStandardConversions([])
      setConversionWarning(null)
      fetchItemConversions(item.id)
      fetchStandardConversions()
    }
  }, [item])

  // Check if conversion exists when baseUnit ≠ displayUnit
  useEffect(() => {
    if (!item || !formData.baseUnit || !formData.displayUnit) {
      setConversionWarning(null)
      return
    }
    if (formData.baseUnit === formData.displayUnit) {
      setConversionWarning(null)
      return
    }
    const hasCustom = itemConversions.some(c =>
      (c.from_unit === formData.displayUnit && c.to_unit === formData.baseUnit) ||
      (c.from_unit === formData.baseUnit && c.to_unit === formData.displayUnit)
    )
    const hasStandard = standardConversions.some(c =>
      (c.from_unit === formData.displayUnit && c.to_unit === formData.baseUnit) ||
      (c.from_unit === formData.baseUnit && c.to_unit === formData.displayUnit)
    )
    if (!hasCustom && !hasStandard) {
      setConversionWarning(`⚠️ ไม่พบการแปลงหน่วยจาก "${ul(formData.displayUnit)}" เป็น "${ul(formData.baseUnit)}" — ระบบจะไม่สามารถคำนวณสต๊อกได้`)
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
      toast.error('บันทึกไม่สำเร็จ กรุณาลองใหม่')
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
                        ราคาต้นทุน/หน่วยซื้อ (฿)
                        <span className="ml-1 text-amber-400/70">ต่อ {formData.displayUnit || formData.unit || 'หน่วยที่ซื้อ'}</span>
                      </label>
                      <input
                        type="number"
                        value={formData.unitCost}
                        onChange={(e) => setFormData({ ...formData, unitCost: parseFloat(e.target.value) || 0 })}
                        onFocus={(e) => e.target.select()}
                        className="phopy-input w-full"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--fg-3)] mb-1.5">
                        ราคาขาย/หน่วยฐาน (฿)
                        <span className="ml-1 text-success/70">ต่อ {formData.baseUnit || formData.unit || 'หน่วยฐาน'}</span>
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
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${formData.isPosEnabled ? 'bg-[var(--success-soft)] text-success' : 'bg-gray-700 text-[var(--fg-3)]'}`}>
                      {formData.isPosEnabled ? 'เปิด' : 'ปิด'}
                    </span>
                  </label>
                </>
              )}

              {/* ── UNITS TAB ── */}
              {activeTab === 'units' && (
                <>
                  {/* Unit (legacy) */}
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1.5">หน่วยสินค้า (Legacy)</label>
                    <select
                      value={formData.unit}
                      onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                      className="phopy-input w-full"
                    >
                      {formData.unit && !availableUnits.find(u => u.value === formData.unit) && (
                        <option value={formData.unit}>{formData.unit}</option>
                      )}
                      {availableUnits.map((u) => (
                        <option key={u.value} value={u.value}>{u.label} ({u.value})</option>
                      ))}
                    </select>
                    <p className="text-xs text-[var(--fg-4)] mt-1">เพิ่มหน่วยได้ใน Settings → Unit Conversions</p>
                  </div>

                  {/* Base Unit + Display Unit */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[var(--fg-3)] mb-1.5">
                        หน่วยฐาน <span className="text-[var(--fg-4)]">(Base - หน่วยย่อยสุด)</span>
                      </label>
                      <select
                        value={formData.baseUnit || ''}
                        onChange={(e) => setFormData({ ...formData, baseUnit: e.target.value })}
                        className="phopy-input w-full"
                      >
                        <option value="">{formData.unit || 'เลือกหน่วยฐาน'}</option>
                        {availableUnits.map((u) => (
                          <option key={u.value} value={u.value}>{u.label} ({u.value})</option>
                        ))}
                      </select>
                      <p className="text-xs text-[var(--fg-4)] mt-1">เช่น ขวด, pcs, g, ml</p>
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--fg-3)] mb-1.5">
                        หน่วยบรรจุ <span className="text-[var(--fg-4)]">(Packaging - บรรจุภัณฑ์)</span>
                      </label>
                      <select
                        value={formData.displayUnit || ''}
                        onChange={(e) => setFormData({ ...formData, displayUnit: e.target.value })}
                        className="phopy-input w-full"
                      >
                        <option value="">{formData.unit || 'เลือกหน่วยบรรจุ'}</option>
                        {availableUnits.map((u) => (
                          <option key={u.value} value={u.value}>{u.label} ({u.value})</option>
                        ))}
                      </select>
                      <p className="text-xs text-[var(--fg-4)] mt-1">เช่น ลัง, กล่อง, ถุง</p>
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
                              <div key={c.id} className="flex items-center gap-2 px-3 py-2 bg-gray-800/60 rounded-lg">
                                <span className="text-xs font-mono text-blue-300">1 {ul(c.from_unit)}</span>
                                <span className="text-[var(--fg-4)] text-xs">=</span>
                                <span className="text-xs font-mono text-green-300">{c.conversion_factor} {ul(c.to_unit)}</span>
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
                            <p className="text-[10px] text-[var(--fg-4)] mb-1">จาก (เช่น pack)</p>
                            <select
                              value={convForm.from_unit}
                              onChange={e => setConvForm(f => ({ ...f, from_unit: e.target.value }))}
                              className="w-full px-2.5 py-1.5 bg-gray-700/50 border border-[var(--border-strong)]/50 rounded-lg text-xs text-[var(--fg-2)] focus:outline-none focus:border-purple-500/50"
                            >
                              <option value="">เลือกหน่วย</option>
                              {availableUnits.map((u) => (
                                <option key={u.value} value={u.value}>{u.label} ({u.value})</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex-1">
                            <p className="text-[10px] text-[var(--fg-4)] mb-1">เป็น (เช่น pcs)</p>
                            <select
                              value={convForm.to_unit}
                              onChange={e => setConvForm(f => ({ ...f, to_unit: e.target.value }))}
                              className="w-full px-2.5 py-1.5 bg-gray-700/50 border border-[var(--border-strong)]/50 rounded-lg text-xs text-[var(--fg-2)] focus:outline-none focus:border-purple-500/50"
                            >
                              <option value="">เลือกหน่วย</option>
                              {availableUnits.map((u) => (
                                <option key={u.value} value={u.value}>{u.label} ({u.value})</option>
                              ))}
                            </select>
                          </div>
                          <div className="w-20">
                            <p className="text-[10px] text-[var(--fg-4)] mb-1">จำนวน</p>
                            <input
                              type="number"
                              value={convForm.conversion_factor}
                              onChange={e => setConvForm(f => ({ ...f, conversion_factor: e.target.value }))}
                              placeholder="24"
                              min="0.000001"
                              step="any"
                              className="w-full px-2.5 py-1.5 bg-gray-700/50 border border-[var(--border-strong)]/50 rounded-lg text-xs text-[var(--fg-2)] placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
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
                          <p className="text-xs text-purple-300/70 text-center">
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
                className="flex-1 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-3)] hover:text-[var(--fg-2)] hover:border-gray-500 transition-colors text-sm"
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
function MovementModal({
  open,
  type,
  item,
  stockItems,
  onClose,
  onSave,
  setShowAddModal,
}: {
  open: boolean
  type: 'IN' | 'OUT'
  item: StockItem | null
  stockItems: StockItem[]
  onClose: () => void
  onSave: () => void
  setShowAddModal: (show: boolean) => void
}) {
  useModalClose(onClose)
  const [selectedItemId, setSelectedItemId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [unit, setUnit] = useState('')
  const [notes, setNotes] = useState('')
  const [reference, setReference] = useState('')
  const [unitCost, setUnitCost] = useState<number | ''>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (item) {
      setSelectedItemId(item.id)
      setUnit(item.displayUnit || item.unit || item.baseUnit || '')
    } else {
      setSelectedItemId('')
      setUnit('')
    }
    setQuantity(1)
    setNotes('')
    setReference('')
    setUnitCost('')
  }, [item, open])

  const selectedItem = stockItems.find((i) => i.id === selectedItemId)
  const { units: availableUnits } = useUnits(selectedItem?.id)

  const baseQuantity = useMemo(() => {
    if (!selectedItem || !unit || unit === (selectedItem.baseUnit || selectedItem.unit)) return quantity
    if (unit === selectedItem.displayUnit && selectedItem.displayQuantity !== undefined && selectedItem.displayQuantity !== null && selectedItem.displayQuantity > 0) {
      const ratio = selectedItem.quantity / selectedItem.displayQuantity
      if (!isFinite(ratio) || ratio <= 0) return quantity
      return Math.round(quantity * ratio * 1000) / 1000
    }
    return quantity
  }, [quantity, unit, selectedItem])

  const isOutOfStock = selectedItem && selectedItem.quantity === 0 && type === 'OUT'
  const canConvertInFrontend = !selectedItem || !unit || unit === (selectedItem.baseUnit || selectedItem.unit) || (unit === selectedItem.displayUnit && selectedItem.displayQuantity !== undefined && selectedItem.displayQuantity !== null && selectedItem.displayQuantity > 0)
  const exceedsStock = selectedItem && type === 'OUT' && canConvertInFrontend && Number.isFinite(baseQuantity) && baseQuantity > selectedItem.quantity

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedItemId) {
      toast.error('Please select an item')
      return
    }

    if (isOutOfStock) {
      toast.error('Cannot perform Stock Out - item is out of stock!')
      return
    }

    if (exceedsStock) {
      toast.error(`Cannot take out more than available stock (${selectedItem?.quantity} ${selectedItem?.baseUnit || selectedItem?.unit})`)
      return
    }

    setSaving(true)
    try {
      await stockService.recordMovement({
        stockItemId: selectedItemId,
        type,
        quantity: baseQuantity,
        unit: selectedItem?.baseUnit || selectedItem?.unit || undefined,
        notes: notes || undefined,
        reference: reference || undefined,
        unitCost: unitCost !== '' ? unitCost : undefined,
      })
      onSave()
      onClose()
    } catch (err) {
      console.error('Failed to record movement:', err)
      toast.error('Failed to record movement')
    } finally {
      setSaving(false)
    }
  }

  const availableItems = useMemo(
    () => type === 'OUT' ? (stockItems || []).filter((i) => i.quantity > 0) : stockItems,
    [type, stockItems],
  )
  const availableItemOptions = useMemo(
    () => availableItems.map((stockItem) => ({
      id: stockItem.id,
      label: `${stockItem.name} (${stockItem.sku}) - ${stockItem.quantity} ${stockItem.unit}`,
      searchText: `${stockItem.name} ${stockItem.sku}`,
    })),
    [availableItems],
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-[var(--fg-1)]/50 flex items-center justify-center z-50 p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="phopy-card w-full max-w-lg flex flex-col max-h-[90vh] animate-scaleIn"
      >
        <div className={`p-6 border-b border-[var(--border)] flex items-center justify-between flex-shrink-0 ${type === 'IN' ? 'bg-success/10' : 'bg-[var(--danger-soft)]'
          }`}>
          <div className="flex items-center gap-3">
            {type === 'IN' ? (
              <ArrowUpCircle className="w-6 h-6 text-success" />
            ) : (
              <ArrowDownCircle className="w-6 h-6 text-danger" />
            )}
            <h2 className="text-xl font-bold text-[var(--fg-1)]">
              Stock {type === 'IN' ? 'In' : 'Out'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--bg)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[var(--fg-3)]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-2">Select Item</label>
            <SearchableDropdown
              value={selectedItemId}
              onChange={setSelectedItemId}
              options={availableItemOptions}
              placeholder="-- Select Item --"
              disabled={!!item}
            />
            {type === 'OUT' && availableItems.length === 0 && (
              <p className="text-danger text-sm mt-2 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                No items available for Stock Out
              </p>
            )}
            {type === 'IN' && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-sm text-[var(--fg-4)]">Item not found?</span>
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    setShowAddModal(true)
                  }}
                  className="text-sm text-[var(--primary)] hover:text-phopy-indigo-600 flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Create New Item
                </button>
              </div>
            )}
          </div>

          {selectedItem && (
            <div className="p-4 bg-[var(--surface-2)] rounded-lg space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-[var(--fg-3)]">Current Stock:</span>
                <span className={`font-bold ${selectedItem.quantity === 0 ? 'text-danger' : 'text-[var(--primary)]'}`}>
                  {selectedItem.displayQuantity !== undefined && selectedItem.displayQuantity !== selectedItem.quantity
                    ? `${selectedItem.displayQuantity} ${selectedItem.displayUnit || selectedItem.unit}`
                    : `${selectedItem.quantity} ${selectedItem.baseUnit || selectedItem.unit}`}
                  {selectedItem.quantity === 0 && (
                    <span className="ml-2 text-xs bg-[var(--danger-soft)] text-danger px-2 py-1 rounded">
                      OUT OF STOCK
                    </span>
                  )}
                </span>
              </div>
              {selectedItem.displayQuantity !== undefined && selectedItem.displayQuantity !== selectedItem.quantity && (
                <div className="flex justify-between items-center text-xs text-[var(--fg-4)]">
                  <span></span>
                  <span>{selectedItem.quantity} {selectedItem.baseUnit || selectedItem.unit}</span>
                </div>
              )}
            </div>
          )}

          {isOutOfStock && (
            <div className="p-4 bg-[var(--danger-soft)] border border-danger/30 rounded-lg flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-danger flex-shrink-0" />
              <div>
                <p className="text-danger font-medium">Cannot Proceed</p>
                <p className="text-danger/70 text-sm">This item is out of stock. Stock Out is not allowed.</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-[var(--fg-3)] mb-2">Quantity</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
                onFocus={(e) => e.target.select()}
                className="phopy-input w-full"
                min="1"
                required
                disabled={isOutOfStock}
              />
            </div>
            <div>
              <label className="block text-sm text-[var(--fg-3)] mb-2">Unit</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="phopy-input w-full"
                disabled={isOutOfStock}
              >
                {selectedItem ? (
                  <>
                    {selectedItem.baseUnit && (
                      <option value={selectedItem.baseUnit}>
                        {UNIT_LABELS_MAP[selectedItem.baseUnit] || selectedItem.baseUnit} (Base)
                      </option>
                    )}
                    {selectedItem.displayUnit && selectedItem.displayUnit !== selectedItem.baseUnit && (
                      <option value={selectedItem.displayUnit}>
                        {UNIT_LABELS_MAP[selectedItem.displayUnit] || selectedItem.displayUnit} (บรรจุ)
                      </option>
                    )}
                    {availableUnits.filter(u => u.value !== selectedItem.baseUnit && u.value !== selectedItem.displayUnit).map(u => (
                      <option key={u.value} value={u.value}>{u.label} ({u.value})</option>
                    ))}
                  </>
                ) : (
                  <option value="">Select item first</option>
                )}
              </select>
            </div>
          </div>
          {exceedsStock && (
            <p className="text-danger text-sm mt-1">
              Cannot exceed available stock ({selectedItem?.quantity} {selectedItem?.baseUnit || selectedItem?.unit})
            </p>
          )}

          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-2">Reference (Optional)</label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="phopy-input w-full"
              placeholder="e.g., PO-2024-001"
              disabled={isOutOfStock}
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-2">Notes (Optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="phopy-input w-full"
              rows={3}
              placeholder="Additional notes..."
              disabled={isOutOfStock}
            />
          </div>

          {type === 'IN' && (
            <div>
              <label className="block text-sm text-[var(--fg-3)] mb-2">
                อัปเดตราคาต้นทุน/หน่วยซื้อ (฿) <span className="text-[var(--fg-4)]">(ไม่บังคับ)</span>
              </label>
              <input
                type="number"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value ? parseFloat(e.target.value) : '')}
                onFocus={(e) => e.target.select()}
                className="phopy-input w-full"
                min="0"
                step="0.01"
                placeholder="เว้นว่างถ้าไม่ต้องการเปลี่ยนราคา"
              />
            </div>
          )}
          </div>
          <div className="flex justify-end gap-3 px-6 py-4 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-3)] hover:text-[var(--fg-2)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || isOutOfStock || exceedsStock || !selectedItemId}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${type === 'IN'
                ? 'bg-success text-black hover:shadow-2-green disabled:opacity-50'
                : 'bg-red-500 text-white hover:bg-red-600 disabled:opacity-50'
                }`}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : type === 'IN' ? (
                <ArrowUpCircle className="w-4 h-4" />
              ) : (
                <ArrowDownCircle className="w-4 h-4" />
              )}
              Record {type === 'IN' ? 'Stock In' : 'Stock Out'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string
  value: string
  icon: any
  color: string
}) {
  const colorClass = {
    primary: 'text-[var(--primary)]',
    green: 'text-success',
    yellow: 'text-warning',
    red: 'text-danger',
  }[color]

  return (
    <div className="phopy-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-[var(--fg-3)] mb-1">{label}</p>
          <p className={`text-2xl font-bold ${colorClass}`}>
            {value}
          </p>
        </div>
        <Icon className={`w-8 h-8 ${colorClass} opacity-50`} />
      </div>
    </div>
  )
}

function FilterButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg transition-all whitespace-nowrap ${active
        ? 'bg-[var(--primary-soft)] text-[var(--primary)] border border-phopy-indigo/50'
        : 'bg-[var(--surface-2)] text-[var(--fg-3)] border border-[var(--border)] hover:border-phopy-indigo/30'
        }`}
    >
      {label}
    </button>
  )
}

// Map any category value (Thai or English) to a display group
function getCategoryGroup(category: string): 'raw' | 'wip' | 'finished' | 'material' {
  const raw = ['[วัตถุดิบ]', '[วัสดุย่อย]', 'raw', 'raw material']
  const wip = ['[สินค้ากึ่งสำเร็จรูป]', 'wip', 'semi-finished']
  const finished = ['[สินค้าสำเร็จรูป]', '[สินค้า]', '[สินค้าไม่มีตัวตน]', 'finished', 'finish']
  const c = category.toLowerCase()
  if (raw.includes(c)) return 'raw'
  if (wip.includes(c)) return 'wip'
  if (finished.includes(c)) return 'finished'
  return 'material'
}

function CategoryBadge({ category }: { category: string }) {
  const config: Record<string, { label: string; color: string }> = {
    raw:      { label: 'วัตถุดิบ',       color: 'text-blue-400 bg-[var(--info-soft)] border-info/30' },
    wip:      { label: 'กึ่งสำเร็จรูป', color: 'text-warning bg-[var(--warning-soft)] border-warning/30' },
    finished: { label: 'สินค้าสำเร็จรูป', color: 'text-success bg-[var(--success-soft)] border-success/30' },
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
      label: 'Adequate',
      className: 'bg-[var(--success-soft)] text-success border-success/30',
    },
    low: {
      label: 'Low',
      className: 'bg-[var(--warning-soft)] text-warning border-warning/30',
    },
    critical: {
      label: 'Critical',
      className: 'bg-[var(--danger-soft)] text-danger border-danger/30',
    },
    overstock: {
      label: 'Overstock',
      className: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    },
    out: {
      label: 'Out of Stock',
      className: 'bg-red-600/30 text-red-300 border-red-600/50',
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
}: {
  label: string
  colKey: ColumnKey
  sortKey: ColumnKey | null
  sortDir: 'asc' | 'desc'
  onSort: (key: ColumnKey) => void
}) {
  const active = sortKey === colKey
  return (
    <th
      onClick={() => onSort(colKey)}
      className="cursor-pointer select-none hover:text-[var(--primary)] transition-colors"
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
function AdjustModal({
  open,
  item,
  stockItems,
  onClose,
  onSave,
}: {
  open: boolean
  item: StockItem | null
  stockItems: StockItem[]
  onClose: () => void
  onSave: () => void
}) {
  useModalClose(onClose)
  const [selectedItemId, setSelectedItemId] = useState('')
  const [physicalCount, setPhysicalCount] = useState(0)
  const [unit, setUnit] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const selectedItem = stockItems.find(i => i.id === selectedItemId)
  const { units: availableUnits } = useUnits(selectedItem?.id)

  useEffect(() => {
    if (item) {
      setSelectedItemId(item.id)
      setPhysicalCount(item.quantity)
      setUnit(item.baseUnit || item.unit || '')
    } else {
      setSelectedItemId('')
      setPhysicalCount(0)
      setUnit('')
    }
    setNotes('')
  }, [item, open])

  useEffect(() => {
    if (selectedItem && !item) {
      setPhysicalCount(selectedItem.quantity)
      setUnit(selectedItem.baseUnit || selectedItem.unit || '')
    }
  }, [selectedItemId])

  const baseQuantity = useMemo(() => {
    if (!selectedItem || !unit || unit === (selectedItem.baseUnit || selectedItem.unit)) return physicalCount
    if (unit === selectedItem.displayUnit && selectedItem.displayQuantity !== undefined && selectedItem.displayQuantity !== null && selectedItem.displayQuantity > 0) {
      const ratio = selectedItem.quantity / selectedItem.displayQuantity
      if (!isFinite(ratio) || ratio <= 0) return physicalCount
      return Math.round(physicalCount * ratio * 1000) / 1000
    }
    return physicalCount
  }, [physicalCount, unit, selectedItem])

  const diff = baseQuantity - (selectedItem?.quantity ?? 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedItemId) { toast.error('กรุณาเลือกสินค้า'); return }
    if (physicalCount < 0) { toast.error('จำนวนต้องไม่ติดลบ'); return }
    if (diff === 0) { toast('จำนวนเท่าเดิม ไม่มีการเปลี่ยนแปลง'); onClose(); return }

    setSaving(true)
    try {
      await stockService.recordMovement({
        stockItemId: selectedItemId,
        type: 'ADJUST',
        quantity: baseQuantity,
        unit: selectedItem?.baseUnit || selectedItem?.unit || undefined,
        notes: notes || `ปรับสต๊อก: ${selectedItem?.quantity} → ${baseQuantity} ${selectedItem?.baseUnit || selectedItem?.unit || ''} (นับได้ ${physicalCount} ${unit})`,
      })
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
    <div
      className="fixed inset-0 bg-[var(--fg-1)]/50 flex items-center justify-center z-50 p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="phopy-card w-full max-w-lg flex flex-col max-h-[90vh] animate-scaleIn"
      >
        <div className="p-6 border-b border-[var(--border)] flex items-center justify-between bg-blue-500/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <SlidersHorizontal className="w-6 h-6 text-blue-400" />
            <div>
              <h2 className="text-xl font-bold text-[var(--fg-1)]">ปรับสต๊อก (Physical Count)</h2>
              <p className="text-xs text-[var(--fg-3)] mt-0.5">ตรวจนับและปรับยอดสต๊อกให้ตรงกับความจริง</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[var(--bg)] rounded-lg transition-colors">
            <X className="w-5 h-5 text-[var(--fg-3)]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-2">เลือกสินค้า</label>
            <SearchableDropdown
              value={selectedItemId}
              onChange={setSelectedItemId}
              options={stockItems.map(si => ({
                id: si.id,
                label: `${si.name} (${si.sku}) - ยอดปัจจุบัน: ${si.quantity} ${si.baseUnit || si.unit}`,
                searchText: `${si.name} ${si.sku}`,
              }))}
              placeholder="-- เลือกสินค้า --"
              disabled={!!item}
            />
          </div>

          {selectedItem && (
            <div className="p-4 bg-[var(--surface-2)] rounded-lg space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[var(--fg-3)] text-sm">ยอดในระบบ:</span>
                <span className="font-bold text-[var(--primary)]">
                  {selectedItem.displayQuantity !== undefined && selectedItem.displayQuantity !== selectedItem.quantity
                    ? `${selectedItem.displayQuantity} ${selectedItem.displayUnit || selectedItem.unit}`
                    : `${selectedItem.quantity} ${selectedItem.baseUnit || selectedItem.unit}`}
                  {selectedItem.displayQuantity !== undefined && selectedItem.displayQuantity !== selectedItem.quantity && (
                    <span className="block text-xs text-[var(--fg-4)] text-right">{selectedItem.quantity} {selectedItem.baseUnit || selectedItem.unit}</span>
                  )}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">จำนวนที่นับได้จริง</label>
                  <input
                    type="number"
                    value={physicalCount}
                    onChange={(e) => setPhysicalCount(parseInt(e.target.value) || 0)}
                    onFocus={(e) => e.target.select()}
                    className="phopy-input w-full text-lg font-bold"
                    min="0"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-2">หน่วยที่นับ</label>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="phopy-input w-full"
                  >
                    {selectedItem.baseUnit && (
                      <option value={selectedItem.baseUnit}>{UNIT_LABELS_MAP[selectedItem.baseUnit] || selectedItem.baseUnit} (Base)</option>
                    )}
                    {selectedItem.displayUnit && selectedItem.displayUnit !== selectedItem.baseUnit && (
                      <option value={selectedItem.displayUnit}>{UNIT_LABELS_MAP[selectedItem.displayUnit] || selectedItem.displayUnit} (บรรจุ)</option>
                    )}
                    {availableUnits.filter(u => u.value !== selectedItem.baseUnit && u.value !== selectedItem.displayUnit).map(u => (
                      <option key={u.value} value={u.value}>{u.label} ({u.value})</option>
                    ))}
                  </select>
                </div>
              </div>
              {diff !== 0 && (
                <div className={`flex items-center justify-between p-3 rounded-lg border ${diff > 0 ? 'bg-success/10 border-success/30' : 'bg-[var(--danger-soft)] border-danger/30'}`}>
                  <span className="text-sm text-[var(--fg-2)]">ผลต่าง:</span>
                  <span className={`font-bold text-lg ${diff > 0 ? 'text-success' : 'text-danger'}`}>
                    {diff > 0 ? '+' : ''}{diff} {selectedItem.baseUnit || selectedItem.unit}
                  </span>
                </div>
              )}
              {diff === 0 && physicalCount === selectedItem.quantity && (
                <p className="text-[var(--fg-4)] text-sm text-center">จำนวนเท่ากับยอดในระบบ</p>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm text-[var(--fg-3)] mb-2">หมายเหตุ (ไม่บังคับ)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="phopy-input w-full"
              rows={2}
              placeholder="เช่น ตรวจนับประจำเดือน, เจอสินค้าหาย..."
            />
          </div>
          </div>
          <div className="flex justify-end gap-3 px-6 py-4 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-3)] hover:text-[var(--fg-2)]"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saving || !selectedItemId}
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <SlidersHorizontal className="w-4 h-4" />}
              ยืนยันปรับสต๊อก
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Add New Stock Item Modal
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
    unitCost: 0,
    unitPrice: 0,
  })
  const [saving, setSaving] = useState(false)
  const { units: availableUnits } = useUnits()

  const addConversionWarning = (() => {
    if (!formData.baseUnit || !formData.displayUnit) return null
    if (formData.baseUnit === formData.displayUnit) return null
    return `⚠️ หน่วยฐาน (${UNIT_LABELS_MAP[formData.baseUnit] || formData.baseUnit}) กับหน่วยบรรจุ (${UNIT_LABELS_MAP[formData.displayUnit] || formData.displayUnit}) ต่างกัน — ควรไปสร้างการแปลงหน่วยใน Settings → Unit Conversions หลังจากเพิ่มสินค้า`
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
        unitCost: formData.unitCost || undefined,
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
        unitCost: 0,
        unitPrice: 0,
      })
    } catch (err) {
      console.error('Failed to create stock item:', err)
      toast.error('Failed to create stock item')
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
                    <option value="">{formData.unit || 'เลือกหน่วยฐาน'}</option>
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
                    <option value="">{formData.unit || 'เลือกหน่วยบรรจุ'}</option>
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
                  <label className="block text-xs text-[var(--fg-3)] mb-1">ราคาต้นทุน/หน่วยซื้อ (฿)</label>
                  <input
                    type="number"
                    value={formData.unitCost}
                    onChange={(e) => setFormData({ ...formData, unitCost: parseFloat(e.target.value) || 0 })}
                    onFocus={(e) => e.target.select()}
                    className="phopy-input w-full"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                  />
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
                  <label className="block text-xs text-[var(--fg-3)] mb-1">Min Stock</label>
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
                  <label className="block text-xs text-[var(--fg-3)] mb-1">Max Stock</label>
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
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${formData.isPosEnabled ? 'bg-[var(--success-soft)] text-success' : 'bg-gray-700 text-[var(--fg-3)]'}`}>
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
              className="flex-1 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-3)] hover:text-[var(--fg-2)] hover:border-gray-500 transition-colors text-sm"
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
