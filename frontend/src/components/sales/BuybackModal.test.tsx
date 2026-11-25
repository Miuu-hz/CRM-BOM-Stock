import { createElement } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BuybackModal, defaultSellerVat } from './BuybackModal'
import UnifiedBillTemplate from '../bill/UnifiedBillTemplate'
import { BILL_CONFIGS } from '../bill/BillContext'
import { resolveBillType, toBillData } from '../../utils/printBill'
import stockService from '../../services/stock'
import salesService from '../../services/sales.service'
import toast from 'react-hot-toast'

vi.mock('../../services/stock', () => ({
  default: {
    getAll: vi.fn(),
  },
}))

vi.mock('../../services/sales.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/sales.service')>()
  return {
    ...actual,
    default: {
      ...actual.default,
      getCustomerCredits: vi.fn(),
      createBuyback: vi.fn(),
    },
  }
})

vi.mock('../../services/companySettings.service', () => ({
  getCachedCompanySettings: () => ({ vat_registered: 1, name: 'บจก. ทดสอบ' }),
}))

vi.mock('../../hooks/useUnits', () => ({
  useUnits: () => ({
    units: [{ value: 'pcs', label: 'ชิ้น', category: 'count', aliases: [] }],
    specials: [],
    loading: false,
  }),
  unitLabel: (u: string) => (u === 'pcs' ? 'ชิ้น' : u),
  unitLabelOf: (u: string) => (u === 'pcs' ? 'ชิ้น' : u),
  unitCategoryOf: () => 'count',
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue || key,
  }),
}))

describe('BuybackModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(stockService.getAll).mockResolvedValue([
      {
        id: 'st-1',
        sku: 'FG-001',
        name: 'หมอนหนุน',
        category: 'FINISHED',
        quantity: 10,
        unit: 'pcs',
        baseUnit: 'pcs',
        minStock: 0,
        maxStock: 0,
        location: '',
        unitPrice: 500,
        status: 'ADEQUATE',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'st-svc',
        sku: 'SVC-01',
        name: 'ค่าขนส่ง',
        category: 'SERVICE',
        quantity: 0,
        unit: 'pcs',
        minStock: 0,
        maxStock: 0,
        location: '',
        unitPrice: 100,
        status: 'ADEQUATE',
        createdAt: '',
        updatedAt: '',
      },
    ])
  })

  it('defaultSellerVat เป็น true เฉพาะเลขผู้เสียภาษี 13 หลักขึ้นต้นด้วย 0', () => {
    expect(defaultSellerVat('0105555123456')).toBe(true)
    expect(defaultSellerVat('1100555123456')).toBe(false)
    expect(defaultSellerVat('01055')).toBe(false)
    expect(defaultSellerVat(null)).toBe(false)
  })

  it('คำนวณยอด calcVat, เติมอัตโนมัติเรียงบิลเก่าก่อน, และแสดง error จาก server', async () => {
    let rejectCreate!: (e: any) => void
    vi.mocked(salesService.createBuyback).mockImplementation(
      () => new Promise((_, rej) => { rejectCreate = rej }),
    )

    render(
      <BuybackModal
        customer={{ id: 'c1', code: 'C-01', name: 'บจก. ลูกค้า', taxId: '0105555123456' }}
        openInvoices={[
          {
            id: 'inv-new',
            invoice_number: 'INV-NEW',
            invoice_date: '2026-10-20',
            total_amount: 1000,
            balance_amount: 800,
            status: 'ISSUED',
            payment_status: 'UNPAID',
          },
          {
            id: 'inv-old',
            invoice_number: 'INV-OLD',
            invoice_date: '2026-10-01',
            total_amount: 700,
            balance_amount: 700,
            status: 'ISSUED',
            payment_status: 'UNPAID',
          },
        ]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )

    // default sellerVat = true เพราะ taxId 13 หลักขึ้นต้นด้วย 0
    expect(screen.getByPlaceholderText('เช่น INV-...')).toBeTruthy()
    expect(screen.getByText(/ลูกค้าผู้ขายคืนต้องออกใบกำกับภาษีขาย/)).toBeTruthy()

    // เลือกสินค้า (และตรวจว่า SERVICE ไม่โผล่ในตัวเลือก)
    await waitFor(() => expect(stockService.getAll).toHaveBeenCalled())
    fireEvent.click(screen.getByText('ค้นหาสินค้า...'))
    expect(screen.getByText('FG-001 · หมอนหนุน')).toBeTruthy()
    expect(screen.queryByText('SVC-01 · ค่าขนส่ง')).toBeNull()
    fireEvent.mouseDown(screen.getByText('FG-001 · หมอนหนุน'))

    // จำนวน 2 × 500 = 1,000 + VAT 7% = 1,070.00
    const qtyInput = screen.getByDisplayValue('1') as HTMLInputElement
    fireEvent.change(qtyInput, { target: { value: '2' } })
    expect(screen.getAllByText('฿1,070.00')[0]).toBeTruthy()

    // เติมอัตโนมัติ (บิลเก่าสุด INV-OLD ได้ 700 ก่อน, INV-NEW ได้ส่วนที่เหลือ 370)
    fireEvent.click(screen.getByRole('button', { name: /เติมอัตโนมัติ/ }))
    const oldInput = screen.getByLabelText('หักบิล INV-OLD') as HTMLInputElement
    const newInput = screen.getByLabelText('หักบิล INV-NEW') as HTMLInputElement
    expect(oldInput.value).toBe('700')
    expect(newInput.value).toBe('370')
    expect(screen.getByTestId('remaining-credit').textContent).toBe('฿0.00')

    // กรอกเลขที่ใบกำกับภาษีแล้วกดบันทึก → ปุ่ม disabled ระหว่างบันทึก + toast error เมื่อ server พลาด
    fireEvent.change(screen.getByPlaceholderText('เช่น INV-...'), { target: { value: 'TAX-999' } })
    const submitBtn = screen.getByRole('button', { name: /บันทึกรับซื้อคืน/ }) as HTMLButtonElement
    fireEvent.click(submitBtn)
    expect(submitBtn.disabled).toBe(true)

    rejectCreate({ response: { data: { message: 'เลขที่ใบกำกับภาษีซ้ำ' } } })
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('เลขที่ใบกำกับภาษีซ้ำ')
    })
    expect(submitBtn.disabled).toBe(false)
  })
})

describe('พิมพ์ใบลดหนี้ (ป.80/2542), ใบรับซื้อคืน (bb), และใบหักกลบ (of)', () => {
  it('CREDIT_NOTE แสดงเลขที่/วันที่ใบเดิม, มูลค่าเดิม, มูลค่าถูกต้อง, ผลต่าง, VAT และเหตุผล', () => {
    const raw = {
      id: 'cn-1',
      cn_number: 'CN-2026-0001',
      credit_date: '2026-11-20',
      invoice_number: 'INV-2026-0009',
      original_invoice_date: '2026-10-15',
      original_value: 5000,
      correct_value: 4000,
      difference: 1000,
      vat: 70,
      subtotal: 1000,
      tax_amount: 70,
      total_amount: 1070,
      reason_code: 'DEFECTIVE',
      reason: 'สินค้าชำรุด 2 ชิ้น',
      customer_name: 'บจก. เอ',
      customer_tax_id: '0105555123456',
      items: [{ id: '1', product_name: 'หมอน', quantity: 2, unit: 'pcs', unit_price: 500, total_price: 1000 }],
    }
    const html = renderToStaticMarkup(createElement(UnifiedBillTemplate as any, {
      config: BILL_CONFIGS[resolveBillType('cn', raw)],
      data: toBillData('cn', raw),
      size: 'A4',
      showPrintButton: false,
    })).replace(/<style[\s\S]*?<\/style>/g, '')

    expect(html).toContain('INV-2026-0009')
    expect(html).toContain('15 ตุลาคม 2569')
    expect(html).toContain('5,000.00')
    expect(html).toContain('4,000.00')
    expect(html).toContain('1,000.00')
    expect(html).toContain('70.00')
    expect(html).toContain('สินค้าชำรุด/บกพร่อง')
    expect(html).toContain('สินค้าชำรุด 2 ชิ้น')
  })

  it('bb (ใบรับซื้อคืน) มีช่องเซ็นผู้ขาย/ผู้จ่าย/ผู้อนุมัติ และห้ามมีคำว่า ใบกำกับภาษี เด็ดขาด', () => {
    const raw = {
      id: 'bb-1',
      bb_number: 'BB-2026-0001',
      buyback_date: '2026-11-20',
      seller_vat: 1,
      tax_invoice_number: 'S-001',
      tax_invoice_date: '2026-11-20',
      subtotal: 1000,
      tax_amount: 70,
      total_amount: 1070,
      approved_by: 'ผู้จัดการเอ',
      seller_id_doc: 'บัตร ปชช. XXXX',
      customer_name: 'ร้านบี',
      customer_tax_id: '0105555123456',
      items: [{ id: '1', product_name: 'หมอน', quantity: 2, unit: 'pcs', unit_price: 500, total_price: 1000 }],
    }
    const html = renderToStaticMarkup(createElement(UnifiedBillTemplate as any, {
      config: BILL_CONFIGS[resolveBillType('bb', raw)],
      data: toBillData('bb', raw),
      size: 'A4',
      showPrintButton: false,
      settings: { signatureSlots: ['ไม่ควรทับช่องเซ็นของใบรับซื้อคืน'] },
    })).replace(/<style[\s\S]*?<\/style>/g, '')

    expect(html).toContain('ใบรับซื้อคืนสินค้า / ใบสำคัญรับเงิน')
    expect(html).toContain('ผู้ขายคืน (ผู้รับเงิน)')
    expect(html).toContain('ผู้จ่ายเงิน')
    expect(html).toContain('ผู้อนุมัติ')
    expect(html).not.toContain('ใบกำกับภาษี')
  })

  it('of (ใบหักกลบลบหนี้) แสดงแหล่งเครดิต, รายการบิล, ช่องเซ็นทั้งสองฝ่าย และรองรับ billPaginate (col-total)', () => {
    const raw = {
      id: 'of-1',
      offset_number: 'OF-2026-0001',
      offset_date: '2026-11-21',
      kind: 'APPLY',
      source_type: 'BUYBACK',
      source_number: 'BB-2026-0001',
      total_amount: 1070,
      customer_name: 'ร้านบี',
      lines: [
        { id: 'l1', invoice_number: 'INV-001', amount: 700 },
        { id: 'l2', invoice_number: 'INV-002', amount: 370 },
      ],
    }
    const html = renderToStaticMarkup(createElement(UnifiedBillTemplate as any, {
      config: BILL_CONFIGS[resolveBillType('of', raw)],
      data: toBillData('of', raw),
      size: 'A4',
      showPrintButton: false,
    })).replace(/<style[\s\S]*?<\/style>/g, '')

    expect(html).toContain('ใบหักกลบลบหนี้')
    expect(html).toContain('BB-2026-0001')
    expect(html).toContain('INV-001')
    expect(html).toContain('700.00')
    expect(html).toContain('INV-002')
    expect(html).toContain('370.00')
    expect(html).toContain('ผู้รับทราบ (ลูกค้า)')
    expect(html).toContain('class="col-total"')
  })
})
