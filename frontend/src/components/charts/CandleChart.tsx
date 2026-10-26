// แท่งเทียนรายรับ / รายจ่าย + เส้นเงินคงเหลือ 3 แผง แกนเวลาเดียวกัน — ใช้ทั้ง Dashboard (รายสัปดาห์) และ Phopy Board (เดือน/ไตรมาส/ปี)
// สูตรแท่ง (อัตราต่อวัน) คำนวณที่ backend (phopyBoard.service.ts) ตัวเดียว — คอมโพเนนต์นี้วาดอย่างเดียว
// TODO(C1 worker): ตัววาดจริง — ห้ามเปลี่ยน interface ด้านล่าง (Phopy Board ใช้อยู่)

export interface Candle {
  /** เปิด = ค่าเฉลี่ยต่อวันของงวดก่อน (งวดแรก = ของตัวเอง) */
  o: number
  /** ปิด = ค่าเฉลี่ยต่อวันของงวดนี้ */
  c: number
  /** max(o, c, วันสูงสุด) */
  h: number
  /** min(o, c, วันต่ำสุด) */
  l: number
  /** ยอดรวมทั้งงวด (บาท) */
  tot: number
}

export interface TrendPeriod {
  key: string
  from: string
  to: string
  /** จำนวนวันที่มีในงวด (งวดแรก/งวดปัจจุบันอาจไม่เต็ม) */
  days: number
  partial?: boolean
  rev: Candle
  exp: Candle
  /** เงินคงเหลือ: c = สิ้นงวด, hi/lo = สูงสุด/ต่ำสุดระหว่างงวด · null = ไม่มีบัญชีเงิน */
  cash: { c: number; hi: number; lo: number } | null
}

export interface CandleChartProps {
  /** รวมงวด warm-up ไว้หน้าสุด (ใช้คิดเส้นค่าเฉลี่ยเท่านั้น ไม่วาด) */
  periods: TrendPeriod[]
  /** index แรกที่วาด (ก่อนหน้านี้คือ warm-up) */
  visibleFrom?: number
  /** คู่เส้นค่าเฉลี่ยของค่าปิด เช่น [4, 13] รายสัปดาห์ · [3, 12] รายเดือน · [2, 4] รายไตรมาส */
  ma: [number, number]
  /** ป้ายแกน x / readout ของงวด */
  labelOf: (p: TrendPeriod) => string
}

/** ค่าเฉลี่ยเคลื่อนที่ n งวด — จุดที่ข้อมูลไม่ถึง n งวด = null (ไม่วาดเส้นจากข้อมูลไม่พอ) */
export function movingAverage(vals: number[], n: number): Array<number | null> {
  return vals.map((_, i) => (i < n - 1 ? null : vals.slice(i - n + 1, i + 1).reduce((s, x) => s + x, 0) / n))
}

export default function CandleChart(_props: CandleChartProps) {
  return null
}
