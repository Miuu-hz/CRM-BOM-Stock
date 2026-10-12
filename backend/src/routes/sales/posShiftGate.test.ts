import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import posRouter from './pos.routes'
import posBillRouter from '../pos-bill.routes'
import { createTestUser } from '../../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/sales', authenticate, posRouter)
app.use('/api/pos', posBillRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_lines', 'journal_entries', 'pos_payments', 'pos_bill_items', 'pos_running_bills',
                       'pos_shifts', 'pos_menu_configs', 'stock_items', 'company_settings', 'accounts', 'users', 'document_sequences']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* no tenant_id column */ }
    }
  }
})

function newTenant() {
  const u = createTestUser()
  tenants.push(u.tenantId)
  // ไม่ตัดสต็อก — เทสนี้ดูเฉพาะเรื่องกะ
  db.prepare('INSERT INTO company_settings (tenant_id, pos_bom_deduct) VALUES (?, 0)').run(u.tenantId)
  return u
}

function seedShift(tenantId: string, openedAt = new Date().toISOString()) {
  const id = generateId()
  db.prepare(`INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, opening_cash, opened_by)
              VALUES (?, ?, ?, 'OPEN', ?, 0, 'tester')`).run(id, tenantId, 'SH-' + id.slice(0, 6), openedAt)
  return id
}

function seedBillWithItem(tenantId: string, shiftId: string | null) {
  const productId = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, unit, location, status)
              VALUES (?, ?, ?, 'P', 'FOOD', 'pcs', 'WH1', 'ACTIVE')`).run(productId, tenantId, productId)
  const menuId = generateId()
  db.prepare(`INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price) VALUES (?, ?, ?, 50)`)
    .run(menuId, tenantId, productId)
  const billId = generateId()
  db.prepare(`INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, created_by, shift_id)
              VALUES (?, ?, ?, 'B', 'OPEN', 'tester', ?)`).run(billId, tenantId, 'POS-T-' + billId.slice(0, 6), shiftId)
  db.prepare(`INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price)
              VALUES (?, ?, ?, ?, 'Item', 1, 50, 50)`).run(generateId(), tenantId, billId, menuId)
  return billId
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

describe('POS shift gate', () => {
  it('blocks create and pay with 403 SHIFT_NOT_OPEN when no shift is open', async () => {
    const u = newTenant()
    const create = await request(app).post('/api/pos/bills').set(auth(u.token)).send({})
    expect(create.status).toBe(403)
    expect(create.body.code).toBe('SHIFT_NOT_OPEN')

    const billId = seedBillWithItem(u.tenantId, null)
    const pay = await request(app).post(`/api/pos/bills/${billId}/pay`).set(auth(u.token)).send({ payment_method: 'CASH' })
    expect(pay.status).toBe(403)
    expect(pay.body.code).toBe('SHIFT_NOT_OPEN')
  })

  it('stale shift: blocks new bills (409 SHIFT_STALE) but still lets old bills be paid into it, then close', async () => {
    const u = newTenant()
    const staleId = seedShift(u.tenantId, new Date(Date.now() - 2 * 86400_000).toISOString())
    const create = await request(app).post('/api/pos/bills').set(auth(u.token)).send({})
    expect(create.status).toBe(409)
    expect(create.body.code).toBe('SHIFT_STALE')

    const billId = seedBillWithItem(u.tenantId, null)
    const cur = await request(app).get('/api/sales/pos-shifts/current').set(auth(u.token))
    expect(cur.body.data.stale).toBe(true)
    expect(cur.body.data.opened_by).toBe('tester')

    const pay = await request(app).post(`/api/pos/bills/${billId}/pay`).set(auth(u.token)).send({ payment_method: 'CASH' })
    expect(pay.status).toBe(200)
    expect((db.prepare('SELECT shift_id FROM pos_running_bills WHERE id = ?').get(billId) as any).shift_id).toBe(staleId)

    const close = await request(app).post(`/api/sales/pos-shifts/${staleId}/close`).set(auth(u.token)).send({ closing_cash_counted: 50 })
    expect(close.status).toBe(200)
  })

  it('creates a bill tagged to the open shift, and pay re-tags an old bill to the current shift', async () => {
    const u = newTenant()
    const shiftId = seedShift(u.tenantId)
    const create = await request(app).post('/api/pos/bills').set(auth(u.token)).send({})
    expect(create.status).toBe(200)
    const created = db.prepare('SELECT shift_id FROM pos_running_bills WHERE id = ?').get(create.body.data.id) as any
    expect(created.shift_id).toBe(shiftId)

    const billId = seedBillWithItem(u.tenantId, 'old-shift-id')
    const pay = await request(app).post(`/api/pos/bills/${billId}/pay`).set(auth(u.token)).send({ payment_method: 'CASH' })
    expect(pay.status).toBe(200)
    const paid = db.prepare('SELECT status, shift_id FROM pos_running_bills WHERE id = ?').get(billId) as any
    expect(paid).toEqual({ status: 'PAID', shift_id: shiftId })

    const again = await request(app).post(`/api/pos/bills/${billId}/pay`).set(auth(u.token)).send({ payment_method: 'CASH' })
    expect(again.status).toBe(404)
    expect((db.prepare('SELECT COUNT(*) c FROM pos_payments WHERE bill_id = ?').get(billId) as any).c).toBe(1)
  })

  it('refuses to close a shift while any OPEN bill exists (incl. NULL shift_id), closes once cleared', async () => {
    const u = newTenant()
    const shiftId = seedShift(u.tenantId)
    const billId = seedBillWithItem(u.tenantId, null)

    const blocked = await request(app).post(`/api/sales/pos-shifts/${shiftId}/close`).set(auth(u.token)).send({ closing_cash_counted: 0 })
    expect(blocked.status).toBe(409)
    expect(blocked.body.code).toBe('SHIFT_HAS_OPEN_BILLS')
    expect(blocked.body.count).toBe(1)
    expect(blocked.body.open_bills).toEqual([{ id: billId, bill_number: expect.any(String) }])

    db.prepare(`UPDATE pos_running_bills SET status = 'CANCELLED' WHERE id = ? AND tenant_id = ?`).run(billId, u.tenantId)
    const ok = await request(app).post(`/api/sales/pos-shifts/${shiftId}/close`).set(auth(u.token)).send({ closing_cash_counted: 0 })
    expect(ok.status).toBe(200)
  })

  it('validates opening/closing cash and stores it rounded to 2 decimals', async () => {
    const u = newTenant()
    for (const bad of [-1, 'abc', 'Infinity', null]) {
      const r = await request(app).post('/api/sales/pos-shifts/open').set(auth(u.token)).send({ opening_cash: bad })
      expect(r.status).toBe(400)
    }
    const r = await request(app).post('/api/sales/pos-shifts/open').set(auth(u.token)).send({ opening_cash: '100.456' })
    expect(r.status).toBe(200)
    expect((db.prepare('SELECT opening_cash FROM pos_shifts WHERE id = ?').get(r.body.data.id) as any).opening_cash).toBe(100.46)

    const bad = await request(app).post(`/api/sales/pos-shifts/${r.body.data.id}/close`).set(auth(u.token)).send({ closing_cash_counted: -5 })
    expect(bad.status).toBe(400)
  })

  it('isolates tenants: B open shift does not let A sell; closing A leaves B untouched', async () => {
    const a = newTenant()
    const b = newTenant()
    const shiftB = seedShift(b.tenantId)
    seedBillWithItem(b.tenantId, shiftB) // B's open bill must not block A's close

    const createA = await request(app).post('/api/pos/bills').set(auth(a.token)).send({})
    expect(createA.status).toBe(403)

    const shiftA = seedShift(a.tenantId)
    const closeA = await request(app).post(`/api/sales/pos-shifts/${shiftA}/close`).set(auth(a.token)).send({ closing_cash_counted: 0 })
    expect(closeA.status).toBe(200)
    expect((db.prepare('SELECT status FROM pos_shifts WHERE id = ?').get(shiftB) as any).status).toBe('OPEN')

    // A cannot close B's shift
    const cross = await request(app).post(`/api/sales/pos-shifts/${shiftB}/close`).set(auth(a.token)).send({ closing_cash_counted: 0 })
    expect(cross.status).toBe(404)
  })
})
