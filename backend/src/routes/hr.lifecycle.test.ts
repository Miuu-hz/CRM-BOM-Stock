import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import { subscriptionGate } from '../middleware/subscription.middleware'
import lifecycleRoutes, { computeFinalPay, severanceDaysFor, startChecklist } from './hr.lifecycle.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/hr', authenticate, subscriptionGate('hr'))
app.use('/api/hr', lifecycleRoutes)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tb of ['hr_checklist_items', 'hr_checklist_templates', 'hr_asset_loans', 'hr_assets', 'line_user_mappings', 'employee_advances', 'leave_requests', 'leave_types', 'employees', 'tenant_subscriptions', 'users'])
      db.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).run(t)
  }
})
const admin = (role: any = 'ADMIN', tenantId?: string) => {
  const u = createTestUser({ role, tenantId })
  if (!tenantId) tenants.push(u.tenantId)
  return u
}
const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` })

function insertEmp(tenantId: string, opts: { userId?: string; start?: string; end?: string; type?: string; wage?: number } = {}) {
  const id = generateId()
  db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, last_name, employment_type, base_wage, start_date, end_date, status, user_id)
    VALUES (?, ?, ?, 'ส', 'ด', ?, ?, ?, ?, 'ACTIVE', ?)`)
    .run(id, tenantId, `E${id.slice(0, 6)}`, opts.type ?? 'MONTHLY', opts.wage ?? 30000, opts.start ?? '2020-01-01', opts.end ?? null, opts.userId ?? null)
  return id
}

describe('computeFinalPay (pure)', () => {
  it('severance brackets at every boundary', () => {
    const cases: [number, number][] = [
      [0, 0], [119, 0], [120, 30], [364, 30], [365, 90], [3 * 365 - 1, 90], [3 * 365, 180],
      [6 * 365 - 1, 180], [6 * 365, 240], [10 * 365 - 1, 240], [10 * 365, 300], [20 * 365 - 1, 300], [20 * 365, 400], [9000, 400],
    ]
    for (const [d, s] of cases) expect(severanceDaysFor(d), `day ${d}`).toBe(s)
  })

  it('daily wage per employment type and rounding', () => {
    const base = { tenureDays: 400, unusedAnnualLeaveDays: 2, outstandingAdvances: 100.456 }
    const m = computeFinalPay({ ...base, employmentType: 'MONTHLY', baseWage: 10000 })
    expect(m.dailyWage).toBe(333.33)
    expect(m.severanceDays).toBe(90)
    expect(m.severanceAmount).toBe(30000)
    expect(m.leavePayout).toBe(666.67)
    expect(m.outstandingAdvances).toBe(100.46)
    expect(computeFinalPay({ ...base, employmentType: 'DAILY', baseWage: 500 }).dailyWage).toBe(500)
    const h = computeFinalPay({ ...base, employmentType: 'HOURLY', baseWage: 60 })
    expect(h.dailyWage).toBe(480)
    expect(h.leavePayout).toBe(960)
  })

  it('zero severance under 120 days and negative inputs clamp', () => {
    const r = computeFinalPay({ employmentType: 'DAILY', baseWage: 400, tenureDays: 50, unusedAnnualLeaveDays: -3, outstandingAdvances: 0 })
    expect(r.severanceAmount).toBe(0)
    expect(r.leavePayout).toBe(0)
  })
})

describe('HR lifecycle routes', () => {
  it('templates: seed once (409 after), CRUD, validation', async () => {
    const a = admin()
    const seed = await request(app).post('/api/hr/checklist-templates/seed-defaults').set(auth(a))
    expect(seed.status).toBe(201)
    expect((await request(app).post('/api/hr/checklist-templates/seed-defaults').set(auth(a))).status).toBe(409)
    const off = await request(app).get('/api/hr/checklist-templates?kind=OFFBOARD').set(auth(a))
    expect(off.body.data.map((t: any) => t.auto_action).filter(Boolean)).toEqual(['DISABLE_USER', 'UNLINK_LINE'])
    expect((await request(app).post('/api/hr/checklist-templates').set(auth(a)).send({ kind: 'X', title: 't' })).status).toBe(400)
    expect((await request(app).post('/api/hr/checklist-templates').set(auth(a)).send({ kind: 'ONBOARD', title: 't', org_unit_id: 'nope' })).status).toBe(400)
    const c = await request(app).post('/api/hr/checklist-templates').set(auth(a)).send({ kind: 'ONBOARD', title: 'ใหม่' })
    expect(c.status).toBe(201)
    const u = await request(app).put(`/api/hr/checklist-templates/${c.body.data.id}`).set(auth(a)).send({ title: 'แก้', is_active: false })
    expect(u.body.data.title).toBe('แก้')
    expect(u.body.data.is_active).toBe(false)
    expect((await request(app).delete(`/api/hr/checklist-templates/${c.body.data.id}`).set(auth(a))).status).toBe(200)
  })

  it('start checklist: 400 without templates, 201, 409 while open, startChecklist export', async () => {
    const a = admin()
    const emp = insertEmp(a.tenantId)
    expect((await request(app).post(`/api/hr/employees/${emp}/checklists`).set(auth(a)).send({ kind: 'ONBOARD' })).status).toBe(400)
    await request(app).post('/api/hr/checklist-templates/seed-defaults').set(auth(a))
    const r = await request(app).post(`/api/hr/employees/${emp}/checklists`).set(auth(a)).send({ kind: 'ONBOARD' })
    expect(r.status).toBe(201)
    expect(r.body.data.created).toBe(6)
    expect((await request(app).post(`/api/hr/employees/${emp}/checklists`).set(auth(a)).send({ kind: 'ONBOARD' })).status).toBe(409)
    expect(startChecklist(a.tenantId, emp, 'ONBOARD', a.userId)).toBe(0)
    expect(startChecklist(a.tenantId, emp, 'OFFBOARD', a.userId)).toBe(7)
    const list = await request(app).get(`/api/hr/employees/${emp}/checklists?kind=ONBOARD`).set(auth(a))
    expect(list.body.data).toHaveLength(6)
  })

  function offboardItems(a: { tenantId: string; userId: string }, empId: string) {
    db.prepare(`INSERT INTO hr_checklist_items (id, tenant_id, employee_id, kind, title, auto_action, sort_order) VALUES (?, ?, ?, 'OFFBOARD', 'x', 'DISABLE_USER', 1)`).run('dis-' + empId, a.tenantId, empId)
    db.prepare(`INSERT INTO hr_checklist_items (id, tenant_id, employee_id, kind, title, auto_action, sort_order) VALUES (?, ?, ?, 'OFFBOARD', 'y', 'UNLINK_LINE', 2)`).run('unl-' + empId, a.tenantId, empId)
  }
  const status = (id: string) => (db.prepare('SELECT status FROM users WHERE id = ?').get(id) as any).status

  it('DISABLE_USER disables a normal user in this company only; undo does not revert', async () => {
    const a = admin()
    const target = admin('USER', a.tenantId)
    const emp = insertEmp(a.tenantId, { userId: target.userId })
    offboardItems(a, emp)
    const r = await request(app).put(`/api/hr/checklist-items/dis-${emp}`).set(auth(a)).send({ done: true })
    expect(r.status).toBe(200)
    expect(status(target.userId)).toBe('inactive')
    const undo = await request(app).put(`/api/hr/checklist-items/dis-${emp}`).set(auth(a)).send({ done: false })
    expect(undo.body.message).toContain('ไม่ย้อน')
    expect(status(target.userId)).toBe('inactive')
  })

  it('DISABLE_USER refuses caller and OWNER/MASTER, leaving them active', async () => {
    const a = admin()
    const self = insertEmp(a.tenantId, { userId: a.userId })
    offboardItems(a, self)
    expect((await request(app).put(`/api/hr/checklist-items/dis-${self}`).set(auth(a)).send({ done: true })).status).toBe(400)
    expect(status(a.userId)).toBe('active')
    expect((await request(app).get(`/api/hr/employees/${self}/checklists`).set(auth(a))).body.data.find((i: any) => i.id === `dis-${self}`).done_at).toBeNull()
    const owner = admin('OWNER', a.tenantId)
    const e2 = insertEmp(a.tenantId, { userId: owner.userId })
    offboardItems(a, e2)
    expect((await request(app).put(`/api/hr/checklist-items/dis-${e2}`).set(auth(a)).send({ done: true })).status).toBe(400)
    expect(status(owner.userId)).toBe('active')
  })

  it('DISABLE_USER ignores a user_id belonging to another company', async () => {
    const a = admin()
    const b = admin()
    const emp = insertEmp(a.tenantId, { userId: b.userId })
    offboardItems(a, emp)
    const r = await request(app).put(`/api/hr/checklist-items/dis-${emp}`).set(auth(a)).send({ done: true })
    expect(r.status).toBe(200)
    expect(status(b.userId)).toBe('active')
  })

  it('UNLINK_LINE deletes only that user mapping in this company', async () => {
    const a = admin()
    const b = admin()
    const target = admin('USER', a.tenantId)
    const other = admin('USER', a.tenantId)
    const emp = insertEmp(a.tenantId, { userId: target.userId })
    offboardItems(a, emp)
    const map = db.prepare(`INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, 'USER')`)
    map.run(generateId(), a.tenantId, target.userId, 'L1')
    map.run(generateId(), a.tenantId, other.userId, 'L2')
    map.run(generateId(), b.tenantId, target.userId, 'L3')
    expect((await request(app).put(`/api/hr/checklist-items/unl-${emp}`).set(auth(a)).send({ done: true })).status).toBe(200)
    const left = db.prepare(`SELECT line_user_id FROM line_user_mappings WHERE tenant_id IN (?, ?) ORDER BY line_user_id`).all(a.tenantId, b.tenantId) as any[]
    expect(left.map((x) => x.line_user_id)).toEqual(['L2', 'L3'])
    db.prepare('DELETE FROM line_user_mappings WHERE tenant_id = ?').run(b.tenantId)
  })

  it('final-pay: assembles leave, advances and unreturned assets', async () => {
    const a = admin()
    const emp = insertEmp(a.tenantId, { start: '2020-01-01', end: '2026-06-01', wage: 30000 })
    const ltId = generateId()
    db.prepare(`INSERT INTO leave_types (id, tenant_id, code, name, paid, days_per_year, is_active) VALUES (?, ?, 'VACATION', 'พักร้อน', 1, 6, 1)`).run(ltId, a.tenantId)
    db.prepare(`INSERT INTO leave_requests (id, tenant_id, employee_id, leave_type_id, start_date, end_date, days, status) VALUES (?, ?, ?, ?, '2026-03-01', '2026-03-02', 2, 'APPROVED')`).run(generateId(), a.tenantId, emp, ltId)
    db.prepare(`INSERT INTO employee_advances (id, tenant_id, employee_id, kind, amount, installments, installment_amount, interest_rate, interest_amount, start_period, status)
      VALUES (?, ?, ?, 'ADVANCE', 1000, 1, 1000, 0, 0, '2026-05', 'ACTIVE')`).run(generateId(), a.tenantId, emp)
    const assetId = generateId()
    db.prepare(`INSERT INTO hr_assets (id, tenant_id, code, name, status) VALUES (?, ?, 'A1', 'ยูนิฟอร์ม', 'LOANED')`).run(assetId, a.tenantId)
    db.prepare(`INSERT INTO hr_asset_loans (id, tenant_id, asset_id, employee_id, loaned_on) VALUES (?, ?, ?, ?, '2025-01-01')`).run(generateId(), a.tenantId, assetId, emp)
    const r = await request(app).get(`/api/hr/employees/${emp}/final-pay`).set(auth(a))
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ dailyWage: 1000, severanceDays: 240, severanceAmount: 240000, unusedAnnualLeaveDays: 4, leavePayout: 4000, outstandingAdvances: 1000 })
    expect(r.body.data.unreturnedAssets).toEqual([{ id: assetId, code: 'A1', name: 'ยูนิฟอร์ม', loaned_on: '2025-01-01' }])
  })

  it('cross-company ids return 404', async () => {
    const a = admin()
    const b = admin()
    const emp = insertEmp(a.tenantId)
    const tpl = (await request(app).post('/api/hr/checklist-templates').set(auth(a)).send({ kind: 'ONBOARD', title: 't' })).body.data.id
    offboardItems(a, emp)
    expect((await request(app).get(`/api/hr/employees/${emp}/final-pay`).set(auth(b))).status).toBe(404)
    expect((await request(app).get(`/api/hr/employees/${emp}/checklists`).set(auth(b))).status).toBe(404)
    expect((await request(app).post(`/api/hr/employees/${emp}/checklists`).set(auth(b)).send({ kind: 'ONBOARD' })).status).toBe(404)
    expect((await request(app).put(`/api/hr/checklist-items/dis-${emp}`).set(auth(b)).send({ done: true })).status).toBe(404)
    expect((await request(app).put(`/api/hr/checklist-templates/${tpl}`).set(auth(b)).send({ title: 'z' })).status).toBe(404)
    expect((await request(app).delete(`/api/hr/checklist-templates/${tpl}`).set(auth(b))).status).toBe(404)
    expect((await request(app).get('/api/hr/checklist-templates').set(auth(b))).body.data).toEqual([])
  })

  it('USER without hr gets 403 on every route', async () => {
    const a = admin()
    const u = admin('USER', a.tenantId)
    const emp = insertEmp(a.tenantId)
    const h = auth(u)
    expect((await request(app).get('/api/hr/checklist-templates').set(h)).status).toBe(403)
    expect((await request(app).post('/api/hr/checklist-templates').set(h).send({ kind: 'ONBOARD', title: 't' })).status).toBe(403)
    expect((await request(app).post('/api/hr/checklist-templates/seed-defaults').set(h)).status).toBe(403)
    expect((await request(app).post(`/api/hr/employees/${emp}/checklists`).set(h).send({ kind: 'ONBOARD' })).status).toBe(403)
    expect((await request(app).get(`/api/hr/employees/${emp}/final-pay`).set(h)).status).toBe(403)
    expect((await request(app).put('/api/hr/checklist-items/x').set(h).send({ done: true })).status).toBe(403)
  })
})
