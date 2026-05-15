import { NavLink, useLocation, useNavigate } from 'react-router-dom'
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
  BookOpen,
  BarChart3,
  Landmark,
  Percent,
  Factory,
  Store,
  MonitorPlay,
  Megaphone,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import api from '../../utils/api'

export type SidebarMode = 'full' | 'rail'

interface SidebarProps {
  mode: SidebarMode
}

const menuItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/crm', label: 'CRM', icon: Users, description: 'Customer Relations' },
  {
    path: '/production',
    label: 'Production',
    icon: Factory,
    description: 'BOM & Work Orders',
    isParent: true,
    subMenu: [
      { path: '/bom', label: 'BOM', icon: FileText },
      { path: '/work-orders', label: 'Work Orders', icon: Wrench },
    ],
  },
  { path: '/stock', label: 'Stock', icon: Package, description: 'Inventory Management' },
  { path: '/purchase', label: 'Purchase', icon: ShoppingCart, description: 'Procurement Management' },
  { path: '/calculator', label: 'Calculator', icon: Calculator, description: 'Cost & Profit Analysis' },
  { path: '/sales', label: 'Sales', icon: TrendingUp, description: 'Sales & Invoicing' },
  { path: '/marketing', label: 'Marketing', icon: Megaphone, description: 'Campaign Analytics' },
  { path: '/tax', label: 'Tax', icon: Percent, description: 'VAT, WHT & CIT Management' },
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
    ],
  },
  { path: '/cashier', label: 'Cashier', icon: Store, description: 'POS & Quick Sales' },
  { path: '/kds', label: 'Kitchen Display', icon: MonitorPlay, description: 'POS Orders Queue (KDS)' },
]

function Sidebar({ mode }: SidebarProps) {
  const { user, isMaster, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [sysStats, setSysStats] = useState({ activeOrders: 0, lowStock: 0, pendingPO: 0 })

  const isRail = mode === 'rail'

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
    <aside
      className={`
        bg-[var(--surface)] border-r border-[var(--border)] flex flex-col relative z-50
        transition-[width] duration-200 ease-out overflow-hidden flex-shrink-0
        ${isRail ? 'w-16' : 'w-[280px]'}
      `}
      aria-label="เมนูหลัก"
    >
      {/* Logo */}
      <div className={`border-b border-[var(--border)] flex-shrink-0 ${isRail ? 'p-3.5 flex justify-center' : 'p-5'}`}>
        {isRail ? (
          <div
            className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-phopy-indigo to-phopy-indigo-700 flex items-center justify-center cursor-pointer"
            title="Phopy ERP"
          >
            <span className="text-white font-extrabold text-lg">P</span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-phopy-indigo to-phopy-indigo-700 flex items-center justify-center flex-none">
              <span className="text-white font-extrabold text-lg">P</span>
            </div>
            <div>
              <h1 className="text-base font-bold text-[var(--fg-1)] tracking-tight">Phopy</h1>
              <p className="text-[11px] text-[var(--fg-3)]">ERP · POS</p>
            </div>
          </div>
        )}
      </div>

      {/* User Info — full mode only */}
      {!isRail && (
        <div className="px-4 py-3 border-b border-[var(--border)] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-none ${
              isMaster
                ? 'bg-gradient-to-br from-phopy-mango to-phopy-mango-600'
                : 'bg-gradient-to-br from-phopy-indigo to-phopy-indigo-700'
            }`}>
              <span className="text-white font-bold text-sm">
                {user?.name?.charAt(0).toUpperCase() || 'U'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--fg-1)] truncate">{user?.name || 'User'}</p>
              <p className={`text-xs font-semibold ${isMaster ? 'text-phopy-mango' : 'text-[var(--primary)]'}`}>
                {isMaster ? '★ MASTER' : (user?.role || 'USER')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 py-4 overflow-y-auto phopy-scrollbar" role="navigation" aria-label="เมนูระบบ">
        <div className={`space-y-1 ${isRail ? 'px-1.5' : 'px-2'}`}>
          {menuItems.map((item) => {
            if (item.subMenu) {
              const isChildActive = item.subMenu.some(
                sub => location.pathname === sub.path || location.pathname.startsWith(sub.path + '/')
              )

              if (isRail) {
                // Rail: parent icon navigates to first child
                return (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.subMenu![0].path)}
                    title={item.label}
                    className={`w-full flex justify-center items-center py-3 rounded-lg transition-all ${
                      isChildActive
                        ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                        : 'text-[var(--fg-3)] hover:bg-[var(--surface-2)] hover:text-[var(--fg-2)]'
                    }`}
                  >
                    <item.icon className="w-5 h-5" />
                  </button>
                )
              }

              return (
                <div key={item.path} className="space-y-1">
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-lg ${isChildActive ? 'text-[var(--primary)]' : 'text-[var(--fg-2)]'}`}>
                    <item.icon className={`w-5 h-5 ${isChildActive ? 'text-[var(--primary)]' : 'text-[var(--fg-3)]'}`} />
                    <div className="flex-1">
                      <p className="font-semibold text-sm">{item.label}</p>
                      {item.description && <p className="text-xs text-[var(--fg-4)]">{item.description}</p>}
                    </div>
                  </div>
                  <div className="ml-4 pl-4 border-l border-[var(--border)] space-y-1">
                    {item.subMenu.map((sub) => (
                      <NavLink
                        key={sub.path}
                        to={sub.path}
                        className={({ isActive }) =>
                          `flex items-center gap-3 px-4 py-2 rounded-lg transition-all text-sm ${
                            isActive
                              ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
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
              )
            }

            // Regular item
            if (isRail) {
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  title={item.label}
                  className={({ isActive }) =>
                    `flex justify-center items-center py-3 rounded-lg transition-all ${
                      isActive
                        ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                        : 'text-[var(--fg-3)] hover:bg-[var(--surface-2)] hover:text-[var(--fg-2)]'
                    }`
                  }
                >
                  <item.icon className="w-5 h-5" />
                </NavLink>
              )
            }

            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-lg transition-all group ${
                    isActive
                      ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                      : 'hover:bg-[var(--surface-2)] text-[var(--fg-2)]'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon className={`w-5 h-5 transition-colors ${isActive ? 'text-[var(--primary)]' : 'text-[var(--fg-3)] group-hover:text-[var(--primary)]'}`} />
                    <div className="flex-1">
                      <p className={`font-semibold text-sm ${isActive ? 'text-[var(--primary)]' : 'text-[var(--fg-2)]'}`}>
                        {item.label}
                      </p>
                      {item.description && <p className="text-xs text-[var(--fg-4)]">{item.description}</p>}
                    </div>
                  </>
                )}
              </NavLink>
            )
          })}
        </div>

        {/* System Stats — full mode only */}
        {!isRail && (
          <div className="mt-6 mx-2 p-4 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-success" />
              <p className="text-sm font-semibold text-[var(--fg-2)]">System Status</p>
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
                <span className="text-[var(--primary)] font-semibold">{sysStats.pendingPO}</span>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Bottom */}
      <div className={`border-t border-[var(--border)] flex-shrink-0 ${isRail ? 'p-1.5 space-y-1' : 'p-3'}`}>
        {isRail ? (
          <>
            <NavLink
              to="/settings"
              title="Settings"
              className={({ isActive }) =>
                `flex justify-center items-center py-3 rounded-lg transition-all ${
                  isActive ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'text-[var(--fg-3)] hover:bg-[var(--surface-2)] hover:text-[var(--fg-2)]'
                }`
              }
            >
              <Settings className="w-5 h-5" />
            </NavLink>
            <button
              onClick={logout}
              title="Logout"
              className="w-full flex justify-center items-center py-3 rounded-lg hover:bg-[var(--danger-soft)] text-[var(--fg-3)] hover:text-danger transition-all"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </>
        ) : (
          <>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg transition-all group ${
                  isActive ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'hover:bg-[var(--surface-2)] text-[var(--fg-2)]'
                }`
              }
            >
              <Settings className="w-5 h-5 text-[var(--fg-3)] group-hover:text-[var(--primary)] transition-colors" />
              <span className="font-medium text-sm">Settings</span>
            </NavLink>
            <button
              onClick={logout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-[var(--danger-soft)] transition-all group mt-1"
            >
              <LogOut className="w-5 h-5 text-[var(--fg-3)] group-hover:text-danger transition-colors" />
              <span className="text-[var(--fg-2)] font-medium text-sm group-hover:text-danger transition-colors">Logout</span>
            </button>
          </>
        )}
      </div>
    </aside>
  )
}

export default Sidebar
