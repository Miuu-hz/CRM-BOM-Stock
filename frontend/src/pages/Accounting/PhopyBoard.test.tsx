import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Mock ResizeObserver for recharts ResponsiveContainer in jsdom
;(globalThis as any).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

// Mock AuthContext
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', role: 'ADMIN', departments: [] },
  }),
}))

// Mock services/api
const mockGet = vi.fn()
vi.mock('../../services/api', () => ({
  default: {
    get: (url: string, config?: unknown) => mockGet(url, config),
    post: vi.fn(),
  },
}))

import PhopyBoard from './PhopyBoard'

const mockSummary = {
  period: { start: '2026-10-01', end: '2026-10-31' },
  kpis: {
    revenue: 812345, cost: 467000, grossProfit: 345345, netProfit: 150000, grossMarginPct: 42.5,
    prevRevenue: 700000, prevGrossProfit: 300000, opex: 195345, labour: 50000,
  },
  businessUnits: [],
  revenueChart: [],
  plTable: [],
  arAging: { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 },
  apAging: { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 },
  arDetail: { buckets: { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 }, total: 0, overdue: 0, count: 0, ledger: {} },
  apDetail: { buckets: { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 }, total: 0, overdue: 0, count: 0, ledger: {} },
  customers: [],
  stockAlerts: [],
  workOrders: { draft: 0, planned: 0, inProgress: 0, completed: 0, cancelled: 0, costVariance: 0 },
  earlyWarnings: [],
  cogsAnalysis: {
    recipe: 0, stockAdjust: 0, directPurchase: 0, ledger: 0,
    stock: { opening: 0, purchasesToStock: 0, directPurchase: 0, closing: 0, cogs: 0 },
    variance: 0, varianceCount: 0, notInLedgerCogs: 0,
    systemStock: { value: null, diff: null },
  },
  posSales: {
    revenue: 0, bills: 0, avgBill: 0, discount: 0, byMethod: [],
    cancelled: { bills: 0, amount: 0 },
    ledger: { sales: 0, cancels: 0, other: 0, net: 0 }, diff: 0,
  },
  cashDrawer: {
    movements: [], totals: { EXPENSE: 0, PURCHASE: 0, OWNER: 0, CASH_IN: 0, OTHER: 0 },
    unposted: { count: 0, amount: 0 }, untrackedGaps: [], overShort: { over: 0, short: 0, net: 0, ledger: 0 },
  },
  labour: { salary: 0, directLabor: 0, total: 0 },
}

const mockExtended = {
  channel: { byPlatform: [], onlineTotal: 0, onlineOrders: 0, offlineRevenue: 0, offlineOrders: 0, orderTrend: [], retailRevenue: 0, retailBills: 0, channels: [] },
  adsROI: {
    totals: { impressions: 0, clicks: 0, orders: 0, revenue: 0, adCost: 0, roas: 0, cpc: 0, cpo: 0, ctr: 0, orderRate: 0, revenuePerAdBaht: 0 },
    byPlatform: [],
  },
  costStructure: { cogsByCategory: [], expenseByCategory: [], expenseRatio: 0, productionVariance: { estimated: 0, actual: 0, variancePct: 0, count: 0 }, costTrend: [], ledgerCogsTotal: 0, ledgerRevenue: 0 },
  products: { top10: [], bottom10: [], concentrationRisk: 0, totalRevenue: 0 },
  workingCapital: { currentAssets: 0, currentLiabilities: 0, cash: 0, ar: 0, currentRatio: 0, quickRatio: 0, cashBurnRate: 0, wcTrend: [] },
  outsourceProduction: { stockValue: { inHouse: 0, offsite: 0 }, suppliersWithStock: [], overdueContracts: [], yield: { good: 0, scrap: 0, shortage: 0, goodPct: 0, scrapPct: 0, shortagePct: 0, byContract: [] } },
}

const mockCfoSummary = {
  period: { start: '2026-10-01', end: '2026-10-31' },
  compare: { mode: 'yoy', start: '2025-10-01', end: '2025-10-31', label: 'ช่วงเดียวกันปีก่อน', hasData: true },
  kpis: [
    { key: 'revenue', label: 'ยอดขาย', value: 812345, prev: 700000, deltaPct: 16.0, format: 'baht' },
    { key: 'netProfit', label: 'กำไรสุทธิ (ก่อนภาษี)', value: 150000, prev: 120000, deltaPct: 25.0, format: 'baht' },
    { key: 'grossMarginPct', label: '% กำไรขั้นต้น', value: 42.5, prev: 40.0, deltaPct: 2.5, format: 'pct' },
    { key: 'cashEnd', label: 'เงินสดสิ้นงวด', value: 250000, prev: 200000, deltaPct: 25.0, format: 'baht', note: 'พอใช้ 52 วัน' },
  ],
  strengths: [
    { text: 'ยอดขายโตต่อเนื่อง 16.0%', from: 'ยอดขายรายไตรมาส · บท 3' },
  ],
  cautions: [
    { text: 'ต้นทุนวัตถุดิบค่อนข้างผันผวน', from: 'ต้นทุนขาย ÷ รายได้ · บท 3' },
  ],
  decisions: [
    { text: 'เงินสดเกินความต้องการ 60 วันราว ฿50,000', from: 'เงินสดสิ้นงวด − เงินใช้ 60 วัน · บท 2' },
  ],
  confidence: { period: '2026-09', label: 'ผ่าน 7/11 ด่าน', passed: 7, total: 11 },
}

const mockTrend = {
  grain: 'month',
  ma: [3, 12],
  warmup: 3,
  dataSince: '2026-04-28',
  periods: [],
}

const mockChecklist = {
  period: '2026-09',
  start: '2026-09-01',
  end: '2026-09-30',
  periodStatus: 'OPEN',
  passed: 7,
  total: 11,
  blocks: 2,
  warns: 2,
  label: 'ผ่าน 7/11 ด่าน',
  canClose: false,
  items: [
    { id: 1, key: 'trial_balance', title: 'งบทดลองดุล', severity: 'block', status: 'pass', detail: 'เดบิตเท่ากับเครดิต', daily: true },
    { id: 2, key: 'unposted', title: 'ไม่มีรายการค้างร่าง', severity: 'warn', status: 'warn', detail: 'มีรายการร่าง 3 รายการ', daily: false },
    { id: 3, key: 'bank_recon', title: 'กระทบยอดเงินฝากธนาคาร', severity: 'block', status: 'block', detail: 'ยังไม่กระทบยอด', daily: false, link: '/accounting/bank-recon' },
    { id: 4, key: 'cash_count', title: 'กระทบยอดเงินสด', severity: 'warn', status: 'pass', detail: 'เงินสดตรง', daily: true },
    { id: 5, key: 'ar_subledger', title: 'ลูกหนี้ตรงบัญชีคุม', severity: 'block', status: 'pass', detail: 'ตรงกัน', daily: true },
    { id: 6, key: 'ap_subledger', title: 'เจ้าหนี้ตรงบัญชีคุม', severity: 'block', status: 'pass', detail: 'ตรงกัน', daily: true },
    { id: 7, key: 'stock_recon', title: 'สต็อกตรงบัญชี', severity: 'warn', status: 'warn', detail: 'ต่างกัน 100 บาท', daily: false },
    { id: 8, key: 'grni_clearing', title: 'บัญชีพักรับของ GRNI', severity: 'warn', status: 'pass', detail: 'ไม่มีค้าง', daily: false },
    { id: 9, key: 'vat_reconcile', title: 'ภาษีซื้อภาษีขาย', severity: 'block', status: 'pass', detail: 'ตรงตามรายงาน', daily: false },
    { id: 10, key: 'wht_reconcile', title: 'ภาษีหัก ณ ที่จ่าย', severity: 'block', status: 'pass', detail: 'ตรงตาม ภ.ง.ด.', daily: false },
    { id: 11, key: 'fixed_assets', title: 'ค่าเสื่อมราคาสินทรัพย์', severity: 'warn', status: 'na', detail: 'ไม่มีสินทรัพย์', daily: false },
  ],
}

describe('PhopyBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/phopy-board/summary')) {
        return Promise.resolve({ data: { success: true, data: mockSummary } })
      }
      if (url.includes('/phopy-board/extended')) {
        return Promise.resolve({ data: { success: true, data: mockExtended } })
      }
      if (url.includes('/phopy-board/cfo-summary')) {
        return Promise.resolve({ data: { success: true, data: mockCfoSummary } })
      }
      if (url.includes('/phopy-board/trend')) {
        return Promise.resolve({ data: { success: true, data: mockTrend } })
      }
      if (url.includes('/month-close/') && url.includes('/checklist')) {
        return Promise.resolve({ data: { success: true, data: mockChecklist } })
      }
      if (url.startsWith('/budgets/')) {
        return Promise.resolve({ data: { success: true, data: [] } })
      }
      if (url.startsWith('/receivables/aging')) {
        return Promise.resolve({ data: { success: true, data: { totals: { outstanding: 0, overdue: 0, current: 0, overduePercent: 0, docCount: 0, overdueCount: 0, partyCount: 0, oldestDays: 0 }, buckets: {}, parties: [] } } })
      }
      if (url.startsWith('/receivables/collection-trend')) {
        return Promise.resolve({ data: { success: true, data: { series: [] } } })
      }
      return Promise.resolve({ data: { success: true, data: null } })
    })
  })

  it('default chapter 1 renders the CFO summary lists with their "มาจาก" lines', async () => {
    render(
      <MemoryRouter initialEntries={['/accounting/phopy-board']}>
        <PhopyBoard />
      </MemoryRouter>
    )

    // CFO summary list items
    await screen.findByText('ยอดขายโตต่อเนื่อง 16.0%')
    expect(screen.getByText('ต้นทุนวัตถุดิบค่อนข้างผันผวน')).toBeTruthy()
    expect(screen.getByText('เงินสดเกินความต้องการ 60 วันราว ฿50,000')).toBeTruthy()

    // "มาจาก:" lines
    expect(screen.getByText('มาจาก: ยอดขายรายไตรมาส · บท 3')).toBeTruthy()
    expect(screen.getByText('มาจาก: ต้นทุนขาย ÷ รายได้ · บท 3')).toBeTruthy()
    expect(screen.getByText('มาจาก: เงินสดสิ้นงวด − เงินใช้ 60 วัน · บท 2')).toBeTruthy()

    // Confidence badge
    expect(screen.getByText('ความน่าเชื่อถือข้อมูล ผ่าน 7/11 ด่าน')).toBeTruthy()
  })

  it('?chapter=6 renders the 11 checklist items', async () => {
    render(
      <MemoryRouter initialEntries={['/accounting/phopy-board?chapter=6']}>
        <PhopyBoard />
      </MemoryRouter>
    )

    await screen.findByText('1. งบทดลองดุล')
    expect(screen.getByText('2. ไม่มีรายการค้างร่าง')).toBeTruthy()
    expect(screen.getByText('3. กระทบยอดเงินฝากธนาคาร')).toBeTruthy()
    expect(screen.getByText('4. กระทบยอดเงินสด')).toBeTruthy()
    expect(screen.getByText('5. ลูกหนี้ตรงบัญชีคุม')).toBeTruthy()
    expect(screen.getByText('6. เจ้าหนี้ตรงบัญชีคุม')).toBeTruthy()
    expect(screen.getByText('7. สต็อกตรงบัญชี')).toBeTruthy()
    expect(screen.getByText('8. บัญชีพักรับของ GRNI')).toBeTruthy()
    expect(screen.getByText('9. ภาษีซื้อภาษีขาย')).toBeTruthy()
    expect(screen.getByText('10. ภาษีหัก ณ ที่จ่าย')).toBeTruthy()
    expect(screen.getByText('11. ค่าเสื่อมราคาสินทรัพย์')).toBeTruthy()

    // Details and status chips
    expect(screen.getByText('ยังไม่กระทบยอด')).toBeTruthy()
    expect(screen.getByText('บล็อก')).toBeTruthy()
    expect(screen.getAllByText('ผ่าน').length).toBeGreaterThan(0)
  })

  it('?view=receivables still renders the receivables tab', async () => {
    render(
      <MemoryRouter initialEntries={['/accounting/phopy-board?view=receivables']}>
        <PhopyBoard />
      </MemoryRouter>
    )

    // Receivables embedded view renders AR/AP tab controls
    await screen.findByText('ลูกหนี้')
    expect(screen.getByText('เจ้าหนี้')).toBeTruthy()
  })

  it('chapter 7 shows the invitation when budgets are empty', async () => {
    render(
      <MemoryRouter initialEntries={['/accounting/phopy-board?chapter=7']}>
        <PhopyBoard />
      </MemoryRouter>
    )

    // Invitation card when budgets empty
    await screen.findByText(/ยังไม่ได้ตั้งงบประมาณ — ตั้งได้ที่ บัญชี > รายงาน > งบประมาณเทียบจริง/)
    expect(screen.getByText(/ตั้งงบประมาณปี/)).toBeTruthy()
  })
})
