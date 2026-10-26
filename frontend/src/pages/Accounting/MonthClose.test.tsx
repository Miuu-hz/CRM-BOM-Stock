import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as XLSX from 'xlsx'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

import api from '../../services/api'
import MonthClose, { buildClosePackWorkbook } from './MonthClose'
import type { ClosePack, MonthCloseStatus } from '../../services/monthClose'

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> }

// ชุดปิดเดือนตัวอย่าง — ตัดให้สั้นที่สุดเท่าที่ยังครบทุก field ที่ buildClosePackWorkbook อ่าน
const fixturePack: ClosePack = {
  version: 1, period: '2026-10', start: '2026-10-01', end: '2026-10-31', generatedAt: '2026-11-01T02:00:00.000Z',
  company: { name: 'Kids House', taxId: null, entityType: 'COMPANY', vatRegistered: true },
  instructions: '# ชุดคำสั่งสำหรับ AI\nบรรทัดที่สอง\nบรรทัดที่สาม',
  accounts: [{
    accountId: 'a1', code: '1102-01', name: 'กรุงศรี 6670', kind: 'BANK', bankName: 'กรุงศรี', accountNumber: '6670',
    opening: -30000, closing: -40080, pending: 0, statement: null,
    lines: [{
      lineId: 'l1', date: '2026-10-03', entryNumber: 'JV-2026-00123', journalEntryId: 'je1', source: 'จ่ายผู้ขาย',
      sourceType: 'SUPPLIER_PAYMENT', sourceNumber: 'SP-2026-00045', counterparty: 'แม็คโคร', description: 'ซื้อของ',
      in: 0, out: 1250, balance: -31250, posted: true,
    }],
  }],
  headerBalances: [{ code: '1102', name: 'เงินฝากธนาคาร', balance: -6965.34 }],
  chart: [{ code: '5309', name: 'ค่าธรรมเนียมธนาคาร', type: 'EXPENSE', category: 'BANK_CHARGE' }],
  contacts: {
    suppliers: [{ id: 's1', code: 'SUP-001', name: 'แม็คโคร', taxId: null }],
    customers: [{ id: 'c1', code: 'CUS-001', name: 'ลูกค้าทั่วไป', taxId: null }],
  },
  openInvoices: {
    sales: [{ id: 'inv1', number: 'INV-001', party: 'ลูกค้าทั่วไป', date: '2026-10-01', dueDate: '2026-10-31', balance: 1200 }],
    purchase: [],
  },
  types: [{ type: 'BANK_FEE', label: 'ค่าธรรมเนียมธนาคาร', debit: '5309', credit: 'บัญชีที่กระทบยอด', needs: [], allowedAccounts: [], note: 'บรรทัดใน statement' }],
  submitSchema: {
    lineFields: ['type', 'date', 'amount', 'statement_ref', 'statement_line_no', 'description'],
    example: { type: 'BANK_FEE', date: '2026-10-31', amount: 20, statement_ref: 'FEE1031', statement_line_no: 58, description: 'ค่าธรรมเนียมโอนต่างธนาคาร' },
  },
  existingAdjustments: [],
}

function fixtureStatus(overrides: Partial<MonthCloseStatus> = {}): MonthCloseStatus {
  return {
    period: '2026-10', start: '2026-10-01', end: '2026-10-31',
    periodStatus: 'OPEN', taxPeriodId: 'tp1', entityType: 'COMPANY', canApprove: true,
    recon: [], groups: [], unposts: [],
    checklist: {
      period: '2026-10', start: '2026-10-01', end: '2026-10-31', periodStatus: 'OPEN',
      items: [], passed: 0, total: 11, blocks: 0, warns: 0, label: 'ผ่าน 0/11', canClose: true,
    },
    ...overrides,
  }
}

function seedStatus(status: MonthCloseStatus) {
  mockApi.get.mockImplementation((url: string) => {
    if (url.includes('/status')) return Promise.resolve({ data: { data: status } })
    return Promise.resolve({ data: { data: [] } })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildClosePackWorkbook', () => {
  it('คืน 9 ชีตตามลำดับที่สเปกกำหนด', () => {
    const wb = buildClosePackWorkbook(fixturePack)
    expect(wb.SheetNames).toEqual([
      'อ่านก่อน', 'รายการในระบบ', 'ยอดต่อบัญชี', 'บัญชีหัวค้างยอด', 'ผังบัญชี', 'คู่ค้า', 'ใบแจ้งหนี้ค้าง', 'ประเภทรายการ', 'แบบฟอร์มส่งกลับ',
    ])
  })

  it('ชีตแรก (อ่านก่อน) แถวแรก ๆ ต้องเป็นบรรทัดคำสั่งตามลำดับเดิม', () => {
    const wb = buildClosePackWorkbook(fixturePack)
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][]
    const expectedLines = fixturePack.instructions.split('\n')
    expect(rows.map((r) => r[0])).toEqual(expectedLines)
  })
})

describe('หน้าปิดเดือน — ตารางกระทบยอด', () => {
  it('statement เป็น null แสดง "ยังไม่ส่ง" และผลต่าง 0 แสดง "ตรง" สีเขียว', async () => {
    seedStatus(fixtureStatus({
      recon: [
        {
          accountId: 'acc1', code: '1102-01', name: 'กรุงศรี 6670', kind: 'BANK', bankName: 'กรุงศรี', accountNumber: '6670',
          book: -40080, pending: 0, timing: 0, statement: null, statementHash: null, difference: null, reconciled: false,
          submittedAt: null, submittedBy: null, counts: { draft: 0, pendingApproval: 0, posted: 0, discarded: 0, noted: 0 },
        },
        {
          accountId: 'acc2', code: '1101', name: 'เงินสด', kind: 'CASH', bankName: null, accountNumber: null,
          book: 5000, pending: 0, timing: 0, statement: 5000, statementHash: 'h1', difference: 0, reconciled: true,
          submittedAt: '2026-11-01T00:00:00.000Z', submittedBy: 'owner', counts: { draft: 0, pendingApproval: 0, posted: 0, discarded: 0, noted: 0 },
        },
      ],
    }))
    render(<MemoryRouter><MonthClose /></MemoryRouter>)

    await screen.findByText('ยังไม่ส่ง')
    expect(screen.getByText('ตรง')).toBeTruthy()
  })
})

describe('หน้าปิดเดือน — ปุ่มล็อกงวด', () => {
  it('canClose = false ต้องปิดปุ่มปิดงวด', async () => {
    seedStatus(fixtureStatus({
      checklist: {
        period: '2026-10', start: '2026-10-01', end: '2026-10-31', periodStatus: 'OPEN',
        items: [{ id: 6, key: 'no_header_posting', title: 'ไม่มีรายการลงบัญชีหัว', severity: 'block', status: 'block', detail: '1102 · 4 รายการ', daily: true }],
        passed: 0, total: 11, blocks: 1, warns: 0, label: 'ผ่าน 0/11', canClose: false,
      },
    }))
    render(<MemoryRouter><MonthClose /></MemoryRouter>)

    const button = await screen.findByRole('button', { name: /ปิดงวด/ })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true))
  })
})

describe('หน้าปิดเดือน — ปุ่มกลุ่มรายการปรับปรุง', () => {
  const baseGroup = {
    type: 'BANK_FEE', label: 'ค่าธรรมเนียมธนาคาร', status: 'DRAFT', count: 1, total: 20,
    records: [{
      id: 'r1', accountCode: '1102-01', date: '2026-10-31', amount: 20, effect: -20, direction: 'OUT',
      description: 'ค่าธรรมเนียม', statementRef: 'FEE1031', statementLineNo: 58, reason: 'statement บรรทัด 58', confidence: 0.95,
      debitAccount: '5309', creditAccount: '1102-01', journalEntryId: null, entryNumber: 'JV-2026-00999',
      status: 'DRAFT', submittedBy: 'ai', approvalRequestNumber: null,
    }],
  }

  it('canApprove = true แสดง "อนุมัติและลงบัญชีกลุ่มนี้"', async () => {
    seedStatus(fixtureStatus({ canApprove: true, groups: [baseGroup] }))
    render(<MemoryRouter><MonthClose /></MemoryRouter>)
    await screen.findByText('อนุมัติและลงบัญชีกลุ่มนี้')
  })

  it('canApprove = false แสดง "ส่งขออนุมัติกลุ่มนี้"', async () => {
    seedStatus(fixtureStatus({ canApprove: false, groups: [baseGroup] }))
    render(<MemoryRouter><MonthClose /></MemoryRouter>)
    await screen.findByText('ส่งขออนุมัติกลุ่มนี้')
  })

  it('กลุ่ม TIMING / NOTED ต้องไม่มีปุ่มอนุมัติ แต่มีปุ่มทิ้ง', async () => {
    const timingGroup = {
      type: 'TIMING', label: 'รายการระหว่างทาง (ไม่ลงบัญชี)', status: 'NOTED', count: 1, total: 100,
      records: [{
        id: 'r2', accountCode: '1102-01', date: '2026-10-31', amount: 100, effect: 100, direction: 'IN',
        description: 'เงินโอนระหว่างทาง', statementRef: 'TRF1031', statementLineNo: 1, reason: 'เงินเข้าปลายงวด', confidence: 1,
        debitAccount: 'ไม่ลงบัญชี', creditAccount: '', journalEntryId: null, entryNumber: null,
        status: 'NOTED', submittedBy: 'ai', approvalRequestNumber: null,
      }],
    }
    seedStatus(fixtureStatus({ canApprove: true, groups: [timingGroup] }))
    render(<MemoryRouter><MonthClose /></MemoryRouter>)
    await screen.findByText('รายการระหว่างทาง (ไม่ลงบัญชี)')
    expect(screen.queryByText('อนุมัติและลงบัญชีกลุ่มนี้')).toBeNull()
    expect(screen.queryByText('ส่งขออนุมัติกลุ่มนี้')).toBeNull()
    expect(screen.getByText('ทิ้ง')).toBeTruthy()
  })
})
