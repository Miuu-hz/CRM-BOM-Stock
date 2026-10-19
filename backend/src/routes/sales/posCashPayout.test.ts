import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import posRouter from './pos.routes'
import { createTestUser } from '../../test/testAuth'
import { ACC } from '../../config/accountCodes'
import { paySupplier, listPosCashUnmatched, PurchaseBillingError } from '../../services/purchaseBilling.service'
import { reverseSupplierPayment } from '../purchase.routes'

/**
 * เงินจาก POS: เงินออกจากลิ้นชักก่อนมีบิล (เปิดกะด้วยเงินขาด / เงินออกระหว่างกะ) ลงพักไว้ที่ 1182
 * แล้วใบจ่ายเงินผู้ขายวิธี POS_CASH จับคู่ปิดยอดนั้น — เงินสดต้องถูกตัดครั้งเดียว
 */
const app = express()
app.use(express.json())
app.use('/api/sales', authenticate, posRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_lines', 'journal_entries', 'supplier_payments', 'suppliers', 'pos_shift_cash_movements', 'pos_shifts',
                       'company_settings', 'accounts', 'users', 'document_sequences']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* no tenant_id column */ }
    }
  }
})

function newTenant() {
  const u = createTestUser()
  tenants.push(u.tenantId)
  db.prepare('INSERT INTO company_settings (tenant_id, pos_bom_deduct) VALUES (?, 0)').run(u.tenantId)
  const supplierId = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'ร้านน้ำแข็ง', 'C')").run(supplierId, u.tenantId, supplierId)
  return { ...u, supplierId }
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

function balance(tenantId: string, code: string): number {
  const r = db.prepare(`
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS b FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id WHERE jl.tenant_id = ? AND a.code = ?
  `).get(tenantId, code) as { b: number }
  return Math.round(r.b * 100) / 100
}

async function openShortShift(u: ReturnType<typeof newTenant>) {
  const s1 = await request(app).post('/api/sales/pos-shifts/open').set(auth(u.token)).send({ opening_cash: 1495 })
  await request(app).post(`/api/sales/pos-shifts/${s1.body.data.id}/close`).set(auth(u.token)).send({ closing_cash_counted: 1495 })
  return request(app).post('/api/sales/pos-shifts/open').set(auth(u.token))
    .send({ opening_cash: 1162, opening_gap_reason: 'พนักงานเอาไปซื้อของ' })
}

describe('เงินจาก POS (1182)', () => {
  it('เปิดกะด้วยเงินขาด + หมายเหตุ → ลงพัก 1182 และไม่นับเป็นเงินออกของกะ', async () => {
    const u = newTenant()
    const res = await openShortShift(u)
    expect(res.status).toBe(200)
    expect(res.body.data.opening_gap).toBe(333)

    expect(balance(u.tenantId, ACC.POS_PAYOUT_PENDING)).toBe(333)
    expect(balance(u.tenantId, ACC.CASH)).toBe(-333)

    const cur = await request(app).get('/api/sales/pos-shifts/current').set(auth(u.token))
    expect(cur.body.data.live.paid_out).toBe(0) // เงินออกไปก่อนนับยอดเปิดกะ — ไม่กระทบยอดที่ควรมีตอนปิด

    const items = listPosCashUnmatched(u.tenantId)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: 'OPENING_GAP', remaining: 333, reason: 'พนักงานเอาไปซื้อของ' })
  })

  it('ไม่ใส่หมายเหตุ → ไม่ลงบัญชีอะไร (เหมือนเดิม)', async () => {
    const u = newTenant()
    const s1 = await request(app).post('/api/sales/pos-shifts/open').set(auth(u.token)).send({ opening_cash: 1495 })
    await request(app).post(`/api/sales/pos-shifts/${s1.body.data.id}/close`).set(auth(u.token)).send({ closing_cash_counted: 1495 })
    await request(app).post('/api/sales/pos-shifts/open').set(auth(u.token)).send({ opening_cash: 1162 })
    expect(listPosCashUnmatched(u.tenantId)).toHaveLength(0)
    expect(balance(u.tenantId, ACC.POS_PAYOUT_PENDING)).toBe(0)
  })

  it('จ่ายผู้ขายด้วยเงินจาก POS → ปิด 1182 ไม่หักเงินสดซ้ำ, ยกเลิกแล้วกลับมารอจับคู่', async () => {
    const u = newTenant()
    await openShortShift(u)
    const mv = listPosCashUnmatched(u.tenantId)[0]

    let caught: any
    try { paySupplier(u.tenantId, u.email, { supplierId: u.supplierId, amount: 400, paymentMethod: 'POS_CASH', posCashMovementId: mv.id }) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(PurchaseBillingError)
    expect(caught.code).toBe('POS_CASH_OVER')

    try { paySupplier(u.tenantId, u.email, { supplierId: u.supplierId, amount: 333, paymentMethod: 'POS_CASH' }) } catch (e) { caught = e }
    expect(caught.code).toBe('POS_CASH_REQUIRED')

    const pay = paySupplier(u.tenantId, u.email, { supplierId: u.supplierId, amount: 333, paymentMethod: 'POS_CASH', posCashMovementId: mv.id, bankAccountId: 'ignored' }) as any
    expect(pay.pos_cash_movement_id).toBe(mv.id)
    expect(pay.bank_account_id).toBeNull()
    expect(balance(u.tenantId, ACC.POS_PAYOUT_PENDING)).toBe(0)
    expect(balance(u.tenantId, ACC.CASH)).toBe(-333) // ตัดครั้งเดียวตอนเงินออกจากลิ้นชัก
    expect(listPosCashUnmatched(u.tenantId)).toHaveLength(0)

    reverseSupplierPayment(u.tenantId, pay, u.email, '2026-10-19')
    expect(balance(u.tenantId, ACC.POS_PAYOUT_PENDING)).toBe(333)
    expect(listPosCashUnmatched(u.tenantId)[0].remaining).toBe(333)
  })

  it('จ่ายบางส่วนได้ ยอดที่เหลือยังรอจับคู่', async () => {
    const u = newTenant()
    await openShortShift(u)
    const mv = listPosCashUnmatched(u.tenantId)[0]
    paySupplier(u.tenantId, u.email, { supplierId: u.supplierId, amount: 200, paymentMethod: 'POS_CASH', posCashMovementId: mv.id })
    expect(listPosCashUnmatched(u.tenantId)[0].remaining).toBe(133)
    expect(balance(u.tenantId, ACC.POS_PAYOUT_PENDING)).toBe(133)
  })
})
