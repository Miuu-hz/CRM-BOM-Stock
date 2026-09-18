import { describe, it, expect } from 'vitest'
// อ่านซอร์สเป็นข้อความด้วย ?raw ของ Vite — Stock.tsx 3,400+ บรรทัดผูกกับ api/auth/i18n
// การ render ทั้งหน้าในเทสต์แพงเกินคุ้ม และบั๊กชุดนี้อ่านจากซอร์สจับได้ตรงกว่า
import StockSource from './Stock.tsx?raw'

const SRC: string = StockSource
const slice = (from: string, to: string) => {
  const a = SRC.indexOf(from), b = SRC.indexOf(to)
  // หมุดหาย = ขอบเขตผิด ต้องล้มเสียงดัง ไม่ใช่เงียบแล้วตัดไปจนจบไฟล์
  if (a < 0) throw new Error('หาหมุดหัวไม่เจอ: ' + from)
  if (b < 0) throw new Error('หาหมุดท้ายไม่เจอ: ' + to)
  return SRC.slice(a, b)
}
// หมุดท้ายต้องเป็นสิ่งที่อยู่ถัดจาก EditModal จริง ๆ ณ ตอนนี้
// ถ้าหมุดหาย indexOf คืน -1 แล้ว slice จะกินไปจนจบไฟล์โดยไม่มีอะไรเตือน
const EDIT_MODAL = slice('export function EditModal({', 'function FilterButton({')
const DETAIL_MODAL = slice('function DetailModal({', 'export function EditModal({')

describe('Stock.tsx — ห้าม JSX รั่วออกมาเป็นข้อความ', () => {
  it('ไม่มีสตริงไหนขึ้นต้นด้วยแท็ก JSX', () => {
    // เคยมี 2 จุดที่เขียน setWarning(`<AlertTriangle className="w-4 h-4" /> ...`)
    // แล้วเอาไปวางใน <p> ธรรมดา ผู้ใช้เลยเห็นโค้ดเป็นตัวหนังสือจริง ๆ
    const leaks = SRC.match(/[`'"]\s*<[A-Z][A-Za-z]*\s+className=/g) || []
    expect(leaks, 'เขียนเป็นข้อความล้วน แล้ววางไอคอนเป็น JSX แยกต่างหาก').toEqual([])
  })
})

describe('Stock.tsx — สีต้องมาจาก token ไม่ใช่เลขเทา/ฟ้าคงที่', () => {
  // ธีมเริ่มต้นของแอปคือโหมดสว่าง (:root ใน index.css = #F0ECE2)
  // bg-gray-800/60 + text-blue-300 จึงเป็นกล่องเทาเข้มตัวหนังสือฟ้าซีดบนพื้นทราย
  it('โมดัลตั้งค่าสินค้าไม่ใช้สีคงที่โทนเทา/ฟ้า/เขียว', () => {
    const raw = EDIT_MODAL.match(/(bg|text|border|placeholder)-(gray|slate|zinc|blue|green)-\d{2,3}(\/\d+)?/g) || []
    expect(raw).toEqual([])
  })
})

describe('Stock.tsx — ภาษาบนจอ', () => {
  it('โมดัลรายละเอียดไม่เหลือป้ายอังกฤษ', () => {
    const en = (DETAIL_MODAL.match(/>[A-Z][A-Za-z ()]{2,30}</g) || [])
      .filter((x: string) => !/^>(SKU|GS1|POS|BOM|QC|ID)</.test(x))
    expect(en).toEqual([])
  })
})

describe('Stock.tsx — แท็บหน่วย', () => {
  it('ช่องเลือกหน่วยที่ยังว่าง ต้องไม่เอาหน่วยเก่ามาโชว์แทน placeholder', () => {
    // เดิม <option value="">{unitLabel(formData.unit || '...')}</option>
    // ทำให้ดูเหมือนเลือกไว้แล้วทั้งที่ค่ายังว่าง
    expect(EDIT_MODAL.match(/<option value="">\{unitLabel/g) || []).toEqual([])
  })

  it('ต้องเห็นสายหน่วยครบ 3 ชั้น ซื้อ → เก็บ → นับ', () => {
    // หน่วยซื้ออยู่แท็บ "ทั่วไป" (คู่กับราคา) ส่วนหน่วยนับ/บรรจุอยู่แท็บ "หน่วย"
    // ถ้าไม่สรุปทั้งสายไว้ที่เดียว คนตั้งค่าจะไม่มีทางเห็นพร้อมกัน
    for (const k of ['สายหน่วยของสินค้านี้', 'ซื้อเป็น', 'เก็บเป็น', 'นับเป็น']) {
      expect(EDIT_MODAL, 'ขาด "' + k + '"').toContain(k)
    }
  })
})
