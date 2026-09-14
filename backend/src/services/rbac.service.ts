import db from '../db/sqlite'
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

/**
 * สิทธิ์ "แตะเงิน" — ออกใบแจ้งหนี้ / รับชำระ / จ่ายเงินผู้ขาย
 *
 * เดิม POST /invoices, /receipts, /purchase/invoices, /purchase/payments ไม่เช็ค role เลย
 * (ล็อกแค่ตอนยกเลิก) ใครก็สร้างรายได้/จ่ายเงินออกได้ — เจ้าของสั่ง 2026-09-14 ให้ยึด role จริง
 *
 * ผ่านถ้า: ADMIN/MASTER · แผนก CEO/IT · แผนกที่ดูแลสายนั้นอยู่แล้ว (SALES→orders, PURCHASE→purchase)
 *          หรือแผนกบัญชี (ACCOUNTING→accounting) ซึ่งเป็นคนออกบิล/ตั้งเบิกจริง
 * ไม่ผ่าน: แผนกผลิต/QC/คลัง ที่ไม่เกี่ยวกับการเงิน
 */
export function canHandleBilling(
  user: { role: string; departments?: Department[]; customPermissions?: Record<string, boolean> },
  side: 'sales' | 'purchase'
): boolean {
  const role = user.role as Role
  const depts = user.departments || []
  const own = side === 'sales' ? 'orders' : 'purchase'
  return can(role, depts, own, 'write', user.customPermissions)
    || can(role, depts, 'accounting', 'write', user.customPermissions)
}

/** เวอร์ชันสำหรับ MCP ที่มีแค่ userId — โหลดแผนก/สิทธิ์รายคนจาก DB เหมือน auth middleware */
export function canHandleBillingByUserId(
  userId: string, role: string, side: 'sales' | 'purchase'
): boolean {
  let departments: Department[] = []
  let customPermissions: Record<string, boolean> | undefined
  try {
    const row = db.prepare('SELECT departments, custom_permissions FROM users WHERE id = ?').get(userId) as any
    if (row?.departments) departments = JSON.parse(row.departments)
    if (row?.custom_permissions) customPermissions = JSON.parse(row.custom_permissions)
  } catch { /* ไม่มีแถว (master api key) → ตกไปตัดสินด้วย role อย่างเดียว */ }
  return canHandleBilling({ role, departments, customPermissions }, side)
}

export { departmentResources }
