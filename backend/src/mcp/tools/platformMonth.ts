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
import { proposeSkuMapping, getMappingSummary } from '../../services/platformMonthSale.service'

// ── zod schema ต่อชนิดไฟล์ — ตรวจรูปร่าง data ให้ตรงก่อนส่งเข้า service (service ตรวจสมการเอง) ──────
// num(): กันเลข NaN/Infinity ที่ parser พลาดหลุดมา (.finite()) + กันเลขหลุดโลก (เกินหมื่นล้านบาท ไม่มีจริง
// ในรอบเดือนร้านเดียว) — เดิม z.number() เฉยๆ ปล่อยทั้ง Infinity และเลขมหาศาลผ่านได้หมด
const num = () => z.number().finite().min(-1e10).max(1e10)
// fraction(): สัดส่วน 0-1 (ไม่ใช่เปอร์เซ็นต์) ใช้กับ repeat_rate เท่านั้น
const fraction = () => z.number().finite().min(0).max(1)
// dateStr(): ต้องเป็น YYYY-MM-DD เป๊ะ — กันรูปแบบ dd/mm/yyyy หลุดเข้ามาเป็นวันที่ JV ตรงๆ (payout date ที่ผิด
// รูปแบบเคยหลุดผ่าน z.string() เฉยๆ มาก่อน)
const dateStr = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ต้องเป็นรูปแบบ YYYY-MM-DD')

const incomeSchema = z.object({
  period_start: dateStr(),
  period_end: dateStr(),
  order_count: num(),
  product_list_price: num(),
  seller_discount: num(),
  refund_to_buyer: num(),
  shopee_product_discount: num(),
  product_sales: num(),
  total_income: num(),
  shipping_buyer_paid: num(),
  shipping_shopee_subsidy: num(),
  shipping_charged: num(),
  shipping_return: num(),
  commission: num(),
  ams_commission: num(),
  service_fee: num(),
  infrastructure_fee: num(),
  transaction_fee: num(),
  ads_topup_from_escrow: num(),
  other_fees: num().default(0),
  total_expense: num(),
  total_transferred: num(),
  adjustments: z.object({
    total: num(),
    marketing: num(),
    shipping_claim: num(),
    refund_after_complete: num(),
    other: num(),
  }),
})

const balanceSchema = z.object({
  period_start: dateStr(),
  period_end: dateStr(),
  opening: num(),
  closing: num(),
  money_in: num(),
  money_out: num(),
  order_income_in: num(),
  order_income_out: num(),
  adjustments_in: num(),
  adjustments_out: num(),
  withdrawals: z.array(z.object({ date: dateStr(), amount: num() })),
  withdrawals_total: num(),
})

// level='variant' ต้องมี variant_id, ทุกแถว (parent/variant) ต้องมี product_id — เดิมปล่อยทั้งคู่
// nullable/optional หมด ทำให้ rows: [{level:'variant'}] (ไม่มีทั้ง product_id/variant_id) ผ่าน schema ได้
const productRowSchema = z.object({
  level: z.enum(['parent', 'variant']),
  product_id: z.string().nullable().optional(),
  variant_id: z.string().nullable().optional(),
  product_name: z.string().optional(),
  variant_name: z.string().optional(),
  sales_all: num().optional(),
  sales_confirmed: num().optional(),
  orders_all: num().optional(),
  orders_confirmed: num().optional(),
  qty_all: num().optional(),
  qty_confirmed: num().optional(),
  visitors: num().optional(),
  cart_visitors: num().optional(),
  buyers_confirmed: num().optional(),
  clicks: num().optional(),
  impressions: num().optional(),
  repeat_rate: fraction().optional().describe('อัตราการซื้อซ้ำ เป็นสัดส่วน 0-1 (เช่น 35% ให้ส่ง 0.35 ไม่ใช่ 35)'),
}).superRefine((row, ctx) => {
  if (!row.product_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ทุกแถว (parent และ variant) ต้องมี product_id', path: ['product_id'] })
  }
  if (row.level === 'variant' && !row.variant_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'แถว level="variant" ต้องมี variant_id', path: ['variant_id'] })
  }
})
const productsSchema = z.object({ rows: z.array(productRowSchema).min(1, 'ต้องมีอย่างน้อย 1 แถว') })

const adsCampaignSchema = z.object({
  name: z.string(),
  ad_type: z.string(),
  status: z.string(),
  product_id: z.string().nullable().optional(),
  impressions: num(),
  clicks: num(),
  orders: num(),
  direct_orders: num(),
  items_sold: num(),
  sales: num(),
  direct_sales: num(),
  cost: num(),
})
const adsSchema = z.object({
  period_start: dateStr(),
  period_end: dateStr(),
  campaigns: z.array(adsCampaignSchema),
  total_cost: num(),
})

const dayRowSchema = z.object({
  date: dateStr(),
  sales_all: num(),
  orders_all: num(),
  sales_confirmed: num(),
  orders_confirmed: num(),
  visitors: num(),
  clicks: num(),
  cancelled_orders: num(),
  cancelled_sales: num(),
  buyers: num(),
  new_buyers: num(),
  existing_buyers: num(),
  potential_buyers: num(),
})
const statsSchema = z.object({
  period_start: dateStr(),
  period_end: dateStr(),
  totals: z.object({
    sales_all: num(),
    sales_confirmed: num(),
    orders_all: num(),
    orders_confirmed: num(),
    visitors: num(),
    clicks: num(),
    cancelled_orders: num(),
    cancelled_sales: num(),
    buyers: num(),
    new_buyers: num(),
    existing_buyers: num(),
    potential_buyers: num(),
    repeat_rate: fraction().describe('อัตราการซื้อซ้ำ เป็นสัดส่วน 0-1 (เช่น 35% ให้ส่ง 0.35 ไม่ใช่ 35)'),
  }),
  daily: z.array(dayRowSchema),
  sources: z.object({
    product_page: num(),
    live: num(),
    video: num(),
    partner: num(),
    ads_attributed: num(),
  }),
})

const SCHEMA_BY_TYPE: Record<PlatformFileType, z.ZodTypeAny> = {
  income: incomeSchema,
  balance: balanceSchema,
  products: productsSchema,
  ads: adsSchema,
  stats: statsSchema,
}

export function registerPlatformMonthTools(server: IMcpServer, tenantId: string, userId = 'mcp-agent'): void {
  // ── platform_submit_file ──────────────────────────────────────────────────
  server.tool(
    'platform_submit_file',
    `ส่งไฟล์รายงานรอบเดือนของช่องทางขายแพลตฟอร์ม (ตอนนี้รองรับ Shopee — Lazada จะตามมาทีหลัง) เข้าสู่รอบเดือน
ต้องส่งแยกเป็น 5 ไฟล์ ไฟล์ไหนมาก่อนส่งก่อนได้ (file_type):
  1) income    — Seller Centre > การเงินของฉัน > รายรับ — อ่านยอดจาก "ชีตสรุป (Summary)" เท่านั้น ห้ามรวมเองจากแถวย่อย
  2) balance   — Seller Centre > การเงินของฉัน > ยอดคงเหลือ (เงินเข้า/ออก/ถอน)
  3) products  — Seller Centre > ข้อมูลเชิงลึกของธุรกิจ > สินค้า — ต้องมีทั้งแถวสรุปต่อสินค้า (level="parent")
     และแถวต่อตัวเลือก (level="variant") ถ้าสินค้าไม่มีตัวเลือกให้มีแค่แถว parent
     ไฟล์ parentskudetail ชีต "สินค้าขายดี" — แถวแรกต่อสินค้า = parent, แถวที่ "รหัสตัวเลือกสินค้า" ≠ '-' = variant
     แม็บคอลัมน์→ฟิลด์: รหัสสินค้า→product_id, รหัสตัวเลือกสินค้า→variant_id, ผลิตภัณฑ์→product_name,
     ชื่อตัวเลือกสินค้า→variant_name, "ยอดขาย (ที่มีการสั่งซื้อทั้งหมด) (THB)"→sales_all,
     "ยอดขาย (ยืนยันแล้ว) (THB)"→sales_confirmed, ทั้งหมด→orders_all, ยืนยันแล้ว→orders_confirmed
     (2 คอลัมน์จำนวนคำสั่งซื้อที่อยู่ถัดจาก "อัตราการซื้อสินค้า (ยืนยันแล้ว)"),
     "จำนวนที่ขายได้ (ที่มีการสั่งซื้อทั้งหมด)"→qty_all, "จำนวนที่ขายได้ (ยืนยันแล้ว)"→qty_confirmed,
     "ผู้ซื้อ (ยืนยันคำสั่งซื้อแล้ว)"→buyers_confirmed, ผู้เข้าชมสินค้า→visitors,
     "ผู้เข้าชมสินค้า (ที่เพิ่มสินค้าเข้าไปในรถเข็น)"→cart_visitors, จำนวนคลิก→clicks,
     ยอดการมองเห็นสินค้าที่ไม่ซ้ำ→impressions, "อัตราการซื้อซ้ำ (ยืนยันแล้ว)"→repeat_rate (แปลง % เป็นสัดส่วน
     0-1 เช่น 3.66% ส่งเป็น 0.0366) · '-' ในไฟล์ = 0/null · ตัด comma คั่นหลักพันก่อนแปลงเป็นเลข
  4) ads       — Seller Centre > การตลาด > โฆษณา (รายงานแคมเปญ)
  5) stats     — Seller Centre > ข้อมูลเชิงลึกของธุรกิจ > ร้านค้า (สถิติรายวัน)
     ไฟล์ shop-stats — totals: อ่านชีต "ทั้งหมด" สำหรับฟิลด์ลงท้าย _all, ชีต "ยืนยันแล้ว" สำหรับฟิลด์ลงท้าย
     _confirmed (ชื่อคอลัมน์เดียวกันปรากฏในทั้ง 2 ชีต) — "ยอดขายทั้งหมด (THB)"→sales_all/sales_confirmed,
     คำสั่งซื้อทั้งหมด→orders_all/orders_confirmed, จำนวนผู้เยี่ยมชม→visitors, จำนวนคลิก→clicks,
     คำสั่งซื้อที่ยกเลิก→cancelled_orders, ยอดขายที่ยกเลิก→cancelled_sales, "# ของผู้ซื้อ"→buyers,
     "# ของผู้ซื้อใหม่"→new_buyers, "# ของผู้ซื้อเดิม"→existing_buyers, "# ผู้ที่อาจจะซื้อ"→potential_buyers,
     อัตราการกลับมาซื้อซ้ำ→repeat_rate (แปลง % เป็นสัดส่วน 0-1 เช่น 8.43% ส่งเป็น 0.0843)
     หมายเหตุ: daily[] (รายวันต่อแถว) และ sources (product_page/live/video/partner/ads_attributed) ยังไม่มี
     แม็บคอลัมน์ต้นทางที่ยืนยันแล้ว — กรอกเท่าที่หาได้จากรายงาน ถ้าหาไม่ได้ให้ใส่ 0 ห้ามเดาตัวเลข

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
      // เฟส 2: แปะสรุปจับคู่ SKU ต่อถ้ารอบนี้มีแล้ว (ยังไม่มี monthId ตอน products ยังไม่มาก็ไม่มีอะไรให้สรุป)
      const mapping = status.monthId ? getMappingSummary(tenantId, status.monthId) : null
      return ok({ ...status, mapping })
    }
  )

  // ── platform_propose_sku_mapping ──────────────────────────────────────────
  server.tool(
    'platform_propose_sku_mapping',
    `เสนอคู่จับคู่ SKU ให้ตัวเลือก/สินค้าของรอบเดือนนี้ — เป็นแค่ "ข้อเสนอ" รอคนยืนยันที่หน้าเว็บเท่านั้น
ไม่ผูกจริง ไม่ตัดสต็อก ห้ามยืนยันเอง — แนะนำโดยเทียบชื่อตัวเลือก/สินค้ากับชื่อสินค้าในคลัง (ใกล้เคียงที่สุด)
ระบุ variant_id (มีตัวเลือก) หรือ product_id (ไม่มีตัวเลือก) อย่างใดอย่างหนึ่งต่อคู่ · sku หรือ stock_item_id อย่างใดอย่างหนึ่ง
factor = ตัวคูณแพ็ก เช่นตัวเลือก "หมอน 2 ใบ" ชี้ SKU "หมอน" (หน่วยฐาน ใบ) → factor = 2 (ไม่ระบุ = 1)`,
    {
      platform: z.enum(['SHOPEE']).describe('แพลตฟอร์ม'),
      shop_key: z.string().min(1).describe('ชื่อ/รหัสร้านเดียวกับที่ใช้ตอนส่งไฟล์'),
      month: z.string().regex(/^\d{4}-\d{2}$/).describe('เดือนปฏิทินของรอบ รูปแบบ YYYY-MM'),
      pairs: z.array(z.object({
        variant_id: z.string().nullable().optional(),
        product_id: z.string().nullable().optional(),
        sku: z.string().optional(),
        stock_item_id: z.string().optional(),
        factor: z.number().positive().default(1),
      })).min(1),
    },
    async (args) => {
      try {
        const result = proposeSkuMapping(tenantId, {
          platform: args.platform,
          shopKey: args.shop_key,
          month: args.month,
          pairs: args.pairs.map((p: any) => ({
            variantId: p.variant_id ?? null,
            productId: p.product_id ?? null,
            sku: p.sku,
            stockItemId: p.stock_item_id,
            factor: p.factor ?? 1,
          })),
        }, userId)
        return ok({
          success: true,
          ...result,
          message: `เสนอคู่แล้ว ${result.accepted} คู่ (รอคนยืนยันที่หน้าเว็บ)${result.rejected.length ? ` — ปฏิเสธ ${result.rejected.length} คู่` : ''}`,
        })
      } catch (err: any) {
        const message = err instanceof PlatformMonthError ? err.message : (err?.message || String(err))
        return ok({ success: false, message })
      }
    }
  )
}

export default registerPlatformMonthTools
