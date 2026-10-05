import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { createTestUser } from '../../test/testAuth'
import { postJournal } from '../../services/accounting.service'
import { ACC } from '../../config/accountCodes'
import { findStuckClosedShifts, repairStuckShift } from '../../services/posShiftRepair.service'

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_lines', 'journal_entries', 'pos_payments', 'pos_running_bills', 'pos_shifts',
                       'tax_periods', 'accounts', 'users', 'document_sequences']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* ตารางไม่มีคอลัมน์ tenant_id ก็ข้าม */ }
    }
  }
})

function balanceOf(tenantId: string, code: string) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS bal
    FROM journal_lines l JOIN accounts a ON a.id = l.account_id
    WHERE l.tenant_id = ? AND a.code = ?
  `).get(tenantId, code) as any
  return Math.round((row.bal || 0) * 100) / 100
}

const closeJournals = (tenantId: string) => db.prepare(
  `SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = 'POS_SHIFT_CLOSE'`).all(tenantId) as any[]

/**
 * กะที่ปิดแล้ว (CLOSED + ยอดที่เก็บตอนปิด) — เหมือนที่โค้ดเดิมทิ้งไว้ตอน postJournal พัง
 * withSales = บิลในกะลง Dr 1180 ไว้ (ระบบบัญชีพัก) · false = กะยุคก่อนเปลี่ยนระบบ
 */
function seedClosedShift(tenantId: string, opts: {
  number: string; closedAt: string; bills: { amount: number; method: string }[]; counted: number; withSales?: boolean
}) {
  const shiftId = generateId()
  const openedAt = new Date(new Date(opts.closedAt).getTime() - 3600_000).toISOString()
  let total = 0, cash = 0, bank = 0
  for (const b of opts.bills) {
    const billId = generateId()
    db.prepare(`INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, total_amount, subtotal, shift_id, closed_at)
                VALUES (?, ?, ?, 'โต๊ะ 1', 'PAID', ?, ?, ?, ?)`)
      .run(billId, tenantId, 'B-' + billId.slice(0, 6), b.amount, b.amount, shiftId, opts.closedAt)
    db.prepare(`INSERT INTO pos_payments (id, tenant_id, bill_id, payment_method, amount, received_by, paid_at)
                VALUES (?, ?, ?, ?, ?, 'tester', ?)`).run(generateId(), tenantId, billId, b.method, b.amount, opts.closedAt)
    if (opts.withSales !== false) {
      postJournal({
        tenantId, date: opts.closedAt.slice(0, 10), referenceType: 'POS_SALE', referenceId: billId, description: 'ขายหน้าร้าน',
        lines: [{ code: ACC.POS_CLEARING, debit: b.amount }, { code: ACC.REVENUE_PRODUCT, credit: b.amount }],
      })
    }
    total += b.amount
    if (b.method === 'CASH') cash += b.amount; else bank += b.amount
  }
  const expected = 500 + cash
  // สูตรเดิม (ไม่ปัด) — เศษลอยแบบที่กะจริงเก็บไว้
  db.prepare(`INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, closed_at, opening_cash,
                closing_cash_counted, expected_cash, cash_difference, total_revenue, cash_revenue, bank_revenue, bill_count, opened_by, closed_by)
              VALUES (?, ?, ?, 'CLOSED', ?, ?, 500, ?, ?, ?, ?, ?, ?, ?, 'tester', 'tester')`)
    .run(shiftId, tenantId, opts.number, openedAt, opts.closedAt, opts.counted, expected, opts.counted - expected,
      total, cash, bank, opts.bills.length)
  return shiftId
}

describe('ซ่อมกะ POS ปิดค้าง (CLOSED แต่ไม่มี journal POS_SHIFT_CLOSE)', () => {
  it('ลงย้อนหลังวันที่ปิดกะ เคลียร์ 1180 · กะปกติ/กะยุคเก่าไม่แตะ · งวดปิดติด · รันซ้ำไม่ลงซ้ำ', () => {
    const { tenantId } = createTestUser({ role: 'ADMIN' })
    tenants.push(tenantId)

    const stuck = seedClosedShift(tenantId, {
      number: 'SH-STUCK', closedAt: '2026-09-25T10:00:00.000Z', counted: 790,
      bills: [{ amount: 300, method: 'CASH' }, { amount: 700, method: 'QR_CODE' }],
    })
    // เคสจริงที่พัง: เศษเกิน 2 ตำแหน่ง ยอดรวมปัดคนละทางกับรายบรรทัด
    const fraction = seedClosedShift(tenantId, {
      number: 'SH-FRAC', closedAt: '2026-09-26T10:00:00.000Z', counted: 500 + 17.655,
      bills: [{ amount: 17.655, method: 'CASH' }, { amount: 10.005, method: 'QR_CODE' }],
    })
    const normal = seedClosedShift(tenantId, {
      number: 'SH-OK', closedAt: '2026-09-27T10:00:00.000Z', counted: 600,
      bills: [{ amount: 100, method: 'CASH' }],
    })
    postJournal({
      tenantId, date: '2026-09-27', referenceType: 'POS_SHIFT_CLOSE', referenceId: normal, description: 'ปิดกะปกติ',
      lines: [{ code: ACC.CASH, debit: 100 }, { code: ACC.POS_CLEARING, credit: 100 }],
    })
    const legacy = seedClosedShift(tenantId, {
      number: 'SH-OLD', closedAt: '2026-09-10T10:00:00.000Z', counted: 550,
      bills: [{ amount: 50, method: 'CASH' }], withSales: false,
    })
    db.prepare(`INSERT INTO tax_periods (id, tenant_id, year, month, period_type, start_date, end_date, status)
                VALUES (?, ?, 2026, 8, 'MONTHLY', '2026-08-01', '2026-08-31', 'CLOSED')`).run(generateId(), tenantId)
    const inClosedPeriod = seedClosedShift(tenantId, {
      number: 'SH-AUG', closedAt: '2026-08-20T10:00:00.000Z', counted: 520,
      bills: [{ amount: 20, method: 'CASH' }],
    })

    const found = findStuckClosedShifts(tenantId).map(s => s.id)
    expect(found.sort()).toEqual([stuck, fraction, legacy, inClosedPeriod].sort())

    const clearingBefore = balanceOf(tenantId, ACC.POS_CLEARING)
    const before = closeJournals(tenantId).length

    // dry-run: บอกผลแต่ไม่เขียน
    const dry = Object.fromEntries(findStuckClosedShifts(tenantId).map(s => [s.id, repairStuckShift(s, 'test', { dryRun: true })]))
    expect(dry[stuck].status).toBe('posted')
    expect(dry[fraction].status).toBe('posted')
    expect(dry[legacy].status).toBe('skip')
    expect(dry[inClosedPeriod].status).toBe('blocked')
    expect(dry[inClosedPeriod].message).toContain('8/2026')
    expect(closeJournals(tenantId).length, 'dry-run ห้ามเขียน').toBe(before)

    // apply
    const applied = Object.fromEntries(findStuckClosedShifts(tenantId).map(s => [s.id, repairStuckShift(s, 'test')]))
    expect(applied[stuck].status).toBe('posted')
    expect(applied[fraction].status).toBe('posted')
    const je = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(applied[stuck].journalEntryId) as any
    expect(je.date).toBe('2026-09-25')
    expect(je.reference_id).toBe(stuck)
    expect(je.total_debit).toBe(1000)
    // กะ STUCK: เงินสด 300 − ขาด 10 · ธนาคาร 700 · เงินขาด 10 · Cr 1180 ทั้งก้อน
    // เงินสด+ธนาคาร = กะปกติ 100 + กะ STUCK (290 + 700) + กะเศษ 27.66 (ยอดรวมปัดครั้งเดียว)
    expect(Math.round((balanceOf(tenantId, ACC.CASH) + balanceOf(tenantId, ACC.BANK)) * 100) / 100).toBe(1117.66)
    expect(balanceOf(tenantId, ACC.CASH_OVER_SHORT)).toBe(10)
    const frac = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(applied[fraction].journalEntryId) as any
    expect(frac.total_debit).toBe(27.66)
    expect(frac.total_credit).toBe(27.66)
    // 1180 ของกะที่ซ่อมต้องหายไป เหลือเฉพาะกะงวดปิด (20) — กะยุคเก่าไม่เคยลงพัก
    // (±0.01 จากกะเศษ: บิลลงพักปัดรายใบ แต่กะปิดด้วยยอดรวม — เหมือน route ปิดกะจริง)
    expect(Math.abs(balanceOf(tenantId, ACC.POS_CLEARING) - 20)).toBeLessThanOrEqual(0.011)
    expect(clearingBefore).toBeGreaterThan(1000)

    // รันซ้ำ: ไม่เจอกะที่ซ่อมแล้ว และไม่มี journal เพิ่ม
    const after = closeJournals(tenantId).length
    expect(after).toBe(before + 2)
    const again = findStuckClosedShifts(tenantId).map(s => s.id)
    expect(again.sort()).toEqual([legacy, inClosedPeriod].sort())
    for (const s of findStuckClosedShifts(tenantId)) repairStuckShift(s, 'test')
    expect(closeJournals(tenantId).length).toBe(after)
    // เรียกตรงกับกะที่ลงแล้วก็ไม่ลงซ้ำ (กันแข่งกันรัน)
    const shiftRow = db.prepare('SELECT * FROM pos_shifts WHERE id = ?').get(stuck)
    expect(repairStuckShift(shiftRow, 'test').status).toBe('skip')
    expect(closeJournals(tenantId).length).toBe(after)
  })

  it('สคริปต์: dry-run ไม่เขียน → --apply สำรอง DB + ลง → รันซ้ำไม่เจออะไร', () => {
    const { tenantId } = createTestUser({ role: 'ADMIN' })
    tenants.push(tenantId)
    const stuck = seedClosedShift(tenantId, {
      number: 'SH-SCRIPT', closedAt: '2026-09-28T10:00:00.000Z', counted: 800,
      bills: [{ amount: 300, method: 'CASH' }, { amount: 200, method: 'TRANSFER' }],
    })

    const backend = path.resolve(__dirname, '../../..')
    const run = (...args: string[]) => {
      const r = spawnSync(path.join(backend, 'node_modules/.bin/ts-node-transpile-only'),
        ['scripts/repair-stuck-pos-shifts-2026-10-06.ts', '--tenant', tenantId, ...args],
        { cwd: backend, env: process.env, encoding: 'utf8' })
      return { code: r.status, out: `${r.stdout}${r.stderr}` }
    }

    const dry = run()
    expect(dry.code, dry.out).toBe(0)
    expect(dry.out).toContain('SH-SCRIPT')
    expect(dry.out).toContain('ลงได้ 1 กะ')
    expect(closeJournals(tenantId).length).toBe(0)

    const applied = run('--apply')
    expect(applied.code, applied.out).toBe(0)
    expect(applied.out).toContain('ลงบัญชีแล้ว 1 กะ')
    const backup = /สำรอง DB แล้ว: (.+\.bak)/.exec(applied.out)?.[1]
    expect(backup && fs.existsSync(backup)).toBe(true)
    fs.unlinkSync(backup!)
    const js = closeJournals(tenantId)
    expect(js).toHaveLength(1)
    expect(js[0].reference_id).toBe(stuck)
    expect(js[0].date).toBe('2026-09-28')
    expect(balanceOf(tenantId, ACC.POS_CLEARING)).toBe(0)

    const rerun = run('--apply')
    expect(rerun.code, rerun.out).toBe(0)
    expect(rerun.out).toContain('พบกะปิดแล้วแต่ไม่มี journal ปิดกะ 0 กะ')
    expect(rerun.out).not.toContain('สำรอง DB แล้ว')
    expect(closeJournals(tenantId)).toHaveLength(1)
  }, 180_000)
})
