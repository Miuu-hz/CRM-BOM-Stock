import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import hrRouter from './hr.routes'
import hrPayrollRouter from './hr.payroll.routes'
import hrAttendanceRouter from './hr.attendance.routes'
import { getAttendanceSummary } from '../services/hr/attendanceStore'
import { createTestUser } from '../test/testAuth'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/hr', authenticate, subscriptionGate('hr'))
  app.use('/api/hr', hrRouter)
  app.use('/api/hr', hrPayrollRouter)
  app.use('/api/hr', hrAttendanceRouter)
  return app
}

const tenants: string[] = []

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM payroll_run_lines WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM payroll_runs WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM leave_requests WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM leave_types WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM public_holidays WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM attendance_logs WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM attendance_imports WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM employees WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM shifts WHERE tenant_id = ?').run(t)
    db.prepare('UPDATE org_units SET parent_id = NULL WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM org_units WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM tenant_subscriptions WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM users WHERE tenant_id = ?').run(t)
  }
})

function newAdmin() {
  const u = createTestUser({ role: 'ADMIN' })
  tenants.push(u.tenantId)
  return u
}

describe('Task B3 — Leave & Holidays feed into Payroll and Attendance', () => {
  const app = buildApp()

  it('defaults inputs.unpaidLeaveDays in POST /payroll-runs from approved unpaid requests (prorated and rounded to 0.5)', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }
    const tenantId = admin.tenantId
    const now = new Date().toISOString()

    // 1. Leave types: UNPAID (paid = 0) and SICK (paid = 1)
    const unpaidTypeId = generateId()
    db.prepare(
      `INSERT INTO leave_types (id, tenant_id, code, name, paid, days_per_year, is_active, created_at)
       VALUES (?, ?, 'UNPAID', 'ลาไม่รับค่าจ้าง', 0, NULL, 1, ?)`
    ).run(unpaidTypeId, tenantId, now)

    const sickTypeId = generateId()
    db.prepare(
      `INSERT INTO leave_types (id, tenant_id, code, name, paid, days_per_year, is_active, created_at)
       VALUES (?, ?, 'SICK', 'ลาป่วย', 1, 30, 1, ?)`
    ).run(sickTypeId, tenantId, now)

    // 2. Four active employees
    const emp1Id = generateId()
    db.prepare(
      `INSERT INTO employees (id, tenant_id, code, first_name, last_name, start_date, status, employment_type, base_wage, sso_enrolled, created_at, updated_at)
       VALUES (?, ?, 'EMP-01', 'สมชาย', 'หนึ่ง', '2026-01-01', 'ACTIVE', 'MONTHLY', 15000, 1, ?, ?)`
    ).run(emp1Id, tenantId, now, now)

    const emp2Id = generateId()
    db.prepare(
      `INSERT INTO employees (id, tenant_id, code, first_name, last_name, start_date, status, employment_type, base_wage, sso_enrolled, created_at, updated_at)
       VALUES (?, ?, 'EMP-02', 'สมหญิง', 'สอง', '2026-01-01', 'ACTIVE', 'MONTHLY', 18000, 1, ?, ?)`
    ).run(emp2Id, tenantId, now, now)

    const emp3Id = generateId()
    db.prepare(
      `INSERT INTO employees (id, tenant_id, code, first_name, last_name, start_date, status, employment_type, base_wage, sso_enrolled, created_at, updated_at)
       VALUES (?, ?, 'EMP-03', 'สมศักดิ์', 'สาม', '2026-01-01', 'ACTIVE', 'MONTHLY', 20000, 1, ?, ?)`
    ).run(emp3Id, tenantId, now, now)

    const emp4Id = generateId()
    db.prepare(
      `INSERT INTO employees (id, tenant_id, code, first_name, last_name, start_date, status, employment_type, base_wage, sso_enrolled, created_at, updated_at)
       VALUES (?, ?, 'EMP-04', 'สมพร', 'สี่', '2026-01-01', 'ACTIVE', 'MONTHLY', 22000, 1, ?, ?)`
    ).run(emp4Id, tenantId, now, now)

    // 3. Leave requests:
    // Emp 1: APPROVED UNPAID request 2026-11-10..11 (2 days) -> 2 days in Nov
    db.prepare(
      `INSERT INTO leave_requests (id, tenant_id, employee_id, leave_type_id, start_date, end_date, days, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, '2026-11-10', '2026-11-11', 2, 'APPROVED', ?, ?)`
    ).run(generateId(), tenantId, emp1Id, unpaidTypeId, now, now)

    // Emp 2: APPROVED UNPAID request 2026-10-30..2026-11-02 (4 days total, 2 days in Nov) -> prorated 2 days
    db.prepare(
      `INSERT INTO leave_requests (id, tenant_id, employee_id, leave_type_id, start_date, end_date, days, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, '2026-10-30', '2026-11-02', 4, 'APPROVED', ?, ?)`
    ).run(generateId(), tenantId, emp2Id, unpaidTypeId, now, now)

    // Emp 3: APPROVED PAID (SICK) request 2026-11-05..2026-11-06 (2 days) -> paid = 1 so 0 unpaid days
    db.prepare(
      `INSERT INTO leave_requests (id, tenant_id, employee_id, leave_type_id, start_date, end_date, days, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, '2026-11-05', '2026-11-06', 2, 'APPROVED', ?, ?)`
    ).run(generateId(), tenantId, emp3Id, sickTypeId, now, now)

    // Emp 4: PENDING UNPAID request 2026-11-15..2026-11-16 (2 days) -> PENDING so 0 unpaid days
    db.prepare(
      `INSERT INTO leave_requests (id, tenant_id, employee_id, leave_type_id, start_date, end_date, days, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, '2026-11-15', '2026-11-16', 2, 'PENDING', ?, ?)`
    ).run(generateId(), tenantId, emp4Id, unpaidTypeId, now, now)

    // 4. Create payroll run for 2026-11
    const runRes = await request(app)
      .post('/api/hr/payroll-runs')
      .set(auth)
      .send({ period: '2026-11' })

    expect(runRes.status).toBe(201)
    const lines = runRes.body.lines
    expect(lines).toHaveLength(4)

    const lineByEmp = Object.fromEntries(lines.map((l: any) => [l.employee_id, l]))

    // Emp 1: 2 days unpaid leave defaulted
    expect(lineByEmp[emp1Id].inputs.unpaidLeaveDays).toBe(2)
    // Emp 2: 2 days unpaid leave defaulted (prorated: 4 * 2/4 = 2)
    expect(lineByEmp[emp2Id].inputs.unpaidLeaveDays).toBe(2)
    // Emp 3: paid leave -> 0 unpaid leave days
    expect(lineByEmp[emp3Id].inputs.unpaidLeaveDays).toBe(0)
    // Emp 4: pending leave -> 0 unpaid leave days
    expect(lineByEmp[emp4Id].inputs.unpaidLeaveDays).toBe(0)

    // 5. Defaults only; user can still edit line inputs
    const emp1Line = lineByEmp[emp1Id]
    const putRes = await request(app)
      .put(`/api/hr/payroll-runs/${runRes.body.id}/lines/${emp1Line.id}`)
      .set(auth)
      .send({ unpaidLeaveDays: 3.5 })

    expect(putRes.status).toBe(200)
    expect(putRes.body.inputs.unpaidLeaveDays).toBe(3.5)
  })

  it('attendance summary over range with a shift: holiday and approved leave days are not absent, adds holidayDays 1, leaveDays 1, another missing day absent', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }
    const tenantId = admin.tenantId
    const now = new Date().toISOString()

    // 1. Create a shift 09:00–18:00
    const shiftId = generateId()
    db.prepare(
      `INSERT INTO shifts (id, tenant_id, name, start_time, end_time, grace_minutes, break_minutes, is_active, created_at)
       VALUES (?, ?, 'กะปกติ 09-18', '09:00', '18:00', 0, 60, 1, ?)`
    ).run(shiftId, tenantId, now)

    // 2. Create employee with the shift and pin
    const empId = generateId()
    db.prepare(
      `INSERT INTO employees (id, tenant_id, code, first_name, last_name, start_date, status, employment_type, base_wage, sso_enrolled, shift_id, device_pin, created_at, updated_at)
       VALUES (?, ?, 'EMP-10', 'กานดา', 'ใจสงบ', '2026-01-01', 'ACTIVE', 'MONTHLY', 20000, 1, ?, '701', ?, ?)`
    ).run(empId, tenantId, shiftId, now, now)

    // 3. Leave type
    const leaveTypeId = generateId()
    db.prepare(
      `INSERT INTO leave_types (id, tenant_id, code, name, paid, days_per_year, is_active, created_at)
       VALUES (?, ?, 'VACATION', 'ลาพักผ่อน', 1, 10, 1, ?)`
    ).run(leaveTypeId, tenantId, now)

    // 4. Day 1: 2026-11-02 Public Holiday
    db.prepare(
      `INSERT INTO public_holidays (id, tenant_id, date, name, created_at)
       VALUES (?, ?, '2026-11-02', 'วันหยุดพิเศษ', ?)`
    ).run(generateId(), tenantId, now)

    // 5. Day 2: 2026-11-03 Approved Leave
    db.prepare(
      `INSERT INTO leave_requests (id, tenant_id, employee_id, leave_type_id, start_date, end_date, days, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, '2026-11-03', '2026-11-03', 1, 'APPROVED', ?, ?)`
    ).run(generateId(), tenantId, empId, leaveTypeId, now, now)

    // 6. Day 3: 2026-11-04 Regular work day (no punches -> absent)

    // 7. GET /attendance/summary for 2026-11-02..2026-11-04
    const res = await request(app)
      .get('/api/hr/attendance/summary?from=2026-11-02&to=2026-11-04')
      .set(auth)

    expect(res.status).toBe(200)
    expect(res.body.employees).toHaveLength(1)
    const empSummary = res.body.employees[0]

    // Verify totals: holidayDays 1, leaveDays 1, absentDays 1
    expect(empSummary.totals.holidayDays).toBe(1)
    expect(empSummary.totals.leaveDays).toBe(1)
    expect(empSummary.totals.absentDays).toBe(1)
    expect(empSummary.holidayDays).toBe(1)
    expect(empSummary.leaveDays).toBe(1)
    expect(empSummary.absentDays).toBe(1)

    // Verify per-day absent flags:
    // 2026-11-02 (holiday): not absent
    const d1 = empSummary.days.find((d: any) => d.workDate === '2026-11-02')
    expect(d1).toBeDefined()
    expect(d1.absent).toBe(false)

    // 2026-11-03 (approved leave): not absent
    const d2 = empSummary.days.find((d: any) => d.workDate === '2026-11-03')
    expect(d2).toBeDefined()
    expect(d2.absent).toBe(false)

    // 2026-11-04 (regular day without punch): still absent
    const d3 = empSummary.days.find((d: any) => d.workDate === '2026-11-04')
    expect(d3).toBeDefined()
    expect(d3.absent).toBe(true)

    // Verify store function directly (used by REST and MCP)
    const directSummary = getAttendanceSummary(tenantId, '2026-11-02', '2026-11-04')
    const directEmp = directSummary.employees.find((e) => e.employeeId === empId)!
    expect(directEmp.totals.holidayDays).toBe(1)
    expect(directEmp.totals.leaveDays).toBe(1)
    expect(directEmp.totals.absentDays).toBe(1)
  })

  it('holiday wins when both a public holiday and an approved leave request fall on the same day', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }
    const tenantId = admin.tenantId
    const now = new Date().toISOString()

    const shiftId = generateId()
    db.prepare(
      `INSERT INTO shifts (id, tenant_id, name, start_time, end_time, grace_minutes, break_minutes, is_active, created_at)
       VALUES (?, ?, 'กะปกติ', '09:00', '18:00', 0, 60, 1, ?)`
    ).run(shiftId, tenantId, now)

    const empId = generateId()
    db.prepare(
      `INSERT INTO employees (id, tenant_id, code, first_name, last_name, start_date, status, employment_type, base_wage, sso_enrolled, shift_id, created_at, updated_at)
       VALUES (?, ?, 'EMP-20', 'ชนิสา', 'บุญชู', '2026-01-01', 'ACTIVE', 'MONTHLY', 25000, 1, ?, ?, ?)`
    ).run(empId, tenantId, shiftId, now, now)

    const leaveTypeId = generateId()
    db.prepare(
      `INSERT INTO leave_types (id, tenant_id, code, name, paid, days_per_year, is_active, created_at)
       VALUES (?, ?, 'PERSONAL', 'ลากิจ', 1, 5, 1, ?)`
    ).run(leaveTypeId, tenantId, now)

    // 2026-11-05 is BOTH public holiday AND approved leave
    db.prepare(
      `INSERT INTO public_holidays (id, tenant_id, date, name, created_at)
       VALUES (?, ?, '2026-11-05', 'วันหยุดราชการ', ?)`
    ).run(generateId(), tenantId, now)

    db.prepare(
      `INSERT INTO leave_requests (id, tenant_id, employee_id, leave_type_id, start_date, end_date, days, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, '2026-11-05', '2026-11-05', 1, 'APPROVED', ?, ?)`
    ).run(generateId(), tenantId, empId, leaveTypeId, now, now)

    const res = await request(app)
      .get(`/api/hr/attendance/summary?from=2026-11-05&to=2026-11-05&employee_id=${empId}`)
      .set(auth)

    expect(res.status).toBe(200)
    const empSummary = res.body.employees[0]
    expect(empSummary.totals.holidayDays).toBe(1)
    expect(empSummary.totals.leaveDays).toBeUndefined()
    expect(empSummary.totals.absentDays).toBe(0)
    expect(empSummary.days[0].absent).toBe(false)
  })

  it('multi-tenant isolation: Tenant B holidays and leave requests do not affect Tenant A', async () => {
    const adminA = newAdmin()
    const adminB = newAdmin()
    const authA = { Authorization: `Bearer ${adminA.token}` }
    const authB = { Authorization: `Bearer ${adminB.token}` }
    const now = new Date().toISOString()

    // Tenant A employee with shift
    const shiftA = generateId()
    db.prepare(
      `INSERT INTO shifts (id, tenant_id, name, start_time, end_time, grace_minutes, break_minutes, is_active, created_at)
       VALUES (?, ?, 'กะ A', '09:00', '18:00', 0, 60, 1, ?)`
    ).run(shiftA, adminA.tenantId, now)

    const empA = generateId()
    db.prepare(
      `INSERT INTO employees (id, tenant_id, code, first_name, last_name, start_date, status, employment_type, base_wage, sso_enrolled, shift_id, created_at, updated_at)
       VALUES (?, ?, 'EMP-A', 'สมบัติ', 'เอ', '2026-01-01', 'ACTIVE', 'MONTHLY', 20000, 1, ?, ?, ?)`
    ).run(empA, adminA.tenantId, shiftA, now, now)

    // Tenant B gets public holiday and leave
    const unpaidB = generateId()
    db.prepare(
      `INSERT INTO leave_types (id, tenant_id, code, name, paid, days_per_year, is_active, created_at)
       VALUES (?, ?, 'UNPAID', 'ลาไม่รับค่าจ้าง', 0, NULL, 1, ?)`
    ).run(unpaidB, adminB.tenantId, now)

    db.prepare(
      `INSERT INTO public_holidays (id, tenant_id, date, name, created_at)
       VALUES (?, ?, '2026-11-02', 'วันหยุด B', ?)`
    ).run(generateId(), adminB.tenantId, now)

    // Summary for Tenant A on 2026-11-02: Tenant A has NO holiday, so empA is absent
    const resA = await request(app)
      .get('/api/hr/attendance/summary?from=2026-11-02&to=2026-11-02')
      .set(authA)

    expect(resA.status).toBe(200)
    expect(resA.body.employees[0].totals.holidayDays).toBeUndefined()
    expect(resA.body.employees[0].totals.absentDays).toBe(1)
    expect(resA.body.employees[0].days[0].absent).toBe(true)

    // Payroll run for Tenant A on 2026-11: empA has 0 unpaidLeaveDays
    const runA = await request(app)
      .post('/api/hr/payroll-runs')
      .set(authA)
      .send({ period: '2026-11' })

    expect(runA.status).toBe(201)
    expect(runA.body.lines[0].inputs.unpaidLeaveDays).toBe(0)
  })
})
