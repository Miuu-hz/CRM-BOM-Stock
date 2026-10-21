/**
 * ดึง "เลขลำดับ" ออกจากเลขที่เอกสาร ใช้ตอน seed ตัวนับ document_sequences
 *
 *   PO-2026-00041   (แบบเดิม  P-ปี-ลำดับ)        → 41
 *   GR-037-180926   (ตั้งค่า  P-ลำดับ-วันที่)     → 37
 *   WO-00008 · JV-BF-0010                       → 8 · 10
 *
 * เดิมเอา "ท่อนสุดท้าย" เสมอ พอเปิดรูปแบบ P-ลำดับ-DDMMYY ท่อนสุดท้ายคือวันที่
 * ตัวนับเลยกระโดดเป็น 180926 ทุกครั้งที่ restart (GR-180927-180926, POS-190930-280926)
 *
 * ponytail: เดาจากรูปทรง ไม่อ่านค่าตั้งรูปแบบ เพราะเอกสารเก่าหลายรูปแบบปนกันและผู้ใช้เปลี่ยนรูปแบบได้
 * เพดาน: ลำดับที่ตรงกับปี 1900-2199 ในรูปแบบใหม่จะถูกอ่านเป็นปี · ค่า >= MAX_DOC_SEQ ถือว่าไม่ใช่ลำดับ
 * (วันที่/timestamp จากบั๊กเดิม) — ถ้าวันไหนเอกสารชนิดเดียวเกินแสนใบ ค่อยย้ายไปอ่านจากค่าตั้งรูปแบบ
 */
export const MAX_DOC_SEQ = 100000

export function docSeqOf(docNumber: unknown): number | null {
  const digits = String(docNumber ?? '').split('-').filter(s => /^\d+$/.test(s))
  if (digits.length === 0) return null
  const pick = digits.length >= 2 && /^(19|20|21)\d\d$/.test(digits[0]) ? digits[1] : digits[0]
  const n = parseInt(pick, 10)
  return n > 0 && n < MAX_DOC_SEQ ? n : null
}

/**
 * ถังตัวนับ (document_sequences.year) ของเลขแบบตั้งค่า — ถังใหม่ = เลขเริ่ม 001 ใหม่
 *   YEAR → 2026 · MONTH → 202610 · DAY → 20261016
 * reset ได้ละเอียดแค่ที่วันที่ในเลขแยกได้ ไม่งั้นเลขชนกัน (MMYY + DAY → POS-001-1026 ซ้ำทุกวัน)
 * จึงถอยเป็นช่วงที่ใหญ่ขึ้นเอง
 */
export function seqBucket(resetPeriod: string | null | undefined, dateFormat: string, d: Date): number {
  const y = d.getFullYear(), m = d.getMonth() + 1
  const hasDay = dateFormat === 'DDMMYY' || dateFormat === 'YYMMDD'
  if (resetPeriod === 'DAY' && hasDay) return y * 10000 + m * 100 + d.getDate()
  if ((resetPeriod === 'MONTH' || resetPeriod === 'DAY') && (hasDay || dateFormat === 'MMYY')) return y * 100 + m
  return y
}

/** docType → ตารางที่เก็บเลขเอกสารนั้น (ใช้ seed ตัวนับตอน migrate และเช็คเลขซ้ำก่อนออกเลขแบบตั้งค่า) */
export const DOC_NUMBER_TABLES: [string, string][] = [
  ['QUOTATION', 'quotations'],
  ['SALES_ORDER', 'sales_orders'],
  ['DELIVERY_ORDER', 'delivery_orders'],
  ['INVOICE', 'invoices'],
  ['CREDIT_NOTE', 'credit_notes'],
  ['RECEIPT', 'receipts'],
  ['BACKORDER', 'backorders'],
  ['PURCHASE_REQUEST', 'purchase_requests'],
  ['PO', 'purchase_orders'],
  ['GOODS_RECEIPT', 'goods_receipts'],
  ['PURCHASE_INVOICE', 'purchase_invoices'],
  ['SUPPLIER_PAYMENT', 'supplier_payments'],
  ['PURCHASE_RETURN', 'purchase_returns'],
  ['WORK_ORDER', 'work_orders'],
  ['ORDER', 'orders'],
  ['POS_BILL', 'pos_running_bills'],
  ['POS_DAILY_SALES', 'pos_daily_sales'],
  ['POS_SHIFT', 'pos_shifts'],
  ['JOURNAL', 'journal_entries'],
  ['APPROVAL_REQUEST', 'approval_requests'],
  ['STOCK_ADJUSTMENT', 'stock_adjustments'],
  ['SUBCONTRACT', 'wo_subcontracts'],
  ['SUBCON_ISSUE', 'subcon_material_issues'],
  ['SUBCON_RECEIPT', 'subcon_receipts'],
]
