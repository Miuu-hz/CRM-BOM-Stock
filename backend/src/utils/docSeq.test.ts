import { describe, it, expect } from 'vitest'
import { docSeqOf } from './docSeq'

describe('docSeqOf — seed ตัวนับเลขเอกสาร', () => {
  it('แบบเดิม P-ปี-ลำดับ', () => expect(docSeqOf('PO-2026-00041')).toBe(41))
  it('แบบตั้งค่า P-ลำดับ-DDMMYY ต้องไม่เอาวันที่', () => expect(docSeqOf('GR-037-180926')).toBe(37))
  it('แบบตั้งค่า ลำดับ-YYYY', () => expect(docSeqOf('PO-041-2026')).toBe(41))
  it('ไม่มีวันที่', () => expect(docSeqOf('WO-00008')).toBe(8))
  it('มีคำคั่น', () => expect(docSeqOf('JV-BF-0010')).toBe(10))
  it('เลขเสียจากบั๊กเดิม/timestamp ไม่นับ', () => {
    expect(docSeqOf('GR-180927-180926')).toBeNull()
    expect(docSeqOf('APR-2026-1783503278936')).toBeNull()
  })
  it('ค่าว่าง', () => expect(docSeqOf(null)).toBeNull())
})
