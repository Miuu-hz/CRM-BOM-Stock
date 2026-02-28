import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import db from '../db/sqlite'
import { authenticate, generateToken, requireRole } from '../middleware/auth.middleware'

const router = Router()

// Master Accounts (Hardcoded - สามารถย้ายไป DB ได้ในอนาคต)
const MASTER_ACCOUNTS = [
  { id: 'BB-pillow', password: 'BB0918033688', name: 'BB Pillow Master' },
  { id: 'Kidshosuecafe', password: 'Kids0834516669', name: 'Kids House Cafe Master' },
]

// Helper: ตรวจสอบ Master Credentials
const verifyMasterCredentials = (id: string, password: string): boolean => {
  const master = MASTER_ACCOUNTS.find(m => m.id.toLowerCase() === id.toLowerCase())
  return master ? master.password === password : false
}

// Helper: สร้างหรือดึง Master Tenant
const getOrCreateMasterTenant = (masterId: string, masterName: string) => {
  const tenantCode = `MASTER-${masterId.toUpperCase()}`
  
  // ตรวจสอบว่ามี tenant นี้อยู่แล้วหรือไม่
  let tenant = db.prepare('SELECT * FROM tenants WHERE code = ?').get(tenantCode) as any
  
  if (!tenant) {
    // สร้าง Tenant ใหม่สำหรับ Master
    const tenantId = randomUUID().replace(/-/g, '').substring(0, 25)
    const now = new Date().toISOString()
    
    db.prepare(`
      INSERT INTO tenants (id, code, name, status, plan, created_at, updated_at)
      VALUES (?, ?, ?, 'ACTIVE', 'MASTER', ?, ?)
    `).run(tenantId, tenantCode, masterName, now, now)
    
    tenant = { id: tenantId, code: tenantCode, name: masterName }
    
    // สร้าง Master User
    const userId = randomUUID().replace(/-/g, '').substring(0, 25)
    const hashedPassword = bcrypt.hashSync(MASTER_ACCOUNTS.find(m => m.id === masterId)!.password, 10)
    
    db.prepare(`
      INSERT INTO users (id, tenant_id, email, password, name, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'ADMIN', 'ACTIVE', ?, ?)
    `).run(userId, tenantId, masterId, hashedPassword, masterName, now, now)
  }
  
  return tenant
}

// POST /api/auth/login-master - Login สำหรับ Master ID
router.post('/login-master', async (req: Request, res: Response) => {
  try {
    const { masterId, password } = req.body
    
    if (!masterId || !password) {
      return res.status(400).json({ success: false, message: 'กรุณากรอก Master ID และรหัสผ่าน' })
    }
    
    // Verify Master credentials
    if (!verifyMasterCredentials(masterId, password)) {
      return res.status(401).json({ success: false, message: 'Master ID หรือรหัสผ่านไม่ถูกต้อง' })
    }
    
    const masterAccount = MASTER_ACCOUNTS.find(m => m.id === masterId)!
    
    // สร้างหรือดึง Master Tenant
    const tenant = getOrCreateMasterTenant(masterId, masterAccount.name)
    
    // ดึงข้อมูล Master User
    const user = db.prepare(`
      SELECT u.id, u.tenant_id, u.email, u.name, u.role, u.status
      FROM users u
      WHERE u.tenant_id = ? AND u.email = ?
    `).get(tenant.id, masterId) as any
    
    if (!user) {
      return res.status(500).json({ success: false, message: 'ไม่พบข้อมูล Master User' })
    }
    
    // Update last login
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
      .run(new Date().toISOString(), user.id)
    
    // Generate token
    const token = generateToken(user.id, user.tenant_id)
    
    res.json({
      success: true,
      message: 'เข้าสู่ระบบ Master สำเร็จ',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          isMaster: true,
        },
        tenant: {
          id: tenant.id,
          code: tenant.code,
          name: tenant.name,
        },
      },
    })
  } catch (error) {
    console.error('Master login error:', error)
    res.status(500).json({ success: false, message: 'เข้าสู่ระบบไม่สำเร็จ' })
  }
})

// GET /api/auth/children - ดึงรายการสายงานลูก (สำหรับ Master)
router.get('/children', authenticate, (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    // ตรวจสอบว่าเป็น Master tenant หรือไม่
    const tenant = db.prepare('SELECT code FROM tenants WHERE id = ?').get(tenantId) as any
    
    if (!tenant?.code?.startsWith('MASTER-')) {
      return res.status(403).json({ success: false, message: 'เฉพาะ Master เท่านั้น' })
    }
    
    // ดึงรายการผู้ใช้งานลูก (ไม่ใช่ Master เอง)
    const children = db.prepare(`
      SELECT id, email, name, role, status, created_at, last_login_at
      FROM users
      WHERE tenant_id = ? AND email NOT LIKE 'MASTER-%' AND role != 'ADMIN'
      ORDER BY created_at DESC
    `).all(tenantId)
    
    res.json({ success: true, data: children })
  } catch (error) {
    console.error('Get children error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลได้' })
  }
})

// POST /api/auth/children - สร้างสายงานลูก (สำหรับ Master)
router.post('/children', authenticate, async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { email, password, name, role = 'USER' } = req.body
    
    // ตรวจสอบว่าเป็น Master tenant หรือไม่
    const tenant = db.prepare('SELECT code FROM tenants WHERE id = ?').get(tenantId) as any
    
    if (!tenant?.code?.startsWith('MASTER-')) {
      return res.status(403).json({ success: false, message: 'เฉพาะ Master เท่านั้น' })
    }
    
    // Validation
    if (!email || !password || !name) {
      return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบ' })
    }
    
    // Check duplicate email in this tenant
    const existing = db.prepare('SELECT id FROM users WHERE tenant_id = ? AND email = ?')
      .get(tenantId, email)
    
    if (existing) {
      return res.status(400).json({ success: false, message: 'อีเมลนี้มีอยู่แล้ว' })
    }
    
    const userId = randomUUID().replace(/-/g, '').substring(0, 25)
    const hashedPassword = await bcrypt.hash(password, 10)
    const now = new Date().toISOString()
    
    db.prepare(`
      INSERT INTO users (id, tenant_id, email, password, name, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
    `).run(userId, tenantId, email, hashedPassword, name, role, now, now)
    
    res.status(201).json({
      success: true,
      message: 'สร้างสายงานลูกสำเร็จ',
      data: {
        id: userId,
        email,
        name,
        role,
      },
    })
  } catch (error) {
    console.error('Create child error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถสร้างผู้ใช้งานได้' })
  }
})

// DELETE /api/auth/children/:id - ลบสายงานลูก (สำหรับ Master)
router.delete('/children/:id', authenticate, (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params
    
    // ตรวจสอบว่าเป็น Master tenant หรือไม่
    const tenant = db.prepare('SELECT code FROM tenants WHERE id = ?').get(tenantId) as any
    
    if (!tenant?.code?.startsWith('MASTER-')) {
      return res.status(403).json({ success: false, message: 'เฉพาะ Master เท่านั้น' })
    }
    
    // ตรวจสอบว่าไม่ใช่ Master เอง
    const user = db.prepare('SELECT email FROM users WHERE id = ? AND tenant_id = ?')
      .get(id, tenantId) as any
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งาน' })
    }
    
    if (user.email === req.user!.email) {
      return res.status(400).json({ success: false, message: 'ไม่สามารถลบตัวเองได้' })
    }
    
    db.prepare('DELETE FROM users WHERE id = ? AND tenant_id = ?').run(id, tenantId)
    
    res.json({ success: true, message: 'ลบผู้ใช้งานสำเร็จ' })
  } catch (error) {
    console.error('Delete child error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถลบผู้ใช้งานได้' })
  }
})

export default router
