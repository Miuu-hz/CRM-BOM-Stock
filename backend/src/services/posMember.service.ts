import { createHash, randomBytes, randomUUID } from 'crypto'
import db from '../db/sqlite'
import { maskPhone } from '../utils/phone'

// สมาชิกที่สมัครเองด้วยเบอร์โทรผ่าน QR สั่งที่โต๊ะ
// ไม่มี OTP (ค่า SMS) — ใช้กติกา "สะสมได้ทันที แลก/ดูแต้มต้องยืนยัน":
//   ใส่เบอร์คนอื่น = แต้มไปเข้าเจ้าของเบอร์ ไม่มีใครเสียอะไร · ดูชื่อ/แต้ม/แลกแต้ม ต้องให้แคชเชียร์ยืนยันตัวตนก่อน 1 ครั้ง
//   แล้วเครื่องนั้นถูกจำไว้ DEVICE_DAYS วัน
// ponytail: ยืนยันด้วยคน — ถ้าร้านต้องการ OTP ค่อยเสียบผู้ให้บริการ SMS แทนขั้นตอน verifyBillMember

export const DEVICE_COOKIE = 'phq_dev'
export const DEVICE_DAYS = 180

export const mintDeviceToken = (): string => randomBytes(32).toString('base64url')
const hash = (token: string) => createHash('sha256').update(token).digest('hex')

export interface MemberDevice {
  id: string
  customer_id: string
  verified_at: string | null
  consent_marketing: number
  name: string
  phone: string
  loyalty_points: number
  marketing_consent_at: string | null
}

export function getDevice(tenantId: string, token: unknown): MemberDevice | null {
  // cookie-parser แปลง j:{...} เป็น object ได้ — รับเฉพาะ string
  if (typeof token !== 'string' || !token || token.length > 100) return null
  return (db.prepare(`
    SELECT d.id, d.customer_id, d.verified_at, d.consent_marketing,
           c.name, c.phone, c.loyalty_points, c.marketing_consent_at
    FROM pos_member_devices d JOIN customers c ON c.id = d.customer_id AND c.tenant_id = d.tenant_id
    WHERE d.tenant_id = ? AND d.token_hash = ? AND d.expires_at > ? AND c.status = 'ACTIVE'
  `).get(tenantId, hash(token), new Date().toISOString()) as MemberDevice | undefined) || null
}

/** ข้อมูลสมาชิกที่หน้าลูกค้าเห็นได้ — ยังไม่ยืนยัน = เห็นแค่เบอร์ที่ปิดไว้ (คนสุ่มเบอร์ส่องชื่อ/แต้มคนอื่นไม่ได้) */
export function memberView(d: MemberDevice | null) {
  if (!d) return null
  if (!d.verified_at) return { status: 'pending' as const, phone: maskPhone(d.phone) }
  return {
    status: 'verified' as const,
    phone: maskPhone(d.phone),
    name: d.name,
    points: Math.floor(d.loyalty_points || 0),
    marketing: !!d.marketing_consent_at,
  }
}

/** สมาชิกเดิมของร้านที่เบอร์ตรงกัน (เทียบเฉพาะตัวเลข) หรือสร้างใหม่ — ตอบแบบเดียวกันทั้งสองกรณี */
export function findOrCreateMember(tenantId: string, mobile: string, nickname: string): string {
  const existing = db.prepare(`SELECT id FROM customers WHERE tenant_id = ? AND status = 'ACTIVE' AND phone_digits(phone) = ?
    ORDER BY updated_at DESC LIMIT 1`).get(tenantId, mobile) as any
  if (existing) return existing.id

  const id = randomUUID().replace(/-/g, '').substring(0, 25)
  let code: string
  do { code = 'CUS-' + randomUUID().replace(/-/g, '').substring(0, 8) }
  while (db.prepare('SELECT 1 FROM customers WHERE tenant_id = ? AND code = ?').get(tenantId, code))
  const now = new Date().toISOString()
  const name = nickname || `สมาชิก ${maskPhone(mobile)}`
  db.prepare(`INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city,
      lead_source, pdpa_points_consent_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'INDIVIDUAL', ?, '', ?, '', 'QR สั่งที่โต๊ะ', ?, 'ACTIVE', ?, ?)`)
    .run(id, tenantId, code, name, name, mobile, now, now, now)
  return id
}

/** ผูกมือถือเครื่องนี้กับสมาชิก (ยังไม่ยืนยัน) — เปลี่ยนเบอร์บนเครื่องเดิม = แทนที่แถวเดิม และต้องยืนยันใหม่ */
export function bindDevice(tenantId: string, token: string, customerId: string, consentMarketing: boolean): string {
  const h = hash(token)
  const now = new Date()
  const expires = new Date(now.getTime() + DEVICE_DAYS * 86400_000).toISOString()
  const current = db.prepare('SELECT id, customer_id FROM pos_member_devices WHERE tenant_id = ? AND token_hash = ?').get(tenantId, h) as any
  if (current && current.customer_id === customerId) {
    db.prepare('UPDATE pos_member_devices SET consent_marketing = ?, expires_at = ? WHERE id = ?').run(consentMarketing ? 1 : 0, expires, current.id)
    return current.id
  }
  if (current) db.prepare('DELETE FROM pos_member_devices WHERE id = ?').run(current.id)
  const id = randomUUID().replace(/-/g, '').substring(0, 25)
  db.prepare(`INSERT INTO pos_member_devices (id, tenant_id, token_hash, customer_id, consent_marketing, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, tenantId, h, customerId, consentMarketing ? 1 : 0, now.toISOString(), expires)
  return id
}

/** token นี้ server เคยออกให้จริง (ร้านไหนก็ได้) — ลูกค้าคนเดียวเป็นสมาชิกหลายร้านด้วย cookie เดียว */
export function isKnownToken(token: unknown): boolean {
  return typeof token === 'string' && !!db.prepare('SELECT 1 FROM pos_member_devices WHERE token_hash = ?').get(hash(token))
}

export function forgetDevice(tenantId: string, token: unknown): void {
  if (typeof token === 'string' && token) db.prepare('DELETE FROM pos_member_devices WHERE tenant_id = ? AND token_hash = ?').run(tenantId, hash(token))
}

/** แคชเชียร์ยืนยันว่าคนที่โต๊ะคือเจ้าของเบอร์ → เครื่องนั้นเห็นแต้ม/แลกแต้มได้ + บันทึกความยินยอมลงโปรไฟล์ลูกค้า */
export function verifyBillMember(tenantId: string, billId: string): boolean {
  const row = db.prepare(`SELECT d.id, d.customer_id, d.consent_marketing FROM pos_running_bills b
    JOIN pos_member_devices d ON d.id = b.member_device_id AND d.tenant_id = b.tenant_id
    WHERE b.id = ? AND b.tenant_id = ?`).get(billId, tenantId) as any
  if (!row) return false
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare('UPDATE pos_member_devices SET verified_at = COALESCE(verified_at, ?) WHERE id = ?').run(now, row.id)
    db.prepare(`UPDATE customers SET pdpa_points_consent_at = COALESCE(pdpa_points_consent_at, ?),
        marketing_consent_at = CASE WHEN ? = 1 THEN COALESCE(marketing_consent_at, ?) ELSE marketing_consent_at END
      WHERE id = ? AND tenant_id = ?`).run(now, row.consent_marketing, now, row.customer_id, tenantId)
  })()
  return true
}
