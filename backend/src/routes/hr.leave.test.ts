import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import hrLeaveRoutes from './hr.leave.routes'
import { createTestUser } from '../test/testAuth'

function buildApp() {
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.use('/api/hr', authenticate, subscriptionGate('hr'))
  app.use('/api/hr', hrLeaveRoutes)
  return app
}

const tenants: string[] = []

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM approval_logs WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM approval_requests WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM leave_requests WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM leave_types WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM public_holidays WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM employees WHERE tenant_id = ?').run(t)
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

function newUser(tenantId?: string) {
  const u = createTestUser({ role: 'USER', tenantId })
  if (!tenantId) tenants.push(u.tenantId)
  return u
}

function insertEmployee(
  tenantId: string,
  code: string,
  firstName: string,
  lastName: string,
  userId?: string
): string {
  const id = generateId()
  db.prepare(`
    INSERT INTO employees (
      id, tenant_id, code, first_name, last_name, employment_type,
      base_wage, start_date, status, user_id
    ) VALUES (?, ?, ?, ?, ?, 'MONTHLY', 25000, '2026-01-01', 'ACTIVE', ?)
  `).run(id, tenantId, code, firstName, lastName, userId || null)
  return id
}

describe('HR Phase 4 — Leave & Holiday API (/api/hr)', () => {
  const app = buildApp()

  it('starter creates 8 then 0', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    const res1 = await request(app).post('/api/hr/leave-types/starter').set(auth)
    expect(res1.status).toBe(200)
    expect(res1.body).toEqual({ success: true, data: { created: 8 } })

    const res2 = await request(app).post('/api/hr/leave-types/starter').set(auth)
    expect(res2.status).toBe(200)
    expect(res2.body).toEqual({ success: true, data: { created: 0 } })

    const listRes = await request(app).get('/api/hr/leave-types').set(auth)
    expect(listRes.status).toBe(200)
    expect(listRes.body.data).toHaveLength(8)
    const codes = listRes.body.data.map((t: any) => t.code)
    expect(codes).toContain('SICK')
    expect(codes).toContain('VACATION')
    expect(codes).toContain('UNPAID')
  })

  it('L2 duplicate code 409 and L3 update', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    const res1 = await request(app)
      .post('/api/hr/leave-types')
      .set(auth)
      .send({
        code: 'SPECIAL',
        name: 'ลาพิเศษ',
        paid: true,
        days_per_year: 5,
      })
    expect(res1.status).toBe(201)
    expect(res1.body.data).toMatchObject({
      code: 'SPECIAL',
      name: 'ลาพิเศษ',
      paid: true,
      days_per_year: 5,
      is_active: true,
    })
    const typeId = res1.body.data.id

    // Duplicate code in same tenant -> 409
    const resDup = await request(app)
      .post('/api/hr/leave-types')
      .set(auth)
      .send({
        code: 'SPECIAL',
        name: 'ลาพิเศษซ้ำ',
        paid: false,
        days_per_year: 10,
      })
    expect(resDup.status).toBe(409)
    expect(resDup.body.success).toBe(false)

    // L3 update
    const resPut = await request(app)
      .put(`/api/hr/leave-types/${typeId}`)
      .set(auth)
      .send({
        name: 'ลาพิเศษปรับปรุง',
        days_per_year: 7,
      })
    expect(resPut.status).toBe(200)
    expect(resPut.body.data).toMatchObject({
      id: typeId,
      code: 'SPECIAL',
      name: 'ลาพิเศษปรับปรุง',
      days_per_year: 7,
      paid: true,
    })
  })

  it('holiday CRUD + year filter + duplicate date 409', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    const h1 = await request(app)
      .post('/api/hr/holidays')
      .set(auth)
      .send({ date: '2026-04-13', name: 'วันสงกรานต์' })
    expect(h1.status).toBe(201)
    expect(h1.body.data).toMatchObject({ date: '2026-04-13', name: 'วันสงกรานต์' })

    const hDup = await request(app)
      .post('/api/hr/holidays')
      .set(auth)
      .send({ date: '2026-04-13', name: 'วันสงกรานต์ซ้ำ' })
    expect(hDup.status).toBe(409)

    const h2 = await request(app)
      .post('/api/hr/holidays')
      .set(auth)
      .send({ date: '2025-12-31', name: 'วันสิ้นปี 2568' })
    expect(h2.status).toBe(201)

    // Year filter 2026
    const res2026 = await request(app).get('/api/hr/holidays?year=2026').set(auth)
    expect(res2026.status).toBe(200)
    expect(res2026.body.data).toHaveLength(1)
    expect(res2026.body.data[0].date).toBe('2026-04-13')

    // Year filter 2025
    const res2025 = await request(app).get('/api/hr/holidays?year=2025').set(auth)
    expect(res2025.status).toBe(200)
    expect(res2025.body.data).toHaveLength(1)
    expect(res2025.body.data[0].date).toBe('2025-12-31')

    // Delete holiday
    const delRes = await request(app)
      .delete(`/api/hr/holidays/${h1.body.data.id}`)
      .set(auth)
    expect(delRes.status).toBe(200)
    expect(delRes.body.data).toEqual({ id: h1.body.data.id })

    const delAgain = await request(app)
      .delete(`/api/hr/holidays/${h1.body.data.id}`)
      .set(auth)
    expect(delAgain.status).toBe(404)
  })

  it('self request 201 PENDING with approval_requests row, self for another employee 403, overlap 409, days 0.3 400, cancel own PENDING', async () => {
    const admin = newAdmin()
    // Seed starter leave types
    await request(app)
      .post('/api/hr/leave-types/starter')
      .set('Authorization', `Bearer ${admin.token}`)

    const ltSick = db
      .prepare('SELECT id FROM leave_types WHERE tenant_id = ? AND code = ?')
      .get(admin.tenantId, 'SICK') as any

    // Create a USER (no hr permissions)
    const user = newUser(admin.tenantId)
    const emp1Id = insertEmployee(admin.tenantId, 'EMP-001', 'สมชาย', 'ใจดี', user.userId)
    const emp2Id = insertEmployee(admin.tenantId, 'EMP-002', 'สมหญิง', 'สุขใจ')

    const userAuth = { Authorization: `Bearer ${user.token}` }

    // 1. self for another employee -> 403
    const forOtherRes = await request(app)
      .post('/api/hr/leave-requests')
      .set(userAuth)
      .send({
        employee_id: emp2Id,
        leave_type_id: ltSick.id,
        start_date: '2026-11-03',
        end_date: '2026-11-04',
        days: 2,
      })
    expect(forOtherRes.status).toBe(403)

    // 2. days 0.3 -> 400 (not multiple of 0.5)
    const daysRes = await request(app)
      .post('/api/hr/leave-requests')
      .set(userAuth)
      .send({
        employee_id: emp1Id,
        leave_type_id: ltSick.id,
        start_date: '2026-11-03',
        end_date: '2026-11-03',
        days: 0.3,
      })
    expect(daysRes.status).toBe(400)

    // 3. self request -> 201 PENDING and approval_requests row created
    const leaveRes = await request(app)
      .post('/api/hr/leave-requests')
      .set(userAuth)
      .send({
        employee_id: emp1Id,
        leave_type_id: ltSick.id,
        start_date: '2026-11-03',
        end_date: '2026-11-04',
        days: 2,
        reason: 'ป่วยเป็นไข้หวัด',
      })
    expect(leaveRes.status).toBe(201)
    expect(leaveRes.body.data.status).toBe('PENDING')
    expect(leaveRes.body.data.employee_id).toBe(emp1Id)
    expect(leaveRes.body.data.employee_name).toBe('สมชาย ใจดี')
    expect(leaveRes.body.data.days).toBe(2)
    const leaveId = leaveRes.body.data.id
    const aprId = leaveRes.body.data.approval_request_id
    expect(aprId).toBeTruthy()

    // Verify approval_requests table row
    const aprRow = db
      .prepare('SELECT * FROM approval_requests WHERE module_type = ? AND reference_id = ?')
      .get('leave', leaveId) as any
    expect(aprRow).toBeTruthy()
    expect(aprRow.id).toBe(aprId)
    expect(aprRow.status).toBe('PENDING')
    expect(aprRow.reference_type).toBe('leave_requests')
    expect(aprRow.description).toContain('สมชาย ใจดี')
    expect(aprRow.description).toContain('ลาป่วย 2 วัน')

    // 4. overlap 409 (overlapping 2026-11-03..2026-11-04)
    const overlapRes = await request(app)
      .post('/api/hr/leave-requests')
      .set(userAuth)
      .send({
        employee_id: emp1Id,
        leave_type_id: ltSick.id,
        start_date: '2026-11-04',
        end_date: '2026-11-05',
        days: 2,
      })
    expect(overlapRes.status).toBe(409)

    // 5. cancel own PENDING -> CANCELLED and approval request no longer PENDING
    const cancelRes = await request(app)
      .post(`/api/hr/leave-requests/${leaveId}/cancel`)
      .set(userAuth)
    expect(cancelRes.status).toBe(200)
    expect(cancelRes.body.data.status).toBe('CANCELLED')

    const updatedApr = db
      .prepare('SELECT status FROM approval_requests WHERE id = ?')
      .get(aprId) as any
    expect(updatedApr.status).toBe('CANCELLED')
    expect(updatedApr.status).not.toBe('PENDING')

    // Approval log recorded 'CANCEL'
    const logRow = db
      .prepare('SELECT * FROM approval_logs WHERE approval_request_id = ? AND action = ?')
      .get(aprId, 'CANCEL') as any
    expect(logRow).toBeTruthy()
    expect(logRow.new_status).toBe('CANCELLED')
  })

  it('balances: quota/used/pending/remaining after inserting an APPROVED row with SQL', async () => {
    const admin = newAdmin()
    await request(app)
      .post('/api/hr/leave-types/starter')
      .set('Authorization', `Bearer ${admin.token}`)

    const ltVac = db
      .prepare('SELECT id FROM leave_types WHERE tenant_id = ? AND code = ?')
      .get(admin.tenantId, 'VACATION') as any

    const user = newUser(admin.tenantId)
    const empId = insertEmployee(admin.tenantId, 'EMP-010', 'กิตติ', 'มั่นคง', user.userId)

    // Insert an APPROVED row directly with SQL for year 2026
    db.prepare(`
      INSERT INTO leave_requests (
        id, tenant_id, employee_id, leave_type_id, start_date, end_date, days,
        reason, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, '2026-06-01', '2026-06-02', 2, 'พักผ่อน', 'APPROVED', '2026-05-20T00:00:00Z', '2026-05-20T00:00:00Z')
    `).run(generateId(), admin.tenantId, empId, ltVac.id)

    // Insert a PENDING row directly with SQL for year 2026
    db.prepare(`
      INSERT INTO leave_requests (
        id, tenant_id, employee_id, leave_type_id, start_date, end_date, days,
        reason, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, '2026-07-01', '2026-07-01', 0.5, 'ธุระ', 'PENDING', '2026-06-20T00:00:00Z', '2026-06-20T00:00:00Z')
    `).run(generateId(), admin.tenantId, empId, ltVac.id)

    const balRes = await request(app)
      .get(`/api/hr/leave-balances?employee_id=${empId}&year=2026`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(balRes.status).toBe(200)
    const vac = balRes.body.data.find((b: any) => b.code === 'VACATION')
    expect(vac).toMatchObject({
      code: 'VACATION',
      quota: 6,
      used: 2,
      pending: 0.5,
      remaining: 4, // 6 - 2 = 4
    })
  })

  it('tenant B gets 404 on tenant A ids and sees empty lists', async () => {
    const adminA = newAdmin()
    const adminB = newAdmin()

    const authA = { Authorization: `Bearer ${adminA.token}` }
    const authB = { Authorization: `Bearer ${adminB.token}` }

    // Tenant A creates holiday, leave type, leave request
    const typeRes = await request(app)
      .post('/api/hr/leave-types')
      .set(authA)
      .send({ code: 'TENANT_A', name: 'ลาเฉพาะ A', paid: true, days_per_year: 5 })
    expect(typeRes.status).toBe(201)
    const typeAId = typeRes.body.data.id

    const holRes = await request(app)
      .post('/api/hr/holidays')
      .set(authA)
      .send({ date: '2026-12-05', name: 'วันชาติ' })
    expect(holRes.status).toBe(201)
    const holAId = holRes.body.data.id

    const empAId = insertEmployee(adminA.tenantId, 'EMP-A1', 'สมศักดิ์', 'รักชาติ')
    const leaveRes = await request(app)
      .post('/api/hr/leave-requests')
      .set(authA)
      .send({
        employee_id: empAId,
        leave_type_id: typeAId,
        start_date: '2026-11-20',
        end_date: '2026-11-21',
        days: 2,
      })
    expect(leaveRes.status).toBe(201)
    const leaveAId = leaveRes.body.data.id

    // Tenant B sees empty lists
    const bTypes = await request(app).get('/api/hr/leave-types').set(authB)
    expect(bTypes.body.data).toEqual([])

    const bHolidays = await request(app).get('/api/hr/holidays?year=2026').set(authB)
    expect(bHolidays.body.data).toEqual([])

    const bRequests = await request(app).get('/api/hr/leave-requests').set(authB)
    expect(bRequests.body.data).toEqual([])

    // Tenant B gets 404 on tenant A IDs
    const putType404 = await request(app)
      .put(`/api/hr/leave-types/${typeAId}`)
      .set(authB)
      .send({ name: 'แก้ข้ามบริษัท' })
    expect(putType404.status).toBe(404)

    const delHol404 = await request(app)
      .delete(`/api/hr/holidays/${holAId}`)
      .set(authB)
    expect(delHol404.status).toBe(404)

    const cancel404 = await request(app)
      .post(`/api/hr/leave-requests/${leaveAId}/cancel`)
      .set(authB)
    expect(cancel404.status).toBe(404)

    const bal404 = await request(app)
      .get(`/api/hr/leave-balances?employee_id=${empAId}&year=2026`)
      .set(authB)
    expect(bal404.status).toBe(404)
  })

  it('USER without employee link and without hr → 403 on L8', async () => {
    const admin = newAdmin()
    const unlinkedUser = newUser(admin.tenantId)

    const res = await request(app)
      .get('/api/hr/leave-requests')
      .set('Authorization', `Bearer ${unlinkedUser.token}`)

    expect(res.status).toBe(403)
    expect(res.body.success).toBe(false)
  })
})
