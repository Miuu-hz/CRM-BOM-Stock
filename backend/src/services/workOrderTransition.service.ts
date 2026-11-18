import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
import { lineBotService } from './line-bot.service'
import { convertQuantityBidirectional, autoUnpackIfNeeded, normalizeUnit } from './unitConversion.service'
import { roundQty, isPositiveQty } from '../utils/qty'
import {
  restockCancelledWorkOrderMaterials, workOrderStatusError,
  woMaterialsIssued, WO_PRIVILEGED_ROLES, resolveWorkOrderCompletion, settleWorkOrderCost,
} from './stockMovement.service'
import { resolveStockItemId, StockItemRefError } from './stockItem.service'

export class WorkOrderTransitionError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'WorkOrderTransitionError'
    this.status = status
  }
}

export interface TransitionActor {
  email?: string
  role: string
  isMaster: boolean
}

export interface TransitionOptions {
  notify?: boolean
}

export interface CreateWorkOrderInput {
  bomId?: string | null
  productName?: string
  quantity: number
  priority?: string
  dueDate?: string | null
  assignedTo?: string
  notes?: string
  materials?: any[]
  unit?: string | null
  sales_order_id?: string | null
  salesOrderId?: string | null
}

export function createWorkOrder(
  tenantId: string,
  input: CreateWorkOrderInput,
  opts?: { notify?: boolean }
): any {
  const { bomId, productName, quantity, priority, dueDate, assignedTo, notes, materials, unit } = input
  const salesOrderId = input.sales_order_id || input.salesOrderId || null

  if (!isPositiveQty(quantity)) {
    throw new WorkOrderTransitionError(400, 'จำนวนที่ต้องการผลิตต้องเป็นตัวเลขมากกว่า 0')
  }

  try {
    for (const m of materials || []) {
      m.materialId = resolveStockItemId(tenantId, m.materialId, m.materialName)
    }
  } catch (e: any) {
    if (e instanceof StockItemRefError) {
      throw new WorkOrderTransitionError(400, e.message)
    }
    throw e
  }

  const id = generateId()
  const woNumber = formatDocumentNumber('WO', tenantId, 'WORK_ORDER', undefined, 5)
  const now = new Date().toISOString()

  let estimatedCost = 0
  if (materials) {
    estimatedCost = materials.reduce((sum: number, m: any) => sum + (m.requiredQty * (m.unitCost || 0)), 0)
  }

  let woUnit: string | null = unit || null
  if (!woUnit && bomId) {
    const bomProduct = db.prepare(`
      SELECT p.base_unit, p.unit FROM boms b
      LEFT JOIN stock_items p ON b.product_id = p.id
      WHERE b.id = ? AND b.tenant_id = ?
    `).get(bomId, tenantId) as any
    woUnit = bomProduct?.base_unit || bomProduct?.unit || null
  }

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO work_orders (id, tenant_id, wo_number, bom_id, product_name, quantity, status, priority, unit,
        due_date, assigned_to, notes, estimated_cost, sales_order_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, woNumber, bomId || null, productName || '', quantity, priority || 'NORMAL', woUnit,
      dueDate || null, assignedTo || '', notes || '', estimatedCost, salesOrderId, now, now)

    if (materials && materials.length > 0) {
      const insertMaterial = db.prepare(`
        INSERT INTO work_order_materials (id, tenant_id, work_order_id, material_id, material_name, required_qty, unit, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
      `)
      for (const m of materials) {
        let mUnit = m.unit || ''
        if (!mUnit && m.materialId) {
          const stockItem = db.prepare('SELECT unit FROM stock_items WHERE id = ? AND tenant_id = ?').get(m.materialId, tenantId) as any
          mUnit = stockItem?.unit || ''
        }
        insertMaterial.run(generateId(), tenantId, id, m.materialId || null, m.materialName || '', m.requiredQty, mUnit)
      }
    }
  })

  transaction()

  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(id, tenantId)
  const woMaterials = db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(id)

  if (opts?.notify !== false) {
    lineBotService.notifyWorkOrderCreated(tenantId, wo).catch(e => console.error('LINE Bot error:', e))
  }

  return { ...wo, materials: woMaterials }
}

export function transitionWorkOrder(
  tenantId: string,
  woId: string,
  toStatus: string,
  actor: TransitionActor,
  opts?: TransitionOptions
): any {
  const validStatuses = ['DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ON_HOLD']
  if (!validStatuses.includes(toStatus)) {
    throw new WorkOrderTransitionError(400, 'Invalid status')
  }

  let effectiveTenantId = tenantId
  const wo = (actor.isMaster
    ? db.prepare('SELECT * FROM work_orders WHERE id = ?').get(woId)
    : db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(woId, tenantId)) as any

  if (!wo) {
    throw new WorkOrderTransitionError(404, 'Work order not found')
  }

  if (actor.isMaster && wo.tenant_id) {
    effectiveTenantId = wo.tenant_id
  }

  const seqError = workOrderStatusError(wo.status, toStatus)
  if (seqError) {
    throw new WorkOrderTransitionError(400, seqError)
  }

  if ((toStatus === 'CANCELLED' || toStatus === 'COMPLETED') && !actor.isMaster && !WO_PRIVILEGED_ROLES.includes(actor.role)) {
    throw new WorkOrderTransitionError(403, `ไม่มีสิทธิ์${toStatus === 'CANCELLED' ? 'ยกเลิก' : 'ปิด'}ใบสั่งผลิต — ต้องเป็น ${WO_PRIVILEGED_ROLES.join('/')}`)
  }

  const now = new Date().toISOString()
  const materials = db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(woId) as any[]

  if (toStatus === 'IN_PROGRESS' && wo.status !== 'IN_PROGRESS' && woMaterialsIssued(effectiveTenantId, wo.wo_number)) {
    db.prepare('UPDATE work_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run(toStatus, now, woId, effectiveTenantId)
  } else if (toStatus === 'IN_PROGRESS' && wo.status !== 'IN_PROGRESS') {
    const negSetting = db.prepare('SELECT allow_negative_stock FROM company_settings WHERE tenant_id = ?').get(effectiveTenantId) as any
    const allowNegativeStock = !!negSetting && negSetting.allow_negative_stock === 1

    const deductStock = db.transaction(() => {
      db.prepare('UPDATE work_orders SET status = ?, start_date = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(toStatus, now, now, woId, effectiveTenantId)

      for (const m of materials) {
        if (m.material_id) {
          const stock = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(m.material_id, effectiveTenantId) as any
          if (!stock) continue

          let deductQty = m.required_qty
          let movementNotes = 'Material issued for work order'

          if (m.unit && m.unit !== stock.unit) {
            const converted = convertQuantityBidirectional(Number(m.required_qty), m.unit, stock.unit, effectiveTenantId, m.material_id)
            if (!converted) {
              throw new WorkOrderTransitionError(400, `ไม่พบการแปลงหน่วย ${m.unit} → ${stock.unit} สำหรับ ${m.material_name} กรุณาตั้งค่า Unit Conversion ก่อน`)
            }
            deductQty = converted.converted
            movementNotes = `Material issued for work order (converted: ${m.required_qty} ${m.unit} → ${converted.converted.toFixed(4)} ${stock.unit}, factor: ${converted.factor})`
          }

          const needed = roundQty(Number(deductQty))
          if (stock.quantity < needed && (stock.sealed_qty ?? 0) > 0) {
            const unpack = autoUnpackIfNeeded(stock, needed, effectiveTenantId)
            if (unpack && unpack.unpackedPacks > 0) {
              const gained = roundQty(unpack.unpackedPacks * unpack.packFactor)
              db.prepare('UPDATE stock_items SET sealed_qty = ?, quantity = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
                .run(unpack.sealed_qty, unpack.quantity, now, stock.id, effectiveTenantId)
              db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
                VALUES (?, ?, ?, 'UNPACK', ?, ?, ?, ?, ?, ?, 'system')`)
                .run(generateId(), effectiveTenantId, stock.id, gained, stock.display_unit || null, unpack.unpackedPacks, `WO: ${wo.wo_number}`,
                  `แกะอัตโนมัติ ${unpack.unpackedPacks} ${stock.display_unit} → ${gained} ${stock.unit}`, now)
              stock.quantity = unpack.quantity
            }
          }

          if (stock.quantity < needed && !allowNegativeStock) {
            throw new WorkOrderTransitionError(400, `Insufficient stock for ${m.material_name}. Need ${needed} ${stock.unit}, have ${stock.quantity}`)
          }

          db.prepare('UPDATE stock_items SET quantity = quantity - ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
            .run(needed, now, stock.id, effectiveTenantId)

          db.prepare(`
            INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
            VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, 'system')
          `).run(generateId(), effectiveTenantId, stock.id, needed, `WO: ${wo.wo_number}`, movementNotes, now)

          db.prepare("UPDATE work_order_materials SET issued_qty = ?, status = 'ISSUED' WHERE id = ?")
            .run(m.required_qty, m.id)
        }
      }
    })

    try {
      deductStock()
    } catch (err: any) {
      if (err instanceof WorkOrderTransitionError) throw err
      throw new WorkOrderTransitionError(400, err?.message || 'เบิกวัตถุดิบไม่สำเร็จ')
    }
  } else if (toStatus === 'COMPLETED' && wo.status !== 'COMPLETED') {
    const qcResult = resolveWorkOrderCompletion(effectiveTenantId, woId, wo.quantity)
    if (qcResult.error) {
      throw new WorkOrderTransitionError(400, qcResult.error)
    }
    const finalCompletedQty = qcResult.completedQty

    const completeTransaction = db.transaction(() => {
      db.prepare('UPDATE work_orders SET status = ?, completed_date = ?, completed_qty = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(toStatus, now, finalCompletedQty, now, woId, effectiveTenantId)

      let finished: { id: string; addQty: number } | null = null
      if (wo.bom_id) {
        const bom = db.prepare('SELECT product_id FROM boms WHERE id = ? AND tenant_id = ?').get(wo.bom_id, effectiveTenantId) as any
        if (bom?.product_id) {
          const finishedStock = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(bom.product_id, effectiveTenantId) as any
          if (finishedStock) {
            const stockUnit = finishedStock.base_unit || finishedStock.unit
            const woUnit = wo.unit || stockUnit

            let addQty = Number(finalCompletedQty)
            let movementUnit: string | null = null
            let movementQuantity: number | null = null
            if (stockUnit && woUnit && normalizeUnit(woUnit) !== normalizeUnit(stockUnit)) {
              const converted = convertQuantityBidirectional(addQty, woUnit, stockUnit, effectiveTenantId, finishedStock.id)
              if (!converted) {
                throw new WorkOrderTransitionError(400, `ไม่พบการแปลงหน่วย ${woUnit} → ${stockUnit} สำหรับสินค้าสำเร็จรูป "${finishedStock.name}" กรุณาตั้งค่า Unit Conversion ก่อนปิดใบสั่งงาน`)
              }
              movementUnit = woUnit
              movementQuantity = addQty
              addQty = converted.converted
            }
            addQty = roundQty(addQty)

            db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
              .run(addQty, now, finishedStock.id, effectiveTenantId)
            db.prepare(`
              INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
              VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, 'system')
            `).run(generateId(), effectiveTenantId, finishedStock.id, addQty, movementUnit, movementQuantity, `WO: ${wo.wo_number}`, 'Finished goods from production', now)
            finished = { id: finishedStock.id, addQty }
          }
        }
      }
      settleWorkOrderCost(effectiveTenantId, actor.email || 'system', { id: woId, wo_number: wo.wo_number }, finished)
    })

    try {
      completeTransaction()
    } catch (err: any) {
      if (err instanceof WorkOrderTransitionError) throw err
      throw new WorkOrderTransitionError(400, err?.message || 'ปิดงานผลิตไม่สำเร็จ')
    }
  } else if (toStatus === 'CANCELLED') {
    if (wo.status === 'COMPLETED') {
      throw new WorkOrderTransitionError(400, 'ยกเลิกใบสั่งผลิตที่ผลิตเสร็จแล้วไม่ได้ — สินค้าสำเร็จรูปเข้าสต็อกไปแล้ว')
    }
    const cancelTransaction = db.transaction(() => {
      db.prepare('UPDATE work_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(toStatus, now, woId, effectiveTenantId)
      restockCancelledWorkOrderMaterials(effectiveTenantId, 'system', { id: woId, wo_number: wo.wo_number })
    })

    try {
      cancelTransaction()
    } catch (err: any) {
      if (err instanceof WorkOrderTransitionError) throw err
      throw new WorkOrderTransitionError(400, err?.message || 'ยกเลิกใบสั่งผลิตไม่สำเร็จ')
    }
  } else {
    db.prepare('UPDATE work_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run(toStatus, now, woId, effectiveTenantId)
  }

  const updated = db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(woId, effectiveTenantId)

  if (updated && toStatus !== wo.status && opts?.notify !== false) {
    lineBotService.notifyWorkOrderStatusChanged(effectiveTenantId, updated).catch(e => console.error('LINE Bot status change error:', e))
  }

  return updated
}
