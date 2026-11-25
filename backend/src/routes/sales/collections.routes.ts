import { Router, Request, Response } from 'express'
import { requireRole } from '../../middleware/auth.middleware'
import { getCollections } from '../../services/collections.service'

const router = Router()

const COLLECTION_ROLES = requireRole('ADMIN', 'MANAGER', 'POWERUSER', 'MASTER', 'OWNER')

// GET /api/sales/collections?customerId= — รายการบิลที่ต้องติดตามเรียงตามวันติดตาม
router.get('/', COLLECTION_ROLES, (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const customerId = typeof req.query.customerId === 'string' && req.query.customerId.trim()
      ? req.query.customerId.trim()
      : undefined
    const data = getCollections(tenantId, { customerId })
    res.json({ success: true, data })
  } catch (error) {
    console.error('Get collections error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch collections' })
  }
})

export default router
