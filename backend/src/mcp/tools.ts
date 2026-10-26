// MCP tool handlers — DB-Anchored Token Intersection search
// Re-exported as a single `registerTools` aggregator.
//
// Core idea: use the database itself as a Thai vocabulary.
// "เนื้อหมูสับ" → substrings → filter those that exist in DB → greedy non-overlap tokens
// → AND search (fallback OR) → precise results without a Thai NLP library.

import db from '../db/sqlite'
import { IMcpServer } from './sdk-compat'
import { registerSearchTool } from './tools/search'
import { registerGuideTool } from './tools/guide'
import { registerSummaryTools } from './tools/summary'
import { registerPurchaseTools } from './tools/purchase'
import { registerSalesTools } from './tools/sales'
import { registerStockTools } from './tools/stock'
import { registerProductionTools } from './tools/production'
import { registerBomTools } from './tools/bom'
import { registerFinanceTools } from './tools/finance'
import { registerCrmTools } from './tools/crm'
import { registerMarketingTools } from './tools/marketing'
import { registerPlatformMonthTools } from './tools/platformMonth'
import { registerBindingTools } from './tools/binding'
import { registerPurchaseBillingTools } from './tools/purchaseBilling'
import { registerSalesBillingTools } from './tools/salesBilling'
import { loadPermUser, isBasicUser } from '../services/rbac.service'
import { isCashierOnly } from '../middleware/cashierScope'

// โหมดอ่านอย่างเดียว (audit) — ผู้ใช้ mcp_scope='readonly' เห็นแค่ tool ใน allowlist นี้
// allowlist (ไม่ใช่ denylist) เพื่อให้ tool เขียนข้อมูลตัวใหม่ในอนาคตถูกบล็อกโดยปริยาย
// ต้องเช็คโค้ด handler จริงแล้วว่าไม่มี INSERT/UPDATE/DELETE ก่อนเพิ่มชื่อเข้ามาที่นี่
const READ_ONLY_TOOLS = new Set([
  'search', 'get_erp_guide', 'get_summary', 'get_sales', 'get_orders',
  'get_ar_aging', 'get_ap_aging', 'get_financial_summary', 'get_trial_balance', 'get_ledger',
  'get_stock_movements', 'explode_bom',
  'get_purchase_requests', 'get_suppliers', 'get_sales_orders',
  'list_marketing_shops', 'get_customer_insights', 'get_quotations', 'platform_month_status',
  'check_unit_issues', 'get_lead_source_performance',
])

export function registerTools(server: IMcpServer, tenantId: string, userId = 'mcp-agent'): void {
  // Resolve display name + role for audit trail and approval-permission checks
  const callerRow = db.prepare(`SELECT name, email, role, mcp_scope FROM users WHERE id = ? LIMIT 1`).get(userId) as any
  const callerName: string = callerRow?.name ?? callerRow?.email ?? userId
  // Master API key has no row in `users` (resolved separately in mcp/server.ts) — treat as MASTER role
  const callerRole: string = userId === 'master' ? 'MASTER' : (callerRow?.role ?? 'USER')

  // ขอบเขตเดียวกับ REST: แคชเชียร์ (cashierScope) ใช้ได้แค่ POS ซึ่ง MCP ไม่มี → ไม่เห็น tool ใดเลย
  // ผู้ใช้พื้นฐาน (D2) ไม่เห็นงานบัญชี/รายงาน/ลูกหนี้-เจ้าหนี้ (finance, platform settlement)
  const perm = loadPermUser(userId, callerRole)
  if (isCashierOnly(perm.role, perm.departments)) return
  const basic = isBasicUser(perm)

  // Master key สิทธิ์เต็มเสมอ — ผู้ใช้ปกติดูที่ mcp_scope ('full' ถ้าไม่ตั้ง)
  const readonly = userId !== 'master' && callerRow?.mcp_scope === 'readonly'
  // ponytail: ห่อ server.tool() ชั้นเดียวตรงนี้ — ทุก transport (SSE/streamable/countTools/test) เรียก registerTools()
  // อยู่แล้วจึงได้ผลทันทีไม่ต้องแก้ที่อื่น · session ที่ connect ไปแล้วก่อนเปลี่ยน scope ยังใช้สิทธิ์เดิมจน TTL หมด (2 ชม., ดู mcp/server.ts)
  const target: IMcpServer = readonly
    ? {
        tool: (name, description, inputSchema, handler) => {
          if (READ_ONLY_TOOLS.has(name)) server.tool(name, description, inputSchema, handler)
        },
        connect: (transport) => server.connect(transport),
        close: () => server.close(),
      }
    : server

  registerSearchTool(target, tenantId)
  registerGuideTool(target, tenantId)
  registerSummaryTools(target, tenantId)
  registerPurchaseTools(target, tenantId, userId, callerName, callerRole)
  registerSalesTools(target, tenantId, userId, callerName, callerRole)
  registerStockTools(target, tenantId, userId, callerName, callerRole)
  registerProductionTools(target, tenantId, userId, callerRole)
  registerBomTools(target, tenantId)
  if (!basic) registerFinanceTools(target, tenantId, callerRole)
  registerCrmTools(target, tenantId)
  registerMarketingTools(target, tenantId)
  if (!basic) registerPlatformMonthTools(target, tenantId, userId)
  registerBindingTools(target, tenantId)
  registerPurchaseBillingTools(target, tenantId, userId, callerName, callerRole)
  registerSalesBillingTools(target, tenantId, userId, callerName, callerRole)
}

export default registerTools
