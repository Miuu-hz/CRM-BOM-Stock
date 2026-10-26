import { describe, it, expect } from 'vitest'
import { canViewMenu, isCashierOnly, isMenuLocked, MENU_REQUIRED_FEATURES } from './menuPermissions'

// แคชเชียร์ (แผนก POS แผนกเดียว) เห็นแค่หน้าร้าน — ต้องตรงกับ backend cashierScope
describe('menuPermissions — แคชเชียร์', () => {
  it('แคชเชียร์เห็นแค่แคชเชียร์ + จอครัว + หน้าคำอธิบาย', () => {
    expect(canViewMenu('USER', '/cashier', ['POS'])).toBe(true)
    expect(canViewMenu('USER', '/kds', ['POS'])).toBe(true)
    expect(canViewMenu('USER', '/help/permissions', ['POS'])).toBe(true)
    expect(canViewMenu('USER', '/purchase', ['POS'])).toBe(false)
    expect(canViewMenu('USER', '/', ['POS'])).toBe(false)
  })
  it('มีแผนกอื่นร่วม หรือเป็น Admin = ไม่ถูกจำกัด', () => {
    expect(isCashierOnly('USER', ['POS', 'SALES'])).toBe(false)
    expect(canViewMenu('ADMIN', '/purchase', ['POS'])).toBe(true)
    expect(canViewMenu('USER', '/purchase', ['SALES'])).toBe(true)
  })
})

// ผู้ใช้พื้นฐาน (USER ไม่มีแผนก) — ต้องตรงกับ backend cashierScope.basicUserDenied
describe('menuPermissions — ผู้ใช้พื้นฐาน', () => {
  it('ไม่เห็นบัญชี/ภาษี/รายงาน/ลูกหนี้ แต่ยังเห็นแคชเชียร์และจัดซื้อ', () => {
    for (const p of [
      '/accounting',
      '/accounting/reports',
      '/accounting/journal-entries',
      '/accounting/books',
      '/accounting/reconcile',
      '/accounting/phopy-board',
      '/tax',
      '/receivables',
    ]) {
      expect(canViewMenu('USER', p, [])).toBe(false)
    }
    expect(canViewMenu('USER', '/cashier', [])).toBe(true)
    expect(canViewMenu('USER', '/purchase', undefined)).toBe(true)
  })
  it('USER ที่มีแผนกบัญชี ยังเห็นเมนูบัญชีตามเดิม', () => {
    expect(canViewMenu('USER', '/accounting', ['ACCOUNTING'])).toBe(true)
    expect(canViewMenu('USER', '/accounting/books', ['ACCOUNTING'])).toBe(true)
    expect(canViewMenu('USER', '/accounting/reconcile', ['ACCOUNTING'])).toBe(true)
    expect(canViewMenu('USER', '/accounting/phopy-board', ['ACCOUNTING'])).toBe(true)
    expect(canViewMenu('MANAGER', '/tax', [])).toBe(true)
  })
})

describe('menuPermissions — isMenuLocked (Phase 3)', () => {
  it('เมนูพื้นฐาน (Dashboard, CRM, Stock, Sales, Purchase) ไม่เคยล็อก', () => {
    expect(isMenuLocked('/', [])).toBe(false)
    expect(isMenuLocked('/crm', [])).toBe(false)
    expect(isMenuLocked('/stock', [])).toBe(false)
    expect(isMenuLocked('/sales', [])).toBe(false)
    expect(isMenuLocked('/purchase', [])).toBe(false)
  })

  it('MASTER ไม่เคยถูกล็อกในเมนูใด ๆ แม้ไม่มีฟีเจอร์', () => {
    expect(isMenuLocked('/bom', [], true)).toBe(false)
    expect(isMenuLocked('/accounting', [], true)).toBe(false)
    expect(isMenuLocked('/tax', [], true)).toBe(false)
  })

  it('ล็อกเมื่อไม่มีฟีเจอร์ และปลดล็อกเมื่อมีฟีเจอร์ในแพ็กเกจ', () => {
    // BOM ต้องการ 'bom'
    expect(isMenuLocked('/bom', ['stock', 'sales'])).toBe(true)
    expect(isMenuLocked('/bom', ['stock', 'sales', 'bom'])).toBe(false)

    // บัญชี ต้องการ 'accounting'
    expect(isMenuLocked('/accounting', [])).toBe(true)
    expect(isMenuLocked('/accounting', ['accounting'])).toBe(false)
    expect(isMenuLocked('/accounting/books', [])).toBe(true)
    expect(isMenuLocked('/accounting/books', ['accounting'])).toBe(false)
    expect(isMenuLocked('/accounting/reconcile', [])).toBe(true)
    expect(isMenuLocked('/accounting/reconcile', ['accounting'])).toBe(false)

    // KDS ต้องการ 'kds'
    expect(isMenuLocked('/kds', [])).toBe(true)
    expect(isMenuLocked('/kds', ['kds'])).toBe(false)

    // Subcontract ต้องการ 'subcontract'
    expect(isMenuLocked('/stock/subcontractors', [])).toBe(true)
    expect(isMenuLocked('/stock/subcontractors', ['subcontract'])).toBe(false)

    // Shopee/Lazada Settlement ต้องการ 'platform_settlement'
    expect(isMenuLocked('/accounting/platform-settlement', ['accounting'])).toBe(true)
    expect(isMenuLocked('/accounting/platform-settlement', ['accounting', 'platform_settlement'])).toBe(false)
  })
})
describe('GM แผนก CEO', () => {
  it('USER แผนก CEO เห็นเมนูอนุมัติ · USER แผนกอื่นไม่เห็น', () => {
    expect(canViewMenu('USER', '/approvals', ['CEO'])).toBe(true)
    expect(canViewMenu('USER', '/approvals', ['SALES'])).toBe(false)
  })
})
