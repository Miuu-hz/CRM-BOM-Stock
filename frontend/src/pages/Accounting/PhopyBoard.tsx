import { useState, useEffect, useCallback, Fragment } from 'react'
import { motion } from 'framer-motion'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, ResponsiveContainer
} from 'recharts'
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle,
  Users, Package, Wrench, BarChart3, RefreshCw, ChevronRight
} from 'lucide-react'
import { format, startOfMonth } from 'date-fns'
import toast from 'react-hot-toast'
import {
  phopyBoardApi,
  PhopyBoardData,
  PhopyBoardExtendedData,
  CfoSummaryData,
} from '../../services/phopyBoard'
import {
  ChannelPerformance,
  AdsRoi,
  CostStructure,
  ProductProfitability,
  WorkingCapital,
  OutsourceProduction,
} from './PhopyBoardExtended'
import { CogsAnalysisCard, PosSalesCard, CashDrawerCard, AgingCard, WarningCard } from './PhopyBoardAccuracy'
import { unitLabel } from '../../hooks/useUnits'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { canViewMenu } from '../../config/menuPermissions'
import Receivables from '../Receivables'
import { PeriodPreset, ComparePreset, periodRange } from './board/period'
import { BoardTrendCard } from './board/BoardTrendCard'
import { CfoSummaryCard } from './board/CfoSummaryCard'
import { ChecklistGateCard } from './board/ChecklistGateCard'
import { BudgetVsActualCard } from './board/BudgetVsActualCard'
import {
  OpexCard,
  CashJourneyCard,
  PipelineCard,
  TopCustomersCard,
} from './board/DashboardCards'

const BU_LABELS: Record<string, string> = {
  RETAIL: 'ค้าปลีก (หน้าร้าน)',
  WHOLESALE: 'ขายส่ง',
  ONLINE: 'ออนไลน์',
  OTHER: 'ส่วนกลาง (ไม่ระบุหน่วย)',
}

const TIER_COLORS: Record<string, string> = {
  Champion: 'var(--success, #22c55e)',
  Loyal: 'var(--primary)',
  'At-Risk': 'var(--warning, #f59e0b)',
  Lost: 'var(--danger)',
}

const CHAPTERS = [
  { id: 1, title: '1 สรุปจาก CFO' },
  { id: 2, title: '2 เงินสดและสภาพคล่อง' },
  { id: 3, title: '3 การเติบโตและกำไร' },
  { id: 4, title: '4 ประสิทธิภาพ' },
  { id: 5, title: '5 ลูกค้าและตลาด' },
  { id: 6, title: '6 ความเสี่ยงและการควบคุม' },
  { id: 7, title: '7 แผนเทียบจริง' },
] as const

const PERIOD_PRESETS: Array<{ id: PeriodPreset; label: string }> = [
  { id: 'month', label: 'เดือน' },
  { id: 'quarter', label: 'ไตรมาส' },
  { id: 'year', label: 'ปี' },
  { id: '3y', label: '3 ปี' },
  { id: '5y', label: '5 ปี' },
  { id: 'custom', label: 'กำหนดเอง' },
]

const COMPARE_PRESETS: Array<{ id: ComparePreset; label: string }> = [
  { id: 'prev', label: 'งวดก่อน' },
  { id: 'yoy', label: 'ช่วงเดียวกันปีก่อน' },
  { id: 'budget', label: 'งบประมาณ' },
]

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, delay },
})

function fmt(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtPct(n: number) {
  return n.toFixed(1) + '%'
}

function ComingSoonCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--fg-2)]">{title}</h3>
        <span className="text-xs px-2.5 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--fg-3)] font-medium">เร็ว ๆ นี้</span>
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        {items.map(it => (
          <span key={it} className="text-xs px-2.5 py-1 rounded-lg bg-[var(--surface-2)] text-[var(--fg-3)]">
            {it}
          </span>
        ))}
      </div>
    </div>
  )
}

const WO_COLORS = ['#6366f1', '#3b82f6', '#f59e0b', '#22c55e', '#ef4444']

export default function PhopyBoard() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const canAR = canViewMenu(user?.role, '/receivables', user?.departments)
  const isReceivables = canAR && params.get('view') === 'receivables'
  const activeChapter = parseInt(params.get('chapter') || '1', 10) || 1

  const [preset, setPreset] = useState<PeriodPreset>('month')
  const [compare, setCompare] = useState<ComparePreset>('yoy')
  const [customStart, setCustomStart] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [customEnd, setCustomEnd] = useState(format(new Date(), 'yyyy-MM-dd'))

  const [data, setData] = useState<PhopyBoardData | null>(null)
  const [extendedData, setExtendedData] = useState<PhopyBoardExtendedData | null>(null)
  const [cfoSummary, setCfoSummary] = useState<CfoSummaryData | null>(null)
  const [loading, setLoading] = useState(false)
  const [openUnit, setOpenUnit] = useState<string | null>(null)

  const getRange = useCallback(() => {
    return periodRange(preset, new Date(), { startDate: customStart, endDate: customEnd })
  }, [preset, customStart, customEnd])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const range = getRange()
      const cfoCompare = compare === 'budget' ? 'yoy' : compare
      const [sumRes, extRes, cfoRes] = await Promise.allSettled([
        phopyBoardApi.getSummary(range),
        phopyBoardApi.getExtended(range),
        phopyBoardApi.getCfoSummary({ ...range, compare: cfoCompare }),
      ])

      if (sumRes.status === 'fulfilled') setData(sumRes.value.data.data)
      if (extRes.status === 'fulfilled') setExtendedData(extRes.value.data.data)
      if (cfoRes.status === 'fulfilled') setCfoSummary(cfoRes.value.data.data)
    } catch {
      toast.error('ไม่สามารถโหลดข้อมูล Phopy Board ได้')
    } finally {
      setLoading(false)
    }
  }, [getRange, compare])

  useEffect(() => {
    load()
  }, [load])

  const handleSelectChapter = (chId: number) => {
    const next = new URLSearchParams(params)
    next.delete('view')
    next.set('chapter', String(chId))
    setParams(next, { replace: true })
  }

  const handleSelectReceivables = () => {
    const next = new URLSearchParams(params)
    next.set('view', 'receivables')
    setParams(next, { replace: true })
  }

  const dateRange = getRange()
  const isLongPeriod = preset === '3y' || preset === '5y'
  const topCustPeriod = preset === 'month' ? 'month' : 'year'

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
          <p className="text-sm text-[var(--fg-3)]">
            Executive board pack · {dateRange.startDate} – {dateRange.endDate}
          </p>
        </div>

        {!isReceivables && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Period presets */}
            <div className="inline-flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
              {PERIOD_PRESETS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                    preset === p.id
                      ? 'bg-[var(--surface)] text-[var(--primary)] shadow-sm'
                      : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Compare presets */}
            <div className="inline-flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
              {COMPARE_PRESETS.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCompare(c.id)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                    compare === c.id
                      ? 'bg-[var(--surface)] text-[var(--primary)] shadow-sm'
                      : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'
                  }`}
                >
                  เทียบ: {c.label}
                </button>
              ))}
            </div>

            {preset === 'custom' && (
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  type="date"
                  value={customStart}
                  onChange={e => setCustomStart(e.target.value)}
                  className="px-2 py-1 text-xs border border-[var(--border)] rounded-lg bg-[var(--surface)] text-[var(--fg-1)]"
                />
                <span className="text-[var(--fg-3)] text-xs">–</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={e => setCustomEnd(e.target.value)}
                  className="px-2 py-1 text-xs border border-[var(--border)] rounded-lg bg-[var(--surface)] text-[var(--fg-1)]"
                />
              </div>
            )}

            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1 px-2.5 py-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-xs font-medium text-[var(--fg-2)] hover:border-[var(--primary)] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              รีเฟรช
            </button>
          </div>
        )}
      </div>

      {/* Chapter menu / tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-[var(--border)]" role="tablist">
        {CHAPTERS.map(ch => (
          <button
            key={ch.id}
            type="button"
            role="tab"
            aria-selected={!isReceivables && activeChapter === ch.id}
            onClick={() => handleSelectChapter(ch.id)}
            className={`px-3 py-2 -mb-px text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
              !isReceivables && activeChapter === ch.id
                ? 'border-[var(--primary)] text-[var(--primary)]'
                : 'border-transparent text-[var(--fg-3)] hover:text-[var(--fg-1)]'
            }`}
          >
            {ch.title}
          </button>
        ))}

        {canAR && (
          <button
            type="button"
            role="tab"
            aria-selected={isReceivables}
            onClick={handleSelectReceivables}
            className={`px-3 py-2 -mb-px text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
              isReceivables
                ? 'border-[var(--primary)] text-[var(--primary)]'
                : 'border-transparent text-[var(--fg-3)] hover:text-[var(--fg-1)]'
            }`}
          >
            ลูกหนี้ / เจ้าหนี้
          </button>
        )}
      </div>

      {isReceivables ? (
        <Receivables embedded />
      ) : (
        <>
          {loading && !data && !cfoSummary && (
            <div className="flex justify-center py-20">
              <div className="w-10 h-10 border-4 border-[var(--primary)]/30 border-t-[var(--primary)] rounded-full animate-spin" />
            </div>
          )}

          {/* ────────────────── Chapter 1: สรุปจาก CFO ────────────────── */}
          {activeChapter === 1 && (
            <div className="space-y-6">
              {cfoSummary && (
                <CfoSummaryCard data={cfoSummary} onNavigateChapter={handleSelectChapter} />
              )}

              {/* Trend Chart */}
              <BoardTrendCard
                startDate={dateRange.startDate}
                endDate={dateRange.endDate}
                isLongPeriod={isLongPeriod}
              />

            </div>
          )}

          {/* ────────────────── Chapter 2: เงินสดและสภาพคล่อง ────────────────── */}
          {activeChapter === 2 && (
            <div className="space-y-6">
              {/* Working Capital Health */}
              {extendedData && <WorkingCapital data={extendedData} />}

              {/* Aging cards + link ดูรายใบ */}
              {data && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[var(--fg-2)]">อายุหนี้ลูกหนี้และเจ้าหนี้</h3>
                    {canAR && (
                      <button
                        type="button"
                        onClick={handleSelectReceivables}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--primary)] hover:underline"
                      >
                        ดูรายใบ &rarr;
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <AgingCard
                      title="ลูกหนี้ (AR) — อายุหนี้"
                      source="ใบแจ้งหนี้ขายที่ค้างรับ ณ วันนี้"
                      detail={data.arDetail}
                      ledgerLabels={{
                        tradeAR: 'บัญชี 1104 ลูกหนี้การค้า',
                        posClearing: 'บัญชี 1180 ลูกหนี้-POS (รอเงินเข้า)',
                        posPayoutPending: 'บัญชี 1182 เงินจ่ายจาก POS รอจับคู่บิล',
                      }}
                    />
                    <AgingCard
                      title="เจ้าหนี้ (AP) — อายุหนี้"
                      source="ใบแจ้งหนี้ซื้อที่ค้างจ่าย ณ วันนี้"
                      detail={data.apDetail}
                      ledgerLabels={{
                        tradeAP: 'บัญชี 2101 เจ้าหนี้การค้า',
                        otherAP: 'บัญชี 2102 เจ้าหนี้อื่น',
                        grni: 'บัญชี 2109 รับของแล้วยังไม่ได้รับใบแจ้งหนี้',
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Cash Drawer + Cash Journey */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {data && <CashDrawerCard d={data.cashDrawer} />}
                <CashJourneyCard />
              </div>

              {/* Trend Chart */}
              <BoardTrendCard
                startDate={dateRange.startDate}
                endDate={dateRange.endDate}
                isLongPeriod={isLongPeriod}
              />

              {/* Placeholder: cash-cycle + operating cash flow vs profit */}
              <ComingSoonCard
                title="วงจรเงินสด และกระแสเงินสดจากการดำเนินงานเทียบกำไร"
                items={['วงจรเงินสด (DSO + DIO − DPO)', 'เงินสดจากการดำเนินงานเทียบกำไร (วัดคุณภาพกำไร)']}
              />
            </div>
          )}

          {/* ────────────────── Chapter 3: การเติบโตและกำไร ────────────────── */}
          {activeChapter === 3 && (
            <div className="space-y-6">
              {data && (
                <>
                  {/* Revenue Chart + P&L Table */}
                  <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                    <motion.div {...fade(0.1)} className="xl:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
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

                    <motion.div {...fade(0.15)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 overflow-auto">
                      <h2 className="text-sm font-semibold text-[var(--fg-2)] mb-3 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-[var(--primary)]" /> P&L รายเดือน
                      </h2>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-[var(--border)]">
                            {['เดือน', 'รายได้', 'ต้นทุนขาย', 'กำไรขั้นต้น', '%', 'เงินเดือน/ค่าแรง', 'ค่าใช้จ่ายอื่น', 'กำไรสุทธิ'].map(h => (
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
                              <td className="py-1.5 text-right text-[var(--fg-2)]">{fmt(row.labour)}</td>
                              <td className="py-1.5 text-right text-[var(--fg-2)]">{fmt(row.otherOpex)}</td>
                              <td className={`py-1.5 text-right font-medium ${row.netProfit >= 0 ? 'text-[color:var(--success,#22c55e)]' : 'text-[color:var(--danger)]'}`}>{fmt(row.netProfit)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {data.labour.total === 0 && (
                        <p className="mt-2 text-xs text-[var(--fg-4)]">ยังไม่มีเงินเดือน/ค่าแรงในบัญชี (5301 / 5103) ในช่วงนี้</p>
                      )}
                    </motion.div>
                  </div>

                  {/* Business-Unit P&L */}
                  <motion.div {...fade(0.2)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
                    <h2 className="text-sm font-semibold text-[var(--fg-2)] mb-4 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-[var(--primary)]" /> กำไรขาดทุนตามหน่วยธุรกิจ
                    </h2>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[560px]">
                        <thead>
                          <tr className="border-b border-[var(--border)]">
                            {['หน่วยธุรกิจ', 'รายได้', 'ต้นทุนขาย', 'ค่าใช้จ่าย', 'ขาด/เกิน·ปรับสต็อก', 'กำไรสุทธิ'].map(h => (
                              <th key={h} className="pb-2 text-right first:text-left font-semibold text-[var(--fg-3)]">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {data.businessUnits.filter(bu => bu.breakdown.length > 0 || bu.unit === 'RETAIL').map(bu => (
                            <Fragment key={bu.unit}>
                              <tr className="border-b border-[var(--border)] last:border-0">
                                <td className="py-2 font-medium text-[var(--fg-1)]">
                                  <button
                                    type="button"
                                    onClick={() => setOpenUnit(openUnit === bu.unit ? null : bu.unit)}
                                    aria-expanded={openUnit === bu.unit}
                                    className="inline-flex items-center gap-1 hover:text-[var(--primary)]"
                                    disabled={bu.breakdown.length === 0}
                                  >
                                    {bu.breakdown.length > 0 && (
                                      <ChevronRight className={`w-3.5 h-3.5 transition-transform ${openUnit === bu.unit ? 'rotate-90' : ''}`} />
                                    )}
                                    {BU_LABELS[bu.unit] || bu.unit}
                                  </button>
                                </td>
                                <td className="py-2 text-right text-[var(--fg-1)]">฿{fmt(bu.revenue)}</td>
                                <td className="py-2 text-right text-[color:var(--danger)]">฿{fmt(bu.cogs)}</td>
                                <td className="py-2 text-right text-[var(--fg-3)]">฿{fmt(bu.expense)}</td>
                                <td className={`py-2 text-right ${bu.adjust < 0 ? 'text-[color:var(--success,#22c55e)]' : 'text-[var(--fg-3)]'}`}>
                                  {bu.adjust < 0 ? `+฿${fmt(-bu.adjust)}` : `฿${fmt(bu.adjust)}`}
                                </td>
                                <td className={`py-2 text-right font-semibold ${bu.netProfit >= 0 ? 'text-[color:var(--success,#22c55e)]' : 'text-[color:var(--danger)]'}`}>
                                  ฿{fmt(bu.netProfit)}
                                </td>
                              </tr>
                              {openUnit === bu.unit && bu.breakdown.map(b => (
                                <tr key={b.referenceType} className="text-xs text-[var(--fg-3)] bg-[var(--surface-2)]">
                                  <td className="py-1.5 pl-6">{b.label} <span className="text-[var(--fg-4)]">({b.referenceType})</span></td>
                                  <td className="py-1.5 text-right">{b.revenue ? `฿${fmt(b.revenue)}` : '–'}</td>
                                  <td className="py-1.5 text-right">{b.cogs ? `฿${fmt(b.cogs)}` : '–'}</td>
                                  <td className="py-1.5 text-right">{b.expense ? `฿${fmt(b.expense)}` : '–'}</td>
                                  <td className="py-1.5 text-right">{b.adjust ? (b.adjust < 0 ? `+฿${fmt(-b.adjust)}` : `฿${fmt(b.adjust)}`) : '–'}</td>
                                  <td />
                                </tr>
                              ))}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </motion.div>
                </>
              )}

              {/* Cost Structure + Product Profitability */}
              {extendedData && (
                <>
                  <CostStructure data={extendedData} />
                  <ProductProfitability data={extendedData} />
                </>
              )}

              {/* PosSalesCard + OpexCard */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {data && <PosSalesCard p={data.posSales} />}
                <OpexCard />
              </div>

              {/* Placeholder: Break-even / prime cost / seasonality / CAGR */}
              <ComingSoonCard
                title="การวิเคราะห์การเติบโตและจุดคุ้มทุนเพิ่มเติม"
                items={['จุดคุ้มทุนและส่วนเผื่อความปลอดภัย (Break-even)', 'Prime Cost % (วัตถุดิบ + ค่าแรง)', 'ตารางฤดูกาล (Seasonality)', 'CAGR อัตราเติบโตเฉลี่ยสะสม']}
              />
            </div>
          )}

          {/* ────────────────── Chapter 4: ประสิทธิภาพ ────────────────── */}
          {activeChapter === 4 && (
            <div className="space-y-6">
              {/* CogsAnalysisCard */}
              {data && <CogsAnalysisCard a={data.cogsAnalysis} revenue={data.kpis.revenue} />}

              {/* Work Orders */}
              {data && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <motion.div {...fade(0.1)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
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
                </div>
              )}

              {/* Outsource production + Ads ROI */}
              {extendedData && (
                <>
                  <OutsourceProduction data={extendedData} />
                  <AdsRoi data={extendedData} />
                </>
              )}

              {/* Placeholder: Stock turnover / sales per labour baht */}
              <ComingSoonCard
                title="ตัวชี้วัดประสิทธิภาพเพิ่มเติม"
                items={['รอบหมุนสต็อก / สต็อกพอขายกี่วัน (Stock Turnover)', 'ยอดขายต่อค่าแรง 1 บาท (Sales per Labour Baht)']}
              />
            </div>
          )}

          {/* ────────────────── Chapter 5: ลูกค้าและตลาด ────────────────── */}
          {activeChapter === 5 && (
            <div className="space-y-6">
              {/* Customer Intelligence */}
              {data && (
                <motion.div {...fade(0.1)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
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
              )}

              {/* Channel Performance */}
              {extendedData && <ChannelPerformance data={extendedData} />}

              {/* PipelineCard & TopCustomersCard */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <PipelineCard />
                <TopCustomersCard period={topCustPeriod} />
              </div>
            </div>
          )}

          {/* ────────────────── Chapter 6: ความเสี่ยงและการควบคุม ────────────────── */}
          {activeChapter === 6 && (
            <div className="space-y-6">
              {/* 11-gate checklist */}
              <ChecklistGateCard endDate={dateRange.endDate} />

              {/* Early Warning Signals + Stock Alert */}
              {data && (
                <>
                  <motion.div {...fade(0.1)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
                    <h2 className="text-sm font-semibold text-[var(--fg-2)] mb-4 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-[color:var(--warning,#f59e0b)]" /> Early Warning Signals
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {data.earlyWarnings.map(w => <WarningCard key={w.id} w={w} />)}
                    </div>
                    <p className="mt-2 text-xs text-[var(--fg-4)]">
                      กดไอคอน ⓘ ที่มุมการ์ดเพื่อดูว่าตัวชี้วัดคืออะไร คำนวณอย่างไร เกณฑ์สี และควรทำอะไรเมื่อเป็นสีแดง
                    </p>
                  </motion.div>

                  <motion.div {...fade(0.15)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
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
                </>
              )}
            </div>
          )}

          {/* ────────────────── Chapter 7: แผนเทียบจริง ────────────────── */}
          {activeChapter === 7 && (
            <div className="space-y-6">
              <BudgetVsActualCard endDate={dateRange.endDate} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
