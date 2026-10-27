import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import type {
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  Time,
  LogicalRange,
  MouseEventParams,
} from 'lightweight-charts'

export interface Candle {
  /** เปิด = ค่าเฉลี่ยต่อวันของงวดก่อน (งวดแรก = ของตัวเอง) */
  o: number
  /** ปิด = ค่าเฉลี่ยต่อวันของงวดนี้ */
  c: number
  /** max(o, c, วันสูงสุด) */
  h: number
  /** min(o, c, วันต่ำสุด) */
  l: number
  /** ยอดรวมทั้งงวด (บาท) */
  tot: number
}

export interface TrendPeriod {
  key: string
  from: string
  to: string
  /** จำนวนวันที่มีในงวด (งวดแรก/งวดปัจจุบันอาจไม่เต็ม) */
  days: number
  partial?: boolean
  rev: Candle
  exp: Candle
  /** เงินคงเหลือ: c = สิ้นงวด, hi/lo = สูงสุด/ต่ำสุดระหว่างงวด · null = ไม่มีบัญชีเงิน */
  cash: { c: number; hi: number; lo: number } | null
}

export interface CandleChartProps {
  /** รวมงวด warm-up ไว้หน้าสุด (ใช้คิดเส้นค่าเฉลี่ยเท่านั้น ไม่วาด) */
  periods: TrendPeriod[]
  /** index แรกที่วาด (ก่อนหน้านี้คือ warm-up) */
  visibleFrom?: number
  /** คู่เส้นค่าเฉลี่ยของค่าปิด เช่น [4, 13] รายสัปดาห์ · [3, 12] รายเดือน · [2, 4] รายไตรมาส */
  ma: [number, number]
  /** ป้ายแกน x / readout ของงวด */
  labelOf: (p: TrendPeriod) => string
  /** จำนวนแท่งล่าสุดที่แสดงตอนเริ่มและหลังกดรีเซ็ต (ไม่ส่งหรือ >= จำนวนแท่งที่วาด = แสดงทั้งหมด) */
  bars?: number
}

/** ค่าเฉลี่ยเคลื่อนที่ n งวด — จุดที่ข้อมูลไม่ถึง n งวด = null (ไม่วาดเส้นจากข้อมูลไม่พอ) */
export function movingAverage(vals: number[], n: number): Array<number | null> {
  return vals.map((_, i) => (i < n - 1 ? null : vals.slice(i - n + 1, i + 1).reduce((s, x) => s + x, 0) / n))
}

/**
 * คำนวณขีดจำกัดความสูงของแท่งเทียน (Wick cap)
 * min(max wick, max(1.6 × max(visible bodies' max(o,c) and MA values), p90 of upper wicks r.h))
 * โดย p90 คิดจาก nearest-rank ของค่า r.h ที่เรียงลำดับแล้ว
 */
export function capFor(
  rows: Array<{ o: number; c: number; h: number; l?: number }>,
  maVals: Array<number | null> = []
): number {
  if (!rows || rows.length === 0) return 0
  const maxWick = Math.max(...rows.map(r => r.h))
  const validMa = maVals.filter((v): v is number => v !== null && !isNaN(v))
  const bodiesAndMa = [
    ...rows.map(r => Math.max(r.o, r.c)),
    ...validMa,
  ]
  const maxBodyOrMa = bodiesAndMa.length > 0 ? Math.max(...bodiesAndMa) : 0
  const threshold = 1.6 * maxBodyOrMa

  const sortedH = rows.map(r => r.h).sort((a, b) => a - b)
  const p90Idx = Math.min(sortedH.length - 1, Math.max(0, Math.ceil(0.9 * sortedH.length) - 1))
  const p90 = sortedH[p90Idx]

  return Math.min(maxWick, Math.max(threshold, p90))
}

const baht = (v: number) => {
  const sign = v < 0 ? '−' : ''
  return `${sign}฿${Math.round(Math.abs(v)).toLocaleString('th-TH')}`
}

const kfmt = (v: number) => {
  const a = Math.abs(v)
  const s = v < 0 ? '−' : ''
  if (a >= 1e6) return `${s}฿${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${s}฿${Math.round(a / 1e3)}K`
  return `${s}฿${Math.round(a)}`
}

const chgPct = (c: number, o: number) => {
  if (!o || o === 0) return '+0%'
  const d = c / o - 1
  const s = d >= 0 ? '+' : '−'
  return `${s}${Math.round(Math.abs(d) * 100)}%`
}

function timeToKey(t: Time): string {
  if (typeof t === 'string') return t.slice(0, 10)
  if (typeof t === 'number') return new Date(t * 1000).toISOString().slice(0, 10)
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`
}

interface ResolvedColors {
  up: string
  dn: string
  expUp: string
  expDn: string
  fg1: string
  fg3: string
  border: string
  primary: string
  primarySoft: string
}

function readToken(probe: HTMLElement | null, token: string): string {
  if (probe && typeof getComputedStyle === 'function') {
    probe.style.color = ''
    probe.style.color = `var(${token})`
    const val = getComputedStyle(probe).color?.trim()
    if (val && !val.startsWith('var(')) return val
  }
  return '#888888'
}

function resolveColors(probe: HTMLElement | null): ResolvedColors {
  return {
    up: readToken(probe, '--up'),
    dn: readToken(probe, '--dn'),
    expUp: readToken(probe, '--exp-up'),
    expDn: readToken(probe, '--exp-dn'),
    fg1: readToken(probe, '--fg-1'),
    fg3: readToken(probe, '--fg-3'),
    border: readToken(probe, '--border'),
    primary: readToken(probe, '--primary'),
    primarySoft: readToken(probe, '--primary-soft'),
  }
}

interface MaVisibility {
  revA: boolean
  revB: boolean
  expA: boolean
  expB: boolean
}

interface ChartBundle {
  charts: [IChartApi, IChartApi, IChartApi]
  revMain: ISeriesApi<'Candlestick'>
  revMaA: ISeriesApi<'Line'>
  revMaB: ISeriesApi<'Line'>
  revMarkers: ISeriesMarkersPluginApi<Time>
  expMain: ISeriesApi<'Candlestick'>
  expMaA: ISeriesApi<'Line'>
  expMaB: ISeriesApi<'Line'>
  expMarkers: ISeriesMarkersPluginApi<Time>
  cashBand: ISeriesApi<'Candlestick'>
  cashMain: ISeriesApi<'Line'>
  colors: ResolvedColors
  lastRevCap: number | null
  lastExpCap: number | null
  currentRange: { from: number; to: number } | null
  syncingRange: boolean
  syncingCrosshair: boolean
}

export default function CandleChart({ periods, visibleFrom = 0, ma, labelOf, bars }: CandleChartProps) {
  const visiblePeriods = useMemo(() => periods.slice(visibleFrom), [periods, visibleFrom])
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [maVis, setMaVis] = useState<MaVisibility>({
    revA: true,
    revB: true,
    expA: true,
    expB: true,
  })

  // คำนวณเส้น MA จากชุดข้อมูลทั้งหมด (รวม warm-up) แล้วตัดเฉพาะช่วง visible
  const maCalculations = useMemo(() => {
    const revCloses = periods.map(p => p.rev.c)
    const expCloses = periods.map(p => p.exp.c)
    const rA = movingAverage(revCloses, ma[0]).slice(visibleFrom)
    const rB = movingAverage(revCloses, ma[1]).slice(visibleFrom)
    const eA = movingAverage(expCloses, ma[0]).slice(visibleFrom)
    const eB = movingAverage(expCloses, ma[1]).slice(visibleFrom)
    return { rA, rB, eA, eB }
  }, [periods, visibleFrom, ma])

  const periodMap = useMemo(() => {
    const map = new Map<string, { period: TrendPeriod; index: number }>()
    visiblePeriods.forEach((p, index) => {
      map.set(p.from.slice(0, 10), { period: p, index })
    })
    return map
  }, [visiblePeriods])

  const probeRef = useRef<HTMLSpanElement | null>(null)
  const revContainerRef = useRef<HTMLDivElement | null>(null)
  const expContainerRef = useRef<HTMLDivElement | null>(null)
  const cashContainerRef = useRef<HTMLDivElement | null>(null)
  const bundleRef = useRef<ChartBundle | null>(null)
  const appliedViewKeyRef = useRef<string | null>(null)

  const latestRef = useRef({
    visiblePeriods,
    maCalculations,
    periodMap,
    bars,
    labelOf,
    maVis,
  })
  latestRef.current = {
    visiblePeriods,
    maCalculations,
    periodMap,
    bars,
    labelOf,
    maVis,
  }

  const updateWickCaps = useCallback(
    (bundle: ChartBundle, range: { from: number; to: number } | null, force: boolean) => {
      const { visiblePeriods: drawn, maCalculations: maCalc } = latestRef.current
      const n = drawn.length
      if (n === 0) return

      let startIdx = 0
      let endIdx = n - 1
      if (range) {
        const s = Math.max(0, Math.round(range.from))
        const e = Math.min(n - 1, Math.floor(range.to))
        if (e >= s) {
          startIdx = s
          endIdx = e
        }
      }

      const visSlice = drawn.slice(startIdx, endIdx + 1)
      const revCap = capFor(
        visSlice.map(p => p.rev),
        [...maCalc.rA.slice(startIdx, endIdx + 1), ...maCalc.rB.slice(startIdx, endIdx + 1)]
      )
      const expCap = capFor(
        visSlice.map(p => p.exp),
        [...maCalc.eA.slice(startIdx, endIdx + 1), ...maCalc.eB.slice(startIdx, endIdx + 1)]
      )

      if (force || revCap !== bundle.lastRevCap) {
        bundle.lastRevCap = revCap
        bundle.revMain.setData(
          drawn.map(p => ({
            time: p.from.slice(0, 10) as Time,
            open: p.rev.o,
            high: Math.min(p.rev.h, revCap),
            low: p.rev.l,
            close: p.rev.c,
          }))
        )
        bundle.revMarkers.setMarkers(
          drawn
            .filter(p => p.rev.h > revCap)
            .map(p => ({
              time: p.from.slice(0, 10) as Time,
              position: 'aboveBar' as const,
              shape: 'arrowUp' as const,
              size: 0.5,
              color: p.rev.c >= p.rev.o ? bundle.colors.up : bundle.colors.dn,
            }))
        )
      }

      if (force || expCap !== bundle.lastExpCap) {
        bundle.lastExpCap = expCap
        bundle.expMain.setData(
          drawn.map(p => ({
            time: p.from.slice(0, 10) as Time,
            open: p.exp.o,
            high: Math.min(p.exp.h, expCap),
            low: p.exp.l,
            close: p.exp.c,
          }))
        )
        bundle.expMarkers.setMarkers(
          drawn
            .filter(p => p.exp.h > expCap)
            .map(p => ({
              time: p.from.slice(0, 10) as Time,
              position: 'aboveBar' as const,
              shape: 'arrowUp' as const,
              size: 0.5,
              color: p.exp.c >= p.exp.o ? bundle.colors.expUp : bundle.colors.expDn,
            }))
        )
      }
    },
    []
  )

  const applyResetView = useCallback(() => {
    const bundle = bundleRef.current
    const { visiblePeriods: drawn, bars: b } = latestRef.current
    if (!bundle || drawn.length === 0) return
    const n = drawn.length
    const targetRange: { from: number; to: number } | null =
      b !== undefined && b > 0 && b < n ? { from: n - b - 0.5, to: n - 0.5 } : null

    bundle.syncingRange = true
    try {
      bundle.currentRange = targetRange
      updateWickCaps(bundle, targetRange, false)
      for (const c of bundle.charts) {
        c.priceScale('right').applyOptions({ autoScale: true })
        if (targetRange) {
          c.timeScale().setVisibleLogicalRange(targetRange as LogicalRange)
        } else {
          c.timeScale().fitContent()
        }
      }
    } finally {
      bundle.syncingRange = false
    }
  }, [updateWickCaps])

  const syncSeriesData = useCallback(
    (bundle: ChartBundle) => {
      const { visiblePeriods: drawn, maCalculations: maCalc, bars: b } = latestRef.current
      if (drawn.length === 0) return

      const toLinePoint = (p: TrendPeriod, val: number | null) => {
        const time = p.from.slice(0, 10) as Time
        return val === null ? { time } : { time, value: val }
      }

      bundle.revMaA.setData(drawn.map((p, i) => toLinePoint(p, maCalc.rA[i])))
      bundle.revMaB.setData(drawn.map((p, i) => toLinePoint(p, maCalc.rB[i])))
      bundle.expMaA.setData(drawn.map((p, i) => toLinePoint(p, maCalc.eA[i])))
      bundle.expMaB.setData(drawn.map((p, i) => toLinePoint(p, maCalc.eB[i])))

      bundle.cashBand.setData(
        drawn.map(p => {
          const time = p.from.slice(0, 10) as Time
          return p.cash === null
            ? { time }
            : { time, open: p.cash.lo, close: p.cash.hi, high: p.cash.hi, low: p.cash.lo }
        })
      )
      bundle.cashMain.setData(
        drawn.map(p => {
          const time = p.from.slice(0, 10) as Time
          return p.cash === null ? { time } : { time, value: p.cash.c }
        })
      )

      const viewKey = `${b ?? 'all'}:${drawn.length}`
      const shouldApplyView = appliedViewKeyRef.current !== viewKey
      const n = drawn.length
      const targetRange: { from: number; to: number } | null = shouldApplyView
        ? b !== undefined && b > 0 && b < n
          ? { from: n - b - 0.5, to: n - 0.5 }
          : null
        : bundle.currentRange

      bundle.currentRange = targetRange
      updateWickCaps(bundle, targetRange, true)

      if (shouldApplyView) {
        appliedViewKeyRef.current = viewKey
        applyResetView()
      }
    },
    [updateWickCaps, applyResetView]
  )

  const hasData = visiblePeriods.length > 0

  // สร้างกราฟครั้งเดียวเมื่อ container mount และมีข้อมูล
  useEffect(() => {
    if (!hasData) return
    let cancelled = false
    const cleanups: Array<() => void> = []

    import('lightweight-charts').then(lwc => {
      if (cancelled) return
      const revEl = revContainerRef.current
      const expEl = expContainerRef.current
      const cashEl = cashContainerRef.current
      if (!revEl || !expEl || !cashEl) return

      const tickMarkFormatter = (time: Time, tickMarkType: number) => {
        const key = timeToKey(time)
        const d = new Date(`${key}T00:00:00`)
        if (isNaN(d.getTime())) return key
        if (tickMarkType === 0) return d.toLocaleDateString('th-TH', { year: 'numeric' }).replace(/^พ\.ศ\.\s*/, '')
        if (tickMarkType === 1) return d.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' })
        return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
      }

      const timeFormatter = (time: Time) => {
        const key = timeToKey(time)
        const found = latestRef.current.periodMap.get(key)
        return found ? latestRef.current.labelOf(found.period) : key
      }

      const makeChartOptions = (showTimeAxis: boolean, isCash: boolean) => ({
        autoSize: true,
        layout: {
          background: { type: lwc.ColorType.Solid, color: 'transparent' },
          attributionLogo: false,
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { visible: true },
        },
        rightPriceScale: {
          minimumWidth: 72,
          autoScale: true,
        },
        timeScale: {
          visible: showTimeAxis,
          fixLeftEdge: true,
          fixRightEdge: true,
          tickMarkFormatter,
        },
        crosshair: {
          mode: lwc.CrosshairMode.Normal,
          vertLine: { style: lwc.LineStyle.Dashed },
          horzLine: { style: lwc.LineStyle.Dashed },
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
        handleScale: {
          mouseWheel: true,
          pinch: true,
          axisPressedMouseMove: true,
          axisDoubleClickReset: true,
        },
        localization: {
          priceFormatter: isCash ? (v: number) => kfmt(v) : (v: number) => `${kfmt(v)}/ว`,
          timeFormatter,
        },
      })

      const revChart = lwc.createChart(revEl, makeChartOptions(false, false))
      const expChart = lwc.createChart(expEl, makeChartOptions(false, false))
      const cashChart = lwc.createChart(cashEl, makeChartOptions(true, true))

      const curMaVis = latestRef.current.maVis
      const maOpts = (lineStyle: number, visible: boolean) => ({
        lineWidth: 2 as const,
        lineStyle,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        visible,
      })

      const revMain = revChart.addSeries(lwc.CandlestickSeries, { priceLineVisible: false, lastValueVisible: true })
      const revMaA = revChart.addSeries(lwc.LineSeries, maOpts(lwc.LineStyle.Solid, curMaVis.revA))
      const revMaB = revChart.addSeries(lwc.LineSeries, maOpts(lwc.LineStyle.Dashed, curMaVis.revB))
      // ponytail: ลูกศรไส้ถูกตัดวาดในขอบบน 20% ของสเกล ไม่ให้ขยายสเกล (ค่าเริ่ม autoScale ดันแท่งลงไปครึ่งล่างของแผง 150px)
      const revMarkers = lwc.createSeriesMarkers(revMain, [], { autoScale: false })

      const expMain = expChart.addSeries(lwc.CandlestickSeries, { priceLineVisible: false, lastValueVisible: true })
      const expMaA = expChart.addSeries(lwc.LineSeries, maOpts(lwc.LineStyle.Solid, curMaVis.expA))
      const expMaB = expChart.addSeries(lwc.LineSeries, maOpts(lwc.LineStyle.Dashed, curMaVis.expB))
      const expMarkers = lwc.createSeriesMarkers(expMain, [], { autoScale: false })

      const cashBand = cashChart.addSeries(lwc.CandlestickSeries, {
        borderVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      })
      const cashMain = cashChart.addSeries(lwc.LineSeries, {
        lineWidth: 2,
        lineStyle: lwc.LineStyle.Solid,
        lastValueVisible: true,
        priceLineVisible: false,
      })

      const charts: [IChartApi, IChartApi, IChartApi] = [revChart, expChart, cashChart]
      const mainSeries = [revMain, expMain, cashMain] as const

      const bundle: ChartBundle = {
        charts,
        revMain,
        revMaA,
        revMaB,
        revMarkers,
        expMain,
        expMaA,
        expMaB,
        expMarkers,
        cashBand,
        cashMain,
        colors: resolveColors(probeRef.current),
        lastRevCap: null,
        lastExpCap: null,
        currentRange: null,
        syncingRange: false,
        syncingCrosshair: false,
      }
      bundleRef.current = bundle
      appliedViewKeyRef.current = null

      const paint = (c: ResolvedColors) => {
        bundle.colors = c
        charts.forEach(ch => {
          ch.applyOptions({
            layout: { textColor: c.fg3 },
            grid: { horzLines: { color: c.border } },
            rightPriceScale: { borderColor: c.border },
            timeScale: { borderColor: c.border },
            crosshair: {
              vertLine: { color: c.fg3, labelBackgroundColor: c.fg1 },
              horzLine: { color: c.fg3, labelBackgroundColor: c.fg1 },
            },
          })
        })
        revMain.applyOptions({
          upColor: c.up,
          downColor: c.dn,
          borderUpColor: c.up,
          borderDownColor: c.dn,
          wickUpColor: c.up,
          wickDownColor: c.dn,
        })
        revMaA.applyOptions({ color: c.fg1 })
        revMaB.applyOptions({ color: c.fg3 })
        expMain.applyOptions({
          upColor: c.expUp,
          downColor: c.expDn,
          borderUpColor: c.expUp,
          borderDownColor: c.expDn,
          wickUpColor: c.expUp,
          wickDownColor: c.expDn,
        })
        expMaA.applyOptions({ color: c.fg1 })
        expMaB.applyOptions({ color: c.fg3 })
        cashBand.applyOptions({
          upColor: c.primarySoft,
          downColor: c.primarySoft,
          borderColor: c.primarySoft,
          borderUpColor: c.primarySoft,
          borderDownColor: c.primarySoft,
          wickUpColor: c.primarySoft,
          wickDownColor: c.primarySoft,
        })
        cashMain.applyOptions({ color: c.primary })
        updateWickCaps(bundle, bundle.currentRange, true)
      }

      paint(bundle.colors)

      charts.forEach((chart, idx) => {
        const onRangeChange = (range: LogicalRange | null) => {
          if (!range || bundle.syncingRange) return
          bundle.syncingRange = true
          try {
            bundle.currentRange = { from: range.from, to: range.to }
            charts.forEach((other, j) => {
              if (j !== idx) {
                other.timeScale().setVisibleLogicalRange(range)
              }
            })
            updateWickCaps(bundle, bundle.currentRange, false)
          } finally {
            bundle.syncingRange = false
          }
        }

        const onCrosshairMove = (param: MouseEventParams<Time>) => {
          if (bundle.syncingCrosshair) return
          bundle.syncingCrosshair = true
          try {
            const drawn = latestRef.current.visiblePeriods
            const hasPos =
              Boolean(param && param.point) &&
              (typeof param.logical === 'number' || param.time !== undefined) &&
              drawn.length > 0

            if (!hasPos) {
              charts.forEach((other, j) => {
                if (j !== idx) other.clearCrosshairPosition()
              })
              setHoverIndex(null)
              return
            }

            let barIdx = drawn.length - 1
            if (typeof param.logical === 'number') {
              barIdx = Math.max(0, Math.min(drawn.length - 1, Math.round(param.logical)))
            } else if (param.time !== undefined) {
              const found = latestRef.current.periodMap.get(timeToKey(param.time))
              if (found) barIdx = found.index
            }

            const bar = drawn[barIdx]
            const barTime = bar.from.slice(0, 10) as Time
            setHoverIndex(barIdx)

            charts.forEach((other, j) => {
              if (j === idx) return
              const val = j === 0 ? bar.rev.c : j === 1 ? bar.exp.c : bar.cash ? bar.cash.c : null
              if (val !== null) {
                other.setCrosshairPosition(val, barTime, mainSeries[j])
              } else {
                other.clearCrosshairPosition()
              }
            })
          } finally {
            bundle.syncingCrosshair = false
          }
        }

        chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange)
        chart.subscribeCrosshairMove(onCrosshairMove)
        cleanups.push(() => {
          chart.timeScale().unsubscribeVisibleLogicalRangeChange?.(onRangeChange)
          chart.unsubscribeCrosshairMove?.(onCrosshairMove)
        })
      })

      if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
        const observer = new MutationObserver(() => paint(resolveColors(probeRef.current)))
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-theme'],
        })
        cleanups.push(() => observer.disconnect())
      }

      syncSeriesData(bundle)
    })

    return () => {
      cancelled = true
      cleanups.forEach(fn => fn())
      if (bundleRef.current) {
        bundleRef.current.charts.forEach(c => c.remove())
        bundleRef.current = null
      }
      appliedViewKeyRef.current = null
    }
  }, [hasData, syncSeriesData, updateWickCaps])

  // อัปเดตข้อมูลเมื่อ periods / visibleFrom / ma / bars เปลี่ยน โดยไม่ทำลายกราฟเดิม
  useEffect(() => {
    const bundle = bundleRef.current
    if (!bundle || visiblePeriods.length === 0) return
    syncSeriesData(bundle)
  }, [visiblePeriods, maCalculations, bars, syncSeriesData])

  const toggleMa = (key: keyof MaVisibility) => {
    const next = !maVis[key]
    setMaVis(prev => ({ ...prev, [key]: next }))
    const bundle = bundleRef.current
    if (bundle) {
      const target =
        key === 'revA'
          ? bundle.revMaA
          : key === 'revB'
          ? bundle.revMaB
          : key === 'expA'
          ? bundle.expMaA
          : bundle.expMaB
      target.applyOptions({ visible: next })
    }
  }

  if (visiblePeriods.length === 0) {
    return <div className="text-center py-8 text-xs text-[var(--fg-4)]">ไม่มีข้อมูล</div>
  }

  // แถบสรุปตัวเลขด้านบน: ตอนเอาเมาส์ออกจะแสดงงวดล่าสุดเสมอ
  const activeIndex =
    hoverIndex !== null && hoverIndex >= 0 && hoverIndex < visiblePeriods.length
      ? hoverIndex
      : visiblePeriods.length - 1
  const activePeriod = visiblePeriods[activeIndex]

  const revStr = `รายรับ ${baht(activePeriod.rev.c)}/วัน (${chgPct(activePeriod.rev.c, activePeriod.rev.o)})`
  const expStr = `รายจ่าย ${baht(activePeriod.exp.c)}/วัน (${chgPct(activePeriod.exp.c, activePeriod.exp.o)})`
  const cashStr = activePeriod.cash
    ? `เงินคงเหลือ ${baht(activePeriod.cash.c)} (ต่ำสุด ${baht(activePeriod.cash.lo)})`
    : 'เงินคงเหลือ —'
  const readoutText = `${labelOf(activePeriod)} · ${revStr} · ${expStr} · ${cashStr}`

  const activeRevMaA = maCalculations.rA[activeIndex] ?? null
  const activeRevMaB = maCalculations.rB[activeIndex] ?? null
  const activeExpMaA = maCalculations.eA[activeIndex] ?? null
  const activeExpMaB = maCalculations.eB[activeIndex] ?? null

  const revOhlc = `เปิด ${baht(activePeriod.rev.o)} สูง ${baht(activePeriod.rev.h)} ต่ำ ${baht(activePeriod.rev.l)} ปิด ${baht(activePeriod.rev.c)} · MA${ma[0]} ${activeRevMaA !== null ? baht(activeRevMaA) : '—'} · MA${ma[1]} ${activeRevMaB !== null ? baht(activeRevMaB) : '—'}`
  const expOhlc = `เปิด ${baht(activePeriod.exp.o)} สูง ${baht(activePeriod.exp.h)} ต่ำ ${baht(activePeriod.exp.l)} ปิด ${baht(activePeriod.exp.c)} · MA${ma[0]} ${activeExpMaA !== null ? baht(activeExpMaA) : '—'} · MA${ma[1]} ${activeExpMaB !== null ? baht(activeExpMaB) : '—'}`
  const cashOhlc = activePeriod.cash
    ? `สิ้นงวด ${baht(activePeriod.cash.c)} สูงสุด ${baht(activePeriod.cash.hi)} ต่ำสุด ${baht(activePeriod.cash.lo)}`
    : 'สิ้นงวด — สูงสุด — ต่ำสุด —'

  return (
    <div className="space-y-3">
      <span ref={probeRef} className="hidden" aria-hidden="true" />

      {/* Readout bar + Reset controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="readout text-xs sm:text-sm text-[var(--fg-2)] tabular-nums" aria-live="polite">
          {readoutText}
        </div>
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <span className="text-[11px] text-[var(--fg-4)]">
            ลากเพื่อเลื่อน · ล้อเมาส์หรือสองนิ้วเพื่อซูม · ดับเบิลคลิกเพื่อรีเซ็ต
          </span>
          <button
            type="button"
            onClick={applyResetView}
            className="px-2 py-0.5 text-xs rounded border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-2)] hover:text-[var(--fg-1)] cursor-pointer transition-colors"
          >
            รีเซ็ตมุมมอง
          </button>
        </div>
      </div>

      {/* แผง 1: รายรับ */}
      <div className="panel">
        <div className="flex flex-wrap items-baseline gap-2 sm:gap-3 text-xs mb-1">
          <span className="font-bold text-[var(--fg-1)] text-sm">รายรับ</span>
          <span className="text-[var(--fg-3)] tabular-nums text-[11px] sm:text-xs">
            {revOhlc}
          </span>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[var(--fg-3)] ml-auto text-xs">
            <span className="inline-flex items-center gap-1.5">
              <i className="w-2.5 h-3 rounded-[2px] inline-block" style={{ background: 'var(--up)' }} />
              เพิ่มจากงวดก่อน
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="w-2.5 h-3 rounded-[2px] inline-block" style={{ background: 'var(--dn)' }} />
              ลดลง
            </span>
            <button
              type="button"
              aria-pressed={maVis.revA}
              onClick={() => toggleMa('revA')}
              className={`inline-flex items-center gap-1.5 cursor-pointer transition-opacity ${
                maVis.revA ? '' : 'opacity-40 line-through'
              }`}
            >
              <i className="w-3.5 h-[3px] rounded-full inline-block" style={{ background: 'var(--fg-1)' }} />
              MA{ma[0]}
            </button>
            <button
              type="button"
              aria-pressed={maVis.revB}
              onClick={() => toggleMa('revB')}
              className={`inline-flex items-center gap-1.5 cursor-pointer transition-opacity ${
                maVis.revB ? '' : 'opacity-40 line-through'
              }`}
            >
              <i className="w-3.5 h-[3px] rounded-full inline-block border-b-2 border-dashed border-[var(--fg-3)]" />
              MA{ma[1]}
            </button>
          </div>
        </div>
        <div
          ref={revContainerRef}
          role="img"
          aria-label="รายรับต่อวัน"
          onDoubleClick={applyResetView}
          className="h-[150px] w-full overflow-hidden"
        />
      </div>

      {/* แผง 2: รายจ่าย */}
      <div className="panel">
        <div className="flex flex-wrap items-baseline gap-2 sm:gap-3 text-xs mb-1">
          <span className="font-bold text-[var(--fg-1)] text-sm">รายจ่าย</span>
          <span className="text-[var(--fg-3)] tabular-nums text-[11px] sm:text-xs">
            {expOhlc}
          </span>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[var(--fg-3)] ml-auto text-xs">
            <span className="inline-flex items-center gap-1.5">
              <i className="w-2.5 h-3 rounded-[2px] inline-block" style={{ background: 'var(--exp-up)' }} />
              เพิ่มจากงวดก่อน (ต้องระวัง)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="w-2.5 h-3 rounded-[2px] inline-block" style={{ background: 'var(--exp-dn)' }} />
              ลดลง
            </span>
            <button
              type="button"
              aria-pressed={maVis.expA}
              onClick={() => toggleMa('expA')}
              className={`inline-flex items-center gap-1.5 cursor-pointer transition-opacity ${
                maVis.expA ? '' : 'opacity-40 line-through'
              }`}
            >
              <i className="w-3.5 h-[3px] rounded-full inline-block" style={{ background: 'var(--fg-1)' }} />
              MA{ma[0]}
            </button>
            <button
              type="button"
              aria-pressed={maVis.expB}
              onClick={() => toggleMa('expB')}
              className={`inline-flex items-center gap-1.5 cursor-pointer transition-opacity ${
                maVis.expB ? '' : 'opacity-40 line-through'
              }`}
            >
              <i className="w-3.5 h-[3px] rounded-full inline-block border-b-2 border-dashed border-[var(--fg-3)]" />
              MA{ma[1]}
            </button>
          </div>
        </div>
        <div
          ref={expContainerRef}
          role="img"
          aria-label="รายจ่ายต่อวัน"
          onDoubleClick={applyResetView}
          className="h-[150px] w-full overflow-hidden"
        />
      </div>

      {/* แผง 3: เงินคงเหลือ */}
      <div className="panel">
        <div className="flex flex-wrap items-baseline gap-2 sm:gap-3 text-xs mb-1">
          <span className="font-bold text-[var(--fg-1)] text-sm">เงินคงเหลือ</span>
          <span className="text-[var(--fg-3)] tabular-nums text-[11px] sm:text-xs">
            {cashOhlc}
          </span>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[var(--fg-3)] ml-auto text-xs">
            <span className="inline-flex items-center gap-1.5">
              <i className="w-3.5 h-[3px] rounded-full inline-block" style={{ background: 'var(--primary)' }} />
              สิ้นงวด
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="w-2.5 h-3 rounded-[2px] inline-block" style={{ background: 'var(--primary-soft)' }} />
              ช่วงต่ำสุด–สูงสุดในงวด
            </span>
          </div>
        </div>
        <div
          ref={cashContainerRef}
          role="img"
          aria-label="เงินคงเหลือ"
          onDoubleClick={applyResetView}
          className="h-[160px] w-full overflow-hidden"
        />
        <div className="text-[10px] text-[var(--fg-4)] mt-1">
          <a
            href="https://www.tradingview.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            TradingView Lightweight Charts™
          </a>{' '}
          Copyright (c) 2025 TradingView, Inc.
        </div>
      </div>
    </div>
  )
}
