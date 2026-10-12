import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import posRouter from './pos.routes'
import { createTestUser } from '../../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/sales', authenticate, posRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['pos_daily_sales_bills', 'pos_daily_sales', 'pos_payments', 'pos_bill_items', 'pos_running_bills',
                       'pos_menu_configs', 'stock_items', 'users', 'document_sequences']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* no tenant_id column */ }
    }
  }
})

function newTenant() {
  const u = createTestUser()
  tenants.push(u.tenantId)
  return u
}

const DAY = '2026-10-08'

/** บิล PAID 1 รายการ: เมนูไม่มีสูตร ผูก stock item unit_cost=costEach · payments = [method, amount][] */
function seedPaidBill(tenantId: string, closedAt: string, total: number, payments: [string, number][], costEach = 0, qty = 1) {
  const productId = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, unit, base_unit, unit_cost, location, status)
              VALUES (?, ?, ?, 'P', 'FOOD', 'pcs', 'pcs', ?, 'WH1', 'ACTIVE')`).run(productId, tenantId, productId, costEach)
  const menuId = generateId()
  db.prepare(`INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price) VALUES (?, ?, ?, ?)`)
    .run(menuId, tenantId, productId, total)
  const billId = generateId()
  db.prepare(`INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, created_by, closed_at, total_amount, subtotal)
              VALUES (?, ?, ?, 'B', 'PAID', 'tester', ?, ?, ?)`).run(billId, tenantId, 'POS-' + billId.slice(0, 8), closedAt, total, total)
  db.prepare(`INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price)
              VALUES (?, ?, ?, ?, 'Item', ?, ?, ?)`).run(generateId(), tenantId, billId, menuId, qty, total / qty, total)
  for (const [method, amount] of payments) {
    db.prepare(`INSERT INTO pos_payments (id, tenant_id, bill_id, payment_method, amount, received_by)
                VALUES (?, ?, ?, ?, ?, 'tester')`).run(generateId(), tenantId, billId, method, amount)
  }
  return billId
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

describe('POS daily sales (Z-report)', () => {
  it('sums every payment bucket (QR + transfer = bank), counts split bills once, buckets add to total', async () => {
    const u = newTenant()
    seedPaidBill(u.tenantId, `${DAY}T03:00:00.000Z`, 3000, [['QR_CODE', 3000]])
    seedPaidBill(u.tenantId, `${DAY}T04:00:00.000Z`, 2000, [['TRANSFER', 2000]])
    seedPaidBill(u.tenantId, `${DAY}T05:00:00.000Z`, 1500, [['CASH', 1000], ['CREDIT_CARD', 500]])
    seedPaidBill(u.tenantId, `${DAY}T06:00:00.000Z`, 100, []) // no payment row → other

    const res = await request(app).post('/api/sales/pos-daily-sales').set(auth(u.token)).send({ sales_date: DAY })
    expect(res.status).toBe(200)
    const d = res.body.data
    expect(d.total_revenue).toBe(6600)
    expect(d.bank_amount).toBe(5000)
    expect(d.cash_amount).toBe(1000)
    expect(d.other_amount).toBe(600)
    expect(d.cash_amount + d.bank_amount + d.other_amount).toBe(d.total_revenue)
    expect(d.bill_count).toBe(4)
    const links = db.prepare('SELECT COUNT(*) c FROM pos_daily_sales_bills WHERE tenant_id = ?').get(u.tenantId) as any
    expect(links.c).toBe(4)
  })

  it('only takes bills whose Thai business date is sales_date; older pending bills close under their own date', async () => {
    const u = newTenant()
    seedPaidBill(u.tenantId, '2026-10-07T18:00:00.000Z', 100, [['CASH', 100]]) // = 01:00 08 Oct Thai → in
    seedPaidBill(u.tenantId, '2026-10-07T16:00:00.000Z', 200, [['CASH', 200]]) // = 23:00 07 Oct Thai → out
    seedPaidBill(u.tenantId, '2026-09-01T05:00:00.000Z', 400, [['CASH', 400]]) // old pending → out

    const res = await request(app).post('/api/sales/pos-daily-sales').set(auth(u.token)).send({ sales_date: DAY })
    expect(res.status).toBe(200)
    expect(res.body.data.total_revenue).toBe(100)
    expect(res.body.data.bill_count).toBe(1)

    const prev = await request(app).post('/api/sales/pos-daily-sales').set(auth(u.token)).send({ sales_date: '2026-10-07' })
    expect(prev.body.data.total_revenue).toBe(200)

    const pending = await request(app).get('/api/sales/pos-daily-sales/pending-bills').set(auth(u.token))
    expect(pending.body.data.map((b: any) => b.total_amount)).toEqual([400])

    const dup = await request(app).post('/api/sales/pos-daily-sales').set(auth(u.token)).send({ sales_date: DAY })
    expect(dup.status).toBe(400)
    const bad = await request(app).post('/api/sales/pos-daily-sales').set(auth(u.token)).send({ sales_date: '8/10/2026' })
    expect(bad.status).toBe(400)
  })

  it('estimated COGS includes the no-recipe menu branch (product unit_cost × qty)', async () => {
    const u = newTenant()
    seedPaidBill(u.tenantId, `${DAY}T03:00:00.000Z`, 100, [['CASH', 100]], 12.5, 2)
    const res = await request(app).post('/api/sales/pos-daily-sales').set(auth(u.token)).send({ sales_date: DAY })
    expect(res.body.data.estimated_cogs).toBe(25)
    expect(res.body.data.net_profit).toBe(75)
  })

  it('tenant isolation: never picks up or exposes another tenant’s bills/summaries', async () => {
    const a = newTenant()
    const b = newTenant()
    seedPaidBill(a.tenantId, `${DAY}T03:00:00.000Z`, 100, [['CASH', 100]])
    seedPaidBill(b.tenantId, `${DAY}T03:00:00.000Z`, 999, [['QR_CODE', 999]])

    const resA = await request(app).post('/api/sales/pos-daily-sales').set(auth(a.token)).send({ sales_date: DAY })
    expect(resA.body.data.total_revenue).toBe(100)
    expect(resA.body.data.bank_amount).toBe(0)

    // B can still close the same date with only its own bill
    const resB = await request(app).post('/api/sales/pos-daily-sales').set(auth(b.token)).send({ sales_date: DAY })
    expect(resB.status).toBe(200)
    expect(resB.body.data.total_revenue).toBe(999)

    const cross = await request(app).get(`/api/sales/pos-daily-sales/${resA.body.data.id}`).set(auth(b.token))
    expect(cross.status).toBe(404)
    const listB = await request(app).get('/api/sales/pos-daily-sales').set(auth(b.token))
    expect(listB.body.data.map((s: any) => s.id)).toEqual([resB.body.data.id])
  })

  it('a bill voided after the summary is excluded and totals are recomputed on GET', async () => {
    const u = newTenant()
    seedPaidBill(u.tenantId, `${DAY}T03:00:00.000Z`, 300, [['CASH', 300]])
    const voided = seedPaidBill(u.tenantId, `${DAY}T04:00:00.000Z`, 200, [['QR_CODE', 200]])
    const created = await request(app).post('/api/sales/pos-daily-sales').set(auth(u.token)).send({ sales_date: DAY })
    expect(created.body.data.total_revenue).toBe(500)

    db.prepare(`UPDATE pos_running_bills SET status = 'VOID' WHERE id = ? AND tenant_id = ?`).run(voided, u.tenantId)

    const detail = await request(app).get(`/api/sales/pos-daily-sales/${created.body.data.id}`).set(auth(u.token))
    expect(detail.body.data.total_revenue).toBe(300)
    expect(detail.body.data.bank_amount).toBe(0)
    expect(detail.body.data.bill_count).toBe(1)
    expect(detail.body.data.bills).toHaveLength(1)
    expect(detail.body.data.excluded_bills).toEqual([{ id: voided, bill_number: expect.any(String), status: 'VOID' }])

    const list = await request(app).get('/api/sales/pos-daily-sales').set(auth(u.token))
    expect(list.body.data[0].bill_count).toBe(1)
    expect(list.body.data[0].voided_bill_count).toBe(1)
  })
})
