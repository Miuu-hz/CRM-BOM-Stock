import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import { getPlatformDashboard, getDashboardShops } from '../services/platformDashboard.service'
import { PlatformMonthError } from '../services/platformMonth.service'

const router = Router()

// All routes require authentication
router.use(authenticate)

// ponytail: /shops, /metrics, /analytics/summary (ยุค CSV อัปโหลดเอง) ลบทิ้ง 2026-10-13 —
// marketing_metrics มี 0 แถวมาตลอด, ไม่มีผู้เรียกอื่นนอกจาก Marketing.tsx เดิมที่เขียนทับไปแล้ว
// (marketingRepo.getAllShops ยังใช้อยู่ตรงๆ จาก MCP tool list_marketing_shops — ไม่ผ่าน route นี้)

/**
 * GET /api/marketing/platform-dashboard/shops
 * รายชื่อ platform+shop_key+เดือนที่มีข้อมูลแล้ว — ใช้เติม selector หน้าแดชบอร์ด
 */
router.get('/platform-dashboard/shops', (req: Request, res: Response) => {
  try {
    const shops = getDashboardShops(req.user!.tenantId)
    res.json({ success: true, data: shops })
  } catch (error: any) {
    console.error('Get platform dashboard shops error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch shops' })
  }
})

/**
 * GET /api/marketing/platform-dashboard?platform=SHOPEE&shop_key=...&end_month=YYYY-MM&range=1|3|6|12
 * แดชบอร์ดกำไรรายสินค้า + KPI 4 หมวด ของรอบ range เดือนปฏิทิน (รวม) สิ้นสุดที่ end_month
 */
router.get('/platform-dashboard', (req: Request, res: Response) => {
  try {
    const platform = String(req.query.platform || '').toUpperCase()
    const shopKey = String(req.query.shop_key || '')
    const endMonth = String(req.query.end_month || '')
    const range = Number(req.query.range) as 1 | 3 | 6 | 12

    if (!platform || !shopKey) return res.status(400).json({ success: false, message: 'ต้องระบุ platform และ shop_key' })
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(endMonth)) return res.status(400).json({ success: false, message: 'end_month ต้องเป็นรูปแบบ YYYY-MM (เดือน 01-12)' })
    if (![1, 3, 6, 12].includes(range)) return res.status(400).json({ success: false, message: 'range ต้องเป็น 1, 3, 6 หรือ 12' })

    const data = getPlatformDashboard(req.user!.tenantId, { platform, shopKey, endMonth, range })
    res.json({ success: true, data })
  } catch (error: any) {
    console.error('Get platform dashboard error:', error)
    if (error instanceof PlatformMonthError) return res.status(400).json({ success: false, message: error.message })
    res.status(500).json({ success: false, message: 'Failed to fetch platform dashboard' })
  }
})

export default router
