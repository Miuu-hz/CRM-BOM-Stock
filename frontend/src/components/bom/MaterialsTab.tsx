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
} from 'lucide-react'
import materialsService, { Material, MaterialStats, CreateMaterialInput } from '../../services/materials'

function MaterialsTab() {
  const [materials, setMaterials] = useState<Material[]>([])
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
      const [materialsData, statsData] = await Promise.all([
        materialsService.getAll(),
        materialsService.getStats(),
      ])
      setMaterials(materialsData)
      setStats(statsData)
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
  const filteredMaterials = materials.filter(
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
        className: 'bg-red-500/20 text-red-400 border-red-500/30',
        label: 'Critical',
      },
      LOW: {
        icon: AlertTriangle,
        className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
        label: 'Low',
      },
      ADEQUATE: {
        icon: CheckCircle,
        className: 'bg-cyber-green/20 text-cyber-green border-cyber-green/30',
        label: 'Adequate',
      },
      OVERSTOCK: {
        icon: Boxes,
        className: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
        label: 'Overstock',
      },
      NO_STOCK: {
        icon: Package,
        className: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
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
        <Loader2 className="w-8 h-8 text-cyber-primary animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <p className="text-gray-300">{error}</p>
        <button onClick={fetchData} className="cyber-btn-primary mt-4">
          ลองใหม่
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="cyber-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Total Materials</p>
              <p className="text-2xl font-bold text-cyber-primary">
                {stats?.totalMaterials || 0}
              </p>
            </div>
            <Package className="w-8 h-8 text-cyber-primary/50" />
          </div>
        </div>
        <div className="cyber-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Low Stock</p>
              <p className="text-2xl font-bold text-yellow-400">
                {stats?.lowStockCount || 0}
              </p>
            </div>
            <TrendingDown className="w-8 h-8 text-yellow-400/50" />
          </div>
        </div>
        <div className="cyber-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Total Value</p>
              <p className="text-2xl font-bold text-cyber-green">
                ฿{(stats?.totalValue || 0).toLocaleString()}
              </p>
            </div>
            <DollarSign className="w-8 h-8 text-cyber-green/50" />
          </div>
        </div>
        <div className="cyber-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Active Items</p>
              <p className="text-2xl font-bold text-cyber-primary">
                {stats?.activeItems || 0}
              </p>
            </div>
            <Boxes className="w-8 h-8 text-cyber-primary/50" />
          </div>
        </div>
      </div>

      {/* Search & Add */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search materials..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="cyber-input pl-10 w-full"
          />
        </div>
        <button onClick={handleCreate} className="cyber-btn-primary flex items-center gap-2">
          <Plus className="w-5 h-5" />
          Add Material
        </button>
      </div>

      {/* Materials Table */}
      <div className="cyber-card overflow-hidden">
        <table className="cyber-table w-full">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
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
                <td colSpan={8} className="text-center py-8 text-gray-500">
                  {searchTerm ? 'ไม่พบวัตถุดิบที่ค้นหา' : 'ยังไม่มีวัตถุดิบ'}
                </td>
              </tr>
            ) : (
              filteredMaterials.map((material) => (
                <tr key={material.id}>
                  <td className="text-cyber-primary font-mono">{material.code}</td>
                  <td className="text-gray-200">{material.name}</td>
                  <td className="text-gray-400">{material.unit}</td>
                  <td className="text-gray-400">฿{Number(material.unitCost).toLocaleString()}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-300">{material.currentStock || 0}</span>
                      <span className="text-gray-500 text-sm">
                        / {material.minStock}-{material.maxStock}
                      </span>
                    </div>
                  </td>
                  <td>{getStatusBadge(material.stockStatus)}</td>
                  <td className="text-gray-400">{material.usedInBOMs || 0} BOMs</td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleStockAdjust(material)}
                        className="p-2 rounded-lg hover:bg-cyber-card/50 transition-colors"
                        title="Adjust Stock"
                      >
                        <Boxes className="w-4 h-4 text-gray-400 hover:text-cyber-green" />
                      </button>
                      <button
                        onClick={() => handleEdit(material)}
                        className="p-2 rounded-lg hover:bg-cyber-card/50 transition-colors"
                        title="Edit"
                      >
                        <Edit className="w-4 h-4 text-gray-400 hover:text-cyber-primary" />
                      </button>
                      <button
                        onClick={() => handleDelete(material.id, material.name)}
                        className="p-2 rounded-lg hover:bg-red-500/10 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4 text-gray-400 hover:text-red-400" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Material Modal */}
      <MaterialModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={fetchData}
        editMaterial={editingMaterial}
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
}: {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  editMaterial: Material | null
}) {
  const [submitting, setSubmitting] = useState(false)
  const [formData, setFormData] = useState<CreateMaterialInput>({
    code: '',
    name: '',
    unit: '',
    unitCost: 0,
    minStock: 10,
    maxStock: 1000,
    initialStock: 0,
  })

  const isEdit = !!editMaterial

  useEffect(() => {
    if (editMaterial) {
      setFormData({
        code: editMaterial.code,
        name: editMaterial.name,
        unit: editMaterial.unit,
        unitCost: Number(editMaterial.unitCost),
        minStock: editMaterial.minStock,
        maxStock: editMaterial.maxStock,
      })
    } else {
      setFormData({
        code: '',
        name: '',
        unit: '',
        unitCost: 0,
        minStock: 10,
        maxStock: 1000,
        initialStock: 0,
      })
    }
  }, [editMaterial, isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.code || !formData.name || !formData.unit) {
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
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="cyber-card w-full max-w-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-6 border-b border-cyber-border">
            <h2 className="text-xl font-bold text-gray-100">
              {isEdit ? 'แก้ไขวัตถุดิบ' : 'เพิ่มวัตถุดิบใหม่'}
            </h2>
            <button onClick={onClose} className="p-2 hover:bg-cyber-card/50 rounded-lg">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Code *</label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  className="cyber-input w-full"
                  placeholder="MAT-001"
                  disabled={isEdit}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Unit *</label>
                <input
                  type="text"
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  className="cyber-input w-full"
                  placeholder="kg, pcs, meters"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="cyber-input w-full"
                placeholder="Material name"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Cost per Unit (฿) *</label>
              <input
                type="number"
                value={formData.unitCost}
                onChange={(e) => setFormData({ ...formData, unitCost: parseFloat(e.target.value) || 0 })}
                className="cyber-input w-full"
                min="0"
                step="0.01"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Min Stock</label>
                <input
                  type="number"
                  value={formData.minStock}
                  onChange={(e) => setFormData({ ...formData, minStock: parseInt(e.target.value) || 0 })}
                  className="cyber-input w-full"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Max Stock</label>
                <input
                  type="number"
                  value={formData.maxStock}
                  onChange={(e) => setFormData({ ...formData, maxStock: parseInt(e.target.value) || 0 })}
                  className="cyber-input w-full"
                  min="0"
                />
              </div>
            </div>

            {!isEdit && (
              <div>
                <label className="block text-sm text-gray-400 mb-1">Initial Stock</label>
                <input
                  type="number"
                  value={formData.initialStock}
                  onChange={(e) => setFormData({ ...formData, initialStock: parseInt(e.target.value) || 0 })}
                  className="cyber-input w-full"
                  min="0"
                />
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4">
              <button type="button" onClick={onClose} className="px-4 py-2 border border-cyber-border rounded-lg text-gray-300">
                ยกเลิก
              </button>
              <button type="submit" disabled={submitting} className="cyber-btn-primary">
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
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="cyber-card w-full max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-6 border-b border-cyber-border">
            <h2 className="text-xl font-bold text-gray-100">Adjust Stock</h2>
            <button onClick={onClose} className="p-2 hover:bg-cyber-card/50 rounded-lg">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="text-center p-4 bg-cyber-dark/50 rounded-lg">
              <p className="text-gray-400 text-sm">Material</p>
              <p className="text-lg font-bold text-gray-100">{material.name}</p>
              <p className="text-cyber-primary">
                Current Stock: {material.currentStock || 0} {material.unit}
              </p>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">Type</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setType('IN')}
                  className={`p-3 rounded-lg border flex flex-col items-center gap-1 ${
                    type === 'IN'
                      ? 'border-cyber-green bg-cyber-green/20 text-cyber-green'
                      : 'border-cyber-border text-gray-400'
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
                      ? 'border-red-400 bg-red-400/20 text-red-400'
                      : 'border-cyber-border text-gray-400'
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
                      ? 'border-cyber-primary bg-cyber-primary/20 text-cyber-primary'
                      : 'border-cyber-border text-gray-400'
                  }`}
                >
                  <Edit className="w-5 h-5" />
                  <span className="text-sm">Adjust</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                {type === 'ADJUST' ? 'New Quantity' : 'Quantity'}
              </label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(parseFloat(e.target.value) || 0)}
                className="cyber-input w-full"
                min="0"
                step="0.01"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="cyber-input w-full"
                rows={2}
                placeholder="Optional notes..."
              />
            </div>

            {type !== 'ADJUST' && (
              <div className="text-center p-3 bg-cyber-dark/30 rounded-lg">
                <p className="text-sm text-gray-400">New Stock:</p>
                <p className="text-xl font-bold text-cyber-primary">
                  {type === 'IN'
                    ? (material.currentStock || 0) + quantity
                    : (material.currentStock || 0) - quantity}{' '}
                  {material.unit}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4">
              <button type="button" onClick={onClose} className="px-4 py-2 border border-cyber-border rounded-lg text-gray-300">
                ยกเลิก
              </button>
              <button type="submit" disabled={submitting} className="cyber-btn-primary">
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
