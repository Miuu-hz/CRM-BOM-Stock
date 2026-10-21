import { Router, Request, Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { hasFeature } from '../services/subscription.service'
import { resolveQrToken, ResolvedQr } from '../services/posQr.service'
import { createKdsTicket } from '../services/kdsTicket.service'
import { getLoyaltySettings } from '../services/loyaltySettings'
import {
  DEVICE_COOKIE, DEVICE_DAYS, bindDevice, findOrCreateMember, forgetDevice, getDevice, isKnownToken, memberView, mintDeviceToken,
} from '../services/posMember.service'
import {
  GUEST_COOKIE, GUEST_DAYS, createGuest, forgetGuest, getGuest, guestView, linkItems, retroPoints,
} from '../services/posGuest.service'
import { maskPhone, normalizeThaiMobile } from '../utils/phone'
import { RewardError, activeAd, activePromotions, activeRewards, reservedPoints, reserveRewards } from '../services/qrRewards.service'
import { recalculateBillTotals } from './pos-bill.routes'

// ====================================================================
// PUBLIC — หน้าสั่งอาหารของลูกค้า (frontend/public/qr/) ไม่มี login
// เข้าได้ด้วย token จาก QR เท่านั้น (192 บิต ดู services/posQr.service.ts) และเห็นแค่
// เมนูที่เปิดขาย + บิลของโต๊ะตัวเอง — ห้ามคืนต้นทุน/ข้อมูลลูกค้า/โน้ตภายในของร้าน
// วางนอก /api เพื่อไม่ให้ลูกค้าทั้งร้าน (Wi-Fi เดียวกัน = IP เดียว) ไปกิน rate limit ของแคชเชียร์
// ====================================================================

const router = Router()

// POST ต้องเป็น JSON จากหน้าเว็บของเราเอง — กัน form ข้ามเว็บยิง logout/ถอนความยินยอมด้วย cookie ของลูกค้า
router.use((req, res, next) => {
  if (req.method === 'GET') return next()
  const site = req.get('sec-fetch-site')
  if (!req.is('application/json') || site === 'cross-site' || site === 'same-site') {
    return res.status(403).json({ success: false, message: 'คำขอไม่ถูกต้อง' })
  }
  next()
})

// ponytail: limit ต่อ IP — ร้านใหญ่ที่ลูกค้าหลายสิบโต๊ะใช้ Wi-Fi ร้าน (NAT เดียว) ยังพอ (poll 10 วิ/เครื่อง)
// ถ้าเจอ 429 ที่ร้านจริงค่อยเปลี่ยน key เป็น IP + token
router.use(rateLimit({
  windowMs: 60 * 1000, max: 600, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { success: false, message: 'เรียกถี่เกินไป ลองใหม่อีกครั้งในอีกสักครู่' },
}))
// ส่งออเดอร์/สมัคร — นับแยกต่อ (IP, QR) กันยิงรัวใส่โต๊ะเดียว โดยไม่ให้ลูกค้าโต๊ะอื่นที่ใช้ Wi-Fi ร้านเดียวกันแย่งโควตากันตอนคนแน่น
const orderLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip || '')}|${String(req.query.t ?? req.body?.t ?? '').slice(0, 64)}`,
  message: { success: false, message: 'ส่งถี่เกินไป รอสักครู่แล้วลองใหม่' },
})

// สมัครสมาชิก: ต่ำกว่าออเดอร์ — กันยิงสร้างลูกค้าขยะใส่ CRM
const memberLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip || '')}|${String(req.body?.t ?? '').slice(0, 64)}`,
  message: { success: false, message: 'ลองหลายครั้งเกินไป รอสักครู่แล้วลองใหม่' },
})

const MAX_LINES = 30
const MAX_QTY = 50
const MAX_NOTE = 100

const tokenOf = (req: Request) => String(req.query.t ?? req.body?.t ?? '')

/** token → ผลลัพธ์ หรือส่ง 404/403 ไปแล้วคืน null */
function resolveOr404(req: Request, res: Response): ResolvedQr | null {
  const r = resolveQrToken(tokenOf(req))
  if (!r) { res.status(404).json({ success: false, code: 'QR_NOT_FOUND', message: 'ไม่พบ QR นี้ กรุณาสแกน QR ที่โต๊ะอีกครั้ง' }); return null }
  // QR สั่งที่โต๊ะอยู่ใน Pack Shop เดียวกับ KDS
  // ponytail: ใช้ feature 'kds' ร่วม — แยก key เมื่อจะขาย QR แยกจาก KDS
  if (!hasFeature(r.tenantId, 'kds')) { res.status(403).json({ success: false, code: 'QR_DISABLED', message: 'ร้านนี้ยังไม่เปิดใช้การสั่งผ่าน QR' }); return null }
  return r
}

/**
 * ponytail: สติกเกอร์โต๊ะที่เปิดอยู่ ห้ามสั่งหรือทำรายการตรงๆ — ต้อง redirect ไปใช้ session token ประจำรอบ
 */
function requireSession(r: ResolvedQr, res: Response): boolean {
  if (r.via === 'table' && r.state === 'open') {
    res.status(409).json({
      success: false,
      code: 'SESSION_REQUIRED',
      message: 'กรุณาสั่งอาหารผ่านลิงก์ประจำรอบของโต๊ะ',
      data: { sessionToken: r.sessionToken },
    })
    return false
  }
  return true
}

function publicMenu(tenantId: string) {
  return db.prepare(`
    SELECT pmc.id, COALESCE(si.name, si.sku, 'เมนู') AS name, pmc.pos_price AS price, pmc.image_url AS image,
           pmc.description, pmc.is_available AS available, pmc.category_id, pc.name AS category_name
    FROM pos_menu_configs pmc
    LEFT JOIN stock_items si ON si.id = pmc.product_id
    LEFT JOIN pos_categories pc ON pc.id = pmc.category_id
    WHERE pmc.tenant_id = ? AND pmc.is_pos_enabled = 1
    ORDER BY pc.sort_order ASC, pmc.display_order ASC, si.name ASC
  `).all(tenantId).map((m: any) => ({ ...m, available: m.available === 1 }))
}

function publicBill(bill: any) {
  const items = db.prepare(`
    SELECT product_name AS name, quantity AS qty, unit_price AS price, total_price AS total,
           special_instructions AS note, status
    FROM pos_bill_items WHERE bill_id = ? AND tenant_id = ? ORDER BY added_at ASC
  `).all(bill.id, bill.tenant_id)
  return {
    number: bill.bill_number,
    items,
    subtotal: bill.subtotal || 0,
    service: bill.service_charge_amount || 0,
    extra: bill.extra_charge_amount || 0,
    discount: bill.discount_amount || 0,
    tax: bill.tax_amount || 0,
    total: bill.total_amount || 0,
    billRequested: !!bill.bill_requested_at,
  }
}

// GET /qr/api/session?t= — สถานะโต๊ะ + เมนู + บิลของโต๊ะ (หน้าลูกค้า poll ทุก 10 วินาที)
router.get('/session', (req, res) => {
  try {
    const r = resolveOr404(req, res)
    if (!r) return
    // ponytail: โต๊ะเปิดในโหมด static ให้ redirect ไปลิงก์สุ่มประจำรอบ — สั่งอาหารบน session link เท่านั้น
    if (r.via === 'table' && r.state === 'open') {
      return res.set('Cache-Control', 'no-store').json({
        success: true,
        data: { state: 'redirect', sessionToken: r.sessionToken },
      })
    }
    const shop = db.prepare('SELECT name FROM company_settings WHERE tenant_id = ?').get(r.tenantId) as any
    const data: Record<string, unknown> = { state: r.state, shop: { name: shop?.name || '' }, table: { name: r.table?.name || '' } }
    if (r.sessionToken) data.sessionToken = r.sessionToken
    const device = getDevice(r.tenantId, req.cookies?.[DEVICE_COOKIE])
    data.member = memberView(device)
    const guestToken = !device ? req.cookies?.[GUEST_COOKIE] : undefined
    const guest = !device ? getGuest(r.tenantId, guestToken) : null
    if (guest && typeof guestToken === 'string') setGuestCookie(req, res, guestToken)
    data.guest = guestView(r.tenantId, guest)
    if (r.state === 'open') {
      data.menu = publicMenu(r.tenantId)
      data.bill = publicBill(r.bill)
      const loyalty = getLoyaltySettings(r.tenantId)
      data.loyalty = { enabled: loyalty.enabled, earnRate: loyalty.earnRate }
      // บิลละ 1 สมาชิก — คนอื่นที่โต๊ะเห็นแค่เบอร์ที่ปิดไว้
      data.billMember = r.bill.customer_id
        ? (device && device.customer_id === r.bill.customer_id ? { mine: true, phone: maskPhone(r.bill.customer_phone) } : { mine: false })
        : null
      // เฟส 3: แท็บโปรและแลกแต้ม · แต้มที่ใช้ได้ = แต้มคงเหลือ − ที่จองไว้กับบิลที่ยังไม่จ่าย
      data.promotions = activePromotions(r.tenantId, !!device?.verified_at)
      data.rewards = loyalty.enabled ? activeRewards(r.tenantId) : []
      if (device?.verified_at && data.member) (data.member as any).available = Math.max(0, Math.floor(device.loyalty_points || 0) - reservedPoints(r.tenantId, device.customer_id))
      // เฟส 4: Pop-up โฆษณา (add-on qr_ad)
      data.ad = activeAd(r.tenantId)
    } else if (r.state === 'closed') {
      data.bill = { number: r.bill.bill_number, total: r.bill.total_amount || 0, paid: r.bill.status === 'PAID' }
    }
    res.set('Cache-Control', 'no-store').json({ success: true, data })
  } catch (error) {
    console.error('QR session error:', error)
    res.status(500).json({ success: false, message: 'โหลดเมนูไม่สำเร็จ ลองใหม่อีกครั้ง' })
  }
})

// POST /qr/api/order { t, items: [{ menuId, qty, note? }], orderKey? } — ลงบิลของโต๊ะแล้วส่งครัวทันที
router.post('/order', orderLimiter, (req, res) => {
  try {
    const r = resolveOr404(req, res)
    if (!r) return
    if (!requireSession(r, res)) return
    if (r.state !== 'open') return res.status(409).json({ success: false, code: 'TABLE_NOT_OPEN', message: 'โต๊ะนี้ยังไม่เปิดหรือปิดบิลไปแล้ว กรุณาติดต่อพนักงาน' })
    const bill = r.bill

    const rawKey = req.body?.orderKey
    if (rawKey !== undefined) {
      if (typeof rawKey !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(rawKey)) {
        return res.status(400).json({ success: false, message: 'orderKey ไม่ถูกต้อง' })
      }
    }
    const orderKey: string | null = rawKey || null

    const raw = Array.isArray(req.body?.items) ? req.body.items : []
    const lines = raw.map((l: any) => ({
      menuId: String(l?.menuId ?? ''),
      qty: Number(l?.qty),
      note: typeof l?.note === 'string' ? l.note.trim().slice(0, MAX_NOTE) : '',
    }))
    const rewardIds = Array.isArray(req.body?.rewards) ? (req.body.rewards as unknown[]).map(x => String(x ?? '')).filter(Boolean).slice(0, 10) : []
    if ((!lines.length && !rewardIds.length) || lines.length > MAX_LINES
      || lines.some((l: any) => !l.menuId || !Number.isInteger(l.qty) || l.qty < 1 || l.qty > MAX_QTY)) {
      return res.status(400).json({ success: false, message: `ตะกร้าไม่ถูกต้อง (สูงสุด ${MAX_LINES} รายการ รายการละ 1–${MAX_QTY} ที่)` })
    }

    const twoDaysAgo = new Date(Date.now() - 2 * 86400_000).toISOString()

    const result = db.transaction(() => {
      // ponytail: ลบ key เก่าเกิน 2 วันแบบ opportunistic กันตารางบวม
      db.prepare('DELETE FROM pos_qr_order_keys WHERE tenant_id = ? AND created_at < ?').run(r.tenantId, twoDaysAgo)

      if (orderKey) {
        const existing = db.prepare('SELECT bill_id, response FROM pos_qr_order_keys WHERE tenant_id = ? AND order_key = ?')
          .get(r.tenantId, orderKey) as any
        if (existing) {
          if (existing.bill_id !== bill.id) {
            return { conflict: true }
          }
          return { cached: true, response: JSON.parse(existing.response) }
        }
      }

      // ราคา/ชื่อ/ของหมด อ่านจากเมนูของร้านเสมอ ไม่เชื่อค่าจากมือถือ
      const menuIds = [...new Set(lines.map((l: any) => l.menuId))] as string[]
      const menus = !menuIds.length ? [] : db.prepare(`
        SELECT pmc.id, pmc.pos_price, pmc.is_available, COALESCE(si.name, si.sku, 'เมนู') AS name
        FROM pos_menu_configs pmc LEFT JOIN stock_items si ON si.id = pmc.product_id
        WHERE pmc.tenant_id = ? AND pmc.is_pos_enabled = 1 AND pmc.id IN (${menuIds.map(() => '?').join(',')})
      `).all(r.tenantId, ...menuIds) as any[]
      const byId = new Map(menus.map(m => [m.id, m]))
      const unavailable = menuIds.filter(id => !byId.get(id) || byId.get(id).is_available !== 1)
      if (unavailable.length) {
        return {
          unavailable: true,
          data: { menuIds: unavailable },
          message: `ขออภัย เมนูนี้หมดแล้ว: ${unavailable.map(id => byId.get(id)?.name || 'เมนูที่ถูกปิด').join(', ')}`,
        }
      }

      // แลกแต้ม: เฉพาะเครื่องที่แคชเชียร์ยืนยันแล้ว และเป็นสมาชิกที่ผูกกับบิลนี้
      let rewardMember: string | null = null
      if (rewardIds.length) {
        const device = getDevice(r.tenantId, req.cookies?.[DEVICE_COOKIE])
        if (!device?.verified_at) return { memberNotVerified: true }
        if (bill.customer_id !== device.customer_id) return { notBillMember: true }
        rewardMember = device.customer_id
      }

      const insert = db.prepare(`
        INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price,
          special_instructions, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'QR')
      `)
      const ids = lines.map((l: any) => {
        const m = byId.get(l.menuId)
        const id = generateId()
        insert.run(id, r.tenantId, bill.id, m.id, m.name, l.qty, m.pos_price, m.pos_price * l.qty, l.note || null)
        return id
      })
      const itemIds = [...ids]
      if (!getDevice(r.tenantId, req.cookies?.[DEVICE_COOKIE])) {
        const guest = getGuest(r.tenantId, req.cookies?.[GUEST_COOKIE])
        if (guest && itemIds.length) linkItems(r.tenantId, guest.id, bill.id, itemIds)
      }
      if (rewardMember) ids.push(...reserveRewards(r.tenantId, bill.id, rewardMember, rewardIds))
      recalculateBillTotals(bill.id)
      const ticket = createKdsTicket(r.tenantId, bill, ids)

      const responseBody = { success: true, data: { round: ticket?.round ?? null, items: lines.length, rewards: rewardIds.length, itemIds } }

      if (orderKey) {
        db.prepare(`
          INSERT INTO pos_qr_order_keys (tenant_id, order_key, bill_id, response, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(r.tenantId, orderKey, bill.id, JSON.stringify(responseBody), new Date().toISOString())
      }

      return { cached: false, response: responseBody }
    })()

    if (result.conflict) {
      return res.status(409).json({ success: false, code: 'ORDER_KEY_REUSED', message: 'orderKey นี้ถูกใช้กับบิลอื่นแล้ว' })
    }
    if (result.unavailable) {
      return res.status(409).json({ success: false, code: 'MENU_UNAVAILABLE', data: result.data, message: result.message })
    }
    if (result.memberNotVerified) {
      return res.status(403).json({ success: false, code: 'MEMBER_NOT_VERIFIED', message: 'แลกแต้มได้หลังแคชเชียร์ยืนยันสมาชิก 1 ครั้ง' })
    }
    if (result.notBillMember) {
      return res.status(409).json({ success: false, code: 'NOT_BILL_MEMBER', message: 'บิลนี้สะสมแต้มให้สมาชิกคนอื่นอยู่ แลกแต้มในบิลนี้ไม่ได้' })
    }

    res.json(result.response)
  } catch (error) {
    if (error instanceof RewardError) return res.status(409).json({ success: false, code: 'REWARD_INVALID', message: error.message })
    console.error('QR order error:', error)
    res.status(500).json({ success: false, message: 'ส่งออเดอร์ไม่สำเร็จ ลองกดส่งอีกครั้ง' })
  }
})

// POST /qr/api/call-bill { t } — ลูกค้าเรียกเช็คบิล → ผังโต๊ะหน้าแคชเชียร์ขึ้นป้าย (ยังสั่งเพิ่มได้)
router.post('/call-bill', orderLimiter, (req, res) => {
  try {
    const r = resolveOr404(req, res)
    if (!r) return
    if (!requireSession(r, res)) return
    if (r.state !== 'open') return res.status(409).json({ success: false, code: 'TABLE_NOT_OPEN', message: 'โต๊ะนี้ปิดบิลไปแล้ว' })
    db.prepare(`UPDATE pos_running_bills SET bill_requested_at = COALESCE(bill_requested_at, ?) WHERE id = ? AND status = 'OPEN'`)
      .run(new Date().toISOString(), r.bill.id)
    res.json({ success: true })
  } catch (error) {
    console.error('QR call-bill error:', error)
    res.status(500).json({ success: false, message: 'เรียกเช็คบิลไม่สำเร็จ ลองอีกครั้ง หรือเรียกพนักงาน' })
  }
})

// POST /qr/api/ad-event { t, type: shown|tap|close } — สถิติ Pop-up โฆษณา (ร้านดูในหน้าตั้งค่า)
router.post('/ad-event', orderLimiter, (req, res) => {
  try {
    const r = resolveOr404(req, res)
    if (!r) return
    if (!requireSession(r, res)) return
    const type = String(req.body?.type ?? '')
    if (!['shown', 'tap', 'close'].includes(type) || !activeAd(r.tenantId)) return res.status(400).json({ success: false })
    db.prepare('INSERT INTO pos_ad_events (id, tenant_id, type, created_at) VALUES (?, ?, ?, ?)').run(generateId(), r.tenantId, type, new Date().toISOString())
    res.json({ success: true })
  } catch (error) {
    console.error('QR ad-event error:', error)
    res.status(500).json({ success: false })
  }
})

// ==================== สมาชิกด้วยเบอร์โทร (ไม่มี OTP — ดูกติกาใน services/posMember.service.ts) ====================

const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/
const setDeviceCookie = (req: Request, res: Response, token: string) => res.cookie(DEVICE_COOKIE, token, {
  httpOnly: true, sameSite: 'lax', secure: req.secure || process.env.NODE_ENV === 'production', path: '/qr/api', maxAge: DEVICE_DAYS * 86400_000,
})
const setGuestCookie = (req: Request, res: Response, token: string) => res.cookie(GUEST_COOKIE, token, {
  httpOnly: true, sameSite: 'lax', secure: req.secure || process.env.NODE_ENV === 'production', path: '/qr/api', maxAge: GUEST_DAYS * 86400_000,
})

// POST /qr/api/guest { t, itemIds? } — ลูกค้าทั่วไปกดยินยอมให้จำเมนูที่สั่งบนเครื่องนี้
router.post('/guest', orderLimiter, (req, res) => {
  try {
    const r = resolveOr404(req, res)
    if (!r) return
    if (!requireSession(r, res)) return
    if (r.state !== 'open') return res.status(409).json({ success: false, code: 'TABLE_NOT_OPEN', message: 'โต๊ะนี้ยังไม่เปิดหรือปิดบิลไปแล้ว' })
    if (getDevice(r.tenantId, req.cookies?.[DEVICE_COOKIE])) {
      return res.status(403).json({ success: false, code: 'ALREADY_MEMBER', message: 'เครื่องนี้ผูกเป็นสมาชิกอยู่แล้ว' })
    }
    let token = req.cookies?.[GUEST_COOKIE]
    const existing = getGuest(r.tenantId, token)
    let guestId: string
    if (existing && typeof token === 'string') {
      guestId = existing.id
    } else {
      const created = createGuest(r.tenantId)
      guestId = created.id
      token = created.token
    }
    if (Array.isArray(req.body?.itemIds) && req.body.itemIds.length) {
      linkItems(r.tenantId, guestId, r.bill.id, req.body.itemIds)
    }
    setGuestCookie(req, res, token)
    const guest = getGuest(r.tenantId, token)
    res.json({ success: true, data: { guest: guestView(r.tenantId, guest) } })
  } catch (error) {
    console.error('QR guest error:', error)
    res.status(500).json({ success: false, message: 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง' })
  }
})

// POST /qr/api/guest/forget { t } — ลบข้อมูลที่จำไว้ทั้งหมดและหยุดจำเครื่องนี้ (PDPA)
router.post('/guest/forget', (req, res) => {
  try {
    const r = resolveOr404(req, res)
    if (!r) return
    if (!requireSession(r, res)) return
    forgetGuest(r.tenantId, req.cookies?.[GUEST_COOKIE])
    res.clearCookie(GUEST_COOKIE, { path: '/qr/api' }).json({ success: true })
  } catch (error) {
    console.error('QR guest forget error:', error)
    res.status(500).json({ success: false, message: 'ลบข้อมูลไม่สำเร็จ' })
  }
})

// POST /qr/api/member { t, phone, name?, consentPoints: true, consentMarketing? } — สมัคร/ผูกเบอร์ แล้วให้บิลนี้สะสมแต้ม
// POST /qr/api/member { t } — เครื่องนี้ผูกเบอร์ไว้แล้ว: ให้บิลโต๊ะนี้สะสมแต้มให้สมาชิกคนเดิม
// ตอบแบบเดียวกันไม่ว่าเบอร์จะเป็นสมาชิกอยู่แล้วหรือไม่ (กันสุ่มเบอร์เช็กว่าใครเป็นลูกค้าร้านนี้)
router.post('/member', memberLimiter, (req, res) => {
  try {
    const r = resolveOr404(req, res)
    if (!r) return
    if (!requireSession(r, res)) return
    if (r.state !== 'open') return res.status(409).json({ success: false, code: 'TABLE_NOT_OPEN', message: 'สมัครได้เฉพาะตอนโต๊ะเปิดอยู่' })
    if (!getLoyaltySettings(r.tenantId).enabled) return res.status(409).json({ success: false, message: 'ร้านนี้ยังไม่เปิดระบบสะสมแต้ม' })

    let token = req.cookies?.[DEVICE_COOKIE]
    let device = getDevice(r.tenantId, token)
    let awardedRetro: number | undefined
    if (req.body?.phone !== undefined) {
      const mobile = normalizeThaiMobile(req.body.phone)
      if (!mobile) return res.status(400).json({ success: false, message: 'เบอร์ไม่ถูกต้อง ใส่เบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 06, 08 หรือ 09' })
      if (req.body.consentPoints !== true) return res.status(400).json({ success: false, message: 'ต้องยินยอมให้ร้านเก็บเบอร์เพื่อสะสมแต้มก่อน' })
      const nickname = String(req.body.name ?? '').trim().slice(0, 30)
      // ไม่รับ token ที่ client เลือกเองมาผูกสมาชิกใหม่ (กันถูกฝัง cookie แล้วรอแคชเชียร์ยืนยันให้)
      if (typeof token !== 'string' || !TOKEN_RE.test(token) || !isKnownToken(token)) token = mintDeviceToken()
      const guestToken = req.cookies?.[GUEST_COOKIE]
      db.transaction(() => {
        const customerId = findOrCreateMember(r.tenantId, mobile, nickname)
        bindDevice(r.tenantId, token, customerId, req.body.consentMarketing === true)
        const guest = getGuest(r.tenantId, guestToken)
        if (guest) {
          const gv = guestView(r.tenantId, guest)
          const alreadyAwarded = db.prepare(`
            SELECT 1 FROM loyalty_transactions
            WHERE tenant_id = ? AND reference_type = 'QR_GUEST_RETRO' AND (reference_id = ? OR customer_id = ?)
            LIMIT 1
          `).get(r.tenantId, guest.id, customerId)
          const retro = alreadyAwarded ? 0 : retroPoints(r.tenantId, guest)
          const nowIso = new Date().toISOString()
          if (retro > 0) {
            const cust = db.prepare('SELECT loyalty_points FROM customers WHERE id = ? AND tenant_id = ?')
              .get(customerId, r.tenantId) as { loyalty_points: number } | undefined
            const balanceAfter = (Number(cust?.loyalty_points) || 0) + retro
            db.prepare('UPDATE customers SET loyalty_points = ? WHERE id = ? AND tenant_id = ?')
              .run(balanceAfter, customerId, r.tenantId)
            db.prepare(`
              INSERT INTO loyalty_transactions (id, tenant_id, customer_id, type, points, balance_after, reference_type, reference_id, note, created_by, created_at)
              VALUES (?, ?, ?, 'ADJUST', ?, ?, 'QR_GUEST_RETRO', ?, ?, 'QR', ?)
            `).run(
              generateId(), r.tenantId, customerId, retro, balanceAfter, guest.id,
              `แต้มย้อนหลัง ${guest.visits} ครั้งก่อนสมัครสมาชิก`, nowIso
            )
          }
          const favText = gv?.favorite || '-'
          const crmNote = `ประวัติก่อนสมัคร: มา ${guest.visits} ครั้ง ยอด ฿${Number(guest.spent || 0).toLocaleString('th-TH')} เมนูที่สั่งบ่อย ${favText}`
          db.prepare(`INSERT INTO activity_logs (id, customer_id, type, note, created_by, tenant_id, created_at) VALUES (?, ?, 'NOTE', ?, 'QR', ?, ?)`)
            .run(generateId(), customerId, crmNote, r.tenantId, nowIso)
          db.prepare('DELETE FROM pos_guest_bill_items WHERE tenant_id = ? AND guest_id = ?').run(r.tenantId, guest.id)
          db.prepare('DELETE FROM pos_guest_devices WHERE id = ? AND tenant_id = ?').run(guest.id, r.tenantId)
          awardedRetro = retro
        }
      })()
      if (awardedRetro !== undefined) res.clearCookie(GUEST_COOKIE, { path: '/qr/api' })
      setDeviceCookie(req, res, token)
      device = getDevice(r.tenantId, token)
    }
    if (!device) return res.status(400).json({ success: false, message: 'ใส่เบอร์โทรเพื่อสมัครสมาชิก' })

    // บิลละ 1 สมาชิก: คนแรกที่ผูก (แคชเชียร์เปลี่ยนคนได้ที่หน้าแคชเชียร์)
    db.prepare(`UPDATE pos_running_bills SET customer_id = ?, member_device_id = ?,
        customer_name = (SELECT name FROM customers WHERE id = ?), customer_phone = (SELECT phone FROM customers WHERE id = ?)
      WHERE id = ? AND tenant_id = ? AND status = 'OPEN' AND customer_id IS NULL`)
      .run(device.customer_id, device.id, device.customer_id, device.customer_id, r.bill.id, r.tenantId)
    const bill = db.prepare('SELECT customer_id FROM pos_running_bills WHERE id = ?').get(r.bill.id) as any
    const out: Record<string, unknown> = { member: memberView(device), linked: bill?.customer_id === device.customer_id }
    if (awardedRetro !== undefined) out.retroPoints = awardedRetro
    res.json({ success: true, data: out })
  } catch (error) {
    console.error('QR member error:', error)
    res.status(500).json({ success: false, message: 'สมัครสมาชิกไม่สำเร็จ ลองอีกครั้ง' })
  }
})

/** สมาชิกที่แคชเชียร์ยืนยันแล้วเท่านั้นถึงดู/แก้ข้อมูลของตัวเองได้ */
function verifiedDevice(req: Request, res: Response) {
  const r = resolveOr404(req, res)
  if (!r) return null
  if (!requireSession(r, res)) return null
  const device = getDevice(r.tenantId, req.cookies?.[DEVICE_COOKIE])
  if (!device?.verified_at) { res.status(403).json({ success: false, code: 'MEMBER_NOT_VERIFIED', message: 'ให้แคชเชียร์ยืนยันสมาชิกก่อน 1 ครั้ง' }); return null }
  return { r, device }
}

// GET /qr/api/member/ledger?t= — ประวัติแต้ม 20 รายการล่าสุด
router.get('/member/ledger', (req, res) => {
  try {
    const v = verifiedDevice(req, res)
    if (!v) return
    // ไม่ส่ง note ดิบ (ปรับแต้มมือมีหมายเหตุภายในของพนักงาน) — ใช้ป้ายคงที่ตามชนิด
    const LABEL: Record<string, string> = { EARN: 'ได้แต้มจากบิล', REDEEM: 'ใช้แต้มแลกส่วนลด', ADJUST: 'ร้านปรับแต้ม' }
    const rows = (db.prepare(`SELECT type, points, created_at FROM loyalty_transactions
      WHERE tenant_id = ? AND customer_id = ? ORDER BY created_at DESC LIMIT 20`).all(v.r.tenantId, v.device.customer_id) as any[])
      .map(l => ({ ...l, note: LABEL[l.type] || 'ปรับแต้ม' }))
    res.set('Cache-Control', 'no-store').json({ success: true, data: rows })
  } catch (error) {
    console.error('QR ledger error:', error)
    res.status(500).json({ success: false, message: 'โหลดประวัติแต้มไม่สำเร็จ' })
  }
})

// POST /qr/api/member/consent { t, marketing } — ถอน/ให้ความยินยอมรับข่าวสาร (PDPA ต้องถอนได้ง่ายเท่ากับตอนให้)
router.post('/member/consent', orderLimiter, (req, res) => {
  try {
    const v = verifiedDevice(req, res)
    if (!v) return
    const on = req.body?.marketing === true
    db.prepare('UPDATE customers SET marketing_consent_at = ? WHERE id = ? AND tenant_id = ?').run(on ? new Date().toISOString() : null, v.device.customer_id, v.r.tenantId)
    db.prepare('UPDATE pos_member_devices SET consent_marketing = ? WHERE id = ?').run(on ? 1 : 0, v.device.id)
    res.json({ success: true, data: { marketing: on } })
  } catch (error) {
    console.error('QR consent error:', error)
    res.status(500).json({ success: false, message: 'บันทึกไม่สำเร็จ' })
  }
})

// POST /qr/api/member/delete-request { t } — ขอลบข้อมูลสมาชิก: ลงบันทึกในประวัติลูกค้า (CRM) ให้ร้านดำเนินการ + ลืมเครื่องนี้
// ponytail: ไม่ลบเองอัตโนมัติ เพราะลูกค้าอาจมีบิล/ใบกำกับภาษีที่กฎหมายบังคับเก็บ — ร้านตัดสินใจลบ/ปิดบัญชีในหน้า CRM
router.post('/member/delete-request', orderLimiter, (req, res) => {
  try {
    const v = verifiedDevice(req, res)
    if (!v) return
    db.prepare(`INSERT INTO activity_logs (id, customer_id, type, note, created_by, tenant_id, created_at) VALUES (?, ?, 'NOTE', ?, 'QR', ?, ?)`)
      .run(generateId(), v.device.customer_id, 'ลูกค้าขอลบข้อมูลสมาชิกผ่านหน้า QR สั่งที่โต๊ะ (PDPA) — ร้านต้องดำเนินการภายใน 30 วัน', v.r.tenantId, new Date().toISOString())
    db.prepare('UPDATE customers SET marketing_consent_at = NULL WHERE id = ? AND tenant_id = ?').run(v.device.customer_id, v.r.tenantId)
    forgetDevice(v.r.tenantId, req.cookies?.[DEVICE_COOKIE])
    res.clearCookie(DEVICE_COOKIE, { path: '/qr/api' }).json({ success: true })
  } catch (error) {
    console.error('QR delete-request error:', error)
    res.status(500).json({ success: false, message: 'ส่งคำขอไม่สำเร็จ' })
  }
})

// POST /qr/api/member/logout { t } — ลืมเครื่องนี้ (แต้มยังอยู่ครบเพราะผูกกับเบอร์)
router.post('/member/logout', (req, res) => {
  try {
    const r = resolveOr404(req, res)
    if (!r) return
    if (!requireSession(r, res)) return
    forgetDevice(r.tenantId, req.cookies?.[DEVICE_COOKIE])
    res.clearCookie(DEVICE_COOKIE, { path: '/qr/api' }).json({ success: true })
  } catch (error) {
    console.error('QR logout error:', error)
    res.status(500).json({ success: false, message: 'ออกจากระบบไม่สำเร็จ' })
  }
})

export default router
