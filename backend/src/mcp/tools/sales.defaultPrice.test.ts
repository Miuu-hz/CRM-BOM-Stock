import { describe, it, expect, afterEach } from 'vitest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { registerSalesTools } from './sales'
import type { IMcpServer } from '../sdk-compat'

/**
 * ปลอม IMcpServer แบบขั้นต่ำ — เก็บ handler ของแต่ละ tool ไว้เรียกตรงๆ ในเทสต์
 * (รูปแบบเดียวกับ sales.test.ts ที่มีอยู่แล้ว)
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

const tenants: string[] = []
function setupTenant() {
  const t = 'test_mcp_price_' + generateId()
  tenants.push(t)
  db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock) VALUES (?, ?, 0)').run(t, 'test')
  return t
}

function seedStockItem(tenantId: string, name: string, baseUnit: string, unitPrice: number, category = 'FINISHED') {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, sale_unit, location, status, unit_price)
    VALUES (?, ?, ?, ?, ?, 100, ?, ?, ?, 'MAIN', 'ACTIVE', ?)
  `).run(id, tenantId, id, name, category, baseUnit, baseUnit, baseUnit, unitPrice)
  return id
}

function addPackRule(tenantId: string, materialId: string, factor: number) {
  db.prepare(`
    INSERT INTO unit_conversions (id, tenant_id, material_id, from_unit, to_unit, conversion_factor, created_at, updated_at)
    VALUES (?, ?, ?, 'pack', 'pcs', ?, datetime('now'), datetime('now'))
  `).run(generateId(), tenantId, materialId, factor)
}

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM quotation_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM quotations WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM unit_conversions WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM document_sequences WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM company_settings WHERE tenant_id = ?').run(t)
  }
})

/**
 * ITEM 5 (ตรวจ 2026-10-05): create_quotation เติม unitPrice เริ่มต้นจาก stock_items.unit_price
 * (เก็บต่อหน่วยฐานเสมอ) คูณตัวแปลงหน่วย เมื่อ AI ไม่ได้ระบุ unitPrice มาเอง — ไม่มีกฎแปลง หรือ
 * บรรทัด free text ที่ไม่ผูกสินค้า ต้องตอบ error ไม่ใช่เดา factor 1 แบบเงียบๆ
 */
describe('create_quotation เติมราคาเริ่มต้นจาก stock_items.unit_price เมื่อไม่ระบุ unitPrice', () => {
  it('ไม่ระบุ unitPrice, หน่วยขาย pack = 6 ชิ้น, unit_price ฐาน 29 → ราคาต่อแพ็คที่บันทึก 174', async () => {
    const t = setupTenant()
    const stockId = seedStockItem(t, 'สินค้าแพ็ค', 'pcs', 29)
    addPackRule(t, stockId, 6)
    const { server, tools } = fakeServer()
    registerSalesTools(server, t, 'user_x', 'ทดสอบ', 'ADMIN')

    const res = parseOk(await tools['create_quotation']({
      items: [{ description: 'สินค้าแพ็ค', quantity: 2, unit: 'pack' }],
    }))

    expect(res.success).toBe(true)
    const qt = db.prepare('SELECT id FROM quotations WHERE quotation_number = ? AND tenant_id = ?').get(res.เลขที่ใบเสนอราคา, t) as any
    const item = db.prepare('SELECT unit_price FROM quotation_items WHERE quotation_id = ?').get(qt.id) as any
    expect(item.unit_price).toBe(174)
  })

  it('ผูกสินค้าได้แต่ไม่มีกฎแปลงหน่วย (kg → pcs ไม่มีกฎ ไม่มีมาตรฐานสากล) → tool ตอบ error UNIT_PRICE_REQUIRED', async () => {
    const t = setupTenant()
    seedStockItem(t, 'สินค้าไม่มีกฎ', 'pcs', 29)
    const { server, tools } = fakeServer()
    registerSalesTools(server, t, 'user_x', 'ทดสอบ', 'ADMIN')

    const res = parseOk(await tools['create_quotation']({
      items: [{ description: 'สินค้าไม่มีกฎ', quantity: 1, unit: 'kg' }],
    }))

    expect(res.success).toBe(false)
    expect(res.code).toBe('UNIT_PRICE_REQUIRED')
  })

  it('บรรทัด free text (ไม่ผูกสินค้าใดเลย) ไม่ระบุ unitPrice → tool ตอบ error UNIT_PRICE_REQUIRED', async () => {
    const t = setupTenant()
    const { server, tools } = fakeServer()
    registerSalesTools(server, t, 'user_x', 'ทดสอบ', 'ADMIN')

    const res = parseOk(await tools['create_quotation']({
      items: [{ description: 'ค่าแรงติดตั้ง (ไม่มีในสต็อก)', quantity: 1 }],
    }))

    expect(res.success).toBe(false)
    expect(res.code).toBe('UNIT_PRICE_REQUIRED')
  })
})
