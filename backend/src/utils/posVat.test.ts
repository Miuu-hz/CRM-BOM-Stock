import { describe, it, expect } from 'vitest'
import { calcPosTotals } from './posVat'

/**
 * กฎเหล็กของยอดบิล POS: subtotal + ค่าบริการ + ภาษี ต้องเท่ากับ total เป๊ะเสมอ
 * — journal ลง Dr บัญชีพัก POS ด้วย total และ Cr รายได้ด้วย subtotal+ค่าบริการ
 *   ถ้าสามตัวนี้บวกไม่ลงตัว งบจะไม่บาลานซ์ และใบกำกับจะพิมพ์ยอดไม่ตรงกัน
 */
const EX = { vatEnabled: true, vatRate: 7, vatInclusive: false, serviceEnabled: false, serviceRate: 10 }
const IN = { ...EX, vatInclusive: true }

const balanced = (t: ReturnType<typeof calcPosTotals>) =>
  Math.abs(t.subtotal + t.serviceChargeAmount + t.extraCharge - t.discount + t.taxAmount - t.totalAmount) < 0.005

describe('calcPosTotals', () => {
  it('โหมดบวกเพิ่ม: ภาษีบวกทับราคาป้าย', () => {
    const t = calcPosTotals(100, EX)
    expect(t.subtotal).toBe(100)
    expect(t.taxAmount).toBe(7)
    expect(t.totalAmount).toBe(107)
  })

  it('โหมดรวม VAT: ลูกค้าจ่ายเท่าราคาป้าย ภาษีถูกถอดออกมาเป็นฐาน', () => {
    const t = calcPosTotals(107, IN)
    expect(t.totalAmount).toBe(107)          // จ่ายเท่าป้าย ไม่บวกเพิ่ม
    expect(t.taxAmount).toBe(7)              // 107 × 7/107
    expect(t.subtotal).toBe(100)
  })

  it('ฐานภาษีรวมค่าบริการด้วย', () => {
    const t = calcPosTotals(100, { ...EX, serviceEnabled: true })
    expect(t.serviceChargeAmount).toBe(10)
    expect(t.taxAmount).toBe(8)              // (100 + 10) × 7%
    expect(t.totalAmount).toBe(118)
  })

  it('ฐานภาษีรวมค่าขนส่งที่เรียกเก็บจากลูกค้าด้วย', () => {
    const t = calcPosTotals(100, EX, { extraCharge: 50 })
    expect(t.taxAmount).toBe(11)             // (100 + 50) × 7% ไม่ใช่ 7
    expect(t.totalAmount).toBe(161)
    expect(balanced(t)).toBe(true)
  })

  it('ส่วนลดลดฐานภาษี ไม่ใช่หักทีหลัง', () => {
    const t = calcPosTotals(100, EX, { discount: 20 })
    expect(t.taxAmount).toBe(6)              // (100 − 20) × 7% ไม่ใช่ 7
    expect(t.totalAmount).toBe(86)
  })

  it('โหมดรวม VAT: ค่าขนส่งก็ถูกถอดภาษีออกจากยอดที่ลูกค้าจ่าย', () => {
    const t = calcPosTotals(100, IN, { extraCharge: 7 })
    expect(t.totalAmount).toBe(107)          // จ่ายเท่าที่เห็น ไม่บวกเพิ่ม
    expect(t.taxAmount).toBe(7)              // 107 × 7/107
    expect(balanced(t)).toBe(true)
  })

  it('ส่วนลดเกินยอดบิล → ไม่ติดลบ', () => {
    const t = calcPosTotals(100, EX, { discount: 500 })
    expect(t.totalAmount).toBe(0)
    expect(t.taxAmount).toBe(0)
  })

  it('ยอดไหนก็ต้องบวกกลับได้ total เป๊ะ ไม่มีเศษหลุด', () => {
    for (const amt of [0, 1, 15, 99, 123.45, 1000, 33333.33]) {
      for (const cfg of [EX, IN, { ...EX, serviceEnabled: true }, { ...IN, serviceEnabled: true }]) {
        for (const adj of [{}, { extraCharge: 40 }, { discount: 13.5 }, { extraCharge: 40, discount: 13.5 }]) {
          const t = calcPosTotals(amt, cfg, adj)
          expect(balanced(t), `${amt} ${cfg.vatInclusive ? 'รวม' : 'แยก'} ${JSON.stringify(adj)}`).toBe(true)
        }
      }
    }
  })

  it('ปิด VAT แล้วต้องไม่มีภาษีโผล่ ไม่ว่าโหมดไหน', () => {
    expect(calcPosTotals(100, { ...IN, vatEnabled: false }).taxAmount).toBe(0)
    expect(calcPosTotals(100, { ...EX, vatEnabled: false }).totalAmount).toBe(100)
  })
})
