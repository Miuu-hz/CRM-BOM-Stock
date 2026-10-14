import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import {
  submitFile,
  getMonthStatus,
  PlatformMonthError,
  type IncomePayload,
  type BalancePayload,
  type ProductsPayload,
  type AdsPayload,
  type StatsPayload,
} from './platformMonth.service'

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    const monthIds = (db.prepare(`SELECT id FROM platform_months WHERE tenant_id = ?`).all(t) as any[]).map(r => r.id)
    for (const id of monthIds) {
      db.prepare(`DELETE FROM platform_month_products WHERE month_id = ?`).run(id)
      db.prepare(`DELETE FROM platform_days WHERE month_id = ?`).run(id)
    }
    db.prepare(`DELETE FROM platform_months WHERE tenant_id = ?`).run(t)
  }
})

function newTenant() {
  const t = 'test_platform_' + generateId()
  tenants.push(t)
  return t
}

// ตัวเลขจริงของรอบ ต.ค. 2026 (golden) — ตามที่เจ้าของให้มา
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

const PRODUCTS: ProductsPayload = {
  rows: [
    { level: 'parent', product_id: 'P1', product_name: 'สินค้า A', sales_all: 300000, sales_confirmed: 300000, orders_all: 50, orders_confirmed: 48, qty_all: 100, qty_confirmed: 96 },
    { level: 'variant', product_id: 'P1', variant_id: 'V1', variant_name: 'ไซส์ M', sales_all: 150000, sales_confirmed: 150000 },
    { level: 'variant', product_id: 'P1', variant_id: 'V2', variant_name: 'ไซส์ L', sales_all: 150000, sales_confirmed: 150000 },
    { level: 'parent', product_id: 'P2', product_name: 'สินค้า B', sales_all: 286743, sales_confirmed: 286743, orders_all: 40, orders_confirmed: 39, qty_all: 80, qty_confirmed: 78 },
  ],
}

const ADS: AdsPayload = {
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  campaigns: [
    { name: 'แคมเปญ A', ad_type: 'ค้นหา', status: 'กำลังแสดง', product_id: 'P1', impressions: 10000, clicks: 500, orders: 20, direct_orders: 15, items_sold: 25, sales: 50000, direct_sales: 40000, cost: 6307 },
  ],
  total_cost: 6307,
}

const STATS: StatsPayload = {
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  totals: {
    sales_all: 600000, sales_confirmed: 586743, orders_all: 92, orders_confirmed: 87,
    visitors: 20000, clicks: 3000, cancelled_orders: 5, cancelled_sales: 13257,
    buyers: 80, new_buyers: 30, existing_buyers: 50, potential_buyers: 500, repeat_rate: 0.35,
  },
  daily: [
    { date: '2026-10-01', sales_all: 20000, orders_all: 3, sales_confirmed: 19500, orders_confirmed: 3, visitors: 650, clicks: 100, cancelled_orders: 0, cancelled_sales: 0, buyers: 3, new_buyers: 1, existing_buyers: 2, potential_buyers: 15 },
    { date: '2026-10-02', sales_all: 18000, orders_all: 2, sales_confirmed: 18000, orders_confirmed: 2, visitors: 600, clicks: 90, cancelled_orders: 0, cancelled_sales: 0, buyers: 2, new_buyers: 0, existing_buyers: 2, potential_buyers: 12 },
    // แทนวันที่เหลือทั้งหมดของเดือน (ไม่ลงรายวันจริงในเทสต์นี้ แค่ทำให้ sum(daily) = totals เป๊ะ)
    { date: '2026-10-03', sales_all: 562000, orders_all: 87, sales_confirmed: 549243, orders_confirmed: 82, visitors: 18750, clicks: 2810, cancelled_orders: 5, cancelled_sales: 13257, buyers: 75, new_buyers: 29, existing_buyers: 46, potential_buyers: 473 },
  ],
  sources: { product_page: 400000, live: 50000, video: 30000, partner: 20000, ads_attributed: 100000 },
}

describe('platform_months — รอบเดือนแพลตฟอร์ม (เฟส 1)', () => {
  it('ส่งครบ 5 ไฟล์แล้วสมการทุกข้อผ่าน', () => {
    const tenantId = newTenant()
    const base = { platform: 'SHOPEE', shopKey: 'ร้านหลัก', month: '2026-10' }

    const r1 = submitFile(tenantId, { ...base, fileType: 'income', data: INCOME })
    expect(r1.checks.every(c => c.pass)).toBe(true)

    const r2 = submitFile(tenantId, { ...base, fileType: 'balance', data: BALANCE })
    expect(r2.checks.every(c => c.pass)).toBe(true)
    // ตอนนี้มีทั้ง income+balance แล้ว ต้องเกิดเช็คข้ามไฟล์ 2 ข้อเพิ่ม
    expect(r2.checks.some(c => c.name.includes('order_income_in'))).toBe(true)

    const r3 = submitFile(tenantId, { ...base, fileType: 'products', data: PRODUCTS })
    expect(r3.checks.every(c => c.pass)).toBe(true)

    const r4 = submitFile(tenantId, { ...base, fileType: 'stats', data: STATS })
    expect(r4.checks.every(c => c.pass)).toBe(true)
    expect(r4.checks.some(c => c.name.includes('sales_confirmed'))).toBe(true)

    submitFile(tenantId, { ...base, fileType: 'ads', data: ADS })

    const status = getMonthStatus(tenantId, base.platform, base.shopKey, base.month)
    expect(status.found).toBe(true)
    expect(status.filesReceived).toEqual({ income: true, balance: true, products: true, ads: true, stats: true })
    expect(status.receivedCount).toBe(5)
    expect(status.allChecksPass).toBe(true)
    expect(status.checks.length).toBeGreaterThanOrEqual(8)
  })

  it('total_transferred ผิด ต้องถูกปฏิเสธตั้งแต่ไฟล์ income เดียว', () => {
    const tenantId = newTenant()
    const base = { platform: 'SHOPEE', shopKey: 'ร้านหลัก', month: '2026-11' }
    const bad: IncomePayload = { ...INCOME, total_transferred: 999999 }
    expect(() => submitFile(tenantId, { ...base, fileType: 'income', data: bad })).toThrow(PlatformMonthError)

    // ไม่ควรมีอะไรถูกบันทึกเลย (rollback ทั้งก้อน)
    const status = getMonthStatus(tenantId, base.platform, base.shopKey, base.month)
    expect(status.found).toBe(false)
  })

  it('ยอดขายสินค้ารวม (parent) ไม่ตรงกับ stats.totals.sales_confirmed ต้องถูกปฏิเสธข้ามไฟล์', () => {
    const tenantId = newTenant()
    const base = { platform: 'SHOPEE', shopKey: 'ร้านหลัก', month: '2026-12' }

    submitFile(tenantId, { ...base, fileType: 'products', data: PRODUCTS }) // รวม parent = 586743
    const badStats: StatsPayload = { ...STATS, totals: { ...STATS.totals, sales_confirmed: 123456 } }
    expect(() => submitFile(tenantId, { ...base, fileType: 'stats', data: badStats })).toThrow(PlatformMonthError)

    // stats ที่ทำให้สมการพังต้องไม่ถูกบันทึก
    const status = getMonthStatus(tenantId, base.platform, base.shopKey, base.month)
    expect(status.filesReceived.stats).toBe(false)
  })

  it('ส่งไฟล์เดิมซ้ำ = เขียนทับ ไม่สร้างรอบใหม่ซ้อน', () => {
    const tenantId = newTenant()
    const base = { platform: 'SHOPEE', shopKey: 'ร้านหลัก', month: '2027-01' }

    const income2027 = { ...INCOME, period_start: '2027-01-01', period_end: '2027-01-31' }
    submitFile(tenantId, { ...base, fileType: 'income', data: income2027 })
    submitFile(tenantId, { ...base, fileType: 'income', data: { ...income2027, order_count: 150 } })

    const rows = db.prepare(`SELECT COUNT(*) AS c FROM platform_months WHERE tenant_id = ?`).get(tenantId) as any
    expect(rows.c).toBe(1)

    const row = db.prepare(`SELECT income_json FROM platform_months WHERE tenant_id = ?`).get(tenantId) as any
    expect(JSON.parse(row.income_json).order_count).toBe(150)
  })

  // ==================== finding #5 / #13: เช็คสมการเพิ่มตอน submit ====================
  it('adjustments: marketing+shipping_claim+refund_after_complete+other ไม่เท่า total ต้องถูกปฏิเสธ (finding #5)', () => {
    const tenantId = newTenant()
    const base = { platform: 'SHOPEE', shopKey: 'ร้านหลัก', month: '2026-10' }
    const bad: IncomePayload = { ...INCOME, adjustments: { total: -486, marketing: 100, shipping_claim: 535, refund_after_complete: -962, other: 0 } }
    expect(() => submitFile(tenantId, { ...base, fileType: 'income', data: bad })).toThrow(PlatformMonthError)
  })

  it('period_end ไกลเกินไปจากเดือนที่ประกาศ (month) ต้องถูกปฏิเสธ (finding #13)', () => {
    const tenantId = newTenant()
    const base = { platform: 'SHOPEE', shopKey: 'ร้านหลัก', month: '2026-10' }
    const bad: IncomePayload = { ...INCOME, period_end: '2027-03-31' }
    expect(() => submitFile(tenantId, { ...base, fileType: 'income', data: bad })).toThrow(/ไม่อยู่ในช่วงรอบเดือน/)
  })

  it('วันที่ถอนเงิน (withdrawals) ไกลเกินไปจากเดือนที่ประกาศ ต้องถูกปฏิเสธ (finding #13 — กันวันที่ parse ผิดกลายเป็น JV date)', () => {
    const tenantId = newTenant()
    const base = { platform: 'SHOPEE', shopKey: 'ร้านหลัก', month: '2026-10' }
    const bad: BalancePayload = { ...BALANCE, withdrawals: [{ date: '2027-05-10', amount: -100 }], withdrawals_total: -100 }
    expect(() => submitFile(tenantId, { ...base, fileType: 'balance', data: bad })).toThrow(/ไม่อยู่ในช่วงรอบเดือน/)
  })

  it('ไฟล์ ads: ผลรวม cost ของแคมเปญทั้งหมดไม่เท่า total_cost ต้องถูกปฏิเสธ (finding #13)', () => {
    const tenantId = newTenant()
    const base = { platform: 'SHOPEE', shopKey: 'ร้านหลัก', month: '2026-10' }
    const bad: AdsPayload = { ...ADS, total_cost: 9999 }
    expect(() => submitFile(tenantId, { ...base, fileType: 'ads', data: bad })).toThrow(PlatformMonthError)
  })

  it('ไฟล์ stats: ผลรวม daily ไม่เท่า totals ต้องถูกปฏิเสธ (finding #13)', () => {
    const tenantId = newTenant()
    const base = { platform: 'SHOPEE', shopKey: 'ร้านหลัก', month: '2026-10' }
    const bad: StatsPayload = { ...STATS, totals: { ...STATS.totals, sales_all: 999999 } }
    expect(() => submitFile(tenantId, { ...base, fileType: 'stats', data: bad })).toThrow(PlatformMonthError)
  })

  it('ไฟล์ products: ผลรวม qty ของ variant ไม่เท่าแถว parent (exact) ต้องถูกปฏิเสธ (finding #13)', () => {
    const tenantId = newTenant()
    const base = { platform: 'SHOPEE', shopKey: 'ร้านหลัก', month: '2026-10' }
    const bad: ProductsPayload = {
      rows: [
        { level: 'parent', product_id: 'P1', product_name: 'สินค้า A', qty_all: 100, qty_confirmed: 96 },
        { level: 'variant', product_id: 'P1', variant_id: 'V1', qty_all: 40, qty_confirmed: 38 },
        { level: 'variant', product_id: 'P1', variant_id: 'V2', qty_all: 40, qty_confirmed: 38 },
      ],
    }
    expect(() => submitFile(tenantId, { ...base, fileType: 'products', data: bad })).toThrow(PlatformMonthError)
  })
})
