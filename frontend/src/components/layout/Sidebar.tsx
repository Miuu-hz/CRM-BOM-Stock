import { NavLink } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  Users,
  FileText,
  Package,
  Calculator,
  ShoppingCart,
  Wrench,
  TrendingUp,
  Settings,
  LogOut,
  Zap,
} from 'lucide-react'

interface SidebarProps {
  isOpen: boolean
}

const menuItems = [
  {
    path: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
  },
  {
    path: '/crm',
    label: 'CRM',
    icon: Users,
    description: 'Customer Relations',
  },
  {
    path: '/bom',
    label: 'BOM',
    icon: FileText,
    description: 'Bill of Materials',
  },
  {
    path: '/stock',
    label: 'Stock',
    icon: Package,
    description: 'Inventory Management',
  },
  {
    path: '/purchase-orders',
    label: 'Purchase Orders',
    icon: ShoppingCart,
    description: 'Procurement Management',
  },
  {
    path: '/work-orders',
    label: 'Work Orders',
    icon: Wrench,
    description: 'Production Management',
  },
  {
    path: '/calculator',
    label: 'Calculator',
    icon: Calculator,
    description: 'Cost & Profit Analysis',
  },
  {
    path: '/marketing',
    label: 'Marketing',
    icon: TrendingUp,
    description: 'Campaign Analytics',
  },
]

const bottomMenuItems = [
  {
    path: '/settings',
    label: 'Settings',
    icon: Settings,
  },
]

function Sidebar({ isOpen }: SidebarProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          initial={{ x: -280 }}
          animate={{ x: 0 }}
          exit={{ x: -280 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="w-[280px] bg-gradient-card backdrop-blur-xl border-r border-cyber-border flex flex-col relative z-50"
        >
          {/* Logo Section */}
          <div className="p-6 border-b border-cyber-border">
            <div className="flex items-center gap-3">
              <motion.div
                animate={{
                  rotate: [0, 360],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: 'linear',
                }}
                className="w-10 h-10 bg-gradient-to-br from-cyber-primary via-cyber-purple to-cyber-green rounded-lg flex items-center justify-center shadow-neon"
              >
                <Zap className="w-6 h-6 text-white" />
              </motion.div>
              <div>
                <h1 className="text-xl font-bold neon-text font-['Orbitron']">
                  CRM-BOM
                </h1>
                <p className="text-xs text-gray-400">Bedding Factory</p>
              </div>
            </div>
          </div>

          {/* Navigation Menu */}
          <nav className="flex-1 py-6 px-3 overflow-y-auto cyber-scrollbar">
            <div className="space-y-2">
              {menuItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-3 rounded-lg transition-all group ${
                      isActive
                        ? 'bg-gradient-to-r from-cyber-primary/20 to-cyber-purple/20 border border-cyber-primary/50 shadow-neon'
                        : 'hover:bg-cyber-card/50 border border-transparent hover:border-cyber-border'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        className={`w-5 h-5 transition-colors ${
                          isActive
                            ? 'text-cyber-primary'
                            : 'text-gray-400 group-hover:text-cyber-primary'
                        }`}
                      />
                      <div className="flex-1">
                        <p
                          className={`font-semibold ${
                            isActive ? 'text-cyber-primary' : 'text-gray-300'
                          }`}
                        >
                          {item.label}
                        </p>
                        {item.description && (
                          <p className="text-xs text-gray-500">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </NavLink>
              ))}
            </div>

            {/* System Stats Card */}
            <motion.div
              whileHover={{ scale: 1.02 }}
              className="mt-6 p-4 bg-gradient-to-br from-cyber-purple/20 to-cyber-primary/20 rounded-lg border border-cyber-border glow-effect"
            >
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-cyber-green" />
                <p className="text-sm font-semibold text-gray-300">
                  System Status
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Active Orders</span>
                  <span className="text-cyber-green font-semibold">24</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Low Stock Items</span>
                  <span className="text-yellow-400 font-semibold">5</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Pending Tasks</span>
                  <span className="text-cyber-primary font-semibold">12</span>
                </div>
              </div>
            </motion.div>
          </nav>

          {/* Bottom Menu */}
          <div className="p-3 border-t border-cyber-border">
            {bottomMenuItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-cyber-card/50 transition-all group"
              >
                <item.icon className="w-5 h-5 text-gray-400 group-hover:text-cyber-primary transition-colors" />
                <span className="text-gray-300 font-medium">{item.label}</span>
              </NavLink>
            ))}

            <button className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-red-500/10 transition-all group mt-2">
              <LogOut className="w-5 h-5 text-gray-400 group-hover:text-red-400 transition-colors" />
              <span className="text-gray-300 font-medium group-hover:text-red-400 transition-colors">
                Logout
              </span>
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

export default Sidebar
