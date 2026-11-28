import { describe, it, expect, vi, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import authRoutes from '../routes/auth.routes'
import { richMenus } from './line-richmenu.service'
import { flexTemplates } from './line-flex-templates'
import { lineBotService } from './line-bot.service'

const app = express()
app.use(express.json())
app.use('/api/auth', authRoutes)

const tenants: string[] = []
const origTasksUrl = process.env.MY_TASKS_URL
const origOsrmUrl = process.env.OSRM_URL
const origRouteTimeoutMs = process.env.ROUTE_TIMEOUT_MS

afterEach(() => {
    vi.restoreAllMocks()
    if (origTasksUrl === undefined) delete process.env.MY_TASKS_URL
    else process.env.MY_TASKS_URL = origTasksUrl
    if (origOsrmUrl === undefined) delete process.env.OSRM_URL
    else process.env.OSRM_URL = origOsrmUrl
    if (origRouteTimeoutMs === undefined) delete process.env.ROUTE_TIMEOUT_MS
    else process.env.ROUTE_TIMEOUT_MS = origRouteTimeoutMs

    for (const t of tenants.splice(0)) {
        for (const tb of [
            'hr_car_trip_stops',
            'hr_car_trips',
            'hr_trip_consents',
            'hr_vehicles',
            'line_pending_tasks',
            'line_event_logs',
            'employees',
            'line_user_mappings',
            'line_group_mappings',
            'line_login_tokens',
            'users',
            'company_settings',
        ]) {
            db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t)
        }
    }
})

function setupStaff(opts?: { employeeStatus?: string | null; tenantId?: string }) {
    delete process.env.MY_TASKS_URL
    const tenantId = opts?.tenantId ?? 'tenant_lbt_' + generateId().slice(0, 8)
    if (!tenants.includes(tenantId)) tenants.push(tenantId)

    const userId = generateId()
    const lineUserId = 'U' + generateId()
    db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', 'สมชาย', 'USER', ?, 'active')`)
        .run(userId, `${userId}@example.com`, tenantId)
    db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, 'USER')`)
        .run(generateId(), tenantId, userId, lineUserId)
    if (!db.prepare('SELECT 1 FROM company_settings WHERE tenant_id = ?').get(tenantId)) {
        try { db.prepare(`INSERT INTO company_settings (id, tenant_id, name) VALUES (?, ?, 'บริษัททดสอบ')`).run(generateId(), tenantId) }
        catch { db.prepare(`INSERT INTO company_settings (tenant_id, name) VALUES (?, 'บริษัททดสอบ')`).run(tenantId) }
    }

    let employeeId: string | null = null
    if (opts?.employeeStatus !== null) {
        employeeId = generateId()
        db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, last_name, employment_type, base_wage, start_date, status, user_id) VALUES (?, ?, ?, 'สมชาย', 'ใจดี', 'MONTHLY', 15000, '2026-01-01', ?, ?)`)
            .run(employeeId, tenantId, 'E' + userId.slice(0, 5), opts?.employeeStatus ?? 'ACTIVE', userId)
    }

    const replies: any[] = []
    const pushMessage = vi.fn(async () => {})
    vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({
        token: 't',
        replyMessage: async (_t: string, m: any) => { replies.push(m) },
        pushMessage,
    })
    vi.spyOn(richMenus, 'syncUser').mockResolvedValue()

    const send = (ev: any) => lineBotService.handleEvent(tenantId, { replyToken: 'rt', ...ev })
    const say = (text: string, source: any = { type: 'user', userId: lineUserId }) =>
        send({ type: 'message', message: { type: 'text', text }, source })
    const sendLoc = (latitude: number, longitude: number, optsLoc?: { title?: string; source?: any }) =>
        send({
            type: 'message',
            message: { type: 'location', latitude, longitude, ...(optsLoc?.title ? { title: optsLoc.title } : {}) },
            source: optsLoc?.source ?? { type: 'user', userId: lineUserId },
        })
    const postback = (data: string, source: any = { type: 'user', userId: lineUserId }) =>
        send({ type: 'postback', postback: { data }, source })

    return { tenantId, userId, employeeId, lineUserId, replies, pushMessage, send, say, sendLoc, postback }
}

function insertVehicle(tenantId: string, plateNo: string, label: string | null = null, isActive = 1) {
    const id = generateId()
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO hr_vehicles (id, tenant_id, plate_no, label, is_active, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`)
        .run(id, tenantId, plateNo, label, isActive, now, now)
    return id
}

describe('LINE Bot — In-Chat Car Trips, งานของฉัน และ One-time Link', () => {
    it('happy path start (6-digit odometer not hijacked by bareOtp) -> stop -> end with mocked OSRM & zero coord leaks', async () => {
        process.env.OSRM_URL = 'https://osrm.test'
        const logSpy = vi.spyOn(console, 'log')
        const errSpy = vi.spyOn(console, 'error')
        const warnSpy = vi.spyOn(console, 'warn')
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(
                JSON.stringify({ code: 'Ok', routes: [{ distance: 10000, duration: 600 }] }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        )

        const { tenantId, employeeId, replies, pushMessage, say, sendLoc, postback } = setupStaff()
        const vehId = insertVehicle(tenantId, 'กท 1234', 'กระบะ 1')

        // 1. Tap เริ่ม/จบทริป -> PDPA consent
        await say('เริ่ม/จบทริป')
        expect(replies.at(-1).type).toBe('text')
        expect(replies.at(-1).text).toContain('ความยินยอมการใช้ตำแหน่ง (PDPA)')
        expect(replies.at(-1).text).toContain('OpenStreetMap (OSRM)')
        expect(replies.at(-1).quickReply.items.map((i: any) => i.action.data)).toEqual([
            'action=trip_consent',
            'action=trip_cancel',
        ])

        // 2. Accept consent -> PICK_CAR
        await postback('action=trip_consent')
        const pickCarMsg = replies.at(-1)
        expect(pickCarMsg.text).toContain('กรุณาเลือกรถที่ใช้งาน')
        expect(pickCarMsg.quickReply.items.map((i: any) => i.action.data)).toEqual([
            `action=trip_car&type=COMPANY&vid=${encodeURIComponent(vehId)}`,
            'action=trip_car&type=PRIVATE',
            'action=trip_cancel',
        ])

        // 3. Pick company car -> START_ODO
        await postback(`action=trip_car&type=COMPANY&vid=${encodeURIComponent(vehId)}`)
        expect(replies.at(-1).text).toContain('กรุณาพิมพ์เลขไมล์เริ่มต้น')

        // 4. Send 6-digit odometer (125430) -> must NOT be hijacked by bareOtp!
        await say('125430')
        expect(replies.at(-1).text).toContain('วัตถุประสงค์การเดินทาง')
        expect(replies.at(-1).text).not.toContain('รหัสไม่ถูกต้อง')

        // 5. Type purpose -> START_LOC
        await say('ส่งของลูกค้า')
        expect(replies.at(-1).quickReply.items[0].action.type).toBe('location')

        // 6. Send start location -> tripStartedCard Flex card, OPEN row with start_accuracy_m = NULL
        await sendLoc(13.756311, 100.501822)
        const startedCard = replies.at(-1)
        expect(startedCard.type).toBe('flex')
        expect(startedCard.altText).toContain('เริ่มทริปแล้ว')
        const tripRow = db.prepare('SELECT * FROM hr_car_trips WHERE tenant_id = ? AND employee_id = ?').get(tenantId, employeeId) as any
        expect(tripRow.status).toBe('OPEN')
        expect(tripRow.start_odometer).toBe(125430)
        expect(tripRow.start_accuracy_m).toBeNull()
        expect(tripRow.purpose).toBe('ส่งของลูกค้า')

        // 7. Add stop -> STOP_LOC -> location -> stop saved with accuracy_m = NULL
        await say('แวะจุด')
        expect(replies.at(-1).text).toContain('บันทึกจุดแวะ (1/10)')
        await sendLoc(13.781111, 100.531111, { title: 'จุดส่งที่ 1' })
        expect(replies.at(-1).text).toContain('บันทึกจุดแวะที่ 1/10 เรียบร้อยแล้ว')
        const stopRow = db.prepare('SELECT * FROM hr_car_trip_stops WHERE trip_id = ?').get(tripRow.id) as any
        expect(stopRow.accuracy_m).toBeNull()
        expect(stopRow.note).toBe('จุดส่งที่ 1')

        // 8. End trip -> END_ODO -> 125455 (25 km vs 10 km map -> ODOMETER_MISMATCH) -> location -> tripSummaryCard
        await say('เริ่ม/จบทริป')
        expect(replies.at(-1).text).toContain('จบทริป')
        await say('125455')
        expect(replies.at(-1).text).toContain('ระยะทาง 25 กม.')
        await sendLoc(13.812345, 100.556789)
        const summaryCard = replies.at(-1)
        expect(summaryCard.type).toBe('flex')
        const summaryStr = JSON.stringify(summaryCard)
        expect(summaryStr).toContain('จบทริปแล้ว')
        expect(summaryStr).toContain('25 กม.')
        expect(summaryStr).toContain('10 กม.')
        expect(summaryStr).toContain('ระยะไมล์ต่างจากแผนที่ >20%')
        expect(summaryStr).not.toContain('ความแม่นยำ GPS ต่ำ')

        const completedRow = db.prepare('SELECT * FROM hr_car_trips WHERE id = ?').get(tripRow.id) as any
        expect(completedRow.status).toBe('COMPLETED')
        expect(JSON.parse(completedRow.flags_json)).toEqual(['ODOMETER_MISMATCH'])

        // Verify zero pushMessage and zero raw coords / API key in replies, logs, and console
        expect(pushMessage).not.toHaveBeenCalled()
        const replyBlob = JSON.stringify(replies)
        const eventLogs = (db.prepare('SELECT summary, error FROM line_event_logs WHERE tenant_id = ?').all(tenantId) as any[])
            .map(r => `${r.summary ?? ''} ${r.error ?? ''}`).join(' ')
        const consoleBlob = [...logSpy.mock.calls, ...errSpy.mock.calls, ...warnSpy.mock.calls].flat().map(String).join(' ')
        for (const leak of ['13.756311', '100.501822', '13.781111', '13.812345']) {
            expect(replyBlob).not.toContain(leak)
            expect(eventLogs).not.toContain(leak)
            expect(consoleBlob).not.toContain(leak)
        }
    })

    it('PDPA consent once + skip purpose via trip_skip_purpose + private car validation', async () => {
        process.env.OSRM_URL = 'off'
        const { tenantId, employeeId, replies, say, sendLoc, postback } = setupStaff()

        // First trip: accept consent, pick PRIVATE, test invalid & valid plate, skip purpose
        await say('เริ่ม/จบทริป')
        await postback('action=trip_consent')
        await postback('action=trip_car&type=PRIVATE')
        expect(replies.at(-1).text).toContain('พิมพ์ทะเบียนรถส่วนตัว')

        // > 30 chars rejected
        await say('ก'.repeat(31))
        expect(replies.at(-1).text).toContain('1-30 ตัวอักษร')

        await say('ขค 5678')
        expect(replies.at(-1).text).toContain('ขค 5678')
        await say('1000')
        await postback('action=trip_skip_purpose')
        expect(replies.at(-1).quickReply.items[0].action.type).toBe('location')
        await sendLoc(13.75, 100.5)
        expect(replies.at(-1).type).toBe('flex')

        // End first trip
        await say('จบทริป')
        await say('1010')
        await sendLoc(13.76, 100.51)
        expect(replies.at(-1).type).toBe('flex')

        // Second trip: skips CONSENT and goes straight to PICK_CAR; only 1 row in hr_trip_consents
        await say('เริ่ม/จบทริป')
        expect(replies.at(-1).text).toContain('เริ่มทริปใหม่')
        expect(replies.at(-1).text).not.toContain('PDPA')
        const consentCount = (db.prepare('SELECT COUNT(*) c FROM hr_trip_consents WHERE tenant_id = ? AND employee_id = ?').get(tenantId, employeeId) as any).c
        expect(consentCount).toBe(1)
    })

    it('validates odometer in START_ODO and END_ODO (non-numeric, negative, >9999999, end < start) while preserving state', async () => {
        process.env.OSRM_URL = 'off'
        const { replies, say, sendLoc, postback } = setupStaff()
        await say('เริ่ม/จบทริป')
        await postback('action=trip_consent')
        await postback('action=trip_car&type=PRIVATE')
        await say('กข 111')

        for (const bad of ['abc', '-5', '10000000']) {
            await say(bad)
            expect(replies.at(-1).text).toContain('0 ถึง 9,999,999')
        }
        await say('500')
        await say('ข้าม')
        await sendLoc(13.75, 100.5)

        // End trip odometer checks
        await say('จบทริป')
        await say('abc')
        expect(replies.at(-1).text).toContain('0 ถึง 9,999,999')
        await say('450')
        expect(replies.at(-1).text).toContain('มากกว่าหรือเท่ากับเลขไมล์เริ่มต้น')
        expect(replies.at(-1).text).toContain('500')

        // Valid follow-up succeeds
        await say('520')
        expect(replies.at(-1).text).toContain('ระยะทาง 20 กม.')
        await sendLoc(13.77, 100.52)
        expect(replies.at(-1).type).toBe('flex')
    })

    it('rejects second start while open, stops without open trip, and 11th stop', async () => {
        process.env.OSRM_URL = 'off'
        const { tenantId, employeeId, replies, say, sendLoc, postback } = setupStaff()

        // No open trip -> แวะจุด and จบทริป refused
        await say('แวะจุด')
        expect(replies.at(-1).text).toContain('ยังไม่มีทริปที่เปิดอยู่')
        await say('จบทริป')
        expect(replies.at(-1).text).toContain('ยังไม่มีทริปที่เปิดอยู่')

        // Start a trip
        await say('เริ่ม/จบทริป')
        await postback('action=trip_consent')
        await postback('action=trip_car&type=PRIVATE')
        await say('งง 999')
        await say('100')
        await say('ข้าม')
        await sendLoc(13.75, 100.5)

        // Explicit เริ่มทริป while open refused; no 2nd row created
        await say('เริ่มทริป')
        expect(replies.at(-1).text).toContain('คุณมีทริปที่เปิดอยู่แล้ว')
        const tripCount = (db.prepare('SELECT COUNT(*) c FROM hr_car_trips WHERE tenant_id = ? AND employee_id = ?').get(tenantId, employeeId) as any).c
        expect(tripCount).toBe(1)

        // Add 10 stops
        for (let i = 1; i <= 10; i++) {
            await say('แวะจุด')
            await sendLoc(13.75 + i * 0.001, 100.5)
            expect(replies.at(-1).text).toContain(`บันทึกจุดแวะที่ ${i}/10`)
        }
        // 11th stop rejected
        await say('แวะจุด')
        expect(replies.at(-1).text).toContain('แวะจุดได้สูงสุด 10 จุดต่อทริป')
    })

    it('refuses group chat commands, silently ignores group locations, and refuses unlinked/resigned employees', async () => {
        const g1 = setupStaff()
        for (const cmd of ['เริ่ม/จบทริป', 'แวะจุด', 'ประวัติทริป']) {
            await g1.say(cmd, { type: 'group', groupId: 'G1', userId: g1.lineUserId })
            expect(g1.replies.at(-1).type).toBe('text')
            expect(g1.replies.at(-1).text).toContain('แชทส่วนตัว')
        }
        const beforeGroupLoc = g1.replies.length
        await g1.sendLoc(13.75, 100.5, { source: { type: 'group', groupId: 'G1', userId: g1.lineUserId } })
        expect(g1.replies.length).toBe(beforeGroupLoc)

        const noEmp = setupStaff({ employeeStatus: null })
        await noEmp.say('เริ่ม/จบทริป')
        expect(noEmp.replies[0].text).toContain('ยังไม่ได้ผูกกับทะเบียนพนักงาน')

        const resigned = setupStaff({ employeeStatus: 'RESIGNED' })
        await resigned.say('ประวัติทริป')
        expect(resigned.replies[0].text).toContain('ยังไม่ได้ผูกกับทะเบียนพนักงาน')
    })

    it('handles cancel (text & postback), mid-flow rich-menu escape, and 15-min expiry', async () => {
        const { tenantId, lineUserId, replies, say, sendLoc, postback } = setupStaff()

        // Cancel via text ยกเลิก
        await say('เริ่ม/จบทริป')
        expect(db.prepare("SELECT COUNT(*) c FROM line_pending_tasks WHERE line_user_id = ? AND type = 'car_trip'").get(lineUserId)).toEqual({ c: 1 })
        await say('ยกเลิก')
        expect(replies.at(-1).text).toBe('❌ ยกเลิกการทำรายการแล้วครับ')
        expect(db.prepare("SELECT COUNT(*) c FROM line_pending_tasks WHERE line_user_id = ? AND type = 'car_trip'").get(lineUserId)).toEqual({ c: 0 })

        // Cancel via postback trip_cancel
        await say('เริ่ม/จบทริป')
        await postback('action=trip_cancel')
        expect(replies.at(-1).text).toBe('❌ ยกเลิกการทำรายการแล้วครับ')
        expect(db.prepare("SELECT COUNT(*) c FROM line_pending_tasks WHERE line_user_id = ? AND type = 'car_trip'").get(lineUserId)).toEqual({ c: 0 })

        // Mid-flow rich-menu escape (สถานะ clears car_trip state and executes สถานะ)
        await say('เริ่ม/จบทริป')
        await say('สถานะ')
        expect(replies.at(-1).text).toContain('ไม่มีรายการที่กำลังผลิต')
        expect(db.prepare("SELECT COUNT(*) c FROM line_pending_tasks WHERE line_user_id = ? AND type = 'car_trip'").get(lineUserId)).toEqual({ c: 0 })

        // 15-min expiry on postback & location
        await say('เริ่ม/จบทริป')
        db.prepare("UPDATE line_pending_tasks SET expires_at = ? WHERE tenant_id = ? AND line_user_id = ? AND type = 'car_trip'")
            .run(new Date(Date.now() - 1000).toISOString(), tenantId, lineUserId)
        await postback('action=trip_consent')
        expect(replies.at(-1).text).toContain('หมดเวลาแล้ว')
        expect(db.prepare("SELECT COUNT(*) c FROM line_pending_tasks WHERE line_user_id = ? AND type = 'car_trip'").get(lineUserId)).toEqual({ c: 0 })

        await say('เริ่ม/จบทริป')
        db.prepare("UPDATE line_pending_tasks SET expires_at = ? WHERE tenant_id = ? AND line_user_id = ? AND type = 'car_trip'")
            .run(new Date(Date.now() - 1000).toISOString(), tenantId, lineUserId)
        await sendLoc(13.75, 100.5)
        expect(replies.at(-1).text).toContain('หมดเวลาแล้ว')
    })

    it('ประวัติทริป: empty text vs Flex card with latest 5 trips (no other employee, no web URL, no raw coords)', async () => {
        const s = setupStaff()
        await s.say('ประวัติทริป')
        expect(s.replies.at(-1).text).toContain('ยังไม่มีประวัติการใช้รถ')

        // Seed 6 trips for this employee + 1 trip for another employee
        const otherEmpId = generateId()
        db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, last_name, employment_type, base_wage, start_date, status) VALUES (?, ?, 'OTHER-1', 'อื่น', 'คน', 'MONTHLY', 15000, '2026-01-01', 'ACTIVE')`)
            .run(otherEmpId, s.tenantId)
        const baseMs = Date.UTC(2026, 5, 1, 8, 0, 0)
        for (let i = 1; i <= 6; i++) {
            const startedAt = new Date(baseMs + i * 3600_000).toISOString()
            const endedAt = new Date(baseMs + i * 3600_000 + 1800_000).toISOString()
            db.prepare(`
                INSERT INTO hr_car_trips (
                  id, tenant_id, employee_id, car_type, plate_no, status, started_at,
                  start_odometer, start_lat, start_lng, ended_at, end_odometer, end_lat, end_lng,
                  odometer_km, duration_sec, route_status, flags_json, created_at, updated_at
                ) VALUES (?, ?, ?, 'PRIVATE', ?, 'COMPLETED', ?, 100, 13.751234, 100.501234, ?, 110, 13.761234, 100.511234, 10, 1800, 'OK', '[]', ?, ?)
            `).run(generateId(), s.tenantId, s.employeeId, `PLT-${i}`, startedAt, endedAt, startedAt, startedAt)
        }
        const otherStarted = new Date(baseMs + 9 * 3600_000).toISOString()
        db.prepare(`
            INSERT INTO hr_car_trips (
              id, tenant_id, employee_id, car_type, plate_no, status, started_at,
              start_odometer, start_lat, start_lng, route_status, flags_json, created_at, updated_at
            ) VALUES (?, ?, ?, 'PRIVATE', 'OTHER-PLT', 'OPEN', ?, 100, 13.7, 100.5, 'NONE', '[]', ?, ?)
        `).run(generateId(), s.tenantId, otherEmpId, otherStarted, otherStarted, otherStarted)

        await s.say('ประวัติทริป')
        const card = s.replies.at(-1)
        expect(card.type).toBe('flex')
        const json = JSON.stringify(card)
        for (const p of ['PLT-6', 'PLT-5', 'PLT-4', 'PLT-3', 'PLT-2']) expect(json).toContain(p)
        expect(json).not.toContain('PLT-1')
        expect(json).not.toContain('OTHER-PLT')
        expect(json).not.toContain('13.751234')
        expect(json).not.toContain('https://')
    })

    it('tenant isolation: spoofed cross-tenant vehicle_id rejected, vehicles/history scoped, switch_tenant clears state', async () => {
        const a = setupStaff()
        const b = setupStaff()
        const vehA = insertVehicle(a.tenantId, 'เอ 1111', 'รถ A')
        const vehB = insertVehicle(b.tenantId, 'บี 2222', 'รถ B')

        // Employee B starts flow -> sees only vehB, spoofed vehA rejected
        await b.say('เริ่ม/จบทริป')
        await b.postback('action=trip_consent')
        const pickText = JSON.stringify(b.replies.at(-1))
        expect(pickText).toContain('บี 2222')
        expect(pickText).not.toContain('เอ 1111')

        await b.postback(`action=trip_car&type=COMPANY&vid=${encodeURIComponent(vehA)}`)
        expect(b.replies.at(-1).text).toContain('ไม่พบรถบริษัทที่เลือก')
        expect(vehB).toBeTruthy()

        // switch_tenant clears pending car_trip state before checking the target mapping
        expect(db.prepare("SELECT COUNT(*) c FROM line_pending_tasks WHERE line_user_id = ? AND type = 'car_trip'").get(b.lineUserId)).toEqual({ c: 1 })
        await b.postback(`action=switch_tenant&id=${encodeURIComponent(a.tenantId)}`)
        expect(db.prepare("SELECT COUNT(*) c FROM line_pending_tasks WHERE line_user_id = ? AND type = 'car_trip'").get(b.lineUserId)).toEqual({ c: 0 })
    })

    it('"งานของฉัน": MY_TASKS_URL ว่าง → ข้อความแจ้งปิดใช้งาน · มี URL → buttons URI', async () => {
        const { replies, pushMessage, say } = setupStaff()
        delete process.env.MY_TASKS_URL
        await say('งานของฉัน')
        expect(replies[0]).toEqual({
            type: 'text',
            text: 'ระบบงานของฉันยังไม่เปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
        })

        process.env.MY_TASKS_URL = 'https://tasks.phopy.net/board'
        await say('งานของฉัน')
        expect(replies[1]).toMatchObject({
            type: 'template',
            template: {
                type: 'buttons',
                title: 'งานของฉัน',
                text: 'เปิดระบบงานภายนอก',
                actions: [{ type: 'uri', label: 'เปิดงานของฉัน', uri: 'https://tasks.phopy.net/board' }],
            },
        })
        expect(pushMessage).not.toHaveBeenCalled()
    })

    it('คำสั่งเดิม (สลิป, สถานะ) ยังทำงาน · postback richmenu_switch เงียบไม่ตอบ · helpCard(staff) ครบ', async () => {
        const { tenantId, replies, pushMessage, say, postback } = setupStaff()
        await say('สลิป')
        expect(replies[0].type).toBe('template')
        const url = new URL(replies[0].template.actions[0].uri)
        const token = url.searchParams.get('t')!
        expect(token).toMatch(/^[a-f0-9]{64}$/)
        expect(url.searchParams.get('to')).toBeNull()

        const r1 = await request(app).post('/api/auth/line-login').send({ token })
        expect(r1.status).toBe(200)
        expect(r1.body.data.user.scope).toBe('hr_self')
        const r2 = await request(app).post('/api/auth/line-login').send({ token })
        expect(r2.status).toBe(401)
        expect(tenantId).toBeTruthy()

        await say('สถานะ')
        expect(replies[1].type).toBe('text')

        const before = replies.length
        await postback('action=richmenu_switch&to=staff_car')
        expect(replies.length).toBe(before)
        expect(pushMessage).not.toHaveBeenCalled()

        const helpStr = JSON.stringify(flexTemplates.helpCard('staff'))
        for (const cmd of ['เริ่ม/จบทริป', 'แวะจุด', 'ประวัติทริป', 'สลิป', 'สต็อก [ชื่อ]', 'สถานะ']) {
            expect(helpStr).toContain(cmd)
        }
    })
})
