import { motion } from 'framer-motion'
import {
  Users,
  Package,
  ShoppingCart,
  TrendingUp,
  AlertTriangle,
  Activity,
} from 'lucide-react'
import StatCard from '../components/dashboard/StatCard'
import RecentOrders from '../components/dashboard/RecentOrders'
import StockAlerts from '../components/dashboard/StockAlerts'
import SalesChart from '../components/dashboard/SalesChart'
import ProductionChart from '../components/dashboard/ProductionChart'

function Dashboard() {
  const stats = [
    {
      title: 'Total Customers',
      value: '1,248',
      change: '+12.5%',
      trend: 'up',
      icon: Users,
      color: 'primary',
    },
    {
      title: 'Active Orders',
      value: '48',
      change: '+8.2%',
      trend: 'up',
      icon: ShoppingCart,
      color: 'green',
    },
    {
      title: 'Stock Items',
      value: '3,456',
      change: '-2.4%',
      trend: 'down',
      icon: Package,
      color: 'purple',
    },
    {
      title: 'Revenue (Month)',
      value: '฿2.4M',
      change: '+15.3%',
      trend: 'up',
      icon: TrendingUp,
      color: 'primary',
    },
  ]

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  }

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        type: 'spring',
        damping: 15,
      },
    },
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* Header */}
      <motion.div variants={itemVariants}>
        <h1 className="text-3xl font-bold text-gray-100 mb-2 font-['Orbitron']">
          <span className="neon-text">Dashboard</span>
        </h1>
        <p className="text-gray-400">Welcome back! Here's your system overview</p>
      </motion.div>

      {/* Stats Grid */}
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
      >
        {(stats || []).map((stat, index) => (
          <StatCard key={index} {...stat} />
        ))}
      </motion.div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales Chart */}
        <motion.div variants={itemVariants}>
          <SalesChart />
        </motion.div>

        {/* Production Chart */}
        <motion.div variants={itemVariants}>
          <ProductionChart />
        </motion.div>
      </div>

      {/* Bottom Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Orders */}
        <motion.div variants={itemVariants} className="lg:col-span-2">
          <RecentOrders />
        </motion.div>

        {/* Stock Alerts */}
        <motion.div variants={itemVariants}>
          <StockAlerts />
        </motion.div>
      </div>

      {/* System Activity Card */}
      <motion.div
        variants={itemVariants}
        className="cyber-card p-6 scan-line-effect"
      >
        <div className="flex items-center gap-3 mb-4">
          <Activity className="w-6 h-6 text-cyber-primary" />
          <h2 className="text-xl font-bold text-gray-100 font-['Orbitron']">
            System Activity
          </h2>
        </div>
        <div className="space-y-3">
          <ActivityItem
            time="2 min ago"
            text="New order #ORD-1234 received from Hotel Grand"
            type="success"
          />
          <ActivityItem
            time="15 min ago"
            text="Stock alert: Foam material running low"
            type="warning"
          />
          <ActivityItem
            time="1 hour ago"
            text="Production batch #BTH-567 completed"
            type="success"
          />
          <ActivityItem
            time="2 hours ago"
            text="New customer registered: ABC Trading Co."
            type="info"
          />
        </div>
      </motion.div>
    </motion.div>
  )
}

function ActivityItem({
  time,
  text,
  type,
}: {
  time: string
  text: string
  type: 'success' | 'warning' | 'info'
}) {
  const colors = {
    success: 'text-cyber-green',
    warning: 'text-yellow-400',
    info: 'text-cyber-primary',
  }

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-cyber-darker/50 border border-cyber-border hover:border-cyber-primary/30 transition-all">
      <div className={`w-2 h-2 rounded-full mt-2 ${colors[type]} animate-pulse`} />
      <div className="flex-1">
        <p className="text-sm text-gray-300">{text}</p>
        <p className="text-xs text-gray-500 mt-1">{time}</p>
      </div>
    </div>
  )
}

export default Dashboard
