import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

function generateWONumber(tenantId: string) {
  const count = (db.prepare('SELECT COUNT(*) as count FROM work_orders WHERE tenant_id = ?').get(tenantId) as any).count
  return `WO-${String(count + 1).padStart(5, '0')}`
}

// GET all work orders
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const orders = db.prepare(`
      SELECT wo.*,
        (SELECT COUNT(*) FROM work_order_materials WHERE work_order_id = wo.id) as material_count
      FROM work_orders wo
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
    const tenantId = req.user!.tenantId
    
    const total = db.prepare('SELECT COUNT(*) as count FROM work_orders WHERE tenant_id = ?').get(tenantId) as any
    const inProgress = db.prepare("SELECT COUNT(*) as count FROM work_orders WHERE tenant_id = ? AND status = 'IN_PROGRESS'").get(tenantId) as any
    const planned = db.prepare("SELECT COUNT(*) as count FROM work_orders WHERE tenant_id = ? AND status = 'PLANNED'").get(tenantId) as any
    const completed = db.prepare("SELECT COUNT(*) as count FROM work_orders WHERE tenant_id = ? AND status = 'COMPLETED'").get(tenantId) as any
    const completedQty = db.prepare("SELECT COALESCE(SUM(completed_qty), 0) as total FROM work_orders WHERE tenant_id = ? AND status = 'COMPLETED'").get(tenantId) as any

    res.json({
      success: true,
      data: {
        totalOrders: total.count,
        inProgress: inProgress.count,
        planned: planned.count,
        completed: completed.count,
        totalProduced: completedQty.total,
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
    const tenantId = req.user!.tenantId
    
    const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!wo) {
      return res.status(404).json({ success: false, message: 'Work order not found' })
    }

    const materials = db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(req.params.id)

    res.json({ success: true, data: { ...wo, materials } })
  } catch (error) {
    console.error('Get work order error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch work order' })
  }
})

// POST create work order
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { bomId, productName, quantity, priority, dueDate, assignedTo, notes, materials } = req.body
    const id = generateId()
    const woNumber = generateWONumber(tenantId)
    const now = new Date().toISOString()

    // Check stock availability for all materials (scoped to tenant)
    if (materials && materials.length > 0) {
      const outOfStock = materials.filter((m: any) => {
        const stock = db.prepare('SELECT quantity FROM stock_items WHERE material_id = ? AND tenant_id = ?').get(m.materialId, tenantId) as any
        return !stock || stock.quantity === 0
      })

      if (outOfStock.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot create work order: some materials are out of stock',
          outOfStock: outOfStock.map((m: any) => m.materialName),
        })
      }
    }

    // Calculate estimated cost
    let estimatedCost = 0
    if (materials) {
      estimatedCost = materials.reduce((sum: number, m: any) => sum + (m.requiredQty * (m.unitCost || 0)), 0)
    }

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO work_orders (id, tenant_id, wo_number, bom_id, product_name, quantity, status, priority, 
          due_date, assigned_to, notes, estimated_cost, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tenantId, woNumber, bomId || null, productName || '', quantity, priority || 'NORMAL', 
        dueDate || null, assignedTo || '', notes || '', estimatedCost, now, now)

      if (materials && materials.length > 0) {
        const insertMaterial = db.prepare(`
          INSERT INTO work_order_materials (id, tenant_id, work_order_id, material_id, material_name, required_qty, unit, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
        `)
        for (const m of materials) {
          insertMaterial.run(generateId(), tenantId, id, m.materialId || null, m.materialName || '', m.requiredQty, m.unit || 'units')
        }
      }
    })

    transaction()

    const wo = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(id)
    const woMaterials = db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(id)
    res.status(201).json({ success: true, data: { ...wo, materials: woMaterials } })
  } catch (error) {
    console.error('Create work order error:', error)
    res.status(500).json({ success: false, message: 'Failed to create work order' })
  }
})

// PUT update work order status (with stock deduction)
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ON_HOLD']
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!wo) {
      return res.status(404).json({ success: false, message: 'Work order not found' })
    }

    const now = new Date().toISOString()
    const materials = db.prepare('SELECT * FROM work_order_materials WHERE work_order_id = ?').all(req.params.id) as any[]

    // When starting production (IN_PROGRESS) - deduct materials from stock
    if (status === 'IN_PROGRESS' && wo.status !== 'IN_PROGRESS') {
      // Check stock availability first (scoped to tenant)
      for (const m of materials) {
        if (m.material_id) {
          const stock = db.prepare('SELECT * FROM stock_items WHERE material_id = ? AND tenant_id = ?').get(m.material_id, tenantId) as any
          if (!stock || stock.quantity < m.required_qty) {
            return res.status(400).json({
              success: false,
              message: `Insufficient stock for ${m.material_name}. Need ${m.required_qty}, have ${stock?.quantity || 0}`,
            })
          }
        }
      }

      // Deduct stock
      const deductStock = db.transaction(() => {
        db.prepare("UPDATE work_orders SET status = ?, start_date = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(status, now, now, req.params.id, tenantId)

        for (const m of materials) {
          if (m.material_id) {
            const stock = db.prepare('SELECT * FROM stock_items WHERE material_id = ? AND tenant_id = ?').get(m.material_id, tenantId) as any
            if (stock) {
              db.prepare('UPDATE stock_items SET quantity = quantity - ?, updated_at = ? WHERE id = ?')
                .run(Math.floor(m.required_qty), now, stock.id)

              db.prepare(`
                INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
                VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, 'system')
              `).run(generateId(), tenantId, stock.id, Math.floor(m.required_qty), `WO: ${wo.wo_number}`, `Material issued for work order`, now)

              db.prepare("UPDATE work_order_materials SET issued_qty = ?, status = 'ISSUED' WHERE id = ?")
                .run(m.required_qty, m.id)
            }
          }
        }
      })

      deductStock()
    } else if (status === 'COMPLETED') {
      db.prepare("UPDATE work_orders SET status = ?, completed_date = ?, completed_qty = quantity, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(status, now, now, req.params.id, tenantId)
    } else {
      db.prepare("UPDATE work_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(status, now, req.params.id, tenantId)
    }

    const updated = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: updated })
  } catch (error) {
    console.error('Update WO status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// PUT update work order
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { productName, quantity, priority, dueDate, assignedTo, notes } = req.body
    const now = new Date().toISOString()

    // Check if work order exists and belongs to tenant
    const existing = db.prepare('SELECT id FROM work_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Work order not found' })
    }

    db.prepare(`
      UPDATE work_orders SET product_name = COALESCE(?, product_name), quantity = COALESCE(?, quantity),
      priority = COALESCE(?, priority), due_date = ?, assigned_to = COALESCE(?, assigned_to),
      notes = COALESCE(?, notes), updated_at = ?
      WHERE id = ? AND tenant_id = ? AND status IN ('DRAFT', 'PLANNED')
    `).run(productName, quantity, priority, dueDate || null, assignedTo, notes, now, req.params.id, tenantId)

    const updatedWo = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: updatedWo })
  } catch (error) {
    console.error('Update work order error:', error)
    res.status(500).json({ success: false, message: 'Failed to update work order' })
  }
})

// DELETE work order (only DRAFT)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const wo = db.prepare('SELECT status FROM work_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!wo) {
      return res.status(404).json({ success: false, message: 'Work order not found' })
    }
    if (wo.status !== 'DRAFT') {
      return res.status(400).json({ success: false, message: 'Can only delete draft work orders' })
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
