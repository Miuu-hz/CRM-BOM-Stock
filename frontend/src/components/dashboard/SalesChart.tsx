import { motion } from 'framer-motion'
import { TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  return (
    <div className="phopy-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-6 h-6 text-success" />
          <h2 className="text-xl font-bold text-[var(--fg-1)]">
            {t('dashboard.salesChart.title')}
          </h2>
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-1 text-xs rounded-lg bg-[var(--primary-soft)] text-[var(--primary)] border border-phopy-indigo/30 min-h-[44px]">
            {t('dashboard.salesChart.7days')}
          </button>
          <button className="px-3 py-1 text-xs rounded-lg hover:bg-[var(--surface-2)] text-[var(--fg-3)] min-h-[44px]">
            {t('dashboard.salesChart.30days')}
          </button>
          <button className="px-3 py-1 text-xs rounded-lg hover:bg-[var(--surface-2)] text-[var(--fg-3)] min-h-[44px]">
            {t('dashboard.salesChart.90days')}
          </button>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
          <XAxis
            dataKey="month"
            stroke="var(--fg-3)"
            style={{ fontSize: '12px' }}
          />
          <YAxis
            stroke="var(--fg-3)"
            style={{ fontSize: '12px' }}
            tickFormatter={(value) => `${(value / 1000000).toFixed(1)}M`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              boxShadow: 'var(--shadow-2)',
            }}
            labelStyle={{ color: 'var(--primary)' }}
            itemStyle={{ color: 'var(--fg-1)' }}
            formatter={(value: number) => [
              `฿${(value / 1000000).toFixed(2)}M`,
              t('dashboard.salesChart.sales'),
            ]}
          />
          <Area
            type="monotone"
            dataKey="sales"
            name={t('dashboard.salesChart.sales')}
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#salesGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="text-center">
          <p className="text-xs text-[var(--fg-3)] mb-1">{t('dashboard.salesChart.totalSales')}</p>
          <p className="text-lg font-bold text-[var(--primary)]">฿22.7M</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-[var(--fg-3)] mb-1">{t('dashboard.salesChart.avgOrderValue')}</p>
          <p className="text-lg font-bold text-success">฿62,500</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-[var(--fg-3)] mb-1">{t('dashboard.salesChart.totalOrders')}</p>
          <p className="text-lg font-bold text-[var(--primary)]">366</p>
        </div>
      </div>
    </div>
  )
}

export default SalesChart
