import { Router, Request, Response } from 'express'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

const router = Router()

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

// Get stock statistics
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const totalItems = (db.prepare('SELECT COUNT(*) as count FROM stock_items').get() as any).count
    const stockItems = db.prepare('SELECT * FROM stock_items').all() as any[]

    const lowStockCount = stockItems.filter(
      (item: any) => item.quantity <= item.min_stock
    ).length

    const criticalCount = stockItems.filter(
      (item: any) => item.quantity <= item.min_stock * 0.3
    ).length

    let totalValue = 0
    for (const item of stockItems) {
      if (item.material_id) {
        const material = db.prepare('SELECT unit_cost FROM materials WHERE id = ?').get(item.material_id) as any
        if (material) {
          totalValue += item.quantity * (material.unit_cost || 0)
        }
      }
    }

    res.json({
      success: true,
      data: {
        totalItems,
        lowStockCount,
        criticalCount,
        totalValue: Math.round(totalValue),
      },
    })
  } catch (error) {
    console.error('Get stock stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stock stats' })
  }
})

// Get all stock items
router.get('/', async (_req: Request, res: Response) => {
  try {
    const stockItems = db.prepare(`
      SELECT si.*, p.name as product_name, p.code as product_code,
             m.name as material_name, m.code as material_code, m.unit_cost
      FROM stock_items si
      LEFT JOIN products p ON si.product_id = p.id
      LEFT JOIN materials m ON si.material_id = m.id
      ORDER BY si.updated_at DESC
    `).all() as any[]

    for (const item of stockItems) {
      item.movements = db.prepare(`
        SELECT * FROM stock_movements
        WHERE stock_item_id = ?
        ORDER BY created_at DESC
        LIMIT 5
      `).all(item.id)
    }

    res.json({
      success: true,
      data: stockItems,
    })
  } catch (error) {
    console.error('Get stock items error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stock items' })
  }
})

// Get stock item by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const stock = db.prepare(`
      SELECT si.*, p.name as product_name, p.code as product_code,
             m.name as material_name, m.code as material_code, m.unit_cost
      FROM stock_items si
      LEFT JOIN products p ON si.product_id = p.id
      LEFT JOIN materials m ON si.material_id = m.id
      WHERE si.id = ?
    `).get(req.params.id) as any

    if (!stock) {
      return res.status(404).json({
        success: false,
        message: 'Stock item not found',
      })
    }

    stock.movements = db.prepare(`
      SELECT * FROM stock_movements
      WHERE stock_item_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(req.params.id)

    res.json({
      success: true,
      data: stock,
    })
  } catch (error) {
    console.error('Get stock item error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stock item' })
  }
})

export default router
