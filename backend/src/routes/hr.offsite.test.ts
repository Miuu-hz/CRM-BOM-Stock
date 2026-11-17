import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import hrOffsiteRoutes from './hr.offsite.routes'
import { createTestUser } from '../test/testAuth'

function buildApp() {
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.use('/api/hr', authenticate, subscriptionGate('hr'))
  app.use('/api/hr', hrOffsiteRoutes)
  return app
}

const tenants: string[] = []

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM approval_logs WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM approval_requests WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM document_sequences WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM offsite_requests WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM employees WHERE tenant_id = ?').run(t)
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

function offsetDate(baseIso: string, deltaDays: number): string {
  const d = new Date(`${baseIso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

describe('HR Offsite Requests API (/api/hr/offsite-requests)', () => {
  const app = buildApp()

  it('self request → 201 PENDING with offsite approval_requests row, overlap → 409, and cancel own PENDING → CANCELLED', async () => {
    const admin = newAdmin()
    const user1 = newUser(admin.tenantId)
    const emp1Id = insertEmployee(admin.tenantId, 'EMP-001', 'สมชาย', 'ใจดี', user1.userId)
    const userAuth = { Authorization: `Bearer ${user1.token}` }

    const today = thaiDateStr()
    const d1 = offsetDate(today, 1)
    const d2 = offsetDate(today, 2)
    const d3 = offsetDate(today, 3)

    const createRes = await request(app)
      .post('/api/hr/offsite-requests')
      .set(userAuth)
      .send({
        start_date: d1,
        end_date: d2,
        place: 'ไซต์งานบางนา',
        reason: 'ติดตั้งอุปกรณ์ลูกค้า',
      })

    expect(createRes.status).toBe(201)
    expect(createRes.body.success).toBe(true)
    expect(createRes.body.data).toMatchObject({
      employee_id: emp1Id,
      employee_code: 'EMP-001',
      employee_name: 'สมชาย ใจดี',
      start_date: d1,
      end_date: d2,
      place: 'ไซต์งานบางนา',
      reason: 'ติดตั้งอุปกรณ์ลูกค้า',
      status: 'PENDING',
      decided_at: null,
    })
    const reqId = createRes.body.data.id

    // Verify approval_requests row in category 'offsite'
    const aprRow = db
      .prepare('SELECT * FROM approval_requests WHERE module_type = ? AND reference_id = ?')
      .get('offsite', reqId) as any
    expect(aprRow).toBeTruthy()
    expect(aprRow.status).toBe('PENDING')
    expect(aprRow.reference_type).toBe('offsite_requests')
    expect(aprRow.amount).toBe(0)
    expect(aprRow.description).toBe(`ขอทำงานนอกสถานที่ ${d1}–${d2} · ไซต์งานบางนา (สมชาย ใจดี)`)

    // Overlapping date range -> 409
    const overlapRes = await request(app)
      .post('/api/hr/offsite-requests')
      .set(userAuth)
      .send({
        start_date: d2,
        end_date: d3,
        place: 'อีกที่หนึ่ง',
      })
    expect(overlapRes.status).toBe(409)
    expect(overlapRes.body.message).toBe('มีคำขอทำงานนอกสถานที่ช่วงนี้อยู่แล้ว')

    // Cancel own PENDING -> CANCELLED + approval_requests CANCELLED
    const cancelRes = await request(app)
      .post(`/api/hr/offsite-requests/${reqId}/cancel`)
      .set(userAuth)
    expect(cancelRes.status).toBe(200)
    expect(cancelRes.body.data.status).toBe('CANCELLED')

    const updatedApr = db
      .prepare('SELECT status FROM approval_requests WHERE id = ?')
      .get(aprRow.id) as any
    expect(updatedApr.status).toBe('CANCELLED')

    // Cancel again when already CANCELLED -> 409
    const cancelAgain = await request(app)
      .post(`/api/hr/offsite-requests/${reqId}/cancel`)
      .set(userAuth)
    expect(cancelAgain.status).toBe(409)
  })

  it('unlinked user → 403, past/reversed/over-31d/empty place → 400, normal employee requesting for another → 403', async () => {
    const admin = newAdmin()
    const unlinked = newUser(admin.tenantId)
    const user1 = newUser(admin.tenantId)
    insertEmployee(admin.tenantId, 'EMP-001', 'สมชาย', 'ใจดี', user1.userId)
    const emp2Id = insertEmployee(admin.tenantId, 'EMP-002', 'สมหญิง', 'สุขใจ')

    const today = thaiDateStr()
    const yesterday = offsetDate(today, -1)
    const d1 = offsetDate(today, 1)
    const d2 = offsetDate(today, 2)
    const d33 = offsetDate(today, 32) // d1..d33 = 32 days (> 31)

    // Unlinked user: POST self and GET mine=1 -> 403
    const unlinkedPost = await request(app)
      .post('/api/hr/offsite-requests')
      .set('Authorization', `Bearer ${unlinked.token}`)
      .send({ start_date: d1, end_date: d1, place: 'หน้างาน' })
    expect(unlinkedPost.status).toBe(403)

    const unlinkedMine = await request(app)
      .get('/api/hr/offsite-requests?mine=1')
      .set('Authorization', `Bearer ${unlinked.token}`)
    expect(unlinkedMine.status).toBe(403)

    const userAuth = { Authorization: `Bearer ${user1.token}` }

    // Past start_date -> 400
    const pastRes = await request(app)
      .post('/api/hr/offsite-requests')
      .set(userAuth)
      .send({ start_date: yesterday, end_date: today, place: 'หน้างาน' })
    expect(pastRes.status).toBe(400)

    // Reversed dates (start_date > end_date) -> 400
    const revRes = await request(app)
      .post('/api/hr/offsite-requests')
      .set(userAuth)
      .send({ start_date: d2, end_date: d1, place: 'หน้างาน' })
    expect(revRes.status).toBe(400)

    // Range > 31 days -> 400
    const longRes = await request(app)
      .post('/api/hr/offsite-requests')
      .set(userAuth)
      .send({ start_date: d1, end_date: d33, place: 'หน้างาน' })
    expect(longRes.status).toBe(400)

    // Empty place -> 400
    const emptyPlaceRes = await request(app)
      .post('/api/hr/offsite-requests')
      .set(userAuth)
      .send({ start_date: d1, end_date: d1, place: '   ' })
    expect(emptyPlaceRes.status).toBe(400)

    // Normal employee requesting for another employee -> 403
    const otherEmpRes = await request(app)
      .post('/api/hr/offsite-requests')
      .set(userAuth)
      .send({ employee_id: emp2Id, start_date: d1, end_date: d1, place: 'หน้างาน' })
    expect(otherEmpRes.status).toBe(403)
  })

  it('mine=1 sees only own rows, hr:write can create/cancel APPROVED, and other tenant sees nothing', async () => {
    const adminA = newAdmin()
    const adminB = newAdmin()
    const user1 = newUser(adminA.tenantId)
    const user2 = newUser(adminA.tenantId)
    insertEmployee(adminA.tenantId, 'EMP-001', 'สมชาย', 'ใจดี', user1.userId)
    const emp2Id = insertEmployee(adminA.tenantId, 'EMP-002', 'สมหญิง', 'สุขใจ', user2.userId)

    const today = thaiDateStr()
    const d1 = offsetDate(today, 1)
    const d2 = offsetDate(today, 2)

    // user1 creates own request
    const r1 = await request(app)
      .post('/api/hr/offsite-requests')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ start_date: d1, end_date: d1, place: 'ลาดพร้าว' })
    expect(r1.status).toBe(201)

    // adminA (hr:write) creates request for emp2 (single day description)
    const r2 = await request(app)
      .post('/api/hr/offsite-requests')
      .set('Authorization', `Bearer ${adminA.token}`)
      .send({ employee_id: emp2Id, start_date: d2, end_date: d2, place: 'อโศก' })
    expect(r2.status).toBe(201)

    const apr2 = db
      .prepare('SELECT description FROM approval_requests WHERE module_type = ? AND reference_id = ?')
      .get('offsite', r2.body.data.id) as any
    expect(apr2.description).toBe(`ขอทำงานนอกสถานที่ ${d2} · อโศก (สมหญิง สุขใจ)`)

    // mine=1 for user1 returns only r1
    const mineRes = await request(app)
      .get('/api/hr/offsite-requests?mine=1')
      .set('Authorization', `Bearer ${user1.token}`)
    expect(mineRes.status).toBe(200)
    expect(mineRes.body.data.map((x: any) => x.id)).toEqual([r1.body.data.id])

    // Without mine=1, user1 (no hr:read) gets 403
    const noHrRes = await request(app)
      .get('/api/hr/offsite-requests')
      .set('Authorization', `Bearer ${user1.token}`)
    expect(noHrRes.status).toBe(403)

    // adminA sees both, ordered by start_date DESC (d2 before d1)
    const allRes = await request(app)
      .get('/api/hr/offsite-requests')
      .set('Authorization', `Bearer ${adminA.token}`)
    expect(allRes.status).toBe(200)
    expect(allRes.body.data.map((x: any) => x.id)).toEqual([r2.body.data.id, r1.body.data.id])

    // Mark r2 APPROVED: owner (user2) cannot cancel APPROVED (409), but adminA (hr:write) can (200)
    db.prepare("UPDATE offsite_requests SET status = 'APPROVED' WHERE id = ?").run(r2.body.data.id)

    const ownerCancelApproved = await request(app)
      .post(`/api/hr/offsite-requests/${r2.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${user2.token}`)
    expect(ownerCancelApproved.status).toBe(409)

    const hrCancelApproved = await request(app)
      .post(`/api/hr/offsite-requests/${r2.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${adminA.token}`)
    expect(hrCancelApproved.status).toBe(200)
    expect(hrCancelApproved.body.data.status).toBe('CANCELLED')

    // Tenant B sees empty list and gets 404 on Tenant A's id
    const listB = await request(app)
      .get('/api/hr/offsite-requests')
      .set('Authorization', `Bearer ${adminB.token}`)
    expect(listB.status).toBe(200)
    expect(listB.body.data).toEqual([])

    const cancelB = await request(app)
      .post(`/api/hr/offsite-requests/${r1.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${adminB.token}`)
    expect(cancelB.status).toBe(404)
  })
})
