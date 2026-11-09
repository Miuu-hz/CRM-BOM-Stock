import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../../services/hr.service', () => ({
  default: {
    getMe: vi.fn(),
    getCheckinLocation: vi.fn(),
    checkin: vi.fn(),
    getMyAttendance: vi.fn(),
    getMySlips: vi.fn(),
    getLeaveTypes: vi.fn(),
    getLeaveBalances: vi.fn(),
    getLeaveRequests: vi.fn(),
    createLeaveRequest: vi.fn(),
    cancelLeaveRequest: vi.fn(),
    getMyAdvances: vi.fn(),
    createMyAdvance: vi.fn(),
    cancelAdvance: vi.fn(),
    getMyTraining: vi.fn(),
    getMyRoster: vi.fn(),
    getColleagueShifts: vi.fn(),
    getMyShiftSwaps: vi.fn(),
    createShiftSwap: vi.fn(),
    acceptShiftSwap: vi.fn(),
    declineShiftSwap: vi.fn(),
    cancelShiftSwap: vi.fn(),
  },
}))

vi.mock('./PayslipPrint', () => ({
  default: vi.fn(({ slips, onClose }: any) => (
    <div data-testid="payslip-print-modal">
      <span>พิมพ์สลิป งวด {slips?.[0]?.period}</span>
      <button onClick={onClose}>ปิดหน้าต่าง</button>
    </div>
  )),
}))

import hrService from '../../services/hr.service'
import MyHr from './MyHr'

const mockHr = hrService as unknown as {
  getMe: ReturnType<typeof vi.fn>
  getCheckinLocation: ReturnType<typeof vi.fn>
  checkin: ReturnType<typeof vi.fn>
  getMyAttendance: ReturnType<typeof vi.fn>
  getMySlips: ReturnType<typeof vi.fn>
  getLeaveTypes: ReturnType<typeof vi.fn>
  getLeaveBalances: ReturnType<typeof vi.fn>
  getLeaveRequests: ReturnType<typeof vi.fn>
  createLeaveRequest: ReturnType<typeof vi.fn>
  cancelLeaveRequest: ReturnType<typeof vi.fn>
  getMyAdvances: ReturnType<typeof vi.fn>
  createMyAdvance: ReturnType<typeof vi.fn>
  cancelAdvance: ReturnType<typeof vi.fn>
  getMyTraining: ReturnType<typeof vi.fn>
  getMyRoster: ReturnType<typeof vi.fn>
  getColleagueShifts: ReturnType<typeof vi.fn>
  getMyShiftSwaps: ReturnType<typeof vi.fn>
  createShiftSwap: ReturnType<typeof vi.fn>
  acceptShiftSwap: ReturnType<typeof vi.fn>
  declineShiftSwap: ReturnType<typeof vi.fn>
  cancelShiftSwap: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHr.getCheckinLocation.mockResolvedValue(null)
  mockHr.getMyAttendance.mockResolvedValue({
    employee: { id: 'emp-1', code: 'EMP001', name: 'สมชาย ใจดี', device_pin: '1001', shift_name: 'กะเช้า' },
    logs: [],
    days: [],
    totals: null,
  })
  mockHr.getMySlips.mockResolvedValue([])
  mockHr.getLeaveTypes.mockResolvedValue([])
  mockHr.getLeaveBalances.mockResolvedValue([])
  mockHr.getLeaveRequests.mockResolvedValue([])
  mockHr.getMyAdvances.mockResolvedValue([])
  mockHr.getMyTraining.mockResolvedValue([])
  mockHr.getMyRoster.mockResolvedValue({
    week_start: '2026-11-09',
    employee_id: 'emp-1',
    days: [
      { date: '2026-11-09', shift: null, source: 'NONE', on_leave: false, holiday: false },
      { date: '2026-11-10', shift: null, source: 'NONE', on_leave: false, holiday: false },
      { date: '2026-11-11', shift: null, source: 'NONE', on_leave: false, holiday: false },
      { date: '2026-11-12', shift: null, source: 'NONE', on_leave: false, holiday: false },
      { date: '2026-11-13', shift: null, source: 'NONE', on_leave: false, holiday: false },
      { date: '2026-11-14', shift: null, source: 'NONE', on_leave: false, holiday: false },
      { date: '2026-11-15', shift: null, source: 'NONE', on_leave: false, holiday: false },
    ],
  })
  mockHr.getColleagueShifts.mockResolvedValue([])
  mockHr.getMyShiftSwaps.mockResolvedValue([])
})

describe('หน้าของฉัน /hr/me (MyHr)', () => {
  it('ผู้ใช้ที่ยังไม่ได้ผูกกับพนักงาน (getMe 404) จะเห็นการ์ดแจ้งเตือนและไม่เห็นส่วนอื่น', async () => {
    mockHr.getMe.mockRejectedValue({
      response: { status: 404, data: { message: 'Employee not found' } },
    })

    render(<MyHr />)

    expect(
      await screen.findByText('บัญชีนี้ยังไม่ได้ผูกกับพนักงาน ติดต่อฝ่ายบุคคล')
    ).toBeTruthy()

    // ไม่แสดงปุ่มบันทึกเวลาหรือการ์ดอื่นๆ
    expect(screen.queryByText('บันทึกเวลา')).toBeNull()
    expect(screen.queryByText('เวลาของฉัน')).toBeNull()
    expect(screen.queryByText('สลิปเงินเดือน')).toBeNull()
  })

  it('ผู้ใช้ที่ผูกแล้วกดบันทึกเวลา → เรียก checkin พร้อม lat/lng และแสดงแบนเนอร์ เข้างาน', async () => {
    mockHr.getMe.mockResolvedValue({
      id: 'emp-1',
      code: 'EMP-001',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
      position: 'บาริสต้า',
      org_unit_name: 'หน้าร้าน',
    })

    mockHr.getCheckinLocation.mockResolvedValue({
      lat: 13.7563,
      lng: 100.5018,
      radius_m: 150,
    })

    mockHr.checkin.mockResolvedValue({
      punched_at: '2026-11-02 08:57:00',
      kind: 'IN',
      employee_name: 'สมชาย ใจดี',
      distance_m: 35,
    })

    // Mock navigator.geolocation
    const mockGetCurrentPosition = vi.fn().mockImplementation((success) => {
      success({
        coords: {
          latitude: 13.7564,
          longitude: 100.5019,
          accuracy: 10,
        },
      })
    })

    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        getCurrentPosition: mockGetCurrentPosition,
      },
    })

    render(<MyHr />)

    const checkinBtn = await screen.findByRole('button', { name: /บันทึกเวลา/ })
    expect(checkinBtn).toBeTruthy()

    fireEvent.click(checkinBtn)

    await waitFor(() => {
      expect(mockGetCurrentPosition).toHaveBeenCalled()
      expect(mockHr.checkin).toHaveBeenCalledWith({
        lat: 13.7564,
        lng: 100.5019,
        accuracy: 10,
      })
    })

    // แบนเนอร์ความสำเร็จแสดงข้อความ เข้างาน 08:57 · ห่างร้าน 35 ม.
    expect(await screen.findByText(/เข้างาน 08:57 · ห่างร้าน 35 ม\./)).toBeTruthy()
  })

  it('ถ้าไม่ได้ตั้งจุดเช็คอิน (no location configured) จะส่งบันทึกเวลาโดยไม่ต้องใช้ GPS', async () => {
    mockHr.getMe.mockResolvedValue({
      id: 'emp-1',
      code: 'EMP-001',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
    })
    mockHr.getCheckinLocation.mockResolvedValue(null)
    mockHr.checkin.mockResolvedValue({
      punched_at: '2026-11-02 18:30:00',
      kind: 'OUT',
      employee_name: 'สมชาย ใจดี',
      distance_m: null,
    })

    const mockGetCurrentPosition = vi.fn()
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition: mockGetCurrentPosition },
    })

    render(<MyHr />)

    const checkinBtn = await screen.findByRole('button', { name: /บันทึกเวลา/ })
    fireEvent.click(checkinBtn)

    await waitFor(() => {
      expect(mockGetCurrentPosition).not.toHaveBeenCalled()
      expect(mockHr.checkin).toHaveBeenCalledWith({})
    })

    expect(await screen.findByText(/ออกงาน 18:30/)).toBeTruthy()
  })

  it('กรณีผู้ใช้ปฏิเสธสิทธิ์ตำแหน่ง (Permission Denied) จะแสดงคำแนะนำวิธีเปิดใช้งาน GPS', async () => {
    mockHr.getMe.mockResolvedValue({
      id: 'emp-1',
      code: 'EMP-001',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
    })
    mockHr.getCheckinLocation.mockResolvedValue({
      lat: 13.7563,
      lng: 100.5018,
      radius_m: 150,
    })

    const mockGetCurrentPosition = vi.fn().mockImplementation((_success, error) => {
      error({ code: 1, message: 'User denied Geolocation' })
    })
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition: mockGetCurrentPosition },
    })

    render(<MyHr />)

    const checkinBtn = await screen.findByRole('button', { name: /บันทึกเวลา/ })
    fireEvent.click(checkinBtn)

    expect(await screen.findByText('ไม่สามารถเข้าถึงตำแหน่ง (GPS) ได้')).toBeTruthy()
    expect(screen.getByText(/บริการหาตำแหน่ง/)).toBeTruthy()
    expect(mockHr.checkin).not.toHaveBeenCalled()
  })

  it('แสดงตารางเวลา 14 วันล่าสุดและแถวสรุปยอดรวม (totals)', async () => {
    mockHr.getMe.mockResolvedValue({
      id: 'emp-1',
      code: 'EMP-001',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
    })
    mockHr.getMyAttendance.mockResolvedValue({
      employee: { id: 'emp-1', code: 'EMP-001', name: 'สมชาย ใจดี', device_pin: '1001', shift_name: 'กะเช้า' },
      logs: [],
      days: [
        {
          workDate: '2026-11-01',
          in: '2026-11-01 09:10:00',
          out: '2026-11-01 18:05:00',
          workedMinutes: 480,
          lateMinutes: 10,
          earlyLeaveMinutes: 0,
          otCandidateMinutes: 30,
          missingOut: false,
          absent: false,
        },
      ],
      totals: {
        daysWorked: 1,
        absentDays: 0,
        lateMinutes: 10,
        earlyLeaveMinutes: 0,
        otCandidateMinutes: 30,
        leaveDays: 0,
        holidayDays: 0,
      },
    })

    render(<MyHr />)

    expect(await screen.findByText('2026-11-01')).toBeTruthy()
    expect(screen.getByText('09:10')).toBeTruthy()
    expect(screen.getByText('18:05')).toBeTruthy()
    expect(screen.getByText('10')).toBeTruthy()
    expect(screen.getByText(/ทำงาน 1 วัน/)).toBeTruthy()
    expect(screen.getByText(/สาย 10 นาที/)).toBeTruthy()
  })

  it('สามารถเปิดฟอร์มขอลา ส่งคำขอ และแสดงข้อความ ส่งคำขอแล้ว รอหัวหน้าอนุมัติ', async () => {
    mockHr.getMe.mockResolvedValue({
      id: 'emp-1',
      code: 'EMP-001',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
    })
    mockHr.getLeaveTypes.mockResolvedValue([
      { id: 'lt-1', code: 'SICK', name: 'ลาป่วย', paid: true, days_per_year: 30, is_active: true },
    ])
    mockHr.getLeaveBalances.mockResolvedValue([
      { leave_type_id: 'lt-1', code: 'SICK', name: 'ลาป่วย', paid: true, quota: 30, used: 2, pending: 0, remaining: 28 },
    ])
    mockHr.createLeaveRequest.mockResolvedValue({
      id: 'lr-1',
      employee_id: 'emp-1',
      leave_type_id: 'lt-1',
      start_date: '2026-11-05',
      end_date: '2026-11-05',
      days: 1,
      status: 'PENDING',
    })

    render(<MyHr />)

    const openLeaveBtn = await screen.findByRole('button', { name: /ขอลา/ })
    fireEvent.click(openLeaveBtn)

    // Form modal opens
    expect(screen.getByText('-- เลือกประเภทการลา --')).toBeTruthy()

    // Fill form
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'lt-1' } })
    fireEvent.change(screen.getByLabelText(/เหตุผลการลา/), { target: { value: 'เป็นไข้หวัด' } })

    const submitBtn = screen.getByRole('button', { name: /ส่งคำขอลา/ })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockHr.createLeaveRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          employee_id: 'emp-1',
          leave_type_id: 'lt-1',
          days: 1,
          reason: 'เป็นไข้หวัด',
        })
      )
    })

    expect(await screen.findByText('ส่งคำขอแล้ว รอหัวหน้าอนุมัติ')).toBeTruthy()
  })

  it('แสดงรายการสลิปเงินเดือนและสามารถกดพิมพ์สลิปได้', async () => {
    mockHr.getMe.mockResolvedValue({
      id: 'emp-1',
      code: 'EMP-001',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
    })
    mockHr.getMySlips.mockResolvedValue([
      {
        id: 'slip-1',
        run_id: 'run-1',
        employee_id: 'emp-1',
        period: '2026-10',
        pay_date: '2026-10-31',
        net: 25000,
        late: 0,
        sso_employee: 750,
        wht: 0,
        other_deduction: 0,
        result: {
          basePay: 25750,
          gross: 25750,
          net: 25000,
          lines: [],
        },
      },
    ])

    render(<MyHr />)

    expect(await screen.findByText(/งวด 2026-10/)).toBeTruthy()
    expect(screen.getByText(/25,000.00 ฿/)).toBeTruthy()

    // Click พิมพ์
    const printBtn = screen.getByRole('button', { name: /พิมพ์/ })
    fireEvent.click(printBtn)

    // Modal opens
    expect(await screen.findByTestId('payslip-print-modal')).toBeTruthy()
    expect(screen.getByText('พิมพ์สลิป งวด 2026-10')).toBeTruthy()

    // Close modal
    fireEvent.click(screen.getByText('ปิดหน้าต่าง'))
    expect(screen.queryByTestId('payslip-print-modal')).toBeNull()
  })

  it('ผู้ใช้ที่ผูกแล้วเปิด ขอเบิก / ยืมเงิน เลือก LOAN 3000 x 3 → แสดง preview ผ่อนงวดละ 1,000.00 → ส่งคำขอสำเร็จ', async () => {
    mockHr.getMe.mockResolvedValue({
      id: 'emp-1',
      code: 'EMP-001',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
    })
    mockHr.createMyAdvance.mockResolvedValue({
      id: 'adv-1',
      employee_id: 'emp-1',
      kind: 'LOAN',
      amount: 3000,
      installments: 3,
      installment_amount: 1000,
      start_period: '2026-12',
      status: 'PENDING',
      outstanding: 3000,
      repaid: 0,
      created_at: '2026-11-02T10:00:00Z',
    })

    render(<MyHr />)

    const openBtn = await screen.findByRole('button', { name: /ขอเบิก \/ ยืมเงิน/ })
    fireEvent.click(openBtn)

    // Radio pick LOAN
    const loanRadio = screen.getByLabelText(/ยืมเงินผ่อนหลายงวด/)
    fireEvent.click(loanRadio)

    // Fill amount 3000
    const amountInput = screen.getByLabelText(/จำนวนเงิน/)
    fireEvent.change(amountInput, { target: { value: '3000' } })

    // Fill installments 3
    const installmentsInput = screen.getByLabelText(/จำนวนงวด/)
    fireEvent.change(installmentsInput, { target: { value: '3' } })

    // Preview
    expect(await screen.findByText(/ผ่อนงวดละ 1,000\.00/)).toBeTruthy()
    expect(screen.getByText('* ยอดผ่อนจริงอาจรวมดอกเบี้ยตามที่บริษัทกำหนด')).toBeTruthy()

    // Submit
    const submitBtn = screen.getByRole('button', { name: /ส่งคำขอ/ })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockHr.createMyAdvance).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'LOAN',
          amount: 3000,
          installments: 3,
        })
      )
    })

    expect(await screen.findByText('ส่งคำขอแล้ว รอหัวหน้าอนุมัติ')).toBeTruthy()
  })

  it('การ์ด อบรมของฉัน แสดงป้าย หมดแล้ว สำหรับรายการที่มี days_left: -1', async () => {
    mockHr.getMe.mockResolvedValue({
      id: 'emp-1',
      code: 'EMP-001',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
    })
    mockHr.getMyTraining.mockResolvedValue([
      {
        id: 'tr-1',
        course_id: 'c-1',
        course_name: 'ความปลอดภัยในการทำงาน',
        course_kind: 'INTERNAL',
        employee_id: 'emp-1',
        employee_code: 'EMP-001',
        employee_name: 'สมชาย ใจดี',
        trained_on: '2025-01-01',
        expires_on: '2026-01-01',
        provider: 'สถาบันความปลอดภัย',
        notes: null,
        days_left: -1,
        attachment_count: 0,
        created_at: '2025-01-01T00:00:00Z',
      },
    ])

    render(<MyHr />)

    expect(await screen.findByText('ความปลอดภัยในการทำงาน')).toBeTruthy()
    expect(screen.getByText('หมดแล้ว')).toBeTruthy()
  })

  it('การ์ด เบิก / ยืมเงิน แสดงรายการ PENDING และสามารถกดยกเลิกได้', async () => {
    mockHr.getMe.mockResolvedValue({
      id: 'emp-1',
      code: 'EMP-001',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
    })
    mockHr.getMyAdvances.mockResolvedValue([
      {
        id: 'adv-99',
        employee_id: 'emp-1',
        employee_code: 'EMP-001',
        employee_name: 'สมชาย ใจดี',
        kind: 'ADVANCE',
        amount: 2500,
        installments: 1,
        installment_amount: 2500,
        start_period: '2026-12',
        reason: 'ค่ารักษาพยาบาล',
        status: 'PENDING',
        approval_request_id: null,
        decided_at: null,
        disbursed_on: null,
        disburse_je_id: null,
        repaid: 0,
        outstanding: 2500,
        created_at: '2026-11-02T10:00:00Z',
      },
    ])
    mockHr.cancelAdvance.mockResolvedValue({
      id: 'adv-99',
      status: 'CANCELLED',
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<MyHr />)

    expect(await screen.findByText('เบิกค่าจ้างล่วงหน้า')).toBeTruthy()
    expect(screen.getByText('รออนุมัติ')).toBeTruthy()
    expect(screen.getAllByText(/2,500.00 ฿/).length).toBeGreaterThanOrEqual(1)

    const cancelBtn = screen.getByRole('button', { name: /ยกเลิก/ })
    fireEvent.click(cancelBtn)

    await waitFor(() => {
      expect(mockHr.cancelAdvance).toHaveBeenCalledWith('adv-99')
    })
  })

  it('การ์ด ตารางกะของฉัน แสดงชื่อกะสำหรับวันที่มีกะ และแสดง หยุด สำหรับวันที่ไม่มีกะ', async () => {
    mockHr.getMe.mockResolvedValue({
      id: 'emp-1',
      code: 'EMP-001',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
    })
    mockHr.getMyRoster.mockResolvedValue({
      week_start: '2026-11-09',
      employee_id: 'emp-1',
      days: [
        {
          date: '2026-11-09',
          shift: {
            id: 's-1',
            name: 'กะเช้า',
            start_time: '08:00',
            end_time: '17:00',
            grace_minutes: 15,
            break_minutes: 60,
            is_active: 1,
            hours: 8,
          },
          source: 'ASSIGNED',
          on_leave: false,
          holiday: false,
        },
        {
          date: '2026-11-10',
          shift: null,
          source: 'NONE',
          on_leave: false,
          holiday: false,
        },
        { date: '2026-11-11', shift: null, source: 'NONE', on_leave: false, holiday: false },
        { date: '2026-11-12', shift: null, source: 'NONE', on_leave: false, holiday: false },
        { date: '2026-11-13', shift: null, source: 'NONE', on_leave: false, holiday: false },
        { date: '2026-11-14', shift: null, source: 'NONE', on_leave: false, holiday: false },
        { date: '2026-11-15', shift: null, source: 'NONE', on_leave: false, holiday: false },
      ],
    })

    render(<MyHr />)

    expect(await screen.findByText('ตารางกะของฉัน')).toBeTruthy()
    expect(screen.getByText('กะเช้า')).toBeTruthy()
    expect(screen.getByText('08:00–17:00')).toBeTruthy()
    expect(screen.getAllByText('หยุด').length).toBeGreaterThanOrEqual(1)
  })

  it('ขอแลกกะ: เลือกวันที่ → แสดง radio เพื่อนร่วมงาน → เลือกเพื่อน → กดส่งคำขอ → เรียก createShiftSwap', async () => {
    mockHr.getMe.mockResolvedValue({
      id: 'emp-1',
      code: 'EMP-001',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
    })
    mockHr.getColleagueShifts.mockResolvedValue([
      {
        employee_id: 'emp-2',
        name: 'สมศรี มีสุข',
        org_unit_name: 'หน้าร้าน',
        shift: {
          id: 's-2',
          name: 'กะบ่าย',
          start_time: '13:00',
          end_time: '22:00',
          grace_minutes: 15,
          break_minutes: 60,
          is_active: 1,
          hours: 8,
        },
      },
    ])
    mockHr.createShiftSwap.mockResolvedValue({
      id: 'swap-1',
      work_date: '2026-11-10',
      requester_employee_id: 'emp-1',
      requester_name: 'สมชาย ใจดี',
      target_employee_id: 'emp-2',
      target_name: 'สมศรี มีสุข',
      requester_shift: null,
      target_shift: null,
      reason: 'ติดธุระ',
      status: 'PEER_PENDING',
      approval_request_id: null,
      created_at: '2026-11-09T10:00:00Z',
    })

    render(<MyHr />)

    const openSwapBtn = await screen.findByRole('button', { name: /ขอแลกกะ/ })
    fireEvent.click(openSwapBtn)

    // Pick date
    const dateInput = screen.getByLabelText(/วันที่ต้องการแลกกะ/)
    fireEvent.change(dateInput, { target: { value: '2026-11-10' } })

    await waitFor(() => {
      expect(mockHr.getColleagueShifts).toHaveBeenCalledWith('2026-11-10')
    })

    // Colleague radio appears
    const colleagueRadio = await screen.findByRole('radio', { name: /สมศรี มีสุข/ })
    fireEvent.click(colleagueRadio)

    // Optional reason
    const reasonInput = screen.getByLabelText(/เหตุผล/)
    fireEvent.change(reasonInput, { target: { value: 'ติดธุระ' } })

    // Submit
    const submitBtn = screen.getByRole('button', { name: /ส่งคำขอแลกกะ/ })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockHr.createShiftSwap).toHaveBeenCalledWith({
        target_employee_id: 'emp-2',
        work_date: '2026-11-10',
        reason: 'ติดธุระ',
      })
    })

    expect(await screen.findByText('ส่งคำขอแล้ว รอเพื่อนตอบรับ')).toBeTruthy()
  })

  it('คำขอสถานะ PEER_PENDING ที่พนักงานที่ผูกไว้เป็นผู้ถูกขอ จะแสดงปุ่ม ตกลงแลก และเมื่อคลิกจะเรียก acceptShiftSwap', async () => {
    mockHr.getMe.mockResolvedValue({
      id: 'emp-1',
      code: 'EMP-001',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
    })
    mockHr.getMyShiftSwaps.mockResolvedValue([
      {
        id: 'swap-101',
        work_date: '2026-11-15',
        requester_employee_id: 'emp-2',
        requester_name: 'สมศรี มีสุข',
        requester_shift: { name: 'กะบ่าย' } as any,
        target_employee_id: 'emp-1',
        target_name: 'สมชาย ใจดี',
        target_shift: { name: 'กะเช้า' } as any,
        reason: 'ขอสลับกะ',
        status: 'PEER_PENDING',
        approval_request_id: null,
        created_at: '2026-11-09T10:00:00Z',
      },
    ])
    mockHr.acceptShiftSwap.mockResolvedValue({
      id: 'swap-101',
      status: 'PENDING',
    })

    render(<MyHr />)

    expect(await screen.findByText('2026-11-15')).toBeTruthy()
    expect(screen.getByText('รอเพื่อนตอบ')).toBeTruthy()
    expect(screen.getByText(/สมศรี มีสุข \(กะบ่าย\) ⇄ สมชาย ใจดี \(กะเช้า\)/)).toBeTruthy()

    const acceptBtn = screen.getByRole('button', { name: /ตกลงแลก/ })
    expect(acceptBtn).toBeTruthy()

    fireEvent.click(acceptBtn)

    await waitFor(() => {
      expect(mockHr.acceptShiftSwap).toHaveBeenCalledWith('swap-101')
    })
  })

  it('คำขอสถานะ PEER_PENDING ที่พนักงานเป็นผู้ถูกขอ สามารถกด ปฏิเสธ ได้', async () => {
    mockHr.getMe.mockResolvedValue({
      id: 'emp-1',
      code: 'EMP-001',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
    })
    mockHr.getMyShiftSwaps.mockResolvedValue([
      {
        id: 'swap-102',
        work_date: '2026-11-15',
        requester_employee_id: 'emp-2',
        requester_name: 'สมศรี มีสุข',
        requester_shift: null,
        target_employee_id: 'emp-1',
        target_name: 'สมชาย ใจดี',
        target_shift: null,
        reason: null,
        status: 'PEER_PENDING',
        approval_request_id: null,
        created_at: '2026-11-09T10:00:00Z',
      },
    ])
    mockHr.declineShiftSwap.mockResolvedValue({
      id: 'swap-102',
      status: 'DECLINED',
    })

    render(<MyHr />)

    const declineBtn = await screen.findByRole('button', { name: /ปฏิเสธ/ })
    fireEvent.click(declineBtn)

    await waitFor(() => {
      expect(mockHr.declineShiftSwap).toHaveBeenCalledWith('swap-102')
    })
  })

  it('คำขอสถานะ PEER_PENDING หรือ PENDING ที่พนักงานเป็นผู้ขอ สามารถกด ยกเลิก ได้', async () => {
    mockHr.getMe.mockResolvedValue({
      id: 'emp-1',
      code: 'EMP-001',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
    })
    mockHr.getMyShiftSwaps.mockResolvedValue([
      {
        id: 'swap-103',
        work_date: '2026-11-16',
        requester_employee_id: 'emp-1',
        requester_name: 'สมชาย ใจดี',
        requester_shift: null,
        target_employee_id: 'emp-2',
        target_name: 'สมศรี มีสุข',
        target_shift: null,
        reason: null,
        status: 'PENDING',
        approval_request_id: null,
        created_at: '2026-11-09T10:00:00Z',
      },
    ])
    mockHr.cancelShiftSwap.mockResolvedValue({
      id: 'swap-103',
      status: 'CANCELLED',
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<MyHr />)

    expect(await screen.findByText('2026-11-16')).toBeTruthy()
    expect(screen.getByText('รอหัวหน้าอนุมัติ')).toBeTruthy()

    // Find the cancel button in the swap card
    const cancelButtons = screen.getAllByRole('button', { name: /ยกเลิก/ })
    fireEvent.click(cancelButtons[0])

    await waitFor(() => {
      expect(mockHr.cancelShiftSwap).toHaveBeenCalledWith('swap-103')
    })
  })

  it('สามารถกดปุ่ม ‹ และ › เพื่อเลื่อนสัปดาห์ในตารางกะได้', async () => {
    mockHr.getMe.mockResolvedValue({
      id: 'emp-1',
      code: 'EMP-001',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
    })
    render(<MyHr />)

    const prevWeekBtn = await screen.findByRole('button', { name: /‹/ })
    const nextWeekBtn = screen.getByRole('button', { name: /›/ })

    fireEvent.click(prevWeekBtn)
    await waitFor(() => {
      expect(mockHr.getMyRoster).toHaveBeenCalled()
    })

    fireEvent.click(nextWeekBtn)
    await waitFor(() => {
      expect(mockHr.getMyRoster).toHaveBeenCalled()
    })
  })
})
