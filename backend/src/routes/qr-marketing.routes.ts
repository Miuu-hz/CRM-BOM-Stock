import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import db from '../db/sqlite'
import { authenticate, requireRole } from '../middleware/auth.middleware'
import { generateId } from '../utils/id'
import { isAllowedImageExt, isAllowedImageMimetype, isValidImageFile } from '../utils/upload'
import { hasFeature } from '../services/subscription.service'

// หลังร้าน: โปรโมชัน / รางวัลแลกแต้ม / Pop-up โฆษณา ของหน้า QR สั่งที่โต๊ะ (Settings → QR โปร & โฆษณา)
// mount ที่ /api/pos/qr-marketing (gate 'kds' = Pack Shop) · Pop-up ต้องมี add-on qr_ad เพิ่ม
const router = Router()
router.use(authenticate)
const MANAGERS = ['ADMIN', 'MANAGER', 'MASTER'] as const

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const optDate = (v: unknown) => (v === undefined || v === null || v === '' ? null : DATE_RE.test(String(v)) ? String(v) : undefined)
const optTime = (v: unknown) => (v === undefined || v === null || v === '' ? null : TIME_RE.test(String(v)) ? String(v) : undefined)
const bad = (res: Response, message: string) => res.status(400).json({ success: false, message })
const ownsMenu = (tenantId: string, menuId: unknown) =>
  typeof menuId === 'string' && !!db.prepare('SELECT 1 FROM pos_menu_configs WHERE id = ? AND tenant_id = ?').get(menuId, tenantId)
const tid = (req: Request) => (req as any).user!.tenantId as string

// ==================== โปรโมชัน ====================
router.get('/promotions', (req, res) => {
  res.json({ success: true, data: db.prepare('SELECT * FROM pos_promotions WHERE tenant_id = ? ORDER BY sort_order, created_at').all(tid(req)) })
})

function promoFields(req: Request, res: Response) {
  const b = req.body || {}
  const title = String(b.title ?? '').trim()
  if (!title || title.length > 80) { bad(res, 'ชื่อโปรต้องไม่ว่างและยาวไม่เกิน 80 ตัวอักษร'); return null }
  const startsOn = optDate(b.starts_on), endsOn = optDate(b.ends_on)
  if (startsOn === undefined || endsOn === undefined || (startsOn && endsOn && startsOn > endsOn)) { bad(res, 'ช่วงวันที่ไม่ถูกต้อง'); return null }
  const menuId = b.pos_menu_id ? String(b.pos_menu_id) : null
  if (menuId && !ownsMenu(tid(req), menuId)) { bad(res, 'ไม่พบเมนูที่เลือก'); return null }
  return {
    title, description: String(b.description ?? '').trim().slice(0, 200) || null, menuId, startsOn, endsOn,
    membersOnly: b.members_only ? 1 : 0, active: b.is_active === false ? 0 : 1, sort: Number.isInteger(b.sort_order) ? b.sort_order : 0,
  }
}

router.post('/promotions', requireRole(...MANAGERS), (req, res) => {
  const f = promoFields(req, res); if (!f) return
  const id = generateId()
  db.prepare(`INSERT INTO pos_promotions (id, tenant_id, title, description, pos_menu_id, starts_on, ends_on, members_only, is_active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, tid(req), f.title, f.description, f.menuId, f.startsOn, f.endsOn, f.membersOnly, f.active, f.sort)
  res.json({ success: true, data: { id } })
})

router.put('/promotions/:id', requireRole(...MANAGERS), (req, res) => {
  const f = promoFields(req, res); if (!f) return
  const r = db.prepare(`UPDATE pos_promotions SET title = ?, description = ?, pos_menu_id = ?, starts_on = ?, ends_on = ?, members_only = ?, is_active = ?, sort_order = ?
    WHERE id = ? AND tenant_id = ?`).run(f.title, f.description, f.menuId, f.startsOn, f.endsOn, f.membersOnly, f.active, f.sort, req.params.id, tid(req))
  if (!r.changes) return res.status(404).json({ success: false, message: 'ไม่พบโปรนี้' })
  res.json({ success: true })
})

router.delete('/promotions/:id', requireRole(...MANAGERS), (req, res) => {
  const r = db.prepare('DELETE FROM pos_promotions WHERE id = ? AND tenant_id = ?').run(req.params.id, tid(req))
  if (!r.changes) return res.status(404).json({ success: false, message: 'ไม่พบโปรนี้' })
  res.json({ success: true })
})

// ==================== รางวัลแลกแต้ม (ของแถม) ====================
router.get('/rewards', (req, res) => {
  const rows = db.prepare(`SELECT r.*,
      (SELECT COUNT(*) FROM pos_redemptions x WHERE x.reward_id = r.id AND x.status = 'USED') AS used_count
    FROM pos_rewards r WHERE r.tenant_id = ? ORDER BY r.sort_order, r.points_cost`).all(tid(req))
  res.json({ success: true, data: rows })
})

function rewardFields(req: Request, res: Response) {
  const b = req.body || {}
  const name = String(b.name ?? '').trim()
  const points = Number(b.points_cost)
  if (!name || name.length > 60) { bad(res, 'ชื่อรางวัลต้องไม่ว่างและยาวไม่เกิน 60 ตัวอักษร'); return null }
  if (!Number.isInteger(points) || points < 1 || points > 1_000_000) { bad(res, 'แต้มที่ใช้แลกต้องเป็นจำนวนเต็ม 1 ขึ้นไป'); return null }
  if (!ownsMenu(tid(req), b.pos_menu_id)) { bad(res, 'เลือกเมนูของแถม (เข้าบิลราคา 0 และตัดสต็อกตามสูตร)'); return null }
  return { name, points, menuId: String(b.pos_menu_id), active: b.is_active === false ? 0 : 1, sort: Number.isInteger(b.sort_order) ? b.sort_order : 0 }
}

router.post('/rewards', requireRole(...MANAGERS), (req, res) => {
  const f = rewardFields(req, res); if (!f) return
  const id = generateId()
  db.prepare('INSERT INTO pos_rewards (id, tenant_id, name, points_cost, pos_menu_id, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, tid(req), f.name, f.points, f.menuId, f.active, f.sort)
  res.json({ success: true, data: { id } })
})

router.put('/rewards/:id', requireRole(...MANAGERS), (req, res) => {
  const f = rewardFields(req, res); if (!f) return
  const r = db.prepare('UPDATE pos_rewards SET name = ?, points_cost = ?, pos_menu_id = ?, is_active = ?, sort_order = ? WHERE id = ? AND tenant_id = ?')
    .run(f.name, f.points, f.menuId, f.active, f.sort, req.params.id, tid(req))
  if (!r.changes) return res.status(404).json({ success: false, message: 'ไม่พบรางวัลนี้' })
  res.json({ success: true })
})

// ลบ = ปิดใช้งาน (ประวัติการแลกยังอ้างถึงได้)
router.delete('/rewards/:id', requireRole(...MANAGERS), (req, res) => {
  const r = db.prepare('UPDATE pos_rewards SET is_active = 0 WHERE id = ? AND tenant_id = ?').run(req.params.id, tid(req))
  if (!r.changes) return res.status(404).json({ success: false, message: 'ไม่พบรางวัลนี้' })
  res.json({ success: true })
})

// ==================== Pop-up โฆษณา (add-on qr_ad) ====================
const adDir = path.join(__dirname, '..', '..', 'uploads', 'qr-ads')
fs.mkdirSync(adDir, { recursive: true })
const MAX_AD_BYTES = 5 * 1024 * 1024
const upload = multer({
  storage: multer.diskStorage({
    destination: adDir,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: MAX_AD_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext) && isAllowedImageExt(ext) && isAllowedImageMimetype(file.mimetype)) cb(null, true)
    else cb(new Error('รองรับเฉพาะ JPG, PNG หรือ WebP'))
  },
})

const removeAdFile = (url?: string | null) => {
  if (!url?.startsWith('/uploads/qr-ads/')) return
  const p = path.resolve(adDir, path.basename(url))
  if (p.startsWith(adDir)) try { fs.unlinkSync(p) } catch { /* ไฟล์หายไปแล้ว */ }
}

router.get('/ad', (req, res) => {
  const tenantId = tid(req)
  const slot = db.prepare('SELECT * FROM pos_ad_slots WHERE tenant_id = ?').get(tenantId) || null
  const since = new Date(Date.now() - 30 * 86400_000).toISOString()
  const stats = Object.fromEntries((db.prepare(`SELECT type, COUNT(*) AS n FROM pos_ad_events WHERE tenant_id = ? AND created_at >= ? GROUP BY type`)
    .all(tenantId, since) as any[]).map(r => [r.type, r.n]))
  res.json({ success: true, data: { addon: hasFeature(tenantId, 'qr_ad'), slot, stats: { shown: stats.shown || 0, tap: stats.tap || 0, close: stats.close || 0 } } })
})

router.put('/ad', requireRole(...MANAGERS), (req, res) => {
  const tenantId = tid(req)
  if (!hasFeature(tenantId, 'qr_ad')) return res.status(403).json({ success: false, code: 'ADDON_REQUIRED', message: 'ต้องซื้อ Add-on Pop-up โฆษณา (฿19/เดือน) ก่อน' })
  const b = req.body || {}
  const link = ['none', 'promo', 'menu'].includes(b.link_type) ? b.link_type : 'none'
  if (link === 'menu' && !ownsMenu(tenantId, b.link_menu_id)) return bad(res, 'เลือกเมนูที่จะพาไปเมื่อแตะรูป')
  const startsOn = optDate(b.starts_on), endsOn = optDate(b.ends_on), ds = optTime(b.daily_start), de = optTime(b.daily_end)
  if (startsOn === undefined || endsOn === undefined || (startsOn && endsOn && startsOn > endsOn)) return bad(res, 'ช่วงวันที่ไม่ถูกต้อง')
  if (ds === undefined || de === undefined || (!!ds !== !!de)) return bad(res, 'ช่วงเวลาต้องใส่ทั้งเริ่มและสิ้นสุด (HH:MM)')
  db.prepare(`INSERT INTO pos_ad_slots (tenant_id, link_type, link_menu_id, starts_on, ends_on, daily_start, daily_end, is_enabled, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET link_type = excluded.link_type, link_menu_id = excluded.link_menu_id, starts_on = excluded.starts_on,
      ends_on = excluded.ends_on, daily_start = excluded.daily_start, daily_end = excluded.daily_end, is_enabled = excluded.is_enabled, updated_at = excluded.updated_at`)
    .run(tenantId, link, link === 'menu' ? b.link_menu_id : null, startsOn, endsOn, ds, de, b.is_enabled === false ? 0 : 1, new Date().toISOString())
  res.json({ success: true })
})

// POST /ad/image (multipart field "image") — 1 ร้าน 1 รูป อัปโหลดใหม่แทนที่รูปเดิม
// ponytail: ยังไม่ย่อ/แปลงเป็น WebP (ไม่มี sharp ในเครื่อง) — จำกัด 5MB แทน · ติดตั้ง sharp แล้วค่อยย่อเหลือ ~200KB
router.post('/ad/image', requireRole(...MANAGERS), (req, res, next) => {
  if (!hasFeature(tid(req), 'qr_ad')) return res.status(403).json({ success: false, code: 'ADDON_REQUIRED', message: 'ต้องซื้อ Add-on Pop-up โฆษณา (฿19/เดือน) ก่อน' })
  upload.single('image')(req, res, (err: any) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return bad(res, 'ไฟล์ใหญ่เกิน 5 MB กรุณาย่อรูปก่อน')
    if (err) return bad(res, err.message)
    next()
  })
}, (req, res) => {
  const tenantId = tid(req)
  const file = req.file
  if (!file) return bad(res, 'ไม่พบไฟล์รูป')
  const full = path.join(adDir, file.filename)
  if (!isValidImageFile(full)) { try { fs.unlinkSync(full) } catch { /* ignore */ } return bad(res, 'ไฟล์นี้ไม่ใช่รูปภาพที่ใช้ได้') }
  const old = db.prepare('SELECT image_url FROM pos_ad_slots WHERE tenant_id = ?').get(tenantId) as any
  const url = `/uploads/qr-ads/${file.filename}`
  db.prepare(`INSERT INTO pos_ad_slots (tenant_id, image_url, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET image_url = excluded.image_url, updated_at = excluded.updated_at`).run(tenantId, url, new Date().toISOString())
  removeAdFile(old?.image_url)
  res.json({ success: true, data: { image_url: url } })
})

router.delete('/ad/image', requireRole(...MANAGERS), (req, res) => {
  const tenantId = tid(req)
  const old = db.prepare('SELECT image_url FROM pos_ad_slots WHERE tenant_id = ?').get(tenantId) as any
  db.prepare('UPDATE pos_ad_slots SET image_url = NULL, updated_at = ? WHERE tenant_id = ?').run(new Date().toISOString(), tenantId)
  removeAdFile(old?.image_url)
  res.json({ success: true })
})

export default router
