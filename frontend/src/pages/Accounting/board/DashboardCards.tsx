import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Receipt, AlertTriangle, Wallet, ChevronRight, FileText, Users,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import api from '../../../services/api'

// ---- Types ----
export type DashboardPeriod = 'day' | 'week' | 'month' | 'year'

interface OpexMonth { total: number; recurring: number; revenue: number; cogs: number; netProfit: number }
interface OpexAccount { code: string; name: string; current: number; previous: number; isRecurring: boolean | null }
interface OpexData {
  month: string; prevMonth: string; hasEnoughHistory: boolean
  current: OpexMonth; previous: OpexMonth
  accounts: OpexAccount[]; others: { count: number; current: number; previous: number }
  monthlyRecurringAvg: number
}

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

// ---- Helpers ----
const fmt = (n: number | null | undefined) => {
  if (n === null || n === undefined || isNaN(n)) return '฿0'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${sign}฿${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}฿${(abs / 1_000).toFixed(1)}K`
  return `${sign}฿${abs.toLocaleString()}`
}

const fmtShort = (n: number | null | undefined) => {
  if (n === null || n === undefined || isNaN(n)) return '0'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}K`
  return `${sign}${abs.toLocaleString()}`
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-[var(--border)]/30 rounded animate-pulse ${className}`} />
}

const PERIOD_KEYS: Record<DashboardPeriod, string> = {
  day: 'dashboard.today',
  week: 'dashboard.7days',
  month: 'dashboard.30days',
  year: 'dashboard.year',
}

// ---- 1. OpexCard ----
export function OpexCard() {
  const { t } = useTranslation()
  const [data, setData] = useState<OpexData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const res = await api.get('/dashboard/opex')
      if (res.data?.success) {
        setData(res.data.data)
        setError(false)
      } else {
        setError(true)
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    const timer = setInterval(loadData, 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [loadData])

  const maxAmt = Math.max(1, ...(data?.accounts ?? []).map(a => Math.max(a.current, a.previous)))
  const net = data?.current.netProfit ?? 0

  return (
    <div className="phopy-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Receipt className="w-4 h-4 text-[var(--danger)]" />
        <h3 className="font-bold text-[var(--fg-1)]">{t('dashboard.opex.title')}</h3>
        <span className="text-xs text-[var(--fg-4)] ml-auto">{t('dashboard.opex.monthLabel')}{data ? ` · ${data.month}` : ''}</span>
      </div>
      {error && !data ? (
        <p className="text-[var(--fg-4)] text-sm text-center py-6">{t('dashboard.opex.loadError')}</p>
      ) : loading || !data ? (
        <div className="space-y-3"><Skeleton className="h-16" />{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <p className="text-xs text-[var(--fg-4)]">{t('dashboard.opex.total')}</p>
              <p className="text-2xl font-bold text-danger tabular-nums mt-0.5">{fmt(data.current.total)}</p>
              <p className="text-xs text-[var(--fg-4)] mt-0.5">{t('dashboard.opex.prevMonth', { amount: fmt(data.previous.total) })}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--fg-4)]">{t('dashboard.opex.recurring')}</p>
              <p className="text-2xl font-bold text-[var(--fg-1)] tabular-nums mt-0.5">{data.hasEnoughHistory ? fmt(data.current.recurring) : '—'}</p>
              {data.hasEnoughHistory && <p className="text-xs text-[var(--fg-4)] mt-0.5">{t('dashboard.opex.recurringPrev', { amount: fmt(data.previous.recurring) })}</p>}
            </div>
            <div>
              <p className="text-xs text-[var(--fg-4)]">{t('dashboard.opex.netProfit')}</p>
              <p className={`text-2xl font-bold tabular-nums mt-0.5 ${net >= 0 ? 'text-success' : 'text-danger'}`}>{fmt(net)}</p>
              <p className="text-[11px] text-[var(--fg-4)] mt-0.5">{t('dashboard.opex.formula', { revenue: fmt(data.current.revenue), cogs: fmt(data.current.cogs), opex: fmt(data.current.total) })}</p>
            </div>
          </div>

          {!data.hasEnoughHistory && (
            <div className="flex items-start gap-2 mb-3 p-2.5 rounded-lg bg-[var(--warning-soft)] border border-warning/20">
              <AlertTriangle className="w-3.5 h-3.5 text-warning flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-warning leading-relaxed">{t('dashboard.opex.notEnoughHistory')}</p>
            </div>
          )}

          {data.accounts.length === 0 ? (
            <p className="text-[var(--fg-4)] text-sm text-center py-4">{t('dashboard.opex.empty')}</p>
          ) : (
            <div className="space-y-2">
              {data.accounts.map(a => (
                <div key={a.code} className="flex items-center gap-3">
                  <div className="w-36 sm:w-44 flex-shrink-0 min-w-0">
                    <p className="text-xs text-[var(--fg-2)] truncate" title={`${a.code} ${a.name}`}>{a.name}</p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-[var(--fg-4)] font-mono">{a.code}</span>
                      {a.isRecurring !== null && (
                        <span className={`text-[10px] px-1.5 rounded-full ${a.isRecurring ? 'bg-[var(--danger-soft)] text-[var(--danger)]' : 'bg-[var(--surface-2)] text-[var(--fg-4)]'}`}>
                          {t(a.isRecurring ? 'dashboard.opex.badgeRecurring' : 'dashboard.opex.badgeOneOff')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
                    <div className="h-full rounded-full bg-[var(--danger)]" style={{ width: `${Math.max(0, Math.min(100, (a.current / maxAmt) * 100))}%` }} />
                  </div>
                  <div className="w-24 text-right flex-shrink-0">
                    <p className="text-sm font-bold tabular-nums text-[var(--fg-1)]">{fmt(a.current)}</p>
                    <p className="text-[10px] text-[var(--fg-4)] tabular-nums">{t('dashboard.opex.colPrev')} {fmt(a.previous)}</p>
                  </div>
                </div>
              ))}
              {data.others.count > 0 && (
                <div className="flex items-center justify-between text-xs text-[var(--fg-4)] pt-1">
                  <span>{t('dashboard.opex.others', { count: data.others.count })}</span>
                  <span className="tabular-nums">{fmt(data.others.current)} · {t('dashboard.opex.colPrev')} {fmt(data.others.previous)}</span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---- 2. CashJourneyCard ----
export function CashJourneyCard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [pipeline, setPipeline] = useState<Pipeline | null>(null)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    try {
      const res = await api.get('/dashboard/pipeline')
      if (res.data?.success) {
        setPipeline(res.data.data)
      }
    } catch {
      // error handled silently
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    const timer = setInterval(loadData, 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [loadData])

  const waterfallRows = pipeline ? [
    { labelKey: 'dashboard.wfOrdered',     value: pipeline.waterfall.ordered,     color: 'var(--primary)' },
    { labelKey: 'dashboard.wfInvoiced',    value: pipeline.waterfall.invoiced,    color: 'var(--info)' },
    { labelKey: 'dashboard.wfCollected',   value: pipeline.waterfall.collected,   color: 'var(--success)' },
    { labelKey: 'dashboard.wfOutstanding', value: pipeline.waterfall.outstanding, color: 'var(--danger)' },
  ] : []
  const waterfallMax = Math.max(1, ...waterfallRows.map(r => r.value))

  return (
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
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, (value / waterfallMax) * 100))}%`, background: color }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </button>
  )
}

// ---- 3. PipelineCard ----
export function PipelineCard() {
  const { t } = useTranslation()
  const [pipeline, setPipeline] = useState<Pipeline | null>(null)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    try {
      const res = await api.get('/dashboard/pipeline')
      if (res.data?.success) {
        setPipeline(res.data.data)
      }
    } catch {
      // error handled silently
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    const timer = setInterval(loadData, 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [loadData])

  const pipelineRows = pipeline ? [
    { key: 'quoting',  labelKey: 'dashboard.stageQuoting',  data: pipeline.stages.quoting,  color: 'var(--info)' },
    { key: 'awaiting', labelKey: 'dashboard.stageAwaiting', data: pipeline.stages.awaiting, color: 'var(--warning)' },
    { key: 'won',      labelKey: 'dashboard.stageWon',      data: pipeline.stages.won,      color: 'var(--success)' },
    { key: 'lost',     labelKey: 'dashboard.stageLost',     data: pipeline.stages.lost,     color: 'var(--fg-4)' },
  ] : []
  const pipelineMaxCount = Math.max(1, ...pipelineRows.map(r => r.data.count))

  return (
    <div className="phopy-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <FileText className="w-4 h-4 text-[var(--primary)]" />
        <h3 className="font-bold text-[var(--fg-1)]">{t('dashboard.salesPipeline')}</h3>
        {pipeline && typeof pipeline.winRate === 'number' && (
          <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
            {t('dashboard.winRate', { percent: pipeline.winRate.toFixed(0) })}
          </span>
        )}
      </div>
      {loading || !pipeline ? (
        <div className="space-y-3">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
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

          {(pipeline?.linkage?.soDirect ?? 0) > 0 && (
            <div className="flex items-start gap-2 mt-4 p-2.5 rounded-lg bg-[var(--warning-soft)] border border-warning/20">
              <AlertTriangle className="w-3.5 h-3.5 text-warning flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-warning leading-relaxed">
                {t('dashboard.pipelineUnlinked', {
                  direct: pipeline?.linkage?.soDirect ?? 0,
                  total: pipeline?.linkage?.soTotal ?? 0,
                })}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---- 4. TopCustomersCard ----
export function TopCustomersCard({ period }: { period: DashboardPeriod }) {
  const { t } = useTranslation()
  const [topCustomers, setTopCustomers] = useState<TopCustomer[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async (p: DashboardPeriod) => {
    setLoading(true)
    try {
      const res = await api.get(`/dashboard/top-customers?period=${p}`)
      if (res.data?.success) {
        setTopCustomers(res.data.data)
      } else {
        setTopCustomers([])
      }
    } catch {
      setTopCustomers([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData(period)
    const timer = setInterval(() => loadData(period), 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [period, loadData])

  const periodLabel = t(PERIOD_KEYS[period])

  return (
    <div className="phopy-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Users className="w-4 h-4 text-[var(--primary)]" />
        <h3 className="font-bold text-[var(--fg-1)]">{t('dashboard.top5Customers')}</h3>
        <span className="text-xs text-[var(--fg-4)] ml-auto">{periodLabel}</span>
      </div>
      {loading || topCustomers.length === 0 ? (
        topCustomers.length === 0 && !loading
          ? <p className="text-[var(--fg-4)] text-sm text-center py-8">{t('dashboard.noInvoiceData', { period: periodLabel })}</p>
          : <div className="space-y-2">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
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
  )
}
