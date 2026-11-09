import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../../services/hr.service', () => {
  const service = {
    getRoster: vi.fn(),
    saveRosterAssignments: vi.fn(),
    copyRosterWeek: vi.fn(),
    getShiftSwaps: vi.fn(),
    cancelShiftSwap: vi.fn(),
  }
  return {
    default: service,
    hrService: service,
  }
})

import hrService, { RosterWeek, RosterShift, ShiftSwap } from '../../services/hr.service'
import Roster from './Roster'

const mockHr = hrService as unknown as {
  getRoster: ReturnType<typeof vi.fn>
  saveRosterAssignments: ReturnType<typeof vi.fn>
  copyRosterWeek: ReturnType<typeof vi.fn>
  getShiftSwaps: ReturnType<typeof vi.fn>
  cancelShiftSwap: ReturnType<typeof vi.fn>
}

function parseYMD(str: string): Date {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(ymd: string, n: number): string {
  const d = parseYMD(ymd)
  d.setDate(d.getDate() + n)
  return formatYMD(d)
}

const sampleShifts: RosterShift[] = [
  {
    id: 'shift-1',
    name: 'กะเช้า',
    start_time: '08:00',
    end_time: '17:00',
    grace_minutes: 15,
    break_minutes: 60,
    is_active: 1,
    hours: 8,
  },
  {
    id: 'shift-2',
    name: 'กะบ่าย',
    start_time: '13:00',
    end_time: '22:00',
    grace_minutes: 15,
    break_minutes: 60,
    is_active: 1,
    hours: 8,
  },
]

const createSampleRoster = (weekStart: string): RosterWeek => {
  const dates = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i))
  return {
    week_start: weekStart,
    dates,
    shifts: sampleShifts,
    employees: [
      {
        id: 'emp-1',
        code: 'EMP-001',
        name: 'สมชาย ใจดี',
        org_unit_name: 'ครัว',
        employment_type: 'MONTHLY',
        default_shift_id: 'shift-1',
        cells: dates.map((d, idx) => ({
          date: d,
          shift_id: 'shift-1',
          source: idx < 2 ? 'ASSIGNED' : 'DEFAULT',
          on_leave: false,
          holiday: false,
        })),
        hours: 40,
        labor_cost: 6666.67,
        warnings: ['ชั่วโมงปกติเกิน 48 ชม./สัปดาห์'],
      },
      {
        id: 'emp-2',
        code: 'EMP-002',
        name: 'สมหญิง รักดี',
        org_unit_name: 'บริการ',
        employment_type: 'DAILY',
        default_shift_id: 'shift-2',
        cells: dates.map((d, idx) => ({
          date: d,
          shift_id: 'shift-2',
          source: idx < 2 ? 'ASSIGNED' : 'DEFAULT',
          on_leave: false,
          holiday: false,
        })),
        hours: 32,
        labor_cost: 4000,
        warnings: [],
      },
    ],
    days: dates.map((d, idx) => ({
      date: d,
      staff: 2,
      labor_cost: 1500,
      avg_sales: idx === 0 ? 5000 : 6000,
      labor_pct: idx === 0 ? 30 : 25,
      warnings: idx === 0 ? ['คนไม่ถึงขั้นต่ำ (1/2)'] : [],
    })),
    settings: {
      rosterMinStaff: 2,
      laborCostTargetPct: 25,
    },
  }
}

describe('หน้าตารางกะ /hr/roster (Roster)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHr.getRoster.mockImplementation(async (weekStart: string) => createSampleRoster(weekStart))
    mockHr.saveRosterAssignments.mockResolvedValue({ updated: 2, cleared: 0 })
    mockHr.copyRosterWeek.mockResolvedValue({ copied: 5, skipped: 2 })
    mockHr.getShiftSwaps.mockResolvedValue([])
    mockHr.cancelShiftSwap.mockResolvedValue({} as any)
  })

  it('1. Renders the employee names, the day warning text, the employee warning in the legal-warnings list, and 30%', async () => {
    render(<Roster />)

    // Wait for employee names to render
    const emp1Elements = await screen.findAllByText('สมชาย ใจดี')
    expect(emp1Elements.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('สมหญิง รักดี')).toBeTruthy()

    // Day warning text
    expect(screen.getByText('คนไม่ถึงขั้นต่ำ (1/2)')).toBeTruthy()

    // Employee warning in the legal-warnings list
    expect(screen.getByText('คำเตือนตามกฎหมายแรงงาน')).toBeTruthy()
    expect(screen.getByText('ชั่วโมงปกติเกิน 48 ชม./สัปดาห์')).toBeTruthy()

    // Labor cost % pill: 30%
    expect(screen.getByText('30%')).toBeTruthy()
  })

  it("2. Change employee 1's day-1 select to หยุด and employee 2's day-0 to ใช้กะประจำ → click บันทึก (2) → saveRosterAssignments called with exactly those two items", async () => {
    render(<Roster />)

    await screen.findByText('สมหญิง รักดี')

    const emp1Text = (await screen.findAllByText('สมชาย ใจดี'))[0]
    const emp1Row = emp1Text.closest('tr')!
    const emp2Row = screen.getByText('สมหญิง รักดี').closest('tr')!

    const emp1Combos = within(emp1Row).getAllByRole('combobox')
    const emp2Combos = within(emp2Row).getAllByRole('combobox')

    // Change employee 1's day-1 select to หยุด
    fireEvent.change(emp1Combos[1], { target: { value: '__OFF__' } })

    // Change employee 2's day-0 select to ใช้กะประจำ
    fireEvent.change(emp2Combos[0], { target: { value: '__DEFAULT__' } })

    // Click บันทึก (2)
    const saveBtn = screen.getByRole('button', { name: /บันทึก \(2\)/ })
    fireEvent.click(saveBtn)

    expect(mockHr.saveRosterAssignments).toHaveBeenCalledTimes(1)
    const callArgs = mockHr.saveRosterAssignments.mock.calls[0][0]
    expect(callArgs).toHaveLength(2)

    const requestedWeekStart = mockHr.getRoster.mock.calls[0][0]
    const day0 = requestedWeekStart
    const day1 = addDays(requestedWeekStart, 1)

    expect(callArgs).toEqual(
      expect.arrayContaining([
        { employee_id: 'emp-1', work_date: day1, shift_id: null },
        { employee_id: 'emp-2', work_date: day0, shift_id: null, clear: true },
      ])
    )
  })

  it('3. คัดลอกสัปดาห์ก่อน → confirm → copyRosterWeek called with (previous Monday, the roster\'s week_start, false)', async () => {
    render(<Roster />)

    await screen.findByText('สมหญิง รักดี')

    const requestedWeekStart = mockHr.getRoster.mock.calls[0][0]
    const expectedPrevMonday = addDays(requestedWeekStart, -7)

    // Click คัดลอกสัปดาห์ก่อน
    const copyBtn = screen.getByRole('button', { name: /คัดลอกสัปดาห์ก่อน/ })
    fireEvent.click(copyBtn)

    // Modal appears with confirm button
    const confirmBtn = screen.getByRole('button', { name: 'ยืนยัน' })
    fireEvent.click(confirmBtn)

    expect(mockHr.copyRosterWeek).toHaveBeenCalledWith(
      expectedPrevMonday,
      requestedWeekStart,
      false
    )
  })

  it('4. Tab คำขอแลกกะ: renders swaps and handles cancellation', async () => {
    const sampleSwaps: ShiftSwap[] = [
      {
        id: 'swap-1',
        work_date: '2026-11-12',
        requester_employee_id: 'emp-1',
        requester_name: 'สมชาย ใจดี',
        target_employee_id: 'emp-2',
        target_name: 'สมหญิง รักดี',
        requester_shift: sampleShifts[0],
        target_shift: sampleShifts[1],
        reason: 'ติดธุระด่วน',
        status: 'PEER_PENDING',
        approval_request_id: null,
        created_at: '2026-11-09T10:00:00Z',
      },
    ]
    mockHr.getShiftSwaps.mockResolvedValue(sampleSwaps)

    render(<Roster />)

    // Switch tab
    const swapTabBtn = screen.getByRole('button', { name: 'คำขอแลกกะ' })
    fireEvent.click(swapTabBtn)

    expect(await screen.findByText('ติดธุระด่วน')).toBeTruthy()
    expect(screen.getAllByText('รอเพื่อนตอบ').length).toBeGreaterThan(1)

    // Click ยกเลิก on row
    const cancelBtn = screen.getByRole('button', { name: 'ยกเลิก' })
    fireEvent.click(cancelBtn)

    // Modal confirmation
    expect(screen.getByText('ยืนยันการยกเลิกคำขอแลกกะ')).toBeTruthy()
    const confirmCancelBtn = screen.getByRole('button', { name: 'ยืนยัน' })
    fireEvent.click(confirmCancelBtn)

    expect(mockHr.cancelShiftSwap).toHaveBeenCalledWith('swap-1')
  })

  it('5. Prompts confirm modal when navigating week with unsaved edits', async () => {
    render(<Roster />)

    await screen.findByText('สมหญิง รักดี')
    const emp2Row = screen.getByText('สมหญิง รักดี').closest('tr')!
    const emp2Combos = within(emp2Row).getAllByRole('combobox')

    // Edit a cell
    fireEvent.change(emp2Combos[0], { target: { value: '__DEFAULT__' } })
    expect(screen.getByRole('button', { name: /บันทึก \(1\)/ })).toBeTruthy()

    // Click next week
    const nextWeekBtn = screen.getByRole('button', { name: /สัปดาห์ถัดไป/ })
    fireEvent.click(nextWeekBtn)

    // Confirm modal appears
    expect(screen.getByText('ละทิ้งการแก้ไข?')).toBeTruthy()
    const discardBtn = screen.getByRole('button', { name: 'เปลี่ยนสัปดาห์' })
    fireEvent.click(discardBtn)

    // Modal dismissed
    expect(screen.queryByText('ละทิ้งการแก้ไข?')).toBeNull()
  })
})
