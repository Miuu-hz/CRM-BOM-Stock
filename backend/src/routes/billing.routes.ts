import { Router, Request, Response } from 'express'
import Stripe from 'stripe'
import { authenticate, requireRole } from '../middleware/auth.middleware'
import { getSubscription } from '../services/subscription.service'
import { BillingError, publicCatalog } from '../services/billing.catalog'
import { checkout, handleEvent, portal } from '../services/billing.service'
import { getDb } from '../db/sqlite'

const router = Router()

// POST /api/billing/webhook — Stripe เรียกเข้ามา (ไม่มี JWT) ยืนยันตัวด้วยลายเซ็นแทน
// body เป็น raw Buffer: index.ts mount express.raw ให้ path นี้ก่อน express.json
router.post('/webhook', async (req: Request, res: Response) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  const signature = req.headers['stripe-signature']
  if (!secret || typeof signature !== 'string' || !Buffer.isBuffer(req.body)) {
    res.status(400).json({ success: false, message: 'invalid webhook request' })
    return
  }
  let event: Stripe.Event
  try {
    event = Stripe.webhooks.constructEvent(req.body, signature, secret)
  } catch {
    res.status(400).json({ success: false, message: 'invalid signature' })
    return
  }
  try {
    await handleEvent(event)
    res.json({ received: true })
  } catch (err) {
    // ตอบ 500 ให้ Stripe ส่งซ้ำ (retry อัตโนมัติสูงสุด 3 วัน)
    console.error(`[billing] webhook ${event.type} ${event.id} error:`, err)
    res.status(500).json({ success: false })
  }
})

// GET /api/billing/catalog — ราคาสาธารณะ สำหรับหน้าสมัครที่ยังไม่ได้ login
router.get('/catalog', (_req: Request, res: Response) => {
  res.json({ success: true, data: publicCatalog() })
})

// ส่วนที่เหลือ: เจ้าของบริษัทจัดการแพ็กของบริษัทตัวเองเท่านั้น
router.use(authenticate, requireRole('ADMIN', 'MASTER'))

const fail = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof BillingError) {
    res.status(400).json({ success: false, message: err.message })
    return
  }
  console.error(`[billing] ${fallback}:`, err)
  res.status(500).json({ success: false, message: fallback })
}

// GET /api/billing — แพ็กปัจจุบัน + ราคาทั้งหมดสำหรับหน้าเลือกแพ็ก
router.get('/', (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const sub = getSubscription(tenantId)
  const row = getDb().prepare('SELECT billing_cycle, stripe_customer_id, stripe_subscription_id FROM tenant_subscriptions WHERE tenant_id = ?')
    .get(tenantId) as any
  res.json({
    success: true,
    data: {
      current: {
        planCode: sub.planCode,
        planName: sub.planName,
        status: sub.status,
        cycle: row?.billing_cycle ?? null,
        currentPeriodEnd: sub.currentPeriodEnd,
        packs: sub.packs,
        addons: sub.addons,
        hasSubscription: !!row?.stripe_subscription_id,
        hasCustomer: !!row?.stripe_customer_id,
      },
      trialEligible: !row?.stripe_customer_id,
      catalog: publicCatalog(),
    },
  })
})

// POST /api/billing/checkout { plan, cycle, packs, addons } → { url } (ไปจ่าย) หรือ { updated: true } (เปลี่ยนแพ็กแล้ว)
router.post('/checkout', async (req: Request, res: Response) => {
  try {
    const result = await checkout(req.user!.tenantId, req.user!.email, req.body)
    res.json({ success: true, data: result })
  } catch (err) {
    fail(res, err, 'สร้างรายการชำระเงินไม่สำเร็จ')
  }
})

// POST /api/billing/portal → { url } หน้า Stripe สำหรับเปลี่ยนบัตร ดูใบเสร็จ ยกเลิก
router.post('/portal', async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: { url: await portal(req.user!.tenantId) } })
  } catch (err) {
    fail(res, err, 'เปิดหน้าจัดการการชำระเงินไม่สำเร็จ')
  }
})

export default router
