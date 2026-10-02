// การคิด VAT ของทุกเอกสารในระบบ — ที่เดียวของความจริง
// ⚠️ มีฝาแฝดที่ frontend/src/utils/vat.ts แก้ที่ไหนต้องแก้อีกที่ให้เหมือนกัน
//
// เดิมสูตรนี้ถูกก๊อปไว้ 16 จุด (ขาย 5 / ซื้อ 6 / POS 1 / MCP 2 / อื่น 2) และคิดไม่เหมือนกัน
// ฝั่งขายหักส่วนลดก่อนคิดภาษี ฝั่งซื้อไม่หัก มี taxRate = 7 ฝังตาย 5 จุด
//
// หลักที่ยึด (ประมวลรัษฎากร ม.79): ฐานภาษี = ทุกอย่างที่เรียกเก็บจากลูกค้า
// (สินค้า + ค่าบริการ + ค่าขนส่ง) หักส่วนลดที่ให้ขณะขาย แล้วจึงคิดภาษี

export interface VatConfig {
  /** อัตราภาษี % — 0 หรือ vatEnabled = false คือไม่คิดภาษี */
  rate: number
  /**
   * ปัดภาษีเป็นบาทเต็มหรือทศนิยม 2 ตำแหน่ง
   * 'baht'   = เครื่องคิดเงินหน้าร้าน ไม่ทอนสตางค์ (พฤติกรรมเดิมของ POS)
   * 'satang' = เอกสารทั่วไป (ค่าตั้งต้น — สูตรเดิมไม่ปัดเลย ทำให้มีเศษ float ติดมา เช่น 6.230000000000001)
   */
  roundTax?: 'baht' | 'satang'
  /** true = ราคาที่กรอกรวม VAT แล้ว (ถอดออกมาเป็นฐาน) / false = บวกเพิ่ม */
  inclusive?: boolean
  /** ส่วนลดท้ายบิลเป็นบาท — ลดฐานภาษี */
  discountAmount?: number
  /** ค่าบริการ % ของยอดสินค้า (ร้านอาหาร) */
  serviceRate?: number
  /** ค่าขนส่ง/ค่าบริการอื่นเป็นบาท — เพิ่มฐานภาษี */
  extraCharge?: number
}

export interface VatTotals {
  /** ยอดสินค้าก่อนภาษีเสมอ ทั้งสองโหมด — journal ใช้ค่านี้เป็นรายได้/ต้นทุนตรง ๆ */
  subtotal: number
  serviceChargeAmount: number
  extraCharge: number
  discount: number
  taxAmount: number
  totalAmount: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** ยอดรวมรายการตามราคาที่กรอก (หักส่วนลดรายบรรทัดแล้ว) */
export function sumLines(lines: { quantity: number; unitPrice: number; discountPercent?: number }[]): number {
  return lines.reduce((s, l) => s + l.quantity * l.unitPrice * (1 - (l.discountPercent || 0) / 100), 0)
}

/**
 * รับยอดรวมรายการ คืนยอดที่ลงเอกสาร
 *
 * รับประกัน: subtotal + ค่าบริการ + ค่าขนส่ง − ส่วนลด + ภาษี === total เสมอ
 * — journal ลง Dr ด้วย total และ Cr รายได้ด้วยส่วนที่เหลือ ถ้าบวกไม่ลงตัวงบจะไม่บาลานซ์
 */
export function calcVat(lineTotal: number, cfg: VatConfig): VatTotals {
  const rate = cfg.rate || 0
  const service = cfg.serviceRate ? Math.round(lineTotal * cfg.serviceRate / 100) : 0
  const extraCharge = cfg.extraCharge || 0
  const discount = Math.min(cfg.discountAmount || 0, lineTotal + service + extraCharge)

  const base = lineTotal + service + extraCharge - discount
  const round = cfg.roundTax === 'baht' ? Math.round : r2
  const taxAmount = rate
    ? round(cfg.inclusive ? base * rate / (100 + rate) : base * rate / 100)
    : 0

  if (!cfg.inclusive) {
    return { subtotal: lineTotal, serviceChargeAmount: service, extraCharge, discount, taxAmount, totalAmount: r2(base + taxAmount) }
  }
  // โหมดรวม VAT: ลูกค้าจ่ายเท่าราคาป้าย ภาษีถูกถอดออกจากยอดนั้น ไม่ได้บวกเพิ่ม
  // ถอดออกจาก subtotal ที่เดียว เพื่อให้บวกกลับได้ total เป๊ะ ไม่มีเศษหลุด
  // ponytail: ถ้าค่าขนส่งใหญ่กว่ายอดสินค้ามาก ๆ subtotal อาจติดลบ — ไม่เกิดในการใช้งานจริง
  return { subtotal: r2(lineTotal - taxAmount), serviceChargeAmount: service, extraCharge, discount, taxAmount, totalAmount: base }
}

/** คิดจากรายการตรง ๆ — ทางลัดที่เอกสารส่วนใหญ่ใช้ */
export function calcDocTotals(
  lines: { quantity: number; unitPrice: number; discountPercent?: number }[],
  cfg: VatConfig,
): VatTotals {
  return calcVat(sumLines(lines), cfg)
}

// ── โหมด VAT ระดับเอกสาร (2026-09-29) ─────────────────────────────────────────
// ทุกเอกสารเลือกโหมดเดียวที่หัวเอกสาร: NONE | INCLUSIVE | EXCLUSIVE
// เก็บลง field เดิม (tax_rate + vat_inclusive) เพื่อไม่ต้อง migrate schema
// ⚠️ ต้องตรงกับ frontend/src/utils/vat.ts (ฝั่ง frontend มีชุดนี้อยู่แล้ว — ห้ามแก้ค่าที่นี่ให้เพี้ยนไปจากกัน)
export const VAT_RATE = 7
export type VatMode = 'NONE' | 'INCLUSIVE' | 'EXCLUSIVE'

/** อ่านโหมดจาก field ที่เก็บจริง — ใช้ ?? เสมอ ห้าม || (0 ต้องเป็น NONE ไม่ใช่ถูกแทนด้วย 7) */
export function vatModeOf(rate: number | undefined | null, inclusive: boolean | undefined | null): VatMode {
  return (rate ?? 0) <= 0 ? 'NONE' : inclusive ? 'INCLUSIVE' : 'EXCLUSIVE'
}

/** แปลงโหมดกลับเป็น field ที่เอกสารส่งจริง */
export function vatModeToFields(mode: VatMode): { rate: number; inclusive: boolean } {
  if (mode === 'NONE') return { rate: 0, inclusive: false }
  if (mode === 'INCLUSIVE') return { rate: VAT_RATE, inclusive: true }
  return { rate: VAT_RATE, inclusive: false }
}

/**
 * ทำ tax_rate/vat_inclusive ดิบให้เข้ารูปโหมดที่ระบบรู้จักเสมอ (rate<=0 หรือไม่มีค่า → NONE,
 * rate>0 → ปัดเป็น VAT_RATE คงที่ ตาม inclusive ที่ระบุ) — ใช้ก่อนจะ "จำ" โหมดของคู่ค้าไว้
 * ป้องกันไม่ให้ค่าประหลาด (เช่น rate=15 จากเอกสารเก่า) เพี้ยนเข้าไปเป็นโหมดที่ไม่มีจริง
 */
export function normalizeVatFields(
  rate: number | undefined | null,
  inclusive: boolean | number | undefined | null
): { rate: number; inclusive: boolean } {
  return vatModeToFields(vatModeOf(rate, !!inclusive))
}
