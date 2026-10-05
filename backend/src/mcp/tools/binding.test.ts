import { describe, it, expect } from 'vitest'
import db from '../../db/sqlite'
import { registerSalesTools } from './sales'

/**
 * กติกาที่เทสต์นี้ล็อกไว้ (เจ้าของสั่ง 2026-09-14):
 *   AI กรอกเอกสารให้ได้ แต่ผูกสินค้าให้เฉพาะ "ชื่อตรงเป๊ะ"
 *   ไม่ตรงเป๊ะ = ไม่ผูก คืนตัวเลือกให้คนเลือก
 *
 * เดิมเทสต์ผ่านใบสั่งขาย แต่ 2026-09-25 เจ้าของสั่งถอด tool สร้าง SO/ใบแจ้งหนี้/รับชำระ
 * ออกจาก MCP (เหลือใบเสนอราคาอย่างเดียว) จึงย้ายมาล็อกกติกาเดียวกันที่ create_quotation
 * ส่วนกฎ "ยืนยันไม่ได้จนกว่าจะผูกครบ" ยังถูกล็อกไว้ฝั่งจัดซื้อ (ดู purchase.gr.test.ts)
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
  // ขนมจีน = สินค้ากึ่งสำเร็จ (เจ้าของยืนยัน 2026-10-04) — วัตถุดิบ raw ออกใบเสนอราคาไม่ได้แล้ว
  const mk = (name: string, qty: number) => {
    const id = 'si' + Math.random().toString(36).slice(2, 12)
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
      VALUES (?, ?, ?, ?, 'wip', ?, 'g', 'g', 1, 'STOCK', 'ACTIVE')`).run(id, t, 'SKU-' + id.slice(2, 8), name, qty)
    return id
  }
  return { t, exact: mk('ขนมจีน', 1000), similar: mk('ขนมจีนน้ำยาปักษ์ใต้', 50) }
}

describe('AI กรอกให้ แต่ไม่เดาผูกสินค้าแทนคน', () => {
  it('ชื่อตรงเป๊ะ → ผูกให้เลย', async () => {
    const { t, exact } = seedTenant()
    const { server, call } = fakeServer()
    registerSalesTools(server, t, 'u1', 'tester', 'ADMIN')

    const res = parse(await call('create_quotation', {
      items: [{ description: 'ขนมจีน', quantity: 2, unitPrice: 50 }],
    }))
    expect(res.รายการ[0].ผูกกับสินค้า).toBe('ขนมจีน')
    const qt = db.prepare('SELECT id FROM quotations WHERE quotation_number = ? AND tenant_id = ?').get(res.เลขที่ใบเสนอราคา, t) as any
    const row = db.prepare('SELECT stock_item_id FROM quotation_items WHERE quotation_id = ?').get(qt.id) as any
    expect(row.stock_item_id).toBe(exact)
  })

  it('ชื่อไม่ตรงเป๊ะ → ไม่ผูก คืนตัวเลือกให้คนเลือก', async () => {
    const { t } = seedTenant()
    const { server, call } = fakeServer()
    registerSalesTools(server, t, 'u1', 'tester', 'ADMIN')

    const res = parse(await call('create_quotation', {
      items: [{ description: 'ขนมจีนน้ำยา', quantity: 2, unitPrice: 50 }],
    }))
    expect(res.รายการ[0].ผูกกับสินค้า).toBeNull()
    expect(res.รายการ[0].ตัวเลือก.length).toBeGreaterThan(0)

    const qt = db.prepare('SELECT id FROM quotations WHERE quotation_number = ? AND tenant_id = ?').get(res.เลขที่ใบเสนอราคา, t) as any
    const row = db.prepare('SELECT stock_item_id FROM quotation_items WHERE quotation_id = ?').get(qt.id) as any
    expect(row.stock_item_id, 'เดาผูกให้ไม่ได้ เคยทำ "ข้าวโพด" ไปจับ "สลัดทูน่าข้าวโพด" แล้วตัดสต็อกผิดตัว').toBeNull()
  })

  it('ใบเสนอราคาไม่แตะสต็อกไม่ว่ากรณีไหน (เป็นแค่ข้อเสนอ)', async () => {
    const { t, exact } = seedTenant()
    const before = (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(exact) as any).quantity
    const { server, call } = fakeServer()
    registerSalesTools(server, t, 'u1', 'tester', 'ADMIN')

    await call('create_quotation', { items: [{ description: 'ขนมจีน', quantity: 2, unitPrice: 50, unit: 'g' }] })

    const after = (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(exact) as any).quantity
    expect(after).toBe(before)
  })
})
