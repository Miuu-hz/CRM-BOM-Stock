/**
 * Platform Fees Calculator
 * คำนวณค่าธรรมเนียมแต่ละ Platform (Lazada, Shopee, TikTok Shop)
 */

export type PlatformType = 'lazada' | 'shopee' | 'tiktok' | 'facebook' | 'line'

export interface PlatformFeeConfig {
  commissionRate: number // % ค่าคอมมิชชั่น (เช่น 3% = 0.03)
  transactionFeeRate: number // % ค่าธรรมเนียมการทำธุรกรรม
  paymentGatewayFee: number // ค่าธรรมเนียม Payment Gateway
  shippingSubsidy?: number // เงินอุดหนุนค่าขนส่ง (ถ้ามี)
  marketingFee?: number // ค่าโฆษณา/ส่งเสริมการขาย
}

/**
 * ค่าธรรมเนียมมาตรฐานของแต่ละ Platform (อ้างอิงจากข้อมูล 2024-2025)
 * หมายเหตุ: ค่าธรรมเนียมจริงอาจแตกต่างตามประเภทสินค้าและโปรโมชั่น
 */
export const PLATFORM_FEE_CONFIGS: Record<PlatformType, PlatformFeeConfig> = {
  lazada: {
    commissionRate: 0.04, // 4% (ขึ้นอยู่กับหมวดหมู่สินค้า 1-4%)
    transactionFeeRate: 0.02, // 2%
    paymentGatewayFee: 0.0239, // 2.39% + ฿3 per transaction
    shippingSubsidy: 0, // แล้วแต่โปรโมชั่น
    marketingFee: 0,
  },
  shopee: {
    commissionRate: 0.03, // 3% (ขึ้นอยู่กับหมวดหมู่สินค้า 1-5%)
    transactionFeeRate: 0.02, // 2%
    paymentGatewayFee: 0.02, // ~2%
    shippingSubsidy: 0,
    marketingFee: 0,
  },
  tiktok: {
    commissionRate: 0.06, // 6% (หมวดหมู่ทั่วไป 2-8%)
    transactionFeeRate: 0.01, // 1%
    paymentGatewayFee: 0.02, // 2%
    shippingSubsidy: 0,
    marketingFee: 0,
  },
  facebook: {
    commissionRate: 0.05, // 5% (Facebook/Instagram Shop)
    transactionFeeRate: 0.004, // 0.4% + ฿2 per order
    paymentGatewayFee: 0,
    shippingSubsidy: 0,
    marketingFee: 0,
  },
  line: {
    commissionRate: 0.05, // 5% (LINE Shopping)
    transactionFeeRate: 0.02, // 2%
    paymentGatewayFee: 0.02, // 2%
    shippingSubsidy: 0,
    marketingFee: 0,
  },
}

export interface SaleOrder {
  sellingPrice: number // ราคาขาย
  quantity: number
  platform: PlatformType
  shippingCost?: number // ค่าขนส่งที่ลูกค้าจ่าย
  shippingActualCost?: number // ค่าขนส่งจริงที่เราจ่าย
  affiliateCommission?: number // ค่าคอมมิชชั่น Affiliate (ถ้ามี)
  discountAmount?: number // ส่วนลดที่ร้านรับผิดชอบ
  voucherAmount?: number // Voucher ที่ร้านรับผิดชอบ
}

export interface PlatformFeesBreakdown {
  platform: PlatformType
  grossRevenue: number // รายได้รวม
  commissionFee: number // ค่าคอมมิชชั่น
  transactionFee: number // ค่าธรรมเนียมการทำธุรกรรม
  paymentGatewayFee: number // ค่า Payment Gateway
  shippingCost: number // ค่าขนส่งที่ต้องจ่ายจริง
  affiliateCost: number // ค่า Affiliate
  marketingCost: number // ค่าโฆษณา
  discountCost: number // ต้นทุนส่วนลด
  totalFees: number // ค่าธรรมเนียมรวมทั้งหมด
  netRevenue: number // รายได้สุทธิ (หลังหักค่าธรรมเนียม)
}

/**
 * คำนวณค่าธรรมเนียมของแต่ละ Platform
 */
export function calculatePlatformFees(order: SaleOrder): PlatformFeesBreakdown {
  const config = PLATFORM_FEE_CONFIGS[order.platform]

  // รายได้รวม = (ราคาขาย × จำนวน) + ค่าขนส่งที่ได้รับ
  const grossRevenue =
    (order.sellingPrice * order.quantity) +
    (order.shippingCost || 0)

  // หักส่วนลดและ Voucher
  const adjustedRevenue =
    grossRevenue -
    (order.discountAmount || 0) -
    (order.voucherAmount || 0)

  // คำนวณค่าธรรมเนียมแต่ละประเภท
  const commissionFee = adjustedRevenue * config.commissionRate
  const transactionFee = adjustedRevenue * config.transactionFeeRate
  const paymentGatewayFee = adjustedRevenue * config.paymentGatewayFee
  const affiliateCost = order.affiliateCommission || 0
  const marketingCost = config.marketingFee || 0
  const discountCost = (order.discountAmount || 0) + (order.voucherAmount || 0)

  // ค่าขนส่งที่ต้องจ่ายจริง (ถ้าไม่ได้รับเงินอุดหนุน)
  const shippingCost = order.shippingActualCost || 0

  // รวมค่าธรรมเนียมทั้งหมด
  const totalFees =
    commissionFee +
    transactionFee +
    paymentGatewayFee +
    affiliateCost +
    marketingCost +
    discountCost +
    shippingCost

  // รายได้สุทธิ
  const netRevenue = grossRevenue - totalFees

  return {
    platform: order.platform,
    grossRevenue,
    commissionFee,
    transactionFee,
    paymentGatewayFee,
    shippingCost,
    affiliateCost,
    marketingCost,
    discountCost,
    totalFees,
    netRevenue,
  }
}

/**
 * คำนวณกำไรสุทธิ
 */
export interface ProfitCalculation {
  grossRevenue: number // รายได้รวม
  productionCost: number // ต้นทุนการผลิต
  platformFees: number // ค่าธรรมเนียม Platform
  shippingCost: number // ค่าขนส่งที่จ่ายจริง
  otherCosts: number // ค่าใช้จ่ายอื่นๆ
  totalCosts: number // ต้นทุนรวม
  netProfit: number // กำไรสุทธิ
  profitMargin: number // % อัตรากำไรสุทธิ
  grossProfitMargin: number // % อัตรากำไรขั้นต้น
}

/**
 * คำนวณกำไรสุทธิจากการขาย
 */
export function calculateProfit(
  order: SaleOrder,
  productionCost: number
): ProfitCalculation {
  const fees = calculatePlatformFees(order)

  const grossRevenue = fees.grossRevenue
  const platformFees = fees.totalFees
  const shippingCost = order.shippingActualCost || 0
  const otherCosts = 0 // ค่าใช้จ่ายอื่นๆ เช่น packaging, labor

  const totalCosts = productionCost + platformFees + shippingCost + otherCosts
  const netProfit = grossRevenue - totalCosts

  // คำนวณ Gross Profit (ก่อนหักค่าธรรมเนียม)
  const grossProfit = grossRevenue - productionCost

  return {
    grossRevenue,
    productionCost,
    platformFees,
    shippingCost,
    otherCosts,
    totalCosts,
    netProfit,
    profitMargin: (netProfit / grossRevenue) * 100,
    grossProfitMargin: (grossProfit / grossRevenue) * 100,
  }
}

/**
 * เปรียบเทียบกำไรระหว่าง Platforms
 */
export function comparePlatforms(
  sellingPrice: number,
  quantity: number,
  productionCost: number,
  platforms: PlatformType[] = ['lazada', 'shopee', 'tiktok']
): Record<PlatformType, ProfitCalculation> {
  const results: any = {}

  platforms.forEach(platform => {
    const order: SaleOrder = {
      sellingPrice,
      quantity,
      platform,
    }

    results[platform] = calculateProfit(order, productionCost)
  })

  return results
}

/**
 * หาราคาขายที่เหมาะสมเพื่อให้ได้กำไรตามเป้า
 */
export function calculateTargetPrice(
  productionCost: number,
  targetProfitMargin: number, // % กำไรที่ต้องการ เช่น 30% = 30
  platform: PlatformType,
  quantity: number = 1
): number {
  const config = PLATFORM_FEE_CONFIGS[platform]

  // สูตร: Selling Price = (Cost + Target Profit) / (1 - Total Fee Rate)
  const totalFeeRate =
    config.commissionRate +
    config.transactionFeeRate +
    config.paymentGatewayFee

  // Target Profit Margin คือ % ของ selling price
  // Selling Price × (1 - Margin%) = Cost + Fees
  // Selling Price = Cost / ((1 - Margin%) - Fee Rate)

  const targetProfitDecimal = targetProfitMargin / 100
  const sellingPrice = productionCost / ((1 - targetProfitDecimal) - totalFeeRate)

  return Math.ceil(sellingPrice) // ปัดขึ้น
}
