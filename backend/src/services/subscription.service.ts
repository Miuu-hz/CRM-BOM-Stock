import { getDb } from '../db/sqlite'

export interface SubscriptionInfo {
  tenantId: string
  planCode: string
  planName: string
  status: 'FREE' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'NONE'
  currentPeriodEnd: string | null
  features: string[]
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
  maxUsers: null,
  maxProducts: null,
  maxPosShifts: null,
})

export function getSubscription(tenantId: string): SubscriptionInfo {
  const db = getDb()
  const row = db.prepare(`
    SELECT s.plan_code, s.status, s.current_period_end,
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

  return {
    tenantId,
    planCode: row.plan_code,
    planName: row.plan_name,
    status,
    currentPeriodEnd: row.current_period_end,
    features: JSON.parse(row.features || '[]'),
    maxUsers: row.max_users,
    maxProducts: row.max_products,
    maxPosShifts: row.max_pos_shifts,
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
