import { describe, it, expect } from 'vitest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { registerSearchTool } from './search'
import { createTestUser } from '../../test/testAuth'
import type { IMcpServer } from '../sdk-compat'

/**
 * Bug #3: mcp search low_stock เดิมเทียบ si.quantity <= si.min_stock ตรงๆ ไม่นับของที่ยังปิดห่อ
 * อยู่ (sealed_qty × pack factor) เลย ทำให้ของที่แพ็คเต็มวางอยู่บนชั้นถูกฟ้องว่าใกล้หมด — ตอนนี้ใช้
 * availableQuantity() ตัวเดียวกับ /stock/stats (stockValue.service.ts) กรองซ้ำในชั้น JS
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

function parseOk(res: any): any {
  return JSON.parse(res.content[0].text)
}

function seedPackedItem(tenantId: string, opts: { quantity: number; sealedQty: number; minStock: number; packFactor: number }) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, sealed_qty, unit, base_unit, display_unit, location, status, unit_cost, min_stock)
    VALUES (?, ?, ?, 'สินค้าแพ็คทดสอบ', 'RAW', ?, ?, 'ชิ้น', 'ชิ้น', 'แพ็ค', 'WH1', 'ACTIVE', 10, ?)
  `).run(id, tenantId, id, opts.quantity, opts.sealedQty, opts.minStock)
  db.prepare(`
    INSERT INTO unit_conversions (id, tenant_id, material_id, from_unit, to_unit, conversion_factor)
    VALUES (?, ?, ?, 'pack', 'pcs', ?)
  `).run(generateId(), tenantId, id, opts.packFactor)
  return id
}

describe('MCP search low_stock — ต้องนับ sealed_qty × pack factor ด้วย (Bug #3)', () => {
  it('quantity 0 แต่ sealed 2 แพ็ค×12 (=24) เกิน min 10 → ไม่ถือว่าใกล้หมด', async () => {
    const { tenantId } = createTestUser({ role: 'ADMIN' })
    seedPackedItem(tenantId, { quantity: 0, sealedQty: 2, minStock: 10, packFactor: 12 })

    const { server, tools } = fakeServer()
    registerSearchTool(server, tenantId)
    const res = parseOk(await tools.search({ query: '', category: 'stock', low_stock: true }))

    expect(res.results.stock.count).toBe(0)
  })

  it('quantity 0 ไม่มี sealed เลย ต่ำกว่า min 10 จริง → ยังขึ้นใกล้หมดเหมือนเดิม', async () => {
    const { tenantId } = createTestUser({ role: 'ADMIN' })
    const id = seedPackedItem(tenantId, { quantity: 0, sealedQty: 0, minStock: 10, packFactor: 12 })

    const { server, tools } = fakeServer()
    registerSearchTool(server, tenantId)
    const res = parseOk(await tools.search({ query: '', category: 'stock', low_stock: true }))

    expect(res.results.stock.count).toBe(1)
    expect(res.results.stock.items[0].sku).toBe(id)
    expect(res.results.stock.items[0].sealed_qty).toBe(0)
  })
})
