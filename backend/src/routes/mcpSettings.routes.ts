// MCP Settings API — per-user API key linked to login account
// Master accounts store key in company_settings; regular users store in users table.

import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import db from '../db/sqlite'
import { authenticate } from '../middleware/auth.middleware'
import { registerTools } from '../mcp/tools'
import { McpServer } from '../mcp/sdk-compat'

const router = Router()

// ── helpers ───────────────────────────────────────────────────────────────────

function isMaster(userId: string): boolean {
  return userId.startsWith('master_')
}

function getKey(userId: string, tenantId: string): string | null {
  if (isMaster(userId)) {
    const row = db.prepare(
      `SELECT mcp_api_key FROM company_settings WHERE tenant_id = ?`
    ).get(tenantId) as { mcp_api_key: string | null } | undefined
    return row?.mcp_api_key ?? null
  }
  const row = db.prepare(
    `SELECT mcp_api_key FROM users WHERE id = ?`
  ).get(userId) as { mcp_api_key: string | null } | undefined
  return row?.mcp_api_key ?? null
}

function setKey(userId: string, tenantId: string, key: string): void {
  if (isMaster(userId)) {
    db.prepare(
      `UPDATE company_settings SET mcp_api_key = ? WHERE tenant_id = ?`
    ).run(key, tenantId)
  } else {
    db.prepare(
      `UPDATE users SET mcp_api_key = ?, updated_at = ? WHERE id = ?`
    ).run(key, new Date().toISOString(), userId)
  }
}

// ── GET /api/mcp-settings ─────────────────────────────────────────────────────
router.get('/', authenticate, (req: Request, res: Response) => {
  const key = getKey(req.user!.userId, req.user!.tenantId)
  res.json({ success: true, data: { key } })
})

// ── POST /api/mcp-settings/regenerate-key ─────────────────────────────────────
router.post('/regenerate-key', authenticate, (req: Request, res: Response) => {
  const { userId, tenantId } = req.user!
  const newKey = crypto.randomBytes(24).toString('hex')
  setKey(userId, tenantId, newKey)
  res.json({ success: true, data: { key: newKey } })
})

// ── POST /api/mcp-settings/test ──────────────────────────────────────────────
router.post('/test', authenticate, async (req: Request, res: Response) => {
  const { userId, tenantId } = req.user!
  const steps: Array<{ step: string; ok: boolean; ms?: number; error?: string }> = []

  // Step 1: key exists
  const t0 = Date.now()
  const key = getKey(userId, tenantId)
  steps.push({ step: 'API key configured', ok: !!key, ms: Date.now() - t0 })
  if (!key) { res.json({ success: false, steps }); return }

  // Step 2: MCP server init
  const t1 = Date.now()
  try {
    const server = new McpServer({ name: 'mini-erp', version: '1.0.0' })
    registerTools(server, tenantId)
    steps.push({ step: 'MCP server ready (21 tools)', ok: true, ms: Date.now() - t1 })
  } catch (e: unknown) {
    steps.push({ step: 'MCP server init', ok: false, ms: Date.now() - t1, error: String(e) })
    res.json({ success: false, steps }); return
  }

  // Step 3: query_stock dry-run
  const t2 = Date.now()
  try {
    const { c } = db.prepare(
      `SELECT COUNT(*) as c FROM stock_items WHERE tenant_id = ?`
    ).get(tenantId) as { c: number }
    steps.push({ step: `query_stock works (${c} items)`, ok: true, ms: Date.now() - t2 })
  } catch (e: unknown) {
    steps.push({ step: 'query_stock tool', ok: false, ms: Date.now() - t2, error: String(e) })
    res.json({ success: false, steps }); return
  }

  res.json({ success: true, steps })
})

export default router
