import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import { getSubscription } from '../services/subscription.service'

const router = Router()

// GET /api/subscription/me — ข้อมูลแพ็กเกจ + effective features + limits ของ tenant ปัจจุบัน
router.get('/me', authenticate, (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId
  const sub = getSubscription(tenantId)
  res.json({
    success: true,
    data: {
      tenantId: sub.tenantId,
      planCode: sub.planCode,
      planName: sub.planName,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      features: sub.features,
      packs: sub.packs,
      addons: sub.addons,
      limits: {
        maxUsers: sub.maxUsers,
        maxProducts: sub.maxProducts,
        maxPosShifts: sub.maxPosShifts,
      },
    },
  })
})

export default router