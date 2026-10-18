import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveBillType, toBillData } from './printBill'
import UnifiedBillTemplate from '../components/bill/UnifiedBillTemplate'
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

describe('สลิป 80mm', () => {
  const render = (d: any) => renderToStaticMarkup(createElement(UnifiedBillTemplate as any, {
    config: BILL_CONFIGS[resolveBillType('pos', d)], data: toBillData('pos', d), size: 'THERMAL', showPrintButton: false,
  }))
  const items = [{ id: '1', product_name: 'ข้าว', quantity: 1, unit_price: 413, total_price: 413 }]

  it('ร้านไม่เก็บ VAT: ไม่พิมพ์มูลค่าก่อน VAT · ลูกค้าขาจรใช้ชื่อบิล (เลขโต๊ะ) · ไม่มี QR ดูใบเสร็จ', () => {
    const html = render({ bill_number: 'POS-1', display_name: 'โต๊ะ 5', items, subtotal: 413, tax_amount: 0, total_amount: 413, _vatInclusive: true, receipt_qr: 'data:image/png;base64,AAAA' })
    expect(html).not.toContain('มูลค่าก่อน VAT')
    expect(html).not.toContain('รวมภาษีมูลค่าเพิ่มแล้ว')
    expect(html).toContain('โต๊ะ 5')
    expect(html).not.toContain('base64,AAAA')
  })

  it('ร้านเก็บ VAT มีส่วนลด: ฐาน = ยอด − ส่วนลด และ ฐาน + VAT = รวม · สมาชิก CRM ใช้ชื่อจริง', () => {
    // บวก VAT: 413 − 13 = 400, VAT 28, รวม 428
    const html = render({ bill_number: 'POS-2', display_name: 'โต๊ะ 5', customer_name: 'คุณเอ', items, subtotal: 413, discount_amount: 13, tax_amount: 28, total_amount: 428 })
    expect(html).toContain('400.00')
    expect(html).toContain('28.00')
    expect(html).toContain('428.00')
    expect(html).toContain('คุณเอ')
    expect(html).not.toContain('โต๊ะ 5')
  })
})
