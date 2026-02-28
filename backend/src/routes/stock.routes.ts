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

// Get stock statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const totalItems = (db.prepare('SELECT COUNT(*) as count FROM stock_items WHERE tenant_id = ?').get(tenantId) as any).count
    const stockItems = db.prepare('SELECT * FROM stock_items WHERE tenant_id = ?').all(tenantId) as any[]

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
        totalValue,
      },
    })
  } catch (error) {
    console.error('Get stock stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stock stats' })
  }
})

// Get all stock items
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const stockItems = db.prepare(`
      SELECT si.*, p.name as product_name, p.code as product_code,
             m.name as material_name, m.code as material_code, m.unit_cost
      FROM stock_items si
      LEFT JOIN products p ON si.product_id = p.id
      LEFT JOIN materials m ON si.material_id = m.id
      WHERE si.tenant_id = ?
      ORDER BY si.updated_at DESC
    `).all(tenantId) as any[]

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
    const tenantId = req.user!.tenantId
    
    const stock = db.prepare(`
      SELECT si.*, p.name as product_name, p.code as product_code,
             m.name as material_name, m.code as material_code, m.unit_cost
      FROM stock_items si
      LEFT JOIN products p ON si.product_id = p.id
      LEFT JOIN materials m ON si.material_id = m.id
      WHERE si.id = ? AND si.tenant_id = ?
    `).get(req.params.id, tenantId) as any

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
    `).all(stock.id)

    res.json({
      success: true,
      data: stock,
    })
  } catch (error) {
    console.error('Get stock item error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stock item' })
  }
})

// Create stock item
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { sku, name, category, unit, quantity = 0, minStock = 0, maxStock = 100, location } = req.body

    if (!sku || !name) {
      return res.status(400).json({ success: false, message: 'SKU and name are required' })
    }

    const id = generateId()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, min_stock, max_stock, location, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
    `).run(id, tenantId, sku, name, category, quantity, unit, minStock, maxStock, location || 'Main Warehouse', now, now)

    const item = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(id)
    
    res.status(201).json({
      success: true,
      data: item,
    })
  } catch (error) {
    console.error('Create stock item error:', error)
    res.status(500).json({ success: false, message: 'Failed to create stock item' })
  }
})

// Update stock item
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { name, category, minStock, maxStock, location } = req.body
    
    const existing = db.prepare('SELECT id FROM stock_items WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Stock item not found' })
    }

    const now = new Date().toISOString()
    
    db.prepare(`
      UPDATE stock_items SET
        name = COALESCE(?, name),
        category = COALESCE(?, category),
        min_stock = COALESCE(?, min_stock),
        max_stock = COALESCE(?, max_stock),
        location = COALESCE(?, location),
        updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(name, category, minStock, maxStock, location, now, req.params.id, tenantId)

    const item = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(req.params.id)
    
    res.json({
      success: true,
      data: item,
    })
  } catch (error) {
    console.error('Update stock item error:', error)
    res.status(500).json({ success: false, message: 'Failed to update stock item' })
  }
})

// Delete stock item
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const existing = db.prepare('SELECT id FROM stock_items WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Stock item not found' })
    }

    db.prepare('DELETE FROM stock_items WHERE id = ?').run(req.params.id)
    
    res.json({ success: true, message: 'Stock item deleted' })
  } catch (error) {
    console.error('Delete stock item error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete stock item' })
  }
})

// Record stock movement
router.post('/movement', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { stockItemId, type, quantity, reference, notes } = req.body
    const createdBy = req.user!.email

    if (!stockItemId || !type || !quantity) {
      return res.status(400).json({ success: false, message: 'Missing required fields' })
    }

    const item = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
    if (!item) {
      return res.status(404).json({ success: false, message: 'Stock item not found' })
    }

    let newQuantity = item.quantity
    if (type === 'IN') {
      newQuantity += quantity
    } else if (type === 'OUT') {
      if (item.quantity < quantity) {
        return res.status(400).json({ success: false, message: 'Insufficient stock' })
      }
      newQuantity -= quantity
    }

    const now = new Date().toISOString()

    db.prepare('UPDATE stock_items SET quantity = ?, updated_at = ? WHERE id = ?').run(newQuantity, now, stockItemId)

    const movementId = generateId()
    db.prepare(`
      INSERT INTO stock_movements (id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(movementId, stockItemId, type, quantity, reference || '', notes || '', now, createdBy)

    const updatedItem = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(stockItemId)
    
    res.json({
      success: true,
      data: updatedItem,
    })
  } catch (error) {
    console.error('Record movement error:', error)
    res.status(500).json({ success: false, message: 'Failed to record movement' })
  }
})

export default router
