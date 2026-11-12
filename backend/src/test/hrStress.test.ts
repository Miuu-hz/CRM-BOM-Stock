import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import type { Server } from 'http'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { createTestUser } from './testAuth'
import authRoutes from '../routes/auth.routes'
import hrAssetRoutes from '../routes/hr.asset.routes'
import hrDisciplineRoutes from '../routes/hr.discipline.routes'
import hrDocumentRoutes from '../routes/hr.document.routes'
import hrLifecycleRoutes from '../routes/hr.lifecycle.routes'
import hrRecruitRoutes from '../routes/hr.recruit.routes'
import hrLineInviteRoutes from '../routes/hr.lineInvite.routes'
import { createPublicRecruitRouter } from '../routes/hr.recruit.public.routes'
import { lineBotService } from '../services/line-bot.service'
import { richMenus } from '../services/line-richmenu.service'

// Stress / concurrency over HR + LINE features. Every scenario fires overlapping requests and asserts DB invariants.
function buildApp(publicLimit = 100000) {
  const app = express()
  app.set('trust proxy', 1) // lets scenario 1 give each request its own X-Forwarded-For so the per-IP limiter does not mask the race
  app.use(express.json({ limit: '1mb' }))
  app.use('/api/auth', authRoutes)
  app.use('/api/public/jobs', createPublicRecruitRouter(publicLimit))
  app.use('/api/hr', authenticate)
  for (const r of [hrAssetRoutes, hrDisciplineRoutes, hrDocumentRoutes, hrLifecycleRoutes, hrRecruitRoutes, hrLineInviteRoutes]) app.use('/api/hr', r)
  return app
}

const tenants: string[] = []
const TABLES = ['hr_asset_loans', 'hr_assets', 'hr_disciplinary_records', 'hr_employee_documents', 'hr_checklist_items', 'hr_checklist_templates',
  'hr_applicants', 'hr_job_postings', 'line_login_tokens', 'line_link_tokens', 'line_user_mappings', 'employees', 'company_settings', 'tenant_subscriptions', 'users']
afterAll(() => {
  vi.restoreAllMocks()
  for (const t of tenants) for (const tb of TABLES) { try { db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t) } catch { /* table without tenant_id */ } }
})

const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` })
const admin = () => { const u = createTestUser({ role: 'ADMIN' }); tenants.push(u.tenantId); return u }
const count = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as any).c as number
const tally = (rs: { status: number }[]) => rs.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {} as Record<number, number>)

let n = 0
function posting(tenantId: string) {
  const id = generateId()
  db.prepare(`INSERT INTO hr_job_postings (id, tenant_id, title, public_token, is_open, created_at) VALUES (?, ?, 'ตำแหน่ง', ?, 1, ?)`).run(id, tenantId, generateId() + generateId(), new Date().toISOString())
  return id
}
function emp(tenantId: string, opts: { first?: string; userId?: string } = {}) {
  const id = generateId()
  db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, last_name, employment_type, base_wage, start_date, status, user_id)
    VALUES (?, ?, ?, ?, 'ทดสอบ', 'MONTHLY', 20000, '2026-01-01', 'ACTIVE', ?)`).run(id, tenantId, `S${++n}-${id.slice(0, 6)}`, opts.first ?? 'พนักงาน', opts.userId ?? null)
  return id
}

describe('HR/LINE stress', () => {
  const app = buildApp()
  let server: Server
  beforeAll(() => { server = app.listen(0) })
  afterAll(() => { server.close() })
  const api = () => request(server)

  it('1. one-time LINE login link: 50 parallel exchanges -> exactly 1 success', async () => {
    const a = admin()
    db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, 'ADMIN')`).run(generateId(), a.tenantId, a.userId, 'U' + generateId())
    const token = new URL(lineBotService.createLoginLink(a.tenantId, a.userId)).searchParams.get('t')!
    const rs = await Promise.all(Array.from({ length: 50 }, (_, i) => api().post('/api/auth/line-login').set('X-Forwarded-For', `10.9.0.${i + 1}`).send({ token })))
    expect(tally(rs)).toEqual({ 200: 1, 401: 49 })
    expect(count('SELECT COUNT(*) c FROM line_login_tokens WHERE tenant_id = ? AND used_at IS NOT NULL', a.tenantId)).toBe(1)
  }, 60000)

  it('2. asset loan: 30 parallel loans -> 1 wins; 30 parallel returns -> 1 wins', async () => {
    const a = admin(), assetId = generateId()
    db.prepare(`INSERT INTO hr_assets (id, tenant_id, code, name, status, created_at) VALUES (?, ?, 'A1', 'โน้ตบุ๊ก', 'AVAILABLE', ?)`).run(assetId, a.tenantId, new Date().toISOString())
    const emps = Array.from({ length: 30 }, () => emp(a.tenantId))
    const rs = await Promise.all(emps.map(e => api().post(`/api/hr/assets/${assetId}/loan`).set(auth(a)).send({ employee_id: e, loaned_on: '2026-02-01' })))
    expect(tally(rs)).toEqual({ 201: 1, 409: 29 })
    expect(count('SELECT COUNT(*) c FROM hr_asset_loans WHERE asset_id = ? AND returned_on IS NULL', assetId)).toBe(1)
    expect(count('SELECT COUNT(*) c FROM hr_asset_loans WHERE asset_id = ?', assetId)).toBe(1)
    expect((db.prepare('SELECT status FROM hr_assets WHERE id = ?').get(assetId) as any).status).toBe('LOANED')

    const loanId = rs.find(r => r.status === 201)!.body.data.id
    const rr = await Promise.all(Array.from({ length: 30 }, () => api().post(`/api/hr/asset-loans/${loanId}/return`).set(auth(a)).send({ returned_on: thaiDateStr() })))
    expect(tally(rr)).toEqual({ 200: 1, 409: 29 })
    expect(count('SELECT COUNT(*) c FROM hr_asset_loans WHERE asset_id = ? AND returned_on IS NULL', assetId)).toBe(0)
    expect((db.prepare('SELECT status FROM hr_assets WHERE id = ?').get(assetId) as any).status).toBe('AVAILABLE')
  }, 60000)

  it('3. LINE invite: 30 parallel invites -> one line_only user, employee linked, no 500', async () => {
    const a = admin(), e = emp(a.tenantId)
    const rs = await Promise.all(Array.from({ length: 30 }, () => api().post(`/api/hr/employees/${e}/line-invite`).set(auth(a))))
    expect(rs.filter(r => r.status >= 500).map(r => r.status)).toEqual([])
    expect(rs.filter(r => r.status === 201).length, JSON.stringify(tally(rs))).toBeGreaterThanOrEqual(1)
    expect(count('SELECT COUNT(*) c FROM users WHERE tenant_id = ? AND line_only = 1', a.tenantId)).toBe(1)
    const uid = (db.prepare('SELECT user_id FROM employees WHERE id = ?').get(e) as any).user_id
    expect(db.prepare('SELECT line_only FROM users WHERE id = ? AND tenant_id = ?').get(uid, a.tenantId)).toEqual({ line_only: 1 })
  }, 60000)

  it('4. checklist start: 30 parallel OFFBOARD starts -> items created exactly once', async () => {
    const a = admin(), e = emp(a.tenantId)
    expect((await api().post('/api/hr/checklist-templates/seed-defaults').set(auth(a))).status).toBe(201)
    const tpls = count(`SELECT COUNT(*) c FROM hr_checklist_templates WHERE tenant_id = ? AND kind = 'OFFBOARD'`, a.tenantId)
    expect(tpls).toBeGreaterThan(0)
    const rs = await Promise.all(Array.from({ length: 30 }, () => api().post(`/api/hr/employees/${e}/checklists`).set(auth(a)).send({ kind: 'OFFBOARD' })))
    expect(rs.filter(r => r.status >= 500).length).toBe(0)
    expect(count(`SELECT COUNT(*) c FROM hr_checklist_items WHERE employee_id = ? AND kind = 'OFFBOARD'`, e), JSON.stringify(tally(rs))).toBe(tpls)
  }, 60000)

  it('5. hire: 20 parallel hires of one applicant -> 1 employee, applicant HIRED once', async () => {
    const a = admin(), ap = generateId(), now = new Date().toISOString()
    db.prepare(`INSERT INTO hr_applicants (id, tenant_id, posting_id, full_name, phone, source, stage, consent_at, purge_after, created_at) VALUES (?, ?, ?, 'สมหมาย ใจดี', '0812345678', 'PUBLIC', 'APPLIED', ?, '2027-06-01', ?)`).run(ap, a.tenantId, posting(a.tenantId), now, now)
    const body = { code: 'HIRE-1', employment_type: 'MONTHLY', base_wage: 15000, start_date: '2026-11-01' }
    const rs = await Promise.all(Array.from({ length: 20 }, () => api().post(`/api/hr/applicants/${ap}/hire`).set(auth(a)).send(body)))
    expect(rs.filter(r => r.status >= 500).length).toBe(0)
    expect(tally(rs)).toEqual({ 201: 1, 409: 19 })
    expect(count(`SELECT COUNT(*) c FROM employees WHERE tenant_id = ? AND code = 'HIRE-1'`, a.tenantId)).toBe(1)
    const row = db.prepare('SELECT stage, employee_id FROM hr_applicants WHERE id = ?').get(ap) as any
    expect(row.stage).toBe('HIRED')
    expect(row.employee_id).toBeTruthy()
  }, 60000)

  it('6. disciplinary self-acknowledge: 20 parallel -> 1 success, rest 409', async () => {
    const a = admin(), u = createTestUser({ role: 'USER', tenantId: a.tenantId })
    const e = emp(a.tenantId, { userId: u.userId }), id = generateId()
    db.prepare(`INSERT INTO hr_disciplinary_records (id, tenant_id, employee_id, incident_date, category, detail, level, expires_on, created_by, created_at)
      VALUES (?, ?, ?, '2026-10-01', 'มาสาย', 'รายละเอียด', 'VERBAL', '2027-10-01', ?, ?)`).run(id, a.tenantId, e, a.userId, new Date().toISOString())
    const rs = await Promise.all(Array.from({ length: 20 }, () => api().post(`/api/hr/me/disciplinary/${id}/acknowledge`).set(auth(u))))
    expect(tally(rs)).toEqual({ 200: 1, 409: 19 })
    expect(db.prepare('SELECT acknowledged_via FROM hr_disciplinary_records WHERE id = ?').get(id)).toEqual({ acknowledged_via: 'SELF' })
  }, 60000)

  it('7. public applications: 300 parallel all stored; limit 5 -> <=5 stored, rest 429', async () => {
    const a = admin(), other = admin()
    const post = (await api().post('/api/hr/job-postings').set(auth(a)).send({ title: 'แคชเชียร์' })).body.data
    const otherPost = (await api().post('/api/hr/job-postings').set(auth(other)).send({ title: 'อื่น' })).body.data
    const body = (i: number) => ({ full_name: `ผู้สมัคร ${i}`, phone: '081-234-5678', consent: true })
    const rs = await Promise.all(Array.from({ length: 300 }, (_, i) => api().post(`/api/public/jobs/${post.public_token}/apply`).send(body(i))))
    expect(tally(rs)).toEqual({ 201: 300 })
    expect(count('SELECT COUNT(*) c FROM hr_applicants WHERE posting_id = ?', post.id)).toBe(300)
    expect(count('SELECT COUNT(*) c FROM hr_applicants WHERE tenant_id = ?', a.tenantId)).toBe(300)
    expect(count('SELECT COUNT(*) c FROM hr_applicants WHERE tenant_id = ? OR posting_id = ?', other.tenantId, otherPost.id)).toBe(0)

    const limited = request(buildApp(5))
    const lr = await Promise.all(Array.from({ length: 40 }, (_, i) => limited.post(`/api/public/jobs/${post.public_token}/apply`).send(body(1000 + i))))
    const t = tally(lr)
    expect(t[201] ?? 0).toBeLessThanOrEqual(5)
    expect(t[429]).toBe(40 - (t[201] ?? 0))
    expect(count('SELECT COUNT(*) c FROM hr_applicants WHERE posting_id = ?', post.id)).toBe(300 + (t[201] ?? 0))
  }, 60000)

  it('8. tenant isolation under load: ~600 mixed GETs never leak the other company', async () => {
    const mk = (tag: string) => {
      const ad = admin(), ids: string[] = [], now = new Date().toISOString(), pst = posting(ad.tenantId)
      const users = Array.from({ length: 15 }, (_, i) => {
        const u = createTestUser({ role: 'USER', tenantId: ad.tenantId })
        const e = emp(ad.tenantId, { first: `${tag}นาย${i}`, userId: u.userId }); ids.push(e, u.userId)
        const d = generateId(), s = generateId(), r = generateId()
        db.prepare(`INSERT INTO hr_employee_documents (id, tenant_id, employee_id, doc_type, title, created_by, created_at) VALUES (?, ?, ?, 'OTHER', ?, ?, ?)`).run(d, ad.tenantId, e, `${tag}-เอกสาร-${i}`, ad.userId, now)
        db.prepare(`INSERT INTO hr_assets (id, tenant_id, code, name, status, created_at) VALUES (?, ?, ?, ?, 'AVAILABLE', ?)`).run(s, ad.tenantId, `${tag}-A${i}`, `${tag}-ทรัพย์สิน-${i}`, now)
        db.prepare(`INSERT INTO hr_disciplinary_records (id, tenant_id, employee_id, incident_date, category, detail, level, expires_on, created_by, created_at) VALUES (?, ?, ?, '2026-10-01', ?, ?, 'VERBAL', '2027-10-01', ?, ?)`).run(r, ad.tenantId, e, `${tag}-หมวด-${i}`, `${tag}-รายละเอียด`, ad.userId, now)
        const ap = generateId()
        db.prepare(`INSERT INTO hr_applicants (id, tenant_id, posting_id, full_name, phone, source, stage, consent_at, purge_after, created_at) VALUES (?, ?, ?, ?, '0812345678', 'PUBLIC', 'APPLIED', ?, '2027-06-01', ?)`).run(ap, ad.tenantId, pst, `${tag}-ผู้สมัคร-${i}`, now, now)
        ids.push(d, s, r, ap)
        return u
      })
      db.prepare(`INSERT INTO hr_checklist_templates (id, tenant_id, kind, title, sort_order, is_active, created_at) VALUES (?, ?, 'ONBOARD', ?, 1, 1, ?)`).run(generateId(), ad.tenantId, `${tag}-แม่แบบ`, now)
      return { ad, users, ids, tag }
    }
    const A = mk('ALPHAZ'), B = mk('BRAVOZ')
    const adminPaths = ['/documents', '/assets', '/disciplinary', '/applicants', '/checklist-templates']
    const selfPaths = ['/me/documents', '/me/disciplinary', '/me/asset-loans']
    const jobs: { path: string; u: { token: string }; mine: typeof A; other: typeof A }[] = []
    for (let i = 0; i < 600; i++) {
      const [mine, other] = Math.random() < 0.5 ? [A, B] : [B, A]
      const isAdmin = i % 2 === 0
      const u = isAdmin ? mine.ad : mine.users[Math.floor(Math.random() * 15)]
      const paths = isAdmin ? adminPaths : selfPaths
      jobs.push({ path: '/api/hr' + paths[i % paths.length], u, mine, other })
    }
    const t0 = Date.now()
    const rs = await Promise.all(jobs.map(j => api().get(j.path).set(auth(j.u))))
    const ms = Date.now() - t0
    console.log(`[stress 8] ${jobs.length} GETs in ${ms}ms = ${(jobs.length / (ms / 1000)).toFixed(0)} req/s`)
    rs.forEach((r, i) => {
      const j = jobs[i], txt = JSON.stringify(r.body)
      expect(r.status, j.path).toBe(200)
      expect(txt.includes(j.other.tag), `${j.path} leaked ${j.other.tag}`).toBe(false)
      for (const id of j.other.ids) if (txt.includes(id)) throw new Error(`${j.path} leaked foreign id ${id}`)
    })
    // sanity: the admin lists actually returned own data (otherwise "no leak" is vacuous)
    const sample = await api().get('/api/hr/documents').set(auth(A.ad))
    expect(JSON.stringify(sample.body)).toContain('ALPHAZ-เอกสาร-0')
  }, 60000)

  it('9. LINE bot burst: 200 events from 20 linked users -> no throw, replies only own company', async () => {
    const replies = new Map<string, any[]>()
    vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ token: 't', replyMessage: async (t: string, m: any) => { replies.set(t, [...(replies.get(t) || []), m]) }, pushMessage: vi.fn() })
    vi.spyOn(richMenus, 'syncUser').mockResolvedValue()
    const shops = ['เอ', 'บี'].map(l => {
      const tenantId = 'tenant_st_' + generateId().slice(0, 8); tenants.push(tenantId)
      const company = `ร้านสเตรส${l}-${tenantId.slice(-6)}`
      try { db.prepare('INSERT INTO company_settings (id, tenant_id, name) VALUES (?, ?, ?)').run(generateId(), tenantId, company) }
      catch { db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(tenantId, company) }
      return { tenantId, company }
    })
    const people: { uid: string; own: typeof shops[0]; other: typeof shops[0] }[] = []
    for (let i = 0; i < 20; i++) {
      const own = shops[i % 2], other = shops[(i + 1) % 2], userId = generateId(), uid = 'U' + generateId()
      db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', 'คน', 'USER', ?, 'active')`).run(userId, `${userId}@example.com`, own.tenantId)
      emp(own.tenantId, { userId })
      const ev = { type: 'message', replyToken: 'link-' + uid, source: { type: 'user', userId: uid }, message: { type: 'text', text: lineBotService.generateLinkToken(own.tenantId, userId) } }
      await lineBotService.handleEvent(lineBotService.resolveTenant(ev), ev)
      people.push({ uid, own, other })
    }
    const texts = ['บัญชีของฉัน', 'เปลี่ยนบริษัท', 'ของฉัน']
    const evs = Array.from({ length: 200 }, (_, i) => {
      const p = people[i % 20]
      return { p, ev: { type: 'message', replyToken: `rt-${i}`, source: { type: 'user', userId: p.uid }, message: { type: 'text', text: texts[i % 3] } }, text: texts[i % 3] }
    })
    const t0 = Date.now()
    await Promise.all(evs.map(e => lineBotService.handleEvent(lineBotService.resolveTenant(e.ev), e.ev)))
    console.log(`[stress 9] 200 bot events in ${Date.now() - t0}ms`)
    for (const e of evs) {
      const out = JSON.stringify(replies.get(e.ev.replyToken) || [])
      expect(out.includes(e.p.other.company) || out.includes(e.p.other.tenantId), `${e.text} leaked other company`).toBe(false)
      if (e.text === 'บัญชีของฉัน') expect(out).toContain(e.p.own.company)
    }
  }, 60000)
})
