import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockT = vi.fn((key: string, opts?: Record<string, any>) => {
  if (key === 'settings.adminUserManagement.userCount' && opts?.count !== undefined) {
    return `${opts.count} คน`
  }
  return key
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}))

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../../services/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockMe = {
  id: 'u-admin-me',
  email: 'admin@company.com',
  name: 'แอดมิน สูงสุด',
  role: 'ADMIN',
}

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockMe,
  }),
}))

import api from '../../services/api'
import toast from 'react-hot-toast'
import AdminUserManagement from './AdminUserManagement'

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockT.mockImplementation((key: string, opts?: Record<string, any>) => {
    if (key === 'settings.adminUserManagement.userCount' && opts?.count !== undefined) {
      return `${opts.count} คน`
    }
    return key
  })
})

describe('หน้าจัดการผู้ใช้งาน (AdminUserManagement)', () => {
  it('แสดง "HR: EMP-001" สำหรับผู้ใช้ที่มี employee_code; ผู้ใช้ line_only แสดง "บัญชี LINE อย่างเดียว (ไม่นับจำนวนผู้ใช้)" และไม่มีปุ่มสร้างรหัสรีเซ็ตรหัสผ่าน ขณะที่ USER ปกติมีปุ่มนี้; จำนวนผู้ใช้นับเฉพาะผู้ใช้ที่ไม่ใช่ line_only', async () => {
    const users = [
      {
        id: 'u-admin-me',
        email: 'admin@company.com',
        name: 'แอดมิน สูงสุด',
        role: 'ADMIN',
        departments: ['IT'],
        status: 'active',
        employee_code: null,
        line_only: 0,
      },
      {
        id: 'u-emp',
        email: 'somchai@company.com',
        name: 'สมชาย พนักงาน',
        role: 'USER',
        departments: ['SALES'],
        status: 'active',
        employee_code: 'EMP-001',
        line_only: 0,
      },
      {
        id: 'u-line',
        email: 'line-only@company.com',
        name: 'สมศรี ไลน์บอท',
        role: 'USER',
        departments: [],
        status: 'active',
        employee_code: null,
        line_only: 1,
      },
    ]
    mockApi.get.mockResolvedValue({ data: { data: users } })

    render(<AdminUserManagement />)

    // shows "HR: EMP-001" for a user with employee_code
    expect(await screen.findByText('HR: EMP-001')).toBeTruthy()

    // a line_only user shows "บัญชี LINE อย่างเดียว (ไม่นับจำนวนผู้ใช้)"
    expect(screen.getByText('บัญชี LINE อย่างเดียว (ไม่นับจำนวนผู้ใช้)')).toBeTruthy()
    // and does not show email for line_only user
    expect(screen.queryByText('line-only@company.com')).toBeNull()

    // reset-code button check (title "สร้างรหัสรีเซ็ตรหัสผ่าน"):
    // normal USER has one, while line_only user and admin/me do not
    const resetButtons = screen.getAllByTitle('สร้างรหัสรีเซ็ตรหัสผ่าน')
    expect(resetButtons).toHaveLength(1)

    // specifically verify inside each user card container
    const empUserCard = screen.getByText('สมชาย พนักงาน').closest('div.rounded-xl')
    const lineUserCard = screen.getByText('สมศรี ไลน์บอท').closest('div.rounded-xl')
    expect(empUserCard?.querySelector('button[title="สร้างรหัสรีเซ็ตรหัสผ่าน"]')).toBeTruthy()
    expect(lineUserCard?.querySelector('button[title="สร้างรหัสรีเซ็ตรหัสผ่าน"]')).toBeNull()

    // the count excludes line_only users:
    // total 3 users, but 1 is line_only, so count is 2
    expect(mockT).toHaveBeenCalledWith('settings.adminUserManagement.userCount', { count: 2 })
    expect(screen.getByText('2 คน')).toBeTruthy()
  })

  it('กดปุ่มสร้างรหัสรีเซ็ตรหัสผ่านของ USER ปกติแล้วเรียก API /auth/admin/reset-token สำเร็จ', async () => {
    const users = [
      {
        id: 'u-emp',
        email: 'somchai@company.com',
        name: 'สมชาย พนักงาน',
        role: 'USER',
        departments: ['SALES'],
        status: 'active',
        employee_code: 'EMP-001',
        line_only: 0,
      },
    ]
    mockApi.get.mockResolvedValue({ data: { data: users } })
    mockApi.post.mockResolvedValue({ data: { data: { token: 'RESET-TOKEN-XYZ' } } })

    render(<AdminUserManagement />)

    const resetBtn = await screen.findByTitle('สร้างรหัสรีเซ็ตรหัสผ่าน')
    fireEvent.click(resetBtn)

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/auth/admin/reset-token', { userId: 'u-emp' })
    })
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('RESET-TOKEN-XYZ'),
      expect.objectContaining({ duration: 12000 })
    )
  })
})
