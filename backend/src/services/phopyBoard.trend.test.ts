import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { seedChartOfAccounts } from '../config/chartOfAccounts'
import { createTestUser } from '../test/testAuth'
import boardRouter from '../routes/phopy-board.routes'
import {
  weekKey, monthKey, quarterKey, buildCandles, dailySeries, cashOutflow, trendSeries,
} from './phopyBoard.service'

const app = express()
app.use(express.json())
app.use('/api/phopy-board', boardRouter)

const tenants: string[] = []
const userIds: string[] = []

afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_lines', 'journal_entries', 'budgets', 'invoices', 'customers', 'bank_accounts', 'accounts']) {
      db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t)
    }
  }
  for (const u of userIds.splice(0)) {
    db.prepare('DELETE FROM users WHERE id = ?').run(u)
  }
})

function setupTenant() {
  const user = createTestUser({ role: 'ADMIN' })
  userIds.push(user.userId)
  const t = user.tenantId
  tenants.push(t)
  seedChartOfAccounts(t)
  const acc = (code: string) => (db.prepare('SELECT id FROM accounts WHERE tenant_id = ? AND code = ?').get(t, code) as { id: string }).id
  let seq = 0
  const postJe = (
    date: string,
    lines: Array<[string, number, number]>,
    opts: { createdAt?: string; posted?: number; closing?: number; ref?: string } = {},
  ) => {
    const id = generateId()
    const num = ++seq
    const createdAt = opts.createdAt ?? `${date}T0${Math.min(9, num)}:00:00.000Z`
    db.prepare(`
      INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, description, is_posted, is_closing_entry, created_at)
      VALUES (?, ?, ?, ?, ?, 'test', ?, ?, ?)
    `).run(id, t, `JV-TR-${num}`, date, opts.ref ?? 'MANUAL', opts.posted ?? 1, opts.closing ?? 0, createdAt)
    lines.forEach(([code, dr, cr], i) => {
      db.prepare(`
        INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, debit, credit)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(`${id}-L${i + 1}`, t, id, acc(code), i + 1, dr, cr)
    })
    return id
  }
  return { user, t, acc, postJe }
}

describe('buildCandles & key helpers (pure)', () => {
  it('weekKey คืนวันจันทร์ของสัปดาห์ ISO รวมวันอาทิตย์ด้วย', () => {
    expect(weekKey('2026-10-19')).toBe('2026-10-19') // จันทร์
    expect(weekKey('2026-10-24')).toBe('2026-10-19') // เสาร์
    expect(weekKey('2026-10-25')).toBe('2026-10-19') // อาทิตย์ → จันทร์เดียวกัน
    expect(weekKey('2026-10-26')).toBe('2026-10-26') // จันทร์ถัดไป
    expect(monthKey('2026-10-25')).toBe('2026-10')
    expect(quarterKey('2026-10-25')).toBe('2026-Q4')
  })

  it('งวดแรก O = C ตัวเอง, งวดถัดไป O = C งวดก่อน, H/L คลุม O และ C, คิดเฉลี่ยต่อวัน และติด partial เมื่อสัปดาห์ไม่ครบ 7 วัน', () => {
    const days = [
      // สัปดาห์ที่ 1 (ครบ 7 วัน: 2026-10-12 ถึง 2026-10-18) — รายรับรวม 7,000 (เฉลี่ย 1,000/วัน)
      { date: '2026-10-12', rev: 1000, exp: 400, cashOpen: 0, cashClose: 600, cashHi: 1000, cashLo: 0 },
      { date: '2026-10-13', rev: 1200, exp: 500, cashOpen: 600, cashClose: 1300, cashHi: 1800, cashLo: 500 },
      { date: '2026-10-14', rev: 800, exp: 300, cashOpen: 1300, cashClose: 1800, cashHi: 2100, cashLo: 1200 },
      { date: '2026-10-15', rev: 1000, exp: 400, cashOpen: 1800, cashClose: 2400, cashHi: 2800, cashLo: 1800 },
      { date: '2026-10-16', rev: 900, exp: 350, cashOpen: 2400, cashClose: 2950, cashHi: 3300, cashLo: 2400 },
      { date: '2026-10-17', rev: 1100, exp: 450, cashOpen: 2950, cashClose: 3600, cashHi: 4050, cashLo: 2950 },
      { date: '2026-10-18', rev: 1000, exp: 400, cashOpen: 3600, cashClose: 4200, cashHi: 4600, cashLo: 3600 },
      // สัปดาห์ที่ 2 (แค่ 2 วัน → partial = true): รายรับวันที่สูงสุดแค่ 600 แต่ O มาจากสัปดาห์ก่อน = 1,000 → H ต้องคลุม O = 1,000
      // รายจ่ายทุกวันสูงกว่า O (O = 400, วันละ 900 และ 1,100) → L ต้องคลุม O = 400
      { date: '2026-10-19', rev: 400, exp: 900, cashOpen: 4200, cashClose: 3700, cashHi: 4200, cashLo: 3500 },
      { date: '2026-10-20', rev: 600, exp: 1100, cashOpen: 3700, cashClose: 3200, cashHi: 3800, cashLo: 3000 },
    ]

    const candles = buildCandles(days, weekKey)
    expect(candles).toHaveLength(2)

    const w1 = candles[0]
    expect(w1.key).toBe('2026-10-12')
    expect(w1.from).toBe('2026-10-12')
    expect(w1.to).toBe('2026-10-18')
    expect(w1.days).toBe(7)
    expect(w1.partial).toBe(false)
    expect(w1.rev).toEqual({ o: 1000, c: 1000, h: 1200, l: 800, tot: 7000 })
    expect(w1.exp).toEqual({ o: 400, c: 400, h: 500, l: 300, tot: 2800 })
    expect(w1.cash).toEqual({ c: 4200, hi: 4600, lo: 0 })

    const w2 = candles[1]
    expect(w2.key).toBe('2026-10-19')
    expect(w2.days).toBe(2)
    expect(w2.partial).toBe(true)
    // rev: O = 1000 (จาก w1.c), C = 500, max day = 600 → H = max(1000, 500, 600) = 1000, L = min(1000, 500, 400) = 400
    expect(w2.rev).toEqual({ o: 1000, c: 500, h: 1000, l: 400, tot: 1000 })
    // exp: O = 400 (จาก w1.c), C = 1000, min day = 900 → L = min(400, 1000, 900) = 400, H = max(400, 1000, 1100) = 1100
    expect(w2.exp).toEqual({ o: 400, c: 1000, h: 1100, l: 400, tot: 2000 })
    expect(w2.cash).toEqual({ c: 3200, hi: 4200, lo: 3000 })
  })
})

describe('dailySeries, cashOutflow & trendSeries (DB)', () => {
  it('dailySeries ไล่เงินคงเหลือระหว่างวัน (+1000, -1500, +800 → lo เห็นหลุม -500) และวันไม่มีรายการคงค่าเดิม', () => {
    const { t, postJe } = setupTenant()
    // วันเดียว 3 รายการตามลำดับ created_at: +1000, -1500, +800
    postJe('2026-10-10', [['1101', 1000, 0], ['4101', 0, 1000]], { createdAt: '2026-10-10T02:00:00.000Z' })
    postJe('2026-10-10', [['5403', 1500, 0], ['1101', 0, 1500]], { createdAt: '2026-10-10T05:00:00.000Z' })
    postJe('2026-10-10', [['1180', 800, 0], ['4101', 0, 800]], { createdAt: '2026-10-10T08:00:00.000Z' })

    const series = dailySeries(t, '2026-10-09', '2026-10-11')
    // วันก่อน dataSince (2026-10-09) ไม่ถูกนับ
    expect(series).toHaveLength(2)
    expect(series[0]).toEqual({
      date: '2026-10-10',
      rev: 1800,
      exp: 1500,
      cashOpen: 0,
      cashClose: 300,
      cashHi: 1000,
      cashLo: -500,
    })
    // วันถัดไปไม่มีรายการเคลื่อนไหว: open = close = hi = lo = 300
    expect(series[1]).toEqual({
      date: '2026-10-11',
      rev: 0,
      exp: 0,
      cashOpen: 300,
      cashClose: 300,
      cashHi: 300,
      cashLo: 300,
    })
  })

  it('โอนภายในชุดเงินสด (1180 → เงินสด/ธนาคาร ตอนปิดกะ) สุทธิเป็น 0 ไม่นับเป็นเงินออก', () => {
    const { t, postJe } = setupTenant()
    // ขาย POS เข้า 1180 = +2,000
    postJe('2026-10-15', [['1180', 2000, 0], ['4101', 0, 2000]], { ref: 'POS_SALE' })
    // ปิดกะโอน 1180 → 1101 = 2,000 (โอนภายในชุดเงินสด ห้ามนับเป็นเงินออก)
    postJe('2026-10-15', [['1101', 2000, 0], ['1180', 0, 2000]], { ref: 'POS_SHIFT_CLOSE' })
    // จ่ายค่าใช้จ่ายจริงออกจาก 1101 = -600
    postJe('2026-10-16', [['5403', 600, 0], ['1101', 0, 600]], { ref: 'EXPENSE' })

    const out = cashOutflow(t, '2026-10-15', '2026-10-16')
    expect(out.total).toBe(600)
    expect(out.days).toBe(2)
    expect(out.avgPerDay).toBe(300)
    expect(out.byDay['2026-10-15']).toBeUndefined()
    expect(out.byDay['2026-10-16']).toBe(600)
  })

  it('warmup ที่คืน = จำนวนงวดก่อนช่วงที่ขอที่มีข้อมูลจริง (ข้อมูลเริ่มทีหลัง = 0) — หน้าเว็บใช้เป็น visibleFrom', () => {
    const { t, postJe } = setupTenant()
    postJe('2026-10-12', [['1101', 500, 0], ['4101', 0, 500]])
    const r = trendSeries(t, 'month', '2025-11-01', '2026-10-26')
    expect(r.periods.map(p => p.key)).toEqual(['2026-10'])
    expect(r.warmup).toBe(0)
    const r2 = trendSeries(t, 'week', '2026-10-19', '2026-10-26', 12)
    expect(r2.periods[0].key).toBe('2026-10-12')
    expect(r2.warmup).toBe(1)
  })

  it('วันในอนาคตไม่ถูกนับ: ส่ง to เป็นสิ้นเดือนหน้า งวดสุดท้ายจบที่วันนี้ และเงินออกเฉลี่ยหารเฉพาะวันที่ผ่านมา', () => {
    const { t, postJe } = setupTenant()
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)
    postJe(today, [['4101', 0, 700], ['1101', 700, 0]])
    postJe(today, [['5303', 70, 0], ['1101', 0, 70]])
    const far = `${Number(today.slice(0, 4)) + 1}-12-31`
    const r = trendSeries(t, 'month', undefined, far)
    expect(r.periods[r.periods.length - 1].to).toBe(today)
    expect(r.periods[r.periods.length - 1].rev.c).toBe(700)
    const o = cashOutflow(t, today, far)
    expect(o.days).toBe(1)
    expect(o.avgPerDay).toBe(70)
  })

  it('trendSeries("year") เมื่อข้อมูลไม่ถึง 3 ปี จะลดเป็น quarter พร้อม note และ requestedGrain = "year"', () => {
    const { t, postJe } = setupTenant()
    postJe('2026-04-28', [['1101', 5000, 0], ['4101', 0, 5000]])
    postJe('2026-10-20', [['5403', 1200, 0], ['1101', 0, 1200]])

    const res = trendSeries(t, 'year', undefined, '2026-10-25')
    expect(res.grain).toBe('quarter')
    expect(res.requestedGrain).toBe('year')
    expect(res.note).toBe('ข้อมูลยังไม่ถึง 3 ปี แสดงเป็นรายไตรมาส')
    expect(res.ma).toEqual([2, 4])
    expect(res.dataSince).toBe('2026-04-28')
    expect(res.periods.map(p => p.key)).toEqual(['2026-Q2', '2026-Q3', '2026-Q4'])
  })

  it('GET /phopy-board/trend และ /cfo-summary ตรวจพารามิเตอร์และคืนผลตามกฎ', async () => {
    const { user, t, postJe } = setupTenant()
    postJe('2026-10-01', [['1101', 100000, 0], ['4101', 0, 100000]])
    postJe('2026-10-05', [['5101', 40000, 0], ['1101', 0, 40000]])
    postJe('2026-10-10', [['5403', 70000, 0], ['1101', 0, 70000]]) // ขาดทุนสุทธิ -10,000

    const badGrain = await request(app).get('/api/phopy-board/trend?grain=decade').set('Authorization', `Bearer ${user.token}`)
    expect(badGrain.status).toBe(400)
    expect(badGrain.body.message).toContain('grain')

    const trendRes = await request(app).get('/api/phopy-board/trend?grain=year&to=2026-10-25').set('Authorization', `Bearer ${user.token}`)
    expect(trendRes.status).toBe(200)
    expect(trendRes.body.data.grain).toBe('quarter')
    expect(trendRes.body.data.requestedGrain).toBe('year')
    expect(trendRes.body.data.note).toBe('ข้อมูลยังไม่ถึง 3 ปี แสดงเป็นรายไตรมาส')

    const cfoRes = await request(app)
      .get('/api/phopy-board/cfo-summary?startDate=2026-10-01&endDate=2026-10-25&compare=yoy')
      .set('Authorization', `Bearer ${user.token}`)
    expect(cfoRes.status).toBe(200)
    const cfo = cfoRes.body.data
    expect(cfo.compare.hasData).toBe(false)
    expect(cfo.kpis.find((k: any) => k.key === 'revenue')).toMatchObject({ value: 100000, prev: null, deltaPct: null })
    expect(cfo.kpis.find((k: any) => k.key === 'netProfit')).toMatchObject({ value: -10000, prev: null, deltaPct: null })
    expect(cfo.cautions.some((c: any) => c.text.includes('ขาดทุนสุทธิ') && c.from.includes('· บท 3'))).toBe(true)
    expect(cfo.cautions.some((c: any) => c.text.includes('การเทียบยังไม่สมบูรณ์') && c.from.includes('· บท'))).toBe(true)
    expect(cfo.decisions.some((d: any) => d.text.includes('ตั้งงบประมาณปี 2027') && d.from.includes('· บท 7'))).toBe(true)
  })
})
