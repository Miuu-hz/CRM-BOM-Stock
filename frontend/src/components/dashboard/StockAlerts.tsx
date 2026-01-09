import { motion } from 'framer-motion'
import { AlertTriangle, Package } from 'lucide-react'

interface StockAlert {
  id: string
  item: string
  category: string
  current: number
  minimum: number
  unit: string
  level: 'critical' | 'warning' | 'low'
}

const alerts: StockAlert[] = [
  {
    id: '1',
    item: 'Foam Material',
    category: 'Raw Material',
    current: 150,
    minimum: 500,
    unit: 'kg',
    level: 'critical',
  },
  {
    id: '2',
    item: 'Spring Coils',
    category: 'Component',
    current: 300,
    minimum: 400,
    unit: 'units',
    level: 'warning',
  },
  {
    id: '3',
    item: 'Fabric Cover',
    category: 'Raw Material',
    current: 80,
    minimum: 100,
    unit: 'meters',
    level: 'warning',
  },
  {
    id: '4',
    item: 'Thread',
    category: 'Consumable',
    current: 20,
    minimum: 50,
    unit: 'rolls',
    level: 'critical',
  },
  {
    id: '5',
    item: 'Zipper',
    category: 'Component',
    current: 450,
    minimum: 500,
    unit: 'units',
    level: 'low',
  },
]

function StockAlerts() {
  return (
    <div className="cyber-card p-6">
      <div className="flex items-center gap-3 mb-6">
        <AlertTriangle className="w-6 h-6 text-yellow-400" />
        <h2 className="text-xl font-bold text-gray-100 font-['Orbitron']">
          Stock Alerts
        </h2>
      </div>

      <div className="space-y-3 max-h-[500px] overflow-y-auto cyber-scrollbar">
        {alerts.map((alert, index) => (
          <motion.div
            key={alert.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="p-4 rounded-lg bg-cyber-darker/50 border border-cyber-border hover:border-cyber-primary/30 transition-all"
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  alert.level === 'critical'
                    ? 'bg-red-500/20 border border-red-500/30'
                    : alert.level === 'warning'
                    ? 'bg-yellow-500/20 border border-yellow-500/30'
                    : 'bg-orange-500/20 border border-orange-500/30'
                }`}
              >
                <Package
                  className={`w-5 h-5 ${
                    alert.level === 'critical'
                      ? 'text-red-400'
                      : alert.level === 'warning'
                      ? 'text-yellow-400'
                      : 'text-orange-400'
                  }`}
                />
              </div>

              <div className="flex-1">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-200">
                      {alert.item}
                    </h3>
                    <p className="text-xs text-gray-500">{alert.category}</p>
                  </div>
                  <LevelBadge level={alert.level} />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Current Stock</span>
                    <span
                      className={`font-semibold ${
                        alert.level === 'critical'
                          ? 'text-red-400'
                          : alert.level === 'warning'
                          ? 'text-yellow-400'
                          : 'text-orange-400'
                      }`}
                    >
                      {alert.current} {alert.unit}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Minimum Required</span>
                    <span className="text-gray-300 font-semibold">
                      {alert.minimum} {alert.unit}
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-2 bg-cyber-darker rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{
                        width: `${(alert.current / alert.minimum) * 100}%`,
                      }}
                      transition={{ delay: index * 0.1, duration: 0.5 }}
                      className={`h-full ${
                        alert.level === 'critical'
                          ? 'bg-red-500'
                          : alert.level === 'warning'
                          ? 'bg-yellow-500'
                          : 'bg-orange-500'
                      }`}
                    />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function LevelBadge({ level }: { level: StockAlert['level'] }) {
  const config = {
    critical: {
      label: 'Critical',
      className: 'bg-red-500/20 text-red-400 border-red-500/30',
    },
    warning: {
      label: 'Warning',
      className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    },
    low: {
      label: 'Low',
      className: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    },
  }

  const selected = config[level]

  return (
    <span className={`status-badge ${selected.className}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      {selected.label}
    </span>
  )
}

export default StockAlerts
