import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import CandleChart, { movingAverage, capFor, niceScale, TrendPeriod } from './CandleChart'

vi.mock('recharts', async () => {
  const original = await vi.importActual<any>('recharts')
  return {
    ...original,
    ResponsiveContainer: ({ children }: any) => (
      <div style={{ width: 600, height: 150 }}>{children}</div>
    ),
  }
})

describe('CandleChart helpers', () => {
  describe('movingAverage', () => {
    it('returns nulls before n - 1', () => {
      const vals = [10, 20, 30, 40, 50]
      const ma3 = movingAverage(vals, 3)
      // Index 0 and 1 (< 3 - 1) must be null
      expect(ma3[0]).toBeNull()
      expect(ma3[1]).toBeNull()
      // Index 2: (10 + 20 + 30) / 3 = 20
      expect(ma3[2]).toBe(20)
      // Index 3: (20 + 30 + 40) / 3 = 30
      expect(ma3[3]).toBe(30)
      // Index 4: (30 + 40 + 50) / 3 = 40
      expect(ma3[4]).toBe(40)
    })

    it('works for window of 1', () => {
      const vals = [15, 25]
      const ma1 = movingAverage(vals, 1)
      expect(ma1).toEqual([15, 25])
    })
  })

  describe('capFor', () => {
    it('leaves normal wicks untouched', () => {
      // Bodies max = 100, threshold = 1.6 * 100 = 160.
      // Max wick = 140 <= 160, so wick is untouched.
      const rows = [
        { o: 80, c: 100, h: 140, l: 70 },
        { o: 100, c: 90, h: 120, l: 80 },
      ]
      expect(capFor(rows, [])).toBe(140)
    })

    it('cuts spike wick at 1.6x the maximum body value', () => {
      // Bodies max = 100, threshold = 1.6 * 100 = 160.
      // Max wick = 500 > 160, so wick is cut at 160.
      const rows = [
        { o: 80, c: 100, h: 500, l: 70 },
        { o: 100, c: 90, h: 120, l: 80 },
      ]
      expect(capFor(rows, [])).toBe(160)
    })

    it('considers MA values when computing threshold', () => {
      // Bodies max = 50, but MA value = 100.
      // Threshold = 1.6 * 100 = 160.
      // Max wick = 150 <= 160, so wick is untouched.
      const rows = [
        { o: 40, c: 50, h: 150, l: 30 },
      ]
      const maVals = [null, 100]
      expect(capFor(rows, maVals)).toBe(150)
    })

    it('handles empty rows safely', () => {
      expect(capFor([], [])).toBe(0)
    })
  })

  describe('niceScale', () => {
    it('produces round step intervals', () => {
      const scale = niceScale(0, 180, 3)
      expect(scale.min).toBeLessThanOrEqual(0)
      expect(scale.max).toBeGreaterThanOrEqual(180)
      expect(scale.step).toBeGreaterThan(0)
    })
  })
})

describe('CandleChart component', () => {
  const dummyPeriods: TrendPeriod[] = [
    {
      key: '2026-10-12',
      from: '2026-10-12',
      to: '2026-10-18',
      days: 7,
      rev: { o: 5000, c: 6000, h: 7000, l: 4500, tot: 42000 },
      exp: { o: 3000, c: 3500, h: 4000, l: 2800, tot: 24500 },
      cash: { c: 120000, hi: 130000, lo: 115000 },
    },
    {
      key: '2026-10-19',
      from: '2026-10-19',
      to: '2026-10-25',
      days: 7,
      rev: { o: 6000, c: 5500, h: 6200, l: 5000, tot: 38500 },
      exp: { o: 3500, c: 3200, h: 3600, l: 3000, tot: 22400 },
      cash: { c: 125000, hi: 128000, lo: 119000 },
    },
  ]

  it('renders readout with aria-live="polite" and panel role="img"', () => {
    render(
      <CandleChart
        periods={dummyPeriods}
        visibleFrom={0}
        ma={[4, 13]}
        labelOf={p => `สัปดาห์ ${p.from}–${p.to}`}
      />
    )

    // Check readout aria-live polite
    const readout = screen.getByText(/สัปดาห์ 2026-10-19–2026-10-25/i)
    expect(readout).toBeDefined()
    expect(readout.getAttribute('aria-live')).toBe('polite')

    // Check panel images
    const revPanel = screen.getByRole('img', { name: 'รายรับต่อวัน' })
    const expPanel = screen.getByRole('img', { name: 'รายจ่ายต่อวัน' })
    const cashPanel = screen.getByRole('img', { name: 'เงินคงเหลือ' })
    expect(revPanel).toBeDefined()
    expect(expPanel).toBeDefined()
    expect(cashPanel).toBeDefined()
  })

  it('renders empty message when no periods provided', () => {
    render(
      <CandleChart
        periods={[]}
        visibleFrom={0}
        ma={[4, 13]}
        labelOf={p => p.key}
      />
    )
    expect(screen.getByText('ไม่มีข้อมูล')).toBeDefined()
  })
})
