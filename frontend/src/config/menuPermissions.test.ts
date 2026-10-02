import { describe, it, expect } from 'vitest'
import { canViewMenu, isCashierOnly } from './menuPermissions'

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
