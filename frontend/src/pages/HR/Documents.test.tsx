import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../components/common/PaymentAttachments', () => ({ PaymentAttachments: () => <div /> }))
vi.mock('../../services/hr.service', () => {
  const service = { getEmployees: vi.fn(), getExpiringTraining: vi.fn() }
  return { default: service, hrService: service }
})
vi.mock('../../services/hrDocument.service', async () => {
  const actual = await vi.importActual<any>('../../services/hrDocument.service')
  return {
    ...actual,
    default: {
      getDocuments: vi.fn(), getExpiring: vi.fn(), getTemplates: vi.fn(),
      createDocument: vi.fn(), updateDocument: vi.fn(), deleteDocument: vi.fn(),
    },
  }
})

import hrService from '../../services/hr.service'
import docService from '../../services/hrDocument.service'
import Documents from './Documents'

const hr = hrService as any
const svc = docService as any

beforeEach(() => {
  vi.clearAllMocks()
  hr.getEmployees.mockResolvedValue([{ id: 'e1', code: 'EMP-001', first_name: 'สมชาย', last_name: 'ใจดี' }])
  hr.getExpiringTraining.mockResolvedValue([
    { id: 't1', course_name: 'ความปลอดภัย', employee_name: 'สมหญิง รักงาน', expires_on: '2026-12-01', days_left: 20 },
  ])
  svc.getExpiring.mockResolvedValue([
    { id: 'd1', employee_id: 'e1', employee_name: 'สมชาย ใจดี', doc_type: 'WORK_PERMIT', title: 'ใบอนุญาต พ.ศ. 2569', expires_on: '2026-11-10', days_left: -2 },
  ])
  svc.getDocuments.mockResolvedValue([])
  svc.getTemplates.mockResolvedValue([])
  svc.createDocument.mockResolvedValue({})
})

const renderPage = () => render(<MemoryRouter><Documents /></MemoryRouter>)

describe('หน้าเอกสารพนักงาน', () => {
  it('รวมเอกสารและอบรมที่ใกล้หมดอายุในตารางเดียว เรียงตามวันที่เหลือ', async () => {
    renderPage()
    expect(await screen.findByText('ใบอนุญาต พ.ศ. 2569')).toBeTruthy()
    expect(screen.getByText('หมดแล้ว 2 วัน')).toBeTruthy()
    expect(screen.getByText('ความปลอดภัย')).toBeTruthy()
    expect(screen.getByText('เหลือ 20 วัน')).toBeTruthy()
  })

  it('สร้างเอกสารพนักงานใหม่', async () => {
    renderPage()
    await screen.findByText('ใบอนุญาต พ.ศ. 2569')
    fireEvent.click(screen.getByText('เอกสารพนักงาน'))
    fireEvent.click(screen.getByText('เพิ่มเอกสาร'))
    fireEvent.change(screen.getByLabelText('พนักงาน'), { target: { value: 'e1' } })
    fireEvent.change(screen.getByLabelText('ชื่อเอกสาร'), { target: { value: 'สัญญาจ้าง 2569' } })
    fireEvent.click(screen.getByText('บันทึก'))
    await waitFor(() => expect(svc.createDocument).toHaveBeenCalled())
    expect(svc.createDocument.mock.calls[0][0]).toMatchObject({ employee_id: 'e1', doc_type: 'CONTRACT', title: 'สัญญาจ้าง 2569' })
  })
})
