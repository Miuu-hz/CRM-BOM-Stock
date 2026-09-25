import { describe, it, expect } from 'vitest'
import db from '../../db/sqlite'
import { registerStockTools } from './stock'

/**
 * ขอบเขตที่เจ้าของกำหนด 2026-09-25: AI ใส่รูปได้เฉพาะรูปสินค้ารายชิ้น
 * และต้องชี้สินค้าตัวเดียวแบบตรงเป๊ะ ห้ามเดาแทนคน (เคส "ข้าวโพด" → "สลัดทูน่าข้าวโพด")
 */
function fakeServer() {
  const tools: Record<string, any> = {}
  return {
    server: { tool: (n: string, _d: any, _s: any, h: any) => { tools[n] = h } } as any,
    call: (n: string, a: any) => tools[n](a),
    tools,
  }
}
const parse = (r: any) => JSON.parse(r.content[0].text)

function seed() {
  const t = 'tn' + Math.random().toString(36).slice(2, 10)
  const mk = (name: string) => {
    const id = 'si' + Math.random().toString(36).slice(2, 12)
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
      VALUES (?, ?, ?, ?, 'raw', 10, 'pcs', 'pcs', 1, 'STOCK', 'ACTIVE')`).run(id, t, 'SKU-' + id.slice(2, 8), name)
    return id
  }
  db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(t, 'test')
  return { t, pillow: mk('หมอนหนุน'), similar: mk('หมอนหนุนขนเป็ด') }
}

const IMG = 'https://example.com/pillow.jpg'

describe('MCP set_product_image', () => {
  it('ชื่อตรงเป๊ะ → ใส่รูปให้', async () => {
    const { t, pillow } = seed()
    const { server, call } = fakeServer()
    registerStockTools(server, t, 'u1', 'tester', 'ADMIN')

    const res = parse(await call('set_product_image', { product: 'หมอนหนุน', image_url: IMG }))
    expect(res.success).toBe(true)
    expect((db.prepare('SELECT image_url FROM stock_items WHERE id = ?').get(pillow) as any).image_url).toBe(IMG)
  })

  it('ส่ง URL ว่าง → ลบรูป', async () => {
    const { t, pillow } = seed()
    const { server, call } = fakeServer()
    registerStockTools(server, t, 'u1', 'tester', 'ADMIN')
    await call('set_product_image', { product: 'หมอนหนุน', image_url: IMG })

    const res = parse(await call('set_product_image', { product: 'หมอนหนุน', image_url: '' }))
    expect(res.success).toBe(true)
    expect((db.prepare('SELECT image_url FROM stock_items WHERE id = ?').get(pillow) as any).image_url).toBeNull()
  })

  it('ชื่อไม่ตรงเป๊ะ → ไม่เดา คืนตัวเลือกให้คนเลือก', async () => {
    const { t, pillow } = seed()
    const { server, call } = fakeServer()
    registerStockTools(server, t, 'u1', 'tester', 'ADMIN')

    const res = parse(await call('set_product_image', { product: 'หมอน', image_url: IMG }))
    expect(res.success).toBe(false)
    expect(res.ตัวเลือกใกล้เคียง.length).toBeGreaterThan(0)
    expect((db.prepare('SELECT image_url FROM stock_items WHERE id = ?').get(pillow) as any).image_url).toBeNull()
  })

  it('ไม่ใช่ URL รูป → ปฏิเสธ (กันยัด javascript:/data: หรือไฟล์อื่น)', async () => {
    const { t, pillow } = seed()
    const { server, call } = fakeServer()
    registerStockTools(server, t, 'u1', 'tester', 'ADMIN')

    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAA', 'https://example.com/a.exe', 'ftp://x/a.jpg']) {
      const res = parse(await call('set_product_image', { product: 'หมอนหนุน', image_url: bad }))
      expect(res.success, bad).toBe(false)
    }
    expect((db.prepare('SELECT image_url FROM stock_items WHERE id = ?').get(pillow) as any).image_url).toBeNull()
  })
})
