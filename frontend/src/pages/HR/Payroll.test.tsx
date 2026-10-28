import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../../services/accounting', () => ({
  accountsApi: {
    getAll: vi.fn().mockResolvedValue({ data: { data: [] } }),
  },
}))

vi.mock('../../services/hr.service', () => ({
  default: {
    getPayrollRuns: vi.fn(),
    getPayrollRun: vi.fn(),
    createPayrollRun: vi.fn(),
    updatePayrollRunLine: vi.fn(),
    approvePayrollRun: vi.fn(),
    postPayrollRun: vi.fn(),
    payPayrollRun: vi.fn(),
    voidPayrollRun: vi.fn(),
    deletePayrollRun: vi.fn(),
    exportSsoCsv: vi.fn(),
    getPnd1Csv: vi.fn(),
    getEmployeePayItems: vi.fn().mockResolvedValue([]),
  },
}))

import hrService, { PayrollRun } from '../../services/hr.service'
import Payroll from './Payroll'

const mockHr = hrService as unknown as {
  getPayrollRuns: ReturnType<typeof vi.fn>
  getPayrollRun: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('หน้าทำจ่ายเงินเดือน (Payroll)', () => {
  it('แสดงตารางพนักงานในรอบเงินเดือนพร้อมแถวรวมยอด (totals) จาก service', async () => {
    const sampleRun: PayrollRun = {
      id: 'run-2026-10',
      tenant_id: 't1',
      period: '2026-10',
      status: 'DRAFT',
      pay_date: null,
      pay_account_id: null,
      other_deduction_account_id: null,
      accrual_je_ids: [],
      payment_je_id: null,
      lines: [
        {
          id: 'line-1',
          tenant_id: 't1',
          run_id: 'run-2026-10',
          employee_id: 'emp-1',
          code: 'EMP-001',
          employee_code: 'EMP-001',
          first_name: 'สมชาย',
          last_name: 'ใจดี',
          employee_name: 'สมชาย ใจดี',
          full_name: 'สมชาย ใจดี',
          org_unit_name: 'ครัวกลาง',
          employment_type: 'MONTHLY',
          base_wage: 40000,
          sso_enrolled: true,
          inputs: {
            daysWorked: 30,
            hoursWorked: 0,
            unpaidLeaveDays: 0,
            lateMinutes: 0,
            ot: [],
            extraPayItems: [],
            otherDeductions: [],
          },
          result: {
            basePay: 40000,
            lateDeduction: 0,
            otPay: 1000,
            payItemsTotal: 1500,
            gross: 42500,
            ssoBase: 17500,
            ssoEmployee: 875,
            ssoEmployer: 875,
            taxableMonthly: 42500,
            wht: 439.58,
            otherDeductionsTotal: 0,
            net: 41185.42,
            lines: [
              { code: 'BASE', label: 'เงินเดือน', amount: 40000 },
              { code: 'OT_WORKDAY_OT', label: 'OT วันทำงาน 1.5x (4 ชม.)', amount: 1000 },
              { code: 'ITEM_ค่าเดินทาง', label: 'ค่าเดินทาง', amount: 1500 },
            ],
          },
          base_pay: 40000,
          ot_pay: 1000,
          pay_items_total: 1500,
          sso_base: 17500,
          taxable_monthly: 42500,
          gross: 42500,
          late: 0,
          sso_employee: 875,
          sso_employer: 875,
          wht: 439.58,
          other_deduction: 0,
          net: 41185.42,
        },
        {
          id: 'line-2',
          tenant_id: 't1',
          run_id: 'run-2026-10',
          employee_id: 'emp-2',
          code: 'EMP-002',
          employee_code: 'EMP-002',
          first_name: 'มาลี',
          last_name: 'รักงาน',
          employee_name: 'มาลี รักงาน',
          full_name: 'มาลี รักงาน',
          org_unit_name: 'หน้าร้าน',
          employment_type: 'MONTHLY',
          base_wage: 20000,
          sso_enrolled: true,
          inputs: {
            daysWorked: 30,
            hoursWorked: 0,
            unpaidLeaveDays: 0,
            lateMinutes: 15,
            ot: [],
            extraPayItems: [],
            otherDeductions: [],
          },
          result: {
            basePay: 20000,
            lateDeduction: 20.83,
            otPay: 0,
            payItemsTotal: 1000,
            gross: 21000,
            ssoBase: 17500,
            ssoEmployee: 875,
            ssoEmployer: 875,
            taxableMonthly: 20979.17,
            wht: 0,
            otherDeductionsTotal: 0,
            net: 20104.17,
            lines: [
              { code: 'BASE', label: 'เงินเดือน', amount: 20000 },
              { code: 'ITEM_เบี้ยขยัน', label: 'เบี้ยขยัน', amount: 1000 },
              { code: 'LATE', label: 'หักมาสาย (15 นาที)', amount: -20.83 },
            ],
          },
          base_pay: 20000,
          ot_pay: 0,
          pay_items_total: 1000,
          sso_base: 17500,
          taxable_monthly: 20979.17,
          gross: 21000,
          late: 20.83,
          sso_employee: 875,
          sso_employer: 875,
          wht: 0,
          other_deduction: 0,
          net: 20104.17,
        },
      ],
      totals: {
        employee_count: 2,
        gross: 63500,
        late: 20.83,
        sso_employee: 1750,
        sso_employer: 1750,
        wht: 439.58,
        other_deduction: 0,
        net: 61289.59,
      },
    }

    mockHr.getPayrollRuns.mockResolvedValue([sampleRun])
    mockHr.getPayrollRun.mockResolvedValue(sampleRun)

    render(
      <MemoryRouter>
        <Payroll />
      </MemoryRouter>
    )

    expect(await screen.findByText(/สมชาย ใจดี/)).toBeTruthy()
    expect(screen.getByText(/มาลี รักงาน/)).toBeTruthy()

    expect(screen.getByTestId('total-gross').textContent).toBe('63,500.00')
    expect(screen.getByTestId('total-sso').textContent).toBe('1,750.00')
    expect(screen.getByTestId('total-wht').textContent).toBe('439.58')
    expect(screen.getByTestId('total-other').textContent).toBe('20.83')
    expect(screen.getByTestId('total-net').textContent).toBe('61,289.59')
  })
})
