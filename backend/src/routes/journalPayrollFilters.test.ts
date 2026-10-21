import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { getOrCreateAccount } from '../services/accounting.service'
import journalRouter, {
  buildPayrollLines, validatePayroll, PayrollError, listJournalEntries, parseJournalFilter, FilterError,
} from './journal.routes'
import { createTestUser } from '../test/testAuth'

// สมุดรายวัน: ตัวกรองฝั่ง DB + บันทึกเงินเดือนเป็น JE (2026-10)
const app = express()
app.use(express.json())
app.use('/api/journal', journalRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM journal_lines WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM journal_entries WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM accounts WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM users WHERE tenant_id = ?').run(t)
  }
})
const newUser = () => {
  const u = createTestUser({ role: 'ADMIN' })
  tenants.push(u.tenantId)
  return u
}

const ACC_IDS = { salary: 'S', ssPayable: 'SS', whtPayable: 'W', pay: 'BANK', otherDeduction: 'OTH' }

describe('buildPayrollLines', () => {
  const input = validatePayroll({
    period: '2026-10', payDate: '2026-10-31', payAccountId: 'BANK', otherDeductionAccountId: 'OTH',
    ssEmployer: 1500,
    employees: [
      { name: 'สมชาย', gross: 15000, ssEmployee: 750, wht: 200 },
      { name: 'สมหญิง', gross: 12000.5, ssEmployee: 600, otherDeduction: 1000 },
    ],
  })

  it('Dr 5301 (ก่อนหัก+สมทบนายจ้าง) = Cr จ่ายสุทธิ + 2106 + 2105 + หักอื่นๆ และสมดุล', () => {
    const r = buildPayrollLines(input, ACC_IDS)
    const by = (id: string, side: 'debit' | 'credit') =>
      r.lines.filter(l => l.accountId === id).reduce((s, l) => s + (l[side] ?? 0), 0)

    expect(by('S', 'debit')).toBe(27000.5 + 1500)
    expect(by('BANK', 'credit')).toBe(27000.5 - 1350 - 200 - 1000) // 24,450.50
    expect(by('SS', 'credit')).toBe(1350 + 1500)
    expect(by('W', 'credit')).toBe(200)
    expect(by('OTH', 'credit')).toBe(1000)
    expect(r.totalDebit).toBe(28500.5)
    expect(r.totalCredit).toBe(28500.5)
    expect(r.summary.net).toBe(24450.5)
    // ไม่มีบรรทัดศูนย์ · รายละเอียดรายคนอยู่ใน notes และคำอธิบายบรรทัด
    expect(r.lines.every(l => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0)).toBe(true)
    expect(r.notes).toContain('สมหญิง: เงินเดือน 12,000.50')
    expect(r.lines.find(l => l.accountId === 'BANK')!.description).toContain('สมชาย 14,050.00')
  })

  it('ไม่มีภาษี/สมทบ/หักอื่น → ตัดบรรทัดศูนย์ทิ้ง เหลือ Dr 5301 / Cr บัญชีจ่าย', () => {
    const r = buildPayrollLines(validatePayroll({
      period: '2026-10', payDate: '2026-10-31', payAccountId: 'BANK',
      employees: [{ name: 'ยอดรวม', gross: 30000 }],
    }), ACC_IDS)
    expect(r.lines.map(l => l.accountId)).toEqual(['S', 'BANK'])
    expect(r.totalDebit).toBe(30000)
  })
})

describe('validatePayroll', () => {
  const base = { period: '2026-10', payDate: '2026-10-31', payAccountId: 'BANK', employees: [{ name: 'ก', gross: 100 }] }
  it.each([
    [{ payAccountId: '' }, 'บัญชีที่จ่าย'],
    [{ employees: [] }, 'อย่างน้อย 1'],
    [{ employees: [{ name: 'ก', gross: -1 }] }, 'ไม่ติดลบ'],
    [{ employees: [{ name: 'ก', gross: 100, ssEmployee: 80, wht: 30 }] }, 'สุทธิติดลบ'],
    [{ employees: [{ name: 'ก', gross: 100, otherDeduction: 10 }] }, 'บัญชีรับยอดหักอื่นๆ'],
    [{ period: '2026-13' }, 'YYYY-MM'],
    [{ ssEmployer: -5 }, 'ไม่ติดลบ'],
    [{ businessUnit: 'MOON' }, 'หน่วยธุรกิจ'],
  ])('ปฏิเสธ %j', (patch, msg) => {
    expect(() => validatePayroll({ ...base, ...patch })).toThrow(PayrollError)
    expect(() => validatePayroll({ ...base, ...patch })).toThrow(msg)
  })
})

describe('POST /api/journal/payroll', () => {
  it('สร้าง JE แบบร่าง PAYROLL ถูกบัญชี สมดุล และติด business_unit', async () => {
    const u = newUser()
    const bank = getOrCreateAccount(u.tenantId, '1102')
    const res = await request(app).post('/api/journal/payroll').set('Authorization', `Bearer ${u.token}`).send({
      period: '2026-10', payDate: '2026-10-31', payAccountId: bank, businessUnit: 'RETAIL',
      ssEmployer: 750, employees: [{ name: 'สมชาย', gross: 15000, ssEmployee: 750, wht: 100 }],
    })
    expect(res.status).toBe(200)
    const je = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(res.body.data.id) as any
    expect(je.reference_type).toBe('PAYROLL')
    expect(je.reference_id).toBe('2026-10')
    expect(je.is_posted).toBe(0)
    expect(je.business_unit).toBe('RETAIL')
    expect(je.total_debit).toBe(15750)
    expect(je.total_credit).toBe(15750)

    const lines = db.prepare(`
      SELECT a.code, SUM(jl.debit) d, SUM(jl.credit) c FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE jl.journal_entry_id = ? GROUP BY a.code ORDER BY a.code
    `).all(je.id) as Array<{ code: string; d: number; c: number }>
    expect(lines).toEqual([
      { code: '1102', d: 0, c: 14150 },
      { code: '2105', d: 0, c: 100 },
      { code: '2106', d: 0, c: 1500 },
      { code: '5301', d: 15750, c: 0 },
    ])
  })

  it('บัญชีจ่ายต้องเป็นสินทรัพย์ของบริษัทตัวเอง', async () => {
    const u = newUser()
    const expense = getOrCreateAccount(u.tenantId, '5302', 'ค่าเช่า', 'EXPENSE', 'RENT', 'DEBIT')
    const res = await request(app).post('/api/journal/payroll').set('Authorization', `Bearer ${u.token}`).send({
      period: '2026-10', payDate: '2026-10-31', payAccountId: expense, employees: [{ name: 'ก', gross: 100 }],
    })
    expect(res.status).toBe(400)
    expect(db.prepare('SELECT COUNT(*) n FROM journal_entries WHERE tenant_id = ?').get(u.tenantId)).toEqual({ n: 0 })
  })
})

describe('ตัวกรองสมุดรายวัน (กรองใน DB)', () => {
  const seed = (tenantId: string) => {
    const cash = getOrCreateAccount(tenantId, '1101')
    const rev = getOrCreateAccount(tenantId, '4101')
    const exp = getOrCreateAccount(tenantId, '5301', 'เงินเดือนและค่าจ้าง', 'EXPENSE', 'SALARY', 'DEBIT')
    const now = new Date().toISOString()
    const add = (no: string, date: string, ref: string | null, desc: string, amt: number, dr: string, cr: string) => {
      const id = generateId()
      db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, description,
        total_debit, total_credit, is_posted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(id, tenantId, no, date, ref, desc, amt, amt, now, now)
      const line = db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, debit, credit)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
      line.run(generateId(), tenantId, id, dr, 1, amt, 0)
      line.run(generateId(), tenantId, id, cr, 2, 0, amt)
    }
    add('JV-2026-00001', '2026-09-30', 'POS_SALE', 'ขายหน้าร้าน กะเช้า', 500, cash, rev)
    add('JV-2026-00002', '2026-10-05', 'POS_SALE', 'ขายหน้าร้าน กะบ่าย', 1200, cash, rev)
    add('JV-2026-00003', '2026-10-10', null, 'ปรับปรุงเอง', 50, exp, cash)
    add('JV-2026-00004', '2026-10-31', 'PAYROLL', 'บันทึกเงินเดือน งวด 10/2026', 30000, exp, cash)
    return { cash, rev, exp }
  }
  const nos = (r: ReturnType<typeof listJournalEntries>) => r.entries.map(e => e.entry_number).sort()

  it('กรองตามประเภทหลายค่า (MANUAL = reference_type ว่าง) + นับต่อประเภทโดยไม่สนประเภทที่เลือก', () => {
    const t = 'test_jfilter_' + generateId(); tenants.push(t); seed(t)
    const r = listJournalEntries(t, parseJournalFilter({ referenceTypes: 'PAYROLL,MANUAL' }))
    expect(nos(r)).toEqual(['JV-2026-00003', 'JV-2026-00004'])
    expect(Object.fromEntries(r.typeCounts.map(c => [c.type, c.count]))).toEqual({ POS_SALE: 2, MANUAL: 1, PAYROLL: 1 })
  })

  it('ช่วงวันที่ + ช่วงจำนวนเงิน + บัญชีในบรรทัด + ค้นหาข้อความ + เลขที่', () => {
    const t = 'test_jfilter_' + generateId(); tenants.push(t)
    const { rev, exp } = seed(t)
    expect(nos(listJournalEntries(t, parseJournalFilter({ startDate: '2026-10-01', endDate: '2026-10-10' }))))
      .toEqual(['JV-2026-00002', 'JV-2026-00003'])
    expect(nos(listJournalEntries(t, parseJournalFilter({ minDebit: '100', maxDebit: '1200' }))))
      .toEqual(['JV-2026-00001', 'JV-2026-00002'])
    expect(nos(listJournalEntries(t, parseJournalFilter({ minCredit: '1000' }))))
      .toEqual(['JV-2026-00002', 'JV-2026-00004'])
    expect(nos(listJournalEntries(t, parseJournalFilter({ accountId: exp })))).toEqual(['JV-2026-00003', 'JV-2026-00004'])
    expect(nos(listJournalEntries(t, parseJournalFilter({ accountId: rev, q: 'บ่าย' })))).toEqual(['JV-2026-00002'])
    expect(nos(listJournalEntries(t, parseJournalFilter({ entryNumber: '0004' })))).toEqual(['JV-2026-00004'])
    // นับต่อประเภทต้องเคารพตัวกรองอื่น (ช่วงวันที่)
    const counts = listJournalEntries(t, parseJournalFilter({ startDate: '2026-10-01', referenceTypes: 'PAYROLL' })).typeCounts
    expect(Object.fromEntries(counts.map(c => [c.type, c.count]))).toEqual({ POS_SALE: 1, MANUAL: 1, PAYROLL: 1 })
  })

  it('ไม่รั่วข้าม tenant และปฏิเสธค่าผิดรูป', () => {
    const t1 = 'test_jfilter_' + generateId(); const t2 = 'test_jfilter_' + generateId(); tenants.push(t1, t2)
    seed(t1)
    expect(listJournalEntries(t2, parseJournalFilter({})).entries).toEqual([])
    expect(() => parseJournalFilter({ startDate: '31/10/2026' })).toThrow(FilterError)
    expect(() => parseJournalFilter({ minDebit: 'abc' })).toThrow(FilterError)
  })

  it('GET /api/journal ส่ง meta.typeCounts และ 400 เมื่อ query ผิด', async () => {
    const u = newUser(); seed(u.tenantId)
    const ok = await request(app).get('/api/journal?referenceTypes=POS_SALE').set('Authorization', `Bearer ${u.token}`)
    expect(ok.status).toBe(200)
    expect(ok.body.data).toHaveLength(2)
    expect(ok.body.meta.typeCounts.length).toBe(3)
    const bad = await request(app).get('/api/journal?maxCredit=-1').set('Authorization', `Bearer ${u.token}`)
    expect(bad.status).toBe(400)
  })
})
