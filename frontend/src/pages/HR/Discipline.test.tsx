import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import toast from 'react-hot-toast'
import hrService from '../../services/hr.service'
import hrDisciplineService from '../../services/hrDiscipline.service'
import Discipline, {
  renderDisciplinaryActivePill,
  renderAcknowledgedPill,
  renderLevelPill,
} from './Discipline'

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
  }
  return {
    default: service,
    hrService: service,
  }
})

vi.mock('../../services/hrDiscipline.service', () => {
  const service = {
    getWorkRules: vi.fn(),
    createWorkRule: vi.fn(),
    updateWorkRule: vi.fn(),
    deleteWorkRule: vi.fn(),
    getDisciplinaryRecords: vi.fn(),
    getDisciplinaryRecord: vi.fn(),
    createDisciplinaryRecord: vi.fn(),
    updateDisciplinaryRecord: vi.fn(),
    acknowledgeWitness: vi.fn(),
    getMyDisciplinary: vi.fn(),
    acknowledgeSelf: vi.fn(),
  }
  return {
    default: service,
    hrDisciplineService: service,
  }
})

const mockHr = hrService as unknown as {
  getEmployees: ReturnType<typeof vi.fn>
}

const mockDiscipline = hrDisciplineService as unknown as {
  getWorkRules: ReturnType<typeof vi.fn>
  createWorkRule: ReturnType<typeof vi.fn>
  updateWorkRule: ReturnType<typeof vi.fn>
  deleteWorkRule: ReturnType<typeof vi.fn>
  getDisciplinaryRecords: ReturnType<typeof vi.fn>
  createDisciplinaryRecord: ReturnType<typeof vi.fn>
  updateDisciplinaryRecord: ReturnType<typeof vi.fn>
  acknowledgeWitness: ReturnType<typeof vi.fn>
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
  ])

  mockDiscipline.getWorkRules.mockResolvedValue([
    {
      id: 'rule-1',
      clause_no: 'หมวดที่ 4 ข้อ 12',
      title: 'การละทิ้งหน้าที่การงาน',
      body: 'ห้ามพนักงานละทิ้งหน้าที่โดยไม่ได้รับอนุญาต',
      announced_on: '2026-01-01',
      is_active: true,
    },
  ])

  mockDiscipline.getDisciplinaryRecords.mockResolvedValue([
    {
      id: 'rec-1',
      employee_id: 'emp-1',
      employee_code: 'EMP-001',
      employee_name: 'สมชาย ใจดี',
      incident_date: '2026-03-10',
      category: 'เข้างานสาย',
      detail: 'เข้างานสาย 3 ครั้งในรอบสัปดาห์',
      level: 'WRITTEN',
      work_rule_id: 'rule-1',
      clause_no: 'หมวดที่ 4 ข้อ 12',
      work_rule_title: 'การละทิ้งหน้าที่การงาน',
      expires_on: '2027-03-10',
      active: true,
      acknowledged_at: null,
      acknowledged_via: null,
      witness_name: null,
      attachment_count: 1,
      created_at: '2026-03-10T08:00:00Z',
    },
    {
      id: 'rec-2',
      employee_id: 'emp-2',
      employee_code: 'EMP-002',
      employee_name: 'สมหญิง รักงาน',
      incident_date: '2025-01-15',
      category: 'ไม่สวมอุปกรณ์ความปลอดภัย',
      detail: 'ไม่สวมแว่นตานิรภัยในห้องปฏิบัติการ',
      level: 'VERBAL',
      work_rule_id: null,
      clause_no: null,
      work_rule_title: null,
      expires_on: '2026-01-15',
      active: false,
      acknowledged_at: '2025-01-16T10:00:00Z',
      acknowledged_via: 'SELF',
      witness_name: null,
      attachment_count: 0,
      created_at: '2025-01-15T09:00:00Z',
    },
  ])
})

describe('Discipline Pill Helpers', () => {
  it('renderDisciplinaryActivePill renders correct text for active vs expired', () => {
    const { container: c1 } = render(renderDisciplinaryActivePill(true))
    expect(c1.textContent).toBe('ยังมีผล')

    const { container: c2 } = render(renderDisciplinaryActivePill(false))
    expect(c2.textContent).toBe('หมดผลแล้ว')
  })

  it('renderAcknowledgedPill renders correct status for self, witness, and unacknowledged', () => {
    const { container: c1 } = render(
      renderAcknowledgedPill({
        acknowledged_via: 'SELF',
      } as any)
    )
    expect(c1.textContent).toBe('รับทราบแล้ว (ตนเอง)')

    const { container: c2 } = render(
      renderAcknowledgedPill({
        acknowledged_via: 'WITNESS',
        witness_name: 'นายสมพร',
      } as any)
    )
    expect(c2.textContent).toBe('รับทราบแล้ว (พยาน: นายสมพร)')

    const { container: c3 } = render(
      renderAcknowledgedPill({
        acknowledged_via: null,
      } as any)
    )
    expect(c3.textContent).toBe('ยังไม่ได้รับทราบ')
  })

  it('renderLevelPill renders verbal vs written labels', () => {
    const { container: c1 } = render(renderLevelPill('WRITTEN'))
    expect(c1.textContent).toBe('ตักเตือนเป็นหนังสือ')

    const { container: c2 } = render(renderLevelPill('VERBAL'))
    expect(c2.textContent).toBe('ตักเตือนด้วยวาจา')
  })
})

describe('Discipline Page Component', () => {
  it('renders disciplinary records list with employees and badges', async () => {
    render(
      <MemoryRouter>
        <Discipline />
      </MemoryRouter>
    )

    // Verify records loaded and displayed
    expect(await screen.findByText('สมชาย ใจดี')).toBeTruthy()
    expect(screen.getByText('EMP-001')).toBeTruthy()
    expect(screen.getByText('เข้างานสาย')).toBeTruthy()
    expect(screen.getByText('2027-03-10')).toBeTruthy()
    expect(screen.getByText('ยังมีผล')).toBeTruthy()
    // the filter <option> shares this label; require a non-option (the table pill)
    expect(screen.getAllByText('ยังไม่ได้รับทราบ').some(el => el.tagName !== 'OPTION')).toBe(true)

    expect(screen.getByText('สมหญิง รักงาน')).toBeTruthy()
    expect(screen.getByText('EMP-002')).toBeTruthy()
    expect(screen.getByText('ไม่สวมอุปกรณ์ความปลอดภัย')).toBeTruthy()
    expect(screen.getAllByText('หมดผลแล้ว').some(el => el.tagName !== 'OPTION')).toBe(true)
    expect(screen.getByText('รับทราบแล้ว (ตนเอง)')).toBeTruthy()
  })

  it('switches to "ข้อบังคับการทำงาน" tab and displays work rules', async () => {
    render(
      <MemoryRouter>
        <Discipline />
      </MemoryRouter>
    )

    // Switch to tab "ข้อบังคับการทำงาน"
    const rulesTabBtn = screen.getByRole('button', { name: /ข้อบังคับการทำงาน/ })
    fireEvent.click(rulesTabBtn)

    expect(await screen.findByText('หมวดที่ 4 ข้อ 12')).toBeTruthy()
    expect(screen.getByText('การละทิ้งหน้าที่การงาน')).toBeTruthy()
    expect(screen.getByText('ใช้งาน')).toBeTruthy()
  })

  it('submits a new disciplinary record via create modal', async () => {
    mockDiscipline.createDisciplinaryRecord.mockResolvedValue({
      id: 'rec-new',
      employee_id: 'emp-1',
      employee_code: 'EMP-001',
      employee_name: 'สมชาย ใจดี',
      incident_date: '2026-11-01',
      category: 'ละทิ้งหน้าที่',
      detail: 'ออกจากพื้นที่ปฏิบัติงานก่อนเวลา',
      level: 'WRITTEN',
      work_rule_id: 'rule-1',
      clause_no: 'หมวดที่ 4 ข้อ 12',
      work_rule_title: 'การละทิ้งหน้าที่การงาน',
      expires_on: '2027-11-01',
      active: true,
      acknowledged_at: null,
      acknowledged_via: null,
      witness_name: null,
      created_at: '2026-11-01T12:00:00Z',
    })

    render(
      <MemoryRouter>
        <Discipline />
      </MemoryRouter>
    )

    // Click "บันทึกวินัยใหม่" button
    const openBtn = screen.getByRole('button', { name: /บันทึกวินัยใหม่/ })
    fireEvent.click(openBtn)

    // Wait for modal heading
    expect(await screen.findByRole('heading', { name: 'บันทึกวินัยใหม่' })).toBeTruthy()

    // Select employee "emp-1"
    const empSelect = screen.getByLabelText(/พนักงาน \*/)
    fireEvent.change(empSelect, { target: { value: 'emp-1' } })

    // Set category
    const catInput = screen.getByLabelText(/หมวดหมู่ความผิด \*/)
    fireEvent.change(catInput, { target: { value: 'ละทิ้งหน้าที่' } })

    // Set level
    const levelSelect = screen.getByLabelText(/ระดับการลงโทษ \*/)
    fireEvent.change(levelSelect, { target: { value: 'WRITTEN' } })

    // Set detail
    const detailInput = screen.getByLabelText(/รายละเอียดเหตุการณ์ \*/)
    fireEvent.change(detailInput, { target: { value: 'ออกจากพื้นที่ปฏิบัติงานก่อนเวลา' } })

    // Submit modal form
    const modalHeading = screen.getByRole('heading', { name: 'บันทึกวินัยใหม่' })
    const modalContainer = modalHeading.closest('.phopy-card') as HTMLElement
    const submitBtn = within(modalContainer).getByRole('button', { name: 'บันทึก' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockDiscipline.createDisciplinaryRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          employee_id: 'emp-1',
          category: 'ละทิ้งหน้าที่',
          level: 'WRITTEN',
          detail: 'ออกจากพื้นที่ปฏิบัติงานก่อนเวลา',
        })
      )
    })

    expect(mockToast.success).toHaveBeenCalledWith('บันทึกวินัยเรียบร้อย')
  })

  it('records witness acknowledgment through witness modal', async () => {
    mockDiscipline.acknowledgeWitness.mockResolvedValue({
      id: 'rec-1',
      employee_id: 'emp-1',
      incident_date: '2026-03-10',
      category: 'เข้างานสาย',
      detail: 'เข้างานสาย 3 ครั้งในรอบสัปดาห์',
      level: 'WRITTEN',
      expires_on: '2027-03-10',
      active: true,
      acknowledged_at: '2026-03-11T09:00:00Z',
      acknowledged_via: 'WITNESS',
      witness_name: 'นายหัวหน้า งานดี',
    })

    render(
      <MemoryRouter>
        <Discipline />
      </MemoryRouter>
    )

    // Find the witness acknowledge button for rec-1
    const witnessBtn = await screen.findByTitle('พยานลงชื่อรับทราบ')
    fireEvent.click(witnessBtn)

    // Verify modal appears
    expect(await screen.findByRole('heading', { name: 'พยานลงชื่อรับทราบ' })).toBeTruthy()

    // Type witness name
    const witnessInput = screen.getByLabelText(/ชื่อพยาน \/ ผู้บันทึก \*/)
    fireEvent.change(witnessInput, { target: { value: 'นายหัวหน้า งานดี' } })

    // Submit
    const submitBtn = screen.getByRole('button', { name: 'ยืนยันการรับทราบ' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockDiscipline.acknowledgeWitness).toHaveBeenCalledWith('rec-1', 'นายหัวหน้า งานดี')
    })

    expect(mockToast.success).toHaveBeenCalledWith('พยานลงชื่อรับทราบเรียบร้อย')
  })
})
