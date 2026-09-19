
import { describe, it, expect } from 'vitest'
import db from '../../db/sqlite'
import { registerPurchaseTools } from './purchase'

function fakeServer() {
  const tools: Record<string, any> = {}
  return {
    server: { tool: (name: string, _d: any, _s: any, handler: any) => { tools[name] = handler } } as any,
    call: (name: string, args: any) => tools[name](args),
  }
}
const parse = (res: any) => JSON.parse(res.content[0].text)

describe('create_draft_po auto-binding test', () => {
  it('ผูกให้อัตโนมัติเมื่อชื่อสินค้าตรงเป๊ะ 100% และปล่อยว่างเมื่อชื่อไม่ตรงเป๊ะ', async () => {
    const t = 'tn_test_' + Math.random().toString(36).slice(2, 8)
    const id1 = 'si1_' + Math.random().toString(36).slice(2, 8)
    const id2 = 'si2_' + Math.random().toString(36).slice(2, 8)
    
    // Seed 2 stock items:
    // 1) "ผ้าลายอโวคาโด้ 85 กรัม"
    // 2) "หมูสับอนามัย"
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
      VALUES (?, ?, 'FAB-001', 'ผ้าลายอโวคาโด้ 85 กรัม', 'wip', 10, 'm', 'm', 50, 'STOCK', 'ACTIVE')`).run(id1, t)
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
      VALUES (?, ?, 'RAW-001', 'หมูสับอนามัย', 'raw', 20, 'kg', 'kg', 120, 'STOCK', 'ACTIVE')`).run(id2, t)

    const { server, call } = fakeServer()
    registerPurchaseTools(server, t, 'u1', 'tester', 'ADMIN')

    const res = parse(await call('create_draft_po', {
      items: [
        { description: 'ผ้าลายอโวคาโด้ 85 กรัม', quantity: 5, unitPrice: 50 }, // Exact 100%
        { description: 'ผ้าลายอโวคาโด้', quantity: 2, unitPrice: 50 },        // Partial (missing words)
        { description: 'หมูสับอนามัย เบทาโกร', quantity: 3, unitPrice: 120 }, // Partial (extra words)
      ],
      supplier_hint: 'ร้านค้าผ้า'
    }))

    expect(res.status).toBe('DRAFT')
    expect(res.itemCount).toBe(3)
    expect(res.boundCount).toBe(1)
    expect(res.unboundCount).toBe(2)

    // รายการที่ 1: ตรงเป๊ะ 100% -> ผูกให้เลย
    expect(res.items[0].material_id).toBe(id1)
    expect(res.items[0].สถานะ).toContain('ผูกแล้ว')

    // รายการที่ 2: ขาดคำ -> null
    expect(res.items[1].material_id).toBeNull()
    expect(res.items[1].สถานะ).toContain('ยังไม่ผูก')

    // รายการที่ 3: เกินคำ -> null
    expect(res.items[2].material_id).toBeNull()
    expect(res.items[2].สถานะ).toContain('ยังไม่ผูก')

    // ตรวจสอบข้อมูลที่บันทึกลง purchase_order_items ใน DB จริง
    const rows = db.prepare('SELECT material_id, description FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY rowid').all(res.poId) as any[]
    expect(rows[0].material_id).toBe(id1)
    expect(rows[1].material_id).toBeNull()
    expect(rows[2].material_id).toBeNull()

    console.log('TEST PASSED! Output items:', JSON.stringify(res.items, null, 2))
  })
})
