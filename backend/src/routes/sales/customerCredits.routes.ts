import { Router, Request, Response, NextFunction } from 'express'
import {
  CustomerCreditError,
  applyOffset,
  refundCredit,
  cancelOffset,
  getOffsetById,
  getCustomerCreditsOverview,
} from '../../services/customerCredit.service'

const router = Router()

const ALLOWED_ROLES = ['ADMIN', 'MANAGER', 'MASTER', 'OWNER']

function requireCreditRole(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role || ''
  if (!ALLOWED_ROLES.includes(role)) {
    return res.status(403).json({
      success: false,
      message: 'ไม่มีสิทธิ์เข้าถึงเมนูเครดิตลูกค้า/หักกลบหนี้ — ต้องเป็น ADMIN, MANAGER, MASTER หรือ OWNER',
    })
  }
  next()
}

router.use(requireCreditRole)

// GET /api/sales/customer-credits?customerId=&all=1
router.get('/', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : undefined
    const all = req.query.all === '1' || req.query.all === 'true'
    const data = getCustomerCreditsOverview(tenantId, { customerId, all })
    res.json({ success: true, data })
  } catch (err) {
    if (err instanceof CustomerCreditError) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    console.error('Get customer credits error:', err)
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลเครดิตลูกค้าได้' })
  }
})

// GET /api/sales/customer-credits/offsets/:id
router.get('/offsets/:id', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const offset = getOffsetById(tenantId, req.params.id)
    if (!offset) {
      return res.status(404).json({ success: false, message: 'ไม่พบใบหักกลบหนี้' })
    }
    res.json({ success: true, data: offset })
  } catch (err) {
    if (err instanceof CustomerCreditError) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    console.error('Get offset error:', err)
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลใบหักกลบหนี้ได้' })
  }
})

// POST /api/sales/customer-credits/offsets
router.post('/offsets', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { creditId, date, lines, notes } = req.body || {}
    const data = applyOffset(tenantId, req.user, { creditId, date, lines, notes })
    res.status(201).json({ success: true, data })
  } catch (err) {
    if (err instanceof CustomerCreditError) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    console.error('Apply offset error:', err)
    res.status(500).json({ success: false, message: 'ไม่สามารถบันทึกการหักกลบหนี้ได้' })
  }
})

// POST /api/sales/customer-credits/refunds
router.post('/refunds', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { creditId, date, amount, paymentMethod, bankAccountId, notes } = req.body || {}
    const data = refundCredit(tenantId, req.user, { creditId, date, amount, paymentMethod, bankAccountId, notes })
    res.status(201).json({ success: true, data })
  } catch (err) {
    if (err instanceof CustomerCreditError) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    console.error('Refund credit error:', err)
    res.status(500).json({ success: false, message: 'ไม่สามารถบันทึกการจ่ายคืนเครดิตได้' })
  }
})

// POST /api/sales/customer-credits/offsets/:id/cancel
router.post('/offsets/:id/cancel', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { reason } = req.body || {}
    const data = cancelOffset(tenantId, req.user, req.params.id, reason)
    res.json({ success: true, data })
  } catch (err) {
    if (err instanceof CustomerCreditError) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    console.error('Cancel offset error:', err)
    res.status(500).json({ success: false, message: 'ไม่สามารถยกเลิกใบหักกลบหนี้ได้' })
  }
})

export default router
