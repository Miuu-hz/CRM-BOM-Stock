import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import hrRecruitRoutes from './hr.recruit.routes'
import { createPublicRecruitRouter } from './hr.recruit.public.routes'
import { createTestUser } from '../test/testAuth'

function buildApp(limit = 1000) {
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.use('/api/public/jobs', createPublicRecruitRouter(limit))
  app.use('/api/hr', authenticate, subscriptionGate('hr'))
  app.use('/api/hr', hrRecruitRoutes)
  return app
}

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tb of ['hr_applicants', 'hr_job_postings', 'employees', 'company_settings', 'tenant_subscriptions', 'users']) {
      db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t)
    }
  }
})

function newUser(role: 'ADMIN' | 'USER', tenantId?: string) {
  const u = createTestUser({ role, tenantId })
  if (!tenantId) tenants.push(u.tenantId)
  return u
}
const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` })
const OK_BODY = { full_name: 'สมชาย ใจดี', phone: '081-234-5678', consent: true }

describe('HR recruit (Phase 11)', () => {
  const app = buildApp()

  async function mkPosting(u: ReturnType<typeof newUser>, extra: any = {}) {
    const r = await request(app).post('/api/hr/job-postings').set(auth(u)).send({ title: 'แคชเชียร์', ...extra })
    return r.body.data
  }
  async function apply(token: string, body: any = OK_BODY) {
    return request(app).post(`/api/public/jobs/${token}/apply`).send(body)
  }

  it('posting CRUD: token generated once, immutable; permission 403; cross-company 404', async () => {
    const a = newUser('ADMIN')
    const b = newUser('ADMIN')
    const p = await mkPosting(a)
    expect(p.public_token).toMatch(/^[0-9a-f]{32}$/)
    const put = await request(app).put(`/api/hr/job-postings/${p.id}`).set(auth(a)).send({ title: 'ใหม่', is_open: false, public_token: 'x' })
    expect(put.status).toBe(200)
    expect(put.body.data.public_token).toBe(p.public_token)
    expect(put.body.data.is_open).toBe(false)
    expect((await request(app).put(`/api/hr/job-postings/${p.id}`).set(auth(b)).send({ title: 'x' })).status).toBe(404)
    expect((await request(app).get('/api/hr/job-postings').set(auth(b))).body.data).toEqual([])
    const u = newUser('USER')
    expect((await request(app).get('/api/hr/job-postings').set(auth(u))).status).toBe(403)
    expect((await request(app).post('/api/hr/job-postings').set(auth(u)).send({ title: 'x' })).status).toBe(403)
    expect((await request(app).post('/api/hr/job-postings').set(auth(a)).send({ title: '' })).status).toBe(400)
    expect((await request(app).post('/api/hr/job-postings').set(auth(a)).send({ title: 'x', org_unit_id: 'nope' })).status).toBe(400)
  })

  it('QR: png data url + link; cross-company 404; no hr 403', async () => {
    const a = newUser('ADMIN')
    const b = newUser('ADMIN')
    const p = await mkPosting(a)
    const r = await request(app).get(`/api/hr/job-postings/${p.id}/qr`).set(auth(a))
    expect(r.status).toBe(200)
    expect(r.body.data.qr).toMatch(/^data:image\/png;base64,/)
    expect(r.body.data.url).toBe(`${process.env.APP_URL ?? 'https://erp.phopy.net'}/apply/${p.public_token}`)
    expect((await request(app).get(`/api/hr/job-postings/${p.id}/qr`).set(auth(b))).status).toBe(404)
    expect((await request(app).get(`/api/hr/job-postings/${p.id}/qr`).set(auth(newUser('USER')))).status).toBe(403)
  })

  it('public: get/apply happy path, no internal ids, closed/unknown identical 404', async () => {
    const a = newUser('ADMIN')
    db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(a.tenantId, 'บริษัทเอ')
    const p = await mkPosting(a, { description: 'รายละเอียด' })
    const g = await request(app).get(`/api/public/jobs/${p.public_token}`)
    expect(g.body).toEqual({ success: true, data: { title: 'แคชเชียร์', description: 'รายละเอียด', company_name: 'บริษัทเอ' } })
    expect(JSON.stringify(g.body)).not.toContain(a.tenantId)
    const ok = await apply(p.public_token, { ...OK_BODY, email: 'a@b.co', note: 'hi' })
    expect(ok.status).toBe(201)
    expect(ok.body).toEqual({ success: true })
    const row = db.prepare('SELECT * FROM hr_applicants WHERE tenant_id = ?').get(a.tenantId) as any
    expect(row.source).toBe('PUBLIC')
    expect(row.stage).toBe('APPLIED')
    expect(row.purge_after > row.created_at.slice(0, 10)).toBe(true)
    await request(app).put(`/api/hr/job-postings/${p.id}`).set(auth(a)).send({ is_open: false })
    const closed = await request(app).get(`/api/public/jobs/${p.public_token}`)
    const unknown = await request(app).get(`/api/public/jobs/${'0'.repeat(32)}`)
    expect(closed.status).toBe(404)
    expect(closed.body).toEqual(unknown.body)
    expect((await apply(p.public_token)).status).toBe(404)
  })

  it('public: validation and honeypot', async () => {
    const a = newUser('ADMIN')
    const p = await mkPosting(a)
    const t = p.public_token
    const bads: any[] = [
      { ...OK_BODY, consent: 'true' }, { ...OK_BODY, consent: false },
      { ...OK_BODY, full_name: 'ก' }, { ...OK_BODY, full_name: 'ก'.repeat(121) }, { ...OK_BODY, full_name: 123 },
      { ...OK_BODY, phone: '12345' }, { ...OK_BODY, phone: 'abcdefghij' }, { ...OK_BODY, phone: ['0812345678'] },
      { ...OK_BODY, email: 'a'.repeat(201) }, { ...OK_BODY, note: 'x'.repeat(2001) },
      { ...OK_BODY, stage: 'HIRED' }, { ...OK_BODY, tenant_id: 'x' },
    ]
    for (const body of bads) expect((await apply(t, body)).status).toBe(400)
    expect((await request(app).post(`/api/public/jobs/${t}/apply`).send('[1]')).status).toBe(400)
    const hp = await apply(t, { ...OK_BODY, website: 'http://spam' })
    expect(hp.status).toBe(201)
    expect(hp.body).toEqual({ success: true })
    expect((db.prepare('SELECT COUNT(*) c FROM hr_applicants WHERE tenant_id = ?').get(a.tenantId) as any).c).toBe(0)
  })

  it('public: rate limit returns 429 after max requests', async () => {
    const limited = buildApp(3)
    // ส่งใบสมัครจำกัดที่ max · เปิดดูประกาศได้ถี่กว่า (max × 6) เพราะหลายคนใช้ IP เดียวกัน
    const url = `/api/public/jobs/${'0'.repeat(32)}`
    for (let i = 0; i < 3; i++) await request(limited).post(`${url}/apply`).send({})
    expect((await request(limited).post(`${url}/apply`).send({})).status).toBe(429)
    expect((await request(limited).get(url)).status, 'เปิดดูประกาศยังไม่โดนจำกัด').toBe(404)
  })

  it('applicants: list/filter, stage update, HIRED via PUT rejected, cross-company 404, 403', async () => {
    const a = newUser('ADMIN')
    const b = newUser('ADMIN')
    const p = await mkPosting(a)
    await apply(p.public_token)
    const list = (await request(app).get(`/api/hr/applicants?posting_id=${p.id}&stage=APPLIED`).set(auth(a))).body.data
    expect(list).toHaveLength(1)
    const id = list[0].id
    const up = await request(app).put(`/api/hr/applicants/${id}`).set(auth(a)).send({ stage: 'INTERVIEW', interview_at: '2026-12-01T10:00', interview_note: 'ok' })
    expect(up.body.data.stage).toBe('INTERVIEW')
    expect((await request(app).put(`/api/hr/applicants/${id}`).set(auth(a)).send({ stage: 'HIRED' })).status).toBe(400)
    expect((await request(app).put(`/api/hr/applicants/${id}`).set(auth(a)).send({ stage: 'BOGUS' })).status).toBe(400)
    expect((await request(app).put(`/api/hr/applicants/${id}`).set(auth(b)).send({ stage: 'TRIAL' })).status).toBe(404)
    expect((await request(app).get('/api/hr/applicants').set(auth(b))).body.data).toEqual([])
    const u = newUser('USER')
    expect((await request(app).get('/api/hr/applicants').set(auth(u))).status).toBe(403)
  })

  it('PDPA purge: only this company, only expired, never HIRED', async () => {
    const a = newUser('ADMIN')
    const b = newUser('ADMIN')
    const pa = await mkPosting(a)
    const pb = await mkPosting(b)
    const ins = (t: string, p: string, stage: string, purge: string) => {
      const id = generateId()
      db.prepare(`INSERT INTO hr_applicants (id, tenant_id, posting_id, full_name, phone, stage, consent_at, purge_after, created_at)
        VALUES (?, ?, ?, 'x y', '0812345678', ?, '2025-01-01', ?, '2025-01-01')`).run(id, t, p, stage, purge)
      return id
    }
    const oldApplied = ins(a.tenantId, pa.id, 'APPLIED', '2000-01-01')
    const oldHired = ins(a.tenantId, pa.id, 'HIRED', '2000-01-01')
    const fresh = ins(a.tenantId, pa.id, 'APPLIED', '2999-01-01')
    const otherOld = ins(b.tenantId, pb.id, 'APPLIED', '2000-01-01')
    const ids = (await request(app).get('/api/hr/applicants').set(auth(a))).body.data.map((r: any) => r.id)
    expect(ids).toContain(oldHired)
    expect(ids).toContain(fresh)
    expect(ids).not.toContain(oldApplied)
    expect(db.prepare('SELECT id FROM hr_applicants WHERE id = ?').get(otherOld)).toBeTruthy()
  })

  it('hire: creates employee, validates, 409 on dup code and double hire, cross-company 404', async () => {
    const a = newUser('ADMIN')
    const b = newUser('ADMIN')
    const p = await mkPosting(a)
    await apply(p.public_token)
    await apply(p.public_token)
    const [x, y] = (await request(app).get('/api/hr/applicants').set(auth(a))).body.data
    const body = { code: 'E001', employment_type: 'MONTHLY', base_wage: 15000, start_date: '2026-12-01' }
    expect((await request(app).post(`/api/hr/applicants/${x.id}/hire`).set(auth(b)).send(body)).status).toBe(404)
    expect((await request(app).post(`/api/hr/applicants/${x.id}/hire`).set(auth(newUser('USER', a.tenantId))).send(body)).status).toBe(403)
    for (const bad of [{ ...body, code: '' }, { ...body, employment_type: 'X' }, { ...body, base_wage: -1 }, { ...body, start_date: '2026-13-01' }, { ...body, org_unit_id: 'nope' }]) {
      expect((await request(app).post(`/api/hr/applicants/${x.id}/hire`).set(auth(a)).send(bad)).status).toBe(400)
    }
    const ok = await request(app).post(`/api/hr/applicants/${x.id}/hire`).set(auth(a)).send(body)
    expect(ok.status).toBe(201)
    expect(ok.body.data.stage).toBe('HIRED')
    const emp = db.prepare('SELECT * FROM employees WHERE id = ? AND tenant_id = ?').get(ok.body.data.employee_id, a.tenantId) as any
    expect(emp.first_name).toBe('สมชาย')
    expect(emp.last_name).toBe('ใจดี')
    expect((await request(app).post(`/api/hr/applicants/${x.id}/hire`).set(auth(a)).send({ ...body, code: 'E002' })).status).toBe(409)
    expect((await request(app).post(`/api/hr/applicants/${y.id}/hire`).set(auth(a)).send(body)).status).toBe(409)
    expect((await request(app).put(`/api/hr/applicants/${x.id}`).set(auth(a)).send({ stage: 'REJECTED' })).status).toBe(409)
  })
})
