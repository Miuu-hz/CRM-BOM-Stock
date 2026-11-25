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
import { getBomIngredientsRecursive } from './pos-stock.service'

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
  /** ปิดงานผลิตได้แม้ role ไม่ถึง — ใช้กับการสั่งผลิตจากใบขายที่ตรวจสิทธิ์ production:write มาแล้ว (ไม่รวมยกเลิก) */
  canComplete?: boolean
}

export interface TransitionOptions {
  notify?: boolean
}

export interface CreateWorkOrderInput {
  bomId?: string | null
  /** stock_items.id ของสินค้าที่ผลิต — ใช้เมื่อไม่มี BOM (มี BOM ใช้สินค้าของ BOM เสมอ) */
  productId?: string | null
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

interface MaterialLine {
  materialId: string
  materialName: string
  requiredQty: number
  unit: string
}

/** ทุกบรรทัดต้องผูกกับสินค้าในคลังของเทแนนต์ — ชื่อลอย ๆ ตัดสต็อก/คิดต้นทุนไม่ได้ */
function resolveMaterials(tenantId: string, materials: any[] | undefined): MaterialLine[] {
  if (materials !== undefined && materials !== null && !Array.isArray(materials)) {
    throw new WorkOrderTransitionError(400, 'รูปแบบรายการวัตถุดิบไม่ถูกต้อง')
  }
  return (materials || []).map((m: any) => {
    const label = m?.materialName || m?.materialId || '-'
    let id: string | null
    try {
      id = resolveStockItemId(tenantId, m?.materialId, m?.materialName)
    } catch (e: any) {
      if (e instanceof StockItemRefError) throw new WorkOrderTransitionError(400, e.message)
      throw e
    }
    if (!id) throw new WorkOrderTransitionError(400, `วัตถุดิบ "${label}" ยังไม่ได้เลือกจากคลังสินค้า`)
    const requiredQty = Number(m.requiredQty)
    if (!isPositiveQty(requiredQty)) throw new WorkOrderTransitionError(400, `จำนวนที่ต้องใช้ของ "${label}" ต้องมากกว่า 0`)
    const stock = db.prepare('SELECT name, unit FROM stock_items WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
    return {
      materialId: id,
      materialName: stock.name,
      requiredQty: roundQty(requiredQty),
      unit: normalizeUnit(String(m.unit || stock.unit || '')),
    }
  })
}

/** สินค้าที่ผลิต: มี BOM ใช้สินค้าของ BOM เสมอ ไม่มีค่อยใช้ที่เลือกจากคลัง */
function resolveProduct(tenantId: string, bomId: unknown, productId: unknown): { bomId: string | null; productId: string | null } {
  if (bomId) {
    const bom = db.prepare('SELECT id, product_id FROM boms WHERE id = ? AND tenant_id = ?').get(bomId, tenantId) as any
    if (!bom) throw new WorkOrderTransitionError(400, 'ไม่พบ BOM ที่เลือก')
    return { bomId: bom.id, productId: bom.product_id || null }
  }
  try {
    return { bomId: null, productId: resolveStockItemId(tenantId, productId, 'สินค้าที่ผลิต') }
  } catch (e: any) {
    if (e instanceof StockItemRefError) throw new WorkOrderTransitionError(400, e.message)
    throw e
  }
}

/** id สินค้าสำเร็จรูปที่จะรับเข้าคลังตอนปิดงาน (ใช้ร่วม REST + MCP) */
export function workOrderProductId(tenantId: string, wo: { bom_id?: string | null; product_id?: string | null }): string | null {
  if (wo.bom_id) {
    const bom = db.prepare('SELECT product_id FROM boms WHERE id = ? AND tenant_id = ?').get(wo.bom_id, tenantId) as any
    if (bom?.product_id) return bom.product_id
  }
  return wo.product_id || null
}

function productUnit(tenantId: string, productId: string | null): string | null {
  if (!productId) return null
  const p = db.prepare('SELECT base_unit, unit FROM stock_items WHERE id = ? AND tenant_id = ?').get(productId, tenantId) as any
  return p?.base_unit || p?.unit || null
}

export interface MaterialStockCheck {
  stockStatus: 'ok' | 'short' | 'mismatch' | 'unknown'
  stockQty: number
  stockUnit: string
  /** จำนวนที่ต้องใช้ แปลงเป็นหน่วยสต็อกแล้ว (null = แปลงไม่ได้) */
  needQty: number | null
  shortQty: number
  sku: string
  unitCost: number
}

/** เทียบวัตถุดิบกับสต็อกในหน่วยเดียวกัน รวมแพ็คที่ยังไม่แกะ · ตัวเดิมซ้ำหลายบรรทัดหักต่อกัน */
export function checkMaterialStock(
  tenantId: string,
  lines: { materialId?: string | null; requiredQty: number; unit?: string | null }[]
): MaterialStockCheck[] {
  const used = new Map<string, number>()
  return lines.map(l => {
    const st = l.materialId
      ? db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(l.materialId, tenantId) as any
      : null
    if (!st) return { stockStatus: 'unknown' as const, stockQty: 0, stockUnit: '', needQty: null, shortQty: 0, sku: '', unitCost: 0 }

    let available = Number(st.quantity) || 0
    const base = st.base_unit || st.unit
    if ((st.sealed_qty ?? 0) > 0 && st.display_unit && base && normalizeUnit(st.display_unit) !== normalizeUnit(base)) {
      const pack = convertQuantityBidirectional(Number(st.sealed_qty), st.display_unit, base, tenantId, st.id)
      if (pack) available += pack.converted
    }
    const info = { stockQty: roundQty(available), stockUnit: st.unit || '', sku: st.sku || '', unitCost: Number(st.unit_cost) || 0 }

    let need: number | null = Number(l.requiredQty) || 0
    if (l.unit && st.unit && normalizeUnit(l.unit) !== normalizeUnit(st.unit)) {
      need = convertQuantityBidirectional(need, l.unit, st.unit, tenantId, st.id)?.converted ?? null
    }
    if (need === null) return { ...info, stockStatus: 'mismatch' as const, needQty: null, shortQty: 0 }

    need = roundQty(need)
    const left = roundQty(available - (used.get(st.id) || 0))
    used.set(st.id, (used.get(st.id) || 0) + need)
    const shortQty = roundQty(Math.max(0, need - Math.max(0, left)))
    return { ...info, stockStatus: shortQty > 0 ? 'short' as const : 'ok' as const, needQty: need, shortQty }
  })
}

/** ต้นทุนวัตถุดิบโดยประมาณ — ต้นทุนเป็นต่อหน่วยสต็อก จึงต้องคูณจำนวนที่แปลงหน่วยแล้วเท่านั้น */
function estimateMaterialCost(tenantId: string, lines: MaterialLine[]): number {
  return Math.round(checkMaterialStock(tenantId, lines).reduce((s, c) => s + (c.needQty ?? 0) * c.unitCost, 0) * 100) / 100
}

/** วัตถุดิบตาม BOM สำหรับจำนวนผลิตที่สั่ง (แตก BOM ลูก, หาร output_qty, หน่วยตามสูตร) */
export function bomMaterials(tenantId: string, bomId: string, quantity: number, unit?: string | null): MaterialLine[] {
  const bom = db.prepare(`
    SELECT b.product_id, COALESCE(b.output_unit, p.base_unit, p.unit) as out_unit
    FROM boms b LEFT JOIN stock_items p ON p.id = b.product_id AND p.tenant_id = b.tenant_id
    WHERE b.id = ? AND b.tenant_id = ?
  `).get(bomId, tenantId) as any
  if (!bom) throw new WorkOrderTransitionError(400, 'ไม่พบ BOM ที่เลือก')
  if (!isPositiveQty(quantity)) throw new WorkOrderTransitionError(400, 'จำนวนที่ต้องการผลิตต้องเป็นตัวเลขมากกว่า 0')

  let qty = quantity
  if (unit && bom.out_unit && normalizeUnit(unit) !== normalizeUnit(bom.out_unit)) {
    const c = convertQuantityBidirectional(qty, unit, bom.out_unit, tenantId, bom.product_id || undefined)
    if (!c) throw new WorkOrderTransitionError(400, `ไม่พบการแปลงหน่วย ${unit} → ${bom.out_unit} ของสินค้าที่ผลิต กรุณาตั้งค่า Unit Conversion ก่อน`)
    qty = c.converted
  }

  const grouped = new Map<string, MaterialLine>()
  for (const it of getBomIngredientsRecursive(bomId, tenantId, qty)) {
    const u = normalizeUnit(String(it.ingredient_unit || it.stock_unit || ''))
    const key = `${it.stock_item_id}|${u}`
    const line = grouped.get(key)
    if (line) line.requiredQty += Number(it.quantity_used)
    else grouped.set(key, { materialId: it.stock_item_id, materialName: it.stock_item_name || '', requiredQty: Number(it.quantity_used), unit: u })
  }
  return [...grouped.values()].map(l => ({ ...l, requiredQty: roundQty(l.requiredQty) })).filter(l => l.requiredQty > 0)
}

function insertMaterials(tenantId: string, woId: string, lines: MaterialLine[]) {
  const insert = db.prepare(`
    INSERT INTO work_order_materials (id, tenant_id, work_order_id, material_id, material_name, required_qty, unit, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
  `)
  for (const m of lines) insert.run(generateId(), tenantId, woId, m.materialId, m.materialName, m.requiredQty, m.unit)
}

/** กันเริ่มผลิตทั้งที่มีวัตถุดิบไม่ผูกคลัง — เดิมข้ามเงียบ ๆ ผลิตเสร็จโดยไม่ตัดสต็อก */
export function assertMaterialsLinked(tenantId: string, materials: any[]): void {
  const bad = materials.filter(m => !m.material_id
    || !db.prepare('SELECT 1 FROM stock_items WHERE id = ? AND tenant_id = ?').get(m.material_id, tenantId))
  if (bad.length > 0) {
    throw new WorkOrderTransitionError(400,
      `วัตถุดิบยังไม่ผูกกับคลังสินค้า: ${bad.map(m => m.material_name || '-').join(', ')} — กดแก้ไขใบสั่งงานแล้วเลือกจากคลังก่อนเริ่มผลิต`)
  }
}

export function createWorkOrder(
  tenantId: string,
  input: CreateWorkOrderInput,
  opts?: { notify?: boolean }
): any {
  const { priority, dueDate, assignedTo, notes } = input
  const salesOrderId = input.sales_order_id || input.salesOrderId || null
  const quantity = Number(input.quantity)

  if (!isPositiveQty(quantity)) {
    throw new WorkOrderTransitionError(400, 'จำนวนที่ต้องการผลิตต้องเป็นตัวเลขมากกว่า 0')
  }
  const { bomId, productId } = resolveProduct(tenantId, input.bomId, input.productId)
  const materials = resolveMaterials(tenantId, input.materials)
  const unit = input.unit ? normalizeUnit(String(input.unit)) : productUnit(tenantId, productId)

  const id = generateId()
  const woNumber = formatDocumentNumber('WO', tenantId, 'WORK_ORDER', undefined, 5)
  const now = new Date().toISOString()

  db.transaction(() => {
    db.prepare(`
      INSERT INTO work_orders (id, tenant_id, wo_number, bom_id, product_id, product_name, quantity, status, priority, unit,
        due_date, assigned_to, notes, estimated_cost, sales_order_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, woNumber, bomId, productId, input.productName || '', quantity, priority || 'NORMAL', unit,
      dueDate || null, assignedTo || '', notes || '', estimateMaterialCost(tenantId, materials), salesOrderId, now, now)
    insertMaterials(tenantId, id, materials)
  })()

  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(id, tenantId)
  const woMaterials = db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(id)

  if (opts?.notify !== false) {
    lineBotService.notifyWorkOrderCreated(tenantId, wo).catch(e => console.error('LINE Bot error:', e))
  }

  return { ...wo, materials: woMaterials }
}

function getEditableWorkOrder(tenantId: string, woId: string, action: string): any {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(woId, tenantId) as any
  if (!wo) throw new WorkOrderTransitionError(404, 'Work order not found')
  if (!['DRAFT', 'PLANNED'].includes(wo.status) || woMaterialsIssued(tenantId, wo.wo_number)) {
    throw new WorkOrderTransitionError(400, `${action}ได้เฉพาะใบที่ยังไม่เริ่มผลิต — ใบที่เริ่มแล้วให้ใช้ "ยกเลิก" ระบบจะคืนวัตถุดิบเข้าคลังให้`)
  }
  return wo
}

/** แก้ใบสั่งงาน — ฟิลด์ที่ไม่ส่งมา = คงเดิม · ส่ง materials มา = แทนที่ทั้งชุด */
export function updateWorkOrder(tenantId: string, woId: string, input: Partial<CreateWorkOrderInput>): any {
  const wo = getEditableWorkOrder(tenantId, woId, 'แก้ไข')
  const keep = (v: any, old: any) => (v === undefined ? old : v)

  const quantity = input.quantity === undefined || input.quantity === null ? wo.quantity : Number(input.quantity)
  if (!isPositiveQty(quantity)) throw new WorkOrderTransitionError(400, 'จำนวนที่ต้องการผลิตต้องเป็นตัวเลขมากกว่า 0')

  const product = input.bomId === undefined && input.productId === undefined
    ? { bomId: wo.bom_id, productId: wo.product_id }
    : resolveProduct(tenantId, keep(input.bomId, wo.bom_id), keep(input.productId, wo.product_id))
  const materials = input.materials === undefined ? null : resolveMaterials(tenantId, input.materials)

  db.transaction(() => {
    db.prepare(`
      UPDATE work_orders SET bom_id = ?, product_id = ?, product_name = ?, quantity = ?, priority = ?, unit = ?,
        due_date = ?, assigned_to = ?, notes = ?, estimated_cost = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(product.bomId, product.productId, input.productName || wo.product_name, quantity, input.priority || wo.priority,
      input.unit ? normalizeUnit(String(input.unit))
        : product.productId !== wo.product_id || product.bomId !== wo.bom_id ? productUnit(tenantId, product.productId) : wo.unit,
      keep(input.dueDate, wo.due_date) || null, keep(input.assignedTo, wo.assigned_to) ?? '', keep(input.notes, wo.notes) ?? '',
      materials ? estimateMaterialCost(tenantId, materials) : wo.estimated_cost, new Date().toISOString(), woId, tenantId)
    if (materials) {
      db.prepare('DELETE FROM work_order_materials WHERE work_order_id = ?').run(woId)
      insertMaterials(tenantId, woId, materials)
    }
  })()

  const updated = db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(woId, tenantId) as any
  return { ...updated, materials: db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(woId) }
}

/** ลบใบสั่งงาน — ร่างลบได้ทุกคน · วางแผนแล้วต้องเป็นหัวหน้างานขึ้นไป · มีงานจ้าง/QC อ้างอิงอยู่ลบไม่ได้ */
export function deleteWorkOrder(tenantId: string, woId: string, actor: TransitionActor): void {
  const wo = getEditableWorkOrder(tenantId, woId, 'ลบ')
  if (wo.status !== 'DRAFT' && !actor.isMaster && !WO_PRIVILEGED_ROLES.includes(actor.role)) {
    throw new WorkOrderTransitionError(403, `ไม่มีสิทธิ์ลบใบสั่งผลิตที่วางแผนแล้ว — ต้องเป็น ${WO_PRIVILEGED_ROLES.join('/')}`)
  }
  const used = db.prepare('SELECT 1 FROM wo_subcontracts WHERE work_order_id = ? UNION ALL SELECT 1 FROM qc_inspections WHERE work_order_id = ? LIMIT 1').get(woId, woId)
  if (used) throw new WorkOrderTransitionError(400, 'ลบไม่ได้ — มีงานจ้างผลิตหรือผลตรวจ QC อ้างอิงใบนี้อยู่ ให้ใช้ "ยกเลิก" แทน')
  db.transaction(() => {
    db.prepare('DELETE FROM work_order_materials WHERE work_order_id = ?').run(woId)
    db.prepare('DELETE FROM work_orders WHERE id = ? AND tenant_id = ?').run(woId, tenantId)
  })()
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

  if ((toStatus === 'CANCELLED' || (toStatus === 'COMPLETED' && !actor.canComplete)) && !actor.isMaster && !WO_PRIVILEGED_ROLES.includes(actor.role)) {
    throw new WorkOrderTransitionError(403, `ไม่มีสิทธิ์${toStatus === 'CANCELLED' ? 'ยกเลิก' : 'ปิด'}ใบสั่งผลิต — ต้องเป็น ${WO_PRIVILEGED_ROLES.join('/')}`)
  }

  const now = new Date().toISOString()
  const materials = db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(woId) as any[]

  if (toStatus === 'IN_PROGRESS' && wo.status !== 'IN_PROGRESS' && woMaterialsIssued(effectiveTenantId, wo.wo_number)) {
    db.prepare('UPDATE work_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run(toStatus, now, woId, effectiveTenantId)
  } else if (toStatus === 'IN_PROGRESS' && wo.status !== 'IN_PROGRESS') {
    assertMaterialsLinked(effectiveTenantId, materials)
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
      const productId = workOrderProductId(effectiveTenantId, wo)
      const finishedStock = productId ? db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(productId, effectiveTenantId) as any : null
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
