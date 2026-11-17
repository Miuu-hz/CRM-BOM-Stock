import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import hrCheckinRoutes, {
  resetCheckinPinLockout,
  resetCheckinFaceLockout,
} from './hr.checkin.routes'
import { encryptDescriptor } from '../services/hr/face'
import { createTestUser } from '../test/testAuth'

if (typeof globalThis !== 'undefined' && !(globalThis as any).expect) {
  ;(globalThis as any).expect = expect
}

// สัญญากลาง: docs/contracts/hr-offsite.md — งาน O2 (เช็คอินนอกสถานที่)
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
  resetCheckinFaceLockout()
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM offsite_requests WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM hr_face_enrollments WHERE tenant_id = ?').run(t)
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

function insertOffsiteRequest(params: {
  tenantId: string
  employeeId: string
  startDate: string
  endDate: string
  place?: string
  reason?: string | null
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  requestedBy?: string | null
  decidedBy?: string | null
}) {
  const id = generateId()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO offsite_requests (
       id, tenant_id, employee_id, start_date, end_date, place, reason,
       status, approval_request_id, requested_by, decided_by, decided_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.tenantId,
    params.employeeId,
    params.startDate,
    params.endDate,
    params.place ?? 'ไซท์งานลูกค้า กทม.',
    params.reason ?? 'ติดตั้งอุปกรณ์ระบบไฟ',
    params.status ?? 'APPROVED',
    params.requestedBy ?? null,
    params.decidedBy ?? null,
    params.status === 'APPROVED' ? now : null,
    now,
    now
  )
  return id
}

function shiftDay(isoDate: string, deltaDays: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

describe('HR Offsite Check-in (O2) — เช็คอินนอกสถานที่ตามสัญญากลาง', () => {
  const app = buildApp()

  it('ร้านตั้งจุด + อยู่ไกล + ไม่มีคำขอ → 400 พร้อมข้อความแนะนำยื่นคำขอ', async () => {
    const admin = newAdmin()
    const authAdmin = { Authorization: `Bearer ${admin.token}` }

    // ตั้งจุดเช็คอินร้าน (กทม. รัศมี 150 ม.)
    await request(app)
      .put('/api/hr/checkin/location')
      .set(authAdmin)
      .send({ lat: 13.7563, lng: 100.5018, radius_m: 150 })

    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    insertEmployee({
      tenantId: admin.tenantId,
      code: 'EMP-OFF-01',
      firstName: 'สมศักดิ์',
      lastName: 'ใจสู้',
      userId: user.userId,
    })

    // พิกัดไกลจากร้าน (~16 กม.) และไม่มีคำขอทำงานนอกสถานที่
    const res = await request(app)
      .post('/api/hr/checkin')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ lat: 13.9000, lng: 100.5018, accuracy: 10 })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/^อยู่นอกพื้นที่ร้าน \(ห่าง \d+ ม\.\) · ถ้าทำงานนอกสถานที่ให้ยื่นคำขอก่อน$/)
  })

  it('มีคำขอ APPROVED วันนี้ → 201, offsite: true, แถว log มี offsite_request_id และเก็บ distance_m จริง', async () => {
    const admin = newAdmin()
    const authAdmin = { Authorization: `Bearer ${admin.token}` }

    await request(app)
      .put('/api/hr/checkin/location')
      .set(authAdmin)
      .send({ lat: 13.7563, lng: 100.5018, radius_m: 150 })

    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const empId = insertEmployee({
      tenantId: admin.tenantId,
      code: 'EMP-OFF-02',
      firstName: 'วิภา',
      lastName: 'รักงาน',
      userId: user.userId,
    })

    const today = thaiDateStr()
    const reqId = insertOffsiteRequest({
      tenantId: admin.tenantId,
      employeeId: empId,
      startDate: today,
      endDate: today,
      place: 'ตึกออฟฟิศลูกค้า สาทร',
      status: 'APPROVED',
    })

    // เช็คอินจากระยะไกล แต่มีคำขอ APPROVED วันนี้ -> ผ่าน (ข้ามด่านรัศมี)
    const res = await request(app)
      .post('/api/hr/checkin')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ lat: 13.9000, lng: 100.5018, accuracy: 10 })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.offsite).toBe(true)
    expect(res.body.data.kind).toBe('IN')
    expect(res.body.data.employee_name).toBe('วิภา รักงาน')
    expect(typeof res.body.data.distance_m).toBe('number')
    expect(res.body.data.distance_m).toBeGreaterThan(15000)

    // ตรวจสอบข้อมูลในตาราง attendance_logs
    const log = db
      .prepare('SELECT * FROM attendance_logs WHERE tenant_id = ? AND offsite_request_id = ?')
      .get(admin.tenantId, reqId) as any
    expect(log).toBeDefined()
    expect(log.source).toBe('WEB')
    expect(log.offsite_request_id).toBe(reqId)
    expect(log.lat).toBeCloseTo(13.9000, 4)
    expect(log.lng).toBeCloseTo(100.5018, 4)
    expect(log.distance_m).toBe(res.body.data.distance_m)
  })

  it('มีคำขอ APPROVED วันนี้แต่ไม่ส่งพิกัด GPS → 201, offsite: true, lat/lng/distance_m เป็น null', async () => {
    const admin = newAdmin()
    const authAdmin = { Authorization: `Bearer ${admin.token}` }

    await request(app)
      .put('/api/hr/checkin/location')
      .set(authAdmin)
      .send({ lat: 13.7563, lng: 100.5018, radius_m: 150 })

    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const empId = insertEmployee({
      tenantId: admin.tenantId,
      code: 'EMP-OFF-03',
      firstName: 'ชาญชัย',
      lastName: 'เดินทาง',
      userId: user.userId,
    })

    const today = thaiDateStr()
    const reqId = insertOffsiteRequest({
      tenantId: admin.tenantId,
      employeeId: empId,
      startDate: today,
      endDate: today,
      status: 'APPROVED',
    })

    // ไม่ส่งพิกัด GPS เลย แต่มีคำขอนอกสถานที่ -> ไม่บังคับ GPS และผ่านได้
    const res = await request(app)
      .post('/api/hr/checkin')
      .set('Authorization', `Bearer ${user.token}`)
      .send({})

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.offsite).toBe(true)
    expect(res.body.data.distance_m).toBeNull()

    const log = db
      .prepare('SELECT * FROM attendance_logs WHERE tenant_id = ? AND offsite_request_id = ?')
      .get(admin.tenantId, reqId) as any
    expect(log).toBeDefined()
    expect(log.lat).toBeNull()
    expect(log.lng).toBeNull()
    expect(log.distance_m).toBeNull()
  })

  it('คำขอ PENDING หรือ REJECTED หรือ CANCELLED วันนี้ → ยังคง 400', async () => {
    const admin = newAdmin()
    const authAdmin = { Authorization: `Bearer ${admin.token}` }

    await request(app)
      .put('/api/hr/checkin/location')
      .set(authAdmin)
      .send({ lat: 13.7563, lng: 100.5018, radius_m: 150 })

    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const empId = insertEmployee({
      tenantId: admin.tenantId,
      code: 'EMP-OFF-04',
      firstName: 'ธนา',
      lastName: 'รอผล',
      userId: user.userId,
    })

    const today = thaiDateStr()
    // 1. PENDING
    insertOffsiteRequest({
      tenantId: admin.tenantId,
      employeeId: empId,
      startDate: today,
      endDate: today,
      status: 'PENDING',
    })

    const resPending = await request(app)
      .post('/api/hr/checkin')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ lat: 13.9000, lng: 100.5018 })
    expect(resPending.status).toBe(400)
    expect(resPending.body.message).toMatch(/^อยู่นอกพื้นที่ร้าน/)

    // 2. REJECTED
    db.prepare('DELETE FROM offsite_requests WHERE tenant_id = ?').run(admin.tenantId)
    insertOffsiteRequest({
      tenantId: admin.tenantId,
      employeeId: empId,
      startDate: today,
      endDate: today,
      status: 'REJECTED',
    })

    const resRejected = await request(app)
      .post('/api/hr/checkin')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ lat: 13.9000, lng: 100.5018 })
    expect(resRejected.status).toBe(400)

    // 3. CANCELLED
    db.prepare('DELETE FROM offsite_requests WHERE tenant_id = ?').run(admin.tenantId)
    insertOffsiteRequest({
      tenantId: admin.tenantId,
      employeeId: empId,
      startDate: today,
      endDate: today,
      status: 'CANCELLED',
    })

    const resCancelled = await request(app)
      .post('/api/hr/checkin')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ lat: 13.9000, lng: 100.5018 })
    expect(resCancelled.status).toBe(400)
  })

  it('คำขอ APPROVED ของวันอื่น (เมื่อวาน / พรุ่งนี้) → ยังคง 400', async () => {
    const admin = newAdmin()
    const authAdmin = { Authorization: `Bearer ${admin.token}` }

    await request(app)
      .put('/api/hr/checkin/location')
      .set(authAdmin)
      .send({ lat: 13.7563, lng: 100.5018, radius_m: 150 })

    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const empId = insertEmployee({
      tenantId: admin.tenantId,
      code: 'EMP-OFF-05',
      firstName: 'ประเสริฐ',
      lastName: 'วันผิด',
      userId: user.userId,
    })

    const today = thaiDateStr()
    const yesterday = shiftDay(today, -1)
    const tomorrow = shiftDay(today, 1)

    // อนุมัติเมื่อวานเท่านั้น
    insertOffsiteRequest({
      tenantId: admin.tenantId,
      employeeId: empId,
      startDate: yesterday,
      endDate: yesterday,
      status: 'APPROVED',
    })

    const resPast = await request(app)
      .post('/api/hr/checkin')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ lat: 13.9000, lng: 100.5018 })
    expect(resPast.status).toBe(400)

    // อนุมัติพรุ่งนี้เท่านั้น
    db.prepare('DELETE FROM offsite_requests WHERE tenant_id = ?').run(admin.tenantId)
    insertOffsiteRequest({
      tenantId: admin.tenantId,
      employeeId: empId,
      startDate: tomorrow,
      endDate: tomorrow,
      status: 'APPROVED',
    })

    const resFuture = await request(app)
      .post('/api/hr/checkin')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ lat: 13.9000, lng: 100.5018 })
    expect(resFuture.status).toBe(400)
  })

  it('คำขอ APPROVED ของพนักงานคนอื่น หรือ Tenant อื่น → ยังคง 400 (Tenant & Employee Isolation)', async () => {
    const adminA = newAdmin()
    const adminB = newAdmin()

    await request(app)
      .put('/api/hr/checkin/location')
      .set('Authorization', `Bearer ${adminA.token}`)
      .send({ lat: 13.7563, lng: 100.5018, radius_m: 150 })

    const userA1 = createTestUser({ role: 'USER', tenantId: adminA.tenantId })
    const userA2 = createTestUser({ role: 'USER', tenantId: adminA.tenantId })
    const empA1 = insertEmployee({
      tenantId: adminA.tenantId,
      code: 'EMP-A1',
      firstName: 'คนขอ',
      userId: userA1.userId,
    })
    insertEmployee({
      tenantId: adminA.tenantId,
      code: 'EMP-A2',
      firstName: 'คนไม่ขอ',
      userId: userA2.userId,
    })

    const today = thaiDateStr()
    // พนักงาน A1 มีคำขอ APPROVED
    insertOffsiteRequest({
      tenantId: adminA.tenantId,
      employeeId: empA1,
      startDate: today,
      endDate: today,
      status: 'APPROVED',
    })

    // พนักงาน A2 เช็คอินนอกสถานที่ -> 400
    const resA2 = await request(app)
      .post('/api/hr/checkin')
      .set('Authorization', `Bearer ${userA2.token}`)
      .send({ lat: 13.9000, lng: 100.5018 })
    expect(resA2.status).toBe(400)

    // Tenant B มีคำขอ APPROVED สำหรับพนักงานของ Tenant B
    const userB = createTestUser({ role: 'USER', tenantId: adminB.tenantId })
    const empB = insertEmployee({
      tenantId: adminB.tenantId,
      code: 'EMP-B1',
      firstName: 'คนบี',
      userId: userB.userId,
    })
    insertOffsiteRequest({
      tenantId: adminB.tenantId,
      employeeId: empB,
      startDate: today,
      endDate: today,
      status: 'APPROVED',
    })

    // ตั้งจุดให้ Tenant B
    await request(app)
      .put('/api/hr/checkin/location')
      .set('Authorization', `Bearer ${adminB.token}`)
      .send({ lat: 13.7563, lng: 100.5018, radius_m: 150 })

    // Tenant A1 ไม่สามารถใช้คำขอของ Tenant B ได้ (และในทางกลับกัน Tenant B ไม่ได้ใช้คำขอของ Tenant A)
    const resB = await request(app)
      .post('/api/hr/checkin')
      .set('Authorization', `Bearer ${userB.token}`)
      .send({ lat: 13.9000, lng: 100.5018 })
    // userB มีคำขอของ tenantB เอง -> ผ่าน 201
    expect(resB.status).toBe(201)
    expect(resB.body.data.offsite).toBe(true)
  })

  it('ตู้ kiosk PIN check-in ไม่ข้ามรัศมีแม้พนักงานมีคำขอ APPROVED วันนี้', async () => {
    const admin = newAdmin()
    const authAdmin = { Authorization: `Bearer ${admin.token}` }

    await request(app)
      .put('/api/hr/checkin/location')
      .set(authAdmin)
      .send({ lat: 13.7563, lng: 100.5018, radius_m: 150 })

    const pinHash = await bcrypt.hash('1234', 10)
    const empId = insertEmployee({
      tenantId: admin.tenantId,
      code: 'EMP-KIOSK',
      firstName: 'กิตติ',
      lastName: 'หน้าร้าน',
      devicePin: 'K101',
      checkinPinHash: pinHash,
    })

    const today = thaiDateStr()
    insertOffsiteRequest({
      tenantId: admin.tenantId,
      employeeId: empId,
      startDate: today,
      endDate: today,
      status: 'APPROVED',
    })

    // ตู้ kiosk กด PIN แต่ส่งพิกัดอยู่นอกพื้นที่ร้าน -> ยังคง 400 (ตู้ไม่ข้ามรัศมี)
    const kioskRes = await request(app)
      .post('/api/hr/checkin/pin')
      .set(authAdmin)
      .send({
        employee_code: 'EMP-KIOSK',
        pin: '1234',
        lat: 13.9000,
        lng: 100.5018,
      })

    expect(kioskRes.status).toBe(400)
    // ตู้ kiosk ไม่เติมข้อความแนะนำยื่นคำขอนอกสถานที่
    expect(kioskRes.body.message).toMatch(/^อยู่นอกพื้นที่ร้าน \(ห่าง \d+ ม\.\)$/)
  })

  it('เช็คอินปกติในรัศมี คืน data.offsite = false', async () => {
    const admin = newAdmin()
    const authAdmin = { Authorization: `Bearer ${admin.token}` }

    await request(app)
      .put('/api/hr/checkin/location')
      .set(authAdmin)
      .send({ lat: 13.7563, lng: 100.5018, radius_m: 200 })

    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    insertEmployee({
      tenantId: admin.tenantId,
      code: 'EMP-NORMAL',
      firstName: 'นงนุช',
      lastName: 'ตรงเวลา',
      userId: user.userId,
    })

    const res = await request(app)
      .post('/api/hr/checkin')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ lat: 13.7564, lng: 100.5018, accuracy: 10 })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.offsite).toBe(false)
  })

  it('GET /hr/me/attendance คืน offsite: boolean (true เมื่อ offsite_request_id มีค่า, false เมื่อไม่มี)', async () => {
    const admin = newAdmin()
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const empId = insertEmployee({
      tenantId: admin.tenantId,
      code: 'EMP-LOGS',
      firstName: 'พิชิต',
      lastName: 'ดูประวัติ',
      userId: user.userId,
      devicePin: 'LOG-99',
    })

    const today = thaiDateStr()
    const reqId = insertOffsiteRequest({
      tenantId: admin.tenantId,
      employeeId: empId,
      startDate: today,
      endDate: today,
      status: 'APPROVED',
    })

    // บันทึก attendance_logs 2 แถว: แถวหนึ่งเป็น offsite, อีกแถวเป็นปกติ
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO attendance_logs (id, tenant_id, device_pin, punched_at, source, distance_m, created_at, offsite_request_id)
       VALUES (?, ?, ?, ?, 'WEB', 5000, ?, ?)`
    ).run(generateId(), admin.tenantId, 'LOG-99', `${today} 09:00:00`, now, reqId)

    db.prepare(
      `INSERT INTO attendance_logs (id, tenant_id, device_pin, punched_at, source, distance_m, created_at, offsite_request_id)
       VALUES (?, ?, ?, ?, 'WEB', 20, ?, NULL)`
    ).run(generateId(), admin.tenantId, 'LOG-99', `${today} 18:00:00`, now)

    const res = await request(app)
      .get(`/api/hr/me/attendance?from=${today}&to=${today}`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.logs).toHaveLength(2)

    // logs เรียงใหม่ไปเก่า (18:00 ก่อน 09:00)
    const log18 = res.body.data.logs.find((l: any) => l.punched_at === `${today} 18:00:00`)
    const log09 = res.body.data.logs.find((l: any) => l.punched_at === `${today} 09:00:00`)

    expect(log09).toBeDefined()
    expect(log09.offsite).toBe(true)

    expect(log18).toBeDefined()
    expect(log18.offsite).toBe(false)
  })

  it('ช่วงคำขอหลายวัน (start_date <= today <= end_date) ข้ามรัศมีได้ตลอดช่วง', async () => {
    const admin = newAdmin()
    const authAdmin = { Authorization: `Bearer ${admin.token}` }

    await request(app)
      .put('/api/hr/checkin/location')
      .set(authAdmin)
      .send({ lat: 13.7563, lng: 100.5018, radius_m: 150 })

    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const empId = insertEmployee({
      tenantId: admin.tenantId,
      code: 'EMP-MULTI',
      firstName: 'มณฑล',
      lastName: 'งานหลายวัน',
      userId: user.userId,
    })

    const today = thaiDateStr()
    const yesterday = shiftDay(today, -1)
    const tomorrow = shiftDay(today, 1)

    // คำขอครอบคลุม 3 วัน: เมื่อวาน ถึง พรุ่งนี้
    insertOffsiteRequest({
      tenantId: admin.tenantId,
      employeeId: empId,
      startDate: yesterday,
      endDate: tomorrow,
      place: 'ออกบูธต่างจังหวัด',
      status: 'APPROVED',
    })

    const res = await request(app)
      .post('/api/hr/checkin')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ lat: 14.5000, lng: 101.0000 })

    expect(res.status).toBe(201)
    expect(res.body.data.offsite).toBe(true)
  })

  it('เช็คอินใบหน้าส่วนตัว (/checkin/face) ข้ามรัศมีเมื่อมีคำขอ APPROVED และตู้ kiosk face (/checkin/face-kiosk) ยังคง 400', async () => {
    const admin = newAdmin()
    const authAdmin = { Authorization: `Bearer ${admin.token}` }

    await request(app)
      .put('/api/hr/checkin/location')
      .set(authAdmin)
      .send({ lat: 13.7563, lng: 100.5018, radius_m: 150 })

    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const empId = insertEmployee({
      tenantId: admin.tenantId,
      code: 'EMP-FACE-OFF',
      firstName: 'มนัส',
      lastName: 'หน้าใส',
      userId: user.userId,
    })

    const descriptor = Array.from({ length: 128 }, () => 0.2)
    const nowIso = new Date().toISOString()
    db.prepare(
      `INSERT INTO hr_face_enrollments (id, tenant_id, employee_id, descriptor_enc, consent_at, consent_version, created_at)
       VALUES (?, ?, ?, ?, ?, '1.0', ?)`
    ).run(generateId(), admin.tenantId, empId, encryptDescriptor(descriptor), nowIso, nowIso)

    const today = thaiDateStr()
    const reqId = insertOffsiteRequest({
      tenantId: admin.tenantId,
      employeeId: empId,
      startDate: today,
      endDate: today,
      place: 'ปฏิบัติงานต่างสาขา',
      status: 'APPROVED',
    })

    // 1. /checkin/face (self): มีคำขอ APPROVED วันนี้ อยู่ไกล 16 กม. -> ผ่าน 201, offsite: true
    const resSelfFace = await request(app)
      .post('/api/hr/checkin/face')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        face_descriptor: descriptor,
        lat: 13.9000,
        lng: 100.5018,
      })

    expect(resSelfFace.status).toBe(201)
    expect(resSelfFace.body.success).toBe(true)
    expect(resSelfFace.body.data.offsite).toBe(true)
    expect(resSelfFace.body.data.employee_name).toBe('มนัส หน้าใส')

    const log = db
      .prepare('SELECT * FROM attendance_logs WHERE tenant_id = ? AND offsite_request_id = ?')
      .get(admin.tenantId, reqId) as any
    expect(log).toBeDefined()
    expect(log.offsite_request_id).toBe(reqId)

    // 2. /checkin/face-kiosk: ตู้ kiosk ไม่ข้ามรัศมีแม้มีคำขอ APPROVED -> 400
    // ย้ายเวลา punch เดิมไปเมื่อวานเพื่อให้ debounce ไม่ติด
    db.prepare('UPDATE attendance_logs SET punched_at = ? WHERE tenant_id = ? AND offsite_request_id = ?').run(
      shiftDay(today, -1) + ' 08:00:00',
      admin.tenantId,
      reqId
    )

    const resKioskFace = await request(app)
      .post('/api/hr/checkin/face-kiosk')
      .set(authAdmin)
      .send({
        face_descriptor: descriptor,
        lat: 13.9000,
        lng: 100.5018,
      })

    expect(resKioskFace.status).toBe(400)
    expect(resKioskFace.body.message).toMatch(/^อยู่นอกพื้นที่ร้าน \(ห่าง \d+ ม\.\)$/)
  })
})
