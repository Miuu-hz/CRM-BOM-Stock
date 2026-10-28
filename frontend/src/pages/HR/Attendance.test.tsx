import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../../services/hr.service', () => ({
  default: {
    getAttendanceSummary: vi.fn(),
    getAttendanceImports: vi.fn(),
    getUnmappedPins: vi.fn(),
    getShifts: vi.fn(),
    getEmployees: vi.fn(),
  },
}))

import hrService from '../../services/hr.service'
import Attendance from './Attendance'

const mockHr = hrService as unknown as {
  getAttendanceSummary: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('หน้าเวลาเข้าออก (Attendance)', () => {
  it('แสดงตารางสรุปเวลาเข้าออกของพนักงานจาก service และกางดูรายวันได้', async () => {
    mockHr.getAttendanceSummary.mockResolvedValue({
      from: '2026-04-01',
      to: '2026-04-02',
      employees: [
        {
          id: 'emp-1',
          employeeId: 'emp-1',
          code: 'EMP-001',
          first_name: 'สมชาย',
          last_name: 'ใจดี',
          name: 'สมชาย ใจดี',
          device_pin: '1001',
          shift_id: 'shift-1',
          shift_name: 'กะปกติ',
          employee: {
            id: 'emp-1',
            code: 'EMP-001',
            first_name: 'สมชาย',
            last_name: 'ใจดี',
            device_pin: '1001',
            shift_id: 'shift-1',
          },
          shift: {
            id: 'shift-1',
            name: 'กะปกติ',
            start: '09:00',
            end: '18:00',
            graceMinutes: 5,
            breakMinutes: 60,
          },
          days: [
            {
              workDate: '2026-04-01',
              in: '2026-04-01 09:15:00',
              out: '2026-04-01 19:30:00',
              workedMinutes: 540,
              lateMinutes: 15,
              earlyLeaveMinutes: 0,
              otCandidateMinutes: 90,
              missingOut: false,
              absent: false,
            },
          ],
          totals: {
            daysWorked: 1,
            absentDays: 1,
            lateMinutes: 15,
            earlyLeaveMinutes: 0,
            otCandidateMinutes: 90,
          },
          daysWorked: 1,
          absentDays: 1,
          lateMinutes: 15,
          earlyLeaveMinutes: 0,
          otCandidateMinutes: 90,
        },
      ],
      noShift: [
        {
          id: 'emp-2',
          code: 'EMP-002',
          first_name: 'สมหญิง',
          last_name: 'รักงาน',
          device_pin: '1002',
        },
      ],
    })

    render(<Attendance />)

    expect(await screen.findByText('EMP-001')).toBeTruthy()
    expect(screen.getByText(/สมชาย ใจดี/)).toBeTruthy()
    expect(screen.getByText(/กะปกติ/)).toBeTruthy()
    expect(screen.getByText('1.50')).toBeTruthy() // 90 mins = 1.50 hr OT candidate
    expect(screen.getByText(/EMP-002 — สมหญิง รักงาน/)).toBeTruthy()

    // กางแถวดูรายละเอียดรายวัน
    fireEvent.click(screen.getByTestId('summary-row-emp-1'))
    expect(await screen.findByText('2026-04-01')).toBeTruthy()
    expect(screen.getByText('มาทำงาน')).toBeTruthy()
  })
})
