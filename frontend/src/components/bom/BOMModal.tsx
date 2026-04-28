import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, Trash2, Loader2, Package, GitBranch, Box, CheckSquare, Square, AlertTriangle } from 'lucide-react'
import bomService, { BOM, Material, Product } from '../../services/bom'
import materialsService, { MaterialCategory } from '../../services/materials'
import { SearchableDropdown } from '../common/SearchableDropdown'
import api from '../../services/api'

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
  unit: string
  notes: string
}

// Helper: แปลง category เป็นป้ายสั้น (ไม่มีวงเล็บ)
const getCategoryLabel = (category: string): string => {
  const labels: Record<string, string> = {
    // English keys
    'raw': 'วัตถุดิบ',
    'wip': 'กึ่งสำเร็จรูป',
    'finished': 'สำเร็จรูป',
    'material': 'วัสดุ',
    // Thai keys (ตัดวงเล็บออกแล้วแสดงตรงๆ)
    '[สินค้า]': 'สินค้า',
    '[สินค้าสำเร็จรูป]': 'สำเร็จรูป',
    '[สินค้ากึ่งสำเร็จรูป]': 'กึ่งสำเร็จรูป',
    '[วัตถุดิบ]': 'วัตถุดิบ',
    '[วัสดุย่อย]': 'วัสดุย่อย',
    '[สินค้าไม่มีตัวตน]': 'ไม่มีตัวตน',
  }
  return labels[category] || labels[category?.toLowerCase()] || category.replace(/^\[|\]$/g, '')
}

// Helper: ตรวจสอบว่า category ต้องเปลี่ยนก่อนใช้เป็น BOM product หรือไม่
const SAFE_BOM_CATEGORIES = ['[สินค้า]', '[สินค้าสำเร็จรูป]', '[สินค้ากึ่งสำเร็จรูป]', 'finished', 'wip', 'FINISHED', 'WIP']
const needsCategoryChange = (category: string): boolean => !SAFE_BOM_CATEGORIES.includes(category)

const BOM_PRODUCT_CATEGORIES = [...SAFE_BOM_CATEGORIES, 'material', 'Material', 'Raw Material', 'raw']
const getValidBOMProducts = (products: Product[]): Product[] => {
  return products.filter((p) => BOM_PRODUCT_CATEGORIES.includes(p.category) || !SAFE_BOM_CATEGORIES.includes(p.category))
}

function BOMModal({ isOpen, onClose, onSuccess, editBOM, copyFrom }: BOMModalProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [availableChildBOMs, setAvailableChildBOMs] = useState<BOM[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Modals
  const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false)
  const [categoryChangeModal, setCategoryChangeModal] = useState<{ productId: string; productName: string } | null>(null)
  const [changingCategory, setChangingCategory] = useState(false)

  // Form state
  const [productId, setProductId] = useState('')
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<'DRAFT' | 'ACTIVE' | 'ARCHIVED'>('DRAFT')
  const [isSemiFinished, setIsSemiFinished] = useState(false)

  const handleProductSelect = (id: string) => {
    const product = products.find(p => p.id === id)
    if (product && needsCategoryChange(product.category)) {
      setCategoryChangeModal({ productId: id, productName: product.name })
    } else {
      setProductId(id)
    }
  }

  const handleConfirmCategoryChange = async (newCategory: 'finished' | 'wip') => {
    if (!categoryChangeModal) return
    setChangingCategory(true)
    try {
      await api.patch(`/data/products/${categoryChangeModal.productId}/category`, { category: newCategory })
      // Update local products list
      setProducts(prev => prev.map(p =>
        p.id === categoryChangeModal.productId ? { ...p, category: newCategory } : p
      ))
      setProductId(categoryChangeModal.productId)
      setCategoryChangeModal(null)
    } catch (err: any) {
      alert(err.response?.data?.message || 'ไม่สามารถเปลี่ยนประเภทสินค้าได้')
    } finally {
      setChangingCategory(false)
    }
  }

  // Generate unique id helper
  const generateRowId = () => `row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${Math.random().toString(36).substr(2, 5)}`

  const [itemRows, setItemRows] = useState<BOMItemRow[]>([
    { id: generateRowId(), itemType: 'MATERIAL', materialId: '', childBomId: '', quantity: 0, unit: '', notes: '' },
  ])
  const [compatibleUnits, setCompatibleUnits] = useState<Record<string, { code: string; label: string }[]>>({})
  const [rowCosts, setRowCosts] = useState<Record<string, number>>({})

  const isEdit = !!editBOM
  const isCopy = !!copyFrom

  // Load products, materials, and available child BOMs
  useEffect(() => {
    if (isOpen) {
      loadData()
    }
  }, [isOpen])

  // Helper to transform API items to form rows
  const transformItemsToRows = (items: any[], preserveIds: boolean = true) => {
    if (items.length === 0) {
      return [{ id: generateRowId(), itemType: 'MATERIAL' as const, materialId: '', childBomId: '', quantity: 0, unit: '', notes: '' }]
    }
    return items.map((item: any) => ({
      id: preserveIds && item.id && item.id.trim() !== '' ? item.id : generateRowId(),
      itemType: (item.itemType || item.item_type || 'MATERIAL') as 'MATERIAL' | 'CHILD_BOM',
      materialId: item.materialId || item.material_id || '',
      childBomId: item.childBomId || item.child_bom_id || '',
      quantity: Number(item.quantity),
      unit: item.unit || item.material_unit || '',
      notes: item.notes || '',
    }))
  }

  // Load compatible units for rows that have materialId but no units loaded yet
  useEffect(() => {
    if (materials.length === 0) return
    itemRows.forEach((row) => {
      if (row.itemType === 'MATERIAL' && row.materialId && !compatibleUnits[row.id]) {
        const material = materials.find((m) => m.id === row.materialId)
        if (material?.unit) {
          materialsService.getCompatibleUnits(material.unit, row.materialId)
            .then((units) => {
              setCompatibleUnits(prev => ({ ...prev, [row.id]: units }))
            })
            .catch(() => {})
        }
      }
    })
  }, [itemRows, materials])

  // Populate form when editing or copying
  useEffect(() => {
    if (editBOM) {
      // Fetch full BOM data (with items) from API since list endpoint doesn't include items
      const fetchFullBOM = async () => {
        try {
          const fullBOM = await bomService.getById(editBOM.id)
          setProductId(fullBOM.productId || (fullBOM as any).product_id || editBOM.productId)
          setVersion(fullBOM.version || editBOM.version)
          setStatus(fullBOM.status || editBOM.status)
          setIsSemiFinished(
            fullBOM.isSemiFinished || (fullBOM as any).is_semi_finished === 1 ||
            editBOM.isSemiFinished || editBOM.is_semi_finished === 1
          )

          const items = fullBOM.items || fullBOM.materials || []
          setItemRows(transformItemsToRows(items, true))
        } catch (err) {
          console.error('Failed to fetch full BOM data, using list data:', err)
          // Fallback to editBOM data from list
          setProductId(editBOM.productId)
          setVersion(editBOM.version)
          setStatus(editBOM.status)
          setIsSemiFinished(editBOM.isSemiFinished || editBOM.is_semi_finished === 1)
          const items = editBOM.items || editBOM.materials || []
          setItemRows(transformItemsToRows(items, true))
        }
      }
      fetchFullBOM()
    } else if (copyFrom) {
      // For copy, also fetch full BOM data to get items
      const fetchFullBOMForCopy = async () => {
        try {
          const fullBOM = await bomService.getById(copyFrom.id)
          setProductId(fullBOM.productId || (fullBOM as any).product_id || copyFrom.productId)
          setVersion(`${fullBOM.version || copyFrom.version}-copy`)
          setStatus('DRAFT')
          setIsSemiFinished(false)

          const items = fullBOM.items || fullBOM.materials || []
          setItemRows(transformItemsToRows(items, false))
        } catch (err) {
          console.error('Failed to fetch full BOM data for copy, using list data:', err)
          setProductId(copyFrom.productId)
          setVersion(`${copyFrom.version}-copy`)
          setStatus('DRAFT')
          setIsSemiFinished(false)
          const items = copyFrom.items || copyFrom.materials || []
          setItemRows(transformItemsToRows(items, false))
        }
      }
      fetchFullBOMForCopy()
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
    setItemRows([{ id: generateRowId(), itemType: 'MATERIAL', materialId: '', childBomId: '', quantity: 0, unit: '', notes: '' }])
    setCompatibleUnits({})
  }

  const handleAddItem = (itemType: 'MATERIAL' | 'CHILD_BOM') => {
    setItemRows([
      ...itemRows,
      { id: generateRowId(), itemType, materialId: '', childBomId: '', quantity: 0, unit: '', notes: '' },
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

  // โหลด compatible units เมื่อเลือก material
  const loadCompatibleUnits = async (materialId: string, rowId: string) => {
    const material = materials.find((m) => m.id === materialId)
    if (!material?.unit) return
    try {
      const units = await materialsService.getCompatibleUnits(material.unit, materialId)
      setCompatibleUnits(prev => ({ ...prev, [rowId]: units }))
    } catch (err) {
      console.error('Failed to load compatible units:', err)
    }
  }

  // Get display label for a unit code
  const getUnitLabel = (code: string): string => {
    const found = Object.values(compatibleUnits)
      .flat()
      .find((u) => u.code === code)
    return found?.label || code
  }

  // Handle material selection with unit loading
  const handleMaterialSelect = (rowId: string, materialId: string) => {
    const material = materials.find((m) => m.id === materialId)
    handleItemChange(rowId, 'materialId', materialId)
    handleItemChange(rowId, 'unit', material?.unit || '')
    if (material?.unit) {
      loadCompatibleUnits(materialId, rowId)
    }
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
          unit: row.unit,
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

  // Calculate row costs with unit conversion via backend API
  useEffect(() => {
    const calculateCosts = async () => {
      const costs: Record<string, number> = {}
      for (const row of itemRows) {
        if (row.itemType === 'MATERIAL' && row.materialId && row.quantity > 0) {
          const material = materials.find((m) => m.id === row.materialId)
          if (!material) continue
          const stockUnit = material.unit
          const bomUnit = row.unit || stockUnit
          let convertedQty = row.quantity
          if (bomUnit !== stockUnit) {
            try {
              const res = await api.post('/materials/unit-conversions/convert', {
                quantity: row.quantity,
                from_unit: bomUnit,
                to_unit: stockUnit,
                material_id: row.materialId,
              })
              if (res.data?.success) {
                convertedQty = res.data.data.converted
              }
            } catch {
              // fallback: use raw quantity if conversion fails
            }
          }
          costs[row.id] = convertedQty * Number(material.unitCost)
        } else if (row.itemType === 'CHILD_BOM' && row.childBomId && row.quantity > 0) {
          const childBOM = availableChildBOMs.find((b) => b.id === row.childBomId)
          costs[row.id] = (childBOM?.totalCost || 0) * row.quantity
        }
      }
      setRowCosts(costs)
    }
    calculateCosts()
  }, [itemRows, materials, availableChildBOMs])

  const totalCost = itemRows.reduce((sum, row) => sum + (rowCosts[row.id] || 0), 0)

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
                        onChange={handleProductSelect}
                        options={(products || []).map((p) => ({
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
                        className={`flex items-center gap-2 w-full p-2.5 rounded-lg border transition-all ${isSemiFinished
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
                        const rowTotal = rowCosts[row.id] || 0

                        return (
                          <div
                            key={row.id}
                            className={`grid grid-cols-12 gap-3 items-start p-3 rounded-lg border ${isMaterial
                                ? 'bg-cyber-dark/50 border-cyber-border'
                                : 'bg-cyber-purple/5 border-cyber-purple/30'
                              }`}
                          >
                            {/* Type Indicator */}
                            <div className="col-span-1">
                              <div className={`w-full h-10 rounded-lg flex items-center justify-center ${isMaterial ? 'bg-cyber-primary/10' : 'bg-cyber-purple/20'
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
                                    onChange={(value) => handleMaterialSelect(row.id, value)}
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

                            {/* Unit Dropdown */}
                            <div className="col-span-2">
                              {isMaterial && row.materialId ? (
                                <select
                                  value={row.unit || getMaterialUnit(row.materialId)}
                                  onChange={(e) => handleItemChange(row.id, 'unit', e.target.value)}
                                  className="cyber-input w-full text-sm"
                                >
                                  {(compatibleUnits[row.id] || [{ code: getMaterialUnit(row.materialId), label: getMaterialUnit(row.materialId) }]).map((u) => (
                                    <option key={u.code} value={u.code}>{u.label}</option>
                                  ))}
                                </select>
                              ) : (
                                <div className="cyber-input w-full text-sm bg-cyber-dark/50 text-cyber-primary font-semibold flex items-center justify-center">
                                  {selectedChildBOM ? 'ชุด' : '-'}
                                </div>
                              )}
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
                    <span className="text-2xl font-bold text-cyber-primary">
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

        {/* Category Change Required Modal */}
        <AnimatePresence>
          {categoryChangeModal && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4"
              onClick={() => setCategoryChangeModal(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="cyber-card w-full max-w-md"
              >
                <div className="p-5 border-b border-cyber-border flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-yellow-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-100">ต้องเปลี่ยนประเภทสินค้าก่อน</h3>
                    <p className="text-sm text-gray-400">สินค้านี้ถูกตั้งเป็น "วัตถุดิบ"</p>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  <p className="text-sm text-gray-300">
                    <span className="text-cyber-primary font-semibold">{categoryChangeModal.productName}</span>{' '}
                    ถูกตั้งค่าเป็น วัตถุดิบ (Material) ซึ่งไม่สามารถใช้เป็น output ของ BOM ได้
                  </p>
                  <p className="text-sm text-gray-400">กรุณาเลือกประเภทที่ถูกต้องสำหรับสินค้าที่จะผลิต:</p>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleConfirmCategoryChange('finished')}
                      disabled={changingCategory}
                      className="p-4 rounded-lg border border-cyber-primary/30 bg-cyber-primary/10 hover:bg-cyber-primary/20 text-left transition-all group"
                    >
                      <div className="text-cyber-primary font-semibold text-sm mb-1">✅ สินค้าสำเร็จรูป</div>
                      <div className="text-xs text-gray-400">Finished Good</div>
                      <div className="text-xs text-gray-500 mt-2">สินค้าพร้อมขาย ผลิตแล้วเข้า stock โดยตรง</div>
                    </button>
                    <button
                      onClick={() => handleConfirmCategoryChange('wip')}
                      disabled={changingCategory}
                      className="p-4 rounded-lg border border-cyber-purple/30 bg-cyber-purple/10 hover:bg-cyber-purple/20 text-left transition-all"
                    >
                      <div className="text-cyber-purple font-semibold text-sm mb-1">🔧 กึ่งสำเร็จรูป</div>
                      <div className="text-xs text-gray-400">Semi-Finished Good</div>
                      <div className="text-xs text-gray-500 mt-2">ผ่านการผลิตขั้นต้น ใช้เป็น Child BOM ต่อได้</div>
                    </button>
                  </div>
                </div>

                <div className="p-4 border-t border-cyber-border flex justify-end">
                  <button
                    onClick={() => setCategoryChangeModal(null)}
                    className="px-4 py-2 text-sm border border-cyber-border rounded text-gray-400 hover:text-gray-300"
                  >
                    ยกเลิก
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

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
