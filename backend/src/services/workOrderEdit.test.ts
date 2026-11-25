import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import workOrderRouter from '../routes/workOrder.routes'
import { createTestUser } from '../test/testAuth'
import {
  createWorkOrder, updateWorkOrder, deleteWorkOrder, transitionWorkOrder, checkMaterialStock, bomMaterials,
} from './workOrderTransition.service'

const app = express()
app.use(express.json())
app.use('/api/work-orders', authenticate, workOrderRouter)

const ACTOR = { email: 'boss', role: 'ADMIN', isMaster: false }
const newTenant = () => 't_wo_' + generateId()

function stock(tenantId: string, over: any = {}) {
  const id = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, ?, 'RAW', ?, ?, ?, ?, 'WH1', 'ACTIVE')`)
    .run(id, tenantId, 'S-' + id, over.name || 'ใยโพลี', over.quantity ?? 10, over.unit || 'kg', over.unit || 'kg', over.unitCost ?? 100)
  return id
}
const qtyOf = (id: string) => (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(id) as any).quantity

describe('ใบสั่งงาน: วัตถุดิบต้องผูกคลัง', () => {
  it('ชื่อลอย / id ร้านอื่น / จำนวน 0 ถูกปฏิเสธ', () => {
    const t = newTenant()
    const foreign = stock(newTenant())
    const mk = (m: any) => () => createWorkOrder(t, { productName: 'หมอน', quantity: 1, materials: [m] }, { notify: false })
    expect(mk({ materialName: 'ยางพารา', requiredQty: 1 })).toThrow(/ยังไม่ได้เลือกจากคลัง/)
    expect(mk({ materialId: foreign, requiredQty: 1 })).toThrow(/ไม่พบสินค้าในคลัง/)
    expect(mk({ materialId: stock(t), requiredQty: 0 })).toThrow(/มากกว่า 0/)
  })

  it('ต้นทุนประมาณการคิดหลังแปลงหน่วย (500 g × ฿100/kg = ฿50)', () => {
    const t = newTenant()
    const wo = createWorkOrder(t, { productName: 'หมอน', quantity: 1, materials: [{ materialId: stock(t), requiredQty: 500, unit: 'g' }] }, { notify: false })
    expect(wo.estimated_cost).toBe(50)
  })

  it('เริ่มผลิตใบเก่าที่มีวัตถุดิบไม่ผูกคลังไม่ได้ แก้ให้ผูกแล้วเริ่มได้', () => {
    const t = newTenant()
    const id = generateId()
    db.prepare(`INSERT INTO work_orders (id, tenant_id, wo_number, product_name, quantity, status) VALUES (?, ?, 'WO-OLD', 'หมอน', 1, 'PLANNED')`).run(id, t)
    db.prepare(`INSERT INTO work_order_materials (id, tenant_id, work_order_id, material_name, required_qty, unit, status) VALUES (?, ?, ?, 'ยางพารา', 1, 'kg', 'PENDING')`).run(generateId(), t, id)
    expect(() => transitionWorkOrder(t, id, 'IN_PROGRESS', ACTOR, { notify: false })).toThrow(/ยางพารา/)
    const mat = stock(t)
    updateWorkOrder(t, id, { materials: [{ materialId: mat, requiredQty: 2, unit: 'kg' }] })
    transitionWorkOrder(t, id, 'IN_PROGRESS', ACTOR, { notify: false })
    expect(qtyOf(mat)).toBe(8)
  })
})

describe('ใบสั่งงาน: แก้ไข / ลบ', () => {
  it('แก้ได้ก่อนเริ่มผลิต ฟิลด์ที่ไม่ส่งคงเดิม', () => {
    const t = newTenant()
    const mat = stock(t)
    const wo = createWorkOrder(t, { productName: 'หมอน', quantity: 5, dueDate: '2026-12-01', notes: 'x', materials: [{ materialId: mat, requiredQty: 1, unit: 'kg' }] }, { notify: false })
    const u = updateWorkOrder(t, wo.id, { quantity: 7, notes: '' })
    expect([u.quantity, u.notes, u.due_date, u.materials.length, u.estimated_cost]).toEqual([7, '', '2026-12-01', 1, 100])
  })

  it('เปลี่ยนสินค้าโดยไม่ส่งหน่วย ใช้หน่วยของสินค้าใหม่', () => {
    const t = newTenant()
    const wo = createWorkOrder(t, { productId: stock(t, { unit: 'kg' }), productName: 'A', quantity: 1 }, { notify: false })
    expect(updateWorkOrder(t, wo.id, { productId: stock(t, { unit: 'pcs' }) }).unit).toBe('pcs')
  })

  it('เริ่มผลิตแล้วแก้/ลบไม่ได้ ร้านอื่นแก้/ลบไม่ได้', () => {
    const t = newTenant()
    const wo = createWorkOrder(t, { productName: 'หมอน', quantity: 1, materials: [{ materialId: stock(t), requiredQty: 1, unit: 'kg' }] }, { notify: false })
    expect(() => updateWorkOrder(newTenant(), wo.id, { quantity: 2 })).toThrow(/not found/)
    expect(() => deleteWorkOrder(newTenant(), wo.id, ACTOR)).toThrow(/not found/)
    transitionWorkOrder(t, wo.id, 'PLANNED', ACTOR, { notify: false })
    transitionWorkOrder(t, wo.id, 'IN_PROGRESS', ACTOR, { notify: false })
    expect(() => updateWorkOrder(t, wo.id, { quantity: 2 })).toThrow(/ยังไม่เริ่มผลิต/)
    expect(() => deleteWorkOrder(t, wo.id, ACTOR)).toThrow(/ยังไม่เริ่มผลิต/)
  })

  it('ใบที่วางแผนแล้ว USER ลบไม่ได้ ADMIN ลบได้', () => {
    const t = newTenant()
    const wo = createWorkOrder(t, { productName: 'หมอน', quantity: 1 }, { notify: false })
    transitionWorkOrder(t, wo.id, 'PLANNED', ACTOR, { notify: false })
    expect(() => deleteWorkOrder(t, wo.id, { role: 'USER', isMaster: false })).toThrow(/ไม่มีสิทธิ์/)
    deleteWorkOrder(t, wo.id, ACTOR)
    expect(db.prepare('SELECT 1 FROM work_orders WHERE id = ?').get(wo.id)).toBeUndefined()
  })
})

describe('ใบสั่งงาน: สต็อก / BOM / สินค้าสำเร็จรูป', () => {
  it('เทียบสต็อกข้ามหน่วย หักต่อกันเมื่อวัตถุดิบซ้ำ และบอกเมื่อแปลงไม่ได้', () => {
    const t = newTenant()
    const mat = stock(t, { quantity: 1 })
    const r = checkMaterialStock(t, [
      { materialId: mat, requiredQty: 700, unit: 'g' },
      { materialId: mat, requiredQty: 700, unit: 'g' },
      { materialId: mat, requiredQty: 1, unit: 'm' },
      { materialId: null, requiredQty: 1 },
    ])
    expect(r.map(x => x.stockStatus)).toEqual(['ok', 'short', 'mismatch', 'unknown'])
    expect(r[1].shortQty).toBeCloseTo(0.4)
  })

  it('BOM คงหน่วยสูตร หาร output_qty', () => {
    const t = newTenant()
    const fg = stock(t, { unit: 'pcs', quantity: 0 })
    const mat = stock(t)
    const bomId = generateId()
    db.prepare(`INSERT INTO boms (id, tenant_id, product_id, version, status, output_qty) VALUES (?, ?, ?, 'v1', 'ACTIVE', 2)`).run(bomId, t, fg)
    db.prepare(`INSERT INTO bom_items (id, tenant_id, bom_id, item_type, material_id, quantity, unit) VALUES (?, ?, ?, 'MATERIAL', ?, 300, 'g')`).run(generateId(), t, bomId, mat)
    expect(bomMaterials(t, bomId, 10)).toMatchObject([{ materialId: mat, requiredQty: 1500, unit: 'g' }])
    expect(() => bomMaterials(newTenant(), bomId, 10)).toThrow(/ไม่พบ BOM/)
  })

  it('ใบไม่มี BOM แต่เลือกสินค้าจากคลัง ปิดงานแล้วของเข้าคลัง', () => {
    const t = newTenant()
    const fg = stock(t, { unit: 'pcs', quantity: 0, unitCost: 0 })
    const mat = stock(t)
    const wo = createWorkOrder(t, { productId: fg, productName: 'หมอน', quantity: 4, materials: [{ materialId: mat, requiredQty: 2, unit: 'kg' }] }, { notify: false })
    expect(wo.unit).toBe('pcs')
    for (const s of ['PLANNED', 'IN_PROGRESS', 'COMPLETED']) transitionWorkOrder(t, wo.id, s, ACTOR, { notify: false })
    expect(qtyOf(fg)).toBe(4)
    expect((db.prepare('SELECT unit_cost FROM stock_items WHERE id = ?').get(fg) as any).unit_cost).toBe(50)
  })

  it('?tenantId= ใช้ได้เฉพาะ MASTER', async () => {
    const t = newTenant()
    const mat = stock(t)
    const call = async (role: any) => {
      const u = createTestUser({ role })
      const r = await request(app).post(`/api/work-orders/check-materials?tenantId=${t}`).set('Authorization', `Bearer ${u.token}`)
        .send({ materials: [{ materialId: mat, requiredQty: 1, unit: 'kg' }] })
      return r.body.data[0].stockStatus
    }
    expect([await call('MASTER'), await call('ADMIN')]).toEqual(['ok', 'unknown'])
  })

  it('REST: รายละเอียดมีสถานะสต็อก, bom-materials/check-materials/แก้/ลบ ใช้งานได้', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const H = { Authorization: `Bearer ${user.token}` }
    const mat = stock(user.tenantId, { quantity: 1 })
    const c = await request(app).post('/api/work-orders').set(H).send({ productName: 'หมอน', quantity: 1, materials: [{ materialId: mat, requiredQty: 3, unit: 'kg' }] })
    expect(c.status).toBe(201)
    const g = await request(app).get(`/api/work-orders/${c.body.data.id}`).set(H)
    expect(g.body.data.materials[0]).toMatchObject({ stockStatus: 'short', shortQty: 2 })
    const k = await request(app).post('/api/work-orders/check-materials').set(H).send({ materials: [{ materialId: mat, requiredQty: 1, unit: 'kg' }] })
    expect(k.body.data[0].stockStatus).toBe('ok')
    expect((await request(app).get('/api/work-orders/bom-materials/nope?quantity=1').set(H)).status).toBe(400)
    expect((await request(app).put(`/api/work-orders/${c.body.data.id}`).set(H).send({ quantity: -1 })).status).toBe(400)
    expect((await request(app).delete(`/api/work-orders/${c.body.data.id}`).set(H)).status).toBe(200)
  })
})
