import db from '../db/sqlite'
import { randomUUID } from 'crypto'

// ============================================================
// รายการที่ "ขายได้แต่ไม่มีของ" — ค่าขนส่ง / ค่าแพ็ค / ค่าบริการ
//
// ระบบเก่าตั้งของพวกนี้เป็นสินค้าเพราะออกบิลไม่ได้ไม่งั้น พอมาอยู่ใน ERP ที่ตัด
// สต็อกจริง มันจะทำให้ยืนยันบิลไม่ผ่าน ("Insufficient stock") เพราะไม่มีวันมีของ
// ในคลัง — กันด้วยการติดหมวด SERVICE แล้วให้ทุกจุดที่ตัด/คืนสต็อกข้ามไป
//
// เก็บเป็น stock_items ต่อ (ไม่ใช่ free text ในบรรทัดบิล) เพื่อให้ยังมีรหัส
// เลือกจากรายการได้ และแยกรายงานรายได้ค่าขนส่งออกจากรายได้ขายสินค้าได้
// ============================================================

export const SERVICE_CATEGORY = 'SERVICE'

/** true = รายการบริการ ไม่ต้องตัด/คืนสต็อก */
export function isServiceItem(stockItem: { category?: string | null } | null | undefined): boolean {
  return String(stockItem?.category ?? '').trim().toUpperCase() === SERVICE_CATEGORY
}

// หมวดที่ขายออกได้ — วัตถุดิบ (raw) ขายไม่ได้ทุกช่องทาง (ใบขาย / เมนู POS / MCP)
// เจ้าของยืนยัน 2026-10-04: ไม่มีร้านไหนตั้งใจขายวัตถุดิบ
export const SELLABLE_CATEGORIES = ['FINISHED', 'WIP', SERVICE_CATEGORY]

/** true = ขายได้ (สินค้าสำเร็จรูป / กึ่งสำเร็จรูป / บริการ) */
export function isSellableItem(stockItem: { category?: string | null } | null | undefined): boolean {
  return SELLABLE_CATEGORIES.includes(String(stockItem?.category ?? '').trim().toUpperCase())
}

/** อ้างถึงสินค้าที่ไม่มีอยู่ในเทแนนต์นี้ — ผู้เรียกแปลงเป็น 400 พร้อมข้อความนี้ */
export class StockItemRefError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StockItemRefError'
  }
}

/**
 * id สินค้า (`stock_items.id`) ที่มาจากฟอร์ม/MCP — ต้องเป็นของเทแนนต์นี้เท่านั้น
 * ในเอกสารซื้อ/ผลิตคีย์ยังชื่อ `materialId` (ชื่อเก่าก่อนยุบ materials เข้า stock_items 2026-09-16)
 * เดิมบางจุดเช็คแค่ `WHERE id = ?` หรือไม่เช็คเลย → id ของบริษัทอื่นเข้าไปอยู่ในเอกสารได้
 * '' / ช่องว่าง = ไม่ได้เลือกสินค้า → null
 */
export function resolveStockItemId(tenantId: string, stockItemId: unknown, label?: string): string | null {
  const id = typeof stockItemId === 'string' ? stockItemId.trim() : stockItemId
  if (!id) return null
  if (!db.prepare('SELECT 1 FROM stock_items WHERE id = ? AND tenant_id = ?').get(id, tenantId)) {
    throw new StockItemRefError(`ไม่พบสินค้าในคลังของรายการ "${label || id}" — เลือกสินค้าใหม่อีกครั้ง`)
  }
  return id as string
}

// ============================================================
// ชื่อรอง / ชื่อเรียกแทน SKU — "ยี่ห้อ B ใช้แทน SKU ยี่ห้อ A" ใช้ได้ทั้งฝั่งซื้อและฝั่งขาย
//
// จำตอนยืนยันเอกสารที่ของเข้า/ออกจริง (ยืนยันใบรับของ / ยืนยันใบสั่งขาย) หรือเพิ่มเองที่หน้าสต็อก
// ครั้งหน้าใช้ชื่อเดิมเป๊ะ PR/PO/ใบขาย/MCP ผูกให้เอง
// กฎ 1 ชื่อ = 1 ที่: ชื่อรองต้องไม่ซ้ำกับชื่อสินค้าหลักที่ยังใช้งาน และไม่ซ้ำกันเอง (UNIQUE)
// ชื่อสินค้าหลักที่ตรงเป๊ะชนะชื่อรองเสมอ → เปิด SKU ใหม่ชื่อเดียวกันเมื่อไร ความจำเลิกมีผลเอง
//
// ผูกหน่วยได้ (unit + factor): "น้ำดื่มสิงห์" 1 แพ็ค = 15 ขวด · "น้ำดื่มทั่วไป" 1 แพ็ค = 12 ขวด
// ทั้งคู่ชี้ SKU "น้ำดื่ม" (หน่วยฐาน ขวด) — ใช้ตอนแปลงหน่วยเมื่อบรรทัดเอกสารใช้ชื่อนี้
// (convertQuantityBidirectional รับ lineName) · ฝั่งขายระบบไม่รู้ว่าของที่ออกไปจริงเป็นยี่ห้อไหน
// แค่จดชื่อที่ใช้ไว้ในบรรทัดเอกสาร + stock log (ต้นทุนยังเป็นถัวเฉลี่ยของ SKU ตามเดิม)
//
// ปิดได้ทั้งบริษัทที่ ตั้งค่า (company_settings.stock_alias_enabled = 0) → ทุกฟังก์ชันชุดนี้
// ทำตัวเหมือนไม่มีชื่อรอง (ผูกได้เฉพาะชื่อ SKU ตรงเป๊ะ) ข้อมูลเดิมไม่ลบ เปิดกลับมาก็ใช้ต่อได้
// ============================================================

/** ตรงเป๊ะหลังตัดช่องว่าง/ตัวพิมพ์ — ตัวเดียวกับที่ matchStockItem ใช้ */
export const normName = (s: string) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

/** เปิดใช้ชื่อเรียกแทน SKU ไหม — ไม่มีแถว/ยังไม่ตั้ง = เปิด (พฤติกรรมเดิมฝั่งซื้อ) */
export function aliasEnabled(tenantId: string): boolean {
  const row = db.prepare('SELECT stock_alias_enabled FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
  return row?.stock_alias_enabled !== 0
}

/** INACTIVE = ปิดใช้ · ACTIVE/OUT/LOW/ADEQUATE เป็นสถานะระดับสต็อก ยังใช้งานได้ */
const LIVE = "status != 'INACTIVE'"

function liveItemsNamed(tenantId: string, name: string) {
  return db.prepare(`SELECT id, name FROM stock_items WHERE tenant_id = ? AND ${LIVE} AND LOWER(TRIM(name)) = ?`)
    .all(tenantId, normName(name)) as Array<{ id: string; name: string }>
}

export interface AliasTarget {
  stockItemId: string
  sourceRef: string | null
  /** หน่วยที่ผูกกับชื่อนี้ (code normalize แล้ว) — null = ใช้กฎแปลงหน่วยของสินค้าตามปกติ */
  unit: string | null
  /** จำนวนหน่วยฐานต่อ 1 unit ของชื่อนี้ */
  factor: number | null
}

/** ชื่อรองที่ยังใช้ได้ → สินค้าหลัก · ปิดฟีเจอร์/ไม่มี/ถูกชื่อหลักทับ/ปลายทางปิดใช้ = null */
export function findAliasTarget(tenantId: string, name: string): AliasTarget | null {
  const key = normName(name)
  if (!key || !aliasEnabled(tenantId) || liveItemsNamed(tenantId, name).length > 0) return null
  const row = db.prepare(`
    SELECT a.stock_item_id, a.source_ref, a.unit, a.factor FROM stock_item_aliases a
    JOIN stock_items s ON s.id = a.stock_item_id AND s.tenant_id = a.tenant_id AND s.${LIVE}
    WHERE a.tenant_id = ? AND a.name_norm = ?
  `).get(tenantId, key) as any
  if (!row) return null
  const factor = Number(row.factor)
  const bound = !!row.unit && factor > 0
  return { stockItemId: row.stock_item_id, sourceRef: row.source_ref, unit: bound ? row.unit : null, factor: bound ? factor : null }
}

/**
 * จำ/ทับชื่อรองตอนยืนยันใบรับของ/ใบสั่งขาย · คืน true ถ้าจำ
 * ไม่จำเมื่อ: ปิดฟีเจอร์ · ชื่อตรงกับชื่อสินค้าที่ผูกอยู่แล้ว · ชนชื่อสินค้าหลักตัวอื่น (1 ชื่อ = 1 ที่)
 * ย้ายไปชี้ SKU อื่น → ทิ้งหน่วยที่ผูกไว้ (ตัวคูณของ SKU เดิมใช้กับ SKU ใหม่ไม่ได้)
 */
export function rememberAlias(tenantId: string, name: string, stockItemId: string, sourceRef: string, userId: string): boolean {
  const key = normName(name)
  if (!key || !aliasEnabled(tenantId) || liveItemsNamed(tenantId, name).length > 0) return false
  const target = db.prepare('SELECT name FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
  if (!target || normName(target.name) === key) return false
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO stock_item_aliases (id, tenant_id, name_norm, name, stock_item_id, source_ref, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, name_norm) DO UPDATE SET
      unit = CASE WHEN stock_item_id = excluded.stock_item_id THEN unit ELSE NULL END,
      factor = CASE WHEN stock_item_id = excluded.stock_item_id THEN factor ELSE NULL END,
      name = excluded.name, stock_item_id = excluded.stock_item_id, source_ref = excluded.source_ref,
      created_by = excluded.created_by, updated_at = excluded.updated_at
  `).run(randomUUID().replace(/-/g, '').slice(0, 25), tenantId, key, name.trim(), stockItemId, sourceRef, userId, now, now)
  return true
}

/**
 * เพิ่ม/แก้ชื่อรองเองจากหน้าสต็อก พร้อมผูกหน่วย (ไม่บังคับ) · unit ต้อง normalize มาแล้ว (ผู้เรียกทำ)
 * ผิดกติกา → StockItemRefError ข้อความไทย ผู้เรียกแปลงเป็น 400
 */
export function saveAlias(
  tenantId: string,
  input: { name: string; stockItemId: string; unit?: string | null; factor?: number | null },
  userId: string,
): void {
  if (!aliasEnabled(tenantId)) throw new StockItemRefError('ปิดใช้ "ชื่อเรียกแทน SKU" อยู่ — เปิดได้ที่ ตั้งค่า')
  const name = String(input.name || '').trim()
  const key = normName(name)
  if (!key) throw new StockItemRefError('กรุณาระบุชื่อเรียกแทน')
  const target = db.prepare(`SELECT name, COALESCE(NULLIF(base_unit, ''), unit) AS base FROM stock_items WHERE id = ? AND tenant_id = ? AND ${LIVE}`)
    .get(input.stockItemId, tenantId) as any
  if (!target) throw new StockItemRefError('ไม่พบสินค้าในคลัง')
  if (normName(target.name) === key || liveItemsNamed(tenantId, name).length > 0) {
    throw new StockItemRefError(`"${name}" เป็นชื่อสินค้าหลักอยู่แล้ว ใช้เป็นชื่อเรียกแทนไม่ได้`)
  }
  // ผูกกับหน่วยฐานเอง = ไม่มีอะไรต้องแปลง → เก็บเป็นไม่ผูกหน่วย
  const unit = input.unit && input.unit !== target.base ? String(input.unit) : null
  const factor = unit ? Number(input.factor) : null
  if (unit && !(Number.isFinite(factor) && factor! > 0)) {
    throw new StockItemRefError(`ระบุจำนวน ${target.base} ต่อ 1 ${unit} (ต้องมากกว่า 0)`)
  }
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO stock_item_aliases (id, tenant_id, name_norm, name, stock_item_id, source_ref, unit, factor, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, name_norm) DO UPDATE SET
      name = excluded.name, stock_item_id = excluded.stock_item_id, unit = excluded.unit, factor = excluded.factor,
      created_by = excluded.created_by, updated_at = excluded.updated_at
  `).run(randomUUID().replace(/-/g, '').slice(0, 25), tenantId, key, name, input.stockItemId, unit, factor, userId, now, now)
}

/** ชื่อรองทั้งหมด (หรือเฉพาะของสินค้าตัวเดียว) — ปลายทางที่ปิดใช้ไม่เอา · ปิดฟีเจอร์ = ว่าง */
export function listAliases(tenantId: string, stockItemId?: string): any[] {
  if (!aliasEnabled(tenantId)) return []
  const params = stockItemId ? [tenantId, stockItemId] : [tenantId]
  return db.prepare(`
    SELECT a.id, a.name, a.stock_item_id, a.unit, a.factor, a.source_ref,
           s.name AS stock_item_name, s.sku, COALESCE(NULLIF(s.base_unit, ''), s.unit) AS base_unit, s.unit_price, s.category
    FROM stock_item_aliases a
    JOIN stock_items s ON s.id = a.stock_item_id AND s.tenant_id = a.tenant_id AND s.${LIVE}
    WHERE a.tenant_id = ? ${stockItemId ? 'AND a.stock_item_id = ?' : ''}
    ORDER BY a.name
  `).all(...params)
}

export function deleteAliasById(tenantId: string, id: string): boolean {
  return db.prepare('DELETE FROM stock_item_aliases WHERE id = ? AND tenant_id = ?').run(id, tenantId).changes > 0
}

/**
 * ก่อนสร้างสินค้าหลักใหม่: ชื่อนี้เป็นชื่อรองของสินค้าอื่นอยู่ไหม → ข้อความเตือนให้เลือก
 * ผู้ใช้เลือก "สร้างใหม่" (aliasOverride) → dropAlias ตามหลังสร้าง · ปิดฟีเจอร์ = ไม่เตือน
 */
export function aliasConflictMessage(tenantId: string, name: string): string | null {
  if (!aliasEnabled(tenantId)) return null
  const row = db.prepare(`
    SELECT a.source_ref, s.name AS target FROM stock_item_aliases a
    JOIN stock_items s ON s.id = a.stock_item_id AND s.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.name_norm = ?
  `).get(tenantId, normName(name)) as any
  if (!row) return null
  return `"${name.trim()}" ถูกใช้เป็นชื่อรองของ "${row.target}" อยู่ (ยืนยันครั้งแรกใน ${row.source_ref || '-'}) — ` +
    `กด OK = สร้างเป็นสินค้าใหม่แยก (ซื้อชื่อนี้ครั้งหน้าจะเข้าสินค้าใหม่) · กด Cancel = ใช้เป็นชื่อรองของ "${row.target}" ต่อ`
}

export function dropAlias(tenantId: string, name: string): void {
  db.prepare('DELETE FROM stock_item_aliases WHERE tenant_id = ? AND name_norm = ?').run(tenantId, normName(name))
}
