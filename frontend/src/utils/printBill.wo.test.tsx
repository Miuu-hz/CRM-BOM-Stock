import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import UnifiedBillTemplate from '../components/bill/UnifiedBillTemplate'
import { BILL_CONFIGS } from '../components/bill/BillContext'
import { toBillData } from './printBill'

const WO = {
  id: 'w1', wo_number: 'WO-001', product_name: 'หมอนข้าง', finished_sku: 'FG-1', quantity: 100, completed_qty: 0, unit: 'pcs',
  status: 'PLANNED', priority: 'HIGH', assigned_to: 'ทีมเย็บ', so_number: 'SO-9', notes: 'ใช้ด้ายขาว',
  due_date: '2026-12-01', created_at: '2026-11-25T01:00:00Z',
  materials: [{ id: 'm1', material_name: 'ใยโพลี', sku: 'POLY-1', required_qty: 1500, issued_qty: 0, unit: 'g', stockStatus: 'short', stockQty: 1, stockUnit: 'kg', shortQty: 0.5 }],
}

describe('พิมพ์ใบสั่งผลิต', () => {
  const data = toBillData('wo', WO)

  it('วัตถุดิบกลายเป็นรายการ พร้อมสถานะสต็อก', () => {
    expect(data.items[0]).toMatchObject({ name: 'ใยโพลี', quantity: 1500, unit: 'g', stockStatus: 'short', stockShort: 0.5 })
    expect(data).toMatchObject({ woQty: 100, refNumber: 'SO-9', buyer: { name: 'ทีมเย็บ' }, docNumber: 'WO-001' })
  })

  it('CSS ในหน้าพิมพ์ไม่ถูก escape (ฟอนต์/ตัวเลือก > ยังทำงาน)', () => {
    const html = renderToStaticMarkup(createElement(UnifiedBillTemplate as any, { config: BILL_CONFIGS.WORK_ORDER, data, size: 'A4' }))
    expect(html).toContain("font-family: 'Sarabun'")
    expect(html).toContain('.bill-closing > .bill-footer')
  })

  it('ใบพิมพ์ใช้คำของใบสั่งผลิต ไม่ใช้ช่องเซ็น/หมายเหตุของบิลขาย', () => {
    const html = renderToStaticMarkup(createElement(UnifiedBillTemplate as any, {
      config: BILL_CONFIGS.WORK_ORDER, data, size: 'A5', showPrintButton: false,
      settings: { signatureSlots: ['ผู้รับเอกสาร (ลูกค้า)'], footerNote: 'ขอบคุณที่อุดหนุน' },
    }))
    for (const t of ['กำหนดเสร็จ', 'หัวหน้าฝ่ายผลิต', 'ใช้ด้ายขาว', 'ขาด 0.5', 'POLY-1', 'หมอนข้าง (FG-1)']) expect(html).toContain(t)
    for (const t of ['ครบกำหนดชำระ', 'ขอบคุณที่อุดหนุน', 'ผู้รับเอกสาร (ลูกค้า)', 'ผู้ขาย :']) expect(html).not.toContain(t)
  })
})
