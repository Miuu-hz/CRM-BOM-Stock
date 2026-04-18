import { motion } from 'framer-motion'
import { Activity } from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

const data = [
  { product: 'Mattress', produced: 120, target: 150 },
  { product: 'Pillow', produced: 350, target: 300 },
  { product: 'Blanket', produced: 200, target: 250 },
  { product: 'Bed Sheet', produced: 180, target: 200 },
  { product: 'Comforter', produced: 90, target: 100 },
]

function ProductionChart() {
  return (
    <div className="cyber-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-cyber-purple" />
          <h2 className="text-xl font-bold text-gray-100">
            Production Status
          </h2>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">This Week</p>
          <p className="text-sm font-semibold text-cyber-green">
            940 / 1000 Units
          </p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2d3250" opacity={0.3} />
          <XAxis
            dataKey="product"
            stroke="#6b7280"
            style={{ fontSize: '12px' }}
            angle={-15}
            textAnchor="end"
            height={80}
          />
          <YAxis stroke="#6b7280" style={{ fontSize: '12px' }} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#151932',
              border: '1px solid #2d3250',
              borderRadius: '8px',
              boxShadow: '0 0 10px rgba(157, 0, 255, 0.3)',
            }}
            labelStyle={{ color: '#9d00ff' }}
            itemStyle={{ color: '#e5e7eb' }}
          />
          <Legend
            wrapperStyle={{
              fontSize: '12px',
              paddingTop: '20px',
            }}
          />
          <Bar dataKey="produced" fill="#00ff88" radius={[8, 8, 0, 0]} />
          <Bar dataKey="target" fill="#9d00ff" radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      <div className="mt-4 flex items-center justify-between p-3 rounded-lg bg-cyber-darker/50 border border-cyber-border">
        <div>
          <p className="text-xs text-gray-400 mb-1">Production Rate</p>
          <p className="text-sm font-semibold text-gray-200">94% of Target</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400 mb-1">Efficiency</p>
          <p className="text-sm font-semibold text-cyber-green">+4.2%</p>
        </div>
      </div>
    </div>
  )
}

export default ProductionChart
