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
    <div className="cyber-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-6 h-6 text-cyber-green" />
          <h2 className="text-xl font-bold text-gray-100 font-['Orbitron']">
            Sales Overview
          </h2>
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-1 text-xs rounded-lg bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/30">
            7 Days
          </button>
          <button className="px-3 py-1 text-xs rounded-lg hover:bg-cyber-card/50 text-gray-400">
            30 Days
          </button>
          <button className="px-3 py-1 text-xs rounded-lg hover:bg-cyber-card/50 text-gray-400">
            90 Days
          </button>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#00f0ff" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#00f0ff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#2d3250" opacity={0.3} />
          <XAxis
            dataKey="month"
            stroke="#6b7280"
            style={{ fontSize: '12px' }}
          />
          <YAxis
            stroke="#6b7280"
            style={{ fontSize: '12px' }}
            tickFormatter={(value) => `${(value / 1000000).toFixed(1)}M`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#151932',
              border: '1px solid #2d3250',
              borderRadius: '8px',
              boxShadow: '0 0 10px rgba(0, 240, 255, 0.3)',
            }}
            labelStyle={{ color: '#00f0ff' }}
            itemStyle={{ color: '#e5e7eb' }}
            formatter={(value: number) => [
              `฿${(value / 1000000).toFixed(2)}M`,
              'Sales',
            ]}
          />
          <Area
            type="monotone"
            dataKey="sales"
            stroke="#00f0ff"
            strokeWidth={2}
            fill="url(#salesGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="text-center">
          <p className="text-xs text-gray-400 mb-1">Total Sales</p>
          <p className="text-lg font-bold text-cyber-primary">฿22.7M</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-400 mb-1">Avg. Order Value</p>
          <p className="text-lg font-bold text-cyber-green">฿62,500</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-400 mb-1">Total Orders</p>
          <p className="text-lg font-bold text-cyber-purple">366</p>
        </div>
      </div>
    </div>
  )
}

export default SalesChart
