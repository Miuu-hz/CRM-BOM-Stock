import db from '../db/sqlite'

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
