import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import hrRouter from './hr.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/hr', authenticate, subscriptionGate('hr'))
app.use('/api/hr', hrRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM employees WHERE tenant_id = ?').run(t)
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

describe('HR routes (/api/hr)', () => {
  it('feature gate: tenant on pro → 403 FEATURE_LOCKED, enterprise_ai → 200', async () => {
    const proUser = newAdmin()
    setTenantPlan(proUser.tenantId, 'pro')
    const rPro = await request(app)
      .get('/api/hr/employees')
      .set('Authorization', `Bearer ${proUser.token}`)
    expect(rPro.status).toBe(403)
    expect(rPro.body.code).toBe('FEATURE_LOCKED')
    expect(rPro.body.feature).toBe('hr')

    const entUser = newAdmin()
    setTenantPlan(entUser.tenantId, 'enterprise_ai')
    const rEnt = await request(app)
      .get('/api/hr/employees')
      .set('Authorization', `Bearer ${entUser.token}`)
    expect(rEnt.status).toBe(200)
    expect(rEnt.body.data).toEqual([])
  })

  it('CRUD happy path: org units, auto codes EMP-001/EMP-002, update, offboard, and /me', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    // Create org unit
    const ouRes = await request(app).post('/api/hr/org-units').set(auth).send({
      name: 'ฝ่ายขายหน้าร้าน',
      business_unit: 'RETAIL',
    })
    expect(ouRes.status).toBe(201)
    const ouId = ouRes.body.data.id
    expect(ouRes.body.data.business_unit).toBe('RETAIL')

    // Create 1st employee (blank code -> EMP-001) linked to admin user
    const e1Res = await request(app).post('/api/hr/employees').set(auth).send({
      first_name: 'สมชาย',
      last_name: 'ใจดี',
      nickname: 'ชาย',
      org_unit_id: ouId,
      position: 'พนักงานขาย',
      employment_type: 'MONTHLY',
      base_wage: 18000,
      start_date: '2026-01-15',
      national_id: '1100100100101',
      bank_name: 'KBANK',
      bank_account: '123-4-56789-0',
      user_id: admin.userId,
      device_pin: '1234',
      tax_allowances: { spouse: 60000, children: 30000 },
    })
    expect(e1Res.status).toBe(201)
    expect(e1Res.body.data.code).toBe('EMP-001')
    expect(e1Res.body.data.user_id).toBe(admin.userId)
    const e1Id = e1Res.body.data.id

    // Create 2nd employee (blank code -> EMP-002)
    const e2Res = await request(app).post('/api/hr/employees').set(auth).send({
      first_name: 'สมหญิง',
      employment_type: 'DAILY',
      base_wage: 450,
      start_date: '2026-02-01',
      org_unit_id: ouId,
    })
    expect(e2Res.status).toBe(201)
    expect(e2Res.body.data.code).toBe('EMP-002')
    const e2Id = e2Res.body.data.id

    // Duplicate user_id and duplicate device_pin -> 409
    const dupUser = await request(app).post('/api/hr/employees').set(auth).send({
      first_name: 'ซ้ำผู้ใช้',
      employment_type: 'MONTHLY',
      base_wage: 15000,
      start_date: '2026-03-01',
      user_id: admin.userId,
    })
    expect(dupUser.status).toBe(409)

    // Partial unique index uq_employees_tenant_user also enforces uniqueness at DB level
    expect(() =>
      db.prepare(`
        INSERT INTO employees (id, tenant_id, code, first_name, employment_type, base_wage, start_date, status, user_id)
        VALUES (?, ?, 'EMP-999', 'ซ้ำDB', 'MONTHLY', 10000, '2026-03-01', 'ACTIVE', ?)
      `).run(generateId(), admin.tenantId, admin.userId)
    ).toThrow(/UNIQUE/i)

    const dupPin = await request(app).post('/api/hr/employees').set(auth).send({
      first_name: 'ซ้ำพิน',
      employment_type: 'MONTHLY',
      base_wage: 15000,
      start_date: '2026-03-01',
      device_pin: '1234',
    })
    expect(dupPin.status).toBe(409)

    // GET /me returns the employee linked to admin.id with all sensitive fields
    const meRes = await request(app).get('/api/hr/me').set(auth)
    expect(meRes.status).toBe(200)
    expect(meRes.body.data.id).toBe(e1Id)
    expect(meRes.body.data.base_wage).toBe(18000)
    expect(meRes.body.data.bank_account).toBe('123-4-56789-0')

    // Update employee
    const upRes = await request(app).put(`/api/hr/employees/${e1Id}`).set(auth).send({
      position: 'หัวหน้าทีมขาย',
      base_wage: 22000,
    })
    expect(upRes.status).toBe(200)
    expect(upRes.body.data.position).toBe('หัวหน้าทีมขาย')
    expect(upRes.body.data.base_wage).toBe(22000)

    // Cannot delete org unit while it has ACTIVE employees -> 409
    const delFail = await request(app).delete(`/api/hr/org-units/${ouId}`).set(auth)
    expect(delFail.status).toBe(409)

    // Offboard both employees, then delete org unit succeeds
    const off1 = await request(app).post(`/api/hr/employees/${e1Id}/offboard`).set(auth).send({
      end_date: '2026-10-31',
      status: 'RESIGNED',
    })
    expect(off1.status).toBe(200)
    expect(off1.body.data.status).toBe('RESIGNED')
    expect(off1.body.data.end_date).toBe('2026-10-31')

    await request(app).post(`/api/hr/employees/${e2Id}/offboard`).set(auth).send({
      end_date: '2026-10-31',
      status: 'TERMINATED',
    })

    const delOk = await request(app).delete(`/api/hr/org-units/${ouId}`).set(auth)
    expect(delOk.status).toBe(200)
  })

  it('rejects org unit parent cycles (400) and deleting unit with child (409)', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    const a = (await request(app).post('/api/hr/org-units').set(auth).send({ name: 'A' })).body.data
    const b = (await request(app).post('/api/hr/org-units').set(auth).send({ name: 'B', parent_id: a.id })).body.data
    const c = (await request(app).post('/api/hr/org-units').set(auth).send({ name: 'C', parent_id: b.id })).body.data

    // Self cycle: A -> A
    const selfCycle = await request(app).put(`/api/hr/org-units/${a.id}`).set(auth).send({ parent_id: a.id })
    expect(selfCycle.status).toBe(400)

    // Indirect cycle: A -> C (where C -> B -> A)
    const indirectCycle = await request(app).put(`/api/hr/org-units/${a.id}`).set(auth).send({ parent_id: c.id })
    expect(indirectCycle.status).toBe(400)

    // Cannot delete A while B is its child -> 409
    const delParent = await request(app).delete(`/api/hr/org-units/${a.id}`).set(auth)
    expect(delParent.status).toBe(409)
  })

  it('tenant isolation: tenant B cannot read, update, offboard, or delete tenant A rows', async () => {
    const a = newAdmin()
    const b = newAdmin()
    const authA = { Authorization: `Bearer ${a.token}` }
    const authB = { Authorization: `Bearer ${b.token}` }

    const ouA = (await request(app).post('/api/hr/org-units').set(authA).send({ name: 'คลัง A' })).body.data
    const empA = (await request(app).post('/api/hr/employees').set(authA).send({
      first_name: 'เอก',
      employment_type: 'MONTHLY',
      base_wage: 20000,
      start_date: '2026-01-01',
      org_unit_id: ouA.id,
    })).body.data

    const listB = await request(app).get('/api/hr/employees').set(authB)
    expect(listB.status).toBe(200)
    expect(listB.body.data).toEqual([])

    expect((await request(app).get(`/api/hr/employees/${empA.id}`).set(authB)).status).toBe(404)
    expect((await request(app).put(`/api/hr/employees/${empA.id}`).set(authB).send({ first_name: 'แฮก' })).status).toBe(404)
    expect((await request(app).post(`/api/hr/employees/${empA.id}/offboard`).set(authB).send({ end_date: '2026-10-31', status: 'RESIGNED' })).status).toBe(404)
    expect((await request(app).put(`/api/hr/org-units/${ouA.id}`).set(authB).send({ name: 'แฮก' })).status).toBe(404)
    expect((await request(app).delete(`/api/hr/org-units/${ouA.id}`).set(authB)).status).toBe(404)
  })

  it('permissions: USER without HR department gets 403 on write; read-only user has sensitive fields omitted', async () => {
    const admin = newAdmin()
    const authAdmin = { Authorization: `Bearer ${admin.token}` }

    const emp = (await request(app).post('/api/hr/employees').set(authAdmin).send({
      first_name: 'วิชัย',
      employment_type: 'MONTHLY',
      base_wage: 35000,
      start_date: '2026-01-01',
      national_id: '1234567890123',
      bank_account: '999-9-99999-9',
      tax_allowances: { spouse: 60000 },
    })).body.data

    const setPerms = (userId: string, departments: string[], customPermissions?: Record<string, boolean>) => {
      db.prepare('UPDATE users SET departments = ?, custom_permissions = ? WHERE id = ?').run(
        JSON.stringify(departments),
        customPermissions ? JSON.stringify(customPermissions) : null,
        userId
      )
    }

    // USER in SALES department (no HR) -> 403 on read & write
    const salesUser = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    setPerms(salesUser.userId, ['SALES'])
    const authSales = { Authorization: `Bearer ${salesUser.token}` }
    expect((await request(app).get('/api/hr/employees').set(authSales)).status).toBe(403)
    expect((await request(app).post('/api/hr/employees').set(authSales).send({
      first_name: 'ทดสอบ',
      employment_type: 'MONTHLY',
      base_wage: 15000,
      start_date: '2026-01-01',
    })).status).toBe(403)

    // Read-only HR user (users.custom_permissions grants hr:read, denies hr:write)
    const readOnlyUser = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    setPerms(readOnlyUser.userId, ['SALES'], { 'hr:read': true, 'hr:write': false })
    const authRO = { Authorization: `Bearer ${readOnlyUser.token}` }

    // Write still 403
    expect((await request(app).put(`/api/hr/employees/${emp.id}`).set(authRO).send({ first_name: 'แก้' })).status).toBe(403)

    // Read succeeds, sensitive fields are omitted
    const listRO = await request(app).get('/api/hr/employees').set(authRO)
    expect(listRO.status).toBe(200)
    expect(listRO.body.data).toHaveLength(1)
    const item = listRO.body.data[0]
    expect(item.first_name).toBe('วิชัย')
    expect('base_wage' in item).toBe(false)
    expect('national_id' in item).toBe(false)
    expect('bank_account' in item).toBe(false)
    expect('tax_allowances' in item).toBe(false)

    const detailRO = await request(app).get(`/api/hr/employees/${emp.id}`).set(authRO)
    expect(detailRO.status).toBe(200)
    expect('base_wage' in detailRO.body.data).toBe(false)
    expect('bank_account' in detailRO.body.data).toBe(false)

    // User with HR department has hr:read and hr:write -> sees sensitive fields
    const hrStaff = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    setPerms(hrStaff.userId, ['HR'])
    const detailHR = await request(app).get(`/api/hr/employees/${emp.id}`).set('Authorization', `Bearer ${hrStaff.token}`)
    expect(detailHR.status).toBe(200)
    expect(detailHR.body.data.base_wage).toBe(35000)
    expect(detailHR.body.data.bank_account).toBe('999-9-99999-9')
  })
})
