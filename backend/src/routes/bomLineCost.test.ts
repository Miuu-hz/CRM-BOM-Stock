import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import bomRouter from './bom.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/bom', bomRouter)

/** 2026-11-20: การ์ด BOM โชว์แถว Child BOM ไม่มีราคา (หน้าจอคิดเองเป็น 0) ทั้งที่ยอดรวมนับต้นทุนลูกแล้ว */
describe('GET /bom/:id lineCost', () => {
  it('แต่ละแถวมีต้นทุน รวม Child BOM (ซ้ำ 2 แถวก็ต้องได้ทั้งคู่) และรวมแล้วเท่ายอด', async () => {
    const t = createTestUser({ role: 'ADMIN' })
    const item = (name: string, cost: number) => {
      const id = generateId()
      db.prepare("INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status) VALUES (?, ?, ?, ?, 'RAW', 0, 'pcs', 'pcs', ?, 'MAIN', 'ACTIVE')").run(id, t.tenantId, id, name, cost)
      return id
    }
    const bom = (productId: string) => {
      const id = generateId()
      db.prepare("INSERT INTO boms (id, tenant_id, product_id, version, status, output_qty, output_unit) VALUES (?, ?, ?, '1', 'ACTIVE', 1, 'pcs')").run(id, t.tenantId, productId)
      return id
    }
    const line = (bomId: string, type: string, matId: string | null, childId: string | null, qty: number) =>
      db.prepare('INSERT INTO bom_items (id, tenant_id, bom_id, item_type, material_id, child_bom_id, quantity, unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(generateId(), t.tenantId, bomId, type, matId, childId, qty, 'pcs')

    const sauce = bom(item('น้ำยำ', 0))
    line(sauce, 'MATERIAL', item('พริก', 2), null, 3)          // น้ำยำ 1 ชิ้น = 6
    const dish = bom(item('ข้าวยำ', 0))
    line(dish, 'MATERIAL', item('ข้าว', 5), null, 1)           // 5
    line(dish, 'CHILD_BOM', null, sauce, 1)                    // 6
    line(dish, 'CHILD_BOM', null, sauce, 2)                    // 12

    const res = await request(app).get(`/api/bom/${dish}`).set('Authorization', `Bearer ${t.token}`)
    expect(res.status).toBe(200)
    const costs = res.body.data.items.map((i: any) => i.lineCost).sort((a: number, b: number) => a - b)
    expect(costs).toEqual([5, 6, 12])
    expect(res.body.data.totalCost).toBe(23)
  })
})
