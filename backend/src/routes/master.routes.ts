import { Router, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { authenticate, requireMaster } from '../middleware/auth.middleware'
import { getDb } from '../db/sqlite'
import { getSubscription } from '../services/subscription.service'
import { provisionTenant, ProvisionError } from '../services/provisioning'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET!

// ── Seamless Phopy Board (Kanban) provisioning ──────────────────────────────
// Right after an ERP tenant + admin is created, mirror it into Planka so the
// admin gets a matching org + org-admin account with the SAME password (login
// works on both systems). Non-fatal: if Planka is unreachable, the first SSO
// click will JIT-provision the account anyway (SSO-only until a password sync).
const KANBAN_SSO_SECRET = process.env.KANBAN_SSO_SECRET
const KANBAN_INTERNAL_URL = process.env.KANBAN_INTERNAL_URL || 'http://192.168.1.96:1337'

async function provisionKanban(params: {
  erpUserId: string; tenantId: string; tenantName: string; email: string; name: string; password: string
}): Promise<boolean> {
  if (!KANBAN_SSO_SECRET) {
    console.warn('[kanban-provision] KANBAN_SSO_SECRET not set — skipping')
    return false
  }
  try {
    const token = jwt.sign(
      { ...params, erpRole: 'ADMIN', purpose: 'kanban-provision' },
      KANBAN_SSO_SECRET,
      { algorithm: 'HS256', expiresIn: 120 },
    )
    const resp = await fetch(`${KANBAN_INTERNAL_URL}/erp-sso/provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (!resp.ok) {
      console.warn('[kanban-provision] failed', resp.status, await resp.text().catch(() => ''))
      return false
    }
    return true
  } catch (err) {
    console.warn('[kanban-provision] error (non-fatal)', err)
    return false
  }
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

  const passwordHash = await bcrypt.hash(adminPassword, 10)

  let tenantId: string, userId: string
  try {
    ;({ tenantId, userId } = provisionTenant({
      businessName,
      adminEmail,
      adminName,
      adminPasswordHash: passwordHash,
      customTenantId,
    }))
  } catch (err) {
    if (err instanceof ProvisionError) { res.status(err.status).json({ success: false, message: err.message }); return }
    throw err
  }

  const kanbanProvisioned = await provisionKanban({
    erpUserId: userId,
    tenantId,
    tenantName: businessName,
    email: adminEmail,
    name: adminName,
    password: adminPassword,
  })

  res.json({ success: true, data: { tenantId, adminEmail, adminName, companyName: businessName, userId, kanbanProvisioned } })
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
// limit = effective (override ?? max_users ตามแพ็กเกจ) · null = ไม่จำกัด
// override = ค่าที่ตั้งเองไว้ (null = ยึดตามแพ็กเกจ) · planLimit = max_users ของแพ็กเกจปัจจุบัน
router.get('/mcp-quota/:tenantId', authenticate, requireMaster, (req: Request, res: Response) => {
  const db = getDb()
  const { tenantId } = req.params
  const cs   = db.prepare('SELECT mcp_user_limit FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
  const used = (db.prepare("SELECT COUNT(*) as c FROM users WHERE tenant_id = ? AND mcp_api_key IS NOT NULL AND mcp_api_key != ''").get(tenantId) as any)?.c ?? 0
  const override: number | null = cs ? cs.mcp_user_limit : null
  const planLimit = getSubscription(tenantId).maxUsers
  const limit = override != null ? override : planLimit
  res.json({ success: true, data: { tenantId, used, limit, planLimit, override, source: override != null ? 'override' : 'plan' } })
})

// PATCH /api/master/tenant/:tenantId/quota
// mcpUserLimit: number = override, null = เคลียร์ override (กลับไปยึด max_users ตามแพ็กเกจ)
router.patch('/tenant/:tenantId/quota', authenticate, requireMaster, (req: Request, res: Response) => {
  const db = getDb()
  const { tenantId } = req.params
  const { mcpUserLimit } = req.body
  if (mcpUserLimit !== null && (typeof mcpUserLimit !== 'number' || mcpUserLimit < 0)) {
    res.status(400).json({ success: false, message: 'mcpUserLimit ต้องเป็นตัวเลขบวก หรือ null (ตามแพ็กเกจ)' }); return
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

// DELETE /api/master/tenant/:tenantId/purge — ลบถาวร เฉพาะ tenant ที่ไม่มีผู้ใช้และไม่มีข้อมูลธุรกิจ
// ตารางใน SHELL_TABLES = config ที่ provisionTenant สร้างให้ตอนเปิด tenant ไม่นับเป็น "ข้อมูล"
const SHELL_TABLES = new Set([
  'company_settings', 'tenant_subscriptions', 'document_sequences',
  'document_number_formats', 'currencies', 'accounts',
])
router.delete('/tenant/:tenantId/purge', authenticate, requireMaster, (req: Request, res: Response) => {
  const db = getDb()
  const { tenantId } = req.params
  if (tenantId === req.user!.tenantId) {
    res.status(400).json({ success: false, message: 'ลบ tenant ที่กำลังใช้งานอยู่ไม่ได้ ให้สลับไป tenant อื่นก่อน' }); return
  }
  const envKey = Object.keys(process.env).find(k => /^MASTER_.+_TENANT_ID$/.test(k) && process.env[k] === tenantId)
  if (envKey) {
    res.status(400).json({ success: false, message: `tenant นี้ผูกกับบัญชี Master ใน .env (${envKey}) ต้องเอาออกจาก .env ก่อน` }); return
  }

  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(r => r.name as string)
  const owned = tables.filter(t => (db.prepare(`PRAGMA table_info("${t}")`).all() as any[]).some((c: any) => c.name === 'tenant_id'))
  const blockers = owned
    .filter(t => !SHELL_TABLES.has(t))
    .map(t => ({ t, c: (db.prepare(`SELECT COUNT(*) c FROM "${t}" WHERE tenant_id = ?`).get(tenantId) as any).c as number }))
    .filter(x => x.c > 0)
  if (blockers.length) {
    res.status(409).json({
      success: false,
      message: `ลบถาวรไม่ได้ ยังมีข้อมูลอยู่: ${blockers.map(b => `${b.t} (${b.c})`).join(', ')} — ใช้ "ปิดใช้งาน" แทน`,
    }); return
  }

  const deleted = db.transaction(() =>
    owned.reduce((n, t) => n + db.prepare(`DELETE FROM "${t}" WHERE tenant_id = ?`).run(tenantId).changes, 0)
  )()
  res.json({ success: true, data: { tenantId, deleted } })
})

// ==================== SUBSCRIPTIONS ====================

// GET /api/master/plans — รายการแพ็กเกจ
router.get('/plans', authenticate, requireMaster, (req: Request, res: Response) => {
  const db = getDb()
  const plans = (db.prepare('SELECT * FROM subscription_plans ORDER BY sort_order').all() as any[])
    .map(p => ({ ...p, features: JSON.parse(p.features || '[]') }))
  res.json({ success: true, data: plans })
})

// PATCH /api/master/plans/:code — แก้ราคา/limits/features/is_active
router.patch('/plans/:code', authenticate, requireMaster, (req: Request, res: Response) => {
  const db = getDb()
  const { code } = req.params
  const existing = db.prepare('SELECT id FROM subscription_plans WHERE code = ?').get(code)
  if (!existing) { res.status(404).json({ success: false, message: 'ไม่พบแพ็กเกจ' }); return }

  const ALLOWED = ['name', 'description', 'price_monthly', 'price_yearly', 'max_users', 'max_products', 'max_pos_shifts', 'features', 'is_active', 'sort_order']
  const fields: Record<string, any> = {}
  for (const key of ALLOWED) {
    if (req.body[key] !== undefined) {
      fields[key] = key === 'features' ? JSON.stringify(req.body[key]) : req.body[key]
    }
  }
  if (Object.keys(fields).length === 0) {
    res.status(400).json({ success: false, message: 'ไม่มีข้อมูลให้แก้ไข' }); return
  }
  fields.updated_at = new Date().toISOString()

  const setClauses = Object.keys(fields).map(k => `${k} = ?`).join(', ')
  db.prepare(`UPDATE subscription_plans SET ${setClauses} WHERE code = ?`).run(...Object.values(fields), code)
  res.json({ success: true, message: 'อัปเดตแพ็กเกจสำเร็จ' })
})

// GET /api/master/subscriptions — ทุก tenant + plan + status + วันคงเหลือ + usage
router.get('/subscriptions', authenticate, requireMaster, (req: Request, res: Response) => {
  const db = getDb()
  const tenants = getAllTenants(req.user!.tenantId)
  const data = tenants.map(t => {
    const sub = getSubscription(t.tenantId)
    const userCount = (db.prepare('SELECT COUNT(*) as c FROM users WHERE tenant_id = ?').get(t.tenantId) as any).c
    const productCount = (db.prepare('SELECT COUNT(*) as c FROM stock_items WHERE tenant_id = ?').get(t.tenantId) as any).c
    const daysRemaining = sub.currentPeriodEnd
      ? Math.ceil((new Date(sub.currentPeriodEnd).getTime() - Date.now()) / 86400000)
      : null
    return {
      ...t,
      plan: sub.planCode === 'none' ? null : sub.planCode,
      planName: sub.planCode === 'none' ? null : sub.planName,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      daysRemaining,
      usage: {
        users: { used: userCount, max: sub.maxUsers },
        products: { used: productCount, max: sub.maxProducts },
      },
    }
  })
  res.json({ success: true, data })
})

// PUT /api/master/tenant/:id/subscription — เปลี่ยนแพ็กเกจ/เปิด ACTIVE/ปรับกลับ free
router.put('/tenant/:id/subscription', authenticate, requireMaster, (req: Request, res: Response) => {
  const db = getDb()
  const { id } = req.params
  const { planCode, billingCycle, periodDays, notes } = req.body

  const plan = db.prepare('SELECT code FROM subscription_plans WHERE code = ?').get(planCode)
  if (!plan) { res.status(404).json({ success: false, message: `ไม่พบแพ็กเกจ "${planCode}"` }); return }

  const now = new Date()
  let status: string, cycle: string | null, periodEnd: string | null
  if (planCode === 'free') {
    status = 'FREE'; cycle = null; periodEnd = null
  } else {
    status = 'ACTIVE'
    cycle = billingCycle === 'yearly' ? 'yearly' : 'monthly'
    const days = (typeof periodDays === 'number' && periodDays > 0)
      ? periodDays
      : (cycle === 'yearly' ? 365 : 30)
    periodEnd = new Date(now.getTime() + days * 86400000).toISOString()
  }
  const nowStr = now.toISOString()

  db.prepare(
    `INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, billing_cycle, current_period_start, current_period_end, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id) DO UPDATE SET
       plan_code = excluded.plan_code,
       status = excluded.status,
       billing_cycle = excluded.billing_cycle,
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end,
       notes = COALESCE(excluded.notes, tenant_subscriptions.notes),
       updated_at = excluded.updated_at`
  ).run(randomBytes(8).toString('hex'), id, planCode, status, cycle, nowStr, periodEnd, notes ?? null, nowStr)

  res.json({ success: true, data: getSubscription(id) })
})

// POST /api/master/tenant/:id/extend — { days } ขยาย current_period_end (ต่ออายุ)
router.post('/tenant/:id/extend', authenticate, requireMaster, (req: Request, res: Response) => {
  const db = getDb()
  const { id } = req.params
  const { days } = req.body

  if (typeof days !== 'number' || days <= 0) {
    res.status(400).json({ success: false, message: 'days ต้องเป็นตัวเลขบวก' }); return
  }
  const sub = db.prepare('SELECT status, current_period_end FROM tenant_subscriptions WHERE tenant_id = ?').get(id) as any
  if (!sub) { res.status(404).json({ success: false, message: 'Tenant นี้ยังไม่มี subscription' }); return }
  if (!sub.current_period_end) {
    res.status(400).json({ success: false, message: 'แพ็กเกจ Free ไม่มีวันหมดอายุ ไม่ต้องต่ออายุ' }); return
  }

  // ต่อจากวันหมดอายุเดิม หรือจากวันนี้ถ้าหมดอายุไปแล้ว — แล้วแต่อย่างไหนช้ากว่า
  const base = Math.max(new Date(sub.current_period_end).getTime(), Date.now())
  const newEnd = new Date(base + days * 86400000).toISOString()
  db.prepare(
    `UPDATE tenant_subscriptions SET current_period_end = ?, status = 'ACTIVE', updated_at = ? WHERE tenant_id = ?`
  ).run(newEnd, new Date().toISOString(), id)

  res.json({ success: true, data: getSubscription(id) })
})

// ==================== SIGNUP REQUESTS (self-service, Master-approved) ====================

// GET /api/master/signup-requests?status=pending|approved|rejected|all
router.get('/signup-requests', authenticate, requireMaster, (req: Request, res: Response) => {
  const db = getDb()
  const status = (req.query.status as string) || 'pending'
  const rows =
    status === 'all'
      ? db.prepare(
          `SELECT id, business_name, admin_name, email, phone, status, tenant_id, reject_reason, created_at, reviewed_at
           FROM signup_requests ORDER BY created_at DESC`,
        ).all()
      : db.prepare(
          `SELECT id, business_name, admin_name, email, phone, status, tenant_id, reject_reason, created_at, reviewed_at
           FROM signup_requests WHERE status = ? ORDER BY created_at DESC`,
        ).all(status)
  res.json({ success: true, data: rows })
})

// POST /api/master/signup-requests/:id/approve — provision the tenant, mark approved
router.post('/signup-requests/:id/approve', authenticate, requireMaster, (req: Request, res: Response): void => {
  const db = getDb()
  const { id } = req.params
  const reqRow = db.prepare('SELECT * FROM signup_requests WHERE id = ?').get(id) as any
  if (!reqRow) { res.status(404).json({ success: false, message: 'ไม่พบคำขอสมัคร' }); return }
  if (reqRow.status !== 'pending') { res.status(409).json({ success: false, message: 'คำขอนี้ถูกดำเนินการไปแล้ว' }); return }

  let tenantId: string, userId: string
  try {
    // password_hash was set by the applicant at signup — reuse it verbatim (do not re-hash).
    ;({ tenantId, userId } = provisionTenant({
      businessName: reqRow.business_name,
      adminEmail: reqRow.email,
      adminName: reqRow.admin_name,
      adminPasswordHash: reqRow.password_hash,
    }))
  } catch (err) {
    if (err instanceof ProvisionError) { res.status(err.status).json({ success: false, message: err.message }); return }
    throw err
  }

  db.prepare(
    `UPDATE signup_requests SET status = 'approved', tenant_id = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`,
  ).run(tenantId, req.user!.userId, id)

  // Phopy Kanban is auto-provisioned just-in-time on the user's first SSO click
  // (no plaintext password available here to sync).
  res.json({ success: true, data: { tenantId, userId, email: reqRow.email, businessName: reqRow.business_name } })
})

// POST /api/master/signup-requests/:id/reject
router.post('/signup-requests/:id/reject', authenticate, requireMaster, (req: Request, res: Response): void => {
  const db = getDb()
  const { id } = req.params
  const { reason } = req.body
  const reqRow = db.prepare('SELECT status FROM signup_requests WHERE id = ?').get(id) as any
  if (!reqRow) { res.status(404).json({ success: false, message: 'ไม่พบคำขอสมัคร' }); return }
  if (reqRow.status !== 'pending') { res.status(409).json({ success: false, message: 'คำขอนี้ถูกดำเนินการไปแล้ว' }); return }
  db.prepare(
    `UPDATE signup_requests SET status = 'rejected', reject_reason = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`,
  ).run(reason || null, req.user!.userId, id)
  res.json({ success: true })
})

export default router
