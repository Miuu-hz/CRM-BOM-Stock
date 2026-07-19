import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { getDb } from '../db/sqlite'
import { can } from '../services/rbac.service'
import { Role, Department } from '../config/roles'

interface UserJwtPayload {
  userId: string
  email: string
  role: Role
  department?: Department
  tenantId: string
}

interface AgentJwtPayload {
  agentId?: string
  email?: string
  role: string
  tenantId: string
}

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set. Set it before starting the server.')
}
const HOURS_LIMIT = 24

// ponytail: starter allowlist for tables that can be time-box edited.
const EDITABLE_TABLES = new Set([
  'orders', 'customers', 'products', 'materials', 'stock_items', 'stock_movements',
  'boms', 'bom_items', 'purchase_orders', 'purchase_requests', 'pos_running_bills',
  'pos_bill_items', 'journal_entries', 'journal_entry_lines', 'accounts', 'account_balances',
  'work_orders', 'suppliers', 'shops', 'marketing_imports', 'tax_invoices', 'invoice_payments',
  'pos_clearing_transfers', 'pos_kds_tickets'
])

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string
        email: string
        role: Role
        department?: Department
        departments: Department[]
        customPermissions?: Record<string, boolean>
        tenantId: string
      }
      validated?: unknown
    }
  }
}

export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' })
      return
    }

    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token, JWT_SECRET) as UserJwtPayload

    // Refresh tokens must never be accepted as access tokens on protected routes.
    if ((decoded as any).type === 'refresh') {
      res.status(401).json({ success: false, message: 'Token ไม่ถูกต้อง' })
      return
    }

    // Load fresh departments + custom_permissions from DB (always current, no stale JWT)
    const db = getDb()
    const userRecord = db.prepare(
      'SELECT departments, custom_permissions FROM users WHERE id = ?'
    ).get(decoded.userId) as { departments: string | null; custom_permissions: string | null } | undefined

    const departments: Department[] = userRecord?.departments
      ? JSON.parse(userRecord.departments)
      : (decoded.department ? [decoded.department] : [])

    const customPermissions: Record<string, boolean> | undefined = userRecord?.custom_permissions
      ? JSON.parse(userRecord.custom_permissions)
      : undefined

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      department: decoded.department,
      departments,
      customPermissions,
      tenantId: decoded.tenantId,
    }

    next()
  } catch (error) {
    res.status(401).json({ success: false, message: 'Token ไม่ถูกต้อง' })
  }
}

export const requireRole = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' })
      return
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
      return
    }

    next()
  }
}

export const requireMaster = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' })
    return
  }

  if (req.user.role !== 'MASTER') {
    res.status(403).json({ success: false, message: 'เฉพาะ Master Account เท่านั้น' })
    return
  }

  next()
}

const AGENT_JWT_SECRET = process.env.AGENT_JWT_SECRET
if (!AGENT_JWT_SECRET) {
  throw new Error('FATAL: AGENT_JWT_SECRET environment variable is not set.')
}

export const authenticateAgent = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, message: 'Missing agent token' })
      return
    }
    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token, AGENT_JWT_SECRET) as AgentJwtPayload
    if (decoded.role !== 'AI_AGENT') {
      res.status(403).json({ success: false, message: 'Not an agent token' })
      return
    }
    req.user = {
      userId: decoded.agentId || 'ai-agent',
      email: decoded.email || 'ai@system',
      role: 'AI_AGENT' as Role,
      departments: [],
      tenantId: decoded.tenantId,
    }
    next()
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid agent token' })
  }
}

export const requirePermission = (resource: string, action: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' })
      return
    }

    if (!can(req.user.role, req.user.departments, resource, action, req.user.customPermissions)) {
      res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
      return
    }

    next()
  }
}

export const canEditRecord = (tableName: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' })
      return
    }

    if (req.user.role === 'ADMIN' || req.user.role === 'MASTER') {
      next()
      return
    }

    const { id } = req.params
    if (!id) {
      next()
      return
    }

    if (!EDITABLE_TABLES.has(tableName)) {
      res.status(400).json({ success: false, message: 'Invalid table name' })
      return
    }

    try {
      const db = getDb()
      const record = db.prepare(`SELECT created_at FROM ${tableName} WHERE id = ?`).get(id)

      if (!record) {
        res.status(404).json({ success: false, message: 'ไม่พบข้อมูล' })
        return
      }

      const createdAt = new Date(record.created_at).getTime()
      const now = Date.now()
      const diffHours = (now - createdAt) / (1000 * 60 * 60)

      if (diffHours > HOURS_LIMIT) {
        res.status(403).json({
          success: false,
          message: `เกิน ${HOURS_LIMIT} ชั่วโมงแล้ว ไม่สามารถแก้ไขได้`
        })
        return
      }

      next()
    } catch (error) {
      console.error('CanEditRecord error:', error)
      res.status(500).json({ success: false, message: 'ตรวจสอบสิทธิ์ไม่สำเร็จ' })
    }
  }
}

export const checkEditPermission = (user: { role: Role }, createdAt: string): boolean => {
  if (user.role === 'ADMIN' || user.role === 'MASTER') return true

  const recordTime = new Date(createdAt).getTime()
  const now = Date.now()
  const diffHours = (now - recordTime) / (1000 * 60 * 60)

  return diffHours <= HOURS_LIMIT
}
