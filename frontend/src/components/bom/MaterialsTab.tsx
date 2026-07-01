import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Package,
  Plus,
  Search,
  Edit,
  Trash2,
  Loader2,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ArrowUpCircle,
  ArrowDownCircle,
  X,
  Boxes,
  DollarSign,
  TrendingDown,
  Tag,
} from 'lucide-react'
import materialsService, { Material, MaterialStats, CreateMaterialInput, MaterialCategory } from '../../services/materials'

function MaterialsTab() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [categories, setCategories] = useState<MaterialCategory[]>([])
  const [stats, setStats] = useState<MaterialStats | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null)
  const [isStockModalOpen, setIsStockModalOpen] = useState(false)
  const [stockMaterial, setStockMaterial] = useState<Material | null>(null)

  // Fetch data
  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)
      const [materialsData, statsData, categoriesData] = await Promise.all([
        materialsService.getAll(),
        materialsService.getStats(),
        materialsService.getCategories(),
      ])
      setMaterials(materialsData)
      setStats(statsData)
      setCategories(categoriesData)
    } catch (err) {
      console.error('Failed to fetch materials:', err)
      setError('ไม่สามารถโหลดข้อมูลวัตถุดิบได้')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  // Filter materials
  const filteredMaterials = (materials || []).filter(
    (m) =>
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.code.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Handle create
  const handleCreate = () => {
    setEditingMaterial(null)
    setIsModalOpen(true)
  }

  // Handle edit
  const handleEdit = (material: Material) => {
    setEditingMaterial(material)
    setIsModalOpen(true)
  }

  // Handle delete
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`คุณต้องการลบวัตถุดิบ "${name}" หรือไม่?`)) return

    try {
      await materialsService.delete(id)
      fetchData()
    } catch (err: any) {
      alert(err.response?.data?.message || 'ไม่สามารถลบวัตถุดิบได้')
    }
  }

  // Handle stock adjustment
  const handleStockAdjust = (material: Material) => {
    setStockMaterial(material)
    setIsStockModalOpen(true)
  }

  // Get status badge
  const getStatusBadge = (status?: string) => {
    const config: Record<string, { icon: any; className: string; label: string }> = {
      CRITICAL: {
        icon: AlertCircle,
        className: 'bg-[var(--danger-soft)] text-danger border-danger/30',
        label: 'Critical',
      },
      LOW: {
        icon: AlertTriangle,
        className: 'bg-[var(--warning-soft)] text-warning border-warning/30',
        label: 'Low',
      },
      ADEQUATE: {
        icon: CheckCircle,
        className: 'bg-[var(--success-soft)] text-success border-success/30',
        label: 'Adequate',
      },
      OVERSTOCK: {
        icon: Boxes,
        className: 'bg-[var(--info-soft)] text-blue-400 border-info/30',
        label: 'Overstock',
      },
      NO_STOCK: {
        icon: Package,
        className: 'bg-[var(--surface-sunken)] text-[var(--fg-3)] border-[var(--border-strong)]',
        label: 'No Stock',
      },
    }

    const selected = config[status || 'NO_STOCK'] || config.NO_STOCK
    const Icon = selected.icon

    return (
      <span className={`status-badge ${selected.className}`}>
        <Icon className="w-3 h-3" />
        {selected.label}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-[var(--primary)] animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-danger mx-auto mb-4" />
        <p className="text-[var(--fg-2)]">{error}</p>
        <button onClick={fetchData} className="phopy-btn-primary mt-4">
          ลองใหม่
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="phopy-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--fg-3)]">Total Materials</p>
              <p className="text-2xl font-bold text-[var(--primary)]">
                {stats?.totalMaterials || 0}
              </p>
            </div>
            <Package className="w-8 h-8 text-[var(--primary)]/50" />
          </div>
        </div>
        <div className="phopy-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--fg-3)]">Low Stock</p>
              <p className="text-2xl font-bold text-warning">
                {stats?.lowStockCount || 0}
              </p>
            </div>
            <TrendingDown className="w-8 h-8 text-warning/50" />
          </div>
        </div>
        <div className="phopy-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--fg-3)]">Total Value</p>
              <p className="text-2xl font-bold text-success">
                ฿{(stats?.totalValue || 0).toLocaleString()}
              </p>
            </div>
            <DollarSign className="w-8 h-8 text-success/50" />
          </div>
        </div>
        <div className="phopy-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--fg-3)]">Active Items</p>
              <p className="text-2xl font-bold text-[var(--primary)]">
                {stats?.activeItems || 0}
              </p>
            </div>
            <Boxes className="w-8 h-8 text-[var(--primary)]/50" />
          </div>
        </div>
      </div>

      {/* Search & Add */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--fg-3)]" />
          <input
            type="text"
            placeholder="Search materials..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="phopy-input pl-10 w-full"
          />
        </div>
        <button onClick={handleCreate} className="phopy-btn-primary flex items-center gap-2">
          <Plus className="w-5 h-5" />
          Add Material
        </button>
      </div>

      {/* Materials Table */}
      <div className="phopy-card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="phopy-table w-full">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Category</th>
              <th>Unit</th>
              <th>Cost/Unit</th>
              <th>Stock</th>
              <th>Status</th>
              <th>Used In</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredMaterials.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-[var(--fg-4)]">
                  {searchTerm ? 'ไม่พบวัตถุดิบที่ค้นหา' : 'ยังไม่มีวัตถุดิบ'}
                </td>
              </tr>
            ) : (
              (filteredMaterials || []).map((material) => (
                <tr key={material.id}>
                  <td className="text-[var(--primary)] font-mono">{material.code}</td>
                  <td className="text-[var(--fg-2)]">{material.name}</td>
                  <td>
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-[var(--surface)] rounded text-xs text-[var(--primary)]">
                      <Tag className="w-3 h-3" />
                      {material.categoryName || 'Uncategorized'}
                    </span>
                  </td>
                  <td className="text-[var(--fg-3)]">{material.unit}</td>
                  <td className="text-[var(--fg-3)]">฿{Number(material.unitCost).toLocaleString()}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--fg-2)]">{material.currentStock || 0}</span>
                      <span className="text-[var(--fg-4)] text-sm">
                        / {material.minStock}-{material.maxStock}
                      </span>
                    </div>
                  </td>
                  <td>{getStatusBadge(material.stockStatus)}</td>
                  <td className="text-[var(--fg-3)]">{material.usedInBOMs || 0} BOMs</td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleStockAdjust(material)}
                        className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors"
                        title="Adjust Stock"
                      >
                        <Boxes className="w-4 h-4 text-[var(--fg-3)] hover:text-success" />
                      </button>
                      <button
                        onClick={() => handleEdit(material)}
                        className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors"
                        title="Edit"
                      >
                        <Edit className="w-4 h-4 text-[var(--fg-3)] hover:text-[var(--primary)]" />
                      </button>
                      <button
                        onClick={() => handleDelete(material.id, material.name)}
                        className="p-2 rounded-lg hover:bg-[var(--danger-soft)] transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4 text-[var(--fg-3)] hover:text-danger" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Material Modal */}
      <MaterialModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={fetchData}
        editMaterial={editingMaterial}
        categories={categories}
      />

      {/* Stock Adjustment Modal */}
      <StockAdjustModal
        isOpen={isStockModalOpen}
        onClose={() => setIsStockModalOpen(false)}
        onSuccess={fetchData}
        material={stockMaterial}
      />
    </div>
  )
}

// Material Create/Edit Modal
function MaterialModal({
  isOpen,
  onClose,
  onSuccess,
  editMaterial,
  categories,
}: {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  editMaterial: Material | null
  categories: MaterialCategory[]
}) {
  const [submitting, setSubmitting] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<MaterialCategory | null>(null)
  const [formData, setFormData] = useState<CreateMaterialInput>({
    code: '',
    name: '',
    categoryId: '',
    unitCost: 0,
    minStock: 10,
    maxStock: 1000,
    initialStock: 0,
  })

  const isEdit = !!editMaterial

  useEffect(() => {
    if (editMaterial) {
      const category = categories.find(c => c.id === editMaterial.categoryId) || null
      setSelectedCategory(category)
      setFormData({
        code: editMaterial.code,
        name: editMaterial.name,
        categoryId: editMaterial.categoryId || '',
        unitCost: Number(editMaterial.unitCost),
        minStock: editMaterial.minStock,
        maxStock: editMaterial.maxStock,
      })
    } else {
      setSelectedCategory(null)
      setFormData({
        code: '',
        name: '',
        categoryId: '',
        unitCost: 0,
        minStock: 10,
        maxStock: 1000,
        initialStock: 0,
      })
    }
  }, [editMaterial, isOpen, categories])

  const handleCategoryChange = (categoryId: string) => {
    const category = categories.find(c => c.id === categoryId) || null
    setSelectedCategory(category)
    setFormData(prev => ({ ...prev, categoryId }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.code || !formData.name || !formData.categoryId) {
      alert('กรุณากรอกข้อมูลให้ครบ')
      return
    }

    setSubmitting(true)
    try {
      if (isEdit && editMaterial) {
        await materialsService.update(editMaterial.id, formData)
      } else {
        await materialsService.create(formData)
      }
      onSuccess()
      onClose()
    } catch (err: any) {
      alert(err.response?.data?.message || 'ไม่สามารถบันทึกได้')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="phopy-card w-full max-w-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-6 border-b border-[var(--border)]">
            <h2 className="text-xl font-bold text-[var(--fg-1)]">
              {isEdit ? 'แก้ไขวัตถุดิบ' : 'เพิ่มวัตถุดิบใหม่'}
            </h2>
            <button onClick={onClose} className="p-2 hover:bg-[var(--surface-2)] rounded-lg">
              <X className="w-5 h-5 text-[var(--fg-3)]" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-1">Code *</label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  className="phopy-input w-full"
                  placeholder="MAT-001"
                  disabled={isEdit}
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-1">Category *</label>
                <select
                  value={formData.categoryId}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="phopy-input w-full"
                  disabled={isEdit} // ห้ามเปลี่ยน category ตอน edit เพราะจะทำให้ unit เปลี่ยน
                >
                  <option value="">เลือกหมวดหมู่</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm text-[var(--fg-3)] mb-1">Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="phopy-input w-full"
                placeholder="Material name"
              />
            </div>

            {/* Unit - แสดงเป็น read-only ตามที่กำหนดโดย category */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-1">Unit (Auto)</label>
                <div className="phopy-input w-full bg-[var(--surface-2)] text-[var(--fg-3)] flex items-center">
                  <span className={selectedCategory ? 'text-[var(--primary)] font-semibold' : ''}>
                    {selectedCategory?.defaultUnit || 'เลือกหมวดหมู่ก่อน'}
                  </span>
                </div>
                <p className="text-xs text-[var(--fg-4)] mt-1">
                  หน่วยถูกกำหนดโดยอัตโนมัติตามหมวดหมู่
                </p>
              </div>
              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-1">Cost per Unit (฿) *</label>
                <input
                  type="number"
                  value={formData.unitCost}
                  onChange={(e) => setFormData({ ...formData, unitCost: parseFloat(e.target.value) || 0 })}
                  className="phopy-input w-full"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-1">Min Stock</label>
                <input
                  type="number"
                  value={formData.minStock}
                  onChange={(e) => setFormData({ ...formData, minStock: parseInt(e.target.value) || 0 })}
                  className="phopy-input w-full"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-1">Max Stock</label>
                <input
                  type="number"
                  value={formData.maxStock}
                  onChange={(e) => setFormData({ ...formData, maxStock: parseInt(e.target.value) || 0 })}
                  className="phopy-input w-full"
                  min="0"
                />
              </div>
            </div>

            {!isEdit && (
              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-1">Initial Stock</label>
                <input
                  type="number"
                  value={formData.initialStock}
                  onChange={(e) => setFormData({ ...formData, initialStock: parseInt(e.target.value) || 0 })}
                  className="phopy-input w-full"
                  min="0"
                />
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4">
              <button type="button" onClick={onClose} className="px-4 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-2)]">
                ยกเลิก
              </button>
              <button 
                type="submit" 
                disabled={submitting || !selectedCategory} 
                className="phopy-btn-primary disabled:opacity-50"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {isEdit ? 'บันทึก' : 'เพิ่ม'}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// Stock Adjustment Modal
function StockAdjustModal({
  isOpen,
  onClose,
  onSuccess,
  material,
}: {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  material: Material | null
}) {
  const [type, setType] = useState<'IN' | 'OUT' | 'ADJUST'>('IN')
  const [quantity, setQuantity] = useState(0)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setType('IN')
      setQuantity(0)
      setNotes('')
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!material || quantity <= 0) {
      alert('กรุณาระบุจำนวน')
      return
    }

    setSubmitting(true)
    try {
      await materialsService.adjustStock(material.id, { type, quantity, notes })
      onSuccess()
      onClose()
    } catch (err: any) {
      alert(err.response?.data?.message || 'ไม่สามารถปรับ Stock ได้')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen || !material) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="phopy-card w-full max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-6 border-b border-[var(--border)]">
            <h2 className="text-xl font-bold text-[var(--fg-1)]">Adjust Stock</h2>
            <button onClick={onClose} className="p-2 hover:bg-[var(--surface-2)] rounded-lg">
              <X className="w-5 h-5 text-[var(--fg-3)]" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="text-center p-4 bg-[var(--surface-2)] rounded-lg">
              <p className="text-[var(--fg-3)] text-sm">Material</p>
              <p className="text-lg font-bold text-[var(--fg-1)]">{material.name}</p>
              <p className="text-[var(--primary)]">
                Current Stock: {material.currentStock || 0} {material.unit}
              </p>
            </div>

            <div>
              <label className="block text-sm text-[var(--fg-3)] mb-2">Type</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setType('IN')}
                  className={`p-3 rounded-lg border flex flex-col items-center gap-1 ${
                    type === 'IN'
                      ? 'border-success bg-[var(--success-soft)] text-success'
                      : 'border-[var(--border)] text-[var(--fg-3)]'
                  }`}
                >
                  <ArrowDownCircle className="w-5 h-5" />
                  <span className="text-sm">Stock In</span>
                </button>
                <button
                  type="button"
                  onClick={() => setType('OUT')}
                  className={`p-3 rounded-lg border flex flex-col items-center gap-1 ${
                    type === 'OUT'
                      ? 'border-red-400 bg-[var(--danger-soft)] text-danger'
                      : 'border-[var(--border)] text-[var(--fg-3)]'
                  }`}
                >
                  <ArrowUpCircle className="w-5 h-5" />
                  <span className="text-sm">Stock Out</span>
                </button>
                <button
                  type="button"
                  onClick={() => setType('ADJUST')}
                  className={`p-3 rounded-lg border flex flex-col items-center gap-1 ${
                    type === 'ADJUST'
                      ? 'border-phopy-indigo bg-[var(--primary-soft)] text-[var(--primary)]'
                      : 'border-[var(--border)] text-[var(--fg-3)]'
                  }`}
                >
                  <Edit className="w-5 h-5" />
                  <span className="text-sm">Adjust</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm text-[var(--fg-3)] mb-1">
                {type === 'ADJUST' ? 'New Quantity' : 'Quantity'}
              </label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(parseFloat(e.target.value) || 0)}
                className="phopy-input w-full"
                min="0"
                step="0.01"
              />
            </div>

            <div>
              <label className="block text-sm text-[var(--fg-3)] mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="phopy-input w-full"
                rows={2}
                placeholder="Optional notes..."
              />
            </div>

            {type !== 'ADJUST' && (
              <div className="text-center p-3 bg-[var(--bg)]/30 rounded-lg">
                <p className="text-sm text-[var(--fg-3)]">New Stock:</p>
                <p className="text-xl font-bold text-[var(--primary)]">
                  {type === 'IN'
                    ? (material.currentStock || 0) + quantity
                    : (material.currentStock || 0) - quantity}{' '}
                  {material.unit}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4">
              <button type="button" onClick={onClose} className="px-4 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-2)]">
                ยกเลิก
              </button>
              <button type="submit" disabled={submitting} className="phopy-btn-primary">
                {submitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Confirm
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default MaterialsTab
