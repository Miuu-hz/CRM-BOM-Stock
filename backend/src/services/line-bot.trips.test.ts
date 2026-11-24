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
let prevTasksUrl: string | undefined

afterEach(() => {
    vi.restoreAllMocks()
    if (prevTasksUrl === undefined) delete process.env.MY_TASKS_URL
    else process.env.MY_TASKS_URL = prevTasksUrl
    for (const t of tenants.splice(0)) {
        for (const tb of ['employees', 'line_user_mappings', 'line_group_mappings', 'line_login_tokens', 'users', 'company_settings']) {
            db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t)
        }
    }
})

function setupStaff(opts?: { employeeStatus?: string | null }) {
    prevTasksUrl = process.env.MY_TASKS_URL
    delete process.env.MY_TASKS_URL
    const tenantId = 'tenant_lbt_' + generateId().slice(0, 8)
    tenants.push(tenantId)
    const userId = generateId()
    const lineUserId = 'U' + generateId()
    db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', 'สมชาย', 'USER', ?, 'active')`)
        .run(userId, `${userId}@example.com`, tenantId)
    db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, 'USER')`)
        .run(generateId(), tenantId, userId, lineUserId)
    try { db.prepare(`INSERT INTO company_settings (id, tenant_id, name) VALUES (?, ?, 'บริษัททดสอบ')`).run(generateId(), tenantId) }
    catch { db.prepare(`INSERT INTO company_settings (tenant_id, name) VALUES (?, 'บริษัททดสอบ')`).run(tenantId) }

    if (opts?.employeeStatus !== null) {
        db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, last_name, employment_type, base_wage, start_date, status, user_id) VALUES (?, ?, ?, 'สมชาย', 'ใจดี', 'MONTHLY', 15000, '2026-01-01', ?, ?)`)
            .run(generateId(), tenantId, 'E' + userId.slice(0, 5), opts?.employeeStatus ?? 'ACTIVE', userId)
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
    const postback = (data: string) =>
        send({ type: 'postback', postback: { data }, source: { type: 'user', userId: lineUserId } })

    return { tenantId, userId, lineUserId, replies, pushMessage, say, postback }
}

describe('LINE Bot — เมนูใช้งานรถยนต์, งานของฉัน และ One-time Link', () => {
    it('คำสั่งทริปรถยนต์: ตอบลิงก์ใช้ครั้งเดียวตรง ?t=<64hex>&to=... และไม่ push', async () => {
        const { replies, pushMessage, say } = setupStaff()

        const cases: [string, string][] = [
            ['เริ่ม/จบทริป', 'trips'],
            ['เริ่มทริป', 'trips'],
            ['จบทริป', 'trips'],
            ['ใช้งานรถยนต์', 'trips'],
            ['แวะจุด', 'trips_stop'],
            ['ประวัติทริป', 'trips_history'],
        ]
        for (const [cmd, expectedTo] of cases) {
            await say(cmd)
            const msg = replies.at(-1)
            expect(msg.type).toBe('template')
            const uriStr = msg.template.actions[0].uri as string
            const u = new URL(uriStr)
            expect(u.pathname).toBe('/line-login')
            expect(u.searchParams.get('t')).toMatch(/^[a-f0-9]{64}$/)
            expect(u.searchParams.get('to')).toBe(expectedTo)
            expect(msg.template.text).toContain('ลิงก์ใช้ได้ครั้งเดียว ภายใน 5 นาที')
        }
        expect(pushMessage).not.toHaveBeenCalled()
    })

    it('คำสั่งทริปในกลุ่ม → ปฏิเสธ · ยังไม่ผูกทะเบียนพนักงานหรือลาออก → ปฏิเสธ', async () => {
        const g1 = setupStaff()
        await g1.say('เริ่ม/จบทริป', { type: 'group', groupId: 'G1', userId: g1.lineUserId })
        expect(g1.replies[0].type).toBe('text')
        expect(g1.replies[0].text).toContain('แชทส่วนตัว')

        const noEmp = setupStaff({ employeeStatus: null })
        await noEmp.say('แวะจุด')
        expect(noEmp.replies[0].type).toBe('text')
        expect(noEmp.replies[0].text).toContain('ยังไม่ได้ผูกกับทะเบียนพนักงาน')

        const resigned = setupStaff({ employeeStatus: 'RESIGNED' })
        await resigned.say('ประวัติทริป')
        expect(resigned.replies[0].type).toBe('text')
        expect(resigned.replies[0].text).toContain('ยังไม่ได้ผูกกับทะเบียนพนักงาน')
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
        const { replies, pushMessage, say, postback } = setupStaff()
        await say('สลิป')
        expect(replies[0].type).toBe('template')
        expect(new URL(replies[0].template.actions[0].uri).searchParams.get('to')).toBeNull()

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

    it('POST /api/auth/line-login: แลก token จากคำสั่งทริปได้ครั้งเดียว (scope hr_self, ไม่มี refreshToken) · ซ้ำ/หมดอายุ → 401', async () => {
        const { tenantId, replies, say } = setupStaff()
        await say('แวะจุด')
        const url = new URL(replies[0].template.actions[0].uri)
        const token = url.searchParams.get('t')!
        expect(url.searchParams.get('to')).toBe('trips_stop')

        const r1 = await request(app).post('/api/auth/line-login').send({ token })
        expect(r1.status).toBe(200)
        expect(r1.body.data.user.scope).toBe('hr_self')
        expect(r1.body.data.refreshToken).toBeUndefined()

        const r2 = await request(app).post('/api/auth/line-login').send({ token })
        expect(r2.status).toBe(401)

        // Token expired
        await say('ประวัติทริป')
        const tExp = new URL(replies[1].template.actions[0].uri).searchParams.get('t')!
        db.prepare('UPDATE line_login_tokens SET expires_at = ? WHERE tenant_id = ?')
            .run(new Date(Date.now() - 1000).toISOString(), tenantId)
        const rExp = await request(app).post('/api/auth/line-login').send({ token: tExp })
        expect(rExp.status).toBe(401)
    })
})
