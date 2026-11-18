import { describe, it, expect } from 'vitest'
import { invoiceTitle } from './receipt.routes'

// หน้าดูเอกสารออนไลน์ต้องใช้ชื่อเดียวกับใบพิมพ์ — ไม่มี VAT ห้ามมีคำว่าใบกำกับภาษี
describe('ชื่อใบแจ้งหนี้บนหน้าดูออนไลน์', () => {
  it('ขายเชื่อ: มี VAT = ใบแจ้งหนี้/ใบกำกับภาษี · ไม่มี VAT = ใบแจ้งหนี้', () => {
    expect(invoiceTitle({ tax_amount: 70 })).toBe('ใบแจ้งหนี้ / ใบกำกับภาษี')
    expect(invoiceTitle({ tax_amount: 0 })).toBe('ใบแจ้งหนี้')
    expect(invoiceTitle({})).toBe('ใบแจ้งหนี้')
  })
  it('ออกจากบิล POS (รับเงินแล้ว): มี VAT = ใบกำกับภาษี/ใบเสร็จรับเงิน · ไม่มี VAT = ใบเสร็จรับเงิน', () => {
    expect(invoiceTitle({ tax_amount: 7, pos_bill_id: 'b1' })).toBe('ใบกำกับภาษี / ใบเสร็จรับเงิน')
    expect(invoiceTitle({ tax_amount: 0, pos_bill_id: 'b1' })).toBe('ใบเสร็จรับเงิน')
  })
})
