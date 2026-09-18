import { describe, it, expect } from 'vitest'
import StockSource from './Stock.tsx?raw'

/**
 * แผ่น Detail ของแบบร่างมีบล็อก "ผังหน่วย" + การ์ด "จุดเตือน" + แถบปุ่มท้ายหน้าต่าง
 * ซึ่งเฟส 1-3 ไม่เคยทำเลย เจ้าของทักเองว่า "ไม่ได้แก้ ux/ui ตามแผน"
 */
const SRC: string = StockSource
const sliceAt = (from: string, to: string) => {
  const a = SRC.indexOf(from), b = SRC.indexOf(to)
  if (a < 0) throw new Error('หาหมุดหัวไม่เจอ: ' + from)
  if (b < 0) throw new Error('หาหมุดท้ายไม่เจอ: ' + to)
  return SRC.slice(a, b)
}
const DETAIL = sliceAt('function DetailModal({', 'export function EditModal({')

describe('DetailModal — บล็อกผังหน่วยตามแบบร่าง', () => {
  it('มีผังหน่วยพร้อมป้ายบทบาท ซื้อ/บรรจุ/นับ', () => {
    expect(DETAIL).toContain('ผังหน่วย')
    // เจ้าของเลือกใช้คำที่ระบบมีจริง ไม่ใช่ "หน่วยขาย" ตามแบบร่าง (ระบบไม่มี field นั้น)
    for (const role of ["'ซื้อ'", "'บรรจุ'", "'นับ'"]) expect(DETAIL).toContain(role)
  })

  it('ขาดสูตรแปลงต้องเตือน ไม่ใช่โชว์ลูกศรเปล่า', () => {
    expect(DETAIL).toContain('ไม่มีสูตร')
    expect(DETAIL).toContain('ตัดสต็อกผิดทันที')
  })

  it('มีการ์ดจุดเตือนรวม 3 ค่าไว้ที่เดียว', () => {
    expect(DETAIL).toContain('จุดเตือน')
    for (const k of ['จุดสั่งซื้อ', 'เก็บสูงสุด', 'ที่เก็บ']) expect(DETAIL).toContain(k)
  })

  it('มีแถบปุ่มท้ายหน้าต่าง เดิมดูได้อย่างเดียวต้องปิดแล้วไปหาแถวเดิมในตาราง', () => {
    expect(DETAIL).toContain('ราคาทั้งหมดมาจากเอกสารจริง ไม่ได้กรอกมือ')
    expect(DETAIL).toContain('onAdjust?.(item)')
    expect(DETAIL).toContain('onEdit?.(item)')
  })
})

describe('DetailModal — ทางเขียนกฎแปลงหน่วยต้องมีทางเดียว', () => {
  it('ผังเต็มจอใช้ UnitChainEditor ตัวเดิม ไม่สร้าง UI แก้ไขชุดที่สอง', () => {
    expect(DETAIL).toContain('<UnitChainEditor')
    expect(DETAIL).toContain('availableUnits={chainUnits}')
  })

  it('ใช้ endpoint ชุดเดียวกับ EditModal เป๊ะ', () => {
    // กฎแปลงหน่วยผูกกับการคิดสต็อกทั้งระบบ มี 2 ทางเขียนเมื่อไรก็หย่อนไม่เท่ากันเมื่อนั้น
    expect(DETAIL).toContain("api.post('/materials/unit-conversions'")
    expect(DETAIL).toContain('/materials/unit-conversions/${convId}')
    expect(DETAIL).toContain('invalidateUnitsCache()')
  })

  it('ดึงเฉพาะกฎของสินค้าตัวนี้ ไม่ปนกฎกลาง', () => {
    // เจ้าของกำชับว่าผังเป็นของสินค้านั้นตัวเดียว
    expect(DETAIL).toContain('/materials/unit-conversions?materialId=${item.id}')
    expect(DETAIL).not.toContain('unit-conversions/standards')
  })
})
