import { z } from 'zod'
import { IMcpServer } from '../sdk-compat'
import { ok } from './shared'
import * as marketingRepo from '../../repositories/marketing.repository'

// ponytail: import_marketing_csv ถูกลบ 2026-10-13 — แทนที่ด้วย platform_submit_file
// (backend/src/mcp/tools/platformMonth.ts) ซึ่งรับตัวเลขสรุปเป็นรอบเดือนแทนไฟล์ CSV ทั้งก้อน
export function registerMarketingTools(server: IMcpServer, tenantId: string): void {
  // ── list_marketing_shops ────────────────────────────────────────────────────
  server.tool(
    'list_marketing_shops',
    `ดูรายชื่อร้านค้าที่เคยลงทะเบียนไว้สำหรับดูข้อมูลโฆษณา/ยอดขายเก่า (ก่อนย้ายไป platform_submit_file)`,
    {
      platform: z.enum(['SHOPEE', 'TIKTOK', 'LAZADA', 'FACEBOOK']).optional().describe('กรองตามแพลตฟอร์ม'),
    },
    async (args) => {
      const shops = marketingRepo.getAllShops(tenantId, args.platform) as any[]
      return ok({ count: shops.length, shops: shops.map(s => ({ id: s.id, name: s.name, platform: s.platform })) })
    }
  )
}

export default registerMarketingTools
