// การคิด VAT ของทุกเอกสารในระบบ — ที่เดียวของความจริง
// ⚠️ มีฝาแฝดที่ backend/src/utils/vat.ts แก้ที่ไหนต้องแก้อีกที่ให้เหมือนกัน
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
export const VAT_RATE = 7
export type VatMode = 'NONE' | 'INCLUSIVE' | 'EXCLUSIVE'

export const VAT_MODE_LABEL: Record<VatMode, string> = {
  NONE: 'ไม่มี VAT',
  INCLUSIVE: 'ราคารวม VAT แล้ว',
  EXCLUSIVE: 'บวก VAT เพิ่ม',
}
export const VAT_MODE_LABEL_SHORT: Record<VatMode, string> = {
  NONE: 'ไม่มี',
  INCLUSIVE: 'รวมแล้ว',
  EXCLUSIVE: 'บวกเพิ่ม',
}

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
 * โหมดเริ่มต้นของเอกสารใหม่ ตามฝั่ง (ขาย/ซื้อ), การจด VAT ของร้าน, และโหมดล่าสุดของคู่ค้ารายนี้
 *
 * ร้านยังไม่จด VAT:
 * - ฝั่งขาย: ล็อก NONE เสมอ — เก็บ VAT จากลูกค้าไม่ได้ตามกฎหมายถ้าไม่ได้จดทะเบียน
 * - ฝั่งซื้อ: ไม่ล็อก เลือกได้ทั้ง 3 โหมด (ผู้ขายอาจจด VAT แล้วเก็บเรามาก็ได้) —
 *   แต่ VAT ที่จ่ายไปกลายเป็นต้นทุนที่ขอคืนไม่ได้ (ร้านไม่มีภาษีซื้อให้หักกลบ)
 *
 * ร้านจด VAT แล้ว: ใช้โหมดล่าสุดของคู่ค้าถ้ามี ไม่งั้น ซื้อ=NONE, ขาย=EXCLUSIVE
 * (ผู้ขายที่จด VAT ต้องเรียกเก็บ VAT เสมอ — ไม่ default เป็น NONE)
 */
export function defaultVatMode({ side, registered, contactMode }: {
  side: 'sale' | 'purchase'
  registered: boolean
  contactMode?: VatMode | null
}): { mode: VatMode; locked?: { reason: string }; hint?: string } {
  if (!registered && side === 'sale') {
    return { mode: 'NONE', locked: { reason: 'ร้านยังไม่จดทะเบียน VAT — ออกบิลมี VAT ไม่ได้' } }
  }
  if (!registered) {
    // ponytail: ไม่ล็อก แต่เตือนว่า VAT ที่จ่ายไปขอคืนไม่ได้ — อัปเกรดเป็นบล็อกจริงถ้ามีเคสฟ้องภาษีซ้อน
    return { mode: contactMode || 'NONE', hint: 'ร้านยังไม่จด VAT — VAT ที่จ่ายจะรวมเป็นต้นทุน (ขอคืนไม่ได้)' }
  }
  const mode = contactMode || (side === 'purchase' ? 'NONE' : 'EXCLUSIVE')
  const hint = contactMode
    ? (side === 'sale' ? 'ตามที่ใช้ครั้งก่อนกับลูกค้ารายนี้' : 'ตามที่ใช้ครั้งก่อนกับผู้ขายรายนี้')
    : undefined
  return { mode, hint }
}

/** คำเตือนแบบไม่บล็อก คำนวณจากโหมดที่เลือก "อยู่ตอนนี้" — เรียกทุก render ไม่ใช่แค่ตอน default */
export function vatModeWarning(mode: VatMode, opts: {
  side: 'sale' | 'purchase'; registered: boolean; contactMode?: VatMode | null
}): string | undefined {
  if (opts.side === 'sale' && opts.registered && mode === 'NONE') {
    return 'ขายแบบไม่มี VAT ใช้ได้เฉพาะสินค้ายกเว้น VAT'
  }
  if (opts.contactMode && opts.contactMode !== mode) {
    return `ครั้งก่อนใช้ "${VAT_MODE_LABEL[opts.contactMode]}" กับรายนี้`
  }
  return undefined
}

/**
 * เติมราคาต่อหน่วยจากต้นทุนที่จำไว้ (mat.unitCost) ให้ตรงกับโหมด VAT ของเอกสาร
 *
 * กฎจากฝั่ง backend: ต้นทุนที่จำไว้ = ไม่รวม VAT ถ้าร้านจด VAT, รวม VAT แล้วถ้าร้านไม่จด VAT
 * ถ้าโหมดเอกสารตรงกับฐานของต้นทุนที่จำไว้อยู่แล้ว ใช้ตรง ๆ ไม่ต้องแปลง
 * ถ้าไม่ตรง ต้องแปลงครั้งเดียวที่นี่ ไม่งั้นราคาจะโดน VAT ซ้อน (7%+7%)
 */
export function prefillUnitPriceFromCost(cost: number, mode: VatMode, registered: boolean): number {
  if (registered && mode === 'INCLUSIVE') return Math.round(cost * (1 + VAT_RATE / 100) * 100) / 100
  if (!registered && mode === 'EXCLUSIVE') return Math.round(cost / (1 + VAT_RATE / 100) * 100) / 100
  return cost
}
