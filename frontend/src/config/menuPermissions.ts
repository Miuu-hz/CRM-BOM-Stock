// Central template: which roles can see/access each menu (by route path).
// Single source of truth — Sidebar (visibility) and App.tsx (direct-URL guard)
// both read from here, so granting/revoking a menu to a role is a one-line
// edit in this file instead of hunting through components.
//
// Mirrors the Role union in backend/src/config/roles.ts. Keep in sync if a
// role is ever added/removed there.
export type Role = 'MASTER' | 'ADMIN' | 'MANAGER' | 'POWERUSER' | 'USER'

const ALL_ROLES: Role[] = ['MASTER', 'ADMIN', 'MANAGER', 'POWERUSER', 'USER']
const MASTER_ONLY: Role[] = ['MASTER']
const NOT_USER: Role[] = ['MASTER', 'ADMIN', 'MANAGER', 'POWERUSER']

// Key = route path exactly as used in Sidebar's menuItems / App.tsx's <Route path="...">.
// A path with no entry here defaults to ALL_ROLES (see canViewMenu) — add an
// entry only when a menu needs to be narrower than "everyone logged in".
export const MENU_PERMISSIONS: Record<string, Role[]> = {
  '/': ALL_ROLES,
  '/crm': ALL_ROLES,
  '/production': ALL_ROLES,
  '/bom': ALL_ROLES,
  '/work-orders': ALL_ROLES,
  '/qc': ALL_ROLES,
  '/stock': ALL_ROLES,
  '/stock/subcontractors': ALL_ROLES,
  '/purchase': ALL_ROLES,
  '/calculator': ALL_ROLES,
  '/sales': ALL_ROLES,
  '/receivables': NOT_USER, // ยอดหนี้ของลูกค้า/ซัพพลายเออร์ทั้งบริษัท — แคบกว่าเมนูขายทั่วไป
  '/marketing': ALL_ROLES,
  '/tax': ALL_ROLES,
  '/accounting': ALL_ROLES,
  '/accounting/chart-of-accounts': ALL_ROLES,
  '/accounting/journal-entries': ALL_ROLES,
  '/accounting/period-closing': ALL_ROLES, // page is viewable by all; the close/reopen/year-end actions are gated server-side to ADMIN/MASTER + password
  '/accounting/budget-vs-actual': ALL_ROLES,
  '/accounting/pos-clearing': ALL_ROLES,
  '/accounting/reports': ALL_ROLES,
  '/accounting/phopy-board': ALL_ROLES,
  '/approvals': NOT_USER,
  '/users': MASTER_ONLY,
  '/cashier': ALL_ROLES,
  '/kds': ALL_ROLES,
  '/settings': ALL_ROLES,
  '/master': MASTER_ONLY,
}

// Unlisted paths default to "everyone logged in can see the menu" — the menu
// system only controls navigation visibility, not data access. Real
// authorization for reads/writes still lives in the backend (rbac.service.ts,
// requireRole, requireMaster, etc.) and must not be relaxed based on this file.
export function canViewMenu(role: string | undefined, path: string): boolean {
  if (!role) return false
  const allowed = MENU_PERMISSIONS[path]
  if (!allowed) return true
  return allowed.includes(role as Role)
}
