// MCP Server — Streamable HTTP transport (Google AI Edge Gallery compatible)
// POST /mcp/sse  — initialize session or send tool calls
// GET  /mcp/sse  — SSE notification stream for an existing session

import { randomUUID } from 'crypto'
import { Request, Response, Router } from 'express'
import db from '../db/sqlite'
import { McpServer, SSEServerTransport, StreamableHTTPServerTransport, ISSETransport, IStreamableHTTPTransport } from './sdk-compat'
import { registerTools } from './tools'

// ── Auth helpers ──────────────────────────────────────────────────────────────

interface TenantContext { tenantId: string; userId: string }

function resolveTenant(key: string): TenantContext | null {
  // Regular user key
  const userRow = db.prepare(
    `SELECT id, tenant_id FROM users WHERE mcp_api_key = ? AND status = 'active' LIMIT 1`
  ).get(key) as { id: string; tenant_id: string } | undefined
  if (userRow) return { tenantId: userRow.tenant_id, userId: userRow.id }

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

const streamableSessions = new Map<string, IStreamableHTTPTransport>()
const sseSessions = new Map<string, ISSETransport>()  // legacy SSE (keep for compatibility)

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
      const transport = streamableSessions.get(existingSessionId)
      if (!transport) { res.status(404).json({ error: 'Session not found' }); return }
      await transport.handleRequest(req, res, req.body)
      return
    }

    // New session — authenticate with ?key= or Authorization header
    const key = extractKey(req)
    if (!key) { res.status(401).json({ error: 'Missing API key' }); return }
    const ctx = resolveTenant(key)
    if (!ctx) { res.status(401).json({ error: 'Invalid API key' }); return }

    const sessionId = randomUUID()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId })
    streamableSessions.set(sessionId, transport)
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
      const transport = streamableSessions.get(existingSessionId)
      if (!transport) { res.status(404).json({ error: 'Session not found' }); return }
      await transport.handleRequest(req, res)
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
