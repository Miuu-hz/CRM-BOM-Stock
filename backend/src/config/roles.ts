export type Role = 'ADMIN' | 'POWERUSER' | 'USER' | 'MASTER'

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

// ponytail: minimal permission matrix for common ERP resources.
export const resourceActions: Record<Resource, Action[]> = {
  customers: ['read', 'write', 'approve', 'delete', 'admin'],
  suppliers: ['read', 'write', 'approve', 'delete', 'admin'],
  orders: ['read', 'write', 'approve', 'delete', 'admin'],
  purchase: ['read', 'write', 'approve', 'delete', 'admin'],
  stock: ['read', 'write', 'approve', 'delete', 'admin'],
  accounting: ['read', 'write', 'approve', 'delete', 'admin'],
  marketing: ['read', 'write', 'approve', 'delete', 'admin'],
  production: ['read', 'write', 'approve', 'delete', 'admin'],
  qc: ['read', 'write', 'approve', 'delete', 'admin'],
  users: ['read', 'write', 'approve', 'delete', 'admin'],
  settings: ['read', 'write', 'approve', 'delete', 'admin'],
}
