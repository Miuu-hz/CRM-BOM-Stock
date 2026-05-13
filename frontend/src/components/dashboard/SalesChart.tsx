import { motion } from 'framer-motion'
import { TrendingUp } from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

const data = [
  { month: 'Jan', sales: 2400000, orders: 45 },
  { month: 'Feb', sales: 1800000, orders: 38 },
  { month: 'Mar', sales: 3200000, orders: 52 },
  { month: 'Apr', sales: 2800000, orders: 48 },
  { month: 'May', sales: 3500000, orders: 58 },
  { month: 'Jun', sales: 4200000, orders: 65 },
  { month: 'Jul', sales: 3800000, orders: 60 },
]

function SalesChart() {
  return (
    <div className="phopy-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-6 h-6 text-success" />
          <h2 className="text-xl font-bold text-[var(--fg-1)]">
            Sales Overview
          </h2>
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-1 text-xs rounded-lg bg-phopy-indigo-50 text-phopy-indigo border border-phopy-indigo/30">
            7 Days
          </button>
          <button className="px-3 py-1 text-xs rounded-lg hover:bg-[var(--surface-2)] text-[var(--fg-3)]">
            30 Days
          </button>
          <button className="px-3 py-1 text-xs rounded-lg hover:bg-[var(--surface-2)] text-[var(--fg-3)]">
            90 Days
          </button>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3949E5" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3949E5" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#ECE6D8" opacity={0.5} />
          <XAxis
            dataKey="month"
            stroke="#6B6658"
            style={{ fontSize: '12px' }}
          />
          <YAxis
            stroke="#6B6658"
            style={{ fontSize: '12px' }}
            tickFormatter={(value) => `${(value / 1000000).toFixed(1)}M`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#FFFFFF',
              border: '1px solid #ECE6D8',
              borderRadius: '8px',
              boxShadow: '0 4px 12px -2px rgba(30, 27, 22, 0.08)',
            }}
            labelStyle={{ color: '#3949E5' }}
            itemStyle={{ color: '#1E1B16' }}
            formatter={(value: number) => [
              `฿${(value / 1000000).toFixed(2)}M`,
              'Sales',
            ]}
          />
          <Area
            type="monotone"
            dataKey="sales"
            stroke="#3949E5"
            strokeWidth={2}
            fill="url(#salesGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="text-center">
          <p className="text-xs text-[var(--fg-3)] mb-1">Total Sales</p>
          <p className="text-lg font-bold text-phopy-indigo">฿22.7M</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-[var(--fg-3)] mb-1">Avg. Order Value</p>
          <p className="text-lg font-bold text-success">฿62,500</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-[var(--fg-3)] mb-1">Total Orders</p>
          <p className="text-lg font-bold text-phopy-indigo">366</p>
        </div>
      </div>
    </div>
  )
}

export default SalesChart
