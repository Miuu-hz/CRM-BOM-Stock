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

describe('Purchase.tsx — ใบแจ้งหนี้ผู้ขาย: GR-centric + แก้ไขได้ (2026-09-29)', () => {
  it('ห้ามมี tax_rate || 7 ในฟอร์มใบแจ้งหนี้ — 0% คือผู้ขายไม่เก็บ VAT ไม่ใช่ค่าที่ยังไม่ได้ตั้ง', () => {
    expect(SRC).not.toContain('tax_rate || 7')
  })

  it('โมดัลต้องเรียก GET /purchase/invoices/billable-receipts แทนการไล่ทีละ PO', () => {
    expect(SRC).toContain('/purchase/invoices/billable-receipts')
  })

  it('ต้องมี PUT ไป /purchase/invoices/ สำหรับโหมดแก้ไข', () => {
    expect(SRC).toMatch(/api\.put\(\s*['"`]\/purchase\/invoices\//)
  })
})

// 2026-10-01: PO ที่มีใบรับร่างค้าง ปุ่ม "รับสินค้า" ยังกดได้ (backend ปฏิเสธใบที่ 2) คนเลยไม่รู้ว่ารับไปแล้ว
describe('poNextStep — มี GR ร่างแล้วต้องล็อกปุ่มรับสินค้า', () => {
  it('เช็ค DRAFT GR ก่อนคืนปุ่ม receiveGoods', () => {
    const body = SRC.slice(SRC.indexOf('const poNextStep'), SRC.indexOf('const grNextStep'))
    expect(body.indexOf("draftReceiptPending")).toBeGreaterThan(-1)
    expect(body.indexOf("draftReceiptPending")).toBeLessThan(body.indexOf("purchase.actions.receiveGoods"))
  })
})

describe('Purchase.tsx — ชื่อเรียกแทน SKU (เหมือนหน้าขาย)', () => {
  it('ใบขอซื้อ + ใบสั่งซื้อ ส่งรายการชื่อเรียกแทนเข้าช่องค้นหาสินค้า (โหลดจากตัวเดียวกับหน้าขาย)', () => {
    expect(SRC).toMatch(/import \{ fetchStockAliases, type StockAlias \} from '\.\.\/services\/sales\.service'/)
    expect((SRC.match(/<MaterialSearchInput materials=\{materials\} aliases=\{stockAliases\}/g) || []).length).toBe(2)
  })
  it('ราคาซื้อเริ่มต้นคิดจากต้นทุน (unitCost) × ตัวคูณของชื่อ — ไม่ใช้ราคาขาย', () => {
    const fn = SRC.slice(SRC.indexOf('const aliasCost'), SRC.indexOf('const MaterialSearchInput'))
    expect(fn).toContain('unitCost')
    expect(fn).not.toMatch(/sell_price|unit_price/)
  })
})

describe('Purchase.tsx — เลือกชื่อเรียกแทนที่คนละหน่วย ต้องคิดราคาใหม่ (บิลไม่ต่ำเกิน)', () => {
  it('aliasCost ปัดเฉพาะตอนมีตัวคูณ ≠ 1 และเก็บ 4 ตำแหน่ง', () => {
    const fn = SRC.slice(SRC.indexOf('const aliasCost'), SRC.indexOf('const MaterialSearchInput'))
    expect(fn).toContain('factor === 1 ? cost')
    expect(fn).toContain('10000')
    expect(fn).not.toContain('* 100) / 100')
  })
  it('onChange ของช่องค้นหาสินค้า: หน่วยเปลี่ยน + ผู้ใช้ไม่ได้แก้ราคาเอง → คิดราคาจาก aliasCost ใหม่', () => {
    const start = SRC.indexOf('const unitChanged = !!alias?.unit')
    const blk = SRC.slice(start, SRC.indexOf('onAddNew={modalMode', start))
    expect(blk).toMatch(/unitChanged && !item\.price_edited/)
    expect(blk).toContain('aliasCost(mat, alias)')
  })
  it('แก้ช่องราคาเอง = price_edited (กันทับ)', () => {
    expect(SRC).toMatch(/unit_price: parseFloat\(e\.target\.value\) \|\| 0, price_edited: true/)
  })
})
