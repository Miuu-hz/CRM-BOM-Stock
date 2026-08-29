// Shared tenant provisioning — creates an ERP tenant (company_settings + free
// subscription + ADMIN user). Used by BOTH the Master panel (POST /master/tenants)
// and the self-service signup-approval flow (POST /master/signup-requests/:id/approve).
//
// It does NOT touch Phopy Kanban: the Master path passes the plaintext password to
// provisionKanban() to sync the same password; the signup-approval path has only a
// bcrypt hash (user set their own password at signup, plaintext is gone), so the
// Planka account is created just-in-time (SSO-only) on the user's first Kanban click.

import { randomBytes } from 'crypto'
import { getDb } from '../db/sqlite'

// คืนค่าว่างได้ถ้าชื่อไม่เหลือตัวอักษร ASCII เลย (เช่นชื่อไทยล้วน) — ผู้เรียกตัดสินเองว่าจะใช้อะไรแทน
export function slugify(text: string): string {
  return text.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 20)
}

// Carries an HTTP status so route handlers can map it to a response.
export class ProvisionError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ProvisionError'
  }
}

export interface ProvisionInput {
  businessName: string
  adminEmail: string
  adminName: string
  adminPasswordHash: string // already bcrypt-hashed
  customTenantId?: string
}

export interface ProvisionResult {
  tenantId: string
  userId: string
}

// Idempotency is NOT assumed — callers must guard against double-approval.
// Throws ProvisionError(409) on tenantId / email collision.
export function provisionTenant(input: ProvisionInput): ProvisionResult {
  const db = getDb()
  // ชื่อไทยล้วน slugify ได้ค่าว่าง → ข้ามส่วนชื่อไปเลย ไม่งั้นได้ `tenant_tenant_xxx`
  const slug = slugify(input.businessName)
  const tenantId =
    input.customTenantId?.trim() || `tenant_${slug ? slug + '_' : ''}${Date.now().toString(36)}`

  const tExists = db.prepare('SELECT 1 FROM company_settings WHERE tenant_id = ?').get(tenantId)
  if (tExists) throw new ProvisionError(409, `Tenant ID "${tenantId}" มีอยู่แล้ว`)

  const eExists = db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(input.adminEmail)
  if (eExists) throw new ProvisionError(409, `Email "${input.adminEmail}" ถูกใช้งานแล้ว`)

  const userId = randomBytes(12).toString('hex')
  const now = new Date().toISOString()

  // mcp_user_limit = NULL → follows the plan's max_users (Free = 1) until MASTER overrides.
  db.prepare('INSERT INTO company_settings (tenant_id, name, mcp_user_limit) VALUES (?, ?, NULL)').run(
    tenantId,
    input.businessName,
  )
  // New tenants start on the Free plan (no expiry) — MASTER upgrades later.
  db.prepare(
    `INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, current_period_start)
     VALUES (?, ?, 'free', 'FREE', ?)`,
  ).run(randomBytes(8).toString('hex'), tenantId, now)
  db.prepare(
    `INSERT INTO users (id, email, password, name, role, tenant_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'ADMIN', ?, 'active', ?, ?)`,
  ).run(userId, input.adminEmail, input.adminPasswordHash, input.adminName, tenantId, now, now)

  return { tenantId, userId }
}
