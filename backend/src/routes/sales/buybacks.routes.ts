import { Router, Request, Response, NextFunction } from 'express'
import {
  CustomerBuybackError,
  createCustomerBuyback,
  cancelCustomerBuyback,
  listCustomerBuybacks,
  getCustomerBuybackById,
} from '../../services/customerBuyback.service'
import { CustomerCreditError } from '../../services/customerCredit.service'

const router = Router()

const ALLOWED_ROLES = ['ADMIN', 'MANAGER', 'MASTER', 'OWNER']

function requireBuybackRole(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role || ''
  if (!ALLOWED_ROLES.includes(role)) {
    return res.status(403).json({
      success: false,
      message: 'ไม่มีสิทธิ์เข้าถึงเมนูรับซื้อคืนสินค้า — ต้องเป็น ADMIN, MANAGER, MASTER หรือ OWNER',
    })
  }
  next()
}

router.use(requireBuybackRole)

// GET /api/sales/buybacks?customerId=
router.get('/', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : undefined
    const data = listCustomerBuybacks(tenantId, { customerId })
    res.json({ success: true, data })
  } catch (err) {
    if (err instanceof CustomerBuybackError || err instanceof CustomerCreditError) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    console.error('List buybacks error:', err)
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงรายการรับซื้อคืนสินค้าได้' })
  }
})

// GET /api/sales/buybacks/:id
router.get('/:id', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const data = getCustomerBuybackById(tenantId, req.params.id)
    if (!data) {
      return res.status(404).json({ success: false, message: 'ไม่พบใบรับซื้อคืนสินค้า' })
    }
    res.json({ success: true, data })
  } catch (err) {
    if (err instanceof CustomerBuybackError || err instanceof CustomerCreditError) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    console.error('Get buyback error:', err)
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลใบรับซื้อคืนสินค้าได้' })
  }
})

// POST /api/sales/buybacks
router.post('/', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const data = createCustomerBuyback(tenantId, req.user, req.body || {})
    res.status(201).json({ success: true, data })
  } catch (err) {
    if (err instanceof CustomerBuybackError || err instanceof CustomerCreditError) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    console.error('Create buyback error:', err)
    res.status(500).json({ success: false, message: 'ไม่สามารถบันทึกใบรับซื้อคืนสินค้าได้' })
  }
})

// POST /api/sales/buybacks/:id/cancel
router.post('/:id/cancel', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { reason } = req.body || {}
    const data = cancelCustomerBuyback(tenantId, req.user, req.params.id, reason)
    res.json({ success: true, data })
  } catch (err) {
    if (err instanceof CustomerBuybackError || err instanceof CustomerCreditError) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    console.error('Cancel buyback error:', err)
    res.status(500).json({ success: false, message: 'ไม่สามารถยกเลิกใบรับซื้อคืนสินค้าได้' })
  }
})

export default router
