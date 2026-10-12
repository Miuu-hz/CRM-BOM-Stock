import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { getSubscription } from './subscription.service'

function subscribe(planCode: string, packs: string[] = [], addons: Record<string, number> = {}) {
  const tenantId = `t_sub_${generateId()}`
  db.prepare(`
    INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, current_period_end, packs, addons)
    VALUES (?, ?, ?, 'ACTIVE', datetime('now', '+30 days'), ?, ?)
  `).run(generateId(), tenantId, planCode, JSON.stringify(packs), JSON.stringify(addons))
  return tenantId
}

describe('แพ็กเกจ v2 (Base + Pack + Add-on)', () => {
  it('seed แพ็ก v2 ครบ 6 ตัว และแพ็กเก่าที่ไม่ขายแล้วถูกปิด', () => {
    const active = (db.prepare('SELECT code FROM subscription_plans WHERE is_active = 1 ORDER BY sort_order').all() as any[])
      .map(r => r.code)
    expect(active).toEqual(['free', 'solo', 'business', 'business_plus', 'pro', 'enterprise_ai'])
    const legacy = db.prepare(`SELECT is_active FROM subscription_plans WHERE code IN ('starter','enterprise')`).all() as any[]
    expect(legacy.every(r => r.is_active === 0)).toBe(true)
  })

  it('Business ไม่มี Pack = ไม่มีบัญชี/ผลิต/KDS และเปิดกะได้ 1 กะ', () => {
    const sub = getSubscription(subscribe('business'))
    expect(sub.features).toEqual(expect.arrayContaining(['stock', 'sales', 'purchase', 'pos', 'crm']))
    for (const f of ['accounting', 'tax', 'bom', 'work_orders', 'kds', 'platform_settlement']) {
      expect(sub.features).not.toContain(f)
    }
    expect(sub.maxUsers).toBe(3)
    expect(sub.maxPosShifts).toBe(1)
  })

  it('Pack ที่ซื้อเปิดฟีเจอร์ของ Pack นั้น และ Pack Shop ปลดล็อกกะไม่จำกัด', () => {
    const sub = getSubscription(subscribe('business_plus', ['maker', 'shop']))
    expect(sub.features).toEqual(expect.arrayContaining(['bom', 'work_orders', 'kds']))
    expect(sub.features).not.toContain('accounting')
    expect(sub.packs).toEqual(['maker', 'shop'])
    expect(sub.maxPosShifts).toBeNull()
  })

  it('Add-on: User เพิ่มบวกเข้าเพดานผู้ใช้ และ add-on โมดูลเปิดฟีเจอร์', () => {
    const sub = getSubscription(subscribe('business', ['accounting'], { extra_users: 2, multi_currency: 1 }))
    expect(sub.maxUsers).toBe(5)
    expect(sub.features).toEqual(expect.arrayContaining(['accounting', 'tax', 'multi_currency']))
  })

  it('Pack ที่ไม่รู้จักหรือ add-on จำนวน 0 ไม่เปิดอะไรเพิ่ม', () => {
    const sub = getSubscription(subscribe('solo', ['hacker', 'toString'], { api_access: 0 }))
    expect(sub.features).not.toContain('api_access')
    expect(sub.packs).toEqual([])
  })

  it('Pro ได้ครบทุก Pack โดยไม่ต้องเลือก', () => {
    const sub = getSubscription(subscribe('pro'))
    expect(sub.features).toEqual(expect.arrayContaining(['kds', 'platform_settlement', 'bom', 'accounting', 'tax', 'ai']))
    expect(sub.maxUsers).toBe(8)
  })

  it('แพ็ก enterprise เดิม (ลูกค้าเก่า) ยังเข้าหน้ากระทบยอด Shopee/Lazada ได้หลังเปลี่ยน gate', () => {
    const sub = getSubscription(subscribe('enterprise'))
    expect(sub.features).toContain('platform_settlement')
  })
})
