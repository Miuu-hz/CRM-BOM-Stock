import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, Trash2, Loader2, Package } from 'lucide-react'
import bomService, { BOM, Material, Product } from '../../services/bom'
import { SearchableDropdown } from '../common/SearchableDropdown'

interface BOMModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  editBOM?: BOM | null
  copyFrom?: BOM | null
}

interface MaterialRow {
  id: string
  materialId: string
  quantity: number
  unit: string
}

function BOMModal({ isOpen, onClose, onSuccess, editBOM, copyFrom }: BOMModalProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  
  // Material creation modal
  const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false)

  // Form state
  const [productId, setProductId] = useState('')
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<'DRAFT' | 'ACTIVE'>('DRAFT')
  // Generate unique id helper
  const generateRowId = () => `row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${Math.random().toString(36).substr(2, 5)}`
  
  const [materialRows, setMaterialRows] = useState<MaterialRow[]>([
    { id: generateRowId(), materialId: '', quantity: 0, unit: '' },
  ])

  const isEdit = !!editBOM
  const isCopy = !!copyFrom

  // Load products and materials
  useEffect(() => {
    if (isOpen) {
      loadData()
    }
  }, [isOpen])

  // Populate form when editing or copying
  useEffect(() => {
    if (editBOM) {
      setProductId(editBOM.productId)
      setVersion(editBOM.version)
      setStatus(editBOM.status)
      setMaterialRows(
        (editBOM.materials || []).map((m) => ({
          id: m.id && m.id.trim() !== '' ? m.id : generateRowId(),
          materialId: m.materialId,
          quantity: Number(m.quantity),
          unit: m.unit,
        }))
      )
    } else if (copyFrom) {
      setProductId(copyFrom.productId)
      setVersion(`${copyFrom.version}-copy`)
      setStatus('DRAFT')
      setMaterialRows(
        (copyFrom.materials || []).map((m) => ({
          id: generateRowId(),
          materialId: m.materialId,
          quantity: Number(m.quantity),
          unit: m.unit,
        }))
      )
    } else {
      resetForm()
    }
  }, [editBOM, copyFrom])

  const loadData = async () => {
    setLoading(true)
    try {
      const [productsData, materialsData] = await Promise.all([
        bomService.getProducts(),
        bomService.getMaterials(),
      ])
      setProducts(productsData)
      setMaterials(materialsData)
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setProductId('')
    setVersion('')
    setStatus('DRAFT')
    setMaterialRows([{ id: generateRowId(), materialId: '', quantity: 0, unit: '' }])
  }

  const handleAddMaterial = () => {
    setMaterialRows([
      ...materialRows,
      { id: generateRowId(), materialId: '', quantity: 0, unit: '' },
    ])
  }

  const handleRemoveMaterial = (id: string) => {
    if (materialRows.length > 1) {
      setMaterialRows((materialRows || []).filter((row) => row.id !== id))
    }
  }

  const handleMaterialChange = (id: string, field: keyof MaterialRow, value: string | number) => {
    setMaterialRows(
      (materialRows || []).map((row) => {
        if (row.id === id) {
          if (field === 'materialId') {
            const selectedMaterial = materials.find((m) => m.id === value)
            return {
              ...row,
              materialId: value as string,
              unit: selectedMaterial?.unit || row.unit,
            }
          }
          return { ...row, [field]: value }
        }
        return row
      })
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validation
    if (!productId) {
      alert('กรุณาเลือกสินค้า')
      return
    }
    if (!version.trim()) {
      alert('กรุณาระบุเวอร์ชัน')
      return
    }
    const validMaterials = (materialRows || []).filter((m) => m.materialId && m.quantity > 0)
    if (validMaterials.length === 0) {
      alert('กรุณาเพิ่มวัตถุดิบอย่างน้อย 1 รายการ')
      return
    }

    setSubmitting(true)
    try {
      const data = {
        productId,
        version: version.trim(),
        status,
        materials: (validMaterials || []).map((m) => ({
          materialId: m.materialId,
          quantity: m.quantity,
          unit: m.unit,
        })),
      }

      if (isEdit && editBOM) {
        await bomService.update(editBOM.id, data)
      } else {
        await bomService.create(data)
      }

      onSuccess()
      onClose()
      resetForm()
    } catch (err: any) {
      console.error('Failed to save BOM:', err)
      alert(err.response?.data?.message || 'ไม่สามารถบันทึก BOM ได้')
    } finally {
      setSubmitting(false)
    }
  }

  // Calculate total cost
  const totalCost = materialRows.reduce((sum, row) => {
    const material = materials.find((m) => m.id === row.materialId)
    if (material && row.quantity > 0) {
      return sum + Number(material.unitCost) * row.quantity
    }
    return sum
  }, 0)

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
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="cyber-card w-full max-w-4xl max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-cyber-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyber-primary to-cyber-purple flex items-center justify-center">
                <Package className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-100">
                  {isEdit ? 'แก้ไข BOM' : isCopy ? 'คัดลอก BOM' : 'สร้าง BOM ใหม่'}
                </h2>
                <p className="text-sm text-gray-400">
                  {isEdit
                    ? 'แก้ไขสูตรการผลิต'
                    : isCopy
                    ? 'สร้างสูตรใหม่จากสูตรที่มีอยู่'
                    : 'กำหนดวัตถุดิบสำหรับสินค้า'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-cyber-card/50 transition-colors"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-cyber-primary animate-spin" />
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Product & Version */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-1">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      สินค้า <span className="text-red-400">*</span>
                    </label>
                    <SearchableDropdown
                      value={productId}
                      onChange={setProductId}
                      options={(products || []).map((p) => ({
                        id: p.id,
                        label: `${p.code} - ${p.name}`,
                        searchText: `${p.code} ${p.name}`,
                      }))}
                      placeholder="ค้นหาสินค้า..."
                      disabled={isEdit}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      เวอร์ชัน <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                      placeholder="เช่น v1.0, v2.1"
                      className="cyber-input w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      สถานะ
                    </label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as 'DRAFT' | 'ACTIVE')}
                      className="cyber-input w-full"
                    >
                      <option value="DRAFT">Draft</option>
                      <option value="ACTIVE">Active</option>
                    </select>
                  </div>
                </div>

                {/* Materials */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <label className="block text-sm font-medium text-gray-300">
                      วัตถุดิบ <span className="text-red-400">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={handleAddMaterial}
                      className="text-sm text-cyber-primary hover:text-cyber-primary/80 flex items-center gap-1"
                    >
                      <Plus className="w-4 h-4" />
                      เพิ่มวัตถุดิบ
                    </button>
                  </div>

                  <div className="space-y-3">
                    {(materialRows || []).filter(row => row.id && row.id.trim() !== '').map((row) => {
                      const selectedMaterial = materials.find((m) => m.id === row.materialId)
                      const rowTotal = selectedMaterial
                        ? Number(selectedMaterial.unitCost) * row.quantity
                        : 0

                      return (
                        <div
                          key={row.id}
                          className="grid grid-cols-12 gap-3 items-center p-3 bg-cyber-dark/50 rounded-lg border border-cyber-border"
                        >
                          <div className="col-span-4">
                            <SearchableDropdown
                              value={row.materialId}
                              onChange={(value) =>
                                handleMaterialChange(row.id, 'materialId', value)
                              }
                              options={(materials || []).map((m) => ({
                                id: m.id,
                                label: `${m.code} - ${m.name}`,
                                searchText: `${m.code} ${m.name}`,
                              }))}
                              placeholder="ค้นหาวัตถุดิบ..."
                            />
                            {!row.materialId && (
                              <div className="mt-1 flex items-center gap-2">
                                <span className="text-xs text-gray-500">ไม่พบวัตถุดิบ?</span>
                                <button
                                  type="button"
                                  onClick={() => setIsMaterialModalOpen(true)}
                                  className="text-xs text-cyber-primary hover:text-cyber-secondary flex items-center gap-1"
                                >
                                  <Plus className="w-3 h-3" />
                                  เพิ่มวัตถุดิบใหม่
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="col-span-2">
                            <input
                              type="number"
                              value={row.quantity || ''}
                              onChange={(e) =>
                                handleMaterialChange(row.id, 'quantity', parseFloat(e.target.value) || 0)
                              }
                              placeholder="จำนวน"
                              min="0"
                              step="0.01"
                              className="cyber-input w-full text-sm"
                            />
                          </div>

                          <div className="col-span-2">
                            <input
                              type="text"
                              value={row.unit}
                              onChange={(e) => handleMaterialChange(row.id, 'unit', e.target.value)}
                              placeholder="หน่วย"
                              className="cyber-input w-full text-sm"
                            />
                          </div>

                          <div className="col-span-2 text-right">
                            <span className="text-sm text-gray-400">
                              {selectedMaterial && `฿${Number(selectedMaterial.unitCost).toLocaleString()}/unit`}
                            </span>
                          </div>

                          <div className="col-span-1 text-right">
                            <span className="text-sm font-semibold text-cyber-green">
                              ฿{rowTotal.toLocaleString()}
                            </span>
                          </div>

                          <div className="col-span-1 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveMaterial(row.id)}
                              disabled={materialRows.length === 1}
                              className="p-1.5 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Total Cost */}
                <div className="flex items-center justify-end gap-4 pt-4 border-t border-cyber-border">
                  <span className="text-gray-400">ต้นทุนรวม:</span>
                  <span className="text-2xl font-bold text-cyber-primary font-['Orbitron']">
                    ฿{totalCost.toLocaleString()}
                  </span>
                </div>
              </form>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-6 border-t border-cyber-border">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 rounded-lg border border-cyber-border text-gray-300 hover:bg-cyber-card/50 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || loading}
              className="cyber-btn-primary flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEdit ? 'บันทึกการแก้ไข' : 'สร้าง BOM'}
            </button>
          </div>
        </motion.div>
      </motion.div>
      
      {/* Create Material Modal */}
      <CreateMaterialModal
        isOpen={isMaterialModalOpen}
        onClose={() => setIsMaterialModalOpen(false)}
        onSuccess={(newMaterial) => {
          setMaterials([...materials, newMaterial])
          setIsMaterialModalOpen(false)
        }}
      />
    </AnimatePresence>
  )
}

// Create Material Modal Component
interface CreateMaterialModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (material: Material) => void
}

function CreateMaterialModal({ isOpen, onClose, onSuccess }: CreateMaterialModalProps) {
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    unit: 'pcs',
    unitCost: 0,
    minStock: 10,
    maxStock: 100,
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.code || !formData.name) {
      alert('กรุณากรอกรหัสและชื่อวัตถุดิบ')
      return
    }

    setSaving(true)
    try {
      // Import materialsService dynamically to avoid circular dependency
      const { default: materialsService } = await import('../../services/materials')
      const newMaterial = await materialsService.create({
        code: formData.code,
        name: formData.name,
        unit: formData.unit,
        unitCost: formData.unitCost,
        minStock: formData.minStock,
        maxStock: formData.maxStock,
      })
      onSuccess(newMaterial)
      // Reset form
      setFormData({
        code: '',
        name: '',
        unit: 'pcs',
        unitCost: 0,
        minStock: 10,
        maxStock: 100,
      })
    } catch (err) {
      console.error('Failed to create material:', err)
      alert('ไม่สามารถสร้างวัตถุดิบได้')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="cyber-card w-full max-w-md"
          >
            <div className="p-4 border-b border-cyber-border flex items-center justify-between bg-cyber-primary/10">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-cyber-primary" />
                <h3 className="text-lg font-bold text-gray-100">เพิ่มวัตถุดิบใหม่</h3>
              </div>
              <button onClick={onClose} className="p-1 hover:bg-cyber-dark rounded">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">รหัส *</label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="cyber-input w-full text-sm"
                    placeholder="e.g., MAT-001"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">หน่วย</label>
                  <select
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    className="cyber-input w-full text-sm"
                  >
                    <option value="pcs">ชิ้น</option>
                    <option value="kg">กิโลกรัม</option>
                    <option value="m">เมตร</option>
                    <option value="yard">หลา</option>
                    <option value="roll">ม้วน</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">ชื่อวัตถุดิบ *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="cyber-input w-full text-sm"
                  placeholder="ชื่อวัตถุดิบ"
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">ต้นทุน/หน่วย</label>
                  <input
                    type="number"
                    value={formData.unitCost}
                    onChange={(e) => setFormData({ ...formData, unitCost: parseFloat(e.target.value) || 0 })}
                    className="cyber-input w-full text-sm"
                    min="0"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Min Stock</label>
                  <input
                    type="number"
                    value={formData.minStock}
                    onChange={(e) => setFormData({ ...formData, minStock: parseInt(e.target.value) || 0 })}
                    className="cyber-input w-full text-sm"
                    min="0"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Max Stock</label>
                  <input
                    type="number"
                    value={formData.maxStock}
                    onChange={(e) => setFormData({ ...formData, maxStock: parseInt(e.target.value) || 0 })}
                    className="cyber-input w-full text-sm"
                    min="0"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 text-sm border border-cyber-border rounded text-gray-400 hover:text-gray-300"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-3 py-1.5 text-sm bg-cyber-primary text-black rounded hover:shadow-neon disabled:opacity-50 flex items-center gap-1"
                >
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                  <Plus className="w-3 h-3" />
                  เพิ่มวัตถุดิบ
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default BOMModal
