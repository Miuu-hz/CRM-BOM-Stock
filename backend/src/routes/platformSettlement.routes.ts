import { Router, Request, Response } from 'express'
import multer from 'multer'
import { authenticate } from '../middleware/auth.middleware'
import {
  getFeeMappings,
  updateFeeMappings,
  previewSettlementCsv,
  postPlatformSettlement,
  listSettlements,
  SettlementError,
  recordSettlementPayout,
} from '../services/platformSettlement.service'

const router = Router()
router.use(authenticate)

// เก็บไฟล์ไว้ในหน่วยความจำพอ — แค่อ่านโครงสร้างมาคำนวณ preview ไม่ต้องเก็บไฟล์ถาวรเหมือน marketing เดิม
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

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

// POST /api/platform-settlement/preview  multipart: file, platform
// อ่านไฟล์เท่านั้น ไม่ลงบัญชี — ให้คนดูก่อนว่าคอลัมน์ไหนแม็ปตรงและคอลัมน์ไหนยังไม่รู้จัก
router.post('/preview', upload.single('file'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const platform = (req.body?.platform || '').toUpperCase()
    const file = (req as any).file as { buffer: Buffer } | undefined
    if (!platform) return res.status(400).json({ success: false, message: 'ต้องระบุแพลตฟอร์ม' })
    if (!file) return res.status(400).json({ success: false, message: 'ไม่มีไฟล์แนบมา' })

    const csvText = file.buffer.toString('utf-8')
    const result = previewSettlementCsv(tenantId, platform, csvText)
    res.json({ success: true, data: result })
  } catch (err) {
    console.error('Preview settlement error:', err)
    res.status(500).json({ success: false, message: err instanceof Error ? err.message : 'อ่านไฟล์ไม่สำเร็จ' })
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
