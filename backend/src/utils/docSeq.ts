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
