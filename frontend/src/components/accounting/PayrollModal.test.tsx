import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

import api from '../../services/api'
import { PayrollModal } from './PayrollModal'
import type { Account } from '../../services/accounting'

const acc = (id: string, code: string, name: string, type: Account['type']) =>
  ({ id, code, name, type, category: '', level: 2, isActive: true, isSystem: true, normalBalance: 'DEBIT', taxRelated: false }) as Account

const accounts = [acc('cash', '1101', 'เงินสด', 'ASSET'), acc('bank', '1102-01', 'กรุงศรี', 'ASSET'), acc('ar', '1105', 'ลูกหนี้อื่น', 'ASSET')]

describe('PayrollModal', () => {
  it('คำนวณสุทธิ/สมทบนายจ้าง แล้วส่งยอดรายคนไป /journal/payroll', async () => {
    const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post
    post.mockResolvedValue({ data: { success: true, data: { entryNumber: 'JV-1' } } })
    const onSuccess = vi.fn()
    render(<PayrollModal accounts={accounts} onClose={() => {}} onSuccess={onSuccess} />)

    fireEvent.change(screen.getByPlaceholderText('พนักงาน 1'), { target: { value: 'สมชาย' } })
    fireEvent.change(screen.getByLabelText('เงินเดือน'), { target: { value: '15000' } })
    fireEvent.change(screen.getByLabelText('ประกันสังคมลูกจ้าง'), { target: { value: '750' } })
    fireEvent.change(screen.getByLabelText('ภาษีหัก ณ ที่จ่าย'), { target: { value: '250' } })

    // Dr 15,000 + สมทบนายจ้าง 750 = Cr สุทธิ 14,000 + ปกส. 1,500 + ภาษี 250
    expect(screen.getByText('Dr. 15,750.00 / Cr. 15,750.00')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /บันทึกเงินเดือน/ }))
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled())

    const [url, body] = post.mock.calls[0]
    expect(url).toBe('/journal/payroll')
    expect(body).toMatchObject({
      payAccountId: 'bank', ssEmployer: 750,
      employees: [{ name: 'สมชาย', gross: 15000, ssEmployee: 750, wht: 250, otherDeduction: 0 }],
    })
  })

  it('ยอดหักเกินเงินเดือน → ปุ่มบันทึกถูกปิด', () => {
    render(<PayrollModal accounts={accounts} onClose={() => {}} onSuccess={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('พนักงาน 1'), { target: { value: 'ก' } })
    fireEvent.change(screen.getByLabelText('เงินเดือน'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('ภาษีหัก ณ ที่จ่าย'), { target: { value: '200' } })
    expect(screen.getByText('ก: ยอดหักเกินเงินเดือน')).toBeTruthy()
    expect((screen.getByRole('button', { name: /บันทึกเงินเดือน/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
