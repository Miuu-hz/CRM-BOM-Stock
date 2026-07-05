import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import {
  ShoppingBag, Megaphone, DollarSign, TrendingUp,
  TrendingDown, Package, Activity, AlertCircle
} from 'lucide-react'
import toast from 'react-hot-toast'
import { phopyBoardApi } from '../../services/phopyBoard'

const COLORS = ['#6366f1', '#f59e0b', '#22c55e', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316']

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
function fmtPct(n: number) { return n.toFixed(1) + '%' }

interface ExtendedData {
  channel: {
    byPlatform: Array<{ platform: string; revenue: number; orders: number }>
    onlineTotal: number; onlineOrders: number
    offlineRevenue: number; offlineOrders: number
    orderTrend: Array<{ month: string; online: number; offline: number }>
  }
  adsROI: {
    totals: { impressions: number; clicks: number; orders: number; revenue: number; adCost: number; roas: number; cpc: number; cpo: number; ctr: number; orderRate: number; revenuePerAdBaht: number }
    byPlatform: Array<{ platform: string; impressions: number; clicks: number; orders: number; revenue: number; adCost: number; roas: number; cpc: number; cpo: number }>
  }
  costStructure: {
    cogsByCategory: Array<{ category: string; amount: number }>
    expenseByCategory: Array<{ category: string; amount: number }>
    expenseRatio: number
    productionVariance: { estimated: number; actual: number; variancePct: number; count: number }
    costTrend: Array<{ month: string; cogs: number; opex: number }>
  }
  products: {
    top10: Array<{ id: string; name: string; code: string; revenue: number; unitsSold: number; orderCount: number; bomCost: number; margin: number }>
    bottom10: Array<{ id: string; name: string; code: string; revenue: number; unitsSold: number; orderCount: number; bomCost: number; margin: number }>
    concentrationRisk: number; totalRevenue: number
  }
  workingCapital: {
    currentAssets: number; currentLiabilities: number; cash: number; ar: number
    currentRatio: number; quickRatio: number; cashBurnRate: number
    wcTrend: Array<{ month: string; currentRatio: number; quickRatio: number }>
  }
}

interface Props {
  startDate: string
  endDate: string
}

export default function PhopyBoardExtended({ startDate, endDate }: Props) {
  const [data, setData] = useState<ExtendedData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const res = await phopyBoardApi.getExtended({ startDate, endDate })
        setData(res.data.data)
      } catch {
        toast.error('ไม่สามารถโหลดข้อมูลเพิ่มเติมได้')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [startDate, endDate])

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 border-4 border-[var(--primary)]/30 border-t-[var(--primary)] rounded-full animate-spin" />
    </div>
  )
  if (!data) return null

  const { channel, adsROI, costStructure, products, workingCapital } = data
  const totalRevenue = channel.onlineTotal + channel.offlineRevenue
  const onlinePct = totalRevenue > 0 ? (channel.onlineTotal / totalRevenue) * 100 : 0
  const offlinePct = 100 - onlinePct
  const splitData = [
    { name: 'Online', value: Math.round(onlinePct * 10) / 10 },
    { name: 'Offline', value: Math.round(offlinePct * 10) / 10 },
  ]

  const ratioColor = (r: number) => r >= 2 ? 'var(--success, #22c55e)' : r >= 1 ? 'var(--warning, #f59e0b)' : 'var(--danger, #ef4444)'
  const ratioLabel = (r: number) => r >= 2 ? 'สุขภาพดี' : r >= 1 ? 'ควรระวัง' : 'เสี่ยงสูง'

  return (
    <div className="space-y-8 mt-8">

      {/* ─── Zone 1: Channel Performance ─────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <ShoppingBag className="w-5 h-5 text-[var(--primary)]" />
          <h2 className="text-lg font-bold text-[var(--fg-1)]">Channel Performance</h2>
          <span className="text-xs text-[var(--fg-3)] ml-1">Online vs Offline · Revenue per Platform · Order Trend</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Online vs Offline Donut */}
          <motion.div {...fade(0)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <p className="text-sm font-semibold text-[var(--fg-2)] mb-3">สัดส่วนรายได้</p>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={splitData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                  {splitData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmtPct(v)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2 mt-1">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: COLORS[0] }} />Online</span>
                <span className="font-bold text-[var(--fg-1)]">฿{fmt(channel.onlineTotal)} ({fmtPct(onlinePct)})</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: COLORS[1] }} />Offline</span>
                <span className="font-bold text-[var(--fg-1)]">฿{fmt(channel.offlineRevenue)} ({fmtPct(offlinePct)})</span>
              </div>
            </div>
          </motion.div>

          {/* Revenue per Platform */}
          <motion.div {...fade(0.05)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <p className="text-sm font-semibold text-[var(--fg-2)] mb-3">รายได้ต่อ Platform</p>
            {channel.byPlatform.length === 0 ? (
              <p className="text-xs text-[var(--fg-4)] text-center py-8">ไม่มีข้อมูล Online</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={channel.byPlatform} layout="vertical" margin={{ left: 8 }}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--fg-3)' }} tickFormatter={v => '฿' + fmt(v)} />
                  <YAxis type="category" dataKey="platform" tick={{ fontSize: 11, fill: 'var(--fg-2)' }} width={60} />
                  <Tooltip formatter={(v: number) => '฿' + fmt(v)} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
                  <Bar dataKey="revenue" fill={COLORS[0]} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </motion.div>

          {/* Order Volume Trend */}
          <motion.div {...fade(0.1)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <p className="text-sm font-semibold text-[var(--fg-2)] mb-3">Order Volume Trend (12 เดือน)</p>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={channel.orderTrend} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: 'var(--fg-3)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--fg-3)' }} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="online" stackId="1" stroke={COLORS[0]} fill={COLORS[0] + '40'} name="Online" />
                <Area type="monotone" dataKey="offline" stackId="1" stroke={COLORS[1]} fill={COLORS[1] + '40'} name="Offline" />
              </AreaChart>
            </ResponsiveContainer>
          </motion.div>
        </div>
      </div>

      {/* ─── Zone 2: Ads ROI ─────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Megaphone className="w-5 h-5 text-[var(--primary)]" />
          <h2 className="text-lg font-bold text-[var(--fg-1)]">Ads ROI Dashboard</h2>
          <span className="text-xs text-[var(--fg-3)] ml-1">CPO · CPC · Conversion Funnel · Revenue/Ad Baht</span>
        </div>
        {/* KPI Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'ROAS', value: `${fmtDec(adsROI.totals.roas)}x`, sub: 'รายได้ต่อ ฿1 โฆษณา' },
            { label: 'CPC', value: `฿${fmtDec(adsROI.totals.cpc)}`, sub: 'ต้นทุนต่อคลิก' },
            { label: 'CPO', value: `฿${fmt(adsROI.totals.cpo)}`, sub: 'ต้นทุนต่อ Order' },
            { label: 'Rev/Ad ฿', value: `฿${fmtDec(adsROI.totals.revenuePerAdBaht)}`, sub: 'รายได้ต่อ ฿1 โฆษณา' },
          ].map((k, i) => (
            <motion.div key={k.label} {...fade(i * 0.05)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
              <p className="text-xs text-[var(--fg-3)]">{k.label}</p>
              <p className="text-xl font-bold text-[var(--fg-1)] mt-1">{k.value}</p>
              <p className="text-xs text-[var(--fg-4)] mt-0.5">{k.sub}</p>
            </motion.div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Conversion Funnel */}
          <motion.div {...fade(0.1)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <p className="text-sm font-semibold text-[var(--fg-2)] mb-4">Conversion Funnel</p>
            <div className="space-y-3">
              {[
                { label: 'Impressions', value: fmt(adsROI.totals.impressions), pct: 100, color: COLORS[0] },
                { label: 'Clicks', value: fmt(adsROI.totals.clicks), pct: adsROI.totals.ctr, color: COLORS[2] },
                { label: 'Orders', value: fmt(adsROI.totals.orders), pct: adsROI.totals.orderRate, color: COLORS[1] },
              ].map((step, i) => (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--fg-2)]">{step.label}</span>
                    <span className="font-semibold text-[var(--fg-1)]">{step.value} {i > 0 && <span className="text-xs text-[var(--fg-3)]">({fmtPct(step.pct)})</span>}</span>
                  </div>
                  <div className="h-6 bg-[var(--surface-2)] rounded-full overflow-hidden">
                    <div className="h-full rounded-full flex items-center justify-start pl-2" style={{ width: `${Math.max(5, i === 0 ? 100 : Math.min(100, step.pct * 20))}%`, background: step.color }}>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Platform Comparison Table */}
          <motion.div {...fade(0.15)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <p className="text-sm font-semibold text-[var(--fg-2)] mb-3">เปรียบเทียบ Platform</p>
            {adsROI.byPlatform.length === 0 ? (
              <p className="text-xs text-[var(--fg-4)] text-center py-8">ไม่มีข้อมูล</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      {['Platform', 'Revenue', 'Ad Cost', 'ROAS', 'CPC', 'CPO'].map(h => (
                        <th key={h} className="text-left text-[var(--fg-3)] py-2 pr-3 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {adsROI.byPlatform.map((p, i) => (
                      <tr key={i} className="border-b border-[var(--border)] last:border-0">
                        <td className="py-2 pr-3 font-semibold text-[var(--fg-1)]">{p.platform}</td>
                        <td className="py-2 pr-3 text-[var(--fg-2)]">฿{fmt(p.revenue)}</td>
                        <td className="py-2 pr-3 text-[var(--fg-2)]">฿{fmt(p.adCost)}</td>
                        <td className="py-2 pr-3 font-bold" style={{ color: p.roas >= 3 ? 'var(--success, #22c55e)' : p.roas >= 1 ? 'var(--warning, #f59e0b)' : 'var(--danger)' }}>{fmtDec(p.roas)}x</td>
                        <td className="py-2 pr-3 text-[var(--fg-2)]">฿{fmtDec(p.cpc)}</td>
                        <td className="py-2 text-[var(--fg-2)]">฿{fmt(p.cpo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        </div>
      </div>

      {/* ─── Zone 3: Cost Structure ──────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="w-5 h-5 text-[var(--primary)]" />
          <h2 className="text-lg font-bold text-[var(--fg-1)]">Cost Structure</h2>
          <span className="text-xs text-[var(--fg-3)] ml-1">COGS Breakdown · Expense Ratio · Production Variance · Cost Trend</span>
        </div>
        {/* KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <motion.div {...fade(0)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
            <p className="text-xs text-[var(--fg-3)]">Expense Ratio</p>
            <p className="text-2xl font-bold mt-1" style={{ color: costStructure.expenseRatio > 80 ? 'var(--danger)' : costStructure.expenseRatio > 60 ? 'var(--warning, #f59e0b)' : 'var(--success, #22c55e)' }}>{fmtPct(costStructure.expenseRatio)}</p>
            <p className="text-xs text-[var(--fg-4)] mt-0.5">ค่าใช้จ่ายต่อรายได้</p>
          </motion.div>
          <motion.div {...fade(0.05)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
            <p className="text-xs text-[var(--fg-3)]">Production Cost Variance</p>
            <p className="text-2xl font-bold mt-1" style={{ color: costStructure.productionVariance.variancePct > 10 ? 'var(--danger)' : costStructure.productionVariance.variancePct > 5 ? 'var(--warning, #f59e0b)' : 'var(--success, #22c55e)' }}>
              {costStructure.productionVariance.variancePct > 0 ? '+' : ''}{fmtPct(costStructure.productionVariance.variancePct)}
            </p>
            <p className="text-xs text-[var(--fg-4)] mt-0.5">Actual vs Estimated ({costStructure.productionVariance.count} WO)</p>
          </motion.div>
          <motion.div {...fade(0.1)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
            <p className="text-xs text-[var(--fg-3)]">Total COGS (งวดนี้)</p>
            <p className="text-2xl font-bold text-[var(--fg-1)] mt-1">฿{fmt(costStructure.cogsByCategory.reduce((s, r) => s + r.amount, 0))}</p>
            <p className="text-xs text-[var(--fg-4)] mt-0.5">{costStructure.cogsByCategory.length} หมวดวัตถุดิบ</p>
          </motion.div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* COGS Donut */}
          <motion.div {...fade(0.05)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <p className="text-sm font-semibold text-[var(--fg-2)] mb-3">COGS Breakdown</p>
            {costStructure.cogsByCategory.length === 0 ? (
              <p className="text-xs text-[var(--fg-4)] text-center py-8">ไม่มีข้อมูล</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={costStructure.cogsByCategory} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="amount" paddingAngle={2}>
                      {costStructure.cogsByCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => '฿' + fmt(v)} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 mt-1">
                  {costStructure.cogsByCategory.slice(0, 5).map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full flex-none" style={{ background: COLORS[i % COLORS.length] }} /><span className="text-[var(--fg-3)] truncate max-w-[110px]">{c.category}</span></span>
                      <span className="text-[var(--fg-2)] font-medium">฿{fmt(c.amount)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </motion.div>
          {/* Expense by Category */}
          <motion.div {...fade(0.1)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <p className="text-sm font-semibold text-[var(--fg-2)] mb-3">ค่าใช้จ่ายตามหมวด</p>
            {costStructure.expenseByCategory.length === 0 ? (
              <p className="text-xs text-[var(--fg-4)] text-center py-8">ไม่มีข้อมูล</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={costStructure.expenseByCategory.slice(0, 8)} layout="vertical" margin={{ left: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--fg-3)' }} tickFormatter={v => fmt(v)} />
                  <YAxis type="category" dataKey="category" tick={{ fontSize: 10, fill: 'var(--fg-2)' }} width={80} />
                  <Tooltip formatter={(v: number) => '฿' + fmt(v)} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
                  <Bar dataKey="amount" fill={COLORS[4]} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </motion.div>
          {/* Cost Trend 12mo */}
          <motion.div {...fade(0.15)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <p className="text-sm font-semibold text-[var(--fg-2)] mb-3">Cost Trend (12 เดือน)</p>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={costStructure.costTrend} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: 'var(--fg-3)' }} />
                <YAxis tick={{ fontSize: 9, fill: 'var(--fg-3)' }} tickFormatter={v => fmt(v)} />
                <Tooltip formatter={(v: number) => '฿' + fmt(v)} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="cogs" stackId="1" stroke={COLORS[3]} fill={COLORS[3] + '50'} name="COGS" />
                <Area type="monotone" dataKey="opex" stackId="1" stroke={COLORS[4]} fill={COLORS[4] + '50'} name="OpEx" />
              </AreaChart>
            </ResponsiveContainer>
          </motion.div>
        </div>
      </div>

      {/* ─── Zone 4: Product Profitability ───────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Package className="w-5 h-5 text-[var(--primary)]" />
          <h2 className="text-lg font-bold text-[var(--fg-1)]">Product Profitability</h2>
          <span className="text-xs text-[var(--fg-3)] ml-1">Revenue · Margin · Top 10 / Bottom 10 · Concentration</span>
        </div>
        {/* Concentration KPI */}
        <motion.div {...fade(0)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 mb-4 flex items-center gap-6">
          <div>
            <p className="text-xs text-[var(--fg-3)]">Revenue Concentration (Top 5 SKU)</p>
            <p className="text-2xl font-bold mt-0.5" style={{ color: products.concentrationRisk > 70 ? 'var(--danger)' : products.concentrationRisk > 50 ? 'var(--warning, #f59e0b)' : 'var(--success, #22c55e)' }}>{fmtPct(products.concentrationRisk)}</p>
          </div>
          <div className="text-xs text-[var(--fg-3)]">
            {products.concentrationRisk > 70 ? '⚠️ เสี่ยงสูง — พึ่งพา SKU หลักมากเกินไป' : products.concentrationRisk > 50 ? '🟡 ควรกระจายสินค้า' : '✅ กระจายความเสี่ยงดี'}
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-[var(--fg-3)]">Total Revenue</p>
            <p className="text-lg font-bold text-[var(--fg-1)]">฿{fmt(products.totalRevenue)}</p>
          </div>
        </motion.div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top 10 */}
          <motion.div {...fade(0.05)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <p className="text-sm font-semibold text-[var(--fg-2)] mb-3">🏆 Top 10 by Revenue</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    {['#', 'สินค้า', 'Revenue', 'Margin%'].map(h => (
                      <th key={h} className="text-left text-[var(--fg-3)] py-1.5 pr-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {products.top10.map((p, i) => (
                    <tr key={p.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-1.5 pr-3 text-[var(--fg-3)]">{i + 1}</td>
                      <td className="py-1.5 pr-3 text-[var(--fg-1)] font-medium max-w-[120px] truncate">{p.name}</td>
                      <td className="py-1.5 pr-3 text-[var(--fg-2)]">฿{fmt(p.revenue)}</td>
                      <td className="py-1.5 font-bold" style={{ color: p.margin >= 30 ? 'var(--success, #22c55e)' : p.margin >= 10 ? 'var(--warning, #f59e0b)' : 'var(--danger)' }}>{fmtPct(p.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
          {/* Bottom 10 */}
          <motion.div {...fade(0.1)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <p className="text-sm font-semibold text-[var(--fg-2)] mb-3">⚠️ Bottom 10 by Margin</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    {['#', 'สินค้า', 'Revenue', 'Margin%'].map(h => (
                      <th key={h} className="text-left text-[var(--fg-3)] py-1.5 pr-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {products.bottom10.map((p, i) => (
                    <tr key={p.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-1.5 pr-3 text-[var(--fg-3)]">{i + 1}</td>
                      <td className="py-1.5 pr-3 text-[var(--fg-1)] font-medium max-w-[120px] truncate">{p.name}</td>
                      <td className="py-1.5 pr-3 text-[var(--fg-2)]">฿{fmt(p.revenue)}</td>
                      <td className="py-1.5 font-bold" style={{ color: p.margin >= 30 ? 'var(--success, #22c55e)' : p.margin >= 10 ? 'var(--warning, #f59e0b)' : 'var(--danger)' }}>{fmtPct(p.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>
      </div>

      {/* ─── Zone 5: Working Capital ─────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5 text-[var(--primary)]" />
          <h2 className="text-lg font-bold text-[var(--fg-1)]">Working Capital Health</h2>
          <span className="text-xs text-[var(--fg-3)] ml-1">Current Ratio · Quick Ratio · Cash Burn · WC Trend</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {[
            { label: 'Current Ratio', value: fmtDec(workingCapital.currentRatio), sub: `สินทรัพย์ ÷ หนี้สิน`, ratio: workingCapital.currentRatio },
            { label: 'Quick Ratio', value: fmtDec(workingCapital.quickRatio), sub: `(เงินสด + ลูกหนี้) ÷ หนี้สิน`, ratio: workingCapital.quickRatio },
            { label: 'Cash Burn Rate', value: `฿${fmt(workingCapital.cashBurnRate)}/เดือน`, sub: 'เฉลี่ย 3 เดือนล่าสุด', ratio: -1 },
          ].map((k, i) => (
            <motion.div key={k.label} {...fade(i * 0.05)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
              <p className="text-xs text-[var(--fg-3)]">{k.label}</p>
              <p className="text-3xl font-bold mt-2" style={{ color: k.ratio >= 0 ? ratioColor(k.ratio) : 'var(--fg-1)' }}>{k.value}</p>
              <p className="text-xs text-[var(--fg-4)] mt-1">{k.sub}</p>
              {k.ratio >= 0 && (
                <span className="inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-semibold text-white" style={{ background: ratioColor(k.ratio) }}>
                  {ratioLabel(k.ratio)}
                </span>
              )}
            </motion.div>
          ))}
        </div>
        <motion.div {...fade(0.1)} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <p className="text-sm font-semibold text-[var(--fg-2)] mb-3">Working Capital Trend (12 เดือน)</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={workingCapital.wcTrend} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 9, fill: 'var(--fg-3)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--fg-3)' }} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="currentRatio" stroke={COLORS[0]} strokeWidth={2} dot={false} name="Current Ratio" />
              <Line type="monotone" dataKey="quickRatio" stroke={COLORS[2]} strokeWidth={2} dot={false} name="Quick Ratio" strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

    </div>
  )
}
