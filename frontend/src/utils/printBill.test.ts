import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveBillType, toBillData, waitForLayout } from './printBill'
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

  it('ไม่เก็บ VAT → ใบเสร็จรับเงิน (ไม่มีช่องเลขภาษีผู้ซื้อ)', () => {
    expect(resolveBillType('pos', { tax_amount: 0 })).toBe('RECEIPT_NO_VAT')
    expect(resolveBillType('pos', {})).toBe('RECEIPT_NO_VAT')
    expect(BILL_CONFIGS.RECEIPT_NO_VAT.title.th).toBe('ใบเสร็จรับเงิน')
  })

  it('ออกใบกำกับเต็มรูปแทนแล้ว → สลิปเลิกเป็นใบกำกับภาษี (การขายครั้งเดียวมีใบกำกับได้ใบเดียว)', () => {
    expect(resolveBillType('pos', { tax_amount: 7, _supersededBy: 'INV-00001' })).toBe('RECEIPT')
  })

  it('เอกสารชนิดอื่นไม่ถูกแตะ', () => {
    expect(resolveBillType('so', { tax_amount: 100 })).toBe('SALE')
    expect(resolveBillType('qt', { tax_amount: 0 })).toBe('QUOTATION')
  })
})

/** กิจการจด VAT เลือก มี/ไม่มี VAT ได้รายใบ — ไม่มี VAT ห้ามมีคำว่าใบกำกับภาษี · มี VAT ห้ามมีใบกำกับ 2 ใบต่อการขาย */
describe('ชื่อเอกสารขายตาม VAT ของใบ', () => {
  const title = (t: Parameters<typeof resolveBillType>[0], d: any) => BILL_CONFIGS[resolveBillType(t, d)]
  const noTaxWording = (c: { title: { th: string; en: string } }) => {
    expect(c.title.th).not.toContain('ภาษี')
    expect(c.title.en).not.toMatch(/TAX/i)
  }

  it('ขายเชื่อมี VAT: ใบแจ้งหนี้/ใบกำกับภาษี แล้วใบเสร็จรับเงินธรรมดา', () => {
    expect(title('inv', { tax_amount: 70 }).title.th).toBe('ใบแจ้งหนี้ / ใบกำกับภาษี')
    expect(title('rc', { invoice_tax_amount: 70 }).title.th).toBe('ใบเสร็จรับเงิน')
    expect(title('rc', { invoice_tax_amount: 70 }).fields.showBuyerTaxId).toBe(true)
    // ผู้เรียกเก่าที่ไม่ได้ส่งยอด VAT ต้นทาง → คงพฤติกรรมเดิม
    expect(resolveBillType('rc', {})).toBe('RECEIPT')
  })

  it('ขายเชื่อไม่มี VAT: ใบแจ้งหนี้ + ใบเสร็จรับเงิน ไม่มีคำว่าใบกำกับภาษีและไม่มีเลขภาษีผู้ซื้อ', () => {
    const inv = title('inv', { tax_amount: 0 })
    expect(inv.title.th).toBe('ใบแจ้งหนี้')
    noTaxWording(inv)
    expect(inv.fields.showBuyerTaxId).toBe(false)
    const rc = title('rc', { invoice_tax_amount: 0 })
    expect(rc.title.th).toBe('ใบเสร็จรับเงิน')
    noTaxWording(rc)
    expect(rc.fields.showBuyerTaxId).toBe(false)
  })

  it('ใบเต็มรูปจากบิล POS (รับเงินแล้ว): มี VAT = ใบกำกับภาษี/ใบเสร็จรับเงินใบเดียว · ไม่มี VAT = ใบเสร็จรับเงิน', () => {
    const vatInv = title('inv', { tax_amount: 7, pos_bill_id: 'b1' })
    expect(vatInv.title.th).toBe('ใบกำกับภาษี / ใบเสร็จรับเงิน')
    expect(vatInv.fields.showBuyerTaxId).toBe(true)
    // สลิปเดิมของบิลเดียวกันต้องไม่เป็นใบกำกับภาษีอีก
    expect(title('pos', { tax_amount: 7, _supersededBy: 'INV-1' }).title.th).not.toContain('ใบกำกับภาษี')
    const noVat = title('inv', { tax_amount: 0, pos_bill_id: 'b1' })
    expect(noVat.title.th).toBe('ใบเสร็จรับเงิน')
    noTaxWording(noVat)
  })

  it('ใบพิมพ์ A4 ที่ไม่มี VAT ไม่มีถ้อยคำภาษีเลย (ยกเว้นเลขภาษีผู้ขาย)', () => {
    const d = { invoice_number: 'INV-1', tax_amount: 0, total_amount: 100, subtotal: 100, customer_tax_id: '0105555555555',
      items: [{ product_name: 'หมอน', quantity: 1, unit_price: 100, total_price: 100 }] }
    const html = renderToStaticMarkup(createElement(UnifiedBillTemplate as any, {
      config: BILL_CONFIGS[resolveBillType('inv', d)], data: toBillData('inv', d), size: 'A4', showPrintButton: false,
    })).replace(/<style[\s\S]*?<\/style>/g, '')
    expect(html).toContain('ใบแจ้งหนี้')
    expect(html).not.toContain('ใบกำกับภาษี')
    expect(html).not.toContain('ภาษีมูลค่าเพิ่ม')
    expect(html).not.toContain('0105555555555')
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

describe('ค่าขนส่งบนใบแจ้งหนี้ไม่ซ้ำ', () => {
  const base = { invoice_number: 'INV-1', subtotal: 500, extra_charge_amount: 50, extra_charge_label: 'ค่าขนส่ง', tax_amount: 0, total_amount: 550 }
  const goods = { id: 'a', product_name: 'สินค้า', quantity: 5, unit_price: 100, total_price: 500 }

  it('invoice_items มีบรรทัดค่าขนส่งอยู่แล้ว → ไม่เติมแถวซ้ำ และยอดรวมย่อย = สินค้า + ค่าขนส่ง', () => {
    const bill = toBillData('inv', { ...base, items: [goods, { id: 'b', product_name: 'ค่าขนส่ง', quantity: 1, unit_price: 50, total_price: 50 }] })
    expect(bill.items.filter(i => i.name === 'ค่าขนส่ง')).toHaveLength(1)
    expect(bill.items).toHaveLength(2)
    expect(bill.subtotal).toBe(550)
  })

  it('ใบสั่งขาย/ใบเสนอราคาที่ items ไม่มีบรรทัดค่าขนส่ง → ยังเติมแถวให้ครั้งเดียว', () => {
    const bill = toBillData('so', { ...base, items: [goods] })
    expect(bill.items.filter(i => i.name === 'ค่าขนส่ง')).toHaveLength(1)
    expect(bill.items).toHaveLength(2)
  })

  it('ป้ายกำกับที่ตั้งเอง (เช่น ค่าส่งด่วน) ก็ตรวจซ้ำได้', () => {
    const bill = toBillData('inv', { ...base, extra_charge_label: 'ค่าส่งด่วน', items: [goods, { id: 'b', product_name: 'ค่าส่งด่วน', quantity: 1, unit_price: 50, total_price: 50 }] })
    expect(bill.items).toHaveLength(2)
  })
})

describe('ใบเสร็จมีรายการสินค้าจากใบแจ้งหนี้', () => {
  const items = [{ product_name: 'หมอนอิง สีขาว', quantity: 20, unit: 'pcs', unit_price: 150, total_price: 3000 }]
  it('จ่ายครบ: แสดงรายการ ยอดรวม = ยอดรับ', () => {
    const d = toBillData('rc', { receipt_number: 'RC-1', amount: 3000, items, subtotal: 3000 })
    expect(d.items.map(i => i.name)).toEqual(['หมอนอิง สีขาว'])
    expect(d.total).toBe(3000)
  })
  it('จ่ายบางส่วน: ยังแสดงรายการ แต่ยอดรวมเป็นยอดที่รับจริง ไม่ใช่ยอดเต็มใบ', () => {
    const d = toBillData('rc', { receipt_number: 'RC-2', amount: 1000, items, notes: 'ชำระบางส่วน' })
    expect(d.items).toHaveLength(1)
    expect(d.total).toBe(1000)
  })
})

describe('waitForLayout หน่วงคงที่ก่อนพิมพ์', () => {
  it('รอ 0.8 วิ ไม่ขึ้นกับความสูงหน้า', async () => {
    const t = Date.now()
    await waitForLayout({} as Window)
    const ms = Date.now() - t
    expect(ms).toBeGreaterThanOrEqual(790)
    expect(ms).toBeLessThan(1500)
  })
})

// ข้อมูลนำเข้ามี "ไม่มี " ติดหน้าชื่อ และ "-" แทนช่องว่าง — บิลต้องเว้นว่าง ไม่พิมพ์คำพวกนี้ออกไป
describe('ช่องลูกค้าว่าง', () => {
  it('ตัด "ไม่มี" และ "-" ออกจากข้อมูลลูกค้า', () => {
    const b = toBillData('qt', {
      quotation_number: 'QT-1', customer_name: 'ไม่มี ศูนย์ฝึกอบรม ภาค6',
      customer_phone: '-', customer_email: '-', customer_address: 'ไม่มี', items: [],
    }).buyer
    expect(b.name).toBe('ศูนย์ฝึกอบรม ภาค6')
    expect(b.tel).toBe('')
    expect(b.email).toBeUndefined()
    expect(b.address).toBe('')
    expect(toBillData('qt', { customer_name: 'ไม่มี', items: [] }).buyer.name).toBe('')
  })
})
