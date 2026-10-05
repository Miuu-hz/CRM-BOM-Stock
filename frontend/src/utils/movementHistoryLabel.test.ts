import { describe, it, expect } from 'vitest'
import { movementHistoryLine } from './movementHistoryLabel'

/**
 * เดิม movement.quantity (เก็บเป็นหน่วยฐานเสมอ) ถูกจับคู่กับ movement.movementUnit
 * (หน่วยที่คนนับจริง) ตรง ๆ — นับ 10 ลัง (= 240 ชิ้นฐาน) กลายเป็นโชว์ "240 ลัง"
 */
describe('movementHistoryLine', () => {
  it('นับ 10 ลัง (240 ชิ้นฐาน) → หลัก 10 ลัง + หมายเหตุเป็นหน่วยฐาน', () => {
    const r = movementHistoryLine(
      { quantity: 240, movementQuantity: 10, movementUnit: 'ลัง' },
      'pcs'
    )
    expect(r.qty).toBe(10)
    expect(r.unit).toBe('ลัง')
    expect(r.note).toEqual({ qty: 240, unit: 'pcs' })
  })

  it('movementUnit ตรงกับหน่วยฐาน → ใช้ quantity + หน่วยฐาน ไม่มีหมายเหตุ', () => {
    const r = movementHistoryLine(
      { quantity: 5, movementQuantity: 5, movementUnit: 'pcs' },
      'pcs'
    )
    expect(r.qty).toBe(5)
    expect(r.unit).toBe('pcs')
    expect(r.note).toBeNull()
  })

  it('ไม่มี movementUnit (ข้อมูลเก่า) → ใช้ quantity + หน่วยฐาน ไม่มีหมายเหตุ', () => {
    const r = movementHistoryLine({ quantity: 7 }, 'pcs')
    expect(r.qty).toBe(7)
    expect(r.unit).toBe('pcs')
    expect(r.note).toBeNull()
  })
})
