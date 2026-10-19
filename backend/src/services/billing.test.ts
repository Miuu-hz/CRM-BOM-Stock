import { describe, it, expect, beforeAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import Stripe from 'stripe'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { getSubscription } from './subscription.service'
import { parseSelection, lineItems, subtotal, priceDefinitions, BillingError, classifyChange } from './billing.catalog'
import { applySubscription, assertFits, changeParams, handleEvent, trialFor, SubscriptionLike } from './billing.service'
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
    [{ plan: 'business_plus', packs: ['shop', 'maker', 'online'], addons: { subcontract: 2 } }, 'ซื้อได้ 1 ชุด'],
    [{ plan: 'business_plus', packs: ['shop', 'maker', 'online'], addons: { smart_unit: 1 } }, 'ซื้อ Add-on "smart_unit" ไม่ได้'],  // รวมในแพ็กแล้ว
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
    const s = sel({ plan: 'business_plus', packs: ['shop', 'maker', 'online', 'accounting'], addons: { extra_users: 5, subcontract: 1 } })
    for (const item of lineItems(s)) expect(defs.has(item.lookupKey)).toBe(true)
    expect(subtotal(sel({ addons: { smart_unit: 1 } }))).toBe(690 + 290)  // Business ซื้อ Smart Unit ได้
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
    await handleEvent(staleEvent, { retrieve: async () => latest })
    expect(getSubscription(tenantId).planCode).toBe('free')
  })

  it('checkout.session.completed ผูก subscription กับ tenant', async () => {
    const tenantId = `t_${generateId()}`
    db.prepare(`INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, stripe_subscription_id) VALUES (?, ?, 'free', 'FREE', 'sub_old')`)
      .run(generateId(), tenantId)
    const sub = fakeSub(tenantId)
    const event = { type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: sub.id, client_reference_id: tenantId } } } as unknown as Stripe.Event
    await handleEvent(event, { retrieve: async () => sub })
    expect(getSubscription(tenantId).planCode).toBe('business')
  })

  it('event อื่นไม่สนใจ', async () => {
    const never = async () => { throw new Error('ไม่ควรถูกเรียก') }
    await expect(handleEvent({ type: 'customer.created', data: { object: {} } } as unknown as Stripe.Event, { retrieve: never }))
      .resolves.toBeUndefined()
  })
})

describe('สิทธิ์ทดลองตอนสมัคร Stripe (trialFor)', () => {
  const now = Date.parse('2026-10-13T00:00:00Z')
  const inDays = (d: number) => new Date(now + d * 86400000).toISOString()
  it('Free ไม่เคยทดลอง → 30 วันเต็ม', () => {
    expect(trialFor({ stripe_customer_id: null, status: 'FREE', current_period_end: null }, now)).toEqual({ days: 30 })
  })
  it('กำลังทดลองจากการสมัครเอง → ทดลองต่อถึงวันเดิม ไม่ได้เพิ่มอีก 30 วัน', () => {
    expect(trialFor({ stripe_customer_id: null, status: 'TRIAL', current_period_end: inDays(10) }, now))
      .toEqual({ end: Math.floor((now + 10 * 86400000) / 1000) })
  })
  it('เหลือไม่ถึง 48 ชม. หรือหมดแล้ว → เก็บเงินเลย', () => {
    expect(trialFor({ stripe_customer_id: null, status: 'TRIAL', current_period_end: inDays(1) }, now)).toBeNull()
    expect(trialFor({ stripe_customer_id: null, status: 'TRIAL', current_period_end: inDays(-5) }, now)).toBeNull()
  })
  it('เคยเป็นลูกค้า Stripe แล้ว → ไม่มีทดลอง', () => {
    expect(trialFor({ stripe_customer_id: 'cus_x', status: 'FREE', current_period_end: null }, now)).toBeNull()
  })
})

describe('ทดลองใช้ (TRIAL) ใน getSubscription', () => {
  const seed = (end: string) => {
    const tenantId = `t_${generateId()}`
    db.prepare(`INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, current_period_end, packs, addons) VALUES (?, ?, 'business', 'TRIAL', ?, '["shop","accounting"]', '{}')`)
      .run(generateId(), tenantId, end)
    return tenantId
  }
  it('ระหว่างทดลอง → ได้แพ็ก + Pack ที่เลือกครบ', () => {
    const s = getSubscription(seed(new Date(Date.now() + 86400000).toISOString()))
    expect(s.status).toBe('TRIAL')
    expect(s.planCode).toBe('business')
    expect(s.features).toEqual(expect.arrayContaining(['kds', 'accounting', 'multi_currency']))
    expect(s.maxUsers).toBe(3)
  })
  it('ครบกำหนดไม่จ่าย → เหลือ Free ไม่ล็อก ไม่มี Pack', () => {
    const s = getSubscription(seed(new Date(Date.now() - 1000).toISOString()))
    expect(s.status).toBe('FREE')
    expect(s.planCode).toBe('free')
    expect(s.packs).toEqual([])
    expect(s.features).not.toContain('accounting')
    expect(s.maxUsers).toBe(1)
  })
})

describe('ขึ้นหรือลงแพ็ก (classifyChange) — ลง = มีผลวันครบรอบ ไม่คืนเงิน', () => {
  const S = (plan: string, cycle: 'monthly' | 'yearly', packs: string[] = [], addons: Record<string, number> = {}) =>
    parseSelection({ plan, cycle, packs, addons })
  it.each([
    ['Business → Solo', S('business', 'yearly', ['shop', 'maker']), S('solo', 'yearly'), 'downgrade'],
    ['Business → Business+', S('business', 'monthly', ['shop', 'maker']), S('business_plus', 'monthly', ['shop', 'maker', 'online']), 'upgrade'],
    ['รายเดือน → รายปี แพ็กเดิม', S('solo', 'monthly'), S('solo', 'yearly'), 'upgrade'],
    ['รายปี → รายเดือน แพ็กเดิม', S('solo', 'yearly'), S('solo', 'monthly'), 'downgrade'],
    ['รายปี → รายเดือน แต่ขึ้นแพ็ก (ยังจ่ายปีไว้แล้ว)', S('solo', 'yearly'), S('pro', 'monthly'), 'downgrade'],
    ['ถอด Add-on', S('business', 'monthly', ['shop', 'maker'], { backup: 1 }), S('business', 'monthly', ['shop', 'maker']), 'downgrade'],
    ['เพิ่ม Pack', S('business', 'monthly', ['shop', 'maker']), S('business', 'monthly', ['shop', 'maker', 'online']), 'upgrade'],
    ['ลดผู้ใช้เพิ่ม', S('pro', 'monthly', [], { extra_users: 3 }), S('pro', 'monthly', [], { extra_users: 1 }), 'downgrade'],
    ['สลับ Pack ราคาเท่าเดิม', S('business', 'monthly', ['shop', 'maker']), S('business', 'monthly', ['shop', 'online']), 'upgrade'],
  ])('%s → %s', (_name, cur, next, expected) => {
    expect(classifyChange(cur as any, next as any)).toBe(expected)
  })
})

describe('ด่านลดแพ็ก: ผู้ใช้ต้องพอดีแพ็กใหม่ (assertFits)', () => {
  const seedUsers = (n: number) => {
    const tenantId = `t_${generateId()}`
    for (let i = 0; i < n; i++) {
      db.prepare(`INSERT INTO users (id, email, password, name, role, tenant_id, status) VALUES (?, ?, 'x', 'u', 'USER', ?, 'active')`)
        .run(generateId(), `fit-${generateId()}@example.com`, tenantId)
    }
    return tenantId
  }
  it('3 คน → Solo (1 คน) ไม่ได้ บอกว่าต้องลดเหลือกี่คน', () => {
    const t = seedUsers(3)
    expect(() => assertFits(t, parseSelection({ plan: 'solo', cycle: 'monthly' }))).toThrow('ลบผู้ใช้ให้เหลือ 1 คน')
  })
  it('ซื้อผู้ใช้เพิ่มให้พอ → ผ่าน', () => {
    const t = seedUsers(2)
    expect(() => assertFits(t, parseSelection({ plan: 'solo', cycle: 'monthly', addons: { extra_users: 1 } }))).not.toThrow()
  })
  it('3 คน → Business (3 คน) ผ่าน', () => {
    const t = seedUsers(3)
    expect(() => assertFits(t, parseSelection({ plan: 'business', cycle: 'monthly', packs: ['shop', 'maker'] }))).not.toThrow()
  })
})

describe('สถานะลดแพ็กที่ตั้งเวลาไว้ / ยกเลิกต่ออายุ (applySubscription)', () => {
  const pendingOf = (t: string) => (db.prepare('SELECT pending_change, cancel_at FROM tenant_subscriptions WHERE tenant_id = ?').get(t) as any)
  const withPending = (sub: SubscriptionLike) => {
    applySubscription(sub)
    const pending = { plan: 'solo', cycle: 'monthly', packs: [], addons: {}, effectiveAt: '2026-12-01T00:00:00.000Z' }
    db.prepare('UPDATE tenant_subscriptions SET pending_change = ? WHERE tenant_id = ?').run(JSON.stringify(pending), sub.metadata.tenant_id)
  }
  it('ยังรอวันครบรอบ (มี schedule, แพ็กยังเป็นของเดิม) → เก็บไว้', () => {
    const t = `t_${generateId()}`
    const sub = fakeSub(t, { schedule: 'sub_sched_1' })
    withPending(sub)
    applySubscription(sub)
    expect(pendingOf(t).pending_change).toContain('"solo"')
  })
  it('ถึงวันแล้ว Stripe เปลี่ยนเป็นแพ็กใหม่ → ล้าง และสิทธิ์เป็นแพ็กใหม่', () => {
    const t = `t_${generateId()}`
    const sub = fakeSub(t, { schedule: 'sub_sched_1' })
    withPending(sub)
    applySubscription({ ...sub, metadata: { tenant_id: t, plan: 'solo', cycle: 'monthly', packs: '', addons: '{}' } })
    expect(pendingOf(t).pending_change).toBeNull()
    expect(getSubscription(t).planCode).toBe('solo')
  })
  it('schedule ถูกปล่อย/ยกเลิก → ล้าง', () => {
    const t = `t_${generateId()}`
    const sub = fakeSub(t, { schedule: 'sub_sched_1' })
    withPending(sub)
    applySubscription({ ...sub, schedule: null })
    expect(pendingOf(t).pending_change).toBeNull()
  })
  it('กดยกเลิกใน Portal → จำวันสิ้นสุด, กลับมาต่ออายุ → ล้าง', () => {
    const t = `t_${generateId()}`
    const sub = fakeSub(t, { cancel_at_period_end: true })
    applySubscription(sub)
    expect(new Date(pendingOf(t).cancel_at).getTime()).toBe(sub.items.data[0].current_period_end * 1000)
    applySubscription({ ...sub, cancel_at_period_end: false })
    expect(pendingOf(t).cancel_at).toBeNull()
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
