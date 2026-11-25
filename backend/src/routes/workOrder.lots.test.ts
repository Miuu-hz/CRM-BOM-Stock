import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import workOrderRouter from './workOrder.routes'
import qcRouter from './qc.routes'
import subcontractRouter from './subcontract.routes'
import { createTestUser } from '../test/testAuth'
import {
  createWorkOrder, transitionWorkOrder, recordWorkOrderLot, lotTotals,
} from '../services/workOrderTransition.service'
import { produceForSalesOrder } from '../services/salesOrderProduction.service'
import { registerProductionTools } from '../mcp/tools/production'
import type { IMcpServer } from '../mcp/sdk-compat'

const app = express()
app.use(express.json())
app.use('/api/work-orders', authenticate, workOrderRouter)
app.use('/api/qc', qcRouter)
app.use('/api/subcontracts', subcontractRouter)

const tenants: string[] = []
function trackTenant(t: string) {
  tenants.push(t)
  return t
}

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM journal_lines WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM journal_entries WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM subcon_receipts WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM subcon_material_issues WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM subcon_stock WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM wo_subcontracts WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM qc_inspections WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM qc_checklists WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_movements WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM work_order_lots WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM work_order_materials WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM work_orders WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM sales_order_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM sales_orders WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM bom_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM boms WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM unit_conversions WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM customers WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM suppliers WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM company_settings WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM users WHERE tenant_id = ?').run(t)
  }
})

function seedStock(tenantId: string, opts: {
  name?: string
  category?: string
  quantity?: number
  unit?: string
  baseUnit?: string
  displayUnit?: string | null
  sealedQty?: number
  unitCost?: number
} = {}) {
  const id = generateId()
  const unit = opts.unit || 'kg'
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, display_unit, sealed_qty, unit_cost, location, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WH1', 'ACTIVE')
  `).run(
    id, tenantId, 'SKU-' + id.slice(0, 8), opts.name || 'สินค้าทดสอบ',
    opts.category || 'RAW', opts.quantity ?? 100, unit, opts.baseUnit || unit,
    opts.displayUnit ?? null, opts.sealedQty ?? 0, opts.unitCost ?? 0
  )
  return id
}

function seedBom(tenantId: string, productId: string, outputQty = 1, outputUnit = 'pcs') {
  const id = generateId()
  db.prepare(`
    INSERT INTO boms (id, tenant_id, product_id, version, status, output_qty, output_unit)
    VALUES (?, ?, ?, 'v1', 'ACTIVE', ?, ?)
  `).run(id, tenantId, productId, outputQty, outputUnit)
  return id
}

function seedUnitConv(tenantId: string, materialId: string, fromUnit: string, toUnit: string, factor: number) {
  const id = generateId()
  db.prepare(`
    INSERT INTO unit_conversions (id, tenant_id, material_id, from_unit, to_unit, conversion_factor, is_global)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(id, tenantId, materialId, fromUnit, toUnit, factor)
  return id
}

function seedPlannedWO(tenantId: string, opts: {
  quantity?: number
  bomId?: string | null
  productId?: string | null
  unit?: string | null
  materials?: Array<{ materialId: string; materialName?: string; requiredQty: number; unit?: string }>
} = {}) {
  const wo = createWorkOrder(tenantId, {
    bomId: opts.bomId ?? null,
    productId: opts.productId ?? null,
    productName: 'สินค้าผลิตทดสอบ',
    quantity: opts.quantity ?? 10,
    unit: opts.unit ?? null,
    materials: opts.materials ?? [],
  }, { notify: false })
  transitionWorkOrder(tenantId, wo.id, 'PLANNED', { role: 'ADMIN', isMaster: false }, { notify: false })
  return wo
}

function fakeMcpServer(): { server: IMcpServer; tools: Record<string, (args: any) => Promise<any>> } {
  const tools: Record<string, (args: any) => Promise<any>> = {}
  const server: IMcpServer = {
    tool: (name: string, _desc: string, _schema: any, handler: any) => { tools[name] = handler },
    connect: async () => {},
    close: async () => {},
  }
  return { server, tools }
}

const parseMcp = (res: any) => JSON.parse(res.content[0].text)

describe('Work Order Lots (แบ่งบันทึกรับผลผลิตและตัดวัตถุดิบตามล็อต)', () => {
  it('Case 1: PLANNED → IN_PROGRESS ตรวจวัตถุดิบ/แปลงหน่วย ตั้ง start_date แต่ไม่ตัดสต็อกล่วงหน้า', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const matId = seedStock(admin.tenantId, { quantity: 50, unit: 'kg' })

    // วัตถุดิบหน่วยที่ไม่รู้วิธีแปลง → ต้อง error ทันทีตอนเริ่มผลิต
    const badWo = seedPlannedWO(admin.tenantId, {
      quantity: 10,
      materials: [{ materialId: matId, requiredQty: 5, unit: 'roll' }],
    })
    const badStart = await request(app).put(`/api/work-orders/${badWo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'IN_PROGRESS' })
    expect(badStart.status).toBe(400)
    expect(badStart.body.message).toContain('ไม่พบการแปลงหน่วย')

    // วัตถุดิบผูกคลังและแปลงหน่วยได้ → เริ่มผลิตได้ โดยสต็อกไม่ลดและไม่มี OUT movement
    const wo = seedPlannedWO(admin.tenantId, {
      quantity: 10,
      materials: [{ materialId: matId, requiredQty: 20, unit: 'kg' }],
    })
    const okStart = await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'IN_PROGRESS' })
    expect(okStart.status).toBe(200)
    expect(okStart.body.data.status).toBe('IN_PROGRESS')
    expect(okStart.body.data.start_date).toBeTruthy()

    const stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(matId) as any
    expect(stock.quantity).toBe(50)
    const outs = db.prepare("SELECT COUNT(*) c FROM stock_movements WHERE tenant_id = ? AND type = 'OUT'").get(admin.tenantId) as any
    expect(outs.c).toBe(0)
  })

  it('Case 2: ตัดวัตถุดิบตามสัดส่วนหลายล็อตและไม่มีเศษทศนิยมค้างในล็อตสุดท้าย', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const matId = seedStock(admin.tenantId, { quantity: 100, unit: 'kg' })
    const wo = seedPlannedWO(admin.tenantId, {
      quantity: 3,
      materials: [{ materialId: matId, requiredQty: 10, unit: 'kg' }],
    })
    await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'IN_PROGRESS' })

    const r1 = await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 1 })
    expect(r1.status).toBe(201)
    expect(r1.body.data.workOrder.materials[0].status).toBe('PARTIAL')
    expect(r1.body.data.workOrder.materials[0].issued_qty).toBeCloseTo(3.333333, 6)

    const r2 = await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 1 })
    expect(r2.status).toBe(201)

    const r3 = await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 1 })
    expect(r3.status).toBe(201)
    expect(r3.body.data.autoCompleted).toBe(true)
    expect(r3.body.data.workOrder.materials[0].status).toBe('ISSUED')
    expect(r3.body.data.workOrder.materials[0].issued_qty).toBe(10)

    const outRows = db.prepare("SELECT quantity FROM stock_movements WHERE tenant_id = ? AND stock_item_id = ? AND type = 'OUT' ORDER BY rowid ASC")
      .all(admin.tenantId, matId) as any[]
    expect(outRows.map(r => r.quantity)).toEqual([3.333333, 3.333333, 3.333334])
    const totalOut = outRows.reduce((s, r) => s + r.quantity, 0)
    expect(totalOut).toBeCloseTo(10, 6)

    const stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(matId) as any
    expect(stock.quantity).toBeCloseTo(90, 6)
  })

  it('Case 3: แปลงหน่วย g → kg และแกะแพ็คอัตโนมัติ (auto-unpack) ต่อล็อต', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const matId = seedStock(admin.tenantId, {
      quantity: 1,
      unit: 'kg',
      baseUnit: 'kg',
      displayUnit: 'bag',
      sealedQty: 2,
    })
    seedUnitConv(admin.tenantId, matId, 'bag', 'kg', 5)

    // สั่งผลิต 10 ชิ้น ใช้ 7000 g (7 kg) → ล็อตผลิต 5 ชิ้น ใช้ 3500 g (3.5 kg)
    const wo = seedPlannedWO(admin.tenantId, {
      quantity: 10,
      materials: [{ materialId: matId, requiredQty: 7000, unit: 'g' }],
    })
    await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'IN_PROGRESS' })

    const res = await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 5 })
    expect(res.status).toBe(201)

    const stock = db.prepare('SELECT quantity, sealed_qty FROM stock_items WHERE id = ?').get(matId) as any
    expect(stock.sealed_qty).toBe(1) // แกะไป 1 bag (+5 kg) จาก 1 + 5 - 3.5 = 2.5 kg
    expect(stock.quantity).toBeCloseTo(2.5, 6)

    const unpackMv = db.prepare("SELECT * FROM stock_movements WHERE tenant_id = ? AND stock_item_id = ? AND type = 'UNPACK'")
      .get(admin.tenantId, matId) as any
    expect(unpackMv).toBeTruthy()
    expect(unpackMv.quantity).toBe(5)
    expect(unpackMv.movement_unit).toBe('bag')
    expect(unpackMv.movement_quantity).toBe(1)
    expect(unpackMv.reference).toBe(`WO: ${wo.wo_number} (${wo.wo_number}-L01)`)
  })

  it('Case 4: สร้างเลขล็อตอัตโนมัติ (-L01, -L02), รับเลขล็อตกำหนดเอง และปฏิเสธเลขล็อตซ้ำหรือยาวเกิน 60 ตัว', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const wo = seedPlannedWO(admin.tenantId, { quantity: 10 })
    await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'IN_PROGRESS' })

    const l1 = await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 2 })
    expect(l1.status).toBe(201)
    expect(l1.body.data.lot.lot_number).toBe(`${wo.wo_number}-L01`)

    const l2 = await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 2 })
    expect(l2.status).toBe(201)
    expect(l2.body.data.lot.lot_number).toBe(`${wo.wo_number}-L02`)

    const custom = await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 2, lotNumber: '  SHIFT-A1  ' })
    expect(custom.status).toBe(201)
    expect(custom.body.data.lot.lot_number).toBe('SHIFT-A1')

    const dup = await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 1, lotNumber: 'SHIFT-A1' })
    expect(dup.status).toBe(400)
    expect(dup.body.message).toContain('ซ้ำในใบสั่งผลิตนี้')

    const tooLong = await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 1, lotNumber: 'L'.repeat(61) })
    expect(tooLong.status).toBe(400)
    expect(tooLong.body.message).toBe('เลขล็อตยาวเกิน 60 ตัวอักษร')
  })

  it('Case 5: ของเสียรวมเข้าต้นทุนสินค้าสำเร็จรูปในล็อตที่มีของดี (good=4, scrap=1 → 50% ของต้นทุนเข้า FG 4 ชิ้น)', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const matId = seedStock(admin.tenantId, { quantity: 100, unit: 'kg', unitCost: 5 })
    const fgId = seedStock(admin.tenantId, { category: 'FINISHED', quantity: 0, unit: 'pcs', unitCost: 0 })
    const bomId = seedBom(admin.tenantId, fgId)
    const wo = seedPlannedWO(admin.tenantId, {
      quantity: 10,
      bomId,
      materials: [{ materialId: matId, requiredQty: 20, unit: 'kg' }],
    })
    await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'IN_PROGRESS' })

    const res = await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 4, scrapQty: 1 })
    expect(res.status).toBe(201)
    expect(res.body.data.lot.material_cost).toBe(50)
    expect(res.body.data.lot.unit_cost).toBe(12.5)
    expect(res.body.data.workOrder.actual_cost).toBe(50)

    const fg = db.prepare('SELECT quantity, unit_cost FROM stock_items WHERE id = ?').get(fgId) as any
    expect(fg.quantity).toBe(4)
    expect(fg.unit_cost).toBeCloseTo(12.5, 4)

    const jeCount = db.prepare("SELECT COUNT(*) c FROM journal_entries WHERE tenant_id = ? AND reference_type = 'WO_MATERIAL'")
      .get(admin.tenantId) as any
    expect(jeCount.c).toBe(0)
  })

  it('Case 6: ล็อตของเสียล้วน (good=0, scrap=2) → ไม่เพิ่ม FG, ลง Dr 5102 / Cr 1107 มูลค่า ฿20, บวก actual_cost', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const matId = seedStock(admin.tenantId, { quantity: 100, unit: 'kg', unitCost: 5 })
    const fgId = seedStock(admin.tenantId, { category: 'FINISHED', quantity: 0, unit: 'pcs', unitCost: 0 })
    const bomId = seedBom(admin.tenantId, fgId)
    const wo = seedPlannedWO(admin.tenantId, {
      quantity: 10,
      bomId,
      materials: [{ materialId: matId, requiredQty: 20, unit: 'kg' }],
    })
    await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'IN_PROGRESS' })

    const res = await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 0, scrapQty: 2 })
    expect(res.status).toBe(201)
    expect(res.body.data.lot.material_cost).toBe(20)
    expect(res.body.data.lot.unit_cost).toBe(0)
    expect(res.body.data.workOrder.scrap_qty).toBe(2)
    expect(res.body.data.workOrder.actual_cost).toBe(20)

    const fg = db.prepare('SELECT quantity, unit_cost FROM stock_items WHERE id = ?').get(fgId) as any
    expect(fg.quantity).toBe(0)
    expect(fg.unit_cost).toBe(0)

    const je = db.prepare("SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = 'WO_MATERIAL'").get(admin.tenantId) as any
    expect(je).toBeTruthy()
    expect(je.total_debit).toBeCloseTo(20, 4)
    const lines = db.prepare(`SELECT a.code, jl.debit, jl.credit FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE jl.journal_entry_id = ? ORDER BY jl.line_number`).all(je.id) as any[]
    expect(lines.map(l => [l.code, l.debit, l.credit])).toEqual([['5102', 20, 0], ['1107', 0, 20]])
  })

  it('Case 7: ต้นทุนเฉลี่ยถ่วงน้ำหนักหลายล็อตเท่ากับการปิดงานครั้งเดียว ((80 + 40 + 60) / 20 = ฿9/pc)', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const matId = seedStock(admin.tenantId, { quantity: 100, unit: 'kg', unitCost: 5 })
    const fgId = seedStock(admin.tenantId, { category: 'FINISHED', quantity: 10, unit: 'pcs', unitCost: 8 })
    const bomId = seedBom(admin.tenantId, fgId)
    const wo = seedPlannedWO(admin.tenantId, {
      quantity: 10,
      bomId,
      materials: [{ materialId: matId, requiredQty: 20, unit: 'kg' }],
    })
    await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'IN_PROGRESS' })

    expect((await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 4 })).status).toBe(201)
    expect((await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 6 })).status).toBe(201)

    const fg = db.prepare('SELECT quantity, unit_cost FROM stock_items WHERE id = ?').get(fgId) as any
    expect(fg.quantity).toBe(20)
    expect(fg.unit_cost).toBeCloseTo(9, 6)

    const woRow = db.prepare('SELECT actual_cost, status FROM work_orders WHERE id = ?').get(wo.id) as any
    expect(woRow.actual_cost).toBe(100)
    expect(woRow.status).toBe('COMPLETED')
  })

  it('Case 8: ปฏิเสธการบันทึกเกินจำนวนคงเหลือที่ต้องผลิต (HTTP 400 + rollback)', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const matId = seedStock(admin.tenantId, { quantity: 100, unit: 'kg' })
    const wo = seedPlannedWO(admin.tenantId, {
      quantity: 10,
      materials: [{ materialId: matId, requiredQty: 10, unit: 'kg' }],
    })
    await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'IN_PROGRESS' })
    await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 6 })

    const over = await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 3, scrapQty: 2 })
    expect(over.status).toBe(400)
    expect(over.body.message).toContain('เกินจำนวนคงเหลือที่ต้องผลิต')

    // rollback: เหลือ 4 และวัตถุดิบยังโดนตัดแค่ 6
    expect(lotTotals(admin.tenantId, wo.id)).toEqual({ good: 6, scrap: 0, remaining: 4 })
    const stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(matId) as any
    expect(stock.quantity).toBe(94)
  })

  it('Case 9: USER บันทึกล็อตได้ และเมื่อครบจำนวนจะปิดใบสั่งผลิตอัตโนมัติ + GET /:id & /stats', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const staff = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const wo = seedPlannedWO(admin.tenantId, { quantity: 10 })
    await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'IN_PROGRESS' })

    const r1 = await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${staff.token}`).send({ goodQty: 4, notes: 'กะเช้า' })
    expect(r1.status).toBe(201)
    expect(r1.body.data.autoCompleted).toBe(false)

    // stats รวมยอด completed_qty ของ IN_PROGRESS ด้วย
    const statsRes = await request(app).get('/api/work-orders/stats')
      .set('Authorization', `Bearer ${staff.token}`)
    expect(statsRes.status).toBe(200)
    expect(statsRes.body.data.totalProduced).toBe(4)

    const detailRes = await request(app).get(`/api/work-orders/${wo.id}`)
      .set('Authorization', `Bearer ${staff.token}`)
    expect(detailRes.status).toBe(200)
    expect(detailRes.body.data.lots).toHaveLength(1)
    expect(detailRes.body.data.produced_qty).toBe(4)
    expect(detailRes.body.data.remaining_qty).toBe(6)

    const r2 = await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${staff.token}`).send({ goodQty: 5, scrapQty: 1 })
    expect(r2.status).toBe(201)
    expect(r2.body.data.autoCompleted).toBe(true)
    expect(r2.body.data.workOrder.status).toBe('COMPLETED')
    expect(r2.body.data.workOrder.completed_date).toBeTruthy()
  })

  it('Case 10: ปิดงานก่อนครบ (closeShort) + RBAC (USER 403, ADMIN 400 ถ้าไม่ส่ง closeShort, 200 เมื่อส่ง closeShort)', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const staff = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const matId = seedStock(admin.tenantId, { quantity: 100, unit: 'kg' })
    const fgId = seedStock(admin.tenantId, { category: 'FINISHED', quantity: 0, unit: 'pcs' })
    const bomId = seedBom(admin.tenantId, fgId)
    const wo = seedPlannedWO(admin.tenantId, {
      quantity: 10,
      bomId,
      materials: [{ materialId: matId, requiredQty: 20, unit: 'kg' }],
    })
    await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'IN_PROGRESS' })
    await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${staff.token}`).send({ goodQty: 4 })

    const staffClose = await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${staff.token}`).send({ status: 'COMPLETED', closeShort: true })
    expect(staffClose.status).toBe(403)

    const noFlag = await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'COMPLETED' })
    expect(noFlag.status).toBe(400)
    expect(noFlag.body.message).toContain('ยังผลิตไม่ครบ')

    const closeOk = await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'COMPLETED', closeShort: true })
    expect(closeOk.status).toBe(200)
    expect(closeOk.body.data.status).toBe('COMPLETED')
    expect(closeOk.body.data.completed_qty).toBe(4)

    expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(fgId) as any).quantity).toBe(4)
    expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(matId) as any).quantity).toBe(92) // ตัดไปแค่ 40% (8 kg)
  })

  it('Case 11: ยกเลิกกลางคันบน WO แบบล็อต → เก็บ FG 4 ชิ้นและล็อตไว้, ไม่คืนวัตถุดิบที่ถูกใช้ผลิตไปแล้ว', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const matId = seedStock(admin.tenantId, { quantity: 100, unit: 'kg' })
    const fgId = seedStock(admin.tenantId, { category: 'FINISHED', quantity: 0, unit: 'pcs' })
    const bomId = seedBom(admin.tenantId, fgId)
    const wo = seedPlannedWO(admin.tenantId, {
      quantity: 10,
      bomId,
      materials: [{ materialId: matId, requiredQty: 20, unit: 'kg' }],
    })
    await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'IN_PROGRESS' })
    await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 4 })

    const cancelRes = await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'CANCELLED' })
    expect(cancelRes.status).toBe(200)
    expect(cancelRes.body.data.status).toBe('CANCELLED')

    expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(fgId) as any).quantity).toBe(4)
    expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(matId) as any).quantity).toBe(92)
    const cancelMvs = db.prepare("SELECT COUNT(*) c FROM stock_movements WHERE tenant_id = ? AND reference = ?")
      .get(admin.tenantId, `WO-CANCEL: ${wo.wo_number}`) as any
    expect(cancelMvs.c).toBe(0)
    const lotCount = db.prepare('SELECT COUNT(*) c FROM work_order_lots WHERE work_order_id = ?').get(wo.id) as any
    expect(lotCount.c).toBe(1)
  })

  it('Case 12: Legacy pre-issued WO → บันทึกล็อตไม่ตัดซ้ำ คิดต้นทุนตามสัดส่วน และยกเลิก/ปิดสั้นคืนเฉพาะส่วนที่เหลือ', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const matId = seedStock(admin.tenantId, { quantity: 80, unit: 'kg', unitCost: 5 }) // เหลือ 80 หลังเบิกไป 20
    const fgId = seedStock(admin.tenantId, { category: 'FINISHED', quantity: 0, unit: 'pcs', unitCost: 0 })
    const bomId = seedBom(admin.tenantId, fgId)
    const wo = seedPlannedWO(admin.tenantId, {
      quantity: 10,
      bomId,
      materials: [{ materialId: matId, requiredQty: 20, unit: 'kg' }],
    })
    await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'IN_PROGRESS' })

    // จำลองการเบิกเต็มจำนวนแบบเดิม (exact reference 'WO: <wo_number>')
    db.prepare(`
      INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
      VALUES (?, ?, ?, 'OUT', 20, ?, 'Legacy pre-issue', ?, 'system')
    `).run(generateId(), admin.tenantId, matId, `WO: ${wo.wo_number}`, new Date().toISOString())
    db.prepare("UPDATE work_order_materials SET issued_qty = 20, status = 'ISSUED' WHERE work_order_id = ?").run(wo.id)

    const lotRes = await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 4 })
    expect(lotRes.status).toBe(201)
    expect(lotRes.body.data.lot.material_cost).toBe(40)
    expect(lotRes.body.data.workOrder.actual_cost).toBe(40)
    expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(matId) as any).quantity).toBe(80) // ไม่ตัดซ้ำ
    const fg = db.prepare('SELECT quantity, unit_cost FROM stock_items WHERE id = ?').get(fgId) as any
    expect(fg.quantity).toBe(4)
    expect(fg.unit_cost).toBeCloseTo(10, 4)

    // ยกเลิกหลังล็อต 1 → คืน 60% (12 kg) ให้ deducted(100) = settled(40) + returned(60)
    const cancelRes = await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'CANCELLED' })
    expect(cancelRes.status).toBe(200)
    expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(matId) as any).quantity).toBe(92)
    const retMv = db.prepare("SELECT quantity FROM stock_movements WHERE tenant_id = ? AND reference = ?")
      .get(admin.tenantId, `WO-CANCEL: ${wo.wo_number}`) as any
    expect(retMv.quantity).toBe(12)

    // ตรวจ closeShort ที่ 0 ล็อตบน legacy pre-issued WO → คืน 100% (20 kg) และ actual_cost = 0
    const woZero = seedPlannedWO(admin.tenantId, {
      quantity: 10,
      bomId,
      materials: [{ materialId: matId, requiredQty: 20, unit: 'kg' }],
    })
    await request(app).put(`/api/work-orders/${woZero.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'IN_PROGRESS' })
    db.prepare('UPDATE stock_items SET quantity = quantity - 20 WHERE id = ?').run(matId)
    db.prepare(`
      INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
      VALUES (?, ?, ?, 'OUT', 20, ?, 'Legacy pre-issue', ?, 'system')
    `).run(generateId(), admin.tenantId, matId, `WO: ${woZero.wo_number}`, new Date().toISOString())

    const csZero = await request(app).put(`/api/work-orders/${woZero.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'COMPLETED', closeShort: true })
    expect(csZero.status).toBe(200)
    expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(matId) as any).quantity).toBe(92)
    expect((db.prepare('SELECT actual_cost FROM work_orders WHERE id = ?').get(woZero.id) as any).actual_cost).toBe(0)
  })

  it('Case 13: QC Gate เปิดอยู่ → บันทึกล็อตครบค้างไว้ IN_PROGRESS, บล็อกปิดงานจนกว่า QC PASS, QC complete ไม่เบิ้ล completed_qty', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    db.prepare('INSERT INTO company_settings (tenant_id, name, qc_gate_enabled) VALUES (?, ?, 1)').run(admin.tenantId, 'QC Co')
    const fgId = seedStock(admin.tenantId, { category: 'FINISHED', quantity: 0, unit: 'pcs' })
    const bomId = seedBom(admin.tenantId, fgId)
    const wo = seedPlannedWO(admin.tenantId, { quantity: 10, bomId })
    await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'IN_PROGRESS' })

    const lotRes = await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 10 })
    expect(lotRes.status).toBe(201)
    expect(lotRes.body.data.autoCompleted).toBe(false)
    expect(lotRes.body.data.qcBlockedCompletion).toContain('QC')
    expect(lotRes.body.data.workOrder.status).toBe('IN_PROGRESS')
    expect(lotRes.body.data.workOrder.completed_qty).toBe(10)

    // ปิดงานตรงๆ ตอนยังไม่ PASS → 400
    const blockedClose = await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'COMPLETED' })
    expect(blockedClose.status).toBe(400)
    expect(blockedClose.body.message).toContain('QC')

    // สร้างและปิด QC PASS → ต้องไม่บวก completed_qty ซ้ำเป็น 20
    const chkId = generateId()
    db.prepare("INSERT INTO qc_checklists (id, tenant_id, name, check_items) VALUES (?, ?, 'QC1', '[]')").run(chkId, admin.tenantId)
    const qcCreate = await request(app).post('/api/qc/inspections')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ checklist_id: chkId, work_order_id: wo.id, inspected_qty: 10 })
    expect(qcCreate.status).toBe(200)
    const qcComplete = await request(app).post(`/api/qc/inspections/${qcCreate.body.data.id}/complete`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ results: [{ item_id: '1', result: 'PASS' }], passed_qty: 10, rejected_qty: 0 })
    expect(qcComplete.status).toBe(200)

    const woAfterQc = db.prepare('SELECT completed_qty, scrap_qty FROM work_orders WHERE id = ?').get(wo.id) as any
    expect(woAfterQc.completed_qty).toBe(10) // ไม่เบิ้ลเป็น 20

    const finalClose = await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'COMPLETED' })
    expect(finalClose.status).toBe(200)
    expect(finalClose.body.data.status).toBe('COMPLETED')
  })

  it('Case 14: Sales Order Make-To-Order (produceForSalesOrder) ปิดครบในธุรกรรมเดียวและสร้าง 1 ล็อต', () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const T = trackTenant(admin.tenantId)
    const custId = generateId()
    db.prepare(`INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, status) VALUES (?, ?, 'C1', 'ลูกค้า', 'INDIVIDUAL', 'ก', 'c@t.co', '0800000000', 'กทม', 'ACTIVE')`)
      .run(custId, T)
    const rawId = seedStock(T, { category: 'RAW', quantity: 50, unit: 'kg', unitCost: 10 })
    const fgId = seedStock(T, { category: 'FINISHED', quantity: 0, unit: 'pcs', unitCost: 0 })
    const bomId = seedBom(T, fgId, 1, 'pcs')
    db.prepare(`INSERT INTO bom_items (id, tenant_id, bom_id, item_type, material_id, quantity, unit) VALUES (?, ?, ?, 'MATERIAL', ?, 2, 'kg')`)
      .run(generateId(), T, bomId, rawId)

    const soId = generateId()
    const soNo = formatDocumentNumber('SO', T, 'SALES_ORDER', new Date().getFullYear(), 5)
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, order_date, subtotal, total_amount, status, payment_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1000, 1000, 'DRAFT', 'UNPAID', ?, ?)
    `).run(soId, T, soNo, custId, now, now, now)
    db.prepare(`
      INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, quantity, unit, unit_price, total_price)
      VALUES (?, ?, ?, ?, 5, 'pcs', 200, 1000)
    `).run(generateId(), T, soId, fgId)

    const res = produceForSalesOrder(T, soId, { email: 'admin@test.com', role: 'ADMIN', isMaster: false })
    expect(res.workOrders).toHaveLength(1)
    const wo = res.workOrders[0]
    expect(wo.status).toBe('COMPLETED')
    expect(wo.quantity).toBe(5)

    const lots = db.prepare('SELECT * FROM work_order_lots WHERE work_order_id = ?').all(wo.id) as any[]
    expect(lots).toHaveLength(1)
    expect(lots[0].good_qty).toBe(5)
    expect(lots[0].material_cost).toBe(100)

    const raw = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(rawId) as any
    expect(raw.quantity).toBe(40) // 50 - 5*2
    const fg = db.prepare('SELECT quantity, unit_cost FROM stock_items WHERE id = ?').get(fgId) as any
    expect(fg.quantity).toBe(5)
    expect(fg.unit_cost).toBeCloseTo(20, 4)
  })

  it('Case 15: Subcontract OUTSOURCE + PIECE_RATE เพิ่ม actual_cost โดยไม่ทับหรือนับซ้ำกับต้นทุนล็อต', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    trackTenant(admin.tenantId)
    const matId = seedStock(admin.tenantId, { quantity: 100, unit: 'kg', unitCost: 5 })
    const fgId = seedStock(admin.tenantId, { category: 'FINISHED', quantity: 0, unit: 'pcs' })
    const bomId = seedBom(admin.tenantId, fgId)
    const wo = seedPlannedWO(admin.tenantId, {
      quantity: 10,
      bomId,
      materials: [{ materialId: matId, requiredQty: 20, unit: 'kg' }],
    })
    await request(app).put(`/api/work-orders/${wo.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ status: 'IN_PROGRESS' })

    // บันทึกล็อต 4 ชิ้น → material actual_cost = 40
    await request(app).post(`/api/work-orders/${wo.id}/lots`)
      .set('Authorization', `Bearer ${admin.token}`).send({ goodQty: 4 })

    const supId = generateId()
    db.prepare(`INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, 'SUP1', 'ช่างนอก', 'A')`)
      .run(supId, admin.tenantId)
    const subRes = await request(app).post('/api/subcontracts')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ work_order_id: wo.id, supplier_id: supId, contract_type: 'PIECE_RATE', rate_per_unit: 15, agreed_qty: 10 })
    expect(subRes.status).toBe(201)

    // QC ตรวจผ่าน 4 ชิ้น → accrue ค่าแรงเหมา 4 * 15 = 60 → actual_cost = 40 + 60 = 100 (และ completed_qty ยังคง 4)
    const chkId = generateId()
    db.prepare("INSERT INTO qc_checklists (id, tenant_id, name, check_items) VALUES (?, ?, 'QC-SC', '[]')").run(chkId, admin.tenantId)
    const qcCreate = await request(app).post('/api/qc/inspections')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ checklist_id: chkId, work_order_id: wo.id, inspected_qty: 4 })
    await request(app).post(`/api/qc/inspections/${qcCreate.body.data.id}/complete`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ results: [{ item_id: '1', result: 'PASS' }], passed_qty: 4, rejected_qty: 0 })

    const woRow = db.prepare('SELECT actual_cost, completed_qty FROM work_orders WHERE id = ?').get(wo.id) as any
    expect(woRow.completed_qty).toBe(4)
    expect(woRow.actual_cost).toBe(100)
  })

  it('Case 16: MCP record_work_order_lot และ update_work_order_status (close_short + RBAC + tenant isolation)', async () => {
    const t = trackTenant('t_mcp_lots_' + generateId())
    const otherTenant = trackTenant('t_mcp_other_' + generateId())
    const matId = seedStock(t, { quantity: 100, unit: 'kg', unitCost: 5 })
    const fgId = seedStock(t, { category: 'FINISHED', quantity: 0, unit: 'pcs' })
    const bomId = seedBom(t, fgId)
    const wo1 = seedPlannedWO(t, {
      quantity: 10,
      bomId,
      materials: [{ materialId: matId, requiredQty: 20, unit: 'kg' }],
    })
    const woOther = seedPlannedWO(otherTenant, { quantity: 5 })

    const { server: sUser, tools: userTools } = fakeMcpServer()
    registerProductionTools(sUser, t, 'u-user', 'USER')
    const { server: sAdmin, tools: adminTools } = fakeMcpServer()
    registerProductionTools(sAdmin, t, 'u-admin', 'ADMIN')

    // cross-tenant ถูกบล็อก (isMaster: false)
    const crossRes = parseMcp(await adminTools['record_work_order_lot']({ wo_id: woOther.id, good_qty: 1 }))
    expect(crossRes.success).toBe(false)

    expect(parseMcp(await userTools['update_work_order_status']({ wo_id: wo1.wo_number, status: 'IN_PROGRESS' })).success).toBe(true)

    const lot1 = parseMcp(await userTools['record_work_order_lot']({ wo_id: wo1.wo_number, good_qty: 6, scrap_qty: 1 }))
    expect(lot1.success).toBe(true)
    expect(lot1.lotNumber).toBe(`${wo1.wo_number}-L01`)
    expect(lot1.remainingQty).toBe(3)
    expect(lot1.autoCompleted).toBe(false)

    // USER ปิด short ไม่ได้ (RBAC)
    const userClose = parseMcp(await userTools['update_work_order_status']({ wo_id: wo1.id, status: 'COMPLETED', close_short: true }))
    expect(userClose.success).toBe(false)
    expect(userClose.message).toContain('สิทธิ์')

    // ADMIN ปิด short ได้
    const adminClose = parseMcp(await adminTools['update_work_order_status']({ wo_id: wo1.id, status: 'COMPLETED', close_short: true }))
    expect(adminClose.success).toBe(true)
    expect(adminClose.status).toBe('COMPLETED')

    // ตรวจ auto-complete 100% ผ่าน MCP บน WO อีกใบ
    const wo2 = seedPlannedWO(t, {
      quantity: 4,
      bomId,
      materials: [{ materialId: matId, requiredQty: 8, unit: 'kg' }],
    })
    expect(parseMcp(await userTools['update_work_order_status']({ wo_id: wo2.id, status: 'IN_PROGRESS' })).success).toBe(true)
    const lotFull = parseMcp(await userTools['record_work_order_lot']({ wo_id: wo2.id, good_qty: 4 }))
    expect(lotFull.success).toBe(true)
    expect(lotFull.autoCompleted).toBe(true)
    expect(lotFull.status).toBe('COMPLETED')
  })
})
