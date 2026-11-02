import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import bcrypt from 'bcryptjs'
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

function setTenantPlan(tenantId: string, planCode = 'enterprise_ai') {
  db.prepare('DELETE FROM tenant_subscriptions WHERE tenant_id = ?').run(tenantId)
  db.prepare(`
    INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, current_period_end, packs, addons)
    VALUES (?, ?, ?, 'ACTIVE', datetime('now', '+30 days'), '[]', '{}')
  `).run(generateId(), tenantId, planCode)
}

function newAdmin() {
  const u = createTestUser({ role: 'ADMIN' })
  tenants.push(u.tenantId)
  setTenantPlan(u.tenantId, 'enterprise_ai')
  return u
}

describe('HR Phase 4 — Employee check-in PIN (Task B5)', () => {
  it('sets PIN 1234 on PUT: has_checkin_pin is true, bcrypt hash stored, and checkin_pin_hash is never exposed in PUT, list, detail, or /me', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    // Create an employee linked to admin's user
    const empRes = await request(app).post('/api/hr/employees').set(auth).send({
      first_name: 'สมชาย',
      last_name: 'ใจดี',
      employment_type: 'MONTHLY',
      base_wage: 20000,
      start_date: '2026-01-01',
      user_id: admin.userId,
    })
    expect(empRes.status).toBe(201)
    const empId = empRes.body.data.id
    expect(empRes.body.data.has_checkin_pin).toBe(false)
    expect('checkin_pin_hash' in empRes.body.data).toBe(false)

    // Set PIN 1234
    const putRes = await request(app).put(`/api/hr/employees/${empId}`).set(auth).send({
      checkin_pin: '1234',
    })
    expect(putRes.status).toBe(200)
    expect(putRes.body.data.has_checkin_pin).toBe(true)
    expect('checkin_pin_hash' in putRes.body.data).toBe(false)

    // Direct DB check: hash must be stored and match bcrypt comparison
    const dbRow = db.prepare('SELECT checkin_pin_hash FROM employees WHERE id = ? AND tenant_id = ?').get(empId, admin.tenantId) as any
    expect(dbRow?.checkin_pin_hash).toBeTruthy()
    expect(await bcrypt.compare('1234', dbRow.checkin_pin_hash)).toBe(true)

    // GET /employees (list)
    const listRes = await request(app).get('/api/hr/employees').set(auth)
    expect(listRes.status).toBe(200)
    const empInList = listRes.body.data.find((e: any) => e.id === empId)
    expect(empInList.has_checkin_pin).toBe(true)
    expect('checkin_pin_hash' in empInList).toBe(false)

    // GET /employees/:id (detail)
    const detailRes = await request(app).get(`/api/hr/employees/${empId}`).set(auth)
    expect(detailRes.status).toBe(200)
    expect(detailRes.body.data.has_checkin_pin).toBe(true)
    expect('checkin_pin_hash' in detailRes.body.data).toBe(false)

    // GET /me
    const meRes = await request(app).get('/api/hr/me').set(auth)
    expect(meRes.status).toBe(200)
    expect(meRes.body.data.has_checkin_pin).toBe(true)
    expect('checkin_pin_hash' in meRes.body.data).toBe(false)
  })

  it('rejects invalid PIN formats with 400 and Thai error message', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    const empRes = await request(app).post('/api/hr/employees').set(auth).send({
      first_name: 'กานต์',
      employment_type: 'MONTHLY',
      base_wage: 15000,
      start_date: '2026-01-01',
    })
    const empId = empRes.body.data.id

    const invalidPins = ['12ab', '123', '1234567', 1234, '', '12345 ']
    for (const pin of invalidPins) {
      const res = await request(app).put(`/api/hr/employees/${empId}`).set(auth).send({
        checkin_pin: pin,
      })
      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.message).toBe('PIN ต้องเป็นตัวเลข 4–6 หลัก')
    }
  })

  it('clears PIN when passing null: has_checkin_pin becomes false and DB hash is cleared', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    const empRes = await request(app).post('/api/hr/employees').set(auth).send({
      first_name: 'วิภา',
      employment_type: 'DAILY',
      base_wage: 500,
      start_date: '2026-01-01',
      checkin_pin: '5678',
    })
    expect(empRes.status).toBe(201)
    const empId = empRes.body.data.id
    expect(empRes.body.data.has_checkin_pin).toBe(true)

    // Clear PIN with null
    const clearRes = await request(app).put(`/api/hr/employees/${empId}`).set(auth).send({
      checkin_pin: null,
    })
    expect(clearRes.status).toBe(200)
    expect(clearRes.body.data.has_checkin_pin).toBe(false)
    expect('checkin_pin_hash' in clearRes.body.data).toBe(false)

    // DB check: checkin_pin_hash should be null
    const row = db.prepare('SELECT checkin_pin_hash FROM employees WHERE id = ?').get(empId) as any
    expect(row.checkin_pin_hash).toBeNull()
  })

  it('leaves PIN unchanged when checkin_pin is undefined', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    const empRes = await request(app).post('/api/hr/employees').set(auth).send({
      first_name: 'มานะ',
      employment_type: 'MONTHLY',
      base_wage: 25000,
      start_date: '2026-01-01',
      checkin_pin: '123456',
    })
    const empId = empRes.body.data.id
    expect(empRes.body.data.has_checkin_pin).toBe(true)

    // PUT without checkin_pin
    const putRes = await request(app).put(`/api/hr/employees/${empId}`).set(auth).send({
      nickname: 'นะ',
    })
    expect(putRes.status).toBe(200)
    expect(putRes.body.data.nickname).toBe('นะ')
    expect(putRes.body.data.has_checkin_pin).toBe(true)
    expect('checkin_pin_hash' in putRes.body.data).toBe(false)

    const row = db.prepare('SELECT checkin_pin_hash FROM employees WHERE id = ?').get(empId) as any
    expect(await bcrypt.compare('123456', row.checkin_pin_hash)).toBe(true)
  })

  it('requires hr:write permission: USER without hr:write gets 403', async () => {
    const admin = newAdmin()
    const empRes = await request(app).post('/api/hr/employees').set('Authorization', `Bearer ${admin.token}`).send({
      first_name: 'ชูใจ',
      employment_type: 'MONTHLY',
      base_wage: 18000,
      start_date: '2026-01-01',
    })
    const empId = empRes.body.data.id

    // User in SALES (no HR permissions)
    const salesUser = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    db.prepare('UPDATE users SET departments = ? WHERE id = ?').run(JSON.stringify(['SALES']), salesUser.userId)

    const res = await request(app).put(`/api/hr/employees/${empId}`).set('Authorization', `Bearer ${salesUser.token}`).send({
      checkin_pin: '1234',
    })
    expect(res.status).toBe(403)
  })

  it('never leaks checkin_pin_hash on offboard response', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    const empRes = await request(app).post('/api/hr/employees').set(auth).send({
      first_name: 'ปิติ',
      employment_type: 'MONTHLY',
      base_wage: 20000,
      start_date: '2026-01-01',
      checkin_pin: '4321',
    })
    const empId = empRes.body.data.id

    const offRes = await request(app).post(`/api/hr/employees/${empId}/offboard`).set(auth).send({
      end_date: '2026-10-31',
      status: 'RESIGNED',
    })
    expect(offRes.status).toBe(200)
    expect(offRes.body.data.has_checkin_pin).toBe(true)
    expect('checkin_pin_hash' in offRes.body.data).toBe(false)
  })
})
