import db from '../db/sqlite'
import { findPlatformAlias } from './stockItem.service'
import { sourceRefOf } from './platformMonthSale.service'

// ============================================================
// เฟส 4: แดชบอร์ดกำไรรายสินค้า + KPI 4 หมวด (อ่านอย่างเดียว ไม่เขียนอะไรเลย)
// อ่านจาก platform_months (เฟส 1) + platform_month_products/platform_days (เฟส 1)
// + stock_item_aliases ผ่าน findPlatformAlias (เฟส 2) — ไม่คำนวณ COGS จาก cogs_breakdown
// (เฟส 3) เพราะก้อนนั้นแตก BOM แล้วรวมข้าม stock item ไปแล้ว ไม่เหลือ "ต่อสินค้าต้นทาง"
// ============================================================

const r2 = (n: number) => Math.round((n || 0) * 100) / 100
const safeDiv = (n: number, d: number) => (d ? n / d : 0)

export function monthsWindow(endMonth: string, range: number): string[] {
  const [ey, em] = endMonth.split('-').map(Number)
  const out: string[] = []
  for (let i = range - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ey, em - 1 - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export interface ShopInfo { platform: string; shopKey: string; months: string[] }

export function getDashboardShops(tenantId: string): ShopInfo[] {
  const rows = db.prepare(`
    SELECT platform, shop_key, month FROM platform_months WHERE tenant_id = ? ORDER BY platform, shop_key, month
  `).all(tenantId) as any[]
  const map = new Map<string, ShopInfo>()
  for (const r of rows) {
    const key = `${r.platform}:${r.shop_key}`
    if (!map.has(key)) map.set(key, { platform: r.platform, shopKey: r.shop_key, months: [] })
    map.get(key)!.months.push(r.month)
  }
  return Array.from(map.values())
}

function unitCostOf(tenantId: string, stockItemId: string): number {
  const row = db.prepare(`SELECT unit_cost FROM stock_items WHERE id = ? AND tenant_id = ?`).get(stockItemId, tenantId) as any
  return row ? Number(row.unit_cost) || 0 : 0
}

export interface DashboardParams {
  platform: string
  shopKey: string
  endMonth: string
  range: 1 | 3 | 6 | 12
}

export function getPlatformDashboard(tenantId: string, params: DashboardParams) {
  const { platform, shopKey, endMonth, range } = params
  const windowMonths = monthsWindow(endMonth, range)
  const placeholders = windowMonths.map(() => '?').join(',')
  const monthRows = db.prepare(`
    SELECT * FROM platform_months WHERE tenant_id = ? AND platform = ? AND shop_key = ? AND month IN (${placeholders})
  `).all(tenantId, platform, shopKey, ...windowMonths) as any[]
  const byMonth = new Map(monthRows.map((r) => [r.month, r]))

  type ProductAgg = {
    productId: string
    name: string
    qtyConfirmed: number
    salesConfirmed: number
    salesAll: number
    ordersAll: number
    ordersConfirmed: number
    cartVisitors: number
    buyersConfirmed: number
    cogs: number
    gp: number
    ads: number
    affiliate: number
    shippingExcess: number
    refunds: number
    costWeightedSum: number
    costWeightQty: number
    costUnknown: boolean
  }
  const products = new Map<string, ProductAgg>()
  const monthsOut: Array<{ month: string; hasData: boolean; sales_confirmed: number; ads_cost: number; profit: number; daily?: any[] }> = []

  let salesConfirmedTotal = 0 // จาก products parent (ตามสเปค ยอดขายสุทธิ)
  let statsSalesConfirmedTotal = 0 // จาก stats totals (ใช้คู่กับ orders_confirmed สำหรับ AOV เท่านั้น)
  let ordersConfirmedTotal = 0
  let ordersAllTotal = 0
  let cancelledOrdersTotal = 0
  let feesNum = 0
  let incomeDen = 0
  let grossPriceTotal = 0 // ราคาเต็ม (product_list_price) — ใช้เป็นแท่งแรกของ waterfall ฝั่งหน้าเว็บ
  let storeDiscountTotal = 0 // ส่วนลดร้าน (seller_discount) — แท่งที่สองของ waterfall
  let amsTotal = 0
  let shippingExcessTotal = 0
  let refundsTotal = 0
  let adsSalesTotal = 0
  let adsCostTotal = 0
  let adsClicksTotal = 0
  let adsImpressionsTotal = 0
  let potentialBuyersTotal = 0
  let newBuyersTotal = 0
  let cartVisitorsTotal = 0
  let buyersConfirmedTotal = 0
  let crrNum = 0
  let crrDen = 0
  let monthsWithData = 0

  const getOrCreateProduct = (productId: string, name: string): ProductAgg => {
    let p = products.get(productId)
    if (!p) {
      p = {
        productId, name, qtyConfirmed: 0, salesConfirmed: 0, salesAll: 0, ordersAll: 0, ordersConfirmed: 0,
        cartVisitors: 0, buyersConfirmed: 0, cogs: 0, gp: 0, ads: 0, affiliate: 0, shippingExcess: 0, refunds: 0,
        costWeightedSum: 0, costWeightQty: 0, costUnknown: false,
      }
      products.set(productId, p)
    }
    return p
  }

  for (const month of windowMonths) {
    const row = byMonth.get(month)
    if (!row) { monthsOut.push({ month, hasData: false, sales_confirmed: 0, ads_cost: 0, profit: 0 }); continue }

    const income = row.income_json ? JSON.parse(row.income_json) : null
    const stats = row.stats_json ? JSON.parse(row.stats_json) : null
    const ads = row.ads_json ? JSON.parse(row.ads_json) : null
    // ponytail: นับว่า "มีข้อมูล" เฉพาะเดือนที่มีไฟล์รายรับแล้วจริงๆ ไม่ใช่แค่มีแถว platform_months
    // (แถวอาจถูกสร้างไว้ก่อนแล้วไฟล์ยังไม่ถูกอัปโหลด)
    if (income) monthsWithData++

    let gpRateMonth = 0
    let amsMonth = 0
    let shipExcessMonth = 0
    let refundsMonth = 0
    if (income) {
      const fees = Math.abs((income.commission || 0) + (income.service_fee || 0) + (income.transaction_fee || 0) + (income.infrastructure_fee || 0))
      feesNum += fees
      incomeDen += income.total_income || 0
      gpRateMonth = safeDiv(fees, income.total_income || 0)
      amsMonth = Math.abs(income.ams_commission || 0)
      amsTotal += amsMonth
      shipExcessMonth = -((income.shipping_buyer_paid || 0) + (income.shipping_shopee_subsidy || 0) + (income.shipping_charged || 0) + (income.shipping_return || 0))
      shippingExcessTotal += shipExcessMonth
      refundsMonth = Math.abs(income.refund_to_buyer || 0) + Math.abs(income.adjustments?.refund_after_complete || 0)
      refundsTotal += refundsMonth
      grossPriceTotal += income.product_list_price || 0
      storeDiscountTotal += Math.abs(income.seller_discount || 0)
    }
    if (stats?.totals) {
      const t = stats.totals
      ordersConfirmedTotal += t.orders_confirmed || 0
      ordersAllTotal += t.orders_all || 0
      cancelledOrdersTotal += t.cancelled_orders || 0
      potentialBuyersTotal += t.potential_buyers || 0
      newBuyersTotal += t.new_buyers || 0
      // repeat_rate เป็นเศษส่วน 0–1 เสมอ (zod เช็คตอนรับไฟล์) — ค่าที่หลุดมา >1 หรือ <0 คือหน่วยผิด (เช่น 12.5 แทน 0.125)
      // ไม่เอามาคิดค่าเฉลี่ยเลย (ไม่ใช่ทบ 0) กันลาก CRR/CLV พังทั้งก้อน
      const rr = t.repeat_rate
      if (rr == null || (rr >= 0 && rr <= 1)) {
        crrNum += (rr || 0) * (t.buyers || 0)
        crrDen += t.buyers || 0
      }
      statsSalesConfirmedTotal += t.sales_confirmed || 0
    }

    const directAdsByProduct = new Map<string, number>()
    let directAdsCost = 0
    let adsCostMonth = 0
    if (ads) {
      adsCostMonth = ads.total_cost || 0
      adsCostTotal += adsCostMonth
      for (const c of ads.campaigns || []) {
        adsSalesTotal += c.sales || 0
        adsClicksTotal += c.clicks || 0
        adsImpressionsTotal += c.impressions || 0
        if (c.product_id) {
          directAdsByProduct.set(c.product_id, (directAdsByProduct.get(c.product_id) || 0) + (c.cost || 0))
          directAdsCost += c.cost || 0
        }
      }
    }
    const remainingAdsPool = Math.max(0, adsCostMonth - directAdsCost)

    const parentRows = db.prepare(`
      SELECT * FROM platform_month_products WHERE month_id = ? AND level = 'parent'
    `).all(row.id) as any[]
    // เฉพาะแถวที่มี product_id เป็นตัวหารส่วนแบ่ง — แถวไม่มี product_id เคยอยู่ในตัวหารแต่ไม่เคยได้รับส่วนแบ่งเลย
    const eligibleParents = parentRows.filter((r) => r.product_id)
    const eligibleSalesSum = eligibleParents.reduce((s, r) => s + (r.sales_confirmed || 0), 0)

    let maxShareIdx = -1, maxShareVal = -1
    const allocs = eligibleParents.map((pr, idx) => {
      const share = eligibleSalesSum > 0 ? (pr.sales_confirmed || 0) / eligibleSalesSum : 0
      if ((pr.sales_confirmed || 0) > maxShareVal) { maxShareVal = pr.sales_confirmed || 0; maxShareIdx = idx }
      return {
        pr,
        adsAlloc: (directAdsByProduct.get(pr.product_id) || 0) + remainingAdsPool * share,
        amsAlloc: amsMonth * share,
        shipAlloc: shipExcessMonth * share,
        refundAlloc: refundsMonth * share,
      }
    })
    // เกลี่ยเศษที่เหลือไปให้สินค้าที่มีส่วนแบ่งมากที่สุด เพื่อให้ sum(allocation ของทุกสินค้า) == ยอดจริงของเดือนเสมอ
    // ครอบคลุมทั้งโฆษณาที่ชี้สินค้าไม่มีแถวยอดขาย (เคยหายไปเฉยๆ) และโฆษณาตรงสินค้ารวมเกินยอดจริง (เคยเกินเพราะ max(0,...))
    // ponytail: largest-remainder แบบง่าย (โยนเศษไปก้อนใหญ่สุดก้อนเดียว ไม่ไล่ปันทีละหน่วย)
    if (maxShareIdx >= 0) {
      const t = allocs[maxShareIdx]
      t.adsAlloc += adsCostMonth - allocs.reduce((s, a) => s + a.adsAlloc, 0)
      t.amsAlloc += amsMonth - allocs.reduce((s, a) => s + a.amsAlloc, 0)
      t.shipAlloc += shipExcessMonth - allocs.reduce((s, a) => s + a.shipAlloc, 0)
      t.refundAlloc += refundsMonth - allocs.reduce((s, a) => s + a.refundAlloc, 0)
    }

    let profitMonth = 0
    for (const { pr, adsAlloc, amsAlloc, shipAlloc, refundAlloc } of allocs) {
      const gpAlloc = (pr.sales_confirmed || 0) * gpRateMonth

      // ── ต้นทุน/หน่วย จากเฟส 2 (ผูก SKU) — ใช้ตัวเลือกถ้ามี ไม่มีตัวเลือกใช้แถวสินค้าเอง ──
      const variantRows = db.prepare(`
        SELECT * FROM platform_month_products WHERE month_id = ? AND level = 'variant' AND product_id = ?
      `).all(row.id, pr.product_id) as any[]
      const costRows = variantRows.length > 0 ? variantRows : [pr]
      let weightedSum = 0, weightQty = 0, unmapped = false
      for (const cr of costRows) {
        const ref = sourceRefOf(platform, { product_id: cr.product_id, variant_id: cr.variant_id })
        const alias = findPlatformAlias(tenantId, ref)
        const qty = cr.qty_confirmed || 0
        if (!alias) { if (qty > 0) unmapped = true; continue }
        const cost = unitCostOf(tenantId, alias.stockItemId) * (alias.factor || 1)
        weightedSum += cost * qty
        weightQty += qty
      }
      const cogsAlloc = weightedSum

      const p = getOrCreateProduct(pr.product_id, pr.product_name || pr.product_id)
      p.qtyConfirmed += pr.qty_confirmed || 0
      p.salesConfirmed += pr.sales_confirmed || 0
      p.salesAll += pr.sales_all || 0
      p.ordersAll += pr.orders_all || 0
      p.ordersConfirmed += pr.orders_confirmed || 0
      p.cartVisitors += pr.cart_visitors || 0
      p.buyersConfirmed += pr.buyers_confirmed || 0
      p.cogs += cogsAlloc
      p.gp += gpAlloc
      p.ads += adsAlloc
      p.affiliate += amsAlloc
      p.shippingExcess += shipAlloc
      p.refunds += refundAlloc
      p.costWeightedSum += weightedSum
      p.costWeightQty += weightQty
      if (unmapped) p.costUnknown = true

      cartVisitorsTotal += pr.cart_visitors || 0
      buyersConfirmedTotal += pr.buyers_confirmed || 0
      salesConfirmedTotal += pr.sales_confirmed || 0

      const profitAlloc = (pr.sales_confirmed || 0) - cogsAlloc - gpAlloc - adsAlloc - amsAlloc - shipAlloc - refundAlloc
      profitMonth += profitAlloc
    }

    const dayEntry: any = { month, hasData: true, sales_confirmed: r2(stats?.totals?.sales_confirmed || 0), ads_cost: r2(adsCostMonth), profit: r2(profitMonth) }
    if (range === 1) {
      dayEntry.daily = (db.prepare(`SELECT * FROM platform_days WHERE month_id = ? ORDER BY date`).all(row.id) as any[])
        .map((d) => ({
          date: d.date, sales_all: d.sales_all, orders_all: d.orders_all, sales_confirmed: d.sales_confirmed,
          orders_confirmed: d.orders_confirmed, visitors: d.visitors, clicks: d.clicks,
          cancelled_orders: d.cancelled_orders, cancelled_sales: d.cancelled_sales, buyers: d.buyers,
          new_buyers: d.new_buyers, existing_buyers: d.existing_buyers, potential_buyers: d.potential_buyers,
        }))
    }
    monthsOut.push(dayEntry)
  }

  let cogsTotal = 0, gpTotal = 0, profitTotal = 0
  const productList = Array.from(products.values()).map((p) => {
    cogsTotal += p.cogs
    gpTotal += p.gp
    const profit = p.salesConfirmed - p.cogs - p.gp - p.ads - p.affiliate - p.shippingExcess - p.refunds
    profitTotal += profit
    const unitCost = p.costWeightQty > 0 ? p.costWeightedSum / p.costWeightQty : null
    const costKnown = !p.costUnknown && !!unitCost && unitCost > 0
    return {
      productId: p.productId,
      name: p.name,
      qtyConfirmed: r2(p.qtyConfirmed),
      salesConfirmed: r2(p.salesConfirmed),
      salesAll: r2(p.salesAll),
      ordersAll: r2(p.ordersAll),
      ordersConfirmed: r2(p.ordersConfirmed),
      costKnown,
      unitCost: unitCost == null ? null : r2(unitCost),
      cogs: r2(p.cogs),
      gp: r2(p.gp),
      ads: r2(p.ads),
      affiliate: r2(p.affiliate),
      shippingExcess: r2(p.shippingExcess),
      refunds: r2(p.refunds),
      profit: r2(profit),
      profitPerUnit: p.qtyConfirmed > 0 ? r2(profit / p.qtyConfirmed) : null,
      margin: p.salesConfirmed > 0 ? r2((profit / p.salesConfirmed) * 100) : null,
    }
  }).sort((a, b) => b.salesConfirmed - a.salesConfirmed)

  const cancelled = Array.from(products.values())
    .map((p) => ({
      productId: p.productId,
      name: p.name,
      ordersAll: r2(p.ordersAll),
      ordersConfirmed: r2(p.ordersConfirmed),
      cancelRate: p.ordersAll > 0 ? r2(((p.ordersAll - p.ordersConfirmed) / p.ordersAll) * 100) : 0,
      lostSales: r2(p.salesAll - p.salesConfirmed),
    }))
    .filter((c) => c.lostSales > 0)
    .sort((a, b) => b.lostSales - a.lostSales)
    .slice(0, 10)

  const contributionMargin = safeDiv(salesConfirmedTotal - cogsTotal - gpTotal - shippingExcessTotal - refundsTotal, salesConfirmedTotal)
  const aov = safeDiv(statsSalesConfirmedTotal, ordersConfirmedTotal)
  const crr = safeDiv(crrNum, crrDen)
  const cac = safeDiv(adsCostTotal + amsTotal, newBuyersTotal)
  const clv = crr < 1 ? safeDiv(aov * contributionMargin, 1 - crr) : 0
  // ไม่มีคนเข้าตะกร้าเลย = ไม่มีข้อมูลให้คิด AR ไม่ใช่ "ทิ้งตะกร้า 100%"
  const ar = cartVisitorsTotal > 0 ? r2((1 - safeDiv(buyersConfirmedTotal, cartVisitorsTotal)) * 100) : null

  const kpis = {
    sales: {
      grossPrice: r2(grossPriceTotal), // ราคาเต็ม — แท่งแรกของ waterfall ฝั่งหน้าเว็บ
      storeDiscount: r2(storeDiscountTotal), // ส่วนลดร้าน — แท่งที่สอง
      netSales: r2(salesConfirmedTotal),
      profit: r2(profitTotal),
      margin: r2(safeDiv(profitTotal, salesConfirmedTotal) * 100),
      aov: r2(aov),
      cancelRate: r2(safeDiv(cancelledOrdersTotal, ordersAllTotal) * 100),
    },
    platformCost: {
      gpPercent: r2(safeDiv(feesNum, incomeDen) * 100),
      affiliate: r2(amsTotal),
      shippingExcess: r2(shippingExcessTotal),
    },
    ads: {
      roas: r2(safeDiv(adsSalesTotal, adsCostTotal)),
      tacos: r2(safeDiv(adsCostTotal, salesConfirmedTotal) * 100),
      ctr: r2(safeDiv(adsClicksTotal, adsImpressionsTotal) * 100),
      cpl: r2(safeDiv(adsCostTotal, potentialBuyersTotal)),
    },
    customer: {
      cac: r2(cac),
      ar,
      crr: r2(crr * 100),
      clv: r2(clv),
      clvCac: r2(safeDiv(clv, cac)),
    },
  }

  // gpPercent/CRR/CLV เป็นค่าเฉลี่ยทั้งร้าน/สูตรประมาณเสมอ ไม่ขึ้นกับว่ามีสินค้าหรือไม่ — ต้องติดป้ายไว้ตลอด
  // ส่วนที่แบ่งสัดส่วนรายสินค้า (โฆษณา/Affiliate/ค่าส่ง/คืนเงิน/ทุนจาก unit_cost) มีความหมายเฉพาะตอนมีสินค้า
  const estimates: string[] = ['gp_percent_shopwide_avg', 'crr_clv_weighted_estimate']
  if (productList.length > 0) {
    estimates.push('ads_by_sales_share', 'affiliate_by_sales_share', 'shipping_refund_by_sales_share', 'cogs_from_unit_cost')
  }

  return {
    months: monthsOut,
    monthsWithData,
    monthsInWindow: windowMonths.length,
    kpis,
    products: productList,
    cancelled,
    estimates,
  }
}
