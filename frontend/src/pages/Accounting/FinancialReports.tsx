import { useState, useEffect } from 'react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calculator,
  Calendar,
  CheckCircle2,
  DollarSign,
  Download,
  FileText,
  Minus,
  PieChart,
  Scale,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import {
  reportsApi,
  TrialBalanceReport,
  BalanceSheetReport,
  ProfitLossReport,
} from '../../services/accounting'
import toast from 'react-hot-toast'

type ReportType = 'trial-balance' | 'balance-sheet' | 'profit-loss' | 'cash-flow'
type DatePreset = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear'

const FinancialReports = () => {
  const [activeReport, setActiveReport] = useState<ReportType>('profit-loss')
  const [loading, setLoading] = useState(false)
  const [activePreset, setActivePreset] = useState<DatePreset | null>('thisMonth')

  // เริ่มต้นที่เดือนปัจจุบัน
  const now = new Date()
  const initYear = now.getFullYear()
  const initMonth = now.getMonth()
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastDay = new Date(initYear, initMonth + 1, 0).getDate()
  const defaultStart = `${initYear}-${pad(initMonth + 1)}-01`
  const defaultEnd = `${initYear}-${pad(initMonth + 1)}-${pad(lastDay)}`

  const [dateRange, setDateRange] = useState({
    start: defaultStart,
    end: defaultEnd,
    asOf: defaultEnd,
  })

  // หน่วยธุรกิจของงบกำไรขาดทุน — '' = รวมทุกหน่วย
  const [businessUnit, setBusinessUnit] = useState('')
  const [trialBalance, setTrialBalance] = useState<TrialBalanceReport | null>(null)
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetReport | null>(null)
  const [profitLoss, setProfitLoss] = useState<ProfitLossReport | null>(null)
  const [cashFlow, setCashFlow] = useState<any | null>(null)

  const fetchReport = async (customRange?: { start: string; end: string; asOf: string }, customBU?: string) => {
    const range = customRange || dateRange
    const bu = customBU !== undefined ? customBU : businessUnit

    try {
      setLoading(true)

      switch (activeReport) {
        case 'trial-balance': {
          const tbRes = await reportsApi.getTrialBalance({
            startDate: range.start,
            endDate: range.end,
          })
          setTrialBalance(tbRes.data.data)
          break
        }
        case 'balance-sheet': {
          const bsRes = await reportsApi.getBalanceSheet({
            asOfDate: range.asOf,
          })
          setBalanceSheet(bsRes.data.data)
          break
        }
        case 'profit-loss': {
          const plRes = await reportsApi.getProfitLoss({
            startDate: range.start,
            endDate: range.end,
            businessUnit: bu || undefined,
          })
          setProfitLoss(plRes.data.data)
          break
        }
        case 'cash-flow': {
          const cfRes = await reportsApi.getCashFlow({
            startDate: range.start,
            endDate: range.end,
          })
          setCashFlow(cfRes.data.data)
          break
        }
      }
    } catch (error) {
      toast.error('ไม่สามารถโหลดรายงานได้')
    } finally {
      setLoading(false)
    }
  }

  // Auto fetch when report changes or on initial mount
  useEffect(() => {
    fetchReport()
  }, [activeReport])

  // คำนวณช่วงวันที่ที่ใช้บ่อย
  const applyPreset = (preset: DatePreset) => {
    setActivePreset(preset)
    const current = new Date()
    const y = current.getFullYear()
    const m = current.getMonth() // 0-indexed

    const fmt = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`
    const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate()

    let start = ''
    let end = ''

    if (preset === 'thisMonth') {
      start = fmt(y, m, 1)
      end = fmt(y, m, daysInMonth(y, m))
    } else if (preset === 'lastMonth') {
      const prevY = m === 0 ? y - 1 : y
      const prevM = m === 0 ? 11 : m - 1
      start = fmt(prevY, prevM, 1)
      end = fmt(prevY, prevM, daysInMonth(prevY, prevM))
    } else if (preset === 'thisQuarter') {
      const qStartM = Math.floor(m / 3) * 3
      const qEndM = qStartM + 2
      start = fmt(y, qStartM, 1)
      end = fmt(y, qEndM, daysInMonth(y, qEndM))
    } else if (preset === 'thisYear') {
      start = `${y}-01-01`
      end = `${y}-12-31`
    }

    const newRange = { start, end, asOf: end }
    setDateRange(newRange)
    fetchReport(newRange)
  }

  // รูปแบบตัวเลขมาตรฐาน: คั่นหลักพัน ทศนิยม 2 ตำแหน่ง ยอดติดลบใส่วงเล็บ (xxx) สีแดง
  const formatMoney = (amount: number | null | undefined, options?: { parentheses?: boolean }) => {
    if (amount === null || amount === undefined || isNaN(amount)) return '0.00'
    const formatted = Math.abs(amount).toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    if (amount < 0) {
      return options?.parentheses !== false ? `(${formatted})` : `-${formatted}`
    }
    return formatted
  }

  const reports = [
    { id: 'profit-loss' as ReportType, label: 'งบกำไรขาดทุน', icon: TrendingUp },
    { id: 'balance-sheet' as ReportType, label: 'งบดุล', icon: Scale },
    { id: 'cash-flow' as ReportType, label: 'งบกระแสเงินสด', icon: DollarSign },
    { id: 'trial-balance' as ReportType, label: 'งบทดลอง', icon: Calculator },
  ]

  const printReport = () => {
    window.print()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-1)] flex items-center gap-2">
            <BarChart3 className="w-8 h-8 text-[var(--primary)]" />
            รายงานทางการเงิน (Financial Reports)
          </h1>
          <p className="text-[var(--fg-3)] mt-1">
            งบกำไรขาดทุนแบบขั้นบันได งบดุลตรวจสอบสมดุล และงบกระแสเงินสดกระทบยอด
          </p>
        </div>
        <button
          onClick={printReport}
          className="px-4 py-2 border border-[var(--border)] rounded-lg text-[var(--fg-2)] hover:bg-[var(--bg)] flex items-center gap-2 self-start"
        >
          <Download className="w-4 h-4" />
          พิมพ์ / ส่งออก
        </button>
      </div>

      {/* Report Type Tabs */}
      <div className="flex flex-wrap gap-2">
        {reports.map((report) => {
          const Icon = report.icon
          const isActive = activeReport === report.id
          return (
            <button
              key={report.id}
              onClick={() => setActiveReport(report.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
                isActive
                  ? 'bg-phopy-indigo text-white shadow-sm'
                  : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--fg-1)]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {report.label}
            </button>
          )
        })}
      </div>

      {/* Date Filters & Presets */}
      <div className="phopy-card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-[var(--border)]">
          <span className="text-xs font-semibold text-[var(--fg-3)] flex items-center gap-1 mr-1">
            <Calendar className="w-3.5 h-3.5" /> ช่วงเวลาที่ใช้บ่อย:
          </span>
          <button
            type="button"
            onClick={() => applyPreset('thisMonth')}
            className={`px-3 py-1 rounded text-xs font-medium transition-all ${
              activePreset === 'thisMonth'
                ? 'bg-[var(--primary)] text-white'
                : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            เดือนนี้
          </button>
          <button
            type="button"
            onClick={() => applyPreset('lastMonth')}
            className={`px-3 py-1 rounded text-xs font-medium transition-all ${
              activePreset === 'lastMonth'
                ? 'bg-[var(--primary)] text-white'
                : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            เดือนก่อน
          </button>
          <button
            type="button"
            onClick={() => applyPreset('thisQuarter')}
            className={`px-3 py-1 rounded text-xs font-medium transition-all ${
              activePreset === 'thisQuarter'
                ? 'bg-[var(--primary)] text-white'
                : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            ไตรมาสนี้
          </button>
          <button
            type="button"
            onClick={() => applyPreset('thisYear')}
            className={`px-3 py-1 rounded text-xs font-medium transition-all ${
              activePreset === 'thisYear'
                ? 'bg-[var(--primary)] text-white'
                : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            ปีนี้
          </button>
        </div>

        <div className="flex flex-col md:flex-row gap-4 items-end">
          {activeReport === 'balance-sheet' ? (
            <div>
              <label className="block text-xs font-medium text-[var(--fg-3)] mb-1">ณ วันที่</label>
              <input
                type="date"
                value={dateRange.asOf}
                onChange={(e) => {
                  setActivePreset(null)
                  setDateRange({ ...dateRange, asOf: e.target.value })
                }}
                className="phopy-input"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-[var(--fg-3)] mb-1">ตั้งแต่วันที่</label>
                <input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => {
                    setActivePreset(null)
                    setDateRange({ ...dateRange, start: e.target.value })
                  }}
                  className="phopy-input"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--fg-3)] mb-1">ถึงวันที่</label>
                <input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => {
                    setActivePreset(null)
                    setDateRange({ ...dateRange, end: e.target.value })
                  }}
                  className="phopy-input"
                />
              </div>
            </>
          )}

          {activeReport === 'profit-loss' && (
            <div>
              <label className="block text-xs font-medium text-[var(--fg-3)] mb-1">หน่วยธุรกิจ</label>
              <select
                value={businessUnit}
                onChange={(e) => {
                  setBusinessUnit(e.target.value)
                  fetchReport(dateRange, e.target.value)
                }}
                className="phopy-input"
              >
                <option value="">ทั้งหมด (ทุกหน่วยธุรกิจ)</option>
                <option value="RETAIL">หน้าร้าน (POS / RETAIL)</option>
                <option value="WHOLESALE">ขายส่ง / ใบแจ้งหนี้ (WHOLESALE)</option>
                <option value="ONLINE">ขายออนไลน์ / แพลตฟอร์ม (ONLINE)</option>
                <option value="OTHER">อื่น ๆ (OTHER)</option>
              </select>
            </div>
          )}

          <button
            onClick={() => fetchReport()}
            disabled={loading}
            className="phopy-btn-primary flex items-center gap-2"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <PieChart className="w-4 h-4" />
            )}
            ดูรายงาน
          </button>
        </div>
      </div>

      {/* Report Content */}
      <div className="phopy-card p-6">
        {/* ==================================================== */}
        {/* 1. PROFIT & LOSS (งบกำไรขาดทุนแบบขั้นบันได) */}
        {/* ==================================================== */}
        {activeReport === 'profit-loss' && profitLoss && (
          <div className="space-y-6">
            <div className="text-center pb-4 border-b border-[var(--border)]">
              <h2 className="text-xl font-bold text-[var(--fg-1)]">
                งบกำไรขาดทุน (Profit & Loss Statement)
              </h2>
              <p className="text-sm text-[var(--fg-3)] mt-1">
                ระหว่างวันที่ {new Date(profitLoss.period.startDate).toLocaleDateString('th-TH')} ถึง{' '}
                {new Date(profitLoss.period.endDate).toLocaleDateString('th-TH')}
                {businessUnit && ` · หน่วยธุรกิจ: ${businessUnit}`}
              </p>
            </div>

            {/* KPI Cards สรุปด้านบน */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* รายได้รวม */}
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                <span className="text-xs text-[var(--fg-3)] font-medium">รายได้จากการดำเนินงาน</span>
                <div className="text-xl font-bold font-mono text-[var(--fg-1)] mt-1">
                  ฿{formatMoney(profitLoss.revenue.total)}
                </div>
                {profitLoss.comparison && profitLoss.comparison.revenueChangePct !== null && (
                  <div className="flex items-center gap-1 text-xs mt-1">
                    {profitLoss.comparison.revenueChange >= 0 ? (
                      <span className="text-emerald-600 dark:text-emerald-400 flex items-center font-medium">
                        <ArrowUpRight className="w-3.5 h-3.5" /> +
                        {profitLoss.comparison.revenueChangePct}%
                      </span>
                    ) : (
                      <span className="text-rose-600 dark:text-rose-400 flex items-center font-medium">
                        <ArrowDownRight className="w-3.5 h-3.5" />
                        {profitLoss.comparison.revenueChangePct}%
                      </span>
                    )}
                    <span className="text-[var(--fg-4)]">เทียบงวดก่อน</span>
                  </div>
                )}
              </div>

              {/* กำไรขั้นต้น */}
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--fg-3)] font-medium">กำไรขั้นต้น</span>
                  {profitLoss.grossProfit >= 0 ? (
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      กำไร
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400">
                      ขาดทุน
                    </span>
                  )}
                </div>
                <div
                  className={`text-xl font-bold font-mono mt-1 ${
                    profitLoss.grossProfit >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  ฿{formatMoney(profitLoss.grossProfit)}
                </div>
                <div className="text-xs text-[var(--fg-3)] mt-1">
                  อัตรากำไรขั้นต้น:{' '}
                  <span className="font-semibold text-[var(--fg-1)]">
                    {profitLoss.grossMarginPct ?? (profitLoss.revenue.total > 0 ? ((profitLoss.grossProfit / profitLoss.revenue.total) * 100).toFixed(2) : '0.00')}%
                  </span>
                </div>
              </div>

              {/* ค่าใช้จ่ายดำเนินงาน */}
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                <span className="text-xs text-[var(--fg-3)] font-medium">ค่าใช้จ่ายดำเนินงาน</span>
                <div className="text-xl font-bold font-mono text-[var(--fg-1)] mt-1">
                  ฿{formatMoney(profitLoss.operatingExpenses.total)}
                </div>
                <div className="text-xs text-[var(--fg-3)] mt-1">
                  คิดเป็น{' '}
                  <span className="font-semibold text-[var(--fg-1)]">
                    {profitLoss.revenue.total > 0
                      ? ((profitLoss.operatingExpenses.total / profitLoss.revenue.total) * 100).toFixed(2)
                      : '0.00'}
                    %
                  </span>{' '}
                  ของรายได้
                </div>
              </div>

              {/* กำไรสุทธิ */}
              <div
                className={`p-4 rounded-xl border ${
                  profitLoss.netProfit >= 0
                    ? 'border-emerald-500/40 bg-emerald-500/5'
                    : 'border-rose-500/40 bg-rose-500/5'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--fg-2)]">กำไร(ขาดทุน)สุทธิ</span>
                  {profitLoss.netProfit >= 0 ? (
                    <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-emerald-600 text-white">
                      กำไรสุทธิ
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-rose-600 text-white">
                      ขาดทุนสุทธิ
                    </span>
                  )}
                </div>
                <div
                  className={`text-2xl font-black font-mono mt-1 ${
                    profitLoss.netProfit >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  ฿{formatMoney(profitLoss.netProfit)}
                </div>
                <div className="text-xs text-[var(--fg-3)] mt-1">
                  อัตรากำไรสุทธิ:{' '}
                  <span className="font-bold text-[var(--fg-1)]">
                    {profitLoss.netMarginPct ?? profitLoss.margin}%
                  </span>
                </div>
              </div>
            </div>

            {/* ตารางแสดงงบกำไรขาดทุนแบบขั้นบันได */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-[var(--border)] text-[var(--fg-3)]">
                    <th className="py-2.5 text-left font-semibold">รายการบัญชี</th>
                    <th className="py-2.5 text-right font-semibold w-36">งวดนี้ (บาท)</th>
                    <th className="py-2.5 text-right font-semibold w-24">% ต่อรายได้</th>
                    <th className="py-2.5 text-right font-semibold w-36 text-[var(--fg-4)]">งวดก่อนหน้า</th>
                    <th className="py-2.5 text-right font-semibold w-32">ผลต่าง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]/40">
                  {/* 1. รายได้จากการขายและบริการ */}
                  <tr className="bg-[var(--bg)]/50 font-bold text-[var(--fg-1)]">
                    <td colSpan={5} className="py-2 px-2 text-emerald-600 dark:text-emerald-400">
                      1. รายได้ (Revenues)
                    </td>
                  </tr>
                  {Object.entries(profitLoss.revenue.grouped).map(([category, items]) => (
                    items
                      .filter((item) => Number(item.balance) !== 0)
                      .map((item) => {
                        const pct = profitLoss.revenue.total > 0
                          ? ((item.balance / profitLoss.revenue.total) * 100).toFixed(2)
                          : '0.00'
                        return (
                          <tr key={item.id} className="hover:bg-[var(--surface-hover)]">
                            <td className="py-1.5 pl-6 text-[var(--fg-2)]">
                              <span className="font-mono text-xs text-[var(--fg-4)] mr-2">{item.code}</span>
                              {item.name}
                            </td>
                            <td className="py-1.5 text-right font-mono text-[var(--fg-1)]">
                              {formatMoney(item.balance)}
                            </td>
                            <td className="py-1.5 text-right font-mono text-xs text-[var(--fg-3)]">
                              {pct}%
                            </td>
                            <td className="py-1.5 text-right font-mono text-xs text-[var(--fg-4)]">-</td>
                            <td className="py-1.5 text-right font-mono text-xs text-[var(--fg-4)]">-</td>
                          </tr>
                        )
                      })
                  ))}
                  <tr className="font-bold border-t-2 border-[var(--border)] bg-[var(--surface)] text-[var(--fg-1)]">
                    <td className="py-2 pl-4 text-emerald-600 dark:text-emerald-400">รวมรายได้</td>
                    <td className="py-2 text-right font-mono text-emerald-600 dark:text-emerald-400">
                      {formatMoney(profitLoss.revenue.total)}
                    </td>
                    <td className="py-2 text-right font-mono text-xs text-[var(--fg-3)]">100.00%</td>
                    <td className="py-2 text-right font-mono text-xs text-[var(--fg-4)]">
                      {profitLoss.previousPeriod ? formatMoney(profitLoss.previousPeriod.revenue.total) : '-'}
                    </td>
                    <td className="py-2 text-right font-mono text-xs font-semibold">
                      {profitLoss.comparison ? (
                        <span className={profitLoss.comparison.revenueChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                          {profitLoss.comparison.revenueChange >= 0 ? '+' : ''}
                          {formatMoney(profitLoss.comparison.revenueChange)}
                        </span>
                      ) : '-'}
                    </td>
                  </tr>

                  {/* 2. หัก: ต้นทุนขาย */}
                  <tr className="bg-[var(--bg)]/50 font-bold text-[var(--fg-1)]">
                    <td colSpan={5} className="py-2 px-2 text-amber-600 dark:text-amber-400">
                      2. หัก: ต้นทุนขาย (Cost of Goods Sold - COGS)
                    </td>
                  </tr>
                  {profitLoss.cogs.items.filter((item) => Number(item.balance) !== 0).map((item) => {
                    const pct = profitLoss.revenue.total > 0
                      ? ((item.balance / profitLoss.revenue.total) * 100).toFixed(2)
                      : '0.00'
                    return (
                      <tr key={item.id} className="hover:bg-[var(--surface-hover)]">
                        <td className="py-1.5 pl-6 text-[var(--fg-2)]">
                          <span className="font-mono text-xs text-[var(--fg-4)] mr-2">{item.code}</span>
                          {item.name}
                        </td>
                        <td className="py-1.5 text-right font-mono text-[var(--fg-1)]">
                          {formatMoney(item.balance)}
                        </td>
                        <td className="py-1.5 text-right font-mono text-xs text-[var(--fg-3)]">
                          {pct}%
                        </td>
                        <td className="py-1.5 text-right font-mono text-xs text-[var(--fg-4)]">-</td>
                        <td className="py-1.5 text-right font-mono text-xs text-[var(--fg-4)]">-</td>
                      </tr>
                    )
                  })}
                  <tr className="font-bold border-t border-[var(--border)] bg-[var(--surface)] text-[var(--fg-1)]">
                    <td className="py-2 pl-4 text-amber-600 dark:text-amber-400">รวมต้นทุนขาย</td>
                    <td className="py-2 text-right font-mono text-amber-600 dark:text-amber-400">
                      {formatMoney(profitLoss.cogs.total)}
                    </td>
                    <td className="py-2 text-right font-mono text-xs text-[var(--fg-3)]">
                      {profitLoss.revenue.total > 0
                        ? ((profitLoss.cogs.total / profitLoss.revenue.total) * 100).toFixed(2)
                        : '0.00'}%
                    </td>
                    <td className="py-2 text-right font-mono text-xs text-[var(--fg-4)]">
                      {profitLoss.previousPeriod ? formatMoney(profitLoss.previousPeriod.cogs.total) : '-'}
                    </td>
                    <td className="py-2 text-right font-mono text-xs font-semibold">
                      {profitLoss.comparison ? (
                        <span className={profitLoss.comparison.cogsChange <= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                          {profitLoss.comparison.cogsChange > 0 ? '+' : ''}
                          {formatMoney(profitLoss.comparison.cogsChange)}
                        </span>
                      ) : '-'}
                    </td>
                  </tr>

                  {/* 3. กำไรขั้นต้น (GROSS PROFIT) */}
                  <tr className="border-t-2 border-b-2 border-phopy-indigo/40 bg-phopy-indigo/10 font-bold">
                    <td className="py-3 pl-4 flex items-center gap-2 text-phopy-indigo">
                      <span>กำไรขั้นต้น (Gross Profit)</span>
                      {profitLoss.grossProfit >= 0 ? (
                        <span className="px-2 py-0.5 rounded text-xs bg-emerald-600 text-white font-semibold">
                          กำไร
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs bg-rose-600 text-white font-semibold">
                          ขาดทุน
                        </span>
                      )}
                    </td>
                    <td
                      className={`py-3 text-right font-mono font-bold text-base ${
                        profitLoss.grossProfit >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {formatMoney(profitLoss.grossProfit)}
                    </td>
                    <td className="py-3 text-right font-mono font-semibold text-xs text-phopy-indigo">
                      {profitLoss.grossMarginPct ?? (profitLoss.revenue.total > 0 ? ((profitLoss.grossProfit / profitLoss.revenue.total) * 100).toFixed(2) : '0.00')}%
                    </td>
                    <td className="py-3 text-right font-mono text-xs text-[var(--fg-4)]">
                      {profitLoss.previousPeriod ? formatMoney(profitLoss.previousPeriod.grossProfit) : '-'}
                    </td>
                    <td className="py-3 text-right font-mono text-xs font-bold">
                      {profitLoss.comparison ? (
                        <span className={profitLoss.comparison.grossProfitChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                          {profitLoss.comparison.grossProfitChange >= 0 ? '+' : ''}
                          {formatMoney(profitLoss.comparison.grossProfitChange)}
                        </span>
                      ) : '-'}
                    </td>
                  </tr>

                  {/* 4. หัก: ค่าใช้จ่ายดำเนินงาน */}
                  <tr className="bg-[var(--bg)]/50 font-bold text-[var(--fg-1)]">
                    <td colSpan={5} className="py-2 px-2 text-rose-600 dark:text-rose-400">
                      3. หัก: ค่าใช้จ่ายในการดำเนินงาน (Operating Expenses)
                    </td>
                  </tr>
                  {Object.entries(profitLoss.operatingExpenses.grouped).map(([category, items]) => (
                    items
                      .filter((item) => Number(item.balance) !== 0)
                      .map((item) => {
                        const pct = profitLoss.revenue.total > 0
                          ? ((item.balance / profitLoss.revenue.total) * 100).toFixed(2)
                          : '0.00'
                        return (
                          <tr key={item.id} className="hover:bg-[var(--surface-hover)]">
                            <td className="py-1.5 pl-6 text-[var(--fg-2)]">
                              <span className="font-mono text-xs text-[var(--fg-4)] mr-2">{item.code}</span>
                              {item.name}
                            </td>
                            <td className="py-1.5 text-right font-mono text-[var(--fg-1)]">
                              {formatMoney(item.balance)}
                            </td>
                            <td className="py-1.5 text-right font-mono text-xs text-[var(--fg-3)]">
                              {pct}%
                            </td>
                            <td className="py-1.5 text-right font-mono text-xs text-[var(--fg-4)]">-</td>
                            <td className="py-1.5 text-right font-mono text-xs text-[var(--fg-4)]">-</td>
                          </tr>
                        )
                      })
                  ))}
                  <tr className="font-bold border-t border-[var(--border)] bg-[var(--surface)] text-[var(--fg-1)]">
                    <td className="py-2 pl-4 text-rose-600 dark:text-rose-400">รวมค่าใช้จ่ายดำเนินงาน</td>
                    <td className="py-2 text-right font-mono text-rose-600 dark:text-rose-400">
                      {formatMoney(profitLoss.operatingExpenses.total)}
                    </td>
                    <td className="py-2 text-right font-mono text-xs text-[var(--fg-3)]">
                      {profitLoss.revenue.total > 0
                        ? ((profitLoss.operatingExpenses.total / profitLoss.revenue.total) * 100).toFixed(2)
                        : '0.00'}%
                    </td>
                    <td className="py-2 text-right font-mono text-xs text-[var(--fg-4)]">
                      {profitLoss.previousPeriod ? formatMoney(profitLoss.previousPeriod.operatingExpenses.total) : '-'}
                    </td>
                    <td className="py-2 text-right font-mono text-xs font-semibold">
                      {profitLoss.comparison ? (
                        <span className={profitLoss.comparison.operatingExpensesChange <= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                          {profitLoss.comparison.operatingExpensesChange > 0 ? '+' : ''}
                          {formatMoney(profitLoss.comparison.operatingExpensesChange)}
                        </span>
                      ) : '-'}
                    </td>
                  </tr>

                  {/* 5. กำไรจากการดำเนินงาน (OPERATING PROFIT) */}
                  <tr className="border-t border-[var(--border)] font-semibold bg-[var(--bg)]/30 text-[var(--fg-1)]">
                    <td className="py-2 pl-4">กำไรจากการดำเนินงาน (Operating Profit)</td>
                    <td
                      className={`py-2 text-right font-mono ${
                        profitLoss.operatingProfit >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {formatMoney(profitLoss.operatingProfit)}
                    </td>
                    <td className="py-2 text-right font-mono text-xs text-[var(--fg-3)]">
                      {profitLoss.revenue.total > 0
                        ? ((profitLoss.operatingProfit / profitLoss.revenue.total) * 100).toFixed(2)
                        : '0.00'}%
                    </td>
                    <td className="py-2 text-right font-mono text-xs text-[var(--fg-4)]">
                      {profitLoss.previousPeriod ? formatMoney(profitLoss.previousPeriod.operatingProfit) : '-'}
                    </td>
                    <td className="py-2 text-right font-mono text-xs font-semibold">
                      {profitLoss.comparison ? (
                        <span className={profitLoss.comparison.netProfitChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                          {profitLoss.comparison.netProfitChange >= 0 ? '+' : ''}
                          {formatMoney(profitLoss.comparison.netProfitChange)}
                        </span>
                      ) : '-'}
                    </td>
                  </tr>

                  {/* 6. กำไร(ขาดทุน)สุทธิ (NET PROFIT / LOSS) */}
                  <tr className="border-t-4 border-b-4 border-double border-phopy-indigo bg-phopy-indigo/15">
                    <td className="py-4 pl-4 font-bold text-lg text-[var(--fg-1)] flex items-center gap-3">
                      <span>กำไร (ขาดทุน) สุทธิ (Net Profit / Loss)</span>
                      {profitLoss.netProfit >= 0 ? (
                        <span className="px-3 py-1 rounded-md text-xs font-bold bg-emerald-600 text-white shadow-sm">
                          กำไรสุทธิ
                        </span>
                      ) : (
                        <span className="px-3 py-1 rounded-md text-xs font-bold bg-rose-600 text-white shadow-sm">
                          ขาดทุนสุทธิ
                        </span>
                      )}
                    </td>
                    <td
                      className={`py-4 text-right font-mono font-black text-xl ${
                        profitLoss.netProfit >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {formatMoney(profitLoss.netProfit)}
                    </td>
                    <td className="py-4 text-right font-mono font-bold text-sm text-[var(--fg-1)]">
                      {profitLoss.netMarginPct ?? profitLoss.margin}%
                    </td>
                    <td className="py-4 text-right font-mono text-sm text-[var(--fg-3)]">
                      {profitLoss.previousPeriod ? formatMoney(profitLoss.previousPeriod.netProfit) : '-'}
                    </td>
                    <td className="py-4 text-right font-mono text-sm font-black">
                      {profitLoss.comparison ? (
                        <span className={profitLoss.comparison.netProfitChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                          {profitLoss.comparison.netProfitChange >= 0 ? '+' : ''}
                          {formatMoney(profitLoss.comparison.netProfitChange)}
                        </span>
                      ) : '-'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* คำอธิบายความหมายของงบ */}
            <div className="p-4 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--fg-3)] flex items-center justify-between">
              <div>
                <span className="font-semibold text-[var(--fg-1)]">สูตรงบการเงิน: </span>
                รายได้ ({formatMoney(profitLoss.revenue.total)}) − ต้นทุนขาย ({formatMoney(profitLoss.cogs.total)}) = กำไรขั้นต้น ({formatMoney(profitLoss.grossProfit)}) | หักค่าใช้จ่ายดำเนินงาน ({formatMoney(profitLoss.operatingExpenses.total)}) = กำไรสุทธิ ({formatMoney(profitLoss.netProfit)})
              </div>
              <div className="font-mono text-right">
                อัตรากำไรสุทธิ: {profitLoss.netMarginPct ?? profitLoss.margin}%
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* 2. BALANCE SHEET (งบดุล ตรวจสอบสมดุล & กำไรสะสมงวดปัจจุบัน) */}
        {/* ==================================================== */}
        {activeReport === 'balance-sheet' && balanceSheet && (
          <div className="space-y-6">
            <div className="text-center pb-4 border-b border-[var(--border)]">
              <h2 className="text-xl font-bold text-[var(--fg-1)]">งบดุล (Balance Sheet)</h2>
              <p className="text-sm text-[var(--fg-3)] mt-1">
                ณ วันที่ {new Date(balanceSheet.asOfDate).toLocaleDateString('th-TH')}
              </p>
            </div>

            {/* แถบตรวจสอบสมการบัญชี (Accounting Equation Banner) */}
            <div
              className={`p-4 rounded-xl border flex flex-col md:flex-row items-center justify-between gap-4 ${
                balanceSheet.balanced
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-rose-500/10 border-rose-500/30'
              }`}
            >
              <div className="flex items-center gap-3">
                {balanceSheet.balanced ? (
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-8 h-8 text-rose-600 dark:text-rose-400" />
                )}
                <div>
                  <div className="font-bold text-base text-[var(--fg-1)] flex items-center gap-2">
                    {balanceSheet.balanced ? 'งบดุลสมดุล (Balanced)' : 'งบดุลไม่สมดุล (Unbalanced)'}
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-semibold ${
                        balanceSheet.balanced
                          ? 'bg-emerald-600 text-white'
                          : 'bg-rose-600 text-white'
                      }`}
                    >
                      {balanceSheet.balanced ? 'สินทรัพย์ = หนี้สิน + ทุน' : 'ผลต่าง ฿' + formatMoney(balanceSheet.difference || 0)}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--fg-3)] mt-0.5">
                    สินทรัพย์ (฿{formatMoney(balanceSheet.assets.total)}) {balanceSheet.balanced ? '=' : '≠'} หนี้สิน (฿{formatMoney(balanceSheet.liabilities.total)}) + ส่วนของเจ้าของรวมกำไรสะสมงวดปัจจุบัน (฿{formatMoney(balanceSheet.equity.total)})
                  </p>
                </div>
              </div>

              {!balanceSheet.balanced && (
                <div className="text-rose-600 dark:text-rose-400 font-bold font-mono text-sm">
                  ผลต่าง: ฿{formatMoney(balanceSheet.difference || (balanceSheet.assets.total - balanceSheet.totalLiabilitiesAndEquity))}
                </div>
              )}
            </div>

            {/* แบ่ง 2 คอลัมน์: สินทรัพย์ vs หนี้สินและทุน */}
            <div className="grid md:grid-cols-2 gap-8">
              {/* ฝั่งซ้าย: สินทรัพย์ (Assets) */}
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b-2 border-emerald-500/40">
                  <h3 className="text-lg font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                    <ArrowUpRight className="w-5 h-5" />
                    สินทรัพย์ (Assets)
                  </h3>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    ฿{formatMoney(balanceSheet.assets.total)}
                  </span>
                </div>

                {Object.entries(balanceSheet.assets.grouped).map(([category, items]) => (
                  <div key={category} className="space-y-1">
                    <h4 className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wider">
                      {category}
                    </h4>
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="flex justify-between items-center py-1.5 px-2 rounded hover:bg-[var(--surface-hover)] text-sm"
                      >
                        <span className="text-[var(--fg-2)]">
                          <span className="font-mono text-xs text-[var(--fg-4)] mr-2">{item.code}</span>
                          {item.name}
                        </span>
                        <span className="font-mono text-[var(--fg-1)]">
                          {formatMoney(item.balance)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}

                <div className="border-t-2 border-b-4 border-double border-emerald-500 pt-2 pb-2 mt-4 bg-emerald-500/5 px-3 rounded">
                  <div className="flex justify-between font-bold text-base text-emerald-600 dark:text-emerald-400">
                    <span>รวมสินทรัพย์ (Total Assets)</span>
                    <span className="font-mono">฿{formatMoney(balanceSheet.assets.total)}</span>
                  </div>
                </div>
              </div>

              {/* ฝั่งขวา: หหนี้สินและส่วนของเจ้าของ (Liabilities & Equity) */}
              <div className="space-y-6">
                {/* 1. หนี้สิน */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b-2 border-rose-500/40">
                    <h3 className="text-base font-bold text-rose-600 dark:text-rose-400 flex items-center gap-2">
                      <ArrowDownRight className="w-5 h-5" />
                      หนี้สิน (Liabilities)
                    </h3>
                    <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                      ฿{formatMoney(balanceSheet.liabilities.total)}
                    </span>
                  </div>

                  {Object.entries(balanceSheet.liabilities.grouped).map(([category, items]) => (
                    <div key={category} className="space-y-1">
                      <h4 className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wider">
                        {category}
                      </h4>
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className="flex justify-between items-center py-1.5 px-2 rounded hover:bg-[var(--surface-hover)] text-sm"
                        >
                          <span className="text-[var(--fg-2)]">
                            <span className="font-mono text-xs text-[var(--fg-4)] mr-2">{item.code}</span>
                            {item.name}
                          </span>
                          <span className="font-mono text-[var(--fg-1)]">
                            {formatMoney(item.balance)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}

                  <div className="flex justify-between font-bold text-sm text-rose-600 dark:text-rose-400 border-t border-[var(--border)] pt-2 px-2">
                    <span>รวมหนี้สิน (Total Liabilities)</span>
                    <span className="font-mono">฿{formatMoney(balanceSheet.liabilities.total)}</span>
                  </div>
                </div>

                {/* 2. ส่วนของเจ้าของ */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b-2 border-[var(--equity-strong)]/40">
                    <h3 className="text-base font-bold text-[var(--equity-strong)] flex items-center gap-2">
                      <Scale className="w-5 h-5" />
                      ส่วนของผู้ถือหุ้น / เจ้าของ (Equity)
                    </h3>
                    <span className="font-mono font-bold text-[var(--equity-strong)]">
                      ฿{formatMoney(balanceSheet.equity.total)}
                    </span>
                  </div>

                  {/* บัญชีทุนเดิมในผังบัญชี */}
                  {Object.entries(balanceSheet.equity.grouped).map(([category, items]) => (
                    <div key={category} className="space-y-1">
                      <h4 className="text-xs font-semibold text-[var(--fg-3)] uppercase tracking-wider">
                        {category}
                      </h4>
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className="flex justify-between items-center py-1.5 px-2 rounded hover:bg-[var(--surface-hover)] text-sm"
                        >
                          <span className="text-[var(--fg-2)]">
                            <span className="font-mono text-xs text-[var(--fg-4)] mr-2">{item.code}</span>
                            {item.name}
                          </span>
                          <span className="font-mono text-[var(--fg-1)]">
                            {formatMoney(item.balance)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}

                  {/* บรรทัดพิเศษ: กำไรสะสมงวดปัจจุบันที่ยังไม่ปิดบัญชี (Unclosed Net Income) */}
                  <div className="flex justify-between items-center py-2 px-3 rounded bg-[var(--primary)]/10 border border-[var(--primary)]/20 text-sm">
                    <span className="font-medium text-[var(--primary)] flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4" />
                      กำไร (ขาดทุน) สุทธิสะสมงวดปัจจุบัน (ยังไม่ปิดบัญชี)
                    </span>
                    <span
                      className={`font-mono font-bold ${
                        (balanceSheet.equity.unclosedProfit ?? 0) >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {formatMoney(balanceSheet.equity.unclosedProfit ?? 0)}
                    </span>
                  </div>

                  <div className="flex justify-between font-bold text-sm text-[var(--equity-strong)] border-t border-[var(--border)] pt-2 px-2">
                    <span>รวมส่วนของเจ้าของ (Total Equity)</span>
                    <span className="font-mono">฿{formatMoney(balanceSheet.equity.total)}</span>
                  </div>
                </div>

                {/* รวมหนี้สินและส่วนของเจ้าของ */}
                <div className="border-t-2 border-b-4 border-double border-phopy-indigo pt-2 pb-2 bg-phopy-indigo/10 px-3 rounded">
                  <div className="flex justify-between font-bold text-base text-[var(--primary)]">
                    <span>รวมหนี้สินและส่วนของเจ้าของ</span>
                    <span className="font-mono">฿{formatMoney(balanceSheet.totalLiabilitiesAndEquity)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* 3. CASH FLOW (งบกระแสเงินสดกระทบยอด) */}
        {/* ==================================================== */}
        {activeReport === 'cash-flow' && cashFlow && (
          <div className="space-y-6">
            <div className="text-center pb-4 border-b border-[var(--border)]">
              <h2 className="text-xl font-bold text-[var(--fg-1)]">
                งบกระแสเงินสด (Cash Flow Statement)
              </h2>
              <p className="text-sm text-[var(--fg-3)] mt-1">
                ระหว่างวันที่ {new Date(dateRange.start).toLocaleDateString('th-TH')} ถึง{' '}
                {new Date(dateRange.end).toLocaleDateString('th-TH')}
              </p>
            </div>

            {/* KPI Cards สรุปเงินสด */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                <span className="text-xs text-[var(--fg-3)] font-medium">เงินสดยกมาต้นงวด</span>
                <div className="text-xl font-bold font-mono text-[var(--fg-1)] mt-1">
                  ฿{formatMoney(cashFlow.openingBalance)}
                </div>
              </div>
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                <span className="text-xs text-[var(--fg-3)] font-medium">เงินสดสุทธิเพิ่มขึ้น (ลดลง)</span>
                <div
                  className={`text-xl font-bold font-mono mt-1 ${
                    cashFlow.netChange >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {cashFlow.netChange >= 0 ? '+' : ''}฿{formatMoney(cashFlow.netChange)}
                </div>
              </div>
              <div className="p-4 rounded-xl border border-phopy-indigo bg-phopy-indigo/10">
                <span className="text-xs text-[var(--primary)] font-medium">เงินสดยกไปปลายงวด</span>
                <div className="text-2xl font-black font-mono text-[var(--primary)] mt-1">
                  ฿{formatMoney(cashFlow.closingBalance)}
                </div>
              </div>
            </div>

            {/* รายละเอียด 3 กิจกรรม */}
            <div className="space-y-6">
              {/* 1. กิจกรรมดำเนินงาน */}
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-[var(--border)]">
                  <h3 className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                    <ArrowUpRight className="w-5 h-5" />
                    1. กระแสเงินสดจากกิจกรรมดำเนินงาน (Operating Activities)
                  </h3>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    ฿{formatMoney(cashFlow.operating.total)}
                  </span>
                </div>
                {cashFlow.operating.items.length === 0 ? (
                  <p className="text-xs text-[var(--fg-4)] italic pl-4">ไม่มีรายการกิจกรรมดำเนินงานในช่วงเวลานี้</p>
                ) : (
                  <div className="space-y-1.5 pl-2 max-h-60 overflow-y-auto">
                    {cashFlow.operating.items.map((item: any, i: number) => (
                      <div key={i} className="flex justify-between items-center py-1 px-2 rounded hover:bg-[var(--surface-hover)] text-xs">
                        <span className="text-[var(--fg-2)]">
                          <span className="font-mono text-[var(--fg-4)] mr-2">{item.date}</span>
                          {item.entry_description || item.description || item.account_name}
                        </span>
                        <span className="font-mono text-[var(--fg-1)]">
                          {formatMoney(item.debit - item.credit)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 2. กิจกรรมลงทุน */}
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-[var(--border)]">
                  <h3 className="font-bold text-sky-600 dark:text-sky-400 flex items-center gap-2">
                    <Calculator className="w-5 h-5" />
                    2. กระแสเงินสดจากกิจกรรมลงทุน (Investing Activities)
                  </h3>
                  <span className="font-mono font-bold text-sky-600 dark:text-sky-400">
                    ฿{formatMoney(cashFlow.investing.total)}
                  </span>
                </div>
                {cashFlow.investing.items.length === 0 ? (
                  <p className="text-xs text-[var(--fg-4)] italic pl-4">ไม่มีรายการกิจกรรมลงทุนในช่วงเวลานี้</p>
                ) : (
                  <div className="space-y-1.5 pl-2 max-h-60 overflow-y-auto">
                    {cashFlow.investing.items.map((item: any, i: number) => (
                      <div key={i} className="flex justify-between items-center py-1 px-2 rounded hover:bg-[var(--surface-hover)] text-xs">
                        <span className="text-[var(--fg-2)]">
                          <span className="font-mono text-[var(--fg-4)] mr-2">{item.date}</span>
                          {item.entry_description || item.description || item.account_name}
                        </span>
                        <span className="font-mono text-[var(--fg-1)]">
                          {formatMoney(item.debit - item.credit)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 3. กิจกรรมจัดหาเงิน */}
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-[var(--border)]">
                  <h3 className="font-bold text-[var(--equity-strong)] flex items-center gap-2">
                    <Scale className="w-5 h-5" />
                    3. กระแสเงินสดจากกิจกรรมจัดหาเงิน (Financing Activities)
                  </h3>
                  <span className="font-mono font-bold text-[var(--equity-strong)]">
                    ฿{formatMoney(cashFlow.financing.total)}
                  </span>
                </div>
                {cashFlow.financing.items.length === 0 ? (
                  <p className="text-xs text-[var(--fg-4)] italic pl-4">ไม่มีรายการกิจกรรมจัดหาเงินในช่วงเวลานี้</p>
                ) : (
                  <div className="space-y-1.5 pl-2 max-h-60 overflow-y-auto">
                    {cashFlow.financing.items.map((item: any, i: number) => (
                      <div key={i} className="flex justify-between items-center py-1 px-2 rounded hover:bg-[var(--surface-hover)] text-xs">
                        <span className="text-[var(--fg-2)]">
                          <span className="font-mono text-[var(--fg-4)] mr-2">{item.date}</span>
                          {item.entry_description || item.description || item.account_name}
                        </span>
                        <span className="font-mono text-[var(--fg-1)]">
                          {formatMoney(item.debit - item.credit)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ตารางกระทบยอดเงินสดต้นงวด - ปลายงวด */}
              <div className="p-4 rounded-xl border-2 border-phopy-indigo/40 bg-[var(--surface)] space-y-2.5">
                <h4 className="font-bold text-sm text-[var(--fg-1)] border-b border-[var(--border)] pb-2">
                  การกระทบยอดเงินสด (Cash Reconciliation)
                </h4>
                <div className="flex justify-between text-sm py-1">
                  <span className="text-[var(--fg-2)]">เงินสดยกมาต้นงวด (Opening Cash Balance)</span>
                  <span className="font-mono font-semibold text-[var(--fg-1)]">฿{formatMoney(cashFlow.openingBalance)}</span>
                </div>
                <div className="flex justify-between text-sm py-1 pl-4 text-emerald-600 dark:text-emerald-400">
                  <span>(+) กระแสเงินสดจากกิจกรรมดำเนินงาน</span>
                  <span className="font-mono">{formatMoney(cashFlow.operating.total)}</span>
                </div>
                <div className="flex justify-between text-sm py-1 pl-4 text-sky-600 dark:text-sky-400">
                  <span>(+/−) กระแสเงินสดจากกิจกรรมลงทุน</span>
                  <span className="font-mono">{formatMoney(cashFlow.investing.total)}</span>
                </div>
                <div className="flex justify-between text-sm py-1 pl-4 text-[var(--equity-strong)]">
                  <span>(+/−) กระแสเงินสดจากกิจกรรมจัดหาเงิน</span>
                  <span className="font-mono">{formatMoney(cashFlow.financing.total)}</span>
                </div>
                <div className="flex justify-between font-bold text-sm border-t border-[var(--border)] pt-2">
                  <span className="text-[var(--fg-1)]">รวมเงินสดเพิ่มขึ้น (ลดลง) สุทธิ</span>
                  <span
                    className={`font-mono ${
                      cashFlow.netChange >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {cashFlow.netChange >= 0 ? '+' : ''}฿{formatMoney(cashFlow.netChange)}
                  </span>
                </div>
                <div className="flex justify-between font-black text-lg text-phopy-indigo border-t-2 border-b-2 border-phopy-indigo pt-2 pb-2">
                  <span>เงินสดยกไปปลายงวด (Ending Cash Balance)</span>
                  <span className="font-mono">฿{formatMoney(cashFlow.closingBalance)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* 4. TRIAL BALANCE (งบทดลอง ตรวจสอบเดบิต/เครดิต) */}
        {/* ==================================================== */}
        {activeReport === 'trial-balance' && trialBalance && (
          <div className="space-y-4">
            <div className="text-center pb-4 border-b border-[var(--border)]">
              <h2 className="text-xl font-bold text-[var(--fg-1)]">งบทดลอง (Trial Balance)</h2>
              <p className="text-sm text-[var(--fg-3)] mt-1">
                ระหว่างวันที่ {new Date(dateRange.start).toLocaleDateString('th-TH')} ถึง{' '}
                {new Date(dateRange.end).toLocaleDateString('th-TH')}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-[var(--border)] text-xs text-[var(--fg-3)]">
                    <th className="py-2.5 text-left font-semibold">รหัส</th>
                    <th className="py-2.5 text-left font-semibold">ชื่อบัญชี</th>
                    <th className="py-2.5 text-right font-semibold">ยอดยกมา (เดบิต)</th>
                    <th className="py-2.5 text-right font-semibold">ยอดยกมา (เครดิต)</th>
                    <th className="py-2.5 text-right font-semibold">เดบิต</th>
                    <th className="py-2.5 text-right font-semibold">เครดิต</th>
                    <th className="py-2.5 text-right font-semibold">คงเหลือ (เดบิต)</th>
                    <th className="py-2.5 text-right font-semibold">คงเหลือ (เครดิต)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]/40">
                  {trialBalance.accounts.map((acc) => (
                    <tr key={acc.id} className="hover:bg-[var(--surface-hover)]">
                      <td className="py-1.5 font-mono text-xs text-[var(--fg-3)]">{acc.code}</td>
                      <td className="py-1.5 text-[var(--fg-2)]">{acc.name}</td>
                      <td className="py-1.5 text-right font-mono text-xs text-[var(--fg-3)]">
                        {acc.openingDebit > 0 ? formatMoney(acc.openingDebit) : '-'}
                      </td>
                      <td className="py-1.5 text-right font-mono text-xs text-[var(--fg-3)]">
                        {acc.openingCredit > 0 ? formatMoney(acc.openingCredit) : '-'}
                      </td>
                      <td className="py-1.5 text-right font-mono text-xs text-[var(--fg-1)]">
                        {acc.debit > 0 ? formatMoney(acc.debit) : '-'}
                      </td>
                      <td className="py-1.5 text-right font-mono text-xs text-[var(--fg-1)]">
                        {acc.credit > 0 ? formatMoney(acc.credit) : '-'}
                      </td>
                      <td className="py-1.5 text-right font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        {acc.endingDebit > 0 ? formatMoney(acc.endingDebit) : '-'}
                      </td>
                      <td className="py-1.5 text-right font-mono text-xs font-semibold text-sky-600 dark:text-sky-400">
                        {acc.endingCredit > 0 ? formatMoney(acc.endingCredit) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-b-2 border-phopy-indigo font-bold text-[var(--primary)] bg-[var(--surface)]">
                    <td colSpan={2} className="py-2.5 pl-2">รวมทั้งหมด</td>
                    <td className="py-2.5 text-right font-mono text-xs">{formatMoney(trialBalance.totals.openingDebit)}</td>
                    <td className="py-2.5 text-right font-mono text-xs">{formatMoney(trialBalance.totals.openingCredit)}</td>
                    <td className="py-2.5 text-right font-mono text-xs">{formatMoney(trialBalance.totals.debit)}</td>
                    <td className="py-2.5 text-right font-mono text-xs">{formatMoney(trialBalance.totals.credit)}</td>
                    <td className="py-2.5 text-right font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      {formatMoney(trialBalance.totals.endingDebit)}
                    </td>
                    <td className="py-2.5 text-right font-mono text-xs font-bold text-sky-600 dark:text-sky-400">
                      {formatMoney(trialBalance.totals.endingCredit)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {!trialBalance && !balanceSheet && !profitLoss && !cashFlow && !loading && (
          <div className="text-center py-12">
            <FileText className="w-16 h-16 text-[var(--fg-4)] mx-auto mb-4" />
            <p className="text-[var(--fg-3)] mb-4">เลือกช่วงวันที่และคลิก "ดูรายงาน"</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default FinancialReports
