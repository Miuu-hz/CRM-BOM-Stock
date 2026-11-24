import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../contexts/AuthContext'
import { canViewMenu } from '../../config/menuPermissions'

// HR 15 หน้ารวมเป็น 4 กลุ่ม (+ "ของฉัน") — เมนูข้างโชว์กลุ่ม แต่ละหน้าในกลุ่มเป็นแท็บด้านบน แบบหน้าบัญชี
// ลิงก์เดิมทุกหน้ายังใช้ได้ (แท็บคือ route เดิม)
export const HR_GROUPS: { tKey: string; tabs: { path: string; tKey: string }[] }[] = [
  { tKey: 'sidebar.hrPeople', tabs: [
    { path: '/hr/employees', tKey: 'sidebar.employees' }, { path: '/hr/org', tKey: 'sidebar.orgUnits' },
    { path: '/hr/documents', tKey: 'sidebar.hrDocuments' }, { path: '/hr/discipline', tKey: 'sidebar.discipline' },
    { path: '/hr/assets', tKey: 'sidebar.hrAssets' },
  ] },
  { tKey: 'sidebar.hrTime', tabs: [
    { path: '/hr/attendance', tKey: 'sidebar.attendance' }, { path: '/hr/roster', tKey: 'sidebar.roster' },
    { path: '/hr/leave', tKey: 'sidebar.leave' }, { path: '/hr/trips', tKey: 'sidebar.hrTrips' },
  ] },
  { tKey: 'sidebar.payroll', tabs: [
    { path: '/hr/payroll', tKey: 'sidebar.payrollRuns' }, { path: '/hr/advances', tKey: 'sidebar.advances' },
    { path: '/hr/settings', tKey: 'sidebar.hrSettings' },
  ] },
  { tKey: 'sidebar.lifecycle', tabs: [
    { path: '/hr/recruit', tKey: 'sidebar.recruit' }, { path: '/hr/lifecycle', tKey: 'sidebar.onOffboard' },
    { path: '/hr/training', tKey: 'sidebar.training' },
  ] },
]

export const inPath = (pathname: string, p: string) => pathname === p || pathname.startsWith(p + '/')

export default function HrTabs() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { pathname } = useLocation()
  const group = HR_GROUPS.find(g => g.tabs.some(tab => inPath(pathname, tab.path)))
  const tabs = (group?.tabs ?? []).filter(tab => canViewMenu(user?.role, tab.path, user?.departments))

  return (
    <div className="space-y-6">
      {tabs.length > 1 && (
        <nav className="flex gap-1 border-b border-[var(--border)] overflow-x-auto" aria-label={group ? t(group.tKey) : undefined}>
          {tabs.map(tab => (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={({ isActive }) => `px-4 py-2 -mb-px text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
                isActive
                  ? 'border-[var(--primary)] text-[var(--primary)]'
                  : 'border-transparent text-[var(--fg-3)] hover:text-[var(--fg-1)]'
              }`}
            >
              {t(tab.tKey)}
            </NavLink>
          ))}
        </nav>
      )}
      <Outlet />
    </div>
  )
}
