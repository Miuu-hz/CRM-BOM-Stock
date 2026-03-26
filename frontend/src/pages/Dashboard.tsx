import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Users, Package, ShoppingCart, TrendingUp,
  AlertTriangle, Activity, RefreshCw, BarChart2,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import api from '../utils/api'

// ---- Types ----
interface Stats {
  totalCustomers: number
  activeOrders: number
  stockItems: number
  monthlyRevenue: number
}
interface ChartPoint { month: string; label: string; revenue: number; orders: number }
interface LowStockItem { id: string; name: string; sku: string; quantity: number; min_stock: number; unit: string }
interface Activity { id: string; type: string; message: string; timestamp: string }

// ---- Helpers ----
const fmt = (n: number) =>
  n >= 1_000_000 ? `฿${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `฿${(n / 1_000).toFixed(0)}K`
  : `฿${n.toLocaleString()}`

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'เมื่อกี้'
  if (m < 60) return `${m} นาทีที่แล้ว`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ชั่วโมงที่แล้ว`
  return `${Math.floor(h / 24)} วันที่แล้ว`
}

// ---- Custom Tooltip ----
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-cyber-card border border-cyber-border rounded-lg px-3 py-2 text-xs">
      <p className="text-gray-300 font-medium mb-1">{label}</p>
      <p className="text-cyber-primary">รายได้: {fmt(payload[0]?.value ?? 0)}</p>
      <p className="text-cyber-green">ออเดอร์: {payload[1]?.value ?? 0}</p>
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [chart, setChart] = useState<ChartPoint[]>([])
  const [lowStock, setLowStock] = useState<LowStockItem[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  const load = async () => {
    setLoading(true)
    try {
      const [s, c, l, a] = await Promise.all([
        api.get('/dashboard/stats'),
        api.get('/dashboard/charts'),
        api.get('/dashboard/low-stock'),
        api.get('/dashboard/activities'),
      ])
      setStats(s.data.data)
      setChart(c.data.data)
      setLowStock(l.data.data)
      setActivities(a.data.data)
      setLastUpdated(new Date())
    } catch (e) {
      console.error('Dashboard load error:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const statCards = stats ? [
    { title: 'ลูกค้าทั้งหมด', value: stats.totalCustomers.toLocaleString(), icon: Users, color: 'text-cyber-primary', bg: 'bg-cyber-primary/10 border-cyber-primary/30' },
    { title: 'ออเดอร์ที่รอดำเนินการ', value: stats.activeOrders.toLocaleString(), icon: ShoppingCart, color: 'text-cyber-green', bg: 'bg-cyber-green/10 border-cyber-green/30' },
    { title: 'รายการสต๊อก', value: stats.stockItems.toLocaleString(), icon: Package, color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30' },
    { title: 'รายได้เดือนนี้', value: fmt(stats.monthlyRevenue), icon: TrendingUp, color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30' },
  ] : []

  const container = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.08 } } }
  const item = { hidden: { y: 16, opacity: 0 }, visible: { y: 0, opacity: 1, transition: { type: 'spring', damping: 18 } } }

  return (
    <motion.div variants={container} initial="hidden" animate="visible" className="space-y-6">

      {/* Header */}
      <motion.div variants={item} className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold neon-text font-['Orbitron']">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">
            อัพเดทล่าสุด: {lastUpdated.toLocaleTimeString('th-TH')}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-cyber-primary/10 border border-cyber-primary/30 text-cyber-primary rounded-lg hover:bg-cyber-primary/20 transition-colors text-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          รีเฟรช
        </button>
      </motion.div>

      {/* Stat Cards */}
      <motion.div variants={item} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading && !stats
          ? Array(4).fill(0).map((_, i) => (
              <div key={i} className="cyber-card p-6 animate-pulse">
                <div className="h-4 bg-cyber-border rounded w-3/4 mb-4" />
                <div className="h-8 bg-cyber-border rounded w-1/2" />
              </div>
            ))
          : statCards.map((s) => (
              <div key={s.title} className={`cyber-card p-6 border ${s.bg}`}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-gray-400 text-sm">{s.title}</p>
                  <s.icon className={`w-5 h-5 ${s.color}`} />
                </div>
                <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))
        }
      </motion.div>

      {/* Sales Chart + Low Stock */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales Chart */}
        <motion.div variants={item} className="lg:col-span-2 cyber-card p-6">
          <div className="flex items-center gap-2 mb-6">
            <BarChart2 className="w-5 h-5 text-cyber-primary" />
            <h2 className="text-lg font-bold text-gray-100 font-['Orbitron']">รายได้ย้อนหลัง 6 เดือน</h2>
          </div>
          {chart.length === 0 && loading ? (
            <div className="h-48 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-cyber-primary/30 border-t-cyber-primary rounded-full animate-spin" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chart} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(99,102,241,0.08)' }} />
                <Bar dataKey="revenue" fill="#6366f1" radius={[4, 4, 0, 0]} name="รายได้" />
                <Bar dataKey="orders" fill="#22c55e" radius={[4, 4, 0, 0]} name="ออเดอร์" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        {/* Low Stock Alerts */}
        <motion.div variants={item} className="cyber-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            <h2 className="text-lg font-bold text-gray-100 font-['Orbitron']">สต๊อกต่ำ</h2>
            {lowStock.length > 0 && (
              <span className="ml-auto text-xs px-2 py-0.5 bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 rounded-full">
                {lowStock.length} รายการ
              </span>
            )}
          </div>
          {loading && lowStock.length === 0 ? (
            <div className="space-y-2">
              {Array(4).fill(0).map((_, i) => <div key={i} className="h-10 bg-cyber-border/30 rounded animate-pulse" />)}
            </div>
          ) : lowStock.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-gray-500">
              <Package className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm">สต๊อกปกติทุกรายการ</p>
            </div>
          ) : (
            <div className="space-y-2 overflow-y-auto max-h-56 cyber-scrollbar pr-1">
              {lowStock.map(item => {
                const pct = item.min_stock > 0 ? Math.round((item.quantity / item.min_stock) * 100) : 0
                const urgent = pct <= 25
                return (
                  <div key={item.id} className={`p-3 rounded-lg border ${urgent ? 'bg-red-500/10 border-red-500/30' : 'bg-yellow-500/5 border-yellow-500/20'}`}>
                    <div className="flex justify-between items-start">
                      <p className="text-sm text-gray-200 font-medium truncate flex-1 mr-2">{item.name}</p>
                      <span className={`text-xs font-bold ${urgent ? 'text-red-400' : 'text-yellow-400'}`}>
                        {item.quantity} {item.unit}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 bg-cyber-border rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${urgent ? 'bg-red-400' : 'bg-yellow-400'}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">ขั้นต่ำ {item.min_stock} {item.unit}</p>
                  </div>
                )
              })}
            </div>
          )}
        </motion.div>
      </div>

      {/* Recent Activity */}
      <motion.div variants={item} className="cyber-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5 text-cyber-primary" />
          <h2 className="text-lg font-bold text-gray-100 font-['Orbitron']">กิจกรรมล่าสุด</h2>
        </div>
        {loading && activities.length === 0 ? (
          <div className="space-y-2">
            {Array(5).fill(0).map((_, i) => <div key={i} className="h-12 bg-cyber-border/30 rounded animate-pulse" />)}
          </div>
        ) : activities.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-6">ยังไม่มีกิจกรรม</p>
        ) : (
          <div className="space-y-2">
            {activities.map(a => (
              <div key={a.id} className="flex items-start gap-3 p-3 rounded-lg bg-cyber-darker/50 border border-cyber-border hover:border-cyber-primary/30 transition-all">
                <div className="w-2 h-2 rounded-full mt-2 bg-cyber-primary animate-pulse flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-300 truncate">{a.message}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{timeAgo(a.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>

    </motion.div>
  )
}
