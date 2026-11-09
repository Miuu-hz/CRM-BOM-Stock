import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../../services/accounting', () => ({
  accountsApi: {
    getAll: vi.fn(),
  },
}))

vi.mock('../../services/hr.service', () => {
  const service = {
    getEmployees: vi.fn(),
    getAdvances: vi.fn(),
    getAdvance: vi.fn(),
    createAdvance: vi.fn(),
    cancelAdvance: vi.fn(),
    disburseAdvance: vi.fn(),
    getSettings: vi.fn(),
    repayCashAdvance: vi.fn(),
  }
  return {
    default: service,
    hrService: service,
  }
})

import hrService from '../../services/hr.service'
import { accountsApi } from '../../services/accounting'
import toast from 'react-hot-toast'
import Advances from './Advances'

const mockHr = hrService as unknown as {
  getEmployees: ReturnType<typeof vi.fn>
  getAdvances: ReturnType<typeof vi.fn>
  getAdvance: ReturnType<typeof vi.fn>
  createAdvance: ReturnType<typeof vi.fn>
  cancelAdvance: ReturnType<typeof vi.fn>
  disburseAdvance: ReturnType<typeof vi.fn>
  getSettings: ReturnType<typeof vi.fn>
  repayCashAdvance: ReturnType<typeof vi.fn>
}

const mockAccounts = accountsApi as unknown as {
  getAll: ReturnType<typeof vi.fn>
}

const mockToast = toast as unknown as {
  success: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
}

const sampleEmployees = [
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
    first_name: 'มาลี',
    last_name: 'รักเรียน',
    status: 'ACTIVE',
    employment_type: 'MONTHLY',
  },
]

const sampleAdvances = [
  {
    id: 'adv-1',
    employee_id: 'emp-1',
    employee_code: 'EMP-001',
    employee_name: 'สมชาย ใจดี',
    kind: 'ADVANCE',
    amount: 2000,
    installments: 1,
    installment_amount: 2000,
    interest_rate: 0,
    interest_amount: 0,
    start_period: '2026-04',
    reason: 'ค่ารักษาพยาบาล',
    status: 'PENDING',
    approval_request_id: 'appr-1',
    decided_at: null,
    disbursed_on: null,
    disburse_je_id: null,
    repaid: 0,
    outstanding: 2000,
    created_at: '2026-03-15T10:00:00Z',
  },
  {
    id: 'adv-2',
    employee_id: 'emp-2',
    employee_code: 'EMP-002',
    employee_name: 'มาลี รักเรียน',
    kind: 'LOAN',
    amount: 6000,
    installments: 3,
    installment_amount: 2000,
    interest_rate: 12,
    interest_amount: 90,
    start_period: '2026-04',
    reason: 'ซ่อมแซมบ้าน',
    status: 'APPROVED',
    approval_request_id: 'appr-2',
    decided_at: '2026-03-20T10:00:00Z',
    disbursed_on: null,
    disburse_je_id: null,
    repaid: 0,
    outstanding: 6000,
    created_at: '2026-03-18T10:00:00Z',
  },
  {
    id: 'adv-3',
    employee_id: 'emp-1',
    employee_code: 'EMP-001',
    employee_name: 'สมชาย ใจดี',
    kind: 'LOAN',
    amount: 10000,
    installments: 5,
    installment_amount: 2000,
    interest_rate: 0,
    interest_amount: 0,
    start_period: '2026-01',
    reason: null,
    status: 'ACTIVE',
    approval_request_id: 'appr-3',
    decided_at: '2025-12-25T10:00:00Z',
    disbursed_on: '2026-01-05',
    disburse_je_id: 'je-1',
    repaid: 4000,
    outstanding: 6000,
    created_at: '2025-12-20T10:00:00Z',
  },
]

const sampleAccounts = [
  { id: 'acc-1', code: '1111', name: 'เงินสด', type: 'ASSET' },
  { id: 'acc-2', code: '1112', name: 'เงินฝากกสิกร', type: 'ASSET' },
]

function renderPage() {
  return render(
    <MemoryRouter>
      <Advances />
    </MemoryRouter>
  )
}

describe('หน้าเบิกล่วงหน้าและเงินยืม (Advances)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHr.getEmployees.mockResolvedValue(sampleEmployees)
    mockHr.getAdvances.mockResolvedValue(sampleAdvances)
    mockHr.getSettings.mockResolvedValue({ loanInterestRatePct: 0 })
    mockHr.repayCashAdvance.mockResolvedValue({})
    mockAccounts.getAll.mockResolvedValue({ data: { data: sampleAccounts } })
  })

  it('แสดงชื่อหน้า ชิปกรองสถานะ บันทึกเตือน ม.76 และตารางรายการ', async () => {
    renderPage()

    expect(await screen.findByText('เบิกล่วงหน้า / เงินยืม')).toBeTruthy()

    // ชิปกรองสถานะเป็นปุ่ม
    expect(screen.getByRole('button', { name: 'ทั้งหมด' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'รออนุมัติ' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'อนุมัติแล้ว-รอจ่าย' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'กำลังหัก' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ปิดแล้ว' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ไม่อนุมัติ/ยกเลิก' })).toBeTruthy()

    // ข้อความหมายเหตุใต้ตาราง
    expect(
      screen.getByText(
        'หักในรอบเงินเดือนให้อัตโนมัติ · เงินยืมหักไม่เกิน 10% ของค่าจ้างต่องวด (ม.76) · เบิกค่าจ้างที่ทำแล้วไม่นับเพดานนี้'
      )
    ).toBeTruthy()

    // ตรวจสอบตารางและแถวรายการ
    const table = screen.getByRole('table')
    expect(within(table).getAllByText('EMP-001').length).toBeGreaterThan(0)
    expect(within(table).getAllByText('EMP-002').length).toBeGreaterThan(0)
    expect(within(table).getAllByText('เบิกล่วงหน้า').length).toBeGreaterThan(0)
    expect(within(table).getAllByText('เงินยืม').length).toBeGreaterThan(0)
    expect(within(table).getAllByText('รออนุมัติ').length).toBeGreaterThan(0)
    expect(within(table).getByText('ดอกเบี้ย 12% (90.00)')).toBeTruthy()
  })

  it('แถวที่ APPROVED แสดงปุ่ม "จ่ายเงิน" และส่งฟอร์มจ่ายเงินเรียก disburseAdvance สำเร็จ', async () => {
    renderPage()

    // แถว adv-2 สถานะ APPROVED ต้องมีปุ่ม จ่ายเงิน
    const disburseBtn = await screen.findByRole('button', { name: 'จ่ายเงิน' })
    expect(disburseBtn).toBeTruthy()

    fireEvent.click(disburseBtn)

    // Modal จ่ายเงินเปิดขึ้นมา
    expect(await screen.findByRole('heading', { name: 'บันทึกจ่ายเงิน' })).toBeTruthy()

    // รอให้ options บัญชีโหลดและแสดงผล
    const option1112 = await screen.findByRole('option', { name: /1112/ })
    expect(option1112).toBeTruthy()

    // กำหนดค่าบัญชีและวันที่จ่ายเงิน
    const accountSelect = screen.getByLabelText(/บัญชีจ่ายเงิน/)
    fireEvent.change(accountSelect, { target: { value: 'acc-2' } })

    const dateInput = screen.getByLabelText(/วันที่จ่ายเงิน/)
    fireEvent.change(dateInput, { target: { value: '2026-03-25' } })

    // กดปุ่ม ยืนยันจ่ายเงิน ภายในโมดัล
    const confirmBtn = screen.getByRole('button', { name: 'ยืนยันจ่ายเงิน' })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(mockHr.disburseAdvance).toHaveBeenCalledWith('adv-2', {
        pay_account_id: 'acc-2',
        date: '2026-03-25',
      })
    })

    expect(mockToast.success).toHaveBeenCalledWith('บันทึกการจ่ายเงินแล้ว')
  })

  it('โมดัลสร้างคำขอ เลือก LOAN 3000 × 3 แสดง "ผ่อนงวดละ 1,000.00" และเรียก createAdvance สำเร็จ', async () => {
    renderPage()

    const createBtn = await screen.findByRole('button', { name: /สร้างคำขอ/ })
    fireEvent.click(createBtn)

    expect(await screen.findByRole('heading', { name: 'สร้างคำขอเบิก / เงินยืม' })).toBeTruthy()

    // เลือกพนักงาน
    const empSelect = screen.getByLabelText(/พนักงาน \*/)
    fireEvent.change(empSelect, { target: { value: 'emp-1' } })

    // เลือกประเภท LOAN
    const loanRadio = screen.getByLabelText('เงินยืม')
    fireEvent.click(loanRadio)

    // กรอกยอดเงิน 3000
    const amountInput = screen.getByLabelText(/ยอดเงิน \(บาท\) \*/)
    fireEvent.change(amountInput, { target: { value: '3000' } })

    // กรอกงวด 3
    const installmentsInput = screen.getByLabelText(/จำนวนงวดผ่อน/)
    fireEvent.change(installmentsInput, { target: { value: '3' } })

    // แสดง live preview ผ่อนงวดละ 1,000.00
    expect(await screen.findByText(/ผ่อนงวดละ 1,000\.00/)).toBeTruthy()

    // กรอกเหตุผล
    const reasonInput = screen.getByLabelText(/เหตุผลความจำเป็น/)
    fireEvent.change(reasonInput, { target: { value: 'ยืมซ่อมรถ' } })

    // ส่งคำขอ
    const submitBtn = screen.getByRole('button', { name: 'ส่งคำขอ' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockHr.createAdvance).toHaveBeenCalledWith({
        employee_id: 'emp-1',
        kind: 'LOAN',
        amount: 3000,
        installments: 3,
        start_period: expect.any(String),
        reason: 'ยืมซ่อมรถ',
        interest_rate: 0,
      })
    })

    expect(mockToast.success).toHaveBeenCalledWith('ส่งคำขอแล้ว รออนุมัติในกล่องอนุมัติ')
  })

  it('แสดงข้อความผิดพลาดจากเซิร์ฟเวอร์ เมื่อ createAdvance ล้มเหลว (400 ข้อกำหนด ม.76)', async () => {
    mockHr.createAdvance.mockRejectedValueOnce({
      response: {
        status: 400,
        data: { message: 'ยอดผ่อนต่องวดเกิน 10% ของค่าจ้าง (ม.76) — เพิ่มจำนวนงวด' },
      },
    })

    renderPage()

    const createBtn = await screen.findByRole('button', { name: /สร้างคำขอ/ })
    fireEvent.click(createBtn)

    const empSelect = screen.getByLabelText(/พนักงาน \*/)
    fireEvent.change(empSelect, { target: { value: 'emp-1' } })

    const amountInput = screen.getByLabelText(/ยอดเงิน \(บาท\) \*/)
    fireEvent.change(amountInput, { target: { value: '50000' } })

    const submitBtn = screen.getByRole('button', { name: 'ส่งคำขอ' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'ยอดผ่อนต่องวดเกิน 10% ของค่าจ้าง (ม.76) — เพิ่มจำนวนงวด'
      )
    })
  })

  it('แถว PENDING หรือ APPROVED มีปุ่ม "ยกเลิก" และกดยืนยันใน modal จะเรียก cancelAdvance', async () => {
    renderPage()

    const cancelBtns = await screen.findAllByRole('button', { name: 'ยกเลิก' })
    expect(cancelBtns.length).toBeGreaterThan(0)

    // กดยกเลิกรายการแรก (PENDING)
    fireEvent.click(cancelBtns[0])

    // ตรวจสอบ Confirmation Modal
    expect(await screen.findByRole('heading', { name: 'ยืนยันยกเลิกคำขอ' })).toBeTruthy()

    // กดปุ่ม ยืนยันยกเลิก
    const confirmCancelBtn = screen.getByRole('button', { name: 'ยืนยันยกเลิก' })
    fireEvent.click(confirmCancelBtn)

    await waitFor(() => {
      expect(mockHr.cancelAdvance).toHaveBeenCalledWith('adv-1')
    })

    expect(mockToast.success).toHaveBeenCalledWith('ยกเลิกคำขอแล้ว')
  })

  it('คลิกที่แถวรายการเพื่อเปิดดูรายละเอียดและตารางประวัติการหักชำระพร้อม running balance', async () => {
    mockHr.getAdvance.mockResolvedValueOnce({
      ...sampleAdvances[2],
      repayments: [
        { run_id: 'run-1', period: '2026-01', amount: 2000, interest: 100, source: 'PAYROLL', created_at: '2026-01-31' },
        { run_id: 'run-2', period: '2026-02', amount: 2000, interest: 0, source: 'CASH', created_at: '2026-02-28' },
      ],
    })

    renderPage()

    // คลิกแถวรายการ adv-3 ด้วย regex matcher สำหรับข้อความวิธีหัก
    const rowCell = await screen.findByText(/เริ่ม 2026-01/)
    fireEvent.click(rowCell)

    expect(mockHr.getAdvance).toHaveBeenCalledWith('adv-3')
    expect(await screen.findByRole('heading', { name: 'รายละเอียดเบิกล่วงหน้า / เงินยืม' })).toBeTruthy()
    expect(screen.getByText('ประวัติการหักในรอบเงินเดือน')).toBeTruthy()

    // ตรวจสอบเซลล์ในตารางประวัติการหักชำระ
    expect(screen.getByRole('cell', { name: '2026-01' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '2026-02' })).toBeTruthy()
    expect(screen.getByText('หักเงินเดือน')).toBeTruthy()
    expect(screen.getAllByText('รับคืนเงินสด').length).toBeGreaterThan(0)
    expect(screen.getByText('100.00')).toBeTruthy()

    // งวด 2026-01 ยอดหัก 2,000.00 ยอดคงค้างหลังหัก 8,000.00
    expect(screen.getByText('8,000.00')).toBeTruthy()
    // งวด 2026-02 ยอดหัก 2,000.00 ยอดคงค้างหลังหัก 6,000.00
    expect(screen.getAllByText('6,000.00').length).toBeGreaterThan(0)
  })

  it('การเปลี่ยนตัวกรองชิปสถานะและตัวกรองพนักงานเรียก getAdvances ด้วยพารามิเตอร์ที่ถูกต้อง', async () => {
    renderPage()

    await screen.findByText('เบิกล่วงหน้า / เงินยืม')

    // กดชิปปุ่ม "รออนุมัติ"
    const pendingChip = screen.getByRole('button', { name: 'รออนุมัติ' })
    fireEvent.click(pendingChip)

    await waitFor(() => {
      expect(mockHr.getAdvances).toHaveBeenCalledWith({ status: 'PENDING' })
    })

    // เปลี่ยนตัวกรองพนักงาน
    const empFilter = screen.getByLabelText('กรองตามพนักงาน')
    fireEvent.change(empFilter, { target: { value: 'emp-1' } })

    await waitFor(() => {
      expect(mockHr.getAdvances).toHaveBeenCalledWith({
        status: 'PENDING',
        employee_id: 'emp-1',
      })
    })
  })

  it('สร้างคำขอ LOAN 3000 × 3 ดอกเบี้ย 12 แสดง "ดอกเบี้ยรวม 90.00" และ "ผ่อนงวดละ 1,030.00" และเรียก createAdvance พร้อม interest_rate: 12', async () => {
    renderPage()

    const createBtn = await screen.findByRole('button', { name: /สร้างคำขอ/ })
    fireEvent.click(createBtn)

    expect(await screen.findByRole('heading', { name: 'สร้างคำขอเบิก / เงินยืม' })).toBeTruthy()

    // เลือกพนักงาน
    const empSelect = screen.getByLabelText(/พนักงาน \*/)
    fireEvent.change(empSelect, { target: { value: 'emp-1' } })

    // เลือกประเภท LOAN
    const loanRadio = screen.getByLabelText('เงินยืม')
    fireEvent.click(loanRadio)

    // กรอกยอดเงิน 3000
    const amountInput = screen.getByLabelText(/ยอดเงิน \(บาท\) \*/)
    fireEvent.change(amountInput, { target: { value: '3000' } })

    // กรอกงวด 3
    const installmentsInput = screen.getByLabelText(/จำนวนงวดผ่อน/)
    fireEvent.change(installmentsInput, { target: { value: '3' } })

    // กรอกดอกเบี้ย 12
    const interestInput = screen.getByLabelText(/ดอกเบี้ย \(% ต่อปี\)/)
    fireEvent.change(interestInput, { target: { value: '12' } })

    // แสดง live preview: ดอกเบี้ยรวม 90.00 และ ผ่อนงวดละ 1,030.00
    expect(await screen.findByText(/ดอกเบี้ยรวม 90\.00/)).toBeTruthy()
    expect(screen.getByText(/ผ่อนงวดละ 1,030\.00/)).toBeTruthy()

    // ส่งคำขอ
    const submitBtn = screen.getByRole('button', { name: 'ส่งคำขอ' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockHr.createAdvance).toHaveBeenCalledWith({
        employee_id: 'emp-1',
        kind: 'LOAN',
        amount: 3000,
        installments: 3,
        start_period: expect.any(String),
        interest_rate: 12,
      })
    })

    expect(mockToast.success).toHaveBeenCalledWith('ส่งคำขอแล้ว รออนุมัติในกล่องอนุมัติ')
  })

  it('แถวที่ ACTIVE แสดงปุ่ม "รับคืนเงินสด" และส่งฟอร์มเรียก repayCashAdvance พร้อม amount เท่ากับยอดคงค้าง', async () => {
    renderPage()

    const repayBtn = await screen.findByRole('button', { name: 'รับคืนเงินสด' })
    expect(repayBtn).toBeTruthy()

    fireEvent.click(repayBtn)

    expect(await screen.findByRole('heading', { name: 'บันทึกรับคืนเงินสด' })).toBeTruthy()

    // รอให้ options บัญชีโหลดและแสดงผล
    const option1112 = await screen.findByRole('option', { name: /1112/ })
    expect(option1112).toBeTruthy()

    // กดยืนยันบันทึกรับคืน (default: amount = 6000, date = วันนี้, pay_account_id = acc-1 (บัญชีแรก))
    const confirmBtn = screen.getByRole('button', { name: 'บันทึกรับคืน' })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(mockHr.repayCashAdvance).toHaveBeenCalledWith('adv-3', {
        amount: 6000,
        date: expect.any(String),
        pay_account_id: 'acc-1',
      })
    })

    expect(mockToast.success).toHaveBeenCalledWith('บันทึกรับคืนแล้ว')
  })
})
