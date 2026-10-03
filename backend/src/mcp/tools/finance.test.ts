import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { registerFinanceTools } from './finance'
import { arAging } from '../../routes/receivables.routes'
import { buildTrialBalance } from '../../routes/reports.routes'
import type { IMcpServer } from '../sdk-compat'

function fakeServer() {
  const tools: Record<string, (args: any) => Promise<any>> = {}
  const schemas: Record<string, any> = {}
  const server: IMcpServer = {
    tool: (name: string, _desc: string, schema: any, handler: any) => { tools[name] = handler; schemas[name] = schema },
    connect: async () => {},
    close: async () => {},
  }
  // ตรวจ args ด้วย schema จริงแบบที่ SDK ทำ — เรียก handler ตรงๆ จะข้าม zod ไป (regex วันที่เคยพังแบบนี้)
  const valid = (name: string, args: any) => z.object(schemas[name]).safeParse(args).success
  return { server, tools, valid }
}

const parseOk = (res: any) => JSON.parse(res.content[0].text)

const tenants: string[] = []
function setupTenant() {
  const t = 'test_fin_' + generateId()
  tenants.push(t)
  return t
}

afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_lines', 'journal_entries', 'accounts', 'invoices', 'sales_orders', 'customers']) {
      db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t)
    }
  }
})

function addCustomer(t: string, name: string) {
  const id = generateId()
  db.prepare(`INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, address, tax_id)
              VALUES (?, ?, ?, ?, 'COMPANY', '-', '-', '-', '-', ?, ?)`)
    .run(id, t, 'C' + id.slice(0, 6), name, `ที่อยู่ ${name}`, '0105555000001')
  return id
}

function addInvoice(t: string, customerId: string, balance: number, status = 'ISSUED', dueDate = '2026-01-01') {
  // invoices มี CHECK ว่าต้องมาจาก SO หรือบิล POS
  const so = generateId()
  db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id) VALUES (?, ?, ?, ?)`)
    .run(so, t, 'SO-' + so.slice(0, 8), customerId)
  db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, invoice_date, due_date,
                total_amount, paid_amount, balance_amount, status, payment_status)
              VALUES (?, ?, ?, ?, ?, '2025-12-01', ?, ?, 0, ?, ?, 'UNPAID')`)
    .run(generateId(), t, 'INV-' + generateId().slice(0, 8), so, customerId, dueDate, balance, balance, status)
}

describe('งบทดลอง — ยอดผิดฝั่งต้องไม่หาย', () => {
  it('เงินฝาก (normal DEBIT) ที่ติดลบ ต้องไปอยู่ฝั่งเครดิต และยอดรวม Dr = Cr', () => {
    const t = setupTenant()
    const acc = (code: string, type: string, normal: string) => {
      const id = generateId()
      db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, is_active)
                  VALUES (?, ?, ?, ?, ?, 'X', ?, 1)`).run(id, t, code, code, type, normal)
      return id
    }
    const bank = acc('1102', 'ASSET', 'DEBIT')
    const expense = acc('5302', 'EXPENSE', 'DEBIT')
    const je = generateId()
    db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, description, is_posted)
                VALUES (?, ?, 'JV-T1', '2026-05-01', 'จ่ายค่าเช่าเกินเงินในบัญชี', 1)`).run(je, t)
    const line = db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, ?, ?, ?)`)
    line.run(generateId(), t, je, expense, 1000, 0)
    line.run(generateId(), t, je, bank, 0, 1000)

    const tb = buildTrialBalance(t)
    const bankRow = tb.accounts.find((a: any) => a.code === '1102')!
    expect(bankRow.endingCredit, 'เดิมถูกปัดเป็น 0 ทั้งสองฝั่ง').toBe(1000)
    expect(bankRow.endingDebit).toBe(0)
    expect(tb.totals.endingDebit).toBe(tb.totals.endingCredit)

    // ยอดยกมาใช้ตรรกะเดียวกัน
    const tb2 = buildTrialBalance(t, '2026-06-01')
    expect(tb2.accounts.find((a: any) => a.code === '1102')!.openingCredit).toBe(1000)
    expect(tb2.totals.openingDebit).toBe(tb2.totals.openingCredit)
  })
})

describe('MCP get_ar_aging — ใช้แหล่งเดียวกับ REST', () => {
  it('ไม่นับ DRAFT/CANCELLED, ไม่ตัดที่ 50 ใบ, มีที่อยู่/เลขภาษี และยอดตรงกับ arAging()', async () => {
    const t = setupTenant()
    const c = addCustomer(t, 'บริษัท ทดสอบ')
    for (let i = 0; i < 55; i++) addInvoice(t, c, 100)
    addInvoice(t, c, 9999, 'DRAFT')
    addInvoice(t, c, 8888, 'CANCELLED')

    const { server, tools } = fakeServer()
    registerFinanceTools(server, t)
    const res = parseOk(await tools['get_ar_aging']({ as_of: '2026-03-01' }))

    expect(res.totals.docCount).toBe(55)
    expect(res.totals.outstanding).toBe(5500)
    expect(res.parties[0].address).toBe('ที่อยู่ บริษัท ทดสอบ')
    expect(res.parties[0].taxId).toBe('0105555000001')
    expect(res).toEqual(arAging(t, '2026-03-01'))
  })

  it('กรอง overdue_only / ชื่อลูกค้า แล้วยอดรวมตรงกับรายการที่เหลือ', async () => {
    const t = setupTenant()
    addInvoice(t, addCustomer(t, 'ร้านเอ'), 100, 'ISSUED', '2026-01-01')     // เกินกำหนด
    addInvoice(t, addCustomer(t, 'ร้านบี'), 200, 'ISSUED', '2026-12-31')     // ยังไม่ถึง

    const { server, tools } = fakeServer()
    registerFinanceTools(server, t)
    const overdue = parseOk(await tools['get_ar_aging']({ as_of: '2026-03-01', overdue_only: true }))
    expect(overdue.totals).toMatchObject({ outstanding: 100, overdue: 100, docCount: 1, partyCount: 1 })

    const byName = parseOk(await tools['get_ar_aging']({ as_of: '2026-03-01', customer_name: 'บี' }))
    expect(byName.parties.map((p: any) => p.name)).toEqual(['ร้านบี'])
    expect(byName.totals.outstanding).toBe(200)
  })
})

describe('MCP get_financial_summary', () => {
  it('ยอดลูกหนี้คงค้างไม่รวมใบ DRAFT/CANCELLED', async () => {
    const t = setupTenant()
    const c = addCustomer(t, 'ร้านซี')
    addInvoice(t, c, 300)
    addInvoice(t, c, 5000, 'DRAFT')
    addInvoice(t, c, 7000, 'CANCELLED')

    const { server, tools } = fakeServer()
    registerFinanceTools(server, t)
    const res = parseOk(await tools['get_financial_summary']({ period: 'ytd' }))
    expect(res.accounts_receivable.total_outstanding).toBe(300)
    expect(res.accounts_receivable.overdue_count).toBe(1)
  })
})

describe('MCP get_trial_balance / get_ledger — เฉพาะ MASTER/ADMIN', () => {
  function seedBankJournal(t: string) {
    const acc = (code: string, type: string) => {
      const id = generateId()
      db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, is_active)
                  VALUES (?, ?, ?, ?, ?, 'X', 'DEBIT', 1)`).run(id, t, code, code, type)
      return id
    }
    const bank = acc('1102', 'ASSET')
    const exp = acc('5302', 'EXPENSE')
    const line = db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, debit, credit) VALUES (?, ?, ?, ?, ?, ?)`)
    for (const [date, amt] of [['2026-04-01', 500], ['2026-05-01', 300]] as const) {
      const je = generateId()
      db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, description, is_posted)
                  VALUES (?, ?, ?, ?, 'ค่าเช่า', 1)`).run(je, t, 'JV-' + je.slice(0, 6), date)
      line.run(generateId(), t, je, exp, amt, 0)
      line.run(generateId(), t, je, bank, 0, amt)
    }
  }

  it('USER มองไม่เห็น tool · ADMIN/MASTER เห็น', () => {
    for (const [role, visible] of [['USER', false], ['ADMIN', true], ['MASTER', true]] as const) {
      const { server, tools } = fakeServer()
      registerFinanceTools(server, 'tenant_x', role)
      expect(!!tools['get_trial_balance'], role).toBe(visible)
      expect(!!tools['get_ledger'], role).toBe(visible)
      expect(tools['get_ar_aging'], 'AR/AP ยังเห็นทุก role').toBeTypeOf('function')
    }
  })

  it('get_ledger ไม่ส่ง start_date ยอดปิดต้องไม่เป็น 2 เท่า · ส่ง start_date แล้วยอดยกมาถูก', async () => {
    const t = setupTenant()
    seedBankJournal(t)
    const { server, tools } = fakeServer()
    registerFinanceTools(server, t, 'ADMIN')

    const all = parseOk(await tools['get_ledger']({ account_code: '1102' }))
    expect(all.openingBalance).toBe(0)
    expect(all.closingBalance, 'เดิมได้ -1600').toBe(-800)

    const may = parseOk(await tools['get_ledger']({ account_code: '1102', start_date: '2026-05-01' }))
    expect(may.openingBalance).toBe(-500)
    expect(may.transactions).toHaveLength(1)
    expect(may.closingBalance).toBe(-800)

    expect(parseOk(await tools['get_ledger']({ account_code: '9999' })).success).toBe(false)

    const tb = parseOk(await tools['get_trial_balance']({}))
    expect(tb.accounts.find((a: any) => a.code === '1102').endingCredit).toBe(800)
    expect(tb.totals.endingDebit).toBe(tb.totals.endingCredit)
  })
})

describe('MCP finance — schema รับวันที่ YYYY-MM-DD', () => {
  it('get_trial_balance / get_ledger / get_ar_aging รับวันที่จริง และปฏิเสธรูปแบบผิด', () => {
    const { server, valid } = fakeServer()
    registerFinanceTools(server, 'tenant_x', 'ADMIN')
    expect(valid('get_trial_balance', { start_date: '2026-09-01', end_date: '2026-09-30' }), 'เดิม regex ขาด \\d').toBe(true)
    expect(valid('get_ledger', { account_code: '1102', start_date: '2026-09-01' })).toBe(true)
    expect(valid('get_ar_aging', { as_of: '2026-09-30' })).toBe(true)
    expect(valid('get_trial_balance', { start_date: 'dddd-dd-dd' })).toBe(false)
    expect(valid('get_trial_balance', { start_date: '1/9/2026' })).toBe(false)
  })
})

describe('MCP get_financial_summary — ช่วงเวลาและชื่อช่อง', () => {
  it('mtd นับตั้งแต่วันที่ 1 ของเดือน · ส่ง net_cash_flow แทน gross_profit', async () => {
    const t = setupTenant()
    const c = addCustomer(t, 'ร้านดี')
    const so = generateId()
    db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id) VALUES (?, ?, ?, ?)`).run(so, t, 'SO-' + so.slice(0, 8), c)
    const firstOfMonth = (db.prepare(`SELECT date('now','start of month') d`).get() as any).d
    const lastMonth = (db.prepare(`SELECT date('now','start of month','-1 day') d`).get() as any).d
    for (const [date, amt] of [[firstOfMonth, 400], [lastMonth, 900]] as const) {
      db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, invoice_date, due_date,
                    total_amount, paid_amount, balance_amount, status, payment_status)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'ISSUED', 'PAID')`)
        .run(generateId(), t, 'INV-' + generateId().slice(0, 8), so, c, date, date, amt, amt)
    }
    const { server, tools, valid } = fakeServer()
    registerFinanceTools(server, t)
    expect(valid('get_financial_summary', { period: 'mtd' })).toBe(true)
    const res = parseOk(await tools['get_financial_summary']({ period: 'mtd' }))
    expect(res.income.total_invoiced).toBe(400)
    expect(res.net_cash_flow).toBe(400)
    expect(res).not.toHaveProperty('gross_profit')
  })
})
