export type Role = 'MASTER' | 'ADMIN' | 'MANAGER' | 'POWERUSER' | 'USER'

export type Department =
  | 'IT'
  | 'CEO'
  | 'CTO'
  | 'SALES'
  | 'PURCHASE'
  | 'STOCK'
  | 'ACCOUNTING'
  | 'MARKETING'
  | 'QC'
  | 'PRODUCTION'

export type Action = 'read' | 'write' | 'approve' | 'delete' | 'admin'

export type Resource =
  | 'customers'
  | 'suppliers'
  | 'orders'
  | 'purchase'
  | 'stock'
  | 'accounting'
  | 'marketing'
  | 'production'
  | 'qc'
  | 'users'
  | 'settings'

export const resourceActions: Record<Resource, Action[]> = {
  customers:  ['read', 'write', 'approve', 'delete', 'admin'],
  suppliers:  ['read', 'write', 'approve', 'delete', 'admin'],
  orders:     ['read', 'write', 'approve', 'delete', 'admin'],
  purchase:   ['read', 'write', 'approve', 'delete', 'admin'],
  stock:      ['read', 'write', 'approve', 'delete', 'admin'],
  accounting: ['read', 'write', 'approve', 'delete', 'admin'],
  marketing:  ['read', 'write', 'approve', 'delete', 'admin'],
  production: ['read', 'write', 'approve', 'delete', 'admin'],
  qc:         ['read', 'write', 'approve', 'delete', 'admin'],
  users:      ['read', 'write', 'approve', 'delete', 'admin'],
  settings:   ['read', 'write', 'approve', 'delete', 'admin'],
}

// Role hierarchy: MASTER > ADMIN > MANAGER > POWERUSER > USER
export const ROLE_HIERARCHY: Record<Role, number> = {
  MASTER:    5,
  ADMIN:     4,
  MANAGER:   3,
  POWERUSER: 2,
  USER:      1,
}
