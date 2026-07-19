import { Role, Department, Resource } from '../config/roles'
export type { Role, Department }

const departmentResources: Record<Department, Resource[]> = {
  IT:         ['customers', 'suppliers', 'orders', 'purchase', 'stock', 'accounting', 'marketing', 'production', 'qc', 'users', 'settings'],
  CEO:        ['customers', 'suppliers', 'orders', 'purchase', 'stock', 'accounting', 'marketing', 'production', 'qc', 'users', 'settings'],
  CTO:        ['production', 'qc', 'stock', 'users', 'settings'],
  SALES:      ['customers', 'orders', 'marketing'],
  PURCHASE:   ['purchase', 'suppliers'],
  STOCK:      ['stock'],
  ACCOUNTING: ['accounting'],
  MARKETING:  ['marketing'],
  QC:         ['qc'],
  PRODUCTION: ['production'],
}

const SYSTEM_RESOURCES = ['backup', 'mcp', 'system']

/**
 * 3-layer permission check:
 * Layer 1: MASTER bypass (all) / ADMIN bypass (business only, not system)
 * Layer 2: customPermissions override - explicit per-user grant or deny
 * Layer 3: role + departments matrix - default rules
 */
export function can(
  role: Role,
  departments: Department[],
  resource: string,
  action: string,
  customPermissions?: Record<string, boolean>
): boolean {
  // Layer 1: MASTER sees everything
  if (role === 'MASTER') return true

  // System-level resources (backup/mcp/system) are MASTER-only.
  // Evaluated before customPermissions/department layers so nothing below
  // can grant them — closes the custom_permissions escalation hole.
  if (SYSTEM_RESOURCES.includes(resource)) return false

  // ADMIN sees all business resources but not system-level
  if (role === 'ADMIN') {
    return true
  }

  // Layer 2: per-user custom override (both grant and deny)
  if (customPermissions) {
    const key = `${resource}:${action}`
    if (key in customPermissions) return customPermissions[key]
  }

  // Layer 3: role + departments matrix
  const hasDepAccess = departments.some(
    dept => departmentResources[dept as Department]?.includes(resource as Resource)
  )

  // CEO or IT department → admin-level: all actions on all business resources
  if (departments.some(d => d === 'CEO' || d === 'IT')) {
    if (SYSTEM_RESOURCES.includes(resource)) return false
    return true
  }

  if (role === 'MANAGER')   return ['read', 'write', 'approve', 'delete'].includes(action) && hasDepAccess
  if (role === 'POWERUSER') return ['read', 'write', 'approve'].includes(action)
  if (role === 'USER')      return ['read', 'write'].includes(action) && hasDepAccess

  return false
}

export { departmentResources }
