import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import hrAdvanceRouter from './hr.advance.routes'
import { createTestUser } from '../test/testAuth'
import { seedChartOfAccounts } from '../config/chartOfAccounts'
import { getOrCreateAccount } from '../services/accounting.service'

const app = express()
app.use(express.json())
app.use('/api/hr', authenticate, subscriptionGate('hr'))
app.use('/api/hr', hrAdvanceRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of [
      'approval_logs',
      'approval_requests',
      'document_sequences',
      'journal_lines',
      'journal_entries',
      'advance_repayments',
      'employee_advances',
      'hr_settings',
      'tax_periods',
      'employees',
      'accounts',
      'tenant_subscriptions',
      'users',
    ]) {
      db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t)
    }
  }
})

function setup() {
  const admin = createTestUser({ role: 'ADMIN' })
  tenants.push(admin.tenantId)
  seedChartOfAccounts(admin.tenantId)
  const cash = getOrCreateAccount(admin.tenantId, '1101')
  const expense = getOrCreateAccount(admin.tenantId, '5301')
  const empId = generateId()
  db.prepare(`
    INSERT INTO employees (id, tenant_id, code, first_name, last_name, employment_type, base_wage, sso_enrolled, start_date, status)
    VALUES (?, ?, 'EMP-001', 'มาลี', 'ขยัน', 'MONTHLY', 10000, 0, '2026-01-01', 'ACTIVE')
  `).run(empId, admin.tenantId)
  return {
    admin,
    auth: { Authorization: `Bearer ${admin.token}` },
    tenantId: admin.tenantId,
    cash,
    expense,
    empId,
  }
}

describe('HR Phase 6 — เบิกล่วงหน้า / เงินยืม (A1–A7)', () => {
  it('1–4: สร้างคำขอ, ตรวจเพดาน ม.76 / ค่าจ้าง 1 เดือน / งวดย้อนหลัง, จ่ายเงินลงบัญชี Dr 1115 / Cr 1101, และดูประวัติหักรายงวด', async () => {
    const { auth, tenantId, cash, expense, empId } = setup()
    const currentPeriod = thaiDateStr().slice(0, 7)

    // 2. Validation: LOAN 3,000 × 2 (1,500 > 10% of 10,000) → 400 ม.76; ADVANCE 12,000 → 400; past start_period → 400
    const overLoan = await request(app).post('/api/hr/advances').set(auth).send({
      employee_id: empId,
      kind: 'LOAN',
      amount: 3000,
      installments: 2,
      start_period: currentPeriod,
    })
    expect(overLoan.status).toBe(400)
    expect(overLoan.body.success).toBe(false)
    expect(overLoan.body.message).toContain('ม.76')

    const overAdvance = await request(app).post('/api/hr/advances').set(auth).send({
      employee_id: empId,
      kind: 'ADVANCE',
      amount: 12000,
      start_period: currentPeriod,
    })
    expect(overAdvance.status).toBe(400)
    expect(overAdvance.body.success).toBe(false)

    const pastPeriod = await request(app).post('/api/hr/advances').set(auth).send({
      employee_id: empId,
      kind: 'LOAN',
      amount: 1000,
      installments: 1,
      start_period: '2020-01',
    })
    expect(pastPeriod.status).toBe(400)
    expect(pastPeriod.body.success).toBe(false)

    // 1. HR creates LOAN 3,000 × 3 → 201 PENDING, installment_amount 1000, approval_requests row with module_type = 'advance'
    const created = await request(app).post('/api/hr/advances').set(auth).send({
      employee_id: empId,
      kind: 'LOAN',
      amount: 3000,
      installments: 3,
      start_period: currentPeriod,
      reason: 'ซ่อมรถ',
    })
    expect(created.status).toBe(201)
    expect(created.body.success).toBe(true)
    const adv = created.body.data
    expect(adv).toMatchObject({
      employee_id: empId,
      employee_code: 'EMP-001',
      employee_name: 'มาลี ขยัน',
      kind: 'LOAN',
      amount: 3000,
      installments: 3,
      installment_amount: 1000,
      start_period: currentPeriod,
      reason: 'ซ่อมรถ',
      status: 'PENDING',
      repaid: 0,
      outstanding: 3000,
    })
    expect(adv.approval_request_id).toBeTruthy()

    const apr = db.prepare(
      'SELECT * FROM approval_requests WHERE id = ? AND tenant_id = ?'
    ).get(adv.approval_request_id, tenantId) as any
    expect(apr).toBeTruthy()
    expect(apr.module_type).toBe('advance')
    expect(apr.reference_type).toBe('employee_advances')
    expect(apr.reference_id).toBe(adv.id)
    expect(apr.status).toBe('PENDING')

    // 3. Disburse while PENDING → 409
    const disbPending = await request(app)
      .post(`/api/hr/advances/${adv.id}/disburse`)
      .set(auth)
      .send({ pay_account_id: cash, date: '2026-10-05' })
    expect(disbPending.status).toBe(409)

    // Set status APPROVED by SQL
    db.prepare("UPDATE employee_advances SET status = 'APPROVED' WHERE id = ? AND tenant_id = ?")
      .run(adv.id, tenantId)

    // Disburse to an EXPENSE account → 400
    const disbExpense = await request(app)
      .post(`/api/hr/advances/${adv.id}/disburse`)
      .set(auth)
      .send({ pay_account_id: expense, date: '2026-10-05' })
    expect(disbExpense.status).toBe(400)

    // Closed period → 400
    db.prepare(
      `INSERT INTO tax_periods (id, tenant_id, year, month, period_type, start_date, end_date, status)
       VALUES (?, ?, 2026, 9, 'MONTHLY', '2026-09-01', '2026-09-30', 'CLOSED')`
    ).run(generateId(), tenantId)

    const disbClosed = await request(app)
      .post(`/api/hr/advances/${adv.id}/disburse`)
      .set(auth)
      .send({ pay_account_id: cash, date: '2026-09-15' })
    expect(disbClosed.status).toBe(400)
    expect(disbClosed.body.message).toContain('ปิดแล้ว')

    // Disburse with 1101 cash account → ACTIVE, JE lines Dr 1115 3000 / Cr 1101 3000, is_posted = 1
    const disbursed = await request(app)
      .post(`/api/hr/advances/${adv.id}/disburse`)
      .set(auth)
      .send({ pay_account_id: cash, date: '2026-10-05' })
    expect(disbursed.status).toBe(200)
    expect(disbursed.body.data).toMatchObject({
      id: adv.id,
      status: 'ACTIVE',
      disbursed_on: '2026-10-05',
      repaid: 0,
      outstanding: 3000,
    })
    const jeId = disbursed.body.data.disburse_je_id
    expect(jeId).toBeTruthy()

    const je = db.prepare('SELECT * FROM journal_entries WHERE id = ? AND tenant_id = ?').get(jeId, tenantId) as any
    expect(je).toBeTruthy()
    expect(je.is_posted).toBe(1)
    expect(je.reference_type).toBe('EMPLOYEE_ADVANCE')
    expect(je.reference_id).toBe(adv.id)
    expect(je.description).toContain('EMP-001')
    expect(je.description).not.toContain('มาลี')

    const lines = db.prepare(
      `SELECT a.code, jl.debit, jl.credit
       FROM journal_lines jl
       JOIN accounts a ON a.id = jl.account_id
       WHERE jl.journal_entry_id = ? AND jl.tenant_id = ?`
    ).all(jeId, tenantId) as any[]
    expect(lines.find((l) => l.code === '1115')).toMatchObject({ debit: 3000, credit: 0 })
    expect(lines.find((l) => l.code === '1101')).toMatchObject({ debit: 0, credit: 3000 })

    // 4. Insert one advance_repayments row of 1000 by SQL → A2 shows repaid 1000, outstanding 2000, repayments length 1
    db.prepare(`
      INSERT INTO advance_repayments (id, tenant_id, advance_id, run_id, period, amount, created_at)
      VALUES (?, ?, ?, ?, '2026-10', 1000, ?)
    `).run(generateId(), tenantId, adv.id, generateId(), new Date().toISOString())

    const detail = await request(app).get(`/api/hr/advances/${adv.id}`).set(auth)
    expect(detail.status).toBe(200)
    expect(detail.body.data).toMatchObject({
      id: adv.id,
      repaid: 1000,
      outstanding: 2000,
    })
    expect(detail.body.data.repayments).toHaveLength(1)
    expect(detail.body.data.repayments[0]).toMatchObject({
      period: '2026-10',
      amount: 1000,
    })
  })

  it('5–6: สิทธิ์พนักงาน (/me/advances), ยกเลิกคำขอตนเอง, ห้ามดู/ยกเลิกของคนอื่น, และแยก tenant', async () => {
    const { auth, tenantId, empId } = setup()
    const currentPeriod = thaiDateStr().slice(0, 7)

    // HR creates an advance for empId (EMP-001)
    const emp1AdvRes = await request(app).post('/api/hr/advances').set(auth).send({
      employee_id: empId,
      kind: 'ADVANCE',
      amount: 2000,
      start_period: currentPeriod,
    })
    expect(emp1AdvRes.status).toBe(201)
    const emp1AdvId = emp1AdvRes.body.data.id

    // Create USER linked to a second employee (EMP-002)
    const user = createTestUser({ role: 'USER', tenantId })
    const userAuth = { Authorization: `Bearer ${user.token}` }
    const emp2Id = generateId()
    db.prepare(`
      INSERT INTO employees (id, tenant_id, code, first_name, last_name, employment_type, base_wage, sso_enrolled, start_date, status, user_id)
      VALUES (?, ?, 'EMP-002', 'สมชาย', 'ใจดี', 'MONTHLY', 15000, 0, '2026-01-01', 'ACTIVE', ?)
    `).run(emp2Id, tenantId, user.userId)

    // USER creates via /me/advances
    const myCreated = await request(app).post('/api/hr/me/advances').set(userAuth).send({
      kind: 'ADVANCE',
      amount: 1500,
      start_period: currentPeriod,
      reason: 'เบิกค่าจ้างล่วงหน้า',
    })
    expect(myCreated.status).toBe(201)
    const myAdvId = myCreated.body.data.id
    const myAprId = myCreated.body.data.approval_request_id
    expect(myCreated.body.data.employee_id).toBe(emp2Id)

    // Sees only own rows in /me/advances
    const myList = await request(app).get('/api/hr/me/advances').set(userAuth)
    expect(myList.status).toBe(200)
    expect(myList.body.data).toHaveLength(1)
    expect(myList.body.data[0].id).toBe(myAdvId)

    // Gets 403 on A1
    const a1Forbidden = await request(app).get('/api/hr/advances').set(userAuth)
    expect(a1Forbidden.status).toBe(403)

    // Cannot cancel someone else's (403)
    const cancelOther = await request(app).post(`/api/hr/advances/${emp1AdvId}/cancel`).set(userAuth)
    expect([403, 404]).toContain(cancelOther.status)

    // Can cancel own PENDING one -> approval request becomes CANCELLED
    const cancelOwn = await request(app).post(`/api/hr/advances/${myAdvId}/cancel`).set(userAuth)
    expect(cancelOwn.status).toBe(200)
    expect(cancelOwn.body.data.status).toBe('CANCELLED')

    const aprRow = db.prepare('SELECT status FROM approval_requests WHERE id = ? AND tenant_id = ?')
      .get(myAprId, tenantId) as any
    expect(aprRow.status).toBe('CANCELLED')

    // 6. Another tenant's advance id → 404
    const otherAdmin = createTestUser({ role: 'ADMIN' })
    tenants.push(otherAdmin.tenantId)
    const otherAuth = { Authorization: `Bearer ${otherAdmin.token}` }

    const crossGet = await request(app).get(`/api/hr/advances/${emp1AdvId}`).set(otherAuth)
    expect(crossGet.status).toBe(404)

    const crossCancel = await request(app).post(`/api/hr/advances/${emp1AdvId}/cancel`).set(otherAuth)
    expect(crossCancel.status).toBe(404)

    const crossDisburse = await request(app)
      .post(`/api/hr/advances/${emp1AdvId}/disburse`)
      .set(otherAuth)
      .send({ pay_account_id: 'any', date: '2026-10-05' })
    expect(crossDisburse.status).toBe(404)
  })

  it('7–9: ดอกเบี้ยเงินยืม (interest_rate / interest_amount / ม.76 รวมดอกเบี้ย) และรับคืนเงินสด (A8 repay-cash)', async () => {
    const { auth, tenantId, cash, expense, empId } = setup()
    const currentPeriod = thaiDateStr().slice(0, 7)

    // interest_rate: 20 → 400
    const badRate = await request(app).post('/api/hr/advances').set(auth).send({
      employee_id: empId,
      kind: 'LOAN',
      amount: 1000,
      installments: 2,
      interest_rate: 20,
      start_period: currentPeriod,
    })
    expect(badRate.status).toBe(400)
    expect(badRate.body.message).toBe('ดอกเบี้ยต้องอยู่ระหว่าง 0–15% ต่อปี')

    // เพดาน ม.76 ต้องตรวจจาก installment_amount ที่รวมดอกเบี้ยแล้ว:
    // พนักงาน MONTHLY 10,000 (10% = 1,000) ขอยืม 3,000 × 3 ที่ดอกเบี้ย 12% → installment_amount 1,030 > 1,000 → 400 ม.76
    const overWithInterest = await request(app).post('/api/hr/advances').set(auth).send({
      employee_id: empId,
      kind: 'LOAN',
      amount: 3000,
      installments: 3,
      interest_rate: 12,
      start_period: currentPeriod,
    })
    expect(overWithInterest.status).toBe(400)
    expect(overWithInterest.body.message).toContain('ม.76')

    // ปรับฐานเงินเดือนเป็น 12,000 (เพดาน 10% = 1,200) แล้วสร้าง LOAN 3,000 × 3 ดอกเบี้ย 12%
    db.prepare('UPDATE employees SET base_wage = 12000 WHERE id = ? AND tenant_id = ?').run(empId, tenantId)

    const loanRes = await request(app).post('/api/hr/advances').set(auth).send({
      employee_id: empId,
      kind: 'LOAN',
      amount: 3000,
      installments: 3,
      interest_rate: 12,
      start_period: currentPeriod,
      reason: 'ยืมมีดอกเบี้ย',
    })
    expect(loanRes.status).toBe(201)
    const loan = loanRes.body.data
    expect(loan).toMatchObject({
      kind: 'LOAN',
      amount: 3000,
      installments: 3,
      interest_rate: 12,
      interest_amount: 90,
      installment_amount: 1030,
      outstanding: 3090,
    })

    // ADVANCE with interest_rate: 12 → stored 0
    const advWithRate = await request(app).post('/api/hr/advances').set(auth).send({
      employee_id: empId,
      kind: 'ADVANCE',
      amount: 1000,
      interest_rate: 12,
      start_period: currentPeriod,
    })
    expect(advWithRate.status).toBe(201)
    expect(advWithRate.body.data).toMatchObject({
      kind: 'ADVANCE',
      interest_rate: 0,
      interest_amount: 0,
      installment_amount: 1000,
      outstanding: 1000,
    })

    // Self request via /me/advances with tenant hr_settings JSON {"loanInterestRatePct":6} → interest_rate 6
    db.prepare(
      'INSERT INTO hr_settings (tenant_id, settings, updated_at) VALUES (?, ?, ?)'
    ).run(tenantId, JSON.stringify({ loanInterestRatePct: 6 }), new Date().toISOString())

    const selfUser = createTestUser({ role: 'USER', tenantId })
    const selfAuth = { Authorization: `Bearer ${selfUser.token}` }
    const emp2Id = generateId()
    db.prepare(`
      INSERT INTO employees (id, tenant_id, code, first_name, last_name, employment_type, base_wage, sso_enrolled, start_date, status, user_id)
      VALUES (?, ?, 'EMP-002', 'สมชาย', 'ใจดี', 'MONTHLY', 15000, 0, '2026-01-01', 'ACTIVE', ?)
    `).run(emp2Id, tenantId, selfUser.userId)

    const selfLoanRes = await request(app).post('/api/hr/me/advances').set(selfAuth).send({
      kind: 'LOAN',
      amount: 3000,
      installments: 3,
      interest_rate: 15, // /me/advances ไม่รับฟิลด์นี้ ต้องใช้ค่าจาก hr_settings (6%)
      start_period: currentPeriod,
    })
    expect(selfLoanRes.status).toBe(201)
    expect(selfLoanRes.body.data).toMatchObject({
      kind: 'LOAN',
      interest_rate: 6,
      interest_amount: 45,
      installment_amount: 1015,
      outstanding: 3045,
    })

    // Set APPROVED by SQL + disburse → ACTIVE, outstanding 3090
    db.prepare("UPDATE employee_advances SET status = 'APPROVED' WHERE id = ? AND tenant_id = ?")
      .run(loan.id, tenantId)

    const disbursed = await request(app)
      .post(`/api/hr/advances/${loan.id}/disburse`)
      .set(auth)
      .send({ pay_account_id: cash, date: '2026-10-05' })
    expect(disbursed.status).toBe(200)
    expect(disbursed.body.data).toMatchObject({
      id: loan.id,
      status: 'ACTIVE',
      repaid: 0,
      outstanding: 3090,
      interest_rate: 12,
      interest_amount: 90,
    })

    // Validation before cash repayment: amount 0 → 400, amount > outstanding → 400, EXPENSE account → 400
    const zeroRepay = await request(app)
      .post(`/api/hr/advances/${loan.id}/repay-cash`)
      .set(auth)
      .send({ amount: 0, date: '2026-10-15', pay_account_id: cash })
    expect(zeroRepay.status).toBe(400)

    const overRepay = await request(app)
      .post(`/api/hr/advances/${loan.id}/repay-cash`)
      .set(auth)
      .send({ amount: 3100, date: '2026-10-15', pay_account_id: cash })
    expect(overRepay.status).toBe(400)

    const expenseRepay = await request(app)
      .post(`/api/hr/advances/${loan.id}/repay-cash`)
      .set(auth)
      .send({ amount: 1030, date: '2026-10-15', pay_account_id: expense })
    expect(expenseRepay.status).toBe(400)

    // 2. Repay cash 1030 on that ACTIVE loan to 1101 → Dr 1101 1030 / Cr 1115 1000 / Cr 4202 30, is_posted = 1
    const repay1 = await request(app)
      .post(`/api/hr/advances/${loan.id}/repay-cash`)
      .set(auth)
      .send({ amount: 1030, date: '2026-10-15', pay_account_id: cash })
    expect(repay1.status).toBe(200)
    expect(repay1.body.data).toMatchObject({
      id: loan.id,
      status: 'ACTIVE',
      repaid: 1030,
      outstanding: 2060,
    })
    expect(repay1.body.data.repayments).toHaveLength(1)
    const r1 = repay1.body.data.repayments[0]
    expect(r1).toMatchObject({
      period: '2026-10',
      amount: 1030,
      interest: 30,
      source: 'CASH',
    })
    expect(r1.run_id).toBeTruthy()

    const je1 = db.prepare('SELECT * FROM journal_entries WHERE id = ? AND tenant_id = ?')
      .get(r1.run_id, tenantId) as any
    expect(je1).toBeTruthy()
    expect(je1.is_posted).toBe(1)
    expect(je1.reference_type).toBe('EMPLOYEE_ADVANCE')
    expect(je1.reference_id).toBe(loan.id)

    const lines1 = db.prepare(
      `SELECT a.code, jl.debit, jl.credit
       FROM journal_lines jl
       JOIN accounts a ON a.id = jl.account_id
       WHERE jl.journal_entry_id = ? AND jl.tenant_id = ?`
    ).all(r1.run_id, tenantId) as any[]
    expect(lines1.find((l) => l.code === '1101')).toMatchObject({ debit: 1030, credit: 0 })
    expect(lines1.find((l) => l.code === '1115')).toMatchObject({ debit: 0, credit: 1000 })
    expect(lines1.find((l) => l.code === '4202')).toMatchObject({ debit: 0, credit: 30 })

    // 3. Repay cash the remaining 2060 → interest = 60, loan CLOSED; repay on CLOSED loan → 409
    const repay2 = await request(app)
      .post(`/api/hr/advances/${loan.id}/repay-cash`)
      .set(auth)
      .send({ amount: 2060, date: '2026-11-15', pay_account_id: cash })
    expect(repay2.status).toBe(200)
    expect(repay2.body.data).toMatchObject({
      id: loan.id,
      status: 'CLOSED',
      repaid: 3090,
      outstanding: 0,
    })
    expect(repay2.body.data.repayments).toHaveLength(2)
    const r2 = repay2.body.data.repayments[1]
    expect(r2).toMatchObject({
      period: '2026-11',
      amount: 2060,
      interest: 60,
      source: 'CASH',
    })

    const closedRepay = await request(app)
      .post(`/api/hr/advances/${loan.id}/repay-cash`)
      .set(auth)
      .send({ amount: 100, date: '2026-11-16', pay_account_id: cash })
    expect(closedRepay.status).toBe(409)
  })
})
