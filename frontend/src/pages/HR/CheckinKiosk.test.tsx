import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import hrService from '../../services/hr.service'
import CheckinKiosk from './CheckinKiosk'

vi.mock('../../services/hr.service', () => ({
  default: {
    checkinWithPin: vi.fn(),
  },
}))

const mockHr = hrService as unknown as {
  checkinWithPin: ReturnType<typeof vi.fn>
}

describe('หน้าจอเช็คอินหน้าร้าน (CheckinKiosk)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    // Mock geolocation
    const mockGeolocation = {
      getCurrentPosition: vi.fn((success) => {
        success({
          coords: {
            latitude: 13.7563,
            longitude: 100.5018,
            accuracy: 12,
          },
        })
      }),
    }
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: mockGeolocation,
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('แสดงนาฬิกา วันที่ ช่องกรอกรหัสพนักงาน และแป้นพิมพ์ตัวเลข', () => {
    render(<CheckinKiosk />)

    expect(screen.getByText('รหัสพนักงาน')).toBeTruthy()
    expect(screen.getByPlaceholderText(/EMP-001/)).toBeTruthy()
    expect(screen.getByText('PIN เช็คอิน (4–6 หลัก)')).toBeTruthy()
    expect(screen.getByText('บันทึกเวลา')).toBeTruthy()

    // Keypad numbers 0-9
    for (let i = 0; i <= 9; i++) {
      expect(screen.getByRole('button', { name: String(i) })).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: 'ล้าง' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ลบ' })).toBeTruthy()
  })

  it('กรอกรหัสพนักงาน + PIN และกดบันทึกเวลา จะเรียก checkinWithPin พร้อมพิกัด และแสดงชื่อพนักงาน', async () => {
    mockHr.checkinWithPin.mockResolvedValueOnce({
      punched_at: '2026-11-02 08:57:00',
      kind: 'IN',
      employee_name: 'สมชาย ใจดี',
      distance_m: 25,
    })

    render(<CheckinKiosk />)

    const codeInput = screen.getByTestId('employee-code-input')
    const pinInput = screen.getByTestId('pin-input')
    const submitBtn = screen.getByTestId('submit-checkin-btn')

    fireEvent.change(codeInput, { target: { value: 'EMP-001' } })
    fireEvent.change(pinInput, { target: { value: '1234' } })

    await act(async () => {
      fireEvent.click(submitBtn)
    })

    expect(mockHr.checkinWithPin).toHaveBeenCalledWith({
      employee_code: 'EMP-001',
      pin: '1234',
      lat: 13.7563,
      lng: 100.5018,
      accuracy: 12,
    })

    // Green banner shows employee name, kind, time
    const banner = screen.getByRole('alert')
    expect(banner.textContent).toContain('สมชาย ใจดี')
    expect(banner.textContent).toContain('เข้างาน 08:57')
  })

  it('แสดงข้อความแจ้งเตือนสีแดงเมื่อ server ปฏิเสธ (เช่น PIN ไม่ถูกต้อง)', async () => {
    mockHr.checkinWithPin.mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          success: false,
          message: 'รหัสพนักงานหรือ PIN ไม่ถูกต้อง',
        },
      },
    })

    render(<CheckinKiosk />)

    fireEvent.change(screen.getByTestId('employee-code-input'), { target: { value: 'EMP-001' } })
    fireEvent.change(screen.getByTestId('pin-input'), { target: { value: '9999' } })

    await act(async () => {
      fireEvent.click(screen.getByTestId('submit-checkin-btn'))
    })

    const banner = screen.getByRole('alert')
    expect(banner.textContent).toBe('รหัสพนักงานหรือ PIN ไม่ถูกต้อง')
  })

  it('แสดงข้อความล็อก 429 จาก server เมื่อถูกระงับชั่วคราว', async () => {
    mockHr.checkinWithPin.mockRejectedValueOnce({
      response: {
        status: 429,
        data: {
          success: false,
          message: 'ใส่ PIN ผิดเกินกำหนด ล็อกการใช้งาน 5 นาที',
        },
      },
    })

    render(<CheckinKiosk />)

    fireEvent.change(screen.getByTestId('employee-code-input'), { target: { value: 'EMP-001' } })
    fireEvent.change(screen.getByTestId('pin-input'), { target: { value: '0000' } })

    await act(async () => {
      fireEvent.click(screen.getByTestId('submit-checkin-btn'))
    })

    const banner = screen.getByRole('alert')
    expect(banner.textContent).toBe('ใส่ PIN ผิดเกินกำหนด ล็อกการใช้งาน 5 นาที')
  })

  it('สามารถกดปุ่มตัวเลขบน Keypad เพื่อกรอก PIN, ลบทีละตัว และล้างทั้งหมดได้', () => {
    render(<CheckinKiosk />)

    const pinInput = screen.getByTestId('pin-input') as HTMLInputElement

    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: '3' }))
    fireEvent.click(screen.getByRole('button', { name: '4' }))
    expect(pinInput.value).toBe('1234')

    // Delete one digit
    fireEvent.click(screen.getByRole('button', { name: 'ลบ' }))
    expect(pinInput.value).toBe('123')

    // Add 0
    fireEvent.click(screen.getByRole('button', { name: '0' }))
    expect(pinInput.value).toBe('1230')

    // Clear all
    fireEvent.click(screen.getByRole('button', { name: 'ล้าง' }))
    expect(pinInput.value).toBe('')
  })

  it('ส่งข้อมูลได้โดยไม่ต้องมี GPS หากอุปกรณ์ไม่รองรับหรือไม่ได้เปิดตำแหน่ง', async () => {
    // Delete geolocation
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: undefined,
      writable: true,
      configurable: true,
    })

    mockHr.checkinWithPin.mockResolvedValueOnce({
      punched_at: '2026-11-02 18:00:00',
      kind: 'OUT',
      employee_name: 'สมหญิง รักงาน',
      distance_m: null,
    })

    render(<CheckinKiosk />)

    fireEvent.change(screen.getByTestId('employee-code-input'), { target: { value: 'EMP-002' } })
    fireEvent.change(screen.getByTestId('pin-input'), { target: { value: '5678' } })

    await act(async () => {
      fireEvent.click(screen.getByTestId('submit-checkin-btn'))
    })

    expect(mockHr.checkinWithPin).toHaveBeenCalledWith({
      employee_code: 'EMP-002',
      pin: '5678',
    })

    const banner = screen.getByRole('alert')
    expect(banner.textContent).toContain('สมหญิง รักงาน · ออกงาน 18:00')
  })

  it('ล้างข้อมูลที่กรอกและแถบแจ้งเตือนโดยอัตโนมัติหลังผ่านไป 5 วินาที', async () => {
    mockHr.checkinWithPin.mockResolvedValueOnce({
      punched_at: '2026-11-02 08:30:00',
      kind: 'IN',
      employee_name: 'สมชาย',
      distance_m: 10,
    })

    render(<CheckinKiosk />)

    const codeInput = screen.getByTestId('employee-code-input') as HTMLInputElement
    const pinInput = screen.getByTestId('pin-input') as HTMLInputElement

    fireEvent.change(codeInput, { target: { value: 'EMP-001' } })
    fireEvent.change(pinInput, { target: { value: '1234' } })

    await act(async () => {
      fireEvent.click(screen.getByTestId('submit-checkin-btn'))
    })

    expect(screen.getByRole('alert')).toBeTruthy()

    // Advance 5 seconds
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(codeInput.value).toBe('')
    expect(pinInput.value).toBe('')
  })
})
