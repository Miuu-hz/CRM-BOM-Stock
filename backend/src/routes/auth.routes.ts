import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import rateLimit from 'express-rate-limit'
import { getDb } from '../db/sqlite'
import { authenticate, requireRole } from '../middleware/auth.middleware'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set. Set it before starting the server.')
}

// ASCII-only — rejects stray non-Latin characters (e.g. a leftover Thai IME
// vowel mark) that look invisible in the UI but break exact-match email
// lookups at login. All email-accepting routes below must run input through
// this, not the old permissive `[^\s@]+@[^\s@]+\.[^\s@]+` pattern.
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/

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

// Case-insensitive lookup — MASTER_ACCOUNTS is a plain object keyed by the
// exact env username, so `foo@x.com` and `Foo@x.com` must resolve the same.
function findMasterAccount(email: string) {
  const key = Object.keys(MASTER_ACCOUNTS).find(k => k.toLowerCase() === email.toLowerCase())
  return key ? MASTER_ACCOUNTS[key] : undefined
}

// ── IP-level rate limit (express-rate-limit) ─────────────────────────────────
// Limits each IP to 20 login attempts per 15-minute window.
// NOTE: This uses the default in-memory store. For multi-process / clustered
// deployments, replace the store with a Redis adapter (rate-limit-redis) so
// the counter is shared across all instances and survives restarts.
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'คำขอมากเกินไป กรุณารอ 15 นาที แล้วลองใหม่' },
})

// Public self-service signup: 5 requests per IP per hour (spam guard; Master still
// reviews every request before a tenant is created).
const registerIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'สมัครบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' },
})

// ── Credential-level rate limit: 3 attempts then 5-minute lockout ─────────────
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

// Short-lived access token for regular users, paired with a long-lived refresh
// token. Master accounts keep the single long-lived token (see login handler).
const ACCESS_TOKEN_TTL  = '60m'
const REFRESH_TOKEN_TTL = '7d'
const generateAccessToken = (payload: any) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL })
}
const generateRefreshToken = (userId: string) => {
  return jwt.sign({ userId, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_TTL })
}

// @route   POST /api/auth/login
// @desc    Login user
router.post('/login', loginIpLimiter, async (req, res) => {
  try {
    const { password } = req.body
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : req.body?.email

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
    const masterAccount = findMasterAccount(email)
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
    const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email) as any

    if (!user) {
      // Not an active account yet — surface a helpful status if a self-service
      // signup request exists for this email (awaiting Master approval / rejected).
      const sr = db.prepare(
        `SELECT status FROM signup_requests WHERE email = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 1`,
      ).get(email) as { status: string } | undefined
      if (sr?.status === 'pending') {
        return res.status(403).json({ success: false, message: 'บัญชีของคุณอยู่ระหว่างรอผู้ดูแลอนุมัติ' })
      }
      if (sr?.status === 'rejected') {
        return res.status(403).json({ success: false, message: 'คำขอสมัครถูกปฏิเสธ กรุณาติดต่อผู้ดูแลระบบ' })
      }
      recordFailedAttempt(email)
      return res.status(401).json({ success: false, message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' })
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      recordFailedAttempt(email)
      const remaining = MAX_ATTEMPTS - (loginAttempts.get(email)?.count ?? MAX_ATTEMPTS)
      const msg = remaining > 0 ? `รหัสผ่านไม่ถูกต้อง (เหลือ ${remaining} ครั้ง)` : 'รหัสผ่านไม่ถูกต้อง กรุณารอ 5 นาที'
      return res.status(401).json({ success: false, message: msg })
    }

    // Deactivated account: same generic error as a bad password, so we never
    // confirm to a caller that the email exists but was deactivated.
    if (user.status !== 'active') {
      recordFailedAttempt(email)
      return res.status(401).json({ success: false, message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' })
    }

    clearAttempts(email)
    const token = generateAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenant_id,
    })
    const refreshToken = generateRefreshToken(user.id)

    res.json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, name: user.name, role: user.role, tenant_id: user.tenant_id },
        token,
        refreshToken,
      },
    })

  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ success: false, message: 'เข้าสู่ระบบไม่สำเร็จ' })
  }
})

// @route   POST /api/auth/refresh
// @desc    Exchange a valid refresh token for a fresh 60-minute access token.
//          Refresh tokens issued before the last password change are rejected.
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'ต้องระบุ refreshToken' })
    }

    let decoded: any
    try {
      decoded = jwt.verify(refreshToken, JWT_SECRET)
    } catch {
      return res.status(401).json({ success: false, message: 'refresh token ไม่ถูกต้องหรือหมดอายุ' })
    }
    if (decoded.type !== 'refresh' || !decoded.userId) {
      return res.status(401).json({ success: false, message: 'refresh token ไม่ถูกต้อง' })
    }

    const db = getDb()
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId) as any
    if (!user) {
      return res.status(401).json({ success: false, message: 'ไม่พบผู้ใช้งาน' })
    }

    if (user.status !== 'active') {
      return res.status(401).json({ success: false, message: 'บัญชีถูกระงับการใช้งาน' })
    }

    // Revoke refresh tokens issued before the last password change.
    // Compare at whole-second granularity: JWT `iat` is floored to seconds, so a
    // token minted in the same second as the change must still be accepted.
    if (user.password_changed_at) {
      const issuedAtSec  = decoded.iat ?? 0
      const changedAtSec = Math.floor(new Date(user.password_changed_at).getTime() / 1000)
      if (issuedAtSec < changedAtSec) {
        return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่ (รหัสผ่านถูกเปลี่ยน)' })
      }
    }

    const token = generateAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenant_id,
    })
    res.json({ success: true, data: { token } })
  } catch (error) {
    console.error('Refresh token error:', error)
    res.status(500).json({ success: false, message: 'ต่ออายุ session ไม่สำเร็จ' })
  }
})

// @route   POST /api/auth/register
// @desc    Public self-service signup. Creates a PENDING signup request (no tenant
//          yet) that a Master must approve. The applicant sets their own password.
//          Spam guards: IP rate-limit + honeypot field (`website`) + duplicate checks.
router.post('/register', registerIpLimiter, async (req, res) => {
  try {
    const { businessName, adminName, password, phone, website } = req.body
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : req.body?.email

    // Honeypot: real users never fill `website`; bots do → pretend success, do nothing.
    if (website) return res.json({ success: true, data: { pending: true } })

    if (!businessName || !adminName || !email || !password) {
      return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบ' })
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ success: false, message: 'รูปแบบอีเมลไม่ถูกต้อง (ใช้ตัวอักษรภาษาอังกฤษเท่านั้น)' })
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ success: false, message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' })
    }

    const db = getDb()

    const existingUser = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email)
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'อีเมลนี้ถูกใช้งานแล้ว กรุณาเข้าสู่ระบบ' })
    }
    const existingPending = db.prepare(
      `SELECT id FROM signup_requests WHERE email = ? COLLATE NOCASE AND status = 'pending'`,
    ).get(email)
    if (existingPending) {
      return res.status(409).json({ success: false, message: 'มีคำขอสมัครด้วยอีเมลนี้อยู่แล้ว กรุณารอผู้ดูแลอนุมัติ' })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    db.prepare(
      `INSERT INTO signup_requests (id, business_name, admin_name, email, password_hash, phone, status, created_at)
       VALUES (lower(hex(randomblob(12))), ?, ?, ?, ?, ?, 'pending', datetime('now'))`,
    ).run(businessName, adminName, email, passwordHash, phone || null)

    res.json({ success: true, data: { pending: true } })
  } catch (error) {
    console.error('Register error:', error)
    res.status(500).json({ success: false, message: 'สมัครไม่สำเร็จ' })
  }
})

// @route   POST /api/auth/create-child
// @desc    Master creates a child user directly in their tenant
router.post('/create-child', authenticate, requireRole('MASTER'), async (req, res) => {
  try {
    const { password, name, role = 'USER' } = req.body
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : req.body?.email

    if (!email || !password || !name) {
      return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบ' })
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ success: false, message: 'รูปแบบอีเมลไม่ถูกต้อง (ใช้ตัวอักษรภาษาอังกฤษเท่านั้น)' })
    }

    // MASTER can never be minted via API — master accounts exist only in .env.
    if (!['ADMIN', 'MANAGER', 'POWERUSER', 'USER'].includes(role)) {
      return res.status(403).json({ success: false, message: 'ไม่สามารถกำหนด role นี้ได้ (สร้าง MASTER ผ่าน API ไม่ได้)' })
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ success: false, message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' })
    }

    const db = getDb()

    // Check if email exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email)
    if (existing) {
      return res.status(400).json({ success: false, message: 'อีเมลนี้ถูกใช้แล้ว' })
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10)

    // Insert user with parent_id = master
    const result = db.prepare(`
      INSERT INTO users (id, email, password, name, role, tenant_id, parent_id, status, created_at, updated_at)
      VALUES (lower(hex(randomblob(12))), ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
    `).run(email, hashedPassword, name, role, req.user!.tenantId, req.user!.userId)

    res.json({ success: true, data: { id: result.lastInsertRowid } })

  } catch (error) {
    console.error('Create child error:', error)
    res.status(500).json({ success: false, message: 'สร้างไม่สำเร็จ' })
  }
})

// @route   GET /api/auth/children
// @desc    Get all child users for master
router.get('/children', authenticate, (req, res) => {
  try {
    const db = getDb()
    let children: any[] = []

    if (req.user!.role === 'MASTER') {
      // Get all users in same tenant or with this master as parent
      children = db.prepare(`
        SELECT id, email, name, role, status, created_at, last_login_at
        FROM users 
        WHERE tenant_id = ? OR parent_id = ?
        ORDER BY created_at DESC
      `).all(req.user!.tenantId, req.user!.userId)
    } else {
      // Regular users can see themselves only
      const user = db.prepare('SELECT id, email, name, role, status, created_at, last_login_at FROM users WHERE id = ?').get(req.user!.userId)
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
router.delete('/children/:id', authenticate, requireRole('MASTER'), async (req, res) => {
  try {
    const { id } = req.params
    const db = getDb()

    // Verify the user belongs to this master/tenant
    const child = db.prepare('SELECT * FROM users WHERE id = ? AND (parent_id = ? OR tenant_id = ?)').get(id, req.user!.userId, req.user!.tenantId)
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
