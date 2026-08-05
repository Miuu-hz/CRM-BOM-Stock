// MCP Settings API — per-user API key + admin-gated team access.
//
// Access model (confirmed with owner):
//   - Master account stores its key in company_settings; regular users in users.mcp_api_key.
//   - Regular users CANNOT self-enable MCP. An ADMIN (or MASTER) grants access per user,
//     bounded by the tenant's MCP quota = company_settings.mcp_user_limit (override) ?? the
//     subscription plan's max_users. A granted user may then rotate their own key.
//   - MASTER's own key does NOT count against the quota (kept in company_settings, not users).

import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import db from '../db/sqlite'
import { authenticate } from '../middleware/auth.middleware'
import { registerTools } from '../mcp/tools'
import { McpServer } from '../mcp/sdk-compat'
import { getSubscription } from '../services/subscription.service'

const router = Router()

const APP_URL = process.env.APP_URL || 'https://erp.phopy.net'
const MCP_ENDPOINT = `${APP_URL}/mcp/sse`

// ── helpers ───────────────────────────────────────────────────────────────────

function isMasterId(userId: string): boolean {
  return userId.startsWith('master_')
}
function canManage(role?: string): boolean {
  return role === 'ADMIN' || role === 'MASTER'
}

function getKey(userId: string, tenantId: string): string | null {
  if (isMasterId(userId)) {
    const row = db.prepare(`SELECT mcp_api_key FROM company_settings WHERE tenant_id = ?`).get(tenantId) as { mcp_api_key: string | null } | undefined
    return row?.mcp_api_key ?? null
  }
  const row = db.prepare(`SELECT mcp_api_key FROM users WHERE id = ?`).get(userId) as { mcp_api_key: string | null } | undefined
  return row?.mcp_api_key ?? null
}

function setKeyForMaster(tenantId: string, key: string | null): void {
  db.prepare(`UPDATE company_settings SET mcp_api_key = ? WHERE tenant_id = ?`).run(key, tenantId)
}
function setKeyForUser(userId: string, key: string | null): void {
  db.prepare(`UPDATE users SET mcp_api_key = ?, updated_at = ? WHERE id = ?`).run(key, new Date().toISOString(), userId)
}

// effective MCP-user limit for a tenant: override ?? plan max_users (null = unlimited)
function effectiveLimit(tenantId: string): number | null {
  const cs = db.prepare(`SELECT mcp_user_limit FROM company_settings WHERE tenant_id = ?`).get(tenantId) as { mcp_user_limit: number | null } | undefined
  const override = cs ? cs.mcp_user_limit : null
  return override != null ? override : getSubscription(tenantId).maxUsers
}
function usedCount(tenantId: string): number {
  return (db.prepare(`SELECT COUNT(*) as c FROM users WHERE tenant_id = ? AND mcp_api_key IS NOT NULL AND mcp_api_key != ''`).get(tenantId) as any).c
}
function newKey(): string {
  return crypto.randomBytes(24).toString('hex')
}

// ── GET /api/mcp-settings ── own key + connection info + quota ────────────────
router.get('/', authenticate, (req: Request, res: Response) => {
  const { userId, tenantId, role } = req.user!
  const key = getKey(userId, tenantId)
  const limit = effectiveLimit(tenantId)
  res.json({
    success: true,
    data: {
      key,
      endpointUrl: MCP_ENDPOINT,
      role,
      canManage: canManage(role),
      hasKey: !!key,
      quota: { used: usedCount(tenantId), limit },
    },
  })
})

// ── POST /api/mcp-settings/regenerate-key ── self key (admin self-serve; users rotate only)
router.post('/regenerate-key', authenticate, (req: Request, res: Response): void => {
  const { userId, tenantId, role } = req.user!
  const existing = getKey(userId, tenantId)

  // Regular users cannot mint their first key — an admin must grant it.
  if (!canManage(role) && !existing) {
    res.status(403).json({ success: false, message: 'ยังไม่ได้รับสิทธิ์ใช้งาน MCP กรุณาให้แอดมินเปิดสิทธิ์ให้ก่อน' })
    return
  }

  // Creating a brand-new key for a countable (non-master) user consumes quota.
  if (!existing && !isMasterId(userId)) {
    const limit = effectiveLimit(tenantId)
    if (limit != null && usedCount(tenantId) >= limit) {
      res.status(403).json({ success: false, message: 'เกินโควตาผู้ใช้ MCP ของแพ็กเกจ' })
      return
    }
  }

  const key = newKey()
  if (isMasterId(userId)) setKeyForMaster(tenantId, key)
  else setKeyForUser(userId, key)
  res.json({ success: true, data: { key } })
})

// ── GET /api/mcp-settings/team ── (ADMIN/MASTER) users in tenant + who has MCP ──
router.get('/team', authenticate, (req: Request, res: Response): void => {
  const { tenantId, role } = req.user!
  if (!canManage(role)) { res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์จัดการ' }); return }
  const users = db.prepare(
    `SELECT id, name, email, role,
            CASE WHEN mcp_api_key IS NOT NULL AND mcp_api_key != '' THEN 1 ELSE 0 END AS hasKey
     FROM users WHERE tenant_id = ? AND status = 'active'
     ORDER BY (role = 'ADMIN') DESC, name`,
  ).all(tenantId)
  res.json({ success: true, data: { users, quota: { used: usedCount(tenantId), limit: effectiveLimit(tenantId) } } })
})

// ── POST /api/mcp-settings/team/:userId/grant ── (ADMIN/MASTER) enable a user ──
router.post('/team/:userId/grant', authenticate, (req: Request, res: Response): void => {
  const { tenantId, role } = req.user!
  if (!canManage(role)) { res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์จัดการ' }); return }
  const target = db.prepare(`SELECT id, tenant_id, mcp_api_key FROM users WHERE id = ?`).get(req.params.userId) as
    | { id: string; tenant_id: string; mcp_api_key: string | null } | undefined
  if (!target || target.tenant_id !== tenantId) { res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้ในบริษัทนี้' }); return }

  if (target.mcp_api_key) { res.json({ success: true, data: { key: target.mcp_api_key, alreadyGranted: true } }); return }

  const limit = effectiveLimit(tenantId)
  if (limit != null && usedCount(tenantId) >= limit) {
    res.status(403).json({ success: false, message: `เปิดสิทธิ์เกินโควตา (${limit} ผู้ใช้) กรุณาให้ Master เพิ่มโควตา/อัปเกรดแพ็กเกจ` })
    return
  }
  const key = newKey()
  setKeyForUser(target.id, key)
  res.json({ success: true, data: { key } })
})

// ── POST /api/mcp-settings/team/:userId/revoke ── (ADMIN/MASTER) disable a user ─
router.post('/team/:userId/revoke', authenticate, (req: Request, res: Response): void => {
  const { tenantId, role } = req.user!
  if (!canManage(role)) { res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์จัดการ' }); return }
  const target = db.prepare(`SELECT id, tenant_id FROM users WHERE id = ?`).get(req.params.userId) as
    | { id: string; tenant_id: string } | undefined
  if (!target || target.tenant_id !== tenantId) { res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้ในบริษัทนี้' }); return }
  setKeyForUser(target.id, null)
  res.json({ success: true })
})

// ── POST /api/mcp-settings/test ── verify the caller's MCP works ───────────────
router.post('/test', authenticate, async (req: Request, res: Response) => {
  const { userId, tenantId } = req.user!
  const steps: Array<{ step: string; ok: boolean; ms?: number; error?: string }> = []

  const t0 = Date.now()
  const key = getKey(userId, tenantId)
  steps.push({ step: 'API key configured', ok: !!key, ms: Date.now() - t0 })
  if (!key) { res.json({ success: false, steps }); return }

  const t1 = Date.now()
  try {
    const server = new McpServer({ name: 'mini-erp', version: '1.0.0' })
    registerTools(server, tenantId)
    steps.push({ step: 'MCP server ready', ok: true, ms: Date.now() - t1 })
  } catch (e: unknown) {
    steps.push({ step: 'MCP server init', ok: false, ms: Date.now() - t1, error: String(e) })
    res.json({ success: false, steps }); return
  }

  const t2 = Date.now()
  try {
    const { c } = db.prepare(`SELECT COUNT(*) as c FROM stock_items WHERE tenant_id = ?`).get(tenantId) as { c: number }
    steps.push({ step: `query_stock works (${c} items)`, ok: true, ms: Date.now() - t2 })
  } catch (e: unknown) {
    steps.push({ step: 'query_stock tool', ok: false, ms: Date.now() - t2, error: String(e) })
    res.json({ success: false, steps }); return
  }

  res.json({ success: true, steps })
})

export default router
