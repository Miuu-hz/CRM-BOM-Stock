import { Router } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { getDb } from '../db/sqlite'
import { getLimits } from '../services/subscription.service'
import { syncKanbanPassword } from '../services/kanban-password-sync'
import { authenticate, requireRole } from '../middleware/auth.middleware'

const router = Router()
router.use(authenticate)
router.use(requireRole('ADMIN', 'MASTER'))

// ASCII-only — mirrors auth.routes.ts EMAIL_REGEX. Rejects stray non-Latin
// characters (e.g. a leftover Thai IME vowel mark) that look invisible in the
// UI but break exact-match email lookups at login.
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/

// Roles assignable via the API. MASTER is intentionally excluded:
// master accounts exist only in .env and can never be minted through HTTP.
const ASSIGNABLE_ROLES = ['ADMIN', 'MANAGER', 'POWERUSER', 'USER']

// GET /api/users
router.get('/', (req, res) => {
  const db = getDb()
  const users = db.prepare(
    `SELECT id, email, name, role, departments, custom_permissions, status, created_at
     FROM users WHERE tenant_id = ? ORDER BY created_at DESC`
  ).all(req.user!.tenantId) as any[]

  const data = users.map(u => ({
    ...u,
    departments: u.departments ? JSON.parse(u.departments) : [],
    custom_permissions: u.custom_permissions ? JSON.parse(u.custom_permissions) : null,
  }))

  res.json({ success: true, data })
})

// POST /api/users
router.post('/', async (req, res) => {
  const { password, name, role, departments, custom_permissions } = req.body
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : req.body?.email

  if (!email || !password || !name || !role) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบ' })
  }
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ success: false, message: 'รูปแบบอีเมลไม่ถูกต้อง (ใช้ตัวอักษรภาษาอังกฤษเท่านั้น)' })
  }

  // MASTER can never be created via API — only from .env master accounts.
  // ADMIN/MASTER callers may only assign roles at or below ADMIN.
  if (!ASSIGNABLE_ROLES.includes(role)) {
    return res.status(403).json({ success: false, message: 'ไม่สามารถกำหนด role นี้ได้ (สร้าง MASTER ผ่าน API ไม่ได้)' })
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ success: false, message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' })
  }

  const db = getDb()
  if (db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email)) {
    return res.status(409).json({ success: false, message: 'อีเมลนี้ถูกใช้งานแล้ว' })
  }

  // Subscription: จำกัดจำนวน users ตามแพ็กเกจ (MASTER bypass)
  if (req.user!.role !== 'MASTER') {
    const { maxUsers } = getLimits(req.user!.tenantId)
    if (maxUsers !== null) {
      const count = (db.prepare('SELECT COUNT(*) as c FROM users WHERE tenant_id = ?').get(req.user!.tenantId) as any).c
      if (count >= maxUsers) {
        return res.status(403).json({
          success: false,
          code: 'USER_LIMIT',
          message: `แพ็กเกจนี้ใช้งานได้สูงสุด ${maxUsers} ผู้ใช้ กรุณาอัปเกรดแพ็กเกจ`,
        })
      }
    }
  }

  const hashed = await bcrypt.hash(password, 12)
  const id = crypto.randomBytes(12).toString('hex')

  db.prepare(
    `INSERT INTO users (id, email, password, name, role, departments, custom_permissions, tenant_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).run(
    id, email, hashed, name, role,
    JSON.stringify(departments ?? []),
    custom_permissions ? JSON.stringify(custom_permissions) : null,
    req.user!.tenantId
  )

  res.status(201).json({ success: true, data: { id, email, name, role } })
})

// PUT /api/users/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params
  const { name, role, departments, custom_permissions, password } = req.body

  const db = getDb()
  const existing = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(id, req.user!.tenantId) as any
  if (!existing) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' })

  // Only a MASTER may modify a MASTER account.
  if (existing.role === 'MASTER' && req.user!.role !== 'MASTER') {
    return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์แก้ไขบัญชี MASTER' })
  }

  // Nobody may promote a user to MASTER via API (master lives only in .env).
  if (role === 'MASTER') {
    return res.status(403).json({ success: false, message: 'ไม่สามารถกำหนด role เป็น MASTER ผ่าน API ได้' })
  }
  if (role && !ASSIGNABLE_ROLES.includes(role)) {
    return res.status(400).json({ success: false, message: 'role ไม่ถูกต้อง' })
  }

  if (id === req.user!.userId && role && role !== existing.role) {
    return res.status(403).json({ success: false, message: 'ไม่สามารถเปลี่ยน role ของตัวเองได้' })
  }

  const fields: Record<string, any> = {
    name: name ?? existing.name,
    role: role ?? existing.role,
    departments: JSON.stringify(departments ?? (existing.departments ? JSON.parse(existing.departments) : [])),
    custom_permissions: custom_permissions !== undefined
      ? (Object.keys(custom_permissions).length > 0 ? JSON.stringify(custom_permissions) : null)
      : existing.custom_permissions,
    updated_at: new Date().toISOString(),
  }

  if (password) {
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ success: false, message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' })
    }
    fields.password = await bcrypt.hash(password, 12)
    fields.password_changed_at = new Date().toISOString()
  }

  const setClauses = Object.keys(fields).map(k => `${k} = ?`).join(', ')
  db.prepare(`UPDATE users SET ${setClauses} WHERE id = ?`).run(...Object.values(fields), id)

  // If the password was changed, sync it to the linked Phopy Board account.
  if (password) {
    await syncKanbanPassword(id, password)
  }

  res.json({ success: true, message: 'อัปเดตสำเร็จ' })
})


// PATCH /api/users/:id/permissions
router.patch('/:id/permissions', async (req, res) => {
  const { id } = req.params
  const { departments, customPermissions } = req.body

  const db = getDb()
  const existing = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(id, req.user!.tenantId) as any
  if (!existing) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' })

  if (id === req.user!.userId) {
    return res.status(403).json({ success: false, message: 'ไม่สามารถแก้ไขสิทธิ์ของตัวเองได้' })
  }

  const fields: Record<string, any> = { updated_at: new Date().toISOString() }

  if (departments !== undefined) {
    fields.departments = JSON.stringify(departments)
  }
  if (customPermissions !== undefined) {
    fields.custom_permissions = Object.keys(customPermissions).length > 0
      ? JSON.stringify(customPermissions)
      : null
  }

  const setClauses = Object.keys(fields).map(k => `${k} = ?`).join(', ')
  db.prepare(`UPDATE users SET ${setClauses} WHERE id = ?`).run(...Object.values(fields), id)

  const updated = db.prepare(
    'SELECT id, email, name, role, departments, custom_permissions, status FROM users WHERE id = ?'
  ).get(id) as any

  res.json({
    success: true,
    message: 'อัปเดตสิทธิ์สำเร็จ',
    data: {
      ...updated,
      departments: updated.departments ? JSON.parse(updated.departments) : [],
      custom_permissions: updated.custom_permissions ? JSON.parse(updated.custom_permissions) : {},
    }
  })
})

// DELETE /api/users/:id
router.delete('/:id', (req, res) => {
  const { id } = req.params

  if (id === req.user!.userId) {
    return res.status(403).json({ success: false, message: 'ไม่สามารถลบบัญชีต��วเองได้' })
  }

  const db = getDb()
  const existing = db.prepare('SELECT id FROM users WHERE id = ? AND tenant_id = ?').get(id, req.user!.tenantId)
  if (!existing) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' })

  db.prepare('DELETE FROM users WHERE id = ?').run(id)
  res.json({ success: true, message: 'ลบผู้ใช้สำเร็จ' })
})

export default router
