import { useState, useMemo } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts'

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

/** คำนวณช่วงสเกลแกน Y ที่ลงตัว (nice step) */
export function niceScale(lo: number, hi: number, n = 3): { min: number; max: number; step: number } {
  if (lo === hi) {
    const val = lo === 0 ? 100 : Math.abs(lo)
    return { min: Math.max(0, lo - val), max: hi + val, step: val }
  }
  const minVal = Math.min(lo, hi)
  const maxVal = Math.max(lo, hi)
  const raw = (maxVal - minVal) / n || 1
  const p = 10 ** Math.floor(Math.log10(raw))
  const f = raw / p
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p
  return {
    min: Math.floor(minVal / step) * step,
    max: Math.ceil(maxVal / step) * step,
    step,
  }
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

interface ChartItem {
  index: number
  key: string
  label: string
  period: TrendPeriod
  rev: Candle
  revRange: [number, number]
  revMaA: number | null
  revMaB: number | null
  exp: Candle
  expRange: [number, number]
  expMaA: number | null
  expMaB: number | null
  cash: { c: number; hi: number; lo: number } | null
  cashRange: [number, number] | null
  cashC: number | null
}

function CandleBar(props: any) {
  const { x, width, payload, panelType, yDomain, topEdge = 10, plotHeight = 134 } = props
  if (!payload || x === undefined || width === undefined) return null
  const candle: Candle = panelType === 'rev' ? payload.rev : payload.exp
  if (!candle) return null

  const isUp = candle.c >= candle.o
  const color = panelType === 'rev'
    ? (isUp ? 'var(--up)' : 'var(--dn)')
    : (isUp ? 'var(--exp-up)' : 'var(--exp-dn)')

  const [yMin, yMax] = yDomain
  const yFn = (v: number) => {
    if (props.yAxis && typeof props.yAxis.scale === 'function') {
      return props.yAxis.scale(v)
    }
    if (yMax <= yMin) return topEdge + plotHeight / 2
    return topEdge + plotHeight * (1 - (v - yMin) / (yMax - yMin))
  }

  const cx = x + width / 2
  const bw = Math.max(2, Math.min(16, width * 0.6))
  const cut = candle.h > yMax
  const yt = cut ? topEdge : yFn(candle.h)
  const yb = yFn(candle.l)
  const yOpen = yFn(candle.o)
  const yClose = yFn(candle.c)
  const bodyTop = Math.min(yOpen, yClose)
  const bodyHeight = Math.max(1, Math.abs(yOpen - yClose))

  return (
    <g>
      {/* Wick line */}
      <line x1={cx} x2={cx} y1={yt} y2={yb} stroke={color} strokeWidth={1.2} />
      {/* Body rect */}
      <rect x={cx - bw / 2} y={bodyTop} width={bw} height={bodyHeight} fill={color} rx={1} />
      {/* Cap cut marker */}
      {cut && (
        <path
          d={`M${cx - 4} ${topEdge + 6} L${cx} ${topEdge} L${cx + 4} ${topEdge + 6} Z`}
          fill={color}
        />
      )}
    </g>
  )
}

function LastValueTag(props: any) {
  const { viewBox, val, unit } = props
  if (!viewBox || typeof viewBox.y !== 'number' || isNaN(viewBox.y) || typeof val !== 'number') return null
  const y = viewBox.y
  const x = viewBox.x + viewBox.width + 4
  const txt = `${kfmt(val)}${unit}`
  return (
    <g>
      <rect x={x} y={y - 8} width={56} height={16} rx={3} fill="var(--fg-1)" />
      <text x={x + 28} y={y + 3.5} fill="var(--bg)" fontSize={10} fontFamily="monospace" fontWeight={600} textAnchor="middle">
        {txt}
      </text>
    </g>
  )
}

export default function CandleChart({ periods, visibleFrom = 0, ma, labelOf }: CandleChartProps) {
  const visiblePeriods = useMemo(() => periods.slice(visibleFrom), [periods, visibleFrom])
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

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

  // เตรียมข้อมูลสำหรับ recharts
  const chartData = useMemo<ChartItem[]>(() => {
    return visiblePeriods.map((p, i) => ({
      index: i,
      key: p.key || p.from,
      label: labelOf(p),
      period: p,
      rev: p.rev,
      revRange: [p.rev.l, p.rev.h],
      revMaA: maCalculations.rA[i],
      revMaB: maCalculations.rB[i],
      exp: p.exp,
      expRange: [p.exp.l, p.exp.h],
      expMaA: maCalculations.eA[i],
      expMaB: maCalculations.eB[i],
      cash: p.cash,
      cashRange: p.cash ? [p.cash.lo, p.cash.hi] : null,
      cashC: p.cash ? p.cash.c : null,
    }))
  }, [visiblePeriods, labelOf, maCalculations])

  // คำนวณสเกลของแต่ละแผง
  const revScale = useMemo(() => {
    if (visiblePeriods.length === 0) return { min: 0, max: 100, step: 20 }
    const cap = capFor(visiblePeriods.map(p => p.rev), [...maCalculations.rA, ...maCalculations.rB])
    const all = [
      ...visiblePeriods.flatMap(p => [Math.min(p.rev.h, cap), p.rev.l]),
      ...maCalculations.rA.filter((v): v is number => v !== null),
      ...maCalculations.rB.filter((v): v is number => v !== null),
    ]
    return niceScale(Math.min(...all), Math.max(...all), 3)
  }, [visiblePeriods, maCalculations])

  const expScale = useMemo(() => {
    if (visiblePeriods.length === 0) return { min: 0, max: 100, step: 20 }
    const cap = capFor(visiblePeriods.map(p => p.exp), [...maCalculations.eA, ...maCalculations.eB])
    const all = [
      ...visiblePeriods.flatMap(p => [Math.min(p.exp.h, cap), p.exp.l]),
      ...maCalculations.eA.filter((v): v is number => v !== null),
      ...maCalculations.eB.filter((v): v is number => v !== null),
    ]
    return niceScale(Math.min(...all), Math.max(...all), 3)
  }, [visiblePeriods, maCalculations])

  const cashScale = useMemo(() => {
    const cashList = visiblePeriods.map(p => p.cash).filter((c): c is NonNullable<typeof c> => c !== null)
    if (cashList.length === 0) return { min: 0, max: 100, step: 20 }
    const all = cashList.flatMap(c => [c.lo, c.hi, c.c])
    return niceScale(Math.min(...all), Math.max(...all), 3)
  }, [visiblePeriods])

  if (visiblePeriods.length === 0) {
    return <div className="text-center py-8 text-xs text-[var(--fg-4)]">ไม่มีข้อมูล</div>
  }

  // แถบสรุปตัวเลขด้านบน: ตอนเอาเมาส์ออก (mouseleave) จะแสดงงวดล่าสุดเสมอ
  const activeIndex = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < visiblePeriods.length
    ? hoverIndex
    : visiblePeriods.length - 1
  const activePeriod = visiblePeriods[activeIndex]

  const revStr = `รายรับ ${baht(activePeriod.rev.c)}/วัน (${chgPct(activePeriod.rev.c, activePeriod.rev.o)})`
  const expStr = `รายจ่าย ${baht(activePeriod.exp.c)}/วัน (${chgPct(activePeriod.exp.c, activePeriod.exp.o)})`
  const cashStr = activePeriod.cash
    ? `เงินคงเหลือ ${baht(activePeriod.cash.c)} (ต่ำสุด ${baht(activePeriod.cash.lo)})`
    : 'เงินคงเหลือ —'
  const readoutText = `${labelOf(activePeriod)} · ${revStr} · ${expStr} · ${cashStr}`

  const lastPeriod = visiblePeriods[visiblePeriods.length - 1]
  const lastRevVal = lastPeriod.rev.c
  const lastExpVal = lastPeriod.exp.c
  const lastCashVal = lastPeriod.cash?.c ?? null

  const handleChartMouseMove = (state: any) => {
    if (state && typeof state.activeTooltipIndex === 'number') {
      setHoverIndex(state.activeTooltipIndex)
    }
  }

  const handleChartMouseLeave = () => {
    setHoverIndex(null)
  }

  const commonMargins = { top: 10, right: 65, left: 6, bottom: 6 }

  return (
    <div className="space-y-3" onMouseLeave={handleChartMouseLeave}>
      {/* Readout bar */}
      <div className="readout" aria-live="polite">
        {readoutText}
      </div>

      {/* แผง 1: รายรับ */}
      <div className="panel" role="img" aria-label="รายรับต่อวัน">
        <div className="flex flex-wrap items-baseline gap-2 sm:gap-3 text-xs mb-1">
          <span className="font-bold text-[var(--fg-1)] text-sm">รายรับ</span>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[var(--fg-3)] ml-auto text-xs">
            <span className="inline-flex items-center gap-1.5">
              <i className="w-2.5 h-3 rounded-[2px] inline-block" style={{ background: 'var(--up)' }} />
              เพิ่มจากงวดก่อน
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="w-2.5 h-3 rounded-[2px] inline-block" style={{ background: 'var(--dn)' }} />
              ลดลง
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="w-3.5 h-[3px] rounded-full inline-block" style={{ background: 'var(--fg-1)' }} />
              MA{ma[0]}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="w-3.5 h-[3px] rounded-full inline-block border-b-2 border-dashed border-[var(--fg-3)]" />
              MA{ma[1]}
            </span>
          </div>
        </div>
        <div className="h-[150px] w-full">
          <ResponsiveContainer width="100%" height={150}>
            <ComposedChart
              data={chartData}
              syncId="phopy-candles"
              margin={commonMargins}
              onMouseMove={handleChartMouseMove}
            >
              <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
              <XAxis dataKey="index" hide />
              <YAxis
                orientation="right"
                domain={[revScale.min, revScale.max]}
                ticks={niceTicks(revScale)}
                tickFormatter={v => `${kfmt(v)}/ว`}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--fg-3)', fontSize: 10.5, fontFamily: 'monospace' }}
                width={55}
              />
              <Tooltip
                cursor={{ stroke: 'var(--cross, #888)', strokeDasharray: '3 3', strokeWidth: 1 }}
                content={() => null}
              />
              <Bar
                dataKey="revRange"
                shape={
                  <CandleBar
                    panelType="rev"
                    yDomain={[revScale.min, revScale.max]}
                    topEdge={10}
                    plotHeight={134}
                  />
                }
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="revMaA"
                stroke="var(--fg-1)"
                strokeWidth={1.8}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
              <Line
                type="linear"
                dataKey="revMaB"
                stroke="var(--fg-3)"
                strokeWidth={1.8}
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
              <ReferenceLine
                y={lastRevVal}
                stroke="transparent"
                label={<LastValueTag val={lastRevVal} unit="/ว" />}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* แผง 2: รายจ่าย */}
      <div className="panel" role="img" aria-label="รายจ่ายต่อวัน">
        <div className="flex flex-wrap items-baseline gap-2 sm:gap-3 text-xs mb-1">
          <span className="font-bold text-[var(--fg-1)] text-sm">รายจ่าย</span>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[var(--fg-3)] ml-auto text-xs">
            <span className="inline-flex items-center gap-1.5">
              <i className="w-2.5 h-3 rounded-[2px] inline-block" style={{ background: 'var(--exp-up)' }} />
              เพิ่มจากงวดก่อน (ต้องระวัง)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="w-2.5 h-3 rounded-[2px] inline-block" style={{ background: 'var(--exp-dn)' }} />
              ลดลง
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="w-3.5 h-[3px] rounded-full inline-block" style={{ background: 'var(--fg-1)' }} />
              MA{ma[0]}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="w-3.5 h-[3px] rounded-full inline-block border-b-2 border-dashed border-[var(--fg-3)]" />
              MA{ma[1]}
            </span>
          </div>
        </div>
        <div className="h-[150px] w-full">
          <ResponsiveContainer width="100%" height={150}>
            <ComposedChart
              data={chartData}
              syncId="phopy-candles"
              margin={commonMargins}
              onMouseMove={handleChartMouseMove}
            >
              <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
              <XAxis dataKey="index" hide />
              <YAxis
                orientation="right"
                domain={[expScale.min, expScale.max]}
                ticks={niceTicks(expScale)}
                tickFormatter={v => `${kfmt(v)}/ว`}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--fg-3)', fontSize: 10.5, fontFamily: 'monospace' }}
                width={55}
              />
              <Tooltip
                cursor={{ stroke: 'var(--cross, #888)', strokeDasharray: '3 3', strokeWidth: 1 }}
                content={() => null}
              />
              <Bar
                dataKey="expRange"
                shape={
                  <CandleBar
                    panelType="exp"
                    yDomain={[expScale.min, expScale.max]}
                    topEdge={10}
                    plotHeight={134}
                  />
                }
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="expMaA"
                stroke="var(--fg-1)"
                strokeWidth={1.8}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
              <Line
                type="linear"
                dataKey="expMaB"
                stroke="var(--fg-3)"
                strokeWidth={1.8}
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
              <ReferenceLine
                y={lastExpVal}
                stroke="transparent"
                label={<LastValueTag val={lastExpVal} unit="/ว" />}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* แผง 3: เงินคงเหลือ */}
      <div className="panel" role="img" aria-label="เงินคงเหลือ">
        <div className="flex flex-wrap items-baseline gap-2 sm:gap-3 text-xs mb-1">
          <span className="font-bold text-[var(--fg-1)] text-sm">เงินคงเหลือ</span>
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
        <div className="h-[160px] w-full">
          <ResponsiveContainer width="100%" height={160}>
            <ComposedChart
              data={chartData}
              syncId="phopy-candles"
              margin={{ top: 10, right: 65, left: 6, bottom: 22 }}
              onMouseMove={handleChartMouseMove}
            >
              <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
              <XAxis
                dataKey="index"
                tickFormatter={idx => {
                  const p = visiblePeriods[idx]
                  if (!p || !p.from) return ''
                  const d = new Date(p.from.slice(0, 10) + 'T00:00:00')
                  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
                }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
                tick={{ fill: 'var(--fg-3)', fontSize: 10.5, fontFamily: 'monospace' }}
                interval="preserveStartEnd"
              />
              <YAxis
                orientation="right"
                domain={[cashScale.min, cashScale.max]}
                ticks={niceTicks(cashScale)}
                tickFormatter={v => kfmt(v)}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--fg-3)', fontSize: 10.5, fontFamily: 'monospace' }}
                width={55}
              />
              <Tooltip
                cursor={{ stroke: 'var(--cross, #888)', strokeDasharray: '3 3', strokeWidth: 1 }}
                content={() => null}
              />
              <Area
                type="linear"
                dataKey="cashRange"
                fill="var(--primary-soft)"
                stroke="none"
                isAnimationActive={false}
                connectNulls={false}
              />
              <Line
                type="linear"
                dataKey="cashC"
                stroke="var(--primary)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
              {lastCashVal !== null && (
                <ReferenceLine
                  y={lastCashVal}
                  stroke="transparent"
                  label={<LastValueTag val={lastCashVal} unit="" />}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function niceTicks(scale: { min: number; max: number; step: number }): number[] {
  const ticks: number[] = []
  if (scale.step <= 0) return [scale.min]
  for (let v = scale.min; v <= scale.max + scale.step / 2; v += scale.step) {
    ticks.push(v)
  }
  return ticks
}
