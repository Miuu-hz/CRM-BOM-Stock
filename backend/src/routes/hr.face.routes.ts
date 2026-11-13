import { Router, Request, Response } from 'express'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { authenticate, requirePermission } from '../middleware/auth.middleware'
import { encryptDescriptor } from '../services/hr/face'

const router = Router()
router.use(authenticate)

function getSelfEmployee(tenantId: string, userId: string) {
  return db
    .prepare(
      `SELECT e.*, s.name AS shift_name
       FROM employees e
       LEFT JOIN shifts s ON e.shift_id = s.id AND s.tenant_id = e.tenant_id
       WHERE e.tenant_id = ? AND e.user_id = ? AND e.status = 'ACTIVE'`
    )
    .get(tenantId, userId) as any
}

// GET /api/hr/me/face
router.get('/me/face', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = (req.user as any)?.id || req.user!.userId
    const emp = getSelfEmployee(tenantId, userId)
    if (!emp) {
      return res.status(404).json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    const row = db
      .prepare('SELECT consent_at FROM hr_face_enrollments WHERE tenant_id = ? AND employee_id = ?')
      .get(tenantId, emp.id) as { consent_at: string } | undefined

    return res.json({
      success: true,
      data: {
        enrolled: Boolean(row),
        consent_at: row?.consent_at ?? null,
      },
    })
  } catch (error: any) {
    console.error('Get my face enrollment error:', error)
    return res.status(500).json({ success: false, message: error.message })
  }
})

// POST /api/hr/me/face
router.post('/me/face', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = (req.user as any)?.id || req.user!.userId
    const { descriptor, consent, consent_version } = req.body || {}

    if (consent !== true) {
      return res.status(400).json({ success: false, message: 'ต้องยินยอมการเก็บข้อมูลชีวมิติ (PDPA)' })
    }

    if (
      !Array.isArray(descriptor) ||
      descriptor.length < 128 ||
      descriptor.length > 2048 ||
      !descriptor.every((n: any) => typeof n === 'number' && Number.isFinite(n))
    ) {
      return res.status(400).json({
        success: false,
        message: 'ข้อมูลใบหน้าต้องเป็นตัวเลขความยาว 128 ถึง 2048',
      })
    }

    const emp = getSelfEmployee(tenantId, userId)
    if (!emp) {
      return res.status(404).json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    const descriptorEnc = encryptDescriptor(descriptor)
    const now = new Date().toISOString()
    const consentVer =
      typeof consent_version === 'string' && consent_version.trim() ? consent_version.trim() : '1.0'

    db.prepare(
      `INSERT INTO hr_face_enrollments (
         id, tenant_id, employee_id, descriptor_enc, consent_at, consent_version, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, employee_id) DO UPDATE SET
         descriptor_enc = excluded.descriptor_enc,
         consent_at = excluded.consent_at,
         consent_version = excluded.consent_version`
    ).run(generateId(), tenantId, emp.id, descriptorEnc, now, consentVer, now)

    return res.json({
      success: true,
      data: {
        enrolled: true,
        consent_at: now,
      },
    })
  } catch (error: any) {
    console.error('Enroll face error:', error)
    return res.status(500).json({ success: false, message: error.message })
  }
})

// DELETE /api/hr/me/face
router.delete('/me/face', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = (req.user as any)?.id || req.user!.userId
    const emp = getSelfEmployee(tenantId, userId)
    if (!emp) {
      return res.status(404).json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    db.prepare('DELETE FROM hr_face_enrollments WHERE tenant_id = ? AND employee_id = ?').run(
      tenantId,
      emp.id
    )

    return res.json({ success: true, data: null })
  } catch (error: any) {
    console.error('Delete my face enrollment error:', error)
    return res.status(500).json({ success: false, message: error.message })
  }
})

// GET /api/hr/employees/:id/face (hr read)
router.get('/employees/:id/face', requirePermission('hr', 'read'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const employeeId = req.params.id

    const emp = db
      .prepare('SELECT id FROM employees WHERE id = ? AND tenant_id = ?')
      .get(employeeId, tenantId)
    if (!emp) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' })
    }

    const row = db
      .prepare('SELECT consent_at FROM hr_face_enrollments WHERE tenant_id = ? AND employee_id = ?')
      .get(tenantId, employeeId) as { consent_at: string } | undefined

    return res.json({
      success: true,
      data: {
        enrolled: Boolean(row),
        consent_at: row?.consent_at ?? null,
      },
    })
  } catch (error: any) {
    console.error('Get employee face error:', error)
    return res.status(500).json({ success: false, message: error.message })
  }
})

// DELETE /api/hr/employees/:id/face (hr write)
router.delete(
  '/employees/:id/face',
  requirePermission('hr', 'write'),
  (req: Request, res: Response) => {
    try {
      const tenantId = req.user!.tenantId
      const employeeId = req.params.id

      const emp = db
        .prepare('SELECT id FROM employees WHERE id = ? AND tenant_id = ?')
        .get(employeeId, tenantId)
      if (!emp) {
        return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' })
      }

      db.prepare('DELETE FROM hr_face_enrollments WHERE tenant_id = ? AND employee_id = ?').run(
        tenantId,
        employeeId
      )

      return res.json({ success: true, data: null })
    } catch (error: any) {
      console.error('Delete employee face error:', error)
      return res.status(500).json({ success: false, message: error.message })
    }
  }
)

export default router
