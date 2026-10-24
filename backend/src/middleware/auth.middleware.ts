import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { isCashierOnly, cashierAllowed, basicUserDenied } from './cashierScope'
import { getDb } from '../db/sqlite'
import { can, isBasicUser } from '../services/rbac.service'
import { Role, Department } from '../config/roles'

interface UserJwtPayload {
  userId: string
  email: string
  role: Role
  department?: Department
  tenantId: string
}

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set. Set it before starting the server.')
}

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

    // Load fresh role/status/departments/custom_permissions from DB (always current, no stale JWT)
    const db = getDb()
    const userRecord = db.prepare(
      'SELECT role, status, departments, custom_permissions FROM users WHERE id = ?'
    ).get(decoded.userId) as { role: Role; status: string; departments: string | null; custom_permissions: string | null } | undefined

    // Env-configured MASTER accounts (id "master_<email>", see auth.routes.ts) have
    // no row in `users` — they can't be deactivated via the DB, so skip the status
    // gate for them. Any other missing/inactive row is rejected.
    if (!userRecord && decoded.role !== 'MASTER') {
      res.status(401).json({ success: false, message: 'บัญชีถูกระงับการใช้งาน' })
      return
    }
    // Bounds every already-issued access token to its remaining lifetime after
    // a deactivation, not just new logins/refreshes.
    if (userRecord && userRecord.status !== 'active') {
      res.status(401).json({ success: false, message: 'บัญชีถูกระงับการใช้งาน' })
      return
    }

    const departments: Department[] = userRecord?.departments
      ? JSON.parse(userRecord.departments)
      : (decoded.department ? [decoded.department] : [])

    const customPermissions: Record<string, boolean> | undefined = userRecord?.custom_permissions
      ? JSON.parse(userRecord.custom_permissions)
      : undefined

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: userRecord?.role ?? decoded.role,
      department: decoded.department,
      departments,
      customPermissions,
      tenantId: decoded.tenantId,
    }

    // บัญชีแคชเชียร์ใช้ได้เฉพาะ API งานหน้าร้าน — ตรวจที่นี่ที่เดียวเพราะทุก route ผ่าน authenticate
    if (isCashierOnly(req.user.role, departments) && !cashierAllowed(req.method, req.originalUrl)) {
      res.status(403).json({ success: false, code: 'CASHIER_SCOPE', message: 'บัญชีแคชเชียร์ใช้ได้เฉพาะงานหน้าร้าน (POS)' })
      return
    }
    if (isBasicUser(req.user) && basicUserDenied(req.method, req.originalUrl)) {
      res.status(403).json({ success: false, code: 'BASIC_SCOPE', message: 'ผู้ใช้ทั่วไปเข้าถึงงานบัญชี/ภาษี/รายงานไม่ได้' })
      return
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

    // MASTER role is the system owner ??? always allowed across all operations and tenants
    if (req.user.role === 'MASTER') {
      next()
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

