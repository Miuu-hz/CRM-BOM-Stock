import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
import { lineBotService } from './line-bot.service'
import { convertQuantityBidirectional, autoUnpackIfNeeded, normalizeUnit } from './unitConversion.service'
import { roundQty, isPositiveQty } from '../utils/qty'
import {
  restockCancelledWorkOrderMaterials, workOrderStatusError,
  woMaterialsIssued, WO_PRIVILEGED_ROLES, resolveWorkOrderCompletion,
  isLegacyPreIssuedWo, settleWorkOrderLotCost,
} from './stockMovement.service'
import { getCostBasis } from './stockCostBasis.service'
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
  /** true = ปิดงานตามยอดที่ผลิตจริงแล้ว (Close Short) ไม่ผลิตส่วนที่เหลือ */
  closeShort?: boolean
  /** true = ปิดงานครบจำนวนที่เหลือในครั้งเดียว (ใช้เฉพาะ salesOrderProduction.service.ts) */
  completeAll?: boolean
}

export interface RecordWorkOrderLotInput {
  goodQty: number
  scrapQty?: number
  lotNumber?: string | null
  notes?: string | null
}

export interface RecordWorkOrderLotResult {
  lot: {
    id: string
    tenant_id: string
    work_order_id: string
    lot_number: string
    good_qty: number
    scrap_qty: number
    material_cost: number
    unit_cost: number
    notes: string
    recorded_by: string
    created_at: string
  }
  workOrder: any
  autoCompleted: boolean
  qcBlockedCompletion?: string | null
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
  const hasLots = !!db.prepare('SELECT 1 FROM work_order_lots WHERE tenant_id = ? AND work_order_id = ? LIMIT 1').get(tenantId, woId)
  if (!['DRAFT', 'PLANNED'].includes(wo.status) || woMaterialsIssued(tenantId, wo.wo_number) || hasLots) {
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

function loadWorkOrderForActor(tenantId: string, woId: string, isMaster: boolean): any {
  return isMaster
    ? db.prepare('SELECT * FROM work_orders WHERE id = ?').get(woId)
    : db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(woId, tenantId)
}

/** ยอดผลิตสะสมและคงเหลือของใบสั่งผลิต คำนวณจาก work_order_lots เท่านั้น (ไม่ใช้ work_orders.completed_qty ที่ QC อาจบวกไว้) */
export function lotTotals(tenantId: string, woId: string): { good: number; scrap: number; remaining: number } {
  const wo = db.prepare('SELECT quantity FROM work_orders WHERE id = ? AND tenant_id = ?').get(woId, tenantId) as any
  if (!wo) return { good: 0, scrap: 0, remaining: 0 }
  const row = db.prepare(
    'SELECT COALESCE(SUM(good_qty), 0) AS good, COALESCE(SUM(scrap_qty), 0) AS scrap FROM work_order_lots WHERE tenant_id = ? AND work_order_id = ?'
  ).get(tenantId, woId) as any
  const good = roundQty(Number(row?.good) || 0)
  const scrap = roundQty(Number(row?.scrap) || 0)
  const remaining = roundQty(Math.max(0, (Number(wo.quantity) || 0) - good - scrap))
  return { good, scrap, remaining }
}

/** รายละเอียดใบสั่งผลิตพร้อม materials (เช็คสต็อกส่วนที่ยังไม่เบิก), lots, inspections และยอด produced/remaining */
export function getWorkOrderDetail(tenantId: string, woId: string, isMaster = false): any | null {
  const wo = (isMaster
    ? db.prepare(`
        SELECT wo.*, so.so_number
        FROM work_orders wo
        LEFT JOIN sales_orders so ON wo.sales_order_id = so.id
        WHERE wo.id = ?
      `).get(woId)
    : db.prepare(`
        SELECT wo.*, so.so_number
        FROM work_orders wo
        LEFT JOIN sales_orders so ON wo.sales_order_id = so.id
        WHERE wo.id = ? AND wo.tenant_id = ?
      `).get(woId, tenantId)) as any
  if (!wo) return null

  const effectiveTenantId = wo.tenant_id
  const rows = db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(woId) as any[]
  // เบิกครบแล้วไม่ต้องเทียบสต็อก — ส่วนที่เหลือ (PENDING/PARTIAL) เทียบเฉพาะยอดที่ยังไม่ได้เบิก
  const unissued = rows.filter(m => m.status !== 'ISSUED')
  const checks = checkMaterialStock(effectiveTenantId, unissued.map(m => ({
    materialId: m.material_id,
    requiredQty: roundQty(Math.max(0, (Number(m.required_qty) || 0) - (Number(m.issued_qty) || 0))),
    unit: m.unit,
  })))
  const byId = new Map(unissued.map((m, i) => [m.id, checks[i]]))
  const materials = rows.map(m => ({ ...m, ...byId.get(m.id) }))

  const lots = db.prepare(
    'SELECT * FROM work_order_lots WHERE work_order_id = ? AND tenant_id = ? ORDER BY created_at ASC, rowid ASC'
  ).all(woId, effectiveTenantId) as any[]

  const isLegacyCompleted = wo.status === 'COMPLETED' && lots.length === 0
  const totals = lotTotals(effectiveTenantId, woId)
  const produced_qty = isLegacyCompleted ? (Number(wo.completed_qty) || 0) : totals.good
  const lot_scrap_qty = isLegacyCompleted ? (Number(wo.scrap_qty) || 0) : totals.scrap
  const remaining_qty = isLegacyCompleted ? 0 : totals.remaining

  const productId = workOrderProductId(effectiveTenantId, wo)
  const product = productId
    ? db.prepare('SELECT sku, name FROM stock_items WHERE id = ? AND tenant_id = ?').get(productId, effectiveTenantId) as any
    : null
  const inspections = db.prepare('SELECT * FROM qc_inspections WHERE work_order_id = ? AND tenant_id = ? ORDER BY created_at DESC')
    .all(woId, effectiveTenantId)

  return {
    ...wo,
    produced_qty,
    lot_scrap_qty,
    remaining_qty,
    finished_sku: product?.sku || null,
    finished_name: product?.name || null,
    materials,
    lots,
    inspections,
  }
}

function validateMaterialConversions(effectiveTenantId: string, materials: any[]): void {
  for (const m of materials) {
    if (!m.material_id) continue
    const stock = db.prepare('SELECT id, unit, base_unit FROM stock_items WHERE id = ? AND tenant_id = ?')
      .get(m.material_id, effectiveTenantId) as any
    if (!stock) continue
    const stockUnit = stock.base_unit || stock.unit
    if (m.unit && stockUnit && normalizeUnit(m.unit) !== normalizeUnit(stockUnit)) {
      const converted = convertQuantityBidirectional(Number(m.required_qty) || 1, m.unit, stockUnit, effectiveTenantId, m.material_id)
      if (!converted) {
        throw new WorkOrderTransitionError(400, `ไม่พบการแปลงหน่วย ${m.unit} → ${stock.unit} สำหรับ ${m.material_name} กรุณาตั้งค่า Unit Conversion ก่อน`)
      }
    }
  }
}

function deductLotMaterials(
  effectiveTenantId: string,
  wo: any,
  lotNumber: string,
  lotTotal: number,
  isLastLot: boolean,
  actor: TransitionActor,
  now: string
): number {
  const materials = db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(wo.id) as any[]
  assertMaterialsLinked(effectiveTenantId, materials)

  const negSetting = db.prepare('SELECT allow_negative_stock FROM company_settings WHERE tenant_id = ?').get(effectiveTenantId) as any
  const allowNegativeStock = !!negSetting && negSetting.allow_negative_stock === 1
  const movementRef = `WO: ${wo.wo_number} (${lotNumber})`
  const createdBy = actor.email || 'system'
  let lotMaterialCost = 0

  for (const m of materials) {
    if (!m.material_id) continue
    const alreadyIssued = roundQty(Number(m.issued_qty) || 0)
    const reqQty = roundQty(Number(m.required_qty) || 0)
    const remainingMat = roundQty(Math.max(0, reqQty - alreadyIssued))
    const lotMatQty = isLastLot
      ? remainingMat
      : roundQty(Math.min(remainingMat, reqQty * (lotTotal / Number(wo.quantity))))
    if (lotMatQty <= 0) continue

    const stock = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(m.material_id, effectiveTenantId) as any
    if (!stock) continue

    const stockUnit = stock.base_unit || stock.unit
    let deductQty = lotMatQty
    let movementNotes = `Material issued for work order ${wo.wo_number} (lot: ${lotNumber})`

    if (m.unit && stockUnit && normalizeUnit(m.unit) !== normalizeUnit(stockUnit)) {
      const converted = convertQuantityBidirectional(lotMatQty, m.unit, stockUnit, effectiveTenantId, m.material_id)
      if (!converted) {
        throw new WorkOrderTransitionError(400, `ไม่พบการแปลงหน่วย ${m.unit} → ${stock.unit} สำหรับ ${m.material_name} กรุณาตั้งค่า Unit Conversion ก่อน`)
      }
      deductQty = converted.converted
      movementNotes += ` (converted: ${lotMatQty} ${m.unit} → ${converted.converted.toFixed(4)} ${stock.unit}, factor: ${converted.factor})`
    }

    const needed = roundQty(Number(deductQty))
    if (needed > 0) {
      if (stock.quantity < needed && (stock.sealed_qty ?? 0) > 0) {
        const unpack = autoUnpackIfNeeded(stock, needed, effectiveTenantId)
        if (unpack && unpack.unpackedPacks > 0) {
          const gained = roundQty(unpack.unpackedPacks * unpack.packFactor)
          db.prepare('UPDATE stock_items SET sealed_qty = ?, quantity = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
            .run(unpack.sealed_qty, unpack.quantity, now, stock.id, effectiveTenantId)
          db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
            VALUES (?, ?, ?, 'UNPACK', ?, ?, ?, ?, ?, ?, ?)`)
            .run(generateId(), effectiveTenantId, stock.id, gained, stock.display_unit || null, unpack.unpackedPacks, movementRef,
              `แกะอัตโนมัติ ${unpack.unpackedPacks} ${stock.display_unit} → ${gained} ${stock.unit}`, now, createdBy)
          stock.quantity = unpack.quantity
        }
      }

      if (stock.quantity < needed && !allowNegativeStock) {
        throw new WorkOrderTransitionError(400, `สต็อกวัตถุดิบไม่เพียงพอสำหรับ ${m.material_name} (ต้องการ ${needed} ${stock.unit} มี ${stock.quantity} ${stock.unit})`)
      }

      const nextQty = roundQty(Number(stock.quantity) - needed)
      db.prepare('UPDATE stock_items SET quantity = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(nextQty, now, stock.id, effectiveTenantId)
      db.prepare(`
        INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
        VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, ?)
      `).run(generateId(), effectiveTenantId, stock.id, needed, movementRef, movementNotes, now, createdBy)

      const unitCost = getCostBasis(effectiveTenantId, stock.id).weightedAvg || Number(stock.unit_cost || 0)
      lotMaterialCost += needed * unitCost
    }

    const newIssued = roundQty(alreadyIssued + lotMatQty)
    const newMatStatus = newIssued >= reqQty - 1e-6 ? 'ISSUED' : 'PARTIAL'
    db.prepare('UPDATE work_order_materials SET issued_qty = ?, status = ? WHERE id = ?')
      .run(newIssued, newMatStatus, m.id)
  }

  return Math.round(lotMaterialCost * 100) / 100
}

function computeLegacyLotMaterialCost(
  effectiveTenantId: string,
  wo: any,
  existingLots: any[],
  lotTotal: number,
  isLastLot: boolean
): number {
  const preIssued = db.prepare(`
    SELECT stock_item_id, SUM(quantity) as total
    FROM stock_movements
    WHERE tenant_id = ? AND type = 'OUT' AND reference = ?
    GROUP BY stock_item_id
  `).all(effectiveTenantId, `WO: ${wo.wo_number}`) as { stock_item_id: string; total: number }[]

  let totalPreIssuedCost = 0
  for (const r of preIssued) {
    if (!(Number(r.total) > 0)) continue
    const it = db.prepare('SELECT unit_cost FROM stock_items WHERE id = ? AND tenant_id = ?').get(r.stock_item_id, effectiveTenantId) as any
    const unitCost = getCostBasis(effectiveTenantId, r.stock_item_id).weightedAvg || Number(it?.unit_cost || 0)
    totalPreIssuedCost += Number(r.total) * unitCost
  }
  totalPreIssuedCost = Math.round(totalPreIssuedCost * 100) / 100

  const alreadySettledCost = existingLots.reduce((s, l) => s + (Number(l.material_cost) || 0), 0)
  return isLastLot
    ? Math.max(0, Math.round((totalPreIssuedCost - alreadySettledCost) * 100) / 100)
    : Math.round(totalPreIssuedCost * (lotTotal / Number(wo.quantity)) * 100) / 100
}

function receiveLotFinishedGoods(
  effectiveTenantId: string,
  wo: any,
  lotNumber: string,
  goodQty: number,
  actor: TransitionActor,
  now: string
): { id: string; addQty: number } | null {
  if (goodQty <= 0) return null
  const productId = workOrderProductId(effectiveTenantId, wo)
  const finishedStock = productId
    ? db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(productId, effectiveTenantId) as any
    : null
  if (!finishedStock) return null

  const stockUnit = finishedStock.base_unit || finishedStock.unit
  const woUnit = wo.unit || stockUnit
  let addQty = Number(goodQty)
  let movementUnit: string | null = null
  let movementQuantity: number | null = null

  if (stockUnit && woUnit && normalizeUnit(woUnit) !== normalizeUnit(stockUnit)) {
    const converted = convertQuantityBidirectional(addQty, woUnit, stockUnit, effectiveTenantId, finishedStock.id)
    if (!converted) {
      throw new WorkOrderTransitionError(400, `ไม่พบการแปลงหน่วย ${woUnit} → ${stockUnit} สำหรับสินค้าสำเร็จรูป "${finishedStock.name}" กรุณาตั้งค่า Unit Conversion ก่อนบันทึกการผลิต`)
    }
    movementUnit = woUnit
    movementQuantity = addQty
    addQty = converted.converted
  }
  addQty = roundQty(addQty)

  const nextQty = roundQty(Number(finishedStock.quantity || 0) + addQty)
  db.prepare('UPDATE stock_items SET quantity = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
    .run(nextQty, now, finishedStock.id, effectiveTenantId)
  db.prepare(`
    INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, movement_unit, movement_quantity, reference, notes, created_at, created_by)
    VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?)
  `).run(generateId(), effectiveTenantId, finishedStock.id, addQty, movementUnit, movementQuantity,
    `WO: ${wo.wo_number} (${lotNumber})`, `Finished goods from production lot ${lotNumber}`, now, actor.email || 'system')

  return { id: finishedStock.id, addQty }
}

/** ทำงานภายใน db.transaction ของผู้เรียก — ใช้ร่วมระหว่าง recordWorkOrderLot และ completeAll */
function executeRecordWorkOrderLot(
  effectiveTenantId: string,
  wo: any,
  input: RecordWorkOrderLotInput,
  actor: TransitionActor,
  now: string
): { lot: RecordWorkOrderLotResult['lot']; autoCompleted: boolean; qcBlockedCompletion: string | null } {
  if (wo.status !== 'IN_PROGRESS') {
    throw new WorkOrderTransitionError(400, 'บันทึกการผลิตได้เฉพาะใบสั่งผลิตที่อยู่ในสถานะกำลังผลิต (IN_PROGRESS)')
  }

  const rawGood = Number(input.goodQty ?? 0)
  const rawScrap = Number(input.scrapQty ?? 0)
  if (!Number.isFinite(rawGood) || !Number.isFinite(rawScrap) || rawGood < 0 || rawScrap < 0) {
    throw new WorkOrderTransitionError(400, 'จำนวนของดีและของเสียต้องไม่ติดลบ')
  }
  const goodQty = roundQty(rawGood)
  const scrapQty = roundQty(rawScrap)
  const lotTotal = roundQty(goodQty + scrapQty)
  if (lotTotal <= 0) {
    throw new WorkOrderTransitionError(400, 'จำนวนของดีหรือของเสียรวมกันต้องมากกว่า 0')
  }

  const totals = lotTotals(effectiveTenantId, wo.id)
  const prevCompleted = totals.good
  const prevScrap = totals.scrap
  const prevDone = roundQty(prevCompleted + prevScrap)
  const remainingQty = totals.remaining
  if (lotTotal > remainingQty + 1e-6) {
    throw new WorkOrderTransitionError(400, `จำนวนผลิตรวมของเสีย (${lotTotal}) เกินจำนวนคงเหลือที่ต้องผลิต (${remainingQty})`)
  }

  const existingLots = db.prepare(
    'SELECT lot_number, material_cost FROM work_order_lots WHERE work_order_id = ? AND tenant_id = ? ORDER BY created_at ASC, rowid ASC'
  ).all(wo.id, effectiveTenantId) as { lot_number: string; material_cost: number }[]

  const rawLotNo = input.lotNumber != null ? String(input.lotNumber).trim() : ''
  let lotNumber = rawLotNo
  if (lotNumber) {
    if (lotNumber.length > 60) {
      throw new WorkOrderTransitionError(400, 'เลขล็อตยาวเกิน 60 ตัวอักษร')
    }
  } else {
    let k = existingLots.length + 1
    while (existingLots.some(l => l.lot_number === `${wo.wo_number}-L${String(k).padStart(2, '0')}`)) {
      k++
    }
    lotNumber = `${wo.wo_number}-L${String(k).padStart(2, '0')}`
  }

  if (existingLots.some(l => l.lot_number === lotNumber)) {
    throw new WorkOrderTransitionError(400, `เลขล็อต "${lotNumber}" ซ้ำในใบสั่งผลิตนี้`)
  }

  const isLastLot = roundQty(prevDone + lotTotal) >= roundQty(Number(wo.quantity)) - 1e-6
  const legacyPreIssued = isLegacyPreIssuedWo(effectiveTenantId, wo.wo_number)

  const lotMaterialCost = legacyPreIssued
    ? computeLegacyLotMaterialCost(effectiveTenantId, wo, existingLots, lotTotal, isLastLot)
    : deductLotMaterials(effectiveTenantId, wo, lotNumber, lotTotal, isLastLot, actor, now)

  const finished = receiveLotFinishedGoods(effectiveTenantId, wo, lotNumber, goodQty, actor, now)
  settleWorkOrderLotCost(effectiveTenantId, actor.email || 'system', { id: wo.id, wo_number: wo.wo_number }, lotNumber, lotMaterialCost, finished)

  const lotUnitCost = goodQty > 0 ? Math.round((lotMaterialCost / goodQty) * 10000) / 10000 : 0
  const lotId = generateId()
  const lotNotes = input.notes != null ? String(input.notes) : ''
  const recordedBy = actor.email || 'system'

  db.prepare(`
    INSERT INTO work_order_lots (id, tenant_id, work_order_id, lot_number, good_qty, scrap_qty, material_cost, unit_cost, notes, recorded_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(lotId, effectiveTenantId, wo.id, lotNumber, goodQty, scrapQty, lotMaterialCost, lotUnitCost, lotNotes, recordedBy, now)

  const newCompleted = roundQty(prevCompleted + goodQty)
  const newScrap = roundQty(prevScrap + scrapQty)

  let autoCompleted = false
  let qcBlockedCompletion: string | null = null
  if (isLastLot) {
    const qcResult = resolveWorkOrderCompletion(effectiveTenantId, wo.id, newCompleted)
    if (qcResult.error) {
      qcBlockedCompletion = qcResult.error
      db.prepare('UPDATE work_orders SET completed_qty = ?, scrap_qty = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(newCompleted, newScrap, now, wo.id, effectiveTenantId)
    } else {
      autoCompleted = true
      db.prepare('UPDATE work_orders SET status = ?, completed_date = ?, completed_qty = ?, scrap_qty = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run('COMPLETED', now, newCompleted, newScrap, now, wo.id, effectiveTenantId)
    }
  } else {
    db.prepare('UPDATE work_orders SET completed_qty = ?, scrap_qty = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run(newCompleted, newScrap, now, wo.id, effectiveTenantId)
  }

  const lot = db.prepare('SELECT * FROM work_order_lots WHERE id = ?').get(lotId) as RecordWorkOrderLotResult['lot']
  return { lot, autoCompleted, qcBlockedCompletion }
}

/** บันทึกการผลิตตามล็อต — ตัดวัตถุดิบตามสัดส่วน รับสินค้าสำเร็จรูป และปิดใบสั่งผลิตอัตโนมัติเมื่อครบ */
export function recordWorkOrderLot(
  tenantId: string,
  woId: string,
  input: RecordWorkOrderLotInput,
  actor: TransitionActor,
  opts?: { notify?: boolean }
): RecordWorkOrderLotResult {
  const wo = loadWorkOrderForActor(tenantId, woId, actor.isMaster)
  if (!wo) {
    throw new WorkOrderTransitionError(404, 'Work order not found')
  }
  const effectiveTenantId = (actor.isMaster && wo.tenant_id) ? wo.tenant_id : tenantId
  const now = new Date().toISOString()

  let txResult: { lot: RecordWorkOrderLotResult['lot']; autoCompleted: boolean; qcBlockedCompletion: string | null }
  const run = db.transaction(() => executeRecordWorkOrderLot(effectiveTenantId, wo, input, actor, now))
  try {
    txResult = run()
  } catch (err: any) {
    if (err instanceof WorkOrderTransitionError) throw err
    throw new WorkOrderTransitionError(400, err?.message || 'บันทึกการผลิตไม่สำเร็จ')
  }

  const workOrder = getWorkOrderDetail(effectiveTenantId, woId)
  if (txResult.autoCompleted && opts?.notify !== false && workOrder) {
    lineBotService.notifyWorkOrderStatusChanged(effectiveTenantId, workOrder).catch(e => console.error('LINE Bot status change error:', e))
  }

  return {
    lot: txResult.lot,
    workOrder,
    autoCompleted: txResult.autoCompleted,
    qcBlockedCompletion: txResult.qcBlockedCompletion,
  }
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

  const wo = loadWorkOrderForActor(tenantId, woId, actor.isMaster)
  if (!wo) {
    throw new WorkOrderTransitionError(404, 'Work order not found')
  }
  const effectiveTenantId = (actor.isMaster && wo.tenant_id) ? wo.tenant_id : tenantId

  const seqError = workOrderStatusError(wo.status, toStatus)
  if (seqError) {
    throw new WorkOrderTransitionError(400, seqError)
  }

  if ((toStatus === 'CANCELLED' || (toStatus === 'COMPLETED' && !actor.canComplete)) && !actor.isMaster && !WO_PRIVILEGED_ROLES.includes(actor.role)) {
    throw new WorkOrderTransitionError(403, `ไม่มีสิทธิ์${toStatus === 'CANCELLED' ? 'ยกเลิก' : 'ปิด'}ใบสั่งผลิต — ต้องเป็น ${WO_PRIVILEGED_ROLES.join('/')}`)
  }

  const now = new Date().toISOString()
  const materials = db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(woId) as any[]

  if (toStatus === 'IN_PROGRESS' && wo.status !== 'IN_PROGRESS') {
    assertMaterialsLinked(effectiveTenantId, materials)
    validateMaterialConversions(effectiveTenantId, materials)
    db.prepare('UPDATE work_orders SET status = ?, start_date = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run(toStatus, wo.status === 'ON_HOLD' ? (wo.start_date || now) : now, now, woId, effectiveTenantId)
  } else if (toStatus === 'COMPLETED' && wo.status !== 'COMPLETED') {
    const totals = lotTotals(effectiveTenantId, woId)
    const lotCountRow = db.prepare('SELECT COUNT(*) as c FROM work_order_lots WHERE tenant_id = ? AND work_order_id = ?')
      .get(effectiveTenantId, woId) as any
    const lotCount = Number(lotCountRow?.c) || 0

    if (opts?.completeAll && totals.remaining > 0) {
      const qcResult = resolveWorkOrderCompletion(effectiveTenantId, woId, totals.remaining)
      if (qcResult.error) {
        throw new WorkOrderTransitionError(400, qcResult.error)
      }
      const goodQty = roundQty(qcResult.completedQty)
      const scrapQty = roundQty(Math.max(0, totals.remaining - goodQty))
      const runCompleteAll = db.transaction(() => {
        executeRecordWorkOrderLot(effectiveTenantId, wo, { goodQty, scrapQty, notes: 'ผลิตครบทั้งใบสั่งผลิต' }, actor, now)
      })
      try {
        runCompleteAll()
      } catch (err: any) {
        if (err instanceof WorkOrderTransitionError) throw err
        throw new WorkOrderTransitionError(400, err?.message || 'ปิดงานผลิตไม่สำเร็จ')
      }
    } else if (totals.remaining > 0 && !opts?.closeShort) {
      throw new WorkOrderTransitionError(400, `ยังผลิตไม่ครบ (เหลือ ${totals.remaining}) — บันทึกการผลิตเป็นล็อต หรือเลือก "ปิดงานก่อนครบ"`)
    } else {
      const companySettings = db.prepare('SELECT qc_gate_enabled FROM company_settings WHERE tenant_id = ?').get(effectiveTenantId) as any
      if (Number(companySettings?.qc_gate_enabled) === 1 && (totals.good > 0 || lotCount === 0)) {
        const passCount = db.prepare("SELECT COUNT(*) as c FROM qc_inspections WHERE tenant_id = ? AND work_order_id = ? AND status = 'PASS'")
          .get(effectiveTenantId, woId) as any
        if (!passCount || passCount.c === 0) {
          throw new WorkOrderTransitionError(400, 'ต้องผ่านการตรวจ QC ก่อนปิดใบสั่งงาน')
        }
      }

      const closeTx = db.transaction(() => {
        db.prepare('UPDATE work_orders SET status = ?, completed_date = COALESCE(completed_date, ?), completed_qty = ?, scrap_qty = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(toStatus, now, totals.good, totals.scrap, now, woId, effectiveTenantId)
        if (opts?.closeShort && isLegacyPreIssuedWo(effectiveTenantId, wo.wo_number)) {
          restockCancelledWorkOrderMaterials(effectiveTenantId, actor.email || 'system', { id: woId, wo_number: wo.wo_number })
        }
      })
      try {
        closeTx()
      } catch (err: any) {
        if (err instanceof WorkOrderTransitionError) throw err
        throw new WorkOrderTransitionError(400, err?.message || 'ปิดงานผลิตไม่สำเร็จ')
      }
    }
  } else if (toStatus === 'CANCELLED') {
    if (wo.status === 'COMPLETED') {
      throw new WorkOrderTransitionError(400, 'ยกเลิกใบสั่งผลิตที่ผลิตเสร็จแล้วไม่ได้ — สินค้าสำเร็จรูปเข้าสต็อกไปแล้ว')
    }
    const cancelTransaction = db.transaction(() => {
      db.prepare('UPDATE work_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(toStatus, now, woId, effectiveTenantId)
      restockCancelledWorkOrderMaterials(effectiveTenantId, actor.email || 'system', { id: woId, wo_number: wo.wo_number })
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
