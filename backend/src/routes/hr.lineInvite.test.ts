import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { createTestUser } from '../test/testAuth'
import hrLineInviteRoutes from './hr.lineInvite.routes'
import authRoutes from './auth.routes'

const app = express()
app.use(express.json())
app.use('/api/auth', authRoutes)
app.use('/api/hr', authenticate, hrLineInviteRoutes)

const tenants: string[] = []
afterEach(() => { for (const t of tenants.splice(0)) for (const tb of ['employees', 'line_link_tokens', 'users']) db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t) })
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
})
