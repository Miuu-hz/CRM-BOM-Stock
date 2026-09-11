import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  TrendingUp, TrendingDown, RefreshCw, DollarSign, BarChart2,
  ArrowDownCircle, ArrowUpCircle, Package, Truck, Users, AlertTriangle,
  FileText, ChevronRight, Wallet,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import api from '../services/api'

// ---- Types ----
type Period = 'day' | 'week' | 'month' | 'year'
type CFTab = 'overdue' | 'today' | 'week' | 'month'

interface RevenueData {
  period: Period
  current: { revenue: number; grossProfit: number; cost: number }
  previous: { revenue: number; grossProfit: number; cost: number }
  revenueChangePercent: number | null
  grossChangePercent: number | null
  grossMargin: number
}
interface CFItem { id: string; party_name: string; doc_number: string; amount: number; due_date: string; dueUnspecified?: boolean }
interface CFGroup { overdue: CFItem[]; today: CFItem[]; week: CFItem[]; month: CFItem[]; later: CFItem[]; total: number; weekTotal: number; monthTotal: number; laterTotal: number }
interface Cashflow { ar: CFGroup; ap: CFGroup; netCashflow: { week: number; month: number } }
interface Funnel { quotations: { count: number; value: number }; salesOrders: { count: number; value: number }; invoices: { count: number; value: number }; pendingDelivery: { count: number; value: number } }
interface Stage { count: number; value: number }
interface Pipeline {
  stages: { quoting: Stage; awaiting: Stage; won: Stage; lost: Stage }
  winRate: number | null
  openPipelineValue: number
  linkage: { soTotal: number; soFromQuotation: number; soDirect: number; linkedPercent: number }
  waterfall: { ordered: number; invoiced: number; collected: number; outstanding: number }
  monthly: { month: string; ordered: number; invoiced: number }[]
}
interface TopCustomer { id: string; name: string; revenue: number; invoice_count: number }
interface LowStock { id: string; name: string; quantity: number; min_stock: number; unit: string }

// ---- Helpers ----
const fmt = (n: number) =>
  n >= 1_000_000 ? `฿${(n / 1_000_000).toFixed(2)}M`
  : n >= 1_000 ? `฿${(n / 1_000).toFixed(1)}K`
  : `฿${n.toLocaleString()}`

const fmtShort = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K`
  : n.toLocaleString()

const daysLeft = (dateStr: string) => {
  if (!dateStr) return null
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000)
  return diff
}

const PERIOD_KEYS: Record<Period, string> = { day: 'dashboard.today', week: 'dashboard.7days', month: 'dashboard.30days', year: 'dashboard.year' }

// ---- Sub-components ----
function ChangeChip({ pct, t }: { pct: number | null; t: (key: string) => string }) {
  if (pct === null) return <span className="text-xs text-[var(--fg-4)]">{t('dashboard.noPrevData')}</span>
  const up = pct >= 0
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${up ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--danger-soft)] text-[var(--danger)]'}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {up ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-[var(--border)]/30 rounded animate-pulse ${className}`} />
}

function CFPanel({ titleKey, icon: Icon, items, counts, tab, setTab, total, color, t }: {
  titleKey: string; icon: any; items: CFItem[]; counts: Record<CFTab, number>; tab: CFTab; setTab: (t: CFTab) => void; total: number; color: string; t: (key: string, options?: any) => string
}) {
  const tabs: { key: CFTab; labelKey: string }[] = [
    { key: 'overdue', labelKey: 'dashboard.overdue' },
    { key: 'today', labelKey: 'dashboard.today' },
    { key: 'week', labelKey: 'dashboard.7days' },
    { key: 'month', labelKey: 'dashboard.30days' },
  ]

  return (
    <div className="phopy-card p-5 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className={`w-5 h-5 ${color}`} />
          <h3 className="font-bold text-[var(--fg-1)]">{t(titleKey)}</h3>
        </div>
        <span className={`text-sm font-bold ${color}`}>{fmt(total)}</span>
      </div>
      {/* Tabs */}
      <div className="flex gap-1 mb-3" role="tablist">
        {tabs.map(tabItem => (
          <button
            key={tabItem.key}
            role="tab"
            aria-selected={tab === tabItem.key}
            onClick={() => setTab(tabItem.key)}
            className={`flex-1 py-1.5 text-xs rounded transition-all cursor-pointer min-h-[44px] font-medium ${
              tab === tabItem.key
                ? `bg-[var(--surface)] border border-[var(--border-strong)] shadow-1 ${color} font-semibold`
                : 'text-[var(--fg-4)] hover:text-[var(--fg-2)] hover:bg-[var(--surface-2)]'
            }`}
          >
            {t(tabItem.labelKey)}
            {counts[tabItem.key] > 0 && (
              <span className={`ml-1 rounded-full px-1 text-[10px] ${
                tabItem.key === 'overdue'
                  ? 'bg-[var(--danger)] text-white'
                  : 'bg-[var(--danger)]/10 text-[var(--danger)]'
              }`}>{counts[tabItem.key]}</span>
            )}
          </button>
        ))}
      </div>
      {/* List */}
      <div className="flex-1 overflow-y-auto max-h-52 phopy-scrollbar space-y-2">
        {items.length === 0 ? (
          <p className="text-[var(--fg-4)] text-xs text-center py-6">{t('dashboard.noItems')}</p>
        ) : items.map(item => (
          <div key={item.id} className="flex items-center gap-2 p-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[var(--fg-2)] truncate font-medium">{item.party_name}</p>
              <p className="text-xs text-[var(--fg-4)] font-mono">{item.doc_number}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className={`text-sm font-bold ${color}`}>{fmt(item.amount)}</p>
              {(item.due_date || item.dueUnspecified) && <DueDateBadge dateStr={item.due_date} dueUnspecified={item.dueUnspecified} t={t} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DueDateBadge({ dateStr, dueUnspecified, t }: { dateStr: string; dueUnspecified?: boolean; t: (key: string, options?: any) => string }) {
  if (dueUnspecified) return <span className="text-[var(--fg-4)] text-xs font-semibold">{t('dashboard.dueUnknown')}</span>
  const d = daysLeft(dateStr)
  if (d === null) return <span className="text-[var(--fg-4)] text-xs">{t('dashboard.dueUnknown')}</span>
  if (d < 0) return <span className="text-xs text-danger font-bold">{t('dashboard.overdueDays', { days: Math.abs(d) })}</span>
  if (d === 0) return <span className="text-xs text-warning font-bold">{t('dashboard.today')}</span>
  return <span className="text-xs text-[var(--fg-3)]">{t('dashboard.inDays', { days: d })}</span>
}

// ---- Main Dashboard ----
export default function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [period, setPeriod] = useState<Period>('month')
  const [arTab, setArTab] = useState<CFTab>('week')
  const [apTab, setApTab] = useState<CFTab>('week')

  const [revenue, setRevenue] = useState<RevenueData | null>(null)
  const [cashflow, setCashflow] = useState<Cashflow | null>(null)
  const [funnel, setFunnel] = useState<Funnel | null>(null)
  const [pipeline, setPipeline] = useState<Pipeline | null>(null)
  const [topCustomers, setTopCustomers] = useState<TopCustomer[]>([])
  const [lowStock, setLowStock] = useState<LowStock[]>([])
  const [loading, setLoading] = useState(true)
  const [revLoading, setRevLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(new Date())

  const loadRevenue = useCallback(async (p: Period) => {
    setRevLoading(true)
    try {
      const [rev, top] = await Promise.all([
        api.get(`/dashboard/revenue?period=${p}`),
        api.get(`/dashboard/top-customers?period=${p}`),
      ])
      setRevenue(rev.data.data)
      setTopCustomers(top.data.data)
    } catch {}
    setRevLoading(false)
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [cf, fn, pl, ls] = await Promise.all([
        api.get('/dashboard/cashflow-forecast'),
        api.get('/dashboard/funnel'),
        api.get('/dashboard/pipeline'),
        api.get('/dashboard/low-stock'),
      ])
      setCashflow(cf.data.data)
      setFunnel(fn.data.data)
      setPipeline(pl.data.data)
      setLowStock(ls.data.data)
      setLastUpdated(new Date())
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { loadAll(); loadRevenue(period) }, [])
  useEffect(() => { loadRevenue(period) }, [period, loadRevenue])

  const cf = cashflow
  // แท็บช่วงเวลาเป็นแบบสะสม ให้ตรงกับป้าย ("7 วัน" = ภายใน 7 วัน ไม่ใช่เฉพาะวันที่ 2-7)
  // และตรงกับ weekTotal/monthTotal ที่ backend คิดแบบสะสมอยู่แล้ว
  // เกินกำหนด/เกิน 30 วัน เป็นสถานะเฉพาะ ไม่สะสม
  // แต่ละแท็บแยกขาดจากกัน ใบหนึ่งอยู่ได้ช่องเดียว (union ไม่ซ้ำ)
  // ช่อง later (ครบกำหนดเกิน 30 วันข้างหน้า) ยุบรวมเข้า "30 วัน" เพราะตัดปุ่มนั้นออกแล้ว
  // — ยุบแทนที่จะทิ้ง ไม่งั้นเงินก้อนนั้นจะไม่โผล่ที่แท็บไหนเลยเหมือนบั๊กเดิม
  const cfItems = (g: CFGroup | undefined, tab: CFTab): CFItem[] =>
    !g ? [] : tab === 'month' ? [...g.month, ...g.later] : g[tab]
  const cfCounts = (g: CFGroup | undefined): Record<CFTab, number> => ({
    overdue: g?.overdue.length ?? 0,
    today:   g?.today.length ?? 0,
    week:    g?.week.length ?? 0,
    month:   (g?.month.length ?? 0) + (g?.later.length ?? 0),
  })
  const arItems = cfItems(cf?.ar, arTab)
  const apItems = cfItems(cf?.ap, apTab)
  const arCounts = cfCounts(cf?.ar)
  const apCounts = cfCounts(cf?.ap)

  const container = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.06 } } }
  const item = { hidden: { y: 12, opacity: 0 }, visible: { y: 0, opacity: 1, transition: { type: 'spring', damping: 20 } } }

  const periodLabel = t(PERIOD_KEYS[period])

  // ขั้นของใบเสนอราคา เรียงตามลำดับที่ดีลเดินจริง — แพ้ไว้ท้ายสุดเพราะเป็นปลายทาง
  const pipelineRows = pipeline ? [
    { key: 'quoting',  labelKey: 'dashboard.stageQuoting',  data: pipeline.stages.quoting,  color: 'var(--info)' },
    { key: 'awaiting', labelKey: 'dashboard.stageAwaiting', data: pipeline.stages.awaiting, color: 'var(--warning)' },
    { key: 'won',      labelKey: 'dashboard.stageWon',      data: pipeline.stages.won,      color: 'var(--success)' },
    { key: 'lost',     labelKey: 'dashboard.stageLost',     data: pipeline.stages.lost,     color: 'var(--fg-4)' },
  ] : []
  const pipelineMaxCount = Math.max(1, ...pipelineRows.map(r => r.data.count))

  const waterfallRows = pipeline ? [
    { labelKey: 'dashboard.wfOrdered',     value: pipeline.waterfall.ordered,     color: 'var(--primary)' },
    { labelKey: 'dashboard.wfInvoiced',    value: pipeline.waterfall.invoiced,    color: 'var(--info)' },
    { labelKey: 'dashboard.wfCollected',   value: pipeline.waterfall.collected,   color: 'var(--success)' },
    { labelKey: 'dashboard.wfOutstanding', value: pipeline.waterfall.outstanding, color: 'var(--danger)' },
  ] : []
  const waterfallMax = Math.max(1, ...waterfallRows.map(r => r.value))

  return (
    <motion.div variants={container} initial="hidden" animate="visible" className="space-y-5">

      {/* Header */}
      <motion.div variants={item} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-1)]">{t('dashboard.title')}</h1>
          <p className="text-[var(--fg-4)] text-xs mt-1">{t('dashboard.updated', { time: lastUpdated.toLocaleTimeString('th-TH') })}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Period Toggle */}
          <div className="flex bg-[var(--surface-2)] border border-[var(--border)] rounded-lg overflow-hidden" role="group" aria-label={t('dashboard.periodGroup')}>
            {(Object.keys(PERIOD_KEYS) as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                aria-pressed={period === p}
                className={`px-3 py-1.5 text-xs transition-all cursor-pointer min-h-[44px] ${period === p ? 'bg-[var(--primary-soft)] text-[var(--primary)] font-semibold' : 'font-medium text-[var(--fg-3)] hover:text-[var(--fg-2)] hover:bg-[var(--surface-2)]'}`}
              >
                {t(PERIOD_KEYS[p])}
              </button>
            ))}
          </div>
          <button
            onClick={() => { loadAll(); loadRevenue(period) }}
            aria-label={t('dashboard.refresh')}
            className="p-2 rounded-lg border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--primary)] hover:border-phopy-indigo/50 transition-colors cursor-pointer min-h-[36px] min-w-[36px]"
          >
            <RefreshCw className={`w-4 h-4 ${loading || revLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </motion.div>

      {/* Section 1: Revenue + Gross Profit */}
      <motion.div variants={item} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Revenue */}
        <div className="phopy-card p-5 border border-[var(--primary)]/20">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-[var(--fg-3)] text-sm">
              <DollarSign className="w-4 h-4 text-[var(--primary)]" />
              {t('dashboard.revenue', { period: periodLabel })}
            </div>
            {!revLoading && revenue && <ChangeChip pct={revenue.revenueChangePercent} t={t} />}
          </div>
          {revLoading || !revenue ? <Skeleton className="h-9 w-40 mt-2" /> : (
            <>
              <p className="text-3xl font-bold text-[var(--primary)] mt-1">{fmt(revenue.current.revenue)}</p>
              <p className="text-xs text-[var(--fg-4)] mt-1">{t('dashboard.previous', { amount: fmt(revenue.previous.revenue) })}</p>
            </>
          )}
        </div>

        {/* Gross Profit */}
        <div className="phopy-card p-5 border border-[var(--success)]/20">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-[var(--fg-3)] text-sm">
              <TrendingUp className="w-4 h-4 text-success" />
              {t('dashboard.grossProfit', { period: periodLabel })}
            </div>
            {!revLoading && revenue && <ChangeChip pct={revenue.grossChangePercent} t={t} />}
          </div>
          {revLoading || !revenue ? <Skeleton className="h-9 w-40 mt-2" /> : (
            <>
              <p className={`text-3xl font-bold mt-1 ${revenue.current.grossProfit >= 0 ? 'text-success' : 'text-danger'}`}>
                {fmt(revenue.current.grossProfit)}
              </p>
              <p className="text-xs text-[var(--fg-4)] mt-1">{t('dashboard.marginCost', { margin: revenue.grossMargin.toFixed(1), cost: fmt(revenue.current.cost) })}</p>
            </>
          )}
        </div>
      </motion.div>

      {/* Section 2: Cash Flow Forecast */}
      <motion.div variants={item}>
        <div className="flex items-center gap-2 mb-3">
          <BarChart2 className="w-4 h-4 text-[var(--primary)]" />
          <h2 className="text-sm font-bold text-[var(--fg-2)] uppercase tracking-wider">{t('dashboard.cashflowForecast')}</h2>
          {cf && (
            <div className="ml-auto flex items-center gap-3 text-xs">
              <span className="text-[var(--fg-3)]">{t('dashboard.net7Days')}:
                <span className={`ml-1 font-bold ${cf.netCashflow.week >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                  {cf.netCashflow.week >= 0 ? '+' : ''}{fmt(cf.netCashflow.week)}
                </span>
              </span>
              <span className="text-[var(--fg-3)]">{t('dashboard.net30Days')}:
                <span className={`ml-1 font-bold ${cf.netCashflow.month >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                  {cf.netCashflow.month >= 0 ? '+' : ''}{fmt(cf.netCashflow.month)}
                </span>
              </span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {loading ? (
            <>
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </>
          ) : (
            <>
              <CFPanel
                titleKey="dashboard.cashIn"
                icon={ArrowDownCircle}
                items={arItems}
                counts={arCounts}
                tab={arTab}
                setTab={setArTab}
                total={cf?.ar.total ?? 0}
                color="text-success"
                t={t}
              />
              <CFPanel
                titleKey="dashboard.cashOut"
                icon={ArrowUpCircle}
                items={apItems}
                counts={apCounts}
                tab={apTab}
                setTab={setApTab}
                total={cf?.ap.total ?? 0}
                color="text-danger"
                t={t}
              />
            </>
          )}
        </div>
      </motion.div>

      {/* Section 2b: เงินไหลถึงไหนแล้ว — รับออเดอร์แล้วยังไม่ใช่เก็บเงินได้ */}
      <motion.div variants={item}>
        <button
          onClick={() => navigate('/receivables')}
          className="phopy-card p-5 w-full text-left cursor-pointer hover:border-[var(--primary)]/40 border border-transparent transition-colors group"
        >
          <div className="flex items-center gap-2 mb-4">
            <Wallet className="w-4 h-4 text-[var(--primary)]" />
            <h3 className="font-bold text-[var(--fg-1)]">{t('dashboard.cashJourney')}</h3>
            <ChevronRight className="w-4 h-4 text-[var(--fg-4)] ml-auto group-hover:text-[var(--primary)] transition-colors" />
          </div>
          {loading || !pipeline ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5">
              {waterfallRows.map(({ labelKey, value, color }) => (
                <div key={labelKey}>
                  <p className="text-xs text-[var(--fg-4)]">{t(labelKey)}</p>
                  <p className="text-2xl font-bold tabular-nums mt-0.5" style={{ color }}>{fmt(value)}</p>
                  <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden mt-2">
                    <div className="h-full rounded-full transition-all" style={{ width: `${(value / waterfallMax) * 100}%`, background: color }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </button>
      </motion.div>

      {/* Section 3: Sales Funnel + Top Customers */}
      <motion.div variants={item} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Quotation pipeline — ไล่ตาม quotation_id จริง ไม่ใช่กรวยที่นับแยกกัน */}
        <div className="phopy-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-4 h-4 text-[var(--primary)]" />
            <h3 className="font-bold text-[var(--fg-1)]">{t('dashboard.salesPipeline')}</h3>
            {pipeline && pipeline.winRate !== null && (
              <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
                {t('dashboard.winRate', { percent: pipeline.winRate.toFixed(0) })}
              </span>
            )}
          </div>
          {loading || !pipeline ? (
            <div className="space-y-3">{Array(4).fill(0).map((_,i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <>
              <div className="space-y-3">
                {pipelineRows.map(({ key, labelKey, data, color }) => (
                  <div key={key} className="flex items-center gap-3">
                    <div className="w-28 flex-shrink-0">
                      <p className="text-xs text-[var(--fg-3)]">{t(labelKey)}</p>
                      <p className="text-sm font-bold tabular-nums" style={{ color }}>{fmt(data.value)}</p>
                    </div>
                    <div className="flex-1 h-6 bg-[var(--surface-2)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full flex items-center justify-end pr-2 transition-all"
                        style={{
                          width: `${(data.count / pipelineMaxCount) * 100}%`,
                          minWidth: data.count > 0 ? '2rem' : '0',
                          background: color,
                        }}
                      >
                        {data.count > 0 && <span className="text-white text-xs font-bold tabular-nums">{data.count}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* ออเดอร์ที่เปิดตรงไม่ผ่านใบเสนอราคา ทำให้ไปป์ไลน์ข้างบนอ่านต่ำกว่าความจริง */}
              {pipeline.linkage.soDirect > 0 && (
                <div className="flex items-start gap-2 mt-4 p-2.5 rounded-lg bg-[var(--warning-soft)] border border-warning/20">
                  <AlertTriangle className="w-3.5 h-3.5 text-warning flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-warning leading-relaxed">
                    {t('dashboard.pipelineUnlinked', {
                      direct: pipeline.linkage.soDirect,
                      total: pipeline.linkage.soTotal,
                    })}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Top 5 Customers */}
        <div className="phopy-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-[var(--primary)]" />
            <h3 className="font-bold text-[var(--fg-1)]">{t('dashboard.top5Customers')}</h3>
            <span className="text-xs text-[var(--fg-4)] ml-auto">{periodLabel}</span>
          </div>
          {revLoading || topCustomers.length === 0 ? (
            topCustomers.length === 0 && !revLoading
              ? <p className="text-[var(--fg-4)] text-sm text-center py-8">{t('dashboard.noInvoiceData', { period: periodLabel })}</p>
              : <div className="space-y-2">{Array(5).fill(0).map((_,i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={topCustomers} layout="vertical" barSize={16}>
                <XAxis type="number" tick={{ fill: 'var(--fg-3)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtShort} />
                <YAxis type="category" dataKey="name" tick={{ fill: 'var(--fg-2)', fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
                <Tooltip
                  formatter={(v: number) => [fmt(v), t('dashboard.revenueTooltip')]}
                  cursor={{ fill: 'rgba(57,73,229,0.08)' }}
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'var(--fg-1)',
                  }}
                />
                <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                  {topCustomers.map((_, i) => (
                    <Cell key={i} fill={['var(--primary)','var(--success)','var(--warning)','var(--info)','var(--danger)'][i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </motion.div>

      {/* Section 4: Operations Row */}
      <motion.div variants={item} className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Pending Delivery */}
        <button
          onClick={() => navigate('/sales')}
          className="phopy-card p-4 border border-warning/20 text-left cursor-pointer hover:border-warning/50 transition-colors group"
          aria-label={t('dashboard.pendingDeliveryTitle')}
        >
          <div className="flex items-center gap-2 mb-2">
            <Truck className="w-4 h-4 text-warning" />
            <h3 className="text-sm font-bold text-[var(--fg-2)]">{t('dashboard.pendingDeliveryTitle')}</h3>
            <ChevronRight className="w-3 h-3 text-[var(--fg-4)] ml-auto group-hover:text-warning transition-colors" />
          </div>
          {loading || !funnel ? <Skeleton className="h-8 w-20" /> : (
            <>
              <p className="text-2xl font-bold text-warning">{funnel.pendingDelivery.count} <span className="text-sm font-normal text-[var(--fg-3)]">{t('dashboard.items')}</span></p>
              <p className="text-xs text-[var(--fg-4)] mt-1">{t('dashboard.pendingValue', { amount: fmt(funnel.pendingDelivery.value) })}</p>
            </>
          )}
        </button>

        {/* Critical Stock */}
        <button
          onClick={() => navigate('/stock')}
          className="phopy-card p-4 border border-warning/20 text-left cursor-pointer hover:border-warning/50 transition-colors group"
          aria-label={t('dashboard.criticalStock')}
        >
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-4 h-4 text-warning" />
            <h3 className="text-sm font-bold text-[var(--fg-2)]">{t('dashboard.criticalStock')}</h3>
            <ChevronRight className="w-3 h-3 text-[var(--fg-4)] ml-auto group-hover:text-warning transition-colors" />
          </div>
          {loading ? <Skeleton className="h-8 w-20" /> : (
            <>
              <p className="text-2xl font-bold text-warning">{lowStock.length} <span className="text-sm font-normal text-[var(--fg-3)]">{t('dashboard.items')}</span></p>
              {lowStock.slice(0, 2).map(s => (
                <p key={s.id} className="text-xs text-[var(--fg-4)] truncate">{s.name} · {t('dashboard.remaining', { quantity: s.quantity, unit: s.unit })}</p>
              ))}
            </>
          )}
        </button>

        {/* Overdue Invoices */}
        <button
          onClick={() => navigate('/receivables')}
          className="phopy-card p-4 border border-danger/20 text-left cursor-pointer hover:border-danger/50 transition-colors group"
          aria-label={t('dashboard.overdueInvoices')}
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-danger" />
            <h3 className="text-sm font-bold text-[var(--fg-2)]">{t('dashboard.overdueInvoices')}</h3>
            <ChevronRight className="w-3 h-3 text-[var(--fg-4)] ml-auto group-hover:text-danger transition-colors" />
          </div>
          {loading || !cf ? <Skeleton className="h-8 w-20" /> : (
            <>
              <p className="text-2xl font-bold text-danger">{cf.ar.overdue.length} <span className="text-sm font-normal text-[var(--fg-3)]">{t('dashboard.items')}</span></p>
              <p className="text-xs text-[var(--fg-4)] mt-1">{t('dashboard.receivable', { amount: fmt(cf.ar.overdue.reduce((s,i) => s + i.amount, 0)) })}</p>
              {cf.ar.overdue.slice(0, 2).map(i => (
                <p key={i.id} className="text-xs text-danger/70 truncate">{i.party_name} · {fmt(i.amount)}</p>
              ))}
            </>
          )}
        </button>
      </motion.div>

    </motion.div>
  )
}
