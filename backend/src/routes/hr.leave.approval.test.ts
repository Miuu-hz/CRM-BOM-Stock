import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import approvalRoutes from './approval.routes'
import { isLeaveManagerFor } from '../services/approvalGate.service'
import { createTestUser } from '../test/testAuth'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/approval', authenticate, subscriptionGate(), approvalRoutes)
  return app
}

const tenants: string[] = []

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM approval_logs WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM approval_requests WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM leave_requests WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM leave_types WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM employees WHERE tenant_id = ?').run(t)
    db.prepare('UPDATE org_units SET parent_id = NULL, manager_employee_id = NULL WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM org_units WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM user_approval_permissions WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM tenant_subscriptions WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM users WHERE tenant_id = ?').run(t)
  }
})

function newTenantAdmin() {
  const u = createTestUser({ role: 'ADMIN' })
  tenants.push(u.tenantId)
  return u
}

function seedLeaveType(tenantId: string, code = 'SICK', name = 'ลาป่วย') {
  const id = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO leave_types (id, tenant_id, code, name, paid, days_per_year, is_active, created_at)
    VALUES (?, ?, ?, ?, 1, 30, 1, ?)
  `).run(id, tenantId, code, name, now)
  return id
}

function seedOrgUnit(tenantId: string, name: string, managerEmployeeId: string | null = null, parentId: string | null = null) {
  const id = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO org_units (id, tenant_id, name, parent_id, manager_employee_id, business_unit, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'RETAIL', 1, ?, ?)
  `).run(id, tenantId, name, parentId, managerEmployeeId, now, now)
  return id
}

function seedEmployee(
  tenantId: string,
  opts: { code: string; firstName: string; orgUnitId?: string | null; userId?: string | null }
) {
  const id = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO employees (
      id, tenant_id, code, first_name, last_name, org_unit_id,
      employment_type, base_wage, start_date, status, user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'ใจดี', ?, 'MONTHLY', 15000, '2026-01-01', 'ACTIVE', ?, ?, ?)
  `).run(id, tenantId, opts.code, opts.firstName, opts.orgUnitId ?? null, opts.userId ?? null, now, now)
  return id
}

function seedLeaveAndApproval(
  tenantId: string,
  opts: {
    employeeId: string
    leaveTypeId: string
    requester: { userId: string; email: string; role: string }
    leaveStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  }
) {
  const leaveId = generateId()
  const approvalId = generateId()
  const now = new Date().toISOString()
  const reqNo = `APR-${leaveId.slice(0, 8)}`
  const desc = 'ลาป่วย 1 วัน · 2026-11-03 ถึง 2026-11-03'

  db.prepare(`
    INSERT INTO leave_requests (
      id, tenant_id, employee_id, leave_type_id, start_date, end_date, days,
      reason, status, approval_request_id, requested_by, decided_by, decided_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '2026-11-03', '2026-11-03', 1, 'ป่วย', ?, ?, ?, NULL, NULL, ?, ?)
  `).run(leaveId, tenantId, opts.employeeId, opts.leaveTypeId, opts.leaveStatus ?? 'PENDING', approvalId, opts.requester.userId, now, now)

  db.prepare(`
    INSERT INTO approval_requests (
      id, tenant_id, request_number, module_type, reference_type, reference_id,
      requester_id, requester_name, requester_role, amount, description, status,
      payload, created_at, updated_at
    ) VALUES (?, ?, ?, 'leave', 'leave_requests', ?, ?, ?, ?, 0, ?, 'PENDING', NULL, ?, ?)
  `).run(
    approvalId, tenantId, reqNo, leaveId,
    opts.requester.userId, opts.requester.email, opts.requester.role, desc, now, now
  )

  return { leaveId, approvalId }
}

describe('HR Phase 4 (B2) — Leave approval via /api/approval', () => {
  const app = buildApp()

  it('ADMIN approves via decision endpoint → leave APPROVED + decided_by set, second call does not break, skip when leave not PENDING, and reject → REJECTED', async () => {
    const admin = newTenantAdmin()
    const staff = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const leaveTypeId = seedLeaveType(admin.tenantId)
    const empId = seedEmployee(admin.tenantId, { code: 'EMP-001', firstName: 'สมชาย', userId: staff.userId })

    // 1. ADMIN approves
    const { leaveId: leave1, approvalId: apr1 } = seedLeaveAndApproval(admin.tenantId, {
      employeeId: empId,
      leaveTypeId,
      requester: staff,
    })

    const res1 = await request(app)
      .put(`/api/approval/requests/${apr1}/decision`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'APPROVED', comment: 'อนุมัติให้ลา' })

    expect(res1.status).toBe(200)
    expect(res1.body.success).toBe(true)

    const row1 = db.prepare('SELECT status, decided_by, decided_at FROM leave_requests WHERE id = ?').get(leave1) as any
    expect(row1.status).toBe('APPROVED')
    expect(row1.decided_by).toBe(admin.userId)
    expect(row1.decided_at).toBeTruthy()

    // 2. Second call does not break and preserves leave row state
    const res1Repeat = await request(app)
      .put(`/api/approval/requests/${apr1}/decision`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'APPROVED' })

    expect(res1Repeat.status).toBe(400)
    const row1AfterRepeat = db.prepare('SELECT status, decided_by, decided_at FROM leave_requests WHERE id = ?').get(leave1) as any
    expect(row1AfterRepeat).toEqual(row1)

    // 3. Skip when leave_requests row is no longer PENDING (e.g. CANCELLED)
    const { leaveId: leaveCancelled, approvalId: aprCancelled } = seedLeaveAndApproval(admin.tenantId, {
      employeeId: empId,
      leaveTypeId,
      requester: staff,
      leaveStatus: 'CANCELLED',
    })

    const resCancelled = await request(app)
      .put(`/api/approval/requests/${aprCancelled}/decision`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'APPROVED' })

    expect(resCancelled.status).toBe(200)
    const rowCancelled = db.prepare('SELECT status, decided_by, decided_at FROM leave_requests WHERE id = ?').get(leaveCancelled) as any
    expect(rowCancelled.status).toBe('CANCELLED')
    expect(rowCancelled.decided_by).toBeNull()

    // 4. Reject → REJECTED with decided_by/decided_at
    const { leaveId: leave2, approvalId: apr2 } = seedLeaveAndApproval(admin.tenantId, {
      employeeId: empId,
      leaveTypeId,
      requester: staff,
    })

    const res2 = await request(app)
      .put(`/api/approval/requests/${apr2}/decision`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'REJECTED', comment: 'งานด่วน' })

    expect(res2.status).toBe(200)
    const row2 = db.prepare('SELECT status, decided_by, decided_at FROM leave_requests WHERE id = ?').get(leave2) as any
    expect(row2.status).toBe('REJECTED')
    expect(row2.decided_by).toBe(admin.userId)
    expect(row2.decided_at).toBeTruthy()
  })

  it('org unit manager (USER, no approval permission rows) sees team leave in GET /pending and can approve it, cannot approve own leave, unrelated USER gets 403, and tenant A manager cannot touch tenant B', async () => {
    const adminA = newTenantAdmin()
    const managerUser = createTestUser({ role: 'USER', tenantId: adminA.tenantId })
    const memberUser = createTestUser({ role: 'USER', tenantId: adminA.tenantId })
    const unrelatedUser = createTestUser({ role: 'USER', tenantId: adminA.tenantId })

    const leaveTypeId = seedLeaveType(adminA.tenantId)
    const ouId = seedOrgUnit(adminA.tenantId, 'แผนกขาย')
    const managerEmpId = seedEmployee(adminA.tenantId, {
      code: 'EMP-MGR',
      firstName: 'หัวหน้า',
      orgUnitId: ouId,
      userId: managerUser.userId,
    })
    db.prepare('UPDATE org_units SET manager_employee_id = ? WHERE id = ?').run(managerEmpId, ouId)

    const memberEmpId = seedEmployee(adminA.tenantId, {
      code: 'EMP-MEM',
      firstName: 'ลูกน้อง',
      orgUnitId: ouId,
      userId: memberUser.userId,
    })

    // Confirm manager has 0 user_approval_permissions rows
    const permCount = (db.prepare('SELECT COUNT(*) c FROM user_approval_permissions WHERE tenant_id = ? AND user_id = ?')
      .get(adminA.tenantId, managerUser.userId) as any).c
    expect(permCount).toBe(0)

    const { leaveId: memberLeaveId, approvalId: memberAprId } = seedLeaveAndApproval(adminA.tenantId, {
      employeeId: memberEmpId,
      leaveTypeId,
      requester: memberUser,
    })

    // Also create manager's own leave request (even with admin as requester_id to test isLeaveManagerFor self-guard)
    const { leaveId: mgrLeaveId, approvalId: mgrAprId } = seedLeaveAndApproval(adminA.tenantId, {
      employeeId: managerEmpId,
      leaveTypeId,
      requester: managerUser,
    })

    expect(isLeaveManagerFor(adminA.tenantId, managerUser.userId, memberLeaveId)).toBe(true)
    expect(isLeaveManagerFor(adminA.tenantId, managerUser.userId, mgrLeaveId)).toBe(false)

    // 1. Manager sees only team member's leave in GET /api/approval/pending (not own leave)
    const pendingRes = await request(app)
      .get('/api/approval/pending')
      .set('Authorization', `Bearer ${managerUser.token}`)

    expect(pendingRes.status).toBe(200)
    expect(pendingRes.body.data.map((r: any) => r.id)).toEqual([memberAprId])

    // 2. Unrelated USER sees nothing in GET /pending and gets 403 on decision
    const unrelatedPending = await request(app)
      .get('/api/approval/pending')
      .set('Authorization', `Bearer ${unrelatedUser.token}`)
    expect(unrelatedPending.status).toBe(200)
    expect(unrelatedPending.body.data).toEqual([])

    const unrelatedDecision = await request(app)
      .put(`/api/approval/requests/${memberAprId}/decision`)
      .set('Authorization', `Bearer ${unrelatedUser.token}`)
      .send({ decision: 'APPROVED' })
    expect(unrelatedDecision.status).toBe(403)

    // 3. Manager can view detail and approve team member's leave
    const detailRes = await request(app)
      .get(`/api/approval/requests/${memberAprId}/detail`)
      .set('Authorization', `Bearer ${managerUser.token}`)
    expect(detailRes.status).toBe(200)

    const mgrApproveRes = await request(app)
      .put(`/api/approval/requests/${memberAprId}/decision`)
      .set('Authorization', `Bearer ${managerUser.token}`)
      .send({ decision: 'APPROVED', comment: 'หัวหน้าอนุมัติ' })
    expect(mgrApproveRes.status).toBe(200)

    const memberLeaveRow = db.prepare('SELECT status, decided_by, decided_at FROM leave_requests WHERE id = ?').get(memberLeaveId) as any
    expect(memberLeaveRow.status).toBe('APPROVED')
    expect(memberLeaveRow.decided_by).toBe(managerUser.userId)
    expect(memberLeaveRow.decided_at).toBeTruthy()

    // 4. Same manager cannot approve their own leave (even if requester_id was someone else)
    const mgrSelfDecision1 = await request(app)
      .put(`/api/approval/requests/${mgrAprId}/decision`)
      .set('Authorization', `Bearer ${managerUser.token}`)
      .send({ decision: 'APPROVED' })
    expect(mgrSelfDecision1.status).toBe(403)

    db.prepare('UPDATE approval_requests SET requester_id = ? WHERE id = ?').run(adminA.userId, mgrAprId)
    const mgrSelfDecision2 = await request(app)
      .put(`/api/approval/requests/${mgrAprId}/decision`)
      .set('Authorization', `Bearer ${managerUser.token}`)
      .send({ decision: 'APPROVED' })
    expect(mgrSelfDecision2.status).toBe(403)

    const mgrLeaveRow = db.prepare('SELECT status, decided_by FROM leave_requests WHERE id = ?').get(mgrLeaveId) as any
    expect(mgrLeaveRow.status).toBe('PENDING')
    expect(mgrLeaveRow.decided_by).toBeNull()

    // 5. Manager of tenant A cannot touch tenant B
    const adminB = newTenantAdmin()
    const memberB = createTestUser({ role: 'USER', tenantId: adminB.tenantId })
    const leaveTypeB = seedLeaveType(adminB.tenantId)
    const ouB = seedOrgUnit(adminB.tenantId, 'แผนก B')
    const empB = seedEmployee(adminB.tenantId, { code: 'EMP-B1', firstName: 'คนบริษัทบี', orgUnitId: ouB, userId: memberB.userId })
    const { leaveId: leaveBId, approvalId: aprBId } = seedLeaveAndApproval(adminB.tenantId, {
      employeeId: empB,
      leaveTypeId: leaveTypeB,
      requester: memberB,
    })

    expect(isLeaveManagerFor(adminA.tenantId, managerUser.userId, leaveBId)).toBe(false)
    expect(isLeaveManagerFor(adminB.tenantId, managerUser.userId, leaveBId)).toBe(false)

    const crossTenantDecision = await request(app)
      .put(`/api/approval/requests/${aprBId}/decision`)
      .set('Authorization', `Bearer ${managerUser.token}`)
      .send({ decision: 'APPROVED' })
    expect(crossTenantDecision.status).toBe(404)

    const leaveBRow = db.prepare('SELECT status, decided_by FROM leave_requests WHERE id = ?').get(leaveBId) as any
    expect(leaveBRow.status).toBe('PENDING')
    expect(leaveBRow.decided_by).toBeNull()
  })
})
