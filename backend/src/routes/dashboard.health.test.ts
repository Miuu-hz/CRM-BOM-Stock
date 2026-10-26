import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { seedChartOfAccounts } from '../config/chartOfAccounts'
import { createTestUser } from '../test/testAuth'
import dashboardRouter, { gradeHigh, gradeLow, getDashboardHealth } from './dashboard.routes'
import { thaiToday, addDaysStr } from '../services/phopyBoard.service'

const app = express()
app.use(express.json())
app.use('/api/dashboard', dashboardRouter)

const tenants: string[] = []
const userIds: string[] = []

afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of [
      'journal_lines', 'journal_entries', 'pos_shifts', 'invoices', 'sales_orders',
      'purchase_invoices', 'approval_requests', 'stock_items', 'tax_periods',
      'customers', 'suppliers', 'accounts',
    ]) {
      db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t)
    }
  }
  for (const u of userIds.splice(0)) {
    db.prepare('DELETE FROM users WHERE id = ?').run(u)
  }
})

function makeUser(role: 'USER' | 'ADMIN' | 'MASTER', tenantId?: string) {
  const u = createTestUser({ role, tenantId })
  userIds.push(u.userId)
  if (!tenants.includes(u.tenantId)) tenants.push(u.tenantId)
  return u
}

describe('gradeHigh / gradeLow boundary values', () => {
  it('gradeHigh: 45/21 (runway), 0.90/0.75 (salesYesterday), 14/7 (forecast7)', () => {
    expect(gradeHigh(45, 45, 21)).toBe('G')
    expect(gradeHigh(44.99, 45, 21)).toBe('Y')
    expect(gradeHigh(21, 45, 21)).toBe('Y')
    expect(gradeHigh(20.99, 45, 21)).toBe('R')

    expect(gradeHigh(0.90, 0.90, 0.75)).toBe('G')
    expect(gradeHigh(0.899, 0.90, 0.75)).toBe('Y')
    expect(gradeHigh(0.75, 0.90, 0.75)).toBe('Y')
    expect(gradeHigh(0.749, 0.90, 0.75)).toBe('R')

    expect(gradeHigh(14, 14, 7)).toBe('G')
    expect(gradeHigh(13.9, 14, 7)).toBe('Y')
    expect(gradeHigh(7, 14, 7)).toBe('Y')
    expect(gradeHigh(6.9, 14, 7)).toBe('R')
  })

  it('gradeLow: 1.5/4 (cogs7) และ strict < 10% / ≤ 25% (arOverdue)', () => {
    expect(gradeLow(1.5, 1.5, 4)).toBe('G')
    expect(gradeLow(1.51, 1.5, 4)).toBe('Y')
    expect(gradeLow(4, 1.5, 4)).toBe('Y')
    expect(gradeLow(4.01, 1.5, 4)).toBe('R')

    // AR overdue: strict "< 10%" green
    expect(gradeLow(0.099, 0.10, 0.25, true)).toBe('G')
    expect(gradeLow(0.10, 0.10, 0.25, true)).toBe('Y')
    expect(gradeLow(0.25, 0.10, 0.25, true)).toBe('Y')
    expect(gradeLow(0.251, 0.10, 0.25, true)).toBe('R')
  })
})

describe('GET /api/dashboard/health', () => {
  it('basic USER (ไม่มีแผนก) ได้ financial: false และไม่มีตัวเลขเงิน', async () => {
    const basic = makeUser('USER')
    const today = thaiToday()
    const custId = generateId()
    const soId = generateId()
    db.prepare(`
      INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city)
      VALUES (?, ?, 'C1', 'ลูกค้าทดสอบ', 'COMPANY', '-', 'c@test.local', '0800000000', 'BKK')
    `).run(custId, basic.tenantId)
    db.prepare(`
      INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, order_date, status, subtotal, total_amount)
      VALUES (?, ?, 'SO-001', ?, ?, 'CONFIRMED', 3200, 3200)
    `).run(soId, basic.tenantId, custId, today)
    db.prepare(`
      INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, invoice_date, due_date, subtotal, total_amount, balance_amount, status, payment_status)
      VALUES (?, ?, 'INV-001', ?, ?, ?, ?, 3200, 3200, 3200, 'ISSUED', 'UNPAID')
    `).run(generateId(), basic.tenantId, soId, custId, today, today)

    const res = await request(app).get('/api/dashboard/health').set('Authorization', `Bearer ${basic.token}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      financial: false,
      overall: null,
      confidence: null,
      signals: [],
      chart: null,
      ops: {
        lowStock: 0,
        pendingDelivery: 1,
        pendingApprovals: 0,
        arDue7: { count: 1, amount: null },
      },
    })
  })

  it('tenant ที่ยังไม่มีข้อมูลบัญชี ได้สัญญาณ NA และไฟรวมไม่แดง', async () => {
    const admin = makeUser('ADMIN')
    const res = await request(app).get('/api/dashboard/health').set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    const d = res.body.data
    expect(d.financial).toBe(true)
    expect(d.dataSince).toBeNull()
    expect(d.dataDays).toBe(0)
    expect(d.signals.map((s: any) => s.id)).toEqual([
      'runway', 'salesYesterday', 'cogs7', 'forecast7', 'arOverdue', 'control',
    ])
    expect(d.signals.slice(0, 5).every((s: any) => s.status === 'NA')).toBe(true)
    expect(d.overall.status).not.toBe('R')
    expect(d.overall.headline.startsWith('แดง')).toBe(false)
  })

  it('ADMIN ได้สัญญาณทั้ง 6 ตามลำดับ พร้อมคำนวณไฟรวม แท่งเทียน และแถบงานครบถ้วน', async () => {
    const admin = makeUser('ADMIN')
    const t = admin.tenantId
    seedChartOfAccounts(t)
    const acc = (code: string) => (db.prepare('SELECT id FROM accounts WHERE tenant_id = ? AND code = ?').get(t, code) as { id: string }).id
    let seq = 0
    const post = (date: string, lines: Array<[string, number, number]>) => {
      const id = generateId()
      db.prepare(`
        INSERT INTO journal_entries (id, tenant_id, entry_number, date, description, is_posted, is_closing_entry, created_at)
        VALUES (?, ?, ?, ?, 'test', 1, 0, ?)
      `).run(id, t, `JV-H-${++seq}`, date, `${date}T08:00:00.000Z`)
      lines.forEach(([code, dr, cr], i) => {
        db.prepare(`
          INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, debit, credit)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(`${id}-${i}`, t, id, acc(code), i + 1, dr, cr)
      })
    }

    const today = thaiToday()
    const asOf = addDaysStr(today, -1)
    for (const k of [4, 3, 2, 1]) {
      const d = addDaysStr(asOf, -7 * k)
      post(d, [['1101', 10000, 0], ['4101', 0, 10000]])
      post(d, [['5101', 3500, 0], ['1101', 0, 3500]])
    }
    // ยอดขายเมื่อวาน = 9,500 (95% → G) และ COGS = 3,325 (35% → drift 0 → G)
    post(asOf, [['1101', 9500, 0], ['4101', 0, 9500]])
    post(asOf, [['5101', 3325, 0], ['1101', 0, 3325]])

    // ปิดงวดก่อนหน้าให้ผ่านกฎเดือนก่อน
    const [curY, curM] = today.slice(0, 7).split('-').map(Number)
    const prevY = curM === 1 ? curY - 1 : curY
    const prevM = curM === 1 ? 12 : curM - 1
    db.prepare(`
      INSERT INTO tax_periods (id, tenant_id, year, month, period_type, start_date, end_date, status)
      VALUES (?, ?, ?, ?, 'MONTHLY', '2026-09-01', '2026-09-30', 'CLOSED')
    `).run(generateId(), t, prevY, prevM)

    const res = await request(app).get('/api/dashboard/health').set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    const h = res.body.data
    expect(h.financial).toBe(true)
    expect(h.asOf).toBe(asOf)
    expect(h.today).toBe(today)
    expect(h.dataSince).toBe(addDaysStr(asOf, -28))
    expect(h.dataDays).toBe(29)
    expect(h.signals.map((s: any) => s.id)).toEqual([
      'runway', 'salesYesterday', 'cogs7', 'forecast7', 'arOverdue', 'control',
    ])

    const byId = Object.fromEntries(h.signals.map((s: any) => [s.id, s]))
    expect(byId.runway.status).toBe('G')
    expect(byId.salesYesterday.status).toBe('G')
    expect(byId.salesYesterday.compare).toContain('95% ของวัน')
    expect(byId.cogs7.status).toBe('G')
    expect(byId.forecast7.status).toBe('G')
    expect(byId.arOverdue.status).toBe('NA')
    expect(byId.control.status).toBe('G')
    expect(h.overall).toEqual({ status: 'G', headline: 'เขียว · ไปต่อได้', red: 0, yellow: 0, na: 1 })
    expect(h.chart?.grain).toBe('week')
    expect(h.chart?.ma).toEqual([4, 13])
    expect(h.chart?.periods.length).toBeGreaterThan(0)

    // ถ้ากะเมื่อวานมีเงินลิ้นชักต่างเกิน 500 บาท → สัญญาณ control เป็น R และไฟรวมเป็น "แดง · ต้องสั่งการ 1 เรื่อง"
    db.prepare(`
      INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, closed_at, opening_cash, closing_cash_counted, cash_difference)
      VALUES (?, ?, 'S-RED', 'CLOSED', ?, ?, 1000, 400, -600)
    `).run(generateId(), t, `${asOf}T01:00:00.000Z`, `${asOf}T10:00:00.000Z`)

    const resRed = await request(app).get('/api/dashboard/health').set('Authorization', `Bearer ${admin.token}`)
    expect(resRed.body.data.overall).toEqual({
      status: 'R',
      headline: 'แดง · ต้องสั่งการ 1 เรื่อง',
      red: 1,
      yellow: 0,
      na: 1,
    })
  })
})
