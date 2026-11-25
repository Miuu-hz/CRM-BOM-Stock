import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import salesOrdersRouter from '../routes/sales/salesOrders'
import workOrderRouter from '../routes/workOrder.routes'
import { createTestUser } from '../test/testAuth'
import { createWorkOrder, transitionWorkOrder } from './workOrderTransition.service'
import { planSalesOrderProduction, produceForSalesOrder } from './salesOrderProduction.service'

const app = express()
app.use(express.json())
app.use('/api/sales-orders', authenticate, salesOrdersRouter)
app.use('/api/work-orders', authenticate, workOrderRouter)

const trackedTenants: string[] = []
function trackTenant(t: string) {
  trackedTenants.push(t)
  return t
}

afterEach(() => {
  for (const t of trackedTenants.splice(0)) {
    db.prepare('DELETE FROM journal_lines WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM journal_entries WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_movements WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM work_order_materials WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM work_orders WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM delivery_order_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM delivery_orders WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM sales_order_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM sales_orders WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM bom_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM boms WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM unit_conversions WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM customers WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM company_settings WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM users WHERE tenant_id = ?').run(t)
  }
})

function seedCustomer(tenantId: string) {
  const id = generateId()
  const code = 'CUST-' + id.slice(0, 8)
  db.prepare(`
    INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, status)
    VALUES (?, ?, ?, 'ลูกค้าทดสอบ MTO', 'INDIVIDUAL', 'คุณทดสอบ', 'cust@test.com', '0812345678', 'กรุงเทพ', 'ACTIVE')
  `).run(id, tenantId, code)
  return { id, code }
}

function seedStockItem(tenantId: string, opts: {
  name: string
  category: string
  quantity: number
  unit: string
  baseUnit?: string
  displayUnit?: string
  sealedQty?: number
  unitCost?: number
}) {
  const id = generateId()
  const sku = 'SKU-' + id.slice(0, 8)
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, display_unit, sealed_qty, unit_cost, location, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WH1', 'ACTIVE')
  `).run(
    id, tenantId, sku, opts.name, opts.category, opts.quantity, opts.unit,
    opts.baseUnit || opts.unit, opts.displayUnit || null, opts.sealedQty || 0, opts.unitCost || 0
  )
  return { id, sku, name: opts.name }
}

function seedUnitConversion(tenantId: string, materialId: string, fromUnit: string, toUnit: string, factor: number) {
  const id = generateId()
  db.prepare(`
    INSERT INTO unit_conversions (id, tenant_id, material_id, from_unit, to_unit, conversion_factor, is_global, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
  `).run(id, tenantId, materialId, fromUnit, toUnit, factor)
  return id
}

function seedBom(tenantId: string, productId: string, opts: { isSemiFinished?: number; outputQty?: number; outputUnit?: string } = {}) {
  const id = generateId()
  db.prepare(`
    INSERT INTO boms (id, tenant_id, product_id, version, status, level, is_semi_finished, output_qty, output_unit, created_at, updated_at)
    VALUES (?, ?, ?, 'v1', 'ACTIVE', 0, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, tenantId, productId, opts.isSemiFinished ?? 0, opts.outputQty ?? 1, opts.outputUnit || null)
  return { id }
}

function seedBomItem(tenantId: string, bomId: string, opts: {
  itemType: string
  materialId: string
  childBomId?: string | null
  quantity: number
  unit: string
}) {
  const id = generateId()
  db.prepare(`
    INSERT INTO bom_items (id, tenant_id, bom_id, item_type, material_id, child_bom_id, quantity, unit, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(id, tenantId, bomId, opts.itemType, opts.materialId, opts.childBomId || null, opts.quantity, opts.unit)
  return id
}

function seedSalesOrder(
  tenantId: string,
  customerId: string,
  items: Array<{ stockItemId: string; quantity: number; unit: string; unitPrice: number }>
) {
  const id = generateId()
  const soNumber = formatDocumentNumber('SO', tenantId, 'SALES_ORDER', new Date().getFullYear(), 5)
  const now = new Date().toISOString()
  const subtotal = items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0)

  db.prepare(`
    INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, order_date, subtotal, discount_amount, tax_rate, tax_amount, total_amount, vat_inclusive, status, payment_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 0, 'DRAFT', 'UNPAID', ?, ?)
  `).run(id, tenantId, soNumber, customerId, now, subtotal, subtotal, now, now)

  for (const it of items) {
    db.prepare(`
      INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, quantity, unit, unit_price, total_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(generateId(), tenantId, id, it.stockItemId, it.quantity, it.unit, it.unitPrice, it.quantity * it.unitPrice)
  }

  return { id, soNumber }
}

function seedPlannedWO(tenantId: string, bomId: string) {
  return createWorkOrder(tenantId, { bomId, productName: 'หมอนอิง', quantity: 1, unit: 'pcs', materials: [] }, { notify: false }).id
}

describe('SO Make-To-Order (ผลิตอัตโนมัติจากใบขาย)', () => {
  it('(1) SO สินค้าขาดสต็อก + BOM วัตถุดิบ 2 ตัว (1 ตัวแปลงหน่วย in2 → m) + BOM ลูกกึ่งสำเร็จรูป: plan.ok true → produce → WO COMPLETED ผูก sales_order_id, movements OUT/IN ครบ, ยืนยัน SO ผ่าน', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const T = trackTenant(user.tenantId)
    const customer = seedCustomer(T)

    // สินค้าสำเร็จรูป (FG): มีสต็อก 0
    const fg = seedStockItem(T, { name: 'ผ้าปูที่นอน MTO', category: 'FINISHED', quantity: 0, unit: 'pcs', baseUnit: 'pcs', unitCost: 200 })

    // วัตถุดิบ 1: ผ้าฝ้าย หน่วยสต็อก m, ใน BOM ใช้ in2 (1 in2 = 0.0254 m)
    const raw1 = seedStockItem(T, { name: 'ผ้าฝ้ายทอ', category: 'RAW', quantity: 100, unit: 'm', baseUnit: 'm', unitCost: 40 })
    seedUnitConversion(T, raw1.id, 'in2', 'm', 0.0254)

    // วัตถุดิบ 2: ด้ายเย็บผ้า หน่วย m
    const raw2 = seedStockItem(T, { name: 'ด้ายเย็บผ้า', category: 'RAW', quantity: 500, unit: 'm', baseUnit: 'm', unitCost: 1 })

    // วัตถุดิบ 3: เม็ดใยสังเคราะห์ สำหรับทำแผ่นใยกึ่งสำเร็จรูป
    const raw3 = seedStockItem(T, { name: 'เม็ดใยสังเคราะห์', category: 'RAW', quantity: 50, unit: 'kg', baseUnit: 'kg', unitCost: 80 })

    // สินค้ากึ่งสำเร็จรูป (WIP): แผ่นใยสังเคราะห์ มี BOM ลูก
    const semi = seedStockItem(T, { name: 'แผ่นใยสังเคราะห์กึ่งสำเร็จ', category: 'WIP', quantity: 0, unit: 'pcs', baseUnit: 'pcs', unitCost: 100 })
    const childBom = seedBom(T, semi.id, { isSemiFinished: 1, outputQty: 1, outputUnit: 'pcs' })
    seedBomItem(T, childBom.id, { itemType: 'MATERIAL', materialId: raw3.id, quantity: 2, unit: 'kg' })

    // BOM หลักของสินค้าสำเร็จรูป
    const parentBom = seedBom(T, fg.id, { isSemiFinished: 0, outputQty: 1, outputUnit: 'pcs' })
    seedBomItem(T, parentBom.id, { itemType: 'MATERIAL', materialId: raw1.id, quantity: 100, unit: 'in2' })
    seedBomItem(T, parentBom.id, { itemType: 'MATERIAL', materialId: raw2.id, quantity: 10, unit: 'm' })
    seedBomItem(T, parentBom.id, { itemType: 'CHILD_BOM', materialId: semi.id, childBomId: childBom.id, quantity: 1, unit: 'pcs' })

    // สร้าง SO สั่งซื้อ 2 ผืน
    const { id: soId, soNumber } = seedSalesOrder(T, customer.id, [{ stockItemId: fg.id, quantity: 2, unit: 'pcs', unitPrice: 500 }])

    // เรียก GET /api/sales-orders/:id/production-plan
    const planRes = await request(app)
      .get(`/api/sales-orders/${soId}/production-plan`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(planRes.status).toBe(200)
    expect(planRes.body.success).toBe(true)
    const plan = planRes.body.data
    expect(plan.ok).toBe(true)
    expect(plan.blockers).toHaveLength(0)
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0].stockItemId).toBe(fg.id)
    expect(plan.items[0].shortQty).toBe(2)
    expect(plan.items[0].produceQty).toBe(2)
    expect(plan.items[0].bomId).toBe(parentBom.id)
    expect(plan.items[0].problem).toBeNull()

    // ตรวจสอบ materials ที่แตกออกมา: raw1, raw2, raw3
    expect(plan.materials).toHaveLength(3)
    const mat1Plan = plan.materials.find((m: any) => m.materialId === raw1.id)
    expect(mat1Plan).toBeDefined()
    // 2 ผืน × 100 in2 × 0.0254 = 5.08 m
    expect(mat1Plan.requiredQty).toBeCloseTo(5.08, 2)
    expect(mat1Plan.unit).toBe('m')
    expect(mat1Plan.shortQty).toBe(0)

    const mat2Plan = plan.materials.find((m: any) => m.materialId === raw2.id)
    expect(mat2Plan).toBeDefined()
    // 2 ผืน × 10 m = 20 m
    expect(mat2Plan.requiredQty).toBe(20)
    expect(mat2Plan.shortQty).toBe(0)

    const mat3Plan = plan.materials.find((m: any) => m.materialId === raw3.id)
    expect(mat3Plan).toBeDefined()
    // 2 ผืน × 1 แผ่น × 2 kg = 4 kg
    expect(mat3Plan.requiredQty).toBe(4)
    expect(mat3Plan.shortQty).toBe(0)

    // สั่งผลิต shortfall: POST /api/sales-orders/:id/produce-shortfall
    const produceRes = await request(app)
      .post(`/api/sales-orders/${soId}/produce-shortfall`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(produceRes.status).toBe(200)
    expect(produceRes.body.success).toBe(true)
    const { workOrders } = produceRes.body.data
    expect(workOrders).toHaveLength(1)
    const wo = workOrders[0]
    expect(wo.status).toBe('COMPLETED')
    expect(wo.quantity).toBe(2)
    expect(wo.product_name).toBe(fg.name)

    // ตรวจสอบ work_orders ใน DB มี sales_order_id ผูกถูกต้อง
    const woInDb = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(wo.id) as any
    expect(woInDb.sales_order_id).toBe(soId)
    expect(woInDb.status).toBe('COMPLETED')

    // ตรวจสอบ stock_movements: OUT สำหรับวัตถุดิบที่อ้างถึง WO นี้ (แบบล็อต)
    const outMovements = db.prepare(
      "SELECT * FROM stock_movements WHERE tenant_id = ? AND reference = ? AND type = 'OUT'"
    ).all(T, `WO: ${wo.wo_number} (${wo.wo_number}-L01)`) as any[]
    expect(outMovements.length).toBeGreaterThanOrEqual(3)

    // ตรวจสอบ stock_movements: IN สำหรับสินค้าสำเร็จรูปที่อ้างถึง WO นี้ (แบบล็อต)
    const inMovements = db.prepare(
      "SELECT * FROM stock_movements WHERE tenant_id = ? AND reference = ? AND type = 'IN'"
    ).all(T, `WO: ${wo.wo_number} (${wo.wo_number}-L01)`) as any[]
    expect(inMovements).toHaveLength(1)
    expect(inMovements[0].stock_item_id).toBe(fg.id)
    expect(inMovements[0].quantity).toBe(2)

    // สต็อกสินค้าสำเร็จรูปเพิ่มเป็น 2
    const fgStock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(fg.id) as any
    expect(fgStock.quantity).toBe(2)

    // ยืนยันคำสั่งขาย (SO confirm) ต้องผ่าน!
    const confirmRes = await request(app)
      .put(`/api/sales-orders/${soId}/status`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ status: 'CONFIRMED' })

    expect(confirmRes.status).toBe(200)
    expect(confirmRes.body.success).toBe(true)
    expect(confirmRes.body.data.status).toBe('CONFIRMED')

    // หลังยืนยัน SO สต็อกสินค้าสำเร็จรูปถูกตัดไป 2 เหลือ 0
    const fgStockAfterConfirm = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(fg.id) as any
    expect(fgStockAfterConfirm.quantity).toBe(0)

    // ตรวจสอบ GET /api/sales-orders/:id มีฟิลด์ work_orders
    const soDetailRes = await request(app)
      .get(`/api/sales-orders/${soId}`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(soDetailRes.status).toBe(200)
    expect(soDetailRes.body.data.work_orders).toHaveLength(1)
    expect(soDetailRes.body.data.work_orders[0].id).toBe(wo.id)
    expect(soDetailRes.body.data.work_orders[0].wo_number).toBe(wo.wo_number)

    // ตรวจสอบ GET /api/work-orders และ GET /api/work-orders/:id มี sales_order_id และ so_number
    const woDetailRes = await request(app)
      .get(`/api/work-orders/${wo.id}`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(woDetailRes.status).toBe(200)
    expect(woDetailRes.body.data.sales_order_id).toBe(soId)
    expect(woDetailRes.body.data.so_number).toBe(soNumber)

    const woListRes = await request(app)
      .get('/api/work-orders')
      .set('Authorization', `Bearer ${user.token}`)

    expect(woListRes.status).toBe(200)
    const foundWo = woListRes.body.data.find((w: any) => w.id === wo.id)
    expect(foundWo).toBeDefined()
    expect(foundWo.sales_order_id).toBe(soId)
    expect(foundWo.so_number).toBe(soNumber)
  })

  it('(2) วัตถุดิบขาดสต็อก: plan.ok false, produce ตอบ 400, ไม่เขียนอะไรลง DB (ไม่มี WO, สต็อกคงเดิม)', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const T = trackTenant(user.tenantId)
    const customer = seedCustomer(T)

    const fg = seedStockItem(T, { name: 'เก้าอี้ไม้สัก', category: 'FINISHED', quantity: 0, unit: 'pcs' })
    const rawWood = seedStockItem(T, { name: 'ไม้สักแปรรูป', category: 'RAW', quantity: 1, unit: 'pcs' }) // ขาด: มีแค่ 1

    const bom = seedBom(T, fg.id)
    seedBomItem(T, bom.id, { itemType: 'MATERIAL', materialId: rawWood.id, quantity: 5, unit: 'pcs' })

    const { id: soId } = seedSalesOrder(T, customer.id, [{ stockItemId: fg.id, quantity: 2, unit: 'pcs', unitPrice: 1000 }])

    // ตรวจแผนการผลิต: plan.ok ต้องเป็น false
    const plan = planSalesOrderProduction(T, soId)
    expect(plan.ok).toBe(false)
    expect(plan.blockers.length).toBeGreaterThan(0)
    expect(plan.materials[0].shortQty).toBe(9) // ต้องการ 10 มี 1 ขาด 9

    // ยิง POST /api/sales-orders/:id/produce-shortfall ต้องตอบ 400
    const res = await request(app)
      .post(`/api/sales-orders/${soId}/produce-shortfall`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/สต็อกไม่เพียงพอ/)

    // ตรวจสอบว่าไม่มี WO ถูกสร้างขึ้น และสต็อกไม่เปลี่ยน
    const woCount = db.prepare('SELECT COUNT(*) as c FROM work_orders WHERE sales_order_id = ?').get(soId) as any
    expect(woCount.c).toBe(0)

    const rawStock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(rawWood.id) as any
    expect(rawStock.quantity).toBe(1)

    const fgStock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(fg.id) as any
    expect(fgStock.quantity).toBe(0)
  })

  it('(3) สินค้าไม่มีสูตร BOM: plan.ok false, problem แจ้งไม่มีสูตร และมี blocker', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const T = trackTenant(user.tenantId)
    const customer = seedCustomer(T)

    // สินค้าสำเร็จรูปที่ไม่มี BOM
    const fgNoBom = seedStockItem(T, { name: 'สินค้าสั่งทำพิเศษไร้สูตร', category: 'FINISHED', quantity: 0, unit: 'pcs' })
    const { id: soId } = seedSalesOrder(T, customer.id, [{ stockItemId: fgNoBom.id, quantity: 1, unit: 'pcs', unitPrice: 200 }])

    const plan = planSalesOrderProduction(T, soId)
    expect(plan.ok).toBe(false)
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0].bomId).toBeNull()
    expect(plan.items[0].problem).toBe('ไม่มีสูตรการผลิต (BOM) ที่ใช้งาน')
    expect(plan.blockers).toContain(`สินค้า "${fgNoBom.name}": ไม่มีสูตรการผลิต (BOM) ที่ใช้งาน`)

    // สั่งผลิตต้อง fail 400
    const res = await request(app)
      .post(`/api/sales-orders/${soId}/produce-shortfall`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/ไม่มีสูตรการผลิต/)
  })

  it('Confirm SO ที่สินค้าขาดสต็อกตอบ 400 พร้อม code: INSUFFICIENT_STOCK', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const T = trackTenant(user.tenantId)
    const customer = seedCustomer(T)

    const fg = seedStockItem(T, { name: 'โต๊ะกาแฟ', category: 'FINISHED', quantity: 1, unit: 'pcs' })
    const { id: soId } = seedSalesOrder(T, customer.id, [{ stockItemId: fg.id, quantity: 5, unit: 'pcs', unitPrice: 1500 }])

    const res = await request(app)
      .put(`/api/sales-orders/${soId}/status`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ status: 'CONFIRMED' })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.code).toBe('INSUFFICIENT_STOCK')
    expect(res.body.message).toMatch(/สต็อกไม่เพียงพอ: โต๊ะกาแฟ: ต้องการ 5 pcs มีในสต็อก 1 pcs/)
  })

  it('RBAC: ผู้ใช้ทั่วไป (USER) โดน 403 ตอนสั่งผลิต shortfall', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const T = trackTenant(admin.tenantId)
    const staff = createTestUser({ role: 'USER', tenantId: T })
    const customer = seedCustomer(T)

    const fg = seedStockItem(T, { name: 'หมอนอิง', category: 'FINISHED', quantity: 0, unit: 'pcs' })
    const { id: soId } = seedSalesOrder(T, customer.id, [{ stockItemId: fg.id, quantity: 1, unit: 'pcs', unitPrice: 100 }])

    const res = await request(app)
      .post(`/api/sales-orders/${soId}/produce-shortfall`)
      .set('Authorization', `Bearer ${staff.token}`)

    expect(res.status).toBe(403)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/ไม่มีสิทธิ์สั่งผลิต/)
  })

  it('RBAC: USER แผนก PRODUCTION สั่งผลิตจากใบขายได้จนปิดงาน · แผนกอื่นไม่ได้ · ปิดใบสั่งผลิตตรงๆ ยังไม่ได้', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const T = trackTenant(admin.tenantId)
    const staff = createTestUser({ role: 'USER', tenantId: T })
    const setDepts = (d: string[]) => db.prepare('UPDATE users SET departments = ? WHERE id = ?').run(JSON.stringify(d), staff.userId)
    const customer = seedCustomer(T)
    const raw = seedStockItem(T, { name: 'ใยโพลี', category: 'RAW', quantity: 10, unit: 'kg' })
    const fg = seedStockItem(T, { name: 'หมอนอิง', category: 'FINISHED', quantity: 0, unit: 'pcs' })
    const bom = seedBom(T, fg.id, { outputQty: 1, outputUnit: 'pcs' })
    seedBomItem(T, bom.id, { itemType: 'MATERIAL', materialId: raw.id, quantity: 1, unit: 'kg' })
    const { id: soId } = seedSalesOrder(T, customer.id, [{ stockItemId: fg.id, quantity: 2, unit: 'pcs', unitPrice: 100 }])
    const produce = () => request(app).post(`/api/sales-orders/${soId}/produce-shortfall`).set('Authorization', `Bearer ${staff.token}`)

    setDepts(['SALES', 'STOCK'])
    expect((await produce()).status).toBe(403)

    setDepts(['PRODUCTION', 'SALES', 'STOCK'])
    const res = await produce()
    expect(res.body.message).toBeUndefined()
    expect(res.status).toBe(200)
    expect(res.body.data.workOrders[0].status).toBe('COMPLETED')

    const woId = seedPlannedWO(T, bom.id)
    transitionWorkOrder(T, woId, 'PLANNED', { role: 'ADMIN', isMaster: false })
    transitionWorkOrder(T, woId, 'IN_PROGRESS', { role: 'ADMIN', isMaster: false })
    expect((await request(app).put(`/api/work-orders/${woId}/status`).set('Authorization', `Bearer ${staff.token}`).send({ status: 'COMPLETED' })).status).toBe(403)
    expect((await request(app).put(`/api/work-orders/${woId}/status`).set('Authorization', `Bearer ${staff.token}`).send({ status: 'CANCELLED' })).status).toBe(403)

    expect(() => transitionWorkOrder(T, woId, 'CANCELLED', { role: 'USER', isMaster: false, canComplete: true })).toThrow(/ไม่มีสิทธิ์ยกเลิก/)
  })
})
