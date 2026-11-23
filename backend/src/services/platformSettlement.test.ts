import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { createTestUser } from '../test/testAuth'
import {
  updateFeeMappings,
  getFeeMappings,
  resolveFeeMapping,
  SettlementError,
} from './platformSettlement.service'

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['platform_fee_mappings', 'users']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* ข้ามตารางที่ไม่มี tenant_id */ }
    }
  }
})

describe('การผูกค่าธรรมเนียมแพลตฟอร์ม (platform fee mappings)', () => {
  it('ค่าธรรมเนียมที่ยังไม่ได้ผูกบัญชี ต้อง resolve ไม่ได้ (กันลงมั่ว)', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)

    expect(() => resolveFeeMapping(user.tenantId, 'UNKNOWN_FEE_TYPE')).toThrow(SettlementError)
  })

  it('แก้บัญชีปลายทางของค่าธรรมเนียมผ่าน updateFeeMappings แล้ว resolveFeeMapping ได้บัญชีใหม่', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)

    const mappings = getFeeMappings(user.tenantId)
    const commission = mappings.find(m => m.feeType === 'COMMISSION')!
    expect(commission.accountCode).toBe('5203')

    updateFeeMappings(user.tenantId, [{ id: commission.id, accountCode: '5204' }])

    const resolved = resolveFeeMapping(user.tenantId, 'COMMISSION')
    expect(resolved.accountCode).toBe('5204')
  })
})
