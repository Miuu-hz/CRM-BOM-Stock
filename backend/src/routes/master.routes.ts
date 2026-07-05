import { Router, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { authenticate, requireMaster } from '../middleware/auth.middleware'
import { getDb } from '../db/sqlite'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET!

function slugify(text: string): string {
  return text.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 20) || 'tenant'
}

function getAllTenants(currentTenantId: string): { tenantId: string; name: string; isCurrentTenant: boolean }[] {
  const db = getDb()
  const rows = db.prepare('SELECT tenant_id, name FROM company_settings').all() as { tenant_id: string; name: string | null }[]
  const map = new Map<string, string | null>()
  rows.forEach(r => map.set(r.tenant_id, r.name))
  const prefixes: string[] = []
  for (const key of Object.keys(process.env)) {
    const m = key.match(/^MASTER_(.+)_TENANT_ID$/)
    if (m) prefixes.push(m[1])
  }
  for (const prefix of prefixes) {
    const tenantId = process.env[`MASTER_${prefix}_TENANT_ID`]!
    const name = process.env[`MASTER_${prefix}_NAME`] ?? null
    if (!map.has(tenantId)) map.set(tenantId, name)
  }
  return Array.from(map.entries()).map(([tenantId, name]) => ({
    tenantId,
    name: name ?? tenantId,
    isCurrentTenant: tenantId === currentTenantId,
  }))
}

// GET /api/master/tenants
router.get('/tenants', authenticate, requireMaster, (req: Request, res: Response) => {
  const tenants = getAllTenants(req.user!.tenantId)
  res.json({ success: true, data: tenants })
})

// POST /api/master/tenants — provision new tenant + Admin user
router.post('/tenants', authenticate, requireMaster, async (req: Request, res: Response): Promise<void> => {
  const { businessName, adminEmail, adminPassword, adminName, customTenantId } = req.body

  if (!businessName || !adminEmail || !adminPassword || !adminName) {
    res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบ' }); return
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    res.status(400).json({ success: false, message: 'รูปแบบ email ไม่ถูกต้อง' }); return
  }
  if (adminPassword.length < 8) {
    res.status(400).json({ success: false, message: 'Password ต้องมีอย่างน้อย 8 ตัวอักษร' }); return
  }

  const db = getDb()
  const tenantId = customTenantId?.trim() || `tenant_${slugify(businessName)}_${Date.now().toString(36)}`

  const tExists = db.prepare('SELECT 1 FROM company_settings WHERE tenant_id = ?').get(tenantId)
  if (tExists) { res.status(409).json({ success: false, message: `Tenant ID "${tenantId}" มีอยู่แล้ว` }); return }

  const eExists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(adminEmail)
  if (eExists) { res.status(409).json({ success: false, message: `Email "${adminEmail}" ถูกใช้งานแล้ว` }); return }

  const passwordHash = await bcrypt.hash(adminPassword, 10)
  const userId = randomBytes(12).toString('hex')
  const now = new Date().toISOString()

  db.prepare('INSERT INTO company_settings (tenant_id, name, mcp_user_limit) VALUES (?, ?, 1)').run(tenantId, businessName)
  db.prepare(
    `INSERT INTO users (id, email, password, name, role, tenant_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'ADMIN', ?, 'active', ?, ?)`
  ).run(userId, adminEmail, passwordHash, adminName, tenantId, now, now)

  res.json({ success: true, data: { tenantId, adminEmail, adminName, companyName: businessName, userId } })
})

// POST /api/master/switch-tenant
router.post('/switch-tenant', authenticate, requireMaster, (req: Request, res: Response): void => {
  const { tenantId } = req.body
  if (!tenantId) { res.status(400).json({ success: false, message: 'tenantId required' }); return }
  const tenants = getAllTenants(req.user!.tenantId)
  const target = tenants.find(t => t.tenantId === tenantId)
  if (!target) { res.status(404).json({ success: false, message: 'Tenant not found' }); return }
  const token = jwt.sign(
    { userId: req.user!.userId, email: req.user!.email, role: 'MASTER', tenantId },
    JWT_SECRET,
    { expiresIn: '7d' }
  )
  res.json({ success: true, data: { token, tenantId, tenantName: target.name } })
})

// GET /api/master/stats
router.get('/stats', authenticate, requireMaster, (req: Request, res: Response) => {
  const db = getDb()
  const tenants = getAllTenants(req.user!.tenantId)
  const stats = tenants.map(t => {
    const userCount   = (db.prepare('SELECT COUNT(*) as c FROM users WHERE tenant_id = ?').get(t.tenantId) as any).c
    const backupCount = (db.prepare('SELECT COUNT(*) as c FROM backup_logs WHERE tenant_id = ? OR tenant_id IS NULL').get(t.tenantId) as any).c
    const lastBackup  = (db.prepare("SELECT created_at FROM backup_logs WHERE (tenant_id = ? OR tenant_id IS NULL) AND status IN ('SUCCESS','PARTIAL') ORDER BY created_at DESC LIMIT 1").get(t.tenantId) as any)?.created_at ?? null
    const lastLogin   = (db.prepare('SELECT last_login_at FROM users WHERE tenant_id = ? AND last_login_at IS NOT NULL ORDER BY last_login_at DESC LIMIT 1').get(t.tenantId) as any)?.last_login_at ?? null
    return { ...t, userCount, backupCount, lastBackup, lastLogin }
  })
  res.json({ success: true, data: stats })
})

// GET /api/master/mcp-quota/:tenantId
router.get('/mcp-quota/:tenantId', authenticate, requireMaster, (req: Request, res: Response) => {
  const db = getDb()
  const { tenantId } = req.params
  const cs   = db.prepare('SELECT mcp_user_limit FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
  const used = (db.prepare("SELECT COUNT(*) as c FROM users WHERE tenant_id = ? AND mcp_api_key IS NOT NULL AND mcp_api_key != ''").get(tenantId) as any)?.c ?? 0
  res.json({ success: true, data: { tenantId, used, limit: cs?.mcp_user_limit ?? 1 } })
})

// PATCH /api/master/tenant/:tenantId/quota
router.patch('/tenant/:tenantId/quota', authenticate, requireMaster, (req: Request, res: Response) => {
  const db = getDb()
  const { tenantId } = req.params
  const { mcpUserLimit } = req.body
  if (typeof mcpUserLimit !== 'number' || mcpUserLimit < 0) {
    res.status(400).json({ success: false, message: 'mcpUserLimit ต้องเป็นตัวเลขบวก' }); return
  }
  const exists = db.prepare('SELECT 1 FROM company_settings WHERE tenant_id = ?').get(tenantId)
  if (exists) {
    db.prepare('UPDATE company_settings SET mcp_user_limit = ? WHERE tenant_id = ?').run(mcpUserLimit, tenantId)
  } else {
    db.prepare('INSERT INTO company_settings (tenant_id, mcp_user_limit) VALUES (?, ?)').run(tenantId, mcpUserLimit)
  }
  res.json({ success: true, data: { tenantId, mcpUserLimit } })
})

// PATCH /api/master/tenant/:tenantId/info
router.patch('/tenant/:tenantId/info', authenticate, requireMaster, (req: Request, res: Response) => {
  const db = getDb()
  const { tenantId } = req.params
  const { name } = req.body
  if (!name?.trim()) { res.status(400).json({ success: false, message: 'name required' }); return }
  db.prepare('UPDATE company_settings SET name = ? WHERE tenant_id = ?').run(name.trim(), tenantId)
  res.json({ success: true })
})

// DELETE /api/master/tenant/:tenantId — soft deactivate all users
router.delete('/tenant/:tenantId', authenticate, requireMaster, (req: Request, res: Response) => {
  const db = getDb()
  const { tenantId } = req.params
  const result = db.prepare("UPDATE users SET status = 'inactive' WHERE tenant_id = ?").run(tenantId)
  res.json({ success: true, data: { tenantId, deactivated: result.changes } })
})

export default router
