import { describe, it, expect } from 'vitest'
import { canHandleBilling } from '../services/rbac.service'

/**
 * เจ้าของสั่ง 2026-09-14: "ไม่ทำตามระบบเดิม ต้องยึด role"
 * ออกใบแจ้งหนี้ / รับชำระ / จ่ายเงินผู้ขาย ต้องผ่านระบบสิทธิ์จริง ไม่ใช่เปิดให้ทุกคนแบบเดิม
 * เทสต์นี้ล็อกว่าใครผ่านใครไม่ผ่าน — กันการเผลอเปิดกลับ
 */
const u = (role: string, departments: any[] = []) => ({ role, departments })

describe('สิทธิ์แตะเงิน (canHandleBilling)', () => {
  it('ADMIN / MASTER ผ่านทั้งสองสายเสมอ', () => {
    for (const role of ['ADMIN', 'MASTER']) {
      expect(canHandleBilling(u(role), 'sales')).toBe(true)
      expect(canHandleBilling(u(role), 'purchase')).toBe(true)
    }
  })

  it('พนักงานฝ่ายขายออกบิล/รับเงินฝั่งขายได้ แต่จ่ายเงินผู้ขายไม่ได้', () => {
    const sales = u('USER', ['SALES'])
    expect(canHandleBilling(sales, 'sales')).toBe(true)
    expect(canHandleBilling(sales, 'purchase')).toBe(false)
  })

  it('พนักงานฝ่ายจัดซื้อทำฝั่งซื้อได้ แต่ออกบิลขายไม่ได้', () => {
    const buyer = u('USER', ['PURCHASE'])
    expect(canHandleBilling(buyer, 'purchase')).toBe(true)
    expect(canHandleBilling(buyer, 'sales')).toBe(false)
  })

  it('ฝ่ายบัญชีทำได้ทั้งสองสาย (เป็นคนออกบิล/ตั้งเบิกจริง)', () => {
    const acc = u('USER', ['ACCOUNTING'])
    expect(canHandleBilling(acc, 'sales')).toBe(true)
    expect(canHandleBilling(acc, 'purchase')).toBe(true)
  })

  it('ฝ่ายผลิต/QC/คลัง แตะเงินไม่ได้เลย', () => {
    for (const dept of ['PRODUCTION', 'QC', 'STOCK']) {
      expect(canHandleBilling(u('USER', [dept]), 'sales')).toBe(false)
      expect(canHandleBilling(u('USER', [dept]), 'purchase')).toBe(false)
    }
  })

  it('ไม่มีแผนกเลย = ทำไม่ได้ (กันคนที่ยังไม่ถูกจัดแผนกหลุดเข้ามา)', () => {
    expect(canHandleBilling(u('USER'), 'sales')).toBe(false)
    expect(canHandleBilling(u('USER'), 'purchase')).toBe(false)
  })

  it('สิทธิ์รายคน (custom permissions) ปิดได้แม้อยู่ในแผนกนั้น', () => {
    const blocked = { role: 'USER', departments: ['SALES'] as any[], customPermissions: { 'orders:write': false } }
    expect(canHandleBilling(blocked, 'sales')).toBe(false)
  })
})
