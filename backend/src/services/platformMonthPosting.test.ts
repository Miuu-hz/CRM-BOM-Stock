import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { previewPosting, postMonth, unpostMonth } from './platformMonthPosting.service'
import { PlatformMonthError, type IncomePayload, type BalancePayload } from './platformMonth.service'
import { cancelSale } from './platformMonthSale.service'
import { updateFeeMappings, getFeeMappings } from './platformSettlement.service'

// ============================================================
// เฟส 3: ลงบัญชีรอบเดือนแพลตฟอร์ม — golden numbers ตัวจริงรอบ ต.ค. 2026 (ร้าน bebozch, ดู carbontome.md)
// สร้างแถว platform_months ตรง ๆ ด้วย SQL (bypass submitFile/confirmSale ของเฟส 1-2 ซึ่งมีเทสต์ของ
// ตัวเองอยู่แล้วที่ platformMonth.test.ts / platformMonthSale.test.ts) — โฟกัสเฉพาะตรรกะบัญชีเฟส 3
// ============================================================

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    const monthIds = (db.prepare(`SELECT id FROM platform_months WHERE tenant_id = ?`).all(t) as any[]).map((r) => r.id)
    for (const id of monthIds) db.prepare(`DELETE FROM platform_month_products WHERE month_id = ?`).run(id)
    db.prepare(`DELETE FROM platform_months WHERE tenant_id = ?`).run(t)
    const entryIds = (db.prepare(`SELECT id FROM journal_entries WHERE tenant_id = ?`).all(t) as any[]).map((r) => r.id)
    for (const id of entryIds) db.prepare(`DELETE FROM journal_lines WHERE journal_entry_id = ?`).run(id)
    db.prepare(`DELETE FROM journal_entries WHERE tenant_id = ?`).run(t)
    db.prepare(`DELETE FROM accounts WHERE tenant_id = ?`).run(t)
    db.prepare(`DELETE FROM platform_fee_mappings WHERE tenant_id = ?`).run(t)
    db.prepare(`DELETE FROM company_settings WHERE tenant_id = ?`).run(t)
  }
})

function newTenant() {
  const t = 'test_pfpost_' + generateId()
  tenants.push(t)
  return t
}

const r2 = (n: number) => Math.round((n || 0) * 100) / 100

// ตัวเลขจริงของรอบ ต.ค. 2026 (golden) — เหมือน platformMonth.test.ts
const INCOME: IncomePayload = {
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  order_count: 100,
  product_list_price: 624147,
  seller_discount: -25637,
  refund_to_buyer: -1977,
  shopee_product_discount: 4508,
  product_sales: 596533,
  total_income: 601041,
  shipping_buyer_paid: 46044,
  shipping_shopee_subsidy: 113474,
  shipping_charged: -160040,
  shipping_return: -177,
  commission: -96522,
  ams_commission: -11691,
  service_fee: -51404,
  infrastructure_fee: -1538,
  transaction_fee: -27300,
  ads_topup_from_escrow: -6307,
  other_fees: 0,
  total_expense: -195461,
  total_transferred: 405580,
  adjustments: { total: -486, marketing: -59, shipping_claim: 535, refund_after_complete: -962, other: 0 },
}

const BALANCE: BalancePayload = {
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  opening: 15356.88,
  closing: 17604.88,
  money_in: 406582,
  money_out: -404334,
  order_income_in: 406047,
  order_income_out: -467,
  adjustments_in: 535,
  adjustments_out: -1021,
  withdrawals: [
    { date: '2026-10-02', amount: -56054 },
    { date: '2026-10-05', amount: -21680 },
    { date: '2026-10-07', amount: -60334 },
    { date: '2026-10-09', amount: -16135 },
    { date: '2026-10-11', amount: -48928 },
    { date: '2026-10-14', amount: -11966 },
    { date: '2026-10-17', amount: -71022 },
    { date: '2026-10-21', amount: -35618 },
    { date: '2026-10-24', amount: -37629 },
    { date: '2026-10-28', amount: -43480 },
  ],
  withdrawals_total: -402846,
}

const COGS_BREAKDOWN = [{ stockItemId: 'S1', stockItemName: 'สินค้าทดสอบ', qty: 10, unitCost: 5000, amount: 50000, inventoryAccount: '1106' }]

function makeMonth(tenantId: string, opts: {
  month?: string
  status?: string
  income?: IncomePayload | null
  balance?: BalancePayload | null
  cogsAmount?: number
}) {
  const id = generateId()
  db.prepare(`
    INSERT INTO platform_months (id, tenant_id, platform, shop_key, month, status, period_start, period_end,
      income_json, balance_json, cogs_amount, cogs_breakdown)
    VALUES (?, ?, 'SHOPEE', 'ร้านหลัก', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, tenantId, opts.month || '2026-10', opts.status || 'SALE_CONFIRMED',
    opts.income?.period_start ?? null, opts.income?.period_end ?? null,
    opts.income ? JSON.stringify(opts.income) : null,
    opts.balance ? JSON.stringify(opts.balance) : null,
    opts.cogsAmount ?? 0,
    opts.cogsAmount ? JSON.stringify(COGS_BREAKDOWN) : null
  )
  return id
}

function ledgerBalance(tenantId: string, code: string): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS bal
    FROM journal_lines l JOIN journal_entries e ON l.journal_entry_id = e.id JOIN accounts a ON l.account_id = a.id
    WHERE e.tenant_id = ? AND a.code = ?
  `).get(tenantId, code) as any
  return r2(row?.bal || 0)
}

function setNotVatRegistered(tenantId: string) {
  db.prepare(`INSERT INTO company_settings (tenant_id, name, vat_registered) VALUES (?, 'ทดสอบ', 0)`).run(tenantId)
}

describe('platformMonthPosting — ลงบัญชีรอบเดือนแพลตฟอร์ม (เฟส 3)', () => {
  it('preview: ทุก JV ดุล + ตัวเลข golden ตรง (ขาย/ค่าขนส่ง/ค่าธรรมเนียม/ปรับปรุง/ยอดยกมา)', () => {
    const tenantId = newTenant()
    const monthId = makeMonth(tenantId, { income: INCOME, balance: BALANCE, cogsAmount: 50000 })

    const preview = previewPosting(tenantId, monthId)
    expect(preview.vatRegistered).toBe(true)

    // ทุก JV ต้องดุลเดบิต=เครดิตในตัวเอง
    for (const j of [preview.journals.opening, preview.journals.sales, preview.journals.shipping, preview.journals.cogs, preview.journals.fees, preview.journals.adjust, ...preview.journals.payouts]) {
      if (!j) continue
      expect(j.totalDebit).toBeCloseTo(j.totalCredit, 2)
    }

    // JV ขาย — golden
    expect(preview.journals.sales.lines.find((l) => l.code === '2104')?.credit).toBeCloseTo(39320.44, 2)
    expect(preview.journals.sales.lines.find((l) => l.code === '4101')?.credit).toBeCloseTo(587528.03, 2)
    expect(preview.journals.sales.lines.find((l) => l.code === '1181')?.debit).toBeCloseTo(601041, 2)

    // JV ค่าขนส่ง — gross ทั้ง 2 ขา ผ่าน 1181 ทั้งคู่ ไม่หักกลบ
    const shipping = preview.journals.shipping!
    expect(shipping.lines.filter((l) => l.code === '1181').reduce((s, l) => s + l.debit, 0)).toBeCloseTo(159518, 2)
    expect(shipping.lines.filter((l) => l.code === '1181').reduce((s, l) => s + l.credit, 0)).toBeCloseTo(160217, 2)
    expect(shipping.lines.find((l) => l.code === '2104')?.credit).toBeCloseTo(3012.22, 2) // เฉพาะ buyer_paid
    expect(shipping.lines.find((l) => l.code === '5202')?.debit).toBeCloseTo(160217, 2)
    // ไม่มี VAT บน shopee_subsidy (default ปิด) — ต้องเจอ 4203 เต็มจำนวน 113474 ไม่ถูกแยก
    expect(shipping.lines.some((l) => l.code === '4203' && Math.abs(l.credit - 113474) < 0.01)).toBe(true)

    // JV ค่าธรรมเนียม — ไม่มีค่าขนส่งปนแล้ว, ไม่มี 1110 (claimable ปิดหมดโดย default)
    expect(preview.journals.fees!.lines.some((l) => l.code === '1110')).toBe(false)
    expect(preview.journals.fees!.lines.find((l) => l.code === '1181')?.credit).toBeCloseTo(194762, 2)

    // JV ปรับปรุง
    expect(preview.journals.adjust!.lines.find((l) => l.code === '1181')?.credit).toBeCloseTo(486, 2)

    // JV ยอดยกมา — เดือนแรก ต้องมี
    expect(preview.journals.opening).not.toBeNull()
    expect(preview.journals.opening!.lines.find((l) => l.code === '1181')?.debit).toBeCloseTo(15356.88, 2)
    expect(preview.journals.opening!.lines.find((l) => l.code === '3103')?.credit).toBeCloseTo(15356.88, 2)

    expect(preview.journals.payouts).toHaveLength(10)
    expect(r2(preview.journals.payouts.reduce((s, p) => s + p.totalCredit, 0))).toBeCloseTo(402846, 2)
  })

  it('post: ลงบัญชีจริงแล้ว 1181 ปิดงวด = ยอดกระเป๋า Shopee (closing) เป๊ะ', () => {
    const tenantId = newTenant()
    const monthId = makeMonth(tenantId, { income: INCOME, balance: BALANCE, cogsAmount: 50000 })

    const result = postMonth(tenantId, monthId, 'tester')
    expect(result.journalIds.length).toBe(16) // opening+sales+shipping+cogs+fees+adjust + 10 ถอนเงิน

    expect(ledgerBalance(tenantId, '1181')).toBeCloseTo(17604.88, 2)

    const row = db.prepare(`SELECT status FROM platform_months WHERE id = ?`).get(monthId) as any
    expect(row.status).toBe('POSTED')
  })

  it('post ซ้ำถูกปฏิเสธ', () => {
    const tenantId = newTenant()
    const monthId = makeMonth(tenantId, { income: INCOME, balance: BALANCE, cogsAmount: 50000 })
    postMonth(tenantId, monthId, 'tester')
    expect(() => postMonth(tenantId, monthId, 'tester')).toThrow(PlatformMonthError)
  })

  it('unpost: กลับรายการทุกใบ 1181 คืนเป็นศูนย์ + status กลับ SALE_CONFIRMED แล้วลงใหม่ได้อีกรอบ', () => {
    const tenantId = newTenant()
    const monthId = makeMonth(tenantId, { income: INCOME, balance: BALANCE, cogsAmount: 50000 })
    postMonth(tenantId, monthId, 'tester')
    expect(ledgerBalance(tenantId, '1181')).toBeCloseTo(17604.88, 2)

    unpostMonth(tenantId, monthId, 'tester')
    expect(ledgerBalance(tenantId, '1181')).toBeCloseTo(0, 2)
    const row = db.prepare(`SELECT status FROM platform_months WHERE id = ?`).get(monthId) as any
    expect(row.status).toBe('SALE_CONFIRMED')

    // ลงใหม่อีกรอบต้องไม่ชนกับ referenceId รอบก่อน (token = posted_at กันชนไว้แล้ว)
    const result2 = postMonth(tenantId, monthId, 'tester')
    expect(result2.journalIds.length).toBe(16)
    expect(ledgerBalance(tenantId, '1181')).toBeCloseTo(17604.88, 2)

    unpostMonth(tenantId, monthId, 'tester')
    expect(ledgerBalance(tenantId, '1181')).toBeCloseTo(0, 2)
  })

  it('cancelSale (เฟส 2) ถูกปฏิเสธระหว่างสถานะ POSTED', () => {
    const tenantId = newTenant()
    const monthId = makeMonth(tenantId, { income: INCOME, balance: BALANCE, cogsAmount: 50000 })
    postMonth(tenantId, monthId, 'tester')
    expect(() => cancelSale(tenantId, monthId, 'tester')).toThrow(/ลงบัญชีไปแล้ว/)
  })

  it('tenant ที่ไม่ได้จด VAT — ไม่มีบรรทัด 2104/1110 เลย ยอดเป็น gross ทั้งก้อน', () => {
    const tenantId = newTenant()
    setNotVatRegistered(tenantId)
    const monthId = makeMonth(tenantId, { income: INCOME, balance: BALANCE, cogsAmount: 50000 })

    const preview = previewPosting(tenantId, monthId)
    expect(preview.vatRegistered).toBe(false)

    const allLines = [
      ...preview.journals.sales.lines,
      ...(preview.journals.shipping?.lines || []),
      ...(preview.journals.fees?.lines || []),
    ]
    expect(allLines.some((l) => l.code === '2104')).toBe(false)
    expect(allLines.some((l) => l.code === '1110')).toBe(false)

    // ไม่หัก VAT: Dr 1181(total_income) + Dr 4301(|seller_discount|) + Dr 4302(|refund_to_buyer|) = Cr 4101 ทั้งก้อน
    const grossRevenue = r2(601041 + 25637 + 1977)
    expect(preview.journals.sales.lines.find((l) => l.code === '4101')?.credit).toBeCloseTo(grossRevenue, 2)
  })

  it('เปิด vat_claimable ของค่าธรรมเนียมหนึ่งประเภท (มีใบกำกับ) ต้องแยกภาษีซื้อ 1110 ออกมา', () => {
    const tenantId = newTenant()
    const monthId = makeMonth(tenantId, { income: INCOME, balance: BALANCE, cogsAmount: 50000 })

    const mappings = getFeeMappings(tenantId)
    const commissionRow = mappings.find((m) => m.feeType === 'COMMISSION')!
    expect(commissionRow.vatClaimable).toBe(false) // default ปิด (Shopee ยังไม่ออกใบกำกับ)
    updateFeeMappings(tenantId, [{ id: commissionRow.id, vatClaimable: true }])

    const preview = previewPosting(tenantId, monthId)
    const inputVatLine = preview.journals.fees!.lines.find((l) => l.code === '1110')
    expect(inputVatLine).toBeDefined()
    // commission = 96522 (abs) → vat = round(96522*7/107,2) = 6314.52
    expect(inputVatLine!.debit).toBeCloseTo(6314.52, 2)
  })

  it('ยอดยกมาลงแค่ครั้งเดียว — เดือนที่สองของร้านเดียวกัน (หลังเดือนแรก POSTED แล้ว) ต้องไม่มี JV ยอดยกมาอีก', () => {
    const tenantId = newTenant()
    const month1 = makeMonth(tenantId, { income: INCOME, balance: BALANCE, cogsAmount: 50000, month: '2026-10' })
    postMonth(tenantId, month1, 'tester')

    const income2: IncomePayload = { ...INCOME, period_start: '2026-11-01', period_end: '2026-11-30', adjustments: { total: 0, marketing: 0, shipping_claim: 0, refund_after_complete: 0, other: 0 } }
    const balance2: BalancePayload = { ...BALANCE, period_start: '2026-11-01', period_end: '2026-11-30', withdrawals: [], withdrawals_total: 0 }
    const month2 = makeMonth(tenantId, { income: income2, balance: balance2, cogsAmount: 0, month: '2026-11' })

    const preview2 = previewPosting(tenantId, month2)
    expect(preview2.journals.opening).toBeNull()
  })

  it('tenant isolation — เรียก preview/post รอบเดือนของ tenant อื่นต้องไม่เจอ', () => {
    const tenantA = newTenant()
    const tenantB = newTenant()
    const monthA = makeMonth(tenantA, { income: INCOME, balance: BALANCE, cogsAmount: 50000 })

    expect(() => previewPosting(tenantB, monthA)).toThrow(PlatformMonthError)
    expect(() => postMonth(tenantB, monthA, 'tester')).toThrow(PlatformMonthError)
  })

  // ==================== finding #2: ยอดยกมาโพสต์ซ้ำ (post→unpost→post เดือนถัดไป→post เดือนเดิมซ้ำ) ====================
  it('finding #2: post ต.ค.→unpost→post พ.ย. (ได้ opening เอง)→post ต.ค.ซ้ำต้องถูกปฏิเสธ + 1181 = ปิดงวด พ.ย.', () => {
    const tenantId = newTenant()
    const monthOct = makeMonth(tenantId, { income: INCOME, balance: BALANCE, cogsAmount: 0, month: '2026-10' })

    postMonth(tenantId, monthOct, 'tester')
    expect(ledgerBalance(tenantId, '1181')).toBeCloseTo(17604.88, 2)

    unpostMonth(tenantId, monthOct, 'tester')
    expect(ledgerBalance(tenantId, '1181')).toBeCloseTo(0, 2)

    // พ.ย. ต่อเนื่องจากยอดปิด ต.ค. (17604.88) — ตอนนี้ไม่มี OPENING JV active เหลืออยู่เลย (ของ ต.ค. ถูกกลับแล้ว)
    // ตามเคส (a) พ.ย. จึงลง opening ของตัวเอง 17,604.88 ได้ (ตรงกับที่รีวิวบอกว่า "ได้ opening 17,604.88")
    const incomeNov: IncomePayload = { ...INCOME, period_start: '2026-11-01', period_end: '2026-11-30' }
    const balanceNov: BalancePayload = {
      ...BALANCE,
      period_start: '2026-11-01',
      period_end: '2026-11-30',
      opening: 17604.88,
      closing: r2(17604.88 + BALANCE.money_in + BALANCE.money_out),
    }
    const monthNov = makeMonth(tenantId, { income: incomeNov, balance: balanceNov, cogsAmount: 0, month: '2026-11' })
    postMonth(tenantId, monthNov, 'tester')
    expect(ledgerBalance(tenantId, '1181')).toBeCloseTo(balanceNov.closing, 2)

    // post ต.ค. ซ้ำตอนนี้ต้องถูกปฏิเสธ (มี opening active อยู่ที่ พ.ย. แล้ว + ไม่มีเดือนก่อน ต.ค. ให้ต่อเนื่อง)
    // เดิมบั๊ก: hasEarlierPosted เช็คแค่ "มีเดือนก่อนหน้า ต.ค. POSTED ไหม" → ไม่มี → ปล่อยให้ลง opening ซ้ำอีกใบ
    // (1181 จะเกิน balanceNov.closing ไปอีก 15,356.88) — ตอนนี้ต้องโดนปฏิเสธ 1181 ต้องยังเท่ายอดปิด พ.ย. เท่านั้น
    expect(() => postMonth(tenantId, monthOct, 'tester')).toThrow(PlatformMonthError)
    expect(ledgerBalance(tenantId, '1181')).toBeCloseTo(balanceNov.closing, 2)
  })

  it('finding #2: unpost เดือนเก่าไม่ได้ถ้าเดือนถัดไปของร้านเดียวกัน POSTED อยู่ (ต้อง unpost จากเดือนล่าสุดก่อน)', () => {
    const tenantId = newTenant()
    const monthOct = makeMonth(tenantId, { income: INCOME, balance: BALANCE, cogsAmount: 0, month: '2026-10' })
    postMonth(tenantId, monthOct, 'tester')

    const incomeNov: IncomePayload = { ...INCOME, period_start: '2026-11-01', period_end: '2026-11-30' }
    const balanceNov: BalancePayload = {
      ...BALANCE,
      period_start: '2026-11-01',
      period_end: '2026-11-30',
      opening: 17604.88,
      closing: r2(17604.88 + BALANCE.money_in + BALANCE.money_out),
    }
    const monthNov = makeMonth(tenantId, { income: incomeNov, balance: balanceNov, cogsAmount: 0, month: '2026-11' })
    postMonth(tenantId, monthNov, 'tester') // ต่อเนื่อง (เคส b) — ไม่มี opening ของตัวเอง
    expect(previewPosting(tenantId, monthNov).journals.opening).toBeNull()

    expect(() => unpostMonth(tenantId, monthOct, 'tester')).toThrow(PlatformMonthError)

    unpostMonth(tenantId, monthNov, 'tester') // unpost เดือนล่าสุด (พ.ย.) ก่อนได้
    unpostMonth(tenantId, monthOct, 'tester') // แล้วค่อย unpost ต.ค.
    expect(ledgerBalance(tenantId, '1181')).toBeCloseTo(0, 2)
  })

  it('finding #2: เดือนแรกยอดยกมา = 0 (ไม่มี JV ยอดยกมา) เดือนถัดไปต้องไม่ลงยอดยกมาซ้ำ', () => {
    const tenantId = newTenant()
    const bal1: BalancePayload = { ...BALANCE, opening: 0, closing: r2(BALANCE.closing - BALANCE.opening) }
    const m1 = makeMonth(tenantId, { income: INCOME, balance: bal1, cogsAmount: 0, month: '2026-10' })
    postMonth(tenantId, m1, 'tester')
    expect(ledgerBalance(tenantId, '1181')).toBeCloseTo(bal1.closing, 2)

    const incomeNov: IncomePayload = { ...INCOME, period_start: '2026-11-01', period_end: '2026-11-30' }
    const balNov: BalancePayload = { ...BALANCE, period_start: '2026-11-01', period_end: '2026-11-30',
      opening: bal1.closing, closing: r2(bal1.closing + BALANCE.money_in + BALANCE.money_out) }
    const m2 = makeMonth(tenantId, { income: incomeNov, balance: balNov, cogsAmount: 0, month: '2026-11' })
    expect(previewPosting(tenantId, m2).journals.opening).toBeNull()
    postMonth(tenantId, m2, 'tester')
    expect(ledgerBalance(tenantId, '1181')).toBeCloseTo(balNov.closing, 2)
  })

  // ==================== finding #5: ADJUST JV เดาทิศเครื่องหมายผิด + การ์ดหลังลงบัญชี ====================
  it('finding #5: ปรับปรุง (adjustments) ใช้เครื่องหมายจริงกำหนดทิศ ไม่ใช่เดาเสมอว่าเป็นค่าใช้จ่าย', () => {
    const tenantId = newTenant()
    // marketing = +59 (ชดเชยเข้ากระเป๋า ไม่ใช่ค่าใช้จ่าย) — เดิม abs() แล้ว Dr เสมอ จะกลับทิศผิด (1181 เพี้ยน 118)
    const income: IncomePayload = {
      ...INCOME,
      adjustments: { total: 59, marketing: 59, shipping_claim: 0, refund_after_complete: 0, other: 0 },
    }
    const monthId = makeMonth(tenantId, { income, balance: BALANCE, cogsAmount: 0 })
    const preview = previewPosting(tenantId, monthId)
    const adjust = preview.journals.adjust!
    expect(adjust.totalDebit).toBeCloseTo(adjust.totalCredit, 2)

    const affiliateCode = getFeeMappings(tenantId).find((m) => m.feeType === 'AFFILIATE')!.accountCode
    expect(adjust.lines.find((l) => l.code === affiliateCode)?.credit).toBeCloseTo(59, 2)
    expect(adjust.lines.find((l) => l.code === affiliateCode)?.debit || 0).toBeCloseTo(0, 2)
    expect(adjust.lines.find((l) => l.code === '1181')?.debit).toBeCloseTo(59, 2)
  })

  it('finding #5: การ์ดหลังลงบัญชี — ถ้า 1181 เคลื่อนไหวจริงไม่ตรงกับ closing-opening ต้อง throw และ rollback ทั้งก้อน', () => {
    const tenantId = newTenant()
    // closing ไม่ตรงกับ money_in/money_out จริง (เบี้ยวไป 500) แต่ยังผ่านเช็ค opening+money_in+money_out=closing
    // เพราะปรับ money_in ตามไปด้วย — ไม่มี cross-check ไหนจับได้ก่อนเข้า postMonth (ช่องว่างที่การ์ดนี้อุด)
    const badBalance: BalancePayload = {
      ...BALANCE,
      money_in: r2(BALANCE.money_in + 500),
      closing: r2(BALANCE.opening + (BALANCE.money_in + 500) + BALANCE.money_out),
    }
    const monthId = makeMonth(tenantId, { income: INCOME, balance: badBalance, cogsAmount: 50000 })

    expect(() => postMonth(tenantId, monthId, 'tester')).toThrow(PlatformMonthError)
    expect(ledgerBalance(tenantId, '1181')).toBeCloseTo(0, 2)
    const row = db.prepare(`SELECT status FROM platform_months WHERE id = ?`).get(monthId) as any
    expect(row.status).toBe('SALE_CONFIRMED')
  })
})
