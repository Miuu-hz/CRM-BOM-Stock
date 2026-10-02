import { describe, it, expect } from 'vitest'
import {
  vatModeOf, vatModeToFields, defaultVatMode, vatModeWarning, prefillUnitPriceFromCost, VAT_RATE,
} from './vat'

describe('vatModeOf — อ่านโหมดจาก field ที่เก็บจริง ต้องใช้ ?? ไม่ใช่ ||', () => {
  it('tax_rate 0 ต้องเป็น NONE เสมอ ไม่ว่า vat_inclusive จะเป็นอะไร', () => {
    expect(vatModeOf(0, false)).toBe('NONE')
    expect(vatModeOf(0, true)).toBe('NONE')
  })
  it('tax_rate undefined/null ต้องเป็น NONE ไม่ใช่ throw', () => {
    expect(vatModeOf(undefined, undefined)).toBe('NONE')
    expect(vatModeOf(null, null)).toBe('NONE')
  })
  it('7 + inclusive=true คือ INCLUSIVE, 7 + inclusive=false คือ EXCLUSIVE', () => {
    expect(vatModeOf(7, true)).toBe('INCLUSIVE')
    expect(vatModeOf(7, false)).toBe('EXCLUSIVE')
  })
})

describe('vatModeToFields — แปลงกลับเป็น field เพื่อส่งเอกสาร', () => {
  it('round-trip กับ vatModeOf ต้องได้ค่าเดิม', () => {
    for (const mode of ['NONE', 'INCLUSIVE', 'EXCLUSIVE'] as const) {
      const { rate, inclusive } = vatModeToFields(mode)
      expect(vatModeOf(rate, inclusive)).toBe(mode)
    }
  })
  it('NONE ต้องเป็น rate 0 เสมอ ไม่ใช่ 7', () => {
    expect(vatModeToFields('NONE')).toEqual({ rate: 0, inclusive: false })
  })
})

describe('defaultVatMode — ร้านยังไม่จด VAT', () => {
  it('ฝั่งขายล็อก NONE เสมอ พร้อมเหตุผล', () => {
    const r = defaultVatMode({ side: 'sale', registered: false })
    expect(r.mode).toBe('NONE')
    expect(r.locked?.reason).toBeTruthy()
  })
  it('ฝั่งซื้อไม่ล็อก — เลือกได้ทั้ง 3 โหมด (เจ้าของแก้สเปกภายหลัง)', () => {
    const r = defaultVatMode({ side: 'purchase', registered: false })
    expect(r.locked).toBeUndefined()
    expect(r.mode).toBe('NONE')
    expect(r.hint).toBeTruthy()
  })
  it('ฝั่งซื้อไม่จด VAT แต่คู่ค้าเคยใช้ EXCLUSIVE — ใช้โหมดนั้นเป็นค่าเริ่มต้น ไม่ใช่ NONE ตายตัว', () => {
    const r = defaultVatMode({ side: 'purchase', registered: false, contactMode: 'EXCLUSIVE' })
    expect(r.mode).toBe('EXCLUSIVE')
    expect(r.locked).toBeUndefined()
  })
})

describe('defaultVatMode — ร้านจด VAT แล้ว', () => {
  it('ไม่มีโหมดคู่ค้า: ขาย=EXCLUSIVE (ต้องเก็บ VAT) ซื้อ=NONE', () => {
    expect(defaultVatMode({ side: 'sale', registered: true }).mode).toBe('EXCLUSIVE')
    expect(defaultVatMode({ side: 'purchase', registered: true }).mode).toBe('NONE')
  })
  it('มีโหมดคู่ค้า: ใช้โหมดนั้น พร้อม hint ที่มา', () => {
    const r = defaultVatMode({ side: 'sale', registered: true, contactMode: 'NONE' })
    expect(r.mode).toBe('NONE')
    expect(r.hint).toBeTruthy()
  })
})

describe('vatModeWarning', () => {
  it('ขายแบบไม่มี VAT ทั้งที่ร้านจดทะเบียนแล้ว ต้องเตือน', () => {
    expect(vatModeWarning('NONE', { side: 'sale', registered: true })).toBeTruthy()
  })
  it('ซื้อแบบไม่มี VAT ไม่ต้องเตือน (ร้านซื้อของที่ไม่มี VAT ได้ปกติ)', () => {
    expect(vatModeWarning('NONE', { side: 'purchase', registered: true })).toBeUndefined()
  })
  it('โหมดที่เลือกต่างจากที่คู่ค้าเคยใช้ครั้งก่อน ต้องเตือน', () => {
    const w = vatModeWarning('EXCLUSIVE', { side: 'sale', registered: true, contactMode: 'NONE' })
    expect(w).toBeTruthy()
  })
  it('โหมดตรงกับคู่ค้าเดิม ไม่ต้องเตือน', () => {
    expect(vatModeWarning('EXCLUSIVE', { side: 'sale', registered: true, contactMode: 'EXCLUSIVE' })).toBeUndefined()
  })
})

describe('prefillUnitPriceFromCost — กันเติมราคาซ้อน VAT (7%+7%)', () => {
  it('ร้านจด VAT + โหมด INCLUSIVE: ต้นทุนไม่รวม VAT (มาตรฐาน backend) ต้องบวก VAT เข้าไป 100 -> 107', () => {
    expect(prefillUnitPriceFromCost(100, 'INCLUSIVE', true)).toBeCloseTo(107, 2)
  })
  it('ร้านยังไม่จด VAT: ต้นทุนรวม VAT แล้ว ใช้ตรง ๆ ไม่แปลง', () => {
    expect(prefillUnitPriceFromCost(100, 'INCLUSIVE', false)).toBe(100)
    expect(prefillUnitPriceFromCost(100, 'NONE', false)).toBe(100)
  })
  it('ร้านยังไม่จด VAT + เลือกโหมด EXCLUSIVE: ต้องถอด VAT ออกจากต้นทุนที่รวมมาก่อน 107 -> 100', () => {
    expect(prefillUnitPriceFromCost(107, 'EXCLUSIVE', false)).toBeCloseTo(100, 2)
  })
  it('ร้านจด VAT + โหมด EXCLUSIVE หรือ NONE: ต้นทุนไม่รวม VAT อยู่แล้ว ใช้ตรง ๆ', () => {
    expect(prefillUnitPriceFromCost(100, 'EXCLUSIVE', true)).toBe(100)
    expect(prefillUnitPriceFromCost(100, 'NONE', true)).toBe(100)
  })
  it('VAT_RATE ต้องเป็น 7 (ยึดตามกฎหมายไทยปัจจุบัน)', () => {
    expect(VAT_RATE).toBe(7)
  })
})
