import { describe, it, expect } from 'vitest'
import SalesSource from './Sales.tsx?raw'
import thJson from '../i18n/locales/th/translation.json'
import enJson from '../i18n/locales/en/translation.json'

const SRC: string = SalesSource

describe('Sales.tsx — i18n placeholders guard (ป้องกันบั๊กข้อความหลุด {{...}})', () => {
  it('pendingDelivery (สถานะค้างส่ง) ต้องส่ง { count: order.pending_qty } ครบทั้งแบบตารางและการ์ด', () => {
    // ต้องไม่เรียก t('sales.statusBadge.pendingDelivery') แบบลอย ๆ โดยไม่ส่ง count
    expect(SRC).not.toMatch(/t\('sales\.statusBadge\.pendingDelivery'\)\s*\}\s*\{order\.pending_qty\}/)
    expect(SRC).not.toMatch(/\$\{t\('sales\.statusBadge\.pendingDelivery'\)\}\s*\$\{order\.pending_qty\}/)

    // ต้องส่ง { count: order.pending_qty }
    const matches = SRC.match(/t\('sales\.statusBadge\.pendingDelivery',\s*\{\s*count:\s*order\.pending_qty\s*\}\)/g) || []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  it('shiftOpened (เปิดกะสำเร็จ) ต้องส่ง { number: ... } ไม่ต่อ string ดิบ', () => {
    expect(SRC).not.toMatch(/`\$\{t\('sales\.toast\.shiftOpened'\)\}:/)
    expect(SRC).toContain("t('sales.toast.shiftOpened', { number: data.data.shift_number })")
  })

  it('openSince (เปิดตั้งแต่...) ต้องส่ง { time: ... } ไม่ปล่อยให้หลุด {{time}}', () => {
    expect(SRC).not.toMatch(/t\('sales\.pos\.openSince'\)\}\s*\{fmtDT/)
    expect(SRC).toContain("t('sales.pos.openSince', { time: fmtDT(posCurrentShift.opened_at) })")
  })

  it('titleConvert (แปลง QT -> SO) ต้องส่ง { quotation: ... }', () => {
    expect(SRC).toContain("t('sales.orderModal.titleConvert', { quotation: sourceQuotation.quotation_number")
  })

  it('withholdingTax (หัก ณ ที่จ่าย) ต้องส่ง { type, rate } ไม่หลุด {{type}} {{rate}}%', () => {
    expect(SRC).not.toMatch(/t\('sales\.invoiceDetail\.withholdingTax'\)\}\s*\{w\.tax_type\}/)
    expect(SRC).toContain("t('sales.invoiceDetail.withholdingTax', { type: w.tax_type, rate: w.tax_rate })")
  })
})

describe('Sales — ตรวจสอบความสมบูรณ์ของคีย์แปลภาษา (th & en)', () => {
  const getNestedKey = (obj: any, path: string) => {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj)
  }

  const requiredKeys = [
    'sales.statusBadge.pendingDelivery',
    'sales.toast.shiftOpened',
    'sales.pos.openSince',
    'sales.orderModal.titleConvert',
    'sales.invoiceDetail.withholdingTax',
    'sales.validation.amountExceedsBalance',
    'sales.validation.cashAmount',
    'sales.validation.itemValues',
    'sales.pos.loadShiftFailed',
    'sales.pos.loadingShift',
    'sales.toast.loadProductsFailed',
    'sales.creditNoteModal.discountAmountLabel',
  ]

  it('คีย์ที่จำเป็นต้องมีค่าทั้งใน th/translation.json และ en/translation.json', () => {
    for (const key of requiredKeys) {
      const thVal = getNestedKey(thJson, key)
      const enVal = getNestedKey(enJson, key)
      expect(thVal, `Missing TH key: ${key}`).toBeTruthy()
      expect(enVal, `Missing EN key: ${key}`).toBeTruthy()
    }
  })
})

describe('Sales.tsx — การเดินสถานะเอกสาร (Workflow Status Guards)', () => {
  it('doNextStatus (ใบส่งของ) ต้องมี DRAFT -> READY -> SHIPPED -> DELIVERED', () => {
    expect(SRC).toMatch(/DRAFT:\s*\{\s*status:\s*'READY'/)
    expect(SRC).toMatch(/READY:\s*\{\s*status:\s*'SHIPPED'/)
    expect(SRC).toMatch(/SHIPPED:\s*\{\s*status:\s*'DELIVERED'/)
  })

  it('qtNextStatus (ใบเสนอราคา) ต้องมี DRAFT -> SENT -> ACCEPTED', () => {
    expect(SRC).toMatch(/DRAFT:\s*\{\s*status:\s*'SENT'/)
    expect(SRC).toMatch(/SENT:\s*\{\s*status:\s*'ACCEPTED'/)
  })
})
