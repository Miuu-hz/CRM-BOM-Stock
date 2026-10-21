import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const getAll = vi.fn()
vi.mock('../../services/accounting', () => ({
  journalApi: { getAll: (p: unknown) => getAll(p), getAttachmentCounts: vi.fn(), getById: vi.fn() },
  accountsApi: { getAll: () => Promise.resolve({ data: { success: true, data: { list: [] } } }) },
}))
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../components/accounting/SourceDocSection', () => ({ SourceDocSection: () => null }))

import JournalEntries from './JournalEntries'

const entry = (id: string, ref: string | null, amt: number) => ({
  id, entry_number: `JV-${id}`, date: '2026-10-05', reference_type: ref, description: `รายการ ${id}`,
  total_debit: amt, total_credit: amt, is_posted: 1,
})

describe('JournalEntries — กรองที่หัวคอลัมน์', () => {
  it('เปิดอ่านจาก URL, ติ๊กประเภทแล้วส่ง referenceTypes ไป backend และยอดรวมเป็นของผลที่กรอง', async () => {
    getAll.mockResolvedValue({
      data: {
        success: true,
        data: [entry('1', 'POS_SALE', 100), entry('2', 'POS_SALE', 250)],
        meta: { typeCounts: [{ type: 'POS_SALE', count: 2 }, { type: 'PAYROLL', count: 1 }] },
      },
    })
    render(<MemoryRouter initialEntries={['/?from=2026-10-01']}><JournalEntries /></MemoryRouter>)

    await screen.findByText('รายการ 1')
    expect(getAll).toHaveBeenLastCalledWith({ startDate: '2026-10-01' })
    expect(screen.getAllByText('฿350.00', { selector: 'p' })).toHaveLength(2) // เดบิตรวม + เครดิตรวม

    // หัวคอลัมน์มีทั้งแบบ desktop และแถวปุ่มมือถือ — ใช้ตัวแรก
    fireEvent.click(screen.getAllByRole('button', { name: /^รายการ/ })[0])
    const payroll = screen.getByText('เงินเดือน').closest('label')!
    fireEvent.click(within(payroll).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'ใช้ตัวกรอง' }))

    await vi.waitFor(() =>
      expect(getAll).toHaveBeenLastCalledWith({ startDate: '2026-10-01', referenceTypes: 'PAYROLL' }))
    expect(screen.getByText('กรองอยู่:')).toBeTruthy()
  })
})
