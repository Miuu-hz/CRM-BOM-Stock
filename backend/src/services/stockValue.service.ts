import db from '../db/sqlite'
import { convertQuantityBidirectional, normalizeUnit } from './unitConversion.service'
import { roundQty } from '../utils/qty'

// ─────────────────────────────────────────────────────────────────────────
// มูลค่าสต็อก — จุดเดียวที่คิดสูตรนี้ ห้ามก๊อปไปที่อื่น (เคยมี 5 สำเนา: /stock/stats,
// analytics/executive-summary, agent get_executive_summary, mcp get_summary,
// phopy-board outsource zone — ทุกจุด SUM(quantity * unit_cost) เฉยๆ ไม่นับของที่ยัง
// ปิดห่อ (sealed_qty) เลย ของเต็มลังวางอยู่บนชั้นไม่ถูกตีมูลค่า)
// ─────────────────────────────────────────────────────────────────────────

/** 1 display/pack unit = เท่าไหร่ base unit — null ถ้าไม่มีกฎแปลง/ไม่ใช่ของที่แพ็ค */
export function getPackFactor(item: any, tenantId: string): number | null {
  const baseUnit = item.base_unit || item.unit
  const displayUnit = item.display_unit || item.unit
  if (!baseUnit || !displayUnit) return null
  if (normalizeUnit(baseUnit) === normalizeUnit(displayUnit)) return null
  const converted = convertQuantityBidirectional(1, displayUnit, baseUnit, tenantId, item.id)
  if (!converted || !(converted.factor > 0)) return null
  return roundQty(converted.factor)
}

/** ของที่ "มีจริงพร้อมใช้" ของ item เดียว เป็น base unit = ของที่แกะแล้ว + ของที่ยังปิดห่อ */
export function availableQuantity(item: any, tenantId: string): number {
  const packFactor = getPackFactor(item, tenantId)
  return item.quantity + (packFactor ? (item.sealed_qty || 0) * packFactor : 0)
}

/**
 * มูลค่าสต็อกทั้งหมดของ tenant (available quantity × unit_cost ต่อ base unit)
 * ใช้ตัวนี้ทุกที่ที่ต้องโชว์ "มูลค่าสต็อก" รวม — /stock/stats, analytics, mcp summary,
 * phopy-board ล้วนเรียกฟังก์ชันนี้ ไม่มีสูตรซ้ำ
 */
export function totalStockValue(tenantId: string): number {
  const items = db.prepare('SELECT * FROM stock_items WHERE tenant_id = ?').all(tenantId) as any[]
  let total = 0
  for (const item of items) {
    total += availableQuantity(item, tenantId) * Number(item.unit_cost || 0)
  }
  return total
}
