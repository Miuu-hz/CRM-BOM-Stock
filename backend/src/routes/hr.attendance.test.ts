import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import hrRoutes from './hr.routes'
import hrAttendanceRoutes from './hr.attendance.routes'
import { createTestUser } from '../test/testAuth'

function buildApp() {
  const app = express()
  app.use('/api/hr/attendance/import', express.json({ limit: '6mb' }))
  app.use(express.json({ limit: '1mb' }))
  app.use('/api/hr', authenticate, subscriptionGate('hr'))
  app.use('/api/hr', hrRoutes)
  app.use('/api/hr', hrAttendanceRoutes)
  return app
}

const tenants: string[] = []

afterEach(() => {
  for (const t of tenants.splice(0)) {
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

function setTenantPlan(tenantId: string, planCode: string) {
  db.prepare('DELETE FROM tenant_subscriptions WHERE tenant_id = ?').run(tenantId)
  db.prepare(`
    INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, current_period_end, packs, addons)
    VALUES (?, ?, ?, 'ACTIVE', datetime('now', '+30 days'), '[]', '{}')
  `).run(generateId(), tenantId, planCode)
}

function newAdmin() {
  const u = createTestUser({ role: 'ADMIN' })
  tenants.push(u.tenantId)
  return u
}

describe('HR Phase 3b — Shifts & Attendance API (/api/hr)', () => {
  const app = buildApp()

  it('imports an attlog sample (2 pins, one mapped), deduplicates on re-import, reports unmapped pins, and computes shift summary with late & OT', async () => {
    const adminA = newAdmin()
    const authA = { Authorization: `Bearer ${adminA.token}` }

    // 1. Create a 09:00–18:00 shift (grace 0, break 60)
    const shiftRes = await request(app)
      .post('/api/hr/shifts')
      .set(authA)
      .send({
        name: 'กะปกติ 09-18',
        start_time: '09:00',
        end_time: '18:00',
        grace_minutes: 0,
        break_minutes: 60,
      })
    expect(shiftRes.status).toBe(201)
    const shiftId = shiftRes.body.data.id

    // 2. Create a mapped employee (pin '101') and assign the shift via PUT /employees/:id
    const empRes = await request(app)
      .post('/api/hr/employees')
      .set(authA)
      .send({
        first_name: 'สมชาย',
        last_name: 'ใจดี',
        employment_type: 'MONTHLY',
        base_wage: 20000,
        start_date: '2026-01-01',
        device_pin: '101',
      })
    expect(empRes.status).toBe(201)
    const empId = empRes.body.data.id

    const putEmpRes = await request(app)
      .put(`/api/hr/employees/${empId}`)
      .set(authA)
      .send({ shift_id: shiftId })
    expect(putEmpRes.status).toBe(200)
    expect(putEmpRes.body.data.shift_id).toBe(shiftId)

    // Create a second employee without a shift to verify noShift bucket
    const empNoShiftRes = await request(app)
      .post('/api/hr/employees')
      .set(authA)
      .send({
        first_name: 'สมหญิง',
        last_name: 'ไร้กะ',
        employment_type: 'DAILY',
        base_wage: 500,
        start_date: '2026-01-01',
      })
    expect(empNoShiftRes.status).toBe(201)

    // 3. Import ZKTeco attlog sample:
    //    Pin 101 (mapped): 2026-03-02 (Mon) 09:15 in (15m late), 19:00 out (60m OT candidate)
    //    Pin 202 (unmapped): 2026-03-02 08:55 in, 18:05 out
    const attlogSample = [
      '101\t2026-03-02 09:15:00\t1\t0\t1\t0',
      '101\t2026-03-02 19:00:00\t1\t1\t1\t0',
      '202\t2026-03-02 08:55:00\t1\t0\t1\t0',
      '202\t2026-03-02 18:05:00\t1\t1\t1\t0',
    ].join('\n')

    const imp1 = await request(app)
      .post('/api/hr/attendance/import')
      .set(authA)
      .send({ filename: 'attlog.dat', content: attlogSample })

    expect(imp1.status).toBe(200)
    expect(imp1.body.total).toBe(4)
    expect(imp1.body.inserted).toBe(4)
    expect(imp1.body.duplicates).toBe(0)
    expect(imp1.body.skipped).toEqual([])
    expect(imp1.body.unmappedPins).toEqual([{ pin: '202', count: 2 }])

    // 4. Re-import the exact same content → all duplicates
    const imp2 = await request(app)
      .post('/api/hr/attendance/import')
      .set(authA)
      .send({ filename: 'attlog.dat', content: attlogSample })

    expect(imp2.status).toBe(200)
    expect(imp2.body.total).toBe(4)
    expect(imp2.body.inserted).toBe(0)
    expect(imp2.body.duplicates).toBe(4)

    // 5. Unmapped endpoint returns pin 202 with count and first/last punch
    const unmappedRes = await request(app)
      .get('/api/hr/attendance/unmapped')
      .set(authA)

    expect(unmappedRes.status).toBe(200)
    const unmappedList = unmappedRes.body.data
    expect(unmappedList).toHaveLength(1)
    expect(unmappedList[0]).toMatchObject({
      pin: '202',
      count: 2,
      first_punch: '2026-03-02 08:55:00',
      last_punch: '2026-03-02 18:05:00',
    })

    // 6. Summary endpoint for 2026-03-02..2026-03-03 (Mon-Tue)
    //    2026-03-02: worked, lateMinutes = 15, otCandidateMinutes = 60
    //    2026-03-03: absent
    const sumRes = await request(app)
      .get('/api/hr/attendance/summary?from=2026-03-02&to=2026-03-03')
      .set(authA)

    expect(sumRes.status).toBe(200)
    expect(sumRes.body.employees).toHaveLength(1)
    const empSummary = sumRes.body.employees[0]
    expect(empSummary.employeeId).toBe(empId)
    expect(empSummary.totals).toEqual({
      daysWorked: 1,
      absentDays: 1,
      lateMinutes: 15,
      earlyLeaveMinutes: 0,
      otCandidateMinutes: 60,
    })
    expect(empSummary.days).toHaveLength(2)
    expect(empSummary.days[0]).toMatchObject({
      workDate: '2026-03-02',
      lateMinutes: 15,
      otCandidateMinutes: 60,
      workedMinutes: 525,
      absent: false,
    })
    expect(empSummary.days[1]).toMatchObject({
      workDate: '2026-03-03',
      absent: true,
    })
    expect(sumRes.body.noShift).toHaveLength(1)
    expect(sumRes.body.noShift[0].first_name).toBe('สมหญิง')

    // 7. Tenant B sees nothing of Tenant A
    const adminB = newAdmin()
    const authB = { Authorization: `Bearer ${adminB.token}` }

    const bShifts = await request(app).get('/api/hr/shifts').set(authB)
    expect(bShifts.status).toBe(200)
    expect(bShifts.body.data).toEqual([])

    const bUnmapped = await request(app)
      .get('/api/hr/attendance/unmapped')
      .set(authB)
    expect(bUnmapped.status).toBe(200)
    expect(bUnmapped.body.data).toEqual([])

    const bLogs = await request(app).get('/api/hr/attendance/logs').set(authB)
    expect(bLogs.status).toBe(200)
    expect(bLogs.body.data).toEqual([])

    const bSummary = await request(app)
      .get('/api/hr/attendance/summary?from=2026-03-02&to=2026-03-03')
      .set(authB)
    expect(bSummary.status).toBe(200)
    expect(bSummary.body.employees).toEqual([])
    expect(bSummary.body.noShift).toEqual([])
  })

  it('returns 403 for a user without hr permission or tenant without hr subscription feature', async () => {
    const adminA = newAdmin()

    // 1. User in SALES department only (role USER) lacks hr:read and hr:write
    const salesUser = createTestUser({ role: 'USER', tenantId: adminA.tenantId })
    db.prepare('UPDATE users SET departments = ?, custom_permissions = ? WHERE id = ?').run(
      JSON.stringify(['SALES']),
      null,
      salesUser.userId
    )
    const authSales = { Authorization: `Bearer ${salesUser.token}` }

    const getRes = await request(app)
      .get('/api/hr/attendance/summary?from=2026-03-02&to=2026-03-03')
      .set(authSales)
    expect(getRes.status).toBe(403)

    const postRes = await request(app)
      .post('/api/hr/attendance/import')
      .set(authSales)
      .send({ filename: 'a.txt', content: '101\t2026-03-02 09:00:00' })
    expect(postRes.status).toBe(403)

    // 2. Tenant subscribed to pro plan (without 'hr' feature) gets 403 from subscriptionGate('hr')
    const proAdmin = newAdmin()
    setTenantPlan(proAdmin.tenantId, 'pro')
    const subDeniedRes = await request(app)
      .get('/api/hr/shifts')
      .set('Authorization', `Bearer ${proAdmin.token}`)
    expect(subDeniedRes.status).toBe(403)
  })

  it('rejects attendance import content larger than 5 MB with 413', async () => {
    const adminA = newAdmin()
    const overFiveMb = 'a'.repeat(5 * 1024 * 1024 + 100)

    const res = await request(app)
      .post('/api/hr/attendance/import')
      .set('Authorization', `Bearer ${adminA.token}`)
      .send({ filename: 'huge.dat', content: overFiveMb })

    expect([400, 413]).toContain(res.status)
  })
})
