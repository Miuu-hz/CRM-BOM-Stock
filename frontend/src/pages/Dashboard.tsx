import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  TrendingUp, TrendingDown, RefreshCw, DollarSign, BarChart2,
  ArrowDownCircle, ArrowUpCircle, Package, Truck, Users, AlertTriangle,
  FileText, ShoppingBag, Receipt,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import api from '../utils/api'

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
interface CFItem { id: string; party_name: string; doc_number: string; amount: number; due_date: string }
interface CFGroup { overdue: CFItem[]; today: CFItem[]; week: CFItem[]; month: CFItem[]; later: CFItem[]; total: number; weekTotal: number; monthTotal: number }
interface Cashflow { ar: CFGroup; ap: CFGroup; netCashflow: { week: number; month: number } }
interface Funnel { quotations: { count: number; value: number }; salesOrders: { count: number; value: number }; invoices: { count: number; value: number }; pendingDelivery: { count: number; value: number } }
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

const dueDateBadge = (dateStr: string) => {
  const d = daysLeft(dateStr)
  if (d === null) return <span className="text-gray-500 text-xs">ไม่ระบุ</span>
  if (d < 0)  return <span className="text-xs text-red-400 font-bold">เกิน {Math.abs(d)} วัน</span>
  if (d === 0) return <span className="text-xs text-orange-400 font-bold">วันนี้</span>
  return <span className="text-xs text-gray-400">อีก {d} วัน</span>
}

const PERIOD_LABELS: Record<Period, string> = { day: 'วันนี้', week: 'สัปดาห์นี้', month: 'เดือนนี้', year: 'ปีนี้' }
const CF_TABS: { key: CFTab; label: string }[] = [
  { key: 'overdue', label: 'เกินกำหนด' },
  { key: 'today',   label: 'วันนี้' },
  { key: 'week',    label: '7 วัน' },
  { key: 'month',   label: '30 วัน' },
]

// ---- Sub-components ----
function ChangeChip({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-gray-500">ไม่มีข้อมูลก่อนหน้า</span>
  const up = pct >= 0
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${up ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {up ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-cyber-border/30 rounded animate-pulse ${className}`} />
}

function CFPanel({ title, icon: Icon, items, tab, setTab, total, color }: {
  title: string; icon: any; items: CFItem[]; tab: CFTab; setTab: (t: CFTab) => void; total: number; color: string
}) {
  return (
    <div className="cyber-card p-5 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className={`w-5 h-5 ${color}`} />
          <h3 className="font-bold text-gray-100">{title}</h3>
        </div>
        <span className={`text-sm font-bold ${color}`}>{fmt(total)}</span>
      </div>
      {/* Tabs */}
      <div className="flex gap-1 mb-3">
        {CF_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-1 text-xs rounded transition-colors ${tab === t.key ? `${color.replace('text-','bg-').replace('400','500')}/20 border border-current ${color}` : 'text-gray-500 hover:text-gray-300'}`}
          >
            {t.label}
            {t.key === 'overdue' && items.length > 0 && (
              <span className="ml-1 bg-red-500 text-white rounded-full px-1 text-[10px]">{items.length}</span>
            )}
          </button>
        ))}
      </div>
      {/* List */}
      <div className="flex-1 overflow-y-auto max-h-52 cyber-scrollbar space-y-2">
        {items.length === 0 ? (
          <p className="text-gray-500 text-xs text-center py-6">ไม่มีรายการ</p>
        ) : items.map(item => (
          <div key={item.id} className="flex items-center gap-2 p-2 rounded-lg bg-cyber-darker/60 border border-cyber-border">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-200 truncate font-medium">{item.party_name}</p>
              <p className="text-xs text-gray-500 font-mono">{item.doc_number}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className={`text-sm font-bold ${color}`}>{fmt(item.amount)}</p>
              {item.due_date && dueDateBadge(item.due_date)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- Main Dashboard ----
export default function Dashboard() {
  const [period, setPeriod] = useState<Period>('month')
  const [arTab, setArTab] = useState<CFTab>('week')
  const [apTab, setApTab] = useState<CFTab>('week')

  const [revenue, setRevenue] = useState<RevenueData | null>(null)
  const [cashflow, setCashflow] = useState<Cashflow | null>(null)
  const [funnel, setFunnel] = useState<Funnel | null>(null)
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
      const [cf, fn, ls] = await Promise.all([
        api.get('/dashboard/cashflow-forecast'),
        api.get('/dashboard/funnel'),
        api.get('/dashboard/low-stock'),
      ])
      setCashflow(cf.data.data)
      setFunnel(fn.data.data)
      setLowStock(ls.data.data)
      setLastUpdated(new Date())
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { loadAll(); loadRevenue(period) }, [])
  useEffect(() => { loadRevenue(period) }, [period])

  const cf = cashflow
  const arItems = cf?.ar[arTab] ?? []
  const apItems = cf?.ap[apTab] ?? []

  const container = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.06 } } }
  const item = { hidden: { y: 12, opacity: 0 }, visible: { y: 0, opacity: 1, transition: { type: 'spring', damping: 20 } } }

  return (
    <motion.div variants={container} initial="hidden" animate="visible" className="space-y-5">

      {/* Header */}
      <motion.div variants={item} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold neon-text font-['Orbitron']">Executive Dashboard</h1>
          <p className="text-gray-500 text-xs mt-1">อัพเดท {lastUpdated.toLocaleTimeString('th-TH')}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Period Toggle */}
          <div className="flex bg-cyber-darker border border-cyber-border rounded-lg overflow-hidden">
            {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${period === p ? 'bg-cyber-primary/20 text-cyber-primary' : 'text-gray-400 hover:text-gray-200'}`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <button onClick={() => { loadAll(); loadRevenue(period) }} className="p-2 rounded-lg border border-cyber-border text-gray-400 hover:text-cyber-primary hover:border-cyber-primary/50 transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading || revLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </motion.div>

      {/* Section 1: Revenue + Gross Profit */}
      <motion.div variants={item} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Revenue */}
        <div className="cyber-card p-5 border border-cyber-primary/20">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <DollarSign className="w-4 h-4 text-cyber-primary" />
              รายได้ ({PERIOD_LABELS[period]})
            </div>
            {!revLoading && revenue && <ChangeChip pct={revenue.revenueChangePercent} />}
          </div>
          {revLoading || !revenue ? <Skeleton className="h-9 w-40 mt-2" /> : (
            <>
              <p className="text-3xl font-bold text-cyber-primary mt-1">{fmt(revenue.current.revenue)}</p>
              <p className="text-xs text-gray-500 mt-1">ก่อนหน้า: {fmt(revenue.previous.revenue)}</p>
            </>
          )}
        </div>

        {/* Gross Profit */}
        <div className="cyber-card p-5 border border-cyber-green/20">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <TrendingUp className="w-4 h-4 text-cyber-green" />
              กำไรขั้นต้น ({PERIOD_LABELS[period]})
            </div>
            {!revLoading && revenue && <ChangeChip pct={revenue.grossChangePercent} />}
          </div>
          {revLoading || !revenue ? <Skeleton className="h-9 w-40 mt-2" /> : (
            <>
              <p className={`text-3xl font-bold mt-1 ${revenue.current.grossProfit >= 0 ? 'text-cyber-green' : 'text-red-400'}`}>
                {fmt(revenue.current.grossProfit)}
              </p>
              <p className="text-xs text-gray-500 mt-1">Margin {revenue.grossMargin.toFixed(1)}% · ต้นทุน {fmt(revenue.current.cost)}</p>
            </>
          )}
        </div>
      </motion.div>

      {/* Section 2: Cash Flow Forecast */}
      <motion.div variants={item}>
        <div className="flex items-center gap-2 mb-3">
          <BarChart2 className="w-4 h-4 text-cyber-primary" />
          <h2 className="text-sm font-bold text-gray-300 uppercase tracking-wider">พยากรณ์กระแสเงินสด</h2>
          {cf && (
            <div className="ml-auto flex items-center gap-3 text-xs">
              <span className="text-gray-400">สุทธิ 7 วัน:
                <span className={`ml-1 font-bold ${cf.netCashflow.week >= 0 ? 'text-cyber-green' : 'text-red-400'}`}>
                  {cf.netCashflow.week >= 0 ? '+' : ''}{fmt(cf.netCashflow.week)}
                </span>
              </span>
              <span className="text-gray-400">30 วัน:
                <span className={`ml-1 font-bold ${cf.netCashflow.month >= 0 ? 'text-cyber-green' : 'text-red-400'}`}>
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
                title="เงินจะเข้า (ลูกหนี้)"
                icon={ArrowDownCircle}
                items={arItems}
                tab={arTab}
                setTab={setArTab}
                total={cf?.ar.total ?? 0}
                color="text-cyber-green"
              />
              <CFPanel
                title="เงินจะออก (เจ้าหนี้)"
                icon={ArrowUpCircle}
                items={apItems}
                tab={apTab}
                setTab={setApTab}
                total={cf?.ap.total ?? 0}
                color="text-red-400"
              />
            </>
          )}
        </div>
      </motion.div>

      {/* Section 3: Sales Funnel + Top Customers */}
      <motion.div variants={item} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sales Funnel */}
        <div className="cyber-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-4 h-4 text-cyber-primary" />
            <h3 className="font-bold text-gray-100">Sales Pipeline</h3>
          </div>
          {loading || !funnel ? (
            <div className="space-y-3">{Array(4).fill(0).map((_,i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <div className="space-y-3">
              {[
                { label: 'ใบเสนอราคา (QT)', data: funnel.quotations, icon: FileText, color: 'bg-purple-500', textColor: 'text-purple-400' },
                { label: 'คำสั่งขาย (SO)', data: funnel.salesOrders, icon: ShoppingBag, color: 'bg-cyber-primary', textColor: 'text-cyber-primary' },
                { label: 'ใบแจ้งหนี้ (INV)', data: funnel.invoices, icon: Receipt, color: 'bg-yellow-500', textColor: 'text-yellow-400' },
                { label: 'รอจัดส่ง', data: funnel.pendingDelivery, icon: Truck, color: 'bg-orange-500', textColor: 'text-orange-400' },
              ].map(({ label, data, color, textColor }) => (
                <div key={label} className="flex items-center gap-3">
                  <div className="w-32 flex-shrink-0">
                    <p className="text-xs text-gray-400">{label}</p>
                    <p className={`text-sm font-bold ${textColor}`}>{fmt(data.value)}</p>
                  </div>
                  <div className="flex-1 h-6 bg-cyber-darker rounded-full overflow-hidden">
                    <div
                      className={`h-full ${color} rounded-full flex items-center justify-end pr-2 transition-all`}
                      style={{ width: `${Math.min((data.count / Math.max(funnel.quotations.count, 1)) * 100, 100)}%`, minWidth: data.count > 0 ? '2rem' : '0' }}
                    >
                      <span className="text-white text-xs font-bold">{data.count}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top 5 Customers */}
        <div className="cyber-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-cyber-primary" />
            <h3 className="font-bold text-gray-100">Top 5 ลูกค้า</h3>
            <span className="text-xs text-gray-500 ml-auto">{PERIOD_LABELS[period]}</span>
          </div>
          {revLoading || topCustomers.length === 0 ? (
            topCustomers.length === 0 && !revLoading
              ? <p className="text-gray-500 text-sm text-center py-8">ยังไม่มีข้อมูล Invoice ใน{PERIOD_LABELS[period]}</p>
              : <div className="space-y-2">{Array(5).fill(0).map((_,i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={topCustomers} layout="vertical" barSize={16}>
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtShort} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
                <Tooltip
                  formatter={(v: number) => [fmt(v), 'รายได้']}
                  cursor={{ fill: 'rgba(99,102,241,0.08)' }}
                  contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                  {topCustomers.map((_, i) => (
                    <Cell key={i} fill={['#6366f1','#8b5cf6','#06b6d4','#22c55e','#f59e0b'][i]} />
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
        <div className="cyber-card p-4 border border-orange-500/20">
          <div className="flex items-center gap-2 mb-2">
            <Truck className="w-4 h-4 text-orange-400" />
            <h3 className="text-sm font-bold text-gray-200">รอจัดส่ง</h3>
          </div>
          {loading || !funnel ? <Skeleton className="h-8 w-20" /> : (
            <>
              <p className="text-2xl font-bold text-orange-400">{funnel.pendingDelivery.count} <span className="text-sm font-normal text-gray-400">รายการ</span></p>
              <p className="text-xs text-gray-500 mt-1">มูลค่ารอส่ง {fmt(funnel.pendingDelivery.value)}</p>
            </>
          )}
        </div>

        {/* Critical Stock */}
        <div className="cyber-card p-4 border border-yellow-500/20">
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-4 h-4 text-yellow-400" />
            <h3 className="text-sm font-bold text-gray-200">สต๊อกวิกฤต</h3>
          </div>
          {loading ? <Skeleton className="h-8 w-20" /> : (
            <>
              <p className="text-2xl font-bold text-yellow-400">{lowStock.length} <span className="text-sm font-normal text-gray-400">รายการ</span></p>
              {lowStock.slice(0, 2).map(s => (
                <p key={s.id} className="text-xs text-gray-500 truncate">{s.name} · เหลือ {s.quantity} {s.unit}</p>
              ))}
            </>
          )}
        </div>

        {/* Overdue Invoices */}
        <div className="cyber-card p-4 border border-red-500/20">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <h3 className="text-sm font-bold text-gray-200">Invoice เกินกำหนด</h3>
          </div>
          {loading || !cf ? <Skeleton className="h-8 w-20" /> : (
            <>
              <p className="text-2xl font-bold text-red-400">{cf.ar.overdue.length} <span className="text-sm font-normal text-gray-400">รายการ</span></p>
              <p className="text-xs text-gray-500 mt-1">ค้างรับ {fmt(cf.ar.overdue.reduce((s,i) => s + i.amount, 0))}</p>
              {cf.ar.overdue.slice(0, 2).map(i => (
                <p key={i.id} className="text-xs text-red-400/70 truncate">{i.party_name} · {fmt(i.amount)}</p>
              ))}
            </>
          )}
        </div>
      </motion.div>

    </motion.div>
  )
}
