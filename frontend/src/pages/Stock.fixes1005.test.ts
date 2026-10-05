import { describe, it, expect } from 'vitest'
// Stock.tsx 3,600+ บรรทัด ผูกกับ api/auth/i18n — render ทั้งหน้าแพงเกินคุ้ม
// อ่านซอร์สด้วย ?raw ของ Vite แทน (แนวเดียวกับ Stock.guards.test.ts / Purchase.guards.test.ts)
import StockSource from './Stock.tsx?raw'

const SRC: string = StockSource
const slice = (from: string, to: string) => {
  const a = SRC.indexOf(from), b = SRC.indexOf(to)
  if (a < 0) throw new Error('หาหมุดหัวไม่เจอ: ' + from)
  if (b < 0) throw new Error('หาหมุดท้ายไม่เจอ: ' + to)
  return SRC.slice(a, b)
}

const GET_DEFAULT_COLS = slice('function getDefaultCols()', 'function Stock() {')
const ADJUST_MODAL = slice('function AdjustModal({', 'function AddStockModal({')
const addModalStart = SRC.indexOf('function AddStockModal({')
if (addModalStart < 0) throw new Error('หาหมุดหัวไม่เจอ: function AddStockModal({')
const ADD_MODAL = SRC.slice(addModalStart)

describe('Stock.tsx — getDefaultCols บังคับคอลัมน์ ALWAYS_VISIBLE เสมอ', () => {
  it('ยังมี loop ที่ตั้งทุกคีย์ใน ALWAYS_VISIBLE เป็น true ทับค่าจาก localStorage', () => {
    // เดิม localStorage เก่าที่มี status:false หลุดเข้ามาตรง ๆ ทำให้คอลัมน์บังคับ (quantity/status) หายได้
    expect(GET_DEFAULT_COLS).toContain('for (const k of ALWAYS_VISIBLE) out[k] = true')
  })
})

describe('Stock.tsx — AdjustModal ส่ง payload เป็นหน่วยที่เลือกจริง ไม่ใช่หน่วยฐาน', () => {
  it('recordMovement ส่ง quantity: physicalCount คู่กับ unit ที่ผู้ใช้เลือก', () => {
    // เดิมแปลง physicalCount → baseQuantity เองในฝั่งจอ แล้วส่ง unit: baseUnit ตายตัว
    // ทำให้ backend แปลงหน่วยซ้ำสอง (จอแปลงไปแล้วรอบหนึ่ง backend แปลงอีกรอบ) ตัวเลขเพี้ยน
    expect(ADJUST_MODAL).toContain('quantity: physicalCount,')
    expect(ADJUST_MODAL).toContain('unit: unit || baseU || undefined,')
  })

  it('ไม่มีสูตรเก่า selectedItem.quantity / selectedItem.displayQuantity', () => {
    // สูตรเดิมพังตอน displayQuantity เป็น 0/undefined หรือหน่วยที่นับไม่ใช่ displayUnit
    expect(ADJUST_MODAL).not.toContain('selectedItem.quantity / selectedItem.displayQuantity')
  })

  it('ด่านอนุมัติเช็คล่วงหน้าด้วยมูลค่าส่วนต่างจริง ไม่ใช่ amount: 0 ตายตัว', () => {
    // amount: 0 เสมอ ทำให้ป้าย/ข้อความบนปุ่มไม่ตรงกับที่ backend จะทำจริง
    expect(ADJUST_MODAL).not.toContain('amount: 0 }')
    expect(ADJUST_MODAL).toContain('amount: Math.abs(diffValue)')
  })
})

describe('Stock.tsx — AddStockModal ไม่เหลือช่องเลือกหน่วยที่ตาย', () => {
  it('ไม่มี select ที่ผูกกับ formData.unit ตรง ๆ อีกต่อไป', () => {
    // เดิมมี <select value={formData.unit} onChange={... unit: e.target.value}> ซ้อนอยู่กับ
    // หน่วยฐาน/หน่วยบรรจุ (changeBaseUnit/changeDisplayUnit) — แก้ช่องนี้ไม่มีผลอะไรกับฟอร์มจริง
    expect(ADD_MODAL).not.toContain('value={formData.unit}')
    expect(ADD_MODAL).not.toContain('unit: e.target.value')
  })
})

describe('Stock.tsx — null guard ก่อน .toLowerCase()', () => {
  it('item.name / item.sku ไม่เรียก .toLowerCase() ตรง ๆ โดยไม่มีการ์ด', () => {
    // สินค้าที่ name หรือ sku เป็น null/undefined (ข้อมูลเก่า/นำเข้าพลาด) ทำให้หน้าทั้งหน้าขาว
    expect(SRC).not.toContain('item.name.toLowerCase()')
    expect(SRC).not.toContain('item.sku.toLowerCase()')
    expect(SRC).toContain("(item.name || '').toLowerCase()")
    expect(SRC).toContain("(item.sku || '').toLowerCase()")
  })

  it('category ไม่เรียก .toLowerCase() ตรง ๆ โดยไม่มีการ์ด', () => {
    expect(SRC).not.toContain('category.toLowerCase()')
    expect(SRC).toContain("(category || '').toLowerCase()")
  })
})
