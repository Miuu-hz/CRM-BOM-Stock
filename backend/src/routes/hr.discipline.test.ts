import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import hrDisciplineRoutes, { computeDisciplinaryExpiresOn } from './hr.discipline.routes'
import { createTestUser } from '../test/testAuth'

function buildApp() {
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.use('/api/hr', authenticate, subscriptionGate('hr'))
  app.use('/api/hr', hrDisciplineRoutes)
  return app
}

const tenants: string[] = []

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM payment_attachments WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM hr_disciplinary_records WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM hr_work_rules WHERE tenant_id = ?').run(t)
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

describe('HR Discipline Routes (Phase 10B)', () => {
  const app = buildApp()

  // 1. Expiration Date Math Unit Tests (Section 119)
  describe('computeDisciplinaryExpiresOn', () => {
    it('handles leap day 29 Feb clamped to 28 Feb in non-leap year', () => {
      expect(computeDisciplinaryExpiresOn('2024-02-29')).toBe('2025-02-28')
      expect(computeDisciplinaryExpiresOn('2020-02-29')).toBe('2021-02-28')
    })

    it('handles non-leap to leap year correctly', () => {
      expect(computeDisciplinaryExpiresOn('2023-02-28')).toBe('2024-02-28')
    })

    it('adds exactly 1 year for standard dates', () => {
      expect(computeDisciplinaryExpiresOn('2026-11-12')).toBe('2027-11-12')
      expect(computeDisciplinaryExpiresOn('2026-01-31')).toBe('2027-01-31')
      expect(computeDisciplinaryExpiresOn('2026-04-30')).toBe('2027-04-30')
    })
  })

  // 2. Work Rules (hr_work_rules)
  describe('Work Rules (GET/POST/PUT/DELETE /work-rules)', () => {
    it('creates, lists, updates, and soft-deletes a work rule', async () => {
      const admin = newAdmin()
      const auth = { Authorization: `Bearer ${admin.token}` }

      // 1. Create work rule -> 201
      const createRes = await request(app)
        .post('/api/hr/work-rules')
        .set(auth)
        .send({
          clause_no: 'หมวดที่ 4 ข้อ 12',
          title: 'การละทิ้งหน้าที่การงาน',
          body: 'ห้ามพนักงานละทิ้งหน้าที่ก่อนเวลาเลิกงานโดยไม่ได้รับอนุญาต',
          announced_on: '2026-01-15',
          is_active: true,
        })
      expect(createRes.status).toBe(201)
      expect(createRes.body.success).toBe(true)
      expect(createRes.body.data.clause_no).toBe('หมวดที่ 4 ข้อ 12')
      expect(createRes.body.data.title).toBe('การละทิ้งหน้าที่การงาน')
      expect(createRes.body.data.is_active).toBe(true)
      const ruleId = createRes.body.data.id

      // 2. List work rules -> 200
      const listRes = await request(app)
        .get('/api/hr/work-rules')
        .set(auth)
      expect(listRes.status).toBe(200)
      expect(listRes.body.data).toHaveLength(1)
      expect(listRes.body.data[0].id).toBe(ruleId)

      // 3. Update work rule -> 200
      const updateRes = await request(app)
        .put(`/api/hr/work-rules/${ruleId}`)
        .set(auth)
        .send({
          title: 'การละทิ้งหน้าที่การงานเกิน 3 วัน',
          is_active: true,
        })
      expect(updateRes.status).toBe(200)
      expect(updateRes.body.data.title).toBe('การละทิ้งหน้าที่การงานเกิน 3 วัน')

      // 4. Soft delete work rule (ลบ = is_active 0) -> 200
      const delRes = await request(app)
        .delete(`/api/hr/work-rules/${ruleId}`)
        .set(auth)
      expect(delRes.status).toBe(200)
      expect(delRes.body.data.is_active).toBe(false)

      // 5. Active only filter -> 0 rows
      const activeRes = await request(app)
        .get('/api/hr/work-rules?active=1')
        .set(auth)
      expect(activeRes.status).toBe(200)
      expect(activeRes.body.data).toHaveLength(0)
    })

    it('rejects invalid inputs on POST /work-rules', async () => {
      const admin = newAdmin()
      const auth = { Authorization: `Bearer ${admin.token}` }

      // Missing clause_no -> 400
      const res1 = await request(app)
        .post('/api/hr/work-rules')
        .set(auth)
        .send({ clause_no: '', title: 'ระเบียบ' })
      expect(res1.status).toBe(400)

      // Missing title -> 400
      const res2 = await request(app)
        .post('/api/hr/work-rules')
        .set(auth)
        .send({ clause_no: 'ข้อ 1', title: '' })
      expect(res2.status).toBe(400)

      // Invalid announced_on date -> 400
      const res3 = await request(app)
        .post('/api/hr/work-rules')
        .set(auth)
        .send({ clause_no: 'ข้อ 1', title: 'ระเบียบ', announced_on: 'invalid-date' })
      expect(res3.status).toBe(400)
    })

    it('enforces RBAC on work rules (USER without HR write gets 403)', async () => {
      const admin = newAdmin()
      const regularUser = newUser(admin.tenantId)
      const userAuth = { Authorization: `Bearer ${regularUser.token}` }

      const res = await request(app)
        .post('/api/hr/work-rules')
        .set(userAuth)
        .send({ clause_no: 'ข้อ 1', title: 'กฎระเบียบ' })
      expect(res.status).toBe(403)
      expect(res.body.success).toBe(false)
    })

    it('enforces cross-company isolation on work rules (Company B gets 404 for Company A)', async () => {
      const companyA = newAdmin()
      const companyB = newAdmin()
      const authA = { Authorization: `Bearer ${companyA.token}` }
      const authB = { Authorization: `Bearer ${companyB.token}` }

      const createRes = await request(app)
        .post('/api/hr/work-rules')
        .set(authA)
        .send({ clause_no: 'ข้อ 1', title: 'กฎระเบียบบริษัท A' })
      expect(createRes.status).toBe(201)
      const ruleId = createRes.body.data.id

      // Company B cannot update Company A's rule -> 404
      const updateRes = await request(app)
        .put(`/api/hr/work-rules/${ruleId}`)
        .set(authB)
        .send({ title: 'พยายามแก้ไขโดยบริษัท B' })
      expect(updateRes.status).toBe(404)

      // Company B cannot delete Company A's rule -> 404
      const deleteRes = await request(app)
        .delete(`/api/hr/work-rules/${ruleId}`)
        .set(authB)
      expect(deleteRes.status).toBe(404)
    })
  })

  // 3. Disciplinary Records (hr_disciplinary_records)
  describe('Disciplinary Records (/disciplinary)', () => {
    it('creates a disciplinary record and enforces server-computed expires_on = incident_date + 1 year', async () => {
      const admin = newAdmin()
      const auth = { Authorization: `Bearer ${admin.token}` }
      const empId = insertEmployee(admin.tenantId, 'EMP-001', 'สมชาย', 'สายเสมอ')

      // Create work rule
      const ruleRes = await request(app)
        .post('/api/hr/work-rules')
        .set(auth)
        .send({ clause_no: 'ข้อ 5', title: 'การเข้างานตรงเวลา' })
      const ruleId = ruleRes.body.data.id

      // Create disciplinary record. Client passes a bogus expires_on, server must ignore it!
      const createRes = await request(app)
        .post('/api/hr/disciplinary')
        .set(auth)
        .send({
          employee_id: empId,
          incident_date: '2026-03-15',
          category: 'เข้างานสาย',
          detail: 'เข้างานสายเกิน 1 ชั่วโมง 3 ครั้งในรอบเดือน',
          level: 'VERBAL',
          work_rule_id: ruleId,
          expires_on: '2099-12-31', // Bogus client value
        })
      expect(createRes.status).toBe(201)
      expect(createRes.body.success).toBe(true)
      expect(createRes.body.data.employee_id).toBe(empId)
      expect(createRes.body.data.employee_name).toBe('สมชาย สายเสมอ')
      expect(createRes.body.data.clause_no).toBe('ข้อ 5')
      expect(createRes.body.data.level).toBe('VERBAL')
      // Server computed expires_on: 2026-03-15 + 1 year = 2027-03-15
      expect(createRes.body.data.expires_on).toBe('2027-03-15')
      expect(createRes.body.data.acknowledged_at).toBeNull()
      expect(createRes.body.data.acknowledged_via).toBeNull()
      // created_by must be the caller's user id (regression: req.user.id is undefined)
      expect(createRes.body.data.created_by).toBe(admin.userId)

      const recordId = createRes.body.data.id

      // Get list -> contains active: boolean, employee_name, clause_no
      const listRes = await request(app)
        .get('/api/hr/disciplinary')
        .set(auth)
      expect(listRes.status).toBe(200)
      expect(listRes.body.data).toHaveLength(1)
      expect(listRes.body.data[0].id).toBe(recordId)
      expect(listRes.body.data[0].employee_name).toBe('สมชาย สายเสมอ')
      expect(listRes.body.data[0].clause_no).toBe('ข้อ 5')
      expect(listRes.body.data[0].active).toBe(true)
    })

    it('rejects future incident_date with 400', async () => {
      const admin = newAdmin()
      const auth = { Authorization: `Bearer ${admin.token}` }
      const empId = insertEmployee(admin.tenantId, 'EMP-001', 'สมศักดิ์', 'รักงาน')

      const res = await request(app)
        .post('/api/hr/disciplinary')
        .set(auth)
        .send({
          employee_id: empId,
          incident_date: '2099-01-01',
          category: 'ฝ่าฝืนคำสั่ง',
          detail: 'เหตุการณ์ในอนาคต',
          level: 'WRITTEN',
        })
      expect(res.status).toBe(400)
      expect(res.body.message).toContain('อนาคต')
    })

    it('rejects work_rule_id from another tenant with 400', async () => {
      const companyA = newAdmin()
      const companyB = newAdmin()
      const authA = { Authorization: `Bearer ${companyA.token}` }
      const authB = { Authorization: `Bearer ${companyB.token}` }

      const empIdB = insertEmployee(companyB.tenantId, 'EMP-B', 'บุญมี', 'มานะ')

      // Company A creates work rule
      const ruleA = await request(app)
        .post('/api/hr/work-rules')
        .set(authA)
        .send({ clause_no: 'ข้อ 1', title: 'กฎระเบียบ A' })
      const ruleIdA = ruleA.body.data.id

      // Company B tries to use Company A's work rule
      const res = await request(app)
        .post('/api/hr/disciplinary')
        .set(authB)
        .send({
          employee_id: empIdB,
          incident_date: '2026-02-10',
          category: 'ขาดงาน',
          detail: 'ขาดงานโดยไม่แจ้ง',
          level: 'WRITTEN',
          work_rule_id: ruleIdA,
        })
      expect(res.status).toBe(400)
      expect(res.body.message).toContain('ไม่พบข้อบังคับการทำงาน')
    })

    it('allows PUT /disciplinary/:id before acknowledgment, but returns 409 after acknowledged', async () => {
      const admin = newAdmin()
      const auth = { Authorization: `Bearer ${admin.token}` }
      const empId = insertEmployee(admin.tenantId, 'EMP-001', 'มานี', 'รักดี')

      const createRes = await request(app)
        .post('/api/hr/disciplinary')
        .set(auth)
        .send({
          employee_id: empId,
          incident_date: '2026-04-01',
          category: 'มาสาย',
          detail: 'สาย 30 นาที',
          level: 'VERBAL',
        })
      const recordId = createRes.body.data.id

      // PUT succeeds when unacknowledged -> 200
      const putRes = await request(app)
        .put(`/api/hr/disciplinary/${recordId}`)
        .set(auth)
        .send({
          incident_date: '2026-04-02',
          detail: 'สาย 45 นาที (แก้ไขรายละเอียด)',
        })
      expect(putRes.status).toBe(200)
      expect(putRes.body.data.detail).toContain('แก้ไขรายละเอียด')
      expect(putRes.body.data.expires_on).toBe('2027-04-02')

      // Witness acknowledge -> 200
      const ackRes = await request(app)
        .post(`/api/hr/disciplinary/${recordId}/acknowledge-witness`)
        .set(auth)
        .send({ witness_name: 'นายหัวหน้า งานดี' })
      expect(ackRes.status).toBe(200)
      expect(ackRes.body.data.acknowledged_via).toBe('WITNESS')
      expect(ackRes.body.data.witness_name).toBe('นายหัวหน้า งานดี')

      // PUT after acknowledgment -> 409
      const putAfterAck = await request(app)
        .put(`/api/hr/disciplinary/${recordId}`)
        .set(auth)
        .send({ detail: 'พยายามแก้ไขหลังรับทราบ' })
      expect(putAfterAck.status).toBe(409)

      // Re-acknowledge -> 409
      const reAck = await request(app)
        .post(`/api/hr/disciplinary/${recordId}/acknowledge-witness`)
        .set(auth)
        .send({ witness_name: 'พยานคนที่สอง' })
      expect(reAck.status).toBe(409)
    })

    it('has no DELETE /disciplinary/:id endpoint', async () => {
      const admin = newAdmin()
      const auth = { Authorization: `Bearer ${admin.token}` }
      const empId = insertEmployee(admin.tenantId, 'EMP-001', 'มานี', 'รักดี')

      const createRes = await request(app)
        .post('/api/hr/disciplinary')
        .set(auth)
        .send({
          employee_id: empId,
          incident_date: '2026-05-01',
          category: 'ขาดงาน',
          detail: 'ขาดงาน',
          level: 'VERBAL',
        })
      const recordId = createRes.body.data.id

      const delRes = await request(app)
        .delete(`/api/hr/disciplinary/${recordId}`)
        .set(auth)
      expect(delRes.status).toBe(404)
    })
  })

  // 4. Employee Self View & Self Acknowledgment (/me/disciplinary)
  describe('Personal Data Privacy & Self Acknowledgment (/me/disciplinary)', () => {
    it('employee can view own records and acknowledge with via=SELF', async () => {
      const admin = newAdmin()
      const adminAuth = { Authorization: `Bearer ${admin.token}` }

      // Create employee linked to a regular user
      const user1 = newUser(admin.tenantId)
      const user1Auth = { Authorization: `Bearer ${user1.token}` }
      const emp1Id = insertEmployee(admin.tenantId, 'EMP-U1', 'กานต์', 'ใจเพชร', user1.userId)

      // Admin creates disciplinary record for user1
      const recRes = await request(app)
        .post('/api/hr/disciplinary')
        .set(adminAuth)
        .send({
          employee_id: emp1Id,
          incident_date: '2026-06-10',
          category: 'ใช้อุปกรณ์ไม่ถูกต้อง',
          detail: 'ไม่สวมหมวกนิรภัยในเขตก่อสร้าง',
          level: 'WRITTEN',
        })
      const recordId = recRes.body.data.id

      // User1 gets own disciplinary records
      const myRes = await request(app)
        .get('/api/hr/me/disciplinary')
        .set(user1Auth)
      expect(myRes.status).toBe(200)
      expect(myRes.body.data).toHaveLength(1)
      expect(myRes.body.data[0].id).toBe(recordId)

      // User1 acknowledges own record -> 200, via=SELF
      const ackRes = await request(app)
        .post(`/api/hr/me/disciplinary/${recordId}/acknowledge`)
        .set(user1Auth)
      expect(ackRes.status).toBe(200)
      expect(ackRes.body.data.acknowledged_via).toBe('SELF')
      expect(ackRes.body.data.acknowledged_at).toBeTruthy()

      // User1 attempts to acknowledge again -> 409
      const reAckRes = await request(app)
        .post(`/api/hr/me/disciplinary/${recordId}/acknowledge`)
        .set(user1Auth)
      expect(reAckRes.status).toBe(409)
    })

    it('CRITICAL PRIVACY: User2 in the same company attempting to touch User1 record answers 404', async () => {
      const admin = newAdmin()
      const adminAuth = { Authorization: `Bearer ${admin.token}` }

      // Create Employee 1 linked to User 1
      const user1 = newUser(admin.tenantId)
      const emp1Id = insertEmployee(admin.tenantId, 'EMP-U1', 'กานต์', 'ใจเพชร', user1.userId)

      // Create Employee 2 linked to User 2 (same company!)
      const user2 = newUser(admin.tenantId)
      const user2Auth = { Authorization: `Bearer ${user2.token}` }
      insertEmployee(admin.tenantId, 'EMP-U2', 'กมล', 'ยอดเยี่ยม', user2.userId)

      // Create disciplinary record for Employee 1
      const recRes = await request(app)
        .post('/api/hr/disciplinary')
        .set(adminAuth)
        .send({
          employee_id: emp1Id,
          incident_date: '2026-07-01',
          category: 'ความลับบริษัท',
          detail: 'เปิดเผยข้อมูลส่วนบุคคล',
          level: 'WRITTEN',
        })
      const rec1Id = recRes.body.data.id

      // User 2 lists /me/disciplinary -> does NOT see User 1's record (empty array)
      const user2List = await request(app)
        .get('/api/hr/me/disciplinary')
        .set(user2Auth)
      expect(user2List.status).toBe(200)
      expect(user2List.body.data).toHaveLength(0)

      // User 2 attempts to acknowledge User 1's record -> MUST answer 404!
      const user2Ack = await request(app)
        .post(`/api/hr/me/disciplinary/${rec1Id}/acknowledge`)
        .set(user2Auth)
      expect(user2Ack.status).toBe(404)
      expect(user2Ack.body.success).toBe(false)
    })

    it('returns 404 for user without employee record on /me/disciplinary', async () => {
      const admin = newAdmin()
      const unlinkedUser = newUser(admin.tenantId)
      const auth = { Authorization: `Bearer ${unlinkedUser.token}` }

      const res = await request(app)
        .get('/api/hr/me/disciplinary')
        .set(auth)
      expect(res.status).toBe(404)
    })
  })

  // 5. Cross-Company Tests for Disciplinary Records
  describe('Cross-Company Isolation for Disciplinary Records', () => {
    it('Company B admin gets 404 when accessing Company A disciplinary record', async () => {
      const companyA = newAdmin()
      const companyB = newAdmin()
      const authA = { Authorization: `Bearer ${companyA.token}` }
      const authB = { Authorization: `Bearer ${companyB.token}` }

      const empA = insertEmployee(companyA.tenantId, 'EMP-A', 'ประสิทธิ์', 'มั่นคง')
      const recRes = await request(app)
        .post('/api/hr/disciplinary')
        .set(authA)
        .send({
          employee_id: empA,
          incident_date: '2026-08-01',
          category: 'ทะเลาะวิวาท',
          detail: 'มีปากเสียงในที่ทำงาน',
          level: 'WRITTEN',
        })
      const recordIdA = recRes.body.data.id

      // Company B cannot GET single record -> 404
      const getRes = await request(app)
        .get(`/api/hr/disciplinary/${recordIdA}`)
        .set(authB)
      expect(getRes.status).toBe(404)

      // Company B cannot PUT record -> 404
      const putRes = await request(app)
        .put(`/api/hr/disciplinary/${recordIdA}`)
        .set(authB)
        .send({ detail: 'พยายามแก้ไขโดยบริษัท B' })
      expect(putRes.status).toBe(404)

      // Company B cannot witness-acknowledge -> 404
      const ackRes = await request(app)
        .post(`/api/hr/disciplinary/${recordIdA}/acknowledge-witness`)
        .set(authB)
        .send({ witness_name: 'พยาน บริษัท B' })
      expect(ackRes.status).toBe(404)
    })
  })
})
