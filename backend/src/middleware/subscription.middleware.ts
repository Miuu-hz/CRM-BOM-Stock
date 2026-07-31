import { Request, Response, NextFunction } from 'express'
import { getSubscription } from '../services/subscription.service'

// ใช้คู่กับ authenticate ใน index.ts:
//   app.use('/api/stock', authenticate, subscriptionGate('stock'), stockRoutes)
// ไม่ระบุ feature = เช็คเฉพาะสถานะหมดอายุ (expiry gate เท่านั้น)
export const subscriptionGate = (feature?: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' })
      return
    }

    // MASTER ผ่านทุกอย่าง
    if (req.user.role === 'MASTER') {
      next()
      return
    }

    const sub = getSubscription(req.user.tenantId)

    // หมดอายุ/ยกเลิก → ADMIN ของบริษัทเข้าได้ (ไว้ต่ออายุ) + แจ้ง header, role อื่นโดน 402
    if (sub.status === 'EXPIRED' || sub.status === 'CANCELLED') {
      if (req.user.role === 'ADMIN') {
        res.setHeader('X-Subscription-Expired', '1')
      } else {
        res.status(402).json({
          success: false,
          code: 'SUBSCRIPTION_EXPIRED',
          message: 'แพ็กเกจหมดอายุ กรุณาติดต่อผู้ดูแลบริษัทเพื่อต่ออายุ',
        })
        return
      }
    }

    if (feature && sub.status !== 'NONE' && !sub.features.includes(feature)) {
      res.status(403).json({
        success: false,
        code: 'FEATURE_LOCKED',
        feature,
        plan: sub.planCode,
        message: `ฟีเจอร์นี้ไม่รวมในแพ็กเกจ ${sub.planName} กรุณาอัปเกรดแพ็กเกจ`,
      })
      return
    }

    next()
  }
}
