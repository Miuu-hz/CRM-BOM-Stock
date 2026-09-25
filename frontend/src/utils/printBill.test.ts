import { describe, it, expect } from 'vitest'
import { resolveBillType } from './printBill'
import { BILL_CONFIGS } from '../components/bill/BillContext'

/**
 * ม.86/6: สลิปหน้าร้านที่เก็บ VAT ต้องมีคำว่า "ใบกำกับภาษี" เด่นชัด
 * เดิมสลิปพิมพ์หัวว่า "ใบเสร็จรับเงิน" ทั้งที่เก็บ VAT — ลูกค้าเอาไปใช้ไม่ได้
 */
describe('ชนิดเอกสารของสลิป POS', () => {
  it('เก็บ VAT → ใบกำกับภาษีอย่างย่อ', () => {
    expect(resolveBillType('pos', { tax_amount: 7 })).toBe('TAX_INVOICE_ABB')
    expect(BILL_CONFIGS.TAX_INVOICE_ABB.title.th).toContain('ใบกำกับภาษี')
  })

  it('ไม่เก็บ VAT → ใบเสร็จรับเงินตามเดิม', () => {
    expect(resolveBillType('pos', { tax_amount: 0 })).toBe('RECEIPT')
    expect(resolveBillType('pos', {})).toBe('RECEIPT')
  })

  it('ออกใบกำกับเต็มรูปแทนแล้ว → สลิปเลิกเป็นใบกำกับภาษี (การขายครั้งเดียวมีใบกำกับได้ใบเดียว)', () => {
    expect(resolveBillType('pos', { tax_amount: 7, _supersededBy: 'INV-00001' })).toBe('RECEIPT')
  })

  it('เอกสารชนิดอื่นไม่ถูกแตะ', () => {
    expect(resolveBillType('inv', { tax_amount: 100 })).toBe('INVOICE')
    expect(resolveBillType('rc', { tax_amount: 100 })).toBe('RECEIPT')
  })
})
