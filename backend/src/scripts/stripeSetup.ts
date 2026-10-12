/**
 * สร้าง/อัปเดตของใน Stripe ให้ตรงกับ billing.catalog.ts — รันซ้ำได้ ไม่สร้างของซ้ำ
 *   node dist/scripts/stripeSetup.js
 * - Product + Price ทุกตัว (ราคาเปลี่ยน → สร้าง Price ใหม่แล้วย้าย lookup_key มา, Price เก่าปิดขาย)
 * - Tax Rate VAT 7% แบบบวกเพิ่ม (ราคาในตารางไม่รวม VAT)
 * - Customer Portal: เปลี่ยนบัตร/ดูใบเสร็จ/ยกเลิกได้ แต่เปลี่ยนแพ็กไม่ได้ (ต้องผ่านหน้า /billing ของเรา)
 * - Webhook endpoint → เขียน STRIPE_WEBHOOK_SECRET ลง backend/.env (ไม่พิมพ์ secret ออกจอ)
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import Stripe from 'stripe'
import { priceDefinitions, VAT_PERCENT } from '../services/billing.catalog'

const ENV_PATH = path.resolve(__dirname, '..', '..', '.env')
dotenv.config({ path: ENV_PATH })

const WEBHOOK_URL = `${process.env.APP_URL || 'https://erp.phopy.net'}/api/billing/webhook`
const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
]

async function main() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('ไม่มี STRIPE_SECRET_KEY ใน backend/.env')
  const stripe = new Stripe(key)
  console.log(`Stripe mode: ${key.startsWith('sk_live_') ? 'LIVE' : 'test'}`)

  // ---- Products + Prices ----
  const defs = priceDefinitions()
  const existing = new Map<string, Stripe.Price>()
  for (let i = 0; i < defs.length; i += 10) {
    const page = await stripe.prices.list({ lookup_keys: defs.slice(i, i + 10).map(d => d.lookupKey), active: true, limit: 10 })
    page.data.forEach(p => p.lookup_key && existing.set(p.lookup_key, p))
  }
  // ดึงรายการทีเดียว แทน retrieve ทีละตัว (ตัวที่ยังไม่มีจะขึ้น 404 เป็น "ข้อผิดพลาด" ใน dashboard ให้ตกใจเปล่า ๆ)
  const products = new Set<string>()
  for await (const p of stripe.products.list({ limit: 100 })) products.add(p.id)
  let created = 0
  for (const d of defs) {
    if (!products.has(d.productId)) {
      await stripe.products.create({ id: d.productId, name: d.productName })
      products.add(d.productId)
    }
    const amount = d.unitAmountBaht * 100  // THB เป็นหน่วยสตางค์
    const old = existing.get(d.lookupKey)
    const interval = d.cycle === 'yearly' ? 'year' : 'month'
    if (old && old.unit_amount === amount && old.recurring?.interval === interval) continue
    await stripe.prices.create({
      product: d.productId,
      currency: 'thb',
      unit_amount: amount,
      recurring: { interval },
      tax_behavior: 'exclusive',
      lookup_key: d.lookupKey,
      transfer_lookup_key: true,
      metadata: d.metadata,
      nickname: `${d.productName} (${d.cycle})`,
    })
    if (old) await stripe.prices.update(old.id, { active: false })
    created++
  }
  console.log(`Prices: ${defs.length} รายการ (สร้าง/อัปเดต ${created})`)

  // ---- VAT 7% ----
  const rates = await stripe.taxRates.list({ active: true, limit: 100 })
  if (!rates.data.some(r => r.metadata?.phopy === 'vat7')) {
    await stripe.taxRates.create({
      display_name: 'VAT', description: `ภาษีมูลค่าเพิ่ม ${VAT_PERCENT}%`, percentage: VAT_PERCENT,
      inclusive: false, country: 'TH', jurisdiction: 'TH', tax_type: 'vat', metadata: { phopy: 'vat7' },
    })
    console.log('Tax rate: สร้าง VAT 7%')
  } else {
    console.log('Tax rate: มีแล้ว')
  }

  // ---- Customer Portal ----
  const portals = await stripe.billingPortal.configurations.list({ active: true, limit: 100 })
  if (!portals.data.some(c => c.metadata?.phopy === 'portal')) {
    await stripe.billingPortal.configurations.create({
      business_profile: { headline: 'Phopy ERP — จัดการการชำระเงิน' },
      features: {
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        customer_update: { enabled: true, allowed_updates: ['email', 'address', 'tax_id', 'name'] },
        subscription_cancel: { enabled: true, mode: 'at_period_end' },
        subscription_update: { enabled: false },
      },
      metadata: { phopy: 'portal' },
    })
    console.log('Portal: สร้างแล้ว')
  } else {
    console.log('Portal: มีแล้ว')
  }

  // ---- Webhook ----
  const envText = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : ''
  const hasSecret = /^STRIPE_WEBHOOK_SECRET=whsec_/m.test(envText)
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 })
  const mine = endpoints.data.filter(e => e.url === WEBHOOK_URL)
  if (mine.length === 1 && hasSecret) {
    await stripe.webhookEndpoints.update(mine[0].id, { enabled_events: WEBHOOK_EVENTS, disabled: false })
    console.log(`Webhook: มีแล้ว → ${WEBHOOK_URL}`)
  } else {
    // secret ของ endpoint เดิมดึงย้อนหลังไม่ได้ → ลบแล้วสร้างใหม่
    for (const e of mine) await stripe.webhookEndpoints.del(e.id)
    const endpoint = await stripe.webhookEndpoints.create({ url: WEBHOOK_URL, enabled_events: WEBHOOK_EVENTS, description: 'Phopy ERP billing' })
    const line = `STRIPE_WEBHOOK_SECRET=${endpoint.secret}`
    const next = /^STRIPE_WEBHOOK_SECRET=.*$/m.test(envText)
      ? envText.replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, line)
      : `${envText.replace(/\n?$/, '\n')}${line}\n`
    fs.writeFileSync(ENV_PATH, next, { mode: 0o600 })
    console.log(`Webhook: สร้างใหม่ → ${WEBHOOK_URL} (เขียน STRIPE_WEBHOOK_SECRET ลง .env แล้ว — ต้อง restart backend)`)
  }
}

main().catch(err => {
  console.error('stripeSetup ล้มเหลว:', err?.message || err)
  process.exit(1)
})
