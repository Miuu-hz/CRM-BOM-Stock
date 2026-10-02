import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * สายเอกสาร (chain) เป็นฟีเจอร์ใหม่ที่ยังไม่เคยมีเทสต์คุ้มครอง — คลิก chip แล้วต้องยิง
 * /journal/source/:kind/:refId ของเอกสารที่เลือก ไม่ใช่ของเดิม และต้องมีปุ่ม "กลับ" โผล่มา
 */
vi.mock('../../services/api', () => ({
  default: { get: vi.fn() },
}))
vi.mock('../common/PaymentAttachments', () => ({
  PaymentAttachments: () => null,
}))

import api from '../../services/api'
import { SourceDocSection } from './SourceDocSection'

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> }

const soDoc = {
  kind: 'SALES_ORDER', refId: 'so-1',
  docNumber: 'SO-0001', docDate: '2026-09-01', createdAt: '2026-09-01T08:00:00Z', status: 'CONFIRMED',
  partyLabel: 'ลูกค้า', party: 'ร้าน A', notes: null,
  amounts: { subtotal: 100, total: 107, tax: 7 }, vatInclusive: false,
  extra: [], items: [], itemsNote: null, attachments: [],
  chain: [
    { kind: 'SALES_ORDER', refId: 'so-1', number: 'SO-0001', date: '2026-09-01', status: 'CONFIRMED' },
    { kind: 'INVOICE', refId: 'inv-1', number: 'INV-0001', date: '2026-09-02', status: 'POSTED' },
    { kind: 'PAYMENT', refId: 'pay-1', number: 'RC-0001', date: '2026-09-03', status: 'POSTED' },
  ],
  route: null,
}

const invDoc = { ...soDoc, kind: 'INVOICE', refId: 'inv-1', docNumber: 'INV-0001' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SourceDocSection — สายเอกสาร', () => {
  it('render chain chips ครบ และคลิก chip อื่นแล้วโหลดเอกสารนั้นแทนที่ + โชว์ปุ่มกลับ', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/journal/entry-1/source') return Promise.resolve({ data: { data: soDoc } })
      if (url === '/journal/source/INVOICE/inv-1') return Promise.resolve({ data: { data: invDoc } })
      return Promise.resolve({ data: { data: null } })
    })

    render(<SourceDocSection entryId="entry-1" />)

    // ข้อความในแต่ละ chip คือ "<ป้ายชื่อ><เลขที่>" ในโหนดข้อความเดียวกัน — ต้องคู่กันเพราะเลข
    // เอกสารเปล่า ๆ ชนกับเลขที่โชว์ในหัวข้อ (header) ด้านบนได้
    await screen.findByText(/ใบสั่งขาย\s*SO-0001/)
    expect(screen.getByText(/ใบแจ้งหนี้ขาย\s*INV-0001/)).toBeTruthy()
    expect(screen.getByText(/ใบเสร็จรับเงิน\s*RC-0001/)).toBeTruthy()
    expect(screen.queryByText('← กลับ')).toBeNull()

    fireEvent.click(screen.getByText(/ใบแจ้งหนี้ขาย\s*INV-0001/))

    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/journal/source/INVOICE/inv-1'))
    await screen.findByText('← กลับ')
  })

  it('โหลดล้มเหลว แสดงข้อความแจ้งเตือน', async () => {
    mockApi.get.mockRejectedValue(new Error('network'))
    render(<SourceDocSection kind="INVOICE" refId="inv-1" />)
    await screen.findByText('โหลดเอกสารไม่สำเร็จ')
  })
})
