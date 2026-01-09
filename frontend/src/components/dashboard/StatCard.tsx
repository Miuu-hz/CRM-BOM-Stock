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
      bg: 'from-cyber-primary/20 to-cyber-secondary/20',
      border: 'border-cyber-primary/50',
      text: 'text-cyber-primary',
      shadow: 'shadow-neon',
    },
    green: {
      bg: 'from-cyber-green/20 to-emerald-500/20',
      border: 'border-cyber-green/50',
      text: 'text-cyber-green',
      shadow: 'shadow-green-neon',
    },
    purple: {
      bg: 'from-cyber-purple/20 to-cyber-magenta/20',
      border: 'border-cyber-purple/50',
      text: 'text-cyber-purple',
      shadow: 'shadow-purple-neon',
    },
  }

  const selectedColor = colorClasses[color]

  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -5 }}
      className={`cyber-card p-6 relative overflow-hidden ${selectedColor.shadow}`}
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
              trend === 'up' ? 'bg-cyber-green/20' : 'bg-red-500/20'
            }`}
          >
            {trend === 'up' ? (
              <TrendingUp className="w-3 h-3 text-cyber-green" />
            ) : (
              <TrendingDown className="w-3 h-3 text-red-400" />
            )}
            <span
              className={`text-xs font-semibold ${
                trend === 'up' ? 'text-cyber-green' : 'text-red-400'
              }`}
            >
              {change}
            </span>
          </div>
        </div>

        {/* Stats */}
        <h3 className="text-gray-400 text-sm font-medium mb-2">{title}</h3>
        <p className={`text-3xl font-bold ${selectedColor.text} font-['Orbitron']`}>
          {value}
        </p>
      </div>
    </motion.div>
  )
}

export default StatCard
