import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import type { Server } from 'http'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { createTestUser } from './testAuth'
import authRoutes from '../routes/auth.routes'
import attachmentsRoutes from '../routes/attachments.routes'
import hrRoutes from '../routes/hr.routes'
import hrLifecycleRoutes from '../routes/hr.lifecycle.routes'
import hrRecruitRoutes from '../routes/hr.recruit.routes'
import hrLineInviteRoutes from '../routes/hr.lineInvite.routes'
import { createPublicRecruitRouter } from '../routes/hr.recruit.public.routes'
import { lineBotService } from '../services/line-bot.service'

// Regression tests for HR/LINE bug fixes.
const app = express()
app.set('trust proxy', 1)
app.use(express.json())
app.use('/api/auth', authRoutes)
app.use('/api/attachments', authenticate, attachmentsRoutes)
app.use('/api/public/jobs', createPublicRecruitRouter(2))
app.use('/api/hr', authenticate)
app.get('/api/hr/me', (_req, res) => { res.json({ ok: true }) }) // stub allowlisted path, registered first so real handlers do not 404
for (const r of [hrRoutes, hrLifecycleRoutes, hrRecruitRoutes, hrLineInviteRoutes]) app.use('/api/hr', r)

const tenants: string[] = []
const TABLES = ['payment_attachments', 'hr_employee_documents', 'hr_checklist_items', 'hr_applicants', 'hr_job_postings', 'leave_types',
  'line_login_tokens', 'line_link_tokens', 'line_user_mappings', 'employees', 'tenant_subscriptions', 'users']
afterAll(() => {
  vi.restoreAllMocks()
  for (const t of tenants) for (const tb of TABLES) { try { db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t) } catch { /* no tenant_id */ } }
})

const h = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` })
const mk = (role: any, tenantId?: string) => { const u = createTestUser({ role, tenantId }); if (!tenantId) tenants.push(u.tenantId); return u }
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any
const status = (id: string) => one('SELECT status FROM users WHERE id = ?', id).status
const mapRow = (tenantId: string, userId: string, line = 'U' + generateId()) =>
  db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, 'USER')`).run(generateId(), tenantId, userId, line)
function emp(tenantId: string, o: { userId?: string; start?: string; end?: string; status?: string } = {}) {
  const id = generateId()
  db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, last_name, employment_type, base_wage, start_date, end_date, status, user_id)
    VALUES (?, ?, ?, 'ส', 'ด', 'MONTHLY', 30000, ?, ?, ?, ?)`).run(id, tenantId, `B${id.slice(0, 8)}`, o.start ?? '2024-01-01', o.end ?? null, o.status ?? 'ACTIVE', o.userId ?? null)
  return id
}
function checklistItem(tenantId: string, employeeId: string, action: string) {
  const id = generateId()
  db.prepare(`INSERT INTO hr_checklist_items (id, tenant_id, employee_id, kind, title, auto_action, sort_order) VALUES (?, ?, ?, 'OFFBOARD', 'x', ?, 1)`).run(id, tenantId, employeeId, action)
  return id
}

describe('HR bugfix regressions', () => {
  let server: Server
  beforeAll(() => { server = app.listen(0) })
  afterAll(() => { server.close() })
  const api = () => request(server)

  it('1. attachments/counts: HR user 1, non-owner USER 0, owner 1', async () => {
    const a = mk('ADMIN'), t = a.tenantId
    const owner = mk('USER', t), other = mk('USER', t)
    const e = emp(t, { userId: owner.userId }), doc = generateId()
    db.prepare(`INSERT INTO hr_employee_documents (id, tenant_id, employee_id, doc_type, title, created_at) VALUES (?, ?, ?, 'OTHER', 't', ?)`).run(doc, t, e, new Date().toISOString())
    db.prepare(`INSERT INTO payment_attachments (id, tenant_id, ref_type, ref_id, file_path, original_name, file_size, uploaded_by, created_at) VALUES (?, ?, 'EMPLOYEE_DOCUMENT', ?, 'f.pdf', 'f.pdf', 1, ?, ?)`)
      .run(generateId(), t, doc, a.userId, new Date().toISOString())
    const key = `EMPLOYEE_DOCUMENT:${doc}`
    const get = async (u: any) => { const r = await api().get(`/api/attachments/counts?refs=${key}`).set(h(u)); expect(r.status).toBe(200); return r.body.data[key] ?? 0 }
    expect(await get(a)).toBe(1)
    expect(await get(other)).toBe(0)
    expect(await get(owner)).toBe(1)
  }, 30000)

  it('2a. DISABLE_USER: hr-write MANAGER cannot disable an ADMIN; ADMIN caller can', async () => {
    const a = mk('ADMIN'), t = a.tenantId
    const mgr = mk('MANAGER', t)
    db.prepare('UPDATE users SET custom_permissions = ? WHERE id = ?').run(JSON.stringify({ 'hr:read': true, 'hr:write': true }), mgr.userId)
    const target = mk('ADMIN', t), e = emp(t, { userId: target.userId }), item = checklistItem(t, e, 'DISABLE_USER')
    const r = await api().put(`/api/hr/checklist-items/${item}`).set(h(mgr)).send({ done: true })
    expect(r.status).toBe(400)
    expect(status(target.userId)).toBe('active')
    expect((await api().put(`/api/hr/checklist-items/${item}`).set(h(a)).send({ done: true })).status).toBe(200)
    expect(status(target.userId)).toBe('inactive')
  }, 30000)

  it('2b. DISABLE_USER runs only on the first tick', async () => {
    const a = mk('ADMIN'), t = a.tenantId, target = mk('USER', t)
    const e = emp(t, { userId: target.userId }), item = checklistItem(t, e, 'DISABLE_USER')
    expect((await api().put(`/api/hr/checklist-items/${item}`).set(h(a)).send({ done: true })).status).toBe(200)
    expect(status(target.userId)).toBe('inactive')
    db.prepare(`UPDATE users SET status = 'active' WHERE id = ?`).run(target.userId)
    expect((await api().put(`/api/hr/checklist-items/${item}`).set(h(a)).send({ done: true })).status).toBe(200)
    expect(status(target.userId)).toBe('active')
  }, 30000)

  it('3. UNLINK_LINE deletes mappings + login tokens of that user in this company only', async () => {
    const a = mk('ADMIN'), b = mk('ADMIN'), t = a.tenantId
    const target = mk('USER', t), foreign = mk('USER', b.tenantId)
    const e = emp(t, { userId: target.userId }), item = checklistItem(t, e, 'UNLINK_LINE')
    const tok = db.prepare(`INSERT INTO line_login_tokens (token_hash, tenant_id, user_id, expires_at) VALUES (?, ?, ?, ?)`)
    mapRow(t, target.userId); mapRow(b.tenantId, foreign.userId)
    const exp = new Date(Date.now() + 600000).toISOString()
    tok.run('h' + generateId(), t, target.userId, exp); tok.run('h' + generateId(), b.tenantId, foreign.userId, exp)
    expect((await api().put(`/api/hr/checklist-items/${item}`).set(h(a)).send({ done: true })).status).toBe(200)
    for (const tb of ['line_user_mappings', 'line_login_tokens']) {
      expect(one(`SELECT COUNT(*) c FROM ${tb} WHERE tenant_id = ? AND user_id = ?`, t, target.userId).c, tb).toBe(0)
      expect(one(`SELECT COUNT(*) c FROM ${tb} WHERE tenant_id = ? AND user_id = ?`, b.tenantId, foreign.userId).c, tb).toBe(1)
    }
  }, 30000)

  it('4. final-pay: TERMINATED gets severance, RESIGNED gets none, leave payout unchanged', async () => {
    const a = mk('ADMIN'), t = a.tenantId
    db.prepare(`INSERT INTO leave_types (id, tenant_id, code, name, paid, days_per_year, is_active) VALUES (?, ?, 'VACATION', 'พักร้อน', 1, 6, 1)`).run(generateId(), t)
    const fire = emp(t, { start: '2024-01-01', end: '2026-01-01', status: 'TERMINATED' })
    const quit = emp(t, { start: '2024-01-01', end: '2026-01-01', status: 'RESIGNED' })
    const f = (await api().get(`/api/hr/employees/${fire}/final-pay`).set(h(a))).body.data
    const q = (await api().get(`/api/hr/employees/${quit}/final-pay`).set(h(a))).body.data
    expect(f.severanceDays).toBe(90)
    expect(f.severanceAmount).toBeGreaterThan(0)
    expect(q.severanceDays).toBe(0)
    expect(q.severanceAmount).toBe(0)
    expect(f.leavePayout).toBeGreaterThan(0)
    expect(q.leavePayout).toBe(f.leavePayout)
  }, 30000)

  it('5. offboard: line_only user disabled + unmapped; normal user untouched', async () => {
    const a = mk('ADMIN'), t = a.tenantId
    const lo = mk('USER', t), normal = mk('USER', t)
    db.prepare('UPDATE users SET line_only = 1 WHERE id = ?').run(lo.userId)
    mapRow(t, lo.userId); mapRow(t, normal.userId)
    for (const u of [lo, normal]) {
      const r = await api().post(`/api/hr/employees/${emp(t, { userId: u.userId })}/offboard`).set(h(a)).send({ end_date: '2026-11-01', status: 'RESIGNED' })
      expect(r.status).toBe(200)
    }
    const maps = (u: string) => one('SELECT COUNT(*) c FROM line_user_mappings WHERE tenant_id = ? AND user_id = ?', t, u).c
    expect(status(lo.userId)).toBe('inactive'); expect(maps(lo.userId)).toBe(0)
    expect(status(normal.userId)).toBe('active'); expect(maps(normal.userId)).toBe(1)
  }, 30000)

  it('6. hr_self token stops working once the LINE mapping is removed', async () => {
    const a = mk('ADMIN'), t = a.tenantId
    mapRow(t, a.userId)
    const tk = new URL(lineBotService.createLoginLink(t, a.userId)).searchParams.get('t')!
    const ex = await api().post('/api/auth/line-login').send({ token: tk })
    expect(ex.status).toBe(200)
    const auth = { Authorization: `Bearer ${ex.body.data.token}` }
    expect((await api().get('/api/hr/me').set(auth)).status).toBe(200)
    db.prepare('DELETE FROM line_user_mappings WHERE tenant_id = ? AND user_id = ?').run(t, a.userId)
    expect((await api().get('/api/hr/me').set(auth)).status).toBe(403)
  }, 30000)

  it('7. line-invite refuses an inactive linked user (409) and creates no token', async () => {
    const a = mk('ADMIN'), t = a.tenantId, u = mk('USER', t)
    db.prepare(`UPDATE users SET status = 'inactive' WHERE id = ?`).run(u.userId)
    const e = emp(t, { userId: u.userId })
    expect((await api().post(`/api/hr/employees/${e}/line-invite`).set(h(a))).status).toBe(409)
    expect(one('SELECT COUNT(*) c FROM line_link_tokens WHERE tenant_id = ? AND user_id = ?', t, u.userId).c).toBe(0)
  }, 30000)

  it('8. public recruit: apply limit (2) gives 429 on 3rd, view still 200', async () => {
    const a = mk('ADMIN'), t = a.tenantId
    const tokenStr = generateId() + generateId()
    const tokenHex = (tokenStr.replace(/[^0-9a-f]/g, '') + '0'.repeat(32)).slice(0, 32)
    db.prepare(`INSERT INTO hr_job_postings (id, tenant_id, title, public_token, is_open, created_at) VALUES (?, ?, 'ตำแหน่ง', ?, 1, ?)`).run(generateId(), t, tokenHex, new Date().toISOString())
    const ip = '10.77.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250)
    const apply = (body: any) => api().post(`/api/public/jobs/${tokenHex}/apply`).set('X-Forwarded-For', ip).send(body)
    expect((await apply({ full_name: 'สมชาย ใจดี', phone: '0812345678', consent: true })).status).toBe(201)
    expect((await apply({ full_name: 'x' })).status).toBe(400)
    expect((await apply({ full_name: 'สมหญิง ใจดี', phone: '0812345678', consent: true })).status).toBe(429)
    expect((await api().get(`/api/public/jobs/${tokenHex}`).set('X-Forwarded-For', ip)).status).toBe(200)
  }, 30000)

  it('9. recruit 500 does not leak the thrown error text', async () => {
    const a = mk('ADMIN')
    const real = db.prepare.bind(db)
    const spy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      if (sql.includes('applicant_count')) throw new Error('SECRET_INTERNAL_DETAIL_xyz')
      return real(sql)
    }) as any)
    try {
      const r = await api().get('/api/hr/job-postings').set(h(a))
      expect(r.status).toBe(500)
      expect(JSON.stringify(r.body)).not.toContain('SECRET_INTERNAL_DETAIL_xyz')
    } finally { spy.mockRestore() }
  }, 30000)
})
