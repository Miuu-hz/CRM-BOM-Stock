import { NavLink, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
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
  BookOpen,
  BarChart3,
  Landmark,
  Percent,
  Factory,
  Store,
  MonitorPlay,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import api from '../../utils/api'

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
    path: '/production',
    label: 'Production',
    icon: Factory,
    description: 'BOM & Work Orders',
    isParent: true,
    subMenu: [
      { path: '/bom', label: 'BOM', icon: FileText },
      { path: '/work-orders', label: 'Work Orders', icon: Wrench },
    ]
  },
  {
    path: '/stock',
    label: 'Stock',
    icon: Package,
    description: 'Inventory Management',
  },
  {
    path: '/purchase',
    label: 'Purchase',
    icon: ShoppingCart,
    description: 'Procurement Management',
  },
  {
    path: '/calculator',
    label: 'Calculator',
    icon: Calculator,
    description: 'Cost & Profit Analysis',
  },
  {
    path: '/sales',
    label: 'Sales',
    icon: TrendingUp,
    description: 'Sales & Invoicing',
  },
  {
    path: '/marketing',
    label: 'Marketing',
    icon: TrendingUp,
    description: 'Campaign Analytics',
  },
  {
    path: '/tax',
    label: 'Tax',
    icon: Percent,
    description: 'VAT, WHT & CIT Management',
  },
  {
    path: '/accounting',
    label: 'Accounting',
    icon: Landmark,
    description: 'Chart of Accounts & Reports',
    isParent: true,
    subMenu: [
      { path: '/accounting/chart-of-accounts', label: 'Chart of Accounts', icon: BookOpen },
      { path: '/accounting/journal-entries', label: 'Journal Entries', icon: FileText },
      { path: '/accounting/pos-clearing', label: 'POS Clearing', icon: Store },
      { path: '/accounting/reports', label: 'Financial Reports', icon: BarChart3 },
    ]
  },
  {
    path: '/cashier',
    label: 'Cashier',
    icon: Store,
    description: 'POS & Quick Sales',
  },
  {
    path: '/kds',
    label: 'Kitchen Display',
    icon: MonitorPlay,
    description: 'POS Orders Queue (KDS)',
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
  const { user, isMaster, logout } = useAuth()
  const location = useLocation()
  const [sysStats, setSysStats] = useState({ activeOrders: 0, lowStock: 0, pendingPO: 0 })

  useEffect(() => {
    const load = async () => {
      try {
        const [stats, stock, po] = await Promise.all([
          api.get('/dashboard/stats'),
          api.get('/dashboard/low-stock'),
          api.get('/purchase-orders?status=PENDING').catch(() => ({ data: { data: [] } })),
        ])
        setSysStats({
          activeOrders: stats.data.data?.activeOrders ?? 0,
          lowStock: Array.isArray(stock.data.data) ? stock.data.data.length : 0,
          pendingPO: Array.isArray(po.data.data) ? po.data.data.length : 0,
        })
      } catch {}
    }
    load()
    const interval = setInterval(load, 60_000)
    return () => clearInterval(interval)
  }, [])

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

          {/* User Info */}
          <div className="px-6 py-3 border-b border-cyber-border">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isMaster ? 'bg-gradient-to-br from-cyber-green to-emerald-500' : 'bg-gradient-to-br from-cyber-primary to-cyber-purple'
                }`}>
                <span className="text-white font-bold text-sm">
                  {user?.name?.charAt(0).toUpperCase() || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-200 truncate">
                  {user?.name || 'User'}
                </p>
                <p className={`text-xs ${isMaster ? 'text-cyber-green' : 'text-cyber-primary'}`}>
                  {user?.role || 'USER'}
                  {isMaster && ' ★'}
                </p>
              </div>
            </div>
          </div>

          {/* Navigation Menu */}
          <nav className="flex-1 py-6 px-3 overflow-y-auto cyber-scrollbar">
            <div className="space-y-2">
              {menuItems.map((item) => (
                <div key={item.path}>
                  {item.subMenu ? (
                    // Menu with submenu (like Production, Accounting)
                    <div className="space-y-1">
                      {(() => {
                        const isChildActive = item.subMenu.some(sub => location.pathname === sub.path || location.pathname.startsWith(sub.path + '/'))
                        return (
                          <div className={`flex items-center gap-3 px-4 py-3 rounded-lg ${isChildActive ? 'text-cyber-primary' : 'text-gray-300'}`}>
                            <item.icon className={`w-5 h-5 ${isChildActive ? 'text-cyber-primary' : 'text-gray-400'}`} />
                            <div className="flex-1">
                              <p className="font-semibold">{item.label}</p>
                              {item.description && (
                                <p className="text-xs text-gray-500">{item.description}</p>
                              )}
                            </div>
                          </div>
                        )
                      })()}
                      <div className="ml-4 pl-4 border-l border-cyber-border space-y-1">
                        {item.subMenu.map((sub) => (
                          <NavLink
                            key={sub.path}
                            to={sub.path}
                            className={({ isActive }) =>
                              `flex items-center gap-3 px-4 py-2 rounded-lg transition-all group text-sm ${isActive
                                ? 'bg-cyber-primary/20 text-cyber-primary'
                                : 'text-gray-400 hover:text-gray-300'
                              }`
                            }
                          >
                            <sub.icon className="w-4 h-4" />
                            {sub.label}
                          </NavLink>
                        ))}
                      </div>
                    </div>
                  ) : (
                    // Regular menu item
                    <NavLink
                      to={item.path}
                      end={item.path === '/'}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-4 py-3 rounded-lg transition-all group ${isActive
                          ? 'bg-gradient-to-r from-cyber-primary/20 to-cyber-purple/20 border border-cyber-primary/50 shadow-neon'
                          : 'hover:bg-cyber-card/50 border border-transparent hover:border-cyber-border'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <item.icon
                            className={`w-5 h-5 transition-colors ${isActive
                                ? 'text-cyber-primary'
                                : 'text-gray-400 group-hover:text-cyber-primary'
                              }`}
                          />
                          <div className="flex-1">
                            <p
                              className={`font-semibold ${isActive ? 'text-cyber-primary' : 'text-gray-300'
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
                  )}
                </div>
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
                  <span className="text-cyber-green font-semibold">{sysStats.activeOrders}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Low Stock Items</span>
                  <span className="text-yellow-400 font-semibold">{sysStats.lowStock}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Pending PO</span>
                  <span className="text-cyber-primary font-semibold">{sysStats.pendingPO}</span>
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
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-lg transition-all group ${isActive
                    ? 'bg-cyber-primary/20 text-cyber-primary'
                    : 'hover:bg-cyber-card/50 text-gray-300'
                  }`
                }
              >
                <item.icon className={`w-5 h-5 ${'text-gray-400 group-hover:text-cyber-primary transition-colors'
                  }`} />
                <span className="font-medium">{item.label}</span>
              </NavLink>
            ))}

            <button
              onClick={logout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-red-500/10 transition-all group mt-2"
            >
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
