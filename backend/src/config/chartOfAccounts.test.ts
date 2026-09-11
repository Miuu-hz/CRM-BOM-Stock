import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { DEFAULT_CHART_OF_ACCOUNTS, seedChartOfAccounts } from './chartOfAccounts'
import { ACC, ACC_META } from './accountCodes'

// tenant ทิ้ง — ลบทุกครั้งหลังเทสต์ เพราะเทสต์ชุดนี้ยิงใส่ dev.db ตัวจริง
const tenants: string[] = []
function tmpTenant() {
  const t = 'test_coa_' + generateId()
  tenants.push(t)
  return t
}
afterEach(() => {
  for (const t of tenants.splice(0)) db.prepare('DELETE FROM accounts WHERE tenant_id = ?').run(t)
})

describe('seedChartOfAccounts', () => {
  it('สร้างครบทุกรหัสในผัง และผูก parent ถูกต้อง', () => {
    const t = tmpTenant()
    const created = seedChartOfAccounts(t)

    expect(created).toBe(DEFAULT_CHART_OF_ACCOUNTS.length)
    const rows = db.prepare('SELECT code, level, parent_id FROM accounts WHERE tenant_id = ?').all(t) as any[]
    expect(rows.length).toBe(DEFAULT_CHART_OF_ACCOUNTS.length)

    const byCode = Object.fromEntries(rows.map(r => [r.code, r]))
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS as readonly any[]) {
      const row = byCode[acc.code]
      expect(row, `ขาดรหัส ${acc.code}`).toBeTruthy()
      if (acc.parent_code) {
        const parent = db.prepare('SELECT code FROM accounts WHERE id = ?').get(row.parent_id) as any
        expect(parent?.code, `${acc.code} ผูก parent ผิด`).toBe(acc.parent_code)
      }
    }
  })

  it('เรียกซ้ำแล้วไม่สร้างซ้ำ (idempotent)', () => {
    const t = tmpTenant()
    seedChartOfAccounts(t)
    expect(seedChartOfAccounts(t)).toBe(0)
  })

  it('เติมเฉพาะที่ขาด และซ่อม parent/level ของบัญชีกำพร้าที่ถูกปั้นสดไว้ก่อน', () => {
    const t = tmpTenant()
    // จำลองสภาพจริง: มีแค่บัญชีเดียวที่ getOrCreateAccount ปั้นทิ้งไว้ level 0 ไม่มีแม่
    const orphanId = generateId()
    db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, level, is_active, is_system)
                VALUES (?, ?, ?, 'เงินสด', 'ASSET', 'CURRENT_ASSET', 'DEBIT', 0, 1, 1)`).run(orphanId, t, ACC.CASH)

    const created = seedChartOfAccounts(t)
    expect(created).toBe(DEFAULT_CHART_OF_ACCOUNTS.length - 1)

    const cash = db.prepare('SELECT id, level, parent_id FROM accounts WHERE tenant_id = ? AND code = ?').get(t, ACC.CASH) as any
    expect(cash.id).toBe(orphanId)          // ของเดิมไม่ถูกสร้างซ้ำ
    expect(cash.level).toBe(2)              // level ถูกซ่อม
    const parent = db.prepare('SELECT code FROM accounts WHERE id = ?').get(cash.parent_id) as any
    expect(parent.code).toBe('11')          // ถูกจับกลับเข้าใต้สินทรัพย์หมุนเวียน
  })

  it('ทุกรหัสที่โค้ดเรียกผ่าน ACC/ACC_META ต้องมีอยู่ในผัง — กันบัญชีกำพร้าเกิดใหม่', () => {
    const codesInChart = new Set(DEFAULT_CHART_OF_ACCOUNTS.map(a => a.code as string))
    for (const code of Object.values(ACC)) {
      expect(codesInChart.has(code), `ACC.* ใช้รหัส ${code} ที่ไม่มีในผังบัญชี`).toBe(true)
    }
    for (const code of Object.keys(ACC_META)) {
      expect(codesInChart.has(code), `ACC_META มีรหัส ${code} ที่ไม่มีในผังบัญชี`).toBe(true)
    }
  })

  it('5901 (เงินขาด/เงินเกิน) กับ 5902 (ปรับปรุงสต็อก) ต้องเป็นคนละบัญชี', () => {
    expect(ACC.CASH_OVER_SHORT).not.toBe(ACC.STOCK_ADJUSTMENT)
    expect(ACC_META[ACC.CASH_OVER_SHORT]!.name).not.toBe(ACC_META[ACC.STOCK_ADJUSTMENT]!.name)
  })
})
