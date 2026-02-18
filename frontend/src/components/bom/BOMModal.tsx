import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, Trash2, Loader2, Package, GitBranch, Box, CheckSquare, Square } from 'lucide-react'
import bomService, { BOM, Material, Product } from '../../services/bom'
import { MaterialCategory } from '../../services/materials'
import { SearchableDropdown } from '../common/SearchableDropdown'

interface BOMModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  editBOM?: BOM | null
  copyFrom?: BOM | null
}

interface BOMItemRow {
  id: string
  itemType: 'MATERIAL' | 'CHILD_BOM'
  materialId: string
  childBomId: string
  quantity: number
  notes: string
}

// Helper: แปลง category เป็นภาษาไทย
const getCategoryLabel = (category: string): string => {
  const labels: Record<string, string> = {
    raw: 'วัตถุดิบ',
    wip: 'ระหว่างผลิต',
    finished: 'สำเร็จรูป',
    material: 'วัตถุดิบกึ่งสำเร็จรูป',
  }
  return labels[category?.toLowerCase()] || category
}

// Helper: กรองเฉพาะสินค้าที่ใช้ทำ BOM ได้ (สำเร็จรูปและกึ่งสำเร็จรูป)
// รองรับทั้ง category ภาษาไทยและภาษาอังกฤษ
const BOM_PRODUCT_CATEGORIES = [
  '[สินค้า]', '[สินค้าสำเร็จรูป]', '[สินค้ากึ่งสำเร็จรูป]',
  'finished', 'wip', 'FINISHED', 'WIP', 'material',
]
const getValidBOMProducts = (products: Product[]): Product[] => {
  return products.filter((p) => BOM_PRODUCT_CATEGORIES.includes(p.category))
}

function BOMModal({ isOpen, onClose, onSuccess, editBOM, copyFrom }: BOMModalProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [availableChildBOMs, setAvailableChildBOMs] = useState<BOM[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  
  // Modals
  const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false)

  // Form state
  const [productId, setProductId] = useState('')
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<'DRAFT' | 'ACTIVE' | 'ARCHIVED'>('DRAFT')
  const [isSemiFinished, setIsSemiFinished] = useState(false)
  
  // Generate unique id helper
  const generateRowId = () => `row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${Math.random().toString(36).substr(2, 5)}`
  
  const [itemRows, setItemRows] = useState<BOMItemRow[]>([
    { id: generateRowId(), itemType: 'MATERIAL', materialId: '', childBomId: '', quantity: 0, notes: '' },
  ])

  const isEdit = !!editBOM
  const isCopy = !!copyFrom

  // Load products, materials, and available child BOMs
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
      setIsSemiFinished(editBOM.isSemiFinished || editBOM.is_semi_finished === 1)
      
      // Transform items to rows
      const items = editBOM.items || editBOM.materials || []
      if (items.length > 0) {
        setItemRows(
          items.map((item: any) => ({
            id: item.id && item.id.trim() !== '' ? item.id : generateRowId(),
            itemType: item.itemType || 'MATERIAL',
            materialId: item.materialId || item.material_id || '',
            childBomId: item.childBomId || item.child_bom_id || '',
            quantity: Number(item.quantity),
            notes: item.notes || '',
          }))
        )
      } else {
        setItemRows([{ id: generateRowId(), itemType: 'MATERIAL', materialId: '', childBomId: '', quantity: 0, notes: '' }])
      }
    } else if (copyFrom) {
      setProductId(copyFrom.productId)
      setVersion(`${copyFrom.version}-copy`)
      setStatus('DRAFT')
      setIsSemiFinished(false)
      
      const items = copyFrom.items || copyFrom.materials || []
      if (items.length > 0) {
        setItemRows(
          items.map((item: any) => ({
            id: generateRowId(),
            itemType: item.itemType || 'MATERIAL',
            materialId: item.materialId || item.material_id || '',
            childBomId: item.childBomId || item.child_bom_id || '',
            quantity: Number(item.quantity),
            notes: item.notes || '',
          }))
        )
      } else {
        setItemRows([{ id: generateRowId(), itemType: 'MATERIAL', materialId: '', childBomId: '', quantity: 0, notes: '' }])
      }
    } else {
      resetForm()
    }
  }, [editBOM, copyFrom])

  const loadData = async () => {
    setLoading(true)
    try {
      // Load products separately with error handling
      try {
        const productsData = await bomService.getProducts()
        setProducts(productsData || [])
      } catch (err: any) {
        console.error('Failed to load products:', err?.message || err)
        setProducts([])
      }
      
      // Load materials separately with error handling
      try {
        const materialsData = await bomService.getMaterials()
        setMaterials(materialsData || [])
      } catch (err: any) {
        console.error('Failed to load materials:', err?.message || err)
        setMaterials([])
      }
      
      // Load child BOMs separately with error handling
      try {
        const childBOMsData = await bomService.getAvailableChildren(editBOM?.id)
        setAvailableChildBOMs(childBOMsData || [])
      } catch (err: any) {
        console.error('Failed to load child BOMs:', err?.message || err)
        setAvailableChildBOMs([])
      }
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setProductId('')
    setVersion('')
    setStatus('DRAFT')
    setIsSemiFinished(false)
    setItemRows([{ id: generateRowId(), itemType: 'MATERIAL', materialId: '', childBomId: '', quantity: 0, notes: '' }])
  }

  const handleAddItem = (itemType: 'MATERIAL' | 'CHILD_BOM') => {
    setItemRows([
      ...itemRows,
      { id: generateRowId(), itemType, materialId: '', childBomId: '', quantity: 0, notes: '' },
    ])
  }

  const handleRemoveItem = (id: string) => {
    if (itemRows.length > 1) {
      setItemRows((itemRows || []).filter((row) => row.id !== id))
    }
  }

  const handleItemChange = (id: string, field: keyof BOMItemRow, value: string | number | boolean) => {
    setItemRows(
      (itemRows || []).map((row) => {
        if (row.id === id) {
          return { ...row, [field]: value }
        }
        return row
      })
    )
  }

  // ดึง unit จาก material โดยตรง
  const getMaterialUnit = (materialId: string): string => {
    const material = materials.find((m) => m.id === materialId)
    return material?.unit || '-'
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
    
    const validItems = (itemRows || []).filter((row) => {
      if (row.itemType === 'MATERIAL') {
        return row.materialId && row.quantity > 0
      } else {
        return row.childBomId && row.quantity > 0
      }
    })
    
    if (validItems.length === 0) {
      alert('กรุณาเพิ่มรายการอย่างน้อย 1 รายการ')
      return
    }

    setSubmitting(true)
    try {
      const data = {
        productId,
        version: version.trim(),
        status: status as 'DRAFT' | 'ACTIVE' | 'ARCHIVED',
        isSemiFinished,
        items: validItems.map((row) => ({
          itemType: row.itemType,
          materialId: row.itemType === 'MATERIAL' ? row.materialId : undefined,
          childBomId: row.itemType === 'CHILD_BOM' ? row.childBomId : undefined,
          quantity: row.quantity,
          notes: row.notes,
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
  const totalCost = itemRows.reduce((sum, row) => {
    if (row.itemType === 'MATERIAL') {
      const material = materials.find((m) => m.id === row.materialId)
      if (material && row.quantity > 0) {
        return sum + Number(material.unitCost) * row.quantity
      }
    } else {
      // For child BOM, we would need to fetch the cost, for now show 0
      const childBOM = availableChildBOMs.find((b) => b.id === row.childBomId)
      if (childBOM && row.quantity > 0) {
        return sum + (childBOM.totalCost || 0) * row.quantity
      }
    }
    return sum
  }, 0)

  if (!isOpen) return null

  return (
    <>
      <AnimatePresence>
        <motion.div
          key="bom-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            key="bom-modal-content"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="cyber-card w-full max-w-5xl max-h-[90vh] overflow-hidden"
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
                  {/* Product & Version & Status */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="md:col-span-1">
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        สินค้า <span className="text-red-400">*</span>
                      </label>
                      <SearchableDropdown
                        value={productId}
                        onChange={setProductId}
                        options={getValidBOMProducts(products || []).map((p) => ({
                          id: p.id,
                          label: `[${getCategoryLabel(p.category)}] ${p.code} - ${p.name}`,
                          searchText: `${p.code} ${p.name} ${p.category}`,
                        }))}
                        placeholder="เลือกสินค้าสำเร็จรูป / ระหว่างผลิต..."
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
                        onChange={(e) => setStatus(e.target.value as 'DRAFT' | 'ACTIVE' | 'ARCHIVED')}
                        className="cyber-input w-full"
                      >
                        <option value="DRAFT">Draft</option>
                        <option value="ACTIVE">Active</option>
                        <option value="ARCHIVED">Archived</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        ประเภท BOM
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsSemiFinished(!isSemiFinished)}
                        className={`flex items-center gap-2 w-full p-2.5 rounded-lg border transition-all ${
                          isSemiFinished
                            ? 'bg-cyber-purple/20 border-cyber-purple text-cyber-purple'
                            : 'bg-cyber-dark/50 border-cyber-border text-gray-400 hover:text-gray-300'
                        }`}
                      >
                        {isSemiFinished ? (
                          <CheckSquare className="w-5 h-5" />
                        ) : (
                          <Square className="w-5 h-5" />
                        )}
                        <GitBranch className="w-4 h-4" />
                        <span>Semi-finished (สำหรับเป็น Child BOM)</span>
                      </button>
                    </div>
                  </div>

                  {/* Items Section */}
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <label className="block text-sm font-medium text-gray-300">
                        รายการวัตถุดิบ / Child BOM <span className="text-red-400">*</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleAddItem('MATERIAL')}
                          className="text-sm text-cyber-primary hover:text-cyber-primary/80 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyber-primary/10 border border-cyber-primary/20"
                        >
                          <Box className="w-4 h-4" />
                          เพิ่มวัตถุดิบ
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddItem('CHILD_BOM')}
                          className="text-sm text-cyber-purple hover:text-cyber-purple/80 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyber-purple/10 border border-cyber-purple/20"
                          disabled={availableChildBOMs.length === 0}
                        >
                          <GitBranch className="w-4 h-4" />
                          เพิ่ม Child BOM
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {(itemRows || []).filter(row => row.id && row.id.trim() !== '').map((row) => {
                        const isMaterial = row.itemType === 'MATERIAL'
                        const selectedMaterial = isMaterial ? materials.find((m) => m.id === row.materialId) : null
                        const selectedChildBOM = !isMaterial ? availableChildBOMs.find((b) => b.id === row.childBomId) : null
                        const rowTotal = isMaterial
                          ? (selectedMaterial ? Number(selectedMaterial.unitCost) * row.quantity : 0)
                          : (selectedChildBOM ? (selectedChildBOM.totalCost || 0) * row.quantity : 0)

                        return (
                          <div
                            key={row.id}
                            className={`grid grid-cols-12 gap-3 items-start p-3 rounded-lg border ${
                              isMaterial
                                ? 'bg-cyber-dark/50 border-cyber-border'
                                : 'bg-cyber-purple/5 border-cyber-purple/30'
                            }`}
                          >
                            {/* Type Indicator */}
                            <div className="col-span-1">
                              <div className={`w-full h-10 rounded-lg flex items-center justify-center ${
                                isMaterial ? 'bg-cyber-primary/10' : 'bg-cyber-purple/20'
                              }`}>
                                {isMaterial ? (
                                  <Box className="w-4 h-4 text-cyber-primary" />
                                ) : (
                                  <GitBranch className="w-4 h-4 text-cyber-purple" />
                                )}
                              </div>
                            </div>

                            {/* Item Selection */}
                            <div className="col-span-4">
                              {isMaterial ? (
                                <>
                                  <SearchableDropdown
                                    value={row.materialId}
                                    onChange={(value) => handleItemChange(row.id, 'materialId', value)}
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
                                </>
                              ) : (
                                <SearchableDropdown
                                  value={row.childBomId}
                                  onChange={(value) => handleItemChange(row.id, 'childBomId', value)}
                                  options={(availableChildBOMs || []).map((b) => ({
                                    id: b.id,
                                    label: `${b.productCode || b.product?.code} - ${b.productName || b.product?.name} (฿${(b.totalCost || 0).toLocaleString()})`,
                                    searchText: `${b.productCode || b.product?.code} ${b.productName || b.product?.name}`,
                                  }))}
                                  placeholder="เลือก Semi-finished BOM..."
                                />
                              )}
                            </div>

                            {/* Quantity */}
                            <div className="col-span-2">
                              <input
                                type="number"
                                value={row.quantity || ''}
                                onChange={(e) =>
                                  handleItemChange(row.id, 'quantity', parseFloat(e.target.value) || 0)
                                }
                                placeholder="จำนวน"
                                min="0"
                                step="0.01"
                                className="cyber-input w-full text-sm"
                              />
                            </div>

                            {/* Unit Display */}
                            <div className="col-span-2">
                              <div className="cyber-input w-full text-sm bg-cyber-dark/50 text-cyber-primary font-semibold flex items-center justify-center">
                                {isMaterial
                                  ? getMaterialUnit(row.materialId)
                                  : selectedChildBOM
                                  ? 'ชุด'
                                  : '-'}
                              </div>
                            </div>

                            {/* Unit Cost */}
                            <div className="col-span-1 text-right">
                              <span className="text-sm text-gray-400">
                                {isMaterial
                                  ? selectedMaterial && `฿${Number(selectedMaterial.unitCost).toLocaleString()}`
                                  : selectedChildBOM && `฿${(selectedChildBOM.totalCost || 0).toLocaleString()}`}
                              </span>
                            </div>

                            {/* Row Total */}
                            <div className="col-span-1 text-right">
                              <span className="text-sm font-semibold text-cyber-green">
                                ฿{rowTotal.toLocaleString()}
                              </span>
                            </div>

                            {/* Remove Button */}
                            <div className="col-span-1 text-right">
                              <button
                                type="button"
                                onClick={() => handleRemoveItem(row.id)}
                                disabled={itemRows.length === 1}
                                className="p-1.5 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {availableChildBOMs.length === 0 && (
                      <p className="text-sm text-gray-500 mt-2">
                        * ไม่มี Semi-finished BOM ที่สามารถใช้เป็น Child BOM ได้ (สร้าง BOM ที่เป็น Semi-finished ก่อน)
                      </p>
                    )}
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
    </>
  )
}

// Create Material Modal Component
interface CreateMaterialModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (material: Material) => void
}

function CreateMaterialModal({ isOpen, onClose, onSuccess }: CreateMaterialModalProps) {
  const [categories, setCategories] = useState<MaterialCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState<MaterialCategory | null>(null)
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    categoryId: '',
    unitCost: 0,
    minStock: 10,
    maxStock: 100,
  })
  const [saving, setSaving] = useState(false)

  // Load categories
  useEffect(() => {
    if (isOpen) {
      loadCategories()
    }
  }, [isOpen])

  const loadCategories = async () => {
    try {
      const { default: materialsService } = await import('../../services/materials')
      const cats = await materialsService.getCategories()
      setCategories(cats)
    } catch (err) {
      console.error('Failed to load categories:', err)
    }
  }

  const handleCategoryChange = (categoryId: string) => {
    const category = categories.find(c => c.id === categoryId) || null
    setSelectedCategory(category)
    setFormData(prev => ({ ...prev, categoryId }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.code || !formData.name || !formData.categoryId) {
      alert('กรุณากรอกรหัส ชื่อ และเลือกหมวดหมู่วัตถุดิบ')
      return
    }

    setSaving(true)
    try {
      const { default: materialsService } = await import('../../services/materials')
      const newMaterial = await materialsService.create({
        code: formData.code,
        name: formData.name,
        categoryId: formData.categoryId,
        unitCost: formData.unitCost,
        minStock: formData.minStock,
        maxStock: formData.maxStock,
      })
      onSuccess(newMaterial)
      // Reset form
      setFormData({
        code: '',
        name: '',
        categoryId: '',
        unitCost: 0,
        minStock: 10,
        maxStock: 100,
      })
      setSelectedCategory(null)
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
          key="material-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
          onClick={onClose}
        >
          <motion.div
            key="material-modal-content"
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
                  <label className="block text-sm text-gray-400 mb-1">หมวดหมู่ *</label>
                  <select
                    value={formData.categoryId}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                    className="cyber-input w-full text-sm"
                    required
                  >
                    <option value="">เลือกหมวดหมู่</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Unit - แสดงเป็น read-only */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">หน่วย (Auto)</label>
                <div className="cyber-input w-full text-sm bg-cyber-dark/50 text-cyber-primary font-semibold flex items-center">
                  {selectedCategory?.defaultUnit || 'เลือกหมวดหมู่ก่อน'}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  หน่วยถูกกำหนดโดยอัตโนมัติตามหมวดหมู่วัตถุดิบ
                </p>
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
                  disabled={saving || !selectedCategory}
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
