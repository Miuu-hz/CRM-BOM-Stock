import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { getPlatformDashboard, getDashboardShops, monthsWindow } from './platformDashboard.service'
import { confirmMapping, sourceRefOf } from './platformMonthSale.service'

// ============================================================
// เฟส 4: แดชบอร์ด — เทสต์ขอบหน้าต่างรอบเดือน + เลข KPI 4 หมวดบน fixture เล็กๆ ที่คำนวณมือไว้แล้ว
// ============================================================

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    const monthIds = (db.prepare(`SELECT id FROM platform_months WHERE tenant_id = ?`).all(t) as any[]).map(r => r.id)
    for (const id of monthIds) {
      db.prepare(`DELETE FROM platform_month_products WHERE month_id = ?`).run(id)
      db.prepare(`DELETE FROM platform_days WHERE month_id = ?`).run(id)
    }
    db.prepare(`DELETE FROM stock_item_aliases WHERE tenant_id = ?`).run(t)
    db.prepare(`DELETE FROM stock_items WHERE tenant_id = ?`).run(t)
    db.prepare(`DELETE FROM platform_months WHERE tenant_id = ?`).run(t)
  }
})

function newTenant() {
  const t = 'test_platform_dash_' + generateId()
  tenants.push(t)
  return t
}

function makeStockItem(tenantId: string, unitCost: number) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, ?, 'FINISHED', 1000, 'pcs', 'pcs', ?, 'WH1', 'ACTIVE')
  `).run(id, tenantId, id, 'สินค้าทดสอบ', unitCost)
  return id
}

function makeMonth(tenantId: string, month: string, payload: { income: any; ads: any; stats: any }) {
  const id = generateId()
  db.prepare(`
    INSERT INTO platform_months (id, tenant_id, platform, shop_key, month, income_json, ads_json, stats_json, status)
    VALUES (?, ?, 'SHOPEE', 'shop1', ?, ?, ?, ?, 'COLLECTING')
  `).run(id, tenantId, month, JSON.stringify(payload.income), JSON.stringify(payload.ads), JSON.stringify(payload.stats))
  return id
}

function addParent(tenantId: string, monthId: string, row: any) {
  db.prepare(`
    INSERT INTO platform_month_products
      (id, month_id, tenant_id, product_id, level, product_name, sales_all, sales_confirmed, orders_all, orders_confirmed,
       qty_all, qty_confirmed, cart_visitors, buyers_confirmed)
    VALUES (?, ?, ?, ?, 'parent', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(generateId(), monthId, tenantId, row.productId, row.productName, row.salesAll, row.salesConfirmed,
    row.ordersAll, row.ordersConfirmed, row.qtyConfirmed, row.qtyConfirmed, row.cartVisitors, row.buyersConfirmed)
}

function addVariant(tenantId: string, monthId: string, productId: string, variantId: string, qtyConfirmed: number) {
  db.prepare(`
    INSERT INTO platform_month_products (id, month_id, tenant_id, product_id, variant_id, level, product_name, variant_name, qty_confirmed)
    VALUES (?, ?, ?, ?, ?, 'variant', ?, ?, ?)
  `).run(generateId(), monthId, tenantId, productId, variantId, 'สินค้าทดสอบ', variantId, qtyConfirmed)
}

describe('monthsWindow — ขอบหน้าต่างรอบปฏิทิน', () => {
  it('end=2026-10 range=12 รวม 2025-11 ไม่รวม 2025-10', () => {
    const months = monthsWindow('2026-10', 12)
    expect(months).toHaveLength(12)
    expect(months[0]).toBe('2025-11')
    expect(months[months.length - 1]).toBe('2026-10')
    expect(months).not.toContain('2025-10')
  })

  it('end=2026-10 range=3 คือ ส.ค./ก.ย./ต.ค.', () => {
    expect(monthsWindow('2026-10', 3)).toEqual(['2026-08', '2026-09', '2026-10'])
  })
})

describe('getPlatformDashboard — KPI 4 หมวด + กำไรรายสินค้า', () => {
  it('คำนวณถูกบน fixture 2 เดือน (เดือนนอกช่วงไม่ถูกนับ, allocation ตรง, tenant แยกกัน)', () => {
    const tenantId = newTenant()
    const stockItemId = makeStockItem(tenantId, 20)

    // เดือนนอกช่วง (range=3 สิ้นสุด 2026-10 → ส.ค./ก.ย./ต.ค. เท่านั้น) — ตั้งยอดเวอร์ไว้ ถ้าหลุดเข้ามาจะเห็นทันที
    const decoyId = makeMonth(tenantId, '2026-07', {
      income: { total_income: 999999, commission: 0, service_fee: 0, transaction_fee: 0, infrastructure_fee: 0, ams_commission: 0, shipping_buyer_paid: 0, shipping_shopee_subsidy: 0, shipping_charged: 0, shipping_return: 0, refund_to_buyer: 0, adjustments: { refund_after_complete: 0 } },
      ads: { total_cost: 999999, campaigns: [] },
      stats: { totals: { sales_confirmed: 999999, orders_confirmed: 1, orders_all: 1, cancelled_orders: 0, potential_buyers: 1, new_buyers: 1, buyers: 1, repeat_rate: 0 } },
    })
    addParent(tenantId, decoyId, { productId: 'DECOY', productName: 'ของนอกช่วง', salesAll: 999999, salesConfirmed: 999999, ordersAll: 1, ordersConfirmed: 1, qtyConfirmed: 1, cartVisitors: 1, buyersConfirmed: 1 })

    // ก.ย. 2026 — มีสินค้า P1 ตัวเดียว ผูก SKU แล้ว ไม่มีแคมเปญตรงสินค้า
    const sepId = makeMonth(tenantId, '2026-09', {
      income: { total_income: 1000, commission: -30, service_fee: -10, transaction_fee: -5, infrastructure_fee: -5, ams_commission: -20, shipping_buyer_paid: 40, shipping_shopee_subsidy: 0, shipping_charged: -50, shipping_return: 0, refund_to_buyer: -20, adjustments: { refund_after_complete: -5 } },
      ads: { total_cost: 100, campaigns: [{ name: 'c1', sales: 500, clicks: 40, impressions: 1000, cost: 100 }] },
      stats: { totals: { sales_confirmed: 1000, orders_confirmed: 10, orders_all: 12, cancelled_orders: 2, potential_buyers: 200, new_buyers: 5, buyers: 20, repeat_rate: 0.25 } },
    })
    addParent(tenantId, sepId, { productId: 'P1', productName: 'สินค้า 1', salesAll: 1200, salesConfirmed: 1000, ordersAll: 12, ordersConfirmed: 10, qtyConfirmed: 10, cartVisitors: 50, buyersConfirmed: 20 })
    addVariant(tenantId, sepId, 'P1', 'V1', 10)
    confirmMapping(tenantId, { monthId: sepId, sourceRef: sourceRefOf('SHOPEE', { variant_id: 'V1' }), stockItemId, factor: 1 }, 'tester')

    // ต.ค. 2026 — P1 (ผูกแล้ว) + P2 (ยังไม่ผูก SKU เลย) มีแคมเปญชี้ตรง P2
    const octId = makeMonth(tenantId, '2026-10', {
      income: { total_income: 1000, commission: -30, service_fee: -10, transaction_fee: -5, infrastructure_fee: -5, ams_commission: -20, shipping_buyer_paid: 40, shipping_shopee_subsidy: 0, shipping_charged: -50, shipping_return: 0, refund_to_buyer: -20, adjustments: { refund_after_complete: -5 } },
      ads: { total_cost: 150, campaigns: [{ name: 'c2', sales: 300, clicks: 30, impressions: 800, cost: 50, product_id: 'P2' }, { name: 'c3', sales: 400, clicks: 20, impressions: 700, cost: 100 }] },
      stats: { totals: { sales_confirmed: 1000, orders_confirmed: 10, orders_all: 14, cancelled_orders: 4, potential_buyers: 250, new_buyers: 10, buyers: 25, repeat_rate: 0.4 } },
    })
    addParent(tenantId, octId, { productId: 'P1', productName: 'สินค้า 1', salesAll: 550, salesConfirmed: 500, ordersAll: 6, ordersConfirmed: 5, qtyConfirmed: 5, cartVisitors: 25, buyersConfirmed: 10 })
    addVariant(tenantId, octId, 'P1', 'V1', 5)
    addParent(tenantId, octId, { productId: 'P2', productName: 'สินค้า 2 (ไม่มีทุน)', salesAll: 600, salesConfirmed: 500, ordersAll: 8, ordersConfirmed: 5, qtyConfirmed: 5, cartVisitors: 25, buyersConfirmed: 8 })
    // P2 ไม่มีตัวเลือกและไม่ผูก SKU เลย

    const dash = getPlatformDashboard(tenantId, { platform: 'SHOPEE', shopKey: 'shop1', endMonth: '2026-10', range: 3 })

    // เดือนในช่วง 3 เดือน — ส.ค.ไม่มีข้อมูล, ก.ย./ต.ค. มี, ก.ค.(decoy) ไม่ถูกนับเลย
    expect(dash.months.map(m => m.month)).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(dash.months[0].hasData).toBe(false)
    expect(dash.monthsWithData).toBe(2)

    // KPI รวม
    expect(dash.kpis.sales.netSales).toBe(2000)
    expect(dash.kpis.sales.aov).toBe(100) // 2000 / 20 orders_confirmed (stats totals)
    expect(dash.kpis.sales.cancelRate).toBeCloseTo(23.08, 1) // 6/26*100
    expect(dash.kpis.platformCost.gpPercent).toBe(5) // fee 100 / income 2000
    expect(dash.kpis.platformCost.affiliate).toBe(40)
    expect(dash.kpis.platformCost.shippingExcess).toBe(20)
    expect(dash.kpis.ads.roas).toBe(4.8) // 1200 sales / 250 cost
    expect(dash.kpis.ads.tacos).toBe(12.5) // 250/2000*100
    expect(dash.kpis.ads.ctr).toBe(3.6) // 90/2500*100
    expect(dash.kpis.ads.cpl).toBeCloseTo(0.56, 1) // 250/450
    expect(dash.kpis.customer.cac).toBeCloseTo(19.33, 1) // (250+40)/15
    expect(dash.kpis.customer.ar).toBe(62) // (1-38/100)*100
    expect(dash.kpis.customer.crr).toBeCloseTo(33.33, 1) // weighted (5+10)/(20+25)
    expect(dash.kpis.customer.clvCac).toBeGreaterThan(0)

    // แยกรายสินค้า — P1 มีทุนรู้ชัด, P2 ไม่รู้ทุน (ไม่ได้ผูก SKU เลย)
    const p1 = dash.products.find(p => p.productId === 'P1')!
    const p2 = dash.products.find(p => p.productId === 'P2')!
    expect(p1.costKnown).toBe(true)
    expect(p1.unitCost).toBe(20)
    expect(p1.profit).toBeCloseTo(892.5, 1)
    expect(p2.costKnown).toBe(false)
    expect(p2.cogs).toBe(0)
    // แคมเปญชี้ตรง P2 (cost 50) ต้องลงที่ P2 เต็มๆ บวกส่วนแบ่งจาก pool ที่เหลือ (50% ของ 100)
    expect(p2.ads).toBe(100) // 50 ตรง + 50*0.5 ส่วนแบ่ง
    expect(p1.ads).toBe(150) // ก.ย. 100 (เดียว ไม่มีแคมเปญตรง) + ต.ค. 50*0.5

    expect(dash.estimates).toContain('ads_by_sales_share')

    // แยก tenant — tenant อื่นต้องไม่เห็นข้อมูลนี้แม้ platform/shop_key/month ตรงกัน
    const tenantB = newTenant()
    makeMonth(tenantB, '2026-10', {
      income: { total_income: 5, commission: 0, service_fee: 0, transaction_fee: 0, infrastructure_fee: 0, ams_commission: 0, shipping_buyer_paid: 0, shipping_shopee_subsidy: 0, shipping_charged: 0, shipping_return: 0, refund_to_buyer: 0, adjustments: { refund_after_complete: 0 } },
      ads: { total_cost: 0, campaigns: [] },
      stats: { totals: { sales_confirmed: 5, orders_confirmed: 1, orders_all: 1, cancelled_orders: 0, potential_buyers: 1, new_buyers: 1, buyers: 1, repeat_rate: 0 } },
    })
    const dashB = getPlatformDashboard(tenantB, { platform: 'SHOPEE', shopKey: 'shop1', endMonth: '2026-10', range: 3 })
    expect(dashB.kpis.sales.netSales).toBe(0) // ไม่มีแถว products เลยในรอบของ B
    const shopsA = getDashboardShops(tenantId)
    expect(shopsA.every(s => s.months.every(m => ['2026-07', '2026-09', '2026-10'].includes(m)))).toBe(true)
    // ยังเห็นข้อมูล tenant A เดิมอยู่ครบ ไม่ถูกกระทบจากการสร้าง tenant B
    const dashAagain = getPlatformDashboard(tenantId, { platform: 'SHOPEE', shopKey: 'shop1', endMonth: '2026-10', range: 3 })
    expect(dashAagain.kpis.sales.netSales).toBe(2000)
  })
})

describe('ข้อ 16 — AR ทิ้งตะกร้าไม่มีข้อมูล ต้องเป็น null ไม่ใช่ 100%', () => {
  it('cartVisitors=0 ทั้งเดือน (ไม่มีคนเข้าตะกร้าเลย) → kpis.customer.ar = null', () => {
    const tenantId = newTenant()
    makeMonth(tenantId, '2026-10', {
      income: { total_income: 100, commission: 0, service_fee: 0, transaction_fee: 0, infrastructure_fee: 0, ams_commission: 0, shipping_buyer_paid: 0, shipping_shopee_subsidy: 0, shipping_charged: 0, shipping_return: 0, refund_to_buyer: 0, adjustments: { refund_after_complete: 0 } },
      ads: { total_cost: 0, campaigns: [] },
      stats: { totals: { sales_confirmed: 100, orders_confirmed: 1, orders_all: 1, cancelled_orders: 0, potential_buyers: 1, new_buyers: 1, buyers: 1, repeat_rate: 0 } },
    })
    const dash = getPlatformDashboard(tenantId, { platform: 'SHOPEE', shopKey: 'shop1', endMonth: '2026-10', range: 1 })
    expect(dash.kpis.customer.ar).toBeNull()
  })
})

describe('ข้อ 17 — repeat_rate หน่วยผิด (>1) ต้องไม่ลาก CRR/CLV พัง', () => {
  it('repeat_rate=12.5 (เผื่อส่งมาเป็นเปอร์เซ็นต์ผิด) ถูก ignore ไม่ปนในค่าเฉลี่ยถ่วงน้ำหนัก', () => {
    const tenantId = newTenant()
    makeMonth(tenantId, '2026-10', {
      income: { total_income: 100, commission: 0, service_fee: 0, transaction_fee: 0, infrastructure_fee: 0, ams_commission: 0, shipping_buyer_paid: 0, shipping_shopee_subsidy: 0, shipping_charged: 0, shipping_return: 0, refund_to_buyer: 0, adjustments: { refund_after_complete: 0 } },
      ads: { total_cost: 0, campaigns: [] },
      stats: { totals: { sales_confirmed: 100, orders_confirmed: 1, orders_all: 1, cancelled_orders: 0, potential_buyers: 1, new_buyers: 1, buyers: 10, repeat_rate: 12.5 } },
    })
    const dash = getPlatformDashboard(tenantId, { platform: 'SHOPEE', shopKey: 'shop1', endMonth: '2026-10', range: 1 })
    // ค่าที่หน่วยผิดถูกตัดออกทั้งตัวเศษและตัวหาร (ไม่ใช่ทบ 0 เข้าตัวหาร) → ไม่มีเดือนไหนใช้ได้เลย → crr=0, clv=0
    expect(dash.kpis.customer.crr).toBe(0)
    expect(dash.kpis.customer.clv).toBe(0)
  })
})

describe('ข้อ 18 — allocation รายสินค้าต้องรวมเท่ายอดจริงของเดือนเสมอ', () => {
  it('โฆษณาชี้สินค้าที่ไม่มีแถวยอดขาย + แถวไม่มี product_id เคยอยู่ในตัวหาร → รวมแล้วต้องเท่ายอดจริงทุกชนิดต้นทุน', () => {
    const tenantId = newTenant()
    const monthId = makeMonth(tenantId, '2026-10', {
      income: { total_income: 1000, commission: -30, service_fee: -10, transaction_fee: -5, infrastructure_fee: -5, ams_commission: -40, shipping_buyer_paid: 0, shipping_shopee_subsidy: 0, shipping_charged: -30, shipping_return: 0, refund_to_buyer: -25, adjustments: { refund_after_complete: 0 } },
      // โฆษณารวม 100 แต่ตรงสินค้ารวม 70 (P1=20, P3=50 ที่ไม่มีแถวสินค้าเลย) → เหลือพูล 30
      ads: { total_cost: 100, campaigns: [{ name: 'c1', sales: 1, clicks: 1, impressions: 1, cost: 20, product_id: 'P1' }, { name: 'c2', sales: 1, clicks: 1, impressions: 1, cost: 50, product_id: 'P3' }] },
      stats: { totals: { sales_confirmed: 1000, orders_confirmed: 10, orders_all: 10, cancelled_orders: 0, potential_buyers: 1, new_buyers: 1, buyers: 1, repeat_rate: 0 } },
    })
    // P1 มียอดขายจริง, P3 ไม่มีแถวสินค้าเลย (กรณี "โฆษณาชี้สินค้าไม่มีแถวยอดขาย — เคยหายไปเฉยๆ")
    addParent(tenantId, monthId, { productId: 'P1', productName: 'สินค้า 1', salesAll: 800, salesConfirmed: 800, ordersAll: 8, ordersConfirmed: 8, qtyConfirmed: 8, cartVisitors: 8, buyersConfirmed: 8 })
    // แถวไม่มี product_id (เคยอยู่ในตัวหารแต่ไม่เคยได้รับส่วนแบ่งเลย)
    db.prepare(`
      INSERT INTO platform_month_products
        (id, month_id, tenant_id, product_id, level, product_name, sales_all, sales_confirmed, orders_all, orders_confirmed, qty_all, qty_confirmed, cart_visitors, buyers_confirmed)
      VALUES (?, ?, ?, NULL, 'parent', 'ไม่ผูกสินค้า', 200, 200, 2, 2, 2, 2, 2, 2)
    `).run(generateId(), monthId, tenantId)

    const dash = getPlatformDashboard(tenantId, { platform: 'SHOPEE', shopKey: 'shop1', endMonth: '2026-10', range: 1 })
    const totalAds = dash.products.reduce((s, p) => s + p.ads, 0)
    const totalAffiliate = dash.products.reduce((s, p) => s + p.affiliate, 0)
    const totalShip = dash.products.reduce((s, p) => s + p.shippingExcess, 0)
    const totalRefund = dash.products.reduce((s, p) => s + p.refunds, 0)
    expect(totalAds).toBeCloseTo(100, 2) // เท่า ads.total_cost จริง ไม่ใช่แค่ 70 ที่ตรงสินค้า+ส่วนแบ่งจากพูล
    expect(totalAffiliate).toBeCloseTo(40, 2)
    expect(totalShip).toBeCloseTo(30, 2)
    expect(totalRefund).toBeCloseTo(25, 2)
  })

  it('โฆษณาตรงสินค้ารวมเกินยอดจริงของเดือน (เคย max(0,...) ทำให้รวมเกิน) → รวมยังต้องเท่ายอดจริง', () => {
    const tenantId = newTenant()
    const monthId = makeMonth(tenantId, '2026-10', {
      income: { total_income: 100, commission: 0, service_fee: 0, transaction_fee: 0, infrastructure_fee: 0, ams_commission: 0, shipping_buyer_paid: 0, shipping_shopee_subsidy: 0, shipping_charged: 0, shipping_return: 0, refund_to_buyer: 0, adjustments: { refund_after_complete: 0 } },
      ads: { total_cost: 50, campaigns: [{ name: 'c1', sales: 1, clicks: 1, impressions: 1, cost: 40, product_id: 'P1' }, { name: 'c2', sales: 1, clicks: 1, impressions: 1, cost: 40, product_id: 'P2' }] },
      stats: { totals: { sales_confirmed: 100, orders_confirmed: 1, orders_all: 1, cancelled_orders: 0, potential_buyers: 1, new_buyers: 1, buyers: 1, repeat_rate: 0 } },
    })
    addParent(tenantId, monthId, { productId: 'P1', productName: 'สินค้า 1', salesAll: 50, salesConfirmed: 50, ordersAll: 1, ordersConfirmed: 1, qtyConfirmed: 1, cartVisitors: 1, buyersConfirmed: 1 })
    addParent(tenantId, monthId, { productId: 'P2', productName: 'สินค้า 2', salesAll: 50, salesConfirmed: 50, ordersAll: 1, ordersConfirmed: 1, qtyConfirmed: 1, cartVisitors: 1, buyersConfirmed: 1 })

    const dash = getPlatformDashboard(tenantId, { platform: 'SHOPEE', shopKey: 'shop1', endMonth: '2026-10', range: 1 })
    const totalAds = dash.products.reduce((s, p) => s + p.ads, 0)
    expect(totalAds).toBeCloseTo(50, 2) // ไม่ใช่ 80 (ยอดโฆษณาตรงสินค้ารวมที่เกินจริง)
  })
})

describe('ข้อ 19 — estimates ต้องติดป้ายค่าประมาณให้ครบ และไม่หายเกลี้ยงเมื่อไม่มีสินค้า', () => {
  it('ไม่มีสินค้าเลยในเดือน แต่ยังต้องติด flag GP เฉลี่ยทั้งร้าน และ CRR/CLV', () => {
    const tenantId = newTenant()
    makeMonth(tenantId, '2026-10', {
      income: { total_income: 100, commission: -5, service_fee: 0, transaction_fee: 0, infrastructure_fee: 0, ams_commission: 0, shipping_buyer_paid: 0, shipping_shopee_subsidy: 0, shipping_charged: 0, shipping_return: 0, refund_to_buyer: 0, adjustments: { refund_after_complete: 0 } },
      ads: { total_cost: 0, campaigns: [] },
      stats: { totals: { sales_confirmed: 100, orders_confirmed: 1, orders_all: 1, cancelled_orders: 0, potential_buyers: 1, new_buyers: 1, buyers: 1, repeat_rate: 0.1 } },
    })
    // ไม่เพิ่ม parent เลย → productList ว่าง
    const dash = getPlatformDashboard(tenantId, { platform: 'SHOPEE', shopKey: 'shop1', endMonth: '2026-10', range: 1 })
    expect(dash.products).toHaveLength(0)
    expect(dash.estimates).toContain('gp_percent_shopwide_avg')
    expect(dash.estimates).toContain('crr_clv_weighted_estimate')
    expect(dash.estimates).not.toContain('ads_by_sales_share') // ไม่มีสินค้า ไม่มีให้แบ่งสัดส่วน
  })
})

describe('เช็คเพิ่ม — monthsWithData ต้องไม่นับเดือนที่มีแถวแต่ยังไม่มีไฟล์รายรับ', () => {
  it('income_json เป็น NULL (ยังไม่อัปโหลดไฟล์รายรับ) → ไม่นับใน monthsWithData', () => {
    const tenantId = newTenant()
    db.prepare(`
      INSERT INTO platform_months (id, tenant_id, platform, shop_key, month, income_json, ads_json, stats_json, status)
      VALUES (?, ?, 'SHOPEE', 'shop1', '2026-10', NULL, NULL, NULL, 'COLLECTING')
    `).run(generateId(), tenantId)
    const dash = getPlatformDashboard(tenantId, { platform: 'SHOPEE', shopKey: 'shop1', endMonth: '2026-10', range: 1 })
    expect(dash.monthsWithData).toBe(0)
  })
})
