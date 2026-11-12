import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

vi.mock('../../services/hr.service', () => {
  const service = { getEmployees: vi.fn() }
  return { default: service, hrService: service }
})

vi.mock('../../services/hrLifecycle.service', () => {
  const service = {
    getTemplates: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    seedDefaults: vi.fn(),
    startChecklist: vi.fn(),
    getChecklist: vi.fn(),
    setItemDone: vi.fn(),
    getFinalPay: vi.fn(),
  }
  return { default: service, hrLifecycleService: service }
})

import hrService from '../../services/hr.service'
import lifecycle from '../../services/hrLifecycle.service'
import Lifecycle from './Lifecycle'

const hr = hrService as any
const lc = lifecycle as any

beforeEach(() => {
  vi.clearAllMocks()
  hr.getEmployees.mockResolvedValue([{ id: 'e1', code: 'EMP-1', first_name: 'สมชาย', last_name: 'ใจดี' }])
  lc.getTemplates.mockResolvedValue([
    { id: 't1', kind: 'OFFBOARD', title: 'ปิดบัญชีผู้ใช้ ERP', auto_action: 'DISABLE_USER', sort_order: 1, is_active: true, org_unit_id: null },
  ])
  lc.getChecklist.mockResolvedValue([
    { id: 'i1', employee_id: 'e1', kind: 'OFFBOARD', title: 'ปิดบัญชีผู้ใช้ ERP', auto_action: 'DISABLE_USER', sort_order: 1, done_at: null, done_by: null, note: null },
  ])
  lc.getFinalPay.mockResolvedValue({
    dailyWage: 1000, tenureDays: 400, severanceDays: 90, severanceAmount: 90000,
    unusedAnnualLeaveDays: 2, leavePayout: 2000, outstandingAdvances: 500, unreturnedAssets: [],
  })
})

describe('Lifecycle page', () => {
  it('lists templates and creates one', async () => {
    lc.createTemplate.mockResolvedValue({})
    render(<Lifecycle />)
    expect(await screen.findByText('ปิดบัญชีผู้ใช้ ERP')).toBeTruthy()
    fireEvent.click(screen.getByText('เพิ่มข้อ'))
    fireEvent.change(screen.getByLabelText('ชื่อข้อ *'), { target: { value: 'คืนกุญแจ' } })
    fireEvent.click(screen.getByText('บันทึก'))
    await waitFor(() => expect(lc.createTemplate).toHaveBeenCalledWith({ kind: 'ONBOARD', title: 'คืนกุญแจ', auto_action: null }))
  })

  it('employee tab shows final pay box and asks confirmation before auto item', async () => {
    lc.setItemDone.mockResolvedValue({ message: 'บันทึกแล้ว', item: {} })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Lifecycle />)
    fireEvent.click(screen.getByText('พนักงาน'))
    fireEvent.change(await screen.findByLabelText('เลือกพนักงาน'), { target: { value: 'e1' } })
    expect(await screen.findByText(/เงินงวดสุดท้าย \(ตัวเลขแนะนำ\)/)).toBeTruthy()
    expect(screen.getByTestId('final-pay').textContent).toContain('90,000.00')
    fireEvent.click(await screen.findByLabelText('ปิดบัญชีผู้ใช้ ERP'))
    expect(confirmSpy).toHaveBeenCalled()
    await waitFor(() => expect(lc.setItemDone).toHaveBeenCalledWith('i1', true))
    confirmSpy.mockRestore()
  })
})
