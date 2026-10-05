import { describe, it, expect } from 'vitest'
import { priceForSaleUnit } from './salePrice'

describe('priceForSaleUnit — ราคา × หน่วย (Sales audit 2026-10-04)', () => {
  it('โค้ก base=pcs, 1 pack=6 pcs, unit_price 29/pcs → เลือกขายเป็น pack ต้องได้ 174', () => {
    expect(priceForSaleUnit(29, 6)).toBe(174)
  })

  it('เลือกหน่วยเดียวกับหน่วยฐาน (factor 1) ราคาไม่เปลี่ยน', () => {
    expect(priceForSaleUnit(29, 1)).toBe(29)
  })

  it('แปลงหน่วยไม่ได้ (factor null/0/undefined) = คงราคาต่อหน่วยฐานไว้ ไม่บล็อก', () => {
    expect(priceForSaleUnit(29, null)).toBe(29)
    expect(priceForSaleUnit(29, undefined)).toBe(29)
    expect(priceForSaleUnit(29, 0)).toBe(29)
    expect(priceForSaleUnit(29, NaN)).toBe(29)
  })
})

import { applyRepricedRow } from './salePrice'

describe('applyRepricedRow — ผลแปลงหน่วยที่กลับมาช้าต้องไม่ทับของที่ผู้ใช้เพิ่งทำ', () => {
  const row = { productId: 'coke', unit: 'pack', unitPrice: 29, productName: 'โค้ก' }
  it('ใส่ราคาใหม่ลงแถวล่าสุด โดยคงสินค้าที่เพิ่งเลือกไว้', () => {
    expect(applyRepricedRow([row], 0, { productId: 'coke', unit: 'pack' }, 174)).toEqual([{ ...row, unitPrice: 174 }])
  })
  it('ผู้ใช้พิมพ์ราคาเองระหว่างรอ → ไม่ทับ', () => {
    expect(applyRepricedRow([{ ...row, unitPrice: 160, priceEdited: true }], 0, { productId: 'coke', unit: 'pack' }, 174)).toBeNull()
  })
  it('เปลี่ยนหน่วย/สินค้าไปแล้ว → ผลเก่าทิ้ง', () => {
    expect(applyRepricedRow([{ ...row, unit: 'pcs' }], 0, { productId: 'coke', unit: 'pack' }, 174)).toBeNull()
    expect(applyRepricedRow([{ ...row, productId: 'soda' }], 0, { productId: 'coke', unit: 'pack' }, 174)).toBeNull()
  })
})
