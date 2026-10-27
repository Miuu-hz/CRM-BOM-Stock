import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import { seedChartOfAccounts } from '../config/chartOfAccounts'
import { ACC } from '../config/accountCodes'
import { MonthCloseError } from './monthClose.service'
import { closeChecklist } from './closeChecklist.service'

const tenants: string[] = []

afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of [
      'bank_reconciliation_records',
      'bank_reconciliations',
      'journal_unposts',
      'journal_lines',
      'journal_entries',
      'vat_entries',
      'invoices',
      'sales_orders',
      'customers',
      'purchase_invoices',
      'goods_receipts',
      'purchase_orders',
      'suppliers',
      'stock_items',
      'subcon_stock',
      'tax_periods',
      'bank_accounts',
      'accounts',
      'company_settings',
      'users',
    ]) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* ignore */ }
    }
  }
})

function setupTenant() {
  const u = createTestUser({ role: 'ADMIN' })
  const t = u.tenantId
  tenants.push(t)
  seedChartOfAccounts(t)
  const accId = (code: string) =>
    (db.prepare('SELECT id FROM accounts WHERE tenant_id = ? AND code = ?').get(t, code) as { id: string }).id
  let seq = 0
  const postJe = (opts: {
    date: string
    lines: Array<[string, number, number]>
    posted?: number
    ref?: string | null
    createdBy?: string | null
    postedBy?: string | null
    description?: string
  }) => {
    const id = generateId()
    const entryNumber = `JV-2026-${String(++seq).padStart(5, '0')}`
    const totalDebit = opts.lines.reduce((s, [, dr]) => s + dr, 0)
    const totalCredit = opts.lines.reduce((s, [, , cr]) => s + cr, 0)
    const isPosted = opts.posted ?? 1
    db.prepare(`
      INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, description,
        total_debit, total_credit, is_posted, created_by, posted_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      id, t, entryNumber, opts.date, opts.ref === undefined ? 'POS_SALE' : opts.ref,
      opts.description ?? 'test', totalDebit, totalCredit, isPosted,
      opts.createdBy ?? 'maker@test.com', isPosted ? (opts.postedBy ?? 'checker@test.com') : null,
    )
    const insLine = db.prepare(`
      INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, debit, credit)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    opts.lines.forEach(([code, dr, cr], i) => {
      insLine.run(generateId(), t, id, accId(code), i + 1, dr, cr)
    })
    return { id, entryNumber }
  }
  return { u, t, accId, postJe }
}

const itemOf = (res: ReturnType<typeof closeChecklist>, key: string) =>
  res.items.find(i => i.key === key)!

describe('closeChecklist (ด่านตรวจปิดงวด 11 ข้อ)', () => {
  it('งวดที่รูปแบบผิด → โยน MonthCloseError(400) · กิจการว่างที่เพิ่งเปิดได้ 11 ข้อครบและปิดงวดได้', () => {
    const { t } = setupTenant()
    expect(() => closeChecklist(t, '2026-13')).toThrow(MonthCloseError)
    const res = closeChecklist(t, '2026-10')
    expect(res.items).toHaveLength(11)
    expect(res.total).toBe(11)
    expect(res.blocks).toBe(0)
    expect(res.warns).toBe(0)
    expect(res.passed).toBe(11)
    expect(res.label).toBe('ผ่าน 11/11')
    expect(res.canClose).toBe(true)
    expect(res.periodStatus).toBe('NONE')
  })

  it('ข้อ 1 trial_balance: มีรายการ post แล้วที่ไม่ดุล → block พร้อมระบุเลขรายการและผลต่าง', () => {
    const { t, postJe } = setupTenant()
    const { entryNumber } = postJe({
      date: '2026-10-10',
      lines: [[ACC.CASH, 1000, 0], [ACC.REVENUE_PRODUCT, 0, 990]],
    })
    // กระทบยอดเงินสดเพื่อดูผลข้อ 1 ชัด ๆ
    const c = closeChecklist(t, '2026-10')
    const tb = itemOf(c, 'trial_balance')
    expect(tb.status).toBe('block')
    expect(tb.amount).toBe(10)
    expect(tb.rows).toEqual([{ entryNumber, date: '2026-10-10', diff: 10 }])
    expect(c.canClose).toBe(false)
  })

  it('ข้อ 2 bank_reconciled และ ข้อ 3 cash_counted: มีความเคลื่อนไหวแต่ยังไม่ส่ง statement → block · ส่งตรงยอดบัญชี → pass', () => {
    const { t, accId, postJe } = setupTenant()
    // เงินสด +2,000 และเงินฝากธนาคาร 1102 +5,000
    postJe({ date: '2026-10-05', lines: [[ACC.CASH, 2000, 0], [ACC.REVENUE_PRODUCT, 0, 2000]] })
    postJe({ date: '2026-10-06', lines: [[ACC.BANK, 5000, 0], [ACC.REVENUE_PRODUCT, 0, 5000]] })

    const before = closeChecklist(t, '2026-10')
    expect(itemOf(before, 'bank_reconciled').status).toBe('block')
    expect(itemOf(before, 'cash_counted').status).toBe('block')
    expect(before.canClose).toBe(false)

    // ส่งยอด statement ธนาคาร = 5000 และยอดนับเงินสดจริง = 2000
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO bank_reconciliations (id, tenant_id, period, account_id, statement_closing_balance, created_at, updated_at)
      VALUES (?, ?, '2026-10', ?, 5000, ?, ?), (?, ?, '2026-10', ?, 2000, ?, ?)
    `).run(generateId(), t, accId(ACC.BANK), now, now, generateId(), t, accId(ACC.CASH), now, now)

    const after = closeChecklist(t, '2026-10')
    expect(itemOf(after, 'bank_reconciled').status).toBe('pass')
    expect(itemOf(after, 'cash_counted').status).toBe('pass')
    expect(after.canClose).toBe(true)
    expect(after.label).toBe('ผ่าน 11/11')
  })

  it('ข้อ 4 no_drafts: มีรายการร่างค้างในงวด → block พร้อมจำนวนและยอดรวม', () => {
    const { t, postJe } = setupTenant()
    const { entryNumber } = postJe({
      date: '2026-10-14',
      posted: 0,
      description: 'ร่างค้าง',
      lines: [[ACC.OTHER_EXPENSE, 450, 0], [ACC.CASH, 0, 450]],
    })
    const res = closeChecklist(t, '2026-10')
    const d = itemOf(res, 'no_drafts')
    expect(d.status).toBe('block')
    expect(d.count).toBe(1)
    expect(d.amount).toBe(450)
    expect(d.rows?.[0]).toMatchObject({ entryNumber, date: '2026-10-14', total: 450 })
    expect(res.canClose).toBe(false)
  })

  it('ข้อ 5 no_negative_cash: เงินสดติดลบระหว่างเดือนแล้วกลับมาบวก → warn พร้อมระบุวันแรกที่ติดลบและยอดต่ำสุด', () => {
    const { t, postJe } = setupTenant()
    postJe({ date: '2026-10-02', lines: [[ACC.CASH, 300, 0], [ACC.REVENUE_PRODUCT, 0, 300]] })
    postJe({ date: '2026-10-08', lines: [[ACC.OTHER_EXPENSE, 500, 0], [ACC.CASH, 0, 500]] }) // สิ้นวัน -200
    postJe({ date: '2026-10-12', lines: [[ACC.CASH, 1000, 0], [ACC.REVENUE_PRODUCT, 0, 1000]] }) // สิ้นวัน +800

    const res = closeChecklist(t, '2026-10')
    const neg = itemOf(res, 'no_negative_cash')
    expect(neg.status).toBe('warn')
    expect(neg.rows).toEqual([
      {
        code: ACC.CASH,
        name: 'เงินสด',
        firstNegativeDate: '2026-10-08',
        minBalance: -200,
        minBalanceDate: '2026-10-08',
      },
    ])
  })

  it('ข้อ 6 no_header_balance: มียอดค้างในบัญชีหัว 1102 → block · ย้ายยอดออกไปยังบัญชีย่อย 1102-01 จนเหลือ 0 → pass', () => {
    const { t, accId, postJe } = setupTenant()
    // ลงรายการที่ 1102 ก่อนสร้างบัญชีย่อย (ไม่ติด trigger)
    postJe({ date: '2026-10-03', lines: [[ACC.AP, 600, 0], [ACC.BANK, 0, 600]] })

    // สร้างบัญชีย่อย 1102-01 ใต้ 1102 → ทำให้ 1102 กลายเป็นบัญชีหัว
    const subId = generateId()
    db.prepare(`
      INSERT INTO accounts (id, tenant_id, code, name, type, category, parent_id, level, is_active, normal_balance)
      VALUES (?, ?, '1102-01', 'กรุงศรี ออมทรัพย์', 'ASSET', 'CASH', ?, 3, 1, 'DEBIT')
    `).run(subId, t, accId(ACC.BANK))

    const blocked = closeChecklist(t, '2026-10')
    const hb1 = itemOf(blocked, 'no_header_balance')
    expect(hb1.status).toBe('block')
    expect(hb1.detail).toContain('WRONG_ACCOUNT')
    expect(hb1.rows).toEqual([{ code: ACC.BANK, name: 'เงินฝากธนาคาร', balance: -600, lineCount: 1 }])

    // ย้ายยอดจาก 1102 → 1102-01 (Dr 1102 600 / Cr 1102-01 600)
    postJe({ date: '2026-10-20', lines: [[ACC.BANK, 600, 0], ['1102-01', 0, 600]] })

    const passed = closeChecklist(t, '2026-10')
    const hb2 = itemOf(passed, 'no_header_balance')
    expect(hb2.status).toBe('pass')
  })

  it('ข้อ 7 clearing_accounts: บัญชีพักรอตรวจสอบ 1190 ค้าง 600 บาท (> เพดาน 500) และเอกสารค้างนานเกิน 30 วัน → warn', () => {
    const { t, postJe } = setupTenant()
    postJe({ date: '2026-09-15', lines: [[ACC.SUSPENSE, 600, 0], [ACC.CASH, 0, 600]] })

    // สร้าง GR ยืนยันแล้วตั้งแต่ 2026-08-01 ที่ยังไม่มีใบแจ้งหนี้ (ค้างนานเกิน 30 วัน)
    const supId = generateId()
    db.prepare(`INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'ผู้ขาย', 'C')`).run(supId, t, `S-${supId.slice(0, 6)}`)
    const poId = generateId()
    db.prepare(`INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, total_amount) VALUES (?, ?, ?, ?, 'APPROVED', 500)`).run(poId, t, `PO-${poId.slice(0, 6)}`, supId)
    const grId = generateId()
    db.prepare(`
      INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, receipt_date, status)
      VALUES (?, ?, 'GR-OLD-1', ?, ?, '2026-08-01', 'CONFIRMED')
    `).run(grId, t, poId, supId)
    const { id: grJeId } = postJe({ date: '2026-08-01', ref: 'GOODS_RECEIPT', lines: [[ACC.RAW_MATERIAL, 500, 0], [ACC.GRNI, 0, 500]] })
    db.prepare(`UPDATE journal_entries SET reference_id = ? WHERE id = ?`).run(grId, grJeId)

    const res = closeChecklist(t, '2026-09')
    const cl = itemOf(res, 'clearing_accounts')
    expect(cl.status).toBe('warn')
    expect(cl.detail).toContain('ค้างนาน')
    expect(cl.detail).toContain('ณ วันนี้')
    expect(cl.rows?.some(r => r.code === ACC.SUSPENSE && r.balance === 600)).toBe(true)
    expect(cl.rows?.some(r => r.kind === 'AGED' && r.docNumber === 'GR-OLD-1')).toBe(true)
  })

  it('ข้อ 2: เงินที่หาที่มาไม่ได้ (1190) เกินเพดานบล็อกการปิดงวด แม้ไม่มีบัญชีธนาคาร · ไม่เกินเพดาน = ไม่บล็อก', () => {
    const { t, postJe } = setupTenant()
    postJe({ date: '2026-09-15', lines: [[ACC.SUSPENSE, 400, 0], [ACC.CASH, 0, 400]] })
    expect(itemOf(closeChecklist(t, '2026-09'), 'bank_reconciled').status).not.toBe('block')
    postJe({ date: '2026-09-16', lines: [[ACC.SUSPENSE, 200, 0], [ACC.CASH, 0, 200]] })
    const item = itemOf(closeChecklist(t, '2026-09'), 'bank_reconciled')
    expect(item.status).toBe('block')
    expect(item.detail).toContain('เกินเพดาน')
  })

  it('ข้อ 8 subledger_match: ยอดลูกหนี้ 1104 ในบัญชีไม่ตรงกับใบแจ้งหนี้ค้างชำระ → warn', () => {
    const { t, postJe } = setupTenant()
    // ในบัญชี AR มี 1,500 บาท แต่ในตาราง invoices มีแค่ 1,000 บาท
    postJe({ date: '2026-10-10', lines: [[ACC.AR, 1500, 0], [ACC.REVENUE_PRODUCT, 0, 1500]] })
    const custId = generateId()
    db.prepare(`
      INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city)
      VALUES (?, ?, ?, 'ลูกค้าทดสอบ', 'RETAIL', 'สมชาย', 'c@test.com', '0812345678', 'BKK')
    `).run(custId, t, `C-${custId.slice(0, 6)}`)
    const soId = generateId()
    db.prepare(`
      INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, order_date, status, total_amount)
      VALUES (?, ?, ?, ?, '2026-10-10', 'CONFIRMED', 1000)
    `).run(soId, t, `SO-${soId.slice(0, 6)}`, custId)
    db.prepare(`
      INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, invoice_date, due_date,
        subtotal, tax_amount, total_amount, paid_amount, balance_amount, status, payment_status)
      VALUES (?, ?, 'INV-001', ?, ?, '2026-10-10', '2026-10-25', 1000, 0, 1000, 0, 1000, 'SENT', 'UNPAID')
    `).run(generateId(), t, soId, custId)

    const res = closeChecklist(t, '2026-10')
    const sub = itemOf(res, 'subledger_match')
    expect(sub.status).toBe('warn')
    expect(sub.detail).toContain('ณ วันนี้')
    expect(sub.rows).toEqual([
      { kind: 'AR', code: ACC.AR, name: 'ลูกหนี้การค้า', ledger: 1500, subledger: 1000, diff: 500 },
    ])
  })

  it('ข้อ 9 stock_value: มูลค่าสต็อกในบัญชีต่างจากในระบบเกินเกณฑ์ → warn', () => {
    const { t, postJe } = setupTenant()
    postJe({ date: '2026-10-05', lines: [[ACC.RAW_MATERIAL, 10000, 0], [ACC.AP, 0, 10000]] })
    // ในระบบมีแค่ 5,000 บาท (ต่างกัน 5,000 > max(1000, 5% * 10000 = 500))
    db.prepare(`
      INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
      VALUES (?, ?, 'SKU-1', 'วัตถุดิบ', 'RAW', 50, 'kg', 'kg', 100, 'MAIN', 'ACTIVE')
    `).run(generateId(), t)

    const res = closeChecklist(t, '2026-10')
    const st = itemOf(res, 'stock_value')
    expect(st.status).toBe('warn')
    expect(st.detail).toContain('ณ วันนี้')
    expect(st.amount).toBe(5000)
  })

  it('ข้อ 10 vat_match: กิจการไม่จด VAT (vat_registered = 0) → na · จด VAT แล้วบัญชีต่างจากทะเบียนภาษี → warn', () => {
    const { t, postJe } = setupTenant()
    db.prepare(`INSERT INTO company_settings (tenant_id, name, vat_registered) VALUES (?, 'ร้านทดสอบ', 0)`).run(t)

    const naRes = closeChecklist(t, '2026-10')
    const vatNa = itemOf(naRes, 'vat_match')
    expect(vatNa.status).toBe('na')
    expect(vatNa.detail).toContain('ไม่ได้จด VAT')

    // เปลี่ยนเป็นจด VAT และลงบัญชีภาษีซื้อ 1110 = 140 บาท โดยไม่มี vat_entries
    db.prepare(`UPDATE company_settings SET vat_registered = 1 WHERE tenant_id = ?`).run(t)
    postJe({ date: '2026-10-11', lines: [[ACC.INPUT_VAT, 140, 0], [ACC.CASH, 0, 140]] })

    const warnRes = closeChecklist(t, '2026-10')
    const vatWarn = itemOf(warnRes, 'vat_match')
    expect(vatWarn.status).toBe('warn')
    expect(vatWarn.amount).toBe(140)
  })

  it('ข้อ 11 manual_anomaly: รายการลงมือโดดจากเดือนก่อน, คนสร้างกับคน post เป็นคนเดียวกัน และประวัติ journal_unposts ในงวด → warn (ไม่นับ PAYROLL/CLOSE_ADJUSTMENT)', () => {
    const { t, postJe } = setupTenant()
    const { entryNumber } = postJe({
      date: '2026-10-18',
      ref: 'MANUAL',
      createdBy: 'SameUser@test.com',
      postedBy: 'sameuser@test.com',
      lines: [[ACC.OTHER_EXPENSE, 200, 0], [ACC.CASH, 0, 200]],
    })
    // เพิ่มอีก 4 รายการ manual (รวมเป็น 5 >= manualSpikeMinCount และเดือนก่อน = 0)
    for (let i = 0; i < 4; i++) {
      postJe({
        date: '2026-10-19',
        ref: i % 2 === 0 ? null : 'ADJUSTMENT',
        lines: [[ACC.OTHER_EXPENSE, 50, 0], [ACC.CASH, 0, 50]],
      })
    }
    // PAYROLL และ CLOSE_ADJUSTMENT ไม่ถูกนับเป็น manual
    postJe({ date: '2026-09-25', ref: 'PAYROLL', lines: [[ACC.OTHER_EXPENSE, 1000, 0], [ACC.CASH, 0, 1000]] })
    postJe({ date: '2026-09-30', ref: 'CLOSE_ADJUSTMENT', lines: [[ACC.OTHER_EXPENSE, 100, 0], [ACC.CASH, 0, 100]] })

    db.prepare(`
      INSERT INTO journal_unposts (id, tenant_id, journal_entry_id, entry_number, entry_date, total_debit, total_credit,
        reason, unposted_by, unposted_at)
      VALUES (?, ?, ?, 'JV-2026-00099', '2026-10-19', 300, 300, 'ลงผิดบัญชี', 'admin@test.com', '2026-10-19T04:00:00.000Z')
    `).run(generateId(), t, generateId())

    const res = closeChecklist(t, '2026-10')
    const ma = itemOf(res, 'manual_anomaly')
    expect(ma.status).toBe('warn')
    expect(ma.count).toBe(3)
    expect(ma.rows?.some(r => r.kind === 'SPIKE' && r.count === 5 && r.previousCount === 0)).toBe(true)
    expect(ma.rows?.some(r => r.kind === 'SELF_POSTED' && r.entryNumber === entryNumber)).toBe(true)
    expect(ma.rows?.some(r => r.kind === 'UNPOST' && r.entryNumber === 'JV-2026-00099')).toBe(true)
  })
})
