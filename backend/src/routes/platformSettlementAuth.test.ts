import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import platformSettlementRouter from './platformSettlement.routes'
import { createTestUser } from '../test/testAuth'

// finding #6: PUT /fee-mappings, POST /confirm, POST /:id/payout ไม่มี requireRole เลย (ตรวจกับโค้ดจริงแล้ว)
// ต่างจาก endpoint อื่นในไฟล์เดียวกัน (mapping/confirm, confirm-sale, post, unpost ฯลฯ) ที่มี requireRole
// ('ADMIN','MASTER','MANAGER') ทุกตัว — พนักงานทั่วไป (role USER) เคยแก้การผูกบัญชี/ลงบัญชีได้โดยไม่ต้องมีสิทธิ์
const app = express()
app.use(express.json())
app.use('/api/platform-settlement', platformSettlementRouter)

describe('platformSettlement.routes — requireRole บน endpoint ที่แก้ค่า/ลงบัญชี (finding #6)', () => {
  it('PUT /fee-mappings: role USER (พนักงานทั่วไป) ต้องถูกบล็อก 403', async () => {
    const u = createTestUser({ role: 'USER' })
    const res = await request(app).put('/api/platform-settlement/fee-mappings').set('Authorization', `Bearer ${u.token}`).send({ updates: [] })
    expect(res.status).toBe(403)
  })

  it('POST /confirm: role USER ต้องถูกบล็อก 403', async () => {
    const u = createTestUser({ role: 'USER' })
    const res = await request(app).post('/api/platform-settlement/confirm').set('Authorization', `Bearer ${u.token}`).send({})
    expect(res.status).toBe(403)
  })

  it('POST /:id/payout: role USER ต้องถูกบล็อก 403', async () => {
    const u = createTestUser({ role: 'USER' })
    const res = await request(app).post('/api/platform-settlement/abc123/payout').set('Authorization', `Bearer ${u.token}`).send({})
    expect(res.status).toBe(403)
  })

  it('PUT /fee-mappings: role ADMIN ผ่าน requireRole (ไม่ใช่ 403)', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const res = await request(app).put('/api/platform-settlement/fee-mappings').set('Authorization', `Bearer ${u.token}`).send({ updates: [{ id: 'nonexistent' }] })
    expect(res.status).not.toBe(403)
  })
})
