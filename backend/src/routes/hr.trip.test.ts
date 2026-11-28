import { describe, it, expect, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import authRoutes from './auth.routes'
import hrTripRoutes from './hr.trip.routes'
import {
  closeExpiredTrips,
  getTripConsentStatus,
  acceptTripConsent,
  getActiveVehicles,
  getOpenCarTrip,
  startCarTrip,
  addCarTripStop,
  endCarTrip,
  getMyRecentTrips,
} from '../services/hr/carTrip.service'
import {
  TRIP_CONSENT_VERSION,
  TRIP_CONSENT_NOTICE_TEXT,
  TRIP_MAX_OPEN_MS,
  validateCoords,
  validateOdometer,
  computeTripFlags,
} from '../services/hr/carTripFlags'
import {
  buildOsrmRouteUrl,
  computeRoadRoute,
} from '../services/hr/roadRoute.service'
import { createTestUser } from '../test/testAuth'

function buildApp() {
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.use('/api/auth', authRoutes)
  app.use('/api/hr', authenticate, subscriptionGate('hr'), hrTripRoutes)
  return app
}

const tenants: string[] = []
const origOsrmUrl = process.env.OSRM_URL
const origTimeoutMs = process.env.ROUTE_TIMEOUT_MS

afterEach(() => {
  vi.restoreAllMocks()
  if (origOsrmUrl === undefined) delete process.env.OSRM_URL
  else process.env.OSRM_URL = origOsrmUrl
  if (origTimeoutMs === undefined) delete process.env.ROUTE_TIMEOUT_MS
  else process.env.ROUTE_TIMEOUT_MS = origTimeoutMs

  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM hr_car_trip_stops WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM hr_car_trips WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM hr_trip_consents WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM hr_vehicles WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM line_login_tokens WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM line_user_mappings WHERE tenant_id = ?').run(t)
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

function createUserWithPerms(params: {
  tenantId: string
  role?: 'ADMIN' | 'USER'
  customPermissions?: Record<string, boolean>
}) {
  const userId = generateId()
  const email = `user-${userId}@example.com`
  const role = params.role ?? 'USER'
  db.prepare(
    `INSERT INTO users (id, email, password, name, role, tenant_id, status, custom_permissions)
     VALUES (?, ?, 'x', 'Test User', ?, ?, 'active', ?)`
  ).run(
    userId,
    email,
    role,
    params.tenantId,
    params.customPermissions ? JSON.stringify(params.customPermissions) : null
  )
  const token = jwt.sign(
    { userId, email, role, tenantId: params.tenantId },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' }
  )
  return { userId, email, role, tenantId: params.tenantId, token }
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
     ) VALUES (?, ?, ?, ?, ?, 'MONTHLY', 18000, '2026-01-01', ?, ?, ?, ?)`
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

function insertVehicle(
  tenantId: string,
  plateNo: string,
  label: string | null = null,
  isActive = 1
) {
  const id = generateId()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO hr_vehicles (id, tenant_id, plate_no, label, is_active, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
  ).run(id, tenantId, plateNo, label, isActive, now, now)
  return id
}

describe('carTripFlags unit checks', () => {
  it('validates coordinates and odometer strictly', () => {
    expect(validateCoords({ lat: 95, lng: 100.5 }).ok).toBe(false)
    expect(validateCoords({ lat: 13.7, lng: -200 }).ok).toBe(false)
    expect(validateCoords({ lat: 0, lng: 0 }).ok).toBe(false)
    expect(validateCoords({ lat: 'abc', lng: 100.5 }).ok).toBe(false)
    expect(validateCoords({ lat: true as any, lng: 100.5 }).ok).toBe(false)
    expect(validateCoords({ lat: 13.75, lng: 100.5, accuracy_m: -5 }).ok).toBe(false)
    expect(validateCoords({ lat: 13.75, lng: 100.5, accuracy_m: 20 })).toEqual({
      ok: true,
      lat: 13.75,
      lng: 100.5,
      accuracy_m: 20,
    })

    expect(validateOdometer(-1).ok).toBe(false)
    expect(validateOdometer('abc').ok).toBe(false)
    expect(validateOdometer(true as any).ok).toBe(false)
    expect(validateOdometer(10_000_000).ok).toBe(false)
    expect(validateOdometer(12345.6)).toEqual({ ok: true, value: 12345.6 })
  })

  it('computes all 4 anomaly flags at exact boundary thresholds (null accuracy does not raise POOR_GPS)', () => {
    // ODOMETER_MISMATCH boundaries
    expect(
      computeTripFlags({
        carType: 'PRIVATE',
        startOdometer: 100,
        prevVehicleEndOdometer: null,
        odometerKm: 12,
        mapDistanceKm: 10,
        durationSec: 600,
        mapDurationSec: 600,
        accuracies: [20, 20],
      })
    ).toEqual([])

    expect(
      computeTripFlags({
        carType: 'PRIVATE',
        startOdometer: 100,
        prevVehicleEndOdometer: null,
        odometerKm: 12.1,
        mapDistanceKm: 10,
        durationSec: 600,
        mapDurationSec: 600,
        accuracies: [20, 20],
      })
    ).toEqual(['ODOMETER_MISMATCH'])

    expect(
      computeTripFlags({
        carType: 'PRIVATE',
        startOdometer: 100,
        prevVehicleEndOdometer: null,
        odometerKm: 7.9,
        mapDistanceKm: 10,
        durationSec: 600,
        mapDurationSec: 600,
        accuracies: [20, 20],
      })
    ).toEqual(['ODOMETER_MISMATCH'])

    // DURATION_EXCESSIVE boundaries
    expect(
      computeTripFlags({
        carType: 'PRIVATE',
        startOdometer: 100,
        prevVehicleEndOdometer: null,
        odometerKm: 10,
        mapDistanceKm: 10,
        durationSec: 3600,
        mapDurationSec: 1800,
        accuracies: [15],
      })
    ).toEqual([])

    expect(
      computeTripFlags({
        carType: 'PRIVATE',
        startOdometer: 100,
        prevVehicleEndOdometer: null,
        odometerKm: 10,
        mapDistanceKm: 10,
        durationSec: 3660,
        mapDurationSec: 1800,
        accuracies: [15],
      })
    ).toEqual(['DURATION_EXCESSIVE'])

    expect(
      computeTripFlags({
        carType: 'PRIVATE',
        startOdometer: 100,
        prevVehicleEndOdometer: null,
        odometerKm: 10,
        mapDistanceKm: 10,
        durationSec: 1200,
        mapDurationSec: 300,
        accuracies: [15],
      })
    ).toEqual([])

    // ODOMETER_ROLLBACK boundaries
    expect(
      computeTripFlags({
        carType: 'COMPANY',
        startOdometer: 999,
        prevVehicleEndOdometer: 1000,
        odometerKm: null,
        mapDistanceKm: null,
        durationSec: null,
        mapDurationSec: null,
        accuracies: [10],
      })
    ).toEqual(['ODOMETER_ROLLBACK'])

    expect(
      computeTripFlags({
        carType: 'COMPANY',
        startOdometer: 1000,
        prevVehicleEndOdometer: 1000,
        odometerKm: null,
        mapDistanceKm: null,
        durationSec: null,
        mapDurationSec: null,
        accuracies: [10],
      })
    ).toEqual([])

    expect(
      computeTripFlags({
        carType: 'PRIVATE',
        startOdometer: 500,
        prevVehicleEndOdometer: 1000,
        odometerKm: null,
        mapDistanceKm: null,
        durationSec: null,
        mapDurationSec: null,
        accuracies: [10],
      })
    ).toEqual([])

    // POOR_GPS boundaries: only finite accuracy > 150 raises POOR_GPS; null does not
    expect(
      computeTripFlags({
        carType: 'PRIVATE',
        startOdometer: 100,
        prevVehicleEndOdometer: null,
        odometerKm: null,
        mapDistanceKm: null,
        durationSec: null,
        mapDurationSec: null,
        accuracies: [150, 50],
      })
    ).toEqual([])

    expect(
      computeTripFlags({
        carType: 'PRIVATE',
        startOdometer: 100,
        prevVehicleEndOdometer: null,
        odometerKm: null,
        mapDistanceKm: null,
        durationSec: null,
        mapDurationSec: null,
        accuracies: [20, 151],
      })
    ).toEqual(['POOR_GPS'])

    expect(
      computeTripFlags({
        carType: 'PRIVATE',
        startOdometer: 100,
        prevVehicleEndOdometer: null,
        odometerKm: null,
        mapDistanceKm: null,
        durationSec: null,
        mapDurationSec: null,
        accuracies: [20, null],
      })
    ).toEqual([])
  })
})

describe('roadRoute.service unit checks', () => {
  it('buildOsrmRouteUrl builds lng,lat order with ordered stops and normalizes trailing slashes', () => {
    const url = buildOsrmRouteUrl(
      'https://osrm.test/',
      { lat: 13.71, lng: 100.51 },
      { lat: 13.79, lng: 100.59 },
      [
        { lat: 13.72, lng: 100.52 },
        { lat: 13.73, lng: 100.53 },
      ]
    )
    expect(url).toBe(
      'https://osrm.test/route/v1/driving/100.51,13.71;100.52,13.72;100.53,13.73;100.59,13.79?overview=false'
    )
  })

  it('computeRoadRoute sends GET with User-Agent phopy-erp-trips and parses OK response', async () => {
    process.env.OSRM_URL = 'https://osrm.test'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'Ok', routes: [{ distance: 25400, duration: 1500.4 }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    const res = await computeRoadRoute(
      { lat: 13.71, lng: 100.51 },
      { lat: 13.79, lng: 100.59 },
      []
    )
    expect(res).toEqual({
      status: 'OK',
      distanceMeters: 25400,
      distanceKm: 25.4,
      durationSec: 1500,
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [reqUrl, reqInit] = fetchSpy.mock.calls[0]
    expect(reqUrl).toBe(
      'https://osrm.test/route/v1/driving/100.51,13.71;100.59,13.79?overview=false'
    )
    expect(reqInit?.method).toBe('GET')
    expect((reqInit?.headers as Record<string, string>)['User-Agent']).toBe(
      'phopy-erp-trips'
    )
  })

  it('computeRoadRoute returns ROUTING_DISABLED with 0 fetch calls when OSRM_URL=off or OFF', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    for (const offVal of ['off', 'OFF']) {
      process.env.OSRM_URL = offVal
      const res = await computeRoadRoute(
        { lat: 13.71, lng: 100.51 },
        { lat: 13.79, lng: 100.59 },
        []
      )
      expect(res).toEqual({ status: 'UNAVAILABLE', errorCode: 'ROUTING_DISABLED' })
    }
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('computeRoadRoute maps NoRoute, HTTP_429/500, TIMEOUT, INVALID_JSON, empty routes, and NETWORK_ERROR without leaking coords/messages', async () => {
    process.env.OSRM_URL = 'https://osrm.test'
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    // NoRoute with coords in message -> message/coords not leaked
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'NoRoute',
          message: 'Impossible route between 13.7,100.5',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const noRouteRes = await computeRoadRoute(
      { lat: 13.7, lng: 100.5 },
      { lat: 13.8, lng: 100.6 },
      []
    )
    expect(noRouteRes).toEqual({ status: 'FAILED', errorCode: 'NoRoute' })
    expect(JSON.stringify(noRouteRes)).not.toContain('Impossible')
    expect(JSON.stringify(noRouteRes)).not.toContain('13.7')

    // HTTP 429 & HTTP 500
    fetchSpy.mockResolvedValueOnce(new Response('too many', { status: 429 }))
    expect(
      await computeRoadRoute({ lat: 13.7, lng: 100.5 }, { lat: 13.8, lng: 100.6 }, [])
    ).toEqual({ status: 'FAILED', errorCode: 'HTTP_429' })

    fetchSpy.mockResolvedValueOnce(new Response('err', { status: 500 }))
    expect(
      await computeRoadRoute({ lat: 13.7, lng: 100.5 }, { lat: 13.8, lng: 100.6 }, [])
    ).toEqual({ status: 'FAILED', errorCode: 'HTTP_500' })

    // Invalid JSON
    fetchSpy.mockResolvedValueOnce(new Response('not-json{', { status: 200 }))
    expect(
      await computeRoadRoute({ lat: 13.7, lng: 100.5 }, { lat: 13.8, lng: 100.6 }, [])
    ).toEqual({ status: 'FAILED', errorCode: 'INVALID_JSON' })

    // Empty routes
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'Ok', routes: [] }), { status: 200 })
    )
    expect(
      await computeRoadRoute({ lat: 13.7, lng: 100.5 }, { lat: 13.8, lng: 100.6 }, [])
    ).toEqual({ status: 'FAILED', errorCode: 'NO_ROUTE' })

    // Network error
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    expect(
      await computeRoadRoute({ lat: 13.7, lng: 100.5 }, { lat: 13.8, lng: 100.6 }, [])
    ).toEqual({ status: 'FAILED', errorCode: 'NETWORK_ERROR' })

    // Timeout
    process.env.ROUTE_TIMEOUT_MS = '30'
    fetchSpy.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('Aborted')
            err.name = 'AbortError'
            reject(err)
          })
        })
    )
    expect(
      await computeRoadRoute({ lat: 13.7, lng: 100.5 }, { lat: 13.8, lng: 100.6 }, [])
    ).toEqual({ status: 'FAILED', errorCode: 'TIMEOUT' })
  })
})

describe('carTrip.service & HR Manager Trips REST API', () => {
  const app = buildApp()

  it('PDPA consent gate: blocks start/stops/end until accepted, rejects wrong version', async () => {
    const admin = newAdmin()
    const empUser = createUserWithPerms({ tenantId: admin.tenantId })
    const empId = insertEmployee({
      tenantId: admin.tenantId,
      code: 'EMP-001',
      firstName: 'สมชาย',
      userId: empUser.userId,
    })

    const badConsent = acceptTripConsent(admin.tenantId, empId, empUser.userId, '9.9')
    expect(badConsent.ok).toBe(false)
    if (!badConsent.ok) expect(badConsent.status).toBe(400)

    const startWithout = startCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      carType: 'PRIVATE',
      plateNo: 'กข 1234',
      startOdometer: 1000,
      lat: 13.7563,
      lng: 100.5018,
      accuracyM: null,
    })
    expect(startWithout.ok).toBe(false)
    if (!startWithout.ok) {
      expect(startWithout.status).toBe(403)
      expect(startWithout.code).toBe('CONSENT_REQUIRED')
    }
    const countAfterReject = (
      db
        .prepare('SELECT COUNT(*) c FROM hr_car_trips WHERE tenant_id = ?')
        .get(admin.tenantId) as any
    ).c
    expect(countAfterReject).toBe(0)

    const stopWithout = addCarTripStop({
      tenantId: admin.tenantId,
      employeeId: empId,
      tripId: 'nonexistent',
      lat: 13.75,
      lng: 100.5,
    })
    expect(stopWithout.ok).toBe(false)
    if (!stopWithout.ok) {
      expect(stopWithout.status).toBe(403)
      expect(stopWithout.code).toBe('CONSENT_REQUIRED')
    }

    const endWithout = await endCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      tripId: 'nonexistent',
      endOdometer: 1010,
      lat: 13.75,
      lng: 100.5,
    })
    expect(endWithout.ok).toBe(false)
    if (!endWithout.ok) {
      expect(endWithout.status).toBe(403)
      expect(endWithout.code).toBe('CONSENT_REQUIRED')
    }

    expect(TRIP_CONSENT_VERSION).toBe('1.1')
    expect(TRIP_CONSENT_NOTICE_TEXT).toContain('OpenStreetMap (OSRM)')

    // Employee who only accepted old v1.0 must re-accept v1.1
    db.prepare(
      `INSERT INTO hr_trip_consents (id, tenant_id, employee_id, user_id, consent_version, accepted_at)
       VALUES (?, ?, ?, ?, '1.0', ?)`
    ).run(generateId(), admin.tenantId, empId, empUser.userId, new Date().toISOString())
    expect(getTripConsentStatus(admin.tenantId, empId).accepted).toBe(false)
    const startOldConsent = startCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      carType: 'PRIVATE',
      plateNo: 'กข 1234',
      startOdometer: 1000,
      lat: 13.7563,
      lng: 100.5018,
      accuracyM: null,
    })
    expect(startOldConsent.ok).toBe(false)
    if (!startOldConsent.ok) {
      expect(startOldConsent.status).toBe(403)
      expect(startOldConsent.code).toBe('CONSENT_REQUIRED')
    }

    const okConsent = acceptTripConsent(admin.tenantId, empId, empUser.userId, TRIP_CONSENT_VERSION)
    expect(okConsent.ok).toBe(true)
    if (okConsent.ok) {
      expect(okConsent.data.accepted).toBe(true)
      expect(okConsent.data.version).toBe(TRIP_CONSENT_VERSION)
    }

    const consentRow = db
      .prepare(
        'SELECT employee_id, user_id, consent_version, accepted_at FROM hr_trip_consents WHERE tenant_id = ? AND employee_id = ? AND consent_version = ?'
      )
      .get(admin.tenantId, empId, TRIP_CONSENT_VERSION) as any
    expect(consentRow).toMatchObject({
      employee_id: empId,
      user_id: empUser.userId,
      consent_version: TRIP_CONSENT_VERSION,
    })
    expect(consentRow.accepted_at).toBeTruthy()
    expect(getTripConsentStatus(admin.tenantId, empId).accepted).toBe(true)

    const startOk = startCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      carType: 'PRIVATE',
      plateNo: 'กข 1234',
      startOdometer: 1000,
      lat: 13.7563,
      lng: 100.5018,
      accuracyM: null,
    })
    expect(startOk.ok).toBe(true)
    if (startOk.ok) {
      expect(startOk.data.status).toBe('OPEN')
      expect((startOk.data as any).flags).toBeUndefined()
    }
  })

  it('replay start, concurrent start race, and unique index block second OPEN trip (409)', async () => {
    const admin = newAdmin()
    const empUser = createUserWithPerms({ tenantId: admin.tenantId })
    const empId = insertEmployee({
      tenantId: admin.tenantId,
      code: 'EMP-002',
      firstName: 'วิชัย',
      userId: empUser.userId,
    })
    acceptTripConsent(admin.tenantId, empId, empUser.userId)

    const r1 = startCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      carType: 'PRIVATE',
      plateNo: 'ขค 9999',
      startOdometer: 5000,
      lat: 13.75,
      lng: 100.5,
    })
    expect(r1.ok).toBe(true)

    const r2 = startCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      carType: 'PRIVATE',
      plateNo: 'ขค 9999',
      startOdometer: 5000,
      lat: 13.75,
      lng: 100.5,
    })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.status).toBe(409)

    // Direct DB insert of second OPEN trip for same employee is blocked by uq_hr_car_trips_open_emp
    expect(() => {
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO hr_car_trips (
           id, tenant_id, employee_id, car_type, plate_no, status, started_at,
           start_odometer, start_lat, start_lng, created_at, updated_at
         ) VALUES (?, ?, ?, 'PRIVATE', 'XX', 'OPEN', ?, 1, 13.7, 100.5, ?, ?)`
      ).run(generateId(), admin.tenantId, empId, now, now, now)
    }).toThrow(/UNIQUE/)
  })

  it('replay end calls OSRM at most once', async () => {
    process.env.OSRM_URL = 'https://osrm.test'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ code: 'Ok', routes: [{ distance: 10000, duration: 600 }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    const admin = newAdmin()
    const empUser = createUserWithPerms({ tenantId: admin.tenantId })
    const empId = insertEmployee({
      tenantId: admin.tenantId,
      code: 'EMP-004',
      firstName: 'มานะ',
      userId: empUser.userId,
    })
    acceptTripConsent(admin.tenantId, empId, empUser.userId)

    const startRes = startCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      carType: 'PRIVATE',
      plateNo: 'กก 1111',
      startOdometer: 100,
      lat: 13.75,
      lng: 100.5,
    })
    expect(startRes.ok).toBe(true)
    const tripId = startRes.ok ? startRes.data.id : ''

    const e1 = await endCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      tripId,
      endOdometer: 110,
      lat: 13.8,
      lng: 100.6,
    })
    expect(e1.ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const e2 = await endCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      tripId,
      endOdometer: 110,
      lat: 13.8,
      lng: 100.6,
    })
    expect(e2.ok).toBe(false)
    if (!e2.ok) expect(e2.status).toBe(409)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('tenant isolation & employee isolation & removed /me/trips* /me/vehicles return 404', async () => {
    process.env.OSRM_URL = 'off'
    const adminA = newAdmin()
    const adminB = newAdmin()

    const vehA = insertVehicle(adminA.tenantId, 'กท 1001', 'รถตู้ A')

    const userA1 = createUserWithPerms({ tenantId: adminA.tenantId })
    const empA1 = insertEmployee({
      tenantId: adminA.tenantId,
      code: 'A-1',
      firstName: 'เอก',
      userId: userA1.userId,
    })
    const userA2 = createUserWithPerms({ tenantId: adminA.tenantId })
    const empA2 = insertEmployee({
      tenantId: adminA.tenantId,
      code: 'A-2',
      firstName: 'โท',
      userId: userA2.userId,
    })

    const userB1 = createUserWithPerms({ tenantId: adminB.tenantId })
    const empB1 = insertEmployee({
      tenantId: adminB.tenantId,
      code: 'B-1',
      firstName: 'บี',
      userId: userB1.userId,
    })

    acceptTripConsent(adminA.tenantId, empA1, userA1.userId)
    acceptTripConsent(adminA.tenantId, empA2, userA2.userId)
    acceptTripConsent(adminB.tenantId, empB1, userB1.userId)

    // Deleted self routes return 404
    expect(
      (await request(app).get('/api/hr/me/trips/status').set('Authorization', `Bearer ${userA1.token}`)).status
    ).toBe(404)
    expect(
      (await request(app).get('/api/hr/me/vehicles').set('Authorization', `Bearer ${userA1.token}`)).status
    ).toBe(404)
    expect(
      (await request(app).post('/api/hr/me/trips/start').set('Authorization', `Bearer ${userA1.token}`).send({})).status
    ).toBe(404)

    // Employee B cannot start with Tenant A's vehicle
    const crossVehStart = startCarTrip({
      tenantId: adminB.tenantId,
      employeeId: empB1,
      carType: 'COMPANY',
      vehicleId: vehA,
      startOdometer: 100,
      lat: 13.75,
      lng: 100.5,
    })
    expect(crossVehStart.ok).toBe(false)
    if (!crossVehStart.ok) expect([400, 404]).toContain(crossVehStart.status)

    // Employee A1 starts a trip
    const startA = startCarTrip({
      tenantId: adminA.tenantId,
      employeeId: empA1,
      carType: 'COMPANY',
      vehicleId: vehA,
      startOdometer: 100,
      lat: 13.75,
      lng: 100.5,
    })
    expect(startA.ok).toBe(true)
    const tripAId = startA.ok ? startA.data.id : ''

    // Employee A2 cannot add stop or end A1's trip
    const stopA2 = addCarTripStop({
      tenantId: adminA.tenantId,
      employeeId: empA2,
      tripId: tripAId,
      lat: 13.76,
      lng: 100.51,
    })
    expect(stopA2.ok).toBe(false)
    if (!stopA2.ok) expect(stopA2.status).toBe(404)

    const endA2 = await endCarTrip({
      tenantId: adminA.tenantId,
      employeeId: empA2,
      tripId: tripAId,
      endOdometer: 120,
      lat: 13.77,
      lng: 100.52,
    })
    expect(endA2.ok).toBe(false)
    if (!endA2.ok) expect(endA2.status).toBe(404)

    // Employee A2's recent trips excludes A1's trip
    expect(getMyRecentTrips(adminA.tenantId, empA2)).toEqual([])
    expect(getMyRecentTrips(adminA.tenantId, empA1)).toHaveLength(1)

    // Tenant B manager cannot see A's trip or retry/update A's records
    const listB = await request(app)
      .get('/api/hr/trips')
      .set('Authorization', `Bearer ${adminB.token}`)
    expect(listB.status).toBe(200)
    expect(listB.body.data).toEqual([])

    const retryB = await request(app)
      .post(`/api/hr/trips/${tripAId}/retry-route`)
      .set('Authorization', `Bearer ${adminB.token}`)
    expect(retryB.status).toBe(404)

    const updateVehB = await request(app)
      .put(`/api/hr/vehicles/${vehA}`)
      .set('Authorization', `Bearer ${adminB.token}`)
      .send({ label: 'hacked' })
    expect(updateVehB.status).toBe(404)
  })

  it('enforces manager permissions and blocks DELETE /api/hr/trips/:id', async () => {
    const admin = newAdmin()
    const plainUser = createUserWithPerms({ tenantId: admin.tenantId })
    const hrReadUser = createUserWithPerms({
      tenantId: admin.tenantId,
      customPermissions: { 'hr:read': true },
    })

    // Plain user without HR perms -> 403 on manager routes
    expect(
      (
        await request(app)
          .get('/api/hr/trips')
          .set('Authorization', `Bearer ${plainUser.token}`)
      ).status
    ).toBe(403)
    expect(
      (
        await request(app)
          .get('/api/hr/vehicles')
          .set('Authorization', `Bearer ${plainUser.token}`)
      ).status
    ).toBe(403)
    expect(
      (
        await request(app)
          .post('/api/hr/trips/any/retry-route')
          .set('Authorization', `Bearer ${plainUser.token}`)
      ).status
    ).toBe(403)

    // HR read-only can GET, cannot POST/PUT
    expect(
      (
        await request(app)
          .get('/api/hr/trips')
          .set('Authorization', `Bearer ${hrReadUser.token}`)
      ).status
    ).toBe(200)
    expect(
      (
        await request(app)
          .get('/api/hr/vehicles')
          .set('Authorization', `Bearer ${hrReadUser.token}`)
      ).status
    ).toBe(200)
    expect(
      (
        await request(app)
          .post('/api/hr/vehicles')
          .set('Authorization', `Bearer ${hrReadUser.token}`)
          .send({ plate_no: 'กก 123' })
      ).status
    ).toBe(403)
    expect(
      (
        await request(app)
          .post('/api/hr/trips/any/retry-route')
          .set('Authorization', `Bearer ${hrReadUser.token}`)
      ).status
    ).toBe(403)

    // No DELETE endpoint for trips
    const delRes = await request(app)
      .delete('/api/hr/trips/any-id')
      .set('Authorization', `Bearer ${admin.token}`)
    expect(delRes.status).toBe(404)
  })

  it('closes trips open >12h lazily (persisting on 409) and via sweep, leaving <12h OPEN', async () => {
    const admin = newAdmin()
    const u1 = createUserWithPerms({ tenantId: admin.tenantId })
    const emp1 = insertEmployee({
      tenantId: admin.tenantId,
      code: 'EXP-1',
      firstName: 'หมดเวลา',
      userId: u1.userId,
    })
    const u2 = createUserWithPerms({ tenantId: admin.tenantId })
    const emp2 = insertEmployee({
      tenantId: admin.tenantId,
      code: 'ACT-2',
      firstName: 'ยังไม่หมด',
      userId: u2.userId,
    })
    const u3 = createUserWithPerms({ tenantId: admin.tenantId })
    const emp3 = insertEmployee({
      tenantId: admin.tenantId,
      code: 'EXP-3',
      firstName: 'หยุดเกิน',
      userId: u3.userId,
    })

    acceptTripConsent(admin.tenantId, emp1, u1.userId)
    acceptTripConsent(admin.tenantId, emp2, u2.userId)
    acceptTripConsent(admin.tenantId, emp3, u3.userId)

    const nowMs = Date.now()
    const expiredStartedAt = new Date(nowMs - TRIP_MAX_OPEN_MS - 5 * 60_000).toISOString()
    const activeStartedAt = new Date(nowMs - TRIP_MAX_OPEN_MS + 5 * 60_000).toISOString()

    const trip1 = generateId()
    const trip2 = generateId()
    const trip3 = generateId()
    const trip4 = generateId()

    for (const [id, empId, startedAt] of [
      [trip1, emp1, expiredStartedAt],
      [trip2, emp2, activeStartedAt],
      [trip3, emp3, expiredStartedAt],
    ] as const) {
      db.prepare(
        `INSERT INTO hr_car_trips (
           id, tenant_id, employee_id, car_type, plate_no, status, started_at,
           start_odometer, start_lat, start_lng, start_accuracy_m, route_status,
           flags_json, created_at, updated_at
         ) VALUES (?, ?, ?, 'PRIVATE', 'กก 100', 'OPEN', ?, 100, 13.75, 100.5, 10, 'NONE', '[]', ?, ?)`
      ).run(id, admin.tenantId, empId, startedAt, startedAt, startedAt)
    }

    // 1. getOpenCarTrip lazily closes trip1
    expect(getOpenCarTrip(admin.tenantId, emp1)).toBeNull()
    const row1 = db
      .prepare('SELECT status, odometer_km, map_distance_km, route_status, close_reason FROM hr_car_trips WHERE id = ?')
      .get(trip1) as any
    expect(row1).toEqual({
      status: 'INCOMPLETE',
      odometer_km: null,
      map_distance_km: null,
      route_status: 'SKIPPED',
      close_reason: 'EXPIRED_12H',
    })

    // 2. addCarTripStop on expired trip3 returns 409 AND persists INCOMPLETE
    const stopExpired = addCarTripStop({
      tenantId: admin.tenantId,
      employeeId: emp3,
      tripId: trip3,
      lat: 13.76,
      lng: 100.51,
    })
    expect(stopExpired.ok).toBe(false)
    if (!stopExpired.ok) expect(stopExpired.status).toBe(409)
    const row3AfterStop = db
      .prepare('SELECT status, close_reason FROM hr_car_trips WHERE id = ?')
      .get(trip3) as any
    expect(row3AfterStop).toEqual({
      status: 'INCOMPLETE',
      close_reason: 'EXPIRED_12H',
    })

    // 3. Seed trip4 expired for emp3, then call endCarTrip -> returns 409 AND persists INCOMPLETE
    db.prepare(
      `INSERT INTO hr_car_trips (
         id, tenant_id, employee_id, car_type, plate_no, status, started_at,
         start_odometer, start_lat, start_lng, start_accuracy_m, route_status,
         flags_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'PRIVATE', 'กก 100', 'OPEN', ?, 100, 13.75, 100.5, 10, 'NONE', '[]', ?, ?)`
    ).run(trip4, admin.tenantId, emp3, expiredStartedAt, expiredStartedAt, expiredStartedAt)

    const endExpired = await endCarTrip({
      tenantId: admin.tenantId,
      employeeId: emp3,
      tripId: trip4,
      endOdometer: 120,
      lat: 13.8,
      lng: 100.6,
    })
    expect(endExpired.ok).toBe(false)
    if (!endExpired.ok) expect(endExpired.status).toBe(409)
    const row4AfterEnd = db
      .prepare('SELECT status, close_reason FROM hr_car_trips WHERE id = ?')
      .get(trip4) as any
    expect(row4AfterEnd).toEqual({
      status: 'INCOMPLETE',
      close_reason: 'EXPIRED_12H',
    })

    // 4. startCarTrip when expired row exists closes it & opens a new trip
    db.prepare(
      `INSERT INTO hr_car_trips (
         id, tenant_id, employee_id, car_type, plate_no, status, started_at,
         start_odometer, start_lat, start_lng, start_accuracy_m, route_status,
         flags_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'PRIVATE', 'กก 100', 'OPEN', ?, 100, 13.75, 100.5, 10, 'NONE', '[]', ?, ?)`
    ).run(generateId(), admin.tenantId, emp1, expiredStartedAt, expiredStartedAt, expiredStartedAt)

    const newStart = startCarTrip({
      tenantId: admin.tenantId,
      employeeId: emp1,
      carType: 'PRIVATE',
      plateNo: 'กก 100',
      startOdometer: 150,
      lat: 13.75,
      lng: 100.5,
    })
    expect(newStart.ok).toBe(true)

    // 5. closeExpiredTrips() leaves trip2 (11h55m) OPEN
    const swept = closeExpiredTrips({ tenantId: admin.tenantId, nowMs })
    expect(swept).toBe(0)
    const row2 = db
      .prepare('SELECT status FROM hr_car_trips WHERE id = ?')
      .get(trip2) as any
    expect(row2.status).toBe('OPEN')
  })

  it('OSRM: OSRM_URL=off skips fetch; HTTP 500 never logs coords; retry succeeds', async () => {
    process.env.OSRM_URL = 'off'
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const admin = newAdmin()
    const empUser = createUserWithPerms({ tenantId: admin.tenantId })
    const empId = insertEmployee({
      tenantId: admin.tenantId,
      code: 'G-1',
      firstName: 'กูเกิล',
      userId: empUser.userId,
    })
    acceptTripConsent(admin.tenantId, empId, empUser.userId)

    // Trip 1 with OSRM_URL=off
    const s1 = startCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      carType: 'PRIVATE',
      plateNo: 'ขข 2222',
      startOdometer: 200,
      lat: 13.756311,
      lng: 100.501822,
    })
    const trip1Id = s1.ok ? s1.data.id : ''

    const e1 = await endCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      tripId: trip1Id,
      endOdometer: 215,
      lat: 13.811111,
      lng: 100.555555,
    })
    expect(e1.ok).toBe(true)
    if (e1.ok) {
      expect(e1.data.status).toBe('COMPLETED')
      expect(e1.data.route_status).toBe('UNAVAILABLE')
      expect(e1.data.route_error).toBe('ROUTING_DISABLED')
      expect(e1.data.map_distance_km).toBeNull()
      expect(e1.data.odometer_km).toBe(15)
    }
    expect(fetchSpy).toHaveBeenCalledTimes(0)

    const retryDisabled = await request(app)
      .post(`/api/hr/trips/${trip1Id}/retry-route`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(retryDisabled.status).toBe(503)
    expect(retryDisabled.body.message).toBe('ระบบคำนวณระยะทางถูกปิดอยู่ (OSRM_URL=off)')
    expect(fetchSpy).toHaveBeenCalledTimes(0)

    // Trip 2 with OSRM_URL set but HTTP 500 + check zero coord logging
    process.env.OSRM_URL = 'https://osrm.test'
    const logSpy = vi.spyOn(console, 'log')
    const errSpy = vi.spyOn(console, 'error')
    const warnSpy = vi.spyOn(console, 'warn')

    fetchSpy.mockResolvedValueOnce(new Response('bad gateway', { status: 500 }))

    const s2 = startCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      carType: 'PRIVATE',
      plateNo: 'ขข 2222',
      startOdometer: 300,
      lat: 13.712345,
      lng: 100.543219,
    })
    const trip2Id = s2.ok ? s2.data.id : ''

    const e2 = await endCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      tripId: trip2Id,
      endOdometer: 315,
      lat: 13.865432,
      lng: 100.598765,
    })
    expect(e2.ok).toBe(true)
    if (e2.ok) {
      expect(e2.data.status).toBe('COMPLETED')
      expect(e2.data.route_status).toBe('FAILED')
      expect(e2.data.map_distance_km).toBeNull()
    }

    const dbErrRow = db
      .prepare('SELECT route_error FROM hr_car_trips WHERE id = ?')
      .get(trip2Id) as any
    expect(dbErrRow.route_error).toBe('HTTP_500')

    const allLogs = [
      ...logSpy.mock.calls,
      ...errSpy.mock.calls,
      ...warnSpy.mock.calls,
    ]
      .flat()
      .map(String)
      .join(' ')
    expect(allLogs).not.toContain('13.712345')
    expect(allLogs).not.toContain('100.543219')
    expect(allLogs).not.toContain('13.865432')

    // Manager retries trip2 with mocked 200 -> updates route_status='OK' & recomputes flags
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'Ok', routes: [{ distance: 10000, duration: 600 }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const retryOk = await request(app)
      .post(`/api/hr/trips/${trip2Id}/retry-route`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(retryOk.status).toBe(200)
    expect(retryOk.body.data.route_status).toBe('OK')
    expect(retryOk.body.data.map_distance_km).toBe(10)
    expect(retryOk.body.data.map_duration_sec).toBe(600)
    expect(retryOk.body.data.flags).toContain('ODOMETER_MISMATCH')

    // Second retry when already OK -> 409
    const retryAgain = await request(app)
      .post(`/api/hr/trips/${trip2Id}/retry-route`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(retryAgain.status).toBe(409)
  })

  it('OSRM: timeout aborts cleanly & valid call sends GET with User-Agent + ordered lng,lat stops', async () => {
    process.env.OSRM_URL = 'https://osrm.test'
    process.env.ROUTE_TIMEOUT_MS = '30'

    const admin = newAdmin()
    const empUser = createUserWithPerms({ tenantId: admin.tenantId })
    const empId = insertEmployee({
      tenantId: admin.tenantId,
      code: 'G-2',
      firstName: 'เส้นทาง',
      userId: empUser.userId,
    })
    acceptTripConsent(admin.tenantId, empId, empUser.userId)

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted')
            err.name = 'AbortError'
            reject(err)
          })
        })
    )

    const s1 = startCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      carType: 'PRIVATE',
      plateNo: 'งง 4444',
      startOdometer: 100,
      lat: 13.7,
      lng: 100.5,
    })
    const trip1Id = s1.ok ? s1.data.id : ''

    const e1 = await endCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      tripId: trip1Id,
      endOdometer: 105,
      lat: 13.8,
      lng: 100.6,
    })
    expect(e1.ok).toBe(true)
    if (e1.ok) expect(e1.data.route_status).toBe('FAILED')
    const errRow = db
      .prepare('SELECT route_error FROM hr_car_trips WHERE id = ?')
      .get(trip1Id) as any
    expect(errRow.route_error).toBe('TIMEOUT')

    process.env.ROUTE_TIMEOUT_MS = '5000'
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'Ok', routes: [{ distance: 25400, duration: 1500 }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    const s2 = startCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      carType: 'PRIVATE',
      plateNo: 'งง 4444',
      startOdometer: 200,
      lat: 13.71,
      lng: 100.51,
    })
    const trip2Id = s2.ok ? s2.data.id : ''

    addCarTripStop({ tenantId: admin.tenantId, employeeId: empId, tripId: trip2Id, lat: 13.72, lng: 100.52, note: 'จุด 1' })
    addCarTripStop({ tenantId: admin.tenantId, employeeId: empId, tripId: trip2Id, lat: 13.73, lng: 100.53, note: 'จุด 2' })

    const e2 = await endCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      tripId: trip2Id,
      endOdometer: 225,
      lat: 13.79,
      lng: 100.59,
    })
    expect(e2.ok).toBe(true)
    if (e2.ok) {
      expect(e2.data.route_status).toBe('OK')
      expect(e2.data.map_distance_km).toBe(25.4)
      expect(e2.data.map_duration_sec).toBe(1500)
      expect(e2.data.route_map_url).toContain('waypoints=13.72,100.52%7C13.73,100.53')
      expect(e2.data.route_map_url).not.toContain('|')
    }

    const lastCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1]
    expect(lastCall[0]).toBe(
      'https://osrm.test/route/v1/driving/100.51,13.71;100.52,13.72;100.53,13.73;100.59,13.79?overview=false'
    )
    const reqInit = lastCall[1] as RequestInit
    expect(reqInit.method).toBe('GET')
    expect((reqInit.headers as Record<string, string>)['User-Agent']).toBe(
      'phopy-erp-trips'
    )
  })

  it('rejects invalid coords/odometer, end < start, and enforces 10-stop limit', async () => {
    process.env.OSRM_URL = 'off'
    const admin = newAdmin()
    const empUser = createUserWithPerms({ tenantId: admin.tenantId })
    const empId = insertEmployee({
      tenantId: admin.tenantId,
      code: 'LIM-1',
      firstName: 'จุดแวะ',
      userId: empUser.userId,
    })
    acceptTripConsent(admin.tenantId, empId, empUser.userId)

    for (const badInput of [
      { startOdometer: 100, lat: 95, lng: 100 },
      { startOdometer: 100, lat: 13.7, lng: -200 },
      { startOdometer: 100, lat: 0, lng: 0 },
      { startOdometer: 100, lat: 'abc', lng: 100 },
      { startOdometer: 100, lat: 13.7, lng: 100, accuracyM: -5 },
      { startOdometer: -10, lat: 13.7, lng: 100 },
    ]) {
      const r = startCarTrip({
        tenantId: admin.tenantId,
        employeeId: empId,
        carType: 'PRIVATE',
        plateNo: 'ก 1',
        ...badInput,
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.status).toBe(400)
    }

    const startRes = startCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      carType: 'PRIVATE',
      plateNo: 'ก 1',
      startOdometer: 500,
      lat: 13.75,
      lng: 100.5,
    })
    expect(startRes.ok).toBe(true)
    const tripId = startRes.ok ? startRes.data.id : ''

    for (let i = 1; i <= 10; i++) {
      const stopRes = addCarTripStop({
        tenantId: admin.tenantId,
        employeeId: empId,
        tripId,
        lat: 13.75 + i * 0.001,
        lng: 100.5,
      })
      expect(stopRes.ok).toBe(true)
      if (stopRes.ok) expect(stopRes.data.stops).toHaveLength(i)
    }

    const stop11 = addCarTripStop({
      tenantId: admin.tenantId,
      employeeId: empId,
      tripId,
      lat: 13.77,
      lng: 100.5,
    })
    expect(stop11.ok).toBe(false)
    if (!stop11.ok) expect(stop11.status).toBe(409)

    const badEnd = await endCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      tripId,
      endOdometer: 499,
      lat: 13.8,
      lng: 100.6,
    })
    expect(badEnd.ok).toBe(false)
    if (!badEnd.ok) expect(badEnd.status).toBe(400)
  })

  it('vehicles CRUD + manager trip flags (ODOMETER_ROLLBACK, POOR_GPS, ODOMETER_MISMATCH)', async () => {
    process.env.OSRM_URL = 'https://osrm.test'
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ code: 'Ok', routes: [{ distance: 10000, duration: 600 }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    )

    const admin = newAdmin()
    const authAdmin = { Authorization: `Bearer ${admin.token}` }

    const vCreate = await request(app)
      .post('/api/hr/vehicles')
      .set(authAdmin)
      .send({ plate_no: 'ฮฮ 8888', label: 'กระบะ 1', notes: 'ดีเซล' })
    expect(vCreate.status).toBe(201)
    const vehId = vCreate.body.data.id

    const vDup = await request(app)
      .post('/api/hr/vehicles')
      .set(authAdmin)
      .send({ plate_no: 'ฮฮ 8888' })
    expect(vDup.status).toBe(409)

    const empUser = createUserWithPerms({ tenantId: admin.tenantId })
    const empId = insertEmployee({
      tenantId: admin.tenantId,
      code: 'DRV-1',
      firstName: 'คนขับ',
      userId: empUser.userId,
    })
    acceptTripConsent(admin.tenantId, empId, empUser.userId)

    // Trip 1 ends at 1000
    const t1Start = startCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      carType: 'COMPANY',
      vehicleId: vehId,
      startOdometer: 990,
      lat: 13.7,
      lng: 100.5,
      accuracyM: 10,
    })
    await endCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      tripId: t1Start.ok ? t1Start.data.id : '',
      endOdometer: 1000,
      lat: 13.8,
      lng: 100.6,
      accuracyM: 10,
    })

    // Verify last_end_odometer on GET /api/hr/vehicles
    const vList1 = await request(app).get('/api/hr/vehicles').set(authAdmin)
    expect(vList1.status).toBe(200)
    expect(vList1.body.data[0].last_end_odometer).toBe(1000)

    // Trip 2 starts at 950 (< 1000 -> ODOMETER_ROLLBACK) with accuracy_m 200 (POOR_GPS)
    // and ends at 965 (15km vs 10km -> ODOMETER_MISMATCH)
    const t2Start = startCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      carType: 'COMPANY',
      vehicleId: vehId,
      startOdometer: 950,
      lat: 13.7,
      lng: 100.5,
      accuracyM: 200,
    })
    const t2End = await endCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      tripId: t2Start.ok ? t2Start.data.id : '',
      endOdometer: 965,
      lat: 13.8,
      lng: 100.6,
      accuracyM: 10,
    })
    expect(t2End.ok).toBe(true)
    if (t2End.ok) {
      expect(t2End.data.route_status).toBe('OK')
      expect(t2End.data.map_distance_km).toBe(10)
    }

    const flaggedList = await request(app)
      .get('/api/hr/trips?flagged=1')
      .set(authAdmin)
    expect(flaggedList.status).toBe(200)
    expect(flaggedList.body.data).toHaveLength(1)
    expect(flaggedList.body.data[0].flags).toEqual(
      expect.arrayContaining([
        'ODOMETER_ROLLBACK',
        'POOR_GPS',
        'ODOMETER_MISMATCH',
      ])
    )
    expect(flaggedList.body.data[0].prev_vehicle_end_odometer).toBe(1000)

    // Deactivate vehicle -> hidden from getActiveVehicles and rejected on startCarTrip
    const vDeact = await request(app)
      .put(`/api/hr/vehicles/${vehId}`)
      .set(authAdmin)
      .send({ is_active: false })
    expect(vDeact.status).toBe(200)
    expect(vDeact.body.data.is_active).toBe(false)

    expect(getActiveVehicles(admin.tenantId)).toEqual([])

    const startDeact = startCarTrip({
      tenantId: admin.tenantId,
      employeeId: empId,
      carType: 'COMPANY',
      vehicleId: vehId,
      startOdometer: 1000,
      lat: 13.7,
      lng: 100.5,
    })
    expect(startDeact.ok).toBe(false)
    if (!startDeact.ok) expect(startDeact.status).toBe(400)
  })

  it('hr_self token minted via POST /api/auth/line-login is blocked from manager routes and deleted /me/trips*', async () => {
    process.env.OSRM_URL = 'off'
    const admin = newAdmin()
    const empUser = createUserWithPerms({
      tenantId: admin.tenantId,
      role: 'ADMIN',
      customPermissions: { 'hr:write': true },
    })
    insertEmployee({
      tenantId: admin.tenantId,
      code: 'LINE-1',
      firstName: 'ไลน์',
      userId: empUser.userId,
    })
    db.prepare(
      `INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role)
       VALUES (?, ?, ?, ?, 'ADMIN')`
    ).run(generateId(), admin.tenantId, empUser.userId, 'U' + generateId())

    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
    db.prepare(
      `INSERT INTO line_login_tokens (token_hash, tenant_id, user_id, expires_at)
       VALUES (?, ?, ?, ?)`
    ).run(tokenHash, admin.tenantId, empUser.userId, expiresAt)

    const loginRes = await request(app)
      .post('/api/auth/line-login')
      .send({ token: rawToken })
    expect(loginRes.status).toBe(200)
    expect(loginRes.body.data.user.scope).toBe('hr_self')
    const hrSelfToken = loginRes.body.data.token
    const authSelf = { Authorization: `Bearer ${hrSelfToken}` }

    // Deleted /me/trips* and /me/vehicles return 404
    expect((await request(app).get('/api/hr/me/trips/status').set(authSelf)).status).toBe(404)
    expect((await request(app).get('/api/hr/me/vehicles').set(authSelf)).status).toBe(404)

    // Manager endpoints blocked with 403 even though underlying user is ADMIN
    const mgrTrips = await request(app).get('/api/hr/trips').set(authSelf)
    expect(mgrTrips.status).toBe(403)
    const mgrVeh = await request(app)
      .post('/api/hr/vehicles')
      .set(authSelf)
      .send({ plate_no: 'xx 123' })
    expect(mgrVeh.status).toBe(403)
  })
})
