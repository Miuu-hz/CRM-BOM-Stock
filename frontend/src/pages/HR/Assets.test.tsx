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

vi.mock('../../services/hrAsset.service', () => {
  const service = {
    getAssets: vi.fn(),
    getAsset: vi.fn(),
    createAsset: vi.fn(),
    updateAsset: vi.fn(),
    loanAsset: vi.fn(),
    returnAssetLoan: vi.fn(),
    getAssetLoans: vi.fn(),
    getEmployeeAssetLoans: vi.fn(),
    getMyAssetLoans: vi.fn(),
  }
  return {
    default: service,
    hrAssetService: service,
  }
})

vi.mock('../../services/hr.service', () => {
  const service = {
    getEmployees: vi.fn(),
  }
  return {
    default: service,
    hrService: service,
  }
})

import hrAssetService, { HrAsset } from '../../services/hrAsset.service'
import hrService from '../../services/hr.service'
import toast from 'react-hot-toast'
import Assets, { renderAssetStatusPill } from './Assets'

const mockAssetService = hrAssetService as unknown as {
  getAssets: ReturnType<typeof vi.fn>
  getAsset: ReturnType<typeof vi.fn>
  createAsset: ReturnType<typeof vi.fn>
  updateAsset: ReturnType<typeof vi.fn>
  loanAsset: ReturnType<typeof vi.fn>
  returnAssetLoan: ReturnType<typeof vi.fn>
  getAssetLoans: ReturnType<typeof vi.fn>
}

const mockHrService = hrService as unknown as {
  getEmployees: ReturnType<typeof vi.fn>
}

const mockToast = toast as unknown as {
  success: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
}

const mockAssets: HrAsset[] = [
  {
    id: 'ast-1',
    code: 'AST-001',
    name: 'MacBook Pro 14"',
    category: 'คอมพิวเตอร์',
    status: 'AVAILABLE',
    notes: 'สภาพดี',
    created_at: '2026-01-01',
    current_loan: null,
  },
  {
    id: 'ast-2',
    code: 'AST-002',
    name: 'iPad Pro 11"',
    category: 'แท็บเล็ต',
    status: 'LOANED',
    notes: null,
    created_at: '2026-01-02',
    current_loan: {
      loan_id: 'loan-1',
      employee_id: 'emp-1',
      employee_name: 'สมชาย ใจดี',
      loaned_on: '2026-03-01',
    },
  },
  {
    id: 'ast-3',
    code: 'AST-003',
    name: 'โปรเจคเตอร์รุ่นเก่า',
    category: 'อุปกรณ์ห้องประชุม',
    status: 'RETIRED',
    notes: 'ชำรุด',
    created_at: '2025-12-01',
    current_loan: null,
  },
]

beforeEach(() => {
  vi.clearAllMocks()

  mockAssetService.getAssets.mockResolvedValue(mockAssets)
  mockHrService.getEmployees.mockResolvedValue([
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
      first_name: 'วิภา',
      last_name: 'รักงาน',
      status: 'ACTIVE',
      employment_type: 'MONTHLY',
    },
  ])
})

describe('renderAssetStatusPill helper', () => {
  it('renders correct labels for each status', () => {
    const { container: c1 } = render(renderAssetStatusPill('AVAILABLE'))
    expect(c1.textContent).toBe('พร้อมให้ยืม')

    const { container: c2 } = render(renderAssetStatusPill('LOANED'))
    expect(c2.textContent).toBe('กำลังถูกยืม')

    const { container: c3 } = render(renderAssetStatusPill('RETIRED'))
    expect(c3.textContent).toBe('ตัดจำหน่าย')
  })
})

describe('หน้าทรัพย์สินที่ให้ยืม (Assets)', () => {
  it('renders the asset list, counters, and table rows correctly', async () => {
    render(
      <MemoryRouter>
        <Assets />
      </MemoryRouter>
    )

    // Wait for assets to load
    expect(await screen.findByText('AST-001')).toBeTruthy()
    expect(screen.getByText('MacBook Pro 14"')).toBeTruthy()
    expect(screen.getByText('AST-002')).toBeTruthy()
    expect(screen.getByText('iPad Pro 11"')).toBeTruthy()
    expect(screen.getByText('AST-003')).toBeTruthy()
    expect(screen.getByText('โปรเจคเตอร์รุ่นเก่า')).toBeTruthy()

    // Status badges
    // (labels also appear on the filter buttons, so scope to the table)
    const table = within(screen.getByRole('table'))
    expect(table.getByText('พร้อมให้ยืม')).toBeTruthy()
    expect(table.getByText('กำลังถูกยืม')).toBeTruthy()
    expect(table.getByText('ตัดจำหน่าย')).toBeTruthy()

    // Current loan details for AST-002
    expect(table.getByText('สมชาย ใจดี')).toBeTruthy()
    expect(screen.getByText(/ยืมเมื่อ 2026-03-01/)).toBeTruthy()

    // Action buttons
    expect(screen.getByRole('button', { name: 'ให้ยืม' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'รับคืน' })).toBeTruthy()
  })

  it('completes the create asset flow when clicking "เพิ่มทรัพย์สิน" and submitting form', async () => {
    mockAssetService.createAsset.mockResolvedValue({
      id: 'ast-new',
      code: 'AST-099',
      name: 'กล้องดิจิทัล',
      category: 'โสตทัศน์',
      status: 'AVAILABLE',
      notes: 'สำหรับถ่ายงานอีเวนต์',
      created_at: '2026-03-15',
      current_loan: null,
    })

    render(
      <MemoryRouter>
        <Assets />
      </MemoryRouter>
    )

    // Open Add Modal
    const addBtn = screen.getByRole('button', { name: /เพิ่มทรัพย์สิน/ })
    fireEvent.click(addBtn)

    // Verify modal appears
    expect(screen.getByRole('heading', { name: 'เพิ่มทรัพย์สิน' })).toBeTruthy()

    // Fill form inputs
    const codeInput = screen.getByPlaceholderText(/เช่น AST-001/)
    const nameInput = screen.getByPlaceholderText(/เช่น MacBook Pro 14/)
    const categoryInput = screen.getByPlaceholderText(/เช่น คอมพิวเตอร์/)
    const notesInput = screen.getByPlaceholderText(/รายละเอียดเพิ่มเติม/)

    fireEvent.change(codeInput, { target: { value: 'AST-099' } })
    fireEvent.change(nameInput, { target: { value: 'กล้องดิจิทัล' } })
    fireEvent.change(categoryInput, { target: { value: 'โสตทัศน์' } })
    fireEvent.change(notesInput, { target: { value: 'สำหรับถ่ายงานอีเวนต์' } })

    // Submit form
    const submitBtn = screen.getByRole('button', { name: 'บันทึก' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockAssetService.createAsset).toHaveBeenCalledWith({
        code: 'AST-099',
        name: 'กล้องดิจิทัล',
        category: 'โสตทัศน์',
        notes: 'สำหรับถ่ายงานอีเวนต์',
      })
    })

    expect(mockToast.success).toHaveBeenCalledWith('เพิ่มทรัพย์สินเรียบร้อย')
  })

  it('completes the loan flow when clicking "ให้ยืม" and submitting loan modal', async () => {
    mockAssetService.loanAsset.mockResolvedValue({
      id: 'loan-new',
      asset_id: 'ast-1',
      employee_id: 'emp-2',
      loaned_on: '2026-03-20',
      returned_on: null,
      note: 'ยืมใช้งานนอกสถานที่',
      created_by: 'u-1',
      created_at: '2026-03-20',
    })

    render(
      <MemoryRouter>
        <Assets />
      </MemoryRouter>
    )

    expect(await screen.findByText('AST-001')).toBeTruthy()

    // Click "ให้ยืม" button for AST-001
    const loanBtn = screen.getByRole('button', { name: 'ให้ยืม' })
    fireEvent.click(loanBtn)

    // Verify Loan Modal appears
    expect(screen.getByRole('heading', { name: 'บันทึกการให้ยืมทรัพย์สิน' })).toBeTruthy()
    expect(screen.getByText(/AST-001 — MacBook Pro 14"/)).toBeTruthy()

    // Select employee emp-2
    const empSelect = screen.getByRole('combobox')
    fireEvent.change(empSelect, { target: { value: 'emp-2' } })

    // Change note
    const noteInput = screen.getByPlaceholderText(/วัตถุประสงค์ในการยืม/)
    fireEvent.change(noteInput, { target: { value: 'ยืมใช้งานนอกสถานที่' } })

    // Submit
    const submitBtn = screen.getByRole('button', { name: 'ยืนยันการให้ยืม' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockAssetService.loanAsset).toHaveBeenCalledWith(
        'ast-1',
        expect.objectContaining({
          employee_id: 'emp-2',
          note: 'ยืมใช้งานนอกสถานที่',
        })
      )
    })

    expect(mockToast.success).toHaveBeenCalledWith('บันทึกการให้ยืมเรียบร้อย')
  })

  it('completes the return flow with PaymentAttachments when clicking "รับคืน"', async () => {
    mockAssetService.returnAssetLoan.mockResolvedValue({
      id: 'loan-1',
      asset_id: 'ast-2',
      employee_id: 'emp-1',
      loaned_on: '2026-03-01',
      returned_on: '2026-03-10',
      note: null,
      created_by: 'u-1',
      created_at: '2026-03-01',
    })

    render(
      <MemoryRouter>
        <Assets />
      </MemoryRouter>
    )

    expect(await screen.findByText('AST-002')).toBeTruthy()

    // Click "รับคืน" button
    const returnBtn = screen.getByRole('button', { name: 'รับคืน' })
    fireEvent.click(returnBtn)

    // Verify Return Modal appears with PaymentAttachments
    expect(screen.getByRole('heading', { name: 'บันทึกการรับคืนทรัพย์สิน' })).toBeTruthy()
    expect(screen.getByText(/AST-002 — iPad Pro 11"/)).toBeTruthy()
    // borrower is shown in the table row and in the modal
    expect(screen.getAllByText('สมชาย ใจดี')).toHaveLength(2)

    const attachmentsMock = screen.getByTestId('payment-attachments')
    expect(attachmentsMock.getAttribute('data-ref-type')).toBe('ASSET_LOAN')
    expect(attachmentsMock.getAttribute('data-ref-id')).toBe('loan-1')

    // Submit return
    const submitBtn = screen.getByRole('button', { name: 'ยืนยันรับคืน' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockAssetService.returnAssetLoan).toHaveBeenCalledWith(
        'loan-1',
        expect.objectContaining({
          returned_on: expect.any(String),
        })
      )
    })

    expect(mockToast.success).toHaveBeenCalledWith('บันทึกรับคืนทรัพย์สินเรียบร้อย')
  })
})
