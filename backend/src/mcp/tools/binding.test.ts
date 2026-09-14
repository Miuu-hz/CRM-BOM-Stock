import { describe, it, expect } from 'vitest'
import db from '../../db/sqlite'
import { registerSalesTools } from './sales'
import { registerBindingTools } from './binding'

/**
 * กติกาที่เทสต์นี้ล็อกไว้ (เจ้าของสั่ง 2026-09-14):
 *   AI กรอกเอกสารให้ได้ แต่ผูกสินค้าให้เฉพาะ "ชื่อตรงเป๊ะ"
 *   ไม่ตรงเป๊ะ = ไม่ผูก คืนตัวเลือกให้คนเลือก และ **ยืนยันเอกสารไม่ได้จนกว่าจะผูกครบ**
 * เคสจริงที่เป็นต้นเหตุ: "ข้าวโพด" ไปจับ "สลัดทูน่าข้าวโพด" แล้วตัดสต็อกผิดตัวเงียบ ๆ
 */
function fakeServer() {
  const tools: Record<string, any> = {}
  return {
    server: { tool: (name: string, _d: any, _s: any, handler: any) => { tools[name] = handler } } as any,
    call: (name: string, args: any) => tools[name](args),
  }
}
const parse = (res: any) => JSON.parse(res.content[0].text)

function seedTenant() {
  const t = 'tn' + Math.random().toString(36).slice(2, 10)
  const mk = (name: string, qty: number) => {
    const id = 'si' + Math.random().toString(36).slice(2, 12)
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
      VALUES (?, ?, ?, ?, 'raw', ?, 'g', 'g', 1, 'STOCK', 'ACTIVE')`).run(id, t, 'SKU-' + id.slice(2, 8), name, qty)
    return id
  }
  return { t, exact: mk('ขนมจีน', 1000), similar: mk('ขนมจีนน้ำยาปักษ์ใต้', 50) }
}

describe('AI กรอกให้ แต่ไม่เดาผูกสินค้าแทนคน', () => {
  it('ชื่อตรงเป๊ะ → ผูกให้เลย', async () => {
    const { t, exact } = seedTenant()
    const { server, call } = fakeServer()
    registerSalesTools(server, t, 'u1', 'tester', 'ADMIN')

    const res = parse(await call('create_sales_order', {
      items: [{ description: 'ขนมจีน', quantity: 2, unitPrice: 50 }],
    }))
    expect(res.items[0].ผูกกับสินค้า).toBe('ขนมจีน')
    const row = db.prepare('SELECT stock_item_id FROM sales_order_items WHERE sales_order_id = ?').get(res.soId) as any
    expect(row.stock_item_id).toBe(exact)
  })

  it('ชื่อไม่ตรงเป๊ะ → ไม่ผูก คืนตัวเลือก และยืนยันไม่ได้', async () => {
    const { t } = seedTenant()
    const { server, call } = fakeServer()
    registerSalesTools(server, t, 'u1', 'tester', 'ADMIN')

    const res = parse(await call('create_sales_order', {
      items: [{ description: 'ขนมจีนน้ำยา', quantity: 2, unitPrice: 50 }],
    }))
    expect(res.items[0].ผูกกับสินค้า).toBeNull()
    expect(res.items[0].ตัวเลือก.length).toBeGreaterThan(0)

    const row = db.prepare('SELECT stock_item_id FROM sales_order_items WHERE sales_order_id = ?').get(res.soId) as any
    expect(row.stock_item_id).toBeNull()

    const confirm = parse(await call('update_sales_order_status', { so_id: res.soId, status: 'CONFIRMED' }))
    expect(confirm.success).toBe(false)
    expect(confirm.unboundItems).toContain('ขนมจีนน้ำยา')
    // สถานะต้องไม่ขยับ และสต็อกต้องไม่ถูกแตะ
    const so = db.prepare('SELECT status FROM sales_orders WHERE id = ?').get(res.soId) as any
    expect(so.status).toBe('DRAFT')
  })

  it('ผูกด้วย bind_document_item แล้วยืนยันได้ สต็อกถูกตัดจากตัวที่คนเลือก', async () => {
    const { t, similar } = seedTenant()
    const { server, call } = fakeServer()
    registerSalesTools(server, t, 'u1', 'tester', 'ADMIN')
    registerBindingTools(server, t)

    const res = parse(await call('create_sales_order', {
      items: [{ description: 'ขนมจีนน้ำยา', quantity: 2, unitPrice: 50, unit: 'g' }],
    }))

    const view = parse(await call('bind_document_item', { doc: res.soNumber }))
    expect(view.items[0].สถานะ).toContain('ยังไม่ผูก')

    const bound = parse(await call('bind_document_item', {
      doc: res.soNumber, line: 1, stock_item_id: similar,
    }))
    expect(bound.success).toBe(true)
    expect(bound.unboundRemaining).toBe(0)

    const before = (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(similar) as any).quantity
    const confirm = parse(await call('update_sales_order_status', { so_id: res.soId, status: 'CONFIRMED' }))
    expect(confirm.success).toBe(true)
    const after = (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(similar) as any).quantity
    expect(before - after).toBe(2)
  })
})
