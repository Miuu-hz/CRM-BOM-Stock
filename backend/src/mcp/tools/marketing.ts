import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { IMcpServer } from '../sdk-compat'
import { ok } from './shared'
import { parseMarketingCSV } from '../../services/csvParser.service'
import * as marketingRepo from '../../repositories/marketing.repository'

const genFileName = () => `mcp-${Date.now()}-${randomUUID().replace(/-/g, '').substring(0, 8)}.csv`

// 5MB — CSV arrives as inline chat text here, not a multipart upload, so this is
// generous headroom under the 10MB limit the REST /marketing/upload route enforces.
const MAX_CSV_BYTES = 5 * 1024 * 1024

export function registerMarketingTools(server: IMcpServer, tenantId: string): void {
  // ── import_marketing_csv ────────────────────────────────────────────────────
  server.tool(
    'import_marketing_csv',
    `นำเข้าข้อมูลโฆษณา/ยอดขายจากแพลตฟอร์ม (Shopee ฯลฯ) โดยไม่ต้องอัปโหลดไฟล์ผ่านหน้าเว็บ
ใช้เมื่อผู้ใช้วางข้อมูล CSV (คัดลอกจากไฟล์รายงานโฆษณา) มาในแชท หรืออธิบายว่าอยากนำเข้าไฟล์ CSV ที่มีอยู่
วางเนื้อหาไฟล์ CSV ทั้งหมด (รวมบรรทัด header) ลงใน csv_content แล้วระบุแพลตฟอร์ม ร้านค้า และช่วงวันที่ของรายงาน
ใช้ parser เดียวกับหน้าอัปโหลดเว็บ (csvParser.service.ts) — รองรับ Shopee, ยังไม่รองรับ TikTok (TODO ในโค้ด)
ตัวอย่าง: "นี่คือรายงานโฆษณา Shopee ร้านหลักตั้งแต่ 1-4 ส.ค." + วางข้อมูล CSV
→ import_marketing_csv(csv_content="...", platform="SHOPEE", shop_hint="ร้านหลัก", start_date="2026-08-01", end_date="2026-08-04")`,
    {
      csv_content: z.string().min(1).describe('เนื้อหาไฟล์ CSV ทั้งหมด (ดิบ) รวมบรรทัด header'),
      platform: z.enum(['SHOPEE', 'TIKTOK', 'LAZADA', 'FACEBOOK']).describe('แพลตฟอร์มของข้อมูล'),
      // ponytail: min(2) instead of min(1) — a 1-char hint fuzzy-matches too broadly against
      // marketingRepo.getAllShops(), which (like the rest of this module) isn't tenant-scoped.
      // Real fix is scoping shops/marketing_files/marketing_metrics by tenant_id — out of scope here.
      shop_hint: z.string().min(2).describe('ชื่อร้านค้า (อย่างน้อย 2 ตัวอักษร) — ถ้าไม่พบร้านที่ชื่อใกล้เคียงจะสร้างร้านใหม่ให้อัตโนมัติ'),
      start_date: z.string().describe('วันที่เริ่มต้นของรายงาน (YYYY-MM-DD)'),
      end_date: z.string().describe('วันที่สิ้นสุดของรายงาน (YYYY-MM-DD)'),
    },
    async (args) => {
      const { csv_content, platform, shop_hint, start_date, end_date } = args

      if (Buffer.byteLength(csv_content, 'utf-8') > MAX_CSV_BYTES) {
        return ok({ success: false, message: `ข้อมูล CSV ใหญ่เกินไป (จำกัด ${MAX_CSV_BYTES / 1024 / 1024}MB)` })
      }
      if (platform === 'TIKTOK') {
        return ok({ success: false, message: 'ยังไม่รองรับการนำเข้าไฟล์ TikTok (csvParser.service.ts ยังไม่ implement parser นี้)' })
      }

      // หาร้านค้าจากชื่อใกล้เคียง หรือสร้างใหม่ — เลียนแบบ pattern customer_hint ใน create_sales_order
      // (module นี้ไม่มี tenant scoping ใน repository เดิมอยู่แล้ว — คงพฤติกรรมเดิมไว้ ไม่ขยายขอบเขตแก้ตรงนี้)
      const shops = marketingRepo.getAllShops(platform) as any[]
      let shop = shops.find(s => s.name.includes(shop_hint) || shop_hint.includes(s.name))
      let shopCreated = false
      if (!shop) {
        shop = marketingRepo.createShop({ name: shop_hint, platform, shopId: `AUTO-${Date.now()}` })
        shopCreated = true
      }

      // เขียน csv_content ลงไฟล์ชั่วคราว เพื่อ reuse parser เดิม (csvParser.service.ts) โดยไม่ต้อง duplicate logic
      const uploadDir = path.join(__dirname, '../../../uploads/marketing')
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })
      const fileName = genFileName()
      const filePath = path.join(uploadDir, fileName)
      fs.writeFileSync(filePath, csv_content, 'utf-8')

      let parsed
      try {
        parsed = await parseMarketingCSV(filePath, platform, start_date, end_date)
      } catch (err: any) {
        try { fs.unlinkSync(filePath) } catch { /* ignore */ }
        return ok({ success: false, message: `แปลง CSV ไม่สำเร็จ: ${err?.message || err}` })
      }

      if (parsed.rowCount === 0) {
        try { fs.unlinkSync(filePath) } catch { /* ignore */ }
        return ok({ success: false, message: 'ไม่พบข้อมูลในไฟล์ CSV — ตรวจสอบว่า header ตรงกับรูปแบบที่รองรับ (Shopee)' })
      }

      const fileRecord: any = marketingRepo.createFile({
        shopId: shop.id,
        fileName,
        filePath,
        platform,
        userName: parsed.metadata.userName,
        reportStart: parsed.metadata.reportStart || start_date,
        reportEnd: parsed.metadata.reportEnd || end_date,
        rowCount: parsed.rowCount,
      })

      const nextDay = new Date(end_date)
      nextDay.setDate(nextDay.getDate() + 1)
      const lastOrderNumber = marketingRepo.getLastOrderNumber(shop.id, start_date, nextDay.toISOString().split('T')[0])

      const metricsToInsert = parsed.metrics.map((m, i) => ({
        fileId: fileRecord.id,
        shopId: shop.id,
        date: new Date(m.date).toISOString(),
        orderNumber: lastOrderNumber + i + 1,
        campaignName: m.campaignName,
        productName: m.productName,
        sku: m.sku,
        adStatus: m.adStatus,
        impressions: m.impressions,
        clicks: m.clicks,
        ctr: m.ctr,
        orders: m.orders,
        directOrders: m.directOrders,
        orderRate: m.orderRate,
        directOrderRate: m.directOrderRate,
        costPerOrder: m.costPerOrder,
        directCostPerOrder: m.directCostPerOrder,
        itemsSold: m.itemsSold,
        directItemsSold: m.directItemsSold,
        sales: m.sales,
        directSales: m.directSales,
        adCost: m.adCost,
        roas: m.roas,
        directRoas: m.directRoas,
        acos: m.acos,
        directAcos: m.directAcos,
        conversionRate: m.conversionRate,
        extraData: JSON.stringify(m.extraData),
      }))

      marketingRepo.bulkCreateMetrics(metricsToInsert)

      const totalAdCost = parsed.metrics.reduce((s, m) => s + (m.adCost || 0), 0)
      const totalSales = parsed.metrics.reduce((s, m) => s + (m.sales || 0), 0)

      return ok({
        success: true,
        shop: { id: shop.id, name: shop.name, isNew: shopCreated },
        fileId: fileRecord.id,
        rowCount: parsed.rowCount,
        dateRange: { start: parsed.metadata.reportStart || start_date, end: parsed.metadata.reportEnd || end_date },
        totalAdCost,
        totalSales,
        message: [
          `นำเข้าข้อมูล ${platform} ของร้าน "${shop.name}" สำเร็จ ${parsed.rowCount} แถว (${start_date} ถึง ${end_date})`,
          shopCreated ? `— สร้างร้านค้าใหม่ "${shop.name}"` : '',
        ].filter(Boolean).join(' '),
      })
    }
  )

  // ── list_marketing_shops ────────────────────────────────────────────────────
  server.tool(
    'list_marketing_shops',
    `ดูรายชื่อร้านค้าที่เคยลงทะเบียนไว้สำหรับนำเข้าข้อมูลโฆษณา/ยอดขาย
ใช้ก่อนเรียก import_marketing_csv เพื่อเช็คว่ามีร้านค้านี้อยู่แล้วหรือชื่อสะกดต่างจากที่คิดไว้หรือไม่`,
    {
      platform: z.enum(['SHOPEE', 'TIKTOK', 'LAZADA', 'FACEBOOK']).optional().describe('กรองตามแพลตฟอร์ม'),
    },
    async (args) => {
      const shops = marketingRepo.getAllShops(args.platform) as any[]
      return ok({ count: shops.length, shops: shops.map(s => ({ id: s.id, name: s.name, platform: s.platform })) })
    }
  )
}

export default registerMarketingTools
