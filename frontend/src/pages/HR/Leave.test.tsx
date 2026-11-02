import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../../services/hr.service', () => {
  const service = {
    getEmployees: vi.fn(),
    getLeaveTypes: vi.fn(),
    createLeaveType: vi.fn(),
    updateLeaveType: vi.fn(),
    createStarterLeaveTypes: vi.fn(),
    getHolidays: vi.fn(),
    createHoliday: vi.fn(),
    deleteHoliday: vi.fn(),
    getLeaveRequests: vi.fn(),
    createLeaveRequest: vi.fn(),
    cancelLeaveRequest: vi.fn(),
    getLeaveBalances: vi.fn(),
  }
  return {
    default: service,
    hrService: service,
  }
})

import hrService from '../../services/hr.service'
import Leave from './Leave'

const mockHr = hrService as unknown as {
  getEmployees: ReturnType<typeof vi.fn>
  getLeaveTypes: ReturnType<typeof vi.fn>
  createLeaveType: ReturnType<typeof vi.fn>
  updateLeaveType: ReturnType<typeof vi.fn>
  createStarterLeaveTypes: ReturnType<typeof vi.fn>
  getHolidays: ReturnType<typeof vi.fn>
  createHoliday: ReturnType<typeof vi.fn>
  deleteHoliday: ReturnType<typeof vi.fn>
  getLeaveRequests: ReturnType<typeof vi.fn>
  createLeaveRequest: ReturnType<typeof vi.fn>
  cancelLeaveRequest: ReturnType<typeof vi.fn>
  getLeaveBalances: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHr.getEmployees.mockResolvedValue([
    {
      id: 'emp-1',
      code: 'EMP-001',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
      status: 'ACTIVE',
      employment_type: 'MONTHLY',
    },
    {
      id: 'emp-2',
      code: 'EMP-002',
      first_name: 'สมหญิง',
      last_name: 'รักงาน',
      status: 'ACTIVE',
      employment_type: 'MONTHLY',
    },
  ])
  mockHr.getLeaveTypes.mockResolvedValue([
    {
      id: 'lt-1',
      code: 'SICK',
      name: 'ลาป่วย',
      paid: true,
      days_per_year: 30,
      is_active: true,
    },
    {
      id: 'lt-2',
      code: 'VACATION',
      name: 'ลาพักร้อน',
      paid: true,
      days_per_year: 6,
      is_active: true,
    },
    {
      id: 'lt-3',
      code: 'UNPAID',
      name: 'ลาไม่รับค่าจ้าง',
      paid: false,
      days_per_year: null,
      is_active: true,
    },
  ])
  mockHr.getLeaveRequests.mockResolvedValue([])
  mockHr.getHolidays.mockResolvedValue([])
  mockHr.getLeaveBalances.mockResolvedValue([])
})

describe('หน้าการลาและวันหยุด (Leave)', () => {
  it('renders request rows with employee name, type and status pill', async () => {
    mockHr.getLeaveRequests.mockResolvedValue([
      {
        id: 'req-1',
        employee_id: 'emp-1',
        employee_code: 'EMP-001',
        employee_name: 'สมชาย ใจดี',
        org_unit_name: 'ฝ่ายผลิต',
        leave_type_id: 'lt-1',
        leave_type_code: 'SICK',
        leave_type_name: 'ลาป่วย',
        paid: true,
        start_date: '2026-11-10',
        end_date: '2026-11-11',
        days: 2,
        reason: 'มีไข้สูง',
        status: 'PENDING',
        approval_request_id: 'app-1',
        requested_by: 'u-1',
        decided_by: null,
        decided_at: null,
        created_at: '2026-11-01 10:00:00',
      },
      {
        id: 'req-2',
        employee_id: 'emp-2',
        employee_code: 'EMP-002',
        employee_name: 'สมหญิง รักงาน',
        org_unit_name: 'ฝ่ายการตลาด',
        leave_type_id: 'lt-2',
        leave_type_code: 'VACATION',
        leave_type_name: 'ลาพักร้อน',
        paid: true,
        start_date: '2026-10-01',
        end_date: '2026-10-02',
        days: 2,
        reason: 'พักผ่อนประจำปี',
        status: 'APPROVED',
        approval_request_id: 'app-2',
        requested_by: 'u-2',
        decided_by: 'u-admin',
        decided_at: '2026-10-01 09:00:00',
        created_at: '2026-09-28 09:00:00',
      },
    ])

    render(
      <MemoryRouter>
        <Leave />
      </MemoryRouter>
    )

    // Scope assertion to the table to avoid collision with filter dropdown options
    const table = await screen.findByRole('table')
    const utils = within(table)

    // Verify employee name and code rendered
    expect(utils.getByText('สมชาย ใจดี')).toBeTruthy()
    expect(utils.getByText('EMP-001')).toBeTruthy()
    expect(utils.getByText('สมหญิง รักงาน')).toBeTruthy()
    expect(utils.getByText('EMP-002')).toBeTruthy()

    // Verify leave types
    expect(utils.getByText('ลาป่วย')).toBeTruthy()
    expect(utils.getByText('ลาพักร้อน')).toBeTruthy()

    // Verify status pills
    expect(utils.getByText('รออนุมัติ')).toBeTruthy()
    expect(utils.getByText('อนุมัติ')).toBeTruthy()
  })

  it('switching to the holidays tab with 3 holidays shows the <13 warning', async () => {
    mockHr.getHolidays.mockResolvedValue([
      { id: 'h1', date: '2026-01-01', name: 'วันขึ้นปีใหม่' },
      { id: 'h2', date: '2026-04-13', name: 'วันสงกรานต์' },
      { id: 'h3', date: '2026-05-01', name: 'วันแรงงานแห่งชาติ' },
    ])

    render(
      <MemoryRouter>
        <Leave />
      </MemoryRouter>
    )

    // Switch to 'วันหยุดบริษัท' tab
    const holidayTabButton = screen.getByRole('button', { name: /วันหยุดบริษัท/i })
    fireEvent.click(holidayTabButton)

    // Check warning pill when < 13 holidays
    expect(
      await screen.findByText(/ปีนี้มี 3 วัน ต้องไม่น้อยกว่า 13 วัน รวมวันแรงงาน \(ม\.29\)/)
    ).toBeTruthy()

    // Check holiday names rendered in table
    const holidayTable = await screen.findByRole('table')
    const holidayUtils = within(holidayTable)
    expect(holidayUtils.getByText('วันขึ้นปีใหม่')).toBeTruthy()
    expect(holidayUtils.getByText('วันสงกรานต์')).toBeTruthy()
    expect(holidayUtils.getByText('วันแรงงานแห่งชาติ')).toBeTruthy()
  })

  it('displays leave balance table for selected employee with "ไม่จำกัด" for null quota', async () => {
    mockHr.getLeaveBalances.mockResolvedValue([
      {
        leave_type_id: 'lt-1',
        code: 'SICK',
        name: 'ลาป่วย',
        paid: true,
        quota: 30,
        used: 2,
        pending: 1,
        remaining: 28,
      },
      {
        leave_type_id: 'lt-3',
        code: 'UNPAID',
        name: 'ลาไม่รับค่าจ้าง',
        paid: false,
        quota: null,
        used: 5,
        pending: 0,
        remaining: null,
      },
    ])

    render(
      <MemoryRouter>
        <Leave />
      </MemoryRouter>
    )

    // Switch to balances tab
    fireEvent.click(screen.getByRole('button', { name: /ยอดคงเหลือ/i }))

    // Select employee
    const select = await screen.findByRole('combobox')
    fireEvent.change(select, { target: { value: 'emp-1' } })

    // Verify balances loaded in table
    const balanceTable = await screen.findByRole('table')
    const balanceUtils = within(balanceTable)
    expect(await balanceUtils.findByText('30 วัน')).toBeTruthy()
    expect(balanceUtils.getByText('28 วัน')).toBeTruthy()

    // For unpaid leave with null quota/remaining, it should show 'ไม่จำกัด'
    const unlimitedElements = balanceUtils.getAllByText('ไม่จำกัด')
    expect(unlimitedElements.length).toBeGreaterThanOrEqual(2)
  })
})
