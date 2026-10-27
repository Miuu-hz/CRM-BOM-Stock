import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { seedChartOfAccounts } from '../config/chartOfAccounts'
import { ACC } from '../config/accountCodes'
import { createTestUser } from '../test/testAuth'
import {
  submitCloseAdjustments, approveCloseGroup, discardCloseRecord,
  MAX_LINES, ADJ_TYPES, type SubmitLine, type Actor,
} from './closeAdjustments.service'
import { MonthCloseError, postedBalance, reconciliationStatus } from './monthClose.service'
import { buildClosePack } from './closePack.service'
import { ensurePeriod } from '../routes/tax.routes'
import { registerMonthCloseTools } from '../mcp/tools/monthClose'
import monthCloseRouter from '../routes/monthClose.routes'
import approvalRouter from '../routes/approval.routes'
import journalRouter from '../routes/journal.routes'
import periodClosingRouter from '../routes/period-closing.routes'
import type { IMcpServer } from '../mcp/sdk-compat'

const app = express()
app.use(express.json())
app.use('/api/month-close', monthCloseRouter)
app.use('/api/approval', approvalRouter)
app.use('/api/journal', journalRouter)
app.use('/api/period-closing', periodClosingRouter)

const PERIOD = '2026-10'
const DATE = '2026-10-15'
const PASS_HASH = bcrypt.hashSync('Secret#123', 4)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of [
      'bank_reconciliation_records', 'bank_reconciliations', 'approval_logs', 'approval_requests',
      'journal_unposts', 'journal_lines', 'journal_entries', 'receipts', 'invoices', 'sales_orders', 'customers',
      'supplier_payments', 'purchase_invoices', 'purchase_orders', 'suppliers', 'tax_periods',
      'bank_accounts', 'accounts', 'document_sequences', 'company_settings', 'users',
    ]) {
      db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t)
    }
  }
})

function setup(role: 'ADMIN' | 'USER' = 'ADMIN', opts: { tenantId?: string; departments?: string[]; entityType?: string | null } = {}) {
  const u = createTestUser({ role, tenantId: opts.tenantId })
  if (!tenants.includes(u.tenantId)) tenants.push(u.tenantId)
  if (!opts.tenantId) seedChartOfAccounts(u.tenantId)
  db.prepare('UPDATE users SET password = ?, departments = ? WHERE id = ?')
    .run(PASS_HASH, opts.departments ? JSON.stringify(opts.departments) : null, u.userId)
  if (opts.entityType !== undefined) {
    db.prepare(`INSERT INTO company_settings (tenant_id, name, entity_type) VALUES (?, 'บริษัททดสอบ', ?)
      ON CONFLICT(tenant_id) DO UPDATE SET entity_type = excluded.entity_type`)
      .run(u.tenantId, opts.entityType)
  }
  const actor: Actor = { userId: u.userId, name: 'ผู้ทดสอบ', email: u.email, role: u.role, departments: opts.departments ?? [] }
  return { ...u, actor }
}

const accId = (t: string, code: string) => (db.prepare('SELECT id FROM accounts WHERE tenant_id = ? AND code = ?').get(t, code) as any).id
const jvSeq = (t: string) => (db.prepare(`SELECT COALESCE(MAX(last_number), 0) AS n FROM document_sequences WHERE tenant_id = ? AND doc_type = 'JOURNAL'`).get(t) as any).n

function addBank(t: string, code = '1102-01', isDefault = 1) {
  const id = generateId()
  db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, parent_id, level, is_active, normal_balance)
    VALUES (?, ?, ?, ?, 'ASSET', 'CASH', ?, 3, 1, 'DEBIT')`).run(id, t, code, `ธนาคาร ${code}`, accId(t, ACC.BANK))
  const bankRowId = generateId()
  db.prepare(`INSERT INTO bank_accounts (id, tenant_id, bank_name, account_name, account_number, account_id, is_default, is_active)
    VALUES (?, ?, 'กสิกร', 'บจก.ทดสอบ', ?, ?, ?, 1)`).run(bankRowId, t, code, id, isDefault)
  return { id, bankRowId }
}

function insertJe(
  t: string,
  legs: Array<{ code: string; debit?: number; credit?: number }>,
  opts: { date?: string; posted?: number; auto?: number; refType?: string | null; refId?: string | null; entryNumber?: string } = {},
) {
  const jeId = generateId()
  const now = new Date().toISOString()
  const date = opts.date ?? DATE
  const entryNumber = opts.entryNumber ?? `JV-SEED-${jeId.slice(0, 6)}`
  const dr = legs.reduce((s, l) => s + (l.debit || 0), 0)
  const cr = legs.reduce((s, l) => s + (l.credit || 0), 0)
  db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, description,
      total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'รายการตั้งต้น', ?, ?, ?, ?, 'seed', ?, ?)`)
    .run(jeId, t, entryNumber, date, opts.refType ?? 'MANUAL', opts.refId ?? null, dr, cr, opts.auto ?? 0, opts.posted ?? 1, now, now)
  const lineIds: Record<string, string> = {}
  legs.forEach((l, i) => {
    const lid = generateId()
    lineIds[l.code] = lid
    db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
      VALUES (?, ?, ?, ?, ?, 'บรรทัดตั้งต้น', ?, ?)`).run(lid, t, jeId, accId(t, l.code), i + 1, l.debit || 0, l.credit || 0)
  })
  return { jeId, entryNumber, lineIds }
}

function baseLine(overrides: Partial<SubmitLine> = {}): SubmitLine {
  return {
    type: 'BANK_FEE',
    date: DATE,
    amount: 25,
    statement_ref: 'FEE-001',
    statement_line_no: 1,
    description: 'ค่าธรรมเนียมโอนเงิน',
    reason: 'พบค่าธรรมเนียมใน statement บรรทัด 1',
    confidence: 0.95,
    ...overrides,
  }
}

function fakeServer(): { server: IMcpServer; tools: Record<string, (args: any) => Promise<any>> } {
  const tools: Record<string, (args: any) => Promise<any>> = {}
  const server: IMcpServer = {
    tool: (name: string, _desc: string, _schema: any, handler: any) => { tools[name] = handler },
    connect: async () => {},
    close: async () => {},
  }
  return { server, tools }
}

const parseMcp = (res: any) => JSON.parse(res.content[0].text)

describe('W8 — Month-close adjustments adversarial QA', () => {
  it('1. สิทธิ์การใช้งาน: USER ไม่มีแผนก → ไม่ลงทะเบียน MCP get_close_pack/submit_close_adjustments และ service โยน 403 · ADMIN และ USER แผนก ACCOUNTING ผ่าน', async () => {
    const admin = setup('ADMIN')
    addBank(admin.tenantId, '1102-01')
    const basic = setup('USER', { tenantId: admin.tenantId, departments: [] })
    const acct = setup('USER', { tenantId: admin.tenantId, departments: ['ACCOUNTING'] })

    // USER ไม่มีแผนก: MCP มีเฉพาะ get_close_checklist
    const sBasic = fakeServer()
    registerMonthCloseTools(sBasic.server, basic.tenantId, basic.userId, basic.email, basic.role)
    expect(Object.keys(sBasic.tools)).toEqual(['get_close_checklist'])
    expect(() => submitCloseAdjustments(basic.tenantId, basic.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: 0, lines: [],
    })).toThrowError(expect.objectContaining({ status: 403 }))

    // ADMIN: MCP ลงครบ 3 tools และเรียกใช้งานได้
    const sAdmin = fakeServer()
    registerMonthCloseTools(sAdmin.server, admin.tenantId, admin.userId, admin.email, admin.role)
    expect(Object.keys(sAdmin.tools).sort()).toEqual(['get_close_checklist', 'get_close_pack', 'submit_close_adjustments'])
    const adminRes = submitCloseAdjustments(admin.tenantId, admin.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: 0, lines: [],
    })
    expect(adminRes.summary.reconciled).toBe(true)

    // USER แผนก ACCOUNTING: MCP ลงครบ 3 tools และส่งผ่าน MCP handler ได้
    const sAcct = fakeServer()
    registerMonthCloseTools(sAcct.server, acct.tenantId, acct.userId, acct.email, acct.role)
    expect(Object.keys(sAcct.tools).sort()).toEqual(['get_close_checklist', 'get_close_pack', 'submit_close_adjustments'])
    const mcpOut = parseMcp(await sAcct.tools.submit_close_adjustments({
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: -25,
      lines: [baseLine()],
    }))
    expect(mcpOut.success).toBe(true)
    expect(mcpOut.summary.accepted).toBe(1)
  })

  it('2. งวดที่ปิดแล้ว (tax_periods.status = CLOSED) → โยน 400 พร้อมอ้างบัญชี 3107', () => {
    const u = setup('ADMIN')
    addBank(u.tenantId, '1102-01')
    const tpId = ensurePeriod(u.tenantId, '2026-10-01')
    db.prepare(`UPDATE tax_periods SET status = 'CLOSED' WHERE id = ?`).run(tpId)

    try {
      submitCloseAdjustments(u.tenantId, u.actor, {
        period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: 0, lines: [baseLine()],
      })
      expect.unreachable('ต้องโยน MonthCloseError เมื่อส่งในงวดที่ปิดแล้ว')
    } catch (e: any) {
      expect(e).toBeInstanceOf(MonthCloseError)
      expect(e.status).toBe(400)
      expect(e.message).toContain(ACC.PRIOR_PERIOD_ADJ) // 3107
    }
  })

  it('3. ตรวจความถูกต้องรายบรรทัด → ปฏิเสธข้อความไทยครบทุกกรณี · เกิน 200 บรรทัดโยน 400 · บรรทัดที่ถูกปฏิเสธไม่สร้าง JE และไม่กินเลข JV', () => {
    const u = setup('ADMIN')
    addBank(u.tenantId, '1102-01')

    // เกิน 200 บรรทัด → 400
    const tooMany = Array.from({ length: MAX_LINES + 1 }, (_, i) => baseLine({ statement_line_no: i + 1, statement_ref: `R-${i}` }))
    expect(() => submitCloseAdjustments(u.tenantId, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: 0, lines: tooMany,
    })).toThrowError(expect.objectContaining({ status: 400 }))

    const seqBefore = jvSeq(u.tenantId)
    const badLines: SubmitLine[] = [
      baseLine({ statement_line_no: 1, statement_ref: 'B1', type: 'MAGIC_ADJUST' }),
      baseLine({ statement_line_no: 2, statement_ref: 'B2', date: '2026-09-30' }),
      baseLine({ statement_line_no: 3, statement_ref: 'B3', amount: 0 }),
      baseLine({ statement_line_no: 4, statement_ref: 'B4', amount: -50 }),
      baseLine({ statement_line_no: 5, statement_ref: 'B5', amount: 12.345 }),
      baseLine({ statement_line_no: 6, statement_ref: '   ' }),
      baseLine({ statement_line_no: -1, statement_ref: 'B7' }),
      baseLine({ statement_line_no: 8, statement_ref: 'B8', description: '' }),
      baseLine({ statement_line_no: 9, statement_ref: 'B9', reason: 'ab' }),
      baseLine({ statement_line_no: 10, statement_ref: 'B10', confidence: 1.5 }),
    ]

    const res = submitCloseAdjustments(u.tenantId, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: 0, lines: badLines,
    })
    expect(res.summary.accepted).toBe(0)
    expect(res.summary.rejected).toBe(badLines.length)
    for (const r of res.results) {
      expect(r.status).toBe('rejected')
      expect(r.errors && r.errors.length).toBeGreaterThan(0)
      expect(r.errors![0]).toMatch(/[ก-๙]/)
    }
    expect(res.results[0].errors![0]).toContain('ไม่อยู่ในรายการที่รับ')
    expect(res.results[1].errors![0]).toContain('อยู่นอกงวด')
    expect(res.results[2].errors![0]).toContain('มากกว่า 0')
    expect(res.results[3].errors![0]).toContain('มากกว่า 0')
    expect(res.results[4].errors![0]).toContain('ทศนิยมได้ไม่เกิน 2 ตำแหน่ง')
    expect(res.results[5].errors![0]).toContain('statement_ref')
    expect(res.results[6].errors![0]).toContain('statement_line_no')
    expect(res.results[7].errors![0]).toContain('description')
    expect(res.results[8].errors![0]).toContain('reason')
    expect(res.results[9].errors![0]).toContain('confidence')

    // ไม่สร้าง JE และไม่ขยับเลข JV
    expect(jvSeq(u.tenantId)).toBe(seqBefore)
    const jeCount = (db.prepare('SELECT COUNT(*) AS n FROM journal_entries WHERE tenant_id = ?').get(u.tenantId) as any).n
    expect(jeCount).toBe(0)
  })

  it('4. ผังบัญชีและประเภทพื้นฐาน: MISSING_EXPENSE กั้น 1110/5101/บัญชีหัว/รหัสมั่ว · 5306/BANK_FEE/INTEREST_INCOME สร้างร่าง JV ถูกคู่ · bank_account_code = 1102 หัวโยน 400', () => {
    const u = setup('ADMIN')
    const t = u.tenantId
    const { id: bankId } = addBank(t, '1102-01')

    // สร้างบัญชีย่อยใต้ 5301 เพื่อให้ 5301 กลายเป็นบัญชีหัวหมวดค่าใช้จ่าย
    db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, parent_id, level, is_active, normal_balance)
      VALUES (?, ?, '5301-01', 'เงินเดือนฝ่ายบัญชี', 'EXPENSE', 'ADMIN_EXPENSE', ?, 3, 1, 'DEBIT')`)
      .run(generateId(), t, accId(t, '5301'))

    // bank_account_code เป็นบัญชีหัว 1102 → โยน 400
    expect(() => submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: ACC.BANK, statement_closing_balance: 0, lines: [],
    })).toThrowError(expect.objectContaining({ status: 400, message: expect.stringContaining('บัญชีหัว') }))

    const badRes = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: -270,
      lines: [
        baseLine({ statement_line_no: 1, statement_ref: 'E1', type: 'MISSING_EXPENSE', account_code: ACC.INPUT_VAT, amount: 100 }),
        baseLine({ statement_line_no: 2, statement_ref: 'E2', type: 'MISSING_EXPENSE', account_code: ACC.COGS, amount: 100 }),
        baseLine({ statement_line_no: 3, statement_ref: 'E3', type: 'MISSING_EXPENSE', account_code: '5301', amount: 100 }),
        baseLine({ statement_line_no: 4, statement_ref: 'E4', type: 'MISSING_EXPENSE', account_code: '5999', amount: 100 }),
      ],
    })
    expect(badRes.results.map(r => r.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected'])
    expect(badRes.results[2].errors![0]).toContain('บัญชีหัว')
    expect(badRes.results[3].errors![0]).toContain('ไม่พบบัญชี')

    const res = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: -270,
      lines: [
        baseLine({ statement_line_no: 5, statement_ref: 'E5', type: 'MISSING_EXPENSE', account_code: '5306', amount: 300 }),
        baseLine({ statement_line_no: 6, statement_ref: 'E6', type: 'BANK_FEE', amount: 20 }),
        baseLine({ statement_line_no: 7, statement_ref: 'E7', type: 'INTEREST_INCOME', amount: 50 }),
      ],
    })
    expect(res.results.map(r => r.status)).toEqual(['accepted', 'accepted', 'accepted'])

    const checkJv = (recordId: string, drCode: string, crCode: string, amt: number) => {
      const rec = db.prepare('SELECT journal_entry_id FROM bank_reconciliation_records WHERE id = ?').get(recordId) as any
      const je = db.prepare('SELECT is_posted, reference_type, total_debit, total_credit FROM journal_entries WHERE id = ?').get(rec.journal_entry_id) as any
      expect(je).toEqual({ is_posted: 0, reference_type: 'CLOSE_ADJUSTMENT', total_debit: amt, total_credit: amt })
      const lines = db.prepare(`SELECT a.code, jl.debit, jl.credit, jl.account_id FROM journal_lines jl
        JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id = ? ORDER BY jl.line_number`).all(rec.journal_entry_id) as any[]
      expect(lines).toEqual([
        { code: drCode, debit: amt, credit: 0, account_id: drCode === '1102-01' ? bankId : accId(t, drCode) },
        { code: crCode, debit: 0, credit: amt, account_id: crCode === '1102-01' ? bankId : accId(t, crCode) },
      ])
    }

    checkJv(res.results[0].record_id!, '5306', '1102-01', 300)
    checkJv(res.results[1].record_id!, ACC.BANK_CHARGE, '1102-01', 20)
    checkJv(res.results[2].record_id!, '1102-01', ACC.INTEREST_INCOME, 50)
  })

  it('5. ทุกร่าง JV ที่สร้างต้องดุล (Σdebit = Σcredit) และผลกระทบต่อบัญชีที่กระทบยอดเท่ากับ record.effect', () => {
    const u = setup('ADMIN', { entityType: 'COMPANY' })
    const t = u.tenantId
    const { id: bankId } = addBank(t, '1102-01')
    const cashPay = insertJe(t, [{ code: '5306', debit: 400 }, { code: ACC.CASH, credit: 400 }])
    const manDup = insertJe(t, [{ code: '5306', debit: 150 }, { code: '1102-01', credit: 150 }])

    const res = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: 0,
      lines: [
        baseLine({ statement_line_no: 1, statement_ref: 'M1', type: 'MISSING_EXPENSE', account_code: '5306', amount: 120 }),
        baseLine({ statement_line_no: 2, statement_ref: 'M2', type: 'BANK_FEE', amount: 15 }),
        baseLine({ statement_line_no: 3, statement_ref: 'M3', type: 'INTEREST_INCOME', amount: 35.5 }),
        baseLine({ statement_line_no: 4, statement_ref: 'M4', type: 'WRONG_CHANNEL', ref_line_id: cashPay.lineIds[ACC.CASH], amount: 400 }),
        baseLine({ statement_line_no: 5, statement_ref: 'M5', type: 'OWNER_PERSONAL', amount: 250 }),
        baseLine({ statement_line_no: 6, statement_ref: 'M6', type: 'OWNER_CAPITAL', amount: 1000 }),
        baseLine({ statement_line_no: 7, statement_ref: 'M7', type: 'UNRECORDED_RECEIPT', account_code: '4101', amount: 500 }),
        baseLine({ statement_line_no: 8, statement_ref: 'M8', type: 'DUPLICATE', ref_line_id: manDup.lineIds['1102-01'], amount: 150 }),
        baseLine({ statement_line_no: 9, statement_ref: 'M9', type: 'UNIDENTIFIED', direction: 'OUT', amount: 80 }),
      ],
    })
    expect(res.summary.rejected).toBe(0)
    expect(res.summary.accepted).toBe(9)

    // ทดสอบ CASH_COUNT_DIFF บนบัญชีเงินสด 1101 ด้วย
    const resCash = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: ACC.CASH, statement_closing_balance: -450,
      lines: [baseLine({ statement_line_no: 1, statement_ref: 'C1', type: 'CASH_COUNT_DIFF', direction: 'OUT', amount: 50 })],
    })
    expect(resCash.summary.accepted).toBe(1)

    const records = db.prepare(`SELECT r.*, b.account_id AS recon_account_id FROM bank_reconciliation_records r
      JOIN bank_reconciliations b ON b.id = r.reconciliation_id WHERE r.tenant_id = ?`).all(t) as any[]
    expect(records.length).toBe(10)
    for (const r of records) {
      expect(r.journal_entry_id).toBeTruthy()
      const je = db.prepare('SELECT total_debit, total_credit FROM journal_entries WHERE id = ?').get(r.journal_entry_id) as any
      const lines = db.prepare('SELECT account_id, debit, credit FROM journal_lines WHERE journal_entry_id = ?').all(r.journal_entry_id) as any[]
      const sumDr = lines.reduce((s, l) => s + l.debit, 0)
      const sumCr = lines.reduce((s, l) => s + l.credit, 0)
      expect(sumDr).toBeCloseTo(sumCr, 2)
      expect(sumDr).toBeCloseTo(je.total_debit, 2)
      expect(je.total_debit).toBeCloseTo(je.total_credit, 2)
      const effOnBank = lines.filter(l => l.account_id === r.recon_account_id).reduce((s, l) => s + l.debit - l.credit, 0)
      expect(effOnBank).toBeCloseTo(r.effect, 2)
      if (r.recon_account_id === bankId) {
        expect(['-120', '-15', '35.5', '-400', '-250', '1000', '500', '150', '-80']).toContain(String(r.effect))
      }
    }
  })

  it('6. กันซ้ำ (dedupe): ส่งบรรทัดเดิมซ้ำครั้งที่สอง หรือซ้ำในชุดเดียวกัน → status duplicate ไม่สร้างแถว/JV เพิ่ม · หลัง discard ส่งใหม่รับได้อีกครั้ง', () => {
    const u = setup('ADMIN')
    const t = u.tenantId
    addBank(t, '1102-01')

    const line = baseLine({ statement_line_no: 10, statement_ref: 'DUP-10', amount: 30 })
    // ส่ง 2 บรรทัดเหมือนกันในชุดเดียวกัน
    const firstBatch = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: -30,
      lines: [line, { ...line }],
    })
    expect(firstBatch.results[0].status).toBe('accepted')
    expect(firstBatch.results[1].status).toBe('duplicate')
    expect(firstBatch.summary).toMatchObject({ accepted: 1, duplicate: 1, rejected: 0 })

    // ส่งบรรทัดเดิมซ้ำอีกครั้งในรอบถัดไป
    const secondCall = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: -30,
      lines: [line],
    })
    expect(secondCall.results[0].status).toBe('duplicate')
    expect(secondCall.results[0].record_id).toBe(firstBatch.results[0].record_id)
    expect((db.prepare('SELECT COUNT(*) AS n FROM bank_reconciliation_records WHERE tenant_id = ?').get(t) as any).n).toBe(1)
    expect((db.prepare('SELECT COUNT(*) AS n FROM journal_entries WHERE tenant_id = ?').get(t) as any).n).toBe(1)

    // ทิ้งรายการเดิม แล้วส่งบรรทัดเดิมเข้ามาใหม่ → ต้องรับได้อีกครั้ง
    discardCloseRecord(t, firstBatch.results[0].record_id!, u.actor, 'ส่งผิดบรรทัด ขอลองใหม่')
    const afterDiscard = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: -30,
      lines: [line],
    })
    expect(afterDiscard.results[0].status).toBe('accepted')
    expect(afterDiscard.results[0].record_id).not.toBe(firstBatch.results[0].record_id)
  })

  it('7. ตรวจ ref_line_id: ข้าม tenant → ปฏิเสธ · อ้างรายการร่าง (ยังไม่ post) → ปฏิเสธ · แก้รวมเกินยอดเดิม → บรรทัดที่สองถูกปฏิเสธ', () => {
    const u1 = setup('ADMIN')
    const u2 = setup('ADMIN')
    addBank(u1.tenantId, '1102-01')
    addBank(u2.tenantId, '1102-01')

    const otherTenantJe = insertJe(u2.tenantId, [{ code: '5306', debit: 500 }, { code: ACC.CASH, credit: 500 }])
    const draftJe = insertJe(u1.tenantId, [{ code: '5306', debit: 500 }, { code: ACC.CASH, credit: 500 }], { posted: 0 })
    const postedJe = insertJe(u1.tenantId, [{ code: '5306', debit: 500 }, { code: ACC.CASH, credit: 500 }], { posted: 1 })

    const okRes = submitCloseAdjustments(u1.tenantId, u1.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: -300,
      lines: [
        baseLine({ statement_line_no: 3, statement_ref: 'R3', type: 'WRONG_CHANNEL', ref_line_id: postedJe.lineIds[ACC.CASH], amount: 300 }),
      ],
    })
    expect(okRes.results[0].status).toBe('accepted')

    const res = submitCloseAdjustments(u1.tenantId, u1.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: -500,
      lines: [
        baseLine({ statement_line_no: 1, statement_ref: 'R1', type: 'WRONG_CHANNEL', ref_line_id: otherTenantJe.lineIds[ACC.CASH], amount: 500 }),
        baseLine({ statement_line_no: 2, statement_ref: 'R2', type: 'WRONG_CHANNEL', ref_line_id: draftJe.lineIds[ACC.CASH], amount: 500 }),
        baseLine({ statement_line_no: 4, statement_ref: 'R4', type: 'WRONG_CHANNEL', ref_line_id: postedJe.lineIds[ACC.CASH], amount: 250 }),
      ],
    })

    expect(res.results[0].status).toBe('rejected')
    expect(res.results[0].errors![0]).toContain('ไม่พบ ref_line_id')
    expect(res.results[1].status).toBe('rejected')
    expect(res.results[1].errors![0]).toContain('ยังเป็นร่าง')
    expect(res.results[2].status).toBe('rejected')
    expect(res.results[2].errors![0]).toContain('ยอดแก้รวมเกินยอดรายการเดิม')
  })

  it('8. WRONG_ACCOUNT: ลงจ่ายที่ 1102 ก่อนเพิ่มบัญชีย่อย 1102-01 → ส่ง WRONG_ACCOUNT ได้ร่าง → ADMIN อนุมัติแล้ว 1102 เหลือ 0 และ 1102-01 ลดลง · trigger ยังห้ามย้ายเกินยอด', () => {
    const u = setup('ADMIN')
    const t = u.tenantId

    // ลงจ่ายผู้ขายที่ 1102 ก่อนมีบัญชีย่อย 1102-01 (ยอด 1102 = -1,200)
    const orig = insertJe(t, [{ code: ACC.AP, debit: 1200 }, { code: ACC.BANK, credit: 1200 }], { refType: 'SUPPLIER_PAYMENT' })
    expect(postedBalance(t, accId(t, ACC.BANK), '2026-10-31')).toBe(-1200)

    const { id: subBankId } = addBank(t, '1102-01')

    // Trigger ห้ามย้ายเกินยอดเดิมของบัญชีหัว (เช่น Dr 1102 1500 เมื่อยอดเป็น -1200)
    expect(() => insertJe(t, [{ code: ACC.BANK, debit: 1500 }, { code: '1102-01', credit: 1500 }])).toThrow(/ลงบัญชีหัวไม่ได้/)

    // ส่ง WRONG_ACCOUNT ย้าย 1200 จาก 1102 → 1102-01
    const sub = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: -1200,
      lines: [baseLine({
        statement_line_no: 1, statement_ref: 'WA-1', type: 'WRONG_ACCOUNT',
        account_code: '1102-01', ref_line_id: orig.lineIds[ACC.BANK], amount: 1200,
      })],
    })
    expect(sub.results[0].status).toBe('accepted')
    expect(sub.results[0].effect).toBe(-1200)
    // ขณะยังเป็นร่าง ยอดที่ post แล้วของ 1102 ยังเป็น -1200
    expect(postedBalance(t, accId(t, ACC.BANK), '2026-10-31')).toBe(-1200)

    // ADMIN อนุมัติ → post ทันที ยอด 1102 กลับเป็น 0 และ 1102-01 ลดลงเป็น -1200
    const appRes = approveCloseGroup(t, PERIOD, 'WRONG_ACCOUNT', u.actor)
    expect(appRes).toEqual({ mode: 'posted', posted: 1 })
    expect(postedBalance(t, accId(t, ACC.BANK), '2026-10-31')).toBe(0)
    expect(postedBalance(t, subBankId, '2026-10-31')).toBe(-1200)

    // ยอดบัญชีหัว 1102 เป็น 0 แล้ว → trigger ห้ามลง 1102 อีกทุกทิศ
    expect(() => insertJe(t, [{ code: ACC.BANK, debit: 10 }, { code: '1102-01', credit: 10 }])).toThrow(/ลงบัญชีหัวไม่ได้/)
  })

  it('9. WRONG_CHANNEL: ลงจ่ายเป็นเงินสด (1101) แต่จริงออกธนาคาร → ร่าง JV Dr 1101 / Cr ธนาคาร', () => {
    const u = setup('ADMIN')
    const t = u.tenantId
    const { id: bankId } = addBank(t, '1102-01')
    const cashOut = insertJe(t, [{ code: '5306', debit: 850 }, { code: ACC.CASH, credit: 850 }])

    const res = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: -850,
      lines: [baseLine({
        statement_line_no: 1, statement_ref: 'WC-1', type: 'WRONG_CHANNEL',
        ref_line_id: cashOut.lineIds[ACC.CASH], amount: 850,
      })],
    })
    expect(res.results[0].status).toBe('accepted')
    expect(res.results[0].effect).toBe(-850)

    const rec = db.prepare('SELECT journal_entry_id FROM bank_reconciliation_records WHERE id = ?').get(res.results[0].record_id) as any
    const lines = db.prepare('SELECT account_id, debit, credit FROM journal_lines WHERE journal_entry_id = ? ORDER BY line_number').all(rec.journal_entry_id) as any[]
    expect(lines).toEqual([
      { account_id: accId(t, ACC.CASH), debit: 850, credit: 0 },
      { account_id: bankId, debit: 0, credit: 850 },
    ])
  })

  it('10. OWNER_*: entity_type NULL ถูกปฏิเสธให้ตั้งรูปแบบกิจการ · INDIVIDUAL ใช้ 3106/3101 · COMPANY ใช้ 1114 (พร้อมคำเตือน)/2110 · counter_account_code อื่นถูกปฏิเสธ', () => {
    const u = setup('ADMIN', { entityType: null })
    const t = u.tenantId
    const { id: bankId } = addBank(t, '1102-01')

    // entity_type = NULL → ปฏิเสธด้วย "ตั้งรูปแบบกิจการ"
    const nullRes = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: 0,
      lines: [baseLine({ statement_line_no: 1, statement_ref: 'O-NULL', type: 'OWNER_PERSONAL', amount: 200 })],
    })
    expect(nullRes.results[0].status).toBe('rejected')
    expect(nullRes.results[0].errors![0]).toContain('ตั้งรูปแบบกิจการ')

    // INDIVIDUAL: OWNER_PERSONAL → Dr 3106 / Cr bank, OWNER_CAPITAL → Dr bank / Cr 3101
    db.prepare('UPDATE company_settings SET entity_type = ? WHERE tenant_id = ?').run('INDIVIDUAL', t)
    const indRes = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: 700,
      lines: [
        baseLine({ statement_line_no: 2, statement_ref: 'O-IND-P', type: 'OWNER_PERSONAL', amount: 300 }),
        baseLine({ statement_line_no: 3, statement_ref: 'O-IND-C', type: 'OWNER_CAPITAL', amount: 1000 }),
      ],
    })
    expect(indRes.results.map(r => r.status)).toEqual(['accepted', 'accepted'])
    expect(indRes.results[0].warnings).toBeUndefined()

    const drAccountOf = (recId: string) => {
      const jeId = (db.prepare('SELECT journal_entry_id FROM bank_reconciliation_records WHERE id = ?').get(recId) as any).journal_entry_id
      return (db.prepare('SELECT a.code FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id = ? AND jl.debit > 0').get(jeId) as any).code
    }
    const crAccountOf = (recId: string) => {
      const jeId = (db.prepare('SELECT journal_entry_id FROM bank_reconciliation_records WHERE id = ?').get(recId) as any).journal_entry_id
      return (db.prepare('SELECT a.code FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id = ? AND jl.credit > 0').get(jeId) as any).code
    }
    expect(drAccountOf(indRes.results[0].record_id!)).toBe(ACC.OWNER_DRAWINGS) // 3106
    expect(crAccountOf(indRes.results[1].record_id!)).toBe(ACC.CAPITAL) // 3101

    // COMPANY: OWNER_PERSONAL → Dr 1114 + warning, OWNER_CAPITAL → Cr 2110, counter_account_code นอกเหนือ 2110/3101 → ปฏิเสธ
    db.prepare('UPDATE company_settings SET entity_type = ? WHERE tenant_id = ?').run('COMPANY', t)
    const coBadRes = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: 2300,
      lines: [
        baseLine({ statement_line_no: 6, statement_ref: 'O-BAD-CNT', type: 'OWNER_CAPITAL', counter_account_code: '2101', amount: 500 }),
      ],
    })
    expect(coBadRes.results[0].status).toBe('rejected')
    expect(coBadRes.results[0].errors![0]).toContain('counter_account_code')

    const coRes = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: 2300,
      lines: [
        baseLine({ statement_line_no: 4, statement_ref: 'O-CO-P', type: 'OWNER_PERSONAL', amount: 400 }),
        baseLine({ statement_line_no: 5, statement_ref: 'O-CO-C', type: 'OWNER_CAPITAL', amount: 2000 }),
      ],
    })
    expect(coRes.results[0].status).toBe('accepted')
    expect(coRes.results[0].warnings?.[0]).toContain(ACC.DIRECTOR_LOAN) // 1114
    expect(drAccountOf(coRes.results[0].record_id!)).toBe(ACC.DIRECTOR_LOAN) // 1114
    expect(coRes.results[1].status).toBe('accepted')
    expect(crAccountOf(coRes.results[1].record_id!)).toBe(ACC.OWNER_ADVANCE) // 2110
    expect(bankId).toBeTruthy()
  })

  it('11. ประเภทอ้างเอกสารต้นทาง: UNRECORDED_RECEIPT (invoice_id) และ DUPLICATE (SUPPLIER_PAYMENT / MANUAL / POS_SALE)', () => {
    const u = setup('ADMIN')
    const t = u.tenantId
    const { id: bankId, bankRowId } = addBank(t, '1102-01')
    const now = new Date().toISOString()

    // 11a) ลูกค้า + ใบสั่งขาย + ใบแจ้งหนี้ขายค้างชำระ 1,000 บาท
    const custId = generateId()
    db.prepare(`INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, created_at, updated_at)
      VALUES (?, ?, 'C-01', 'ลูกค้า ทดสอบ', 'CORPORATE', 'คุณทดสอบ', 'c@test.com', '0812345678', 'กรุงเทพฯ', ?, ?)`).run(custId, t, now, now)
    const soId = generateId()
    db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, order_date, subtotal, total_amount, status, payment_status, created_at, updated_at)
      VALUES (?, ?, 'SO-2026-001', ?, '2026-10-05', 1000, 1000, 'CONFIRMED', 'UNPAID', ?, ?)`).run(soId, t, custId, now, now)
    const invId = generateId()
    db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, invoice_date, due_date, subtotal, tax_amount, total_amount,
      paid_amount, balance_amount, status, payment_status, created_at, updated_at)
      VALUES (?, ?, 'INV-2026-001', ?, ?, '2026-10-05', '2026-10-20', 1000, 0, 1000, 0, 1000, 'SENT', 'UNPAID', ?, ?)`).run(invId, t, soId, custId, now, now)

    // 11b) ผู้ขาย + ใบสั่งซื้อ + ใบแจ้งหนี้ซื้อ + ใบจ่ายเงินผู้ขายที่ลงซ้ำ 600 บาท
    const supId = generateId()
    db.prepare(`INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, 'S-01', 'ผู้ขาย ทดสอบ', 'คุณสมชาย')`).run(supId, t)
    const poId = generateId()
    db.prepare(`INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_rate, tax_amount, total_amount, created_at, updated_at)
      VALUES (?, ?, 'PO-2026-001', ?, 'RECEIVED', 600, 0, 0, 600, ?, ?)`).run(poId, t, supId, now, now)
    const piId = generateId()
    db.prepare(`INSERT INTO purchase_invoices (id, tenant_id, pi_number, purchase_order_id, supplier_id, invoice_date, subtotal, tax_amount, total_amount,
      paid_amount, balance_amount, status, payment_status, created_at, updated_at)
      VALUES (?, ?, 'PI-2026-001', ?, ?, '2026-10-03', 600, 0, 600, 600, 0, 'CONFIRMED', 'PAID', ?, ?)`).run(piId, t, poId, supId, now, now)
    const spId = generateId()
    db.prepare(`INSERT INTO supplier_payments (id, tenant_id, payment_number, supplier_id, purchase_invoice_id, payment_date,
      payment_method, amount, withholding_tax, net_amount, bank_account_id, created_at, updated_at)
      VALUES (?, ?, 'SP-2026-001', ?, ?, '2026-10-10', 'TRANSFER', 600, 0, 600, ?, ?, ?)`).run(spId, t, supId, piId, bankRowId, now, now)
    const spJe = insertJe(t, [{ code: ACC.AP, debit: 600 }, { code: '1102-01', credit: 600 }], {
      date: '2026-10-10', auto: 1, refType: 'SUPPLIER_PAYMENT', refId: spId,
    })

    // 11c) รายการบันทึกเอง (MANUAL) และรายการอัตโนมัติประเภทอื่น (POS_SALE)
    const manualJe = insertJe(t, [{ code: '5306', debit: 200 }, { code: '1102-01', credit: 200 }], { auto: 0, refType: 'MANUAL' })
    const posJe = insertJe(t, [{ code: '1102-01', debit: 350 }, { code: '4101', credit: 350 }], { auto: 1, refType: 'POS_SALE' })

    const res = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: 1350,
      lines: [
        // ยอดตรงใบแจ้งหนี้ → รับโดยยังไม่สร้าง JV
        baseLine({ statement_line_no: 2, statement_ref: 'UR-OK', date: '2026-10-18', type: 'UNRECORDED_RECEIPT', invoice_id: invId, amount: 1000 }),
        // DUPLICATE ใบจ่ายเงินผู้ขาย → รับโดยยังไม่สร้าง JV
        baseLine({ statement_line_no: 3, statement_ref: 'DUP-SP', date: '2026-10-19', type: 'DUPLICATE', ref_line_id: spJe.lineIds['1102-01'], amount: 600 }),
        // DUPLICATE รายการ MANUAL → สร้างร่าง JV กลับรายการ
        baseLine({ statement_line_no: 4, statement_ref: 'DUP-MAN', date: '2026-10-20', type: 'DUPLICATE', ref_line_id: manualJe.lineIds['1102-01'], amount: 200 }),
      ],
    })
    expect(res.results.map(r => r.status)).toEqual(['accepted', 'accepted', 'accepted'])

    const badRes = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: 1350,
      lines: [
        // ยอดเกินใบแจ้งหนี้ → ปฏิเสธ
        baseLine({ statement_line_no: 1, statement_ref: 'UR-OVER', type: 'UNRECORDED_RECEIPT', invoice_id: invId, amount: 1000.5 }),
        // ส่ง UNRECORDED_RECEIPT ซ้ำใบแจ้งหนี้เดิมจนเกินยอดค้าง → ปฏิเสธ
        baseLine({ statement_line_no: 20, statement_ref: 'UR-DUP-INV', date: '2026-10-18', type: 'UNRECORDED_RECEIPT', invoice_id: invId, amount: 100 }),
        // DUPLICATE อ้าง ref_line_id เดิมซ้ำ → ปฏิเสธ
        baseLine({ statement_line_no: 40, statement_ref: 'DUP-MAN-2', date: '2026-10-20', type: 'DUPLICATE', ref_line_id: manualJe.lineIds['1102-01'], amount: 200 }),
        // DUPLICATE เอกสารอัตโนมัติ POS_SALE → ปฏิเสธ
        baseLine({ statement_line_no: 5, statement_ref: 'DUP-POS', type: 'DUPLICATE', ref_line_id: posJe.lineIds['1102-01'], amount: 350 }),
      ],
    })
    expect(badRes.results.map(r => r.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected'])
    expect(badRes.results[0].errors![0]).toContain('เกินยอดค้าง')
    expect(badRes.results[1].errors![0]).toContain('เกินยอดค้าง')
    expect(badRes.results[2].errors![0]).toContain('ยอดแก้รวมเกินยอดรายการเดิม')
    expect(badRes.results[3].errors![0]).toContain('POS_SALE')

    const urRec = db.prepare('SELECT * FROM bank_reconciliation_records WHERE id = ?').get(res.results[0].record_id) as any
    expect(urRec.journal_entry_id).toBeNull()
    expect(urRec.source_doc_type).toBe('INVOICE')
    expect(urRec.source_doc_id).toBe(invId)

    const spRec = db.prepare('SELECT * FROM bank_reconciliation_records WHERE id = ?').get(res.results[1].record_id) as any
    expect(spRec.journal_entry_id).toBeNull()
    expect(spRec.source_doc_type).toBe('SUPPLIER_PAYMENT_VOID')
    expect(spRec.source_doc_id).toBe(spId)

    const manRec = db.prepare('SELECT * FROM bank_reconciliation_records WHERE id = ?').get(res.results[2].record_id) as any
    expect(manRec.journal_entry_id).toBeTruthy()

    // อนุมัติ UNRECORDED_RECEIPT → สร้างใบเสร็จด้วย recordCustomerPayment วันที่ตาม statement, ตัดยอดค้างใบแจ้งหนี้, ลงบัญชี PAYMENT เข้า 1102-01
    approveCloseGroup(t, PERIOD, 'UNRECORDED_RECEIPT', u.actor)
    const invAfter = db.prepare('SELECT paid_amount, balance_amount, payment_status FROM invoices WHERE id = ?').get(invId) as any
    expect(invAfter).toEqual({ paid_amount: 1000, balance_amount: 0, payment_status: 'PAID' })
    const receipt = db.prepare('SELECT id, receipt_date, amount FROM receipts WHERE invoice_id = ? AND tenant_id = ?').get(invId, t) as any
    expect(receipt).toMatchObject({ receipt_date: '2026-10-18', amount: 1000 })
    const payJe = db.prepare(`SELECT id, date FROM journal_entries WHERE tenant_id = ? AND reference_type = 'PAYMENT' AND reference_id = ?`).get(t, receipt.id) as any
    expect(payJe.date.slice(0, 10)).toBe('2026-10-18')
    const payBankLine = db.prepare('SELECT debit, credit FROM journal_lines WHERE journal_entry_id = ? AND account_id = ?').get(payJe.id, bankId) as any
    expect(payBankLine).toEqual({ debit: 1000, credit: 0 })

    // อนุมัติ DUPLICATE → ยกเลิกใบจ่ายเงินผู้ขาย คืนยอดค้างใบแจ้งหนี้ซื้อ และ post ร่างกลับรายการ MANUAL
    approveCloseGroup(t, PERIOD, 'DUPLICATE', u.actor)
    const spAfter = db.prepare('SELECT status FROM supplier_payments WHERE id = ?').get(spId) as any
    expect(spAfter.status).toBe('CANCELLED')
    const piAfter = db.prepare('SELECT paid_amount, balance_amount, payment_status FROM purchase_invoices WHERE id = ?').get(piId) as any
    expect(piAfter).toEqual({ paid_amount: 0, balance_amount: 600, payment_status: 'UNPAID' })
    const manJeAfter = db.prepare('SELECT is_posted FROM journal_entries WHERE id = ?').get(manRec.journal_entry_id) as any
    expect(manJeAfter.is_posted).toBe(1)
  })

  it('12. สมการกระทบยอด (book + pending + timing = statement) และ TIMING: difference/reconciled ตรง · ไม่ลงตัวก็ยังเก็บร่าง · TIMING สถานะ NOTED ไม่สร้าง JV ทิ้งได้ และห้ามซ้ำ ref เดิมในงวด', () => {
    const u = setup('ADMIN')
    const t = u.tenantId
    addBank(t, '1102-01')

    // ยอดตามบัญชี (book) = +1000 (รับเงิน) - 200 (จ่ายเช็คที่ธนาคารยังไม่ตัด) = 800
    insertJe(t, [{ code: '1102-01', debit: 1000 }, { code: '4101', credit: 1000 }])
    const unpresented = insertJe(t, [{ code: '5306', debit: 200 }, { code: '1102-01', credit: 200 }])

    // ส่งค่าธรรมเนียม -20 (pending = -20) + TIMING ของรายการจ่าย -200 (timing = +200)
    // ดังนั้น book (800) + pending (-20) + timing (+200) = 980
    // ถ้าระบุ statement = 950 → difference = -30, reconciled = false แต่ร่างยังถูกเก็บไว้
    const batchDupTiming = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: 950,
      lines: [
        baseLine({ statement_line_no: 2, statement_ref: 'EQ-TIM', type: 'TIMING', ref_line_id: unpresented.lineIds['1102-01'], amount: 200 }),
        baseLine({ statement_line_no: 22, statement_ref: 'EQ-TIM-BATCH-DUP', type: 'TIMING', ref_line_id: unpresented.lineIds['1102-01'], amount: 200 }),
      ],
    })
    expect(batchDupTiming.results[1].status).toBe('rejected')
    expect(batchDupTiming.results[1].errors![0]).toContain('ถูกระบุเป็นรายการระหว่างทางของงวดนี้ไปแล้ว')

    const notEq = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: 950,
      lines: [
        baseLine({ statement_line_no: 1, statement_ref: 'EQ-FEE', type: 'BANK_FEE', amount: 20 }),
        baseLine({ statement_line_no: 2, statement_ref: 'EQ-TIM', type: 'TIMING', ref_line_id: unpresented.lineIds['1102-01'], amount: 200 }),
      ],
    })
    expect(notEq.summary).toMatchObject({
      accepted: 2, rejected: 0, book_closing_balance: 800, pending_adjustments: -20, timing_items: 200,
      statement_closing_balance: 950, difference: -30, reconciled: false,
    })
    const timingRecId = notEq.results[1].record_id!
    const timingRec = db.prepare('SELECT status, journal_entry_id, effect FROM bank_reconciliation_records WHERE id = ?').get(timingRecId) as any
    expect(timingRec).toEqual({ status: 'NOTED', journal_entry_id: null, effect: 200 })

    // ส่ง TIMING อ้าง ref_line_id เดิมซ้ำในงวดเดียวกัน → ปฏิเสธ
    const dupTiming = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: 980,
      lines: [
        baseLine({ statement_line_no: 3, statement_ref: 'EQ-TIM-DUP', type: 'TIMING', ref_line_id: unpresented.lineIds['1102-01'], amount: 200 }),
      ],
    })
    expect(dupTiming.results[0].status).toBe('rejected')
    expect(dupTiming.results[0].errors![0]).toContain('ถูกระบุเป็นรายการระหว่างทางของงวดนี้ไปแล้ว')

    // และเมื่อส่ง statement = 980 → difference = 0, reconciled = true
    const eqOk = submitCloseAdjustments(t, u.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: 980,
      lines: [],
    })
    expect(eqOk.summary).toMatchObject({
      book_closing_balance: 800, pending_adjustments: -20, timing_items: 200,
      statement_closing_balance: 980, difference: 0, reconciled: true,
    })

    // TIMING ทิ้ง (discard) ได้ → timing กลับเป็น 0
    discardCloseRecord(t, timingRecId, u.actor, 'ธนาคารตัดจ่ายใน statement ที่อัปเดตแล้ว')
    const stAfter = reconciliationStatus(t, PERIOD)[0]
    expect(stAfter.timing).toBe(0)
    expect(stAfter.counts.discarded).toBe(1)
  })

  it('13. การอนุมัติ/ปฏิเสธ/ทิ้งรายการ และล็อกสมุดรายวัน: ADMIN post ทันที · USER แผนกบัญชีสร้างคำขออนุมัติ · อนุมัติ/ปฏิเสธผ่าน approval route · ห้ามทิ้งระหว่างรออนุมัติ · สมุดรายวันปฏิเสธ post/แก้ไข/ลบ CLOSE_ADJUSTMENT ตรง ๆ', async () => {
    const admin = setup('ADMIN')
    const t = admin.tenantId
    addBank(t, '1102-01')
    const acct = setup('USER', { tenantId: t, departments: ['ACCOUNTING'] })

    const sub = submitCloseAdjustments(t, acct.actor, {
      period: PERIOD, bank_account_code: '1102-01', statement_closing_balance: -95,
      lines: [
        baseLine({ statement_line_no: 1, statement_ref: 'AP-1', type: 'BANK_FEE', amount: 25 }),
        baseLine({ statement_line_no: 2, statement_ref: 'AP-2', type: 'INTEREST_INCOME', amount: 30 }),
        baseLine({ statement_line_no: 3, statement_ref: 'AP-3', type: 'MISSING_EXPENSE', account_code: '5306', amount: 100 }),
      ],
    })
    const feeRecId = sub.results[0].record_id!
    const intRecId = sub.results[1].record_id!
    const expRecId = sub.results[2].record_id!
    const expJeId = (db.prepare('SELECT journal_entry_id FROM bank_reconciliation_records WHERE id = ?').get(expRecId) as any).journal_entry_id

    // สมุดรายวันปฏิเสธการ post / แก้ไข / ลบ ร่าง CLOSE_ADJUSTMENT โดยตรง (400)
    const postDirect = await request(app).post(`/api/journal/${expJeId}/post`).set('Authorization', `Bearer ${admin.token}`)
    expect(postDirect.status).toBe(400)
    const editDirect = await request(app).put(`/api/journal/${expJeId}`).set('Authorization', `Bearer ${admin.token}`)
      .send({ date: DATE, description: 'แอบแก้', lines: [] })
    expect(editDirect.status).toBe(400)
    const delDirect = await request(app).delete(`/api/journal/${expJeId}`).set('Authorization', `Bearer ${admin.token}`)
    expect(delDirect.status).toBe(400)

    // ADMIN อนุมัติกลุ่ม BANK_FEE → mode 'posted' ทันที
    const adminApp = approveCloseGroup(t, PERIOD, 'BANK_FEE', admin.actor)
    expect(adminApp).toEqual({ mode: 'posted', posted: 1 })
    expect((db.prepare('SELECT status FROM bank_reconciliation_records WHERE id = ?').get(feeRecId) as any).status).toBe('POSTED')

    // USER แผนกบัญชีอนุมัติกลุ่ม INTEREST_INCOME → mode 'requested', สถานะ PENDING_APPROVAL
    const req1 = approveCloseGroup(t, PERIOD, 'INTEREST_INCOME', acct.actor)
    expect(req1.mode).toBe('requested')
    expect((db.prepare('SELECT status FROM bank_reconciliation_records WHERE id = ?').get(intRecId) as any).status).toBe('PENDING_APPROVAL')

    // ห้าม discard รายการที่อยู่ระหว่าง PENDING_APPROVAL
    expect(() => discardCloseRecord(t, intRecId, acct.actor, 'ขอยกเลิกตอนรออนุมัติ')).toThrowError(expect.objectContaining({ status: 400 }))

    // ADMIN ปฏิเสธคำขอผ่าน PUT /api/approval/requests/:id/decision → กลับเป็น DRAFT
    const req1Row = db.prepare('SELECT id FROM approval_requests WHERE tenant_id = ? AND request_number = ?').get(t, req1.requestNumber) as any
    const rejRes = await request(app).put(`/api/approval/requests/${req1Row.id}/decision`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'REJECTED', comment: 'ตรวจเอกสารแนบอีกครั้ง' })
    expect(rejRes.status).toBe(200)
    expect((db.prepare('SELECT status, approval_request_id FROM bank_reconciliation_records WHERE id = ?').get(intRecId) as any))
      .toEqual({ status: 'DRAFT', approval_request_id: null })

    // ทิ้งรายการ DRAFT (INTEREST_INCOME) → ลบร่าง JV ทิ้ง เก็บแถวเป็น DISCARDED พร้อมเหตุผล
    const intJeId = (db.prepare('SELECT journal_entry_id FROM bank_reconciliation_records WHERE id = ?').get(intRecId) as any).journal_entry_id
    discardCloseRecord(t, intRecId, acct.actor, 'รายการซ้ำกับใบสำคัญอื่น')
    expect(db.prepare('SELECT id FROM journal_entries WHERE id = ?').get(intJeId)).toBeUndefined()
    expect(db.prepare('SELECT status, journal_entry_id, discard_reason FROM bank_reconciliation_records WHERE id = ?').get(intRecId))
      .toEqual({ status: 'DISCARDED', journal_entry_id: null, discard_reason: 'รายการซ้ำกับใบสำคัญอื่น' })

    // USER แผนกบัญชีขออนุมัติ MISSING_EXPENSE → ADMIN อนุมัติผ่าน approval route → post ร่าง JV สำเร็จ
    const req2 = approveCloseGroup(t, PERIOD, 'MISSING_EXPENSE', acct.actor)
    const req2Row = db.prepare('SELECT id FROM approval_requests WHERE tenant_id = ? AND request_number = ?').get(t, req2.requestNumber) as any
    const appRes = await request(app).put(`/api/approval/requests/${req2Row.id}/decision`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'APPROVED', comment: 'อนุมัติให้ลงบัญชี' })
    expect(appRes.status).toBe(200)
    expect((db.prepare('SELECT status FROM bank_reconciliation_records WHERE id = ?').get(expRecId) as any).status).toBe('POSTED')
    expect((db.prepare('SELECT is_posted FROM journal_entries WHERE id = ?').get(expJeId) as any).is_posted).toBe(1)
  })

  it('14. ด่านปิดงวด (POST /api/period-closing/close/:id): ตรวจรหัสผ่านก่อน แล้วปฏิเสธ 400 เมื่อด่านตรวจมี block (บัญชีธนาคารมีรายการแต่ยังไม่ส่ง statement)', async () => {
    const u = setup('ADMIN')
    const t = u.tenantId
    addBank(t, '1102-01')

    // มีรายการเคลื่อนไหวในบัญชีธนาคาร 1102-01 แต่ยังไม่เคยส่ง statement → ด่าน bank_reconciled เป็น block
    insertJe(t, [{ code: '1102-01', debit: 5000 }, { code: '4101', credit: 5000 }])
    const tpId = ensurePeriod(t, '2026-10-01')

    // รหัสผ่านผิด → 401 ก่อนถึงด่าน checklist
    const badPass = await request(app).post(`/api/period-closing/close/${tpId}`)
      .set('Authorization', `Bearer ${u.token}`)
      .send({ password: 'WrongPassword!' })
    expect(badPass.status).toBe(401)

    // รหัสผ่านถูก แต่ยังไม่กระทบยอดธนาคาร → 400 ปิดงวดไม่ได้
    const blocked = await request(app).post(`/api/period-closing/close/${tpId}`)
      .set('Authorization', `Bearer ${u.token}`)
      .send({ password: 'Secret#123' })
    expect(blocked.status).toBe(400)
    expect(blocked.body.message).toContain('ด่านตรวจไม่ผ่าน')
    expect((db.prepare('SELECT status FROM tax_periods WHERE id = ?').get(tpId) as any).status).toBe('OPEN')
  })

  it('15. buildClosePack และ REST: บรรทัดมี lineId และยอดคงเหลือสะสมเฉพาะที่ post แล้ว · แสดงบัญชีหัวที่ค้างยอด · types มีครบ 13 ประเภทพร้อม allowedAccounts · GET /pack และ /instructions.md ตอบ 200 · งวดผิดรูปแบบตอบ 400 ภาษาไทย', async () => {
    const u = setup('ADMIN', { entityType: 'COMPANY' })
    const t = u.tenantId

    // ลงรายการที่ 1102 ก่อนเพิ่มบัญชีย่อย เพื่อให้มี headerBalance ค้างอยู่
    insertJe(t, [{ code: ACC.BANK, debit: 900 }, { code: '4101', credit: 900 }], { date: '2026-10-02' })
    addBank(t, '1102-01')

    // ยอดยกมาก่อนงวด (ก.ย.) = 1000 · ในงวด (ต.ค.): post แล้ว +500, ร่าง -120, post แล้ว -200
    insertJe(t, [{ code: '1102-01', debit: 1000 }, { code: '4101', credit: 1000 }], { date: '2026-09-25' })
    insertJe(t, [{ code: '1102-01', debit: 500 }, { code: '4101', credit: 500 }], { date: '2026-10-05', posted: 1 })
    insertJe(t, [{ code: '5306', debit: 120 }, { code: '1102-01', credit: 120 }], { date: '2026-10-10', posted: 0 })
    insertJe(t, [{ code: '5306', debit: 200 }, { code: '1102-01', credit: 200 }], { date: '2026-10-20', posted: 1 })

    const pack = buildClosePack(t, PERIOD)
    const bankPack = pack.accounts.find(a => a.code === '1102-01')!
    expect(bankPack.opening).toBe(1000)
    expect(bankPack.closing).toBe(1300)
    expect(bankPack.lines).toHaveLength(3)
    expect(bankPack.lines.every(l => typeof l.lineId === 'string' && l.lineId.length > 0)).toBe(true)
    expect(bankPack.lines.map(l => ({ posted: l.posted, balance: l.balance }))).toEqual([
      { posted: true, balance: 1500 },
      { posted: false, balance: null },
      { posted: true, balance: 1300 },
    ])

    expect(pack.headerBalances).toContainEqual(expect.objectContaining({ code: ACC.BANK, balance: 900 }))
    expect(pack.types).toHaveLength(13)
    expect(pack.types.map(x => x.type)).toEqual(Object.keys(ADJ_TYPES))
    for (const tp of pack.types) {
      expect(Array.isArray(tp.allowedAccounts)).toBe(true)
    }

    const packRes = await request(app).get(`/api/month-close/${PERIOD}/pack`).set('Authorization', `Bearer ${u.token}`)
    expect(packRes.status).toBe(200)
    expect(packRes.body.data.period).toBe(PERIOD)

    const mdRes = await request(app).get(`/api/month-close/${PERIOD}/instructions.md`).set('Authorization', `Bearer ${u.token}`)
    expect(mdRes.status).toBe(200)
    expect(mdRes.headers['content-type']).toContain('text/markdown')
    expect(mdRes.text).toContain('submit_close_adjustments')

    const badPeriod = await request(app).get('/api/month-close/2026-13/pack').set('Authorization', `Bearer ${u.token}`)
    expect(badPeriod.status).toBe(400)
    expect(badPeriod.body.message).toMatch(/[ก-๙]/)
  })

  it('16. (A) ส่งงวด 2026-08 แต่บรรทัดลงวันที่ต.ค.ทั้งหมด → ปฏิเสธทุกบรรทัด ไม่สร้างแถว bank_reconciliations/records ไม่ขยับเลข JOURNAL และ summary.saved === false', () => {
    const u = setup('ADMIN')
    const t = u.tenantId
    addBank(t, '1102-01')
    const seqBefore = jvSeq(t)

    const res = submitCloseAdjustments(t, u.actor, {
      period: '2026-08',
      bank_account_code: '1102-01',
      statement_closing_balance: 1171476.55,
      lines: [
        baseLine({ statement_line_no: 1, statement_ref: 'AUG-1', date: '2026-10-15', amount: 50 }),
        baseLine({ statement_line_no: 2, statement_ref: 'AUG-2', date: '2026-10-20', type: 'INTEREST_INCOME', amount: 100 }),
      ],
    })

    expect(res.results.map(r => r.status)).toEqual(['rejected', 'rejected'])
    expect(db.prepare('SELECT * FROM bank_reconciliations WHERE tenant_id = ? AND period = ?').get(t, '2026-08')).toBeUndefined()
    expect((db.prepare('SELECT COUNT(*) AS n FROM bank_reconciliation_records WHERE tenant_id = ?').get(t) as any).n).toBe(0)
    expect(jvSeq(t)).toBe(seqBefore)
    expect(res.summary.saved).toBe(false)
    expect(res.summary.reconciled).toBe(false)
    expect(res.summary.rejected).toBe(2)
    expect(res.summary.not_saved).toBe(0)
    expect(res.summary.message).toBe('ไม่ได้บันทึกอะไรเลย: มี 2 บรรทัดถูกปฏิเสธ — แก้ตาม errors ของแต่ละบรรทัดแล้วส่งทั้งชุดใหม่ (ส่งซ้ำได้ ระบบกันซ้ำ) · ยอด statement ยังไม่ถูกบันทึก')
  })

  it('17. (B) ส่งชุดสะอาดบันทึกยอด statement 1000 แล้วส่งชุดผสม (ดี 1 + ผิด 1) ด้วยยอด 2000 → หัวกระทบยอดยังเป็น 1000 บรรทัดที่ดีได้สถานะ not_saved ไม่สร้าง record/JE และไม่ขยับเลข JOURNAL', () => {
    const u = setup('ADMIN')
    const t = u.tenantId
    addBank(t, '1102-01')

    const clean = submitCloseAdjustments(t, u.actor, {
      period: PERIOD,
      bank_account_code: '1102-01',
      statement_closing_balance: 1000,
      lines: [baseLine({ statement_line_no: 1, statement_ref: 'CLN-1', type: 'BANK_FEE', amount: 25 })],
    })
    expect(clean.summary.saved).toBe(true)
    expect(clean.summary.accepted).toBe(1)
    expect(clean.summary.not_saved).toBe(0)

    const seqAfterClean = jvSeq(t)
    const recCountAfterClean = (db.prepare('SELECT COUNT(*) AS n FROM bank_reconciliation_records WHERE tenant_id = ?').get(t) as any).n
    const jeCountAfterClean = (db.prepare('SELECT COUNT(*) AS n FROM journal_entries WHERE tenant_id = ?').get(t) as any).n

    const mixed = submitCloseAdjustments(t, u.actor, {
      period: PERIOD,
      bank_account_code: '1102-01',
      statement_closing_balance: 2000,
      lines: [
        baseLine({ statement_line_no: 2, statement_ref: 'MIX-OK', type: 'INTEREST_INCOME', amount: 80 }),
        baseLine({ statement_line_no: 3, statement_ref: 'MIX-BAD', type: 'MISSING_EXPENSE', account_code: '5999', amount: 150 }),
      ],
    })

    const header = db.prepare('SELECT statement_closing_balance FROM bank_reconciliations WHERE tenant_id = ? AND period = ?').get(t, PERIOD) as any
    expect(header.statement_closing_balance).toBe(1000)
    expect(mixed.results[0].status).toBe('not_saved')
    expect(mixed.results[0].record_id).toBeUndefined()
    expect(mixed.results[0].entry_number).toBeUndefined()
    expect(mixed.results[0].warnings).toContain('ยังไม่บันทึก — ชุดนี้มีบรรทัดที่ถูกปฏิเสธ ระบบจึงไม่บันทึกทั้งชุด (รวมยอด statement) แก้บรรทัดที่ถูกปฏิเสธแล้วส่งทั้งชุดใหม่')
    expect(mixed.results[1].status).toBe('rejected')
    expect((db.prepare('SELECT COUNT(*) AS n FROM bank_reconciliation_records WHERE tenant_id = ?').get(t) as any).n).toBe(recCountAfterClean)
    expect((db.prepare('SELECT COUNT(*) AS n FROM journal_entries WHERE tenant_id = ?').get(t) as any).n).toBe(jeCountAfterClean)
    expect(jvSeq(t)).toBe(seqAfterClean)

    expect(mixed.summary.saved).toBe(false)
    expect(mixed.summary.reconciled).toBe(false)
    expect(mixed.summary.accepted).toBe(0)
    expect(mixed.summary.not_saved).toBe(1)
    expect(mixed.summary.rejected).toBe(1)
    expect(mixed.summary.message).toBe('ไม่ได้บันทึกอะไรเลย: มี 1 บรรทัดถูกปฏิเสธ — แก้ตาม errors ของแต่ละบรรทัดแล้วส่งทั้งชุดใหม่ (ส่งซ้ำได้ ระบบกันซ้ำ) · ยอด statement ยังไม่ถูกบันทึก')
  })

  it('18. (C) ส่ง lines: [] พร้อม statement_closing_balance 500 ยังสร้างหัวกระทบยอดด้วยยอด 500 ตามปกติ', () => {
    const u = setup('ADMIN')
    const t = u.tenantId
    addBank(t, '1102-01')

    const res = submitCloseAdjustments(t, u.actor, {
      period: PERIOD,
      bank_account_code: '1102-01',
      statement_closing_balance: 500,
      lines: [],
    })
    expect(res.summary.saved).toBe(true)
    expect(res.summary.not_saved).toBe(0)
    expect(res.summary.rejected).toBe(0)
    const header = db.prepare('SELECT statement_closing_balance FROM bank_reconciliations WHERE tenant_id = ? AND period = ?').get(t, PERIOD) as any
    expect(header).toEqual({ statement_closing_balance: 500 })
  })
})
