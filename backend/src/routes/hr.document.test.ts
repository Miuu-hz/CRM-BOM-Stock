import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import hrDocumentRoutes from './hr.document.routes'
import { createTestUser } from '../test/testAuth'

function buildApp() {
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.use('/api/hr', authenticate, subscriptionGate('hr'))
  app.use('/api/hr', hrDocumentRoutes)
  return app
}

const tenants: string[] = []

afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['payment_attachments', 'hr_employee_documents', 'hr_doc_templates', 'employees', 'company_settings', 'tenant_subscriptions', 'users']) {
      db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t)
    }
  }
})

const newAdmin = () => { const u = createTestUser({ role: 'ADMIN' }); tenants.push(u.tenantId); return u }
const newUser = (tenantId?: string) => {
  const u = createTestUser({ role: 'USER', tenantId })
  if (!tenantId) tenants.push(u.tenantId)
  return u
}
const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` })

function insertEmployee(tenantId: string, code: string, userId?: string, status = 'ACTIVE', startDate = '2026-01-01'): string {
  const id = generateId()
  db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, last_name, position, employment_type, base_wage, start_date, status, national_id, user_id)
    VALUES (?, ?, ?, 'สมชาย', 'ใจดี', 'พนักงานขาย', 'MONTHLY', 25000, ?, ?, '1234567890123', ?)`)
    .run(id, tenantId, code, startDate, status, userId || null)
  return id
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

describe('HR Documents (10A)', () => {
  const app = buildApp()

  it('create/list/update/delete, validation, and 409 delete with attachment', async () => {
    const admin = newAdmin()
    const emp = insertEmployee(admin.tenantId, 'E1')
    const bad = await request(app).post('/api/hr/documents').set(auth(admin)).send({ employee_id: emp, doc_type: 'NOPE', title: 'x' })
    expect(bad.status).toBe(400)
    const badDate = await request(app).post('/api/hr/documents').set(auth(admin)).send({ employee_id: emp, doc_type: 'OTHER', title: 'x', expires_on: '2026-02-30' })
    expect(badDate.status).toBe(400)

    const c = await request(app).post('/api/hr/documents').set(auth(admin))
      .send({ employee_id: emp, doc_type: 'WORK_PERMIT', title: 'ใบอนุญาตทำงาน', expires_on: '2030-01-01', notes: 'ลับ' })
    expect(c.status).toBe(201)
    const id = c.body.data.id
    const l = await request(app).get(`/api/hr/documents?employee_id=${emp}&doc_type=WORK_PERMIT`).set(auth(admin))
    expect(l.body.data).toHaveLength(1)
    expect(l.body.data[0].notes).toBe('ลับ')

    const u = await request(app).put(`/api/hr/documents/${id}`).set(auth(admin)).send({ title: 'ใหม่', expires_on: null })
    expect(u.status).toBe(200)
    expect(u.body.data.title).toBe('ใหม่')
    expect(u.body.data.expires_on).toBeNull()

    db.prepare(`INSERT INTO payment_attachments (id, tenant_id, ref_type, ref_id, file_path, original_name, file_size, uploaded_by, created_at)
      VALUES (?, ?, 'EMPLOYEE_DOCUMENT', ?, 'f.pdf', 'f.pdf', 1, ?, ?)`).run(generateId(), admin.tenantId, id, admin.userId, new Date().toISOString())
    expect((await request(app).delete(`/api/hr/documents/${id}`).set(auth(admin))).status).toBe(409)
    db.prepare('DELETE FROM payment_attachments WHERE tenant_id = ?').run(admin.tenantId)
    expect((await request(app).delete(`/api/hr/documents/${id}`).set(auth(admin))).status).toBe(200)
  })

  it('PROBATION without expires_on defaults to start_date + 119 days', async () => {
    const admin = newAdmin()
    const emp = insertEmployee(admin.tenantId, 'E1', undefined, 'ACTIVE', '2026-01-01')
    const r = await request(app).post('/api/hr/documents').set(auth(admin)).send({ employee_id: emp, doc_type: 'PROBATION', title: 'ทดลองงาน' })
    expect(r.status).toBe(201)
    expect(r.body.data.expires_on).toBe('2026-04-30')
    const r2 = await request(app).post('/api/hr/documents').set(auth(admin)).send({ employee_id: emp, doc_type: 'PROBATION', title: 'x', expires_on: null })
    expect(r2.body.data.expires_on).toBeNull()
  })

  it('expiring: only ACTIVE employees, within window, sorted, negative days_left', async () => {
    const admin = newAdmin()
    const a = insertEmployee(admin.tenantId, 'A')
    const gone = insertEmployee(admin.tenantId, 'B', undefined, 'RESIGNED')
    const today = thaiDateStr()
    const mk = (emp: string, title: string, exp: string) =>
      request(app).post('/api/hr/documents').set(auth(admin)).send({ employee_id: emp, doc_type: 'OTHER', title, expires_on: exp })
    await mk(a, 'far', addDays(today, 100))
    await mk(a, 'soon', addDays(today, 10))
    await mk(a, 'expired', addDays(today, -5))
    await mk(gone, 'resigned', addDays(today, 1))
    const r = await request(app).get('/api/hr/documents/expiring?days=60').set(auth(admin))
    expect(r.status).toBe(200)
    expect(r.body.data.map((x: any) => x.title)).toEqual(['expired', 'soon'])
    expect(r.body.data.map((x: any) => x.days_left)).toEqual([-5, 10])
    expect((await request(app).get('/api/hr/documents/expiring?days=0').set(auth(admin))).status).toBe(400)
  })

  it('cross-company: B cannot see or touch A documents, templates or employees', async () => {
    const a = newAdmin()
    const b = newAdmin()
    const empA = insertEmployee(a.tenantId, 'A1')
    const empB = insertEmployee(b.tenantId, 'B1')
    const doc = await request(app).post('/api/hr/documents').set(auth(a)).send({ employee_id: empA, doc_type: 'OTHER', title: 'a' })
    const tpl = await request(app).post('/api/hr/doc-templates').set(auth(a)).send({ kind: 'CONTRACT', name: 't', body: 'x' })
    expect((await request(app).put(`/api/hr/documents/${doc.body.data.id}`).set(auth(b)).send({ title: 'z' })).status).toBe(404)
    expect((await request(app).delete(`/api/hr/documents/${doc.body.data.id}`).set(auth(b))).status).toBe(404)
    expect((await request(app).post('/api/hr/documents').set(auth(b)).send({ employee_id: empA, doc_type: 'OTHER', title: 'z' })).status).toBe(400)
    expect((await request(app).get('/api/hr/documents').set(auth(b))).body.data).toHaveLength(0)
    expect((await request(app).put(`/api/hr/doc-templates/${tpl.body.data.id}`).set(auth(b)).send({ name: 'z' })).status).toBe(404)
    expect((await request(app).delete(`/api/hr/doc-templates/${tpl.body.data.id}`).set(auth(b))).status).toBe(404)
    expect((await request(app).post(`/api/hr/doc-templates/${tpl.body.data.id}/render`).set(auth(b)).send({ employee_id: empB })).status).toBe(404)
    const tb = await request(app).post('/api/hr/doc-templates').set(auth(b)).send({ kind: 'CONTRACT', name: 't', body: 'x' })
    expect((await request(app).post(`/api/hr/doc-templates/${tb.body.data.id}/render`).set(auth(b)).send({ employee_id: empA })).status).toBe(404)
  })

  it('USER without hr gets 403; /me/documents returns only own rows without notes', async () => {
    const admin = newAdmin()
    const user = newUser(admin.tenantId)
    const me = insertEmployee(admin.tenantId, 'ME', user.userId)
    const other = insertEmployee(admin.tenantId, 'OT')
    await request(app).post('/api/hr/documents').set(auth(admin)).send({ employee_id: me, doc_type: 'OTHER', title: 'mine', notes: 'secret' })
    await request(app).post('/api/hr/documents').set(auth(admin)).send({ employee_id: other, doc_type: 'OTHER', title: 'theirs' })
    const tpl = await request(app).post('/api/hr/doc-templates').set(auth(admin)).send({ kind: 'CONTRACT', name: 't', body: 'x' })

    expect((await request(app).get('/api/hr/documents').set(auth(user))).status).toBe(403)
    expect((await request(app).get('/api/hr/documents/expiring').set(auth(user))).status).toBe(403)
    expect((await request(app).post('/api/hr/documents').set(auth(user)).send({})).status).toBe(403)
    expect((await request(app).get('/api/hr/doc-templates').set(auth(user))).status).toBe(403)
    expect((await request(app).post(`/api/hr/doc-templates/${tpl.body.data.id}/render`).set(auth(user)).send({ employee_id: me })).status).toBe(403)

    const r = await request(app).get('/api/hr/me/documents').set(auth(user))
    expect(r.status).toBe(200)
    expect(r.body.data).toHaveLength(1)
    expect(r.body.data[0].title).toBe('mine')
    expect(r.body.data[0]).not.toHaveProperty('notes')
    expect(JSON.stringify(r.body)).not.toContain('secret')

    const unlinked = newUser(admin.tenantId)
    expect((await request(app).get('/api/hr/me/documents').set(auth(unlinked))).status).toBe(404)
  })

  it('render: builtin keys, unknown keys kept, no double expansion, no HTML interpretation', async () => {
    const admin = newAdmin()
    db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(admin.tenantId, 'บริษัท ทดสอบ')
    const emp = insertEmployee(admin.tenantId, 'E9')
    const body = '{{company_name}}|{{employee_name}}|{{employee_code}}|{{position}}|{{national_id}}|{{start_date}}|{{base_wage}}|{{unknown}}|{{note}}|{{trick}}|{{constructor}}|<b>{{html}}</b>'
    const tpl = await request(app).post('/api/hr/doc-templates').set(auth(admin)).send({ kind: 'WARNING', name: 't', body })
    expect(tpl.status).toBe(201)
    const r = await request(app).post(`/api/hr/doc-templates/${tpl.body.data.id}/render`).set(auth(admin))
      .send({ employee_id: emp, extra: { note: 'a {{employee_code}} b', trick: '{{national_id}}', html: '<script>x</script>', employee_code: 'FAKE' } })
    expect(r.status).toBe(200)
    expect(r.body.data.text).toBe(
      'บริษัท ทดสอบ|สมชาย ใจดี|E9|พนักงานขาย|1234567890123|2026-01-01|25,000.00|{{unknown}}|a {{employee_code}} b|{{national_id}}|{{constructor}}|<b><script>x</script></b>'
    )
    expect((await request(app).post(`/api/hr/doc-templates/${tpl.body.data.id}/render`).set(auth(admin)).send({ employee_id: emp, extra: { a: 1 } })).status).toBe(400)
  })

  it('template CRUD validates input', async () => {
    const admin = newAdmin()
    expect((await request(app).post('/api/hr/doc-templates').set(auth(admin)).send({ kind: 'X', name: 'n' })).status).toBe(400)
    expect((await request(app).post('/api/hr/doc-templates').set(auth(admin)).send({ kind: 'CONTRACT', name: '' })).status).toBe(400)
    const c = await request(app).post('/api/hr/doc-templates').set(auth(admin)).send({ kind: 'CONTRACT', name: 'n', body: 'b' })
    const u = await request(app).put(`/api/hr/doc-templates/${c.body.data.id}`).set(auth(admin)).send({ body: 'new' })
    expect(u.body.data.body).toBe('new')
    expect(u.body.data.name).toBe('n')
    expect((await request(app).get('/api/hr/doc-templates').set(auth(admin))).body.data).toHaveLength(1)
    expect((await request(app).delete(`/api/hr/doc-templates/${c.body.data.id}`).set(auth(admin))).status).toBe(200)
  })

  it('GET /doc-templates/:id/pdf returns PDF buffer, handles cross-company (404) and no-permission (403)', async () => {
    const binaryParser = (res: any, cb: (err: Error | null, res: Buffer) => void) => {
      const data: Buffer[] = []
      res.on('data', (chunk: Buffer) => data.push(chunk))
      res.on('end', () => cb(null, Buffer.concat(data)))
    }

    const adminA = newAdmin()
    const adminB = newAdmin()
    const userA = newUser(adminA.tenantId)

    db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(adminA.tenantId, 'บริษัท ทดสอบ จำกัด')
    const empA = insertEmployee(adminA.tenantId, 'E1')
    const tplA = await request(app).post('/api/hr/doc-templates').set(auth(adminA)).send({
      kind: 'CONTRACT',
      name: 'สัญญาจ้าง',
      body: 'สัญญาจ้างระหว่าง {{company_name}} กับ {{employee_name}}',
    })
    expect(tplA.status).toBe(201)
    const tplId = tplA.body.data.id

    // 200 with PDF buffer starting with %PDF-
    const res = await request(app)
      .get(`/api/hr/doc-templates/${tplId}/pdf?employee_id=${empA}`)
      .set(auth(adminA))
      .buffer(true)
      .parse(binaryParser)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''")
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-')

    // 404 for ids of another company (Company B accessing Company A's template)
    const crossRes = await request(app)
      .get(`/api/hr/doc-templates/${tplId}/pdf?employee_id=${empA}`)
      .set(auth(adminB))
      .buffer(true)
      .parse(binaryParser)
    expect(crossRes.status).toBe(404)

    // 403 for user without hr permission
    const noPermRes = await request(app)
      .get(`/api/hr/doc-templates/${tplId}/pdf?employee_id=${empA}`)
      .set(auth(userA))
      .buffer(true)
      .parse(binaryParser)
    expect(noPermRes.status).toBe(403)
  })
})
