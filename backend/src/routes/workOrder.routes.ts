import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { roundQty } from '../utils/qty'
import {
  createWorkOrder, transitionWorkOrder, updateWorkOrder, deleteWorkOrder, checkMaterialStock, bomMaterials,
  recordWorkOrderLot, getWorkOrderDetail, WorkOrderTransitionError,
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

/** MASTER แก้ใบของร้านอื่น → ระบุร้านด้วย ?tenantId= (role อื่นถูกเมิน ใช้ร้านตัวเองเสมอ) */
function scopedTenant(req: Request): string {
  const q = req.query.tenantId
  return req.user?.role === 'MASTER' && typeof q === 'string' && q && q !== 'all' ? q : req.user!.tenantId
}

// วัตถุดิบตาม BOM สำหรับจำนวนผลิต + สถานะสต็อก
router.get('/bom-materials/:bomId', (req: Request, res: Response) => {
  try {
    const tenantId = scopedTenant(req)
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
    res.json({ success: true, data: checkMaterialStock(scopedTenant(req), lines) })
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

    const rawOrders = filterAll
      ? db.prepare(`
          SELECT wo.*, so.so_number,
            (SELECT COUNT(*) FROM work_order_materials WHERE work_order_id = wo.id) as material_count,
            (SELECT COUNT(*) FROM work_order_lots WHERE work_order_id = wo.id AND tenant_id = wo.tenant_id) as lot_count,
            COALESCE((SELECT SUM(good_qty) FROM work_order_lots WHERE work_order_id = wo.id AND tenant_id = wo.tenant_id), 0) as lot_good_sum,
            COALESCE((SELECT SUM(scrap_qty) FROM work_order_lots WHERE work_order_id = wo.id AND tenant_id = wo.tenant_id), 0) as lot_scrap_sum
          FROM work_orders wo
          LEFT JOIN sales_orders so ON wo.sales_order_id = so.id
          ORDER BY
            CASE wo.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 WHEN 'LOW' THEN 4 END,
            wo.created_at DESC
        `).all()
      : db.prepare(`
          SELECT wo.*, so.so_number,
            (SELECT COUNT(*) FROM work_order_materials WHERE work_order_id = wo.id) as material_count,
            (SELECT COUNT(*) FROM work_order_lots WHERE work_order_id = wo.id AND tenant_id = wo.tenant_id) as lot_count,
            COALESCE((SELECT SUM(good_qty) FROM work_order_lots WHERE work_order_id = wo.id AND tenant_id = wo.tenant_id), 0) as lot_good_sum,
            COALESCE((SELECT SUM(scrap_qty) FROM work_order_lots WHERE work_order_id = wo.id AND tenant_id = wo.tenant_id), 0) as lot_scrap_sum
          FROM work_orders wo
          LEFT JOIN sales_orders so ON wo.sales_order_id = so.id
          WHERE wo.tenant_id = ?
          ORDER BY
            CASE wo.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 WHEN 'LOW' THEN 4 END,
            wo.created_at DESC
        `).all(tenantId)

    const orders = (rawOrders as any[]).map((wo) => {
      const lotCount = Number(wo.lot_count) || 0
      const lotGood = roundQty(Number(wo.lot_good_sum) || 0)
      const lotScrap = roundQty(Number(wo.lot_scrap_sum) || 0)
      // ใบเก่าที่ปิดงานแบบเดิม (ไม่มีล็อต) ใช้ยอด completed_qty/scrap_qty เดิมและถือว่าเหลือ 0
      const isLegacyCompleted = wo.status === 'COMPLETED' && lotCount === 0
      const produced_qty = isLegacyCompleted ? (Number(wo.completed_qty) || 0) : lotGood
      const lot_scrap_qty = isLegacyCompleted ? (Number(wo.scrap_qty) || 0) : lotScrap
      const remaining_qty = isLegacyCompleted ? 0 : roundQty(Math.max(0, (Number(wo.quantity) || 0) - lotGood - lotScrap))
      const { lot_count: _lc, lot_good_sum: _lg, lot_scrap_sum: _ls, ...rest } = wo
      return { ...rest, produced_qty, lot_scrap_qty, remaining_qty }
    })

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
    // เพื่อให้ totalOrders สอดคล้องกับสถานะจริง และรวมยอดผลิตสะสมของใบที่กำลังผลิตด้วย
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
            COALESCE(SUM(CASE WHEN UPPER(status) = 'COMPLETED' THEN completed_qty
              ELSE (SELECT COALESCE(SUM(l.good_qty), 0) FROM work_order_lots l WHERE l.work_order_id = work_orders.id) END), 0) as total_produced
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
            COALESCE(SUM(CASE WHEN UPPER(status) = 'COMPLETED' THEN completed_qty
              ELSE (SELECT COALESCE(SUM(l.good_qty), 0) FROM work_order_lots l WHERE l.work_order_id = work_orders.id) END), 0) as total_produced
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

    const detail = getWorkOrderDetail(tenantId, req.params.id, isMaster)
    if (!detail) {
      return res.status(404).json({ success: false, message: 'Work order not found' })
    }

    res.json({ success: true, data: detail })
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

// POST record production lot (partial/full production + proportional material deduction + FG receipt)
router.post('/:id/lots', async (req: Request, res: Response) => {
  try {
    const result = recordWorkOrderLot(
      req.user!.tenantId,
      req.params.id,
      {
        goodQty: req.body?.goodQty,
        scrapQty: req.body?.scrapQty,
        lotNumber: req.body?.lotNumber,
        notes: req.body?.notes,
      },
      {
        email: req.user?.email || 'system',
        role: req.user?.role || '',
        isMaster: req.user?.role === 'MASTER',
      }
    )
    res.status(201).json({ success: true, data: result })
  } catch (error: any) {
    sendError(res, error, 'Failed to record work order lot')
  }
})

// PUT update work order status
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const isMaster = req.user?.role === 'MASTER'
    const tenantId = req.user!.tenantId
    const { status, closeShort } = req.body

    const updated = transitionWorkOrder(
      tenantId,
      req.params.id,
      status,
      {
        email: req.user?.email || 'system',
        role: req.user?.role || '',
        isMaster,
      },
      { closeShort: Boolean(closeShort) }
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
