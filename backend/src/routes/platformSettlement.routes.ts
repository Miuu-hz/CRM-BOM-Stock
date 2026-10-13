import { Router, Request, Response } from 'express'
import { authenticate, requireRole } from '../middleware/auth.middleware'
import {
  getFeeMappings,
  updateFeeMappings,
  postPlatformSettlement,
  listSettlements,
  SettlementError,
  recordSettlementPayout,
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

const router = Router()
router.use(authenticate)

// รับ error ของเฟส 2 ให้แปลงเป็น 400 พร้อมข้อความไทย — error อื่นที่ไม่รู้จักค่อย 500
function handlePhase2Error(res: Response, err: any, fallbackMessage: string) {
  if (err instanceof PlatformMonthError || err instanceof StockItemRefError) {
    return res.status(400).json({ success: false, message: err.message })
  }
  console.error(fallbackMessage, err)
  res.status(500).json({ success: false, message: fallbackMessage })
}

// ==================== เฟส 2: จับคู่ SKU + ยืนยันการขาย ====================

// GET /api/platform-settlement/months — รายการรอบเดือนทั้งหมด (filter ?platform=)
router.get('/months', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { platform } = req.query as { platform?: string }
    res.json({ success: true, data: getMonthsList(tenantId, platform) })
  } catch (err) {
    handlePhase2Error(res, err, 'โหลดรายการรอบเดือนไม่สำเร็จ')
  }
})

// GET /api/platform-settlement/months/:id/mapping — แถวที่ต้องจับคู่ SKU ของรอบนี้
router.get('/months/:id/mapping', (req: Request, res: Response) => {
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

// ==================== เฟส 1 (เดิม): ผูกค่าธรรมเนียม + ลงบัญชีรอบโอน ====================

// GET /api/platform-settlement/fee-mappings
router.get('/fee-mappings', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    res.json({ success: true, data: getFeeMappings(tenantId) })
  } catch (err) {
    console.error('Get fee mappings error:', err)
    res.status(500).json({ success: false, message: 'โหลดการผูกค่าธรรมเนียมไม่สำเร็จ' })
  }
})

// PUT /api/platform-settlement/fee-mappings  body: { updates: [{ id, accountCode?, columnAliases? }] }
router.put('/fee-mappings', (req: Request, res: Response) => {
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

// GET /api/platform-settlement  — ประวัติรอบ settlement ที่เคยยืนยันแล้ว
router.get('/', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { platform } = req.query as { platform?: string }
    res.json({ success: true, data: listSettlements(tenantId, platform) })
  } catch (err) {
    console.error('List settlements error:', err)
    res.status(500).json({ success: false, message: 'โหลดประวัติรอบ settlement ไม่สำเร็จ' })
  }
})

// POST /api/platform-settlement/confirm  body: SettlementBatch — ลงบัญชีจริง
router.post('/confirm', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { platform, periodStart, periodEnd, grossSales, vatAmount, cogsAmount, fees, payoutAmount, sourceFilename } = req.body

    if (!platform || !periodStart || !periodEnd || !(grossSales > 0)) {
      return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบ: platform, periodStart, periodEnd, grossSales ต้องมี' })
    }

    const result = postPlatformSettlement({
      tenantId,
      platform: String(platform).toUpperCase(),
      periodStart,
      periodEnd,
      grossSales: Number(grossSales),
      vatAmount: vatAmount != null ? Number(vatAmount) : undefined,
      cogsAmount: cogsAmount != null ? Number(cogsAmount) : undefined,
      fees: Array.isArray(fees) ? fees.map((f: any) => ({ feeType: String(f.feeType), amount: Number(f.amount) || 0 })) : [],
      payoutAmount: payoutAmount != null ? Number(payoutAmount) : undefined,
      createdBy: req.user!.email,
      sourceFilename,
    })

    res.json({ success: true, data: result })
  } catch (err) {
    if (err instanceof SettlementError) {
      return res.status(400).json({ success: false, message: err.message })
    }
    console.error('Confirm settlement error:', err)
    res.status(500).json({ success: false, message: 'ลงบัญชีไม่สำเร็จ' })
  }
})

// บันทึกเงินโอนของรอบที่ลงยอดขายไว้ก่อนแล้ว (ขั้น 3 ที่มาทีหลัง)
router.post('/:id/payout', (req: Request, res: Response) => {
  try {
    const result = recordSettlementPayout({
      tenantId: req.user!.tenantId,
      batchId: req.params.id,
      payoutAmount: Number(req.body?.payoutAmount),
      createdBy: req.user!.email,
    })
    res.json({ success: true, data: result })
  } catch (error: any) {
    const known = error instanceof SettlementError
    if (!known) console.error('Record settlement payout error:', error)
    res.status(known ? 400 : 500).json({ success: false, message: known ? error.message : 'บันทึกเงินโอนไม่สำเร็จ' })
  }
})

export default router
