import Stripe from 'stripe'
import { randomBytes } from 'crypto'
import { getDb } from '../db/sqlite'
import { BillingError, lineItems, parseSelection, Selection } from './billing.catalog'
import { TRIAL_DAYS } from './provisioning'

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
// Stripe ไม่รับ trial_end ที่ใกล้กว่า 48 ชม.
const MIN_TRIAL_MS = 48 * 3600000

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

export interface EventDeps {
  retrieve: (id: string) => Promise<SubscriptionLike>
}

const stripeDeps: EventDeps = {
  retrieve: async id => (await stripe().subscriptions.retrieve(id)) as unknown as SubscriptionLike,
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
      const tenantId = session.client_reference_id
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

interface TenantBilling {
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  status: string | null
  current_period_end: string | null
}

function tenantBilling(tenantId: string): TenantBilling {
  return (getDb().prepare('SELECT stripe_customer_id, stripe_subscription_id, status, current_period_end FROM tenant_subscriptions WHERE tenant_id = ?')
    .get(tenantId) as TenantBilling | undefined) ?? { stripe_customer_id: null, stripe_subscription_id: null, status: null, current_period_end: null }
}

// สิทธิ์ทดลอง 30 วันมีครั้งเดียวต่อบริษัท:
// - เคยเป็นลูกค้า Stripe แล้ว → ไม่มี
// - กำลังทดลองจากการสมัครเอง (TRIAL) → ทดลองต่อใน Stripe ถึงวันเดิม (ไม่ต่อเพิ่มอีก 30 วัน) เหลือไม่ถึง 48 ชม. = เก็บเงินเลย
// - ทดลองไปแล้วจนหมด (แถวยังเป็น TRIAL) → ไม่มี
// - Free ที่ไม่เคยทดลอง → 30 วันเต็ม
export function trialFor(b: Pick<TenantBilling, 'stripe_customer_id' | 'status' | 'current_period_end'>, now = Date.now()): SessionOptions['trial'] {
  if (b.stripe_customer_id) return null
  if (b.status !== 'TRIAL') return { days: TRIAL_DAYS }
  const end = b.current_period_end ? new Date(b.current_period_end).getTime() : 0
  return end - now >= MIN_TRIAL_MS ? { end: Math.floor(end / 1000) } : null
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

  const existing = await activeSubscription(billing)
  if (existing) {
    const updated = await stripe().subscriptions.update(existing.id, changeParams(existing, items, metadata))
    applySubscription(updated as unknown as SubscriptionLike)
    return { updated: true }
  }

  return createSession({
    items, metadata, email, customer: billing.stripe_customer_id, clientReferenceId: tenantId, trial: trialFor(billing),
    successUrl: `${APP_URL}/settings?tab=subscription&status=success`,
    cancelUrl: `${APP_URL}/settings?tab=subscription&status=cancel`,
  })
}

async function activeSubscription(billing: TenantBilling): Promise<Stripe.Subscription | null> {
  if (!billing.stripe_subscription_id) return null
  const sub = await stripe().subscriptions.retrieve(billing.stripe_subscription_id)
  return ['canceled', 'incomplete_expired'].includes(sub.status) ? null : sub
}

type ChangeTarget = Pick<Stripe.Subscription, 'status'> & { items: { data: { id: string }[] } }

// เปลี่ยนแพ็กกลางรอบ:
// - ช่วงทดลอง: เปลี่ยนได้ทันที ยังไม่ตัดเงิน ทดลองต่อจนครบ 30 วัน
// - จ่ายอยู่: เริ่มรอบบิลใหม่วันนี้ เก็บแพ็กใหม่เต็มรอบ แล้วหักมูลค่าแพ็กเดิมที่ยังไม่ได้ใช้ (Stripe คิดตามวินาทีที่เหลือ)
//   เช่น Solo รายปี 2,990 ใช้ไป 4 เดือน → Business รายปี 6,900: 6,900 − 2,990×8/12 ≈ 4,907 (+VAT)
//   ตัดบัตรไม่ผ่าน = ไม่เปลี่ยนแพ็ก (error_if_incomplete) ลดแพ็กแล้วเครดิตเกิน = เก็บเป็นเครดิตใช้รอบถัดไป
export function changeParams(
  existing: ChangeTarget,
  items: { price: string; quantity: number }[],
  metadata: Record<string, string>,
): Stripe.SubscriptionUpdateParams {
  const base: Stripe.SubscriptionUpdateParams = {
    items: [...existing.items.data.map(i => ({ id: i.id, deleted: true })), ...items],
    metadata,
    cancel_at_period_end: false,
  }
  if (existing.status === 'trialing') return { ...base, proration_behavior: 'none' }
  return { ...base, billing_cycle_anchor: { type: 'now' }, proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete' }
}

export type ChangePreview =
  | { kind: 'checkout' }                       // ยังไม่มี subscription → ไปหน้า Checkout (ทดลอง/จ่ายที่นั่น)
  | { kind: 'trial' }                          // ช่วงทดลอง → เปลี่ยนได้ ยังไม่ตัดเงิน
  | { kind: 'change'; credit: number; charge: number; tax: number; total: number; nextBilling: string | null }

// ยอดที่จะถูกเก็บถ้ากดเปลี่ยนแพ็กตอนนี้ (บาท) — ใช้ตัวคำนวณของ Stripe เอง ตัวเลขจึงตรงกับใบแจ้งหนี้จริง
export async function previewChange(tenantId: string, input: unknown): Promise<ChangePreview> {
  const sel = parseSelection(input)
  const billing = tenantBilling(tenantId)
  const existing = await activeSubscription(billing)
  if (!existing) return { kind: 'checkout' }
  if (existing.status === 'trialing') return { kind: 'trial' }
  const items = await resolvePrices(sel)
  const params = changeParams(existing, items, {})
  const invoice = await stripe().invoices.createPreview({
    customer: billing.stripe_customer_id!,
    subscription: existing.id,
    subscription_details: {
      items: params.items as Stripe.InvoiceCreatePreviewParams.SubscriptionDetails.Item[],
      billing_cycle_anchor: { type: 'now' },
      proration_behavior: 'always_invoice',
    },
  })
  const baht = (satang: number) => Math.round(satang) / 100
  const lines = invoice.lines.data
  const credit = -lines.filter(l => l.amount < 0).reduce((s, l) => s + l.amount, 0)
  const charge = lines.filter(l => l.amount > 0).reduce((s, l) => s + l.amount, 0)
  const periodEnd = Math.max(0, ...lines.map(l => l.period?.end ?? 0))
  return {
    kind: 'change',
    credit: baht(credit),
    charge: baht(charge),
    tax: baht(invoice.total - invoice.subtotal),
    total: baht(invoice.amount_due),
    nextBilling: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  }
}

interface SessionOptions {
  items: { price: string; quantity: number }[]
  metadata: Record<string, string>         // ติดไปกับ subscription
  sessionMetadata?: Record<string, string> // ติดกับ checkout session (อ่านใน checkout.session.completed)
  email: string
  customer: string | null
  clientReferenceId: string | null
  trial: { days: number } | { end: number } | null // null = เก็บเงินทันที ต้องใส่บัตร
  successUrl: string
  cancelUrl: string
}

async function createSession(o: SessionOptions): Promise<{ url: string }> {
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
    // ช่วงทดลองไม่ต้องใส่บัตร — ไม่ใส่จนครบกำหนด Stripe ยกเลิกเอง แล้ว applySubscription ปล่อยลงเป็น Free
    payment_method_collection: o.trial ? 'if_required' : 'always',
    subscription_data: {
      metadata: o.metadata,
      default_tax_rates: [await vatRate()],
      ...(o.trial ? {
        ...('days' in o.trial ? { trial_period_days: o.trial.days } : { trial_end: o.trial.end }),
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
    return_url: `${APP_URL}/settings?tab=subscription`,
    ...(config ? { configuration: config.id } : {}),
  })
  return session.url
}
