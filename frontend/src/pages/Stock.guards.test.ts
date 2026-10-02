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
// AddStockModal เป็นคอมโพเนนต์ตัวท้ายไฟล์ จึงไม่มีหมุดท้ายให้ยึด — ตัดถึงท้ายไฟล์เลย
// แต่หมุดหัวต้องล้มเสียงดังเหมือน slice() ตัวอื่น ไม่ใช่เงียบแล้วได้สตริงว่าง
const addModalStart = SRC.indexOf('function AddStockModal({')
if (addModalStart < 0) throw new Error('หาหมุดหัวไม่เจอ: function AddStockModal({')
const ADD_MODAL = SRC.slice(addModalStart)

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

describe('Stock.tsx — หน้าคลังตามแบบร่างใหม่', () => {
  const MAIN = slice('function Stock() {', 'function UnpackModal({')

  it('ทะเบียนการปรับสต็อกต้องยังเรียกได้ แม้ปุ่มจะย้ายไปอยู่ใต้ "…"', () => {
    // เจ้าของงานสั่งไว้ชัดว่าตัดปุ่มอื่นได้ แต่ห้ามตัดทะเบียนปรับ
    expect(MAIN).toContain('ทะเบียนการปรับสต็อก')
    expect(MAIN).toContain('setAdjLogModal(true)')
  })

  it('SKU ต้องไม่กลับมาเป็นคอลัมน์ของตัวเอง — อยู่ใต้ชื่อสินค้า', () => {
    expect(SRC).not.toContain("colKey=\"sku\"")
    expect(MAIN).toContain('{item.sku}')
  })

  it('ทุกคอลัมน์ที่ซ่อนบนจอเล็ก ต้องซ่อนทั้งหัวและช่องข้อมูล', () => {
    // หัวกับ td ต้องมีจำนวน hidden เท่ากัน ไม่งั้นตารางเหลื่อมกันทั้งแถวบนมือถือ
    const th = (MAIN.match(/<SortTh[^>]*hidden (sm|md|lg):table-cell/g) || []).length
    const td = (MAIN.match(/<td className="hidden (sm|md|lg):table-cell/g) || []).length
    expect(th).toBeGreaterThan(0)
    expect(td).toBe(th)
  })
})

describe('Stock.tsx — โมดัลแก้ไขหน้าตาเดียวกับโมดัลรายละเอียด', () => {
  it('ไม่มีประวัติซื้อ/ขาย และประวัติการเคลื่อนไหวในโมดัลแก้ไข', () => {
    // สองอันนี้อยู่ที่หน้ารายละเอียด — ในโมดัลแก้ไขมันยาวโดยไม่ช่วยให้แก้อะไรได้
    for (const k of ['price-log', 'ประวัติการเคลื่อนไหว', 'logTab']) {
      expect(EDIT_MODAL, 'โมดัลแก้ไขไม่ควรมี "' + k + '"').not.toContain(k)
    }
  })

  it('ยังจัดการรูปได้จากหัวหน้าต่างเหมือนโมดัลรายละเอียด', () => {
    expect(EDIT_MODAL).toContain('รูปหลัก')
    expect(EDIT_MODAL).toContain('handleImageChange')
  })
})

describe('Stock.tsx — ผังหน่วยสองจอต้องตรงกัน', () => {
  it('แถบผังหน่วยในโมดัลแก้ไขลากตามกฎแปลงจริง ไม่ใช่โชว์แค่หน่วยที่ตั้งไว้', () => {
    // ผังเต็มจอโชว์ ลัง ×5 กก. ×1000 กรัม แต่แถบในโมดัลเคยโชว์ "ลัง → กรัม" ไม่มีตัวคูณ
    // เพราะสร้างจาก purchase/display/base ตรง ๆ ไม่ได้เดินกราฟกฎแปลง
    for (const k of ['pathBetween', 'standardConversions.forEach', 'fmtFactor']) {
      expect(EDIT_MODAL, 'ขาด "' + k + '"').toContain(k)
    }
  })
})

describe('Stock.tsx — ราคาซื้อต้องขยับตามหน่วย ทั้งสองทางเข้า', () => {
  // โมดัลเพิ่มสินค้าเคยไม่มีตรรกะคูณราคาเลย (โมดัลแก้ไขมี) เปลี่ยนหน่วยซื้อแล้วราคาค้างหน่วยเดิม
  // สินค้าใหม่จึงเกิดมาพร้อมทุนผิดตั้งแต่แถวแรก เพราะ backend หาร unit_cost = purchase_price / factor
  const MODALS = [['โมดัลแก้ไข', EDIT_MODAL], ['โมดัลเพิ่มสินค้า', ADD_MODAL]] as const

  for (const [name, src] of MODALS) {
    it(name + ' เปลี่ยนหน่วยซื้อผ่าน repriceTo ไม่ใช่เขียนทับตรง ๆ', () => {
      expect(src, 'ขาดการคูณราคาตอนสลับหน่วยซื้อ').toContain('repriceTo(prev, unit)')
      expect(src, 'เหลือจุดที่เขียนหน่วยซื้อทับโดยไม่คูณราคา').not.toMatch(/purchaseUnit:\s*unit\b/)
    })

    it(name + ' เปลี่ยนหน่วยนับ/หน่วยบรรจุ แล้วหน่วยซื้อขยับตาม', () => {
      // เหลือหน่วยซื้อค้างไว้ = สายขาดสูตรแปลง แล้ว backend ตีกลับ UNIT_CONVERSION_MISSING
      // ตอนกดบันทึก ทั้งที่บนจอดูเหมือนเปลี่ยนครบแล้ว
      for (const k of ['changeBaseUnit', 'changeDisplayUnit']) {
        expect(src, 'ขาด "' + k + '"').toContain(k)
      }
    })
  }

  it('กราฟกฎแปลงหน่วยต้องมาจาก utils/unitGraph ชุดเดียว ไม่ก๊อปซ้ำในไฟล์นี้', () => {
    // เคยมี BFS เขียนไว้ใน EditModal เอง โมดัลเพิ่มสินค้าจึงไม่มีอะไรเลย
    // และผังหน่วยสองจอมีโอกาสเพี้ยนไม่ตรงกันเพราะสร้างกราฟคนละชุด
    expect(SRC, 'ไม่ได้ import กราฟกลาง').toContain("from '../utils/unitGraph'")
    expect(SRC, 'ย้าย BFS ไป utils/unitGraph แล้ว ห้ามสร้างกราฟซ้ำที่นี่').not.toContain('addUnitEdge')
  })
})
