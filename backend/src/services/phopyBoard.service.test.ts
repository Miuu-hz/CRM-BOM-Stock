import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { seedChartOfAccounts } from '../config/chartOfAccounts'
import {
  buildCogsAnalysis, cogsSourceOf, ageBuckets, classifyDrawerMovement, untrackedDrawerGaps,
  cogsAnalysis, businessUnitPL, apAging, cashDrawer, ledgerLabour, monthRange,
} from './phopyBoard.service'

// ── pure ─────────────────────────────────────────────────────────────────

describe('ต้นทุนขาย 2 มุม (buildCogsAnalysis)', () => {
  // ตัวเลขจริง tenant_bb_pillow ตุลาคม 2026 (journal posted, ไม่รวมรายการปิดงวด)
  const octRows = [
    { ref: 'GOODS_RECEIPT', inventory: 12803.84, cogs: 0 },
    { ref: 'PURCHASE_INVOICE', inventory: 3382.44, cogs: 0 },
    { ref: 'PURCHASE_INVOICE_RECLASS', inventory: -2527.43, cogs: 344.35 },
    { ref: 'POS_COGS', inventory: -2192.93, cogs: 2192.93 },
    { ref: 'POS_CANCEL', inventory: 27, cogs: -27 },
    { ref: 'STOCK_ADJUST', inventory: 367 - 3949.33, cogs: 3949.33 },
    { ref: 'ADJUSTMENT', inventory: 0, cogs: 0 },
  ]

  it('แยกต้นทุนตามสูตร / ปรับนับสต็อก / ซื้อใช้ตรง และรวมได้เท่าต้นทุนขายในบัญชี', () => {
    const a = buildCogsAnalysis(octRows, 44333.25, 52243.84, null)
    expect(a.recipe).toBe(2165.93)
    expect(a.stockAdjust).toBe(3949.33)
    expect(a.directPurchase).toBe(344.35)
    expect(a.ledger).toBe(6459.61)
  })

  it('ต้นทุนแบบสต็อก = ต้นงวด + ซื้อ − ปลายงวด และส่วนต่างอธิบายได้ครบ', () => {
    const a = buildCogsAnalysis(octRows, 44333.25, 52243.84, 58629.44)
    expect(a.stock.purchasesToStock).toBe(13658.85)
    expect(a.stock.cogs).toBe(6092.61)          // 44,333.25 + 13,658.85 + 344.35 − 52,243.84
    expect(a.variance).toBe(3926.68)            // ข − ก
    expect(a.varianceCount).toBe(3582.33)       // ปรับลดหมูสับ 3,949.33 − ปรับเพิ่ม 367
    expect(a.notInLedgerCogs).toBe(-367)        // ปรับเพิ่มที่ลง 5902/2102 ไม่ได้ลดต้นทุนขาย
    expect(a.systemStock.diff).toBe(6385.6)     // จำนวนในระบบ × ทุน สูงกว่าบัญชี
  })

  it('cogsSourceOf จัดเอกสารซื้อ/ปรับสต็อก/ขาย ถูกกลุ่ม', () => {
    expect(cogsSourceOf('PURCHASE_INVOICE_RECLASS')).toBe('PURCHASE')
    expect(cogsSourceOf('GOODS_RECEIPT')).toBe('PURCHASE')
    expect(cogsSourceOf('STOCK_ADJUST')).toBe('ADJUST')
    expect(cogsSourceOf(null)).toBe('ADJUST')
    expect(cogsSourceOf('POS_COGS')).toBe('RECIPE')
    expect(cogsSourceOf('SO_COGS')).toBe('RECIPE')
  })
})

describe('อายุหนี้ (ageBuckets)', () => {
  it('ขอบช่อง 30/31, 120/121 วัน ลงช่องตรง legend', () => {
    const b = ageBuckets([
      { date: '2026-09-21', amount: 100 },  // 30 วัน → 0-30
      { date: '2026-09-20', amount: 10 },   // 31 วัน → 31-60
      { date: '2026-06-23', amount: 1 },    // 120 วัน → 91-120
      { date: '2024-10-20', amount: 310 },  // ~2 ปี → 120+
    ], '2026-10-21')
    expect(b).toEqual({ current: 100, days30: 10, days60: 0, days90: 1, over90: 310 })
  })
})

describe('เงินออกจากลิ้นชัก', () => {
  it('จัดหมวดตามบัญชีที่เลือก', () => {
    expect(classifyDrawerMovement({ type: 'PAID_OUT', accountType: 'EXPENSE', accountCode: '5403' })).toBe('EXPENSE')
    expect(classifyDrawerMovement({ type: 'OPENING_GAP', accountType: 'ASSET', accountCode: '1182' })).toBe('PURCHASE')
    expect(classifyDrawerMovement({ type: 'PAID_OUT', accountType: 'EQUITY', accountCode: '3101' })).toBe('OWNER')
    expect(classifyDrawerMovement({ type: 'CASH_IN', accountType: 'EQUITY', accountCode: '3101' })).toBe('CASH_IN')
  })

  it('เงินหายระหว่างกะที่ไม่มีรายการอธิบาย (ตัวเลขจริงกะ 0007→0008 หาย 80, 0009→0010 มี OPENING_GAP 333)', () => {
    const gaps = untrackedDrawerGaps([
      { id: 's7', shift_number: 'S7', opening_cash: 894, closing_cash_counted: 594 },
      { id: 's8', shift_number: 'S8', opening_cash: 514, closing_cash_counted: 498 },
      { id: 's9', shift_number: 'S9', opening_cash: 498, closing_cash_counted: 1495 },
      { id: 's10', shift_number: 'S10', opening_cash: 1162, closing_cash_counted: 1102 },
    ], { s10: 333 })
    expect(gaps).toEqual([{ shiftNumber: 'S8', previousShift: 'S7', amount: 80 }])
  })
})

it('monthRange ไม่เลื่อนวันตาม timezone และข้ามปีได้', () => {
  expect(monthRange(2026, 9)).toEqual({ start: '2026-10-01', end: '2026-10-31', label: '2026/10' })
  expect(monthRange(2026, -1)).toEqual({ start: '2025-12-01', end: '2025-12-31', label: '2025/12' })
  expect(monthRange(2024, 1).end).toBe('2024-02-29')
})

// ── กับฐานข้อมูล ───────────────────────────────────────────────────────────

function seedTenant() {
  const t = 'tb' + generateId().slice(0, 10)
  seedChartOfAccounts(t)
  const acc = (code: string) => (db.prepare('SELECT id FROM accounts WHERE tenant_id = ? AND code = ?').get(t, code) as { id: string }).id
  let n = 0
  const je = (o: { date: string; ref: string | null; bu?: string | null; posted?: number; closing?: number; lines: Array<[string, number, number]> }) => {
    const id = generateId()
    db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, description, is_posted, business_unit, is_closing_entry)
      VALUES (?, ?, ?, ?, ?, 'test', ?, ?, ?)`).run(id, t, `JV-T-${++n}`, o.date, o.ref, o.posted ?? 1, o.bu ?? null, o.closing ?? 0)
    o.lines.forEach(([code, dr, cr], i) => db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, debit, credit)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(generateId(), t, id, acc(code), i + 1, dr, cr))
    return id
  }
  return { t, acc, je }
}

describe('cogsAnalysis / businessUnitPL กับ journal จริงในฐานข้อมูล', () => {
  it('คิดสต็อกต้นงวด-ปลายงวดจากบัญชีสินค้าคงเหลือ ไม่นับรายการที่ยังไม่ post และรายการปิดงวด', () => {
    const { t, je } = seedTenant()
    je({ date: '2026-09-20', ref: 'GOODS_RECEIPT', lines: [['1107', 1000, 0], ['2109', 0, 1000]] })               // ต้นงวด 1,000
    je({ date: '2026-10-02', ref: 'GOODS_RECEIPT', lines: [['1107', 500, 0], ['2109', 0, 500]] })                 // ซื้อเข้า 500
    je({ date: '2026-10-03', ref: 'PURCHASE_INVOICE_RECLASS', lines: [['5102', 40, 0], ['1107', 0, 40]] })        // ของไม่นับสต็อก 40 → ต้นทุนตรง
    je({ date: '2026-10-05', ref: 'POS_COGS', bu: 'RETAIL', lines: [['5101', 300, 0], ['1107', 0, 300]] })         // ตามสูตร 300
    je({ date: '2026-10-14', ref: 'STOCK_ADJUST', bu: 'OTHER', lines: [['5102', 200, 0], ['1107', 0, 200]] })     // นับแล้วขาด 200
    je({ date: '2026-10-15', ref: 'STOCK_ADJUST', posted: 0, lines: [['5102', 999, 0], ['1107', 0, 999]] })       // ยังไม่ post → ไม่นับ
    je({ date: '2026-10-31', ref: 'CLOSING', closing: 1, lines: [['3103', 540, 0], ['5101', 0, 540]] })           // ปิดงวด → ไม่นับ

    const a = cogsAnalysis(t, '2026-10-01', '2026-10-31')
    expect(a.stock.opening).toBe(1000)
    expect(a.stock.closing).toBe(960)          // 1000 + 500 − 40 − 300 − 200
    expect(a.recipe).toBe(300)
    expect(a.stockAdjust).toBe(200)
    expect(a.directPurchase).toBe(40)
    expect(a.ledger).toBe(540)
    expect(a.stock.cogs).toBe(540)            // 1000 + 460 + 40 − 960
    expect(a.variance).toBe(240)
  })

  it('POS_* ที่หัว journal เป็น OTHER/NULL ถูกนับเป็นหน้าร้าน และเงินเกินแยกเป็นช่องปรับปรุง ไม่ใช่ค่าใช้จ่ายติดลบ', () => {
    const { t, je } = seedTenant()
    je({ date: '2026-10-10', ref: 'POS_SALE', bu: 'RETAIL', lines: [['1180', 1000, 0], ['4101', 0, 1000]] })
    je({ date: '2026-10-10', ref: 'POS_CASH_MOVEMENT', bu: 'OTHER', lines: [['5403', 80, 0], ['1101', 0, 80]] })
    je({ date: '2026-10-10', ref: 'POS_CASH_MOVEMENT', bu: null, lines: [['5403', 40, 0], ['1101', 0, 40]] })
    je({ date: '2026-10-10', ref: 'POS_SHIFT_CLOSE', bu: 'RETAIL', lines: [['1101', 1150, 0], ['1180', 0, 1000], ['5901', 0, 150]] })
    je({ date: '2026-10-11', ref: 'PURCHASE_INVOICE', bu: 'OTHER', lines: [['5308', 100, 0], ['2101', 0, 100]] })

    const bu = businessUnitPL(t, '2026-10-01', '2026-10-31')
    const retail = bu.find(b => b.unit === 'RETAIL')!
    const other = bu.find(b => b.unit === 'OTHER')!
    expect(retail).toMatchObject({ revenue: 1000, cogs: 0, expense: 120, adjust: -150, netProfit: 1030 })
    expect(other).toMatchObject({ expense: 100, netProfit: -100 })
    expect(other.breakdown[0].referenceType).toBe('PURCHASE_INVOICE')
  })

  it('เงินเดือน/ค่าแรงอ่านจากบัญชี SALARY / DIRECT_LABOR', () => {
    const { t, je } = seedTenant()
    je({ date: '2026-10-25', ref: 'PAYROLL', lines: [['5301', 9000, 0], ['2106', 0, 450], ['1101', 0, 8550]] })
    je({ date: '2026-10-25', ref: 'PAYROLL', lines: [['5103', 3000, 0], ['1101', 0, 3000]] })
    expect(ledgerLabour(t, '2026-10-01', '2026-10-31')).toEqual({ salary: 9000, directLabor: 3000, total: 12000 })
  })
})

describe('AP aging / เงินออกลิ้นชัก กับตารางเอกสาร', () => {
  it('เจ้าหนี้มาจากใบแจ้งหนี้ซื้อที่ค้างชำระ ไม่ใช่ PO ที่ยังไม่รับของ', () => {
    const { t } = seedTenant()
    const sup = generateId()
    db.prepare(`INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'ตลาด', '-')`).run(sup, t, 'S-' + sup.slice(0, 6))
    const po = generateId()
    db.prepare(`INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, order_date, total_amount) VALUES (?, ?, ?, ?, 'DRAFT', '2024-10-20', 310)`).run(po, t, 'PO-' + po.slice(0, 6), sup)
    const pi = (status: string, date: string, balance: number) => db.prepare(`INSERT INTO purchase_invoices (id, tenant_id, pi_number, purchase_order_id, supplier_id, invoice_date, due_date, total_amount, paid_amount, balance_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(generateId(), t, 'PI-' + generateId().slice(0, 8), po, sup, date, date, balance, balance, status)
    pi('ISSUED', '2026-10-15', 500)
    pi('ISSUED', '2026-07-01', 200)
    pi('CANCELLED', '2026-10-15', 999)
    pi('ISSUED', '2026-10-01', 0)

    const ap = apAging(t, '2026-10-21')
    expect(ap.total).toBe(700)            // PO ร่าง 310 ไม่นับ, ใบยกเลิก/ใบจ่ายครบไม่นับ
    expect(ap.buckets.current).toBe(500)
    expect(ap.buckets.days90).toBe(200)
    expect(ap.overdue).toBe(700)
  })

  it('เงินออกลิ้นชักแยกหมวด และบอกรายการที่ยังไม่ลงบัญชี', () => {
    const { t, acc, je } = seedTenant()
    const s1 = generateId(), s2 = generateId()
    const shift = (id: string, no: string, open: string, close: string, opening: number, counted: number, diff: number) =>
      db.prepare(`INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, closed_at, opening_cash, closing_cash_counted, cash_difference)
        VALUES (?, ?, ?, 'CLOSED', ?, ?, ?, ?, ?)`).run(id, t, no, open, close, opening, counted, diff)
    shift(s1, 'S1', '2026-10-16T02:00:00.000Z', '2026-10-16T10:00:00.000Z', 894, 594, 0)
    shift(s2, 'S2', '2026-10-17T02:00:00.000Z', '2026-10-17T10:00:00.000Z', 514, 520, 22)
    const mv = (shiftId: string, type: string, amount: number, code: string, at: string) => {
      const id = generateId()
      db.prepare(`INSERT INTO pos_shift_cash_movements (id, tenant_id, shift_id, type, amount, reason, account_id, created_at) VALUES (?, ?, ?, ?, ?, 'x', ?, ?)`)
        .run(id, t, shiftId, type, amount, acc(code), at)
      return id
    }
    const gas = mv(s1, 'PAID_OUT', 300, '5403', '2026-10-16T09:00:00.000Z')
    mv(s2, 'PAID_OUT', 16, '5403', '2026-10-17T09:00:00.000Z')
    const buy = mv(s2, 'OPENING_GAP', 50, '1182', '2026-10-17T02:01:00.000Z')
    for (const [id, amt, code] of [[gas, 300, '5403'], [buy, 50, '1182']] as const) {
      const j = je({ date: '2026-10-16', ref: 'POS_CASH_MOVEMENT', lines: [[code, amt, 0], ['1101', 0, amt]] })
      db.prepare('UPDATE journal_entries SET reference_id = ? WHERE id = ?').run(id, j)
    }

    const d = cashDrawer(t, '2026-10-01', '2026-10-31')
    expect(d.totals).toMatchObject({ EXPENSE: 316, PURCHASE: 50 })
    expect(d.unposted).toEqual({ count: 1, amount: 16 })        // โค้ก 16 ยังไม่ post
    expect(d.untrackedGaps).toEqual([{ shiftNumber: 'S2', previousShift: 'S1', amount: 30 }]) // 594 − 514 − 50
    expect(d.overShort).toMatchObject({ over: 22, short: 0, net: 22 })
  })
})
