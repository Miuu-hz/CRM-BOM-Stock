import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import posRouter from './pos.routes'
import { createTestUser } from '../../test/testAuth'
import { ACC } from '../../config/accountCodes'

const app = express()
app.use(express.json())
app.use('/api/sales', authenticate, posRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_lines', 'journal_entries', 'pos_payments', 'pos_bill_items', 'pos_running_bills',
                       'pos_shift_cash_movements', 'pos_shifts', 'pos_menu_configs', 'stock_items', 'company_settings', 'accounts', 'users', 'document_sequences']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* no tenant_id column */ }
    }
  }
})

function newTenant() {
  const u = createTestUser()
  tenants.push(u.tenantId)
  db.prepare('INSERT INTO company_settings (tenant_id, pos_bom_deduct) VALUES (?, 0)').run(u.tenantId)
  return u
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

describe('POS Shift: carry-over closing cash and cash expenses breakdown', () => {
  it('prefills opening cash from previous shift and deducts cash expenses on close', async () => {
    const u = newTenant()
    const t = u.tenantId

    // 1. Initially when no shift closed, last-closed returns 0
    const initialLastClosed = await request(app).get('/api/sales/pos-shifts/last-closed').set(auth(u.token))
    expect(initialLastClosed.status).toBe(200)
    expect(initialLastClosed.body.suggested_opening_cash).toBe(0)

    // 2. Open first shift with 500 opening cash
    const openRes1 = await request(app).post('/api/sales/pos-shifts/open').set(auth(u.token)).send({
      opening_cash: 500,
      notes: 'กะเช้า',
    })
    expect(openRes1.status).toBe(200)
    const shift1Id = openRes1.body.data.id

    // 3. Close first shift with closing cash 450 (no sales, 50 difference)
    const closeRes1 = await request(app).post(`/api/sales/pos-shifts/${shift1Id}/close`).set(auth(u.token)).send({
      closing_cash_counted: 450,
      notes: 'ปิดกะเช้า',
    })
    expect(closeRes1.status).toBe(200)
    expect(closeRes1.body.data.closing_cash_counted).toBe(450)

    // 4. Check last-closed endpoint: should now return suggested_opening_cash = 450
    const lastClosedRes = await request(app).get('/api/sales/pos-shifts/last-closed').set(auth(u.token))
    expect(lastClosedRes.status).toBe(200)
    expect(lastClosedRes.body.suggested_opening_cash).toBe(450)
    expect(lastClosedRes.body.data.closing_cash_counted).toBe(450)

    // 5. Check GET /pos-shifts/current when no shift open: should also return suggested_opening_cash = 450
    const curRes = await request(app).get('/api/sales/pos-shifts/current').set(auth(u.token))
    expect(curRes.status).toBe(200)
    expect(curRes.body.data).toBeNull()
    expect(curRes.body.suggested_opening_cash).toBe(450)

    // 6. Open second shift with 450
    const openRes2 = await request(app).post('/api/sales/pos-shifts/open').set(auth(u.token)).send({
      opening_cash: 450,
      notes: 'กะบ่าย',
    })
    expect(openRes2.status).toBe(200)
    const shift2Id = openRes2.body.data.id

    // 7. Close second shift with cash expenses breakdown:
    // Started with 450.
    // Expenses: ซื้อน้ำแข็ง 50, ซื้อของใช้ 100 (Total = 150).
    // Expected cash = 450 - 150 = 300.
    // Counted cash = 300.
    // cashDifference = 0 (ตรงเป๊ะ!).
    const closeRes2 = await request(app).post(`/api/sales/pos-shifts/${shift2Id}/close`).set(auth(u.token)).send({
      closing_cash_counted: 300,
      notes: 'ปิดกะบ่าย',
      cash_expenses: [
        { reason: 'ซื้อน้ำแข็ง', amount: 50 },
        { reason: 'ซื้อของใช้', amount: 100 },
      ],
    })
    expect(closeRes2.status).toBe(200)
    expect(closeRes2.body.data.expected_cash).toBe(300)
    expect(closeRes2.body.data.closing_cash_counted).toBe(300)
    expect(closeRes2.body.data.cash_difference).toBe(0)
    expect(closeRes2.body.data.paid_out).toBe(150)

    // 8. Verify pos_shift_cash_movements rows created
    const movements = db.prepare(`
      SELECT * FROM pos_shift_cash_movements
      WHERE tenant_id = ? AND shift_id = ?
      ORDER BY amount ASC
    `).all(t, shift2Id) as any[]
    expect(movements.length).toBe(2)
    expect(movements[0].type).toBe('PAID_OUT')
    expect(movements[0].reason).toBe('ซื้อน้ำแข็ง')
    expect(movements[0].amount).toBe(50)
    expect(movements[1].type).toBe('PAID_OUT')
    expect(movements[1].reason).toBe('ซื้อของใช้')
    expect(movements[1].amount).toBe(100)

    // 9. Verify journals created for movements (POS_CASH_MOVEMENT)
    const jvEntries = db.prepare(`
      SELECT * FROM journal_entries
      WHERE tenant_id = ? AND reference_type = 'POS_CASH_MOVEMENT'
    `).all(t) as any[]
    expect(jvEntries.length).toBe(2)

    // 10. Verify shift notes include the expense summary
    const shiftRow = db.prepare(`SELECT notes FROM pos_shifts WHERE id = ?`).get(shift2Id) as any
    expect(shiftRow.notes).toContain('ซื้อน้ำแข็ง')
    expect(shiftRow.notes).toContain('ซื้อของใช้')
  })
})
