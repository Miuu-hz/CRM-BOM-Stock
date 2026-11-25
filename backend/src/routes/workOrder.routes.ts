import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import {
  createWorkOrder, transitionWorkOrder, updateWorkOrder, deleteWorkOrder, checkMaterialStock, bomMaterials,
  workOrderProductId, WorkOrderTransitionError,
} from '../services/workOrderTransition.service'

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

function sendError(res: Response, error: any, message: string) {
  if (error instanceof WorkOrderTransitionError) {
    return res.status(error.status).json({ success: false, message: error.message })
  }
  console.error(message, error)
  res.status(500).json({ success: false, message })
}

/** เทแนนต์ของใบสั่งงาน — MASTER ข้ามร้านได้ คนอื่นได้แค่ร้านตัวเอง */
function tenantOf(req: Request): string {
  if (req.user?.role !== 'MASTER') return req.user!.tenantId
  const row = db.prepare('SELECT tenant_id FROM work_orders WHERE id = ?').get(req.params.id) as any
  return row?.tenant_id || req.user!.tenantId
}

// วัตถุดิบตาม BOM สำหรับจำนวนผลิต + สถานะสต็อก
router.get('/bom-materials/:bomId', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const lines = bomMaterials(tenantId, req.params.bomId, Number(req.query.quantity), req.query.unit ? String(req.query.unit) : null)
    res.json({ success: true, data: lines })
  } catch (error) {
    sendError(res, error, 'Failed to load BOM materials')
  }
})

// เทียบวัตถุดิบกับสต็อก (แปลงหน่วย + รวมแพ็คที่ยังไม่แกะ)
router.post('/check-materials', (req: Request, res: Response) => {
  try {
    const lines = Array.isArray(req.body?.materials) ? req.body.materials.slice(0, 500) : []
    res.json({ success: true, data: checkMaterialStock(req.user!.tenantId, lines) })
  } catch (error) {
    sendError(res, error, 'Failed to check materials')
  }
})

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
    const rows = db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(req.params.id) as any[]
    // เบิกไปแล้วไม่ต้องเทียบสต็อก — ของออกจากคลังไปแล้ว เทียบซ้ำจะขึ้น "ขาด" ผิด ๆ
    const pending = rows.filter(m => m.status === 'PENDING')
    const checks = checkMaterialStock(effectiveTenantId, pending.map(m => ({ materialId: m.material_id, requiredQty: m.required_qty, unit: m.unit })))
    const byId = new Map(pending.map((m, i) => [m.id, checks[i]]))
    const materials = rows.map(m => ({ ...m, ...byId.get(m.id) }))
    const productId = workOrderProductId(effectiveTenantId, wo)
    const product = productId
      ? db.prepare('SELECT sku, name FROM stock_items WHERE id = ? AND tenant_id = ?').get(productId, effectiveTenantId) as any
      : null
    const inspections = db.prepare('SELECT * FROM qc_inspections WHERE work_order_id = ? AND tenant_id = ? ORDER BY created_at DESC').all(req.params.id, effectiveTenantId)

    res.json({ success: true, data: { ...wo, finished_sku: product?.sku || null, finished_name: product?.name || null, materials, inspections } })
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
    sendError(res, error, 'Failed to create work order')
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
    sendError(res, error, 'Failed to update status')
  }
})

// PUT update work order (เฉพาะที่ยังไม่เริ่มผลิต)
router.put('/:id', (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: updateWorkOrder(tenantOf(req), req.params.id, req.body || {}) })
  } catch (error) {
    sendError(res, error, 'Failed to update work order')
  }
})

// DELETE work order (เฉพาะที่ยังไม่เริ่มผลิต)
router.delete('/:id', (req: Request, res: Response) => {
  try {
    deleteWorkOrder(tenantOf(req), req.params.id, {
      email: req.user?.email || 'system',
      role: req.user?.role || '',
      isMaster: req.user?.role === 'MASTER',
    })
    res.json({ success: true, message: 'Work order deleted' })
  } catch (error) {
    sendError(res, error, 'Failed to delete work order')
  }
})

export default router
