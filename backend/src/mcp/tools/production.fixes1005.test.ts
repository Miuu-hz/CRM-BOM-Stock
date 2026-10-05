import { describe, it, expect, afterEach } from 'vitest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { registerProductionTools } from './production'
import type { IMcpServer } from '../sdk-compat'

/**
 * เทสต์ใหม่สำหรับ fix ชุด 2026-10-05 ของ Work Order ฝั่ง MCP (mcp/tools/production.ts):
 *   1) ON_HOLD round-trip ไม่เบิกวัตถุดิบซ้ำ
 *   2) role ที่ไม่มีสิทธิ์ (USER) ได้ error ตอน CANCELLED/COMPLETED, ADMIN ทำได้
 *   3) COMPLETED ถูกบล็อกเมื่อ tenant เปิด qc_gate_enabled แล้วยังไม่มี PASS inspection
 *   4) completed_qty / สต็อกสินค้าสำเร็จรูปที่เข้า = min(requested, SUM(passed_qty))
 *   5) create_work_order ปฏิเสธ quantity = 0
 *
 * เรียก registerProductionTools ตรง ๆ ผ่าน fakeServer (ตามแพทเทิร์นใน mcp/tools/stock.test.ts)
 * ไม่ผ่าน mcp/tools.ts dispatcher และไม่ผ่าน zod schema validation ของ MCP SDK จริง
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
function trackTenant(prefix: string) {
  const t = prefix + '_' + generateId()
  tenants.push(t)
  return t
}

function seedMaterialStock(tenantId: string, quantity = 100) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
    VALUES (?, ?, ?, 'วัตถุดิบทดสอบ MCP fixes1005', 'RAW', ?, 'kg', 'kg', 'WH1', 'ACTIVE')
  `).run(id, tenantId, 'MAT-MCP-F1005-' + id.slice(0, 8), quantity)
  return id
}

function seedFinishedStock(tenantId: string, quantity = 0) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
    VALUES (?, ?, ?, 'สินค้าสำเร็จรูป MCP fixes1005', 'FG', ?, 'pcs', 'pcs', 'WH1', 'ACTIVE')
  `).run(id, tenantId, 'FG-MCP-F1005-' + id.slice(0, 8), quantity)
  return id
}

function seedBom(tenantId: string, productId: string) {
  const id = generateId()
  db.prepare(`INSERT INTO boms (id, tenant_id, product_id, version, status) VALUES (?, ?, ?, 'v1', 'ACTIVE')`)
    .run(id, tenantId, productId)
  return id
}

function seedWO(tenantId: string, opts: { bomId?: string | null; status?: string; quantity?: number; completedQty?: number } = {}) {
  const id = generateId()
  db.prepare(`
    INSERT INTO work_orders (id, tenant_id, wo_number, bom_id, product_name, quantity, status, completed_qty)
    VALUES (?, ?, ?, ?, 'สินค้าทดสอบ MCP fixes1005', ?, ?, ?)
  `).run(id, tenantId, 'WO-MCP-F1005-' + id.slice(0, 8), opts.bomId || null, opts.quantity ?? 10, opts.status || 'PLANNED', opts.completedQty ?? 0)
  return id
}

function seedWOMaterial(tenantId: string, woId: string, materialId: string, requiredQty = 20) {
  const id = generateId()
  db.prepare(`
    INSERT INTO work_order_materials (id, tenant_id, work_order_id, material_id, material_name, required_qty, unit, status)
    VALUES (?, ?, ?, ?, 'วัตถุดิบทดสอบ MCP fixes1005', ?, 'kg', 'PENDING')
  `).run(id, tenantId, woId, materialId, requiredQty)
  return id
}

function setQcGate(tenantId: string, enabled: boolean) {
  db.prepare('INSERT INTO company_settings (tenant_id, name, qc_gate_enabled) VALUES (?, ?, ?)')
    .run(tenantId, 'tenant-mcp-f1005', enabled ? 1 : 0)
}

function seedQcInspection(tenantId: string, woId: string, status: 'PASS' | 'FAIL', passedQty: number) {
  db.prepare(`
    INSERT INTO qc_inspections (id, tenant_id, checklist_id, checklist_name, work_order_id, status, passed_qty)
    VALUES (?, ?, 'chk-mcp-f1005', 'Checklist MCP fixes1005', ?, ?, ?)
  `).run(generateId(), tenantId, woId, status, passedQty)
}

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM qc_inspections WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_movements WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM work_order_materials WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM work_orders WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM boms WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM company_settings WHERE tenant_id = ?').run(t)
  }
})

describe('MCP update_work_order_status — fixes1005', () => {
  it('ON_HOLD round-trip ไม่เบิกวัตถุดิบซ้ำ', async () => {
    const t = trackTenant('test_mcp_prod_f1005')
    const { server, tools } = fakeServer()
    registerProductionTools(server, t, 'u1', 'ADMIN')
    const materialId = seedMaterialStock(t, 100)
    const woId = seedWO(t, { quantity: 10 })
    seedWOMaterial(t, woId, materialId, 20)

    let res = parseOk(await tools['update_work_order_status']({ wo_id: woId, status: 'IN_PROGRESS' }))
    expect(res.success).toBe(true)
    let stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(materialId) as any
    expect(stock.quantity).toBe(80)

    res = parseOk(await tools['update_work_order_status']({ wo_id: woId, status: 'ON_HOLD' }))
    expect(res.success).toBe(true)

    res = parseOk(await tools['update_work_order_status']({ wo_id: woId, status: 'IN_PROGRESS' }))
    expect(res.success).toBe(true)

    stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(materialId) as any
    expect(stock.quantity).toBe(80) // ไม่หักซ้ำ

    const outCount = db.prepare(
      "SELECT COUNT(*) as c FROM stock_movements WHERE tenant_id = ? AND stock_item_id = ? AND type = 'OUT'"
    ).get(t, materialId) as any
    expect(outCount.c).toBe(1)
  })

  it('USER (ไม่มีสิทธิ์) ถูกปฏิเสธ CANCELLED, สถานะไม่เปลี่ยน', async () => {
    const t = trackTenant('test_mcp_prod_f1005')
    const { server, tools } = fakeServer()
    registerProductionTools(server, t, 'u1', 'USER')
    const woId = seedWO(t, { status: 'PLANNED' })

    const res = parseOk(await tools['update_work_order_status']({ wo_id: woId, status: 'CANCELLED' }))
    expect(res.success).toBe(false)
    expect(res.message).toContain('สิทธิ์')

    const wo = db.prepare('SELECT status FROM work_orders WHERE id = ?').get(woId) as any
    expect(wo.status).toBe('PLANNED')
  })

  it('ADMIN ยกเลิกใบสั่งผลิตได้ปกติ', async () => {
    const t = trackTenant('test_mcp_prod_f1005')
    const { server, tools } = fakeServer()
    registerProductionTools(server, t, 'u1', 'ADMIN')
    const woId = seedWO(t, { status: 'PLANNED' })

    const res = parseOk(await tools['update_work_order_status']({ wo_id: woId, status: 'CANCELLED' }))
    expect(res.success).toBe(true)

    const wo = db.prepare('SELECT status FROM work_orders WHERE id = ?').get(woId) as any
    expect(wo.status).toBe('CANCELLED')
  })

  it('COMPLETED ถูกบล็อกเมื่อ qc_gate_enabled เปิดและยังไม่มี PASS inspection', async () => {
    const t = trackTenant('test_mcp_prod_f1005')
    setQcGate(t, true)
    const { server, tools } = fakeServer()
    registerProductionTools(server, t, 'u1', 'ADMIN')
    const finishedId = seedFinishedStock(t, 0)
    const bomId = seedBom(t, finishedId)
    const woId = seedWO(t, { bomId, quantity: 10, status: 'IN_PROGRESS' })

    let res = parseOk(await tools['update_work_order_status']({ wo_id: woId, status: 'COMPLETED' }))
    expect(res.success).toBe(false)
    expect(res.message).toContain('QC')

    let stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(finishedId) as any
    expect(stock.quantity).toBe(0)

    seedQcInspection(t, woId, 'PASS', 10)
    res = parseOk(await tools['update_work_order_status']({ wo_id: woId, status: 'COMPLETED' }))
    expect(res.success).toBe(true)

    stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(finishedId) as any
    expect(stock.quantity).toBe(10)
  })

  it('completed_qty/สต็อกสินค้าสำเร็จรูป = min(requested, SUM(passed_qty))', async () => {
    const t = trackTenant('test_mcp_prod_f1005')
    const { server, tools } = fakeServer()
    registerProductionTools(server, t, 'u1', 'ADMIN')
    const finishedId = seedFinishedStock(t, 0)
    const bomId = seedBom(t, finishedId)
    const woId = seedWO(t, { bomId, quantity: 10, status: 'IN_PROGRESS' })
    seedQcInspection(t, woId, 'PASS', 4)
    seedQcInspection(t, woId, 'PASS', 3)

    const res = parseOk(await tools['update_work_order_status']({ wo_id: woId, status: 'COMPLETED' }))
    expect(res.success).toBe(true)

    const wo = db.prepare('SELECT completed_qty FROM work_orders WHERE id = ?').get(woId) as any
    expect(wo.completed_qty).toBe(7)

    const stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(finishedId) as any
    expect(stock.quantity).toBe(7)
  })
})

describe('MCP create_work_order — fixes1005', () => {
  it('quantity = 0 → error, ไม่สร้าง work order', async () => {
    const t = trackTenant('test_mcp_prod_f1005')
    const { server, tools } = fakeServer()
    registerProductionTools(server, t, 'u1', 'ADMIN')

    const res = parseOk(await tools['create_work_order']({ product_name: 'ทดสอบ fixes1005', quantity: 0 }))
    expect(res.success).toBe(false)

    const count = db.prepare('SELECT COUNT(*) as c FROM work_orders WHERE tenant_id = ?').get(t) as any
    expect(count.c).toBe(0)
  })
})
