import { Role, Department, Resource } from '../config/roles'
export type { Role, Department }

const departmentResources: Record<Department, Resource[]> = {
  IT: ['customers', 'suppliers', 'orders', 'purchase', 'stock', 'accounting', 'marketing', 'production', 'qc', 'users', 'settings'],
  CEO: ['customers', 'suppliers', 'orders', 'purchase', 'stock', 'accounting', 'marketing', 'production', 'qc', 'users', 'settings'],
  CTO: ['production', 'qc', 'stock', 'users', 'settings'],
  SALES: ['customers', 'orders', 'marketing'],
  PURCHASE: ['purchase', 'suppliers'],
  STOCK: ['stock'],
  ACCOUNTING: ['accounting'],
  MARKETING: ['marketing'],
  QC: ['qc'],
  PRODUCTION: ['production'],
}

export function can(
  role: Role,
  department: Department | undefined,
  resource: string,
  action: string
): boolean {
  if (role === 'ADMIN') return true
  if (role === 'POWERUSER') return ['read', 'write', 'approve'].includes(action)
  if (role === 'USER') {
    return (
      ['read', 'write'].includes(action) &&
      !!department &&
      departmentResources[department].includes(resource as Resource)
    )
  }
  return false
}
