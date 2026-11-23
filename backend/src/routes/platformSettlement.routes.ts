import { Router, Request, Response } from 'express'
import { authenticate, requireRole } from '../middleware/auth.middleware'
import {
  getFeeMappings,
  updateFeeMappings,
  SettlementError,
} from '../services/platformSettlement.service'
import { PlatformMonthError } from '../services/platformMonth.service'
import { StockItemRefError } from '../services/stockItem.service'
import {
  getMonthsList,
  getMappingRows,
  confirmMapping,
  acceptAllProposals,
  deleteMapping,
  confirmSale,
  cancelSale,
} from '../services/platformMonthSale.service'
import { previewPosting, postMonth, unpostMonth } from '../services/platformMonthPosting.service'
import {
  getOnlineSummary,
  listOnlineOrders,
  getUnlinkedLines,
  confirmOnlineMapping,
  acceptAllOnlineProposals,
  listReturnEvents,
  restockReturnEvents,
  getUnattributedReturns,
  OnlineOrderError,
  type OnlineSummaryGroupBy,
} from '../services/onlineOrders.service'

const router = Router()
router.use(authenticate)

// รับ error ของเฟส 2 และออเดอร์ออนไลน์ให้แปลงเป็น 400 พร้อมข้อความไทย — error อื่นที่ไม่รู้จักค่อย 500
function handlePhase2Error(res: Response, err: any, fallbackMessage: string) {
  if (err instanceof PlatformMonthError || err instanceof StockItemRefError || err instanceof OnlineOrderError) {
    return res.status(400).json({ success: false, message: err.message })
  }
  console.error(fallbackMessage, err)
  res.status(500).json({ success: false, message: fallbackMessage })
}

// เฟส 3 โยน PlatformMonthError (เช็คภายใน) หรือ SettlementError (ยังไม่ผูกบัญชีค่าธรรมเนียม) ทั้งคู่ถือเป็น 400
function handlePostingError(res: Response, err: any, fallbackMessage: string) {
  if (err instanceof PlatformMonthError || err instanceof SettlementError) {
    return res.status(400).json({ success: false, message: err.message })
  }
  console.error(fallbackMessage, err)
  res.status(500).json({ success: false, message: fallbackMessage })
}

// ==================== ออเดอร์ออนไลน์รายออเดอร์ (ค่ามาสก์เท่านั้น) ====================

// GET /api/platform-settlement/online-orders/summary?from&to&groupBy&platform&shopKey
router.get('/online-orders/summary', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { from, to, groupBy, platform, shopKey } = req.query as Record<string, string | undefined>
    const rows = getOnlineSummary(tenantId, {
      from,
      to,
      platform,
      shopKey,
      groupBy: (groupBy || 'province') as OnlineSummaryGroupBy,
    })
    res.json({ success: true, data: rows })
  } catch (err) {
    handlePhase2Error(res, err, 'โหลดสรุปออเดอร์ออนไลน์ไม่สำเร็จ')
  }
})

// GET /api/platform-settlement/online-orders/list?from&to&status&q&page (ค่ามาสก์เท่านั้น)
router.get('/online-orders/list', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { from, to, platform, shopKey, status, q, page, limit } = req.query as Record<string, string | undefined>
    const data = listOnlineOrders(tenantId, {
      from,
      to,
      platform,
      shopKey,
      status,
      q,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    })
    res.json({ success: true, data })
  } catch (err) {
    handlePhase2Error(res, err, 'โหลดรายการออเดอร์ออนไลน์ไม่สำเร็จ')
  }
})

// GET /api/platform-settlement/online-orders/unlinked
router.get('/online-orders/unlinked', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { from, to, platform, shopKey } = req.query as Record<string, string | undefined>
    res.json({ success: true, data: getUnlinkedLines(tenantId, { from, to, platform, shopKey }) })
  } catch (err) {
    handlePhase2Error(res, err, 'โหลดรายการที่ยังไม่ผูกสินค้าไม่สำเร็จ')
  }
})

// POST /api/platform-settlement/online-orders/mapping/confirm  body: { sourceRef, stockItemId, factor }
router.post('/online-orders/mapping/confirm', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { sourceRef, stockItemId, factor } = req.body
    if (!sourceRef || !stockItemId) {
      return res.status(400).json({ success: false, message: 'ต้องระบุ sourceRef และ stockItemId' })
    }
    confirmOnlineMapping(tenantId, { sourceRef, stockItemId, factor: Number(factor) || 1 }, req.user!.email)
    res.json({ success: true, data: getUnlinkedLines(tenantId) })
  } catch (err) {
    handlePhase2Error(res, err, 'ยืนยันคู่จับคู่สินค้าไม่สำเร็จ')
  }
})

// POST /api/platform-settlement/online-orders/mapping/accept-all
router.post('/online-orders/mapping/accept-all', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const result = acceptAllOnlineProposals(tenantId, req.user!.email)
    res.json({ success: true, data: { ...result, rows: getUnlinkedLines(tenantId) } })
  } catch (err) {
    handlePhase2Error(res, err, 'ยืนยันข้อเสนอทั้งหมดไม่สำเร็จ')
  }
})

// GET /api/platform-settlement/online-orders/returns?status
router.get('/online-orders/returns', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.query as { status?: string }
    res.json({ success: true, data: listReturnEvents(tenantId, status) })
  } catch (err) {
    handlePhase2Error(res, err, 'โหลดรายการรับคืนข้ามเดือนไม่สำเร็จ')
  }
})

// POST /api/platform-settlement/online-orders/returns/restock  body: { ids: string[] }
router.post('/online-orders/returns/restock', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { ids } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'ต้องระบุรายการที่ต้องการรับคืนเข้าสต็อก (ids)' })
    }
    const result = restockReturnEvents(tenantId, ids, req.user!.email)
    res.json({ success: true, data: result })
  } catch (err) {
    handlePhase2Error(res, err, 'รับคืนเข้าสต็อกไม่สำเร็จ')
  }
})

// GET /api/platform-settlement/online-orders/unattributed-returns?platform&shopKey&month
router.get('/online-orders/unattributed-returns', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { platform, shopKey, month } = req.query as { platform?: string; shopKey?: string; month?: string }
    if (!platform || !shopKey || !month) {
      return res.status(400).json({ success: false, message: 'ต้องระบุ platform, shopKey และ month' })
    }
    res.json({ success: true, data: getUnattributedReturns(tenantId, platform, shopKey, month) })
  } catch (err) {
    handlePhase2Error(res, err, 'โหลดรายการคืนที่ไม่ระบุออเดอร์ไม่สำเร็จ')
  }
})

// ==================== เฟส 2: จับคู่ SKU + ยืนยันการขาย ====================

// GET /api/platform-settlement/months — รายการรอบเดือนทั้งหมด (filter ?platform=)
router.get('/months', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { platform } = req.query as { platform?: string }
    res.json({ success: true, data: getMonthsList(tenantId, platform) })
  } catch (err) {
    handlePhase2Error(res, err, 'โหลดรายการรอบเดือนไม่สำเร็จ')
  }
})

// GET /api/platform-settlement/months/:id/mapping — แถวที่ต้องจับคู่ SKU ของรอบนี้
router.get('/months/:id/mapping', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    res.json({ success: true, data: getMappingRows(tenantId, req.params.id) })
  } catch (err) {
    handlePhase2Error(res, err, 'โหลดรายการจับคู่ SKU ไม่สำเร็จ')
  }
})

// POST /api/platform-settlement/months/:id/mapping/confirm  body: { sourceRef, stockItemId, factor }
router.post('/months/:id/mapping/confirm', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { sourceRef, stockItemId, factor } = req.body
    if (!sourceRef || !stockItemId) {
      return res.status(400).json({ success: false, message: 'ต้องระบุ sourceRef และ stockItemId' })
    }
    confirmMapping(tenantId, { monthId: req.params.id, sourceRef, stockItemId, factor: Number(factor) || 1 }, req.user!.email)
    res.json({ success: true, data: getMappingRows(tenantId, req.params.id) })
  } catch (err) {
    handlePhase2Error(res, err, 'ยืนยันคู่จับคู่ SKU ไม่สำเร็จ')
  }
})

// POST /api/platform-settlement/months/:id/mapping/accept-all — ยืนยันข้อเสนอจาก MCP ทั้งหมดทีเดียว
router.post('/months/:id/mapping/accept-all', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const result = acceptAllProposals(tenantId, req.params.id, req.user!.email)
    res.json({ success: true, data: { ...result, rows: getMappingRows(tenantId, req.params.id) } })
  } catch (err) {
    handlePhase2Error(res, err, 'ยืนยันข้อเสนอทั้งหมดไม่สำเร็จ')
  }
})

// DELETE /api/platform-settlement/mapping/:sourceRef — ลบการจับคู่ (เผื่อผูกผิด)
router.delete('/mapping/:sourceRef', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    deleteMapping(req.user!.tenantId, req.params.sourceRef)
    res.json({ success: true })
  } catch (err) {
    handlePhase2Error(res, err, 'ลบการจับคู่ไม่สำเร็จ')
  }
})

// POST /api/platform-settlement/months/:id/confirm-sale — ยืนยันการขาย ตัดสต็อกจริง (ไม่ลงบัญชี — เฟส 3)
router.post('/months/:id/confirm-sale', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const result = confirmSale(req.user!.tenantId, req.params.id, req.user!.email)
    res.json({ success: true, data: result, message: `ยืนยันการขายแล้ว ตัดสต็อก ${result.breakdown.length} รายการ ต้นทุนรวม ${result.cogsAmount}` })
  } catch (err) {
    handlePhase2Error(res, err, 'ยืนยันการขายไม่สำเร็จ')
  }
})

// POST /api/platform-settlement/months/:id/cancel-sale — ยกเลิกการยืนยัน คืนสต็อกทั้งหมด
router.post('/months/:id/cancel-sale', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    cancelSale(req.user!.tenantId, req.params.id, req.user!.email)
    res.json({ success: true, message: 'ยกเลิกการยืนยันการขายแล้ว คืนสต็อกทั้งหมด' })
  } catch (err) {
    handlePhase2Error(res, err, 'ยกเลิกการยืนยันการขายไม่สำเร็จ')
  }
})

// ==================== เฟส 3: ลงบัญชีรอบเดือน (ขาย/ต้นทุน/ค่าธรรมเนียม/ปรับปรุง/ถอนเงิน ผ่าน 1181) ====================

// GET /api/platform-settlement/months/:id/posting-preview — ดู JV ที่จะลง ก่อนกดลงจริง
router.get('/months/:id/posting-preview', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    res.json({ success: true, data: previewPosting(tenantId, req.params.id) })
  } catch (err) {
    handlePostingError(res, err, 'โหลดตัวอย่างการลงบัญชีไม่สำเร็จ')
  }
})

// POST /api/platform-settlement/months/:id/post — ลงบัญชีจริง
router.post('/months/:id/post', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const result = postMonth(tenantId, req.params.id, req.user!.email)
    res.json({ success: true, data: result, message: `ลงบัญชีแล้ว ${result.journalIds.length} รายการ` })
  } catch (err) {
    handlePostingError(res, err, 'ลงบัญชีไม่สำเร็จ')
  }
})

// POST /api/platform-settlement/months/:id/unpost — ยกเลิกการลงบัญชี (กลับรายการทุกใบ)
router.post('/months/:id/unpost', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    unpostMonth(tenantId, req.params.id, req.user!.email)
    res.json({ success: true, message: 'ยกเลิกการลงบัญชีแล้ว' })
  } catch (err) {
    handlePostingError(res, err, 'ยกเลิกการลงบัญชีไม่สำเร็จ')
  }
})

// ==================== ผูกค่าธรรมเนียมแพลตฟอร์ม ====================

// GET /api/platform-settlement/fee-mappings
router.get('/fee-mappings', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    res.json({ success: true, data: getFeeMappings(tenantId) })
  } catch (err) {
    console.error('Get fee mappings error:', err)
    res.status(500).json({ success: false, message: 'โหลดการผูกค่าธรรมเนียมไม่สำเร็จ' })
  }
})

// PUT /api/platform-settlement/fee-mappings  body: { updates: [{ id, accountCode?, columnAliases? }] }
router.put('/fee-mappings', requireRole('ADMIN', 'MASTER', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { updates } = req.body
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ success: false, message: 'ไม่มีรายการที่จะแก้ไข' })
    }
    res.json({ success: true, data: updateFeeMappings(tenantId, updates) })
  } catch (err) {
    console.error('Update fee mappings error:', err)
    res.status(500).json({ success: false, message: 'บันทึกการผูกค่าธรรมเนียมไม่สำเร็จ' })
  }
})

export default router
