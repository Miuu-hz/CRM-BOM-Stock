import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate } from '../middleware/auth.middleware'
import attachmentsRoutes from './attachments.routes'
import { createTestUser } from '../test/testAuth'

// mount เหมือน backend/src/index.ts: authenticate อย่างเดียว gate ต่อ ref_type อยู่ในตัว router
const app = express()
app.use(express.json())
app.use('/api/attachments', authenticate)
app.use('/api/attachments', attachmentsRoutes)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['payment_attachments', 'hr_employee_documents', 'employees', 'tenant_subscriptions', 'users']) {
      db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t)
    }
  }
})

function seedEmployee(tenantId: string, code: string, userId?: string) {
  const id = generateId()
  db.prepare(`INSERT INTO employees (id, tenant_id, code, first_name, employment_type, base_wage, start_date, status, user_id)
    VALUES (?, ?, ?, 'x', 'MONTHLY', 0, '2026-01-01', 'ACTIVE', ?)`).run(id, tenantId, code, userId || null)
  return id
}
function seedDoc(tenantId: string, empId: string) {
  const id = generateId()
  db.prepare(`INSERT INTO hr_employee_documents (id, tenant_id, employee_id, doc_type, title, created_at) VALUES (?, ?, ?, 'OTHER', 't', ?)`)
    .run(id, tenantId, empId, new Date().toISOString())
  return id
}

describe('EMPLOYEE_DOCUMENT attachments access', () => {
  it('enforces hr permission, ownership (read only) and tenant isolation', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    tenants.push(admin.tenantId)
    const owner = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const other = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const ownerEmp = seedEmployee(admin.tenantId, 'O', owner.userId)
    const otherEmp = seedEmployee(admin.tenantId, 'X', other.userId)
    const ownerDoc = seedDoc(admin.tenantId, ownerEmp)
    const otherDoc = seedDoc(admin.tenantId, otherEmp)
    const foreign = createTestUser({ role: 'USER' })
    tenants.push(foreign.tenantId)
    const h = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` })

    // USER ไม่มี hr ดูไฟล์ของพนักงานคนอื่น -> 403
    expect((await request(app).get(`/api/attachments/EMPLOYEE_DOCUMENT/${otherDoc}`).set(h(owner))).status).toBe(403)
    // เจ้าของเอกสาร list ได้
    expect((await request(app).get(`/api/attachments/EMPLOYEE_DOCUMENT/${ownerDoc}`).set(h(owner))).status).toBe(200)
    // เจ้าของอัปโหลดไม่ได้
    expect((await request(app).post(`/api/attachments/EMPLOYEE_DOCUMENT/${ownerDoc}`).set(h(owner))
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'a.pdf', contentType: 'application/pdf' })).status).toBe(403)
    // บริษัทอื่น -> 404
    expect((await request(app).get(`/api/attachments/EMPLOYEE_DOCUMENT/${ownerDoc}`).set(h(foreign))).status).toBe(404)
  })
})
