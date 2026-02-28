import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { getDb } from '../db/sqlite'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'
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

// Hardcoded master accounts
const MASTER_ACCOUNTS = ['BB-pillow', 'Kidshosuecafe']

// DEV MODE: Allow dev_token without verification
const DEV_TOKEN = 'dev_token'

export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization
    
    console.log('🔍 Auth Header:', authHeader)
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' })
      return
    }

    const token = authHeader.split(' ')[1]
    console.log('🔍 Token:', token)
    
    // DEV MODE: Accept dev_token
    if (token === DEV_TOKEN) {
      console.log('✅ DEV TOKEN ACCEPTED')
      req.user = {
        userId: 'master_BB-pillow',
        email: 'BB-pillow',
        role: 'MASTER',
        tenantId: 'tenant_bb_pillow'
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

// Check if user is master (either hardcoded or has MASTER role)
export const requireMaster = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' })
    return
  }

  const isMaster = req.user.role === 'MASTER' || MASTER_ACCOUNTS.includes(req.user.email)
  
  if (!isMaster) {
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
    const isMaster = req.user.role === 'MASTER' || MASTER_ACCOUNTS.includes(req.user.email)
    if (isMaster) {
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
  const isMaster = user.role === 'MASTER' || MASTER_ACCOUNTS.includes(user.email)
  if (isMaster) return true

  const recordTime = new Date(createdAt).getTime()
  const now = Date.now()
  const diffHours = (now - recordTime) / (1000 * 60 * 60)

  return diffHours <= HOURS_LIMIT
}

// Add tenant_id filter to query helpers
export const withTenant = (tableName: string) => {
  return {
    getAll: (tenantId: string) => {
      const db = getDb()
      return db.prepare(`SELECT * FROM ${tableName} WHERE tenant_id = ? ORDER BY created_at DESC`).all(tenantId)
    },
    getById: (id: string, tenantId: string) => {
      const db = getDb()
      return db.prepare(`SELECT * FROM ${tableName} WHERE id = ? AND tenant_id = ?`).get(id, tenantId)
    },
    create: (data: any, tenantId: string) => {
      const db = getDb()
      const columns = Object.keys(data).concat(['tenant_id', 'created_at', 'updated_at'])
      const placeholders = columns.map(() => '?').join(', ')
      const values = Object.values(data).concat([tenantId, new Date().toISOString(), new Date().toISOString()])
      
      return db.prepare(`INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`).run(...values)
    },
    update: (id: string, data: any, tenantId: string) => {
      const db = getDb()
      const setClause = Object.keys(data).map(k => `${k} = ?`).join(', ')
      const values = Object.values(data).concat([new Date().toISOString(), id, tenantId])
      
      return db.prepare(`UPDATE ${tableName} SET ${setClause}, updated_at = ? WHERE id = ? AND tenant_id = ?`).run(...values)
    },
    delete: (id: string, tenantId: string) => {
      const db = getDb()
      return db.prepare(`DELETE FROM ${tableName} WHERE id = ? AND tenant_id = ?`).run(id, tenantId)
    }
  }
}
