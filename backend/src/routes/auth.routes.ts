import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { getDb } from '../db/sqlite'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

// Master accounts loaded from environment variables (no hardcoded credentials)
function loadMasterAccounts(): Record<string, { passwordHash: string; tenantId: string; name: string }> {
  const accounts: Record<string, { passwordHash: string; tenantId: string; name: string }> = {}
  const prefixes = ['BB', 'KIDS']
  for (const prefix of prefixes) {
    const username = process.env[`MASTER_${prefix}_USERNAME`]
    const hash     = process.env[`MASTER_${prefix}_PASSWORD_HASH`]
    const tenantId = process.env[`MASTER_${prefix}_TENANT_ID`]
    const name     = process.env[`MASTER_${prefix}_NAME`]
    if (username && hash && tenantId && name) {
      accounts[username] = { passwordHash: hash, tenantId, name }
    }
  }
  return accounts
}
const MASTER_ACCOUNTS = loadMasterAccounts()

// ── Rate Limiting: 3 attempts then 5-minute lockout ─────────────────────────
interface AttemptRecord { count: number; lockedUntil: number }
const loginAttempts = new Map<string, AttemptRecord>()
const MAX_ATTEMPTS   = 3
const LOCKOUT_MS     = 5 * 60 * 1000 // 5 minutes

function checkRateLimit(key: string): { blocked: boolean; retryAfterSec?: number } {
  const now = Date.now()
  const rec  = loginAttempts.get(key)
  if (!rec) return { blocked: false }
  if (rec.lockedUntil > now) {
    return { blocked: true, retryAfterSec: Math.ceil((rec.lockedUntil - now) / 1000) }
  }
  if (rec.lockedUntil > 0 && rec.lockedUntil <= now) {
    // lockout expired — reset
    loginAttempts.delete(key)
    return { blocked: false }
  }
  return { blocked: false }
}

function recordFailedAttempt(key: string): void {
  const now = Date.now()
  const rec  = loginAttempts.get(key) ?? { count: 0, lockedUntil: 0 }
  rec.count += 1
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = now + LOCKOUT_MS
  }
  loginAttempts.set(key, rec)
}

function clearAttempts(key: string): void {
  loginAttempts.delete(key)
}
// ─────────────────────────────────────────────────────────────────────────────

// Generate JWT token
const generateToken = (payload: any) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

// @route   POST /api/auth/login
// @desc    Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'กรุณากรอกอีเมลและรหัสผ่าน' })
    }

    // Rate limit check per email
    const rl = checkRateLimit(email)
    if (rl.blocked) {
      return res.status(429).json({
        success: false,
        message: `เข้าสู่ระบบผิดพลาดหลายครั้ง กรุณารอ ${Math.ceil(rl.retryAfterSec! / 60)} นาที แล้วลองใหม่`,
        retryAfterSec: rl.retryAfterSec,
      })
    }

    // Check master accounts (loaded from env, compared with bcrypt)
    const masterAccount = MASTER_ACCOUNTS[email]
    if (masterAccount) {
      const isMatch = await bcrypt.compare(password, masterAccount.passwordHash)
      if (isMatch) {
        clearAttempts(email)
        const token = generateToken({
          userId: `master_${email}`,
          email,
          role: 'MASTER',
          tenantId: masterAccount.tenantId,
        })
        return res.json({
          success: true,
          data: {
            user: { id: `master_${email}`, email, name: masterAccount.name, role: 'MASTER', tenant_id: masterAccount.tenantId },
            token,
          },
        })
      }
      recordFailedAttempt(email)
      const remaining = MAX_ATTEMPTS - (loginAttempts.get(email)?.count ?? MAX_ATTEMPTS)
      const msg = remaining > 0 ? `รหัสผ่านไม่ถูกต้อง (เหลือ ${remaining} ครั้ง)` : 'รหัสผ่านไม่ถูกต้อง กรุณารอ 5 นาที'
      return res.status(401).json({ success: false, message: msg })
    }

    // Check database for regular/child users
    const db = getDb()
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any

    if (!user) {
      recordFailedAttempt(email)
      return res.status(401).json({ success: false, message: 'ไม่พบผู้ใช้งาน' })
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      recordFailedAttempt(email)
      const remaining = MAX_ATTEMPTS - (loginAttempts.get(email)?.count ?? MAX_ATTEMPTS)
      const msg = remaining > 0 ? `รหัสผ่านไม่ถูกต้อง (เหลือ ${remaining} ครั้ง)` : 'รหัสผ่านไม่ถูกต้อง กรุณารอ 5 นาที'
      return res.status(401).json({ success: false, message: msg })
    }

    clearAttempts(email)
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenant_id,
    })

    res.json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, name: user.name, role: user.role, tenant_id: user.tenant_id },
        token,
      },
    })

  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ success: false, message: 'เข้าสู่ระบบไม่สำเร็จ' })
  }
})

// @route   POST /api/auth/register
// @desc    Register new user (for master to create child)
router.post('/create-child', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' })
    }

    const token = authHeader.split(' ')[1]
    let decoded: any
    
    try {
      decoded = jwt.verify(token, JWT_SECRET)
    } catch {
      return res.status(401).json({ success: false, message: 'Token ไม่ถูกต้อง' })
    }

    // Check if master
    if (decoded.role !== 'MASTER') {
      return res.status(403).json({ success: false, message: 'เฉพาะ Master เท่านั้นที่สร้างผู้ใช้งานได้' })
    }

    const { email, password, name, role = 'USER' } = req.body

    if (!email || !password || !name) {
      return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบ' })
    }

    const db = getDb()

    // Check if email exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
    if (existing) {
      return res.status(400).json({ success: false, message: 'อีเมลนี้ถูกใช้แล้ว' })
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10)

    // Insert user with parent_id = master
    const result = db.prepare(`
      INSERT INTO users (id, email, password, name, role, tenant_id, parent_id, status, created_at, updated_at)
      VALUES (lower(hex(randomblob(12))), ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
    `).run(email, hashedPassword, name, role, decoded.tenantId, decoded.userId)

    res.json({ success: true, data: { id: result.lastInsertRowid } })

  } catch (error) {
    console.error('Create child error:', error)
    res.status(500).json({ success: false, message: 'สร้างไม่สำเร็จ' })
  }
})

// @route   GET /api/auth/children
// @desc    Get all child users for master
router.get('/children', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' })
    }

    const token = authHeader.split(' ')[1]
    let decoded: any
    
    try {
      decoded = jwt.verify(token, JWT_SECRET)
    } catch {
      return res.status(401).json({ success: false, message: 'Token ไม่ถูกต้อง' })
    }

    const db = getDb()
    let children: any[] = []

    if (decoded.role === 'MASTER') {
      // Get all users in same tenant or with this master as parent
      children = db.prepare(`
        SELECT id, email, name, role, status, created_at, last_login_at
        FROM users 
        WHERE tenant_id = ? OR parent_id = ?
        ORDER BY created_at DESC
      `).all(decoded.tenantId, decoded.userId)
    } else {
      // Regular users can see themselves only
      const user = db.prepare('SELECT id, email, name, role, status, created_at, last_login_at FROM users WHERE id = ?').get(decoded.userId)
      if (user) children = [user]
    }

    res.json({ success: true, data: children })

  } catch (error) {
    console.error('Get children error:', error)
    res.status(500).json({ success: false, message: 'ดึงข้อมูลไม่สำเร็จ' })
  }
})

// @route   DELETE /api/auth/children/:id
// @desc    Delete child user
router.delete('/children/:id', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' })
    }

    const token = authHeader.split(' ')[1]
    let decoded: any
    
    try {
      decoded = jwt.verify(token, JWT_SECRET)
    } catch {
      return res.status(401).json({ success: false, message: 'Token ไม่ถูกต้อง' })
    }

    // Only master can delete
    if (decoded.role !== 'MASTER') {
      return res.status(403).json({ success: false, message: 'เฉพาะ Master เท่านั้น' })
    }

    const { id } = req.params
    const db = getDb()

    // Verify the user belongs to this master/tenant
    const child = db.prepare('SELECT * FROM users WHERE id = ? AND (parent_id = ? OR tenant_id = ?)').get(id, decoded.userId, decoded.tenantId)
    if (!child) {
      return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งาน' })
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id)

    res.json({ success: true })

  } catch (error) {
    console.error('Delete child error:', error)
    res.status(500).json({ success: false, message: 'ลบไม่สำเร็จ' })
  }
})

export default router
