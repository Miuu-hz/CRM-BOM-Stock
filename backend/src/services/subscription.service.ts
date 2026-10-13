import { getDb } from '../db/sqlite'
import { PACK_FEATURES, ADDON_FEATURES, EXTRA_USERS } from './subscription.features'

export { PACK_FEATURES, ADDON_FEATURES, EXTRA_USERS }

export interface SubscriptionInfo {
  tenantId: string
  planCode: string
  planName: string
  status: 'FREE' | 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'NONE'
  currentPeriodEnd: string | null
  features: string[]
  packs: string[]
  addons: Record<string, number>
  maxUsers: number | null
  maxProducts: number | null
  maxPosShifts: number | null
}

// ponytail: tenant ที่ไม่มี subscription row (เช่น MASTER tenant จาก .env) ถือว่าเข้าถึงได้ทุกอย่าง
const FULL_ACCESS = (tenantId: string): SubscriptionInfo => ({
  tenantId,
  planCode: 'none',
  planName: 'None',
  status: 'NONE',
  currentPeriodEnd: null,
  features: [],
  packs: [],
  addons: {},
  maxUsers: null,
  maxProducts: null,
  maxPosShifts: null,
})

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  try { return raw ? JSON.parse(raw) : fallback } catch { return fallback }
}

const PLAN_COLS = 'p.code AS plan_code, p.name AS plan_name, p.features, p.max_users, p.max_products, p.max_pos_shifts'

export function getSubscription(tenantId: string): SubscriptionInfo {
  const db = getDb()
  let row = db.prepare(`
    SELECT s.status, s.current_period_end, s.packs, s.addons, ${PLAN_COLS}
    FROM tenant_subscriptions s
    JOIN subscription_plans p ON p.code = s.plan_code
    WHERE s.tenant_id = ?
  `).get(tenantId) as any

  if (!row) return FULL_ACCESS(tenantId)

  const lapsed = !!row.current_period_end && new Date(row.current_period_end).getTime() < Date.now()
  const freePlan = () => db.prepare(`SELECT ${PLAN_COLS} FROM subscription_plans p WHERE p.code = 'free'`).get() as any

  // ทดลองใช้ (สมัครเองจากหน้าเว็บ) ครบกำหนดแล้วยังไม่จ่าย → ใช้ต่อแบบ Free ข้อมูลอยู่ครบ (ไม่ล็อกบริษัท)
  // ponytail: lazy เหมือน ACTIVE ไม่มี cron — แถวใน DB ยังเป็น TRIAL ไว้ให้ checkout รู้ว่าใช้สิทธิ์ทดลองไปแล้ว
  if (row.status === 'TRIAL' && lapsed) {
    row = { ...freePlan(), status: 'FREE', current_period_end: null, packs: '[]', addons: '{}' }
  }

  let status = row.status as SubscriptionInfo['status']
  // Lazy expiry: ACTIVE ที่เลย current_period_end ถือเป็น EXPIRED ทันที (ไม่ต้อง cron)
  // FREE มี current_period_end = NULL จึงไม่หมดอายุ
  if (status === 'ACTIVE' && lapsed) status = 'EXPIRED'

  // หมดอายุ/ยกเลิก: subscriptionGate ยังให้ ADMIN เข้าระบบได้เพื่อต่ออายุ — แต่ต้องได้แค่สิทธิ์ระดับ Free
  // (เดิมได้ฟีเจอร์แพ็กเสียเงินครบต่อไปเรื่อย ๆ) ชื่อแพ็ก/วันหมดอายุคงไว้ให้หน้าแพ็กเกจบอกว่าอะไรหมด
  if (status === 'EXPIRED' || status === 'CANCELLED') {
    const free = freePlan()
    row = { ...row, features: free.features, max_users: free.max_users, max_products: free.max_products, max_pos_shifts: free.max_pos_shifts, packs: '[]', addons: '{}' }
  }

  // ไม่เชื่อค่าใน DB ตรง ๆ — pack/add-on ที่ไม่รู้จักถูกทิ้ง
  const packs = parseJson<string[]>(row.packs, []).filter(p => typeof p === 'string' && Object.prototype.hasOwnProperty.call(PACK_FEATURES, p))
  const addons = parseJson<Record<string, number>>(row.addons, {})
  const enabledAddons = ADDON_FEATURES.filter(a => Number(addons[a]) > 0)
  const extraUsers = Math.max(0, Math.floor(Number(addons[EXTRA_USERS]) || 0))

  const features = [...new Set([
    ...parseJson<string[]>(row.features, []),
    ...packs.flatMap(p => PACK_FEATURES[p]),
    ...enabledAddons,
  ])]

  return {
    tenantId,
    planCode: row.plan_code,
    planName: row.plan_name,
    status,
    currentPeriodEnd: row.current_period_end,
    features,
    packs,
    addons,
    maxUsers: row.max_users === null ? null : row.max_users + extraUsers,
    maxProducts: row.max_products,
    // Pack Shop = เปิด-ปิดกะไม่จำกัด (ไม่มี Pack Shop ใช้ได้ 1 กะ/วันตาม plan)
    maxPosShifts: packs.includes('shop') ? null : row.max_pos_shifts,
  }
}

export function hasFeature(tenantId: string, feature: string): boolean {
  const sub = getSubscription(tenantId)
  if (sub.status === 'NONE') return true
  return sub.features.includes(feature)
}

export function getLimits(tenantId: string): { maxUsers: number | null; maxProducts: number | null; maxPosShifts: number | null } {
  const sub = getSubscription(tenantId)
  return { maxUsers: sub.maxUsers, maxProducts: sub.maxProducts, maxPosShifts: sub.maxPosShifts }
}
