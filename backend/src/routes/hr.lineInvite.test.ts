import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { createTestUser } from '../test/testAuth'
import hrLineInviteRoutes from './hr.lineInvite.routes'
import hrRoutes from './hr.routes'
import userRoutes from './user.routes'
import authRoutes from './auth.routes'

const app = express()
app.use(express.json())
app.use('/api/auth', authRoutes)
app.use('/api/hr', authenticate, hrLineInviteRoutes)
app.use('/api/hr', authenticate, hrRoutes)
app.use('/api/users', userRoutes)

const tenants: string[] = []
afterEach(() => { for (const t of tenants.splice(0)) for (const tb of ['employees', 'line_link_tokens', 'line_user_mappings', 'users']) db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t) })
function emp(tenantId: string, status = 'ACTIVE') {
    const id = generateId()
    db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, last_name, employment_type, base_wage, start_date, status) VALUES (?, ?, ?, 'มาลี', 'ใจดี', 'DAILY', 400, '2026-01-01', ?)`).run(id, tenantId, 'E' + id.slice(0, 6), status)
    return id
}

describe('เชิญพนักงานเข้า LINE (ไม่มีบัญชี ERP)', () => {
    it('สร้างบัญชี LINE อย่างเดียว + รหัส 6 หลัก · กดซ้ำไม่สร้างบัญชีซ้อน · ล็อกอินด้วยรหัสผ่านไม่ได้', async () => {
        const admin = await createTestUser({ role: 'ADMIN' }); tenants.push(admin.tenantId)
        const id = emp(admin.tenantId)
        const r1 = await request(app).post(`/api/hr/employees/${id}/line-invite`).set('Authorization', `Bearer ${admin.token}`)
        expect(r1.status).toBe(201)
        expect(r1.body.data.code).toMatch(/^\d{6}$/)
        expect(r1.body.data.created_line_only_account).toBe(true)
        const u = db.prepare('SELECT u.* FROM users u JOIN employees e ON e.user_id = u.id WHERE e.id = ?').get(id) as any
        expect([u.role, u.line_only, u.tenant_id]).toEqual(['USER', 1, admin.tenantId])

        const r2 = await request(app).post(`/api/hr/employees/${id}/line-invite`).set('Authorization', `Bearer ${admin.token}`)
        expect(r2.body.data.created_line_only_account).toBe(false)
        expect((db.prepare('SELECT COUNT(*) c FROM users WHERE tenant_id = ? AND line_only = 1').get(admin.tenantId) as any).c).toBe(1)

        // ผู้ดูแลตั้งรหัสผ่านให้ภายหลังก็ยังล็อกอินไม่ได้
        db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync('Passw0rd!x', 4), u.id)
        const login = await request(app).post('/api/auth/login').send({ email: u.email, password: 'Passw0rd!x' })
        expect(login.status).toBe(401)
    })

    it('ไม่มีสิทธิ์ hr → 403 · พนักงานบริษัทอื่น → 404 · ออกงานแล้ว → 409', async () => {
        const admin = await createTestUser({ role: 'ADMIN' }); tenants.push(admin.tenantId)
        const other = await createTestUser({ role: 'ADMIN' }); tenants.push(other.tenantId)
        const staff = await createTestUser({ role: 'USER', tenantId: admin.tenantId } as any)
        const id = emp(admin.tenantId)
        expect((await request(app).post(`/api/hr/employees/${id}/line-invite`).set('Authorization', `Bearer ${staff.token}`)).status).toBe(403)
        expect((await request(app).post(`/api/hr/employees/${id}/line-invite`).set('Authorization', `Bearer ${other.token}`)).status).toBe(404)
        expect((await request(app).post(`/api/hr/employees/${emp(admin.tenantId, 'RESIGNED')}/line-invite`).set('Authorization', `Bearer ${admin.token}`)).status).toBe(409)
        expect((db.prepare('SELECT COUNT(*) c FROM users WHERE line_only = 1 AND tenant_id IN (?, ?)').get(admin.tenantId, other.tenantId) as any).c).toBe(0)
    })

    it('มีบัญชี ERP ชื่อเดียวกันที่ยังไม่ผูก → 409 ไม่สร้างซ้ำ · ยืนยันคนละคน (new_account) ถึงสร้าง', async () => {
        const admin = await createTestUser({ role: 'ADMIN' }); tenants.push(admin.tenantId)
        const erp = await createTestUser({ role: 'USER', tenantId: admin.tenantId })
        db.prepare("UPDATE users SET name = 'มาลี ใจดี' WHERE id = ?").run(erp.userId)
        const id = emp(admin.tenantId)
        const invite = (body?: object) => request(app).post(`/api/hr/employees/${id}/line-invite`).set('Authorization', `Bearer ${admin.token}`).send(body)
        const r1 = await invite()
        expect([r1.status, r1.body.code]).toEqual([409, 'ERP_ACCOUNT_EXISTS'])
        expect((db.prepare('SELECT COUNT(*) c FROM users WHERE tenant_id = ? AND line_only = 1').get(admin.tenantId) as any).c).toBe(0)
        expect((await invite({ new_account: true })).status).toBe(201)
    })

    it('ผูกบัญชี: เฉพาะ Admin · ย้าย LINE ตามไปและปิดบัญชี LINE เดิม · HR เชิญบัญชี role สูงกว่าไม่ได้', async () => {
        const admin = await createTestUser({ role: 'ADMIN' }); tenants.push(admin.tenantId)
        const T = admin.tenantId
        const erp = await createTestUser({ role: 'USER', tenantId: T })
        const hr = await createTestUser({ role: 'USER', tenantId: T })
        db.prepare(`UPDATE users SET departments = '["HR"]' WHERE id = ?`).run(hr.userId)
        const id = emp(T)
        await request(app).post(`/api/hr/employees/${id}/line-invite`).set('Authorization', `Bearer ${admin.token}`)
        const old = (db.prepare('SELECT user_id FROM employees WHERE id = ?').get(id) as any).user_id
        db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, 'USER')`).run(generateId(), T, old, 'U' + id)
        const put = (token: string, user_id: string | null) => request(app).put(`/api/hr/employees/${id}`).set('Authorization', `Bearer ${token}`)
            .send({ code: 'E1', first_name: 'มาลี', employment_type: 'DAILY', base_wage: 400, start_date: '2026-01-01', user_id })

        expect((await put(hr.token, erp.userId)).status).toBe(403)
        expect((await put(hr.token, old)).status).toBe(200) // ไม่ได้เปลี่ยนการผูก HR ยังแก้ข้อมูลได้

        expect((await put(admin.token, erp.userId)).status).toBe(200)
        expect((db.prepare('SELECT status FROM users WHERE id = ?').get(old) as any).status).toBe('inactive')
        expect((db.prepare('SELECT user_id FROM line_user_mappings WHERE tenant_id = ?').all(T) as any[]).map(m => m.user_id)).toEqual([erp.userId])
        expect((db.prepare('SELECT COUNT(*) c FROM line_link_tokens WHERE user_id = ?').get(old) as any).c).toBe(0)

        const list = await request(app).get('/api/users').set('Authorization', `Bearer ${admin.token}`)
        expect(list.body.data.map((u: any) => u.id)).not.toContain(old)
        expect(list.body.data.find((u: any) => u.id === erp.userId).employee_code).toBe('E1')

        expect((await put(admin.token, admin.userId)).status).toBe(200)
        expect((await request(app).post(`/api/hr/employees/${id}/line-invite`).set('Authorization', `Bearer ${hr.token}`)).status).toBe(403)
    })
})
