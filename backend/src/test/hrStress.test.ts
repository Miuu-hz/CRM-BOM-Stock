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
import hrRosterRoutes from '../routes/hr.roster.routes'
import hrPayrollRoutes from '../routes/hr.payroll.routes'
import { runExpiryDigest } from '../services/hrExpiry.scheduler'
import { seedChartOfAccounts } from '../config/chartOfAccounts'
import { getOrCreateAccount } from '../services/accounting.service'
import hrFaceRoutes from '../routes/hr.face.routes'
import hrCheckinRoutes, { resetCheckinFaceLockout } from '../routes/hr.checkin.routes'
import hrRoutes from '../routes/hr.routes'
import { encryptDescriptor } from '../services/hr/face'
import lineBotRouter from '../routes/line-bot.routes'

// Stress / concurrency over HR + LINE features. Every scenario fires overlapping requests and asserts DB invariants.
function buildApp(publicLimit = 100000) {
  const app = express()
  app.set('trust proxy', 1) // lets scenario 1 give each request its own X-Forwarded-For so the per-IP limiter does not mask the race
  app.use(express.json({ limit: '1mb' }))
  app.use('/api/auth', authRoutes)
  app.use('/api/public/jobs', createPublicRecruitRouter(publicLimit))
  app.use('/api/hr', authenticate)
  for (const r of [
    hrAssetRoutes,
    hrDisciplineRoutes,
    hrDocumentRoutes,
    hrLifecycleRoutes,
    hrRecruitRoutes,
    hrLineInviteRoutes,
    hrRosterRoutes,
    hrPayrollRoutes,
    hrFaceRoutes,
    hrCheckinRoutes,
    hrRoutes,
  ]) app.use('/api/hr', r)
  return app
}

const tenants: string[] = []
const TABLES = [
  'hr_face_enrollments', 'attendance_logs', 'hr_checkin_locations', 'hr_doc_templates',
  'approval_logs', 'approval_requests', 'leave_requests', 'leave_types', 'shift_assignments', 'hr_roster_publishes', 'shifts',
  'hr_expiry_digest_runs', 'pos_payments', 'pos_running_bills', 'line_push_counts', 'line_master_notify', 'journal_lines', 'journal_entries', 'payroll_run_lines', 'payroll_runs', 'accounts', 'org_units','hr_asset_loans', 'hr_assets', 'hr_disciplinary_records', 'hr_employee_documents', 'hr_checklist_items', 'hr_checklist_templates',
  'hr_applicants', 'hr_job_postings', 'line_login_tokens', 'line_link_tokens', 'line_user_mappings', 'employees', 'company_settings', 'tenant_subscriptions', 'users'
]
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

function makeDescriptor(seed: number, length = 1024): number[] {
  let s = seed >>> 0
  const arr: number[] = new Array(length)
  for (let i = 0; i < length; i++) {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    arr[i] = (s / 0xffffffff) * 0.2
  }
  return arr
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

  it('10. in-chat approval double press: 2 admins x 5 mixed postbacks -> exactly one decision', async () => {
    const a = admin(), t = a.tenantId, now = new Date().toISOString()
    const boss2 = createTestUser({ role: 'ADMIN', tenantId: t }), staff = createTestUser({ role: 'USER', tenantId: t })
    const link = (userId: string) => { const l = 'U' + generateId(); db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, 'ADMIN')`).run(generateId(), t, userId, l); return l }
    const lines = [link(a.userId), link(boss2.userId)]
    const typeId = generateId(), leaveId = generateId(), reqId = generateId(), e = emp(t, { userId: staff.userId })
    db.prepare(`INSERT INTO leave_types (id, tenant_id, code, name, paid, days_per_year, is_active, created_at) VALUES (?, ?, 'SICK', 'ลาป่วย', 1, 30, 1, ?)`).run(typeId, t, now)
    db.prepare(`INSERT INTO leave_requests (id, tenant_id, employee_id, leave_type_id, start_date, end_date, days, reason, status, approval_request_id, requested_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, '2026-11-03', '2026-11-03', 1, 'ป่วย', 'PENDING', ?, ?, ?, ?)`).run(leaveId, t, e, typeId, reqId, staff.userId, now, now)
    db.prepare(`INSERT INTO approval_requests (id, tenant_id, request_number, module_type, reference_type, reference_id, requester_id, requester_name, requester_role, amount, description, status, created_at, updated_at)
      VALUES (?, ?, ?, 'leave', 'leave_requests', ?, ?, 'x', 'USER', 0, 'ลาป่วย 1 วัน', 'PENDING', ?, ?)`).run(reqId, t, 'APR-' + reqId.slice(0, 8), leaveId, staff.userId, now, now)
    vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ token: 't', replyMessage: async () => {}, pushMessage: vi.fn() })
    vi.spyOn(lineBotService, 'notifyApprovalDecision').mockResolvedValue(undefined as any)
    const presses = Array.from({ length: 10 }, (_, i) => lineBotService.handleEvent(t, {
      type: 'postback', replyToken: `rt-${i}`, source: { type: 'user', userId: lines[i % 2] }, postback: { data: `action=${i % 3 === 0 ? 'reject_req' : 'approve_req'}&id=${reqId}` } }))
    const settled = await Promise.allSettled(presses)
    expect(settled.filter(r => r.status === 'rejected').map((r: any) => String(r.reason))).toEqual([])
    expect(count(`SELECT COUNT(*) c FROM approval_logs WHERE approval_request_id = ? AND action IN ('APPROVED', 'REJECTED')`, reqId)).toBe(1)
    const st = (db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(reqId) as any).status
    expect(st).not.toBe('PENDING')
    const leave = (db.prepare('SELECT status FROM leave_requests WHERE id = ?').get(leaveId) as any).status
    expect(leave).toBe(st === 'REJECTED' ? 'REJECTED' : 'APPROVED')
  }, 60000)

  it('11. roster publish: 10 parallel -> 1x200 + 9x409, one push per linked employee; 10 parallel forced -> 1 success', async () => {
    const push = vi.spyOn(lineBotService, 'pushToUser').mockResolvedValue(true)
    push.mockClear()
    const a = admin(), t = a.tenantId, MONDAY = '2030-01-07'
    try { db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(t, 'ร้านสเตรส') } catch { /* already present */ }
    const shift = generateId()
    db.prepare(`INSERT INTO shifts (id, tenant_id, name, start_time, end_time, grace_minutes, break_minutes, is_active, created_at) VALUES (?, ?, 'เช้า', '09:00', '18:00', 0, 60, 1, '2026-01-01T00:00:00.000Z')`).run(shift, t)
    const ins = db.prepare('INSERT INTO shift_assignments (id, tenant_id, employee_id, work_date, shift_id) VALUES (?, ?, ?, ?, ?)')
    const users = Array.from({ length: 4 }, () => createTestUser({ role: 'USER', tenantId: t }))
    for (const u of users) ins.run(generateId(), t, emp(t, { userId: u.userId }), MONDAY, shift)
    ins.run(generateId(), t, emp(t), MONDAY, shift) // no LINE-linked user
    const pub = (body: any = {}) => api().post('/api/hr/roster/publish').set(auth(a)).send({ week_start: MONDAY, ...body })
    const r1 = await Promise.all(Array.from({ length: 10 }, () => pub()))
    expect(tally(r1)).toEqual({ 200: 1, 409: 9 })
    expect(count('SELECT COUNT(*) c FROM hr_roster_publishes WHERE tenant_id = ?', t)).toBe(1)
    expect(push).toHaveBeenCalledTimes(4)
    expect(push.mock.calls.map(c => c[1]).sort()).toEqual(users.map(u => u.userId).sort())
    const r2 = await Promise.all(Array.from({ length: 10 }, () => pub({ force: true })))
    expect(tally(r2)).toEqual({ 200: 1, 409: 9 })
    expect(push).toHaveBeenCalledTimes(8)
    expect(count('SELECT COUNT(*) c FROM hr_roster_publishes WHERE tenant_id = ?', t)).toBe(1)
  }, 60000)

  it('12. expiry digest: 10 parallel runs -> pushed once, one run row', async () => {
    const push = vi.spyOn(lineBotService, 'pushToUser').mockResolvedValue(true)
    push.mockClear()
    const a = admin(), t = a.tenantId, TODAY = '2031-03-01', in30 = '2031-03-31'
    try { db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(t, 'ร้านสเตรส') } catch { /* already present */ }
    db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, 'ADMIN')`).run(generateId(), t, a.userId, 'U' + generateId())
    db.prepare(`INSERT INTO hr_employee_documents (id, tenant_id, employee_id, doc_type, title, expires_on) VALUES (?, ?, ?, 'OTHER', 'พาสปอร์ต', ?)`).run(generateId(), t, emp(t), in30)
    await Promise.all(Array.from({ length: 10 }, () => runExpiryDigest(TODAY)))
    expect(push.mock.calls.filter(c => c[0] === t)).toHaveLength(1)
    expect(count('SELECT COUNT(*) c FROM hr_expiry_digest_runs WHERE tenant_id = ? AND run_date = ?', t, TODAY)).toBe(1)
  }, 60000)

  it('13. final-pay apply: 10 parallel -> each item at most once, gross equals single apply', async () => {
    const a = admin(), t = a.tenantId
    const mk = () => { const id = generateId(); db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, last_name, employment_type, base_wage, start_date, end_date, status)
      VALUES (?, ?, ?, 'ส', 'ด', 'MONTHLY', 30000, '2020-01-01', '2026-06-01', 'ACTIVE')`).run(id, t, `F${id.slice(0, 6)}`); return id }
    const e1 = mk(), e2 = mk()
    db.prepare(`INSERT INTO leave_types (id, tenant_id, code, name, paid, days_per_year, is_active) VALUES (?, ?, 'VACATION', 'พักร้อน', 1, 6, 1)`).run(generateId(), t)
    const run = await api().post('/api/hr/payroll-runs').set(auth(a)).send({ period: '2026-06' })
    expect(run.status).toBe(201)
    const apply = (e: string) => api().post(`/api/hr/employees/${e}/final-pay/apply`).set(auth(a)).send({ run_id: run.body.id })
    const rs = await Promise.all(Array.from({ length: 10 }, () => apply(e1)))
    expect(rs.filter(r => r.status >= 500).map(r => r.status)).toEqual([])
    expect((await apply(e2)).status).toBe(200)
    const line = (e: string) => db.prepare('SELECT inputs, gross FROM payroll_run_lines WHERE run_id = ? AND employee_id = ?').get(run.body.id, e) as any
    const names = (JSON.parse(line(e1).inputs).extraPayItems || []).map((i: any) => i.name as string)
    expect(names.filter((n: string) => n.startsWith('ค่าชดเชยตามกฎหมาย'))).toHaveLength(1)
    expect(names.filter((n: string) => n.startsWith('ค่าจ้างวันหยุดพักผ่อนคงเหลือ'))).toHaveLength(1)
    expect(names).toHaveLength(2)
    expect(line(e1).gross).toBe(line(e2).gross)
  }, 60000)

  it('14. payroll post: 5 parallel -> one success, slip pushed at most once per linked employee, one set of JEs', async () => {
    const push = vi.spyOn(lineBotService, 'pushToUser').mockResolvedValue(true)
    push.mockClear()
    const a = admin(), t = a.tenantId
    seedChartOfAccounts(t)
    const bank = getOrCreateAccount(t, '1102')
    for (const c of ['1101', '2105', '2106', '2107', '5301', '5314']) getOrCreateAccount(t, c)
    try { db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(t, 'ร้านสเตรส') } catch { /* already present */ }
    const users = Array.from({ length: 3 }, () => createTestUser({ role: 'USER', tenantId: t }))
    for (const u of users) emp(t, { userId: u.userId })
    emp(t)
    const run = await api().post('/api/hr/payroll-runs').set(auth(a)).send({ period: '2026-08' })
    expect(run.status).toBe(201)
    expect((await api().post(`/api/hr/payroll-runs/${run.body.id}/approve`).set(auth(a)).send({})).status).toBe(200)
    const rs = await Promise.all(Array.from({ length: 5 }, () => api().post(`/api/hr/payroll-runs/${run.body.id}/post`).set(auth(a)).send({ payDate: '2026-08-31', payAccountId: bank })))
    await new Promise(r => setTimeout(r, 50))
    expect(rs.filter(r => r.status >= 500).map(r => r.status)).toEqual([])
    expect(rs.filter(r => r.status === 200)).toHaveLength(1)
    const ids = users.map(u => u.userId)
    const mine = push.mock.calls.filter(c => ids.includes(c[1] as string))
    for (const id of ids) expect(mine.filter(c => c[1] === id).length, id).toBeLessThanOrEqual(1)
    expect(count(`SELECT COUNT(*) c FROM journal_entries WHERE tenant_id = ? AND reference_type = 'PAYROLL_RUN' AND reference_id = ?`, t, run.body.id))
      .toBe(rs.find(r => r.status === 200)!.body.accrual_je_ids.length)
    expect((db.prepare('SELECT status FROM payroll_runs WHERE id = ?').get(run.body.id) as any).status).toBe('POSTED')
  }, 60000)

  it('15. face enroll race: 20 concurrent POST /api/hr/me/face -> all 200, 1 row, safe GET', async () => {
    const a = admin()
    const u = createTestUser({ role: 'USER', tenantId: a.tenantId })
    const e = emp(a.tenantId, { userId: u.userId })
    const descriptors = Array.from({ length: 20 }, (_, i) => makeDescriptor(i + 1, 1024))
    const rs = await Promise.all(
      descriptors.map(d =>
        api()
          .post('/api/hr/me/face')
          .set(auth(u))
          .send({ descriptor: d, consent: true })
      )
    )
    expect(tally(rs)).toEqual({ 200: 20 })
    expect(count('SELECT COUNT(*) c FROM hr_face_enrollments WHERE tenant_id = ? AND employee_id = ?', a.tenantId, e)).toBe(1)

    const getRes = await api().get('/api/hr/me/face').set(auth(u))
    expect(getRes.status).toBe(200)
    expect(getRes.body.success).toBe(true)
    expect(getRes.body.data.enrolled).toBe(true)
    expect(getRes.body.data).not.toHaveProperty('descriptor')
    expect(getRes.body.data).not.toHaveProperty('descriptor_enc')
    expect(getRes.body).not.toHaveProperty('descriptor')
    expect(getRes.body).not.toHaveProperty('descriptor_enc')
  }, 60000)

  it('16. face check-in burst: 10 concurrent POST /api/hr/checkin/face -> no 5xx, punches equals 2xx count', async () => {
    const a = admin()
    const u = createTestUser({ role: 'USER', tenantId: a.tenantId })
    emp(a.tenantId, { userId: u.userId })
    const desc = makeDescriptor(42, 1024)

    const enrollRes = await api()
      .post('/api/hr/me/face')
      .set(auth(u))
      .send({ descriptor: desc, consent: true })
    expect(enrollRes.status).toBe(200)

    const rs = await Promise.all(
      Array.from({ length: 10 }, () =>
        api()
          .post('/api/hr/checkin/face')
          .set(auth(u))
          .send({ face_descriptor: desc, lat: 13.7563, lng: 100.5018 })
      )
    )
    expect(rs.filter(r => r.status >= 500).map(r => r.status)).toEqual([])
    const okCount = rs.filter(r => r.status >= 200 && r.status < 300).length
    expect(okCount).toBe(1)
    expect(tally(rs)).toEqual({ 201: 1, 409: 9 })
    expect(count('SELECT COUNT(*) c FROM attendance_logs WHERE tenant_id = ?', a.tenantId)).toBe(okCount)
  }, 60000)

  it('17. wrong-face lockout under concurrency: 12 concurrent wrong face -> only 401/429, >=1 429, zero punches', async () => {
    resetCheckinFaceLockout()
    try {
      const a = admin()
      const u = createTestUser({ role: 'USER', tenantId: a.tenantId })
      emp(a.tenantId, { userId: u.userId })
      const enrolledDesc = makeDescriptor(101, 1024)
      const wrongDesc = makeDescriptor(999, 1024)

      const enrollRes = await api()
        .post('/api/hr/me/face')
        .set(auth(u))
        .send({ descriptor: enrolledDesc, consent: true })
      expect(enrollRes.status).toBe(200)

      const rs = await Promise.all(
        Array.from({ length: 12 }, () =>
          api()
            .post('/api/hr/checkin/face')
            .set(auth(u))
            .send({ face_descriptor: wrongDesc, lat: 13.7563, lng: 100.5018 })
        )
      )
      const t = tally(rs)
      expect(rs.every(r => r.status === 401 || r.status === 429)).toBe(true)
      expect(t[429] ?? 0).toBeGreaterThanOrEqual(1)
      expect(count('SELECT COUNT(*) c FROM attendance_logs WHERE tenant_id = ?', a.tenantId)).toBe(0)
    } finally {
      resetCheckinFaceLockout()
    }
  }, 60000)

  it('18. kiosk identification isolation: 30 enrolled in X, 1 in Y -> foreign descriptor 401, own matches #7', async () => {
    resetCheckinFaceLockout()
    try {
      const x = admin(), y = admin()
      const nowIso = new Date().toISOString()
      const descD = makeDescriptor(7777, 1024)

      // Company X has 30 enrolled ACTIVE employees with distinct random descriptors
      const empsX: string[] = []
      const descsX: number[][] = []
      for (let i = 0; i < 30; i++) {
        const eId = emp(x.tenantId, { first: `เอ็กซ์คน${i}` })
        empsX.push(eId)
        const d = makeDescriptor(1000 + i, 1024)
        descsX.push(d)
        db.prepare(
          `INSERT INTO hr_face_enrollments (id, tenant_id, employee_id, descriptor_enc, consent_at, consent_version, created_at)
           VALUES (?, ?, ?, ?, ?, '1.0', ?)`
        ).run(generateId(), x.tenantId, eId, encryptDescriptor(d), nowIso, nowIso)
      }

      // Company Y has 1 employee enrolled with descriptor D
      const empY = emp(y.tenantId, { first: 'วายคนเดียว' })
      db.prepare(
        `INSERT INTO hr_face_enrollments (id, tenant_id, employee_id, descriptor_enc, consent_at, consent_version, created_at)
         VALUES (?, ?, ?, ?, ?, '1.0', ?)`
      ).run(generateId(), y.tenantId, empY, encryptDescriptor(descD), nowIso, nowIso)

      // A kiosk user of company X (ADMIN) posts descriptor D to /api/hr/checkin/face-kiosk -> must be 401
      const resD = await api()
        .post('/api/hr/checkin/face-kiosk')
        .set(auth(x))
        .send({ face_descriptor: descD, lat: 13.7563, lng: 100.5018 })
      expect(resD.status).toBe(401)
      expect(count('SELECT COUNT(*) c FROM attendance_logs WHERE tenant_id = ?', x.tenantId)).toBe(0)
      expect(count('SELECT COUNT(*) c FROM attendance_logs WHERE tenant_id = ?', y.tenantId)).toBe(0)

      // Then posting employee #7's own descriptor from company X matches employee #7 (check the punch row's employee_id)
      const emp7Id = empsX[7]
      const desc7 = descsX[7]
      const res7 = await api()
        .post('/api/hr/checkin/face-kiosk')
        .set(auth(x))
        .send({ face_descriptor: desc7, lat: 13.7563, lng: 100.5018 })
      expect(res7.status).toBe(201)
      expect(res7.body.success).toBe(true)
      expect(res7.body.data.employee_name).toContain('เอ็กซ์คน7')

      const punch = db.prepare(`
        SELECT l.*, e.id AS employee_id
        FROM attendance_logs l
        JOIN employees e ON e.tenant_id = l.tenant_id AND e.device_pin = l.device_pin
        WHERE l.tenant_id = ?
      `).get(x.tenantId) as any
      expect(punch).toBeTruthy()
      expect(punch.employee_id).toBe(emp7Id)
      expect(count('SELECT COUNT(*) c FROM attendance_logs WHERE tenant_id = ?', y.tenantId)).toBe(0)
    } finally {
      resetCheckinFaceLockout()
    }
  }, 60000)

  it('19. offboard wipes face data: offboard concurrently with 5 /checkin/face -> 0 rows, new checkin fails', async () => {
    const a = admin()
    const u = createTestUser({ role: 'USER', tenantId: a.tenantId })
    const e = emp(a.tenantId, { userId: u.userId })
    const desc = makeDescriptor(321, 1024)

    const enrollRes = await api()
      .post('/api/hr/me/face')
      .set(auth(u))
      .send({ descriptor: desc, consent: true })
    expect(enrollRes.status).toBe(200)
    expect(count('SELECT COUNT(*) c FROM hr_face_enrollments WHERE tenant_id = ? AND employee_id = ?', a.tenantId, e)).toBe(1)

    const offboardReq = api()
      .post(`/api/hr/employees/${e}/offboard`)
      .set(auth(a))
      .send({ end_date: '2026-11-13', status: 'RESIGNED' })

    const checkinReqs = Array.from({ length: 5 }, () =>
      api()
        .post('/api/hr/checkin/face')
        .set(auth(u))
        .send({ face_descriptor: desc, lat: 13.7563, lng: 100.5018 })
    )

    const [offRes, ...checkinRes] = await Promise.all([offboardReq, ...checkinReqs])
    expect(offRes.status).toBe(200)
    expect(checkinRes.filter(r => r.status >= 500).map(r => r.status)).toEqual([])

    expect(count('SELECT COUNT(*) c FROM hr_face_enrollments WHERE tenant_id = ? AND employee_id = ?', a.tenantId, e)).toBe(0)

    const postOffboardCheckin = await api()
      .post('/api/hr/checkin/face')
      .set(auth(u))
      .send({ face_descriptor: desc, lat: 13.7563, lng: 100.5018 })
    expect(postOffboardCheckin.status).toBeGreaterThanOrEqual(400)
    expect(count('SELECT COUNT(*) c FROM hr_face_enrollments WHERE tenant_id = ? AND employee_id = ?', a.tenantId, e)).toBe(0)
  }, 60000)

  it('20. PDF burst: 15 concurrent GET doc-templates/:id/pdf with 30k Thai chars -> all 200 %PDF in <20s, foreign admin 404', async () => {
    const a = admin(), foreignAdmin = admin()
    try { db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(a.tenantId, 'บริษัท สเตรสพีดีเอฟ จำกัด') } catch { /* ignore */ }

    const e = emp(a.tenantId, { first: 'สมศักดิ์' })
    const tplId = generateId()
    const nowIso = new Date().toISOString()

    const baseThai = 'หนังสือสัญญาจ้างงานฉบับนี้ทำขึ้นเพื่อเป็นหลักฐานว่าพนักงานตกลงเข้าทำงานตามข้อกำหนดและเงื่อนไขที่ระบุไว้ในสัญญาทุกประการ'
    const thaiWithoutSpaces = baseThai.repeat(Math.ceil(30000 / baseThai.length)).slice(0, 30000)
    expect(thaiWithoutSpaces.length).toBe(30000)
    expect(thaiWithoutSpaces.includes(' ')).toBe(false)
    const tplBody = thaiWithoutSpaces + '{{employee_name}}'

    db.prepare(
      `INSERT INTO hr_doc_templates (id, tenant_id, kind, name, body, created_at, updated_at)
       VALUES (?, ?, 'CONTRACT', 'สัญญาจ้างยาวพิเศษ', ?, ?, ?)`
    ).run(tplId, a.tenantId, tplBody, nowIso, nowIso)

    const parseBinary = (res: any, cb: (err: Error | null, body?: any) => void) => {
      const c: Buffer[] = []
      res.on('data', (d: Buffer) => c.push(d))
      res.on('end', () => cb(null, Buffer.concat(c)))
    }

    const t0 = Date.now()
    const rs = await Promise.all(
      Array.from({ length: 15 }, () =>
        api()
          .get(`/api/hr/doc-templates/${tplId}/pdf?employee_id=${e}`)
          .set(auth(a))
          .buffer(true)
          .parse(parseBinary)
      )
    )
    const elapsedMs = Date.now() - t0
    console.log(`[stress 20] 15 PDF renders in ${elapsedMs}ms`)

    expect(elapsedMs).toBeLessThan(20000)
    expect(rs).toHaveLength(15)
    for (const r of rs) {
      expect(r.status).toBe(200)
      expect(r.headers['content-type']).toContain('application/pdf')
      expect(Buffer.isBuffer(r.body)).toBe(true)
      expect((r.body as Buffer).subarray(0, 4).toString('ascii')).toBe('%PDF')
    }

    // Also one request from another company's admin for the same template id -> 404
    const foreignRes = await api()
      .get(`/api/hr/doc-templates/${tplId}/pdf?employee_id=${e}`)
      .set(auth(foreignAdmin))
    expect(foreignRes.status).toBe(404)
  }, 60000)
  // ── 18 พ.ย.: ปิดกะ/สรุปผู้บริหาร/วงแหวน/Master ลอย — โควตา LINE 300/เดือนรวมทุกบริษัท ทุก push ต้องนับและไม่ซ้ำ ──
  function execShop(admins: number) {
    const a = admin(), t = a.tenantId, ids = [a.userId]
    try { db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(t, 'ร้านสเตรสผู้บริหาร-' + t.slice(-6)) } catch { /* มีแล้ว */ }
    for (let i = 1; i < admins; i++) ids.push(createTestUser({ role: 'ADMIN', tenantId: t }).userId)
    const lines = ids.map(u => { const uid = 'U' + generateId(); db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, 'ADMIN')`).run(generateId(), t, u, uid); return uid })
    const bill = generateId()
    db.prepare(`INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, subtotal, total_amount, status, opened_at, closed_at) VALUES (?, ?, ?, 'โต๊ะ', 500, 500, 'PAID', ?, ?)`)
      .run(bill, t, 'B-' + bill.slice(0, 6), '2031-05-01T05:00:00Z', '2031-05-01T05:00:00Z')
    return { t, lines }
  }

  it('21. exec digest 09:00: 10 parallel runs -> one push per admin, push counter = admins', async () => {
    const { t, lines } = execShop(3)
    const pushed: string[] = []
    vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ token: 't', replyMessage: vi.fn(), pushMessage: async (to: string) => { pushed.push(to) } })
    await Promise.all(Array.from({ length: 10 }, () => lineBotService.sendExecDigests('2031-05-02')))
    expect(pushed.filter(x => lines.includes(x)).sort()).toEqual([...lines].sort())
    expect(count('SELECT COALESCE(SUM(n), 0) c FROM line_push_counts WHERE tenant_id = ?', t)).toBe(3)
    vi.restoreAllMocks()
  }, 60000)

  it('22. command burst: 150 x สรุปผู้บริหาร/สรุปการปิดกะ/ยอดขายวันนี้ -> one reply each, zero pushes', async () => {
    const { lines } = execShop(5)
    const replies = new Map<string, number>(), push = vi.fn()
    vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ token: 't', replyMessage: async (rt: string, m: any) => { JSON.stringify(m); replies.set(rt, (replies.get(rt) || 0) + 1) }, pushMessage: push })
    vi.spyOn(richMenus, 'syncUser').mockResolvedValue()
    const texts = ['สรุปผู้บริหาร', 'สรุปการปิดกะ', 'ยอดขายวันนี้']
    const evs = Array.from({ length: 150 }, (_, i) => ({ type: 'message', replyToken: `x22-${i}`, source: { type: 'user', userId: lines[i % 5] }, message: { type: 'text', text: texts[i % 3] } }))
    const t0 = Date.now()
    await Promise.all(evs.map(e => lineBotService.handleEvent(lineBotService.resolveTenant(e), e)))
    console.log(`[stress 22] 150 summary commands in ${Date.now() - t0}ms`)
    for (const e of evs) expect(replies.get(e.replyToken), e.message.text).toBe(1)
    expect(push).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  }, 60000)

  it('23. donut.png burst: 200 parallel valid/invalid -> only 200 png / 400, never 5xx', async () => {
    const a = express(); a.use('/api/line', lineBotRouter)
    const srv = a.listen(0)
    try {
      const qs = ['1000,500,200', '0,0,0', '1,2,3,4,5,6,7', 'abc', '-1', '1e13', '5', '', '1,,2', '999999999999,1']
      const rs = await Promise.all(Array.from({ length: 200 }, (_, i) => request(srv).get('/api/line/donut.png').query({ v: qs[i % qs.length] })))
      const t = tally(rs)
      expect(Object.keys(t).sort()).toEqual(['200', '400'])
      rs.filter(r => r.status === 200).forEach(r => expect(r.headers['content-type']).toBe('image/png'))
    } finally { srv.close() }
  }, 60000)

  it('24. floating Master burst: 120 mixed switch/demo/master/สลับ events -> one link row, valid state, zero pushes', async () => {
    const shops = [0, 1].map(() => { const t = 'tenant_st_' + generateId().slice(0, 8); tenants.push(t); try { db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(t, 'ร้านลอย-' + t.slice(-6)) } catch { /* มีแล้ว */ } return t })
    const uid = 'U' + generateId(), mid = `master_${process.env.MASTER_BB_USERNAME || 'stress@float.test'}`
    db.prepare('INSERT INTO line_master_links (line_user_id, master_id, view_tenant_id) VALUES (?, ?, ?)').run(uid, mid, shops[0])
    const push = vi.fn()
    vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ token: 't', replyMessage: vi.fn(), pushMessage: push })
    vi.spyOn(richMenus, 'syncUser').mockResolvedValue()
    const pb = (data: string) => ({ type: 'postback', postback: { data } })
    const kinds = [pb(`action=switch_tenant&id=${shops[0]}`), pb(`action=switch_tenant&id=${shops[1]}`), pb('action=demo_role&role=USER'), pb('action=demo_role&role=off'),
      { type: 'message', message: { type: 'text', text: 'master' } }, pb('action=master_notify&kind=daily'), { type: 'message', message: { type: 'text', text: 'แจ้งเตือน' } }]
    const evs = Array.from({ length: 120 }, (_, i) => ({ replyToken: `x24-${i}`, source: { type: 'user', userId: uid }, ...kinds[i % kinds.length] }))
    await Promise.all(evs.map(e => lineBotService.handleEvent(lineBotService.resolveTenant(e), e)))
    const rows = db.prepare('SELECT * FROM line_master_links WHERE line_user_id = ?').all(uid) as any[]
    expect(rows).toHaveLength(1)
    expect(shops).toContain(rows[0].view_tenant_id)
    expect([null, 'USER']).toContain(rows[0].demo_role)
    expect(count('SELECT COUNT(*) c FROM line_user_mappings WHERE line_user_id = ?', uid)).toBe(0)
    expect(push).not.toHaveBeenCalled()
    db.prepare('DELETE FROM line_master_links WHERE line_user_id = ?').run(uid)
    db.prepare('DELETE FROM line_master_notify WHERE line_user_id = ?').run(uid)
    vi.restoreAllMocks()
  }, 60000)
})
