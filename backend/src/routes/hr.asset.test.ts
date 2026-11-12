import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import hrAssetRoutes from './hr.asset.routes'
import { createTestUser } from '../test/testAuth'

function buildApp() {
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.use('/api/hr', authenticate, subscriptionGate('hr'))
  app.use('/api/hr', hrAssetRoutes)
  return app
}

const tenants: string[] = []

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM payment_attachments WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM hr_asset_loans WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM hr_assets WHERE tenant_id = ?').run(t)
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

describe('HR Asset Routes (Phase 9B)', () => {
  const app = buildApp()

  it('creates asset (409 on duplicate code), gets list with filter, and updates asset', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    // 1. Create asset -> 201
    const createRes = await request(app)
      .post('/api/hr/assets')
      .set(auth)
      .send({
        code: 'AST-001',
        name: 'MacBook Pro 14"',
        category: 'คอมพิวเตอร์',
        notes: 'สำหรับทีมพัฒนา',
      })
    expect(createRes.status).toBe(201)
    expect(createRes.body.success).toBe(true)
    expect(createRes.body.data.code).toBe('AST-001')
    expect(createRes.body.data.name).toBe('MacBook Pro 14"')
    expect(createRes.body.data.category).toBe('คอมพิวเตอร์')
    expect(createRes.body.data.status).toBe('AVAILABLE')
    expect(createRes.body.data.current_loan).toBeNull()

    const assetId = createRes.body.data.id

    // 2. Duplicate code -> 409
    const dupRes = await request(app)
      .post('/api/hr/assets')
      .set(auth)
      .send({
        code: 'AST-001',
        name: 'MacBook Pro เครื่องที่สอง',
      })
    expect(dupRes.status).toBe(409)
    expect(dupRes.body.success).toBe(false)
    expect(dupRes.body.message).toBe('มีรหัสทรัพย์สินนี้แล้ว')

    // 3. Update asset -> 200
    const updateRes = await request(app)
      .put(`/api/hr/assets/${assetId}`)
      .set(auth)
      .send({
        name: 'MacBook Pro 14" M3',
        notes: 'อัปเกรดเรียบร้อย',
      })
    expect(updateRes.status).toBe(200)
    expect(updateRes.body.data.name).toBe('MacBook Pro 14" M3')
    expect(updateRes.body.data.notes).toBe('อัปเกรดเรียบร้อย')

    // 4. List assets with query & status -> 200
    const listRes = await request(app)
      .get('/api/hr/assets?status=AVAILABLE&q=MacBook')
      .set(auth)
    expect(listRes.status).toBe(200)
    expect(listRes.body.data).toHaveLength(1)
    expect(listRes.body.data[0].id).toBe(assetId)

    // 5. Get single asset -> 200
    const getRes = await request(app)
      .get(`/api/hr/assets/${assetId}`)
      .set(auth)
    expect(getRes.status).toBe(200)
    expect(getRes.body.data.id).toBe(assetId)
    expect(getRes.body.data.current_loan).toBeNull()
  })

  it('loans asset atomically, prevents double loan (409), rejects non-active employee, and blocks RETIRED while LOANED', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    const empActive = insertEmployee(admin.tenantId, 'EMP-01', 'สมชาย', 'ใจดี', undefined, 'ACTIVE')
    const empResigned = insertEmployee(admin.tenantId, 'EMP-02', 'สมหวัง', 'ลาออก', undefined, 'RESIGNED')

    // Create asset
    const assetRes = await request(app)
      .post('/api/hr/assets')
      .set(auth)
      .send({
        code: 'AST-002',
        name: 'iPad Pro',
        category: 'แท็บเล็ต',
      })
    const assetId = assetRes.body.data.id

    // 1. Try loan to resigned employee -> 400
    const badEmpRes = await request(app)
      .post(`/api/hr/assets/${assetId}/loan`)
      .set(auth)
      .send({
        employee_id: empResigned,
        loaned_on: '2026-03-01',
      })
    expect(badEmpRes.status).toBe(400)
    expect(badEmpRes.body.message).toContain('ไม่พบพนักงาน หรือพนักงานไม่อยู่ในสถานะทำงาน')

    // 2. Loan to active employee -> 201
    const loanRes = await request(app)
      .post(`/api/hr/assets/${assetId}/loan`)
      .set(auth)
      .send({
        employee_id: empActive,
        loaned_on: '2026-03-01',
        note: 'ยืมไปใช้นำเสนองานลูกค้า',
      })
    expect(loanRes.status).toBe(201)
    expect(loanRes.body.success).toBe(true)
    expect(loanRes.body.data.asset_id).toBe(assetId)
    expect(loanRes.body.data.employee_id).toBe(empActive)
    expect(loanRes.body.data.loaned_on).toBe('2026-03-01')
    expect(loanRes.body.data.returned_on).toBeNull()

    // 3. Double loan on same asset -> 409
    const doubleLoanRes = await request(app)
      .post(`/api/hr/assets/${assetId}/loan`)
      .set(auth)
      .send({
        employee_id: empActive,
        loaned_on: '2026-03-02',
      })
    expect(doubleLoanRes.status).toBe(409)
    expect(doubleLoanRes.body.message).toBe('ทรัพย์สินนี้ไม่พร้อมให้ยืม')

    // 4. Verify asset status is now LOANED and current_loan is attached
    const checkRes = await request(app)
      .get(`/api/hr/assets/${assetId}`)
      .set(auth)
    expect(checkRes.status).toBe(200)
    expect(checkRes.body.data.status).toBe('LOANED')
    expect(checkRes.body.data.current_loan).not.toBeNull()
    expect(checkRes.body.data.current_loan.employee_id).toBe(empActive)
    expect(checkRes.body.data.current_loan.employee_name).toBe('สมชาย ใจดี')

    // 5. Try to update status to RETIRED while LOANED -> 409
    const retireRes = await request(app)
      .put(`/api/hr/assets/${assetId}`)
      .set(auth)
      .send({ status: 'RETIRED' })
    expect(retireRes.status).toBe(409)
    expect(retireRes.body.message).toContain('ไม่สามารถตัดจำหน่ายทรัพย์สินที่อยู่ระหว่างการยืมได้')
  })

  it('returns asset loan atomically, validates return date (400 on returned_on < loaned_on), prevents double return (409), and sets asset AVAILABLE', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    const empId = insertEmployee(admin.tenantId, 'EMP-03', 'วิภา', 'แซ่ตั้ง')

    const assetRes = await request(app)
      .post('/api/hr/assets')
      .set(auth)
      .send({
        code: 'AST-003',
        name: 'กล้อง DSLR',
      })
    const assetId = assetRes.body.data.id

    const loanRes = await request(app)
      .post(`/api/hr/assets/${assetId}/loan`)
      .set(auth)
      .send({
        employee_id: empId,
        loaned_on: '2026-04-10',
      })
    const loanId = loanRes.body.data.id

    // 1. Return with date earlier than loaned_on -> 400
    const earlyRes = await request(app)
      .post(`/api/hr/asset-loans/${loanId}/return`)
      .set(auth)
      .send({ returned_on: '2026-04-05' })
    expect(earlyRes.status).toBe(400)
    expect(earlyRes.body.message).toBe('วันที่คืนต้องไม่ก่อนวันที่ยืม')

    // 2. Successful return -> 200
    const returnRes = await request(app)
      .post(`/api/hr/asset-loans/${loanId}/return`)
      .set(auth)
      .send({ returned_on: '2026-04-15' })
    expect(returnRes.status).toBe(200)
    expect(returnRes.body.success).toBe(true)
    expect(returnRes.body.data.returned_on).toBe('2026-04-15')

    // 3. Asset status is now AVAILABLE and current_loan is null
    const assetAfter = await request(app)
      .get(`/api/hr/assets/${assetId}`)
      .set(auth)
    expect(assetAfter.status).toBe(200)
    expect(assetAfter.body.data.status).toBe('AVAILABLE')
    expect(assetAfter.body.data.current_loan).toBeNull()

    // 4. Double return -> 409
    const doubleReturnRes = await request(app)
      .post(`/api/hr/asset-loans/${loanId}/return`)
      .set(auth)
      .send({ returned_on: '2026-04-16' })
    expect(doubleReturnRes.status).toBe(409)
    expect(doubleReturnRes.body.message).toBe('ทรัพย์สินนี้ถูกบันทึกรับคืนแล้ว')

    // 5. Loan again to another employee -> 201 (since it is AVAILABLE again)
    const emp2 = insertEmployee(admin.tenantId, 'EMP-04', 'กมล', 'มีสุข')
    const secondLoanRes = await request(app)
      .post(`/api/hr/assets/${assetId}/loan`)
      .set(auth)
      .send({
        employee_id: emp2,
        loaned_on: '2026-04-20',
      })
    expect(secondLoanRes.status).toBe(201)
  })

  it('queries asset loan history and employee asset loans', async () => {
    const admin = newAdmin()
    const auth = { Authorization: `Bearer ${admin.token}` }

    const empId = insertEmployee(admin.tenantId, 'EMP-05', 'มนัส', 'ใจดี')

    const assetRes = await request(app)
      .post('/api/hr/assets')
      .set(auth)
      .send({
        code: 'AST-005',
        name: 'จอมอนิเตอร์ 27"',
      })
    const assetId = assetRes.body.data.id

    // Loan 1
    const l1 = await request(app)
      .post(`/api/hr/assets/${assetId}/loan`)
      .set(auth)
      .send({
        employee_id: empId,
        loaned_on: '2026-05-01',
        note: 'รอบแรก',
      })
    const l1Id = l1.body.data.id

    // Return 1
    await request(app)
      .post(`/api/hr/asset-loans/${l1Id}/return`)
      .set(auth)
      .send({ returned_on: '2026-05-10' })

    // Loan 2
    await request(app)
      .post(`/api/hr/assets/${assetId}/loan`)
      .set(auth)
      .send({
        employee_id: empId,
        loaned_on: '2026-05-15',
        note: 'รอบสอง',
      })

    // GET /assets/:id/loans -> 2 items
    const assetLoansRes = await request(app)
      .get(`/api/hr/assets/${assetId}/loans`)
      .set(auth)
    expect(assetLoansRes.status).toBe(200)
    expect(assetLoansRes.body.data).toHaveLength(2)

    // GET /employees/:id/asset-loans -> 2 items
    const empLoansRes = await request(app)
      .get(`/api/hr/employees/${empId}/asset-loans`)
      .set(auth)
    expect(empLoansRes.status).toBe(200)
    expect(empLoansRes.body.data).toHaveLength(2)
    expect(empLoansRes.body.data[0].asset_code).toBe('AST-005')
  })

  it('enforces RBAC permissions and handles /me/asset-loans correctly', async () => {
    const admin = newAdmin()
    const adminAuth = { Authorization: `Bearer ${admin.token}` }

    // Normal USER without HR permission
    const normalUser = newUser(admin.tenantId)
    const userAuth = { Authorization: `Bearer ${normalUser.token}` }

    // 1. Normal USER gets 403 on GET /assets
    const forbiddenGet = await request(app)
      .get('/api/hr/assets')
      .set(userAuth)
    expect(forbiddenGet.status).toBe(403)
    expect(forbiddenGet.body.message).toBe('ไม่มีสิทธิ์เข้าถึง')

    // 2. Normal USER gets 403 on POST /assets
    const forbiddenPost = await request(app)
      .post('/api/hr/assets')
      .set(userAuth)
      .send({ code: 'AST-NOPE', name: 'No Access' })
    expect(forbiddenPost.status).toBe(403)

    // 3. Normal USER calls /me/asset-loans before employee link -> 404
    const meBeforeLink = await request(app)
      .get('/api/hr/me/asset-loans')
      .set(userAuth)
    expect(meBeforeLink.status).toBe(404)
    expect(meBeforeLink.body.message).toBe('บัญชีนี้ยังไม่ได้ผูกกับพนักงาน')

    // Link employee to normalUser
    const empUser = insertEmployee(admin.tenantId, 'EMP-U1', 'ผู้ใช้', 'ทดสอบ', normalUser.userId)
    const empOther = insertEmployee(admin.tenantId, 'EMP-U2', 'คนอื่น', 'ทดสอบ')

    // Admin creates 2 assets and loans 1 to empUser, 1 to empOther
    const ast1 = (await request(app).post('/api/hr/assets').set(adminAuth).send({ code: 'AST-U1', name: 'หูฟัง' })).body.data.id
    const ast2 = (await request(app).post('/api/hr/assets').set(adminAuth).send({ code: 'AST-U2', name: 'คีย์บอร์ด' })).body.data.id

    await request(app).post(`/api/hr/assets/${ast1}/loan`).set(adminAuth).send({ employee_id: empUser, loaned_on: '2026-06-01' })
    await request(app).post(`/api/hr/assets/${ast2}/loan`).set(adminAuth).send({ employee_id: empOther, loaned_on: '2026-06-01' })

    // 4. Normal USER calls /me/asset-loans -> sees ONLY their own loan (AST-U1), not AST-U2
    const meAfterLink = await request(app)
      .get('/api/hr/me/asset-loans')
      .set(userAuth)
    expect(meAfterLink.status).toBe(200)
    expect(meAfterLink.body.data).toHaveLength(1)
    expect(meAfterLink.body.data[0].asset_code).toBe('AST-U1')
    expect(meAfterLink.body.data[0].employee_id).toBe(empUser)
  })

  it('guarantees cross-company isolation: Tenant B cannot read or modify Tenant A assets or loans', async () => {
    const adminA = newAdmin()
    const adminB = newAdmin()
    const authA = { Authorization: `Bearer ${adminA.token}` }
    const authB = { Authorization: `Bearer ${adminB.token}` }

    const empA = insertEmployee(adminA.tenantId, 'EMP-A', 'กานดา', 'สุขสม')

    // Tenant A creates asset and loan
    const createResA = await request(app)
      .post('/api/hr/assets')
      .set(authA)
      .send({ code: 'AST-A1', name: 'แล็ปท็อป A' })
    const assetIdA = createResA.body.data.id

    const loanResA = await request(app)
      .post(`/api/hr/assets/${assetIdA}/loan`)
      .set(authA)
      .send({ employee_id: empA, loaned_on: '2026-07-01' })
    const loanIdA = loanResA.body.data.id

    // 1. Tenant B tries GET /assets/:id for Tenant A's asset -> 404
    const getResB = await request(app)
      .get(`/api/hr/assets/${assetIdA}`)
      .set(authB)
    expect(getResB.status).toBe(404)
    expect(getResB.body.message).toBe('ไม่พบทรัพย์สิน')

    // 2. Tenant B tries PUT /assets/:id for Tenant A's asset -> 404
    const putResB = await request(app)
      .put(`/api/hr/assets/${assetIdA}`)
      .set(authB)
      .send({ name: 'แอบแก้ชื่อ' })
    expect(putResB.status).toBe(404)
    expect(putResB.body.message).toBe('ไม่พบทรัพย์สิน')

    // 3. Tenant B tries POST /assets/:id/loan for Tenant A's asset -> 404
    const loanResB = await request(app)
      .post(`/api/hr/assets/${assetIdA}/loan`)
      .set(authB)
      .send({ employee_id: empA, loaned_on: '2026-07-02' })
    expect(loanResB.status).toBe(404)
    expect(loanResB.body.message).toBe('ไม่พบทรัพย์สิน')

    // 4. Tenant B tries POST /asset-loans/:id/return for Tenant A's loan -> 404
    const returnResB = await request(app)
      .post(`/api/hr/asset-loans/${loanIdA}/return`)
      .set(authB)
      .send({ returned_on: '2026-07-05' })
    expect(returnResB.status).toBe(404)
    expect(returnResB.body.message).toBe('ไม่พบรายการยืมทรัพย์สิน')

    // 5. Tenant B tries GET /employees/:id/asset-loans for Tenant A's employee -> 404
    const empLoansResB = await request(app)
      .get(`/api/hr/employees/${empA}/asset-loans`)
      .set(authB)
    expect(empLoansResB.status).toBe(404)
    expect(empLoansResB.body.message).toBe('ไม่พบพนักงาน')
  })
})
