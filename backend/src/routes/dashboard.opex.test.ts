import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { getOpexSummary } from './dashboard.routes'

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_lines', 'journal_entries', 'accounts']) {
      db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t)
    }
  }
})

function setup() {
  const t = 'test_opex_' + generateId()
  tenants.push(t)
  const acc = (code: string, type: string, category: string, normal = 'DEBIT') => {
    const id = generateId()
    db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, level, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, 2, 1)`).run(id, t, code, 'acc ' + code, type, category, normal)
    return id
  }
  const cash = acc('1101', 'ASSET', 'CURRENT_ASSET')
  let n = 0
  // ลงบัญชี Dr expense / Cr เงินสด (หรือ Dr เงินสด / Cr รายได้ ถ้า amount เป็นรายได้)
  const post = (date: string, accountId: string, amount: number, opts: { revenue?: boolean; posted?: number; closing?: number } = {}) => {
    const je = generateId()
    db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, description, is_posted, is_closing_entry)
                VALUES (?, ?, ?, ?, 'test', ?, ?)`).run(je, t, 'JV-' + (++n), date, opts.posted ?? 1, opts.closing ?? 0)
    const line = db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, ?, ?, ?)`)
    if (opts.revenue) {
      line.run(generateId(), t, je, cash, amount, 0)
      line.run(generateId(), t, je, accountId, 0, amount)
    } else {
      line.run(generateId(), t, je, accountId, amount, 0)
      line.run(generateId(), t, je, cash, 0, amount)
    }
  }
  return { t, acc, post }
}

// วันที่อ้างอิง = 21 ต.ค. 2026 (เวลาไทย) → หน้าต่าง 3 เดือน = ส.ค.–ต.ค.
const NOW = new Date(2026, 9, 21, 12, 0, 0)

describe('getOpexSummary — รายจ่ายประจำบนแดชบอร์ด', () => {
  it('นับเฉพาะ EXPENSE ที่ไม่ใช่ COGS, posted, ไม่รวมปิดงวด และคิดกำไรหลังหักรายจ่าย', () => {
    const { t, acc, post } = setup()
    const sales = acc('4101', 'REVENUE', 'SALES', 'CREDIT')
    const cogs = acc('5101', 'EXPENSE', 'COGS')
    const rent = acc('5302', 'EXPENSE', 'RENT')
    const salary = acc('5301', 'EXPENSE', 'SALARY')
    const repair = acc('5307', 'EXPENSE', 'MAINTENANCE')

    post('2026-10-05', sales, 10000, { revenue: true })
    post('2026-10-05', cogs, 4000)
    post('2026-10-01', rent, 3000)
    post('2026-10-15', salary, 2000)
    post('2026-10-16', salary, 500, { posted: 0 })    // ร่าง — ห้ามนับ
    post('2026-10-31', salary, 9999, { closing: 1 })  // ปิดงวด — ห้ามนับ
    post('2026-10-22', salary, 7777)                  // อนาคต (หลังวันนี้) — ห้ามนับ
    post('2026-10-10', repair, 400)
    post('2026-09-01', rent, 3000)
    post('2026-09-15', salary, 1800)
    post('2026-08-01', rent, 3000)

    const s = getOpexSummary(t, NOW)
    expect(s.month).toBe('2026-10')
    expect(s.prevMonth).toBe('2026-09')
    expect(s.hasEnoughHistory).toBe(true)
    expect(s.current.total).toBe(5400)
    expect(s.previous.total).toBe(4800)
    expect(s.current.revenue).toBe(10000)
    expect(s.current.cogs).toBe(4000)
    expect(s.current.netProfit).toBe(10000 - 4000 - 5400)

    const byCode = Object.fromEntries(s.accounts.map(a => [a.code, a]))
    expect(byCode['5101'], 'COGS ไม่ใช่รายจ่ายประจำ').toBeUndefined()
    expect(byCode['5302'].isRecurring).toBe(true)   // 3/3 เดือน
    expect(byCode['5301'].isRecurring).toBe(true)   // 2/3 เดือน
    expect(byCode['5307'].isRecurring).toBe(false)  // ครั้งเดียว
    expect(s.accounts.map(a => a.code)).toEqual(['5302', '5301', '5307']) // เรียงจากมากไปน้อย
    expect(s.current.recurring).toBe(5000)

    // เฉลี่ยจากเดือนที่จบแล้ว (ส.ค. 3000, ก.ย. 4800) ของบัญชีประจำ
    expect(s.monthlyRecurringAvg).toBe((3000 + 4800) / 2)
  })

  it('มีข้อมูลเดือนเดียว → isRecurring = null ทุกบัญชี และใช้ยอดเดือนนี้เป็นค่าประมาณ', () => {
    const { t, acc, post } = setup()
    const rent = acc('5302', 'EXPENSE', 'RENT')
    const fee = acc('5309', 'EXPENSE', 'FEES')
    post('2026-10-01', rent, 3000)
    post('2026-10-02', fee, 120)

    const s = getOpexSummary(t, NOW)
    expect(s.hasEnoughHistory).toBe(false)
    expect(s.accounts.every(a => a.isRecurring === null)).toBe(true)
    expect(s.current.total).toBe(3120)
    expect(s.monthlyRecurringAvg).toBe(3120)
  })

  it('เกิน 8 บัญชี → ตัดเป็น top 8 + ก้อน "อื่นๆ" โดยยอดรวมไม่หาย', () => {
    const { t, acc, post } = setup()
    for (let i = 1; i <= 10; i++) post('2026-10-03', acc(String(5310 + i), 'EXPENSE', 'OTHER'), i * 100)

    const s = getOpexSummary(t, NOW)
    expect(s.accounts).toHaveLength(8)
    expect(s.accounts[0].current).toBe(1000)
    expect(s.others).toEqual({ count: 2, current: 300, previous: 0 })
    expect(s.accounts.reduce((x, a) => x + a.current, 0) + s.others.current).toBe(s.current.total)
  })
})
