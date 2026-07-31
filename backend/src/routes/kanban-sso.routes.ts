// Phopy Kanban (Planka) SSO handoff — issues a short-lived signed token that lets
// the currently authenticated ERP user land on their OWN Planka account instead
// of whatever stale session happens to be in the browser.
import { Router, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'

const router = Router()

const KANBAN_SSO_SECRET = process.env.KANBAN_SSO_SECRET
if (!KANBAN_SSO_SECRET) {
  throw new Error('FATAL: KANBAN_SSO_SECRET environment variable is not set. Set it before starting the server.')
}

const KANBAN_URL = process.env.KANBAN_URL || 'https://kanban.phopy.net'
const SSO_TOKEN_TTL_SECONDS = 60

router.use(authenticate)

// company_settings.name is often empty for tenants created before that field was
// backfilled — fall back to the MASTER_<PREFIX>_NAME env label (same convention
// used by master.routes.ts getAllTenants()), and finally to the raw tenantId.
function resolveTenantName(tenantId: string): string {
  const row = db.prepare('SELECT name FROM company_settings WHERE tenant_id = ?').get(tenantId) as
    | { name: string | null }
    | undefined
  if (row?.name) return row.name

  for (const key of Object.keys(process.env)) {
    const m = key.match(/^MASTER_(.+)_TENANT_ID$/)
    if (m && process.env[key] === tenantId) {
      return process.env[`MASTER_${m[1]}_NAME`] || tenantId
    }
  }

  return tenantId
}

// ── POST /api/kanban/sso — mint a one-time SSO token for Phopy Kanban ────────
router.post('/sso', (req: Request, res: Response): void => {
  const { userId, email, tenantId, role } = req.user!

  const userRow = db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as
    | { name: string }
    | undefined
  const name = userRow?.name || email

  const jti = crypto.randomUUID()
  const token = jwt.sign(
    {
      erpUserId: userId,
      tenantId,
      email,
      name,
      erpRole: role,
      tenantName: resolveTenantName(tenantId),
      jti,
      purpose: 'kanban-sso',
    },
    KANBAN_SSO_SECRET,
    { algorithm: 'HS256', expiresIn: SSO_TOKEN_TTL_SECONDS }
  )

  const url = `${KANBAN_URL}/erp-sso?token=${encodeURIComponent(token)}`
  res.json({ success: true, data: { url, tenantName: resolveTenantName(tenantId) } })
})

export default router
