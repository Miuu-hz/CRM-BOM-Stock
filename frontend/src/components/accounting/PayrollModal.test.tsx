import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

import api from '../../services/api'
import { PayrollModal } from './PayrollModal'
import type { Account, PayrollHistory } from '../../services/accounting'

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> }

const acc = (id: string, code: string, name: string, type: Account['type']) =>
  ({ id, code, name, type, category: '', level: 2, isActive: true, isSystem: true, normalBalance: 'DEBIT', taxRelated: false }) as Account

const accounts = [
  acc('cash', '1101', 'เงินสด', 'ASSET'), acc('bank', '1102-01', 'กรุงศรี', 'ASSET'), acc('ar', '1105', 'ลูกหนี้อื่น', 'ASSET'),
  acc('op', '2102', 'เจ้าหนี้อื่น', 'LIABILITY'), acc('sso', '5314', 'เงินสมทบประกันสังคม (ส่วนนายจ้าง)', 'EXPENSE'),
]

const emptyHistory = (employee: string): PayrollHistory => ({
  employee, period: '2026-10', samePeriod: { count: 0, gross: 0, net: 0 }, year: '2026',
  yearToDate: { count: 0, gross: 0, net: 0 }, recent: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.get.mockImplementation((url: string, cfg?: { params?: { employee?: string } }) => {
    if (url === '/journal/payroll/employees') {
      return Promise.resolve({ data: { success: true, data: [{ name: 'สมชาย', count: 3, lastPayDate: '2026-10-15' }] } })
    }
    const employee = cfg?.params?.employee ?? ''
    const data = employee === 'สมชาย'
      ? {
          ...emptyHistory(employee),
          samePeriod: { count: 1, gross: 5000, net: 4950 },
          yearToDate: { count: 3, gross: 20000, net: 19950 },
          recent: [{ payDate: '2026-10-15', period: '2026-10', gross: 5000, net: 4950, entryNumber: 'JV-2026-00042', isPosted: 1 }],
        }
      : emptyHistory(employee)
    return Promise.resolve({ data: { success: true, data } })
  })
})

const fillRow = (name: string, gross: string) => {
  fireEvent.change(screen.getByPlaceholderText('พนักงาน 1'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('เงินเดือน'), { target: { value: gross } })
}

describe('PayrollModal', () => {
  it('คำนวณสุทธิ/สมทบนายจ้าง (5314) แล้วส่งยอดรายคนไป /journal/payroll', async () => {
    mockApi.post.mockResolvedValue({ data: { success: true, data: { entryNumber: 'JV-1', warnings: [] } } })
    const onSuccess = vi.fn()
    render(<PayrollModal accounts={accounts} onClose={() => {}} onSuccess={onSuccess} />)

    fillRow('สมหญิง', '15000')
    fireEvent.change(screen.getByLabelText('ประกันสังคมลูกจ้าง'), { target: { value: '750' } })
    fireEvent.change(screen.getByLabelText('ภาษีหัก ณ ที่จ่าย'), { target: { value: '250' } })

    // Dr 15,000 + สมทบนายจ้าง 750 = Cr สุทธิ 14,000 + ปกส. 1,500 + ภาษี 250
    expect(screen.getByText('Dr. 15,750.00 / Cr. 15,750.00')).toBeTruthy()
    expect(screen.getByText('5314 เงินสมทบประกันสังคม (ส่วนนายจ้าง)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /บันทึกเงินเดือน/ }))
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled())

    const [url, body] = mockApi.post.mock.calls[0]
    expect(url).toBe('/journal/payroll')
    expect(body).toMatchObject({
      payAccountId: 'bank', ssEmployer: 750,
      employees: [{ name: 'สมหญิง', gross: 15000, ssEmployee: 750, wht: 250, otherDeduction: 0 }],
    })
  })

  it('หักอื่นๆ ค่าเริ่มต้นลงบัญชี 2102 เจ้าหนี้อื่น', async () => {
    mockApi.post.mockResolvedValue({ data: { success: true, data: { entryNumber: 'JV-2', warnings: [] } } })
    const onSuccess = vi.fn()
    render(<PayrollModal accounts={accounts} onClose={() => {}} onSuccess={onSuccess} />)
    fillRow('สมหญิง', '10000')
    fireEvent.change(screen.getByLabelText('หักอื่นๆ'), { target: { value: '500' } })
    expect((screen.getByDisplayValue('2102 – เจ้าหนี้อื่น') as HTMLSelectElement).value).toBe('op')
    fireEvent.click(screen.getByRole('button', { name: /บันทึกเงินเดือน/ }))
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(mockApi.post.mock.calls[0][1].otherDeductionAccountId).toBe('op')
  })

  it('ชื่อที่งวดนี้จ่ายแล้ว → แสดงประวัติ + เตือนสีเหลือง แต่ยังบันทึกได้', async () => {
    render(<PayrollModal accounts={accounts} onClose={() => {}} onSuccess={() => {}} />)
    // autocomplete จากชื่อที่เคยบันทึก
    await vi.waitFor(() => expect(document.querySelector('#payroll-employee-names option[value="สมชาย"]')).toBeTruthy())

    fillRow('สมชาย', '5000')
    expect(await screen.findByText(/งวด 10\/2026 จ่ายแล้ว 1 ครั้ง สุทธิ ฿4,950.00/, {}, { timeout: 2000 })).toBeTruthy()
    expect(screen.getByText(/ปี 2026: 3 ครั้ง สุทธิ ฿19,950.00/)).toBeTruthy()
    expect(screen.getByText(/JV-2026-00042/)).toBeTruthy()
    expect(screen.getByText(/มีรายการเงินเดือนของ สมชาย \(1 ครั้ง/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /บันทึกเงินเดือน/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('ยอดหักเกินเงินเดือน → ปุ่มบันทึกถูกปิด', () => {
    render(<PayrollModal accounts={accounts} onClose={() => {}} onSuccess={() => {}} />)
    fillRow('ก', '100')
    fireEvent.change(screen.getByLabelText('ภาษีหัก ณ ที่จ่าย'), { target: { value: '200' } })
    expect(screen.getByText('ก: ยอดหักเกินเงินเดือน')).toBeTruthy()
    expect((screen.getByRole('button', { name: /บันทึกเงินเดือน/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
