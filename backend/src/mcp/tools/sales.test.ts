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
    expect(created.items[0]['ผูกกับสินค้า']).toBe('กุ้งเทสต์')
    expect(created.items[0]['หน่วย']).toBe('kg')

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

/**
 * ตรวจงานวันนี้ (2026-09-14) ที่แก้ในสายขาย: เลขที่เอกสารเปลี่ยนจาก COUNT(*)+1 → ตัวนับกลาง,
 * RBAC ยกเลิก, คืนสต็อกตอนยกเลิก, ออกใบส่งของอัตโนมัติ
 */
describe('MCP sales — เลขที่เอกสารใช้ตัวนับกลาง (ไม่ใช่ COUNT(*)+1)', () => {
  it('ลบ SO ใบล่าสุดแล้วสร้างใหม่ → เลขไม่ซ้ำ (ตัวนับกลางเดินต่อ ไม่นับจากแถวที่เหลือ)', async () => {
    const t = setupTenant()
    const { server, tools } = fakeServer()
    registerSalesTools(server, t, 'u1', 'tester', 'ADMIN')

    const first = parseOk(await tools['create_sales_order']({
      items: [{ description: 'ของทั่วไป', quantity: 1, unitPrice: 10 }],
    }))
    // ลบ SO ใบแรกทิ้ง (จำลอง "ลบใบเดียว" ในสถานการณ์ COUNT(*)+1 เดิม)
    db.prepare('DELETE FROM sales_order_items WHERE sales_order_id = ?').run(first.soId)
    db.prepare('DELETE FROM sales_orders WHERE id = ?').run(first.soId)

    const second = parseOk(await tools['create_sales_order']({
      items: [{ description: 'ของทั่วไป', quantity: 1, unitPrice: 10 }],
    }))
    expect(second.soNumber, 'ตัวนับกลางต้องเดินต่อจากที่ออกไปแล้ว ไม่ย้อนไปนับแถวที่เหลือ').not.toBe(first.soNumber)
    expect(second.soNumber).toMatch(/^SO-\d{4}-\d{5}$/)
  })

  it('ลูกค้าใหม่ที่ AI สร้างให้ได้รหัส CUS ไม่ซ้ำแม้ลบลูกค้าคนก่อนทิ้ง', async () => {
    const t = setupTenant()
    const { server, tools } = fakeServer()
    registerSalesTools(server, t, 'u1', 'tester', 'ADMIN')

    const so1 = parseOk(await tools['create_sales_order']({
      items: [{ description: 'ของทั่วไป', quantity: 1, unitPrice: 10 }],
      customer_hint: 'ลูกค้าเทสต์เอ',
    }))
    db.prepare('DELETE FROM sales_order_items WHERE sales_order_id = ?').run(so1.soId)
    db.prepare('DELETE FROM sales_orders WHERE id = ?').run(so1.soId)
    db.prepare('DELETE FROM customers WHERE id = ?').run(so1.customer.id)

    const so2 = parseOk(await tools['create_sales_order']({
      items: [{ description: 'ของทั่วไป', quantity: 1, unitPrice: 10 }],
      customer_hint: 'ลูกค้าเทสต์บี',
    }))
    const code = (db.prepare('SELECT code FROM customers WHERE id = ?').get(so2.customer.id) as any).code
    expect(code).not.toBe(null)
    // รหัสเดินต่อจากตัวนับกลาง ไม่ใช่ COUNT(*) ที่ตอนนี้เหลือ 0 แถว (จะวนกลับไปเลข 0001 ซ้ำได้)
    expect(code).toMatch(/^CUS-\d{4}-\d{4}$/)
  })
})

describe('MCP sales — จับคู่สินค้า/ลูกค้าแบบ exact-match ชนะ substring', () => {
  it('มีทั้งชื่อตรงเป๊ะและเมนูที่มีชื่อนั้นเป็นส่วนหนึ่ง → ต้องจับชื่อตรงเป๊ะ ไม่ใช่เมนู', async () => {
    const t = setupTenant()
    const { server, tools } = fakeServer()
    registerSalesTools(server, t, 'u1', 'tester', 'ADMIN')

    const exactId = generateId()
    const menuId = generateId()
    // เมนู (FINISHED) ที่ชื่อมี "ข้าวโพด" ประกอบอยู่ — ถูกสร้างก่อน ชื่อยาวกว่า
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
                VALUES (?, ?, ?, 'สลัดทูน่าข้าวโพด', 'FINISHED', 50, 'pcs', 'pcs', 'MAIN', 'ACTIVE')`).run(menuId, t, menuId)
    // สินค้าที่ชื่อตรงเป๊ะกับที่ลูกค้าสั่ง แต่เป็น RAW (แพ้ category tiebreak แบบเดิม)
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
                VALUES (?, ?, ?, 'ข้าวโพด', 'raw', 200, 'kg', 'kg', 'MAIN', 'ACTIVE')`).run(exactId, t, exactId)

    const created = parseOk(await tools['create_sales_order']({
      items: [{ description: 'ข้าวโพด', quantity: 2, unitPrice: 20 }],
    }))
    const item = db.prepare('SELECT stock_item_id FROM sales_order_items WHERE sales_order_id = ?').get(created.soId) as any
    expect(item.stock_item_id, 'ต้องจับ "ข้าวโพด" ตัวที่ชื่อตรงเป๊ะ ไม่ใช่ "สลัดทูน่าข้าวโพด"').toBe(exactId)
  })
})

describe('MCP update_sales_order_status — RBAC ยกเลิกออเดอร์', () => {
  it('role ธรรมดา (STAFF) ยกเลิก SO ไม่ได้', async () => {
    const t = setupTenant()
    const { server, tools } = fakeServer()
    registerSalesTools(server, t, 'u1', 'staff-user', 'STAFF')

    const created = parseOk(await tools['create_sales_order']({
      items: [{ description: 'ของทั่วไป', quantity: 1, unitPrice: 10 }],
    }))
    const res = parseOk(await tools['update_sales_order_status']({ so_id: created.soId, status: 'CANCELLED' }))
    expect(res.success).toBe(false)
    expect(res.message).toMatch(/ไม่มีสิทธิ์ยกเลิก/)

    const so = db.prepare('SELECT status FROM sales_orders WHERE id = ?').get(created.soId) as any
    expect(so.status).toBe('DRAFT')
  })

  it('ADMIN ยกเลิก SO ที่ยืนยันแล้ว (ตัดสต็อกไปแล้ว) → ต้องคืนสต็อกกลับ', async () => {
    const t = setupTenant()
    const { server, tools } = fakeServer()
    registerSalesTools(server, t, 'u1', 'admin-user', 'ADMIN')

    const stockId = generateId()
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
                VALUES (?, ?, ?, 'ของยกเลิกเทสต์', 'FINISHED', 100, 'pcs', 'pcs', 'MAIN', 'ACTIVE')`).run(stockId, t, stockId)

    const created = parseOk(await tools['create_sales_order']({
      items: [{ description: 'ของยกเลิกเทสต์', quantity: 10, unitPrice: 5 }],
    }))
    const confirmed = parseOk(await tools['update_sales_order_status']({ so_id: created.soId, status: 'CONFIRMED' }))
    expect(confirmed.success, confirmed.message).toBe(true)
    expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockId) as any).quantity).toBe(90)

    const cancelled = parseOk(await tools['update_sales_order_status']({ so_id: created.soId, status: 'CANCELLED' }))
    expect(cancelled.success, cancelled.message).toBe(true)
    expect(cancelled.message).toMatch(/คืนสต็อกแล้ว/)
    expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockId) as any).quantity,
      'ยกเลิก SO ที่ตัดสต็อกไปแล้วต้องคืนสต็อกกลับ 100 — เดิม MCP ไม่คืนเลย').toBe(100)
  })
})

describe('MCP update_sales_order_status — ออกใบส่งของอัตโนมัติเมื่อ DELIVERED/COMPLETED', () => {
  it('ยืนยันแล้วกด DELIVERED → ต้องมีใบส่งของเกิดขึ้น (เดิม MCP ไม่เคยเรียกเลย)', async () => {
    const t = setupTenant()
    const { server, tools } = fakeServer()
    registerSalesTools(server, t, 'u1', 'tester', 'ADMIN')

    const stockId = generateId()
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
                VALUES (?, ?, ?, 'ของส่งเทสต์', 'FINISHED', 50, 'pcs', 'pcs', 'MAIN', 'ACTIVE')`).run(stockId, t, stockId)

    const created = parseOk(await tools['create_sales_order']({
      items: [{ description: 'ของส่งเทสต์', quantity: 3, unitPrice: 5 }],
    }))
    await tools['update_sales_order_status']({ so_id: created.soId, status: 'CONFIRMED' })
    await tools['update_sales_order_status']({ so_id: created.soId, status: 'DELIVERED' })

    const dos = db.prepare('SELECT * FROM delivery_orders WHERE sales_order_id = ?').all(created.soId) as any[]
    expect(dos.length, 'ต้องออกใบส่งของอัตโนมัติเหมือน REST').toBe(1)
    expect(dos[0].do_number).toMatch(/^DO-\d{4}-\d{5}$/)

    // ล้างข้อมูลที่ afterEach เดิมไม่รู้จัก (delivery_orders/_items) ป้องกันตกค้างข้าม test
    db.prepare('DELETE FROM delivery_order_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM delivery_orders WHERE tenant_id = ?').run(t)
  })
})
