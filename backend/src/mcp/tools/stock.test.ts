import { describe, it, expect, afterEach } from 'vitest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { registerStockTools } from './stock'
import type { IMcpServer } from '../sdk-compat'

/**
 * เดิม mcp/tools/stock.ts เขียน stock_movements + UPDATE quantity เองทั้งชุด
 * ไม่ผ่าน applyStockMovement เลย ผลคือปรับยอดผ่าน AI แล้ว: ไม่ลง journal
 * ไม่มีแถวในทะเบียนปรับสต็อก และไม่เจอประตูอนุมัติ — ของขยับอยู่ฝ่ายเดียว
 * แถมยังรับ type=IN/OUT ได้ ซึ่งเป็นประตูหลังของปุ่มที่ถูกลบไปจากหน้าเว็บแล้ว
 */
function fakeServer(): { server: IMcpServer; tools: Record<string, (args: any) => Promise<any>> } {
  const tools: Record<string, (args: any) => Promise<any>> = {}
  const server: IMcpServer = {
    tool: (name: string, _desc: string, _schema: any, handler: any) => { tools[name] = handler },
    connect: async () => {},
    close: async () => {},
  }
  return { server, tools }
}

const parseOk = (res: any) => JSON.parse(res.content[0].text)

const tenants: string[] = []
function setupTenant() {
  const t = 'test_mcp_stock_' + generateId()
  tenants.push(t)
  db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock) VALUES (?, ?, 0)').run(t, 'test')
  return t
}

function seedItem(tenantId: string, qty: number, unitCost: number) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, 'ของทดสอบ MCP', 'raw', ?, 'ชิ้น', 'ชิ้น', ?, 'STOCK', 'ACTIVE')
  `).run(id, tenantId, 'SKU-' + id.slice(0, 8), qty, unitCost)
  return id
}

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM journal_lines WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM journal_entries WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_adjustments WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_movements WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM approval_requests WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM approval_settings WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM document_sequences WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM company_settings WHERE tenant_id = ?').run(t)
  }
})

describe('MCP record_stock_movement', () => {
  it('IN / OUT ถูกปิด — ตอบกลับว่าให้ไปทำผ่านเอกสารจริง และของต้องไม่ขยับ', async () => {
    const t = setupTenant()
    const { server, tools } = fakeServer()
    registerStockTools(server, t, 'u1', 'tester', 'ADMIN')
    const itemId = seedItem(t, 100, 10)

    for (const type of ['IN', 'OUT']) {
      const res = parseOk(await tools['record_stock_movement']({ stock_item_id: itemId, type, quantity: 5 }))
      expect(res.success).toBe(false)
      expect(res.message).toContain('ปรับยอดสต็อก')
    }
    const after = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(itemId) as any
    expect(after.quantity).toBe(100)
  })

  it('ADJUST ต้องลง journal + เข้าทะเบียน เหมือนที่หน้าเว็บทำ', async () => {
    const t = setupTenant()
    const { server, tools } = fakeServer()
    registerStockTools(server, t, 'u1', 'tester', 'ADMIN')
    const itemId = seedItem(t, 100, 10)   // ปรับเหลือ 90 = ส่วนต่าง ฿100

    const res = parseOk(await tools['record_stock_movement']({
      stock_item_id: itemId, type: 'ADJUST', quantity: 90, adjust_reason: 'ของเสีย/หมดอายุ',
    }))
    expect(res.success).toBe(true)

    const item = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(itemId) as any
    expect(item.quantity).toBe(90)

    const reg = db.prepare('SELECT * FROM stock_adjustments WHERE stock_item_id = ?').get(itemId) as any
    expect(reg).toBeTruthy()
    expect(reg.reason).toBe('ของเสีย/หมดอายุ')
    expect(reg.total_value).toBeCloseTo(100, 2)

    const je = db.prepare("SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = 'STOCK_ADJUST'").get(t) as any
    expect(je).toBeTruthy()
    expect(je.is_posted).toBe(1)
    expect(je.total_debit).toBeCloseTo(100, 2)
    expect(je.total_debit).toBeCloseTo(je.total_credit, 2)
  })

  it('USER ที่ปรับเกินวงเงิน ต้องกลายเป็นคำขออนุมัติ ของยังไม่ขยับ', async () => {
    const t = setupTenant()
    db.prepare(`INSERT INTO approval_settings (id, tenant_id, module_type, role, approval_required, auto_approve_threshold, created_at, updated_at)
      VALUES (?, ?, 'stock_adjust', 'USER', 1, 500, datetime('now'), datetime('now'))`).run(generateId(), t)
    const { server, tools } = fakeServer()
    registerStockTools(server, t, 'u2', 'ลูกน้อง', 'USER')
    const itemId = seedItem(t, 100, 20)   // ปรับเหลือ 0 = ฿2,000 เกิน ฿500

    const res = parseOk(await tools['record_stock_movement']({
      stock_item_id: itemId, type: 'ADJUST', quantity: 0, adjust_reason: 'ของหาย',
    }))
    expect(res.pending_approval).toBe(true)

    const item = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(itemId) as any
    expect(item.quantity).toBe(100)
    expect(db.prepare('SELECT COUNT(*) c FROM stock_adjustments WHERE tenant_id = ?').get(t)).toEqual({ c: 0 })
  })
})
