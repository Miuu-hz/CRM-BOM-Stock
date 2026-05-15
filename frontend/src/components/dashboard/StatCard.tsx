import { motion } from 'framer-motion'
import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react'

interface StatCardProps {
  title: string
  value: string
  change: string
  trend: 'up' | 'down'
  icon: LucideIcon
  color: 'primary' | 'green' | 'purple'
}

function StatCard({ title, value, change, trend, icon: Icon, color }: StatCardProps) {
  const colorClasses = {
    primary: {
      bg: 'from-phopy-indigo/20 to-phopy-indigo-600/20',
      border: 'border-phopy-indigo/50',
      text: 'text-[var(--primary)]',
      shadow: 'shadow-2',
    },
    green: {
      bg: 'from-success/20 to-success/20',
      border: 'border-success/50',
      text: 'text-success',
      shadow: 'shadow-2',
    },
    purple: {
      bg: 'from-purple-500/20 to-pink-500/20',
      border: 'border-purple-500/50',
      text: 'text-purple-500',
      shadow: 'shadow-2',
    },
  }

  const selectedColor = colorClasses[color]

  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -5 }}
      className={`phopy-card p-6 relative overflow-hidden ${selectedColor.shadow}`}
    >
      {/* Background Gradient */}
      <div
        className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${selectedColor.bg} rounded-full blur-2xl opacity-50`}
      />

      <div className="relative">
        {/* Icon */}
        <div className="flex items-start justify-between mb-4">
          <div
            className={`w-12 h-12 rounded-lg bg-gradient-to-br ${selectedColor.bg} border ${selectedColor.border} flex items-center justify-center`}
          >
            <Icon className={`w-6 h-6 ${selectedColor.text}`} />
          </div>
          <div
            className={`flex items-center gap-1 px-2 py-1 rounded-full ${
              trend === 'up' ? 'bg-[var(--success-soft)]' : 'bg-[var(--danger-soft)]'
            }`}
          >
            {trend === 'up' ? (
              <TrendingUp className="w-3 h-3 text-success" />
            ) : (
              <TrendingDown className="w-3 h-3 text-danger" />
            )}
            <span
              className={`text-xs font-semibold ${
                trend === 'up' ? 'text-success' : 'text-danger'
              }`}
            >
              {change}
            </span>
          </div>
        </div>

        {/* Stats */}
        <h3 className="text-[var(--fg-3)] text-sm font-medium mb-2">{title}</h3>
        <p className={`text-3xl font-bold ${selectedColor.text}`}>
          {value}
        </p>
      </div>
    </motion.div>
  )
}

export default StatCard
