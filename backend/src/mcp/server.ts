// MCP Server — Streamable HTTP transport (Google AI Edge Gallery compatible)
// POST /mcp/sse  — initialize session or send tool calls
// GET  /mcp/sse  — SSE notification stream for an existing session

import { randomUUID } from 'crypto'
import { Request, Response, Router } from 'express'
import db from '../db/sqlite'
import { McpServer, SSEServerTransport, StreamableHTTPServerTransport, ISSETransport, IStreamableHTTPTransport } from './sdk-compat'
import { registerTools } from './tools'
import { getSubscription } from '../services/subscription.service'

// ── Auth helpers ──────────────────────────────────────────────────────────────

interface TenantContext { tenantId: string; userId: string }

function resolveTenant(key: string): TenantContext | null {
  // Regular user key
  const userRow = db.prepare(
    `SELECT id, tenant_id FROM users WHERE mcp_api_key = ? AND status = 'active' LIMIT 1`
  ).get(key) as { id: string; tenant_id: string } | undefined
  if (userRow) {
    // Quota check: effective MCP limit = override (company_settings.mcp_user_limit)
    // ถ้าไม่ตั้ง override (NULL) → ยึด max_users ของแพ็กเกจ · limit = null คือไม่จำกัด
    const cs = db.prepare(
      `SELECT mcp_user_limit FROM company_settings WHERE tenant_id = ?`
    ).get(userRow.tenant_id) as { mcp_user_limit: number | null } | undefined
    const override = cs ? cs.mcp_user_limit : null
    const limit = override != null ? override : getSubscription(userRow.tenant_id).maxUsers
    if (limit != null) {
      const used = (db.prepare(
        `SELECT COUNT(*) as c FROM users WHERE tenant_id = ? AND mcp_api_key IS NOT NULL AND mcp_api_key != ''`
      ).get(userRow.tenant_id) as any)?.c ?? 0
      if (used > limit) return null  // over quota — reject
    }
    return { tenantId: userRow.tenant_id, userId: userRow.id }
  }

  // Master account key (stored in company_settings)
  const csRow = db.prepare(
    `SELECT tenant_id FROM company_settings WHERE mcp_api_key = ? LIMIT 1`
  ).get(key) as { tenant_id: string } | undefined
  return csRow ? { tenantId: csRow.tenant_id, userId: 'master' } : null
}

function extractKey(req: Request): string | null {
  const fromQuery = req.query.key as string | undefined
  if (fromQuery) return fromQuery
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  return null
}

// ── Session registries ────────────────────────────────────────────────────────

// ponytail: idle TTL 2 ชม. — session id ที่หลุดออกไปจะใช้ได้ไม่เกิน 2 ชม. หลังใช้ครั้งสุดท้าย
// ถ้าต้องการ revoke ทันทีเมื่อลบคีย์ ค่อยเปลี่ยนเป็น resolveTenant() ทุก request (ต้องให้ client ส่ง key มาด้วยทุกครั้ง)
const SESSION_TTL_MS = 2 * 60 * 60 * 1000

interface StreamableSession { transport: IStreamableHTTPTransport; tenantId: string; expiresAt: number }
const streamableSessions = new Map<string, StreamableSession>()
const sseSessions = new Map<string, ISSETransport>()  // legacy SSE (transport ตายพร้อม HTTP response จึงไม่ต้องมี TTL)

// คืน session ที่ยังไม่หมดอายุ พร้อมต่ออายุ และกวาดตัวที่หมดอายุทิ้ง
function touchSession(sessionId: string): StreamableSession | null {
  const now = Date.now()
  for (const [id, s] of streamableSessions) {
    if (s.expiresAt <= now) streamableSessions.delete(id)
  }
  const session = streamableSessions.get(sessionId)
  if (!session) return null
  session.expiresAt = now + SESSION_TTL_MS
  return session
}

// ถ้า client ส่ง key มาพร้อม session id ต้องเป็น tenant เดียวกัน (กัน session ถูกใช้ข้ามบริษัท)
function keyMatchesSession(req: Request, session: StreamableSession): boolean {
  const key = extractKey(req)
  if (!key) return true
  const ctx = resolveTenant(key)
  return ctx != null && ctx.tenantId === session.tenantId
}

// ── MCP server factory ────────────────────────────────────────────────────────

function buildServer(tenantId: string, userId: string) {
  const server = new McpServer({ name: 'mini-erp', version: '1.0.0' })
  registerTools(server, tenantId, userId)
  return server
}

// ── Route setup ───────────────────────────────────────────────────────────────

export function setupMcpRoutes(app: Router): void {
  // Health / capability check
  app.get('/mcp/test', (req: Request, res: Response) => {
    const key = extractKey(req)
    if (!key) { res.status(401).json({ ok: false, error: 'Missing API key' }); return }
    const ctx = resolveTenant(key)
    if (!ctx) { res.status(401).json({ ok: false, error: 'Invalid API key' }); return }
    res.json({ ok: true, tools: 21, server: 'mini-erp', tenantId: ctx.tenantId })
  })

  // ── POST /mcp/sse — Streamable HTTP (Gallery sends this) ─────────────────────
  app.post('/mcp/sse', async (req: Request, res: Response) => {
    const existingSessionId = req.headers['mcp-session-id'] as string | undefined

    if (existingSessionId) {
      // Tool call on existing session
      const session = touchSession(existingSessionId)
      if (!session) { res.status(404).json({ error: 'Session not found or expired' }); return }
      if (!keyMatchesSession(req, session)) { res.status(401).json({ error: 'Invalid API key' }); return }
      await session.transport.handleRequest(req, res, req.body)
      return
    }

    // New session — authenticate with ?key= or Authorization header
    const key = extractKey(req)
    if (!key) { res.status(401).json({ error: 'Missing API key' }); return }
    const ctx = resolveTenant(key)
    if (!ctx) { res.status(401).json({ error: 'Invalid API key' }); return }

    const sessionId = randomUUID()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId })
    streamableSessions.set(sessionId, { transport, tenantId: ctx.tenantId, expiresAt: Date.now() + SESSION_TTL_MS })
    transport.onclose = () => streamableSessions.delete(sessionId)

    const server = buildServer(ctx.tenantId, ctx.userId)
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  })

  // ── GET /mcp/sse — SSE notifications for existing Streamable HTTP session ────
  // (Also handles legacy SSE clients that open a new stream with ?key=)
  app.get('/mcp/sse', async (req: Request, res: Response) => {
    const existingSessionId = req.headers['mcp-session-id'] as string | undefined

    if (existingSessionId) {
      // SSE notification stream for an established Streamable HTTP session
      const session = touchSession(existingSessionId)
      if (!session) { res.status(404).json({ error: 'Session not found or expired' }); return }
      if (!keyMatchesSession(req, session)) { res.status(401).json({ error: 'Invalid API key' }); return }
      await session.transport.handleRequest(req, res)
      return
    }

    // Legacy SSE new connection (no session yet) — keep for backward compat
    const key = extractKey(req)
    if (!key) { res.status(401).json({ error: 'Missing API key' }); return }
    const ctx = resolveTenant(key)
    if (!ctx) { res.status(401).json({ error: 'Invalid API key' }); return }

    const transport = new SSEServerTransport('/mcp/messages', res)
    const server = buildServer(ctx.tenantId, ctx.userId)
    sseSessions.set(transport.sessionId, transport)
    transport.onclose = () => sseSessions.delete(transport.sessionId)
    await server.connect(transport)
  })

  // ── POST /mcp/messages — legacy SSE message endpoint ─────────────────────────
  app.post('/mcp/messages', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string | undefined
    if (!sessionId) { res.status(400).json({ error: 'Missing sessionId' }); return }
    const transport = sseSessions.get(sessionId)
    if (!transport) { res.status(404).json({ error: 'Session not found' }); return }
    await transport.handlePostMessage(req, res, req.body)
  })
}
