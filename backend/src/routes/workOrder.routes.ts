import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { normalizeUnit } from '../services/unitConversion.service'
import { createWorkOrder, transitionWorkOrder, WorkOrderTransitionError } from '../services/workOrderTransition.service'

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

// GET all work orders
router.get('/', async (req: Request, res: Response) => {
  try {
    const isMaster = req.user?.role === 'MASTER'
    const queryTenant = req.query.tenantId ? String(req.query.tenantId) : undefined
    const tenantId = (isMaster && queryTenant && queryTenant !== 'all') ? queryTenant : req.user!.tenantId
    const filterAll = isMaster && queryTenant === 'all'

    const orders = filterAll
      ? db.prepare(`
          SELECT wo.*, so.so_number,
            (SELECT COUNT(*) FROM work_order_materials WHERE work_order_id = wo.id) as material_count
          FROM work_orders wo
          LEFT JOIN sales_orders so ON wo.sales_order_id = so.id
          ORDER BY
            CASE wo.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 WHEN 'LOW' THEN 4 END,
            wo.created_at DESC
        `).all()
      : db.prepare(`
          SELECT wo.*, so.so_number,
            (SELECT COUNT(*) FROM work_order_materials WHERE work_order_id = wo.id) as material_count
          FROM work_orders wo
          LEFT JOIN sales_orders so ON wo.sales_order_id = so.id
          WHERE wo.tenant_id = ?
          ORDER BY
            CASE wo.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 WHEN 'LOW' THEN 4 END,
            wo.created_at DESC
        `).all(tenantId)

    res.json({ success: true, data: orders })
  } catch (error) {
    console.error('Get work orders error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch work orders' })
  }
})

// GET work order stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const isMaster = req.user?.role === 'MASTER'
    const queryTenant = req.query.tenantId ? String(req.query.tenantId) : undefined
    const tenantId = (isMaster && queryTenant && queryTenant !== 'all') ? queryTenant : req.user!.tenantId
    const filterAll = isMaster && queryTenant === 'all'

    // ปรับคำสั่ง SQL ให้นับสถานะใบสั่งผลิตให้ครบทุกตัว (DRAFT, PLANNED, IN_PROGRESS, ON_HOLD, COMPLETED, CANCELLED)
    // เพื่อให้ totalOrders สอดคล้องกับสถานะจริง
    const row = filterAll
      ? db.prepare(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN UPPER(status) = 'DRAFT' THEN 1 ELSE 0 END) as draft,
            SUM(CASE WHEN UPPER(status) = 'PLANNED' THEN 1 ELSE 0 END) as planned,
            SUM(CASE WHEN UPPER(status) = 'IN_PROGRESS' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN UPPER(status) = 'ON_HOLD' THEN 1 ELSE 0 END) as on_hold,
            SUM(CASE WHEN UPPER(status) = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN UPPER(status) = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled,
            COALESCE(SUM(CASE WHEN UPPER(status) = 'COMPLETED' THEN completed_qty ELSE 0 END), 0) as total_produced
          FROM work_orders
          WHERE UPPER(status) IN ('DRAFT', 'PLANNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')
        `).get() as any
      : db.prepare(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN UPPER(status) = 'DRAFT' THEN 1 ELSE 0 END) as draft,
            SUM(CASE WHEN UPPER(status) = 'PLANNED' THEN 1 ELSE 0 END) as planned,
            SUM(CASE WHEN UPPER(status) = 'IN_PROGRESS' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN UPPER(status) = 'ON_HOLD' THEN 1 ELSE 0 END) as on_hold,
            SUM(CASE WHEN UPPER(status) = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN UPPER(status) = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled,
            COALESCE(SUM(CASE WHEN UPPER(status) = 'COMPLETED' THEN completed_qty ELSE 0 END), 0) as total_produced
          FROM work_orders
          WHERE tenant_id = ? AND UPPER(status) IN ('DRAFT', 'PLANNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')
        `).get(tenantId) as any

    res.json({
      success: true,
      data: {
        totalOrders: row?.total || 0,
        draft: row?.draft || 0,
        planned: row?.planned || 0,
        inProgress: row?.in_progress || 0,
        onHold: row?.on_hold || 0,
        completed: row?.completed || 0,
        cancelled: row?.cancelled || 0,
        totalProduced: row?.total_produced || 0,
      },
    })
  } catch (error) {
    console.error('Work order stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stats' })
  }
})

// GET single work order with materials
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const isMaster = req.user?.role === 'MASTER'
    const tenantId = req.user!.tenantId

    const wo = (isMaster
      ? db.prepare(`
          SELECT wo.*, so.so_number
          FROM work_orders wo
          LEFT JOIN sales_orders so ON wo.sales_order_id = so.id
          WHERE wo.id = ?
        `).get(req.params.id)
      : db.prepare(`
          SELECT wo.*, so.so_number
          FROM work_orders wo
          LEFT JOIN sales_orders so ON wo.sales_order_id = so.id
          WHERE wo.id = ? AND wo.tenant_id = ?
        `).get(req.params.id, tenantId)) as any

    if (!wo) {
      return res.status(404).json({ success: false, message: 'Work order not found' })
    }

    const effectiveTenantId = wo.tenant_id
    const materials = db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(req.params.id)
    const inspections = db.prepare('SELECT * FROM qc_inspections WHERE work_order_id = ? AND tenant_id = ? ORDER BY created_at DESC').all(req.params.id, effectiveTenantId)

    res.json({ success: true, data: { ...wo, materials, inspections } })
  } catch (error) {
    console.error('Get work order error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch work order' })
  }
})

// POST create work order
router.post('/', async (req: Request, res: Response) => {
  try {
    const isMaster = req.user?.role === 'MASTER'
    const tenantId = (isMaster && (req.body.tenantId || req.query.tenantId))
      ? String(req.body.tenantId || req.query.tenantId)
      : req.user!.tenantId

    const data = createWorkOrder(tenantId, req.body)
    res.status(201).json({ success: true, data })
  } catch (error: any) {
    if (error instanceof WorkOrderTransitionError) {
      return res.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Create work order error:', error)
    res.status(500).json({ success: false, message: 'Failed to create work order' })
  }
})

// PUT update work order status (with stock deduction)
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const isMaster = req.user?.role === 'MASTER'
    const tenantId = req.user!.tenantId
    const { status } = req.body

    const updated = transitionWorkOrder(
      tenantId,
      req.params.id,
      status,
      {
        email: req.user?.email || 'system',
        role: req.user?.role || '',
        isMaster,
      }
    )

    res.json({ success: true, data: updated })
  } catch (error: any) {
    if (error instanceof WorkOrderTransitionError) {
      return res.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Update WO status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// PUT update work order
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const isMaster = req.user?.role === 'MASTER'
    let tenantId = req.user!.tenantId
    const { productName, quantity, priority, dueDate, assignedTo, notes, unit } = req.body
    const now = new Date().toISOString()

    // Check if work order exists and belongs to tenant
    const existing = (isMaster
      ? db.prepare('SELECT id, tenant_id FROM work_orders WHERE id = ?').get(req.params.id)
      : db.prepare('SELECT id, tenant_id FROM work_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)) as any

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Work order not found' })
    }
    if (isMaster && existing.tenant_id) {
      tenantId = existing.tenant_id
    }

    // หน่วยของ WO เดิมรับเฉพาะตอนสร้าง กรอกผิดแล้วแก้ไม่ได้เลย ต้องลบทิ้งสร้างใหม่
    // ทั้งที่หน่วยเป็นตัวกำหนดว่าตอนปิดงานจะบวกสต็อกเท่าไหร่ — จำกัดไว้ที่ DRAFT/PLANNED
    // ตาม WHERE เดิม จึงแก้หลังเบิกวัตถุดิบไปแล้วไม่ได้
    const normalizedUnit = unit === undefined || unit === null || unit === '' ? null : normalizeUnit(String(unit))

    db.prepare(`
      UPDATE work_orders SET product_name = COALESCE(?, product_name), quantity = COALESCE(?, quantity),
      priority = COALESCE(?, priority), due_date = ?, assigned_to = COALESCE(?, assigned_to),
      notes = COALESCE(?, notes), unit = COALESCE(?, unit), updated_at = ?
      WHERE id = ? AND tenant_id = ? AND status IN ('DRAFT', 'PLANNED')
    `).run(productName, quantity, priority, dueDate || null, assignedTo, notes, normalizedUnit, now, req.params.id, tenantId)

    const updatedWo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: updatedWo })
  } catch (error) {
    console.error('Update work order error:', error)
    res.status(500).json({ success: false, message: 'Failed to update work order' })
  }
})

// DELETE work order (only DRAFT)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const isMaster = req.user?.role === 'MASTER'
    let tenantId = req.user!.tenantId

    const wo = (isMaster
      ? db.prepare('SELECT status, tenant_id FROM work_orders WHERE id = ?').get(req.params.id)
      : db.prepare('SELECT status, tenant_id FROM work_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)) as any

    if (!wo) {
      return res.status(404).json({ success: false, message: 'Work order not found' })
    }
    if (wo.status !== 'DRAFT') {
      return res.status(400).json({ success: false, message: 'Can only delete draft work orders' })
    }
    if (isMaster && wo.tenant_id) {
      tenantId = wo.tenant_id
    }

    db.prepare('DELETE FROM work_order_materials WHERE work_order_id = ?').run(req.params.id)
    db.prepare('DELETE FROM work_orders WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)
    res.json({ success: true, message: 'Work order deleted' })
  } catch (error) {
    console.error('Delete work order error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete work order' })
  }
})

export default router
