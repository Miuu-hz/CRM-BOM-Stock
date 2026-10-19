import db from '../db/sqlite'

export interface LoyaltySettings {
  enabled: boolean
  earnRate: number    // ใช้จ่าย X บาท ได้ 1 แต้ม
  redeemRate: number  // X แต้ม = ลด 1 บาท
  minRedeem: number   // แลกขั้นต่ำกี่แต้ม
}

// ตรงกับ DEFAULT_LOYALTY ในหน้าตั้งค่า (frontend/src/pages/Settings.tsx) — คอลัมน์เป็น NULL = ร้านยังไม่เคยตั้ง
const DEFAULTS: LoyaltySettings = { enabled: true, earnRate: 100, redeemRate: 10, minRedeem: 100 }

export function getLoyaltySettings(tenantId: string): LoyaltySettings {
  const r = db.prepare(`SELECT loyalty_enabled, loyalty_earn_rate, loyalty_redeem_rate, loyalty_min_redeem
    FROM company_settings WHERE tenant_id = ?`).get(tenantId) as any
  const positive = (v: unknown, d: number) => (Number(v) > 0 ? Number(v) : d)
  return {
    enabled: r?.loyalty_enabled == null ? DEFAULTS.enabled : r.loyalty_enabled === 1,
    earnRate: positive(r?.loyalty_earn_rate, DEFAULTS.earnRate),
    redeemRate: positive(r?.loyalty_redeem_rate, DEFAULTS.redeemRate),
    minRedeem: r?.loyalty_min_redeem == null ? DEFAULTS.minRedeem : Math.max(0, Number(r.loyalty_min_redeem) || 0),
  }
}
