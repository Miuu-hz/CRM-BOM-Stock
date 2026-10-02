import { describe, it, expect } from 'vitest'
// อ่านซอร์สเป็นข้อความด้วย ?raw ของ Vite — เพจพวกนี้ผูกกับ api/auth/i18n เต็มไปหมด
// render จริงในเทสต์แพงเกินคุ้ม เช็คที่รูปแบบโค้ดตรงกว่า (ดู Purchase.guards.test.ts เป็นตัวอย่าง)
import SalesSource from '../pages/Sales.tsx?raw'
import PurchaseSource from '../pages/Purchase.tsx?raw'

/**
 * บั๊กที่เคยเกิด: `data.tax_rate || 7` เปลี่ยน 0 (ผู้ขาย/ลูกค้าไม่เก็บ VAT จริง ๆ) ให้กลายเป็น 7
 * แบบเงียบ ๆ ตอนเปิดแก้เอกสาร ต้องใช้ ?? เท่านั้น — งานนี้ (โหมด VAT ระดับเอกสาร 2026-09-29)
 * เขียน field ใหม่จำนวนมาก กันไว้ไม่ให้แพทเทิร์นเดิมโผล่กลับมาที่ไหนอีก
 */
describe('Sales.tsx / Purchase.tsx — ห้ามมี tax_rate || 7 หรือ taxRate || 7 หลงเหลือ', () => {
  it('Sales.tsx สะอาด', () => {
    expect(SalesSource).not.toMatch(/tax_rate \|\| 7/)
    expect(SalesSource).not.toMatch(/taxRate \|\| 7/)
  })
  it('Purchase.tsx สะอาด', () => {
    expect(PurchaseSource).not.toMatch(/tax_rate \|\| 7/)
    expect(PurchaseSource).not.toMatch(/taxRate \|\| 7/)
  })
})

describe('utils/vat.ts — ต้อง export ชุดโหมด VAT ตามสัญญาที่ backend/frontend ตกลงกัน', () => {
  it('มีชื่อ/ซิกเนเจอร์ตามที่ตกลงไว้เป๊ะ (ชื่อผิดแปลว่าฝั่งอื่นเรียกไม่เจอ)', async () => {
    const vat = await import('./vat')
    expect(vat.VAT_RATE).toBe(7)
    expect(typeof vat.vatModeOf).toBe('function')
    expect(typeof vat.vatModeToFields).toBe('function')
    expect(vat.vatModeOf(0, false)).toBe('NONE')
  })
})
