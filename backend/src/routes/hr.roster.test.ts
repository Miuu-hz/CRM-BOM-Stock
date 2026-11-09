import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import hrRosterRouter from './hr.roster.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/hr', authenticate, subscriptionGate('hr'))
app.use('/api/hr', hrRosterRouter)

const tenants: string[] = []

afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of [
      'shift_assignments',
      'pos_running_bills',
      'hr_settings',
      'employees',
      'shifts',
      'org_units',
      'tenant_subscriptions',
      'users',
    ]) {
      db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t)
    }
  }
})

const MONDAY = '2030-01-07'
const TUESDAY = '2030-01-08'
const WEDNESDAY = '2030-01-09'
const NEXT_MONDAY = '2030-01-14'

function setupSeed() {
  const admin = createTestUser({ role: 'ADMIN' })
  tenants.push(admin.tenantId)
  const otherAdmin = createTestUser({ role: 'ADMIN' })
  tenants.push(otherAdmin.tenantId)

  const linkedUser = createTestUser({ role: 'USER', tenantId: admin.tenantId })
  const unlinkedUser = createTestUser({ role: 'USER', tenantId: admin.tenantId })

  const shiftMorningId = generateId()
  const shiftLongId = generateId()
  const shiftInactiveId = generateId()

  const insertShift = db.prepare(`
    INSERT INTO shifts (id, tenant_id, name, start_time, end_time, grace_minutes, break_minutes, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, 0, 60, ?, '2026-01-01T00:00:00.000Z')
  `)
  // เช้า 09:00–18:00 พัก 60 = 8 ชม.
  insertShift.run(shiftMorningId, admin.tenantId, 'เช้า', '09:00', '18:00', 1)
  // ยาว 08:00–20:00 พัก 60 = 11 ชม.
  insertShift.run(shiftLongId, admin.tenantId, 'ยาว', '08:00', '20:00', 1)
  // กะที่ปิดใช้งาน
  insertShift.run(shiftInactiveId, admin.tenantId, 'ดึก (ปิด)', '22:00', '06:00', 0)

  const empMonthlyId = generateId()
  const empDailyId = generateId()
  const empHourlyId = generateId()
  const otherEmpId = generateId()

  const insertEmp = db.prepare(`
    INSERT INTO employees (
      id, tenant_id, code, first_name, last_name, employment_type,
      base_wage, start_date, status, shift_id, user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '2026-01-01', 'ACTIVE', ?, ?)
  `)
  insertEmp.run(empMonthlyId, admin.tenantId, 'EMP-001', 'สมชาย', 'รายเดือน', 'MONTHLY', 15000, shiftMorningId, linkedUser.userId)
  insertEmp.run(empDailyId, admin.tenantId, 'EMP-002', 'สมหญิง', 'รายวัน', 'DAILY', 400, null, null)
  insertEmp.run(empHourlyId, admin.tenantId, 'EMP-003', 'สมปอง', 'รายชั่วโมง', 'HOURLY', 50, null, null)
  insertEmp.run(otherEmpId, otherAdmin.tenantId, 'EMP-999', 'ต่าง', 'บริษัท', 'MONTHLY', 20000, null, null)

  return {
    tenantId: admin.tenantId,
    auth: { Authorization: `Bearer ${admin.token}` },
    linkedUserAuth: { Authorization: `Bearer ${linkedUser.token}` },
    unlinkedUserAuth: { Authorization: `Bearer ${unlinkedUser.token}` },
    shiftMorningId,
    shiftLongId,
    shiftInactiveId,
    empMonthlyId,
    empDailyId,
    empHourlyId,
    otherEmpId,
  }
}

describe('HR Phase 7 — Shift Roster API (B7a: R1–R5)', () => {
  it('1–6: R2 assign/rollback, R1 effective cells & warnings, POS avg sales & labor %, R3 copy week, R2 clear, and R4/R5 self endpoints', async () => {
    const {
      tenantId,
      auth,
      linkedUserAuth,
      unlinkedUserAuth,
      shiftMorningId,
      shiftLongId,
      shiftInactiveId,
      empMonthlyId,
      empDailyId,
      empHourlyId,
      otherEmpId,
    } = setupSeed()

    // 1a. Inactive shift id -> 400 and nothing saved (transaction rollback)
    const badShiftRes = await request(app)
      .put('/api/hr/roster/assignments')
      .set(auth)
      .send({
        items: [
          { employee_id: empDailyId, work_date: MONDAY, shift_id: shiftLongId },
          { employee_id: empMonthlyId, work_date: TUESDAY, shift_id: shiftInactiveId },
        ],
      })
    expect(badShiftRes.status).toBe(400)
    expect(badShiftRes.body.success).toBe(false)
    const countAfterBadShift = (
      db.prepare('SELECT COUNT(*) as c FROM shift_assignments WHERE tenant_id = ?').get(tenantId) as { c: number }
    ).c
    expect(countAfterBadShift).toBe(0)

    // 1b. Other-tenant employee -> 404 and nothing saved
    const otherTenantRes = await request(app)
      .put('/api/hr/roster/assignments')
      .set(auth)
      .send({
        items: [
          { employee_id: empDailyId, work_date: MONDAY, shift_id: shiftLongId },
          { employee_id: otherEmpId, work_date: MONDAY, shift_id: shiftMorningId },
        ],
      })
    expect(otherTenantRes.status).toBe(404)
    expect(otherTenantRes.body.success).toBe(false)
    const countAfterOtherTenant = (
      db.prepare('SELECT COUNT(*) as c FROM shift_assignments WHERE tenant_id = ?').get(tenantId) as { c: number }
    ).c
    expect(countAfterOtherTenant).toBe(0)

    // 1c. Valid R2: DAILY -> ยาว on Monday, OFF (null) on Tuesday; MONTHLY -> OFF on Wednesday -> 200 {updated: 3, cleared: 0}
    const assignRes = await request(app)
      .put('/api/hr/roster/assignments')
      .set(auth)
      .send({
        items: [
          { employee_id: empDailyId, work_date: MONDAY, shift_id: shiftLongId },
          { employee_id: empDailyId, work_date: TUESDAY, shift_id: null },
          { employee_id: empMonthlyId, work_date: WEDNESDAY, shift_id: null },
        ],
      })
    expect(assignRes.status).toBe(200)
    expect(assignRes.body).toEqual({
      success: true,
      data: { updated: 3, cleared: 0 },
    })

    // 2. R1 for that week
    const r1Res = await request(app)
      .get(`/api/hr/roster?week_start=${MONDAY}`)
      .set(auth)
    expect(r1Res.status).toBe(200)
    expect(r1Res.body.success).toBe(true)

    const roster = r1Res.body.data
    expect(roster.week_start).toBe(MONDAY)
    expect(roster.dates).toHaveLength(7)
    expect(roster.shifts).toHaveLength(3) // รวมกะที่ปิดใช้

    const rowMonthly = roster.employees.find((e: any) => e.id === empMonthlyId)
    const rowDaily = roster.employees.find((e: any) => e.id === empDailyId)
    const rowHourly = roster.employees.find((e: any) => e.id === empHourlyId)

    // MONTHLY: Monday DEFAULT เช้า, Wednesday ASSIGNED null
    expect(rowMonthly.cells[0]).toMatchObject({
      date: MONDAY,
      shift_id: shiftMorningId,
      source: 'DEFAULT',
    })
    expect(rowMonthly.cells[2]).toMatchObject({
      date: WEDNESDAY,
      shift_id: null,
      source: 'ASSIGNED',
    })
    expect(rowMonthly.warnings).not.toContain('ไม่มีวันหยุดในสัปดาห์ (ม.28)')

    // DAILY: Monday ASSIGNED ยาว, Tuesday ASSIGNED null
    expect(rowDaily.cells[0]).toMatchObject({
      date: MONDAY,
      shift_id: shiftLongId,
      source: 'ASSIGNED',
    })
    expect(rowDaily.cells[1]).toMatchObject({
      date: TUESDAY,
      shift_id: null,
      source: 'ASSIGNED',
    })
    expect(rowDaily.warnings).toContain(`${MONDAY} เกิน 8 ชม. (OT 3 ชม.)`)

    // HOURLY: all NONE
    expect(rowHourly.cells.every((c: any) => c.shift_id === null && c.source === 'NONE')).toBe(true)

    // Monday summary: staff = 2, labor_cost = 15000/30 + 400 = 900
    expect(roster.days[0]).toMatchObject({
      date: MONDAY,
      staff: 2,
      labor_cost: 900,
      avg_sales: null,
      labor_pct: null,
    })

    // 3. POS bills & hr_settings warnings
    const insertBill = db.prepare(`
      INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, opened_at, closed_at, total_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    // Monday - 7 (2029-12-31), Monday - 14 (2029-12-24), Monday - 21 (2029-12-17)
    insertBill.run(generateId(), tenantId, 'POS-001', 'โต๊ะ 1', 'PAID', '2029-12-31T04:00:00.000Z', '2029-12-31T05:00:00.000Z', 3000)
    insertBill.run(generateId(), tenantId, 'POS-002', 'โต๊ะ 2', 'PAID', '2029-12-24T04:00:00.000Z', '2029-12-24T05:00:00.000Z', 1000)
    insertBill.run(generateId(), tenantId, 'POS-003', 'โต๊ะ 3', 'CANCELLED', '2029-12-17T04:00:00.000Z', '2029-12-17T05:00:00.000Z', 5000)

    db.prepare(`
      INSERT INTO hr_settings (tenant_id, settings, updated_at)
      VALUES (?, ?, '2026-01-01T00:00:00.000Z')
    `).run(tenantId, JSON.stringify({ rosterMinStaff: 3, laborCostTargetPct: 25 }))

    const r1PosRes = await request(app)
      .get(`/api/hr/roster?week_start=${MONDAY}`)
      .set(auth)
    expect(r1PosRes.status).toBe(200)
    const monDay = r1PosRes.body.data.days[0]
    expect(monDay.avg_sales).toBe(1000)
    expect(monDay.labor_pct).toBe(90)
    expect(monDay.warnings).toContain('คนไม่ถึงขั้นต่ำ (2/3)')
    expect(monDay.warnings).toContain('ค่าแรงเกินเป้า 90%')

    // วันอื่นที่ไม่มีบิล -> avg_sales null
    expect(r1PosRes.body.data.days[1].avg_sales).toBeNull()
    expect(r1PosRes.body.data.days[1].labor_pct).toBeNull()

    // 4. R3 copy to next week -> copied 3; again without overwrite -> skipped 3; week_start not Monday -> 400
    const copy1 = await request(app)
      .post('/api/hr/roster/copy')
      .set(auth)
      .send({ from_week_start: MONDAY, to_week_start: NEXT_MONDAY })
    expect(copy1.status).toBe(200)
    expect(copy1.body).toEqual({
      success: true,
      data: { copied: 3, skipped: 0 },
    })

    const copy2 = await request(app)
      .post('/api/hr/roster/copy')
      .set(auth)
      .send({ from_week_start: MONDAY, to_week_start: NEXT_MONDAY })
    expect(copy2.status).toBe(200)
    expect(copy2.body).toEqual({
      success: true,
      data: { copied: 0, skipped: 3 },
    })

    const copyNotMonday = await request(app)
      .post('/api/hr/roster/copy')
      .set(auth)
      .send({ from_week_start: TUESDAY, to_week_start: NEXT_MONDAY })
    expect(copyNotMonday.status).toBe(400)
    expect(copyNotMonday.body.success).toBe(false)

    // 5. R2 clear: true -> row deleted -> R1 shows DEFAULT again
    const clearRes = await request(app)
      .put('/api/hr/roster/assignments')
      .set(auth)
      .send({
        items: [{ employee_id: empMonthlyId, work_date: WEDNESDAY, shift_id: null, clear: true }],
      })
    expect(clearRes.status).toBe(200)
    expect(clearRes.body).toEqual({
      success: true,
      data: { updated: 0, cleared: 1 },
    })

    const r1AfterClear = await request(app)
      .get(`/api/hr/roster?week_start=${MONDAY}`)
      .set(auth)
    const rowMonthlyAfter = r1AfterClear.body.data.employees.find((e: any) => e.id === empMonthlyId)
    expect(rowMonthlyAfter.cells[2]).toMatchObject({
      date: WEDNESDAY,
      shift_id: shiftMorningId,
      source: 'DEFAULT',
    })

    // 6. R4/R5 as a USER linked to the MONTHLY employee
    const r4Res = await request(app)
      .get(`/api/hr/me/roster?week_start=${MONDAY}`)
      .set(linkedUserAuth)
    expect(r4Res.status).toBe(200)
    expect(r4Res.body.data.employee_id).toBe(empMonthlyId)
    expect(r4Res.body.data.days).toHaveLength(7)
    expect(r4Res.body.data.days[0].shift).toMatchObject({
      id: shiftMorningId,
      name: 'เช้า',
      start_time: '09:00',
      end_time: '18:00',
      break_minutes: 60,
      hours: 8,
    })

    const r5Res = await request(app)
      .get(`/api/hr/me/roster/day?date=${MONDAY}`)
      .set(linkedUserAuth)
    expect(r5Res.status).toBe(200)
    const colleagues = r5Res.body.data
    expect(colleagues.some((c: any) => c.employee_id === empMonthlyId)).toBe(false)
    const dailyColleague = colleagues.find((c: any) => c.employee_id === empDailyId)
    expect(dailyColleague).toBeTruthy()
    expect(dailyColleague.shift).toMatchObject({
      id: shiftLongId,
      name: 'ยาว',
      hours: 11,
    })

    // User with no linked employee -> 404
    const unlinkedR4 = await request(app)
      .get(`/api/hr/me/roster?week_start=${MONDAY}`)
      .set(unlinkedUserAuth)
    expect(unlinkedR4.status).toBe(404)

    const unlinkedR5 = await request(app)
      .get(`/api/hr/me/roster/day?date=${MONDAY}`)
      .set(unlinkedUserAuth)
    expect(unlinkedR5.status).toBe(404)

    // Linked USER without hr permission calling R1 -> 403
    const userR1 = await request(app)
      .get(`/api/hr/roster?week_start=${MONDAY}`)
      .set(linkedUserAuth)
    expect(userR1.status).toBe(403)
  })
})
