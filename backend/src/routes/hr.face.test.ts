import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import hrFaceRoutes from './hr.face.routes'
import hrRoutes from './hr.routes'
import hrLifecycleRoutes from './hr.lifecycle.routes'
import { decryptDescriptor } from '../services/hr/face'
import { createTestUser } from '../test/testAuth'

function buildApp() {
  const app = express()
  app.use(express.json({ limit: '1mb', strict: false }))
  app.use('/api/hr', authenticate, subscriptionGate('hr'))
  app.use('/api/hr', hrFaceRoutes)
  app.use('/api/hr', hrRoutes)
  app.use('/api/hr', hrLifecycleRoutes)
  return app
}

const tenants: string[] = []

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM hr_face_enrollments WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM hr_checklist_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM hr_checklist_templates WHERE tenant_id = ?').run(t)
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

function insertEmployee(params: {
  tenantId: string
  code: string
  firstName: string
  lastName?: string
  userId?: string | null
  status?: 'ACTIVE' | 'RESIGNED' | 'TERMINATED'
}) {
  const id = generateId()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO employees (
       id, tenant_id, code, first_name, last_name, employment_type, base_wage,
       start_date, status, user_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'MONTHLY', 15000, '2026-01-01', ?, ?, ?, ?)`
  ).run(
    id,
    params.tenantId,
    params.code,
    params.firstName,
    params.lastName ?? null,
    params.status ?? 'ACTIVE',
    params.userId ?? null,
    now,
    now
  )
  return id
}

describe('HR Face Routes (/api/hr/me/face & /api/hr/employees/:id/face)', () => {
  const app = buildApp()
  const dummyDescriptor = Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.1))

  describe('GET /api/hr/me/face', () => {
    it('returns 404 when caller has no employee record', async () => {
      const admin = newAdmin()
      const res = await request(app)
        .get('/api/hr/me/face')
        .set('Authorization', `Bearer ${admin.token}`)
      expect(res.status).toBe(404)
      expect(res.body.success).toBe(false)
    })

    it('returns enrolled: false when employee has not enrolled face', async () => {
      const admin = newAdmin()
      insertEmployee({
        tenantId: admin.tenantId,
        code: 'E01',
        firstName: 'สมหมาย',
        userId: admin.userId,
      })

      const res = await request(app)
        .get('/api/hr/me/face')
        .set('Authorization', `Bearer ${admin.token}`)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        success: true,
        data: { enrolled: false, consent_at: null },
      })
      expect(res.body.data.descriptor).toBeUndefined()
    })
  })

  describe('POST /api/hr/me/face', () => {
    it('requires explicit PDPA consent === true', async () => {
      const admin = newAdmin()
      insertEmployee({
        tenantId: admin.tenantId,
        code: 'E01',
        firstName: 'สมหมาย',
        userId: admin.userId,
      })

      const resNoConsent = await request(app)
        .post('/api/hr/me/face')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ descriptor: dummyDescriptor, consent: false })
      expect(resNoConsent.status).toBe(400)
      expect(resNoConsent.body.success).toBe(false)

      const resMissingConsent = await request(app)
        .post('/api/hr/me/face')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ descriptor: dummyDescriptor })
      expect(resMissingConsent.status).toBe(400)
    })

    it('validates descriptor array length (128..2048) and finite numbers', async () => {
      const admin = newAdmin()
      insertEmployee({
        tenantId: admin.tenantId,
        code: 'E01',
        firstName: 'สมหมาย',
        userId: admin.userId,
      })

      // Short descriptor
      const resShort = await request(app)
        .post('/api/hr/me/face')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ descriptor: [0.1, 0.2], consent: true })
      expect(resShort.status).toBe(400)

      // Non-number descriptor
      const resNaN = await request(app)
        .post('/api/hr/me/face')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          descriptor: Array.from({ length: 128 }, (_, i) => (i === 5 ? 'not-a-number' : 0.1)),
          consent: true,
        })
      expect(resNaN.status).toBe(400)
    })

    it('successfully enrolls face, stores encrypted vector, and never leaks descriptor', async () => {
      const admin = newAdmin()
      const empId = insertEmployee({
        tenantId: admin.tenantId,
        code: 'E01',
        firstName: 'สมหมาย',
        userId: admin.userId,
      })

      const res = await request(app)
        .post('/api/hr/me/face')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ descriptor: dummyDescriptor, consent: true })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.enrolled).toBe(true)
      expect(res.body.data.consent_at).toBeTruthy()
      expect(res.body.data.descriptor).toBeUndefined()
      expect(res.body.data.descriptor_enc).toBeUndefined()

      // Verify database record
      const row = db
        .prepare('SELECT * FROM hr_face_enrollments WHERE tenant_id = ? AND employee_id = ?')
        .get(admin.tenantId, empId) as any
      expect(row).toBeTruthy()
      expect(row.descriptor_enc).not.toContain('[')
      expect(row.descriptor_enc).not.toContain(']')
      const parts = row.descriptor_enc.split(':')
      expect(parts).toHaveLength(3)

      // Stored vector decrypts back to original
      const decrypted = decryptDescriptor(row.descriptor_enc)
      expect(decrypted).toHaveLength(dummyDescriptor.length)
      expect(decrypted[0]).toBeCloseTo(dummyDescriptor[0], 5)

      // GET /api/hr/me/face now reflects enrolled status
      const getRes = await request(app)
        .get('/api/hr/me/face')
        .set('Authorization', `Bearer ${admin.token}`)
      expect(getRes.status).toBe(200)
      expect(getRes.body.data.enrolled).toBe(true)
      expect(getRes.body.data.consent_at).toBe(row.consent_at)
      expect(getRes.body.data.descriptor).toBeUndefined()
    })
  })

  describe('DELETE /api/hr/me/face', () => {
    it('deletes own face enrollment and withdraws consent', async () => {
      const admin = newAdmin()
      const empId = insertEmployee({
        tenantId: admin.tenantId,
        code: 'E01',
        firstName: 'สมหมาย',
        userId: admin.userId,
      })

      await request(app)
        .post('/api/hr/me/face')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ descriptor: dummyDescriptor, consent: true })

      const delRes = await request(app)
        .delete('/api/hr/me/face')
        .set('Authorization', `Bearer ${admin.token}`)
      expect(delRes.status).toBe(200)
      expect(delRes.body.success).toBe(true)

      const row = db
        .prepare('SELECT 1 FROM hr_face_enrollments WHERE tenant_id = ? AND employee_id = ?')
        .get(admin.tenantId, empId)
      expect(row).toBeUndefined()

      const getRes = await request(app)
        .get('/api/hr/me/face')
        .set('Authorization', `Bearer ${admin.token}`)
      expect(getRes.body.data.enrolled).toBe(false)
      expect(getRes.body.data.consent_at).toBeNull()
    })
  })

  describe('GET & DELETE /api/hr/employees/:id/face (HR permissions & cross-company)', () => {
    it('GET /employees/:id/face requires hr:read, rejects cross-company and unpermitted users', async () => {
      const adminA = newAdmin()
      const adminB = newAdmin()

      const empA = insertEmployee({
        tenantId: adminA.tenantId,
        code: 'A01',
        firstName: 'กานต์',
      })

      // Admin A enrolls for empA in database directly
      const dummyEnc = 'iv:tag:cipher'
      db.prepare(
        `INSERT INTO hr_face_enrollments (id, tenant_id, employee_id, descriptor_enc, consent_at, consent_version, created_at)
         VALUES (?, ?, ?, ?, ?, '1.0', ?)`
      ).run(generateId(), adminA.tenantId, empA, dummyEnc, new Date().toISOString(), new Date().toISOString())

      // Plain user without hr:read -> 403
      const plainUser = createTestUser({ role: 'USER', tenantId: adminA.tenantId })
      const res403 = await request(app)
        .get(`/api/hr/employees/${empA}/face`)
        .set('Authorization', `Bearer ${plainUser.token}`)
      expect(res403.status).toBe(403)

      // Cross-company access -> 404
      const resCross = await request(app)
        .get(`/api/hr/employees/${empA}/face`)
        .set('Authorization', `Bearer ${adminB.token}`)
      expect(resCross.status).toBe(404)

      // Admin A -> 200
      const res200 = await request(app)
        .get(`/api/hr/employees/${empA}/face`)
        .set('Authorization', `Bearer ${adminA.token}`)
      expect(res200.status).toBe(200)
      expect(res200.body.data.enrolled).toBe(true)
      expect(res200.body.data.descriptor).toBeUndefined()
      expect(res200.body.data.descriptor_enc).toBeUndefined()
    })

    it('DELETE /employees/:id/face requires hr:write, rejects cross-company and unpermitted users', async () => {
      const adminA = newAdmin()
      const adminB = newAdmin()

      const empA = insertEmployee({
        tenantId: adminA.tenantId,
        code: 'A02',
        firstName: 'วิชัย',
      })

      db.prepare(
        `INSERT INTO hr_face_enrollments (id, tenant_id, employee_id, descriptor_enc, consent_at, consent_version, created_at)
         VALUES (?, ?, ?, 'iv:tag:cipher', ?, '1.0', ?)`
      ).run(generateId(), adminA.tenantId, empA, new Date().toISOString(), new Date().toISOString())

      // Plain user -> 403
      const plainUser = createTestUser({ role: 'USER', tenantId: adminA.tenantId })
      const res403 = await request(app)
        .delete(`/api/hr/employees/${empA}/face`)
        .set('Authorization', `Bearer ${plainUser.token}`)
      expect(res403.status).toBe(403)

      // Cross-company -> 404
      const resCross = await request(app)
        .delete(`/api/hr/employees/${empA}/face`)
        .set('Authorization', `Bearer ${adminB.token}`)
      expect(resCross.status).toBe(404)

      // Admin A deletes
      const resDel = await request(app)
        .delete(`/api/hr/employees/${empA}/face`)
        .set('Authorization', `Bearer ${adminA.token}`)
      expect(resDel.status).toBe(200)
      expect(resDel.body.success).toBe(true)

      const row = db
        .prepare('SELECT 1 FROM hr_face_enrollments WHERE tenant_id = ? AND employee_id = ?')
        .get(adminA.tenantId, empA)
      expect(row).toBeUndefined()
    })
  })

  describe('Offboarding auto-deletion of face enrollment', () => {
    it('deletes face enrollment when employee is offboarded via POST /employees/:id/offboard', async () => {
      const admin = newAdmin()
      const empId = insertEmployee({
        tenantId: admin.tenantId,
        code: 'OFF-01',
        firstName: 'อำนาจ',
      })

      db.prepare(
        `INSERT INTO hr_face_enrollments (id, tenant_id, employee_id, descriptor_enc, consent_at, consent_version, created_at)
         VALUES (?, ?, ?, 'iv:tag:cipher', ?, '1.0', ?)`
      ).run(generateId(), admin.tenantId, empId, new Date().toISOString(), new Date().toISOString())

      // Offboard employee
      const offboardRes = await request(app)
        .post(`/api/hr/employees/${empId}/offboard`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ end_date: '2026-11-30', status: 'RESIGNED' })
      expect(offboardRes.status).toBe(200)

      const faceRow = db
        .prepare('SELECT 1 FROM hr_face_enrollments WHERE tenant_id = ? AND employee_id = ?')
        .get(admin.tenantId, empId)
      expect(faceRow).toBeUndefined()
    })

    it('deletes face enrollment when employee status updated to TERMINATED via PUT /employees/:id', async () => {
      const admin = newAdmin()
      const empId = insertEmployee({
        tenantId: admin.tenantId,
        code: 'TERM-01',
        firstName: 'สิทธิ',
      })

      db.prepare(
        `INSERT INTO hr_face_enrollments (id, tenant_id, employee_id, descriptor_enc, consent_at, consent_version, created_at)
         VALUES (?, ?, ?, 'iv:tag:cipher', ?, '1.0', ?)`
      ).run(generateId(), admin.tenantId, empId, new Date().toISOString(), new Date().toISOString())

      const putRes = await request(app)
        .put(`/api/hr/employees/${empId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          code: 'TERM-01',
          first_name: 'สิทธิ',
          employment_type: 'MONTHLY',
          base_wage: 15000,
          start_date: '2026-01-01',
          status: 'TERMINATED',
        })
      expect(putRes.status).toBe(200)

      const faceRow = db
        .prepare('SELECT 1 FROM hr_face_enrollments WHERE tenant_id = ? AND employee_id = ?')
        .get(admin.tenantId, empId)
      expect(faceRow).toBeUndefined()
    })

    it('deletes face enrollment when lifecycle offboarding checklist item (DISABLE_USER) is ticked', async () => {
      const admin = newAdmin()
      const linkedUser = createTestUser({ role: 'USER', tenantId: admin.tenantId })
      const empId = insertEmployee({
        tenantId: admin.tenantId,
        code: 'OFF-02',
        firstName: 'ชัย',
        userId: linkedUser.userId,
      })

      db.prepare(
        `INSERT INTO hr_face_enrollments (id, tenant_id, employee_id, descriptor_enc, consent_at, consent_version, created_at)
         VALUES (?, ?, ?, 'iv:tag:cipher', ?, '1.0', ?)`
      ).run(generateId(), admin.tenantId, empId, new Date().toISOString(), new Date().toISOString())

      const itemId = generateId()
      db.prepare(
        `INSERT INTO hr_checklist_items (id, tenant_id, employee_id, kind, title, auto_action, sort_order, created_at)
         VALUES (?, ?, ?, 'OFFBOARD', 'ปิดบัญชีผู้ใช้ ERP', 'DISABLE_USER', 1, ?)`
      ).run(itemId, admin.tenantId, empId, new Date().toISOString())

      const tickRes = await request(app)
        .put(`/api/hr/checklist-items/${itemId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ done: true })
      expect(tickRes.status).toBe(200)

      const faceRow = db
        .prepare('SELECT 1 FROM hr_face_enrollments WHERE tenant_id = ? AND employee_id = ?')
        .get(admin.tenantId, empId)
      expect(faceRow).toBeUndefined()
    })
  })
})
