import { Request, Response, NextFunction } from 'express'
import db from '../db/sqlite'

/**
 * Middleware ตรวจสอบ 24 Hour Rule
 * - ข้อมูลที่สร้างเกิน 24 ชั่วโมงไม่สามารถแก้ไข/ลบได้
 * - ยกเว้น Master ID (ที่เป็น Master Account)
 * 
 * ใช้กับ Routes: PUT, DELETE
 */

// รายการตารางที่ต้องการตรวจสอบ 24hr
const TIME_LOCKED_TABLES = [
  'customers',
  'orders',
  'products',
  'materials',
  'boms',
  'purchase_orders',
  'work_orders',
  'stock_movements',
]

// ดึงชื่อตารางจาก URL path
const getTableNameFromPath = (path: string): string | null => {
  const mappings: Record<string, string> = {
    '/api/customers': 'customers',
    '/api/orders': 'orders',
    '/api/products': 'products',
    '/api/materials': 'materials',
    '/api/bom': 'boms',
    '/api/purchase-orders': 'purchase_orders',
    '/api/work-orders': 'work_orders',
    '/api/stock/movement': 'stock_movements',
  }
  
  for (const [prefix, table] of Object.entries(mappings)) {
    if (path.startsWith(prefix)) return table
  }
  return null
}

// ตรวจสอบว่าเป็น Master Account หรือไม่
const isMasterAccount = async (userId: string): Promise<boolean> => {
  const user = db.prepare('SELECT email, tenant_id FROM users WHERE id = ?').get(userId) as any
  
  if (!user) return false
  
  // ตรวจสอบว่า email เป็น Master ID หรือไม่
  const masterEmails = ['BB-pillow', 'Kidshosuecafe']
  if (masterEmails.includes(user.email)) return true
  
  // ตรวจสอบว่า tenant เป็น Master tenant หรือไม่
  const tenant = db.prepare('SELECT code FROM tenants WHERE id = ?').get(user.tenant_id) as any
  if (tenant?.code?.startsWith('MASTER-')) return true
  
  return false
}

// Middleware หลัก
export const checkTimeLock = async (req: Request, res: Response, next: NextFunction) => {
  // ข้ามถ้าไม่ใช่ PUT หรือ DELETE
  if (!['PUT', 'DELETE'].includes(req.method)) {
    return next()
  }
  
  const tableName = getTableNameFromPath(req.path)
  
  // ถ้าไม่ใช่ตารางที่ต้องการตรวจสอบ ให้ผ่านไป
  if (!tableName || !TIME_LOCKED_TABLES.includes(tableName)) {
    return next()
  }
  
  // ดึง ID จาก params
  const recordId = req.params.id
  if (!recordId) {
    return next()
  }
  
  try {
    // ดึงข้อมูล created_at และ tenant_id ของ record
    const record = db.prepare(`
      SELECT created_at, tenant_id FROM ${tableName} WHERE id = ?
    `).get(recordId) as any
    
    if (!record) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูล' })
    }
    
    // ตรวจสอบว่าเป็น Master หรือไม่
    const isMaster = await isMasterAccount(req.user!.id)
    
    // Master สามารถแก้ไขได้เสมอ
    if (isMaster) {
      return next()
    }
    
    // คำนวณเวลาที่ผ่านไป
    const createdAt = new Date(record.created_at).getTime()
    const now = Date.now()
    const hoursPassed = (now - createdAt) / (1000 * 60 * 60)
    
    // ถ้าเกิน 24 ชั่วโมง ไม่อนุญาตให้แก้ไข
    if (hoursPassed >= 24) {
      const hoursLeft = Math.floor(hoursPassed)
      return res.status(403).json({
        success: false,
        message: `ไม่สามารถแก้ไขข้อมูลได้ เนื่องจากสร้างมาแล้วเกิน 24 ชั่วโมง (${hoursLeft} ชั่วโมง)`,
        code: 'TIME_LOCKED',
        createdAt: record.created_at,
        hoursPassed: Math.floor(hoursPassed),
      })
    }
    
    // ผ่านการตรวจสอบ
    next()
  } catch (error) {
    console.error('Time lock check error:', error)
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการตรวจสอบเวลา' })
  }
}

// Helper function สำหรับตรวจสอบเวลาใน Controller
export const getTimeLockInfo = (createdAt: string): {
  isLocked: boolean
  hoursPassed: number
  hoursLeft: number
  canEdit: boolean
} => {
  const created = new Date(createdAt).getTime()
  const now = Date.now()
  const hoursPassed = (now - created) / (1000 * 60 * 60)
  const hoursLeft = Math.max(0, 24 - hoursPassed)
  
  return {
    isLocked: hoursPassed >= 24,
    hoursPassed: Math.floor(hoursPassed * 100) / 100,
    hoursLeft: Math.floor(hoursLeft * 100) / 100,
    canEdit: hoursPassed < 24,
  }
}

// Middleware สำหรับดึงข้อมูล time lock ไปแสดงใน response
export const withTimeLockInfo = (req: Request, res: Response, next: NextFunction) => {
  // เก็บ original json method
  const originalJson = res.json
  
  // override json method
  res.json = function(body: any) {
    // ถ้ามี data และ data มี created_at
    if (body?.data && body.data.created_at) {
      const timeInfo = getTimeLockInfo(body.data.created_at)
      body.data._timeLock = timeInfo
    }
    
    // ถ้ามี data เป็น array
    if (body?.data && Array.isArray(body.data)) {
      body.data = body.data.map((item: any) => {
        if (item.created_at) {
          return {
            ...item,
            _timeLock: getTimeLockInfo(item.created_at),
          }
        }
        return item
      })
    }
    
    return originalJson.call(this, body)
  }
  
  next()
}
