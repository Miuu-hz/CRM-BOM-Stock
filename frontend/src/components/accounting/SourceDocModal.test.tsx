import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// โมดัลกลางที่เอาไปแทน JournalSourceModal เดิมใน ChartOfAccounts + ใช้เปิดจากผลค้นหา/ปุ่ม "สายเอกสาร"
// ทั่วระบบ — เทสต์แค่ว่ายิง API ถูก endpoint, โชว์ title, และปิดได้ทั้ง Esc กับคลิกปุ่มปิด
vi.mock('../../services/api', () => ({
  default: { get: vi.fn() },
}))
vi.mock('../common/PaymentAttachments', () => ({
  PaymentAttachments: () => null,
}))

import api from '../../services/api'
import { SourceDocModal } from './SourceDocModal'

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> }

const poDoc = {
  kind: 'PURCHASE_ORDER', refId: 'po-1',
  docNumber: 'PO-0001', docDate: '2026-09-01', createdAt: '2026-09-01T08:00:00Z', status: 'CONFIRMED',
  partyLabel: 'ผู้ขาย', party: 'บจก. ทดสอบ', notes: null,
  amounts: { subtotal: 100, total: 107, tax: 7 }, vatInclusive: false,
  extra: [], items: [], itemsNote: null, attachments: [], chain: [], route: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SourceDocModal', () => {
  it('เปิดด้วย kind/refId แล้วยิง API ถูก endpoint และโชว์ title', async () => {
    mockApi.get.mockResolvedValue({ data: { data: poDoc } })
    const onClose = vi.fn()
    render(<SourceDocModal kind="PURCHASE_ORDER" refId="po-1" title="PO-0001" onClose={onClose} />)

    expect(mockApi.get).toHaveBeenCalledWith('/journal/source/PURCHASE_ORDER/po-1')
    expect(screen.getByText('PO-0001')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('บจก. ทดสอบ')).toBeTruthy())
  })

  it('กด Esc แล้วเรียก onClose', async () => {
    mockApi.get.mockResolvedValue({ data: { data: poDoc } })
    const onClose = vi.fn()
    render(<SourceDocModal kind="PURCHASE_ORDER" refId="po-1" title="PO-0001" onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('กดปุ่มปิดแล้วเรียก onClose', async () => {
    mockApi.get.mockResolvedValue({ data: { data: poDoc } })
    const onClose = vi.fn()
    render(<SourceDocModal kind="PURCHASE_ORDER" refId="po-1" title="PO-0001" onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('ปิด'))
    expect(onClose).toHaveBeenCalled()
  })
})
