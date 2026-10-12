import { getDb } from '../db/sqlite'

export interface SubscriptionInfo {
  tenantId: string
  planCode: string
  planName: string
  status: 'FREE' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'NONE'
  currentPeriodEnd: string | null
  features: string[]
  packs: string[]
  addons: Record<string, number>
  maxUsers: number | null
  maxProducts: number | null
  maxPosShifts: number | null
}

// แพ็ก v2 = Base plan + Pack ตามประเภทธุรกิจ + Add-on (ดู Phopy_Price.xlsx ชีต Add-ons)
// Business เลือกได้ 1 Pack, Business+ 2 Pack (ซื้อเพิ่มได้) — Pro/Enterprise AI ใส่ฟีเจอร์ทุก Pack ไว้ใน plan แล้ว
// ponytail: mapping อยู่ในโค้ดเพราะผูกกับ gate ใน index.ts — ถ้าต้องให้ MASTER แก้เองค่อยย้ายเป็นตาราง
export const PACK_FEATURES: Record<string, string[]> = {
  shop: ['kds'],                          // + กะไม่จำกัด (ดู maxPosShifts ด้านล่าง)
  online: ['platform_settlement'],
  maker: ['bom', 'work_orders'],
  accounting: ['accounting', 'tax'],
}

// add-on ที่เป็นโมดูล (จำนวน > 0 = เปิด) — extra_users เป็นจำนวนที่นั่ง บวกเข้า maxUsers
export const ADDON_FEATURES = ['smart_unit', 'multi_currency', 'subcontract', 'api_access', 'backup'] as const
export const EXTRA_USERS = 'extra_users'

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

export function getSubscription(tenantId: string): SubscriptionInfo {
  const db = getDb()
  const row = db.prepare(`
    SELECT s.plan_code, s.status, s.current_period_end, s.packs, s.addons,
           p.name AS plan_name, p.features, p.max_users, p.max_products, p.max_pos_shifts
    FROM tenant_subscriptions s
    JOIN subscription_plans p ON p.code = s.plan_code
    WHERE s.tenant_id = ?
  `).get(tenantId) as any

  if (!row) return FULL_ACCESS(tenantId)

  let status = row.status as SubscriptionInfo['status']
  // Lazy expiry: ACTIVE ที่เลย current_period_end ถือเป็น EXPIRED ทันที (ไม่ต้อง cron)
  // FREE มี current_period_end = NULL จึงไม่หมดอายุ
  if (status === 'ACTIVE' && row.current_period_end &&
      new Date(row.current_period_end).getTime() < Date.now()) {
    status = 'EXPIRED'
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
