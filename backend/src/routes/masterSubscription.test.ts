import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import masterRouter from './master.routes'
import { createTestUser } from '../test/testAuth'
import { generateId } from '../utils/id'
import { getSubscription } from '../services/subscription.service'
import { getDb } from '../db/sqlite'

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

describe('tenant ที่จ่ายผ่าน Stripe', () => {
  it('Master เปลี่ยนแพ็ก/ต่ออายุ/ลบถาวรไม่ได้ (webhook จะเขียนทับ หรือ Stripe ตัดเงินต่อ) และเห็นลิงก์ Stripe', async () => {
    const master = createTestUser({ role: 'MASTER' })
    const tenantId = `t_${generateId()}`
    await put(master.token, tenantId, { planCode: 'business' })
    getDb().prepare("UPDATE tenant_subscriptions SET stripe_subscription_id = 'sub_x', stripe_customer_id = 'cus_x' WHERE tenant_id = ?").run(tenantId)
    const auth = { Authorization: `Bearer ${master.token}` }

    expect((await put(master.token, tenantId, { planCode: 'pro' })).status).toBe(409)
    expect((await request(app).post(`/api/master/tenant/${tenantId}/extend`).set(auth).send({ days: 30 })).status).toBe(409)
    expect((await request(app).delete(`/api/master/tenant/${tenantId}/purge`).set(auth)).status).toBe(409)
    expect(getSubscription(tenantId).planCode).toBe('business')
  })

  it('แก้ราคาแพ็กจากหน้า Master ไม่ได้ ราคาที่แสดงมาจาก catalog ที่ Stripe ใช้', async () => {
    const master = createTestUser({ role: 'MASTER' })
    const auth = { Authorization: `Bearer ${master.token}` }
    expect((await request(app).patch('/api/master/plans/business').set(auth).send({ price_monthly: 1 })).status).toBe(400)
    const plans = (await request(app).get('/api/master/plans').set(auth)).body.data
    expect(plans.find((p: any) => p.code === 'business').price_monthly).toBe(690)
  })
})
