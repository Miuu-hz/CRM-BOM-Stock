import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { createTestUser } from '../test/testAuth'
import { ACC } from '../config/accountCodes'
import {
  postPlatformSettlement,
  recordSettlementPayout,
  SettlementError,
  ensureDefaultFeeMappings,
} from './platformSettlement.service'

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_lines', 'journal_entries', 'platform_settlements',
                       'platform_fee_mappings', 'accounts', 'users', 'document_sequences']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* ข้ามตารางที่ไม่มี tenant_id */ }
    }
  }
})

const balanceOf = (tenantId: string, code: string) => {
  const r = db.prepare(`
    SELECT COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0) AS bal
    FROM journal_lines l JOIN accounts a ON a.id = l.account_id
    WHERE l.tenant_id = ? AND a.code = ?
  `).get(tenantId, code) as any
  return Math.round((r.bal || 0) * 100) / 100
}

/** ลงรอบขายไว้ก่อนโดยยังไม่มีเงินโอน — จังหวะจริงของแพลตฟอร์ม */
function seedPendingBatch(tenantId: string) {
  ensureDefaultFeeMappings(tenantId)
  return postPlatformSettlement({
    tenantId,
    platform: 'SHOPEE',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-15',
    grossSales: 1000,
    vatAmount: 65.42,
    cogsAmount: 610,
    fees: [
      { feeType: 'COMMISSION', amount: 120 },
      { feeType: 'SHIPPING', amount: 50 },
      { feeType: 'ADS', amount: 30 },
      { feeType: 'TRANSACTION', amount: 20 },
    ],
    createdBy: 'tester',
  })
}

describe('รับเงินโอนของรอบแพลตฟอร์มที่ลงไว้ก่อน', () => {
  it('ลงยอดขายก่อน เงินยังไม่เข้า → 1181 ค้างเท่ายอดที่ควรได้รับ', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const res = seedPendingBatch(user.tenantId)

    expect(res.status).toBe('PENDING_PAYOUT')
    expect(res.payoutJournalId).toBeNull()
    // 1,000 − (120+50+30+20) = 780
    expect(balanceOf(user.tenantId, ACC.PLATFORM_CLEARING), 'รอเงินโอนอยู่ 780').toBe(780)
    expect(balanceOf(user.tenantId, ACC.REVENUE_PRODUCT), 'รายได้ต้องเป็นยอดเต็มก่อนภาษี ไม่ใช่ยอดสุทธิ').toBe(-934.58)
  })

  it('เงินโอนเข้าทีหลังตรงยอด → 1181 กลับเป็นศูนย์ ไม่มีเงินขาดเงินเกิน', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const batch = seedPendingBatch(user.tenantId)

    const done = recordSettlementPayout({ tenantId: user.tenantId, batchId: batch.batchId, payoutAmount: 780 })

    expect(done.status).toBe('COMPLETED')
    expect(balanceOf(user.tenantId, ACC.PLATFORM_CLEARING), 'ปิดบัญชีพักแล้วต้องเป็นศูนย์').toBe(0)
    expect(balanceOf(user.tenantId, ACC.BANK)).toBe(780)
    expect(balanceOf(user.tenantId, ACC.CASH_OVER_SHORT)).toBe(0)
  })

  it('โอนมาขาด 30 → ส่วนต่างเข้า 5901 และบัญชีพักยังกลับเป็นศูนย์', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const batch = seedPendingBatch(user.tenantId)

    recordSettlementPayout({ tenantId: user.tenantId, batchId: batch.batchId, payoutAmount: 750 })

    expect(balanceOf(user.tenantId, ACC.PLATFORM_CLEARING)).toBe(0)
    expect(balanceOf(user.tenantId, ACC.BANK)).toBe(750)
    expect(balanceOf(user.tenantId, ACC.CASH_OVER_SHORT), 'โอนมาขาดเป็นค่าใช้จ่าย ยอดเดบิต').toBe(30)
  })

  it('บันทึกเงินโอนซ้ำรอบเดิมไม่ได้', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const batch = seedPendingBatch(user.tenantId)
    recordSettlementPayout({ tenantId: user.tenantId, batchId: batch.batchId, payoutAmount: 780 })

    expect(() => recordSettlementPayout({ tenantId: user.tenantId, batchId: batch.batchId, payoutAmount: 780 }))
      .toThrow(SettlementError)
    expect(balanceOf(user.tenantId, ACC.BANK), 'ห้ามรับเงินเข้าสองรอบ').toBe(780)
  })

  it('ยืนยันรอบเดิมซ้ำต้องบอกให้ไปบันทึกเงินโอนแทน ไม่ใช่บอกว่าลงซ้ำเฉย ๆ', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    seedPendingBatch(user.tenantId)

    expect(() => seedPendingBatch(user.tenantId)).toThrow(/รอเงินโอนอยู่/)
  })
})
