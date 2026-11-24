import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../../services/hr.service', () => ({
  default: {
    getEmployees: vi.fn(),
    getOrgUnits: vi.fn(),
    createEmployee: vi.fn(),
    updateEmployee: vi.fn(),
    offboardEmployee: vi.fn(),
    inviteEmployeeToLine: vi.fn(),
    getEmployeeFace: vi.fn(),
    deleteEmployeeFace: vi.fn(),
    getLinkableUsers: vi.fn(),
  },
}))

import hrService, { Employee, LinkableUser } from '../../services/hr.service'
import Employees from './Employees'

const mockHr = hrService as unknown as {
  getEmployees: ReturnType<typeof vi.fn>
  getOrgUnits: ReturnType<typeof vi.fn>
  createEmployee: ReturnType<typeof vi.fn>
  updateEmployee: ReturnType<typeof vi.fn>
  offboardEmployee: ReturnType<typeof vi.fn>
  inviteEmployeeToLine: ReturnType<typeof vi.fn>
  getEmployeeFace: ReturnType<typeof vi.fn>
  deleteEmployeeFace: ReturnType<typeof vi.fn>
  getLinkableUsers: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHr.getOrgUnits.mockResolvedValue([])
  mockHr.getLinkableUsers.mockRejectedValue(new Error('Forbidden'))
  ;(hrService as any).getEmployeeFace.mockResolvedValue({ enrolled: false, consent_at: null })
})

describe('หน้าทะเบียนพนักงาน (Employees)', () => {
  it('แสดงแถวพนักงานจาก service และแสดงเลขบัญชีธนาคารเมื่อมีข้อมูล', async () => {
    const rows: Employee[] = [
      {
        id: 'e1',
        tenant_id: 't1',
        code: 'EMP-001',
        first_name: 'สมชาย',
        last_name: 'ใจดี',
        nickname: 'ชาย',
        org_unit_id: null,
        org_unit_name: 'ฝ่ายผลิต',
        position: 'ช่างเทคนิค',
        employment_type: 'MONTHLY',
        base_wage: 25000,
        start_date: '2026-01-01',
        end_date: null,
        status: 'ACTIVE',
        bank_name: 'KBANK',
        bank_account: '123-4-56789-0',
        sso_enrolled: 1,
      },
    ]
    mockHr.getEmployees.mockResolvedValue(rows)

    render(<Employees />)

    expect(await screen.findByText('EMP-001')).toBeTruthy()
    expect(screen.getByText(/สมชาย ใจดี/)).toBeTruthy()
    const bankCell = screen.getByTestId('bank-account-e1')
    expect(bankCell.textContent).toBe('KBANK 123-4-56789-0')
  })

  it('ไม่แสดงค่าในคอลัมน์เลขบัญชีธนาคารเมื่อฟิลด์ bank_account ถูกตัดออก (สิทธิ์อ่านอย่างเดียว)', async () => {
    const rows: Employee[] = [
      {
        id: 'e2',
        tenant_id: 't1',
        code: 'EMP-002',
        first_name: 'สมหญิง',
        last_name: 'รักงาน',
        org_unit_id: null,
        position: 'ธุรการ',
        employment_type: 'MONTHLY',
        start_date: '2026-02-01',
        end_date: null,
        status: 'ACTIVE',
        bank_name: 'SCB',
        // bank_account omitted by backend for read-only users
        sso_enrolled: 1,
      },
    ]
    mockHr.getEmployees.mockResolvedValue(rows)

    render(<Employees />)

    expect(await screen.findByText('EMP-002')).toBeTruthy()
    expect(screen.getByText(/สมหญิง รักงาน/)).toBeTruthy()
    const bankCell = screen.getByTestId('bank-account-e2')
    expect(bankCell.textContent).toBe('')
  })

  it('กด เชิญเข้า LINE แล้วเรียก inviteEmployeeToLine และแสดงรหัส', async () => {
    mockHr.getEmployees.mockResolvedValue([
      {
        id: 'e3', tenant_id: 't1', code: 'EMP-003', first_name: 'สมศรี', last_name: 'ดีมาก',
        org_unit_id: null, position: null, employment_type: 'MONTHLY', start_date: '2026-02-01',
        end_date: null, status: 'ACTIVE', sso_enrolled: 1,
      },
    ])
    const invite = (hrService as any).inviteEmployeeToLine as ReturnType<typeof vi.fn>
    invite.mockResolvedValue({ code: '123456', expires_in_minutes: 10, created_line_only_account: false })

    render(<Employees />)
    fireEvent.click(await screen.findByTitle('เชิญเข้า LINE'))

    expect(await screen.findByText('123456')).toBeTruthy()
    expect(invite).toHaveBeenCalledWith('e3')
  })

  it('แก้ไขพนักงาน: แสดงสถานะสแกนหน้า และลบข้อมูลใบหน้าได้หลังยืนยัน', async () => {
    mockHr.getEmployees.mockResolvedValue([
      {
        id: 'e4', tenant_id: 't1', code: 'EMP-004', first_name: 'สมปอง', last_name: 'ตั้งใจ',
        org_unit_id: null, position: null, employment_type: 'MONTHLY', start_date: '2026-02-01',
        end_date: null, status: 'ACTIVE', sso_enrolled: 1,
      },
    ])
    const getFace = (hrService as any).getEmployeeFace as ReturnType<typeof vi.fn>
    const delFace = (hrService as any).deleteEmployeeFace as ReturnType<typeof vi.fn>
    getFace.mockResolvedValue({ enrolled: true, consent_at: '2026-11-01 10:00:00' })
    delFace.mockResolvedValue(undefined)

    render(<Employees />)
    fireEvent.click(await screen.findByTitle('แก้ไข'))

    await waitFor(() => {
      expect(screen.getByTestId('emp-face-status').textContent).toContain('ลงทะเบียนแล้ว')
    })
    expect(getFace).toHaveBeenCalledWith('e4')

    fireEvent.click(screen.getByTestId('emp-face-delete'))
    fireEvent.click(screen.getByTestId('emp-face-delete-confirm'))

    await waitFor(() => {
      expect(delFace).toHaveBeenCalledWith('e4')
      expect(screen.getByTestId('emp-face-status').textContent).toBe('ยังไม่ได้ลงทะเบียน')
    })
  })

  it('admin (getLinkableUsers resolves): edit form shows select labelled "บัญชีผู้ใช้ ERP ที่ผูก"; options contain active ERP users and current line_only account, but not other line_only or inactive', async () => {
    const employee: Employee = {
      id: 'e5',
      tenant_id: 't1',
      code: 'EMP-005',
      first_name: 'สมพร',
      last_name: 'เจริญ',
      employment_type: 'MONTHLY',
      start_date: '2026-01-01',
      status: 'ACTIVE',
      sso_enrolled: 1,
      user_id: 'u-linked-line',
    }
    mockHr.getEmployees.mockResolvedValue([employee])
    const linkableUsers: LinkableUser[] = [
      { id: 'u-active-erp', name: 'นาย Active ERP', email: 'active@erp.com', status: 'active', line_only: 0 },
      { id: 'u-inactive-erp', name: 'นาย Inactive ERP', email: 'inactive@erp.com', status: 'inactive', line_only: 0 },
      { id: 'u-linked-line', name: 'นาย Linked Line', email: 'line-linked@erp.com', status: 'active', line_only: 1 },
      { id: 'u-other-line', name: 'นาย Other Line', email: 'line-other@erp.com', status: 'active', line_only: 1 },
    ]
    mockHr.getLinkableUsers.mockResolvedValue(linkableUsers)

    render(<Employees />)
    fireEvent.click(await screen.findByTitle('แก้ไข'))

    const select = (await screen.findByLabelText('บัญชีผู้ใช้ ERP ที่ผูก')) as HTMLSelectElement
    expect(select).toBeTruthy()

    const optionValues = Array.from(select.options).map((opt) => opt.value)
    expect(optionValues).toContain('u-active-erp')
    expect(optionValues).toContain('u-linked-line')
    expect(optionValues).not.toContain('u-inactive-erp')
    expect(optionValues).not.toContain('u-other-line')

    expect(screen.getByText('นาย Active ERP — active@erp.com')).toBeTruthy()
    expect(screen.getByText('นาย Linked Line (LINE อย่างเดียว)')).toBeTruthy()
    expect(screen.queryByText(/Inactive ERP/)).toBeNull()
    expect(screen.queryByText(/Other Line/)).toBeNull()
  })

  it('choosing another account and submitting calls updateEmployee with that user_id', async () => {
    const employee: Employee = {
      id: 'e6',
      tenant_id: 't1',
      code: 'EMP-006',
      first_name: 'สมจิตร',
      last_name: 'ว่องไว',
      employment_type: 'MONTHLY',
      start_date: '2026-01-01',
      status: 'ACTIVE',
      sso_enrolled: 1,
      user_id: 'u-linked-line',
    }
    mockHr.getEmployees.mockResolvedValue([employee])
    mockHr.getLinkableUsers.mockResolvedValue([
      { id: 'u-active-erp', name: 'นาย Active ERP', email: 'active@erp.com', status: 'active', line_only: 0 },
      { id: 'u-linked-line', name: 'นาย Linked Line', email: 'line-linked@erp.com', status: 'active', line_only: 1 },
    ])
    mockHr.updateEmployee.mockResolvedValue({ ...employee, user_id: 'u-active-erp' })

    render(<Employees />)
    fireEvent.click(await screen.findByTitle('แก้ไข'))

    const select = (await screen.findByLabelText('บัญชีผู้ใช้ ERP ที่ผูก')) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'u-active-erp' } })
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))

    await waitFor(() => {
      expect(mockHr.updateEmployee).toHaveBeenCalledTimes(1)
    })
    expect(mockHr.updateEmployee).toHaveBeenCalledWith(
      'e6',
      expect.objectContaining({ user_id: 'u-active-erp' })
    )
  })

  it('not changing the linked user_id sends NO user_id key upon submit', async () => {
    const employee: Employee = {
      id: 'e7',
      tenant_id: 't1',
      code: 'EMP-007',
      first_name: 'สมหมาย',
      last_name: 'ชื่นใจ',
      employment_type: 'MONTHLY',
      start_date: '2026-01-01',
      status: 'ACTIVE',
      sso_enrolled: 1,
      user_id: 'u-linked-line',
    }
    mockHr.getEmployees.mockResolvedValue([employee])
    mockHr.getLinkableUsers.mockResolvedValue([
      { id: 'u-active-erp', name: 'นาย Active ERP', email: 'active@erp.com', status: 'active', line_only: 0 },
      { id: 'u-linked-line', name: 'นาย Linked Line', email: 'line-linked@erp.com', status: 'active', line_only: 1 },
    ])
    mockHr.updateEmployee.mockResolvedValue(employee)

    render(<Employees />)
    fireEvent.click(await screen.findByTitle('แก้ไข'))

    await screen.findByLabelText('บัญชีผู้ใช้ ERP ที่ผูก')
    // Submit without changing select
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))

    await waitFor(() => {
      expect(mockHr.updateEmployee).toHaveBeenCalledTimes(1)
    })
    const payload = mockHr.updateEmployee.mock.calls[0][1]
    expect(payload).not.toHaveProperty('user_id')
  })

  it('non-admin (getLinkableUsers rejects): no select, and submit sends no user_id key', async () => {
    const employee: Employee = {
      id: 'e8',
      tenant_id: 't1',
      code: 'EMP-008',
      first_name: 'วิชัย',
      last_name: 'มั่นคง',
      employment_type: 'MONTHLY',
      start_date: '2026-01-01',
      status: 'ACTIVE',
      sso_enrolled: 1,
      user_id: 'u-linked-line',
    }
    mockHr.getEmployees.mockResolvedValue([employee])
    mockHr.getLinkableUsers.mockRejectedValue(new Error('403 Forbidden'))
    mockHr.updateEmployee.mockResolvedValue(employee)

    render(<Employees />)
    fireEvent.click(await screen.findByTitle('แก้ไข'))

    await screen.findByDisplayValue('วิชัย')
    expect(screen.queryByLabelText('บัญชีผู้ใช้ ERP ที่ผูก')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))

    await waitFor(() => {
      expect(mockHr.updateEmployee).toHaveBeenCalledTimes(1)
    })
    const payload = mockHr.updateEmployee.mock.calls[0][1]
    expect(payload).not.toHaveProperty('user_id')
  })

  it('LINE invite rejected with ERP_ACCOUNT_EXISTS: window.confirm true -> inviteEmployeeToLine called again with (id, true) and code shown', async () => {
    const employee: Employee = {
      id: 'e9',
      tenant_id: 't1',
      code: 'EMP-009',
      first_name: 'มานพ',
      last_name: 'มีลาภ',
      employment_type: 'MONTHLY',
      start_date: '2026-01-01',
      status: 'ACTIVE',
      sso_enrolled: 1,
    }
    mockHr.getEmployees.mockResolvedValue([employee])
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    mockHr.inviteEmployeeToLine
      .mockRejectedValueOnce({
        response: { data: { code: 'ERP_ACCOUNT_EXISTS', message: 'มีบัญชีชื่อนี้แล้วในระบบ ERP' } },
      })
      .mockResolvedValueOnce({
        code: 'CONFIRM-CODE-888',
        expires_in_minutes: 10,
        created_line_only_account: true,
      })

    render(<Employees />)
    fireEvent.click(await screen.findByTitle('เชิญเข้า LINE'))

    await waitFor(() => {
      expect(mockHr.inviteEmployeeToLine).toHaveBeenCalledTimes(2)
    })
    expect(mockHr.inviteEmployeeToLine).toHaveBeenNthCalledWith(1, 'e9')
    expect(mockHr.inviteEmployeeToLine).toHaveBeenNthCalledWith(2, 'e9', true)
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('มีบัญชีชื่อนี้แล้วในระบบ ERP'))
    expect(await screen.findByText('CONFIRM-CODE-888')).toBeTruthy()
    await waitFor(() => {
      expect(mockHr.getEmployees).toHaveBeenCalledTimes(2)
    })

    confirmSpy.mockRestore()
  })

  it('LINE invite rejected with ERP_ACCOUNT_EXISTS: window.confirm false -> called only once', async () => {
    const employee: Employee = {
      id: 'e10',
      tenant_id: 't1',
      code: 'EMP-010',
      first_name: 'สายใจ',
      last_name: 'รักสงบ',
      employment_type: 'MONTHLY',
      start_date: '2026-01-01',
      status: 'ACTIVE',
      sso_enrolled: 1,
    }
    mockHr.getEmployees.mockResolvedValue([employee])
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    mockHr.inviteEmployeeToLine.mockRejectedValueOnce({
      response: { data: { code: 'ERP_ACCOUNT_EXISTS', message: 'มีบัญชีชื่อนี้แล้วในระบบ ERP' } },
    })

    render(<Employees />)
    fireEvent.click(await screen.findByTitle('เชิญเข้า LINE'))

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('มีบัญชีชื่อนี้แล้วในระบบ ERP'))
    })
    expect(mockHr.inviteEmployeeToLine).toHaveBeenCalledTimes(1)
    expect(mockHr.inviteEmployeeToLine).toHaveBeenCalledWith('e10')
    expect(screen.queryByText('CONFIRM-CODE-888')).toBeNull()

    confirmSpy.mockRestore()
  })
})
