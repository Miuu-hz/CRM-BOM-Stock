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
import { getAttendanceSummary } from '../services/hr/attendanceStore'

// HR Phase 7 (ส่วนของ T0): ตารางกะรายวันในสรุปเวลา + ดอกเบี้ยเงินยืมตอนลงบัญชีเงินเดือน
const app = express()
app.use(express.json())
app.use('/api/hr', authenticate, subscriptionGate('hr'))
app.use('/api/hr', hrPayrollRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_lines', 'journal_entries', 'advance_repayments', 'employee_advances', 'payroll_run_lines', 'payroll_runs',
      'shift_assignments', 'attendance_logs', 'shifts', 'employees', 'accounts', 'tenant_subscriptions', 'users']) {
      db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t)
    }
  }
})

const now = () => new Date().toISOString()

describe('HR Phase 7 core', () => {
  it('สรุปเวลาใช้กะรายวัน: มาสายเทียบกะของวันนั้น, วันหยุดตามตารางไม่นับขาด, คนไม่มีกะประจำแต่มีตารางก็สรุปได้', () => {
    const u = createTestUser({ role: 'ADMIN' })
    tenants.push(u.tenantId)
    const t = u.tenantId
    const morning = generateId(), evening = generateId()
    db.prepare('INSERT INTO shifts (id, tenant_id, name, start_time, end_time, grace_minutes, break_minutes, is_active, created_at) VALUES (?, ?, ?, ?, ?, 0, 60, 1, ?)').run(morning, t, 'เช้า', '09:00', '18:00', now())
    db.prepare('INSERT INTO shifts (id, tenant_id, name, start_time, end_time, grace_minutes, break_minutes, is_active, created_at) VALUES (?, ?, ?, ?, ?, 0, 60, 1, ?)').run(evening, t, 'บ่าย', '13:00', '22:00', now())
    const emp = (code: string, pin: string, shiftId: string | null) => {
      const id = generateId()
      db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, employment_type, base_wage, sso_enrolled, start_date, status, device_pin, shift_id)
                  VALUES (?, ?, ?, ?, 'DAILY', 400, 0, '2026-01-01', 'ACTIVE', ?, ?)`).run(id, t, code, code, pin, shiftId)
      return id
    }
    const a = emp('A', '9001', morning)
    const b = emp('B', '9002', null)
    const assign = (e: string, d: string, s: string | null) =>
      db.prepare('INSERT INTO shift_assignments (id, tenant_id, employee_id, work_date, shift_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(generateId(), t, e, d, s, now())
    assign(a, '2030-01-08', evening)
    assign(a, '2030-01-09', null)
    assign(b, '2030-01-08', evening)
    const punch = (pin: string, at: string) =>
      db.prepare("INSERT INTO attendance_logs (id, tenant_id, device_pin, punched_at, source, created_at) VALUES (?, ?, ?, ?, 'WEB', ?)").run(generateId(), t, pin, at, now())
    punch('9001', '2030-01-07 09:10:00'); punch('9001', '2030-01-07 18:00:00')
    punch('9001', '2030-01-08 13:05:00'); punch('9001', '2030-01-08 22:00:00')
    punch('9002', '2030-01-08 13:00:00'); punch('9002', '2030-01-08 22:00:00')

    const s = getAttendanceSummary(t, '2030-01-07', '2030-01-09')
    const ea = s.employees.find((e) => e.id === a)!
    expect(ea.totals.lateMinutes).toBe(15) // 10 (กะเช้า) + 5 (กะบ่ายตามตาราง) — ถ้าใช้กะประจำจะสาย 245 นาที
    expect(ea.totals.absentDays).toBe(0)
    expect(ea.totals.offDays).toBe(1)
    expect(ea.totals.daysWorked).toBe(2)
    const eb = s.employees.find((e) => e.id === b)!
    expect(eb).toBeTruthy()
    expect(eb.totals).toMatchObject({ lateMinutes: 0, absentDays: 0, daysWorked: 1, offDays: 2 })
    expect(s.noShift.find((e) => e.id === b)).toBeUndefined()
  })

  it('เงินยืมมีดอกเบี้ย: รอบเงินเดือนหักงวดรวมดอกเบี้ย แยก Cr 1115 เงินต้น / Cr 4202 ดอกเบี้ย', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    tenants.push(u.tenantId)
    const t = u.tenantId
    seedChartOfAccounts(t)
    const empId = generateId()
    db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, employment_type, base_wage, sso_enrolled, start_date, status)
                VALUES (?, ?, 'EMP-001', 'มาลี', 'MONTHLY', 20000, 0, '2026-01-01', 'ACTIVE')`).run(empId, t)
    const loanId = generateId()
    // 3,000 × 12% × 3/12 = 90 → งวดละ 1,030
    db.prepare(`INSERT INTO employee_advances (id, tenant_id, employee_id, kind, amount, installments, installment_amount, interest_rate, interest_amount, start_period, status, disbursed_on, created_at, updated_at)
                VALUES (?, ?, ?, 'LOAN', 3000, 3, 1030, 12, 90, '2026-10', 'ACTIVE', '2026-10-05', ?, ?)`).run(loanId, t, empId, now(), now())
    const auth = { Authorization: `Bearer ${u.token}` }

    const created = await request(app).post('/api/hr/payroll-runs').set(auth).send({ period: '2026-10' })
    expect(created.status).toBe(201)
    expect(created.body.lines[0].advance_deduction).toBe(1030)
    expect((await request(app).post(`/api/hr/payroll-runs/${created.body.id}/approve`).set(auth).send({})).status).toBe(200)
    const posted = await request(app).post(`/api/hr/payroll-runs/${created.body.id}/post`).set(auth).send({})
    expect(posted.status).toBe(200)

    const lines = db.prepare(`SELECT a.code, jl.debit, jl.credit FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id = ? AND jl.tenant_id = ?`)
      .all(posted.body.accrual_je_ids[0], t) as any[]
    expect(lines.find((l) => l.code === '1115')).toMatchObject({ credit: 1000 })
    expect(lines.find((l) => l.code === '4202')).toMatchObject({ credit: 30 })
    const dr = lines.reduce((s, l) => s + l.debit, 0), cr = lines.reduce((s, l) => s + l.credit, 0)
    expect(Math.round(dr * 100)).toBe(Math.round(cr * 100))
    const rep = db.prepare('SELECT amount, interest, source FROM advance_repayments WHERE advance_id = ?').get(loanId) as any
    expect(rep).toMatchObject({ amount: 1030, interest: 30, source: 'PAYROLL' })
  })
})
