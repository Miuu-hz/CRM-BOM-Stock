import { describe, it, expect, afterEach } from 'vitest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { registerSalesTools } from './sales'
import type { IMcpServer } from '../sdk-compat'

/**
 * ปลอม IMcpServer แบบขั้นต่ำ — เก็บ handler ของแต่ละ tool ไว้เรียกตรงๆ ในเทสต์
 * โดยไม่ต้องพึ่ง MCP SDK server/transport จริง (registerSalesTools ต้องการแค่ .tool())
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
  const t = 'test_mcp_so_' + generateId()
  tenants.push(t)
  db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock) VALUES (?, ?, 0)').run(t, 'test')
  return t
}

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM stock_movements WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM approval_requests WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM sales_order_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM sales_orders WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM customers WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM document_sequences WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM company_settings WHERE tenant_id = ?').run(t)
  }
})

/**
 * เดิม mcp/tools/sales.ts มีสำเนา deductStockForSO ของตัวเอง ที่หย่อนกว่าของจริงใน
 * routes/sales/shared.ts: เงียบเมื่อแปลงหน่วยไม่ได้ (ใช้เลขดิบข้ามหน่วย), floor() ปัดเศษหาย,
 * MAX(0, ...) เงียบตอนของไม่พอ, ไม่ atomic. ตอนนี้เรียกตัวจริงแล้ว — เทสต์นี้ยืนยันว่า
 * แปลงหน่วยถูกต้องตามอัตราแปลงจริง ไม่ใช่ลอกเลขดิบข้ามหน่วย
 */
describe('MCP update_sales_order_status → ใช้ deductStockForSO ตัวจริง', () => {
  it('หน่วยขาย (kg) ต่างจากหน่วยสต็อก (g) → ตัดสต็อกตามอัตราแปลง 1000 ไม่ใช่เลขดิบ', async () => {
    const t = setupTenant()
    const { server, tools } = fakeServer()
    registerSalesTools(server, t, 'u1', 'tester', 'ADMIN')

    // สต็อกเก็บเป็นกรัม (base_unit=g) แต่ unit เดิม (legacy) เป็น kg — เคสกุ้งจากคอมเมนต์จริงในโค้ด
    const stockId = generateId()
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
                VALUES (?, ?, ?, 'กุ้งเทสต์', 'FINISHED', 5000, 'kg', 'g', 'MAIN', 'ACTIVE')`).run(stockId, t, stockId)

    const created = parseOk(await tools['create_sales_order']({
      items: [{ description: 'กุ้งเทสต์', quantity: 5, unitPrice: 100 }],
    }))
    expect(created.items[0].matched).toBe(true)
    expect(created.items[0].unit).toBe('kg')

    const confirmed = parseOk(await tools['update_sales_order_status']({ so_id: created.soId, status: 'CONFIRMED' }))
    expect(confirmed.success, confirmed.message).toBe(true)

    // ขาย 5 kg = 5000 g จากสต็อก 5000 g เหลือ 0 (ถ้าเป็นสำเนาเดิมที่ไม่แปลงหน่วยเลยจะเหลือ 4995 g)
    const stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockId) as any
    expect(stock.quantity).toBe(0)

    const movement = db.prepare(`SELECT quantity FROM stock_movements WHERE stock_item_id = ? AND type = 'OUT'`).get(stockId) as any
    expect(movement.quantity, 'ต้องบันทึกจำนวนที่ตัดจริงเป็นกรัม (5000) ไม่ใช่เลขดิบ (5)').toBe(5000)
  })

  it('แปลงหน่วยไม่ได้ (ไม่มีอัตราแปลง) → ยืนยันไม่สำเร็จ, สถานะย้อนกลับ DRAFT, ไม่แตะสต็อก', async () => {
    const t = setupTenant()
    const { server, tools } = fakeServer()
    registerSalesTools(server, t, 'u1', 'tester', 'ADMIN')

    // หน่วยประดิษฐ์ที่ไม่มีทางแปลงหากันได้เลย (ไม่ใช่ standard, ไม่มี tenant rule)
    const stockId = generateId()
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
                VALUES (?, ?, ?, 'ของทดสอบแปลงหน่วยไม่ได้', 'FINISHED', 100, 'xstockunit', 'xstockunit', 'MAIN', 'ACTIVE')`).run(stockId, t, stockId)

    const created = parseOk(await tools['create_sales_order']({
      items: [{ description: 'ของทดสอบแปลงหน่วยไม่ได้', quantity: 5, unit: 'xsounit', unitPrice: 100 }],
    }))

    const confirmed = parseOk(await tools['update_sales_order_status']({ so_id: created.soId, status: 'CONFIRMED' }))
    expect(confirmed.success, 'ต้อง fail แบบอ่านรู้เรื่อง ไม่ใช่ 500 เปล่าๆ หรือเงียบแล้วตัดเลขดิบ').toBe(false)
    expect(confirmed.message).toMatch(/ยืนยันไม่สำเร็จ/)

    const so = db.prepare('SELECT status FROM sales_orders WHERE id = ?').get(created.soId) as any
    expect(so.status, 'ตัดสต็อกไม่สำเร็จต้องย้อนสถานะกลับ DRAFT ไม่ค้าง CONFIRMED เฉยๆ').toBe('DRAFT')

    const stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockId) as any
    expect(stock.quantity, 'ต้องไม่ถูกแตะเลยเมื่อแปลงหน่วยไม่ได้').toBe(100)

    const movements = db.prepare(`SELECT COUNT(*) c FROM stock_movements WHERE stock_item_id = ?`).get(stockId) as any
    expect(movements.c).toBe(0)
  })
})
