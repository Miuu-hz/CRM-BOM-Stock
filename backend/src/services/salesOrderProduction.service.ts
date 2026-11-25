import db from '../db/sqlite'
import { convertQuantityBidirectional, normalizeUnit } from './unitConversion.service'
import { isServiceItem } from './stockItem.service'
import { getBomIngredientsRecursive } from './pos-stock.service'
import { roundQty } from '../utils/qty'
import { createWorkOrder, transitionWorkOrder, WorkOrderTransitionError, TransitionActor } from './workOrderTransition.service'

export interface SalesOrderItemStockCheck {
  soItemId: string
  stockItemId: string
  itemName: string
  stockUnit: string
  soUnit: string
  orderedQtyOriginal: number
  orderedQtyInBase: number
  stockQty: number
  sealedQty: number
  sealedInBase: number
  availableTotal: number
  isShort: boolean
  shortQty: number
  conversionFailed?: boolean
  stockDisplayUnit?: string
}

/**
 * Shared stock evaluation for Sales Order items.
 * Used for both confirming an SO and planning Make-To-Order shortfall production.
 */
export function evaluateSalesOrderStock(tenantId: string, soId: string): SalesOrderItemStockCheck[] {
  const soItems = db.prepare(`
    SELECT soi.*, si.quantity as stock_qty, si.unit as stock_unit, si.sealed_qty as stock_sealed,
           si.base_unit as stock_base_unit, si.display_unit as stock_display_unit, si.category as stock_category,
           COALESCE(soi.product_name, si.name) as item_name
    FROM sales_order_items soi
    LEFT JOIN stock_items si ON soi.stock_item_id = si.id AND si.tenant_id = soi.tenant_id
    WHERE soi.sales_order_id = ? AND soi.tenant_id = ?
  `).all(soId, tenantId) as any[]

  return soItems.map(it => {
    if (!it.stock_item_id || isServiceItem({ category: it.stock_category })) {
      return {
        soItemId: it.id,
        stockItemId: it.stock_item_id || '',
        itemName: it.item_name || 'สินค้า',
        stockUnit: it.stock_base_unit || it.stock_unit || '',
        soUnit: it.unit || '',
        orderedQtyOriginal: Number(it.quantity || 0),
        orderedQtyInBase: Number(it.quantity || 0),
        stockQty: Number(it.stock_qty || 0),
        sealedQty: Number(it.stock_sealed || 0),
        sealedInBase: 0,
        availableTotal: Number(it.stock_qty || 0),
        isShort: false,
        shortQty: 0,
        stockDisplayUnit: it.stock_display_unit || it.stock_unit || '',
      }
    }

    let needQty = Number(it.quantity || 0)
    const soUnit = it.unit || ''
    const stockUnit = it.stock_base_unit || it.stock_unit || ''
    let conversionFailed = false

    if (soUnit && stockUnit && normalizeUnit(soUnit) !== normalizeUnit(stockUnit)) {
      const converted = convertQuantityBidirectional(needQty, soUnit, stockUnit, tenantId, it.stock_item_id, it.product_name)
      if (converted) {
        needQty = converted.converted
      } else {
        console.warn(`[qty] SO stock check: no conversion ${soUnit} → ${stockUnit} for stock item ${it.stock_item_id}; treating as insufficient`)
        conversionFailed = true
      }
    }

    const stockBase = it.stock_base_unit || it.stock_unit
    const stockDisplay = it.stock_display_unit || it.stock_unit
    let sealedInBase = 0
    if (stockBase && stockDisplay && normalizeUnit(stockBase) !== normalizeUnit(stockDisplay)) {
      const pack = convertQuantityBidirectional(1, stockDisplay, stockBase, tenantId, it.stock_item_id)
      if (pack && pack.factor > 0) {
        sealedInBase = (it.stock_sealed || 0) * pack.factor
      }
    }

    const availableTotal = (it.stock_qty ?? 0) + sealedInBase
    const isShort = conversionFailed || (availableTotal < needQty)
    const shortQty = conversionFailed ? needQty : Math.max(0, roundQty(needQty - availableTotal))

    return {
      soItemId: it.id,
      stockItemId: it.stock_item_id,
      itemName: it.item_name || 'สินค้า',
      stockUnit,
      soUnit,
      orderedQtyOriginal: Number(it.quantity || 0),
      orderedQtyInBase: needQty,
      stockQty: Number(it.stock_qty || 0),
      sealedQty: Number(it.stock_sealed || 0),
      sealedInBase,
      availableTotal,
      isShort,
      shortQty,
      conversionFailed,
      stockDisplayUnit: stockDisplay || '',
    }
  })
}

export interface SalesOrderProductionPlanItem {
  soItemId: string
  stockItemId: string
  name: string
  unit: string // product stock base unit
  orderedQty: number
  stockQty: number
  shortQty: number
  produceQty: number // ceil(shortQty)
  bomId: string | null
  problem: string | null
}

export interface SalesOrderProductionPlanMaterial {
  materialId: string
  name: string
  unit: string // material stock unit
  requiredQty: number
  stockQty: number
  shortQty: number
  problem: string | null
}

export interface SalesOrderProductionPlan {
  ok: boolean
  allowNegativeStock: boolean
  items: SalesOrderProductionPlanItem[]
  materials: SalesOrderProductionPlanMaterial[]
  blockers: string[]
}

/**
 * Explodes finished goods shortfall for an SO, checks raw material availability,
 * and builds a make-to-order production plan.
 */
export function planSalesOrderProduction(tenantId: string, soId: string): SalesOrderProductionPlan {
  const so = db.prepare('SELECT * FROM sales_orders WHERE id = ? AND tenant_id = ?').get(soId, tenantId) as any
  if (!so) {
    throw new WorkOrderTransitionError(404, 'Sales order not found')
  }

  const negSetting = db.prepare('SELECT allow_negative_stock FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
  const allowNegativeStock = !!negSetting && negSetting.allow_negative_stock === 1

  const blockers: string[] = []
  const stockEvaluations = evaluateSalesOrderStock(tenantId, soId)
  const shortItems = stockEvaluations.filter(it => it.isShort)

  const items: SalesOrderProductionPlanItem[] = []

  for (const it of shortItems) {
    const bom = db.prepare(`
      SELECT id, output_qty, output_unit, product_id
      FROM boms
      WHERE tenant_id = ? AND product_id = ? AND status = 'ACTIVE'
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `).get(tenantId, it.stockItemId) as any

    let bomId: string | null = null
    let problem: string | null = null

    if (!bom) {
      problem = 'ไม่มีสูตรการผลิต (BOM) ที่ใช้งาน'
      blockers.push(`สินค้า "${it.itemName}": ไม่มีสูตรการผลิต (BOM) ที่ใช้งาน`)
    } else if (it.conversionFailed) {
      bomId = bom.id
      problem = `ไม่มีการแปลงหน่วย ${it.soUnit} → ${it.stockUnit}`
      blockers.push(`สินค้า "${it.itemName}": ไม่มีการแปลงหน่วย ${it.soUnit} → ${it.stockUnit}`)
    } else {
      bomId = bom.id
    }

    const produceQty = Math.ceil(it.shortQty)

    items.push({
      soItemId: it.soItemId,
      stockItemId: it.stockItemId,
      name: it.itemName,
      unit: it.stockUnit,
      orderedQty: it.orderedQtyInBase,
      stockQty: it.availableTotal,
      shortQty: it.shortQty,
      produceQty,
      bomId,
      problem,
    })
  }

  interface MaterialAcc {
    materialId: string
    name: string
    unit: string
    requiredQty: number
    problem: string | null
    looseQty: number
    sealedQty: number
    stockBaseUnit: string
    stockDisplayUnit: string
  }

  const matMap = new Map<string, MaterialAcc>()

  for (const item of items) {
    if (!item.bomId || item.produceQty <= 0) continue

    const ingredients = getBomIngredientsRecursive(item.bomId, tenantId, item.produceQty)

    for (const ing of ingredients) {
      const matId = ing.stock_item_id
      if (!matId) continue
      const matName = ing.stock_item_name
      const ingUnit = ing.ingredient_unit
      const qtyUsed = Number(ing.quantity_used)

      const stock = db.prepare('SELECT id, name, unit, base_unit, display_unit, quantity, sealed_qty FROM stock_items WHERE id = ? AND tenant_id = ?').get(matId, tenantId) as any
      const matStockUnit = stock?.base_unit || stock?.unit || ingUnit

      let convertedQty = qtyUsed
      let convProblem: string | null = null

      if (ingUnit && matStockUnit && normalizeUnit(ingUnit) !== normalizeUnit(matStockUnit)) {
        const conv = convertQuantityBidirectional(qtyUsed, ingUnit, matStockUnit, tenantId, matId)
        if (conv) {
          convertedQty = conv.converted
        } else {
          convProblem = `ไม่มีการแปลงหน่วย ${ingUnit} → ${matStockUnit}`
          blockers.push(`วัตถุดิบ "${stock?.name || matName}": ไม่มีการแปลงหน่วย ${ingUnit} → ${matStockUnit}`)
        }
      }

      if (!matMap.has(matId)) {
        matMap.set(matId, {
          materialId: matId,
          name: stock?.name || matName,
          unit: matStockUnit,
          requiredQty: 0,
          problem: convProblem,
          looseQty: Number(stock?.quantity || 0),
          sealedQty: Number(stock?.sealed_qty || 0),
          stockBaseUnit: stock?.base_unit || stock?.unit || '',
          stockDisplayUnit: stock?.display_unit || stock?.unit || '',
        })
      }

      const acc = matMap.get(matId)!
      acc.requiredQty += convertedQty
      if (convProblem && !acc.problem) {
        acc.problem = convProblem
      }
    }
  }

  const materials: SalesOrderProductionPlanMaterial[] = []

  for (const acc of matMap.values()) {
    let sealedInBase = 0
    if (acc.stockBaseUnit && acc.stockDisplayUnit && normalizeUnit(acc.stockBaseUnit) !== normalizeUnit(acc.stockDisplayUnit)) {
      const pack = convertQuantityBidirectional(1, acc.stockDisplayUnit, acc.stockBaseUnit, tenantId, acc.materialId)
      if (pack && pack.factor > 0) {
        sealedInBase = (acc.sealedQty || 0) * pack.factor
      }
    }

    const stockQty = roundQty((acc.looseQty || 0) + sealedInBase)
    const requiredQty = roundQty(acc.requiredQty)
    const shortQty = roundQty(Math.max(0, requiredQty - stockQty))
    let problem = acc.problem

    if (shortQty > 0) {
      if (!allowNegativeStock) {
        blockers.push(`วัตถุดิบ "${acc.name}": สต็อกไม่เพียงพอ ต้องการ ${requiredQty} ${acc.unit} มี ${stockQty} ${acc.unit}`)
        if (!problem) {
          problem = `สต็อกไม่เพียงพอ ต้องการ ${requiredQty} ${acc.unit} มี ${stockQty} ${acc.unit}`
        }
      }
    }

    materials.push({
      materialId: acc.materialId,
      name: acc.name,
      unit: acc.unit,
      requiredQty,
      stockQty,
      shortQty,
      problem,
    })
  }

  return {
    ok: blockers.length === 0,
    allowNegativeStock,
    items,
    materials,
    blockers,
  }
}

/**
 * Creates and finishes work orders for all shortfall items in a Sales Order.
 * Executes atomically in one transaction.
 */
export function produceForSalesOrder(
  tenantId: string,
  soId: string,
  actor: TransitionActor
): { workOrders: Array<{ id: string; wo_number: string; product_name: string; quantity: number; status: string }> } {
  const so = db.prepare('SELECT * FROM sales_orders WHERE id = ? AND tenant_id = ?').get(soId, tenantId) as any
  if (!so) {
    throw new WorkOrderTransitionError(404, 'Sales order not found')
  }

  if (so.status !== 'DRAFT') {
    throw new WorkOrderTransitionError(400, `ไม่สามารถสั่งผลิตได้ — คำสั่งขายอยู่ในสถานะ ${so.status} (ต้องเป็น DRAFT)`)
  }

  const plan = planSalesOrderProduction(tenantId, soId)
  if (!plan.ok) {
    throw new WorkOrderTransitionError(400, plan.blockers.join(' · '))
  }

  if (plan.items.length === 0) {
    return { workOrders: [] }
  }

  const createdWorkOrders: Array<{ id: string; wo_number: string; product_name: string; quantity: number; status: string }> = []

  const execute = db.transaction(() => {
    for (const item of plan.items) {
      if (!item.bomId || item.produceQty <= 0) continue

      const exploded = getBomIngredientsRecursive(item.bomId, tenantId, item.produceQty)
      const materials = exploded.map((m: any) => ({
        materialId: m.stock_item_id,
        materialName: m.stock_item_name,
        requiredQty: m.quantity_used,
        unit: m.ingredient_unit,
        unitCost: m.unit_cost || 0,
      }))

      const wo = createWorkOrder(
        tenantId,
        {
          bomId: item.bomId,
          productName: item.name,
          quantity: item.produceQty,
          unit: item.unit,
          sales_order_id: soId,
          notes: `ผลิตอัตโนมัติจากใบขาย ${so.so_number}`,
          materials,
        },
        { notify: false }
      )

      transitionWorkOrder(tenantId, wo.id, 'PLANNED', actor, { notify: false })
      transitionWorkOrder(tenantId, wo.id, 'IN_PROGRESS', actor, { notify: false })
      const completed = transitionWorkOrder(tenantId, wo.id, 'COMPLETED', actor, { notify: false, completeAll: true })

      createdWorkOrders.push({
        id: completed.id,
        wo_number: completed.wo_number,
        product_name: completed.product_name,
        quantity: completed.quantity,
        status: completed.status,
      })
    }
  })

  execute()

  return { workOrders: createdWorkOrders }
}
