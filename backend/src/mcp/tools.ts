// MCP tool handlers — DB-Anchored Token Intersection search
// Re-exported as a single `registerTools` aggregator.
//
// Core idea: use the database itself as a Thai vocabulary.
// "เนื้อหมูสับ" → substrings → filter those that exist in DB → greedy non-overlap tokens
// → AND search (fallback OR) → precise results without a Thai NLP library.

import db from '../db/sqlite'
import { IMcpServer } from './sdk-compat'
import { registerSearchTool } from './tools/search'
import { registerSummaryTools } from './tools/summary'
import { registerPurchaseTools } from './tools/purchase'
import { registerSalesTools } from './tools/sales'
import { registerStockTools } from './tools/stock'
import { registerProductionTools } from './tools/production'
import { registerBomTools } from './tools/bom'
import { registerFinanceTools } from './tools/finance'

export function registerTools(server: IMcpServer, tenantId: string, userId = 'mcp-agent'): void {
  // Resolve display name + role for audit trail and approval-permission checks
  const callerRow = db.prepare(`SELECT name, email, role FROM users WHERE id = ? LIMIT 1`).get(userId) as any
  const callerName: string = callerRow?.name ?? callerRow?.email ?? userId
  // Master API key has no row in `users` (resolved separately in mcp/server.ts) — treat as MASTER role
  const callerRole: string = userId === 'master' ? 'MASTER' : (callerRow?.role ?? 'USER')

  registerSearchTool(server, tenantId)
  registerSummaryTools(server, tenantId)
  registerPurchaseTools(server, tenantId, userId, callerName, callerRole)
  registerSalesTools(server, tenantId, userId, callerName, callerRole)
  registerStockTools(server, tenantId, userId)
  registerProductionTools(server, tenantId, userId)
  registerBomTools(server, tenantId)
  registerFinanceTools(server, tenantId)
}

export default registerTools
