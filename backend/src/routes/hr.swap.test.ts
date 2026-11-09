import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import hrSwapRoutes from './hr.swap.routes'
import { createTestUser } from '../test/testAuth'
import { addDays } from '../services/hr/rosterData'

function buildApp() {
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.use('/api/hr', authenticate, subscriptionGate('hr'))
  app.use('/api/hr', hrSwapRoutes)
  return app
}

const tenants: string[] = []

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM approval_logs WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM approval_requests WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM shift_swaps WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM shift_assignments WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM shifts WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM employees WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM tenant_subscriptions WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM users WHERE tenant_id = ?').run(t)
  }
})

function setup() {
  const admin = createTestUser({ role: 'ADMIN' })
  tenants.push(admin.tenantId)

  const ua = createTestUser({ role: 'USER', tenantId: admin.tenantId })
  const ub = createTestUser({ role: 'USER', tenantId: admin.tenantId })
  const uc = createTestUser({ role: 'USER', tenantId: admin.tenantId })

  const otherAdmin = createTestUser({ role: 'ADMIN' })
  tenants.push(otherAdmin.tenantId)

  // Seed 2 shifts: เช้า (08:00–17:00), บ่าย (13:00–22:00)
  const shiftMorningId = generateId()
  const shiftAfternoonId = generateId()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO shifts (id, tenant_id, name, start_time, end_time, grace_minutes, break_minutes, is_active, created_at)
    VALUES (?, ?, 'เช้า', '08:00', '17:00', 0, 60, 1, ?)
  `).run(shiftMorningId, admin.tenantId, now)

  db.prepare(`
    INSERT INTO shifts (id, tenant_id, name, start_time, end_time, grace_minutes, break_minutes, is_active, created_at)
    VALUES (?, ?, 'บ่าย', '13:00', '22:00', 0, 60, 1, ?)
  `).run(shiftAfternoonId, admin.tenantId, now)

  // Employees A (default เช้า, linked to ua), B (default บ่าย, linked to ub), C (default เช้า, linked to uc)
  const empAId = generateId()
  const empBId = generateId()
  const empCId = generateId()

  const insertEmp = db.prepare(`
    INSERT INTO employees (
      id, tenant_id, code, first_name, last_name, employment_type,
      base_wage, start_date, status, user_id, shift_id
    ) VALUES (?, ?, ?, ?, ?, 'MONTHLY', 20000, '2026-01-01', 'ACTIVE', ?, ?)
  `)

  insertEmp.run(empAId, admin.tenantId, 'EMP-A', 'สมชาย', 'สายัณห์', ua.userId, shiftMorningId)
  insertEmp.run(empBId, admin.tenantId, 'EMP-B', 'สมหญิง', 'มิ่งขวัญ', ub.userId, shiftAfternoonId)
  insertEmp.run(empCId, admin.tenantId, 'EMP-C', 'ชาตรี', 'มีสุข', uc.userId, shiftMorningId)

  // Employee of another tenant
  const otherEmpId = generateId()
  insertEmp.run(otherEmpId, otherAdmin.tenantId, 'EMP-OTHER', 'คนอื่น', 'ต่างแดน', null, null)

  const futureDate = addDays(thaiDateStr(), 3)

  return {
    admin,
    ua,
    ub,
    uc,
    otherAdmin,
    empA: { id: empAId, name: 'สมชาย สายัณห์' },
    empB: { id: empBId, name: 'สมหญิง มิ่งขวัญ' },
    empC: { id: empCId, name: 'ชาตรี มีสุข' },
    otherEmp: { id: otherEmpId },
    shiftMorning: { id: shiftMorningId, name: 'เช้า' },
    shiftAfternoon: { id: shiftAfternoonId, name: 'บ่าย' },
    futureDate,
  }
}

describe('HR Phase 7 — Shift swap requests (B7b: S1–S6)', () => {
  it('1. ua creates swap with B → 201 PEER_PENDING, requester_shift.name เช้า / target_shift.name บ่าย. Same request again → 409. Swap A↔C (both เช้า) → 400. Past date → 400. Self as target → 400. Other-tenant employee → 404.', async () => {
    const app = buildApp()
    const { ua, empA, empB, empC, otherEmp, futureDate } = setup()

    // ua creates swap with B → 201 PEER_PENDING
    const res = await request(app)
      .post('/api/hr/me/shift-swaps')
      .set('Authorization', `Bearer ${ua.token}`)
      .send({
        target_employee_id: empB.id,
        work_date: futureDate,
        reason: 'ธุระด่วน',
      })
    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.status).toBe('PEER_PENDING')
    expect(res.body.data.requester_shift.name).toBe('เช้า')
    expect(res.body.data.target_shift.name).toBe('บ่าย')
    expect(res.body.data.requester_employee_id).toBe(empA.id)
    expect(res.body.data.target_employee_id).toBe(empB.id)

    // Same request again → 409
    const dup = await request(app)
      .post('/api/hr/me/shift-swaps')
      .set('Authorization', `Bearer ${ua.token}`)
      .send({
        target_employee_id: empB.id,
        work_date: futureDate,
      })
    expect(dup.status).toBe(409)
    expect(dup.body.success).toBe(false)

    // Swap A↔C (both เช้า) → 400
    const sameShiftDate = addDays(futureDate, 10)
    const sameShift = await request(app)
      .post('/api/hr/me/shift-swaps')
      .set('Authorization', `Bearer ${ua.token}`)
      .send({
        target_employee_id: empC.id,
        work_date: sameShiftDate,
      })
    expect(sameShift.status).toBe(400)
    expect(sameShift.body.success).toBe(false)
    expect(sameShift.body.message).toContain('กะของทั้งสองคนเหมือนกัน ไม่ต้องแลก')

    // Past date → 400
    const past = await request(app)
      .post('/api/hr/me/shift-swaps')
      .set('Authorization', `Bearer ${ua.token}`)
      .send({
        target_employee_id: empB.id,
        work_date: '2020-01-01',
      })
    expect(past.status).toBe(400)
    expect(past.body.success).toBe(false)

    // Self as target → 400
    const selfSwap = await request(app)
      .post('/api/hr/me/shift-swaps')
      .set('Authorization', `Bearer ${ua.token}`)
      .send({
        target_employee_id: empA.id,
        work_date: addDays(futureDate, 11),
      })
    expect(selfSwap.status).toBe(400)
    expect(selfSwap.body.success).toBe(false)

    // Other-tenant employee → 404
    const otherTenant = await request(app)
      .post('/api/hr/me/shift-swaps')
      .set('Authorization', `Bearer ${ua.token}`)
      .send({
        target_employee_id: otherEmp.id,
        work_date: addDays(futureDate, 12),
      })
    expect(otherTenant.status).toBe(404)
    expect(otherTenant.body.success).toBe(false)
  })

  it('2. uc tries to accept A↔B → 403. ub accepts → PENDING, an approval_requests row with module_type shift_swap and status PENDING exists', async () => {
    const app = buildApp()
    const { ua, ub, uc, admin, empB, futureDate } = setup()

    const created = await request(app)
      .post('/api/hr/me/shift-swaps')
      .set('Authorization', `Bearer ${ua.token}`)
      .send({
        target_employee_id: empB.id,
        work_date: futureDate,
      })
    expect(created.status).toBe(201)
    const swapId = created.body.data.id

    // uc tries to accept A↔B → 403
    const ucRes = await request(app)
      .post(`/api/hr/me/shift-swaps/${swapId}/accept`)
      .set('Authorization', `Bearer ${uc.token}`)
    expect(ucRes.status).toBe(403)
    expect(ucRes.body.success).toBe(false)

    // ub accepts → PENDING
    const ubRes = await request(app)
      .post(`/api/hr/me/shift-swaps/${swapId}/accept`)
      .set('Authorization', `Bearer ${ub.token}`)
    expect(ubRes.status).toBe(200)
    expect(ubRes.body.success).toBe(true)
    expect(ubRes.body.data.status).toBe('PENDING')
    expect(ubRes.body.data.approval_request_id).toBeTruthy()

    // Check approval_requests row with module_type shift_swap and status PENDING in DB
    const aprRow = db.prepare(
      "SELECT * FROM approval_requests WHERE id = ? AND tenant_id = ? AND module_type = 'shift_swap'"
    ).get(ubRes.body.data.approval_request_id, admin.tenantId) as any

    expect(aprRow).toBeTruthy()
    expect(aprRow.status).toBe('PENDING')
    expect(aprRow.reference_type).toBe('shift_swaps')
    expect(aprRow.reference_id).toBe(swapId)
  })

  it('3. S2 for ua and for ub both list it; S6 as ADMIN lists it.', async () => {
    const app = buildApp()
    const { ua, ub, admin, empB, futureDate } = setup()

    const created = await request(app)
      .post('/api/hr/me/shift-swaps')
      .set('Authorization', `Bearer ${ua.token}`)
      .send({
        target_employee_id: empB.id,
        work_date: futureDate,
      })
    const swapId = created.body.data.id

    // S2 for ua lists it
    const s2Ua = await request(app)
      .get('/api/hr/me/shift-swaps')
      .set('Authorization', `Bearer ${ua.token}`)
    expect(s2Ua.status).toBe(200)
    expect(s2Ua.body.success).toBe(true)
    expect(s2Ua.body.data.some((s: any) => s.id === swapId)).toBe(true)

    // S2 for ub lists it
    const s2Ub = await request(app)
      .get('/api/hr/me/shift-swaps')
      .set('Authorization', `Bearer ${ub.token}`)
    expect(s2Ub.status).toBe(200)
    expect(s2Ub.body.success).toBe(true)
    expect(s2Ub.body.data.some((s: any) => s.id === swapId)).toBe(true)

    // S6 as ADMIN lists it
    const s6Admin = await request(app)
      .get('/api/hr/shift-swaps')
      .set('Authorization', `Bearer ${admin.token}`)
    expect(s6Admin.status).toBe(200)
    expect(s6Admin.body.success).toBe(true)
    expect(s6Admin.body.data.some((s: any) => s.id === swapId)).toBe(true)

    // S6 with status filter
    const s6Pending = await request(app)
      .get('/api/hr/shift-swaps?status=PEER_PENDING')
      .set('Authorization', `Bearer ${admin.token}`)
    expect(s6Pending.status).toBe(200)
    expect(s6Pending.body.data.some((s: any) => s.id === swapId)).toBe(true)

    const s6Approved = await request(app)
      .get('/api/hr/shift-swaps?status=APPROVED')
      .set('Authorization', `Bearer ${admin.token}`)
    expect(s6Approved.status).toBe(200)
    expect(s6Approved.body.data.some((s: any) => s.id === swapId)).toBe(false)
  })

  it('4. New swap A↔B on another date, ub declines → DECLINED. Another one: ua cancels via S5 while PEER_PENDING → CANCELLED; a PENDING one (after ub accepts) cancelled by ua → CANCELLED and its approval request is CANCELLED.', async () => {
    const app = buildApp()
    const { ua, ub, admin, empB, futureDate } = setup()

    // 4a. ub declines → DECLINED
    const date1 = addDays(futureDate, 1)
    const swap1 = await request(app)
      .post('/api/hr/me/shift-swaps')
      .set('Authorization', `Bearer ${ua.token}`)
      .send({ target_employee_id: empB.id, work_date: date1 })
    expect(swap1.status).toBe(201)

    const decRes = await request(app)
      .post(`/api/hr/me/shift-swaps/${swap1.body.data.id}/decline`)
      .set('Authorization', `Bearer ${ub.token}`)
    expect(decRes.status).toBe(200)
    expect(decRes.body.success).toBe(true)
    expect(decRes.body.data.status).toBe('DECLINED')

    // 4b. ua cancels via S5 while PEER_PENDING → CANCELLED
    const date2 = addDays(futureDate, 2)
    const swap2 = await request(app)
      .post('/api/hr/me/shift-swaps')
      .set('Authorization', `Bearer ${ua.token}`)
      .send({ target_employee_id: empB.id, work_date: date2 })
    expect(swap2.status).toBe(201)

    const cancelPeerPending = await request(app)
      .post(`/api/hr/shift-swaps/${swap2.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${ua.token}`)
    expect(cancelPeerPending.status).toBe(200)
    expect(cancelPeerPending.body.success).toBe(true)
    expect(cancelPeerPending.body.data.status).toBe('CANCELLED')

    // 4c. a PENDING one (after ub accepts) cancelled by ua → CANCELLED and its approval request is CANCELLED
    const date3 = addDays(futureDate, 3)
    const swap3 = await request(app)
      .post('/api/hr/me/shift-swaps')
      .set('Authorization', `Bearer ${ua.token}`)
      .send({ target_employee_id: empB.id, work_date: date3 })
    expect(swap3.status).toBe(201)

    const acceptRes = await request(app)
      .post(`/api/hr/me/shift-swaps/${swap3.body.data.id}/accept`)
      .set('Authorization', `Bearer ${ub.token}`)
    expect(acceptRes.status).toBe(200)
    expect(acceptRes.body.data.status).toBe('PENDING')
    const aprId = acceptRes.body.data.approval_request_id
    expect(aprId).toBeTruthy()

    const cancelPending = await request(app)
      .post(`/api/hr/shift-swaps/${swap3.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${ua.token}`)
    expect(cancelPending.status).toBe(200)
    expect(cancelPending.body.success).toBe(true)
    expect(cancelPending.body.data.status).toBe('CANCELLED')

    // Verify approval request is CANCELLED
    const aprRow = db.prepare(
      'SELECT status FROM approval_requests WHERE id = ? AND tenant_id = ?'
    ).get(aprId, admin.tenantId) as any
    expect(aprRow.status).toBe('CANCELLED')
  })

  it('5. A USER without hr permission calling S6 → 403; ub cancelling ua\'s request → 403.', async () => {
    const app = buildApp()
    const { ua, ub, empB, futureDate } = setup()

    // A USER without hr permission calling S6 → 403
    const s6User = await request(app)
      .get('/api/hr/shift-swaps')
      .set('Authorization', `Bearer ${ua.token}`)
    expect(s6User.status).toBe(403)
    expect(s6User.body.success).toBe(false)

    // ub cancelling ua's request → 403
    const date4 = addDays(futureDate, 4)
    const swap = await request(app)
      .post('/api/hr/me/shift-swaps')
      .set('Authorization', `Bearer ${ua.token}`)
      .send({ target_employee_id: empB.id, work_date: date4 })
    expect(swap.status).toBe(201)

    const ubCancel = await request(app)
      .post(`/api/hr/shift-swaps/${swap.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${ub.token}`)
    expect(ubCancel.status).toBe(403)
    expect(ubCancel.body.success).toBe(false)
  })

  it('6. Immediate-approve: target with bypass accepts → APPROVED and shifts swapped immediately', async () => {
    const app = buildApp()
    const { admin, ua, empA, futureDate } = setup()

    // Link admin user to an employee with afternoon shift
    const adminEmpId = generateId()
    const shiftAfternoon = db.prepare("SELECT id FROM shifts WHERE tenant_id = ? AND name = 'บ่าย'").get(admin.tenantId) as any

    db.prepare(`
      INSERT INTO employees (
        id, tenant_id, code, first_name, last_name, employment_type,
        base_wage, start_date, status, user_id, shift_id
      ) VALUES (?, ?, 'EMP-ADMIN', 'บอส', 'ใหญ่', 'MONTHLY', 50000, '2026-01-01', 'ACTIVE', ?, ?)
    `).run(adminEmpId, admin.tenantId, admin.userId, shiftAfternoon.id)

    const date5 = addDays(futureDate, 5)
    const created = await request(app)
      .post('/api/hr/me/shift-swaps')
      .set('Authorization', `Bearer ${ua.token}`)
      .send({ target_employee_id: adminEmpId, work_date: date5 })
    expect(created.status).toBe(201)

    // admin accepts → since admin has bypass, immediately APPROVED
    const acceptRes = await request(app)
      .post(`/api/hr/me/shift-swaps/${created.body.data.id}/accept`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(acceptRes.status).toBe(200)
    expect(acceptRes.body.success).toBe(true)
    expect(acceptRes.body.data.status).toBe('APPROVED')
    // Shifts swapped: requester (empA) now has บ่าย, target (adminEmp) now has เช้า
    expect(acceptRes.body.data.requester_shift.name).toBe('บ่าย')
    expect(acceptRes.body.data.target_shift.name).toBe('เช้า')

    // Verify shift_assignments in DB
    const aAssign = db.prepare('SELECT shift_id FROM shift_assignments WHERE tenant_id = ? AND employee_id = ? AND work_date = ?').get(admin.tenantId, empA.id, date5) as any
    const adminAssign = db.prepare('SELECT shift_id FROM shift_assignments WHERE tenant_id = ? AND employee_id = ? AND work_date = ?').get(admin.tenantId, adminEmpId, date5) as any
    expect(aAssign.shift_id).toBe(shiftAfternoon.id)
    const shiftMorning = db.prepare("SELECT id FROM shifts WHERE tenant_id = ? AND name = 'เช้า'").get(admin.tenantId) as any
    expect(adminAssign.shift_id).toBe(shiftMorning.id)
  })
})
