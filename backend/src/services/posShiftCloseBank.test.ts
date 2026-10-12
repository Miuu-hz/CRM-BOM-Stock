import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import posRouter from '../routes/sales/pos.routes'
import posAccountingService from './pos-accounting.service'
import { buildShiftCloseJournal } from './posShiftRepair.service'
import { ACC } from '../config/accountCodes'
import { createTestUser } from '../test/testAuth'

/**
 * 2026-10-08: ปิดกะลงขาธนาคารแยกตามบัญชีธนาคารที่รับเงินจริง (pos_payments.bank_account_id → GL ย่อย)
 * ไม่ได้เลือกบัญชี = 1102 · void หลังปิดกะคืนจากบัญชีเดียวกัน
 */
const app = express()
app.use(express.json())
app.use('/api/sales', authenticate, posRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_lines', 'journal_entries', 'vat_entries', 'tax_transactions', 'tax_periods', 'pos_payments',
                       'pos_running_bills', 'pos_shifts', 'bank_accounts', 'accounts', 'users', 'document_sequences']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* ไม่มีคอลัมน์ tenant_id */ }
    }
  }
})

const newTenant = () => { const t = 'tn' + generateId().slice(0, 12); tenants.push(t); return t }

function seedBank(tenantId: string, code: string) {
  const accountId = generateId()
  db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, level, is_active)
              VALUES (?, ?, ?, ?, 'ASSET', 'CASH', 'DEBIT', 3, 1)`).run(accountId, tenantId, code, 'ธนาคาร ' + code)
  const bankId = generateId()
  db.prepare(`INSERT INTO bank_accounts (id, tenant_id, bank_name, account_name, account_number, account_id)
              VALUES (?, ?, 'B', 'A', ?, ?)`).run(bankId, tenantId, code, accountId)
  return { bankId, accountId }
}

function seedShift(tenantId: string) {
  const id = generateId()
  const openedAt = new Date(Date.now() - 3600_000).toISOString()
  db.prepare(`INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, opening_cash, opened_by)
              VALUES (?, ?, ?, 'OPEN', ?, 0, 'tester')`).run(id, tenantId, 'SH-' + id.slice(0, 6), openedAt)
  return { id, opened_at: openedAt }
}

type Pay = { method: string; amount: number; bankId?: string | null }
function seedBill(tenantId: string, shiftId: string, total: number, pays: Pay[]) {
  const billId = generateId()
  db.prepare(`INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, subtotal, tax_rate, tax_amount,
                total_amount, shift_id, closed_at) VALUES (?, ?, ?, 'T', 'PAID', ?, 0, 0, ?, ?, ?)`)
    .run(billId, tenantId, 'B-' + billId.slice(0, 6), total, total, shiftId, new Date().toISOString())
  for (const p of pays) {
    db.prepare(`INSERT INTO pos_payments (id, tenant_id, bill_id, payment_method, amount, received_by, bank_account_id)
                VALUES (?, ?, ?, ?, ?, 'tester', ?)`).run(generateId(), tenantId, billId, p.method, p.amount, p.bankId ?? null)
  }
  return billId
}

const close = (tenantId: string, shift: { id: string; opened_at: string }, total: number, bank: number) =>
  buildShiftCloseJournal({ tenant_id: tenantId, id: shift.id, opened_at: shift.opened_at, shift_number: 'SH',
    total_revenue: total, bank_revenue: bank, cash_difference: 0 })!

const debitOf = (lines: any[], key: { code?: string; accountId?: string }) =>
  lines.filter(l => (key.code ? l.code === key.code : l.accountId === key.accountId)).reduce((a, l) => a + (l.debit || 0), 0)

const sumDr = (lines: any[]) => Math.round(lines.reduce((a, l) => a + (l.debit || 0), 0) * 100) / 100
const sumCr = (lines: any[]) => Math.round(lines.reduce((a, l) => a + (l.credit || 0), 0) * 100) / 100

describe('buildShiftCloseJournal — bank lines per bank account', () => {
  it('QR to bank A + transfer to bank B → two bank lines, no 1102, balanced', () => {
    const t = newTenant()
    const a = seedBank(t, '1102-01'); const b = seedBank(t, '1102-02')
    const s = seedShift(t)
    seedBill(t, s.id, 100, [{ method: 'QR_CODE', amount: 100, bankId: a.bankId }])
    seedBill(t, s.id, 50, [{ method: 'TRANSFER', amount: 50, bankId: b.bankId }])
    seedBill(t, s.id, 30, [{ method: 'CASH', amount: 30 }])
    const j = close(t, s, 180, 150)
    expect(debitOf(j.lines, { accountId: a.accountId })).toBe(100)
    expect(debitOf(j.lines, { accountId: b.accountId })).toBe(50)
    expect(debitOf(j.lines, { code: ACC.BANK })).toBe(0)
    expect(debitOf(j.lines, { code: ACC.CASH })).toBe(30)
    expect(sumDr(j.lines)).toBe(sumCr(j.lines))
  })

  it('null bank_account_id (and card) → 1102', () => {
    const t = newTenant()
    const s = seedShift(t)
    seedBill(t, s.id, 40, [{ method: 'QR_CODE', amount: 40 }])
    seedBill(t, s.id, 60, [{ method: 'CREDIT_CARD', amount: 60 }])
    const j = close(t, s, 100, 100)
    expect(debitOf(j.lines, { code: ACC.BANK })).toBe(100)
    expect(sumDr(j.lines)).toBe(sumCr(j.lines))
  })

  it('multi-payment bill: split cash/QR(bank A)/transfer(null) not double counted', () => {
    const t = newTenant()
    const a = seedBank(t, '1102-01')
    const s = seedShift(t)
    // บิล 100 จ่ายเกิน (รวม 120) → แบ่งตามสัดส่วน: cash 20, A 50, 1102 30
    seedBill(t, s.id, 100, [
      { method: 'CASH', amount: 24 }, { method: 'QR_CODE', amount: 30, bankId: a.bankId },
      { method: 'QR_CODE', amount: 30, bankId: a.bankId }, { method: 'TRANSFER', amount: 36 },
    ])
    const j = close(t, s, 100, 80)
    expect(debitOf(j.lines, { accountId: a.accountId })).toBe(50)
    expect(debitOf(j.lines, { code: ACC.BANK })).toBe(30)
    expect(debitOf(j.lines, { code: ACC.CASH })).toBe(20)
    expect(sumDr(j.lines)).toBe(sumCr(j.lines))
  })

  it('tenant isolation: another tenant bank account id / bills are ignored', () => {
    const t1 = newTenant(); const t2 = newTenant()
    const foreign = seedBank(t2, '1102-09')
    const s = seedShift(t1)
    seedBill(t1, s.id, 70, [{ method: 'QR_CODE', amount: 70, bankId: foreign.bankId }])
    // บิลของ tenant อื่นที่อ้าง shift id เดียวกัน ต้องไม่ถูกนับ
    seedBill(t2, s.id, 999, [{ method: 'QR_CODE', amount: 999, bankId: foreign.bankId }])
    const j = close(t1, s, 70, 70)
    expect(debitOf(j.lines, { code: ACC.BANK })).toBe(70)
    expect(j.lines.some(l => l.accountId === foreign.accountId)).toBe(false)
  })
})

describe('POST /pos-shifts/:id/close + void after close', () => {
  it('posts per-bank lines; void after close credits the same bank GL', async () => {
    const u = createTestUser(); tenants.push(u.tenantId)
    const t = u.tenantId
    const a = seedBank(t, '1102-01'); const b = seedBank(t, '1102-02')
    const s = seedShift(t)
    const billA = seedBill(t, s.id, 100, [{ method: 'QR_CODE', amount: 100, bankId: a.bankId }])
    seedBill(t, s.id, 50, [{ method: 'TRANSFER', amount: 50, bankId: b.bankId }])
    for (const [id, total] of [[billA, 100]] as const) {
      posAccountingService.recordSale({ id, bill_number: 'B', display_name: 'T', subtotal: total, service_charge_amount: 0,
        discount_amount: 0, extra_charge_amount: 0, tax_rate: 0, tax_amount: 0, total_amount: total } as any,
        { payment_method: 'QR_CODE', amount: total } as any, t, 'u1')
    }
    const res = await request(app).post(`/api/sales/pos-shifts/${s.id}/close`)
      .set({ Authorization: `Bearer ${u.token}` }).send({ closing_cash_counted: 0 })
    expect(res.status).toBe(200)
    const lines = db.prepare(`SELECT l.account_id, l.debit FROM journal_lines l
      JOIN journal_entries j ON j.id = l.journal_entry_id WHERE j.tenant_id = ? AND j.reference_type = 'POS_SHIFT_CLOSE'`)
      .all(t) as { account_id: string; debit: number }[]
    expect(lines.find(l => l.account_id === a.accountId)?.debit).toBe(100)
    expect(lines.find(l => l.account_id === b.accountId)?.debit).toBe(50)

    posAccountingService.recordCancelledSale({ id: billA, bill_number: 'B', display_name: 'T', total_amount: 100 } as any, t, 'u1')
    const back = db.prepare(`SELECT l.account_id, l.credit FROM journal_lines l
      JOIN journal_entries j ON j.id = l.journal_entry_id WHERE j.tenant_id = ? AND j.reference_type = 'POS_CANCEL'`)
      .all(t) as { account_id: string; credit: number }[]
    expect(back.find(l => l.account_id === a.accountId)?.credit).toBe(100)
  })
})
