import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import approvalRouter from './approval.routes'
import { createTestUser } from '../test/testAuth'
import { createRequest } from '../services/approvalGate.service'

const app = express()
app.use(express.json())
app.use('/api/approval', approvalRouter)

function seedPending(tenantId: string, requesterRole = 'USER') {
  const requester = createTestUser({ role: requesterRole as any, tenantId })
  return createRequest({
    tenantId,
    user: { userId: requester.userId, email: requester.email, role: requester.role },
    category: 'stock_adjust',
    refType: 'stock_items',
    refId: generateId(),
    description: 'ขอปรับสต๊อก',
  })
}

/**
 * ทั้ง 3 เคสนี้คือบั๊กที่ทำให้ระบบอนุมัติใช้ไม่ได้จริงมาตลอด:
 * ADMIN ไม่เห็นคำขอ / กดอนุมัติแล้วค้าง PENDING / ADMIN โดน 403
 */
describe('ระบบอนุมัติ — เส้นทางของเจ้าของบริษัท', () => {
  it('ADMIN เห็นคำขอที่ค้างอยู่ โดยไม่ต้องมีแถวใน user_approval_permissions', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const pending = seedPending(admin.tenantId)

    const perms = db.prepare('SELECT COUNT(*) c FROM user_approval_permissions WHERE tenant_id = ?')
      .get(admin.tenantId) as any
    expect(perms.c).toBe(0)

    const res = await request(app).get('/api/approval/pending')
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.map((r: any) => r.id)).toContain(pending.id)
  })

  it('กดอนุมัติครั้งเดียวแล้วสถานะเปลี่ยนเป็น APPROVED จริง (ไม่ค้าง PENDING)', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const pending = seedPending(admin.tenantId)

    const res = await request(app).put(`/api/approval/requests/${pending.id}/decision`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'APPROVED', comment: '', level: 1 })   // UI ส่ง level 1 เสมอ

    expect(res.status).toBe(200)
    const after = db.prepare('SELECT status, executed_at FROM approval_requests WHERE id = ?')
      .get(pending.id) as any
    expect(after.status).not.toBe('PENDING')
    expect(after.executed_at).toBeTruthy()
  })

  it('ปฏิเสธแล้วสถานะเป็น REJECTED', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const pending = seedPending(admin.tenantId)

    await request(app).put(`/api/approval/requests/${pending.id}/decision`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'REJECTED', comment: 'ไม่อนุมัติ', level: 1 })

    const after = db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(pending.id) as any
    expect(after.status).toBe('REJECTED')
  })

  it('พนักงานธรรมดาอนุมัติไม่ได้', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const pending = seedPending(admin.tenantId)
    const user = createTestUser({ role: 'USER', tenantId: admin.tenantId })

    const res = await request(app).put(`/api/approval/requests/${pending.id}/decision`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ decision: 'APPROVED', level: 1 })

    expect(res.status).toBe(403)
    const after = db.prepare('SELECT status FROM approval_requests WHERE id = ?').get(pending.id) as any
    expect(after.status).toBe('PENDING')
  })

  it('คำขอของ tenant อื่นมองไม่เห็น', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const otherAdmin = createTestUser({ role: 'ADMIN' })
    const foreign = seedPending(otherAdmin.tenantId)

    const res = await request(app).get('/api/approval/pending')
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.body.data.map((r: any) => r.id)).not.toContain(foreign.id)
  })
})

describe('ประวัติการอนุมัติ — GET /approval/history', () => {
  it('กรองด้วย from/to ตามช่วงวันที่ และนับ total ให้ถูก', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const old = seedPending(admin.tenantId)
    db.prepare("UPDATE approval_requests SET created_at = ? WHERE id = ?")
      .run('2020-01-01T00:00:00.000Z', old.id)
    const recent = seedPending(admin.tenantId)

    const res = await request(app).get('/api/approval/history?from=2025-01-01')
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.map((r: any) => r.id)
    expect(ids).toContain(recent.id)
    expect(ids).not.toContain(old.id)
    expect(res.body.total).toBe(ids.length)
  })

  it('ADMIN/MASTER เห็นทั้ง tenant ส่วนพนักงานธรรมดาเห็นแค่คำขอของตัวเอง', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const me = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const other = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const mine = seedPending(admin.tenantId)
    db.prepare('UPDATE approval_requests SET requester_id = ? WHERE id = ?').run(me.userId, mine.id)
    const others = seedPending(admin.tenantId)
    db.prepare('UPDATE approval_requests SET requester_id = ? WHERE id = ?').run(other.userId, others.id)

    const asMe = await request(app).get('/api/approval/history').set('Authorization', `Bearer ${me.token}`)
    const meIds = asMe.body.data.map((r: any) => r.id)
    expect(meIds).toContain(mine.id)
    expect(meIds).not.toContain(others.id)

    const asAdmin = await request(app).get('/api/approval/history').set('Authorization', `Bearer ${admin.token}`)
    const adminIds = asAdmin.body.data.map((r: any) => r.id)
    expect(adminIds).toContain(mine.id)
    expect(adminIds).toContain(others.id)
  })

  it('เห็นแถวสถานะ AUTO ด้วย ไม่ใช่แค่ PENDING/APPROVED/REJECTED', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const auto = createRequest({
      tenantId: admin.tenantId,
      user: { userId: admin.userId, email: admin.email, role: admin.role },
      category: 'stock_adjust', refType: 'stock_items', refId: generateId(), description: 'ทำเลย',
    })
    db.prepare("UPDATE approval_requests SET status = 'AUTO' WHERE id = ?").run(auto.id)

    const res = await request(app).get('/api/approval/history?status=AUTO')
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.body.data.map((r: any) => r.id)).toContain(auto.id)
  })
})

describe('รายละเอียดคำขอ — GET /approval/requests/:id/detail', () => {
  it('แกะ payload เป็น { before, update } ให้แยกกันสำหรับหมวด doc_edit', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const created = createRequest({
      tenantId: admin.tenantId,
      user: { userId: admin.userId, email: admin.email, role: admin.role },
      category: 'doc_edit', refType: 'purchase_orders', refId: 'po-detail-1', description: 'แก้ไข PO',
      payload: { before: { total: 100 }, update: { total: 200 } },
    })

    const res = await request(app).get(`/api/approval/requests/${created.id}/detail`)
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.before).toEqual({ total: 100 })
    expect(res.body.data.payload).toEqual({ total: 200 })
  })

  it('เจ้าของคำขอดูของตัวเองได้ คนอื่นดูไม่ได้', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const owner = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const stranger = createTestUser({ role: 'USER', tenantId: admin.tenantId })
    const created = createRequest({
      tenantId: admin.tenantId,
      user: { userId: owner.userId, email: owner.email, role: owner.role },
      category: 'stock_adjust', refType: 'stock_items', refId: generateId(), description: 'ของฉัน',
    })

    const mine = await request(app).get(`/api/approval/requests/${created.id}/detail`)
      .set('Authorization', `Bearer ${owner.token}`)
    expect(mine.status).toBe(200)

    const notMine = await request(app).get(`/api/approval/requests/${created.id}/detail`)
      .set('Authorization', `Bearer ${stranger.token}`)
    expect(notMine.status).toBe(403)
  })
})
