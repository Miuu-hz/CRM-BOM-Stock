import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockPut = vi.fn()

vi.mock('../../services/api', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: (...args: unknown[]) => mockPut(...args),
  },
}))

import OnlineOrders, {
  normalizeOrderRow,
  normalizeUnlinkedRow,
  summarizeRows,
} from './OnlineOrders'
import PlatformSettlement from './PlatformSettlement'

const summaryFixture = [
  {
    key: 'กรุงเทพมหานคร',
    label: 'กรุงเทพมหานคร',
    orders: 12,
    qty: 18,
    qtyReturned: 1,
    sales: 5400,
    returnsValue: 300,
    netSales: 5100,
  },
  {
    key: 'เชียงใหม่',
    label: 'เชียงใหม่',
    orders: 5,
    qty: 7,
    qtyReturned: 0,
    sales: 2100,
    returnsValue: 0,
    netSales: 2100,
  },
]

const ordersFixture = {
  rows: [
    {
      id: 'ord1',
      platform: 'SHOPEE',
      shop_key: 'bebozch',
      order_no: '261123ABC001',
      order_date: '2026-11-20',
      status_raw: 'สำเร็จแล้ว',
      status_group: 'COMPLETED',
      province: 'ชัยภูมิ',
      district: 'อำเภอเมืองชัยภูมิ',
      postal_code: '36000',
      buyer_name_masked: 'ธัชพxxx',
      buyer_phone_masked: '081-234-5xxx',
      address_masked: 'เลขที่ xxx หมู่ที่ 4 ต.รอบเมือง อ.เมืองชัยภูมิ จ.ชัยภูมิ 36000',
      // Ensure raw PII is never displayed even if accidentally returned
      buyer_name: 'ธัชพงษ์ ทดสอบ',
      buyer_phone: '081-234-5678',
      full_address: 'เลขที่ 858/7 หมู่ที่ 4',
      qty: 2,
      qty_returned: 0,
      net_total: 590,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
}

const unlinkedFixture = [
  {
    sourceRef: 'SHOPEE:Nเสื้อยืด||สีขาว',
    productName: 'เสื้อยืด',
    variantName: 'สีขาว',
    qty: 4,
    proposed: {
      stockItemId: 'stk-1',
      sku: 'TSH-WHT',
      stockItemName: 'เสื้อยืดสีขาว',
      factor: 1,
    },
  },
  {
    sourceRef: 'SHOPEE:Nกระเป๋าผ้า||ลายแมว',
    productName: 'กระเป๋าผ้า',
    variantName: 'ลายแมว',
    qty: 2,
    proposed: null,
  },
]

const stockFixture = [
  { id: 'stk-1', sku: 'TSH-WHT', name: 'เสื้อยืดสีขาว', base_unit: 'pcs', quantity: 50 },
  { id: 'stk-2', sku: 'BAG-CAT', name: 'กระเป๋าผ้าลายแมว', base_unit: 'pcs', quantity: 20 },
]

const returnsFixture = [
  {
    id: 'ret-1',
    platform: 'SHOPEE',
    shop_key: 'bebozch',
    order_no: '261015XYZ999',
    order_month: '2026-10',
    product_name: 'เสื้อยืด',
    variant_name: 'สีขาว',
    source_ref: 'SHOPEE:Nเสื้อยืด||สีขาว',
    qty_delta: 1,
    status: 'PENDING',
    detected_at: '2026-11-05T10:00:00Z',
  },
]

const unattributedFixture = [
  {
    productName: 'หมวกแก๊ป',
    variantName: 'สีดำ',
    qtyDelta: 2,
    monthlyQtyReturned: 5,
    orderQtyReturned: 3,
  },
]

function setupDefaultMocks() {
  mockGet.mockImplementation((url: string) => {
    if (url === '/platform-settlement/months') {
      return Promise.resolve({
        data: { success: true, data: [{ id: 'm1', platform: 'SHOPEE', shop_key: 'bebozch', month: '2026-11', status: 'COLLECTING' }] },
      })
    }
    if (url === '/platform-settlement/fee-mappings') {
      return Promise.resolve({ data: { success: true, data: [] } })
    }
    if (url === '/stock') {
      return Promise.resolve({ data: { success: true, data: stockFixture } })
    }
    if (url === '/platform-settlement/online-orders/summary') {
      return Promise.resolve({ data: { success: true, data: summaryFixture } })
    }
    if (url === '/platform-settlement/online-orders/list') {
      return Promise.resolve({ data: { success: true, data: ordersFixture } })
    }
    if (url === '/platform-settlement/online-orders/unlinked') {
      return Promise.resolve({ data: { success: true, data: unlinkedFixture } })
    }
    if (url === '/platform-settlement/online-orders/returns') {
      return Promise.resolve({ data: { success: true, data: returnsFixture } })
    }
    if (url === '/platform-settlement/online-orders/unattributed-returns') {
      return Promise.resolve({ data: { success: true, data: unattributedFixture } })
    }
    return Promise.resolve({ data: { success: true, data: [] } })
  })

  mockPost.mockResolvedValue({ data: { success: true, data: { accepted: 1 } } })
}

beforeEach(() => {
  vi.clearAllMocks()
  setupDefaultMocks()
})

describe('OnlineOrders pure helpers', () => {
  it('normalizeOrderRow อ่านเฉพาะค่ามาสก์และไม่ดึง raw PII', () => {
    const row = normalizeOrderRow(ordersFixture.rows[0])
    expect(row.buyerNameMasked).toBe('ธัชพxxx')
    expect(row.buyerPhoneMasked).toBe('081-234-5xxx')
    expect(row.addressMasked).toContain('เลขที่ xxx')
    expect((row as any).buyer_name).toBeUndefined()
    expect((row as any).buyer_phone).toBeUndefined()
    expect((row as any).full_address).toBeUndefined()
  })

  it('normalizeUnlinkedRow รองรับทั้งรูปแบบ proposed object และ flat', () => {
    const nested = normalizeUnlinkedRow(unlinkedFixture[0])
    expect(nested.proposedStockItemId).toBe('stk-1')
    expect(nested.proposedSku).toBe('TSH-WHT')
    expect(nested.proposedFactor).toBe(1)

    const flat = normalizeUnlinkedRow({
      source_ref: 'SHOPEE:123',
      product_name: 'สินค้า A',
      variant_name: null,
      qty: 3,
      proposedStockItemId: 'stk-9',
      proposedSku: 'SKU-9',
      proposedStockItemName: 'สต็อก 9',
      proposedFactor: 2,
    })
    expect(flat.proposedStockItemId).toBe('stk-9')
    expect(flat.proposedFactor).toBe(2)
  })

  it('summarizeRows รวมยอดทุกคอลัมน์ถูกต้อง', () => {
    const sum = summarizeRows(summaryFixture)
    expect(sum).toEqual({
      orders: 17,
      qty: 25,
      qtyReturned: 1,
      sales: 7500,
      returnsValue: 300,
      netSales: 7200,
    })
  })
})

describe('OnlineOrders component', () => {
  it('แสดงตารางสรุป เปลี่ยน groupBy และส่งพารามิเตอร์ถูกต้อง', async () => {
    render(<OnlineOrders platform="SHOPEE" />)

    await screen.findByText('กรุงเทพมหานคร')
    expect(screen.getByText('เชียงใหม่')).toBeTruthy()

    const groupSelect = screen.getByLabelText('จัดกลุ่มตาม')
    fireEvent.change(groupSelect, { target: { value: 'product' } })

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        '/platform-settlement/online-orders/summary',
        expect.objectContaining({
          params: expect.objectContaining({ groupBy: 'product', platform: 'SHOPEE' }),
        }),
      )
    })
  })

  it('แสดงเฉพาะข้อมูลผู้รับแบบมาสก์ในตารางออเดอร์ และไม่แสดง raw PII', async () => {
    render(<OnlineOrders platform="SHOPEE" />)

    await screen.findByText('261123ABC001')
    expect(screen.getByText('ธัชพxxx')).toBeTruthy()
    expect(screen.getByText('081-234-5xxx')).toBeTruthy()
    expect(screen.queryByText('ธัชพงษ์ ทดสอบ')).toBeNull()
    expect(screen.queryByText('081-234-5678')).toBeNull()
    expect(screen.queryByText('เลขที่ 858/7 หมู่ที่ 4')).toBeNull()
  })

  it('ผูกสินค้าที่ยังไม่ผูกและกดยอมรับข้อเสนอทั้งหมดได้', async () => {
    render(<OnlineOrders platform="SHOPEE" />)

    await screen.findByText('ยังไม่ผูกสินค้า (2)')

    // กดยอมรับข้อเสนอทั้งหมด
    fireEvent.click(screen.getByText('ยอมรับข้อเสนอทั้งหมด'))
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/platform-settlement/online-orders/mapping/accept-all')
    })

    // ยืนยันรายการที่มีข้อเสนอ (ปุ่มยืนยันตัวแรก)
    const confirmBtns = screen.getAllByRole('button', { name: 'ยืนยัน' })
    fireEvent.click(confirmBtns[0])
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/platform-settlement/online-orders/mapping/confirm', {
        sourceRef: 'SHOPEE:Nเสื้อยืด||สีขาว',
        stockItemId: 'stk-1',
        factor: 1,
      })
    })
  })

  it('แสดงรายการรับคืนข้ามเดือนและส่ง POST /returns/restock เมื่อกดรับคืนเข้าสต็อก', async () => {
    render(<OnlineOrders platform="SHOPEE" />)

    await screen.findByText('รับคืนข้ามเดือน (1)')
    expect(screen.getByText('261015XYZ999')).toBeTruthy()

    const checkboxes = screen.getAllByRole('checkbox')
    // checkboxes[0] = เลือกทั้งหมด, checkboxes[1] = ret-1
    fireEvent.click(checkboxes[1])

    fireEvent.click(screen.getByRole('button', { name: /รับคืนเข้าสต็อก \(1\)/ }))
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/platform-settlement/online-orders/returns/restock', {
        ids: ['ret-1'],
      })
    })
  })

  it('แสดงส่วนคืนที่ไม่ระบุออเดอร์', async () => {
    render(<OnlineOrders platform="SHOPEE" />)

    await screen.findByText('หมวกแก๊ป · สีดำ')
    expect(screen.getByText('2 ชิ้น')).toBeTruthy()
  })
})

describe('PlatformSettlement sub-tab ออเดอร์ออนไลน์', () => {
  it('สลับไปแท็บ "ออเดอร์ออนไลน์" แล้วแสดงหน้า OnlineOrders', async () => {
    render(<PlatformSettlement />)

    const ordersTab = screen.getByRole('tab', { name: 'ออเดอร์ออนไลน์' })
    fireEvent.click(ordersTab)

    await screen.findByText('กรุงเทพมหานคร')
    expect(ordersTab.getAttribute('aria-selected')).toBe('true')
  })
})
