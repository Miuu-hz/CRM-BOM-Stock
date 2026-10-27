import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react'
import CandleChart, { movingAverage, capFor, TrendPeriod } from './CandleChart'

type SpyFn = ReturnType<typeof vi.fn<(...args: any[]) => any>>

interface FakeSeries {
  definition: unknown
  options: unknown
  setData: SpyFn
  applyOptions: SpyFn
}

interface FakeMarkersPlugin {
  series: FakeSeries
  setMarkers: SpyFn
}

interface FakeChart {
  container: HTMLElement
  options: unknown
  series: FakeSeries[]
  rangeHandlers: Array<(range: { from: number; to: number } | null) => void>
  crosshairHandlers: Array<(param: any) => void>
  setVisibleLogicalRange: SpyFn
  fitContent: SpyFn
  priceScaleApplyOptions: SpyFn
  setCrosshairPosition: SpyFn
  clearCrosshairPosition: SpyFn
  applyOptions: SpyFn
  remove: SpyFn
}

const createdCharts: FakeChart[] = []
const createdMarkers: FakeMarkersPlugin[] = []

vi.mock('lightweight-charts', () => {
  const CandlestickSeries = { type: 'Candlestick', isBuiltIn: true, defaultOptions: {} }
  const LineSeries = { type: 'Line', isBuiltIn: true, defaultOptions: {} }
  const ColorType = { Solid: 'solid', VerticalGradient: 'gradient' }
  const CrosshairMode = { Normal: 0, Magnet: 1, Hidden: 2, MagnetOHLC: 3 }
  const LineStyle = { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 }

  const createChart = vi.fn((container: HTMLElement, options: unknown) => {
    const chart: FakeChart = {
      container,
      options,
      series: [],
      rangeHandlers: [],
      crosshairHandlers: [],
      setVisibleLogicalRange: vi.fn((range: { from: number; to: number }) => {
        chart.rangeHandlers.forEach(h => h(range))
      }),
      fitContent: vi.fn(),
      priceScaleApplyOptions: vi.fn(),
      setCrosshairPosition: vi.fn(),
      clearCrosshairPosition: vi.fn(),
      applyOptions: vi.fn(),
      remove: vi.fn(),
    }

    const api = {
      addSeries: vi.fn((definition: unknown, sOpts?: unknown) => {
        const s: FakeSeries = {
          definition,
          options: sOpts,
          setData: vi.fn(),
          applyOptions: vi.fn(),
        }
        chart.series.push(s)
        return s
      }),
      timeScale: () => ({
        subscribeVisibleLogicalRangeChange: vi.fn((fn: (r: any) => void) => {
          chart.rangeHandlers.push(fn)
        }),
        unsubscribeVisibleLogicalRangeChange: vi.fn(),
        setVisibleLogicalRange: chart.setVisibleLogicalRange,
        fitContent: chart.fitContent,
      }),
      priceScale: () => ({
        applyOptions: chart.priceScaleApplyOptions,
      }),
      subscribeCrosshairMove: vi.fn((fn: (p: any) => void) => {
        chart.crosshairHandlers.push(fn)
      }),
      unsubscribeCrosshairMove: vi.fn(),
      setCrosshairPosition: chart.setCrosshairPosition,
      clearCrosshairPosition: chart.clearCrosshairPosition,
      applyOptions: chart.applyOptions,
      remove: chart.remove,
    }

    createdCharts.push(chart)
    return api
  })

  const createSeriesMarkers = vi.fn((series: FakeSeries, initial?: unknown[]) => {
    const plugin: FakeMarkersPlugin = {
      series,
      setMarkers: vi.fn(),
    }
    if (initial && initial.length > 0) {
      plugin.setMarkers(initial)
    }
    createdMarkers.push(plugin)
    return plugin
  })

  return {
    CandlestickSeries,
    LineSeries,
    ColorType,
    CrosshairMode,
    LineStyle,
    createChart,
    createSeriesMarkers,
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
      const rows = [
        { o: 80, c: 100, h: 140, l: 70 },
        { o: 100, c: 90, h: 120, l: 80 },
      ]
      expect(capFor(rows, [])).toBe(140)
    })

    it('cuts spike wick at 1.6x the maximum body value when wicks are below 1.6x', () => {
      const rows = [
        ...Array(9).fill(0).map(() => ({ o: 80, c: 100, h: 130, l: 70 })),
        { o: 80, c: 100, h: 500, l: 70 },
      ]
      expect(capFor(rows, [])).toBe(160)
    })

    it('monthly-like bars: does not clip when most wicks are ~2.5x body max (cap >= p90)', () => {
      const rows = Array(10).fill(0).map(() => ({ o: 80, c: 100, h: 250, l: 50 }))
      const cap = capFor(rows, [])
      expect(cap).toBeGreaterThanOrEqual(250)
      expect(cap).toBe(250)
    })

    it('monthly-like bars with one extreme outlier wick: still clipped below that outlier', () => {
      const rows = [
        ...Array(9).fill(0).map(() => ({ o: 80, c: 100, h: 250, l: 50 })),
        { o: 80, c: 100, h: 1000, l: 50 },
      ]
      const cap = capFor(rows, [])
      expect(cap).toBe(250)
      expect(cap).toBeLessThan(1000)
    })

    it('considers MA values when computing threshold', () => {
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

  beforeEach(() => {
    createdCharts.length = 0
    createdMarkers.length = 0
    vi.clearAllMocks()
  })

  it('renders readout with aria-live="polite" and panel role="img"', async () => {
    render(
      <CandleChart
        periods={dummyPeriods}
        visibleFrom={0}
        ma={[4, 13]}
        labelOf={p => `สัปดาห์ ${p.from}–${p.to}`}
      />
    )

    await waitFor(() => {
      expect(createdCharts.length).toBe(3)
    })

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

  it('syncs visible logical range from chart 0 to charts 1 and 2 without looping back', async () => {
    render(
      <CandleChart
        periods={dummyPeriods}
        visibleFrom={0}
        ma={[4, 13]}
        labelOf={p => `สัปดาห์ ${p.from}–${p.to}`}
      />
    )

    await waitFor(() => {
      expect(createdCharts.length).toBe(3)
    })

    createdCharts.forEach(c => c.setVisibleLogicalRange.mockClear())

    act(() => {
      createdCharts[0].rangeHandlers[0]({ from: 2, to: 10 })
    })

    expect(createdCharts[1].setVisibleLogicalRange).toHaveBeenCalledTimes(1)
    expect(createdCharts[1].setVisibleLogicalRange).toHaveBeenCalledWith({ from: 2, to: 10 })
    expect(createdCharts[2].setVisibleLogicalRange).toHaveBeenCalledTimes(1)
    expect(createdCharts[2].setVisibleLogicalRange).toHaveBeenCalledWith({ from: 2, to: 10 })
    expect(createdCharts[0].setVisibleLogicalRange).not.toHaveBeenCalled()
  })

  it('syncs crosshair across panels and updates readout on hover and leave', async () => {
    render(
      <CandleChart
        periods={dummyPeriods}
        visibleFrom={0}
        ma={[4, 13]}
        labelOf={p => `สัปดาห์ ${p.from}–${p.to}`}
      />
    )

    await waitFor(() => {
      expect(createdCharts.length).toBe(3)
    })

    act(() => {
      createdCharts[1].crosshairHandlers[0]({
        logical: 0,
        time: '2026-10-12',
        point: { x: 1, y: 1 },
      })
    })

    expect(screen.getByText(/สัปดาห์ 2026-10-12–2026-10-18/)).toBeDefined()
    expect(createdCharts[0].setCrosshairPosition).toHaveBeenCalledWith(
      dummyPeriods[0].rev.c,
      '2026-10-12',
      createdCharts[0].series[0]
    )
    expect(createdCharts[2].setCrosshairPosition).toHaveBeenCalledWith(
      dummyPeriods[0].cash!.c,
      '2026-10-12',
      createdCharts[2].series[1]
    )
    expect(createdCharts[1].setCrosshairPosition).not.toHaveBeenCalled()

    act(() => {
      createdCharts[1].crosshairHandlers[0]({ point: undefined })
    })

    expect(screen.getByText(/สัปดาห์ 2026-10-19–2026-10-25/)).toBeDefined()
    expect(createdCharts[0].clearCrosshairPosition).toHaveBeenCalled()
    expect(createdCharts[2].clearCrosshairPosition).toHaveBeenCalled()
  })

  it('toggles MA series visibility when clicking the revenue-panel MA4 legend button', async () => {
    render(
      <CandleChart
        periods={dummyPeriods}
        visibleFrom={0}
        ma={[4, 13]}
        labelOf={p => p.key}
      />
    )

    await waitFor(() => {
      expect(createdCharts.length).toBe(3)
    })

    const revPanel = screen.getByRole('img', { name: 'รายรับต่อวัน' }).parentElement!
    const ma4Btn = within(revPanel).getByRole('button', { name: 'MA4' })
    expect(ma4Btn.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(ma4Btn)

    expect(ma4Btn.getAttribute('aria-pressed')).toBe('false')
    const revMaASeries = createdCharts[0].series[1]
    expect(revMaASeries.applyOptions).toHaveBeenCalledWith({ visible: false })
  })

  it('applies the last-2-bars logical range on all three charts when clicking รีเซ็ตมุมมอง with bars={2} on 4 drawn bars', async () => {
    const fourPeriods: TrendPeriod[] = [0, 1, 2, 3].map(i => ({
      key: `2026-10-0${i + 1}`,
      from: `2026-10-0${i + 1}`,
      to: `2026-10-0${i + 1}`,
      days: 7,
      rev: { o: 5000, c: 6000, h: 7000, l: 4500, tot: 42000 },
      exp: { o: 3000, c: 3500, h: 4000, l: 2800, tot: 24500 },
      cash: { c: 120000, hi: 130000, lo: 115000 },
    }))

    render(
      <CandleChart
        periods={fourPeriods}
        visibleFrom={0}
        ma={[4, 13]}
        bars={2}
        labelOf={p => p.key}
      />
    )

    await waitFor(() => {
      expect(createdCharts.length).toBe(3)
    })

    // Simulate user panning away, then clicking reset
    createdCharts.forEach(c => {
      c.setVisibleLogicalRange.mockClear()
      c.priceScaleApplyOptions.mockClear()
    })

    const resetBtn = screen.getByRole('button', { name: 'รีเซ็ตมุมมอง' })
    fireEvent.click(resetBtn)

    createdCharts.forEach(c => {
      expect(c.priceScaleApplyOptions).toHaveBeenCalledWith({ autoScale: true })
      expect(c.setVisibleLogicalRange).toHaveBeenCalledTimes(1)
      expect(c.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 1.5, to: 3.5 })
    })
  })

  it('clips extreme revenue spike high in series data, adds one arrowUp marker, and shows real high in OHLC readout on hover', async () => {
    const tenPeriods: TrendPeriod[] = Array.from({ length: 10 }, (_, i) => {
      const day = String(i + 10).padStart(2, '0')
      const isSpike = i === 4
      return {
        key: `2026-10-${day}`,
        from: `2026-10-${day}`,
        to: `2026-10-${day}`,
        days: 7,
        rev: {
          o: 5000,
          c: 6000,
          h: isSpike ? 50000 : 7000,
          l: 4500,
          tot: 42000,
        },
        exp: { o: 3000, c: 3500, h: 4000, l: 2800, tot: 24500 },
        cash: { c: 120000, hi: 130000, lo: 115000 },
      }
    })

    render(
      <CandleChart
        periods={tenPeriods}
        visibleFrom={0}
        ma={[4, 13]}
        labelOf={p => p.key}
      />
    )

    await waitFor(() => {
      expect(createdCharts.length).toBe(3)
    })

    const revCandleSeries = createdCharts[0].series[0]
    expect(revCandleSeries.setData).toHaveBeenCalled()
    const dataCalls = revCandleSeries.setData.mock.calls
    const lastDataCall = dataCalls[dataCalls.length - 1][0] as Array<{
      time: string
      open: number
      high: number
      low: number
      close: number
    }>
    expect(lastDataCall).toHaveLength(10)
    // Spike at index 4 is clipped below real h (50000): 1.6 * 6000 = 9600
    expect(lastDataCall[4].high).toBeLessThan(50000)
    expect(lastDataCall[4].high).toBe(9600)

    const revMarkersPlugin = createdMarkers[0]
    expect(revMarkersPlugin.setMarkers).toHaveBeenCalled()
    const markerCalls = revMarkersPlugin.setMarkers.mock.calls
    const markersArg = markerCalls[markerCalls.length - 1][0] as Array<{
      time: string
      position: string
      shape: string
      size: number
    }>
    expect(markersArg).toHaveLength(1)
    expect(markersArg[0].time).toBe('2026-10-14')
    expect(markersArg[0].position).toBe('aboveBar')
    expect(markersArg[0].shape).toBe('arrowUp')
    expect(markersArg[0].size).toBe(0.5)

    // Hover the spike bar (index 4) and verify real high (฿50,000) appears in revenue OHLC line
    act(() => {
      createdCharts[0].crosshairHandlers[0]({
        logical: 4,
        time: '2026-10-14',
        point: { x: 50, y: 50 },
      })
    })

    const revPanel = screen.getByRole('img', { name: 'รายรับต่อวัน' }).parentElement!
    expect(revPanel.textContent).toContain('สูง ฿50,000')
  })
})
