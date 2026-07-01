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
import { registerStockTools } from './tools/stock'
import { registerProductionTools } from './tools/production'
import { registerBomTools } from './tools/bom'
import { registerFinanceTools } from './tools/finance'

export function registerTools(server: IMcpServer, tenantId: string, userId = 'mcp-agent'): void {
  // Resolve display name for audit trail — lookup from users table, fallback to userId
  const callerRow = db.prepare(`SELECT name, email FROM users WHERE id = ? LIMIT 1`).get(userId) as any
  const callerName: string = callerRow?.name ?? callerRow?.email ?? userId

  registerSearchTool(server, tenantId)
  registerSummaryTools(server, tenantId)
  registerPurchaseTools(server, tenantId, userId, callerName)
  registerStockTools(server, tenantId, userId)
  registerProductionTools(server, tenantId, userId)
  registerBomTools(server, tenantId)
  registerFinanceTools(server, tenantId)
}

export default registerTools
