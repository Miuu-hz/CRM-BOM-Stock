import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../../services/hr.service', () => ({
  default: {
    getOffsiteRequests: vi.fn(),
    createOffsiteRequest: vi.fn(),
    cancelOffsiteRequest: vi.fn(),
  },
}))

import hrService from '../../services/hr.service'
import toast from 'react-hot-toast'
import MyOffsite from './MyOffsite'

const mockHr = hrService as unknown as {
  getOffsiteRequests: ReturnType<typeof vi.fn>
  createOffsiteRequest: ReturnType<typeof vi.fn>
  cancelOffsiteRequest: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHr.getOffsiteRequests.mockResolvedValue([])
  mockHr.createOffsiteRequest.mockResolvedValue({} as any)
  mockHr.cancelOffsiteRequest.mockResolvedValue({} as any)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('การ์ดทำงานนอกสถานที่ MyOffsite', () => {
  it('แสดงการ์ด ทำงานนอกสถานที่ พร้อมรายการคำขอเดิมและป้ายสถานะ', async () => {
    mockHr.getOffsiteRequests.mockResolvedValue([
      {
        id: 'off-1',
        employee_id: 'emp-1',
        employee_code: 'EMP001',
        employee_name: 'สมชาย ใจดี',
        start_date: '2026-11-20',
        end_date: '2026-11-21',
        place: 'ไซต์งานลูกค้า ก',
        reason: 'ติดตั้งอุปกรณ์',
        status: 'PENDING',
        decided_at: null,
        created_at: '2026-11-17T09:00:00Z',
      },
      {
        id: 'off-2',
        employee_id: 'emp-1',
        employee_code: 'EMP001',
        employee_name: 'สมชาย ใจดี',
        start_date: '2026-11-25',
        end_date: '2026-11-25',
        place: 'งานสัมมนา ข',
        reason: null,
        status: 'APPROVED',
        decided_at: '2026-11-18T10:00:00Z',
        created_at: '2026-11-17T10:00:00Z',
      },
    ])

    render(<MyOffsite />)

    expect(await screen.findByText('ทำงานนอกสถานที่')).toBeTruthy()
    expect(await screen.findByText('ไซต์งานลูกค้า ก')).toBeTruthy()
    expect(screen.getByText(/2026-11-20 ถึง 2026-11-21/)).toBeTruthy()
    expect(screen.getByText('"ติดตั้งอุปกรณ์"')).toBeTruthy()
    expect(screen.getByText('รออนุมัติ')).toBeTruthy()

    expect(screen.getByText('งานสัมมนา ข')).toBeTruthy()
    expect(screen.getByText('2026-11-25')).toBeTruthy()
    expect(screen.getByText('อนุมัติแล้ว')).toBeTruthy()

    // ปุ่มยกเลิกแสดงเฉพาะแถว PENDING
    const cancelButtons = screen.getAllByRole('button', { name: /ยกเลิก/ })
    expect(cancelButtons.length).toBe(1)
  })

  it('ส่งฟอร์มสำเร็จ: กรอกข้อมูลครบถ้วน → เรียก createOffsiteRequest ด้วยค่าที่กรอก', async () => {
    mockHr.createOffsiteRequest.mockResolvedValue({
      id: 'off-3',
      employee_id: 'emp-1',
      employee_code: 'EMP001',
      employee_name: 'สมชาย ใจดี',
      start_date: '2026-11-20',
      end_date: '2026-11-22',
      place: 'สำนักงานสาขาพัทยา',
      reason: 'ตรวจงานสาขา',
      status: 'PENDING',
      decided_at: null,
      created_at: '2026-11-17T10:00:00Z',
    })

    render(<MyOffsite />)

    const openBtn = await screen.findByRole('button', { name: /ขอทำงานนอกสถานที่/ })
    fireEvent.click(openBtn)

    // Modal opens
    expect(screen.getByLabelText(/สถานที่/)).toBeTruthy()

    // Fill form
    fireEvent.change(screen.getByLabelText(/วันเริ่ม/), { target: { value: '2026-11-20' } })
    fireEvent.change(screen.getByLabelText(/วันสิ้นสุด/), { target: { value: '2026-11-22' } })
    fireEvent.change(screen.getByLabelText(/สถานที่/), { target: { value: 'สำนักงานสาขาพัทยา' } })
    fireEvent.change(screen.getByLabelText(/เหตุผล/), { target: { value: 'ตรวจงานสาขา' } })

    const submitBtn = screen.getByRole('button', { name: /ส่งคำขอ/ })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockHr.createOffsiteRequest).toHaveBeenCalledWith({
        start_date: '2026-11-20',
        end_date: '2026-11-22',
        place: 'สำนักงานสาขาพัทยา',
        reason: 'ตรวจงานสาขา',
      })
    })

    expect(await screen.findByText('ส่งคำขอแล้ว รอหัวหน้าอนุมัติ')).toBeTruthy()
    expect(toast.success).toHaveBeenCalledWith('ส่งคำขอแล้ว รอหัวหน้าอนุมัติ')
  })

  it('วันสิ้นสุด default เป็นวันเดียวกับวันเริ่มเมื่อเปลี่ยนวันเริ่ม', async () => {
    render(<MyOffsite defaultOpen />)

    const startDateInput = screen.getByLabelText(/วันเริ่ม/)
    const endDateInput = screen.getByLabelText(/วันสิ้นสุด/) as HTMLInputElement

    fireEvent.change(startDateInput, { target: { value: '2026-12-10' } })
    expect(endDateInput.value).toBe('2026-12-10')
  })

  it('place ว่าง → ไม่เรียก createOffsiteRequest และแสดงข้อความเตือน', async () => {
    render(<MyOffsite defaultOpen />)

    const placeInput = screen.getByLabelText(/สถานที่/)
    fireEvent.change(placeInput, { target: { value: '   ' } })

    const submitBtn = screen.getByRole('button', { name: /ส่งคำขอ/ })
    fireEvent.click(submitBtn)

    expect(mockHr.createOffsiteRequest).not.toHaveBeenCalled()
    expect(await screen.findByText('กรุณาระบุสถานที่')).toBeTruthy()
  })

  it('ยกเลิกคำขอ PENDING: กดยกเลิก → เรียก cancelOffsiteRequest', async () => {
    mockHr.getOffsiteRequests.mockResolvedValue([
      {
        id: 'off-pending-99',
        employee_id: 'emp-1',
        employee_code: 'EMP001',
        employee_name: 'สมชาย ใจดี',
        start_date: '2026-11-25',
        end_date: '2026-11-25',
        place: 'ไซต์งานทดสอบ',
        reason: null,
        status: 'PENDING',
        decided_at: null,
        created_at: '2026-11-17T10:00:00Z',
      },
    ])
    mockHr.cancelOffsiteRequest.mockResolvedValue({
      id: 'off-pending-99',
      status: 'CANCELLED',
    } as any)

    render(<MyOffsite />)

    const cancelBtn = await screen.findByRole('button', { name: /ยกเลิก/ })
    fireEvent.click(cancelBtn)

    await waitFor(() => {
      expect(mockHr.cancelOffsiteRequest).toHaveBeenCalledWith('off-pending-99')
    })

    expect(toast.success).toHaveBeenCalledWith('ยกเลิกคำขอเรียบร้อยแล้ว')
  })

  it('ยกเลิกคำขอ: เมื่อปฏิเสธการยืนยัน จะไม่เรียก cancelOffsiteRequest', async () => {
    mockHr.getOffsiteRequests.mockResolvedValue([
      {
        id: 'off-pending-99',
        employee_id: 'emp-1',
        employee_code: 'EMP001',
        employee_name: 'สมชาย ใจดี',
        start_date: '2026-11-25',
        end_date: '2026-11-25',
        place: 'ไซต์งานทดสอบ',
        reason: null,
        status: 'PENDING',
        decided_at: null,
        created_at: '2026-11-17T10:00:00Z',
      },
    ])
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<MyOffsite />)

    const cancelBtn = await screen.findByRole('button', { name: /ยกเลิก/ })
    fireEvent.click(cancelBtn)

    expect(confirmSpy).toHaveBeenCalled()
    expect(mockHr.cancelOffsiteRequest).not.toHaveBeenCalled()
  })

  it('แสดง error จาก server ตรง ๆ เมื่อส่งคำขอไม่สำเร็จ', async () => {
    mockHr.createOffsiteRequest.mockRejectedValue({
      response: { data: { message: 'มีคำขอทำงานนอกสถานที่ช่วงนี้อยู่แล้ว' } },
    })

    render(<MyOffsite defaultOpen />)

    fireEvent.change(screen.getByLabelText(/สถานที่/), { target: { value: 'ไซต์งานทับซ้อน' } })
    const submitBtn = screen.getByRole('button', { name: /ส่งคำขอ/ })
    fireEvent.click(submitBtn)

    expect(await screen.findByText('มีคำขอทำงานนอกสถานที่ช่วงนี้อยู่แล้ว')).toBeTruthy()
    expect(toast.error).toHaveBeenCalledWith('มีคำขอทำงานนอกสถานที่ช่วงนี้อยู่แล้ว')
  })

  it('โหลดข้อมูลล้มเหลวจะไม่ throw error และแสดงรายการว่าง', async () => {
    mockHr.getOffsiteRequests.mockRejectedValue(new Error('Network error'))

    render(<MyOffsite />)

    expect(await screen.findByText('ทำงานนอกสถานที่')).toBeTruthy()
    expect(await screen.findByText('ยังไม่มีคำขอทำงานนอกสถานที่')).toBeTruthy()
  })

  it('กรณีไม่มีฟังก์ชัน getOffsiteRequests ใน service (เช่นใน MyHr.test) จะไม่ throw error และแสดงรายการว่าง', async () => {
    const original = mockHr.getOffsiteRequests
    ;(mockHr as any).getOffsiteRequests = undefined

    render(<MyOffsite />)

    expect(await screen.findByText('ทำงานนอกสถานที่')).toBeTruthy()
    expect(await screen.findByText('ยังไม่มีคำขอทำงานนอกสถานที่')).toBeTruthy()

    mockHr.getOffsiteRequests = original
  })

  it('วันเริ่มต้นมากกว่าวันสิ้นสุด → ไม่เรียก createOffsiteRequest และแสดงข้อความเตือน', async () => {
    render(<MyOffsite defaultOpen />)

    fireEvent.change(screen.getByLabelText(/วันเริ่ม/), { target: { value: '2026-11-25' } })
    fireEvent.change(screen.getByLabelText(/วันสิ้นสุด/), { target: { value: '2026-11-20' } })
    fireEvent.change(screen.getByLabelText(/สถานที่/), { target: { value: 'ไซต์งานทดสอบ' } })

    // ช่องวันสิ้นสุดมี min → เบราว์เซอร์ (และ jsdom) บล็อกการกดส่งเอง · ยิง submit ตรงเพื่อทดสอบด่านใน handleSubmit
    const submitBtn = screen.getByRole('button', { name: /ส่งคำขอ/ })
    fireEvent.submit(submitBtn.closest('form')!)

    expect(mockHr.createOffsiteRequest).not.toHaveBeenCalled()
    expect(await screen.findByText('วันเริ่มต้นต้องไม่มากกว่าวันสิ้นสุด')).toBeTruthy()
  })
})
