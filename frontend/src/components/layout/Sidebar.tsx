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
  Sparkles,
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
      } catch (err: any) {
        console.error('Sidebar stats load error:', err)
      }
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
          className="w-[280px] bg-white border-r border-[var(--border)] flex flex-col relative z-50"
          aria-label="เมนูหลัก"
        >
          {/* Logo Section */}
          <div className="p-5 border-b border-[var(--border)]">
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-phopy-indigo to-phopy-indigo-700 flex items-center justify-center flex-none"
                aria-hidden="true"
              >
                <span className="text-white font-extrabold text-lg">P</span>
              </div>
              <div>
                <h1 className="text-base font-bold text-[var(--fg-1)] tracking-tight">
                  Phopy
                </h1>
                <p className="text-[11px] text-[var(--fg-3)]">ERP · BB Pillow + POS</p>
              </div>
            </div>
          </div>

          {/* User Info */}
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center ${isMaster ? 'bg-gradient-to-br from-phopy-mango to-phopy-mango-600' : 'bg-gradient-to-br from-phopy-indigo to-phopy-indigo-700'
                }`}>
                <span className="text-white font-bold text-sm">
                  {user?.name?.charAt(0).toUpperCase() || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--fg-1)] truncate">
                  {user?.name || 'User'}
                </p>
                <p className={`text-xs font-semibold ${isMaster ? 'text-phopy-mango' : 'text-phopy-indigo'}`}>
                  {isMaster ? '★ MASTER' : (user?.role || 'USER')}
                </p>
              </div>
            </div>
          </div>

          {/* Navigation Menu */}
          <nav className="flex-1 py-4 px-2 overflow-y-auto phopy-scrollbar" role="navigation" aria-label="เมนูระบบ">
            <div className="space-y-1">
              {menuItems.map((item) => (
                <div key={item.path}>
                  {item.subMenu ? (
                    // Menu with submenu (like Production, Accounting)
                    <div className="space-y-1">
                      {(() => {
                        const isChildActive = item.subMenu.some(sub => location.pathname === sub.path || location.pathname.startsWith(sub.path + '/'))
                        return (
                          <div className={`flex items-center gap-3 px-4 py-3 rounded-lg ${isChildActive ? 'text-phopy-indigo' : 'text-[var(--fg-2)]'}`}>
                            <item.icon className={`w-5 h-5 ${isChildActive ? 'text-phopy-indigo' : 'text-[var(--fg-3)]'}`} />
                            <div className="flex-1">
                              <p className="font-semibold text-sm">{item.label}</p>
                              {item.description && (
                                <p className="text-xs text-[var(--fg-4)]">{item.description}</p>
                              )}
                            </div>
                          </div>
                        )
                      })()}
                      <div className="ml-4 pl-4 border-l border-[var(--border)] space-y-1">
                        {item.subMenu.map((sub) => (
                          <NavLink
                            key={sub.path}
                            to={sub.path}
                            className={({ isActive }) =>
                              `flex items-center gap-3 px-4 py-2 rounded-lg transition-all group text-sm ${isActive
                                ? 'bg-phopy-indigo-50 text-phopy-indigo'
                                : 'text-[var(--fg-3)] hover:text-[var(--fg-2)]'
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
                          ? 'bg-phopy-indigo-50 text-phopy-indigo'
                          : 'hover:bg-[var(--surface-2)] text-[var(--fg-2)]'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <item.icon
                            className={`w-5 h-5 transition-colors ${isActive
                                ? 'text-phopy-indigo'
                                : 'text-[var(--fg-3)] group-hover:text-phopy-indigo'
                              }`}
                          />
                          <div className="flex-1">
                            <p
                              className={`font-semibold text-sm ${isActive ? 'text-phopy-indigo' : 'text-[var(--fg-2)]'
                                }`}
                            >
                              {item.label}
                            </p>
                            {item.description && (
                              <p className="text-xs text-[var(--fg-4)]">
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
              className="mt-6 p-4 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]"
            >
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-success" />
                <p className="text-sm font-semibold text-[var(--fg-2)]">
                  System Status
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--fg-3)]">Active Orders</span>
                  <span className="text-success font-semibold">{sysStats.activeOrders}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--fg-3)]">Low Stock Items</span>
                  <span className="text-warning font-semibold">{sysStats.lowStock}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--fg-3)]">Pending PO</span>
                  <span className="text-phopy-indigo font-semibold">{sysStats.pendingPO}</span>
                </div>
              </div>
            </motion.div>
          </nav>

          {/* Bottom Menu */}
          <div className="p-3 border-t border-[var(--border)]">
            {bottomMenuItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-lg transition-all group ${isActive
                    ? 'bg-phopy-indigo-50 text-phopy-indigo'
                    : 'hover:bg-[var(--surface-2)] text-[var(--fg-2)]'
                  }`
                }
              >
                <item.icon className={`w-5 h-5 ${'text-[var(--fg-3)] group-hover:text-phopy-indigo transition-colors'
                  }`} />
                <span className="font-medium text-sm">{item.label}</span>
              </NavLink>
            ))}

            <button
              onClick={logout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-danger-soft transition-all group mt-1"
            >
              <LogOut className="w-5 h-5 text-[var(--fg-3)] group-hover:text-danger transition-colors" />
              <span className="text-[var(--fg-2)] font-medium text-sm group-hover:text-danger transition-colors">
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
