import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import hrRouter from './hr.routes'
import hrPayrollRouter from './hr.payroll.routes'
import { createTestUser } from '../test/testAuth'
import { round2 } from '../services/hr/payrollCalc'
import { seedChartOfAccounts } from '../config/chartOfAccounts'
import { getOrCreateAccount } from '../services/accounting.service'

const app = express()
app.use(express.json())
app.use('/api/hr', authenticate, subscriptionGate('hr'))
app.use('/api/hr', hrRouter)
app.use('/api/hr', hrPayrollRouter)

const tenants: string[] = []

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM journal_lines WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM journal_entries WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM payroll_run_lines WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM payroll_runs WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM employee_pay_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM pay_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM hr_settings WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM tax_periods WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM employees WHERE tenant_id = ?').run(t)
    db.prepare('UPDATE org_units SET parent_id = NULL WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM org_units WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM accounts WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM tenant_subscriptions WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM users WHERE tenant_id = ?').run(t)
  }
})

function seedPayrollAccounts(tenantId: string) {
  seedChartOfAccounts(tenantId)
  const codes = ['1101', '1102', '2105', '2106', '2107', '5301', '5314']
  const byCode: Record<string, string> = {}
  for (const code of codes) {
    byCode[code] = getOrCreateAccount(tenantId, code)
  }
  return byCode
}

function newAdmin() {
  const u = createTestUser({ role: 'ADMIN' })
  tenants.push(u.tenantId)
  const accounts = seedPayrollAccounts(u.tenantId)
  return { ...u, accounts }
}

describe('HR Phase 2b — Payroll runs, pay items, accounting posting, slips & tax exports', () => {
  it('Golden 4 employees (สมชาย/มาลี/วิชัย/นภา): compute totals, post accrual JEs by business_unit, pay, and void + recreate', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    // 1. Starter pay items
    const starterRes = await request(app).post('/api/hr/pay-items/starter').set(auth).send({})
    expect(starterRes.status).toBe(201)
    const starterItems: any[] = starterRes.body
    expect(starterItems.map(i => i.name)).toEqual(
      expect.arrayContaining(['ค่าอาหาร', 'ค่าเดินทาง', 'เบี้ยขยัน', 'ค่าที่พัก'])
    )
    const mealItem = starterItems.find(i => i.name === 'ค่าอาหาร')!
    expect(mealItem.calc).toBe('PER_DAY')
    expect(mealItem.taxable).toBe(1)
    expect(mealItem.ssoable).toBe(0)
    const diligenceItem = starterItems.find(i => i.name === 'เบี้ยขยัน')!
    expect(diligenceItem.calc).toBe('FIXED')
    expect(diligenceItem.taxable).toBe(1)
    expect(diligenceItem.ssoable).toBe(1)

    // 2. Two org units with different business_unit -> RETAIL and WHOLESALE
    const ouRetail = await request(app)
      .post('/api/hr/org-units')
      .set(auth)
      .send({ name: 'หน้าร้าน', business_unit: 'RETAIL' })
    expect(ouRetail.status).toBe(201)
    const ouRetailId = ouRetail.body.data.id

    const ouWholesale = await request(app)
      .post('/api/hr/org-units')
      .set(auth)
      .send({ name: 'ขายส่ง', business_unit: 'WHOLESALE' })
    expect(ouWholesale.status).toBe(201)
    const ouWholesaleId = ouWholesale.body.data.id

    // 3. Create the 4 golden employees:
    // สมชาย (RETAIL): MONTHLY 15,000 + OT 6h WORKDAY_OT + ค่าอาหาร 500
    const eSomchai = await request(app).post('/api/hr/employees').set(auth).send({
      code: 'EMP-001',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
      national_id: '1100100100001',
      org_unit_id: ouRetailId,
      employment_type: 'MONTHLY',
      base_wage: 15000,
      start_date: '2026-01-01',
    })
    expect(eSomchai.status).toBe(201)
    const somchaiId = eSomchai.body.data.id

    // มาลี (RETAIL): DAILY 400 × 26 วัน + OT 4h WORKDAY_OT + ค่าอาหาร 30/วัน (780) + สาย 25 นาที
    const eMalee = await request(app).post('/api/hr/employees').set(auth).send({
      code: 'EMP-002',
      first_name: 'มาลี',
      last_name: 'ขยันงาน',
      national_id: '1100100100002',
      org_unit_id: ouRetailId,
      employment_type: 'DAILY',
      base_wage: 400,
      start_date: '2026-01-01',
    })
    expect(eMalee.status).toBe(201)
    const maleeId = eMalee.body.data.id

    // Assign recurring PER_DAY ค่าอาหาร 30/day to มาลี
    const assignMalee = await request(app)
      .put(`/api/hr/employees/${maleeId}/pay-items`)
      .set(auth)
      .send([{ pay_item_id: mealItem.id, amount: 30 }])
    expect(assignMalee.status).toBe(200)
    expect(assignMalee.body).toHaveLength(1)

    // วิชัย (WHOLESALE): MONTHLY 35,000 + ค่าอาหาร 500
    const eWichai = await request(app).post('/api/hr/employees').set(auth).send({
      code: 'EMP-003',
      first_name: 'วิชัย',
      last_name: 'บริหาร',
      national_id: '1100100100003',
      org_unit_id: ouWholesaleId,
      employment_type: 'MONTHLY',
      base_wage: 35000,
      start_date: '2026-01-01',
    })
    expect(eWichai.status).toBe(201)
    const wichaiId = eWichai.body.data.id

    // นภา (WHOLESALE): MONTHLY 18,000 ลางานไม่รับค่าจ้าง 1 วัน
    const eNapa = await request(app).post('/api/hr/employees').set(auth).send({
      code: 'EMP-004',
      first_name: 'นภา',
      last_name: 'สดใส',
      national_id: '1100100100004',
      org_unit_id: ouWholesaleId,
      employment_type: 'MONTHLY',
      base_wage: 18000,
      start_date: '2026-01-01',
    })
    expect(eNapa.status).toBe(201)
    const napaId = eNapa.body.data.id

    // 4. Create payroll run for 2026-10
    const createRunRes = await request(app)
      .post('/api/hr/payroll-runs')
      .set(auth)
      .send({ period: '2026-10' })
    expect(createRunRes.status).toBe(201)
    const runId = createRunRes.body.id
    expect(createRunRes.body.status).toBe('DRAFT')
    expect(createRunRes.body.lines).toHaveLength(4)

    const lineByEmp = Object.fromEntries(
      createRunRes.body.lines.map((l: any) => [l.employee_id, l.id])
    )

    // Update สมชาย inputs: OT 6h WORKDAY_OT + extraPayItems ค่าอาหาร 500
    const upSomchai = await request(app)
      .put(`/api/hr/payroll-runs/${runId}/lines/${lineByEmp[somchaiId]}`)
      .set(auth)
      .send({
        ot: [{ hours: 6, kind: 'WORKDAY_OT' }],
        extraPayItems: [{ name: 'ค่าอาหาร', amount: 500, taxable: true, ssoable: false }],
      })
    expect(upSomchai.status).toBe(200)
    expect(upSomchai.body.gross).toBe(16062.5)
    expect(upSomchai.body.sso_employee).toBe(778)
    expect(upSomchai.body.net).toBe(15284.5)

    // Update มาลี inputs: daysWorked 26 (recurring ค่าอาหาร 30 * 26 = 780), lateMinutes 25, OT 4h WORKDAY_OT
    const upMalee = await request(app)
      .put(`/api/hr/payroll-runs/${runId}/lines/${lineByEmp[maleeId]}`)
      .set(auth)
      .send({
        daysWorked: 26,
        lateMinutes: 25,
        ot: [{ hours: 4, kind: 'WORKDAY_OT' }],
      })
    expect(upMalee.status).toBe(200)
    expect(upMalee.body.gross).toBe(11480)
    expect(upMalee.body.late).toBe(20.83)
    expect(upMalee.body.sso_employee).toBe(534)
    expect(upMalee.body.net).toBe(10925.17)

    // Update วิชัย inputs: extraPayItems ค่าอาหาร 500
    const upWichai = await request(app)
      .put(`/api/hr/payroll-runs/${runId}/lines/${lineByEmp[wichaiId]}`)
      .set(auth)
      .send({
        extraPayItems: [{ name: 'ค่าอาหาร', amount: 500, taxable: true, ssoable: false }],
      })
    expect(upWichai.status).toBe(200)
    expect(upWichai.body.gross).toBe(35500)
    expect(upWichai.body.sso_employee).toBe(875)
    expect(upWichai.body.wht).toBe(439.58)
    expect(upWichai.body.net).toBe(34185.42)

    // Update นภา inputs: unpaidLeaveDays 1
    const upNapa = await request(app)
      .put(`/api/hr/payroll-runs/${runId}/lines/${lineByEmp[napaId]}`)
      .set(auth)
      .send({
        unpaidLeaveDays: 1,
      })
    expect(upNapa.status).toBe(200)
    expect(upNapa.body.gross).toBe(17400)
    expect(upNapa.body.sso_employee).toBe(870)
    expect(upNapa.body.net).toBe(16530)

    // 5. Verify run totals match golden expectations
    const detailRes = await request(app).get(`/api/hr/payroll-runs/${runId}`).set(auth)
    expect(detailRes.status).toBe(200)
    const totals = detailRes.body.totals
    expect(totals.gross).toBe(80442.5)
    expect(totals.sso_employee).toBe(3057)
    expect(totals.sso_employer).toBe(3057)
    expect(totals.wht).toBe(439.58)
    expect(totals.late).toBe(20.83)
    expect(totals.net).toBe(76925.09)

    // 6. Approve run
    const approveRes = await request(app).post(`/api/hr/payroll-runs/${runId}/approve`).set(auth).send({})
    expect(approveRes.status).toBe(200)
    expect(approveRes.body.status).toBe('APPROVED')
    expect(approveRes.body.approved_by).toBe(admin.userId)

    // 7. Post run (creates 2 accrual JEs for RETAIL and WHOLESALE dated 2026-10-31)
    const bankAccountId = admin.accounts['1102']
    const postRes = await request(app)
      .post(`/api/hr/payroll-runs/${runId}/post`)
      .set(auth)
      .send({ payDate: '2026-10-31', payAccountId: bankAccountId })
    expect(postRes.status).toBe(200)
    expect(postRes.body.status).toBe('POSTED')
    expect(postRes.body.accrual_je_ids).toHaveLength(2)

    const accrualJes = db
      .prepare('SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = ? AND reference_id = ?')
      .all(admin.tenantId, 'PAYROLL_RUN', runId) as any[]
    expect(accrualJes).toHaveLength(2)

    for (const je of accrualJes) {
      expect(je.date).toBe('2026-10-31')
      expect(je.is_posted).toBe(1)
      const lines = db
        .prepare('SELECT jl.*, a.code FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id = ? AND jl.tenant_id = ?')
        .all(je.id, admin.tenantId) as any[]
      const sumDr = round2(lines.reduce((s, l) => s + Number(l.debit), 0))
      const sumCr = round2(lines.reduce((s, l) => s + Number(l.credit), 0))
      expect(sumDr).toBe(sumCr)

      // No employee name in any JE description/notes/line description
      const allText = [je.description, je.notes, ...lines.map(l => l.description)].join(' ')
      for (const empName of ['สมชาย', 'มาลี', 'วิชัย', 'นภา', 'ใจดี', 'ขยันงาน', 'บริหาร', 'สดใส']) {
        expect(allText).not.toContain(empName)
      }
    }

    // Aggregate Dr 5301 = gross - late, Cr 2107 = net across both accrual JEs
    const allAccrualLines = db
      .prepare(
        `SELECT jl.*, a.code
         FROM journal_lines jl
         JOIN accounts a ON a.id = jl.account_id
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         WHERE je.tenant_id = ? AND je.reference_type = 'PAYROLL_RUN' AND je.reference_id = ?`
      )
      .all(admin.tenantId, runId) as any[]

    const dr5301 = round2(
      allAccrualLines.filter(l => l.code === '5301').reduce((s, l) => s + Number(l.debit), 0)
    )
    const dr5314 = round2(
      allAccrualLines.filter(l => l.code === '5314').reduce((s, l) => s + Number(l.debit), 0)
    )
    const cr2107 = round2(
      allAccrualLines.filter(l => l.code === '2107').reduce((s, l) => s + Number(l.credit), 0)
    )
    expect(dr5301).toBe(round2(80442.5 - 20.83)) // 80,421.67
    expect(dr5314).toBe(3057)
    expect(cr2107).toBe(76925.09)

    // 8. Export SSO CSV & PND1 tax
    const ssoCsvRes = await request(app).get(`/api/hr/payroll-runs/${runId}/export/sso`).set(auth)
    expect(ssoCsvRes.status).toBe(200)
    expect(ssoCsvRes.text).toContain('เลขบัตรประชาชน,คำนำหน้า-ชื่อ-สกุล,ค่าจ้าง,เงินสมทบ')
    expect(ssoCsvRes.text).toContain('15562.50,778.00')

    const pnd1Res = await request(app).get('/api/hr/payroll-runs/tax/pnd1?period=2026-10').set(auth)
    expect(pnd1Res.status).toBe(200)
    expect(pnd1Res.body.totals.wht).toBe(439.58)
    expect(pnd1Res.body.rows).toHaveLength(4)

    // 9. Pay run: Dr 2107 / Cr bank = net, dated payDate, 2107 nets to zero after pay
    const payRes = await request(app)
      .post(`/api/hr/payroll-runs/${runId}/pay`)
      .set(auth)
      .send({ payDate: '2026-10-31', payAccountId: bankAccountId })
    expect(payRes.status).toBe(200)
    expect(payRes.body.status).toBe('PAID')
    expect(payRes.body.payment_je_id).toBeTruthy()

    const payJe = db
      .prepare('SELECT * FROM journal_entries WHERE id = ? AND tenant_id = ?')
      .get(payRes.body.payment_je_id, admin.tenantId) as any
    expect(payJe.date).toBe('2026-10-31')
    expect(payJe.reference_type).toBe('PAYROLL_RUN')
    expect(payJe.reference_id).toBe(runId)

    const net2107 = db
      .prepare(
        `SELECT COALESCE(SUM(jl.credit - jl.debit), 0) as balance
         FROM journal_lines jl
         JOIN accounts a ON a.id = jl.account_id
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         WHERE je.tenant_id = ? AND je.is_posted = 1 AND a.code = '2107'`
      )
      .get(admin.tenantId) as { balance: number }
    expect(round2(net2107.balance)).toBe(0)

    // 10. Void run: reversals exist for every JE, run is VOID, and a new run for the same period can be created
    const voidRes = await request(app)
      .post(`/api/hr/payroll-runs/${runId}/void`)
      .set(auth)
      .send({ reason: 'แก้ไขข้อมูล' })
    expect(voidRes.status).toBe(200)
    expect(voidRes.body.status).toBe('VOID')
    expect(voidRes.body.reversal_je_ids).toHaveLength(3) // 2 accrual JEs + 1 payment JE

    for (const origJeId of [...postRes.body.accrual_je_ids, payRes.body.payment_je_id]) {
      const rev = db
        .prepare("SELECT id FROM journal_entries WHERE tenant_id = ? AND reference_type = 'REVERSAL' AND reference_id = ?")
        .get(admin.tenantId, origJeId)
      expect(rev).toBeTruthy()
    }

    const recreateRes = await request(app)
      .post('/api/hr/payroll-runs')
      .set(auth)
      .send({ period: '2026-10' })
    expect(recreateRes.status).toBe(201)
    expect(recreateRes.body.status).toBe('DRAFT')
  })

  it('Closed period rejects posting', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    await request(app).post('/api/hr/employees').set(auth).send({
      first_name: 'สมศรี',
      employment_type: 'MONTHLY',
      base_wage: 20000,
      start_date: '2026-01-01',
    })

    const runRes = await request(app).post('/api/hr/payroll-runs').set(auth).send({ period: '2026-09' })
    expect(runRes.status).toBe(201)
    const runId = runRes.body.id

    await request(app).post(`/api/hr/payroll-runs/${runId}/approve`).set(auth).send({})

    // Close 2026-09 in tax_periods (used by closedPeriodLabel)
    db.prepare(
      `INSERT INTO tax_periods (id, tenant_id, year, month, period_type, start_date, end_date, status)
       VALUES (?, ?, 2026, 9, 'MONTHLY', '2026-09-01', '2026-09-30', 'CLOSED')`
    ).run(generateId(), admin.tenantId)

    const postRes = await request(app)
      .post(`/api/hr/payroll-runs/${runId}/post`)
      .set(auth)
      .send({ payDate: '2026-09-30', payAccountId: admin.accounts['1102'] })
    expect(postRes.status).toBe(400)
    expect(postRes.body.error).toContain('ปิดแล้ว')
  })

  it('Tenant isolation, USER without hr -> 403, and /me/slips returns only own POSTED/PAID lines', async () => {
    const adminA = newAdmin()
    const authA = { Authorization: `Bearer ${adminA.token}` }

    const adminB = newAdmin()
    const authB = { Authorization: `Bearer ${adminB.token}` }

    // Create two regular USERs in tenant A without hr permissions
    const user1 = createTestUser({ role: 'USER', tenantId: adminA.tenantId })
    const user2 = createTestUser({ role: 'USER', tenantId: adminA.tenantId })

    // USER without hr gets 403 on HR payroll endpoints
    const forbiddenRes = await request(app)
      .get('/api/hr/payroll-runs')
      .set('Authorization', `Bearer ${user1.token}`)
    expect(forbiddenRes.status).toBe(403)

    // Create 2 employees linked to user1 and user2 in tenant A
    const emp1Res = await request(app).post('/api/hr/employees').set(authA).send({
      first_name: 'พนักงานหนึ่ง',
      employment_type: 'MONTHLY',
      base_wage: 15000,
      start_date: '2026-01-01',
      user_id: user1.userId,
    })
    expect(emp1Res.status).toBe(201)

    const emp2Res = await request(app).post('/api/hr/employees').set(authA).send({
      first_name: 'พนักงานสอง',
      employment_type: 'MONTHLY',
      base_wage: 20000,
      start_date: '2026-01-01',
      user_id: user2.userId,
    })
    expect(emp2Res.status).toBe(201)

    // Create DRAFT run for 2026-08 and POSTED run for 2026-09
    const draftRun = await request(app).post('/api/hr/payroll-runs').set(authA).send({ period: '2026-08' })
    expect(draftRun.status).toBe(201)

    const postedRun = await request(app).post('/api/hr/payroll-runs').set(authA).send({ period: '2026-09' })
    expect(postedRun.status).toBe(201)
    await request(app).post(`/api/hr/payroll-runs/${postedRun.body.id}/approve`).set(authA).send({})
    await request(app)
      .post(`/api/hr/payroll-runs/${postedRun.body.id}/post`)
      .set(authA)
      .send({ payDate: '2026-09-30', payAccountId: adminA.accounts['1102'] })

    // Tenant B cannot access Tenant A's run
    const crossTenantGet = await request(app)
      .get(`/api/hr/payroll-runs/${postedRun.body.id}`)
      .set(authB)
    expect(crossTenantGet.status).toBe(404)

    const crossTenantList = await request(app).get('/api/hr/payroll-runs').set(authB)
    expect(crossTenantList.status).toBe(200)
    expect(crossTenantList.body).toEqual([])

    // user1 calls /api/hr/me/slips -> sees ONLY their own line from the POSTED run (not user2's, and not the DRAFT run)
    const meSlipsRes = await request(app)
      .get('/api/hr/me/slips')
      .set('Authorization', `Bearer ${user1.token}`)
    expect(meSlipsRes.status).toBe(200)
    expect(meSlipsRes.body).toHaveLength(1)
    expect(meSlipsRes.body[0].employee_id).toBe(emp1Res.body.data.id)
    expect(meSlipsRes.body[0].period).toBe('2026-09')
    expect(meSlipsRes.body[0].status).toBe('POSTED')
  })
})
