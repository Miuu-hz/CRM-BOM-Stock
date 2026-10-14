import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import subscriptionRoutes from './subscription.routes'

const app = express()
app.use(express.json())
app.use('/api/subscription', subscriptionRoutes)

describe('GET /api/subscription/me', () => {
  it('401 เมื่อไม่ได้ส่ง auth token', async () => {
    const res = await request(app).get('/api/subscription/me')
    expect(res.status).toBe(401)
  })

  it('คืนข้อมูล plan, status, features, packs, addons, limits ถูกต้องสำหรับ tenant', async () => {
    const tenantId = `t_subme_${generateId()}`
    const user = createTestUser({ role: 'USER', tenantId })

    db.prepare(`
      INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, current_period_end, packs, addons)
      VALUES (?, ?, 'business', 'ACTIVE', datetime('now', '+30 days'), '["maker"]', '{"extra_users":2,"smart_unit":1}')
    `).run(generateId(), tenantId)

    const res = await request(app)
      .get('/api/subscription/me')
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.tenantId).toBe(tenantId)
    expect(res.body.data.planCode).toBe('business')
    expect(res.body.data.status).toBe('ACTIVE')
    expect(res.body.data.packs).toContain('maker')
    expect(res.body.data.features).toContain('bom')
    expect(res.body.data.features).toContain('smart_unit')
    expect(res.body.data.limits.maxUsers).toBe(5) // 3 + 2 extra_users
  })
})