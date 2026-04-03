import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { getDb } from '../db/sqlite'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set. Set it before starting the server.')
}
const HOURS_LIMIT = 24

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string
        email: string
        role: string
        tenantId: string
      }
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

    // AI service account via static API key (for Paperclip AI integration)
    const aiApiKeys = process.env.AI_API_KEYS ? process.env.AI_API_KEYS.split(',').map(k => k.trim()) : []
    const aiTenantId = process.env.AI_TENANT_ID || ''
    if (aiApiKeys.length > 0 && aiApiKeys.includes(token)) {
      if (!aiTenantId) {
        res.status(500).json({ success: false, message: 'AI_TENANT_ID not configured' })
        return
      }
      req.user = {
        userId: 'ai-agent',
        email: 'ai@system',
        role: 'AI_AGENT',
        tenantId: aiTenantId
      }
      next()
      return
    }

    const decoded = jwt.verify(token, JWT_SECRET) as any

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      tenantId: decoded.tenantId
    }

    next()
  } catch (error) {
    res.status(401).json({ success: false, message: 'Token ไม่ถูกต้อง' })
  }
}

// Check if user has required role
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

// Check if user is master
export const requireMaster = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' })
    return
  }

  if (req.user.role !== 'MASTER') {
    res.status(403).json({ success: false, message: 'เฉพาะ Master เท่านั้น' })
    return
  }

  next()
}

// Check if record is within 24h for editing
export const canEditRecord = (tableName: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' })
      return
    }

    // Master can always edit
    if (req.user.role === 'MASTER') {
      next()
      return
    }

    const { id } = req.params
    if (!id) {
      next()
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

// Helper function to check edit permission (for use in controllers)
export const checkEditPermission = (user: any, createdAt: string): boolean => {
  if (user.role === 'MASTER') return true

  const recordTime = new Date(createdAt).getTime()
  const now = Date.now()
  const diffHours = (now - recordTime) / (1000 * 60 * 60)

  return diffHours <= HOURS_LIMIT
}

// Reject any column name that is not a plain SQL identifier (letters, digits, underscore).
// This prevents SQL injection via key names passed from request bodies.
function assertSafeColumnName(name: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe column name rejected: "${name}"`)
  }
}

// Add tenant_id filter to query helpers
export const withTenant = (tableName: string, allowedColumns: string[]) => {
  // Validate the allowlist itself once at call-time so misconfiguration is caught early.
  allowedColumns.forEach(assertSafeColumnName)

  function pickAllowed(data: Record<string, unknown>): Record<string, unknown> {
    const safe: Record<string, unknown> = {}
    for (const key of Object.keys(data)) {
      if (allowedColumns.includes(key)) {
        safe[key] = data[key]
      }
    }
    return safe
  }

  return {
    getAll: (tenantId: string) => {
      const db = getDb()
      return db.prepare(`SELECT * FROM ${tableName} WHERE tenant_id = ? ORDER BY created_at DESC`).all(tenantId)
    },
    getById: (id: string, tenantId: string) => {
      const db = getDb()
      return db.prepare(`SELECT * FROM ${tableName} WHERE id = ? AND tenant_id = ?`).get(id, tenantId)
    },
    create: (data: Record<string, unknown>, tenantId: string) => {
      const db = getDb()
      const filtered = pickAllowed(data)
      if (Object.keys(filtered).length === 0) {
        throw new Error('No allowed columns provided for insert')
      }
      const columns = Object.keys(filtered).concat(['tenant_id', 'created_at', 'updated_at'])
      const placeholders = columns.map(() => '?').join(', ')
      const values = Object.values(filtered).concat([tenantId, new Date().toISOString(), new Date().toISOString()])

      return db.prepare(`INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`).run(...values)
    },
    update: (id: string, data: Record<string, unknown>, tenantId: string) => {
      const db = getDb()
      const filtered = pickAllowed(data)
      if (Object.keys(filtered).length === 0) {
        throw new Error('No allowed columns provided for update')
      }
      const setClause = Object.keys(filtered).map(k => `${k} = ?`).join(', ')
      const values = Object.values(filtered).concat([new Date().toISOString(), id, tenantId])

      return db.prepare(`UPDATE ${tableName} SET ${setClause}, updated_at = ? WHERE id = ? AND tenant_id = ?`).run(...values)
    },
    delete: (id: string, tenantId: string) => {
      const db = getDb()
      return db.prepare(`DELETE FROM ${tableName} WHERE id = ? AND tenant_id = ?`).run(id, tenantId)
    }
  }
}
