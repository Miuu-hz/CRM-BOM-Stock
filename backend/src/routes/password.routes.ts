import { Router } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import rateLimit from 'express-rate-limit'
import { getDb } from '../db/sqlite'
import { authenticate, requireRole } from '../middleware/auth.middleware'
import { ROLE_HIERARCHY, Role } from '../config/roles'

const router = Router()

// ── Reset-token store ─────────────────────────────────────────────────────────
// Idempotent: safe to run on every boot / first import.
getDb().prepare(`
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    token_hash  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    created_by  TEXT
  )
`).run()

const RESET_TTL_MS   = 30 * 60 * 1000 // 30 minutes
const MIN_PW_LENGTH  = 8

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function isStrongEnough(pw: unknown): pw is string {
  return typeof pw === 'string' && pw.length >= MIN_PW_LENGTH
}

// Rate-limit the public reset/forgot endpoints so tokens can't be brute-forced.
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'คำขอมากเกินไป กรุณารอ 15 นาที แล้วลองใหม่' },
})

// ── POST /change-password (self-service, requires login) ─────────────────────
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    const userId = req.user!.userId

    // Master accounts come from .env — their password lives in MASTER_*_PASSWORD_HASH,
    // not in the DB, so it cannot be changed here.
    if (userId.startsWith('master_')) {
      return res.status(403).json({
        success: false,
        message: 'บัญชี MASTER จัดการรหัสผ่านผ่านไฟล์ .env เท่านั้น ไม่สามารถเปลี่ยนที่นี่ได้',
      })
    }

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'กรุณากรอกรหัสผ่านปัจจุบันและรหัสผ่านใหม่' })
    }
    if (!isStrongEnough(newPassword)) {
      return res.status(400).json({ success: false, message: `รหัสผ่านใหม่ต้องมีอย่างน้อย ${MIN_PW_LENGTH} ตัวอักษร` })
    }

    const db = getDb()
    const user = db.prepare('SELECT id, password FROM users WHERE id = ?').get(userId) as any
    if (!user) {
      return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งาน' })
    }

    const ok = await bcrypt.compare(currentPassword, user.password)
    if (!ok) {
      return res.status(401).json({ success: false, message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' })
    }

    const hashed = await bcrypt.hash(newPassword, 12)
    const nowIso = new Date().toISOString()
    db.prepare('UPDATE users SET password = ?, updated_at = ?, password_changed_at = ? WHERE id = ?')
      .run(hashed, nowIso, nowIso, userId)

    // Invalidate any outstanding reset tokens for this user.
    db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0').run(userId)

    res.json({ success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ' })
  } catch (error) {
    console.error('Change password error:', error)
    res.status(500).json({ success: false, message: 'เปลี่ยนรหัสผ่านไม่สำเร็จ' })
  }
})

// ── POST /admin/reset-token ──────────────────────────────────────────────────
// ADMIN/MASTER issues a one-time reset link for a team member (lower privilege,
// same tenant). No email channel exists on this deployment, so the admin hands
// the token to the member out-of-band; the member sets their own new password
// via /reset-password. This keeps the plaintext password out of the admin's hands.
router.post('/admin/reset-token', authenticate, requireRole('ADMIN', 'MASTER'), (req, res) => {
  try {
    const { userId: targetId } = req.body
    if (!targetId) {
      return res.status(400).json({ success: false, message: 'ต้องระบุ userId' })
    }
    if (String(targetId).startsWith('master_')) {
      return res.status(403).json({ success: false, message: 'ไม่สามารถรีเซ็ตบัญชี MASTER ได้' })
    }

    const db = getDb()
    const target = db.prepare('SELECT id, role, tenant_id FROM users WHERE id = ?').get(targetId) as any
    if (!target) {
      return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งาน' })
    }
    // Same-tenant only.
    if (target.tenant_id !== req.user!.tenantId) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์จัดการผู้ใช้นอกบริษัทของคุณ' })
    }
    // Must be strictly lower privilege than the requester.
    const reqRank = ROLE_HIERARCHY[req.user!.role as Role] ?? 0
    const tgtRank = ROLE_HIERARCHY[target.role as Role] ?? 0
    if (tgtRank >= reqRank) {
      return res.status(403).json({ success: false, message: 'รีเซ็ตได้เฉพาะสมาชิกที่มีสิทธิ์ต่ำกว่าคุณ' })
    }

    const token   = crypto.randomBytes(32).toString('hex')
    const now     = new Date()
    const expires = new Date(now.getTime() + RESET_TTL_MS)

    // One live token per user: burn previous unused ones.
    db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0').run(target.id)
    db.prepare(`
      INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used, created_at, created_by)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(crypto.randomBytes(12).toString('hex'), target.id, hashToken(token), expires.toISOString(), now.toISOString(), req.user!.userId)

    res.json({
      success: true,
      data: { token, expiresAt: expires.toISOString() },
      message: 'สร้างลิงก์รีเซ็ตสำเร็จ ส่งรหัสนี้ให้สมาชิก (หมดอายุใน 30 นาที)',
    })
  } catch (error) {
    console.error('Reset-token error:', error)
    res.status(500).json({ success: false, message: 'สร้างลิงก์รีเซ็ตไม่สำเร็จ' })
  }
})

// ── POST /reset-password (public — token holder sets a new password) ─────────
router.post('/reset-password', resetLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, message: 'ต้องระบุ token และรหัสผ่านใหม่' })
    }
    if (!isStrongEnough(newPassword)) {
      return res.status(400).json({ success: false, message: `รหัสผ่านใหม่ต้องมีอย่างน้อย ${MIN_PW_LENGTH} ตัวอักษร` })
    }

    const db  = getDb()
    const rec = db.prepare(
      'SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token_hash = ?'
    ).get(hashToken(String(token))) as any

    if (!rec || rec.used || new Date(rec.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: 'ลิงก์รีเซ็ตไม่ถูกต้องหรือหมดอายุแล้ว' })
    }

    const hashed = await bcrypt.hash(newPassword, 12)
    const now    = new Date().toISOString()
    const tx = db.transaction(() => {
      db.prepare('UPDATE users SET password = ?, updated_at = ?, password_changed_at = ? WHERE id = ?').run(hashed, now, now, rec.user_id)
      db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').run(rec.id)
    })
    tx()

    res.json({ success: true, message: 'ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสใหม่' })
  } catch (error) {
    console.error('Reset password error:', error)
    res.status(500).json({ success: false, message: 'ตั้งรหัสผ่านใหม่ไม่สำเร็จ' })
  }
})

export default router
