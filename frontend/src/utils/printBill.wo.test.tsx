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

  it('พิมพ์ A4 เมื่อยังไม่มีล็อต แสดงแถวว่าง 3 แถวสำหรับจดหน้างาน และไม่ใช้คลาส wo-materials-table', () => {
    const html = renderToStaticMarkup(createElement(UnifiedBillTemplate as any, {
      config: BILL_CONFIGS.WORK_ORDER, data, size: 'A4', showPrintButton: false,
    }))
    expect(html).toContain('wo-lots-table')
    expect(html).toContain('บันทึกการผลิตตามล็อต (Production Lots)')
    expect(html).not.toContain('class="wo-materials-table wo-lots-table"')
    // A5 ไม่แสดงแถวว่างเมื่อยังไม่มีล็อต
    const htmlA5 = renderToStaticMarkup(createElement(UnifiedBillTemplate as any, {
      config: BILL_CONFIGS.WORK_ORDER, data, size: 'A5', showPrintButton: false,
    }))
    expect(htmlA5).not.toContain('wo-lots-table')
  })

  it('toBillData และ UnifiedBillTemplate แสดงประวัติล็อตเมื่อมีข้อมูลทั้ง A4 และ A5', () => {
    const woWithLots = {
      ...WO,
      produced_qty: 40,
      lot_scrap_qty: 2,
      lots: [
        { id: 'l1', lot_number: 'WO-001-L01', good_qty: 40, scrap_qty: 2, recorded_by: 'staff@test.com', notes: 'กะเช้า', created_at: '2026-11-25T08:30:00Z' },
      ],
    }
    const billData = toBillData('wo', woWithLots)
    expect(billData.woCompletedQty).toBe(40)
    expect(billData.woScrapQty).toBe(2)
    expect(billData.woLots).toHaveLength(1)

    for (const size of ['A4', 'A5'] as const) {
      const html = renderToStaticMarkup(createElement(UnifiedBillTemplate as any, {
        config: BILL_CONFIGS.WORK_ORDER, data: billData, size, showPrintButton: false,
      }))
      expect(html).toContain('wo-lots-table')
      expect(html).toContain('WO-001-L01')
      expect(html).toContain('staff@test.com')
      expect(html).toContain('กะเช้า')
    }
  })
})
