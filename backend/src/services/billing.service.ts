import Stripe from 'stripe'
import { randomBytes } from 'crypto'
import { getDb } from '../db/sqlite'
import { BillingError, lineItems, parseSelection, Selection } from './billing.catalog'
import { provisionTenant, ProvisionError } from './provisioning'

let client: Stripe | null = null
export function stripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new BillingError('ยังไม่ได้ตั้งค่า Stripe (STRIPE_SECRET_KEY)')
    client = new Stripe(key)
  }
  return client
}

export const APP_URL = process.env.APP_URL || 'https://erp.phopy.net'
// webhook มาช้าหรือ Stripe ตัดบัตรซ้ำไม่ผ่านรอบแรก — เผื่อไว้ 1 วันก่อน lazy expiry ล็อกระบบ
const GRACE_MS = 86400000
const TRIAL_DAYS = 30

// metadata ของ subscription คือที่เก็บ "ลูกค้าซื้ออะไร" — ตั้งตอน checkout/เปลี่ยนแพ็กผ่าน API ของเราเท่านั้น
// (Customer Portal ตั้งค่าให้เปลี่ยนแพ็กไม่ได้ ดู scripts/stripeSetup) จึงไม่ต้องแกะจาก price ของแต่ละ item
function toMetadata(tenantId: string, sel: Selection): Record<string, string> {
  return {
    tenant_id: tenantId,
    plan: sel.plan,
    cycle: sel.cycle,
    packs: sel.packs.join(','),
    addons: JSON.stringify(sel.addons),
  }
}

function fromMetadata(md: Record<string, string>): Selection {
  return parseSelection({
    plan: md.plan,
    cycle: md.cycle,
    packs: md.packs ? md.packs.split(',') : [],
    addons: md.addons ? JSON.parse(md.addons) : {},
  })
}

// ส่วนที่ต้องใช้จาก Stripe.Subscription — แยกเป็น type เล็กเพื่อให้เทสต์ส่ง object ธรรมดาได้
export interface SubscriptionLike {
  id: string
  status: Stripe.Subscription.Status
  customer: string | { id: string }
  metadata: Record<string, string>
  items: { data: { current_period_end: number }[] }
}

// เขียนสิทธิ์ของ tenant ตามสถานะ subscription ใน Stripe — เรียกซ้ำกี่ครั้งก็ได้ผลเท่าเดิม
export function applySubscription(sub: SubscriptionLike): void {
  const tenantId = sub.metadata.tenant_id
  if (!tenantId) {
    console.warn(`[billing] subscription ${sub.id} ไม่มี tenant_id ใน metadata — ข้าม`)
    return
  }
  const db = getDb()
  const current = db.prepare('SELECT stripe_subscription_id FROM tenant_subscriptions WHERE tenant_id = ?').get(tenantId) as any
  // subscription เก่าที่ถูกแทนแล้ว (เช่นยกเลิกแล้วสมัครใหม่) ห้ามมาทับสิทธิ์ของตัวใหม่
  if (current?.stripe_subscription_id && current.stripe_subscription_id !== sub.id) {
    console.warn(`[billing] ข้าม ${sub.id}: tenant ${tenantId} ใช้ ${current.stripe_subscription_id} อยู่`)
    return
  }
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
  const now = new Date().toISOString()

  if (sub.status === 'incomplete') return  // ยังจ่ายไม่ผ่าน — รอ event ถัดไป

  if (['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status)) {
    // เลิกจ่าย → กลับเป็น Free (ข้อมูลอยู่ครบ) แทนที่จะล็อกทั้งบริษัท
    upsert(tenantId, {
      plan_code: 'free', status: 'FREE', billing_cycle: null, current_period_end: null,
      packs: '[]', addons: '{}', stripe_customer_id: customerId, stripe_subscription_id: null, updated_at: now,
    })
    return
  }

  // active / trialing / past_due (Stripe กำลังตัดบัตรซ้ำ) / paused → ใช้ได้ถึงสิ้นรอบ
  const sel = fromMetadata(sub.metadata)
  const periodEnd = Math.max(...sub.items.data.map(i => i.current_period_end)) * 1000 + GRACE_MS
  upsert(tenantId, {
    plan_code: sel.plan, status: 'ACTIVE', billing_cycle: sel.cycle,
    current_period_end: new Date(periodEnd).toISOString(),
    packs: JSON.stringify(sel.packs), addons: JSON.stringify(sel.addons),
    stripe_customer_id: customerId, stripe_subscription_id: sub.id, updated_at: now,
  })
}

function upsert(tenantId: string, fields: Record<string, string | null>): void {
  const cols = Object.keys(fields)
  getDb().prepare(`
    INSERT INTO tenant_subscriptions (id, tenant_id, current_period_start, ${cols.join(', ')})
    VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')})
    ON CONFLICT(tenant_id) DO UPDATE SET ${cols.map(c => `${c} = excluded.${c}`).join(', ')}
  `).run(randomBytes(8).toString('hex'), tenantId, new Date().toISOString(), ...Object.values(fields))
}

// สมัครใหม่จากหน้าราคา: จ่าย/เริ่มทดลองสำเร็จ = เปิดบริษัทให้เลย ไม่ต้องรอ MASTER อนุมัติ
// (ด่านกันบอทคือหน้า Checkout ของ Stripe + rate limit ของ /auth/register)
// เรียกซ้ำได้: อนุมัติไปแล้วคืน tenant เดิม
export function provisionFromSignup(signupId: string): string | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM signup_requests WHERE id = ?').get(signupId) as any
  if (!row) return null
  if (row.status === 'approved') return row.tenant_id
  if (row.status !== 'checkout') return null
  try {
    return db.transaction(() => {
      const { tenantId } = provisionTenant({
        businessName: row.business_name,
        adminEmail: row.email,
        adminName: row.admin_name,
        adminPasswordHash: row.password_hash,
      })
      db.prepare(`UPDATE signup_requests SET status = 'approved', tenant_id = ?, reviewed_by = 'stripe', reviewed_at = datetime('now') WHERE id = ?`)
        .run(tenantId, signupId)
      return tenantId
    })()
  } catch (err) {
    if (!(err instanceof ProvisionError)) throw err
    // เช่นอีเมลถูกใช้ไประหว่างรอจ่าย — ลูกค้าจ่ายแล้วแต่เปิดบริษัทไม่ได้ ต้องให้คนดูต่อ
    console.error(`[billing] เปิดบริษัทจาก signup ${signupId} (${row.email}) ไม่ได้: ${err.message} — ตรวจใน MasterPanel/Stripe`)
    db.prepare(`UPDATE signup_requests SET status = 'rejected', reject_reason = ? WHERE id = ?`)
      .run(`จ่ายผ่าน Stripe แล้วแต่เปิดบริษัทไม่ได้: ${err.message}`, signupId)
    return null
  }
}

export interface EventDeps {
  retrieve: (id: string) => Promise<SubscriptionLike>
  // ใส่ tenant_id ลง metadata ของ subscription ที่เกิดจากการสมัครใหม่ (ตอนสร้างยังไม่มี tenant)
  attachTenant: (subscriptionId: string, tenantId: string) => Promise<void>
}

const stripeDeps: EventDeps = {
  retrieve: async id => (await stripe().subscriptions.retrieve(id)) as unknown as SubscriptionLike,
  attachTenant: async (id, tenantId) => { await stripe().subscriptions.update(id, { metadata: { tenant_id: tenantId } }) },
}

// ponytail: ไม่มีตารางกัน event ซ้ำ — ทุก event ดึง subscription ล่าสุดจาก Stripe แล้วเขียนทับ
// จึงทนทั้ง event ซ้ำและมาผิดลำดับ (เช่น updated เก่ามาหลัง deleted)
export async function handleEvent(event: Stripe.Event, deps: EventDeps = stripeDeps): Promise<void> {
  let subscriptionId: string | null = null
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.mode !== 'subscription' || !session.subscription) return
      subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id
      let tenantId = session.client_reference_id
      const signupId = session.metadata?.signup_request_id
      if (signupId) {
        tenantId = provisionFromSignup(signupId)
        if (!tenantId) return
        await deps.attachTenant(subscriptionId, tenantId)
      }
      // ผูก subscription ใหม่กับ tenant ก่อน apply เพื่อให้ผ่านด่าน "subscription เก่าห้ามทับตัวใหม่"
      if (tenantId) {
        getDb().prepare('UPDATE tenant_subscriptions SET stripe_subscription_id = ? WHERE tenant_id = ?').run(subscriptionId, tenantId)
      }
      break
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      subscriptionId = (event.data.object as Stripe.Subscription).id
      break
    case 'invoice.paid': {
      const invoice = event.data.object as any
      const sub = invoice.parent?.subscription_details?.subscription ?? invoice.subscription
      subscriptionId = typeof sub === 'string' ? sub : sub?.id ?? null
      break
    }
    default:
      return
  }
  if (subscriptionId) applySubscription(await deps.retrieve(subscriptionId))
}

interface TenantBilling { stripe_customer_id: string | null; stripe_subscription_id: string | null }

function tenantBilling(tenantId: string): TenantBilling {
  return (getDb().prepare('SELECT stripe_customer_id, stripe_subscription_id FROM tenant_subscriptions WHERE tenant_id = ?')
    .get(tenantId) as TenantBilling | undefined) ?? { stripe_customer_id: null, stripe_subscription_id: null }
}

async function resolvePrices(sel: Selection): Promise<{ price: string; quantity: number }[]> {
  const items = lineItems(sel)
  const prices = await stripe().prices.list({ lookup_keys: items.map(i => i.lookupKey), active: true, limit: 20 })
  return items.map(item => {
    const price = prices.data.find(p => p.lookup_key === item.lookupKey)
    if (!price) throw new Error(`ไม่พบ Price ${item.lookupKey} ใน Stripe — รัน dist/scripts/stripeSetup.js`)
    return { price: price.id, quantity: item.quantity }
  })
}

let vatRateId: string | null = null
async function vatRate(): Promise<string> {
  if (vatRateId) return vatRateId
  const rates = await stripe().taxRates.list({ active: true, limit: 100 })
  const vat = rates.data.find(r => r.metadata?.phopy === 'vat7')
  if (!vat) throw new Error('ไม่พบ Tax Rate VAT 7% ใน Stripe — รัน dist/scripts/stripeSetup.js')
  vatRateId = vat.id
  return vat.id
}

export type CheckoutResult = { url: string } | { updated: true }

// ยังไม่มี subscription → ส่งไปหน้า Stripe Checkout
// มีอยู่แล้ว → เปลี่ยน item ใน subscription เดิม (Stripe คิดส่วนต่างตามวันที่เหลือให้เอง)
export async function checkout(tenantId: string, email: string, input: unknown): Promise<CheckoutResult> {
  const sel = parseSelection(input)
  const billing = tenantBilling(tenantId)
  const items = await resolvePrices(sel)
  const metadata = toMetadata(tenantId, sel)

  if (billing.stripe_subscription_id) {
    const existing = await stripe().subscriptions.retrieve(billing.stripe_subscription_id)
    if (!['canceled', 'incomplete_expired'].includes(existing.status)) {
      const updated = await stripe().subscriptions.update(existing.id, {
        items: [...existing.items.data.map(i => ({ id: i.id, deleted: true })), ...items],
        metadata,
        cancel_at_period_end: false,
        proration_behavior: 'always_invoice',
      })
      applySubscription(updated as unknown as SubscriptionLike)
      return { updated: true }
    }
  }

  return createSession({
    items, metadata, email, customer: billing.stripe_customer_id, clientReferenceId: tenantId,
    successUrl: `${APP_URL}/billing?status=success`, cancelUrl: `${APP_URL}/billing?status=cancel`,
  })
}

// สมัครใหม่จากหน้าราคา phopy.net — ยังไม่มี tenant, webhook เปิดบริษัทให้ตอน checkout เสร็จ (provisionFromSignup)
export async function signupCheckout(signupId: string, email: string, sel: Selection): Promise<{ url: string }> {
  return createSession({
    items: await resolvePrices(sel),
    metadata: { ...toMetadata('', sel), signup_request_id: signupId },
    sessionMetadata: { signup_request_id: signupId },
    email, customer: null, clientReferenceId: null,
    successUrl: `${APP_URL}/?signup=success`,
    cancelUrl: `${APP_URL}/?signup=cancel&plan=${sel.plan}&cycle=${sel.cycle}`,
  })
}

interface SessionOptions {
  items: { price: string; quantity: number }[]
  metadata: Record<string, string>         // ติดไปกับ subscription
  sessionMetadata?: Record<string, string> // ติดกับ checkout session (อ่านใน checkout.session.completed)
  email: string
  customer: string | null
  clientReferenceId: string | null
  successUrl: string
  cancelUrl: string
}

async function createSession(o: SessionOptions): Promise<{ url: string }> {
  // ทดลองฟรี 30 วัน ไม่ต้องใส่บัตร — ครั้งแรกครั้งเดียวต่อบริษัท (เคยเป็นลูกค้า Stripe แล้ว = ใช้สิทธิ์ไปแล้ว)
  const firstTime = !o.customer
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    line_items: o.items,
    ...(o.clientReferenceId ? { client_reference_id: o.clientReferenceId } : {}),
    ...(o.sessionMetadata ? { metadata: o.sessionMetadata } : {}),
    ...(o.customer
      ? { customer: o.customer, customer_update: { name: 'auto' as const, address: 'auto' as const } }
      : { customer_email: o.email }),
    // ใบกำกับภาษีเต็มรูปต้องมีชื่อ ที่อยู่ เลขผู้เสียภาษีของผู้ซื้อ
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    payment_method_collection: firstTime ? 'if_required' : 'always',
    subscription_data: {
      metadata: o.metadata,
      default_tax_rates: [await vatRate()],
      ...(firstTime ? {
        trial_period_days: TRIAL_DAYS,
        trial_settings: { end_behavior: { missing_payment_method: 'cancel' as const } },
      } : {}),
    },
    locale: 'th',
    success_url: o.successUrl,
    cancel_url: o.cancelUrl,
  })
  if (!session.url) throw new Error('Stripe ไม่คืน URL ของหน้าชำระเงิน')
  return { url: session.url }
}

export async function portal(tenantId: string): Promise<string> {
  const { stripe_customer_id } = tenantBilling(tenantId)
  if (!stripe_customer_id) throw new BillingError('ยังไม่เคยสมัครแพ็กเกจแบบเสียเงิน')
  const configs = await stripe().billingPortal.configurations.list({ active: true, limit: 100 })
  const config = configs.data.find(c => c.metadata?.phopy === 'portal')
  const session = await stripe().billingPortal.sessions.create({
    customer: stripe_customer_id,
    return_url: `${APP_URL}/billing`,
    ...(config ? { configuration: config.id } : {}),
  })
  return session.url
}
