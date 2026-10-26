import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '../services/api'
import Dashboard from './Dashboard'

vi.mock('../services/api', () => ({
  default: { get: vi.fn() },
}))

vi.mock('recharts', async () => {
  const original = await vi.importActual<any>('recharts')
  return {
    ...original,
    ResponsiveContainer: ({ children }: any) => (
      <div style={{ width: 600, height: 150 }}>{children}</div>
    ),
  }
})

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> }

describe('Dashboard Page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('with financial: false, only the ops bar renders and no "฿" appears in the document', async () => {
    const basicFixture = {
      financial: false,
      asOf: '2026-10-25',
      today: '2026-10-26',
      dataSince: null,
      dataDays: 0,
      overall: null,
      confidence: null,
      signals: [],
      chart: null,
      ops: {
        lowStock: 4,
        pendingDelivery: 0,
        pendingApprovals: 2,
        arDue7: { count: 3, amount: null },
      },
    }

    mockApi.get.mockResolvedValueOnce({
      data: { success: true, data: basicFixture },
    })

    const { container } = render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('4')).toBeDefined()
    })

    // Ops bar titles and counts
    expect(screen.getByText(/สต็อกวิกฤต/)).toBeDefined()
    expect(screen.getByText(/รอส่งของ/)).toBeDefined()
    expect(screen.getByText(/รออนุมัติ/)).toBeDefined()
    expect(screen.getByText(/ลูกหนี้ครบกำหนด 7 วัน/)).toBeDefined()
    expect(screen.getByText('3 ใบ')).toBeDefined()

    // No money/currency "฿" symbol anywhere in the document
    expect(container.textContent).not.toContain('฿')

    // Banner, tiles, chart, todo should NOT be rendered
    expect(screen.queryByText(/ความน่าเชื่อถือข้อมูล/)).toBeNull()
    expect(screen.queryByText(/เรื่องที่ต้องดูวันนี้/)).toBeNull()
    expect(screen.queryByText(/รายรับ · รายจ่าย · เงินคงเหลือ/)).toBeNull()
  })

  it('with financial fixture having one R and one Y signal, todo list shows exactly those two and banner shows headline', async () => {
    const financialFixture = {
      financial: true,
      asOf: '2026-10-25',
      today: '2026-10-26',
      dataSince: '2026-04-28',
      dataDays: 181,
      overall: {
        status: 'R',
        headline: 'แดง · ต้องสั่งการ 1 เรื่อง',
        red: 1,
        yellow: 1,
        na: 0,
      },
      confidence: {
        period: '2026-09',
        label: 'ผ่าน 7/11 ด่าน',
        passed: 7,
        total: 11,
        blocks: 2,
      },
      signals: [
        {
          id: 'runway',
          label: 'เงินพอใช้',
          status: 'R',
          value: 18,
          display: '18 วัน',
          compare: 'เงินคงเหลือ ฿50,000 · ใช้เฉลี่ยวันละ ฿2,800',
          rule: 'เขียว ≥ 45 วัน · เหลือง 21–44 · แดง < 21',
          source: 'บัญชีเงินสด + เงินฝาก',
          action: 'ดูรายจ่ายก้อนใหญ่ที่จะถึงรอบ และเร่งเก็บลูกหนี้',
          link: '/accounting/phopy-board?chapter=2',
        },
        {
          id: 'salesYesterday',
          label: 'ยอดขายเมื่อวาน',
          status: 'Y',
          value: 8500,
          display: '฿8,500',
          compare: '80% ของวันอาทิตย์ปกติ (฿10,600)',
          rule: 'เทียบวันเดียวกัน 4 สัปดาห์ก่อน',
          source: 'บิล POS',
          action: 'ตรวจจำนวนบิลและค่าเฉลี่ยต่อบิล',
          link: '/accounting/phopy-board?chapter=3',
        },
        {
          id: 'cogs7',
          label: 'ต้นทุนวัตถุดิบ 7 วัน',
          status: 'G',
          value: 32,
          display: '32%',
          compare: 'ใกล้เคียง 90 วัน',
          rule: 'เขียว ≤ +1.5',
          source: 'COGS',
          action: 'ปกติ',
          link: '/accounting/phopy-board?chapter=3',
        },
      ],
      chart: {
        grain: 'week',
        ma: [4, 13],
        warmup: 0,
        periods: [
          {
            key: '2026-10-19',
            from: '2026-10-19',
            to: '2026-10-25',
            days: 7,
            rev: { o: 6000, c: 6500, h: 7000, l: 5500, tot: 45500 },
            exp: { o: 4000, c: 4200, h: 4800, l: 3800, tot: 29400 },
            cash: { c: 50000, hi: 60000, lo: 45000 },
          },
        ],
      },
      ops: {
        lowStock: 2,
        pendingDelivery: 1,
        pendingApprovals: 0,
        arDue7: { count: 1, amount: 5000 },
      },
    }

    mockApi.get.mockResolvedValueOnce({
      data: { success: true, data: financialFixture },
    })

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    )

    // Banner headline
    await waitFor(() => {
      expect(screen.getByText('แดง · ต้องสั่งการ 1 เรื่อง')).toBeDefined()
    })

    // Confidence label in banner
    expect(screen.getByText('ผ่าน 7/11 ด่าน')).toBeDefined()

    // Todo section
    expect(screen.getByText(/เรื่องที่ต้องดูวันนี้/)).toBeDefined()

    // Exactly the R and Y signals in todo section:
    // "เงินพอใช้ 18 วัน" and "ยอดขายเมื่อวาน ฿8,500"
    expect(screen.getByText(/เงินพอใช้ 18 วัน/)).toBeDefined()
    expect(screen.getByText(/ยอดขายเมื่อวาน ฿8,500/)).toBeDefined()

    // Green signal "ต้นทุนวัตถุดิบ 7 วัน" should NOT be in the todo section
    // Let's verify by finding the todo container
    const todoHeading = screen.getByText(/เรื่องที่ต้องดูวันนี้/)
    const todoCard = todoHeading.closest('div')!
    expect(todoCard.textContent).toContain('เงินพอใช้ 18 วัน')
    expect(todoCard.textContent).toContain('ยอดขายเมื่อวาน ฿8,500')
    expect(todoCard.textContent).not.toContain('ต้นทุนวัตถุดิบ 7 วัน')
  })
})
