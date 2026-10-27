import { useEffect, useState, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  RefreshCw, Package, Truck, CheckSquare, AlertCircle, ChevronRight,
} from 'lucide-react'
import api from '../services/api'
import CandleChart, { TrendPeriod } from '../components/charts/CandleChart'

// ---- Types ----
export interface SignalItem {
  id: string
  label: string
  status: 'G' | 'Y' | 'R' | 'NA'
  value: number | null
  display: string
  compare: string
  rule: string
  source: string
  action: string
  link: string
}

export interface DashboardHealthData {
  financial: boolean
  asOf: string
  today: string
  dataSince: string | null
  dataDays: number
  overall: {
    status: 'G' | 'Y' | 'R'
    headline: string
    red: number
    yellow: number
    na: number
  } | null
  confidence: {
    period: string
    label: string
    passed: number
    total: number
    blocks: number
  } | null
  signals: SignalItem[]
  chart: {
    grain: 'week'
    ma: [number, number]
    warmup: number
    periods: TrendPeriod[]
  } | null
  ops: {
    lowStock: number
    pendingDelivery: number
    pendingApprovals: number
    arDue7: {
      count: number
      amount: number | null
    }
  }
}

// ---- Thai Date Helpers ----
const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const yy = (y: number) => String((y + 543) % 100).padStart(2, '0')

export const thDay = (iso: string) => {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${TH_M[m - 1]} ${yy(y)}`
}

const fmtBaht = (n: number | null | undefined) => {
  if (n === null || n === undefined || isNaN(n)) return '฿0'
  const sign = n < 0 ? '−' : ''
  return `${sign}฿${Math.round(Math.abs(n)).toLocaleString('th-TH')}`
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-[var(--border)]/30 rounded animate-pulse ${className}`} />
}

export default function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [health, setHealth] = useState<DashboardHealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState(new Date())

  // Range options: 13, 26, 52 weeks (default 26)
  const [chartWeeks, setChartWeeks] = useState<13 | 26 | 52>(26)

  const loadHealth = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/dashboard/health')
      if (res.data?.success) {
        setHealth(res.data.data)
      } else {
        setError(res.data?.message || 'ไม่สามารถโหลดข้อมูลสุขภาพธุรกิจได้')
      }
    } catch {
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูล')
    } finally {
      setLoading(false)
      setLastUpdated(new Date())
    }
  }, [])

  useEffect(() => {
    loadHealth()
    const timer = setInterval(loadHealth, 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [loadHealth])

  const container = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.05 } } }
  const item = { hidden: { y: 10, opacity: 0 }, visible: { y: 0, opacity: 1, transition: { type: 'spring', damping: 20 } } }

  // Signal chips mapping
  const statusChips = {
    G: { text: t('dashboard.health.statusNormal', 'ปกติ'), cls: 'bg-[var(--success-soft)] text-[var(--success)]', bar: 'var(--success)' },
    Y: { text: t('dashboard.health.statusWatch', 'เฝ้าดู'), cls: 'bg-[var(--warning-soft)] text-[var(--warning)]', bar: 'var(--warning)' },
    R: { text: t('dashboard.health.statusAction', 'ต้องสั่งการ'), cls: 'bg-[var(--danger-soft)] text-[var(--danger)]', bar: 'var(--danger)' },
    NA: { text: t('dashboard.health.statusNoData', 'ไม่มีข้อมูล'), cls: 'bg-[var(--surface-2)] text-[var(--fg-4)]', bar: 'var(--border-strong)' },
  }

  const isFinancial = health?.financial ?? true

  // Signals count & items
  const signals = health?.signals ?? []
  const normalSignalsCount = signals.filter(s => s.status === 'G').length
  const flaggedSignals = signals.filter(s => s.status === 'Y' || s.status === 'R')

  const labelOfPeriod = (p: TrendPeriod) => `สัปดาห์ ${thDay(p.from)}–${thDay(p.to)}`

  return (
    <motion.div variants={container} initial="hidden" animate="visible" className="space-y-5">
      {/* 0. Header */}
      <motion.div variants={item} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-1)]">
            {t('dashboard.health.title', 'ชีพจรเช้านี้')}
          </h1>
          <p className="text-[var(--fg-4)] text-xs mt-1">
            {t('dashboard.updated', { time: lastUpdated.toLocaleTimeString('th-TH') })}
          </p>
        </div>
        <button
          onClick={loadHealth}
          aria-label={t('dashboard.refresh', 'รีเฟรชข้อมูล')}
          className="p-2 rounded-lg border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--primary)] hover:border-phopy-indigo/50 transition-colors cursor-pointer min-h-[36px] min-w-[36px]"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </motion.div>

      {error && (
        <div className="p-4 rounded-xl bg-[var(--danger-soft)] text-[var(--danger)] text-sm">
          {error}
        </div>
      )}

      {/* Financial Users View */}
      {isFinancial && health && (
        <>
          {/* 1. Banner */}
          {health.overall && (
            <motion.div
              variants={item}
              className="phopy-card p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border border-[var(--border)]"
            >
              <div className="flex items-center gap-4 min-w-0">
                {/* Big light indicator with pulse ring */}
                <span
                  role="img"
                  aria-label={statusChips[health.overall.status].text}
                  className={`w-11 h-11 rounded-full relative flex-shrink-0 flex items-center justify-center after:absolute after:-inset-1.5 after:rounded-full after:border-2 after:border-current after:opacity-25 ${
                    health.overall.status === 'G'
                      ? 'bg-[var(--success)] text-[var(--success)]'
                      : health.overall.status === 'Y'
                      ? 'bg-[var(--warning)] text-[var(--warning)]'
                      : 'bg-[var(--danger)] text-[var(--danger)]'
                  }`}
                />
                <div className="min-w-0">
                  <h2 className="text-lg sm:text-xl font-bold text-[var(--fg-1)] leading-snug">
                    {health.overall.headline}
                  </h2>
                  <div className="text-xs sm:text-sm text-[var(--fg-3)] mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span>
                      {normalSignalsCount} จาก 6 สัญญาณปกติ · ข้อมูลถึงสิ้นวัน {thDay(health.asOf)}
                    </span>
                    {health.dataDays < 90 && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--surface-2)] text-[var(--fg-3)] border border-[var(--border)]">
                        ข้อมูล {health.dataDays} วัน
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Right side: Data confidence */}
              {health.confidence && (
                <Link
                  to="/accounting/period-closing"
                  className="sm:text-right block hover:opacity-80 transition-opacity ml-auto sm:ml-0 flex-shrink-0"
                >
                  <span className="text-xs text-[var(--fg-3)] block">
                    {t('dashboard.health.confidence', 'ความน่าเชื่อถือข้อมูล')}
                  </span>
                  <b className="text-sm sm:text-base font-bold text-[var(--success)] block mt-0.5">
                    {health.confidence.label}
                  </b>
                </Link>
              )}
            </motion.div>
          )}

          {/* 2. Six Signal Tiles */}
          <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {signals.map(s => {
              const chip = statusChips[s.status] || statusChips.NA
              return (
                <div
                  key={s.id}
                  className="phopy-card p-4 relative flex flex-col justify-between overflow-hidden border border-[var(--border)]"
                >
                  {/* Left accent bar */}
                  <div
                    className="absolute left-0 top-3.5 bottom-3.5 w-1 rounded-r"
                    style={{ background: chip.bar }}
                  />

                  <div>
                    {/* Label + status chip */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-xs sm:text-sm font-semibold text-[var(--fg-2)] truncate">
                        {s.label}
                      </span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${chip.cls}`}>
                        {chip.text}
                      </span>
                    </div>

                    {/* Big display */}
                    <div className="text-2xl font-bold font-mono text-[var(--fg-1)] tabular-nums mt-0.5">
                      {s.display}
                    </div>

                    {/* Compare */}
                    <p className="text-xs sm:text-sm text-[var(--fg-2)] mt-1 leading-snug">
                      {s.compare}
                    </p>
                  </div>

                  <div>
                    {/* Rule line */}
                    <div className="border-t border-dashed border-[var(--border)] pt-1.5 mt-2.5 text-xs text-[var(--fg-3)]">
                      {s.rule}
                    </div>

                    {/* Source */}
                    <div className="text-[11px] text-[var(--fg-4)] mt-1">
                      ที่มา: {s.source}
                    </div>
                  </div>
                </div>
              )
            })}
          </motion.div>

          {/* 3. Chart Card */}
          {health.chart && (
            <motion.div variants={item} className="phopy-card p-5 border border-[var(--border)] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-[var(--fg-1)] text-base">
                    {t('dashboard.health.chartTitle', 'รายรับ · รายจ่าย · เงินคงเหลือ')}
                  </h3>
                  <p className="text-xs text-[var(--fg-3)] mt-0.5">
                    {t('dashboard.health.chartSubtitle', 'แท่งละ 1 สัปดาห์ (จันทร์–อาทิตย์) หน่วยเป็นบาทต่อวัน · ชี้ที่กราฟเพื่อดูตัวเลข')}
                  </p>
                </div>

                {/* Range buttons: 13 / 26 / 52 สัปดาห์ */}
                <div
                  className="inline-flex rounded-lg border border-[var(--border)] p-0.5 bg-[var(--surface-2)]"
                  role="group"
                  aria-label="ช่วงเวลา"
                >
                  {([13, 26, 52] as const).map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setChartWeeks(n)}
                      aria-pressed={chartWeeks === n}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                        chartWeeks === n
                          ? 'bg-[var(--surface)] text-[var(--primary)] shadow-sm'
                          : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'
                      }`}
                    >
                      {n} สัปดาห์
                    </button>
                  ))}
                </div>
              </div>

              {/* Shared CandleChart Component */}
              <CandleChart
                periods={health.chart.periods}
                visibleFrom={health.chart.warmup}
                bars={chartWeeks}
                ma={health.chart.ma || [4, 13]}
                labelOf={labelOfPeriod}
              />
            </motion.div>
          )}

          {/* 4. เรื่องที่ต้องดูวันนี้ */}
          <motion.div variants={item} className="phopy-card p-5 border border-[var(--border)]">
            <h3 className="font-bold text-[var(--fg-1)] text-sm mb-3">
              {t('dashboard.health.todoTitle', 'เรื่องที่ต้องดูวันนี้')}
            </h3>

            {flaggedSignals.length === 0 ? (
              <p className="text-xs text-[var(--fg-4)]">
                {t('dashboard.health.noTodo', 'ไม่มี')}
              </p>
            ) : (
              <div className="space-y-3">
                {flaggedSignals.map(s => (
                  <div key={s.id} className="flex items-start gap-3 text-xs sm:text-sm">
                    <span
                      className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${
                        s.status === 'R' ? 'bg-[var(--danger)]' : 'bg-[var(--warning)]'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div>
                        <b className="text-[var(--fg-1)] font-semibold">{s.label} {s.display}</b>
                        <span className="text-[var(--fg-3)] ml-1">· {s.compare}</span>
                      </div>
                      <div className="text-xs text-[var(--fg-3)] mt-0.5">
                        {s.action}
                        {s.link && (
                          <>
                            <span className="mx-1.5 text-[var(--fg-4)]">·</span>
                            <Link to={s.link} className="text-[var(--primary)] font-semibold hover:underline">
                              ดูรายละเอียด
                            </Link>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </>
      )}

      {/* Loading Skeleton if no health yet */}
      {loading && !health && (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {/* 5. Operations Bar (rendered for both basic and financial users) */}
      {health?.ops && (
        <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* สต็อกวิกฤต */}
          <button
            onClick={() => navigate('/stock')}
            className="phopy-card p-3.5 flex items-center justify-between text-left cursor-pointer hover:border-[var(--primary)]/40 border border-[var(--border)] transition-colors group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Package className="w-4 h-4 text-warning flex-shrink-0" />
              <span className="text-xs font-semibold text-[var(--fg-2)] truncate">
                {t('dashboard.health.opsLowStock', 'สต็อกวิกฤต')}
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <b className="text-base font-bold text-[var(--fg-1)] font-mono tabular-nums">
                {health.ops.lowStock}
              </b>
              <ChevronRight className="w-3.5 h-3.5 text-[var(--fg-4)] group-hover:text-[var(--primary)] transition-colors" />
            </div>
          </button>

          {/* รอส่งของ */}
          <button
            onClick={() => navigate('/sales')}
            className="phopy-card p-3.5 flex items-center justify-between text-left cursor-pointer hover:border-[var(--primary)]/40 border border-[var(--border)] transition-colors group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Truck className="w-4 h-4 text-warning flex-shrink-0" />
              <span className="text-xs font-semibold text-[var(--fg-2)] truncate">
                {t('dashboard.health.opsPendingDelivery', 'รอส่งของ')}
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <b className="text-base font-bold text-[var(--fg-1)] font-mono tabular-nums">
                {health.ops.pendingDelivery}
              </b>
              <ChevronRight className="w-3.5 h-3.5 text-[var(--fg-4)] group-hover:text-[var(--primary)] transition-colors" />
            </div>
          </button>

          {/* รออนุมัติ */}
          <button
            onClick={() => navigate('/approvals')}
            className="phopy-card p-3.5 flex items-center justify-between text-left cursor-pointer hover:border-[var(--primary)]/40 border border-[var(--border)] transition-colors group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <CheckSquare className="w-4 h-4 text-warning flex-shrink-0" />
              <span className="text-xs font-semibold text-[var(--fg-2)] truncate">
                {t('dashboard.health.opsPendingApprovals', 'รออนุมัติ')}
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <b className="text-base font-bold text-[var(--fg-1)] font-mono tabular-nums">
                {health.ops.pendingApprovals}
              </b>
              <ChevronRight className="w-3.5 h-3.5 text-[var(--fg-4)] group-hover:text-[var(--primary)] transition-colors" />
            </div>
          </button>

          {/* ลูกหนี้ครบกำหนด 7 วัน */}
          <button
            onClick={() => navigate('/accounting/phopy-board?view=receivables')}
            className="phopy-card p-3.5 flex items-center justify-between text-left cursor-pointer hover:border-[var(--primary)]/40 border border-[var(--border)] transition-colors group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <AlertCircle className="w-4 h-4 text-danger flex-shrink-0" />
              <span className="text-xs font-semibold text-[var(--fg-2)] truncate">
                {t('dashboard.health.opsArDue7', 'ลูกหนี้ถึงกำหนดใน 7 วัน')}
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <b className="text-base font-bold text-[var(--fg-1)] font-mono tabular-nums">
                {health.ops.arDue7.amount !== null
                  ? fmtBaht(health.ops.arDue7.amount)
                  : `${health.ops.arDue7.count} ใบ`}
              </b>
              <ChevronRight className="w-3.5 h-3.5 text-[var(--fg-4)] group-hover:text-[var(--primary)] transition-colors" />
            </div>
          </button>
        </motion.div>
      )}
    </motion.div>
  )
}
