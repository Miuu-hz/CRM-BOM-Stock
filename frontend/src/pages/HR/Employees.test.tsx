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
  },
}))

import hrService, { Employee } from '../../services/hr.service'
import Employees from './Employees'

const mockHr = hrService as unknown as {
  getEmployees: ReturnType<typeof vi.fn>
  getOrgUnits: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHr.getOrgUnits.mockResolvedValue([])
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
})
