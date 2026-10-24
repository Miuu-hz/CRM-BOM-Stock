import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import {
  Calculator,
  Package,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  Loader2,
  Ban,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  GitBranch,
  Box,
  Check,
} from 'lucide-react'
import bomService, { BOM } from '../../services/bom'
import materialsService, { Material } from '../../services/materials'
import api from '../../services/api'
import { unitLabel } from '../../hooks/useUnits'
import { SearchableDropdown } from '../common/SearchableDropdown'
import {
  type ProductionRequirementRow,
  calculateBatches,
  adjustPrice,
  computeRequirementRows,
  computeTotals,
} from './productionCalc'

const getBomProductName = (b: any): string =>
  b?.productName || b?.product_name || b?.product?.name || '-'

const getBomProductCode = (b: any): string =>
  b?.productCode || b?.product_code || b?.product?.code || ''

const getBomOutputQty = (b: any): number => {
  const q = Number(b?.outputQty ?? b?.output_qty)
  return q > 0 ? q : 1
}

const getBomOutputUnit = (b: any): string =>
  b?.outputUnit || b?.output_unit || b?.productUnit || b?.product_unit || b?.product?.unit || ''

function ProductionCalculator() {
  const { t } = useTranslation()
  const [boms, setBoms] = useState<BOM[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [bomLoading, setBomLoading] = useState(false)
  const [bomError, setBomError] = useState<string | null>(null)

  const [selectedBomId, setSelectedBomId] = useState('')
  const [selectedBomFull, setSelectedBomFull] = useState<any | null>(null)
  const [quantity, setQuantity] = useState<number>(1)

  // Unit conversion factors cache: `${materialId}:${fromUnit}->${toUnit}` => factor
  const [conversionFactors, setConversionFactors] = useState<Record<string, number>>({})
  // Track rows with failed unit conversions
  const [unconvertibleKeys, setUnconvertibleKeys] = useState<Record<string, boolean>>({})
  // Simulated unit prices keyed by rowKey
  const [priceChanges, setPriceChanges] = useState<Record<string, number>>({})
  // Track if any child BOM exploded raw material is short
  const [childBomShort, setChildBomShort] = useState(false)

  useEffect(() => {
    loadInitialData()
  }, [])

  const loadInitialData = async () => {
    setLoading(true)
    try {
      const [bomsData, materialsData] = await Promise.all([
        bomService.getAll(),
        materialsService.getAll(),
      ])
      setBoms(bomsData || [])
      setMaterials(materialsData || [])
    } catch (err) {
      console.error('Failed to load BOM/materials data:', err)
    } finally {
      setLoading(false)
    }
  }

  // Fetch full BOM (with items) and resolve conversions in parallel when selectedBomId changes
  useEffect(() => {
    if (!selectedBomId) {
      setSelectedBomFull(null)
      setBomError(null)
      setPriceChanges({})
      setUnconvertibleKeys({})
      return
    }

    let cancelled = false
    const loadBomDetail = async () => {
      setSelectedBomFull(null)
      setBomError(null)
      setBomLoading(true)
      try {
        const full = await bomService.getById(selectedBomId)
        if (cancelled) return
        setSelectedBomFull(full)

        const items: any[] = full.items || full.materials || []
        const initialPrices: Record<string, number> = {}
        const newFactors: Record<string, number> = {}
        const unconvertibleMap: Record<string, boolean> = {}

        // Run conversion requests in parallel with Promise.all
        await Promise.all(
          items.map(async (item, index) => {
            const isChild = (item.itemType || item.item_type) === 'CHILD_BOM'
            const idSuffix = item.id || String(index)

            if (isChild) {
              const cId = item.childBomId || item.child_bom_id || ''
              const rowKey = `child:${cId}:${idSuffix}`
              const childBom =
                boms.find((b) => b.id === cId) ||
                (full as any).availableChildBOMs?.find((b: any) => b.id === cId)
              initialPrices[rowKey] = Number(childBom?.totalCost) || 0
            } else {
              const mId = item.materialId || item.material_id || ''
              const rowKey = `mat:${mId}:${idSuffix}`
              const mat = materials.find((m) => m.id === mId) || item.material
              const unitCost = Number(mat?.unitCost ?? item.material?.unitCost) || 0
              initialPrices[rowKey] = unitCost

              const stockUnit = mat?.unit || item.material?.unit || ''
              const recipeUnit = item.unit || stockUnit
              if (mId && recipeUnit && stockUnit && recipeUnit !== stockUnit) {
                const key = `${mId}:${recipeUnit}->${stockUnit}`
                try {
                  const res = await api.post('/materials/unit-conversions/convert', {
                    quantity: 1,
                    from_unit: recipeUnit,
                    to_unit: stockUnit,
                    material_id: mId,
                  })
                  const data = res.data?.data
                  if (
                    data?.canConvert === false ||
                    data?.converted == null ||
                    typeof data.converted !== 'number' ||
                    data.converted <= 0
                  ) {
                    unconvertibleMap[rowKey] = true
                  } else {
                    newFactors[key] = data.converted
                  }
                } catch {
                  unconvertibleMap[rowKey] = true
                }
              }
            }
          })
        )

        if (!cancelled) {
          setPriceChanges(initialPrices)
          setUnconvertibleKeys(unconvertibleMap)
          if (Object.keys(newFactors).length > 0) {
            setConversionFactors((prev) => ({ ...prev, ...newFactors }))
          }
        }
      } catch (err) {
        if (!cancelled) {
          setSelectedBomFull(null)
          setBomError('ไม่สามารถโหลดข้อมูลสูตรการผลิตได้ กรุณาลองใหม่อีกครั้ง')
          console.error('Failed to fetch BOM detail:', err)
        }
      } finally {
        if (!cancelled) setBomLoading(false)
      }
    }

    loadBomDetail()
    return () => {
      cancelled = true
    }
  }, [selectedBomId, materials, boms])

  const selectedBom = selectedBomFull || boms.find((b) => b.id === selectedBomId)
  const outputQtyPerBatch = getBomOutputQty(selectedBom)
  const outputUnit = getBomOutputUnit(selectedBom)
  const safeQuantity = Math.max(0, Number(quantity) || 0)
  const batches = calculateBatches(safeQuantity, outputQtyPerBatch)

  // Check child BOM exploded raw materials stock
  useEffect(() => {
    if (!selectedBomId || batches <= 0 || !selectedBomFull) {
      setChildBomShort(false)
      return
    }

    const items: any[] = selectedBomFull.items || selectedBomFull.materials || []
    const hasChild = items.some((it) => (it.itemType || it.item_type) === 'CHILD_BOM')
    if (!hasChild) {
      setChildBomShort(false)
      return
    }

    let cancelled = false
    bomService
      .explode(selectedBomId, batches)
      .then((res: any) => {
        if (cancelled) return
        const rawList = res?.rawList || []
        const childReqs: Record<string, number> = {}
        for (const it of rawList) {
          if (it.level > 0 && it.materialId) {
            childReqs[it.materialId] =
              (childReqs[it.materialId] || 0) + (Number(it.quantity) || 0)
          }
        }
        const isShort = Object.entries(childReqs).some(([mId, reqQty]) => {
          const mat = materials.find((m) => m.id === mId)
          const stock = Number(mat?.currentStock) || 0
          return stock + 1e-9 < reqQty
        })
        setChildBomShort(isShort)
      })
      .catch((err) => {
        console.error('Failed to check child BOM explosion:', err)
        if (!cancelled) setChildBomShort(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedBomId, batches, materials, selectedBomFull])

  const bomItems = selectedBomFull?.items || selectedBomFull?.materials || []
  const bomItemsCount = bomItems.length

  // Build unified requirements + cost simulation rows
  const rows = computeRequirementRows({
    items: bomItems,
    batches,
    materials,
    boms,
    availableChildBOMs: (selectedBomFull as any)?.availableChildBOMs,
    conversionFactors,
    unconvertibleKeys,
    priceChanges,
  })

  const {
    originalTotal,
    simulatedTotal,
    totalChange,
    totalChangePercent,
    originalPerUnit,
    simulatedPerUnit,
    changePerUnit,
    canProduce,
    readyCount,
    materialRowsCount,
    hasZeroStock,
    hasInsufficient,
  } = computeTotals(rows, safeQuantity, childBomShort)

  const materialRows = rows.filter((r) => r.itemType === 'MATERIAL')

  const handlePriceChange = (rowKey: string, val: number) => {
    setPriceChanges((prev) => ({ ...prev, [rowKey]: Math.max(0, val) }))
  }

  const applyPercentageChange = (percent: number) => {
    const updated: Record<string, number> = {}
    rows.forEach((r) => {
      updated[r.rowKey] = adjustPrice(r.originalUnitCost, percent)
    })
    setPriceChanges((prev) => ({ ...prev, ...updated }))
  }

  const resetPrices = () => {
    const initial: Record<string, number> = {}
    rows.forEach((r) => {
      initial[r.rowKey] = r.originalUnitCost
    })
    setPriceChanges(initial)
  }

  const getStatusBadge = (status: ProductionRequirementRow['status']) => {
    switch (status) {
      case 'OK':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--success-soft)] text-success">
            <CheckCircle className="w-3.5 h-3.5" />
            พร้อมผลิต
          </span>
        )
      case 'LOW':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--warning-soft)] text-warning">
            <AlertTriangle className="w-3.5 h-3.5" />
            ใกล้หมด
          </span>
        )
      case 'INSUFFICIENT':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--danger-soft)] text-danger">
            <AlertCircle className="w-3.5 h-3.5" />
            ไม่พอ
          </span>
        )
      case 'OUT_OF_STOCK':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-500">
            <Ban className="w-3.5 h-3.5" />
            สต็อกหมด
          </span>
        )
      case 'CHILD_BOM':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/15 text-purple-500">
            <GitBranch className="w-3.5 h-3.5" />
            Child BOM
          </span>
        )
      case 'UNCONVERTIBLE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-500">
            <AlertTriangle className="w-3.5 h-3.5" />
            แปลงหน่วยไม่ได้
          </span>
        )
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
    <div className="space-y-6">
      {/* Control Panel */}
      <div className="phopy-card p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-phopy-indigo to-purple-500 flex items-center justify-center shadow-1">
              <Calculator className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--fg-1)]">
                คำนวณการผลิต & จำลองต้นทุน
              </h2>
              <p className="text-sm text-[var(--fg-3)]">
                ตรวจสอบความพร้อมของวัตถุดิบในคลัง คำนวณปริมาณที่ต้องใช้ และจำลองผลกระทบเมื่อราคาวัตถุดิบเปลี่ยนแปลง
              </p>
            </div>
          </div>

          {/* Quick Price Simulation Controls */}
          {selectedBomId && rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-[var(--fg-3)] mr-1">
                จำลองปรับราคาวัตถุดิบ:
              </span>
              <button
                type="button"
                onClick={() => applyPercentageChange(-10)}
                className="px-2.5 py-1.5 bg-[var(--success-soft)] text-success rounded-lg hover:opacity-85 text-xs font-semibold transition-opacity"
              >
                -10%
              </button>
              <button
                type="button"
                onClick={() => applyPercentageChange(-5)}
                className="px-2.5 py-1.5 bg-[var(--success-soft)] text-success rounded-lg hover:opacity-85 text-xs font-semibold transition-opacity"
              >
                -5%
              </button>
              <button
                type="button"
                onClick={() => applyPercentageChange(5)}
                className="px-2.5 py-1.5 bg-[var(--danger-soft)] text-danger rounded-lg hover:opacity-85 text-xs font-semibold transition-opacity"
              >
                +5%
              </button>
              <button
                type="button"
                onClick={() => applyPercentageChange(10)}
                className="px-2.5 py-1.5 bg-[var(--danger-soft)] text-danger rounded-lg hover:opacity-85 text-xs font-semibold transition-opacity"
              >
                +10%
              </button>
              <button
                type="button"
                onClick={resetPrices}
                className="px-3 py-1.5 border border-[var(--border)] bg-[var(--surface-2)] rounded-lg text-[var(--fg-2)] hover:bg-[var(--surface)] flex items-center gap-1.5 text-xs font-medium transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                รีเซ็ตราคาจริง
              </button>
            </div>
          )}
        </div>

        {/* BOM Selection & Production Quantity */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end pt-2 border-t border-[var(--border)]">
          <div className="md:col-span-7">
            <label className="block text-sm font-medium text-[var(--fg-2)] mb-1.5">
              เลือกสูตรการผลิต (BOM)
            </label>
            <SearchableDropdown
              value={selectedBomId}
              onChange={setSelectedBomId}
              options={(boms || []).map((bom) => {
                const name = getBomProductName(bom)
                const code = getBomProductCode(bom)
                const u = getBomOutputUnit(bom)
                const cost = Number(bom.totalCost || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
                const statusTag = bom.status === 'ACTIVE' ? '' : ` [${bom.status}]`
                return {
                  id: bom.id,
                  label: `${code ? `${code} - ` : ''}${name} (${bom.version})${statusTag} — ฿${cost}${u ? `/${unitLabel(u)}` : ''}`,
                  searchText: `${code} ${name} ${bom.version}`,
                }
              })}
              placeholder="ค้นหาหรือเลือกสูตรการผลิต (BOM)..."
            />
          </div>

          <div className="md:col-span-5">
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-[var(--fg-2)]">
                จำนวนที่ต้องการผลิต
                {outputUnit && (
                  <span className="text-[var(--fg-3)] font-normal">
                    {' '}({unitLabel(outputUnit)})
                  </span>
                )}
              </label>
              <div className="flex items-center gap-1">
                {[1, 10, 50, 100].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setQuantity(preset)}
                    className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                      quantity === preset
                        ? 'bg-[var(--primary)] text-white'
                        : 'bg-[var(--surface-2)] text-[var(--fg-3)] hover:text-[var(--fg-1)]'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
            <input
              type="number"
              value={quantity || ''}
              onChange={(e) => setQuantity(Math.max(0, parseFloat(e.target.value) || 0))}
              min="1"
              step="any"
              className="phopy-input w-full h-[42px] text-sm tabular-nums"
            />
          </div>
        </div>

        {selectedBom && outputQtyPerBatch > 1 && (
          <div className="text-xs text-[var(--fg-3)] flex items-center gap-2 pt-1">
            <span>
              * สูตรนี้ 1 ชุดผลิตได้ <strong>{outputQtyPerBatch.toLocaleString('th-TH')} {unitLabel(outputUnit)}</strong>
              {' '}→ การผลิต {safeQuantity.toLocaleString('th-TH')} {unitLabel(outputUnit)} ใช้{' '}
              <strong className="text-[var(--primary)]">{batches.toLocaleString('th-TH', { maximumFractionDigits: 2 })} ชุดผลิต</strong>
            </span>
          </div>
        )}
      </div>

      {/* BOM Loading Spinner */}
      {bomLoading && (
        <div className="phopy-card p-12 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-[var(--primary)] animate-spin" />
        </div>
      )}

      {/* BOM Fetch Error Banner */}
      {bomError && (
        <div className="phopy-card p-6 border border-danger/40 bg-[var(--danger-soft)]/20 flex items-center gap-3 text-danger">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <div>
            <h4 className="font-semibold">{bomError}</h4>
            <p className="text-xs text-[var(--fg-3)] mt-0.5">
              โปรดลองเลือกสูตรการผลิตใหม่อีกครั้ง หรือตรวจสอบการเชื่อมต่อ
            </p>
          </div>
        </div>
      )}

      {/* Results & Simulation */}
      {!bomLoading && !bomError && selectedBomId && selectedBomFull && bomItemsCount > 0 && safeQuantity > 0 && rows.length > 0 && (
        <>
          {/* 4 KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Production Status */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className={`phopy-card p-4 border ${
                canProduce
                  ? 'border-success/40'
                  : hasZeroStock
                  ? 'border-red-500/60'
                  : 'border-danger/50'
              }`}
            >
              <p className="text-xs font-medium text-[var(--fg-3)] mb-1">สถานะสต็อกพร้อมผลิต</p>
              <div className="flex items-center gap-2">
                {canProduce ? (
                  <>
                    <CheckCircle className="w-6 h-6 text-success shrink-0" />
                    <span className="text-xl font-bold text-success">พร้อมผลิต</span>
                  </>
                ) : hasZeroStock ? (
                  <>
                    <Ban className="w-6 h-6 text-red-500 shrink-0" />
                    <span className="text-xl font-bold text-red-500">สต็อกหมด</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-6 h-6 text-danger shrink-0" />
                    <span className="text-xl font-bold text-danger">วัตถุดิบไม่พอ</span>
                  </>
                )}
              </div>
              <p className="text-xs text-[var(--fg-4)] mt-1.5">
                {childBomShort && !hasZeroStock && !hasInsufficient
                  ? 'วัตถุดิบของ Child BOM ไม่เพียงพอ'
                  : `พร้อมใช้ ${readyCount} / ${materialRowsCount} รายการวัตถุดิบ`}
              </p>
            </motion.div>

            {/* 2. Original Cost */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="phopy-card p-4"
            >
              <p className="text-xs font-medium text-[var(--fg-3)] mb-1">
                ต้นทุนการผลิตจริง ({safeQuantity.toLocaleString()} {unitLabel(outputUnit) || 'หน่วย'})
              </p>
              <p className="text-2xl font-bold text-[var(--fg-1)] tabular-nums">
                ฿{originalTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-[var(--fg-4)] mt-1.5 tabular-nums">
                เฉลี่ย ฿{originalPerUnit.toLocaleString(undefined, { maximumFractionDigits: 2 })} / {unitLabel(outputUnit) || 'หน่วย'}
              </p>
            </motion.div>

            {/* 3. Simulated Cost */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="phopy-card p-4"
            >
              <p className="text-xs font-medium text-[var(--fg-3)] mb-1">
                ต้นทุนจำลอง ({safeQuantity.toLocaleString()} {unitLabel(outputUnit) || 'หน่วย'})
              </p>
              <p className="text-2xl font-bold text-[var(--primary)] tabular-nums">
                ฿{simulatedTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-[var(--fg-4)] mt-1.5 tabular-nums">
                เฉลี่ย ฿{simulatedPerUnit.toLocaleString(undefined, { maximumFractionDigits: 2 })} / {unitLabel(outputUnit) || 'หน่วย'}
              </p>
            </motion.div>

            {/* 4. Difference */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className={`phopy-card p-4 ${
                totalChange > 0
                  ? 'border-danger/40'
                  : totalChange < 0
                  ? 'border-success/40'
                  : ''
              }`}
            >
              <p className="text-xs font-medium text-[var(--fg-3)] mb-1">ส่วนต่างต้นทุน (จำลอง vs จริง)</p>
              <div className="flex items-center gap-1.5">
                {totalChange > 0 ? (
                  <TrendingUp className="w-5 h-5 text-danger shrink-0" />
                ) : totalChange < 0 ? (
                  <TrendingDown className="w-5 h-5 text-success shrink-0" />
                ) : (
                  <Minus className="w-5 h-5 text-[var(--fg-4)] shrink-0" />
                )}
                <span
                  className={`text-2xl font-bold tabular-nums ${
                    totalChange > 0
                      ? 'text-danger'
                      : totalChange < 0
                      ? 'text-success'
                      : 'text-[var(--fg-3)]'
                  }`}
                >
                  {totalChange > 0 ? '+' : ''}฿{totalChange.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
                <span
                  className={`text-xs font-semibold tabular-nums ${
                    totalChange > 0
                      ? 'text-danger'
                      : totalChange < 0
                      ? 'text-success'
                      : 'text-[var(--fg-4)]'
                  }`}
                >
                  ({totalChangePercent > 0 ? '+' : ''}{totalChangePercent.toFixed(1)}%)
                </span>
              </div>
              <p className="text-xs text-[var(--fg-4)] mt-1.5 tabular-nums">
                ต่อหน่วย: {changePerUnit > 0 ? '+' : ''}฿{changePerUnit.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </motion.div>
          </div>

          {/* Unified Requirements & Price Simulation Table */}
          <div className="phopy-card overflow-hidden">
            <div className="p-4 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-[var(--fg-1)]">
                  ตารางคำนวณวัตถุดิบและจำลองราคา
                </h3>
                <p className="text-xs text-[var(--fg-3)]">
                  สามารถแก้ไขตัวเลขในช่อง &ldquo;ราคาจำลอง/หน่วย&rdquo; เพื่อดูผลกระทบต่อต้นทุนรวมได้ทันที
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="phopy-table stock-grid w-full">
                <thead>
                  <tr>
                    <th>สถานะ</th>
                    <th>วัตถุดิบ / ส่วนประกอบ</th>
                    <th className="text-right">ปริมาณที่ใช้</th>
                    <th className="text-right">คงเหลือในคลัง</th>
                    <th className="text-right">ขาดอีก</th>
                    <th className="text-right">ต้นทุนจริง/หน่วย</th>
                    <th className="text-right">ราคาจำลอง/หน่วย (฿)</th>
                    <th className="text-right">ต้นทุนรวม</th>
                    <th className="text-right">เปลี่ยนแปลง</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isChild = row.itemType === 'CHILD_BOM'
                    const unitConverted = row.recipeUnit !== row.stockUnit
                    const priceModified = Math.abs(row.simulatedUnitCost - row.originalUnitCost) > 1e-6
                    const currentPrice = priceChanges[row.rowKey] ?? row.originalUnitCost

                    return (
                      <tr
                        key={row.rowKey}
                        className={
                          row.status === 'OUT_OF_STOCK'
                            ? 'bg-red-500/10'
                            : row.status === 'INSUFFICIENT'
                            ? 'bg-[var(--danger-soft)]/50'
                            : ''
                        }
                      >
                        <td>{getStatusBadge(row.status)}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            {isChild ? (
                              <GitBranch className="w-4 h-4 text-purple-500 shrink-0" />
                            ) : (
                              <Box className="w-4 h-4 text-[var(--primary)] shrink-0" />
                            )}
                            <div>
                              <div className="font-medium text-[var(--fg-1)]">{row.materialName}</div>
                              {row.materialCode && (
                                <div className="text-xs text-[var(--fg-4)] font-mono">{row.materialCode}</div>
                              )}
                              {row.unconvertible && (
                                <div className="text-xs text-amber-500 flex items-center gap-1 mt-1">
                                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                  <span>แปลงหน่วย {row.recipeUnit} → {row.stockUnit} ไม่ได้ — ตั้งค่าการแปลงหน่วยของวัตถุดิบนี้ก่อน</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="text-right tabular-nums">
                          <div className="font-medium text-[var(--fg-1)]">
                            {row.recipeQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}{' '}
                            {unitLabel(row.recipeUnit)}
                          </div>
                          {unitConverted && !row.unconvertible && (
                            <div className="text-xs text-[var(--fg-4)]">
                              ≈ {row.requiredStockQty.toLocaleString(undefined, { maximumFractionDigits: 4 })}{' '}
                              {unitLabel(row.stockUnit)}
                            </div>
                          )}
                        </td>
                        <td className="text-right tabular-nums">
                          {isChild ? (
                            <span className="text-[var(--fg-4)]">-</span>
                          ) : row.availableStock <= 0 ? (
                            <span className="text-red-500 font-semibold">0 {unitLabel(row.stockUnit)}</span>
                          ) : (
                            <span
                              className={
                                row.status === 'INSUFFICIENT'
                                  ? 'text-danger font-medium'
                                  : row.status === 'LOW'
                                  ? 'text-warning font-medium'
                                  : 'text-success font-medium'
                              }
                            >
                              {row.availableStock.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
                              {unitLabel(row.stockUnit)}
                            </span>
                          )}
                        </td>
                        <td className="text-right tabular-nums">
                          {!isChild && !row.unconvertible && row.shortage > 0 ? (
                            <span className="text-danger font-semibold">
                              -{row.shortage.toLocaleString(undefined, { maximumFractionDigits: 4 })}{' '}
                              {unitLabel(row.stockUnit)}
                            </span>
                          ) : (
                            <span className="text-[var(--fg-4)]">-</span>
                          )}
                        </td>
                        <td className="text-right tabular-nums text-[var(--fg-3)]">
                          ฿{row.originalUnitCost.toLocaleString(undefined, {
                            maximumFractionDigits: row.originalUnitCost < 1 ? 4 : 2,
                          })}
                          {row.stockUnit && (
                            <span className="text-xs text-[var(--fg-4)]"> / {unitLabel(row.stockUnit)}</span>
                          )}
                        </td>
                        <td className="text-right">
                          <div className="inline-flex items-center justify-end gap-1">
                            <input
                              type="number"
                              value={
                                priceChanges[row.rowKey] !== undefined
                                  ? priceChanges[row.rowKey]
                                  : currentPrice < 1
                                  ? Number(currentPrice.toFixed(4))
                                  : currentPrice
                              }
                              onChange={(e) =>
                                handlePriceChange(row.rowKey, parseFloat(e.target.value) || 0)
                              }
                              min="0"
                              step={currentPrice < 1 ? '0.0001' : '0.01'}
                              className={`phopy-input w-28 h-8 px-2 py-1 text-sm text-right tabular-nums ${
                                priceModified ? 'border-[var(--primary)] bg-[var(--primary-soft)]/30 font-semibold' : ''
                              }`}
                            />
                          </div>
                        </td>
                        <td className="text-right tabular-nums">
                          {row.unconvertible ? (
                            <span className="text-warning font-semibold text-base">?</span>
                          ) : (
                            <>
                              <div className="font-semibold text-[var(--primary)]">
                                ฿{row.simulatedTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </div>
                              {priceModified && (
                                <div className="text-xs text-[var(--fg-4)] line-through">
                                  ฿{row.originalTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        <td className="text-right tabular-nums">
                          {row.unconvertible ? (
                            <span className="text-[var(--fg-4)]">-</span>
                          ) : (
                            <div className="inline-flex items-center justify-end gap-1">
                              {row.change > 0.001 ? (
                                <TrendingUp className="w-3.5 h-3.5 text-danger" />
                              ) : row.change < -0.001 ? (
                                <TrendingDown className="w-3.5 h-3.5 text-success" />
                              ) : (
                                <Minus className="w-3.5 h-3.5 text-[var(--fg-4)]" />
                              )}
                              <span
                                className={
                                  row.change > 0.001
                                    ? 'text-danger font-medium'
                                    : row.change < -0.001
                                    ? 'text-success font-medium'
                                    : 'text-[var(--fg-4)]'
                                }
                              >
                                {row.change > 0.001 ? '+' : ''}
                                {row.changePercent.toFixed(1)}%
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--border)] bg-[var(--surface-2)]/50">
                    <td colSpan={5} className="text-right font-semibold text-[var(--fg-2)]">
                      รวมต้นทุนการผลิต ({safeQuantity.toLocaleString()} {unitLabel(outputUnit) || 'หน่วย'}):
                    </td>
                    <td className="text-right font-semibold text-[var(--fg-3)] tabular-nums">
                      ฿{originalTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td></td>
                    <td className="text-right text-lg font-bold text-[var(--primary)] tabular-nums">
                      ฿{simulatedTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="text-right font-semibold tabular-nums">
                      <span
                        className={
                          totalChange > 0.001
                            ? 'text-danger'
                            : totalChange < -0.001
                            ? 'text-success'
                            : 'text-[var(--fg-4)]'
                        }
                      >
                        {totalChange > 0.001 ? '+' : ''}
                        {totalChangePercent.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Alerts & Impact Analysis Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Stock Shortage Warning */}
            {!canProduce && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className={`phopy-card p-5 border ${
                  hasZeroStock ? 'border-red-500/60 bg-red-500/5' : 'border-danger/50 bg-[var(--danger-soft)]/20'
                }`}
              >
                <div className="flex items-start gap-3">
                  {hasZeroStock ? (
                    <Ban className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-6 h-6 text-danger shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <h3 className="text-base font-bold text-danger mb-1">
                      รายการวัตถุดิบที่ต้องสั่งซื้อ/เติมสต็อกก่อนผลิต
                    </h3>
                    <p className="text-xs text-[var(--fg-3)] mb-3">
                      วัตถุดิบต่อไปนี้มีสต็อกไม่เพียงพอสำหรับการผลิต {safeQuantity.toLocaleString()} {unitLabel(outputUnit) || 'หน่วย'}:
                    </p>
                    <ul className="space-y-1.5 text-sm">
                      {materialRows
                        .filter((r) => r.status === 'OUT_OF_STOCK' || r.status === 'INSUFFICIENT')
                        .map((r) => (
                          <li key={r.rowKey} className="flex items-center justify-between gap-2 py-1 px-2.5 rounded bg-[var(--surface)]/80 border border-[var(--border)]">
                            <span className="font-medium text-[var(--fg-1)]">
                              {r.materialName}{' '}
                              {r.materialCode && <span className="text-xs text-[var(--fg-4)] font-mono">({r.materialCode})</span>}
                            </span>
                            <span className="text-danger font-semibold tabular-nums">
                              ขาดอีก {r.shortage.toLocaleString(undefined, { maximumFractionDigits: 4 })} {unitLabel(r.stockUnit)}
                            </span>
                          </li>
                        ))}
                      {childBomShort && (
                        <li className="flex items-center justify-between gap-2 py-1 px-2.5 rounded bg-[var(--surface)]/80 border border-[var(--border)]">
                          <span className="font-medium text-[var(--fg-1)]">
                            วัตถุดิบของ Child BOM
                          </span>
                          <span className="text-danger font-semibold tabular-nums">
                            สต็อกไม่เพียงพอ
                          </span>
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Cost Impact Analysis */}
            {Math.abs(totalChangePercent) > 0.01 && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className={`phopy-card p-5 border ${
                  totalChange > 0 ? 'border-danger/40' : 'border-success/40'
                }`}
              >
                <h3 className="text-base font-bold text-[var(--fg-1)] mb-3 flex items-center gap-2">
                  {totalChange > 0 ? (
                    <TrendingUp className="w-5 h-5 text-danger" />
                  ) : (
                    <TrendingDown className="w-5 h-5 text-success" />
                  )}
                  วิเคราะห์ผลกระทบด้านต้นทุน (Impact Analysis)
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-[var(--surface-2)]/60">
                    <p className="text-xs text-[var(--fg-3)] mb-1">
                      {t('bom.simulation.perUnitImpact')}
                    </p>
                    <p
                      className={`text-xl font-bold tabular-nums ${
                        totalChange > 0 ? 'text-danger' : 'text-success'
                      }`}
                    >
                      {changePerUnit > 0 ? '+' : ''}฿{changePerUnit.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-[var(--surface-2)]/60">
                    <p className="text-xs text-[var(--fg-3)] mb-1">
                      {t('bom.simulation.for100Units')}
                    </p>
                    <p
                      className={`text-xl font-bold tabular-nums ${
                        totalChange > 0 ? 'text-danger' : 'text-success'
                      }`}
                    >
                      {changePerUnit > 0 ? '+' : ''}฿{(changePerUnit * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--fg-3)] mt-3 pt-3 border-t border-[var(--border)]">
                  {totalChange > 0 ? (
                    <>
                      <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
                      <span>
                        ราคาวัตถุดิบที่ปรับเพิ่มขึ้น จะทำให้ต้นทุนการผลิตสูงขึ้น{' '}
                        <strong className="text-danger">+{totalChangePercent.toFixed(1)}%</strong>
                      </span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 text-success shrink-0" />
                      <span>
                        ราคาวัตถุดิบที่ปรับลดลง จะช่วยประหยัดต้นทุนการผลิตได้{' '}
                        <strong className="text-success">{Math.abs(totalChangePercent).toFixed(1)}%</strong>
                      </span>
                    </>
                  )}
                </div>
              </motion.div>
            )}
          </div>
        </>
      )}

      {/* Empty State when BOM has no items */}
      {!bomLoading && !bomError && selectedBomId && selectedBomFull && bomItemsCount === 0 && (
        <div className="phopy-card p-12 text-center">
          <Package className="w-12 h-12 text-[var(--fg-4)] mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-[var(--fg-2)] mb-1">
            สูตรการผลิตนี้ยังไม่มีรายการวัตถุดิบ
          </h3>
          <p className="text-sm text-[var(--fg-4)]">
            กรุณาเพิ่มวัตถุดิบในสูตรการผลิต (BOM) ก่อนคำนวณการผลิตและจำลองต้นทุน
          </p>
        </div>
      )}

      {/* Empty State when quantity is <= 0 */}
      {!bomLoading && !bomError && selectedBomId && selectedBomFull && bomItemsCount > 0 && safeQuantity <= 0 && (
        <div className="phopy-card p-12 text-center">
          <Calculator className="w-12 h-12 text-[var(--fg-4)] mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-[var(--fg-2)] mb-1">
            ใส่จำนวนที่จะผลิต
          </h3>
          <p className="text-sm text-[var(--fg-4)]">
            กรุณาระบุจำนวนผลผลิตที่ต้องการผลิต เพื่อคำนวณสต็อกวัตถุดิบและต้นทุน
          </p>
        </div>
      )}

      {/* Empty State when no BOM selected */}
      {!selectedBomId && (
        <div className="phopy-card p-12 text-center">
          <Calculator className="w-16 h-16 text-[var(--fg-4)] mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-[var(--fg-2)] mb-2">
            เลือกสูตรการผลิต (BOM) เพื่อคำนวณและจำลองต้นทุน
          </h3>
          <p className="text-[var(--fg-4)] max-w-lg mx-auto">
            เลือกสูตรการผลิตและระบุจำนวนที่ต้องการผลิต เพื่อตรวจสอบสต็อกวัตถุดิบ คำนวณปริมาณที่ต้องใช้ และทดลองปรับราคาวัตถุดิบเพื่อดูผลกระทบต่อต้นทุนในหน้าเดียว
          </p>
        </div>
      )}
    </div>
  )
}

export default ProductionCalculator
