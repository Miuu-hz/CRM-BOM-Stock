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
  if (fromQuery) return fromQuery.trim()
  const auth = req.headers.authorization
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i)
    if (match) return match[1].trim()
    return auth.trim()
  }
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


function normalizeAcceptHeader(req: Request): void {
  req.headers['accept'] = 'application/json, text/event-stream'
  if (req.rawHeaders) {
    let found = false
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      if (req.rawHeaders[i].toLowerCase() === 'accept') {
        req.rawHeaders[i + 1] = 'application/json, text/event-stream'
        found = true
      }
    }
    if (!found) {
      req.rawHeaders.push('Accept', 'application/json, text/event-stream')
    }
  }
}

export function setupMcpRoutes(app: Router): void {

  // Universal CORS & Preflight for MCP
  app.use(['/mcp', '/mcp/*'], (req: Request, res: Response, next) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, mcp-session-id, mcp-protocol-version',
      'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version'
    })
    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }
    next()
  })

  // HEAD probe (instant 200 for URL reachability tests)
  app.head(['/mcp/sse', '/mcp'], (req: Request, res: Response) => {
    res.status(200).set({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, mcp-session-id, mcp-protocol-version'
    }).end()
  })

  // Health / capability check
  app.get('/mcp/test', (req: Request, res: Response) => {
    const key = extractKey(req)
    if (!key) { res.status(401).json({ ok: false, error: 'Missing API key' }); return }
    const ctx = resolveTenant(key)
    if (!ctx) { res.status(401).json({ ok: false, error: 'Invalid API key' }); return }
    res.json({ ok: true, tools: 23, server: 'mini-erp', tenantId: ctx.tenantId })
  })

  // ── POST /mcp & /mcp/sse — Streamable HTTP ──────────────────────────────────
  app.post(['/mcp/sse', '/mcp'], async (req: Request, res: Response) => {
    normalizeAcceptHeader(req)
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
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId, enableJsonResponse: true })
    streamableSessions.set(sessionId, { transport, tenantId: ctx.tenantId, expiresAt: Date.now() + SESSION_TTL_MS })
    transport.onclose = () => streamableSessions.delete(sessionId)

    const server = buildServer(ctx.tenantId, ctx.userId)
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  })

  // ── GET /mcp & /mcp/sse ─────────────────────────────────────────────────────
  // 1. If existing mcp-session-id: SSE notification stream for Streamable HTTP
  // 2. If Accept: text/event-stream: legacy SSE connection
  // 3. Otherwise (Accept: application/json, */*): instant HTTP 200 JSON probe
  app.get(['/mcp/sse', '/mcp'], async (req: Request, res: Response) => {
    const existingSessionId = req.headers['mcp-session-id'] as string | undefined

    if (existingSessionId) {
      const session = touchSession(existingSessionId)
      if (!session) { res.status(404).json({ error: 'Session not found or expired' }); return }
      if (!keyMatchesSession(req, session)) { res.status(401).json({ error: 'Invalid API key' }); return }
      await session.transport.handleRequest(req, res)
      return
    }

    const isSse = req.headers['accept']?.includes('text/event-stream')

    if (!isSse) {
      // Non-SSE GET probe (e.g. Gemini URL verification, health checks, crawlers)
      const key = extractKey(req)
      if (key) {
        const ctx = resolveTenant(key)
        if (!ctx) { res.status(401).json({ error: 'Invalid API key' }); return }
        res.status(200).json({
          ok: true,
          server: 'mini-erp',
          protocolVersion: '2024-11-05',
          transport: 'streamable-http',
          status: 'ready',
          tenantId: ctx.tenantId,
          tools: 23
        })
        return
      }
      // Reachability probe without key
      res.status(200).json({
        ok: true,
        server: 'mini-erp',
        protocolVersion: '2024-11-05',
        transport: 'streamable-http',
        status: 'ready'
      })
      return
    }

    // Legacy SSE connection (explicitly requested text/event-stream)
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
