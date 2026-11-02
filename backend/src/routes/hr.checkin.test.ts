import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import hrCheckinRoutes, { haversineMeters, resetCheckinPinLockout } from './hr.checkin.routes'
import { createTestUser } from '../test/testAuth'

function buildApp() {
  const app = express()
  app.use(express.json({ limit: '1mb', strict: false }))
  app.use('/api/hr', authenticate, subscriptionGate('hr'))
  app.use('/api/hr', hrCheckinRoutes)
  return app
}

const tenants: string[] = []

afterEach(() => {
  resetCheckinPinLockout()
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM attendance_logs WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM hr_checkin_locations WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM employees WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM shifts WHERE tenant_id = ?').run(t)
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
  devicePin?: string | null
  shiftId?: string | null
  checkinPinHash?: string | null
  status?: 'ACTIVE' | 'RESIGNED' | 'TERMINATED'
}) {
  const id = generateId()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO employees (
       id, tenant_id, code, first_name, last_name, employment_type, base_wage,
       start_date, status, user_id, device_pin, shift_id, checkin_pin_hash, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'MONTHLY', 15000, '2026-01-01', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.tenantId,
    params.code,
    params.firstName,
    params.lastName ?? null,
    params.status ?? 'ACTIVE',
    params.userId ?? null,
    params.devicePin ?? null,
    params.shiftId ?? null,
    params.checkinPinHash ?? null,
    now,
    now
  )
  return id
}

describe('HR Phase 4 (B4) — Web Check-in, Kiosk PIN Check-in & My Attendance', () => {
  const app = buildApp()

  it('computes haversine distance in metres between two coordinates', () => {
    // 0.001 degree latitude at equator/Bangkok ≈ 111.195 m
    const d = haversineMeters(13.7563, 100.5018, 13.7573, 100.5018)
    expect(d).toBeGreaterThan(110)
    expect(d).toBeLessThan(113)
    expect(haversineMeters(13.7563, 100.5018, 13.7563, 100.5018)).toBeCloseTo(0, 5)
  })

  it('location PUT by hr:write, GET by self, PUT by plain USER 403, and clear location with null', async () => {
    const admin = newAdmin()
    const authAdmin = { Authorization: `Bearer ${admin.token}` }

    const plainUser = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const authUser = { Authorization: `Bearer ${plainUser.token}` }

    // Unlinked plain user without hr:read gets 403 on GET and PUT
    const unlinkedGet = await request(app).get('/api/hr/checkin/location').set(authUser)
    expect(unlinkedGet.status).toBe(403)

    const unlinkedPut = await request(app)
      .put('/api/hr/checkin/location')
      .set(authUser)
      .send({ lat: 13.7563, lng: 100.5018, radius_m: 150 })
    expect(unlinkedPut.status).toBe(403)

    // Link plainUser to an ACTIVE employee -> becomes "self"
    insertEmployee({
      tenantId: admin.tenantId,
      code: 'EMP-001',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      userId: plainUser.userId,
    })

    // Initially null
    const get0 = await request(app).get('/api/hr/checkin/location').set(authUser)
    expect(get0.status).toBe(200)
    expect(get0.body).toEqual({ success: true, data: null })

    // Plain USER still cannot PUT
    const userPut = await request(app)
      .put('/api/hr/checkin/location')
      .set(authUser)
      .send({ lat: 13.7563, lng: 100.5018, radius_m: 150 })
    expect(userPut.status).toBe(403)

    // Admin (hr:write) sets location
    const putRes = await request(app)
      .put('/api/hr/checkin/location')
      .set(authAdmin)
      .send({ lat: 13.7563, lng: 100.5018, radius_m: 200 })
    expect(putRes.status).toBe(200)
    expect(putRes.body).toEqual({
      success: true,
      data: { lat: 13.7563, lng: 100.5018, radius_m: 200 },
    })

    // Self user can GET the configured location
    const get1 = await request(app).get('/api/hr/checkin/location').set(authUser)
    expect(get1.status).toBe(200)
    expect(get1.body).toEqual({
      success: true,
      data: { lat: 13.7563, lng: 100.5018, radius_m: 200 },
    })

    // Admin clears location with null
    const clearRes = await request(app)
      .put('/api/hr/checkin/location')
      .set(authAdmin)
      .set('Content-Type', 'application/json')
      .send('null')
    expect(clearRes.status).toBe(200)
    expect(clearRes.body).toEqual({ success: true, data: null })
  })

  it('self check-in: unlinked 404, no location -> 201 (distance_m null, W#### pin assigned), with location -> missing GPS 400, outside radius 400, inside radius 201, and 120s debounce 409', async () => {
    const admin = newAdmin()
    const authAdmin = { Authorization: `Bearer ${admin.token}` }

    const unlinkedUser = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const unlinkedRes = await request(app)
      .post('/api/hr/checkin')
      .set('Authorization', `Bearer ${unlinkedUser.token}`)
      .send({})
    expect(unlinkedRes.status).toBe(404)
    expect(unlinkedRes.body).toEqual({
      success: false,
      message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน',
    })

    // Linked user 1 (no device_pin yet) — check in when no location is configured
    const user1 = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const authUser1 = { Authorization: `Bearer ${user1.token}` }
    const emp1Id = insertEmployee({
      tenantId: admin.tenantId,
      code: 'EMP-101',
      firstName: 'กานดา',
      lastName: 'ขยันดี',
      userId: user1.userId,
      devicePin: null,
    })

    const noLocCheckin = await request(app)
      .post('/api/hr/checkin')
      .set(authUser1)
      .send({ lat: 13.7563, lng: 100.5018 })
    expect(noLocCheckin.status).toBe(201)
    expect(noLocCheckin.body.success).toBe(true)
    expect(noLocCheckin.body.data).toMatchObject({
      kind: 'IN',
      employee_name: 'กานดา ขยันดี',
      distance_m: null,
    })
    expect(noLocCheckin.body.data.punched_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)

    // Verify W#### device_pin was auto-assigned
    const emp1Row = db.prepare('SELECT device_pin FROM employees WHERE id = ?').get(emp1Id) as {
      device_pin: string
    }
    expect(emp1Row.device_pin).toMatch(/^W\d{4}$/)

    // Second punch within 120s -> 409
    const dupCheckin = await request(app)
      .post('/api/hr/checkin')
      .set(authUser1)
      .send({ lat: 13.7563, lng: 100.5018 })
    expect(dupCheckin.status).toBe(409)
    expect(dupCheckin.body.message).toMatch(/^เพิ่งบันทึกไปเมื่อ \d{2}:\d{2}$/)

    // Configure company check-in location (radius 150m)
    await request(app)
      .put('/api/hr/checkin/location')
      .set(authAdmin)
      .send({ lat: 13.7563, lng: 100.5018, radius_m: 150 })

    // Linked user 2 (no device_pin yet)
    const user2 = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const authUser2 = { Authorization: `Bearer ${user2.token}` }
    const emp2Id = insertEmployee({
      tenantId: admin.tenantId,
      code: 'EMP-102',
      firstName: 'มานะ',
      lastName: 'อดทน',
      userId: user2.userId,
      devicePin: null,
    })

    // Missing GPS when location is set -> 400
    const missingGpsRes = await request(app).post('/api/hr/checkin').set(authUser2).send({})
    expect(missingGpsRes.status).toBe(400)
    expect(missingGpsRes.body).toEqual({
      success: false,
      message: 'ต้องเปิดตำแหน่ง (GPS) เพื่อเช็คอิน',
    })

    // Outside radius (~334m away > 150m) -> 400 with distance in message
    const outsideRes = await request(app)
      .post('/api/hr/checkin')
      .set(authUser2)
      .send({ lat: 13.7593, lng: 100.5018, accuracy: 10 })
    expect(outsideRes.status).toBe(400)
    expect(outsideRes.body.message).toMatch(/^อยู่นอกพื้นที่ร้าน \(ห่าง \d+ ม\.\)$/)

    // Inside radius (~56m away <= 150m) -> 201, stores WEB, lat, lng, distance_m, and unique W#### pin
    const insideRes = await request(app)
      .post('/api/hr/checkin')
      .set(authUser2)
      .send({ lat: 13.7568, lng: 100.5018, accuracy: 15 })
    expect(insideRes.status).toBe(201)
    expect(insideRes.body.data.kind).toBe('IN')
    expect(insideRes.body.data.employee_name).toBe('มานะ อดทน')
    expect(typeof insideRes.body.data.distance_m).toBe('number')
    expect(insideRes.body.data.distance_m).toBeGreaterThanOrEqual(50)
    expect(insideRes.body.data.distance_m).toBeLessThanOrEqual(60)

    const emp2Row = db.prepare('SELECT device_pin FROM employees WHERE id = ?').get(emp2Id) as {
      device_pin: string
    }
    expect(emp2Row.device_pin).toMatch(/^W\d{4}$/)
    expect(emp2Row.device_pin).not.toBe(emp1Row.device_pin)

    const logRow = db
      .prepare('SELECT * FROM attendance_logs WHERE tenant_id = ? AND device_pin = ?')
      .get(admin.tenantId, emp2Row.device_pin) as any
    expect(logRow.source).toBe('WEB')
    expect(logRow.lat).toBeCloseTo(13.7568, 4)
    expect(logRow.lng).toBeCloseTo(100.5018, 4)
    expect(logRow.distance_m).toBe(insideRes.body.data.distance_m)
  })

  it('kiosk PIN check-in: caller without hr:read 403, wrong PIN 400, 5 wrong -> 429 lockout, correct PIN 201 (and OUT on second punch of day)', async () => {
    const admin = newAdmin()
    const authAdmin = { Authorization: `Bearer ${admin.token}` }

    const salesUser = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    db.prepare('UPDATE users SET departments = ? WHERE id = ?').run(
      JSON.stringify(['SALES']),
      salesUser.userId
    )
    const authSales = { Authorization: `Bearer ${salesUser.token}` }

    const pinHash = await bcrypt.hash('1234', 10)
    insertEmployee({
      tenantId: admin.tenantId,
      code: 'EMP-201',
      firstName: 'สมศรี',
      lastName: 'มีสุข',
      devicePin: 'P201',
      checkinPinHash: pinHash,
    })

    // Caller without hr:read gets 403
    const deniedRes = await request(app)
      .post('/api/hr/checkin/pin')
      .set(authSales)
      .send({ employee_code: 'EMP-201', pin: '1234' })
    expect(deniedRes.status).toBe(403)

    // Wrong employee_code gets 400 with same message
    const wrongEmpRes = await request(app)
      .post('/api/hr/checkin/pin')
      .set(authAdmin)
      .send({ employee_code: 'EMP-999', pin: '1234' })
    expect(wrongEmpRes.status).toBe(400)
    expect(wrongEmpRes.body).toEqual({
      success: false,
      message: 'รหัสพนักงานหรือ PIN ไม่ถูกต้อง',
    })

    // Wrong PIN 1..4 times -> 400, 5th time -> 429, and subsequent attempt while locked -> 429
    for (let i = 1; i <= 4; i++) {
      const r = await request(app)
        .post('/api/hr/checkin/pin')
        .set(authAdmin)
        .send({ employee_code: 'EMP-201', pin: '9999' })
      expect(r.status).toBe(400)
      expect(r.body.message).toBe('รหัสพนักงานหรือ PIN ไม่ถูกต้อง')
    }

    const r5 = await request(app)
      .post('/api/hr/checkin/pin')
      .set(authAdmin)
      .send({ employee_code: 'EMP-201', pin: '9999' })
    expect(r5.status).toBe(429)

    // Even with correct PIN while locked -> still 429
    const lockedRightPin = await request(app)
      .post('/api/hr/checkin/pin')
      .set(authAdmin)
      .send({ employee_code: 'EMP-201', pin: '1234' })
    expect(lockedRightPin.status).toBe(429)

    // Reset lockout and test valid PIN check-in
    resetCheckinPinLockout()

    const okIn = await request(app)
      .post('/api/hr/checkin/pin')
      .set(authAdmin)
      .send({ employee_code: 'EMP-201', pin: '1234' })
    expect(okIn.status).toBe(201)
    expect(okIn.body.data).toMatchObject({
      kind: 'IN',
      employee_name: 'สมศรี มีสุข',
      distance_m: null,
    })

    // Move first punch back by 10 minutes on the same Thai-local date so debounce passes and next punch is OUT
    const firstPunch = okIn.body.data.punched_at as string
    const tenMinEarlier = new Date(Date.parse(firstPunch.replace(' ', 'T') + 'Z') - 10 * 60_000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ')
    if (tenMinEarlier.slice(0, 10) === firstPunch.slice(0, 10)) {
      db.prepare('UPDATE attendance_logs SET punched_at = ? WHERE tenant_id = ? AND device_pin = ?').run(
        tenMinEarlier,
        admin.tenantId,
        'P201'
      )

      const okOut = await request(app)
        .post('/api/hr/checkin/pin')
        .set(authAdmin)
        .send({ employee_code: 'EMP-201', pin: '1234' })
      expect(okOut.status).toBe(201)
      expect(okOut.body.data.kind).toBe('OUT')
    }
  })

  it('GET /me/attendance returns only own logs (+ days/totals when shift set, empty days/null totals when not) and enforces tenant isolation', async () => {
    const adminA = newAdmin()
    const adminB = newAdmin()

    // Create shift in tenant A
    const shiftId = generateId()
    db.prepare(
      `INSERT INTO shifts (id, tenant_id, name, start_time, end_time, grace_minutes, break_minutes, is_active, created_at)
       VALUES (?, ?, 'กะปกติ 09-18', '09:00', '18:00', 0, 60, 1, ?)`
    ).run(shiftId, adminA.tenantId, new Date().toISOString())

    // Employee 1 in tenant A WITH shift
    const userWithShift = createTestUser({ role: 'USER', tenantId: adminA.tenantId })
    insertEmployee({
      tenantId: adminA.tenantId,
      code: 'EMP-301',
      firstName: 'วิชัย',
      lastName: 'มีกะ',
      userId: userWithShift.userId,
      devicePin: '301',
      shiftId,
    })

    // Employee 2 in tenant A WITHOUT shift
    const userNoShift = createTestUser({ role: 'USER', tenantId: adminA.tenantId })
    insertEmployee({
      tenantId: adminA.tenantId,
      code: 'EMP-302',
      firstName: 'สุดา',
      lastName: 'ไร้กะ',
      userId: userNoShift.userId,
      devicePin: '302',
      shiftId: null,
    })

    // Employee in tenant B with same pin '301'
    const userB = createTestUser({ role: 'USER', tenantId: adminB.tenantId })
    insertEmployee({
      tenantId: adminB.tenantId,
      code: 'EMP-301',
      firstName: 'คนละ',
      lastName: 'บริษัท',
      userId: userB.userId,
      devicePin: '301',
      shiftId: null,
    })

    // Insert attendance logs
    const insertLog = db.prepare(
      `INSERT INTO attendance_logs (id, tenant_id, device_pin, punched_at, source, distance_m, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    const now = new Date().toISOString()
    // Pin 301 in Tenant A: worked 2026-03-02 (09:10 in, 18:05 out), absent 2026-03-03
    insertLog.run(generateId(), adminA.tenantId, '301', '2026-03-02 09:10:00', 'WEB', 25, now)
    insertLog.run(generateId(), adminA.tenantId, '301', '2026-03-02 18:05:00', 'WEB', 30, now)
    // Pin 302 in Tenant A
    insertLog.run(generateId(), adminA.tenantId, '302', '2026-03-02 08:50:00', 'FILE', null, now)
    // Pin 301 in Tenant B
    insertLog.run(generateId(), adminB.tenantId, '301', '2026-03-02 07:00:00', 'DEVICE', null, now)

    // 1. userWithShift gets own logs (newest first), days (2 days), and totals
    const resWithShift = await request(app)
      .get('/api/hr/me/attendance?from=2026-03-02&to=2026-03-03')
      .set('Authorization', `Bearer ${userWithShift.token}`)
    expect(resWithShift.status).toBe(200)
    expect(resWithShift.body.data.employee).toEqual({
      id: expect.any(String),
      code: 'EMP-301',
      name: 'วิชัย มีกะ',
      device_pin: '301',
      shift_name: 'กะปกติ 09-18',
    })
    expect(resWithShift.body.data.logs).toEqual([
      { punched_at: '2026-03-02 18:05:00', source: 'WEB', distance_m: 30 },
      { punched_at: '2026-03-02 09:10:00', source: 'WEB', distance_m: 25 },
    ])
    expect(resWithShift.body.data.days).toHaveLength(2)
    expect(resWithShift.body.data.totals).toMatchObject({
      daysWorked: 1,
      absentDays: 1,
      lateMinutes: 10,
      earlyLeaveMinutes: 0,
      otCandidateMinutes: 0,
    })

    // 2. userNoShift gets own logs, empty days [], and null totals
    const resNoShift = await request(app)
      .get('/api/hr/me/attendance?from=2026-03-02&to=2026-03-03')
      .set('Authorization', `Bearer ${userNoShift.token}`)
    expect(resNoShift.status).toBe(200)
    expect(resNoShift.body.data.employee.shift_name).toBeNull()
    expect(resNoShift.body.data.logs).toEqual([
      { punched_at: '2026-03-02 08:50:00', source: 'FILE', distance_m: null },
    ])
    expect(resNoShift.body.data.days).toEqual([])
    expect(resNoShift.body.data.totals).toBeNull()

    // 3. Tenant B user sees only Tenant B's log, not Tenant A's logs or location
    await request(app)
      .put('/api/hr/checkin/location')
      .set('Authorization', `Bearer ${adminA.token}`)
      .send({ lat: 13.7563, lng: 100.5018, radius_m: 150 })

    const locB = await request(app)
      .get('/api/hr/checkin/location')
      .set('Authorization', `Bearer ${userB.token}`)
    expect(locB.status).toBe(200)
    expect(locB.body.data).toBeNull()

    const resB = await request(app)
      .get('/api/hr/me/attendance?from=2026-03-02&to=2026-03-03')
      .set('Authorization', `Bearer ${userB.token}`)
    expect(resB.status).toBe(200)
    expect(resB.body.data.logs).toEqual([
      { punched_at: '2026-03-02 07:00:00', source: 'DEVICE', distance_m: null },
    ])
  })
})
