import { describe, it, expect, beforeAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import Stripe from 'stripe'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { getSubscription } from './subscription.service'
import { parseSelection, lineItems, subtotal, priceDefinitions, BillingError } from './billing.catalog'
import { applySubscription, changeParams, handleEvent, provisionFromSignup, SubscriptionLike } from './billing.service'
import billingRouter from '../routes/billing.routes'

const sel = (over: Record<string, unknown>) => parseSelection({ plan: 'business', cycle: 'monthly', packs: ['shop', 'maker'], addons: {}, ...over })

describe('ตรวจคำสั่งซื้อ (parseSelection)', () => {
  it.each([
    [{ plan: 'free' }, 'ไม่พบแพ็กเกจ'],
    [{ plan: 'toString' }, 'ไม่พบแพ็กเกจ'],
    [{ cycle: 'weekly' }, 'รอบบิล'],
    [{ packs: ['shop'] }, 'ต้องเลือก 2 Pack'],
    [{ plan: 'business_plus', packs: ['shop', 'maker'] }, 'ต้องเลือก 3 Pack'],
    [{ packs: ['hacker'] }, 'Pack ต้องเป็น'],
    [{ plan: 'solo', packs: ['shop'] }, 'เลือก Pack ไม่ได้'],
    [{ addons: { extra_users: 3 } }, 'ไม่เกิน 2 คน'],
    [{ addons: { extra_users: 1.5 } }, 'จำนวนเต็ม'],
    [{ addons: { api_access: 1 } }, 'ซื้อ Add-on "api_access" ไม่ได้'],
    [{ plan: 'business_plus', packs: ['shop', 'online', 'accounting'], addons: { subcontract: 1 } }, 'ต้องเลือก Pack Maker'],
    [{ plan: 'business_plus', packs: ['shop', 'maker', 'online'], addons: { smart_unit: 2 } }, 'ซื้อได้ 1 ชุด'],
  ])('%j → ปฏิเสธ', (over, msg) => {
    expect(() => sel(over)).toThrow(BillingError)
    expect(() => sel(over)).toThrow(msg)
  })

  it('Pro ได้ครบทุก Pack — packs ที่ส่งมาถูกตัดทิ้ง ไม่คิดเงินเพิ่ม', () => {
    const s = sel({ plan: 'pro', packs: ['shop', 'online', 'maker', 'accounting'] })
    expect(s.packs).toEqual([])
    expect(lineItems(s)).toEqual([{ lookupKey: 'phopy_plan_pro_monthly', quantity: 1 }])
  })
})

describe('รายการคิดเงิน (lineItems / subtotal)', () => {
  it('Business + 3 Pack (รวม 2 เกิน 1) + ผู้ใช้เพิ่ม 2 = 690 + 390 + 150×2', () => {
    const s = sel({ packs: ['shop', 'accounting', 'online'], addons: { extra_users: 2 } })
    expect(lineItems(s)).toEqual([
      { lookupKey: 'phopy_plan_business_monthly', quantity: 1 },
      { lookupKey: 'phopy_pack_monthly', quantity: 1 },
      { lookupKey: 'phopy_user_business_monthly', quantity: 2 },
    ])
    expect(subtotal(s)).toBe(690 + 390 + 300)
  })

  it('รายปี = 10 เดือนทุกรายการ', () => {
    expect(subtotal(sel({ cycle: 'yearly', addons: { backup: 1 } }))).toBe((690 + 99) * 10)
  })

  it('ราคาแพ็กตรงกับ Excel และทุก lookup key ที่ checkout ใช้มี Price ให้สร้าง', () => {
    const defs = new Map(priceDefinitions().map(d => [d.lookupKey, d.unitAmountBaht]))
    expect([...['solo', 'business', 'business_plus', 'pro', 'enterprise_ai']].map(p => defs.get(`phopy_plan_${p}_monthly`)))
      .toEqual([299, 690, 950, 1950, 3490])
    expect(defs.get('phopy_plan_solo_yearly')).toBe(2990)
    const s = sel({ plan: 'business_plus', packs: ['shop', 'maker', 'online', 'accounting'], addons: { extra_users: 5, smart_unit: 1, multi_currency: 1, subcontract: 1 } })
    for (const item of lineItems(s)) expect(defs.has(item.lookupKey)).toBe(true)
  })
})

function fakeSub(tenantId: string, over: Partial<SubscriptionLike> = {}): SubscriptionLike {
  return {
    id: `sub_${generateId()}`,
    status: 'active',
    customer: 'cus_test',
    metadata: { tenant_id: tenantId, plan: 'business', cycle: 'monthly', packs: 'maker,shop', addons: '{"extra_users":1}' },
    items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] },
    ...over,
  }
}

describe('เปลี่ยนแพ็กกลางรอบ (changeParams)', () => {
  const items = [{ price: 'price_new', quantity: 1 }]
  const existing = (status: string) => ({ status, items: { data: [{ id: 'si_old_1' }, { id: 'si_old_2' }] } }) as any

  it('จ่ายอยู่ → เริ่มรอบใหม่วันนี้ หักมูลค่าที่เหลือ เก็บเงินทันที ตัดไม่ผ่าน = ไม่เปลี่ยน', () => {
    const p = changeParams(existing('active'), items, { plan: 'pro' })
    expect(p.billing_cycle_anchor).toEqual({ type: 'now' })
    expect(p.proration_behavior).toBe('always_invoice')
    expect(p.payment_behavior).toBe('error_if_incomplete')
    expect(p.cancel_at_period_end).toBe(false)
    expect(p.items).toEqual([{ id: 'si_old_1', deleted: true }, { id: 'si_old_2', deleted: true }, ...items])
  })

  it('ช่วงทดลอง → เปลี่ยนได้เลย ไม่ตัดเงิน ไม่ตัดช่วงทดลองทิ้ง', () => {
    const p = changeParams(existing('trialing'), items, {})
    expect(p.proration_behavior).toBe('none')
    expect(p.billing_cycle_anchor).toBeUndefined()
  })
})

describe('Stripe → สิทธิ์ใน ERP (applySubscription)', () => {
  it('จ่ายสำเร็จ → ACTIVE ตามแพ็ก/Pack/Add-on ที่ซื้อ', () => {
    const tenantId = `t_${generateId()}`
    applySubscription(fakeSub(tenantId))
    const s = getSubscription(tenantId)
    expect(s.status).toBe('ACTIVE')
    expect(s.planCode).toBe('business')
    expect(s.features).toContain('bom')
    expect(s.features).not.toContain('accounting')
    expect(s.maxUsers).toBe(4)
  })

  it('trialing ใช้งานได้เหมือน active', () => {
    const tenantId = `t_${generateId()}`
    applySubscription(fakeSub(tenantId, { status: 'trialing' }))
    expect(getSubscription(tenantId).status).toBe('ACTIVE')
  })

  it('ยกเลิก/ไม่จ่าย → กลับเป็น Free ไม่ล็อกทั้งบริษัท', () => {
    const tenantId = `t_${generateId()}`
    const sub = fakeSub(tenantId)
    applySubscription(sub)
    applySubscription({ ...sub, status: 'canceled' })
    const s = getSubscription(tenantId)
    expect(s.planCode).toBe('free')
    expect(s.status).toBe('FREE')
    expect(s.packs).toEqual([])
  })

  it('subscription เก่ามาทีหลัง ห้ามทับตัวใหม่', () => {
    const tenantId = `t_${generateId()}`
    const newer = fakeSub(tenantId, { metadata: { tenant_id: tenantId, plan: 'pro', cycle: 'monthly', packs: '', addons: '{}' } })
    applySubscription(newer)
    applySubscription({ ...fakeSub(tenantId), status: 'canceled' })
    expect(getSubscription(tenantId).planCode).toBe('pro')
  })

  it('ยังจ่ายไม่ผ่าน (incomplete) → ไม่เปิดสิทธิ์', () => {
    const tenantId = `t_${generateId()}`
    applySubscription(fakeSub(tenantId, { status: 'incomplete' }))
    expect(getSubscription(tenantId).status).toBe('NONE')  // ไม่มีแถว = ยังไม่ถูกแตะ
  })

  it('ไม่มี tenant_id ใน metadata → ไม่เขียนอะไร', () => {
    expect(() => applySubscription(fakeSub('', { metadata: {} }))).not.toThrow()
  })
})

describe('handleEvent', () => {
  it('ทุก event ดึง subscription ล่าสุดก่อนเขียน (กัน event มาผิดลำดับ)', async () => {
    const tenantId = `t_${generateId()}`
    const latest = fakeSub(tenantId, { status: 'canceled' })
    const staleEvent = { type: 'customer.subscription.updated', data: { object: { ...latest, status: 'active' } } } as unknown as Stripe.Event
    await handleEvent(staleEvent, { retrieve: async () => latest, attachTenant: async () => {} })
    expect(getSubscription(tenantId).planCode).toBe('free')
  })

  it('checkout.session.completed ผูก subscription กับ tenant', async () => {
    const tenantId = `t_${generateId()}`
    db.prepare(`INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, stripe_subscription_id) VALUES (?, ?, 'free', 'FREE', 'sub_old')`)
      .run(generateId(), tenantId)
    const sub = fakeSub(tenantId)
    const event = { type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: sub.id, client_reference_id: tenantId } } } as unknown as Stripe.Event
    await handleEvent(event, { retrieve: async () => sub, attachTenant: async () => {} })
    expect(getSubscription(tenantId).planCode).toBe('business')
  })

  it('event อื่นไม่สนใจ', async () => {
    const never = async () => { throw new Error('ไม่ควรถูกเรียก') }
    await expect(handleEvent({ type: 'customer.created', data: { object: {} } } as unknown as Stripe.Event, { retrieve: never, attachTenant: never }))
      .resolves.toBeUndefined()
  })
})

function seedSignup(status = 'checkout', email = `buyer-${generateId()}@example.com`) {
  const id = generateId()
  db.prepare(`INSERT INTO signup_requests (id, business_name, admin_name, email, password_hash, status) VALUES (?, 'ร้านทดสอบ', 'เจ้าของ', ?, 'hash', ?)`)
    .run(id, email, status)
  return { id, email }
}

describe('สมัครใหม่จากหน้าราคา → จ่ายแล้วเปิดบริษัทอัตโนมัติ', () => {
  it('checkout เสร็จ → สร้างบริษัท + ADMIN + เปิดแพ็กที่ซื้อ และผูก tenant กับ subscription', async () => {
    const signup = seedSignup()
    const sub = fakeSub('')
    let attached: [string, string] | null = null
    const event = { type: 'checkout.session.completed', data: { object: {
      mode: 'subscription', subscription: sub.id, client_reference_id: null, metadata: { signup_request_id: signup.id },
    } } } as unknown as Stripe.Event
    await handleEvent(event, {
      attachTenant: async (subId, tenantId) => { attached = [subId, tenantId] },
      // Stripe คืน subscription ที่ใส่ tenant_id แล้ว
      retrieve: async () => ({ ...sub, metadata: { ...sub.metadata, tenant_id: attached![1] } }),
    })
    const row = db.prepare('SELECT status, tenant_id, reviewed_by FROM signup_requests WHERE id = ?').get(signup.id) as any
    expect(row.status).toBe('approved')
    expect(row.reviewed_by).toBe('stripe')
    expect(attached).toEqual([sub.id, row.tenant_id])
    const admin = db.prepare('SELECT role, tenant_id FROM users WHERE email = ?').get(signup.email) as any
    expect(admin).toEqual({ role: 'ADMIN', tenant_id: row.tenant_id })
    const s = getSubscription(row.tenant_id)
    expect(s.planCode).toBe('business')
    expect(s.status).toBe('ACTIVE')
  })

  it('event ซ้ำ → ไม่สร้างบริษัทซ้ำ', () => {
    const signup = seedSignup()
    const first = provisionFromSignup(signup.id)
    expect(provisionFromSignup(signup.id)).toBe(first)
    expect((db.prepare('SELECT COUNT(*) c FROM users WHERE email = ?').get(signup.email) as any).c).toBe(1)
  })

  it('คำขอ Free ที่รอ MASTER อนุมัติ เปิดผ่าน Stripe ไม่ได้', () => {
    expect(provisionFromSignup(seedSignup('pending').id)).toBeNull()
  })

  it('อีเมลถูกใช้ไปแล้วระหว่างรอจ่าย → ไม่พัง ทำเครื่องหมายให้คนตรวจ', () => {
    const signup = seedSignup()
    db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', 'x', 'ADMIN', 'other', 'active')`)
      .run(generateId(), signup.email)
    expect(provisionFromSignup(signup.id)).toBeNull()
    const row = db.prepare('SELECT status, reject_reason FROM signup_requests WHERE id = ?').get(signup.id) as any
    expect(row.status).toBe('rejected')
    expect(row.reject_reason).toContain('จ่ายผ่าน Stripe แล้ว')
  })
})

describe('POST /api/billing/webhook', () => {
  const app = express()
  app.use('/api/billing/webhook', express.raw({ type: 'application/json' }))
  app.use(express.json())
  app.use('/api/billing', billingRouter)
  const secret = 'whsec_test_only'
  beforeAll(() => { process.env.STRIPE_WEBHOOK_SECRET = secret })

  it('ลายเซ็นปลอม → 400', async () => {
    const res = await request(app).post('/api/billing/webhook')
      .set('Content-Type', 'application/json').set('stripe-signature', 't=1,v1=deadbeef').send('{"type":"x"}')
    expect(res.status).toBe(400)
  })

  it('ลายเซ็นถูก → 200 และ event ที่ไม่เกี่ยวถูกข้าม', async () => {
    const payload = JSON.stringify({ id: 'evt_test', object: 'event', type: 'customer.created', data: { object: {} } })
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret })
    const res = await request(app).post('/api/billing/webhook')
      .set('Content-Type', 'application/json').set('stripe-signature', header).send(payload)
    expect(res.status).toBe(200)
  })

  it('เส้นอื่นของ billing ต้อง login', async () => {
    const res = await request(app).get('/api/billing')
    expect(res.status).toBe(401)
  })
})
