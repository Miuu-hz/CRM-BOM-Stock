import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BarChart3,
  BookOpen,
  Calculator,
  ClipboardCheck,
  Factory,
  FileText,
  Landmark,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MonitorPlay,
  Package,
  Percent,
  Settings,
  ShieldCheck,
  Trello,
  ShoppingCart,
  Star,
  Store,
  TrendingUp,
  Users,
  UserCog,
  Wrench,
  Building2,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import api from '../../services/api'

export type SidebarMode = 'full' | 'rail'

interface SidebarProps {
  mode: SidebarMode
}

interface MenuItem {
  path: string
  tKey: string
  icon: React.ElementType
  descriptionKey?: string
  isParent?: boolean
  subMenu?: MenuItem[]
  adminOnly?: boolean
}

const menuItems: MenuItem[] = [
  { path: '/', tKey: 'sidebar.dashboard', icon: LayoutDashboard },
  { path: '/crm', tKey: 'sidebar.crm', icon: Users, descriptionKey: 'sidebar.crmDesc' },
  {
    path: '/production',
    tKey: 'sidebar.production',
    icon: Factory,
    descriptionKey: 'sidebar.productionDesc',
    isParent: true,
    subMenu: [
      { path: '/bom', tKey: 'sidebar.bom', icon: FileText },
      { path: '/work-orders', tKey: 'sidebar.workOrders', icon: Wrench },
      { path: '/qc', tKey: 'sidebar.qualityControl', icon: ClipboardCheck },
    ],
  },
  { path: '/stock', tKey: 'sidebar.stock', icon: Package, descriptionKey: 'sidebar.stockDesc' },
  { path: '/purchase', tKey: 'sidebar.purchase', icon: ShoppingCart, descriptionKey: 'sidebar.purchaseDesc' },
  { path: '/calculator', tKey: 'sidebar.calculator', icon: Calculator, descriptionKey: 'sidebar.calculatorDesc' },
  { path: '/sales', tKey: 'sidebar.sales', icon: TrendingUp, descriptionKey: 'sidebar.salesDesc' },
  { path: '/marketing', tKey: 'sidebar.marketing', icon: Megaphone, descriptionKey: 'sidebar.marketingDesc' },
  { path: '/tax', tKey: 'sidebar.tax', icon: Percent, descriptionKey: 'sidebar.taxDesc' },
  {
    path: '/accounting',
    tKey: 'sidebar.accounting',
    icon: Landmark,
    descriptionKey: 'sidebar.accountingDesc',
    isParent: true,
    subMenu: [
      { path: '/accounting/chart-of-accounts', tKey: 'sidebar.chartOfAccounts', icon: BookOpen },
      { path: '/accounting/journal-entries', tKey: 'sidebar.journalEntries', icon: FileText },
      { path: '/accounting/pos-clearing', tKey: 'sidebar.posClearing', icon: Store },
      { path: '/accounting/reports', tKey: 'sidebar.financialReports', icon: BarChart3 },
      { path: '/accounting/phopy-board', tKey: 'sidebar.phopyBoard', icon: LayoutDashboard },
    ],
  },
  { path: '/approvals', tKey: 'sidebar.approvals', icon: ShieldCheck },
  { path: '/users', tKey: 'sidebar.userManagement', icon: UserCog, adminOnly: true },
  { path: '/cashier', tKey: 'sidebar.cashier', icon: Store, descriptionKey: 'sidebar.cashierDesc' },
  { path: '/kds', tKey: 'sidebar.kitchenDisplay', icon: MonitorPlay, descriptionKey: 'sidebar.kitchenDisplayDesc' },
  { path: 'https://kanban.phopy.net', tKey: 'sidebar.kanban', icon: Trello, descriptionKey: 'sidebar.kanbanDesc' },
]

function Sidebar({ mode }: SidebarProps) {
  const { t } = useTranslation()
  const { user, isMaster, allTenants, switchTenant, tenant, originalTenantId, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [tenantOpen, setTenantOpen] = useState(false)
  const [sysStats, setSysStats] = useState({ activeOrders: 0, lowStock: 0, pendingPO: 0 })

  const [pendingApprovals, setPendingApprovals] = useState(0)
  const isRail = mode === 'rail'
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'MASTER'

  useEffect(() => {
    const load = async () => {
      try {
        const [stats, stock, po, approvals] = await Promise.all([
          api.get('/dashboard/stats'),
          api.get('/dashboard/low-stock'),
          api.get('/purchase-orders?status=PENDING').catch(() => ({ data: { data: [] } })),
          api.get('/approval/pending').catch(() => ({ data: { data: [] } })),
        ])
        setSysStats({
          activeOrders: stats.data.data?.activeOrders ?? 0,
          lowStock: Array.isArray(stock.data.data) ? stock.data.data.length : 0,
          pendingPO: Array.isArray(po.data.data) ? po.data.data.length : 0,
        })
        setPendingApprovals(Array.isArray(approvals.data.data) ? approvals.data.data.length : 0)
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
      aria-label={t('sidebar.mainMenu')}
    >
      {/* Logo */}
      <div className={`border-b border-[var(--border)] flex-shrink-0 ${isRail ? 'p-3.5 flex justify-center' : 'p-5'}`}>
        {isRail ? (
          <div
            className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-phopy-indigo to-phopy-indigo-700 flex items-center justify-center cursor-pointer"
            title={t('app.name')}
          >
            <span className="text-white font-extrabold text-lg">P</span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-phopy-indigo to-phopy-indigo-700 flex items-center justify-center flex-none">
              <span className="text-white font-extrabold text-lg">P</span>
            </div>
            <div>
              <h1 className="text-base font-bold text-[var(--fg-1)] tracking-tight">{t('app.name')}</h1>
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
                {isMaster ? <><Star className="w-3 h-3 fill-current" /> MASTER</> : (user?.role || 'USER')}
              </p>
            </div>
          </div>
        </div>
      )}


      {/* Tenant Switcher — Master only, full mode */}
      {isMaster && !isRail && (
        <div className="px-4 py-2 border-b border-[var(--border)] flex-shrink-0 relative">
          <button
            onClick={() => setTenantOpen(o => !o)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface)] border border-[var(--border)] transition-all text-left"
          >
            <Building2 className="w-4 h-4 text-[var(--primary)] flex-shrink-0" />
            <span className="flex-1 text-xs font-medium text-[var(--fg-2)] truncate">
              {tenant?.name || tenant?.code || 'เลือก tenant'}
            </span>
            <span className="text-[var(--fg-4)] text-xs">{tenantOpen ? '▲' : '▼'}</span>
          </button>
          {tenantOpen && (
            <div className="absolute left-4 right-4 top-full mt-1 z-50 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg overflow-hidden">
              {allTenants.map(t => (
                <button
                  key={t.tenantId}
                  onClick={async () => {
                    setTenantOpen(false)
                    if (!t.isCurrentTenant) await switchTenant(t.tenantId)
                  }}
                  className={"w-full flex items-center gap-2 px-3 py-2.5 text-xs text-left transition-all hover:bg-[var(--surface-2)] " + (t.isCurrentTenant ? "text-[var(--primary)] font-semibold" : "text-[var(--fg-2)]")}
                >
                  <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{t.name}</span>
                  {t.isCurrentTenant && <span className="ml-auto text-[var(--primary)]">✓</span>}
                  {t.tenantId === originalTenantId && <span className="text-[var(--warning)] text-[10px]">home</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Navigation */}
      <nav className="flex-1 py-4 overflow-y-auto phopy-scrollbar" role="navigation" aria-label={t('sidebar.mainMenu')}>
        <div className={`space-y-1 ${isRail ? 'px-1.5' : 'px-2'}`}>
          {menuItems.map((item) => {
            const label = t(item.tKey)
            const description = item.descriptionKey ? t(item.descriptionKey) : undefined
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
                    title={label}
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
                      <p className="font-semibold text-sm">{label}</p>
                      {description && <p className="text-xs text-[var(--fg-4)]">{description}</p>}
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
                        {t(sub.tKey)}
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
                  title={label}
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

            if (item.path.startsWith('http')) {
              return (
                <a
                  key={item.path}
                  href={item.path}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 rounded-lg transition-all group hover:bg-[var(--surface-2)] text-[var(--fg-2)]"
                >
                  <item.icon className="w-5 h-5 transition-colors text-[var(--fg-3)] group-hover:text-[var(--primary)]" />
                  <div className="flex-1">
                    <p className="font-semibold text-sm text-[var(--fg-2)]">{label}</p>
                    {description && <p className="text-xs text-[var(--fg-4)]">{description}</p>}
                  </div>
                </a>
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
                        {label}
                      </p>
                      {description && <p className="text-xs text-[var(--fg-4)]">{description}</p>}
                    </div>
                    {item.path === '/approvals' && pendingApprovals > 0 && (
                      <span className="px-1.5 py-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full leading-none flex-shrink-0">
                        {pendingApprovals}
                      </span>
                    )}
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
              <p className="text-sm font-semibold text-[var(--fg-2)]">{t('sidebar.systemStatus.title')}</p>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-[var(--fg-3)]">{t('sidebar.systemStatus.activeOrders')}</span>
                <span className="text-success font-semibold">{sysStats.activeOrders}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[var(--fg-3)]">{t('sidebar.systemStatus.lowStock')}</span>
                <span className="text-warning font-semibold">{sysStats.lowStock}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[var(--fg-3)]">{t('sidebar.systemStatus.pendingPO')}</span>
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
              title={t('sidebar.settings')}
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
              title={t('sidebar.logout')}
              className="w-full flex justify-center items-center py-3 rounded-lg hover:bg-[var(--danger-soft)] text-[var(--fg-3)] hover:text-danger transition-all"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </>
        ) : (
          <>
            {isMaster && (
              <NavLink
                to="/master"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-lg transition-all group ${
                    isActive ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'hover:bg-[var(--surface-2)] text-[var(--fg-2)]'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Building2 className={`w-5 h-5 transition-colors ${isActive ? 'text-[var(--primary)]' : 'text-[var(--fg-3)] group-hover:text-[var(--primary)]'}`} />
                    <span className={`font-medium text-sm ${isActive ? 'text-[var(--primary)]' : ''}`}>Master Panel</span>
                  </>
                )}
              </NavLink>
            )}
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg transition-all group ${
                  isActive ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : 'hover:bg-[var(--surface-2)] text-[var(--fg-2)]'
                }`
              }
            >
              <Settings className="w-5 h-5 text-[var(--fg-3)] group-hover:text-[var(--primary)] transition-colors" />
              <span className="font-medium text-sm">{t('sidebar.settings')}</span>
            </NavLink>
            <button
              onClick={logout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-[var(--danger-soft)] transition-all group mt-1"
            >
              <LogOut className="w-5 h-5 text-[var(--fg-3)] group-hover:text-danger transition-colors" />
              <span className="text-[var(--fg-2)] font-medium text-sm group-hover:text-danger transition-colors">{t('sidebar.logout')}</span>
            </button>
          </>
        )}
      </div>
    </aside>
  )
}

export default Sidebar
