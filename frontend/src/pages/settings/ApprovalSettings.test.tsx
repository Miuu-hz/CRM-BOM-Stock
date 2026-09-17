import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * เทสต์ตัวแรกของฝั่งเว็บ — จงใจเลือกบั๊กที่ typecheck จับไม่ได้และของจริงเคยพังมาแล้ว:
 * สวิตช์ลัดในหน้าตั้งค่าเคยส่ง autoApproveThreshold: 0 ตายตัว
 * เจ้าของตั้งวงเงิน ฿500 แล้วเผลอปิด-เปิดสวิตช์ทีเดียว วงเงินหายเกลี้ยงแบบเงียบ ๆ
 */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

import api from '../../services/api'
import ApprovalSettings from './ApprovalSettings'

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> }

// t() ถูก mock ให้คืน key ตรง ๆ — aria-label ของหมวดจึงเป็น key นี้
const STOCK = 'settings.approval.modules.stockChange'

function seedApi(threshold: number, approvalRequired = 1) {
  mockApi.get.mockImplementation((url: string) => {
    if (url === '/approval/settings') {
      return Promise.resolve({
        data: {
          data: [{
            id: 's1',
            role: 'USER',
            module_type: 'stock_adjust',
            approval_required: approvalRequired,
            auto_approve_threshold: threshold,
          }],
        },
      })
    }
    return Promise.resolve({ data: { data: [] } })
  })
  mockApi.post.mockResolvedValue({ data: { success: true } })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('หน้าตั้งค่าการอนุมัติ — สวิตช์ลัด', () => {
  it('ปิดสวิตช์แล้วต้องไม่ล้างวงเงินที่บริษัทตั้งไว้', async () => {
    seedApi(500)
    render(<ApprovalSettings />)

    const toggle = await screen.findByRole('switch', { name: STOCK })
    expect(toggle.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(toggle)

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    expect(mockApi.post).toHaveBeenCalledWith('/approval/settings', {
      role: 'USER',
      moduleType: 'stock_adjust',
      approvalRequired: false,
      autoApproveThreshold: 500,
    })
  })

  it('กรอกวงเงินใหม่แล้วคลิกออก = บันทึกตัวเลขที่พิมพ์ และยังเปิดหมวดไว้', async () => {
    seedApi(500)
    render(<ApprovalSettings />)

    const input = await screen.findByLabelText(STOCK + ' — วงเงินที่ทำเองได้')
    fireEvent.change(input, { target: { value: '2000' } })
    fireEvent.blur(input)

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    expect(mockApi.post).toHaveBeenCalledWith('/approval/settings', {
      role: 'USER',
      moduleType: 'stock_adjust',
      approvalRequired: true,
      autoApproveThreshold: 2000,
    })
  })

  it('กรอกค่าเดิมซ้ำ ไม่ต้องยิง API', async () => {
    seedApi(500)
    render(<ApprovalSettings />)

    const input = await screen.findByLabelText(STOCK + ' — วงเงินที่ทำเองได้')
    fireEvent.blur(input)

    await new Promise((r) => setTimeout(r, 20))
    expect(mockApi.post).not.toHaveBeenCalled()
  })

  it('ค่าติดลบไม่ถูกบันทึก', async () => {
    seedApi(500)
    render(<ApprovalSettings />)

    const input = await screen.findByLabelText(STOCK + ' — วงเงินที่ทำเองได้')
    fireEvent.change(input, { target: { value: '-100' } })
    fireEvent.blur(input)

    await new Promise((r) => setTimeout(r, 20))
    expect(mockApi.post).not.toHaveBeenCalled()
  })

  it('หมวดที่ปิดอยู่ ไม่ต้องโชว์ช่องวงเงิน', async () => {
    seedApi(500, 0)
    render(<ApprovalSettings />)

    await screen.findByRole('switch', { name: STOCK })
    expect(screen.queryByLabelText(STOCK + ' — วงเงินที่ทำเองได้')).toBeNull()
  })
})
