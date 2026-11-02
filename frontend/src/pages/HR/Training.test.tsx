import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../../components/common/PaymentAttachments', () => ({
  PaymentAttachments: ({ refType, refId }: { refType: string; refId: string }) => (
    <div data-testid="payment-attachments" data-ref-type={refType} data-ref-id={refId}>
      PaymentAttachments Mock
    </div>
  ),
}))

vi.mock('../../services/hr.service', () => {
  const service = {
    getEmployees: vi.fn(),
    getTrainingCourses: vi.fn(),
    createTrainingCourse: vi.fn(),
    updateTrainingCourse: vi.fn(),
    getTrainingRecords: vi.fn(),
    createTrainingRecords: vi.fn(),
    updateTrainingRecord: vi.fn(),
    deleteTrainingRecord: vi.fn(),
    getExpiringTraining: vi.fn(),
    getMyTraining: vi.fn(),
  }
  return {
    default: service,
    hrService: service,
  }
})

import hrService from '../../services/hr.service'
import toast from 'react-hot-toast'
import Training, { renderExpiryPill } from './Training'

const mockHr = hrService as unknown as {
  getEmployees: ReturnType<typeof vi.fn>
  getTrainingCourses: ReturnType<typeof vi.fn>
  createTrainingCourse: ReturnType<typeof vi.fn>
  updateTrainingCourse: ReturnType<typeof vi.fn>
  getTrainingRecords: ReturnType<typeof vi.fn>
  createTrainingRecords: ReturnType<typeof vi.fn>
  updateTrainingRecord: ReturnType<typeof vi.fn>
  deleteTrainingRecord: ReturnType<typeof vi.fn>
  getExpiringTraining: ReturnType<typeof vi.fn>
}

const mockToast = toast as unknown as {
  success: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()

  mockHr.getEmployees.mockResolvedValue([
    {
      id: 'emp-1',
      code: 'EMP-001',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
      status: 'ACTIVE',
      employment_type: 'MONTHLY',
    },
    {
      id: 'emp-2',
      code: 'EMP-002',
      first_name: 'สมหญิง',
      last_name: 'รักงาน',
      status: 'ACTIVE',
      employment_type: 'MONTHLY',
    },
    {
      id: 'emp-3',
      code: 'EMP-003',
      first_name: 'สมศักดิ์',
      last_name: 'มั่นคง',
      status: 'ACTIVE',
      employment_type: 'DAILY',
    },
  ])

  mockHr.getTrainingCourses.mockResolvedValue([
    {
      id: 'c-1',
      name: 'ความปลอดภัยในการทำงาน',
      kind: 'INTERNAL',
      mandatory: true,
      validity_months: 12,
      is_active: true,
      record_count: 4,
    },
    {
      id: 'c-2',
      name: 'การปฐมพยาบาลเบื้องต้น',
      kind: 'EXTERNAL',
      mandatory: false,
      validity_months: null,
      is_active: true,
      record_count: 2,
    },
  ])

  mockHr.getTrainingRecords.mockResolvedValue([])
  mockHr.getExpiringTraining.mockResolvedValue([])
})

describe('renderExpiryPill helper', () => {
  it('renders correct labels for expired, warning, valid and null', () => {
    const { container: c1 } = render(renderExpiryPill(-3))
    expect(c1.textContent).toBe('หมดแล้ว 3 วัน')

    const { container: c2 } = render(renderExpiryPill(15))
    expect(c2.textContent).toBe('เหลือ 15 วัน')

    const { container: c3 } = render(renderExpiryPill(45))
    expect(c3.textContent).toBe('เหลือ 45 วัน')

    const { container: c4 } = render(renderExpiryPill(null))
    expect(c4.textContent).toBe('ไม่หมดอายุ')
  })
})

describe('หน้าบันทึกอบรม (Training)', () => {
  it('the expiring tab lists a record with days_left: -3 as "หมดแล้ว 3 วัน"', async () => {
    mockHr.getExpiringTraining.mockResolvedValue([
      {
        id: 'rec-exp-1',
        course_id: 'c-1',
        course_name: 'ความปลอดภัยในการทำงาน',
        course_kind: 'INTERNAL',
        employee_id: 'emp-1',
        employee_code: 'EMP-001',
        employee_name: 'สมชาย ใจดี',
        trained_on: '2025-10-15',
        expires_on: '2026-10-15',
        provider: 'วิทยากร สปภ.',
        notes: null,
        days_left: -3,
        attachment_count: 1,
        created_at: '2025-10-15',
      },
    ])

    render(
      <MemoryRouter>
        <Training />
      </MemoryRouter>
    )

    // Switch to tab "ใกล้หมดอายุ"
    const expiringTabBtn = screen.getByRole('button', { name: /ใกล้หมดอายุ/ })
    fireEvent.click(expiringTabBtn)

    // Verify row displays employee and days_left: -3 formatted as 'หมดแล้ว 3 วัน'
    expect(await screen.findByText('หมดแล้ว 3 วัน')).toBeTruthy()
    expect(screen.getByText('สมชาย ใจดี')).toBeTruthy()
    expect(screen.getByText('EMP-001')).toBeTruthy()
  })

  it('saving the "บันทึกรอบอบรม" modal with two ticked employees calls createTrainingRecords with employee_ids of both and the chosen course', async () => {
    mockHr.createTrainingRecords.mockResolvedValue([
      {
        id: 'rec-new-1',
        course_id: 'c-2',
        course_name: 'การปฐมพยาบาลเบื้องต้น',
        course_kind: 'EXTERNAL',
        employee_id: 'emp-1',
        employee_code: 'EMP-001',
        employee_name: 'สมชาย ใจดี',
        trained_on: '2026-11-02',
        expires_on: null,
        provider: 'กาชาดไทย',
        notes: null,
        days_left: null,
        attachment_count: 0,
        created_at: '2026-11-02',
      },
      {
        id: 'rec-new-2',
        course_id: 'c-2',
        course_name: 'การปฐมพยาบาลเบื้องต้น',
        course_kind: 'EXTERNAL',
        employee_id: 'emp-2',
        employee_code: 'EMP-002',
        employee_name: 'สมหญิง รักงาน',
        trained_on: '2026-11-02',
        expires_on: null,
        provider: 'กาชาดไทย',
        notes: null,
        days_left: null,
        attachment_count: 0,
        created_at: '2026-11-02',
      },
    ])

    render(
      <MemoryRouter>
        <Training />
      </MemoryRouter>
    )

    // Click "บันทึกรอบอบรม" to open round modal
    const openModalBtn = screen.getByRole('button', { name: /บันทึกรอบอบรม/ })
    fireEvent.click(openModalBtn)

    // Select course "c-2" (รอให้รายการหลักสูตรโหลดก่อน ไม่งั้น select ยังไม่มี option)
    await screen.findAllByRole('option', { name: 'การปฐมพยาบาลเบื้องต้น' })
    const courseSelect = screen.getByLabelText(/หลักสูตร \*/)
    fireEvent.change(courseSelect, { target: { value: 'c-2' } })

    // Wait for employees to load asynchronously in the modal
    const emp1Checkbox = await screen.findByLabelText('เลือก EMP-001 สมชาย')
    const emp2Checkbox = await screen.findByLabelText('เลือก EMP-002 สมหญิง')
    fireEvent.click(emp1Checkbox)
    fireEvent.click(emp2Checkbox)

    // Optionally set provider
    const providerInput = screen.getByLabelText(/ผู้สอน \/ สถาบัน/)
    fireEvent.change(providerInput, { target: { value: 'กาชาดไทย' } })

    // Find submit button inside the modal dialog
    const modalHeading = screen.getByRole('heading', { name: 'บันทึกรอบอบรม' })
    const modalContainer = modalHeading.closest('.phopy-card') as HTMLElement
    const submitBtn = within(modalContainer).getByRole('button', { name: 'บันทึกรอบอบรม' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockHr.createTrainingRecords).toHaveBeenCalledWith(
        expect.objectContaining({
          course_id: 'c-2',
          employee_ids: ['emp-1', 'emp-2'],
          provider: 'กาชาดไทย',
        })
      )
    })

    expect(mockHr.createTrainingRecords.mock.calls[0][0].employee_ids).toHaveLength(2)
    expect(mockToast.success).toHaveBeenCalledWith('บันทึกรอบอบรมเรียบร้อย')
  })

  it('opens edit modal on row click, shows attachments, and displays server error message on 409 deletion', async () => {
    mockHr.getTrainingRecords.mockResolvedValue([
      {
        id: 'rec-1',
        course_id: 'c-1',
        course_name: 'ความปลอดภัยในการทำงาน',
        course_kind: 'INTERNAL',
        employee_id: 'emp-1',
        employee_code: 'EMP-001',
        employee_name: 'สมชาย ใจดี',
        trained_on: '2026-06-01',
        expires_on: '2027-06-01',
        provider: 'วิทยากร สปภ.',
        notes: 'ผ่านเกณฑ์ดีเยี่ยม',
        days_left: 210,
        attachment_count: 2,
        created_at: '2026-06-01',
      },
    ])

    render(
      <MemoryRouter>
        <Training />
      </MemoryRouter>
    )

    // Click record row by finding a rendered column cell (e.g. provider 'วิทยากร สปภ.')
    const rowCell = await screen.findByText('วิทยากร สปภ.')
    const row = rowCell.closest('tr') as HTMLElement
    fireEvent.click(row)

    // Verify edit modal opened, notes displayed in input/textarea, and attachments rendered
    expect(await screen.findByRole('heading', { name: 'แก้ไขบันทึกการอบรม' })).toBeTruthy()
    expect(screen.getByDisplayValue('ผ่านเกณฑ์ดีเยี่ยม')).toBeTruthy()
    expect(screen.getByTestId('payment-attachments')).toBeTruthy()

    // Test delete with 409 error
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockHr.deleteTrainingRecord.mockRejectedValueOnce({
      response: { data: { message: 'ลบไฟล์ใบรับรองก่อน' } },
    })

    const deleteBtn = screen.getByRole('button', { name: /ลบบันทึก/ })
    fireEvent.click(deleteBtn)

    await waitFor(() => {
      expect(mockHr.deleteTrainingRecord).toHaveBeenCalledWith('rec-1')
      expect(mockToast.error).toHaveBeenCalledWith('ลบไฟล์ใบรับรองก่อน')
    })
  })

  it('creates a new course in the courses tab', async () => {
    mockHr.createTrainingCourse.mockResolvedValue({
      id: 'c-3',
      name: 'อบรมดับเพลิงเบื้องต้น',
      kind: 'EXTERNAL',
      mandatory: true,
      validity_months: 24,
      is_active: true,
      record_count: 0,
    })

    render(
      <MemoryRouter>
        <Training />
      </MemoryRouter>
    )

    // Switch to tab "หลักสูตร"
    fireEvent.click(screen.getByRole('button', { name: /หลักสูตร/ }))

    // Click "เพิ่มหลักสูตร"
    fireEvent.click(screen.getByRole('button', { name: /เพิ่มหลักสูตร/ }))

    // Fill form
    fireEvent.change(screen.getByLabelText(/ชื่อหลักสูตร \*/), {
      target: { value: 'อบรมดับเพลิงเบื้องต้น' },
    })
    fireEvent.change(screen.getByLabelText(/รูปแบบการอบรม \*/), {
      target: { value: 'EXTERNAL' },
    })
    fireEvent.change(screen.getByLabelText(/อายุใบรับรอง \(เดือน\)/), {
      target: { value: '24' },
    })
    fireEvent.click(screen.getByLabelText('เป็นหลักสูตรบังคับ'))

    // Submit
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))

    await waitFor(() => {
      expect(mockHr.createTrainingCourse).toHaveBeenCalledWith({
        name: 'อบรมดับเพลิงเบื้องต้น',
        kind: 'EXTERNAL',
        mandatory: true,
        validity_months: 24,
      })
    })

    expect(mockToast.success).toHaveBeenCalledWith('เพิ่มหลักสูตรเรียบร้อย')
  })
})
