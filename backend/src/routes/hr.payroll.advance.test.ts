import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import hrPayrollRouter from './hr.payroll.routes'
import { createTestUser } from '../test/testAuth'
import { seedChartOfAccounts } from '../config/chartOfAccounts'
import { getOrCreateAccount } from '../services/accounting.service'

// HR Phase 6 (ส่วนของ T0): รอบเงินเดือนหักเบิก/เงินยืมเอง, เพดาน ม.76, ลงบัญชีเครดิต 1115, ยกเลิกรอบคืนยอดค้าง
const app = express()
app.use(express.json())
app.use('/api/hr', authenticate, subscriptionGate('hr'))
app.use('/api/hr', hrPayrollRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_lines', 'journal_entries', 'advance_repayments', 'employee_advances', 'payroll_run_lines', 'payroll_runs', 'employees', 'accounts', 'tenant_subscriptions', 'users']) {
      db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t)
    }
  }
})

function setup() {
  const u = createTestUser({ role: 'ADMIN' })
  tenants.push(u.tenantId)
  seedChartOfAccounts(u.tenantId)
  const cash = getOrCreateAccount(u.tenantId, '1101')
  const empId = generateId()
  db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, last_name, employment_type, base_wage, sso_enrolled, start_date, status)
              VALUES (?, ?, 'EMP-001', 'มาลี', 'ขยัน', 'MONTHLY', 10000, 0, '2026-01-01', 'ACTIVE')`).run(empId, u.tenantId)
  const adv = (kind: 'ADVANCE' | 'LOAN', amount: number, installment: number, status = 'ACTIVE') => {
    const id = generateId()
    db.prepare(`INSERT INTO employee_advances (id, tenant_id, employee_id, kind, amount, installments, installment_amount, start_period, status, disbursed_on, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, '2026-10', ?, '2026-10-05', ?, ?)`)
      .run(id, u.tenantId, empId, kind, amount, Math.ceil(amount / installment), installment, status, new Date().toISOString(), new Date().toISOString())
    return id
  }
  return { auth: { Authorization: `Bearer ${u.token}` }, tenantId: u.tenantId, cash, empId, adv }
}

describe('HR Phase 6 — หักเบิก/เงินยืมในรอบเงินเดือน', () => {
  it('หักเอง + เพดานเงินยืม 10% + ลงบัญชี Cr 1115 + ปิดรายการที่หมด + void คืนยอด', async () => {
    const { auth, tenantId, cash, adv } = setup()
    const advanceId = adv('ADVANCE', 2000, 2000)
    const loanId = adv('LOAN', 3000, 1500) // ผ่อนงวดละ 1,500 แต่เพดาน 10% ของ 10,000 = 1,000
    adv('LOAN', 500, 500, 'APPROVED')       // ยังไม่จ่ายเงิน → ห้ามหัก

    const created = await request(app).post('/api/hr/payroll-runs').set(auth).send({ period: '2026-10' })
    expect(created.status).toBe(201)
    const line = created.body.lines[0]
    expect(line.inputs.advanceDeductions).toEqual([
      { advance_id: advanceId, kind: 'ADVANCE', name: 'หักเบิกล่วงหน้า', amount: 2000 },
      { advance_id: loanId, kind: 'LOAN', name: 'หักผ่อนเงินยืม', amount: 1000 },
    ])
    expect(line.advance_deduction).toBe(3000)
    expect(line.other_deduction).toBe(3000)
    expect(line.net).toBe(7000)

    // แก้มือเกินเพดาน ม.76 → 400
    const over = await request(app).put(`/api/hr/payroll-runs/${created.body.id}/lines/${line.id}`).set(auth)
      .send({ advanceDeductions: [{ advance_id: advanceId, amount: 2000 }, { advance_id: loanId, amount: 1200 }] })
    expect(over.status).toBe(400)
    expect(over.body.error).toContain('10%')

    expect((await request(app).post(`/api/hr/payroll-runs/${created.body.id}/approve`).set(auth).send({})).status).toBe(200)
    const posted = await request(app).post(`/api/hr/payroll-runs/${created.body.id}/post`).set(auth).send({ payNow: true, payAccountId: cash })
    expect(posted.status).toBe(200)

    const jeId = posted.body.accrual_je_ids[0]
    const lines = db.prepare(`SELECT a.code, jl.debit, jl.credit FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id = ? AND jl.tenant_id = ?`).all(jeId, tenantId) as any[]
    expect(lines.find(l => l.code === '1115')).toMatchObject({ debit: 0, credit: 3000 })
    expect(lines.find(l => l.code === '2107')).toMatchObject({ credit: 7000 })
    const status = (id: string) => (db.prepare('SELECT status FROM employee_advances WHERE id = ?').get(id) as any).status
    expect(status(advanceId)).toBe('CLOSED')
    expect(status(loanId)).toBe('ACTIVE')

    const voided = await request(app).post(`/api/hr/payroll-runs/${created.body.id}/void`).set(auth).send({})
    expect(voided.status).toBe(200)
    expect(status(advanceId)).toBe('ACTIVE')
    expect((db.prepare('SELECT COUNT(*) n FROM advance_repayments WHERE tenant_id = ?').get(tenantId) as any).n).toBe(0)

    // รอบใหม่หลัง void หักใหม่ได้เท่าเดิม
    const again = await request(app).post('/api/hr/payroll-runs').set(auth).send({ period: '2026-10' })
    expect(again.body.lines[0].advance_deduction).toBe(3000)
  })
})
