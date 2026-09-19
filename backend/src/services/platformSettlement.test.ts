import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { createTestUser } from '../test/testAuth'
import { ACC } from '../config/accountCodes'
import {
  postPlatformSettlement,
  updateFeeMappings,
  getFeeMappings,
  SettlementError,
  type SettlementFee,
} from './platformSettlement.service'

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_lines', 'journal_entries', 'platform_settlements', 'platform_fee_mappings',
                       'accounts', 'users']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* ข้ามตารางที่ไม่มี tenant_id */ }
    }
  }
})

/** ยอดคงเหลือของบัญชี = เดบิต − เครดิต */
function balanceOf(tenantId: string, code: string) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS bal
    FROM journal_lines l JOIN accounts a ON a.id = l.account_id
    WHERE l.tenant_id = ? AND a.code = ?
  `).get(tenantId, code) as any
  return Math.round((row.bal || 0) * 100) / 100
}

// ตัวอย่างจากโจทย์: ขาย 1,000 (รวม VAT) คอมมิชชั่น 120 ค่าส่ง 50 ค่าโฆษณา 30 ค่าธรรมเนียม 20 → ควรได้รับ 780
const SAMPLE_FEES: SettlementFee[] = [
  { feeType: 'COMMISSION', amount: 120 },
  { feeType: 'SHIPPING', amount: 50 },
  { feeType: 'ADS', amount: 30 },
  { feeType: 'TRANSACTION', amount: 20 },
]

describe('บัญชีขายผ่านแพลตฟอร์ม (platform settlement)', () => {
  it('ครบ 3 ขั้น (มี payout ตรงเป๊ะ) แล้ว 1181 ต้องเป็นศูนย์', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)

    const result = postPlatformSettlement({
      tenantId: user.tenantId,
      platform: 'SHOPEE',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-07',
      grossSales: 1000,
      vatAmount: 65.42,
      cogsAmount: 610,
      fees: SAMPLE_FEES,
      payoutAmount: 780,
      createdBy: user.email,
    })

    expect(result.status).toBe('COMPLETED')
    expect(balanceOf(user.tenantId, ACC.PLATFORM_CLEARING), '1181 ต้องเป็นศูนย์เมื่อครบ 3 ขั้น').toBe(0)
    expect(balanceOf(user.tenantId, ACC.REVENUE_PRODUCT), 'รายได้ต้องลงยอดเต็มหลังหัก VAT ไม่ใช่ยอดสุทธิหลังหักค่าธรรมเนียม').toBe(-(1000 - 65.42))
    expect(balanceOf(user.tenantId, ACC.OUTPUT_VAT)).toBe(-65.42)
    expect(balanceOf(user.tenantId, ACC.COGS_PRODUCT)).toBe(610)
    expect(balanceOf(user.tenantId, ACC.INVENTORY)).toBe(-610)
    expect(balanceOf(user.tenantId, ACC.BANK)).toBe(780)
    expect(balanceOf(user.tenantId, '5203'), 'ค่าคอมมิชชั่นต้องลงบัญชี 5203').toBe(120)
    expect(balanceOf(user.tenantId, ACC.CASH_OVER_SHORT), 'โอนมาตรงเป๊ะ ไม่ควรมีส่วนต่างเข้า 5901').toBe(0)
  })

  it('ยังไม่มี payout → 1181 ค้างเท่ายอดที่ควรได้รับ (grossSales หักค่าธรรมเนียมแล้ว)', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)

    const result = postPlatformSettlement({
      tenantId: user.tenantId,
      platform: 'SHOPEE',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-07',
      grossSales: 1000,
      vatAmount: 65.42,
      fees: SAMPLE_FEES,
      // payoutAmount ไม่ระบุ = ยังไม่ถึงรอบโอน
    })

    expect(result.status).toBe('PENDING_PAYOUT')
    expect(result.payoutJournalId).toBeNull()
    expect(balanceOf(user.tenantId, ACC.PLATFORM_CLEARING), '1181 ต้องค้างเท่า 780 (1000-220) จนกว่าจะโอนเข้าจริง').toBe(780)
    expect(balanceOf(user.tenantId, ACC.BANK)).toBe(0)
  })

  it('payout ไม่ตรง → ส่วนต่างเข้า 5901 และ 1181 ยังปิดเป็นศูนย์', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)

    // ควรได้รับ 780 แต่โอนมาจริงแค่ 750 → ขาด 30
    postPlatformSettlement({
      tenantId: user.tenantId,
      platform: 'SHOPEE',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-07',
      grossSales: 1000,
      vatAmount: 65.42,
      fees: SAMPLE_FEES,
      payoutAmount: 750,
      createdBy: user.email,
    })

    expect(balanceOf(user.tenantId, ACC.PLATFORM_CLEARING), '1181 ต้องปิดเป็นศูนย์แม้โอนมาไม่ตรง เพราะส่วนต่างไปลง 5901 แทน').toBe(0)
    expect(balanceOf(user.tenantId, ACC.BANK)).toBe(750)
    expect(balanceOf(user.tenantId, ACC.CASH_OVER_SHORT), 'โอนมาขาด 30 ต้องเป็น Dr 5901 (ยอดคงเหลือเป็นบวก)').toBe(30)
  })

  it('ยืนยันรอบเดิมซ้ำต้องไม่ลงซ้ำ', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)

    const input = {
      tenantId: user.tenantId,
      platform: 'SHOPEE',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-07',
      grossSales: 1000,
      vatAmount: 65.42,
      fees: SAMPLE_FEES,
      payoutAmount: 780,
      createdBy: user.email,
    }

    postPlatformSettlement(input)
    expect(() => postPlatformSettlement(input)).toThrow(SettlementError)

    // ยอดต้องเท่าเดิม ไม่ใช่ทวีคูณ
    expect(balanceOf(user.tenantId, ACC.PLATFORM_CLEARING)).toBe(0)
    expect(balanceOf(user.tenantId, ACC.BANK)).toBe(780)
  })

  it('ค่าธรรมเนียมที่ยังไม่ได้ผูกบัญชี ต้องลงบัญชีไม่ได้ (กันลงมั่ว)', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)

    expect(() => postPlatformSettlement({
      tenantId: user.tenantId,
      platform: 'SHOPEE',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-07',
      grossSales: 1000,
      fees: [{ feeType: 'UNKNOWN_FEE_TYPE', amount: 10 }],
      createdBy: user.email,
    })).toThrow(SettlementError)
  })

  it('แก้บัญชีปลายทางของค่าธรรมเนียมผ่าน updateFeeMappings แล้วโพสต์ตามที่แก้ใหม่', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)

    const mappings = getFeeMappings(user.tenantId)
    const commission = mappings.find(m => m.feeType === 'COMMISSION')!
    updateFeeMappings(user.tenantId, [{ id: commission.id, accountCode: '5204' }])

    postPlatformSettlement({
      tenantId: user.tenantId,
      platform: 'SHOPEE',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-07',
      grossSales: 1000,
      vatAmount: 65.42,
      fees: [{ feeType: 'COMMISSION', amount: 120 }],
      createdBy: user.email,
    })

    expect(balanceOf(user.tenantId, '5204'), 'ย้ายไปผูกกับ 5204 แล้วต้องลงที่นั่นแทน 5203').toBe(120)
    expect(balanceOf(user.tenantId, '5203')).toBe(0)
  })
})
