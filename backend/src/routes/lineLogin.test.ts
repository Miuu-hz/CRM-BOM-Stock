import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import authRoutes from './auth.routes'
import { authenticate } from '../middleware/auth.middleware'
import { hrSelfAllowed } from '../middleware/hrSelfScope'
import { lineBotService } from '../services/line-bot.service'

/** ลิงก์จาก LINE → token scope hr_self: ใช้ครั้งเดียว, ถือสิทธิ์แค่พนักงาน, ออกนอกหน้า "ของฉัน" ไม่ได้ */
const app = express()
app.use(express.json())
app.use('/api/auth', authRoutes)
app.all(/^\/api\/.*/, authenticate, (req, res) => { res.json({ role: req.user!.role, departments: req.user!.departments, perms: req.user!.customPermissions ?? null }) })

const tenants: string[] = []
afterEach(() => {
    for (const t of tenants.splice(0)) for (const tb of ['line_user_mappings', 'line_login_tokens', 'users']) db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t)
})
function admin(linked = true) {
    const tenantId = 'tenant_ll_' + generateId().slice(0, 8); tenants.push(tenantId)
    const userId = generateId()
    db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status, custom_permissions) VALUES (?, ?, 'x', 'แอดมิน', 'ADMIN', ?, 'active', ?)`)
        .run(userId, `${userId}@example.com`, tenantId, JSON.stringify({ 'hr:write': true }))
    if (linked) db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, 'ADMIN')`).run(generateId(), tenantId, userId, 'U' + generateId())
    return { tenantId, userId }
}
const tokenOf = (link: string) => new URL(link).searchParams.get('t')!
const exchange = (token: unknown) => request(app).post('/api/auth/line-login').send({ token })

describe('LINE login link (scope hr_self)', () => {
    it('แลกได้ครั้งเดียว · ได้ token ที่ถือสิทธิ์แค่ USER แม้บัญชีจริงเป็น ADMIN · ไม่มี refresh token', async () => {
        const a = admin()
        const t = tokenOf(lineBotService.createLoginLink(a.tenantId, a.userId))
        const r = await exchange(t)
        expect(r.status).toBe(200)
        expect(r.body.data.refreshToken).toBeUndefined()
        expect(r.body.data.user.role).toBe('USER')
        expect((await exchange(t)).status, 'ใช้ซ้ำไม่ได้').toBe(401)

        const auth = { Authorization: `Bearer ${r.body.data.token}` }
        const ok = await request(app).get('/api/hr/me/slips').set(auth)
        expect(ok.status).toBe(200)
        expect(ok.body).toEqual({ role: 'USER', departments: [], perms: null })
        for (const [m, p] of [['get', '/api/hr/employees'], ['get', '/api/hr/payroll-runs'], ['post', '/api/hr/employees'], ['get', '/api/users'],
            ['get', '/api/journal'], ['get', '/api/hr/me/../employees'], ['get', '/api/hr/metrics'], ['delete', '/api/hr/me/advances'], ['post', '/api/auth/create-child']] as const) {
            const res = await (request(app) as any)[m](p).set(auth)
            expect([403, 404], `${m} ${p}`).toContain(res.status)
            expect(res.body.role, `${m} ${p} ต้องไม่ถึง handler`).toBeUndefined()
        }
    })

    it('ลิงก์หมดอายุ / token มั่ว / ยกเลิกผูก LINE แล้ว / บัญชีถูกปิด → 401 ทั้งหมด', async () => {
        const a = admin()
        const expired = tokenOf(lineBotService.createLoginLink(a.tenantId, a.userId))
        db.prepare('UPDATE line_login_tokens SET expires_at = ? WHERE tenant_id = ?').run(new Date(Date.now() - 1000).toISOString(), a.tenantId)
        expect((await exchange(expired)).status).toBe(401)
        for (const bad of ['', 'x', 'a'.repeat(64), null, { $ne: '' }, ['a']]) expect((await exchange(bad)).status).toBe(401)

        const unlinked = tokenOf(lineBotService.createLoginLink(a.tenantId, a.userId))
        db.prepare('DELETE FROM line_user_mappings WHERE tenant_id = ?').run(a.tenantId)
        expect((await exchange(unlinked)).status).toBe(401)

        const b = admin()
        const t = tokenOf(lineBotService.createLoginLink(b.tenantId, b.userId))
        db.prepare(`UPDATE users SET status = 'inactive' WHERE id = ?`).run(b.userId)
        expect((await exchange(t)).status).toBe(401)
    })

    it('token scope hr_self ที่ออกไปแล้ว ใช้ไม่ได้ทันทีเมื่อบัญชีถูกปิด', async () => {
        const a = admin()
        const r = await exchange(tokenOf(lineBotService.createLoginLink(a.tenantId, a.userId)))
        db.prepare(`UPDATE users SET status = 'inactive' WHERE id = ?`).run(a.userId)
        expect((await request(app).get('/api/hr/me').set({ Authorization: `Bearer ${r.body.data.token}` })).status).toBe(401)
    })

    it('allowlist: เฉพาะเส้นทางของตัวเอง', () => {
        const yes: [string, string][] = [['GET', '/api/hr/me'], ['GET', '/api/hr/me/roster/day?date=2026-11-12'], ['POST', '/api/hr/me/shift-swaps/abc/accept'], ['POST', '/api/hr/checkin'],
            ['GET', '/api/hr/checkin/location'], ['POST', '/api/hr/leave-requests'], ['POST', '/api/hr/leave-requests/a_b-1/cancel'], ['GET', '/api/subscription/me']]
        const no: [string, string][] = [['POST', '/api/hr/checkin/pin'], ['GET', '/api/hr/leave-requests/x'], ['PUT', '/api/hr/me'], ['DELETE', '/api/hr/me/x'], ['GET', '/api/hr/menu'],
            ['POST', '/api/hr/leave-requests/x/approve'], ['GET', '/api/hr/me/%2e%2e/employees'], ['GET', '/api/hr/employees?x=/api/hr/me'], ['GET', '/api/attachments/EMPLOYEE_DOCUMENT/1'], ['GET', '/hr/me']]
        for (const [m, p] of yes) expect(hrSelfAllowed(m, p), `${m} ${p}`).toBe(true)
        for (const [m, p] of no) expect(hrSelfAllowed(m, p), `${m} ${p}`).toBe(false)
    })
})
