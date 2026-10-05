import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import subcontractRouter from './subcontract.routes'

const app = express()
app.use(express.json())
app.use('/api/subcontracts', subcontractRouter)

/**
 * ตรวจ 7 ข้อที่แก้ 2026-10-05 (ดู project_erp_subcontract_fixes_20261005):
 * 1. cancel ต้องบล็อกถ้าวัตถุดิบยังค้างอยู่ที่ผู้รับเหมา
 * 2. จ่ายครบ+บิลครบ แต่วัตถุดิบยังค้าง ต้องไม่ SETTLE (ไม่งั้นรับของไม่ได้อีกตลอดไป)
 * 3. แถวซ้ำ stock_item_id เดียวกันต้องไม่ทำสต็อกติดลบ (issue + receipt) + double-pay ห้ามจ่ายเกิน labor_amount
 * 4. รับของเกิน agreed_qty ต้องถูกบล็อก (ไม่มี tolerance ในโค้ดเดิม)
 * 5. แก้ไขสัญญา (PUT) ต้องบล็อกถ้าสถานะไม่ใช่ OPEN แล้ว (วัตถุดิบออกไปแล้ว)
 * 6. มูลค่าวัตถุดิบที่ใช้ไปตอนรับของ ต้องถูกบวกเข้า work_orders.actual_cost
 * 7. journal ต้อง debit=credit ทุกใบ และบัญชี 1112 ต้องเป็น 0 หลังรับของครบ
 */

function seedStockItem(tenantId: string, qty = 100, unitCost = 10) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status, unit_cost)
    VALUES (?, ?, ?, 'วัตถุดิบทดสอบ', 'RAW', ?, 'pcs', 'pcs', 'WH1', 'ACTIVE', ?)
  `).run(id, tenantId, 'MAT-' + id.slice(0, 6), qty, unitCost)
  return id
}

function seedSupplier(tenantId: string) {
  const id = generateId()
  db.prepare(`INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'ผู้รับเหมาทดสอบ', 'C')`)
    .run(id, tenantId, 'SUP-' + id.slice(0, 6))
  return id
}

function seedWorkOrder(tenantId: string) {
  const id = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO work_orders (id, tenant_id, wo_number, product_name, quantity, status, actual_cost, created_at, updated_at)
    VALUES (?, ?, ?, 'สินค้าทดสอบ', 10, 'IN_PROGRESS', 0, ?, ?)
  `).run(id, tenantId, 'WO-' + id.slice(0, 6), now, now)
  return id
}

function seedOutsourceContract(tenantId: string, workOrderId: string, supplierId: string, opts: { agreedQty?: number; ratePerUnit?: number } = {}) {
  const id = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO wo_subcontracts
      (id, tenant_id, contract_number, work_order_id, supplier_id, supplier_name, contract_type,
       rate_per_unit, agreed_qty, wht_rate, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'ผู้รับเหมาทดสอบ', 'OUTSOURCE', ?, ?, 3, ?, ?)
  `).run(id, tenantId, formatDocumentNumber('SC', tenantId, 'SUBCONTRACT', undefined, 5), workOrderId, supplierId,
    opts.ratePerUnit ?? 20, opts.agreedQty ?? 10, now, now)
  return id
}

function get1112Balance(tenantId: string): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS bal
    FROM journal_lines l
    JOIN accounts a ON l.account_id = a.id
    JOIN journal_entries e ON l.journal_entry_id = e.id
    WHERE e.tenant_id = ? AND a.code = '1112'
  `).get(tenantId) as any
  return row?.bal ?? 0
}

function assertJournalsBalance(tenantId: string) {
  const rows = db.prepare(`SELECT id, total_debit, total_credit FROM journal_entries WHERE tenant_id = ?`).all(tenantId) as any[]
  for (const r of rows) {
    expect(r.total_debit).toBeCloseTo(r.total_credit, 2)
    const lineSum = db.prepare(`SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c FROM journal_lines WHERE journal_entry_id = ?`).get(r.id) as any
    expect(lineSum.d).toBeCloseTo(lineSum.c, 2)
  }
}

describe('Fix 1: cancel ต้องบล็อกถ้าวัตถุดิบยังค้างอยู่ที่ผู้รับเหมา', () => {
  it('ส่งวัตถุดิบไปแล้วยังไม่รับคืน -> cancel ต้องโดน 400 ไม่ใช่ 200', async () => {
    const user = createTestUser({ role: 'MASTER' })
    const supplierId = seedSupplier(user.tenantId)
    const woId = seedWorkOrder(user.tenantId)
    const stockId = seedStockItem(user.tenantId, 100, 10)
    const contractId = seedOutsourceContract(user.tenantId, woId, supplierId)

    const issueRes = await request(app).post(`/api/subcontracts/${contractId}/issue-materials`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ items: [{ stock_item_id: stockId, quantity: 20 }] })
    expect(issueRes.status).toBe(201)

    const cancelRes = await request(app).post(`/api/subcontracts/${contractId}/cancel`)
      .set('Authorization', `Bearer ${user.token}`).send()

    expect(cancelRes.status).toBe(400)
    expect((db.prepare('SELECT status FROM wo_subcontracts WHERE id = ?').get(contractId) as any).status)
      .not.toBe('CANCELLED')
  })

  it('ยังไม่ส่งวัตถุดิบเลย (OPEN, ไม่มี billed_qty) -> cancel ได้ตามปกติ', async () => {
    const user = createTestUser({ role: 'MASTER' })
    const supplierId = seedSupplier(user.tenantId)
    const woId = seedWorkOrder(user.tenantId)
    const contractId = seedOutsourceContract(user.tenantId, woId, supplierId)

    const res = await request(app).post(`/api/subcontracts/${contractId}/cancel`)
      .set('Authorization', `Bearer ${user.token}`).send()

    expect(res.status).toBe(200)
    expect((db.prepare('SELECT status FROM wo_subcontracts WHERE id = ?').get(contractId) as any).status).toBe('CANCELLED')
  })

  it('ส่งวัตถุดิบแล้วรับคืนหมดแล้ว (ไม่มีค้าง) -> cancel ได้', async () => {
    const user = createTestUser({ role: 'MASTER' })
    const supplierId = seedSupplier(user.tenantId)
    const woId = seedWorkOrder(user.tenantId)
    const stockId = seedStockItem(user.tenantId, 100, 10)
    const contractId = seedOutsourceContract(user.tenantId, woId, supplierId)

    await request(app).post(`/api/subcontracts/${contractId}/issue-materials`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ items: [{ stock_item_id: stockId, quantity: 20 }] })

    // รับของคืนหมด (เคลียร์วัตถุดิบ 20 ชิ้นออกจาก subcon_stock ทั้งหมดผ่าน returned_qty)
    const recvRes = await request(app).post(`/api/subcontracts/${contractId}/receipts`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ received_qty: 0, materials: [{ stock_item_id: stockId, returned_qty: 20 }] })
    expect(recvRes.status).toBe(201)

    const cancelRes = await request(app).post(`/api/subcontracts/${contractId}/cancel`)
      .set('Authorization', `Bearer ${user.token}`).send()
    expect(cancelRes.status).toBe(200)
  })
})

describe('Fix 2: จ่ายครบ+บิลครบ แต่วัตถุดิบยังค้าง ต้องไม่ SETTLE', () => {
  it('billed_qty เต็ม + จ่ายเต็ม + ยังมี subcon_stock ค้าง -> status ต้องไม่ใช่ SETTLED และรับของยังได้ต่อ', async () => {
    const user = createTestUser({ role: 'MASTER' })
    const supplierId = seedSupplier(user.tenantId)
    const woId = seedWorkOrder(user.tenantId)
    const stockId = seedStockItem(user.tenantId, 100, 10)
    const contractId = seedOutsourceContract(user.tenantId, woId, supplierId, { agreedQty: 10, ratePerUnit: 20 })

    await request(app).post(`/api/subcontracts/${contractId}/issue-materials`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ items: [{ stock_item_id: stockId, quantity: 50 }] })

    // simulate QC billing ครบ agreed_qty (ปกติ hook มาจาก qc.routes.ts, ที่นี่ตั้งตรงแทน)
    const now = new Date().toISOString()
    db.prepare(`UPDATE wo_subcontracts SET billed_qty = agreed_qty, labor_amount = agreed_qty * rate_per_unit, updated_at = ? WHERE id = ?`)
      .run(now, contractId)

    const payRes = await request(app).post(`/api/subcontracts/${contractId}/pay`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ payment_method: 'CASH' })
    expect(payRes.status).toBe(200)

    const afterPay = db.prepare('SELECT status FROM wo_subcontracts WHERE id = ?').get(contractId) as any
    expect(afterPay.status).not.toBe('SETTLED')

    // รับของ (เคลียร์วัตถุดิบที่ค้าง) ต้องยังใช้งานได้ ไม่ถูกปฏิเสธเพราะ SETTLED ไปแล้ว
    const recvRes = await request(app).post(`/api/subcontracts/${contractId}/receipts`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ received_qty: 10, materials: [{ stock_item_id: stockId, consumed_qty: 50 }] })
    expect(recvRes.status).toBe(201)

    const afterReceipt = db.prepare('SELECT status FROM wo_subcontracts WHERE id = ?').get(contractId) as any
    expect(afterReceipt.status).toBe('SETTLED')
  })
})

describe('Fix 3a: แถวซ้ำ stock_item_id เดียวกันต้องไม่ทำสต็อกติดลบ — issue', () => {
  it('ส่งวัตถุดิบ 2 แถว item เดียวกัน รวมกันเกินสต็อก -> ต้องถูกบล็อกทั้งหมด (ไม่ใช่ติดลบ)', async () => {
    const user = createTestUser({ role: 'MASTER' })
    const supplierId = seedSupplier(user.tenantId)
    const woId = seedWorkOrder(user.tenantId)
    const stockId = seedStockItem(user.tenantId, 5, 10) // มีแค่ 5
    const contractId = seedOutsourceContract(user.tenantId, woId, supplierId)

    const res = await request(app).post(`/api/subcontracts/${contractId}/issue-materials`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ items: [{ stock_item_id: stockId, quantity: 3 }, { stock_item_id: stockId, quantity: 3 }] }) // รวม 6 > 5

    expect(res.status).toBe(400)
    const stockAfter = (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockId) as any).quantity
    expect(stockAfter).toBe(5) // ต้องไม่ขยับเลย (transaction rollback ทั้งหมด)
    expect(stockAfter).toBeGreaterThanOrEqual(0)
  })

  it('แถวซ้ำที่รวมกันยังไม่เกินสต็อก -> ผ่านได้ และสต็อกลดถูกต้อง (ไม่ลดซ้ำ)', async () => {
    const user = createTestUser({ role: 'MASTER' })
    const supplierId = seedSupplier(user.tenantId)
    const woId = seedWorkOrder(user.tenantId)
    const stockId = seedStockItem(user.tenantId, 10, 10)
    const contractId = seedOutsourceContract(user.tenantId, woId, supplierId)

    const res = await request(app).post(`/api/subcontracts/${contractId}/issue-materials`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ items: [{ stock_item_id: stockId, quantity: 3 }, { stock_item_id: stockId, quantity: 3 }] }) // รวม 6 <= 10

    expect(res.status).toBe(201)
    const stockAfter = (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockId) as any).quantity
    expect(stockAfter).toBe(4) // 10 - 6
  })
})

describe('Fix 3b: แถวซ้ำ stock_item_id เดียวกันต้องไม่ทำสต็อกติดลบ — receipt (เคลียร์ subcon_stock)', () => {
  it('รับของ 2 แถว item เดียวกัน รวมกันเกินยอดค้างที่ผู้รับเหมา -> ต้องถูกบล็อกทั้งหมด', async () => {
    const user = createTestUser({ role: 'MASTER' })
    const supplierId = seedSupplier(user.tenantId)
    const woId = seedWorkOrder(user.tenantId)
    const stockId = seedStockItem(user.tenantId, 100, 10)
    const contractId = seedOutsourceContract(user.tenantId, woId, supplierId)

    await request(app).post(`/api/subcontracts/${contractId}/issue-materials`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ items: [{ stock_item_id: stockId, quantity: 10 }] }) // ค้างที่ผู้รับเหมา 10

    const res = await request(app).post(`/api/subcontracts/${contractId}/receipts`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        received_qty: 0,
        materials: [
          { stock_item_id: stockId, consumed_qty: 6 },
          { stock_item_id: stockId, consumed_qty: 6 }, // รวม 12 > ค้าง 10
        ],
      })

    expect(res.status).toBe(400)
    const subconStock = db.prepare('SELECT quantity FROM subcon_stock WHERE tenant_id = ? AND stock_item_id = ?')
      .get(user.tenantId, stockId) as any
    expect(subconStock.quantity).toBe(10) // ต้องไม่ขยับ (rollback)
    expect(subconStock.quantity).toBeGreaterThanOrEqual(0)
  })
})

describe('Fix 3c: double pay ห้ามจ่ายเกิน labor_amount', () => {
  it('ยิง /pay ซ้อนกัน (Promise.all) ด้วยยอดเต็มทั้งคู่ -> รวมจ่ายต้องไม่เกิน labor_amount และมีแค่ครั้งเดียวที่สำเร็จ', async () => {
    const user = createTestUser({ role: 'MASTER' })
    const supplierId = seedSupplier(user.tenantId)
    const woId = seedWorkOrder(user.tenantId)
    const contractId = seedOutsourceContract(user.tenantId, woId, supplierId, { agreedQty: 10, ratePerUnit: 100 })
    db.prepare(`UPDATE wo_subcontracts SET billed_qty = 10, labor_amount = 1000 WHERE id = ?`).run(contractId)

    const [r1, r2] = await Promise.all([
      request(app).post(`/api/subcontracts/${contractId}/pay`).set('Authorization', `Bearer ${user.token}`).send({ payment_method: 'CASH', amount: 1000 }),
      request(app).post(`/api/subcontracts/${contractId}/pay`).set('Authorization', `Bearer ${user.token}`).send({ payment_method: 'CASH', amount: 1000 }),
    ])

    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual([200, 400]) // ต้องสำเร็จแค่ 1 ครั้ง
    const contract = db.prepare('SELECT paid_amount FROM wo_subcontracts WHERE id = ?').get(contractId) as any
    expect(contract.paid_amount).toBeLessThanOrEqual(1000.01)
    expect(contract.paid_amount).toBeCloseTo(1000, 2)
  })
})

describe('Fix 4: รับของเกิน agreed_qty ต้องถูกบล็อก', () => {
  it('received_qty สะสมเกิน agreed_qty -> 400 (ไม่มี tolerance)', async () => {
    const user = createTestUser({ role: 'MASTER' })
    const supplierId = seedSupplier(user.tenantId)
    const woId = seedWorkOrder(user.tenantId)
    const contractId = seedOutsourceContract(user.tenantId, woId, supplierId, { agreedQty: 10 })

    const res = await request(app).post(`/api/subcontracts/${contractId}/receipts`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ received_qty: 11 }) // agreed = 10

    expect(res.status).toBe(400)
    const contract = db.prepare('SELECT received_qty, status FROM wo_subcontracts WHERE id = ?').get(contractId) as any
    expect(contract.received_qty).toBe(0)
  })

  it('received_qty สะสม = agreed_qty พอดี -> ผ่านได้ และสถานะเป็น RECEIVED', async () => {
    const user = createTestUser({ role: 'MASTER' })
    const supplierId = seedSupplier(user.tenantId)
    const woId = seedWorkOrder(user.tenantId)
    const contractId = seedOutsourceContract(user.tenantId, woId, supplierId, { agreedQty: 10 })

    const res = await request(app).post(`/api/subcontracts/${contractId}/receipts`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ received_qty: 10 })

    expect(res.status).toBe(201)
    const contract = db.prepare('SELECT received_qty, status FROM wo_subcontracts WHERE id = ?').get(contractId) as any
    expect(contract.received_qty).toBe(10)
    expect(contract.status).toBe('RECEIVED')
  })
})

describe('Fix 5: PUT /:id ต้องบล็อกถ้าสถานะไม่ใช่ OPEN แล้ว', () => {
  it('ส่งวัตถุดิบไปแล้ว (MATERIAL_SENT, billed_qty ยังเป็น 0) -> แก้ agreed_qty/rate_per_unit ไม่ได้', async () => {
    const user = createTestUser({ role: 'MASTER' })
    const supplierId = seedSupplier(user.tenantId)
    const woId = seedWorkOrder(user.tenantId)
    const stockId = seedStockItem(user.tenantId, 100, 10)
    const contractId = seedOutsourceContract(user.tenantId, woId, supplierId, { agreedQty: 10, ratePerUnit: 20 })

    await request(app).post(`/api/subcontracts/${contractId}/issue-materials`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ items: [{ stock_item_id: stockId, quantity: 5 }] })

    expect((db.prepare('SELECT status, billed_qty FROM wo_subcontracts WHERE id = ?').get(contractId) as any))
      .toMatchObject({ status: 'MATERIAL_SENT', billed_qty: 0 })

    const res = await request(app).put(`/api/subcontracts/${contractId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ agreed_qty: 999, rate_per_unit: 1 })

    expect(res.status).toBe(400)
    const contract = db.prepare('SELECT agreed_qty, rate_per_unit FROM wo_subcontracts WHERE id = ?').get(contractId) as any
    expect(contract.agreed_qty).toBe(10)
    expect(contract.rate_per_unit).toBe(20)
  })

  it('ยังเป็น OPEN (ไม่มีวัตถุดิบออก) -> แก้ไขได้ตามปกติ', async () => {
    const user = createTestUser({ role: 'MASTER' })
    const supplierId = seedSupplier(user.tenantId)
    const woId = seedWorkOrder(user.tenantId)
    const contractId = seedOutsourceContract(user.tenantId, woId, supplierId, { agreedQty: 10, ratePerUnit: 20 })

    const res = await request(app).put(`/api/subcontracts/${contractId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ agreed_qty: 15 })

    expect(res.status).toBe(200)
    expect((db.prepare('SELECT agreed_qty FROM wo_subcontracts WHERE id = ?').get(contractId) as any).agreed_qty).toBe(15)
  })
})

describe('Fix 6: มูลค่าวัตถุดิบที่ใช้ไปตอนรับของ ต้องถูกบวกเข้า work_orders.actual_cost', () => {
  it('receipts ที่มี consumed_qty > 0 ต้องเพิ่ม actual_cost ของ WO ตามมูลค่าที่ใช้ไปจริง', async () => {
    const user = createTestUser({ role: 'MASTER' })
    const supplierId = seedSupplier(user.tenantId)
    const woId = seedWorkOrder(user.tenantId)
    const stockId = seedStockItem(user.tenantId, 100, 10) // unit cost 10
    const contractId = seedOutsourceContract(user.tenantId, woId, supplierId, { agreedQty: 10 })

    await request(app).post(`/api/subcontracts/${contractId}/issue-materials`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ items: [{ stock_item_id: stockId, quantity: 10 }] }) // มูลค่า 100

    const before = (db.prepare('SELECT actual_cost FROM work_orders WHERE id = ?').get(woId) as any).actual_cost

    const res = await request(app).post(`/api/subcontracts/${contractId}/receipts`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ received_qty: 10, materials: [{ stock_item_id: stockId, consumed_qty: 10 }] }) // ใช้ไปหมด = มูลค่า 100

    expect(res.status).toBe(201)
    const after = (db.prepare('SELECT actual_cost FROM work_orders WHERE id = ?').get(woId) as any).actual_cost
    expect(after - before).toBeCloseTo(100, 2)
  })
})

describe('Fix 7 / บัญชี: journal debit=credit ทุกใบ + 1112 nets to zero หลังรับของครบ', () => {
  it('ส่งวัตถุดิบ + รับของครบ (consumed ทั้งหมด) -> ทุก journal balance และ 1112 = 0', async () => {
    const user = createTestUser({ role: 'MASTER' })
    const supplierId = seedSupplier(user.tenantId)
    const woId = seedWorkOrder(user.tenantId)
    const stockId = seedStockItem(user.tenantId, 100, 10)
    const contractId = seedOutsourceContract(user.tenantId, woId, supplierId, { agreedQty: 10 })

    await request(app).post(`/api/subcontracts/${contractId}/issue-materials`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ items: [{ stock_item_id: stockId, quantity: 10 }] })

    await request(app).post(`/api/subcontracts/${contractId}/receipts`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ received_qty: 10, materials: [{ stock_item_id: stockId, consumed_qty: 10 }] })

    assertJournalsBalance(user.tenantId)
    expect(get1112Balance(user.tenantId)).toBeCloseTo(0, 2)
  })
})

describe('GET /subcon-stock ต้องโชว์ยอดติดลบด้วย (เดิมกรอง quantity > 0 ทิ้ง)', () => {
  it('แถวที่ quantity ติดลบ (ผิดปกติ) ต้องยังโผล่ในผลลัพธ์', async () => {
    const user = createTestUser({ role: 'MASTER' })
    const supplierId = seedSupplier(user.tenantId)
    const stockId = seedStockItem(user.tenantId, 100, 10)
    const rowId = generateId()
    db.prepare(`
      INSERT INTO subcon_stock (id, tenant_id, supplier_id, supplier_name, stock_item_id, item_name, unit, quantity, total_value, updated_at)
      VALUES (?, ?, ?, 'ผู้รับเหมาทดสอบ', ?, 'วัตถุดิบทดสอบ', 'pcs', -5, -50, ?)
    `).run(rowId, user.tenantId, supplierId, stockId, new Date().toISOString())

    const res = await request(app).get('/api/subcontracts/subcon-stock')
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(200)
    const found = (res.body.data as any[]).find(r => r.id === rowId)
    expect(found).toBeDefined()
    expect(found.quantity).toBe(-5)
  })
})
