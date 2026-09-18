import { describe, it, expect } from 'vitest'
import UceSource from './UnitChainEditor.tsx?raw'

/**
 * ผังการแปลงหน่วย: ปุ่มกากบาทบนโหนดชื่อว่า "ลบโหนด" แต่จริง ๆ ลบกฎแปลงหน่วย
 * ทุกเส้นที่แตะหน่วยนั้นออกจากฐานข้อมูลถาวร โดยไม่ถามและไม่บอกผล
 * กฎหายแล้วรับของเข้าคลังไม่ได้เลย — goodsReceipt.service โยน NO_CONVERSION
 */
const SRC: string = UceSource

describe('UnitChainEditor — ปุ่มที่ลบของถาวรต้องถามก่อน', () => {
  it('ลบโหนดต้องผ่าน confirm', () => {
    const fn = SRC.slice(SRC.indexOf('const handleRemoveNode'), SRC.indexOf('const handleDeleteEdge'))
    expect(fn).toContain('confirm(')
    expect(fn, 'ต้องบอกจำนวนกฎที่จะหายไปด้วย').toContain('toDelete.length')
  })

  it('ลบกฎจากป้ายด้านล่างต้องผ่าน confirm ไม่ยิง onDelete ตรง ๆ', () => {
    // เดิมเป็น onClick={() => onDelete(conv.id)} คือลบทันทีที่คลิกโดน
    expect(SRC).not.toContain('onClick={() => onDelete(conv.id)}')
    const fn = SRC.slice(SRC.indexOf('const handleDeleteEdge'), SRC.indexOf('const edgePath'))
    expect(fn).toContain('confirm(')
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
