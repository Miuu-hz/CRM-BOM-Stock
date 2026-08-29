import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, PieChart, Pie, Cell, ResponsiveContainer
} from 'recharts'
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle,
  Users, Package, Wrench, BarChart3, Calendar, RefreshCw
} from 'lucide-react'
import { format, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear, subMonths } from 'date-fns'
import toast from 'react-hot-toast'
import { phopyBoardApi, PhopyBoardData } from '../../services/phopyBoard'
import PhopyBoardExtended from './PhopyBoardExtended'
import { unitLabel } from '../../hooks/useUnits'

type PeriodPreset = 'month' | 'quarter' | 'year' | 'custom'

const BU_LABELS: Record<string, string> = {
  RETAIL: 'ค้าปลีก (หน้าร้าน)',
  WHOLESALE: 'ขายส่ง',
  ONLINE: 'ออนไลน์',
  OTHER: 'อื่นๆ',
}

const TIER_COLORS: Record<string, string> = {
  Champion: 'var(--success, #22c55e)',
  Loyal: 'var(--primary)',
  'At-Risk': 'var(--warning, #f59e0b)',
  Lost: 'var(--danger)',
}

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, delay },
})

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtDec(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtPct(n: number) {
  return n.toFixed(1) + '%'
}

function DeltaBadge({ curr, prev }: { curr: number; prev: number }) {
  if (prev === 0) return null
  const pct = ((curr - prev) / prev) * 100
  const up = pct >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? 'text-[color:var(--success,#22c55e)]' : 'text-[color:var(--danger)]'}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

function KPICard({ label, value, prefix = '฿', prev, delay = 0 }: { label: string; value: number; prefix?: string; prev?: number; delay?: number }) {
  return (
    <motion.div {...fade(delay)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex flex-col gap-2 min-w-0">
      <p className="text-xs text-[var(--fg-3)] font-medium uppercase tracking-wide truncate">{label}</p>
      <p className="text-2xl font-bold text-[var(--fg-1)] truncate">{prefix}{fmt(value)}</p>
      {prev !== undefined && <DeltaBadge curr={value} prev={prev} />}
    </motion.div>
  )
}

function SignalDot({ status }: { status: 'ok' | 'warn' | 'danger' }) {
  const cls = status === 'ok' ? 'bg-[color:var(--success,#22c55e)]' : status === 'warn' ? 'bg-[color:var(--warning,#f59e0b)]' : 'bg-[color:var(--danger)]'
  return <span className={`inline-block w-2.5 h-2.5 rounded-full flex-none ${cls}`} />
}

const WO_COLORS = ['#6366f1', '#3b82f6', '#f59e0b', '#22c55e', '#ef4444']

export default function PhopyBoard() {
  const [preset, setPreset] = useState<PeriodPreset>('month')
  const [customStart, setCustomStart] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [customEnd, setCustomEnd] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [data, setData] = useState<PhopyBoardData | null>(null)
  const [loading, setLoading] = useState(false)

  const getRange = useCallback(() => {
    const now = new Date()
    if (preset === 'month') return { startDate: format(startOfMonth(now), 'yyyy-MM-dd'), endDate: format(endOfMonth(now), 'yyyy-MM-dd') }
    if (preset === 'quarter') return { startDate: format(startOfQuarter(now), 'yyyy-MM-dd'), endDate: format(endOfQuarter(now), 'yyyy-MM-dd') }
    if (preset === 'year') return { startDate: format(startOfYear(now), 'yyyy-MM-dd'), endDate: format(endOfYear(now), 'yyyy-MM-dd') }
    return { startDate: customStart, endDate: customEnd }
  }, [preset, customStart, customEnd])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const range = getRange()
      const res = await phopyBoardApi.getSummary(range)
      setData(res.data.data)
    } catch {
      toast.error('ไม่สามารถโหลดข้อมูล Phopy Board ได้')
    } finally {
      setLoading(false)
    }
  }, [getRange])

  useEffect(() => { load() }, [load])

  const agingLabels = ['0-30 วัน', '31-60 วัน', '61-90 วัน', '91-120 วัน', '120+ วัน']

  const arData = data ? [
    { name: 'AR', ...buildAging(data.arAging) }
  ] : []
  const apData = data ? [
    { name: 'AP', ...buildAging(data.apAging) }
  ] : []

  const woData = data ? [
    { name: 'Draft', value: data.workOrders.draft },
    { name: 'Planned', value: data.workOrders.planned },
    { name: 'In Progress', value: data.workOrders.inProgress },
    { name: 'Completed', value: data.workOrders.completed },
    { name: 'Cancelled', value: data.workOrders.cancelled },
  ].filter(w => w.value > 0) : []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-1)]">Phopy Board</h1>
          <p className="text-sm text-[var(--fg-3)]">Executive overview · {data?.period.start} – {data?.period.end}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['month', 'quarter', 'year', 'custom'] as PeriodPreset[]).map(p => (
            <button key={p} onClick={() => setPreset(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${preset === p ? 'bg-[var(--primary)] text-white' : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-2)] hover:border-[var(--primary)]'}`}>
              {p === 'month' ? 'เดือนนี้' : p === 'quarter' ? 'ไตรมาส' : p === 'year' ? 'ปีนี้' : 'กำหนดเอง'}
            </button>
          ))}
          {preset === 'custom' && (
            <>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                className="px-2 py-1.5 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] text-[var(--fg-1)]" />
              <span className="text-[var(--fg-3)]">–</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                className="px-2 py-1.5 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] text-[var(--fg-1)]" />
            </>
          )}
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-2)] hover:border-[var(--primary)] transition-colors disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            รีเฟรช
          </button>
        </div>
      </div>

      {loading && !data && (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-[var(--primary)]/30 border-t-[var(--primary)] rounded-full animate-spin" />
        </div>
      )}

      {data && (
        <>
          {/* Zone 1 — KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <KPICard label="รายได้รวม" value={data.kpis.revenue} prev={data.kpis.prevRevenue} delay={0} />
            <KPICard label="ต้นทุนวัตถุดิบ" value={data.kpis.cost} delay={0.05} />
            <KPICard label="กำไรขั้นต้น" value={data.kpis.grossProfit} prev={data.kpis.prevGrossProfit} delay={0.1} />
            <KPICard label="กำไรสุทธิ" value={data.kpis.netProfit} delay={0.15} />
            <KPICard label="Gross Margin" value={data.kpis.grossMarginPct} prefix="" delay={0.2}
            />
          </div>

          {/* Zone 1b — Business-Unit P&L */}
          <motion.div {...fade(0.22)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <h2 className="text-sm font-semibold text-[var(--fg-2)] mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[var(--primary)]" /> กำไรขาดทุนตามหน่วยธุรกิจ
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    {['หน่วยธุรกิจ', 'รายได้', 'ต้นทุนขาย', 'ค่าใช้จ่าย', 'กำไรสุทธิ'].map(h => (
                      <th key={h} className="pb-2 text-right first:text-left font-semibold text-[var(--fg-3)]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.businessUnits.map(bu => (
                    <tr key={bu.unit} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-2 font-medium text-[var(--fg-1)]">{BU_LABELS[bu.unit] || bu.unit}</td>
                      <td className="py-2 text-right text-[var(--fg-1)]">฿{fmt(bu.revenue)}</td>
                      <td className="py-2 text-right text-[color:var(--danger)]">฿{fmt(bu.cogs)}</td>
                      <td className="py-2 text-right text-[var(--fg-3)]">฿{fmt(bu.expense)}</td>
                      <td className={`py-2 text-right font-semibold ${bu.netProfit >= 0 ? 'text-[color:var(--success,#22c55e)]' : 'text-[color:var(--danger)]'}`}>฿{fmt(bu.netProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>

          {/* Zone 2 — Revenue Chart + P&L Table */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <motion.div {...fade(0.25)} className="xl:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
              <h2 className="text-sm font-semibold text-[var(--fg-2)] mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[var(--primary)]" /> รายได้ vs ต้นทุน (12 เดือน)
              </h2>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={data.revenueChart} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--fg-3)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--fg-3)' }} tickFormatter={v => (v / 1000).toFixed(0) + 'K'} />
                  <Tooltip formatter={(v: number) => '฿' + fmt(v)} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="revenue" name="รายได้" fill="var(--primary)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="cost" name="ต้นทุน" fill="var(--danger)" radius={[3, 3, 0, 0]} />
                  <Line dataKey="grossProfit" name="กำไรขั้นต้น" type="monotone" stroke="#22c55e" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </motion.div>

            <motion.div {...fade(0.3)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 overflow-auto">
              <h2 className="text-sm font-semibold text-[var(--fg-2)] mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[var(--primary)]" /> P&L รายเดือน
              </h2>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    {['เดือน', 'รายได้', 'ต้นทุน', 'กำไร', '%'].map(h => (
                      <th key={h} className="pb-2 text-right first:text-left font-semibold text-[var(--fg-3)]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.plTable.map(row => (
                    <tr key={row.month} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-1.5 text-[var(--fg-2)]">{row.month}</td>
                      <td className="py-1.5 text-right text-[var(--fg-1)]">{fmt(row.revenue)}</td>
                      <td className="py-1.5 text-right text-[color:var(--danger)]">{fmt(row.cogs)}</td>
                      <td className={`py-1.5 text-right font-medium ${row.grossProfit >= 0 ? 'text-[color:var(--success,#22c55e)]' : 'text-[color:var(--danger)]'}`}>{fmt(row.grossProfit)}</td>
                      <td className="py-1.5 text-right text-[var(--fg-3)]">{fmtPct(row.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </motion.div>
          </div>

          {/* Zone 3 — AR / AP Aging */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AgingCard title="ลูกหนี้ (AR) — อายุหนี้" aging={data.arAging} />
            <AgingCard title="เจ้าหนี้ (AP) — อายุหนี้" aging={data.apAging} />
          </div>

          {/* Zone 4 — Customer Intelligence */}
          <motion.div {...fade(0.4)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <h2 className="text-sm font-semibold text-[var(--fg-2)] mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-[var(--primary)]" /> Customer Intelligence
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    {['ลูกค้า', 'Tier', 'รายได้ปัจจุบัน', 'เทียบงวดก่อน', 'Trend', 'ค้างชำระ / วงเงิน', 'ไม่ซื้อมา'].map(h => (
                      <th key={h} className="pb-2 text-left font-semibold text-[var(--fg-3)] pr-4 last:pr-0">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.customers.map(c => (
                    <tr key={c.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)] transition-colors">
                      <td className="py-2 pr-4 font-medium text-[var(--fg-1)] max-w-[160px] truncate">{c.name}</td>
                      <td className="py-2 pr-4">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold text-white" style={{ background: TIER_COLORS[c.tier] || 'var(--fg-3)' }}>
                          {c.tier}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-[var(--fg-1)]">฿{fmt(c.currentRevenue)}</td>
                      <td className="py-2 pr-4 text-[var(--fg-3)]">฿{fmt(c.prevRevenue)}</td>
                      <td className="py-2 pr-4">
                        {c.trend === 'up' ? <TrendingUp className="w-4 h-4 text-[color:var(--success,#22c55e)]" /> : c.trend === 'down' ? <TrendingDown className="w-4 h-4 text-[color:var(--danger)]" /> : <Minus className="w-4 h-4 text-[var(--fg-3)]" />}
                      </td>
                      <td className="py-2 pr-4 min-w-[140px]">
                        {c.creditLimit > 0 ? (
                          <div className="space-y-1">
                            <div className="flex justify-between text-xs text-[var(--fg-3)]">
                              <span>฿{fmt(c.creditUsed)}</span>
                              <span>฿{fmt(c.creditLimit)}</span>
                            </div>
                            <div className="h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${Math.min((c.creditUsed / c.creditLimit) * 100, 100)}%`, background: c.creditUsed / c.creditLimit > 0.8 ? 'var(--danger)' : 'var(--primary)' }} />
                            </div>
                          </div>
                        ) : <span className="text-[var(--fg-4)] text-xs">ไม่มีวงเงิน</span>}
                      </td>
                      <td className="py-2">
                        <span className={`text-xs font-medium ${c.lastOrderDays > 60 ? 'text-[color:var(--danger)]' : c.lastOrderDays > 30 ? 'text-[color:var(--warning,#f59e0b)]' : 'text-[var(--fg-3)]'}`}>
                          {c.lastOrderDays === 999 ? 'ไม่เคย' : `${c.lastOrderDays} วัน`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>

          {/* Zone 5 — Work Orders + Stock Alerts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <motion.div {...fade(0.45)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
              <h2 className="text-sm font-semibold text-[var(--fg-2)] mb-4 flex items-center gap-2">
                <Wrench className="w-4 h-4 text-[var(--primary)]" /> Work Orders
                {data.workOrders.costVariance !== 0 && (
                  <span className={`ml-auto text-xs font-medium ${data.workOrders.costVariance > 10 ? 'text-[color:var(--danger)]' : 'text-[var(--fg-3)]'}`}>
                    Cost variance: {data.workOrders.costVariance > 0 ? '+' : ''}{fmtPct(data.workOrders.costVariance)}
                  </span>
                )}
              </h2>
              {woData.length > 0 ? (
                <div className="flex items-center gap-6">
                  <ResponsiveContainer width={160} height={160}>
                    <PieChart>
                      <Pie data={woData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                        {woData.map((_, i) => <Cell key={i} fill={WO_COLORS[i % WO_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => [v, 'จำนวน']} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-2">
                    {woData.map((w, i) => (
                      <div key={w.name} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-[var(--fg-2)]">
                          <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: WO_COLORS[i % WO_COLORS.length] }} />
                          {w.name}
                        </span>
                        <span className="font-semibold text-[var(--fg-1)]">{w.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[var(--fg-4)] text-center py-8">ไม่มีข้อมูล Work Orders ในช่วงนี้</p>
              )}
            </motion.div>

            <motion.div {...fade(0.5)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
              <h2 className="text-sm font-semibold text-[var(--fg-2)] mb-4 flex items-center gap-2">
                <Package className="w-4 h-4 text-[color:var(--warning,#f59e0b)]" /> Stock Alert ({data.stockAlerts.length} รายการ)
              </h2>
              {data.stockAlerts.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-[color:var(--success,#22c55e)] py-4">
                  <CheckCircle className="w-5 h-5" /> Stock ทุกรายการอยู่ในระดับปกติ
                </div>
              ) : (
                <div className="space-y-2">
                  {data.stockAlerts.map(s => (
                    <div key={s.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-[var(--surface-2)]">
                      <AlertTriangle className="w-4 h-4 text-[color:var(--warning,#f59e0b)] flex-none" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--fg-1)] truncate">{s.name}</p>
                        <p className="text-xs text-[var(--fg-3)]">คงเหลือ {s.quantity} {unitLabel(s.unit)} · min {s.minStock}</p>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.quantity <= 0 ? 'bg-[var(--danger-soft)] text-[color:var(--danger)]' : 'bg-[var(--warning)]/10 text-[color:var(--warning,#f59e0b)]'}`}>
                        {s.quantity <= 0 ? 'หมด' : `${s.daysRemaining}d`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </div>

          {/* Zone 6 — Early Warning Signals */}
          <motion.div {...fade(0.55)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <h2 className="text-sm font-semibold text-[var(--fg-2)] mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[color:var(--warning,#f59e0b)]" /> Early Warning Signals
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {data.earlyWarnings.map(w => (
                <div key={w.id} className={`rounded-xl p-4 border ${w.status === 'ok' ? 'border-[var(--border)] bg-[var(--surface-2)]' : w.status === 'warn' ? 'border-[var(--warning)]/30 bg-[var(--warning)]/5' : 'border-[var(--danger)]/30 bg-[var(--danger-soft)]'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <SignalDot status={w.status} />
                    <p className="text-xs font-semibold text-[var(--fg-2)] leading-tight">{w.label}</p>
                  </div>
                  <p className={`text-lg font-bold ${w.status === 'ok' ? 'text-[color:var(--success,#22c55e)]' : w.status === 'warn' ? 'text-[color:var(--warning,#f59e0b)]' : 'text-[color:var(--danger)]'}`}>
                    {w.value}
                  </p>
                  <p className="text-xs text-[var(--fg-4)] mt-1 leading-tight">{w.detail}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
      <PhopyBoardExtended startDate={getRange().startDate} endDate={getRange().endDate} />
    </div>
  )
}

function buildAging(aging: { current: number; days30: number; days60: number; days90: number; over90: number }) {
  return {
    '0-30วัน': aging.current,
    '31-60วัน': aging.days30,
    '61-90วัน': aging.days60,
    '91-120วัน': aging.days90,
    '120+วัน': aging.over90,
  }
}

function AgingCard({ title, aging }: { title: string; aging: { current: number; days30: number; days60: number; days90: number; over90: number } }) {
  const chartData = [buildAging(aging)]
  const keys = ['0-30วัน', '31-60วัน', '61-90วัน', '91-120วัน', '120+วัน']
  const COLORS = ['#22c55e', '#6366f1', '#f59e0b', '#f97316', '#ef4444']
  const total = aging.current + aging.days30 + aging.days60 + aging.days90 + aging.over90

  return (
    <motion.div {...fade(0.35)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
      <h2 className="text-sm font-semibold text-[var(--fg-2)] mb-1 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-[var(--primary)]" /> {title}
      </h2>
      <p className="text-xs text-[var(--fg-3)] mb-4">รวม ฿{fmt(total)}</p>
      <ResponsiveContainer width="100%" height={80}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" hide />
          <Tooltip formatter={(v: number) => '฿' + fmt(v)} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
          {keys.map((k, i) => <Bar key={k} dataKey={k} stackId="a" fill={COLORS[i]} radius={i === 0 ? [4, 0, 0, 4] : i === keys.length - 1 ? [0, 4, 4, 0] : [0, 0, 0, 0]} />)}
        </BarChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-2 mt-3">
        {keys.map((k, i) => (
          <span key={k} className="flex items-center gap-1 text-xs text-[var(--fg-3)]">
            <span className="w-2 h-2 rounded-full flex-none" style={{ background: COLORS[i] }} />{k}
          </span>
        ))}
      </div>
    </motion.div>
  )
}
