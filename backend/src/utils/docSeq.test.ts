import { describe, it, expect } from 'vitest'
import { docSeqOf, seqBucket } from './docSeq'

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

describe('seqBucket — เริ่ม 001 ใหม่ตามรอบ', () => {
  const d = new Date(2026, 9, 16)
  it('ค่าเดิม (ไม่ตั้ง) = ต่อเนื่องทั้งปี', () => expect(seqBucket(undefined, 'DDMMYY', d)).toBe(2026))
  it('ทุกวัน', () => expect(seqBucket('DAY', 'DDMMYY', d)).toBe(20261016))
  it('วันถัดไปได้ถังใหม่', () => expect(seqBucket('DAY', 'YYMMDD', new Date(2026, 9, 17))).toBe(20261017))
  it('ทุกเดือน', () => expect(seqBucket('MONTH', 'DDMMYY', d)).toBe(202610))
  it('ทุกวันแต่เลขมีแค่ ดดปป → ถอยเป็นรายเดือน กันเลขชน', () => expect(seqBucket('DAY', 'MMYY', d)).toBe(202610))
  it('เลขมีแค่ปี → รายปี', () => expect(seqBucket('DAY', 'YYYY', d)).toBe(2026))
})
