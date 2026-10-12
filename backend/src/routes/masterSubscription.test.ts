import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import masterRouter from './master.routes'
import { createTestUser } from '../test/testAuth'
import { generateId } from '../utils/id'
import { getSubscription } from '../services/subscription.service'

const app = express()
app.use(express.json())
app.use('/api/master', masterRouter)

const put = (token: string, tenantId: string, body: object) =>
  request(app).put(`/api/master/tenant/${tenantId}/subscription`).set('Authorization', `Bearer ${token}`).send(body)

describe('MASTER ตั้ง Pack / Add-on ให้ tenant', () => {
  it('บันทึก pack + add-on แล้วสิทธิ์เปิดตามนั้น', async () => {
    const master = createTestUser({ role: 'MASTER' })
    const tenantId = `t_${generateId()}`
    const res = await put(master.token, tenantId, {
      planCode: 'business', packs: ['accounting'], addons: { extra_users: 2 },
    })
    expect(res.status).toBe(200)
    const sub = getSubscription(tenantId)
    expect(sub.features).toContain('accounting')
    expect(sub.maxUsers).toBe(5)
  })

  it('เปลี่ยนแพ็กโดยไม่ส่ง packs → pack เดิมไม่หาย', async () => {
    const master = createTestUser({ role: 'MASTER' })
    const tenantId = `t_${generateId()}`
    await put(master.token, tenantId, { planCode: 'business', packs: ['maker'] })
    await put(master.token, tenantId, { planCode: 'business_plus' })
    expect(getSubscription(tenantId).packs).toEqual(['maker'])
  })

  it.each([
    [{ packs: ['hacker'] }],
    [{ packs: ['toString'] }],
    [{ packs: 'shop' }],
    [{ addons: { extra_users: -1 } }],
    [{ addons: { extra_users: 1.5 } }],
    [{ addons: { unknown_addon: 1 } }],
    [{ addons: ['api_access'] }],
  ])('ค่าไม่ถูกต้อง %j → 400', async (bad) => {
    const master = createTestUser({ role: 'MASTER' })
    const res = await put(master.token, `t_${generateId()}`, { planCode: 'business', ...bad })
    expect(res.status).toBe(400)
  })

  it('ADMIN ของบริษัทให้ pack ตัวเองไม่ได้', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    const res = await put(admin.token, admin.tenantId, { planCode: 'pro', packs: ['shop'] })
    expect(res.status).toBe(403)
  })
})
