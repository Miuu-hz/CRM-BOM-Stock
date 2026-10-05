import { normalizeUnit } from './unitNormalize'

export interface MovementLike {
  quantity: number
  movementQuantity?: number | null
  movementUnit?: string | null
}

/**
 * ตัวช่วยจับคู่ตัวเลข-หน่วยในประวัติการเคลื่อนไหวให้ตรงกัน
 * เดิม movement.quantity (เก็บเป็นหน่วยฐานเสมอ) ถูกเอาไปคู่กับ movement.movementUnit
 * (หน่วยที่คนนับจริง เช่น ลัง/แพ็ค) ทำให้ "นับ 10 ลัง" ที่จริงคือ 1000 หน่วยฐาน
 * กลายเป็นโชว์บนจอว่า "1000 ลัง" — ผิดทั้งตัวเลขและหน่วย
 *
 * คืนตัวเลข+หน่วยหลักที่ควรโชว์เป็นบรรทัดหลัก และส่วนต่อท้าย (note) ที่บอกค่าเทียบ
 * เป็นหน่วยฐาน เฉพาะเมื่อ movementUnit ต่างจากหน่วยฐานของสินค้าจริง ๆ
 */
export function movementHistoryLine(
  m: MovementLike,
  baseUnit: string
): { qty: number; unit: string; note: { qty: number; unit: string } | null } {
  const hasNative =
    m.movementQuantity !== undefined &&
    m.movementQuantity !== null &&
    !!m.movementUnit &&
    normalizeUnit(m.movementUnit) !== normalizeUnit(baseUnit)
  if (hasNative) {
    return { qty: m.movementQuantity as number, unit: m.movementUnit as string, note: { qty: m.quantity, unit: baseUnit } }
  }
  return { qty: m.quantity, unit: baseUnit, note: null }
}
