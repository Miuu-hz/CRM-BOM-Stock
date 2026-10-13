import { z } from 'zod'
import { IMcpServer } from '../sdk-compat'
import { ok } from './shared'
import {
  submitFile,
  getMonthStatus,
  PlatformMonthError,
  type PlatformFileType,
  type IncomePayload,
  type BalancePayload,
  type ProductsPayload,
  type AdsPayload,
  type StatsPayload,
} from '../../services/platformMonth.service'

// ── zod schema ต่อชนิดไฟล์ — ตรวจรูปร่าง data ให้ตรงก่อนส่งเข้า service (service ตรวจสมการเอง) ──────
const incomeSchema = z.object({
  period_start: z.string(),
  period_end: z.string(),
  order_count: z.number(),
  product_list_price: z.number(),
  seller_discount: z.number(),
  refund_to_buyer: z.number(),
  shopee_product_discount: z.number(),
  product_sales: z.number(),
  total_income: z.number(),
  shipping_buyer_paid: z.number(),
  shipping_shopee_subsidy: z.number(),
  shipping_charged: z.number(),
  shipping_return: z.number(),
  commission: z.number(),
  ams_commission: z.number(),
  service_fee: z.number(),
  infrastructure_fee: z.number(),
  transaction_fee: z.number(),
  ads_topup_from_escrow: z.number(),
  other_fees: z.number().default(0),
  total_expense: z.number(),
  total_transferred: z.number(),
  adjustments: z.object({
    total: z.number(),
    marketing: z.number(),
    shipping_claim: z.number(),
    refund_after_complete: z.number(),
    other: z.number(),
  }),
})

const balanceSchema = z.object({
  period_start: z.string(),
  period_end: z.string(),
  opening: z.number(),
  closing: z.number(),
  money_in: z.number(),
  money_out: z.number(),
  order_income_in: z.number(),
  order_income_out: z.number(),
  adjustments_in: z.number(),
  adjustments_out: z.number(),
  withdrawals: z.array(z.object({ date: z.string(), amount: z.number() })),
  withdrawals_total: z.number(),
})

const productRowSchema = z.object({
  level: z.enum(['parent', 'variant']),
  product_id: z.string().nullable().optional(),
  variant_id: z.string().nullable().optional(),
  product_name: z.string().optional(),
  variant_name: z.string().optional(),
  sales_all: z.number().optional(),
  sales_confirmed: z.number().optional(),
  orders_all: z.number().optional(),
  orders_confirmed: z.number().optional(),
  qty_all: z.number().optional(),
  qty_confirmed: z.number().optional(),
  visitors: z.number().optional(),
  cart_visitors: z.number().optional(),
  buyers_confirmed: z.number().optional(),
  clicks: z.number().optional(),
  impressions: z.number().optional(),
  repeat_rate: z.number().optional(),
})
const productsSchema = z.object({ rows: z.array(productRowSchema) })

const adsCampaignSchema = z.object({
  name: z.string(),
  ad_type: z.string(),
  status: z.string(),
  product_id: z.string().nullable().optional(),
  impressions: z.number(),
  clicks: z.number(),
  orders: z.number(),
  direct_orders: z.number(),
  items_sold: z.number(),
  sales: z.number(),
  direct_sales: z.number(),
  cost: z.number(),
})
const adsSchema = z.object({
  period_start: z.string(),
  period_end: z.string(),
  campaigns: z.array(adsCampaignSchema),
  total_cost: z.number(),
})

const dayRowSchema = z.object({
  date: z.string(),
  sales_all: z.number(),
  orders_all: z.number(),
  sales_confirmed: z.number(),
  orders_confirmed: z.number(),
  visitors: z.number(),
  clicks: z.number(),
  cancelled_orders: z.number(),
  cancelled_sales: z.number(),
  buyers: z.number(),
  new_buyers: z.number(),
  existing_buyers: z.number(),
  potential_buyers: z.number(),
})
const statsSchema = z.object({
  period_start: z.string(),
  period_end: z.string(),
  totals: z.object({
    sales_all: z.number(),
    sales_confirmed: z.number(),
    orders_all: z.number(),
    orders_confirmed: z.number(),
    visitors: z.number(),
    clicks: z.number(),
    cancelled_orders: z.number(),
    cancelled_sales: z.number(),
    buyers: z.number(),
    new_buyers: z.number(),
    existing_buyers: z.number(),
    potential_buyers: z.number(),
    repeat_rate: z.number(),
  }),
  daily: z.array(dayRowSchema),
  sources: z.object({
    product_page: z.number(),
    live: z.number(),
    video: z.number(),
    partner: z.number(),
    ads_attributed: z.number(),
  }),
})

const SCHEMA_BY_TYPE: Record<PlatformFileType, z.ZodTypeAny> = {
  income: incomeSchema,
  balance: balanceSchema,
  products: productsSchema,
  ads: adsSchema,
  stats: statsSchema,
}

export function registerPlatformMonthTools(server: IMcpServer, tenantId: string): void {
  // ── platform_submit_file ──────────────────────────────────────────────────
  server.tool(
    'platform_submit_file',
    `ส่งไฟล์รายงานรอบเดือนของช่องทางขายแพลตฟอร์ม (ตอนนี้รองรับ Shopee — Lazada จะตามมาทีหลัง) เข้าสู่รอบเดือน
ต้องส่งแยกเป็น 5 ไฟล์ ไฟล์ไหนมาก่อนส่งก่อนได้ (file_type):
  1) income    — Seller Centre > การเงินของฉัน > รายรับ — อ่านยอดจาก "ชีตสรุป (Summary)" เท่านั้น ห้ามรวมเองจากแถวย่อย
  2) balance   — Seller Centre > การเงินของฉัน > ยอดคงเหลือ (เงินเข้า/ออก/ถอน)
  3) products  — Seller Centre > ข้อมูลเชิงลึกของธุรกิจ > สินค้า — ต้องมีทั้งแถวสรุปต่อสินค้า (level="parent")
     และแถวต่อตัวเลือก (level="variant") ถ้าสินค้าไม่มีตัวเลือกให้มีแค่แถว parent
  4) ads       — Seller Centre > การตลาด > โฆษณา (รายงานแคมเปญ)
  5) stats     — Seller Centre > ข้อมูลเชิงลึกของธุรกิจ > ร้านค้า (สถิติรายวัน)

กฎสำคัญ: ดึงเฉพาะตัวเลขตามฟิลด์ที่กำหนดไว้ ห้ามแนบไฟล์ดิบ ห้ามคำนวณเลขเอง ใช้ยอดที่ไฟล์สรุปให้มาตรงๆ
month = เดือนปฏิทินของรอบ (เช่นรอบตุลาคม 2026 ให้ month="2026-10") แม้ไฟล์จะมีช่วงวันที่ไม่ตรงเดือนเต็มก็ตาม
เครื่องหมาย: ค่าธรรมเนียม/รายจ่าย/เงินออกทุกตัว Shopee ให้มาเป็น "ค่าลบ" อยู่แล้วในไฟล์ของเขา — ส่งมาตามที่เห็น
ห้ามกลับเครื่องหมาย ระบบนี้บวกเลขตรงๆเสมอ (ไม่มีการลบในสมการใดๆ)
ส่งไฟล์ซ้ำ (เช่นแก้ตัวเลข) = เขียนทับไฟล์เดิมของเดือนนั้นทันที ไม่สร้างซ้อน
ถ้ารอบนี้ปิดแล้ว (status ไม่ใช่ COLLECTING — เฟสหลังจะล็อกรอบ) จะส่งไฟล์เพิ่ม/แก้ไม่ได้
ถ้าไฟล์ที่ส่งทำให้สมการภายในไฟล์หรือข้ามไฟล์ (กับไฟล์ที่เคยส่งแล้ว) ไม่ตรง ระบบจะปฏิเสธและบอกว่าสมการไหนพัง`,
    {
      platform: z.enum(['SHOPEE']).describe('แพลตฟอร์ม — รองรับ Shopee ก่อน'),
      shop_key: z.string().min(1).describe('ชื่อ/รหัสร้านที่คงที่ — กันข้อมูลชนกันถ้ามีหลายร้าน'),
      month: z.string().regex(/^\d{4}-\d{2}$/).describe('เดือนปฏิทินของรอบ รูปแบบ YYYY-MM'),
      file_type: z.enum(['income', 'balance', 'products', 'ads', 'stats']).describe('ชนิดไฟล์ที่ส่ง'),
      data: z.record(z.any()).describe('ข้อมูลตัวเลขของไฟล์นั้น — รูปร่างขึ้นกับ file_type (ดูคำอธิบาย tool)'),
    },
    async (args) => {
      const schema = SCHEMA_BY_TYPE[args.file_type as PlatformFileType]
      const parsedData = schema.safeParse(args.data)
      if (!parsedData.success) {
        return ok({
          success: false,
          message: `ข้อมูลไม่ตรงรูปแบบของไฟล์ ${args.file_type}: ${parsedData.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        })
      }

      try {
        const result = submitFile(tenantId, {
          platform: args.platform,
          shopKey: args.shop_key,
          month: args.month,
          fileType: args.file_type,
          data: parsedData.data as IncomePayload | BalancePayload | ProductsPayload | AdsPayload | StatsPayload,
        })
        return ok({
          success: true,
          ...result,
          message: `บันทึกไฟล์ ${args.file_type} ของรอบ ${args.month} แล้ว — สมการผ่านทั้งหมด ${result.checks.length} ข้อ`,
        })
      } catch (err: any) {
        const message = err instanceof PlatformMonthError ? err.message : (err?.message || String(err))
        return ok({ success: false, message })
      }
    }
  )

  // ── platform_month_status ───────────────────────────────────────────────────
  server.tool(
    'platform_month_status',
    `เช็คสถานะรอบเดือนของช่องทางขายแพลตฟอร์ม — ไฟล์ไหนส่งแล้ว (5 ไฟล์: income/balance/products/ads/stats)
ไฟล์ไหนยังไม่มา และผลตรวจสมการแต่ละข้อ (ชื่อ, ค่าที่คาด, ค่าจริง, ผ่าน/ไม่ผ่าน)
ใช้ก่อนส่งไฟล์เพื่อดูว่าขาดไฟล์ไหน หรือหลังส่งครบเพื่อสรุปว่าสมการตรงทุกข้อหรือยัง`,
    {
      platform: z.enum(['SHOPEE']).describe('แพลตฟอร์ม'),
      shop_key: z.string().min(1).describe('ชื่อ/รหัสร้านเดียวกับที่ใช้ตอนส่งไฟล์'),
      month: z.string().regex(/^\d{4}-\d{2}$/).describe('เดือนปฏิทินของรอบ รูปแบบ YYYY-MM'),
    },
    async (args) => {
      const status = getMonthStatus(tenantId, args.platform, args.shop_key, args.month)
      return ok(status)
    }
  )
}

export default registerPlatformMonthTools
