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
    <div className="phopy-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-[var(--primary)]" />
          <h2 className="text-xl font-bold text-[var(--fg-1)]">
            Production Status
          </h2>
        </div>
        <div className="text-right">
          <p className="text-xs text-[var(--fg-3)]">This Week</p>
          <p className="text-sm font-semibold text-success">
            940 / 1000 Units
          </p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ECE6D8" opacity={0.5} />
          <XAxis
            dataKey="product"
            stroke="#6B6658"
            style={{ fontSize: '12px' }}
            angle={-15}
            textAnchor="end"
            height={80}
          />
          <YAxis stroke="#6B6658" style={{ fontSize: '12px' }} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#FFFFFF',
              border: '1px solid #ECE6D8',
              borderRadius: '8px',
              boxShadow: '0 4px 12px -2px rgba(30, 27, 22, 0.08)',
            }}
            labelStyle={{ color: '#9333EA' }}
            itemStyle={{ color: '#1E1B16' }}
          />
          <Legend
            wrapperStyle={{
              fontSize: '12px',
              paddingTop: '20px',
            }}
          />
          <Bar dataKey="produced" fill="#16A34A" radius={[8, 8, 0, 0]} />
          <Bar dataKey="target" fill="#9333EA" radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      <div className="mt-4 flex items-center justify-between p-3 rounded-lg bg-[var(--surface-2)]/50 border border-[var(--border)]">
        <div>
          <p className="text-xs text-[var(--fg-3)] mb-1">Production Rate</p>
          <p className="text-sm font-semibold text-[var(--fg-2)]">94% of Target</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-[var(--fg-3)] mb-1">Efficiency</p>
          <p className="text-sm font-semibold text-success">+4.2%</p>
        </div>
      </div>
    </div>
  )
}

export default ProductionChart
