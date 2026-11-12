import { Router, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'

// HR Phase 11 — ใบสมัครสาธารณะ (ไม่ล็อกอิน) ทุกช่องถือว่าเป็นข้อมูลอันตราย: ตรวจชนิด/ความยาว ไม่สะท้อนค่ากลับ ไม่คืน id ใด ๆ
const TOKEN_RE = /^[0-9a-f]{32}$/
const PHONE_RE = /^[0-9+\- ]{9,20}$/
const ALLOWED_KEYS = new Set(['full_name', 'phone', 'email', 'note', 'consent', 'website'])
const NOT_FOUND = { success: false, message: 'ไม่พบตำแหน่งงาน' }

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10)
}

function findOpenPosting(token: string) {
  if (!TOKEN_RE.test(token)) return undefined
  return db.prepare('SELECT id, tenant_id, title, description FROM hr_job_postings WHERE public_token = ? AND is_open = 1').get(token) as any
}

// max เป็นพารามิเตอร์เพื่อให้เทสต์ไม่ชนลิมิตของกันและกัน (production = 10 ครั้ง/15 นาที/IP)
export function createPublicRecruitRouter(max = 10) {
  const router = Router()
  // จำกัดเข้มเฉพาะการส่งใบสมัคร — เปิดหน้าดูประกาศใช้โควตาแยก (หลายคนสมัครจากไวไฟร้านเดียวกัน = IP เดียว)
  const limit = (n: number) => rateLimit({
    windowMs: 15 * 60 * 1000, max: n, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { success: false, message: 'เรียกถี่เกินไป ลองใหม่อีกครั้งในอีกสักครู่' },
  })
  const viewLimit = limit(max * 6), applyLimit = limit(max)

  router.get('/:token', viewLimit, (req: Request, res: Response) => {
    try {
      const p = findOpenPosting(String(req.params.token))
      if (!p) return res.status(404).json(NOT_FOUND)
      const cs = db.prepare('SELECT name FROM company_settings WHERE tenant_id = ?').get(p.tenant_id) as any
      res.json({ success: true, data: { title: p.title, description: p.description ?? '', company_name: cs?.name ?? '' } })
    } catch (err) {
      console.error('Public job get error:', err)
      res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' })
    }
  })

  router.post('/:token/apply', applyLimit, (req: Request, res: Response) => {
    try {
      const p = findOpenPosting(String(req.params.token))
      if (!p) return res.status(404).json(NOT_FOUND)
      const b = req.body
      const bad = (message: string) => res.status(400).json({ success: false, message })
      if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !ALLOWED_KEYS.has(k))) {
        return bad('ข้อมูลไม่ถูกต้อง')
      }
      const str = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v.trim() : null)
      const fullName = str(b.full_name), phone = str(b.phone), email = str(b.email), note = str(b.note), website = str(b.website)
      if (fullName === null || phone === null || email === null || note === null || website === null) return bad('ข้อมูลไม่ถูกต้อง')
      if (b.consent !== true) return bad('กรุณากดยินยอมการเก็บข้อมูล')
      if (website) return res.status(201).json({ success: true }) // honeypot: บอทกรอก → ทำเป็นสำเร็จแต่ไม่บันทึก
      if (fullName.length < 2 || fullName.length > 120) return bad('ชื่อต้องยาว 2–120 ตัวอักษร')
      if (!PHONE_RE.test(phone)) return bad('เบอร์โทรไม่ถูกต้อง')
      if (email.length > 200) return bad('อีเมลยาวเกินไป')
      if (note.length > 2000) return bad('หมายเหตุยาวเกินไป')
      const today = thaiDateStr()
      db.prepare(`
        INSERT INTO hr_applicants (id, tenant_id, posting_id, full_name, phone, email, note, source, stage, consent_at, purge_after, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PUBLIC', 'APPLIED', ?, ?, ?)
      `).run(generateId(), p.tenant_id, p.id, fullName, phone, email || null, note || null,
        new Date().toISOString(), addDays(today, 183), new Date().toISOString())
      res.status(201).json({ success: true })
    } catch (err) {
      console.error('Public apply error:', err)
      res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' })
    }
  })

  return router
}

export default createPublicRecruitRouter()
