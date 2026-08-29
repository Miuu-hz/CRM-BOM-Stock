import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import {X, Plus, Trash2, Loader2, Package, GitBranch, Box, CheckSquare, Square, AlertTriangle, Check, Wrench} from 'lucide-react'
import bomService, { BOM, Material, Product } from '../../services/bom'
import materialsService, { MaterialCategory } from '../../services/materials'
import { SearchableDropdown } from '../common/SearchableDropdown'
import { UnitPicker } from '../common/UnitPicker'
import api from '../../services/api'
import { useUnits, unitLabel } from '../../hooks/useUnits'
import { normalizeUnit } from '../../utils/unitNormalize'
import { EditModal } from '../../pages/Stock'
import { StockItem } from '../../services/stock'

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

// Helper: ตรวจสอบว่า category ต้องเปลี่ยนก่อนใช้เป็น BOM product หรือไม่
const SAFE_BOM_CATEGORIES = ['[สินค้า]', '[สินค้าสำเร็จรูป]', '[สินค้ากึ่งสำเร็จรูป]', 'finished', 'wip', 'FINISHED', 'WIP']
const needsCategoryChange = (category: string): boolean => !SAFE_BOM_CATEGORIES.includes(category)

const BOM_PRODUCT_CATEGORIES = [...SAFE_BOM_CATEGORIES, 'material', 'Material', 'Raw Material', 'raw']
const getValidBOMProducts = (products: Product[]): Product[] => {
  return products.filter((p) => BOM_PRODUCT_CATEGORIES.includes(p.category) || !SAFE_BOM_CATEGORIES.includes(p.category))
}

function BOMModal({ isOpen, onClose, onSuccess, editBOM, copyFrom }: BOMModalProps) {
  const { t } = useTranslation()

  // Helper: แปลง category เป็นป้ายสั้น (ไม่มีวงเล็บ)
  const getCategoryLabel = (category: string): string => {
    const labels: Record<string, string> = {
      'raw': t('bomModal.category.raw'),
      'wip': t('bomModal.category.wip'),
      'finished': t('bomModal.category.finished'),
      'material': t('bomModal.category.material'),
      '[สินค้า]': t('bomModal.category.product'),
      '[สินค้าสำเร็จรูป]': t('bomModal.category.finishedGoods'),
      '[สินค้ากึ่งสำเร็จรูป]': t('bomModal.category.semiFinishedGoods'),
      '[วัตถุดิบ]': t('bomModal.category.raw'),
      '[วัสดุย่อย]': t('bomModal.category.subMaterial'),
      '[สินค้าไม่มีตัวตน]': t('bomModal.category.intangible'),
    }
    return labels[category] || labels[category?.toLowerCase()] || category.replace(/^\[|\]$/g, '')
  }

  const [products, setProducts] = useState<Product[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [availableChildBOMs, setAvailableChildBOMs] = useState<BOM[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Modals
  const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false)
  const [categoryChangeModal, setCategoryChangeModal] = useState<{ productId: string; productName: string } | null>(null)
  const [changingCategory, setChangingCategory] = useState(false)
  const [editStockItem, setEditStockItem] = useState<{ item: StockItem; convForm?: { from_unit: string; to_unit: string } } | null>(null)

  // Form state
  const [productId, setProductId] = useState('')
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<'DRAFT' | 'ACTIVE' | 'ARCHIVED'>('DRAFT')
  const [isSemiFinished, setIsSemiFinished] = useState(false)
  // ผลผลิตต่อ 1 ชุด (R2-UI) — default 1 หน่วย, หน่วย default = หน่วยของสินค้าที่เลือก
  const [outputQty, setOutputQty] = useState(1)
  const [outputUnit, setOutputUnit] = useState('')
  const [outputUnitTouched, setOutputUnitTouched] = useState(false)

  const handleProductSelect = (id: string) => {
    const product = products.find(p => p.id === id)
    if (product && needsCategoryChange(product.category)) {
      setCategoryChangeModal({ productId: id, productName: product.name })
    } else {
      setProductId(id)
    }
  }

  // Default หน่วยผลผลิตตามหน่วยของสินค้าที่เลือก — ทำงานทั้งตอนสร้างใหม่และตอน edit ที่โหลด
  // BOM เก่าซึ่งยังไม่มี output_unit (COALESCE ฝั่ง backend แปลว่าส่ง null ตอน PUT = "ไม่เปลี่ยน"
  // ไม่ใช่ "ล้างค่า" ดังนั้น UI ต้องบังคับให้มีหน่วยเสมอ ไม่ปล่อยว่าง)
  // จะไม่ทับค่าที่ผู้ใช้เลือกเอง (outputUnitTouched) หรือค่าที่โหลดมาจาก BOM เดิม
  useEffect(() => {
    if (outputUnitTouched) return
    const product = products.find(p => p.id === productId)
    if (product?.unit) setOutputUnit(normalizeUnit(product.unit))
  }, [productId, products, outputUnitTouched])

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
      alert(err.response?.data?.message || t('bomModal.errors.changeCategoryFailed'))
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
  const [conversionIssues, setConversionIssues] = useState<Array<{
    rowId: string
    materialName: string
    from: string
    to: string
    materialId: string
  }>>([])

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
      unit: item.unit || item.material_unit || item.material?.unit || '',
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
          const oQty = fullBOM.outputQty ?? fullBOM.output_qty ?? editBOM.outputQty ?? editBOM.output_qty
          const oUnit = fullBOM.outputUnit ?? fullBOM.output_unit ?? editBOM.outputUnit ?? editBOM.output_unit
          setOutputQty(oQty && oQty > 0 ? Number(oQty) : 1)
          if (oUnit) { setOutputUnit(normalizeUnit(oUnit)); setOutputUnitTouched(true) }

          const items = fullBOM.items || fullBOM.materials || []
          setItemRows(transformItemsToRows(items, true))
        } catch (err) {
          console.error('Failed to fetch full BOM data, using list data:', err)
          // Fallback to editBOM data from list
          setProductId(editBOM.productId)
          setVersion(editBOM.version)
          setStatus(editBOM.status)
          setIsSemiFinished(editBOM.isSemiFinished || editBOM.is_semi_finished === 1)
          const oQty = editBOM.outputQty ?? editBOM.output_qty
          const oUnit = editBOM.outputUnit ?? editBOM.output_unit
          setOutputQty(oQty && oQty > 0 ? Number(oQty) : 1)
          if (oUnit) { setOutputUnit(normalizeUnit(oUnit)); setOutputUnitTouched(true) }
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
          const oQty = fullBOM.outputQty ?? fullBOM.output_qty ?? copyFrom.outputQty ?? copyFrom.output_qty
          const oUnit = fullBOM.outputUnit ?? fullBOM.output_unit ?? copyFrom.outputUnit ?? copyFrom.output_unit
          setOutputQty(oQty && oQty > 0 ? Number(oQty) : 1)
          if (oUnit) { setOutputUnit(normalizeUnit(oUnit)); setOutputUnitTouched(true) }

          const items = fullBOM.items || fullBOM.materials || []
          setItemRows(transformItemsToRows(items, false))
        } catch (err) {
          console.error('Failed to fetch full BOM data for copy, using list data:', err)
          setProductId(copyFrom.productId)
          setVersion(`${copyFrom.version}-copy`)
          setStatus('DRAFT')
          setIsSemiFinished(false)
          const oQty = copyFrom.outputQty ?? copyFrom.output_qty
          const oUnit = copyFrom.outputUnit ?? copyFrom.output_unit
          setOutputQty(oQty && oQty > 0 ? Number(oQty) : 1)
          if (oUnit) { setOutputUnit(normalizeUnit(oUnit)); setOutputUnitTouched(true) }
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
    setOutputQty(1)
    setOutputUnit('')
    setOutputUnitTouched(false)
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
    setItemRows(prev =>
      prev.map((row) => {
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
    return material?.unit || ''
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
    setCompatibleUnits(prev => {
      const next = { ...prev }
      delete next[rowId]
      return next
    })
    // Atomic update: set both materialId and unit in one setState call
    setItemRows(prev => prev.map(row =>
      row.id === rowId ? { ...row, materialId, unit: material?.unit || '' } : row
    ))
    if (material?.unit) {
      loadCompatibleUnits(materialId, rowId)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validation
    if (!productId) {
      alert(t('bomModal.errors.selectProduct'))
      return
    }
    if (!version.trim()) {
      alert(t('bomModal.errors.enterVersion'))
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
      alert(t('bomModal.errors.addAtLeastOneItem'))
      return
    }

    setSubmitting(true)
    try {
      const data = {
        productId,
        version: version.trim(),
        status: status as 'DRAFT' | 'ACTIVE' | 'ARCHIVED',
        isSemiFinished,
        outputQty: outputQty > 0 ? outputQty : 1,
        outputUnit: outputUnit || null,
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
      alert(err.response?.data?.message || t('bomModal.errors.saveFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  // Calculate row costs with unit conversion via backend API
  useEffect(() => {
    const calculateCosts = async () => {
      const costs: Record<string, number> = {}
      const issues: typeof conversionIssues = []
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
              const data = res.data?.data
              if (data?.canConvert === false && data?.needsAction) {
                issues.push({
                  rowId: row.id,
                  materialName: material.name,
                  from: bomUnit,
                  to: stockUnit,
                  materialId: row.materialId,
                })
              } else if (data?.converted != null) {
                convertedQty = data.converted
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
      setConversionIssues(issues)
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
          className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            key="bom-modal-content"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="phopy-card w-full max-w-5xl max-h-[90vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-[var(--border)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-phopy-indigo to-purple-500 flex items-center justify-center">
                  <Package className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-[var(--fg-1)]">
                    {isEdit ? t('bomModal.title.edit') : isCopy ? t('bomModal.title.copy') : t('bomModal.title.create')}
                  </h2>
                  <p className="text-sm text-[var(--fg-3)]">
                    {isEdit
                      ? t('bomModal.subtitle.edit')
                      : isCopy
                        ? t('bomModal.subtitle.copy')
                        : t('bomModal.subtitle.create')}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors"
              >
                <X className="w-5 h-5 text-[var(--fg-3)]" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-[var(--primary)] animate-spin" />
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Product & Version & Status */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="md:col-span-1">
                      <label className="block text-sm font-medium text-[var(--fg-2)] mb-2">
                        {t('bomModal.labels.product')} <span className="text-danger">*</span>
                      </label>
                      <SearchableDropdown
                        value={productId}
                        onChange={handleProductSelect}
                        options={(products || []).map((p) => ({
                          id: p.id,
                          label: `[${getCategoryLabel(p.category)}] ${p.code} - ${p.name}`,
                          searchText: `${p.code} ${p.name} ${p.category}`,
                        }))}
                        placeholder={t('bomModal.placeholders.product')}
                        disabled={isEdit}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--fg-2)] mb-2">
                        {t('bomModal.labels.version')} <span className="text-danger">*</span>
                      </label>
                      <input
                        type="text"
                        value={version}
                        onChange={(e) => setVersion(e.target.value)}
                        placeholder={t('bomModal.placeholders.version')}
                        className="phopy-input w-full"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--fg-2)] mb-2">
                        {t('bomModal.labels.status')}
                      </label>
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as 'DRAFT' | 'ACTIVE' | 'ARCHIVED')}
                        className="phopy-input w-full"
                      >
                        <option value="DRAFT">{t('bomModal.status.draft')}</option>
                        <option value="ACTIVE">{t('bomModal.status.active')}</option>
                        <option value="ARCHIVED">{t('bomModal.status.archived')}</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--fg-2)] mb-2">
                        {t('bomModal.labels.bomType')}
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsSemiFinished(!isSemiFinished)}
                        className={`flex items-center gap-2 w-full p-2.5 rounded-lg border transition-all ${isSemiFinished
                            ? 'bg-[var(--primary)]/20 border-[var(--primary)] text-[var(--primary)]'
                            : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--fg-2)]'
                          }`}
                      >
                        {isSemiFinished ? (
                          <CheckSquare className="w-5 h-5" />
                        ) : (
                          <Square className="w-5 h-5" />
                        )}
                        <GitBranch className="w-4 h-4" />
                        <span>{t('bomModal.semiFinishedLabel')}</span>
                      </button>
                    </div>
                  </div>

                  {/* Output Qty & Unit (R2-UI) — BOM 1 ชุด ผลิตได้กี่หน่วย */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[var(--fg-2)] mb-2">
                        {t('bomModal.labels.outputQty')}
                      </label>
                      <input
                        type="number"
                        min={0.0001}
                        step="any"
                        value={outputQty}
                        onChange={(e) => setOutputQty(parseFloat(e.target.value) || 0)}
                        className="phopy-input w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--fg-2)] mb-2">
                        {t('bomModal.labels.outputUnit')}
                      </label>
                      <UnitPicker
                        value={outputUnit}
                        onChange={(u) => { setOutputUnit(u); setOutputUnitTouched(true) }}
                        materialId={productId || null}
                        placeholder={t('bomModal.placeholders.outputUnit')}
                      />
                    </div>
                    <div className="md:col-span-2 flex items-end">
                      {outputQty > 0 && (outputUnit || products.find(p => p.id === productId)?.unit) && (
                        <p className="text-xs text-[var(--fg-4)] pb-2.5">
                          {t('bomModal.hints.outputSummary', {
                            qty: outputQty.toLocaleString('th-TH'),
                            unit: unitLabel(outputUnit || products.find(p => p.id === productId)?.unit),
                          })}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Items Section */}
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <label className="block text-sm font-medium text-[var(--fg-2)]">
                        {t('bomModal.labels.items')} <span className="text-danger">*</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleAddItem('MATERIAL')}
                          className="text-sm text-[var(--primary)] hover:text-[var(--primary)]/80 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-phopy-indigo/10 border border-phopy-indigo-50"
                        >
                          <Box className="w-4 h-4" />
                          {t('bomModal.addMaterial')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddItem('CHILD_BOM')}
                          className="text-sm text-[var(--primary)] hover:text-[var(--primary)]/80 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--primary)]/10 border border-[var(--primary)]/20"
                          disabled={availableChildBOMs.length === 0}
                        >
                          <GitBranch className="w-4 h-4" />
                          {t('bomModal.addChildBOM')}
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
                                ? 'bg-[var(--surface-2)] border-[var(--border)]'
                                : 'bg-[var(--primary)]/5 border-[var(--primary)]/30'
                              }`}
                          >
                            {/* Type Indicator */}
                            <div className="col-span-1">
                              <div className={`w-full h-10 rounded-lg flex items-center justify-center ${isMaterial ? 'bg-phopy-indigo/10' : 'bg-[var(--primary)]/20'
                                }`}>
                                {isMaterial ? (
                                  <Box className="w-4 h-4 text-[var(--primary)]" />
                                ) : (
                                  <GitBranch className="w-4 h-4 text-[var(--primary)]" />
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
                                    placeholder={t('bomModal.placeholders.searchMaterial')}
                                  />
                                  {!row.materialId && (
                                    <div className="mt-1 flex items-center gap-2">
                                      <span className="text-xs text-[var(--fg-4)]">{t('bomModal.noMaterialFound')}</span>
                                      <button
                                        type="button"
                                        onClick={() => setIsMaterialModalOpen(true)}
                                        className="text-xs text-[var(--primary)] hover:text-phopy-indigo-600 flex items-center gap-1"
                                      >
                                        <Plus className="w-3 h-3" />
                                        {t('bomModal.addNewMaterial')}
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
                                  placeholder={t('bomModal.placeholders.selectChildBOM')}
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
                                placeholder={t('bomModal.placeholders.quantity')}
                                min="0"
                                step="0.01"
                                className="phopy-input w-full text-sm"
                              />
                            </div>

                            {/* Unit Dropdown */}
                            <div className="col-span-2">
                              {isMaterial && row.materialId ? (
                                <select
                                  value={row.unit || getMaterialUnit(row.materialId) || ''}
                                  onChange={(e) => handleItemChange(row.id, 'unit', e.target.value)}
                                  className="phopy-input w-full text-sm"
                                >
                                  {(() => {
                                    const unitCode = row.unit || getMaterialUnit(row.materialId) || ''
                                    const opts = compatibleUnits[row.id] || []
                                    const hasCurrent = opts.some(u => u.code === unitCode)
                                    const allOpts = hasCurrent || !unitCode ? opts : [{ code: unitCode, label: unitCode }, ...opts]
                                    if (allOpts.length === 0) {
                                      return <option value="">{t('bomModal.unitOptions.selectUnit')}</option>
                                    }
                                    return allOpts.map((u) => (
                                      <option key={u.code} value={u.code}>{u.label}</option>
                                    ))
                                  })()}
                                </select>
                              ) : (
                                <div className="phopy-input w-full text-sm bg-[var(--surface-2)] text-[var(--primary)] font-semibold flex items-center justify-center">
                                  {selectedChildBOM ? t('bomModal.unitOptions.set') : '-'}
                                </div>
                              )}
                            </div>

                            {/* Unit Cost */}
                            <div className="col-span-1 text-right">
                              <span className="text-sm text-[var(--fg-3)]">
                                {isMaterial
                                  ? selectedMaterial && `฿${Number(selectedMaterial.unitCost).toLocaleString()}`
                                  : selectedChildBOM && `฿${(selectedChildBOM.totalCost || 0).toLocaleString()}`}
                              </span>
                            </div>

                            {/* Row Total */}
                            <div className="col-span-1 text-right">
                              <span className="text-sm font-semibold text-success">
                                ฿{rowTotal.toLocaleString()}
                              </span>
                            </div>

                            {/* Remove Button */}
                            <div className="col-span-1 text-right">
                              <button
                                type="button"
                                onClick={() => handleRemoveItem(row.id)}
                                disabled={itemRows.length === 1}
                                className="p-1.5 rounded hover:bg-[var(--danger-soft)] text-[var(--fg-3)] hover:text-danger disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {availableChildBOMs.length === 0 && (
                      <p className="text-sm text-[var(--fg-4)] mt-2">
                        * {t('bomModal.noChildBOMs')}
                      </p>
                    )}
                  </div>

                  {/* Conversion Issues */}
                  {conversionIssues.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {conversionIssues.map((issue) => (
                        <div key={issue.rowId} className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-amber-300">
                              <span className="font-medium">{issue.materialName}</span>
                              {t('bomModal.conversionIssue', { from: issue.from, to: issue.to })}
                            </p>
                            <div className="flex gap-2 mt-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  const mat = materials.find(m => m.id === issue.materialId)
                                  if (mat) {
                                    setEditStockItem({
                                      item: {
                                        id: mat.id,
                                        sku: mat.code || mat.id,
                                        name: mat.name,
                                        quantity: (mat as any).currentStock ?? 0,
                                        unit: mat.unit,
                                        minStock: (mat as any).minStock ?? 0,
                                        maxStock: (mat as any).maxStock ?? 0,
                                        location: '',
                                        status: (mat as any).stockStatus ?? 'NO_STOCK',
                                        createdAt: new Date().toISOString(),
                                        updatedAt: new Date().toISOString(),
                                        unitCost: mat.unitCost,
                                        category: (mat as any).categoryName ?? '',
                                        materialId: mat.id,
                                      },
                                      convForm: { from_unit: issue.from, to_unit: issue.to },
                                    })
                                  }
                                }}
                                className="text-xs px-2 py-1 bg-amber-500/20 text-amber-300 rounded hover:bg-amber-500/30 transition-colors"
                              >
                                {t('bomModal.editUnitInStock')}
                              </button>
                              <button
                                type="button"
                                onClick={() => window.open('/settings/unit-conversions', '_blank')}
                                className="text-xs px-2 py-1 bg-amber-500/20 text-amber-300 rounded hover:bg-amber-500/30 transition-colors"
                              >
                                {t('bomModal.globalUnitSettings')}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Total Cost */}
                  <div className="flex items-center justify-end gap-4 pt-4 border-t border-[var(--border)]">
                    <span className="text-[var(--fg-3)]">{t('bomModal.totalCost')}</span>
                    <span className="text-2xl font-bold text-[var(--primary)]">
                      ฿{totalCost.toLocaleString()}
                    </span>
                  </div>
                </form>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 rounded-lg border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || loading}
                className="phopy-btn-primary flex items-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {isEdit ? t('bomModal.saveButton') : t('bomModal.createButton')}
              </button>
            </div>
          </motion.div>
        </motion.div>

        {/* Category Change Required Modal */}
        <AnimatePresence>
          {categoryChangeModal && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-[var(--fg-1)]/70 flex items-center justify-center z-50 p-4"
              onClick={() => setCategoryChangeModal(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="phopy-card w-full max-w-md"
              >
                <div className="p-5 border-b border-[var(--border)] flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[var(--warning-soft)] flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-warning" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-[var(--fg-1)]">{t('bomModal.categoryChange.title')}</h3>
                    <p className="text-sm text-[var(--fg-3)]">{t('bomModal.categoryChange.subtitle')}</p>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  <p className="text-sm text-[var(--fg-2)]">
                    <span className="text-[var(--primary)] font-semibold">{categoryChangeModal.productName}</span>{' '}
                    {t('bomModal.categoryChange.description')}
                  </p>
                  <p className="text-sm text-[var(--fg-3)]">{t('bomModal.categoryChange.instruction')}</p>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleConfirmCategoryChange('finished')}
                      disabled={changingCategory}
                      className="p-4 rounded-lg border border-phopy-indigo/30 bg-phopy-indigo/10 hover:bg-[var(--primary-soft)] text-left transition-all group"
                    >
                      <div className="text-[var(--primary)] font-semibold text-sm mb-1"><Check className="w-4 h-4" /> {t('bomModal.categoryChange.finished.title')}</div>
                      <div className="text-xs text-[var(--fg-3)]">{t('bomModal.categoryChange.finished.subtitle')}</div>
                      <div className="text-xs text-[var(--fg-4)] mt-2">{t('bomModal.categoryChange.finished.description')}</div>
                    </button>
                    <button
                      onClick={() => handleConfirmCategoryChange('wip')}
                      disabled={changingCategory}
                      className="p-4 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 text-left transition-all"
                    >
                      <div className="text-[var(--primary)] font-semibold text-sm mb-1"><Wrench className="w-4 h-4" /> {t('bomModal.categoryChange.wip.title')}</div>
                      <div className="text-xs text-[var(--fg-3)]">{t('bomModal.categoryChange.wip.subtitle')}</div>
                      <div className="text-xs text-[var(--fg-4)] mt-2">{t('bomModal.categoryChange.wip.description')}</div>
                    </button>
                  </div>
                </div>

                <div className="p-4 border-t border-[var(--border)] flex justify-end">
                  <button
                    onClick={() => setCategoryChangeModal(null)}
                    className="px-4 py-2 text-sm border border-[var(--border)] rounded text-[var(--fg-3)] hover:text-[var(--fg-2)]"
                  >
                    {t('bomModal.categoryChange.cancel')}
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

        {/* Edit Material Modal — opens on units tab with pre-filled conversion form */}
        <EditModal
          open={!!editStockItem}
          item={editStockItem?.item ?? null}
          initialTab="units"
          initialConvForm={editStockItem?.convForm}
          onClose={() => setEditStockItem(null)}
          onSave={async () => {
            try {
              const materialsData = await bomService.getMaterials()
              setMaterials(materialsData || [])
            } catch (err: any) {
              console.error('Failed to reload materials:', err?.message || err)
            }
            setEditStockItem(null)
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
  const { t } = useTranslation()
  const [categories, setCategories] = useState<MaterialCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState<MaterialCategory | null>(null)
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    categoryId: '',
    unit: '',
    unitCost: 0,
    minStock: 10,
    maxStock: 100,
    initialStock: 0,
  })
  const [saving, setSaving] = useState(false)
  const { units: availableUnits } = useUnits()

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
    setFormData(prev => ({
      ...prev,
      categoryId,
      unit: category?.defaultUnit || prev.unit || '',
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.code || !formData.name || !formData.categoryId) {
      alert(t('bomModal.createMaterial.errors.required'))
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
        initialStock: formData.initialStock,
        unit: formData.unit || selectedCategory?.defaultUnit,
      })
      onSuccess(newMaterial)
      // Reset form
      setFormData({
        code: '',
        name: '',
        categoryId: '',
        unit: '',
        unitCost: 0,
        minStock: 10,
        maxStock: 100,
        initialStock: 0,
      })
      setSelectedCategory(null)
    } catch (err) {
      console.error('Failed to create material:', err)
      alert(t('bomModal.createMaterial.errors.createFailed'))
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
          className="fixed inset-0 bg-[var(--fg-1)]/50 flex items-center justify-center z-50 p-4"
          onClick={onClose}
        >
          <motion.div
            key="material-modal-content"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="phopy-card w-full max-w-md"
          >
            <div className="p-4 border-b border-[var(--border)] flex items-center justify-between bg-phopy-indigo/10">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-[var(--primary)]" />
                <h3 className="text-lg font-bold text-[var(--fg-1)]">{t('bomModal.createMaterial.title')}</h3>
              </div>
              <button onClick={onClose} className="p-1 hover:bg-[var(--bg)] rounded">
                <X className="w-5 h-5 text-[var(--fg-3)]" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-1">{t('bomModal.createMaterial.labels.code')} *</label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="phopy-input w-full text-sm"
                    placeholder="e.g., MAT-001"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-1">{t('bomModal.createMaterial.labels.category')} *</label>
                  <select
                    value={formData.categoryId}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                    className="phopy-input w-full text-sm"
                    required
                  >
                    <option value="">{t('bomModal.createMaterial.placeholders.selectCategory')}</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Unit - เลือกได้จากหมวดหมู่หรือ override */}
              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-1">{t('bomModal.createMaterial.labels.unit')} *</label>
                <select
                  value={formData.unit || selectedCategory?.defaultUnit || ''}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  className="phopy-input w-full text-sm"
                  required
                >
                  <option value="">{t('bomModal.createMaterial.placeholders.selectUnit')}</option>
                  {availableUnits.map((u) => (
                    <option key={u.value} value={u.value}>{u.label} ({u.value})</option>
                  ))}
                </select>
                {selectedCategory?.defaultUnit && (
                  <p className="text-xs text-[var(--fg-4)] mt-1">
                    {t('bomModal.createMaterial.defaultUnit', { unit: selectedCategory.defaultUnit })}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm text-[var(--fg-3)] mb-1">{t('bomModal.createMaterial.labels.name')} *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="phopy-input w-full text-sm"
                  placeholder={t('bomModal.createMaterial.placeholders.name')}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-1">{t('bomModal.createMaterial.labels.unitCost')}</label>
                  <input
                    type="number"
                    value={formData.unitCost}
                    onChange={(e) => setFormData({ ...formData, unitCost: parseFloat(e.target.value) || 0 })}
                    className="phopy-input w-full text-sm"
                    min="0"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-1">{t('bomModal.createMaterial.labels.initialStock')}</label>
                  <input
                    type="number"
                    value={formData.initialStock}
                    onChange={(e) => setFormData({ ...formData, initialStock: parseInt(e.target.value) || 0 })}
                    className="phopy-input w-full text-sm"
                    min="0"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-1">{t('bomModal.createMaterial.labels.minStock')}</label>
                  <input
                    type="number"
                    value={formData.minStock}
                    onChange={(e) => setFormData({ ...formData, minStock: parseInt(e.target.value) || 0 })}
                    className="phopy-input w-full text-sm"
                    min="0"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[var(--fg-3)] mb-1">{t('bomModal.createMaterial.labels.maxStock')}</label>
                  <input
                    type="number"
                    value={formData.maxStock}
                    onChange={(e) => setFormData({ ...formData, maxStock: parseInt(e.target.value) || 0 })}
                    className="phopy-input w-full text-sm"
                    min="0"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 text-sm border border-[var(--border)] rounded text-[var(--fg-3)] hover:text-[var(--fg-2)]"
                >
                  {t('bomModal.createMaterial.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving || !selectedCategory}
                  className="px-3 py-1.5 text-sm bg-phopy-indigo text-black rounded hover:shadow-2 disabled:opacity-50 flex items-center gap-1"
                >
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                  <Plus className="w-3 h-3" />
                  {t('bomModal.createMaterial.addMaterial')}
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
