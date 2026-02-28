import { useState, useEffect } from 'react'
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
} from 'lucide-react'
import stockService, { StockItem, StockStats } from '../services/stock'
import { SearchableDropdown } from '../components/common/SearchableDropdown'
import ImportModal from '../components/common/ImportModal'

// รายการหน่วยพื้นฐาน
const DEFAULT_UNITS = [
  { value: 'pcs', label: 'ชิ้น' },
  { value: 'kg', label: 'กิโลกรัม' },
  { value: 'g', label: 'กรัม' },
  { value: 'm', label: 'เมตร' },
  { value: 'cm', label: 'เซนติเมตร' },
  { value: 'yard', label: 'หลา' },
  { value: 'roll', label: 'ม้วน' },
  { value: 'box', label: 'กล่อง' },
  { value: 'pack', label: 'แพ็ค' },
  { value: 'set', label: 'ชุด' },
  { value: 'pair', label: 'คู่' },
  { value: 'sheet', label: 'แผ่น' },
  { value: 'ltr', label: 'ลิตร' },
  { value: 'bottle', label: 'ขวด' },
]

// ดึงหน่วยจาก localStorage
const getUnits = () => {
  const saved = localStorage.getItem('customUnits')
  const customUnits = saved ? JSON.parse(saved) : []
  return [...DEFAULT_UNITS, ...customUnits]
}

function Stock() {
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [stats, setStats] = useState<StockStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('all')

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(50)

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

  const filteredItems = (stockItems || []).filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCategory =
      selectedCategory === 'all' || item.category.toLowerCase() === selectedCategory.toLowerCase()
    const status = getItemStatus(item)
    const matchesStatus = selectedStatus === 'all' || status === selectedStatus
    return matchesSearch && matchesCategory && matchesStatus
  })

  // Pagination logic
  const totalItems = filteredItems.length
  const totalPages = Math.ceil(totalItems / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedItems = filteredItems.slice(startIndex, endIndex)

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
      alert('Cannot perform Stock Out - item is out of stock!')
      return
    }
    setMovementModal({ open: true, type, item })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-cyber-primary animate-spin" />
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
          <h1 className="text-3xl font-bold text-gray-100 mb-2 font-['Orbitron']">
            <span className="neon-text">Inventory Management</span>
          </h1>
          <p className="text-gray-400">Track and manage your stock levels</p>
        </div>
        <div className="flex gap-3">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowImportModal(true)}
            className="cyber-btn-secondary flex items-center gap-2"
          >
            <Upload className="w-5 h-5" />
            Import
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setMovementModal({ open: true, type: 'IN', item: null })}
            className="cyber-btn-secondary flex items-center gap-2"
          >
            <ArrowUpCircle className="w-5 h-5" />
            Stock In
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setMovementModal({ open: true, type: 'OUT', item: null })}
            className="cyber-btn-primary flex items-center gap-2"
          >
            <ArrowDownCircle className="w-5 h-5" />
            Stock Out
          </motion.button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          label="Total Items"
          value={(stats?.totalItems ?? 0).toString()}
          icon={Package}
          color="primary"
        />
        <StatCard
          label="Critical Stock"
          value={(stats?.criticalCount ?? 0).toString()}
          icon={AlertTriangle}
          color="red"
        />
        <StatCard
          label="Low Stock"
          value={(stats?.lowStockCount ?? 0).toString()}
          icon={TrendingDown}
          color="yellow"
        />
        <StatCard
          label="Total Value"
          value={`฿${(stats?.totalValue ?? 0).toLocaleString()}`}
          icon={TrendingUp}
          color="green"
        />
      </div>

      {/* Filters */}
      <div className="cyber-card p-6">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search items by name or SKU..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="cyber-input pl-10 w-full"
            />
          </div>

          {/* Category Filter */}
          <div className="flex gap-2 flex-wrap">
            <FilterButton
              label="All"
              active={selectedCategory === 'all'}
              onClick={() => handleCategoryChange('all')}
            />
            <FilterButton
              label="Raw Material"
              active={selectedCategory === 'raw'}
              onClick={() => handleCategoryChange('raw')}
            />
            <FilterButton
              label="WIP"
              active={selectedCategory === 'wip'}
              onClick={() => handleCategoryChange('wip')}
            />
            <FilterButton
              label="Finished"
              active={selectedCategory === 'finished'}
              onClick={() => handleCategoryChange('finished')}
            />
          </div>

          {/* Status Filter */}
          <div className="flex gap-2 flex-wrap">
            <FilterButton
              label="All Status"
              active={selectedStatus === 'all'}
              onClick={() => handleStatusChange('all')}
            />
            <FilterButton
              label="Out of Stock"
              active={selectedStatus === 'out'}
              onClick={() => handleStatusChange('out')}
            />
            <FilterButton
              label="Critical"
              active={selectedStatus === 'critical'}
              onClick={() => handleStatusChange('critical')}
            />
            <FilterButton
              label="Low"
              active={selectedStatus === 'low'}
              onClick={() => handleStatusChange('low')}
            />
          </div>
        </div>
      </div>

      {/* Stock List */}
      <div className="cyber-card p-6">
        <div className="overflow-x-auto">
          <table className="cyber-table">
            <thead>
              <tr>
                <th>Item Name</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Current Stock</th>
                <th>Min / Max</th>
                <th>Location</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-gray-500">
                    No stock items found
                  </td>
                </tr>
              ) : (
                paginatedItems.map((item, index) => {
                  const status = getItemStatus(item)
                  return (
                    <motion.tr
                      key={item.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <td>
                        <div className="flex items-center gap-2">
                          <Package className="w-5 h-5 text-cyber-primary" />
                          <span className="text-gray-300 font-medium">
                            {item.name}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="text-gray-400 font-mono text-sm">
                          {item.sku}
                        </span>
                      </td>
                      <td>
                        <CategoryBadge category={item.category} />
                      </td>
                      <td>
                        <span className={`font-semibold ${item.quantity === 0 ? 'text-red-400' : 'text-cyber-primary'}`}>
                          {item.quantity} {item.unit}
                        </span>
                      </td>
                      <td>
                        <span className="text-gray-400 text-sm">
                          {item.minStock} / {item.maxStock}
                        </span>
                      </td>
                      <td>
                        <span className="text-gray-400 text-sm">
                          {item.location || '-'}
                        </span>
                      </td>
                      <td>
                        <StatusBadge status={status} />
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleOpenDetail(item)}
                            className="p-2 text-gray-400 hover:text-cyber-primary hover:bg-cyber-primary/10 rounded-lg transition-colors"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setEditModal({ open: true, item })}
                            className="p-2 text-gray-400 hover:text-yellow-400 hover:bg-yellow-400/10 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleStockMovement('IN', item)}
                            className="p-2 text-gray-400 hover:text-cyber-green hover:bg-cyber-green/10 rounded-lg transition-colors"
                            title="Stock In"
                          >
                            <ArrowUpCircle className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleStockMovement('OUT', item)}
                            disabled={item.quantity === 0}
                            className={`p-2 rounded-lg transition-colors ${item.quantity === 0
                              ? 'text-gray-600 cursor-not-allowed'
                              : 'text-gray-400 hover:text-red-400 hover:bg-red-400/10'
                              }`}
                            title={item.quantity === 0 ? 'Out of Stock' : 'Stock Out'}
                          >
                            <ArrowDownCircle className="w-4 h-4" />
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
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-cyber-border">
          <div className="flex items-center gap-4">
            <span className="text-gray-400 text-sm">
              แสดง <span className="text-cyber-primary font-semibold">{startIndex + 1}-{Math.min(endIndex, totalItems)}</span> จาก <span className="text-cyber-primary font-semibold">{totalItems}</span> รายการ
            </span>

            {/* Items Per Page Selector */}
            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value))
                setCurrentPage(1)
              }}
              className="cyber-input text-sm py-1 px-2"
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
              className="px-3 py-1 text-sm rounded bg-cyber-dark border border-cyber-border text-gray-300 hover:border-cyber-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              หน้าแรก
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm rounded bg-cyber-dark border border-cyber-border text-gray-300 hover:border-cyber-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              ก่อนหน้า
            </button>

            <span className="px-4 py-1 text-sm text-cyber-primary font-semibold bg-cyber-primary/10 rounded border border-cyber-primary/30">
              หน้า {currentPage} / {totalPages || 1}
            </span>

            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages || totalPages === 0}
              className="px-3 py-1 text-sm rounded bg-cyber-dark border border-cyber-border text-gray-300 hover:border-cyber-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              ถัดไป
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages || totalPages === 0}
              className="px-3 py-1 text-sm rounded bg-cyber-dark border border-cyber-border text-gray-300 hover:border-cyber-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
  if (!open || !item) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="cyber-card w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-scaleIn"
      >
        <div className="p-6 border-b border-cyber-border flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-100">Stock Item Details</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-cyber-dark rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Item Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-400 mb-1">Name</p>
              <p className="text-gray-200 font-medium">{item.name}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400 mb-1">SKU</p>
              <p className="text-gray-200 font-mono">{item.sku}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400 mb-1">Category</p>
              <CategoryBadge category={item.category} />
            </div>
            <div>
              <p className="text-sm text-gray-400 mb-1">Current Stock</p>
              <p className={`font-bold text-lg ${item.quantity === 0 ? 'text-red-400' : 'text-cyber-primary'}`}>
                {item.quantity} {item.unit}
                {item.quantity === 0 && (
                  <span className="ml-2 text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded">
                    OUT OF STOCK
                  </span>
                )}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-400 mb-1">Min Stock</p>
              <p className="text-gray-200">{item.minStock} {item.unit}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400 mb-1">Max Stock</p>
              <p className="text-gray-200">{item.maxStock} {item.unit}</p>
            </div>
            <div className="col-span-2">
              <p className="text-sm text-gray-400 mb-1">Location</p>
              <div className="flex items-center gap-2 text-gray-200">
                <MapPin className="w-4 h-4 text-cyber-primary" />
                {item.location || 'Not specified'}
              </div>
            </div>
          </div>

          {/* Related Material/Product */}
          {item.material && (
            <div className="p-4 bg-cyber-darker rounded-lg">
              <p className="text-sm text-gray-400 mb-2">Related Material</p>
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-gray-200 font-medium">{item.material.name}</p>
                  <p className="text-gray-400 text-sm">{item.material.code}</p>
                </div>
                <p className="text-cyber-green font-semibold">
                  ฿{Number(item.material.unitCost).toLocaleString()}/unit
                </p>
              </div>
            </div>
          )}

          {/* Movement History */}
          {item.movements && item.movements.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-gray-200 mb-3">Recent Movements</h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {item.movements.slice(0, 10).map((movement) => (
                  <div
                    key={movement.id}
                    className="flex items-center justify-between p-3 bg-cyber-darker rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      {movement.type === 'IN' ? (
                        <ArrowUpCircle className="w-5 h-5 text-cyber-green" />
                      ) : movement.type === 'OUT' ? (
                        <ArrowDownCircle className="w-5 h-5 text-red-400" />
                      ) : (
                        <Package className="w-5 h-5 text-yellow-400" />
                      )}
                      <div>
                        <p className="text-gray-200">
                          {movement.type === 'IN' ? '+' : movement.type === 'OUT' ? '-' : ''}
                          {movement.quantity} {item.unit}
                        </p>
                        {movement.notes && (
                          <p className="text-gray-400 text-sm">{movement.notes}</p>
                        )}
                        {movement.journalNumber && (
                          <a href={`/accounting/journal?entry=${movement.journalId}`} className="text-cyber-primary text-sm hover:underline" target="_blank" rel="noopener noreferrer">
                            {movement.journalNumber}
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-gray-400 text-sm flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(movement.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    minStock: 0,
    maxStock: 0,
    location: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (item) {
      setFormData({
        name: item.name || '',
        category: item.category || '',
        minStock: item.minStock ?? 0,
        maxStock: item.maxStock ?? 0,
        location: item.location || '',
      })
    }
  }, [item])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!item) return

    setSaving(true)
    try {
      await stockService.update(item.id, formData)
      onSave()
      onClose()
    } catch (err) {
      console.error('Failed to update stock item:', err)
      alert('Failed to update stock item')
    } finally {
      setSaving(false)
    }
  }

  if (!open || !item) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="cyber-card w-full max-w-lg animate-scaleIn"
      >
        <div className="p-6 border-b border-cyber-border flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-100">Edit Stock Item</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-cyber-dark rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="cyber-input w-full"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Category</label>
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className="cyber-input w-full"
              required
            >
              <option value="raw">Raw Material</option>
              <option value="wip">WIP</option>
              <option value="finished">Finished</option>
              <option value="material">Material</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Min Stock</label>
              <input
                type="number"
                value={formData.minStock}
                onChange={(e) => setFormData({ ...formData, minStock: parseInt(e.target.value) || 0 })}
                className="cyber-input w-full"
                min="0"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Max Stock</label>
              <input
                type="number"
                value={formData.maxStock}
                onChange={(e) => setFormData({ ...formData, maxStock: parseInt(e.target.value) || 0 })}
                className="cyber-input w-full"
                min="0"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Location</label>
            <input
              type="text"
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              className="cyber-input w-full"
              placeholder="e.g., Warehouse A - Zone 1"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-cyber-border rounded-lg text-gray-400 hover:text-gray-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="cyber-btn-primary flex items-center gap-2"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Edit2 className="w-4 h-4" />
              )}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
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
  const [selectedItemId, setSelectedItemId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [notes, setNotes] = useState('')
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (item) {
      setSelectedItemId(item.id)
    } else {
      setSelectedItemId('')
    }
    setQuantity(1)
    setNotes('')
    setReference('')
  }, [item, open])

  const selectedItem = stockItems.find((i) => i.id === selectedItemId)
  const isOutOfStock = selectedItem && selectedItem.quantity === 0 && type === 'OUT'
  const exceedsStock = selectedItem && type === 'OUT' && quantity > selectedItem.quantity

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedItemId) {
      alert('Please select an item')
      return
    }

    if (isOutOfStock) {
      alert('Cannot perform Stock Out - item is out of stock!')
      return
    }

    if (exceedsStock) {
      alert(`Cannot take out more than available stock (${selectedItem?.quantity})`)
      return
    }

    setSaving(true)
    try {
      await stockService.recordMovement({
        stockItemId: selectedItemId,
        type,
        quantity,
        notes: notes || undefined,
        reference: reference || undefined,
      })
      onSave()
      onClose()
    } catch (err) {
      console.error('Failed to record movement:', err)
      alert('Failed to record movement')
    } finally {
      setSaving(false)
    }
  }

  // Filter items for Stock Out - exclude items with 0 quantity
  const availableItems = type === 'OUT'
    ? (stockItems || []).filter((i) => i.quantity > 0)
    : stockItems

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="cyber-card w-full max-w-lg animate-scaleIn"
      >
        <div className={`p-6 border-b border-cyber-border flex items-center justify-between ${type === 'IN' ? 'bg-cyber-green/10' : 'bg-red-500/10'
          }`}>
          <div className="flex items-center gap-3">
            {type === 'IN' ? (
              <ArrowUpCircle className="w-6 h-6 text-cyber-green" />
            ) : (
              <ArrowDownCircle className="w-6 h-6 text-red-400" />
            )}
            <h2 className="text-xl font-bold text-gray-100">
              Stock {type === 'IN' ? 'In' : 'Out'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-cyber-dark rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Select Item</label>
            <SearchableDropdown
              value={selectedItemId}
              onChange={setSelectedItemId}
              options={availableItems.map((stockItem) => ({
                id: stockItem.id,
                label: `${stockItem.name} (${stockItem.sku}) - ${stockItem.quantity} ${stockItem.unit}`,
                searchText: `${stockItem.name} ${stockItem.sku}`,
              }))}
              placeholder="-- Select Item --"
              disabled={!!item}
            />
            {type === 'OUT' && availableItems.length === 0 && (
              <p className="text-red-400 text-sm mt-2 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                No items available for Stock Out
              </p>
            )}
            {type === 'IN' && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-sm text-gray-500">Item not found?</span>
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    setShowAddModal(true)
                  }}
                  className="text-sm text-cyber-primary hover:text-cyber-secondary flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Create New Item
                </button>
              </div>
            )}
          </div>

          {selectedItem && (
            <div className="p-4 bg-cyber-darker rounded-lg">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Current Stock:</span>
                <span className={`font-bold ${selectedItem.quantity === 0 ? 'text-red-400' : 'text-cyber-primary'}`}>
                  {selectedItem.quantity} {selectedItem.unit}
                  {selectedItem.quantity === 0 && (
                    <span className="ml-2 text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded">
                      OUT OF STOCK
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}

          {isOutOfStock && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-red-400 flex-shrink-0" />
              <div>
                <p className="text-red-400 font-medium">Cannot Proceed</p>
                <p className="text-red-400/70 text-sm">This item is out of stock. Stock Out is not allowed.</p>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-400 mb-2">Quantity</label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
              className="cyber-input w-full"
              min="1"
              max={type === 'OUT' && selectedItem ? selectedItem.quantity : undefined}
              required
              disabled={isOutOfStock}
            />
            {exceedsStock && (
              <p className="text-red-400 text-sm mt-1">
                Cannot exceed available stock ({selectedItem?.quantity})
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Reference (Optional)</label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="cyber-input w-full"
              placeholder="e.g., PO-2024-001"
              disabled={isOutOfStock}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Notes (Optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="cyber-input w-full"
              rows={3}
              placeholder="Additional notes..."
              disabled={isOutOfStock}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-cyber-border rounded-lg text-gray-400 hover:text-gray-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || isOutOfStock || exceedsStock || !selectedItemId}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${type === 'IN'
                ? 'bg-cyber-green text-black hover:shadow-neon-green disabled:opacity-50'
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
    primary: 'text-cyber-primary',
    green: 'text-cyber-green',
    yellow: 'text-yellow-400',
    red: 'text-red-400',
  }[color]

  return (
    <div className="cyber-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400 mb-1">{label}</p>
          <p className={`text-2xl font-bold ${colorClass} font-['Orbitron']`}>
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
        ? 'bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/50'
        : 'bg-cyber-darker text-gray-400 border border-cyber-border hover:border-cyber-primary/30'
        }`}
    >
      {label}
    </button>
  )
}

function CategoryBadge({ category }: { category: string }) {
  const config: Record<string, { label: string; color: string }> = {
    raw: { label: 'Raw Material', color: 'text-blue-400 bg-blue-500/20 border-blue-500/30' },
    wip: { label: 'WIP', color: 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30' },
    finished: { label: 'Finished', color: 'text-cyber-green bg-cyber-green/20 border-cyber-green/30' },
    material: { label: 'Material', color: 'text-purple-400 bg-purple-500/20 border-purple-500/30' },
  }

  const selected = config[category.toLowerCase()] || config.material

  return (
    <span className={`status-badge ${selected.color}`}>{selected.label}</span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    adequate: {
      label: 'Adequate',
      className: 'bg-cyber-green/20 text-cyber-green border-cyber-green/30',
    },
    low: {
      label: 'Low',
      className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    },
    critical: {
      label: 'Critical',
      className: 'bg-red-500/20 text-red-400 border-red-500/30',
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
  const [formData, setFormData] = useState({
    sku: '',
    name: '',
    category: 'raw',
    unit: 'pcs',
    quantity: 0,
    minStock: 10,
    maxStock: 100,
    location: '',
  })
  const [saving, setSaving] = useState(false)
  const [showUnitModal, setShowUnitModal] = useState(false)
  const [newUnit, setNewUnit] = useState({ value: '', label: '' })

  const handleAddUnit = () => {
    if (!newUnit.value || !newUnit.label) return
    const saved = localStorage.getItem('customUnits')
    const customUnits = saved ? JSON.parse(saved) : []
    customUnits.push(newUnit)
    localStorage.setItem('customUnits', JSON.stringify(customUnits))
    setNewUnit({ value: '', label: '' })
    setShowUnitModal(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.sku || !formData.name) {
      alert('Please enter SKU and Name')
      return
    }

    setSaving(true)
    try {
      await stockService.create({
        sku: formData.sku,
        name: formData.name,
        category: formData.category,
        unit: formData.unit,
        quantity: formData.quantity,
        minStock: formData.minStock,
        maxStock: formData.maxStock,
        location: formData.location || 'Main Warehouse',
      })
      onSave()
      // Reset form
      setFormData({
        sku: '',
        name: '',
        category: 'raw',
        unit: 'pcs',
        quantity: 0,
        minStock: 10,
        maxStock: 100,
        location: '',
      })
    } catch (err) {
      console.error('Failed to create stock item:', err)
      alert('Failed to create stock item')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="cyber-card w-full max-w-lg animate-scaleIn"
      >
        <div className="p-6 border-b border-cyber-border flex items-center justify-between bg-cyber-green/10">
          <div className="flex items-center gap-3">
            <Package className="w-6 h-6 text-cyber-green" />
            <h2 className="text-xl font-bold text-gray-100">Create New Stock Item</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-cyber-dark rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">SKU *</label>
              <input
                type="text"
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                className="cyber-input w-full"
                placeholder="e.g., RAW-001"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Category</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="cyber-input w-full"
              >
                <option value="raw">Raw Material</option>
                <option value="wip">WIP</option>
                <option value="finished">Finished</option>
                <option value="material">Material</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Item Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="cyber-input w-full"
              placeholder="Enter item name"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">หน่วย</label>
              <select
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                className="cyber-input w-full"
              >
                {getUnits().map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowUnitModal(true)}
                className="text-xs text-cyber-primary hover:underline mt-1"
              >
                + เพิ่มหน่วยใหม่
              </button>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Initial Quantity</label>
              <input
                type="number"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 })}
                className="cyber-input w-full"
                min="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Min Stock</label>
              <input
                type="number"
                value={formData.minStock}
                onChange={(e) => setFormData({ ...formData, minStock: parseInt(e.target.value) || 0 })}
                className="cyber-input w-full"
                min="0"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Max Stock</label>
              <input
                type="number"
                value={formData.maxStock}
                onChange={(e) => setFormData({ ...formData, maxStock: parseInt(e.target.value) || 0 })}
                className="cyber-input w-full"
                min="0"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Location</label>
            <input
              type="text"
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              className="cyber-input w-full"
              placeholder="e.g., Main Warehouse, A-12"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-cyber-border rounded-lg text-gray-400 hover:text-gray-300"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold bg-cyber-green text-black hover:shadow-neon-green disabled:opacity-50"
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

        {/* Add Unit Modal */}
        {showUnitModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4 animate-fadeIn">
            <div className="cyber-card w-full max-w-sm animate-scaleIn">
              <div className="p-4 border-b border-cyber-border flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-100">เพิ่มหน่วยใหม่</h3>
                <button onClick={() => setShowUnitModal(false)} className="p-1 hover:bg-cyber-dark rounded">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">รหัสหน่วย (ภาษาอังกฤษ)</label>
                  <input
                    type="text"
                    value={newUnit.value}
                    onChange={(e) => setNewUnit({ ...newUnit, value: e.target.value })}
                    placeholder="เช่น ลัง"
                    className="cyber-input w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">ชื่อหน่วย (ภาษาไทย)</label>
                  <input
                    type="text"
                    value={newUnit.label}
                    onChange={(e) => setNewUnit({ ...newUnit, label: e.target.value })}
                    placeholder="เช่น ลัง"
                    className="cyber-input w-full text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setShowUnitModal(false)}
                    className="px-3 py-1.5 text-sm border border-cyber-border rounded text-gray-400 hover:text-gray-300"
                  >
                    ยกเลิก
                  </button>
                  <button
                    onClick={handleAddUnit}
                    disabled={!newUnit.value || !newUnit.label}
                    className="px-3 py-1.5 text-sm bg-cyber-primary text-black rounded hover:shadow-neon disabled:opacity-50"
                  >
                    บันทึก
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Stock
