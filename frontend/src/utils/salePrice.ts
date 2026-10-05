// stock_items.unit_price คือ "ราคาต่อหน่วยฐาน" เสมอ (เจ้าของยืนยัน 2026-10-04, Stock.tsx ป้ายไว้ตรงๆ)
// ขายเป็นหน่วยอื่น (เช่นแพ็ค) ต้องคูณด้วย factor ที่ backend บอกมา (หน่วยฐานต่อ 1 หน่วยที่เลือก)
// ไฟล์นี้ตั้งใจไม่ผูก React/axios เพื่อเทสต์ตรรกะได้โดยไม่ต้อง render หน้าหรือ mock api

/**
 * ราคาต่อหน่วยที่เลือกขาย = ราคาต่อหน่วยฐาน × factor (หน่วยฐานต่อ 1 หน่วยที่เลือก)
 * ตัวอย่าง: โค้ก base=pcs, 1 pack=6 pcs, unit_price=29/pcs → priceForSaleUnit(29, 6) = 174/pack
 *
 * factor แปลงไม่ได้ (null/0/NaN) = คงราคาต่อหน่วยฐานไว้เงียบๆ ไม่บล็อกผู้ใช้
 */
export function priceForSaleUnit(basePrice: number, factor: number | null | undefined): number {
  if (!isFinite(basePrice)) return basePrice
  if (factor == null || !isFinite(factor) || factor <= 0) return basePrice
  return basePrice * factor
}

/**
 * ใส่ราคาที่แปลงหน่วยแล้วลงแถว i — เรียกหลังผลแปลงหน่วยจาก backend กลับมา (async)
 * ต้องอ่านจากรายการ "ล่าสุด" ไม่ใช่ชุดตอนเริ่มขอ ไม่งั้นทับสินค้าที่เพิ่งเลือก/ราคาที่เพิ่งพิมพ์
 * คืน null = ไม่ต้องทำอะไร (แถวหาย, เปลี่ยนสินค้า/หน่วยไปแล้ว, หรือผู้ใช้พิมพ์ราคาเอง)
 */
export function applyRepricedRow<T extends { productId?: string; unit: string; unitPrice: number; priceEdited?: boolean }>(
  latest: T[], i: number, expect: { productId: string; unit: string }, price: number,
): T[] | null {
  const row = latest[i]
  if (!row || row.priceEdited || row.productId !== expect.productId || row.unit !== expect.unit) return null
  const next = [...latest]
  next[i] = { ...row, unitPrice: price }
  return next
}
