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
// ชื่อรอง (alias) — "ยี่ห้อ B ใช้แทน SKU ยี่ห้อ A" ฝั่งซื้อเท่านั้น
//
// จำตอนยืนยันใบรับของ (คนเห็นของจริงแล้ว) ครั้งหน้าที่ซื้อชื่อเดิมเป๊ะ PR/PO ผูกให้เอง
// กฎ 1 ชื่อ = 1 ที่: ชื่อรองต้องไม่ซ้ำกับชื่อสินค้าหลักที่ยังใช้งาน และไม่ซ้ำกันเอง (UNIQUE)
// ชื่อสินค้าหลักที่ตรงเป๊ะชนะชื่อรองเสมอ → เปิด SKU ใหม่ชื่อเดียวกันเมื่อไร ความจำเลิกมีผลเอง
// ไม่ใช้ฝั่งขาย: ใบกำกับภาษีขายต้องตรงของจริง
// ============================================================

/** ตรงเป๊ะหลังตัดช่องว่าง/ตัวพิมพ์ — ตัวเดียวกับที่ matchStockItem ใช้ */
export const normName = (s: string) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

/** INACTIVE = ปิดใช้ · ACTIVE/OUT/LOW/ADEQUATE เป็นสถานะระดับสต็อก ยังใช้งานได้ */
const LIVE = "status != 'INACTIVE'"

function liveItemsNamed(tenantId: string, name: string) {
  return db.prepare(`SELECT id, name FROM stock_items WHERE tenant_id = ? AND ${LIVE} AND LOWER(TRIM(name)) = ?`)
    .all(tenantId, normName(name)) as Array<{ id: string; name: string }>
}

/** ชื่อรองที่ยังใช้ได้ → สินค้าหลัก + เอกสารที่ยืนยันครั้งแรก · ไม่มี/ถูกชื่อหลักทับ/ปลายทางปิดใช้ = null */
export function findAliasTarget(tenantId: string, name: string): { stockItemId: string; sourceRef: string | null } | null {
  const key = normName(name)
  if (!key || liveItemsNamed(tenantId, name).length > 0) return null
  const row = db.prepare(`
    SELECT a.stock_item_id, a.source_ref FROM stock_item_aliases a
    JOIN stock_items s ON s.id = a.stock_item_id AND s.tenant_id = a.tenant_id AND s.${LIVE}
    WHERE a.tenant_id = ? AND a.name_norm = ?
  `).get(tenantId, key) as any
  return row ? { stockItemId: row.stock_item_id, sourceRef: row.source_ref } : null
}

/**
 * จำ/ทับชื่อรองตอนยืนยันใบรับของ · คืน true ถ้าจำ
 * ไม่จำเมื่อ: ชื่อตรงกับชื่อสินค้าที่ผูกอยู่แล้ว (ไม่ใช่ชื่อรอง) หรือชนชื่อสินค้าหลักตัวอื่น (1 ชื่อ = 1 ที่)
 */
export function rememberAlias(tenantId: string, name: string, stockItemId: string, sourceRef: string, userId: string): boolean {
  const key = normName(name)
  if (!key || liveItemsNamed(tenantId, name).length > 0) return false
  const target = db.prepare('SELECT name FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
  if (!target || normName(target.name) === key) return false
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO stock_item_aliases (id, tenant_id, name_norm, name, stock_item_id, source_ref, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, name_norm) DO UPDATE SET
      name = excluded.name, stock_item_id = excluded.stock_item_id, source_ref = excluded.source_ref,
      created_by = excluded.created_by, updated_at = excluded.updated_at
  `).run(randomUUID().replace(/-/g, '').slice(0, 25), tenantId, key, name.trim(), stockItemId, sourceRef, userId, now, now)
  return true
}

/**
 * ก่อนสร้างสินค้าหลักใหม่: ชื่อนี้เป็นชื่อรองของสินค้าอื่นอยู่ไหม → ข้อความเตือนให้เลือก
 * ผู้ใช้เลือก "สร้างใหม่" (aliasOverride) → dropAlias ตามหลังสร้าง
 */
export function aliasConflictMessage(tenantId: string, name: string): string | null {
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
