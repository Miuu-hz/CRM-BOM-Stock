import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import hrTrainingRoutes, { addMonthsClamped } from './hr.training.routes'
import { createTestUser } from '../test/testAuth'

function buildApp() {
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.use('/api/hr', authenticate, subscriptionGate('hr'))
  app.use('/api/hr', hrTrainingRoutes)
  return app
}

const tenants: string[] = []

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM payment_attachments WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM training_records WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM training_courses WHERE tenant_id = ?').run(t)
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
  userId?: string,
  status: 'ACTIVE' | 'RESIGNED' = 'ACTIVE'
): string {
  const id = generateId()
  db.prepare(`
    INSERT INTO employees (
      id, tenant_id, code, first_name, last_name, employment_type,
      base_wage, start_date, status, user_id
    ) VALUES (?, ?, ?, ?, ?, 'MONTHLY', 25000, '2026-01-01', ?, ?)
  `).run(id, tenantId, code, firstName, lastName, status, userId || null)
  return id
}

describe('HR Training Routes (B5: T1–T9)', () => {
  const app = buildApp()

  it('asserts addMonthsClamped directly with leap years and end-of-month clamp', () => {
    // 2026-01-31 + 1 month -> 2026-02-28 (non-leap year)
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28')
    // 2024-01-31 + 1 month -> 2024-02-29 (leap year)
    expect(addMonthsClamped('2024-01-31', 1)).toBe('2024-02-29')
    // 2026-03-31 + 1 month -> 2026-04-30
    expect(addMonthsClamped('2026-03-31', 1)).toBe('2026-04-30')
    // 2026-05-15 + 12 months -> 2027-05-15
    expect(addMonthsClamped('2026-05-15', 12)).toBe('2027-05-15')
    // 2026-08-31 + 6 months -> 2027-02-28
    expect(addMonthsClamped('2026-08-31', 6)).toBe('2027-02-28')
    // 2026-10-31 + 1 month -> 2026-11-30
    expect(addMonthsClamped('2026-10-31', 1)).toBe('2026-11-30')
  })

  it('create course (409 on duplicate name), get and update course', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    // 1. Create course -> 201
    const createRes = await request(app)
      .post('/api/hr/training/courses')
      .set(auth)
      .send({
        name: 'ความปลอดภัยในการทำงาน',
        kind: 'INTERNAL',
        mandatory: true,
        validity_months: 12,
      })
    expect(createRes.status).toBe(201)
    expect(createRes.body.success).toBe(true)
    expect(createRes.body.data.name).toBe('ความปลอดภัยในการทำงาน')
    expect(createRes.body.data.kind).toBe('INTERNAL')
    expect(createRes.body.data.mandatory).toBe(true)
    expect(createRes.body.data.validity_months).toBe(12)
    expect(createRes.body.data.is_active).toBe(true)
    expect(createRes.body.data.record_count).toBe(0)

    const courseId = createRes.body.data.id

    // 2. Duplicate course name -> 409
    const dupRes = await request(app)
      .post('/api/hr/training/courses')
      .set(auth)
      .send({
        name: '  ความปลอดภัยในการทำงาน  ',
        kind: 'EXTERNAL',
        mandatory: false,
        validity_months: 6,
      })
    expect(dupRes.status).toBe(409)
    expect(dupRes.body.success).toBe(false)
    expect(dupRes.body.message).toBe('มีหลักสูตรชื่อนี้แล้ว')

    // 3. Update course -> 200
    const updateRes = await request(app)
      .put(`/api/hr/training/courses/${courseId}`)
      .set(auth)
      .send({
        mandatory: false,
        validity_months: null,
      })
    expect(updateRes.status).toBe(200)
    expect(updateRes.body.data.mandatory).toBe(false)
    expect(updateRes.body.data.validity_months).toBeNull()

    // 4. List courses -> 200
    const listRes = await request(app)
      .get('/api/hr/training/courses?active=1')
      .set(auth)
    expect(listRes.status).toBe(200)
    expect(listRes.body.data).toHaveLength(1)
    expect(listRes.body.data[0].id).toBe(courseId)
  })

  it('records a session for 2 employees with auto expires_on clamped to end-of-month', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    // Course with validity_months: 1
    const courseRes = await request(app)
      .post('/api/hr/training/courses')
      .set(auth)
      .send({
        name: 'ปฐมพยาบาลเบื้องต้น',
        kind: 'INTERNAL',
        mandatory: false,
        validity_months: 1,
      })
    expect(courseRes.status).toBe(201)
    const courseId = courseRes.body.data.id

    const emp1 = insertEmployee(admin.tenantId, 'EMP-001', 'สมชาย', 'ใจดี')
    const emp2 = insertEmployee(admin.tenantId, 'EMP-002', 'สมหญิง', 'รักดี')

    // trained_on: 2026-01-31 without expires_on -> auto 2026-02-28
    const recordRes = await request(app)
      .post('/api/hr/training/records')
      .set(auth)
      .send({
        course_id: courseId,
        employee_ids: [emp1, emp2],
        trained_on: '2026-01-31',
        provider: 'สภากาชาดไทย',
        notes: 'ผ่านเกณฑ์ทุกคน',
      })
    expect(recordRes.status).toBe(201)
    expect(recordRes.body.success).toBe(true)
    expect(recordRes.body.data).toHaveLength(2)

    const r1 = recordRes.body.data.find((r: any) => r.employee_id === emp1)
    const r2 = recordRes.body.data.find((r: any) => r.employee_id === emp2)

    expect(r1).toBeDefined()
    expect(r1.course_name).toBe('ปฐมพยาบาลเบื้องต้น')
    expect(r1.employee_name).toBe('สมชาย ใจดี')
    expect(r1.expires_on).toBe('2026-02-28') // Clamped to 2026-02-28
    expect(r1.attachment_count).toBe(0)

    expect(r2).toBeDefined()
    expect(r2.expires_on).toBe('2026-02-28')

    // T4: list records filtered by course_id
    const listRecords = await request(app)
      .get(`/api/hr/training/records?course_id=${courseId}`)
      .set(auth)
    expect(listRecords.status).toBe(200)
    expect(listRecords.body.data).toHaveLength(2)

    // T5: non-existent employee -> 400 and nothing inserted
    const badEmpRes = await request(app)
      .post('/api/hr/training/records')
      .set(auth)
      .send({
        course_id: courseId,
        employee_ids: [emp1, 'non-existent-id'],
        trained_on: '2026-02-01',
      })
    expect(badEmpRes.status).toBe(400)
    expect(badEmpRes.body.message).toContain('ไม่สังกัดบริษัท')

    // T5: expires_on before trained_on -> 400
    const earlyRes = await request(app)
      .post('/api/hr/training/records')
      .set(auth)
      .send({
        course_id: courseId,
        employee_ids: [emp1],
        trained_on: '2026-05-10',
        expires_on: '2026-05-01',
      })
    expect(earlyRes.status).toBe(400)
    expect(earlyRes.body.message).toContain('ต้องไม่ก่อน')
  })

  it('T8 shows only the latest row after a renewal, and ignores inactive employees', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    const courseRes = await request(app)
      .post('/api/hr/training/courses')
      .set(auth)
      .send({
        name: 'อบรมดับเพลิง',
        kind: 'EXTERNAL',
        mandatory: true,
        validity_months: 12,
      })
    const courseId = courseRes.body.data.id

    const empActive = insertEmployee(admin.tenantId, 'EMP-101', 'กานต์', 'มั่นคง')
    const empInactive = insertEmployee(admin.tenantId, 'EMP-102', 'วิภา', 'ลาออก', undefined, 'RESIGNED')

    // Initial session for empActive (expired last year)
    await request(app)
      .post('/api/hr/training/records')
      .set(auth)
      .send({
        course_id: courseId,
        employee_ids: [empActive],
        trained_on: '2024-01-01',
        expires_on: '2025-01-01',
      })

    // Inactive employee session (also expired)
    await request(app)
      .post('/api/hr/training/records')
      .set(auth)
      .send({
        course_id: courseId,
        employee_ids: [empInactive],
        trained_on: '2024-01-01',
        expires_on: '2025-01-01',
      })

    // Before renewal: empActive should appear in expiring (expired row included)
    // inactive employee must NOT appear
    const expiringBefore = await request(app)
      .get('/api/hr/training/expiring?days=60')
      .set(auth)
    expect(expiringBefore.status).toBe(200)
    expect(expiringBefore.body.data).toHaveLength(1)
    expect(expiringBefore.body.data[0].employee_id).toBe(empActive)
    expect(expiringBefore.body.data[0].expires_on).toBe('2025-01-01')

    // Renewal session for empActive (expires 3 years into the future, well beyond cutoff)
    await request(app)
      .post('/api/hr/training/records')
      .set(auth)
      .send({
        course_id: courseId,
        employee_ids: [empActive],
        trained_on: '2026-06-01',
        expires_on: '2029-06-01',
      })

    // After renewal: empActive should NOT appear because latest row expires in 2029
    const expiringAfter = await request(app)
      .get('/api/hr/training/expiring?days=60')
      .set(auth)
    expect(expiringAfter.status).toBe(200)
    expect(expiringAfter.body.data).toHaveLength(0)
  })

  it('USER without hr gets 403 on T1 but /me/training returns only their own rows', async () => {
    const admin = newAdmin()
    const adminAuth = { Authorization: `Bearer ${admin.token}` }

    const user = newUser(admin.tenantId)
    const userAuth = { Authorization: `Bearer ${user.token}` }

    const empUser = insertEmployee(admin.tenantId, 'EMP-USER', 'ประสิทธิ์', 'รักดี', user.userId)
    const empOther = insertEmployee(admin.tenantId, 'EMP-OTHER', 'วันชัย', 'เก่งการ')

    const courseRes = await request(app)
      .post('/api/hr/training/courses')
      .set(adminAuth)
      .send({
        name: 'หลักสูตรบริการลูกค้า',
        kind: 'INTERNAL',
        mandatory: false,
        validity_months: 6,
      })
    const courseId = courseRes.body.data.id

    // Create record for both
    await request(app)
      .post('/api/hr/training/records')
      .set(adminAuth)
      .send({
        course_id: courseId,
        employee_ids: [empUser, empOther],
        trained_on: '2026-03-01',
      })

    // 1. USER gets 403 on T1 (no hr permission)
    const t1Res = await request(app)
      .get('/api/hr/training/courses')
      .set(userAuth)
    expect(t1Res.status).toBe(403)
    expect(t1Res.body.success).toBe(false)
    expect(t1Res.body.message).toBe('ไม่มีสิทธิ์เข้าถึง')

    // 2. USER gets 200 on /me/training with only their own records
    const meRes = await request(app)
      .get('/api/hr/me/training')
      .set(userAuth)
    expect(meRes.status).toBe(200)
    expect(meRes.body.success).toBe(true)
    expect(meRes.body.data).toHaveLength(1)
    expect(meRes.body.data[0].employee_id).toBe(empUser)
    expect(meRes.body.data[0].employee_name).toBe('ประสิทธิ์ รักดี')

    // 3. User without employee linked gets 404
    const unlinkedUser = newUser(admin.tenantId)
    const unlinkedAuth = { Authorization: `Bearer ${unlinkedUser.token}` }
    const unlinkedRes = await request(app)
      .get('/api/hr/me/training')
      .set(unlinkedAuth)
    expect(unlinkedRes.status).toBe(404)
    expect(unlinkedRes.body.message).toBe('บัญชีนี้ยังไม่ได้ผูกกับพนักงาน')
  })

  it('another tenant record id returns 404, and DELETE blocks on certificate attachment', async () => {
    const adminA = newAdmin()
    const adminB = newAdmin()
    const authA = { Authorization: `Bearer ${adminA.token}` }
    const authB = { Authorization: `Bearer ${adminB.token}` }

    const courseRes = await request(app)
      .post('/api/hr/training/courses')
      .set(authA)
      .send({
        name: 'สุขศาสตร์อุตสาหกรรม',
        kind: 'INTERNAL',
        mandatory: true,
        validity_months: 12,
      })
    const courseIdA = courseRes.body.data.id
    const empA = insertEmployee(adminA.tenantId, 'EMP-A', 'กานดา', 'สุขสม')

    const recRes = await request(app)
      .post('/api/hr/training/records')
      .set(authA)
      .send({
        course_id: courseIdA,
        employee_ids: [empA],
        trained_on: '2026-04-15',
      })
    const recordIdA = recRes.body.data[0].id

    // 1. Tenant B tries to update Tenant A's record -> 404
    const putRes = await request(app)
      .put(`/api/hr/training/records/${recordIdA}`)
      .set(authB)
      .send({ notes: 'แอบแก้' })
    expect(putRes.status).toBe(404)
    expect(putRes.body.message).toBe('ไม่พบบันทึกการอบรม')

    // 2. Tenant B tries to delete Tenant A's record -> 404
    const delResB = await request(app)
      .delete(`/api/hr/training/records/${recordIdA}`)
      .set(authB)
    expect(delResB.status).toBe(404)
    expect(delResB.body.message).toBe('ไม่พบบันทึกการอบรม')

    // 3. Tenant A attaches a certificate to this record
    const attId = generateId()
    db.prepare(`
      INSERT INTO payment_attachments (id, tenant_id, ref_type, ref_id, file_path, original_name, created_at)
      VALUES (?, ?, 'TRAINING_RECORD', ?, '/uploads/cert.pdf', 'cert.pdf', ?)
    `).run(attId, adminA.tenantId, recordIdA, new Date().toISOString())

    // 4. DELETE while having attachment -> 409
    const delResAWithAtt = await request(app)
      .delete(`/api/hr/training/records/${recordIdA}`)
      .set(authA)
    expect(delResAWithAtt.status).toBe(409)
    expect(delResAWithAtt.body.message).toBe('ลบไฟล์ใบรับรองก่อน')

    // 5. Remove attachment and DELETE -> 200
    db.prepare('DELETE FROM payment_attachments WHERE id = ?').run(attId)

    const delResASuccess = await request(app)
      .delete(`/api/hr/training/records/${recordIdA}`)
      .set(authA)
    expect(delResASuccess.status).toBe(200)
    expect(delResASuccess.body.data.id).toBe(recordIdA)
  })
})
