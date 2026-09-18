import { describe, it, expect } from 'vitest'
// อ่านไฟล์เป็นข้อความด้วย ?raw ของ Vite — ไม่ต้องพึ่ง fs/path ที่ frontend ไม่มี @types/node
// (จะได้ไม่ต้องลง @types/node ซึ่งทำให้ setTimeout กลายเป็น NodeJS.Timeout แล้วโค้ดเดิมพัง)
import PurchaseSource from './Purchase.tsx?raw'

/**
 * บั๊กที่เจอ 2026-09-18: ปุ่ม "ขั้นต่อไป" ในหน้าจัดซื้อใส่ค่าลงฟอร์มก่อน
 * แล้วค่อยเรียก openModal(type, 'create') ที่ไม่ส่ง data
 * openModal วิ่งเข้า else branch แล้วล้างฟอร์ม "ทุกใบ" ทิ้ง
 * ค่าที่เพิ่งใส่จึงหายทันที — กดสร้างใบแจ้งหนี้จาก PO แล้วช่อง PO ว่างเปล่า
 *
 * Purchase.tsx 5,000+ บรรทัดและผูกกับ api/i18n/auth เต็มไปหมด render ทั้งหน้าในเทสต์
 * แพงเกินคุ้ม — เช็คที่รูปแบบโค้ดแทน เพราะบั๊กนี้คือ "ลำดับการเรียก" ล้วน ๆ
 */
const SRC: string = PurchaseSource

describe('Purchase.tsx — openModal ต้องไม่ล้างค่าที่เพิ่งใส่', () => {
  it('ห้ามมี set*Form ตามด้วย openModal(..., "create") ที่ไม่ส่ง data', () => {
    // จับรูปแบบ: setXxxForm(...) ... openModal('type', 'create')  โดยไม่มี argument ที่ 3
    const offenders: string[] = []
    const lines = SRC.split('\n')
    lines.forEach((line: string, i: number) => {
      const m = line.match(/openModal\(\s*'(\w+)'\s*,\s*'create'\s*\)/)
      if (!m) return
      // ย้อนดู 12 บรรทัดก่อนหน้าว่ามีการ prefill ฟอร์มค้างไว้ไหม
      const before = lines.slice(Math.max(0, i - 12), i).join('\n')
      if (/set[A-Z]\w*Form\s*\(/.test(before)) {
        offenders.push(`บรรทัด ${i + 1}: ${line.trim()}`)
      }
    })
    expect(offenders, 'ค่าที่ prefill ไว้จะถูก openModal ล้างทิ้ง — ส่งผ่าน data แทน').toEqual([])
  })

  it('else branch ของ openModal ต้องล้างเฉพาะฟอร์มของชนิดที่เปิด', () => {
    const start = SRC.indexOf('const openModal = (')
    expect(start).toBeGreaterThan(-1)
    const body = SRC.slice(start, start + 8000)
    const elseAt = body.indexOf('    } else {')
    expect(elseAt).toBeGreaterThan(-1)
    const elseBlock = body.slice(elseAt, body.indexOf('\n    }\n', elseAt))

    const resets = elseBlock.match(/set[A-Z]\w*Form\s*\(/g) || []
    const guarded = elseBlock.match(/if \(type === '\w+'\) set[A-Z]\w*Form\s*\(/g) || []
    expect(resets.length).toBeGreaterThan(0)
    expect(guarded.length, 'ทุก reset ต้องมี if (type === ...) คุมอยู่').toBe(resets.length)
  })
})

describe('Purchase.tsx — จอรับสินค้าต้องใช้หน่วยที่สั่งซื้อ', () => {
  it('ป้ายราคาต้องผูกกับ item.unit ไม่ใช่ข้อความ "หน่วย" ตายตัว', () => {
    // unitPriceLabel = "ราคา/หน่วย:" ซึ่งเป็นคำลอย ๆ ไม่บอกว่าหน่วยอะไร
    expect(SRC).not.toContain('receiptModal.unitPriceLabel')
    expect(SRC).toContain('receiptModal.perPurchaseUnit')
  })

  it('ต้องบอกด้วยว่าของจะเข้าคลังเป็นกี่หน่วย เมื่อหน่วยซื้อ != หน่วยคลัง', () => {
    expect(SRC).toContain('stock_unit')
    expect(SRC).toContain('receiptModal.stockUnitHint')
    expect(SRC).toContain('receiptModal.noConversionHint')
  })
})
