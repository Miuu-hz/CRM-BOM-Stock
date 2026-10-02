import { describe, it, expect } from 'vitest'
import { upstreamRefs } from './printBill'

const chain = [
  { kind: 'PURCHASE_REQUEST', number: 'PR-001', status: 'APPROVED' },
  { kind: 'PURCHASE_ORDER', number: 'PO-003', status: 'RECEIVED' },
  { kind: 'PURCHASE_ORDER', number: 'PO-004', status: 'CANCELLED' },
  { kind: 'GOODS_RECEIPT', number: 'GR-007', status: 'CONFIRMED' },
  { kind: 'PURCHASE_INVOICE', number: 'PI-002', status: 'ISSUED' },
]

// Phase 2: หัวเอกสารพิมพ์เลขต้นสายทุกใบ ใกล้สุดก่อน ไม่นับใบยกเลิก และไม่นับใบที่อยู่ปลายสาย
describe('upstreamRefs', () => {
  it('GR อ้างอิง PO แล้วค่อย PR · ไม่เอา PO ที่ยกเลิก · ไม่เอา PI ที่อยู่หลังตัวเอง', () => {
    expect(upstreamRefs('GOODS_RECEIPT', chain)).toEqual({ text: 'PO-003 · PR-001', mixedKinds: true })
  })
  it('PO อ้างอิงแค่ PR → ใช้ป้ายเฉพาะของชนิดนั้นได้', () => {
    expect(upstreamRefs('PURCHASE_ORDER', chain)).toEqual({ text: 'PR-001', mixedKinds: false })
  })
  it('ใบต้นสายไม่มีอะไรให้อ้างอิง', () => {
    expect(upstreamRefs('PURCHASE_REQUEST', chain)).toBeNull()
  })
  it('เลขเกิน 4 ใบย่อเป็น +N', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ kind: 'PURCHASE_ORDER', number: 'PO-' + i, status: 'APPROVED' }))
    expect(upstreamRefs('PURCHASE_INVOICE', many)?.text).toBe('PO-0 · PO-1 · PO-2 · PO-3 +2')
  })
})
