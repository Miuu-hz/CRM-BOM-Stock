import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { createTestUser } from '../test/testAuth'
import mcpSettingsRouter from './mcpSettings.routes'
import { registerTools } from '../mcp/tools'

/**
 * โหมด audit (mcp_scope='readonly') — AI ตรวจบริษัทได้แต่แก้อะไรไม่ได้
 * บังคับที่ registerTools() ชั้นเดียว เทสต์นี้วิ่งผ่าน registerTools ตรง ๆ (ไม่ผ่าน HTTP/MCP SDK)
 * ครอบคลุมทั้ง countTools()/mcp/test ที่เรียก registerTools ซ้ำอยู่แล้ว
 */
const app = express()
app.use(express.json())
app.use('/api/mcp-settings', mcpSettingsRouter)

const READ_ONLY_ALLOWLIST = new Set([
  'search', 'get_summary', 'get_sales', 'get_orders',
  'get_ar_aging', 'get_ap_aging', 'get_financial_summary', 'get_trial_balance', 'get_ledger',
  'get_stock_movements', 'explode_bom',
  'get_purchase_requests', 'get_suppliers', 'get_sales_orders',
  'list_marketing_shops', 'get_customer_insights', 'get_quotations',
  'check_unit_issues', 'get_lead_source_performance',
])

// ตัวแทน write tool ที่ชื่อขึ้นต้นด้วย create_/update_/confirm_/pay_ ฯลฯ — ต้องไม่หลุดมาในโหมด readonly
const WRITE_TOOL_SAMPLE = [
  'create_purchase_request', 'create_draft_po', 'approve_purchase_request', 'convert_pr_to_po',
  'update_purchase_request', 'update_purchase_order', 'confirm_goods_receipt', 'reject_purchase_request',
  'update_po_status', 'create_goods_receipt', 'attach_document_evidence', 'create_purchase_invoice',
  'edit_purchase_invoice', 'pay_supplier', 'complete_purchase_bill', 'create_quotation',
  'set_product_image', 'record_stock_movement', 'manage_unit_conversion', 'create_work_order',
  'update_work_order_status', 'create_bom', 'bind_document_item', 'import_marketing_csv',
]

function collectToolNames(tenantId: string, userId: string): string[] {
  const names: string[] = []
  registerTools(
    { tool: (name: string) => { names.push(name) }, connect: async () => {}, close: async () => {} },
    tenantId,
    userId,
  )
  return names
}

describe('MCP audit mode — mcp_scope readonly', () => {
  it('readonly user: เห็นแค่ allowlist ไม่มี write tool เลย', () => {
    const user = createTestUser({ role: 'USER' })
    db.prepare(`UPDATE users SET mcp_scope = 'readonly' WHERE id = ?`).run(user.userId)

    const names = collectToolNames(user.tenantId, user.userId)
    expect(names.length).toBeGreaterThan(0)
    for (const n of names) {
      expect(READ_ONLY_ALLOWLIST.has(n), `${n} หลุดมาในโหมด readonly ทั้งที่ไม่อยู่ใน allowlist`).toBe(true)
    }
    for (const w of WRITE_TOOL_SAMPLE) expect(names).not.toContain(w)
  })

  it('full (ค่าเริ่มต้น ไม่ตั้ง mcp_scope): ยังได้ write tool ตามปกติ', () => {
    const user = createTestUser({ role: 'USER' })
    const names = collectToolNames(user.tenantId, user.userId)
    expect(names).toContain('create_purchase_request')
    expect(names).toContain('record_stock_movement')
  })

  it('master key (userId literal "master"): เต็มสิทธิ์เสมอ ไม่โดน readonly แม้จะไม่มีแถวใน users', () => {
    const user = createTestUser({ role: 'USER' }) // ใช้ tenantId เดียวกันเฉย ๆ
    const names = collectToolNames(user.tenantId, 'master')
    expect(names).toContain('create_purchase_request')
  })

  it('POST /team/:userId/scope — ปฏิเสธผู้ใช้ข้าม tenant (404)', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const otherTenantUser = createTestUser({ role: 'USER' }) // tenant ของตัวเอง ไม่ใช่ของ admin
    const res = await request(app)
      .post(`/api/mcp-settings/team/${otherTenantUser.userId}/scope`)
      .set('Authorization', 'Bearer ' + admin.token)
      .send({ scope: 'readonly' })
    expect(res.status).toBe(404)
  })

  it('POST /team/:userId/scope — ปฏิเสธผู้เรียกที่ไม่ใช่ ADMIN/MASTER (403)', async () => {
    const plainUser = createTestUser({ role: 'USER' })
    const target = createTestUser({ role: 'USER', tenantId: plainUser.tenantId })
    const res = await request(app)
      .post(`/api/mcp-settings/team/${target.userId}/scope`)
      .set('Authorization', 'Bearer ' + plainUser.token)
      .send({ scope: 'readonly' })
    expect(res.status).toBe(403)
  })

  it('POST /team/:userId/scope — admin เปลี่ยน scope ผู้ใช้ tenant เดียวกันได้จริง', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const target = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const res = await request(app)
      .post(`/api/mcp-settings/team/${target.userId}/scope`)
      .set('Authorization', 'Bearer ' + admin.token)
      .send({ scope: 'readonly' })
    expect(res.status).toBe(200)
    const row = db.prepare('SELECT mcp_scope FROM users WHERE id = ?').get(target.userId) as any
    expect(row.mcp_scope).toBe('readonly')
  })

  it('POST /team/:userId/scope — scope ไม่ใช่ readonly/full ต้องโดนปฏิเสธ (400)', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const target = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const res = await request(app)
      .post(`/api/mcp-settings/team/${target.userId}/scope`)
      .set('Authorization', 'Bearer ' + admin.token)
      .send({ scope: 'superuser' })
    expect(res.status).toBe(400)
  })
})
