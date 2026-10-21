import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import reportsRouter, { buildProfitLoss } from './reports.routes'
import { seedChartOfAccounts } from '../config/chartOfAccounts'

const app = express()
app.use(express.json())
app.use('/api/reports', reportsRouter)

const createdTenants: string[] = []

afterEach(() => {
  for (const t of createdTenants.splice(0)) {
    try {
      db.prepare('DELETE FROM journal_lines WHERE tenant_id = ?').run(t)
      db.prepare('DELETE FROM journal_entries WHERE tenant_id = ?').run(t)
      db.prepare('DELETE FROM accounts WHERE tenant_id = ?').run(t)
      db.prepare('DELETE FROM users WHERE tenant_id = ?').run(t)
    } catch {
      // ignore
    }
  }
})

function getAccountId(tenantId: string, code: string): string {
  const row = db.prepare('SELECT id FROM accounts WHERE tenant_id = ? AND code = ?').get(tenantId, code) as { id: string }
  if (!row) throw new Error(`Account code ${code} not found for tenant ${tenantId}`)
  return row.id
}

function insertJournalEntry(params: {
  tenantId: string
  date: string
  isPosted: number
  isClosingEntry: number
  description: string
  referenceType?: string
  lines: Array<{ accountId: string; debit: number; credit: number; description?: string }>
}) {
  const entryId = generateId()
  const entryNumber = 'JE-' + entryId.slice(0, 8)
  const totalDebit = params.lines.reduce((s, l) => s + l.debit, 0)
  const totalCredit = params.lines.reduce((s, l) => s + l.credit, 0)
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO journal_entries (
      id, tenant_id, entry_number, date, description, reference_type,
      total_debit, total_credit, is_auto_generated, is_posted, is_closing_entry,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
  `).run(
    entryId,
    params.tenantId,
    entryNumber,
    params.date,
    params.description,
    params.referenceType || null,
    totalDebit,
    totalCredit,
    params.isPosted,
    params.isClosingEntry,
    now,
    now
  )

  let lineNo = 1
  for (const line of params.lines) {
    db.prepare(`
      INSERT INTO journal_lines (
        id, tenant_id, journal_entry_id, account_id, line_number,
        description, debit, credit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      generateId(),
      params.tenantId,
      entryId,
      line.accountId,
      lineNo++,
      line.description || params.description,
      line.debit,
      line.credit
    )
  }

  return entryId
}

describe('Profit & Loss Report (งบกำไรขาดทุน)', () => {
  it('คำนวณกำไรสุทธิ = รายได้ − ค่าใช้จ่าย ถูกต้องตามขั้นบันได และไม่รวม closing entry / unposted', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const tenantId = user.tenantId
    createdTenants.push(tenantId)

    seedChartOfAccounts(tenantId)

    const revenueAccId = getAccountId(tenantId, '4101') // รายได้ขายสินค้า (REVENUE)
    const cogsAccId = getAccountId(tenantId, '5101')    // ต้นทุนสินค้าขาย (EXPENSE / COGS)
    const salaryAccId = getAccountId(tenantId, '5301')  // เงินเดือน (EXPENSE / SALARY)
    const cashAccId = getAccountId(tenantId, '1101')    // เงินสด (ASSET)
    const retainedAccId = getAccountId(tenantId, '3103')// กำไรสะสม (EQUITY)

    // 1. รายการขาย (Posted): รายได้ 10,000
    insertJournalEntry({
      tenantId,
      date: '2026-10-05',
      isPosted: 1,
      isClosingEntry: 0,
      description: 'ขายสินค้าหน้าร้าน',
      lines: [
        { accountId: cashAccId, debit: 10000, credit: 0 },
        { accountId: revenueAccId, debit: 0, credit: 10000 },
      ],
    })

    // 2. รายการตัดต้นทุนขาย (Posted): COGS 4,000
    insertJournalEntry({
      tenantId,
      date: '2026-10-06',
      isPosted: 1,
      isClosingEntry: 0,
      description: 'ต้นทุนสินค้าที่ขาย',
      lines: [
        { accountId: cogsAccId, debit: 4000, credit: 0 },
        { accountId: cashAccId, debit: 0, credit: 4000 },
      ],
    })

    // 3. ค่าใช้จ่ายดำเนินงาน (Posted): เงินเดือน 2,500
    insertJournalEntry({
      tenantId,
      date: '2026-10-10',
      isPosted: 1,
      isClosingEntry: 0,
      description: 'จ่ายเงินเดือนพนักงาน',
      lines: [
        { accountId: salaryAccId, debit: 2500, credit: 0 },
        { accountId: cashAccId, debit: 0, credit: 2500 },
      ],
    })

    // 4. รายการปิดบัญชีสิ้นงวด (Closing Entry, is_closing_entry = 1)
    // ถ้านับรายการนี้ ยอดรายได้และค่าใช้จ่ายจะกลายเป็น 0 ทั้งหมด!
    insertJournalEntry({
      tenantId,
      date: '2026-10-31',
      isPosted: 1,
      isClosingEntry: 1,
      description: 'ปิดบัญชีสิ้นงวด',
      lines: [
        { accountId: revenueAccId, debit: 10000, credit: 0 },
        { accountId: cogsAccId, debit: 0, credit: 4000 },
        { accountId: salaryAccId, debit: 0, credit: 2500 },
        { accountId: retainedAccId, debit: 0, credit: 3500 },
      ],
    })

    // 5. รายการดราฟต์ที่ยังไม่โพสต์ (is_posted = 0) ต้องไม่ถูกนำมาคิด
    insertJournalEntry({
      tenantId,
      date: '2026-10-20',
      isPosted: 0,
      isClosingEntry: 0,
      description: 'รายการดราฟต์ขาย',
      lines: [
        { accountId: cashAccId, debit: 50000, credit: 0 },
        { accountId: revenueAccId, debit: 0, credit: 50000 },
      ],
    })

    // ทดสอบฟังก์ชัน buildProfitLoss โดยตรง
    const pl = buildProfitLoss(tenantId, '2026-10-01', '2026-10-31')

    // รายได้ต้องเป็น 10,000 (ไม่ถูกหักล้างด้วย closing entry และไม่รวม unposted)
    expect(pl.revenue.total).toBe(10000)
    // ต้นทุนขายต้องเป็น 4,000
    expect(pl.cogs.total).toBe(4000)
    // กำไรขั้นต้น = รายได้ − ต้นทุนขาย = 10,000 − 4,000 = 6,000
    expect(pl.grossProfit).toBe(6000)
    expect(pl.grossMarginPct).toBe(60)

    // ค่าใช้จ่ายดำเนินงาน = 2,500
    expect(pl.operatingExpenses.total).toBe(2500)
    // กำไรดำเนินงาน = 6,000 − 2,500 = 3,500
    expect(pl.operatingProfit).toBe(3500)

    // กำไรสุทธิ = รายได้ (10,000) − ค่าใช้จ่ายทั้งหมด (6,500) = 3,500
    expect(pl.netProfit).toBe(3500)
    expect(pl.netMarginPct).toBe(35)
    expect(pl.netProfit).toBe(pl.revenue.total - (pl.cogs.total + pl.operatingExpenses.total))

    // ทดสอบผ่าน HTTP Route GET /api/reports/profit-loss
    const res = await request(app)
      .get('/api/reports/profit-loss')
      .query({ startDate: '2026-10-01', endDate: '2026-10-31' })
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.revenue.total).toBe(10000)
    expect(res.body.data.cogs.total).toBe(4000)
    expect(res.body.data.grossProfit).toBe(6000)
    expect(res.body.data.operatingExpenses.total).toBe(2500)
    expect(res.body.data.netProfit).toBe(3500)
    expect(res.body.data.previousPeriod).toBeDefined()
    expect(res.body.data.comparison).toBeDefined()
  })

  it('คืนค่าผลต่างเปรียบเทียบกับงวดก่อนหน้าที่มีความยาวเท่ากัน', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const tenantId = user.tenantId
    createdTenants.push(tenantId)

    seedChartOfAccounts(tenantId)

    const revenueAccId = getAccountId(tenantId, '4101')
    const cogsAccId = getAccountId(tenantId, '5101')
    const cashAccId = getAccountId(tenantId, '1101')

    // งวดก่อนหน้า: 2026-09-01 ถึง 2026-09-30 (รายได้ 8,000, COGS 3,000, Net 5,000)
    insertJournalEntry({
      tenantId,
      date: '2026-09-15',
      isPosted: 1,
      isClosingEntry: 0,
      description: 'ขายงวดก่อน',
      lines: [
        { accountId: cashAccId, debit: 8000, credit: 0 },
        { accountId: revenueAccId, debit: 0, credit: 8000 },
      ],
    })
    insertJournalEntry({
      tenantId,
      date: '2026-09-16',
      isPosted: 1,
      isClosingEntry: 0,
      description: 'COGS งวดก่อน',
      lines: [
        { accountId: cogsAccId, debit: 3000, credit: 0 },
        { accountId: cashAccId, debit: 0, credit: 3000 },
      ],
    })

    // งวดปัจจุบัน: 2026-10-01 ถึง 2026-10-30 (รายได้ 12,000, COGS 5,000, Net 7,000)
    insertJournalEntry({
      tenantId,
      date: '2026-10-15',
      isPosted: 1,
      isClosingEntry: 0,
      description: 'ขายงวดนี้',
      lines: [
        { accountId: cashAccId, debit: 12000, credit: 0 },
        { accountId: revenueAccId, debit: 0, credit: 12000 },
      ],
    })
    insertJournalEntry({
      tenantId,
      date: '2026-10-16',
      isPosted: 1,
      isClosingEntry: 0,
      description: 'COGS งวดนี้',
      lines: [
        { accountId: cogsAccId, debit: 5000, credit: 0 },
        { accountId: cashAccId, debit: 0, credit: 5000 },
      ],
    })

    const res = await request(app)
      .get('/api/reports/profit-loss')
      .query({ startDate: '2026-10-01', endDate: '2026-10-30' })
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.revenue.total).toBe(12000)
    expect(data.previousPeriod.revenue.total).toBe(8000)
    expect(data.comparison.revenueChange).toBe(4000) // 12,000 - 8,000
    expect(data.comparison.revenueChangePct).toBe(50) // +50%
    expect(data.comparison.netProfitChange).toBe(2000) // 7,000 - 5,000
  })

  it('งบดุล (balance-sheet): สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ (รวมกำไรสะสมที่ยังไม่ปิดบัญชี)', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const tenantId = user.tenantId
    createdTenants.push(tenantId)

    seedChartOfAccounts(tenantId)

    const cashAccId = getAccountId(tenantId, '1101')    // ASSET
    const capitalAccId = getAccountId(tenantId, '3101') // EQUITY
    const apAccId = getAccountId(tenantId, '2101')      // LIABILITY
    const revenueAccId = getAccountId(tenantId, '4101') // REVENUE
    const expenseAccId = getAccountId(tenantId, '5301') // EXPENSE

    // 1. ลงทุนเริ่มต้น: Dr Cash 50,000, Cr Capital 50,000
    insertJournalEntry({
      tenantId,
      date: '2026-10-01',
      isPosted: 1,
      isClosingEntry: 0,
      description: 'ลงทุนเริ่มต้น',
      lines: [
        { accountId: cashAccId, debit: 50000, credit: 0 },
        { accountId: capitalAccId, debit: 0, credit: 50000 },
      ],
    })

    // 2. มีเจ้าหนี้: Dr Expense 10,000, Cr AP 10,000
    insertJournalEntry({
      tenantId,
      date: '2026-10-02',
      isPosted: 1,
      isClosingEntry: 0,
      description: 'ตั้งเจ้าหนี้ค่าบริการ',
      lines: [
        { accountId: expenseAccId, debit: 10000, credit: 0 },
        { accountId: apAccId, debit: 0, credit: 10000 },
      ],
    })

    // 3. รับรายได้เงินสด: Dr Cash 25,000, Cr Revenue 25,000
    insertJournalEntry({
      tenantId,
      date: '2026-10-03',
      isPosted: 1,
      isClosingEntry: 0,
      description: 'รับเงินค่าขาย',
      lines: [
        { accountId: cashAccId, debit: 25000, credit: 0 },
        { accountId: revenueAccId, debit: 0, credit: 25000 },
      ],
    })

    // ณ จุดนี้:
    // สินทรัพย์: Cash = 50,000 + 25,000 = 75,000
    // หนี้สิน: AP = 10,000
    // ทุนเดิม: Capital = 50,000
    // กำไรสะสมที่ยังไม่ปิดบัญชี: Revenue (25,000) − Expense (10,000) = 15,000
    // รวมส่วนของเจ้าของ: 50,000 + 15,000 = 65,000
    // หนี้สิน + ส่วนของเจ้าของ = 10,000 + 65,000 = 75,000 == สินทรัพย์ (75,000)
    const res = await request(app)
      .get('/api/reports/balance-sheet')
      .query({ asOfDate: '2026-10-31' })
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.assets.total).toBe(75000)
    expect(data.liabilities.total).toBe(10000)
    expect(data.equity.unclosedProfit).toBe(15000)
    expect(data.equity.total).toBe(65000)
    expect(data.totalLiabilitiesAndEquity).toBe(75000)
    expect(data.balanced).toBe(true)
    expect(data.difference).toBe(0)
  })

  it('งบกระแสเงินสด (cash-flow): เงินสดต้นงวด + ดำเนินงาน + ลงทุน + จัดหาเงิน = เงินสดปลายงวด กระทบกันได้ 100%', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const tenantId = user.tenantId
    createdTenants.push(tenantId)

    seedChartOfAccounts(tenantId)

    const cashAccId = getAccountId(tenantId, '1101')
    const capitalAccId = getAccountId(tenantId, '3101')
    const equipmentAccId = getAccountId(tenantId, '1204')
    const revenueAccId = getAccountId(tenantId, '4101')

    // 1. เงินสดต้นงวด (ก่อน 2026-10-01): ทุนเริ่มต้น 100,000
    insertJournalEntry({
      tenantId,
      date: '2026-09-01',
      isPosted: 1,
      isClosingEntry: 0,
      referenceType: 'EQUITY',
      description: 'ทุนเปิดบริษัท',
      lines: [
        { accountId: cashAccId, debit: 100000, credit: 0 },
        { accountId: capitalAccId, debit: 0, credit: 100000 },
      ],
    })

    // 2. ดำเนินงาน (ตุลาคม): รับเงินสดขาย POS 30,000
    insertJournalEntry({
      tenantId,
      date: '2026-10-05',
      isPosted: 1,
      isClosingEntry: 0,
      referenceType: 'POS_SALE',
      description: 'ขายหน้าร้าน POS',
      lines: [
        { accountId: cashAccId, debit: 30000, credit: 0 },
        { accountId: revenueAccId, debit: 0, credit: 30000 },
      ],
    })

    // 3. ลงทุน (ตุลาคม): ซื้ออุปกรณ์เครื่องจักร 20,000
    insertJournalEntry({
      tenantId,
      date: '2026-10-10',
      isPosted: 1,
      isClosingEntry: 0,
      referenceType: 'ASSET_PURCHASE',
      description: 'ซื้อเครื่องจักร',
      lines: [
        { accountId: equipmentAccId, debit: 20000, credit: 0 },
        { accountId: cashAccId, debit: 0, credit: 20000 },
      ],
    })

    const res = await request(app)
      .get('/api/reports/cash-flow')
      .query({ startDate: '2026-10-01', endDate: '2026-10-31' })
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.openingBalance).toBe(100000)
    expect(data.operating.total).toBe(30000)
    expect(data.investing.total).toBe(-20000)
    expect(data.financing.total).toBe(0)
    expect(data.netChange).toBe(10000)
    expect(data.closingBalance).toBe(110000)
    // กระทบยอด: opening + operating + investing + financing == closing
    expect(data.openingBalance + data.operating.total + data.investing.total + data.financing.total).toBe(data.closingBalance)
  })
})
