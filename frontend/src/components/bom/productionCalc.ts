import type { BOM } from '../../services/bom'

export const EPSILON = 1e-9

export type StockStatus = 'OK' | 'LOW' | 'INSUFFICIENT' | 'OUT_OF_STOCK' | 'CHILD_BOM' | 'UNCONVERTIBLE'

export interface RawBOMItem {
  id?: string
  itemType?: 'MATERIAL' | 'CHILD_BOM'
  item_type?: 'MATERIAL' | 'CHILD_BOM'
  materialId?: string
  material_id?: string
  childBomId?: string
  child_bom_id?: string
  quantity: number
  unit?: string
  childBomProductName?: string
  child_bom_product_name?: string
  childBomProductCode?: string
  child_bom_product_code?: string
  material?: {
    name?: string
    code?: string
    unit?: string
    unitCost?: number
    currentStock?: number
  }
}

export interface ProductionRequirementRow {
  rowKey: string
  itemType: 'MATERIAL' | 'CHILD_BOM'
  materialId: string
  materialName: string
  materialCode: string
  recipeQuantity: number
  recipeUnit: string
  requiredStockQty: number
  stockUnit: string
  availableStock: number
  shortage: number
  originalUnitCost: number
  simulatedUnitCost: number
  originalTotal: number
  simulatedTotal: number
  change: number
  changePercent: number
  status: StockStatus
  unconvertible?: boolean
}

export interface ProductionTotals {
  originalTotal: number
  simulatedTotal: number
  totalChange: number
  totalChangePercent: number
  originalPerUnit: number
  simulatedPerUnit: number
  changePerUnit: number
  canProduce: boolean
  readyCount: number
  materialRowsCount: number
  hasZeroStock: boolean
  hasInsufficient: boolean
}

export function calculateBatches(quantity: number, outputQty: number): number {
  const safeOutput = Number(outputQty) > 0 ? Number(outputQty) : 1
  const safeQty = Math.max(0, Number(quantity) || 0)
  return safeQty / safeOutput
}

// 4-decimal rounding for ±% price adjustments (keeps low-cost items accurate)
export function adjustPrice(originalCost: number, percent: number): number {
  return Math.round(originalCost * (1 + percent / 100) * 10000) / 10000
}

export function computeStockStatus(
  availableStock: number,
  requiredStockQty: number
): 'OK' | 'LOW' | 'INSUFFICIENT' | 'OUT_OF_STOCK' {
  if (availableStock <= EPSILON) {
    return 'OUT_OF_STOCK'
  }
  if (availableStock + EPSILON < requiredStockQty) {
    return 'INSUFFICIENT'
  }
  if (availableStock + EPSILON < requiredStockQty * 1.2) {
    return 'LOW'
  }
  return 'OK'
}

export function calculateShortage(availableStock: number, requiredStockQty: number): number {
  const diff = requiredStockQty - availableStock
  return diff > EPSILON ? diff : 0
}

export function computeRequirementRows(params: {
  items: RawBOMItem[]
  batches: number
  materials: Array<{ id: string; name?: string; code?: string; unit?: string; unitCost?: number; currentStock?: number }>
  boms: BOM[]
  availableChildBOMs?: BOM[]
  conversionFactors?: Record<string, number>
  unconvertibleKeys?: Record<string, boolean>
  priceChanges?: Record<string, number>
}): ProductionRequirementRow[] {
  const {
    items,
    batches,
    materials,
    boms,
    availableChildBOMs = [],
    conversionFactors = {},
    unconvertibleKeys = {},
    priceChanges = {},
  } = params

  if (!items || items.length === 0 || batches <= 0) {
    return []
  }

  // 1. First pass: compute base row info and sum required stock qty per material
  type Interim = Omit<ProductionRequirementRow, 'shortage' | 'status'> & {
    matStock: number
  }

  const interimRows: Interim[] = items.map((item, index) => {
    const isChild = (item.itemType || item.item_type) === 'CHILD_BOM'
    const idSuffix = item.id || String(index)

    if (isChild) {
      const cId = item.childBomId || item.child_bom_id || ''
      const rowKey = `child:${cId}:${idSuffix}`
      const childBom =
        boms.find((b) => b.id === cId) ||
        availableChildBOMs.find((b) => b.id === cId)
      const name =
        item.childBomProductName ||
        item.child_bom_product_name ||
        childBom?.productName ||
        childBom?.product?.name ||
        '-'
      const code =
        item.childBomProductCode ||
        item.child_bom_product_code ||
        childBom?.productCode ||
        childBom?.product?.code ||
        ''
      const reqQty = Number(item.quantity) * batches
      const childUnit =
        childBom?.outputUnit ||
        childBom?.output_unit ||
        childBom?.product?.unit ||
        item.unit ||
        'ชุด'
      const origCost = Number(childBom?.totalCost) || 0
      const simCost = priceChanges[rowKey] ?? origCost
      const origTotal = reqQty * origCost
      const simTotal = reqQty * simCost
      const change = simTotal - origTotal
      const changePercent = origTotal > 0 ? (change / origTotal) * 100 : 0

      return {
        rowKey,
        itemType: 'CHILD_BOM',
        materialId: cId,
        materialName: name,
        materialCode: code,
        recipeQuantity: reqQty,
        recipeUnit: childUnit,
        requiredStockQty: reqQty,
        stockUnit: childUnit,
        availableStock: 0,
        matStock: 0,
        originalUnitCost: origCost,
        simulatedUnitCost: simCost,
        originalTotal: origTotal,
        simulatedTotal: simTotal,
        change,
        changePercent,
        unconvertible: false,
      }
    }

    const mId = item.materialId || item.material_id || ''
    const rowKey = `mat:${mId}:${idSuffix}`
    const mat = materials.find((m) => m.id === mId) || item.material
    const name = mat?.name || item.material?.name || '-'
    const code = mat?.code || item.material?.code || ''
    const stockUnit = mat?.unit || item.material?.unit || item.unit || ''
    const recipeUnit = item.unit || stockUnit
    const factorKey = `${mId}:${recipeUnit}->${stockUnit}`
    const isUnconvertible = Boolean(unconvertibleKeys[rowKey])
    const factor = recipeUnit !== stockUnit ? (conversionFactors[factorKey] ?? 1) : 1

    const recipeQty = Number(item.quantity) * batches
    const requiredStockQty = isUnconvertible ? 0 : recipeQty * factor
    const availableStock = Number(mat?.currentStock) || 0

    const origCost = Number(mat?.unitCost ?? item.material?.unitCost) || 0
    const simCost = priceChanges[rowKey] ?? origCost
    const origTotal = isUnconvertible ? 0 : requiredStockQty * origCost
    const simTotal = isUnconvertible ? 0 : requiredStockQty * simCost
    const change = simTotal - origTotal
    const changePercent = origTotal > 0 ? (change / origTotal) * 100 : 0

    return {
      rowKey,
      itemType: 'MATERIAL',
      materialId: mId,
      materialName: name,
      materialCode: code,
      recipeQuantity: recipeQty,
      recipeUnit,
      requiredStockQty,
      stockUnit,
      availableStock,
      matStock: availableStock,
      originalUnitCost: origCost,
      simulatedUnitCost: simCost,
      originalTotal: origTotal,
      simulatedTotal: simTotal,
      change,
      changePercent,
      unconvertible: isUnconvertible,
    }
  })

  // 2. Sum required stock quantity per material across all rows (handling duplicates)
  const totalRequiredPerMaterial: Record<string, number> = {}
  for (const r of interimRows) {
    if (r.itemType === 'MATERIAL' && !r.unconvertible) {
      totalRequiredPerMaterial[r.materialId] =
        (totalRequiredPerMaterial[r.materialId] || 0) + r.requiredStockQty
    }
  }

  // 3. Second pass: determine status and shortage based on total required quantity
  return interimRows.map((r) => {
    if (r.itemType === 'CHILD_BOM') {
      return {
        ...r,
        shortage: 0,
        status: 'CHILD_BOM' as StockStatus,
      }
    }

    if (r.unconvertible) {
      return {
        ...r,
        shortage: 0,
        status: 'UNCONVERTIBLE' as StockStatus,
      }
    }

    const totalReq = totalRequiredPerMaterial[r.materialId] || 0
    const status = computeStockStatus(r.matStock, totalReq)
    const shortage = calculateShortage(r.matStock, totalReq)

    return {
      ...r,
      shortage,
      status,
    }
  })
}

export function computeTotals(
  rows: ProductionRequirementRow[],
  safeQuantity: number,
  childBomShort: boolean = false
): ProductionTotals {
  // Exclude unconvertible rows from cost totals
  const validCostRows = rows.filter((r) => !r.unconvertible)
  const originalTotal = validCostRows.reduce((sum, r) => sum + r.originalTotal, 0)
  const simulatedTotal = validCostRows.reduce((sum, r) => sum + r.simulatedTotal, 0)
  const totalChange = simulatedTotal - originalTotal
  const totalChangePercent = originalTotal > 0 ? (totalChange / originalTotal) * 100 : 0

  const originalPerUnit = safeQuantity > 0 ? originalTotal / safeQuantity : 0
  const simulatedPerUnit = safeQuantity > 0 ? simulatedTotal / safeQuantity : 0
  const changePerUnit = simulatedPerUnit - originalPerUnit

  // Exclude unconvertible rows from "can produce" decision
  const materialRows = rows.filter((r) => r.itemType === 'MATERIAL')
  const convertibleMaterialRows = materialRows.filter((r) => !r.unconvertible)
  const hasZeroStock = convertibleMaterialRows.some((r) => r.status === 'OUT_OF_STOCK')
  const hasInsufficient = convertibleMaterialRows.some((r) => r.status === 'INSUFFICIENT')
  const canProduce =
    convertibleMaterialRows.length > 0 &&
    !hasZeroStock &&
    !hasInsufficient &&
    !childBomShort

  const readyCount = convertibleMaterialRows.filter(
    (r) => r.status === 'OK' || r.status === 'LOW'
  ).length

  return {
    originalTotal,
    simulatedTotal,
    totalChange,
    totalChangePercent,
    originalPerUnit,
    simulatedPerUnit,
    changePerUnit,
    canProduce,
    readyCount,
    materialRowsCount: materialRows.length,
    hasZeroStock,
    hasInsufficient,
  }
}
