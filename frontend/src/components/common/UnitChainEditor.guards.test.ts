import { describe, it, expect } from 'vitest'
import UceSource from './UnitChainEditor.tsx?raw'

/**
 * ผังการแปลงหน่วย: ปุ่มกากบาทบนโหนดชื่อว่า "ลบโหนด" แต่จริง ๆ ลบกฎแปลงหน่วย
 * ทุกเส้นที่แตะหน่วยนั้นออกจากฐานข้อมูลถาวร โดยไม่ถามและไม่บอกผล
 * กฎหายแล้วรับของเข้าคลังไม่ได้เลย — goodsReceipt.service โยน NO_CONVERSION
 */
const SRC: string = UceSource

describe('UnitChainEditor — ปุ่มที่ลบของถาวรต้องถามก่อน', () => {
  // ถามผ่านกล่องในแอป (setAskDel) ไม่ใช่ window.confirm — พฤติกรรมจริงทดสอบใน UnitChainModal.test.tsx
  it('ลบโหนดต้องถามก่อน', () => {
    const fn = SRC.slice(SRC.indexOf('const handleRemoveNode'), SRC.indexOf('const removeNode'))
    expect(fn).toContain('setAskDel(')
    expect(fn, 'ต้องบอกจำนวนกฎที่จะหายไปด้วย').toContain('toDelete.length')
  })

  it('ลบกฎจากป้ายด้านล่างต้องถามก่อน ไม่ยิง onDelete ตรง ๆ', () => {
    // เดิมเป็น onClick={() => onDelete(conv.id)} คือลบทันทีที่คลิกโดน
    expect(SRC).not.toContain('onClick={() => onDelete(conv.id)}')
    const fn = SRC.slice(SRC.indexOf('const handleDeleteEdge'), SRC.indexOf('const edgePath'))
    expect(fn).toContain('setAskDel(')
  })

  it('ไม่ใช้ window.confirm แล้ว', () => {
    expect(SRC).not.toMatch(/(^|[^.\w])confirm\(|window\.confirm\(/m)
  })

  it('ลบสำเร็จต้องมีเสียงตอบกลับ ไม่เงียบ', () => {
    const fn = SRC.slice(SRC.indexOf('const handleRemoveNode'), SRC.indexOf('const edgePath'))
    expect((fn.match(/toast\.success/g) || []).length).toBeGreaterThanOrEqual(2)
  })
})

describe('UnitChainEditor — ภาษาและสี', () => {
  it('ไม่เหลือชื่อหัวข้อภาษาอังกฤษ', () => {
    expect(SRC).not.toContain('Unit Chain Editor')
    expect(SRC).toContain('ผังการแปลงหน่วย')
  })

  it('ไม่ใช้สีคงที่ ต้องมาจาก token ทั้งหมด', () => {
    const raw = SRC.match(/(bg|text|border|placeholder|ring)-(gray|slate|zinc|neutral|blue|green|purple|amber|red|yellow)-\d{2,3}(\/\d+)?/g) || []
    expect(raw).toEqual([])
  })
})

describe('UnitChainEditor — ช่องเพิ่มหน่วยต้องค้นหาได้ แบบเดียวกับโมดูลอื่น', () => {
  // หมุดท้ายต้องเป็นปุ่ม "เพิ่มหน่วย" ตอนยังไม่ได้กด ไม่ใช่คำว่า "เพิ่มหน่วย" เฉย ๆ
  // เพราะคำนั้นโผล่ก่อนหน้าในข้อความ "ยังไม่มีหน่วย — เพิ่มหน่วยด้านล่าง" แล้ว indexOf
  // จะคืนตำแหน่งผิดจน slice ได้สตริงว่าง แล้วเทสต์ผ่านแบบหลอก ๆ
  const a = SRC.indexOf('{addingUnit ? (')
  const b = SRC.indexOf('onClick={() => setAddingUnit(true)}')
  if (a < 0 || b < 0 || b <= a) throw new Error('ขอบเขตช่องเพิ่มหน่วยเปลี่ยน หาหมุดไม่เจอ')
  const ADD_UNIT_ROW = SRC.slice(a, b)

  it('ใช้ UnitPicker ไม่ใช่ select ธรรมดา', () => {
    // select ที่ไล่ availableUnits ทั้งก้อน พิมพ์ค้นหาไม่ได้ รายการหน่วยยาวหลายสิบตัว
    // และไม่เห็นกลุ่มหมวด/หน่วยพิเศษเหมือนช่องเลือกหน่วยที่อื่นในระบบ
    expect(ADD_UNIT_ROW, 'ยังเหลือ select ธรรมดาในช่องเพิ่มหน่วย').not.toContain('<select')
    expect(ADD_UNIT_ROW).toContain('<UnitPicker')
  })

  it('ยังไม่เสนอหน่วยที่วางบนผังไปแล้ว', () => {
    // เดิมกรองเองด้วย availableUnits.filter(u => !nodePositions[u.value]) ซึ่งเทียบรหัสตรง ๆ
    // ย้ายมาใช้ prop exclude ที่ normalize ก่อนเทียบ จึงกันหน่วยชื่อไทยที่ซ้ำกับรหัสได้ด้วย
    expect(ADD_UNIT_ROW).toContain('exclude={activeUnits}')
  })

  it('ปุ่มเพิ่มยังกดไม่ได้ถ้ายังไม่เลือกหน่วย', () => {
    expect(ADD_UNIT_ROW).toContain('disabled={!newUnitValue}')
  })
})
