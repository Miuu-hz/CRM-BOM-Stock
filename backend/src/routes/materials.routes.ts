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

// Material Categories Routes
// GET /api/materials/categories - ดึงหมวดหมู่วัตถุดิบทั้งหมด
router.get('/categories', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const categories = db.prepare(`
      SELECT id, code, name, default_unit as defaultUnit, description
      FROM material_categories 
      WHERE tenant_id = ? OR tenant_id IS NULL
      ORDER BY name ASC
    `).all(tenantId) as any[]
    
    res.json({ success: true, data: categories })
  } catch (error) {
    console.error('Get categories error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch categories' })
  }
})

// POST /api/materials/categories - สร้างหมวดหมู่ใหม่
router.post('/categories', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { code, name, defaultUnit, description } = req.body
    
    if (!code || !name || !defaultUnit) {
      return res.status(400).json({ success: false, message: 'Code, name, and defaultUnit are required' })
    }
    
    // Validate unit
    const validUnits = ['kg', 'g', 'm', 'cm', 'yard', 'roll', 'pcs', 'box', 'pack', 'set', 'pair', 'sheet', 'ltr', 'bottle']
    if (!validUnits.includes(defaultUnit)) {
      return res.status(400).json({ success: false, message: `Invalid unit. Valid units: ${validUnits.join(', ')}` })
    }
    
    const id = generateId()
    const now = new Date().toISOString()
    
    db.prepare(`
      INSERT INTO material_categories (id, tenant_id, code, name, default_unit, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, code, name, defaultUnit, description || '', now, now)
    
    const category = db.prepare('SELECT * FROM material_categories WHERE id = ?').get(id)
    res.json({ success: true, data: category })
  } catch (error) {
    console.error('Create category error:', error)
    res.status(500).json({ success: false, message: 'Failed to create category' })
  }
})

// Get materials statistics
router.get('/stats', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const totalMaterials = (db.prepare('SELECT COUNT(*) as count FROM materials WHERE tenant_id = ?').get(tenantId) as any).count

    // Get materials with low stock
    const stockItems = db.prepare(`
      SELECT si.*, m.min_stock, m.max_stock
      FROM stock_items si
      JOIN materials m ON si.material_id = m.id
      WHERE si.material_id IS NOT NULL AND si.tenant_id = ?
    `).all(tenantId) as any[]

    const lowStockCount = stockItems.filter(
      (item) => item.quantity <= item.min_stock
    ).length

    // Calculate total inventory value
    const materials = db.prepare('SELECT id, unit_cost FROM materials WHERE tenant_id = ?').all(tenantId) as any[]
    const totalValue = stockItems.reduce((sum, item) => {
      const material = materials.find((m) => m.id === item.material_id)
      if (material) {
        return sum + item.quantity * Number(material.unit_cost)
      }
      return sum
    }, 0)

    res.json({
      success: true,
      data: {
        totalMaterials,
        lowStockCount,
        totalValue: Math.round(totalValue),
        activeItems: stockItems.length,
      },
    })
  } catch (error) {
    console.error('Get materials stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch materials stats' })
  }
})

// Get all materials with stock info
router.get('/', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const materials = db.prepare(`
      SELECT m.*, si.id as stock_id, si.quantity as stock_quantity,
             mc.name as category_name, mc.default_unit as category_default_unit
      FROM materials m
      LEFT JOIN stock_items si ON m.id = si.material_id
      LEFT JOIN material_categories mc ON m.category_id = mc.id
      WHERE m.tenant_id = ?
      ORDER BY m.name ASC
    `).all(tenantId) as any[]

    // Enrich with stock status and convert to camelCase
    const materialsWithStock = materials.map((material) => {
      const currentStock = material.stock_quantity || 0
      const minStock = material.min_stock
      const maxStock = material.max_stock

      let stockStatus = 'NO_STOCK'
      if (material.stock_id) {
        if (currentStock <= minStock * 0.3) {
          stockStatus = 'CRITICAL'
        } else if (currentStock <= minStock) {
          stockStatus = 'LOW'
        } else if (currentStock >= maxStock) {
          stockStatus = 'OVERSTOCK'
        } else {
          stockStatus = 'ADEQUATE'
        }
      }

      // Count usage in BOMs
      const bomCount = db.prepare('SELECT COUNT(*) as count FROM bom_items WHERE material_id = ?').get(material.id) as any
      const usedInBOMs = bomCount.count

      return {
        id: material.id,
        categoryId: material.category_id,
        categoryName: material.category_name,
        categoryDefaultUnit: material.category_default_unit,
        code: material.code,
        name: material.name,
        unit: material.unit,
        unitCost: material.unit_cost,
        minStock: material.min_stock,
        maxStock: material.max_stock,
        currentStock,
        stockStatus,
        usedInBOMs,
        stockItem: material.stock_id ? { id: material.stock_id, quantity: currentStock } : null,
      }
    })

    res.json({
      success: true,
      data: materialsWithStock,
    })
  } catch (error) {
    console.error('Get materials error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch materials' })
  }
})

// Get material by ID
router.get('/:id', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const material = db.prepare(`
      SELECT m.*, si.id as stock_id, si.quantity as stock_quantity
      FROM materials m
      LEFT JOIN stock_items si ON m.id = si.material_id
      WHERE m.id = ? AND m.tenant_id = ?
    `).get(req.params.id, tenantId) as any

    if (!material) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      })
    }

    // Get stock movements if stock item exists
    if (material.stock_id) {
      material.movements = db.prepare(`
        SELECT * FROM stock_movements
        WHERE stock_item_id = ?
        ORDER BY created_at DESC
        LIMIT 10
      `).all(material.stock_id)
    }

    // Get BOM usage
    material.bomItems = db.prepare(`
      SELECT bi.*, p.name as product_name, p.code as product_code
      FROM bom_items bi
      JOIN boms b ON bi.bom_id = b.id
      JOIN products p ON b.product_id = p.id
      WHERE bi.material_id = ?
    `).all(req.params.id)

    res.json({
      success: true,
      data: material,
    })
  } catch (error) {
    console.error('Get material error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch material' })
  }
})

// Create material
router.post('/', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { code, name, categoryId, unitCost, minStock, maxStock, initialStock } = req.body

    // Validate required fields
    if (!code || !name || !categoryId || unitCost === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Code, name, categoryId, and unitCost are required',
      })
    }

    // Get category to determine unit
    const category = db.prepare('SELECT * FROM material_categories WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)').get(categoryId, tenantId) as any
    if (!category) {
      return res.status(400).json({
        success: false,
        message: 'Invalid categoryId',
      })
    }

    // Unit is determined by category - cannot be changed
    const unit = category.default_unit

    // Check for duplicate code
    const existing = db.prepare('SELECT id FROM materials WHERE code = ? AND tenant_id = ?').get(code, tenantId)

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Material code already exists',
      })
    }

    const id = generateId()
    const now = new Date().toISOString()

    // Create material with category
    db.prepare(`
      INSERT INTO materials (id, tenant_id, category_id, code, name, unit, unit_cost, min_stock, max_stock, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, categoryId, code, name, unit, unitCost, minStock || 0, maxStock || 1000, now, now)

    // Create stock item if initial stock provided
    if (initialStock && initialStock > 0) {
      const stockId = generateId()
      db.prepare(`
        INSERT INTO stock_items (id, tenant_id, sku, name, category, material_id, quantity, unit, min_stock, max_stock, location, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'RAW_MATERIAL', ?, ?, ?, ?, ?, 'WAREHOUSE', ?, ?, ?)
      `).run(
        stockId, 
        tenantId, 
        `STK-${code}`, 
        `Stock: ${name}`, 
        id, 
        initialStock, 
        unit,
        minStock || 0, 
        maxStock || 1000, 
        initialStock > (minStock || 0) ? 'ADEQUATE' : 'LOW',
        now, 
        now
      )
    }

    const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(id)

    res.json({
      success: true,
      message: 'Material created successfully',
      data: material,
    })
  } catch (error) {
    console.error('Create material error:', error)
    res.status(500).json({ success: false, message: 'Failed to create material' })
  }
})

// Update material
router.put('/:id', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { code, name, categoryId, unitCost, minStock, maxStock } = req.body

    const existing = db.prepare('SELECT * FROM materials WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      })
    }

    // Check for duplicate code (excluding current)
    if (code && code !== existing.code) {
      const duplicate = db.prepare('SELECT id FROM materials WHERE code = ? AND tenant_id = ?').get(code, tenantId)
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Material code already exists',
        })
      }
    }

    // If changing category, get new unit
    let newUnit = existing.unit
    if (categoryId && categoryId !== existing.category_id) {
      const category = db.prepare('SELECT default_unit FROM material_categories WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)').get(categoryId, tenantId) as any
      if (!category) {
        return res.status(400).json({
          success: false,
          message: 'Invalid categoryId',
        })
      }
      newUnit = category.default_unit
    }

    const now = new Date().toISOString()

    db.prepare(`
      UPDATE materials SET
        code = COALESCE(?, code),
        name = COALESCE(?, name),
        category_id = COALESCE(?, category_id),
        unit = ?,
        unit_cost = COALESCE(?, unit_cost),
        min_stock = COALESCE(?, min_stock),
        max_stock = COALESCE(?, max_stock),
        updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(code, name, categoryId, newUnit, unitCost, minStock, maxStock, now, req.params.id, tenantId)

    // Update related stock items (including unit from material)
    if (minStock !== undefined || maxStock !== undefined) {
      db.prepare(`
        UPDATE stock_items SET
          min_stock = COALESCE(?, min_stock),
          max_stock = COALESCE(?, max_stock),
          unit = ?,
          updated_at = ?
        WHERE material_id = ? AND tenant_id = ?
      `).run(minStock, maxStock, newUnit, now, req.params.id, tenantId)
    }

    const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id)

    res.json({
      success: true,
      message: 'Material updated successfully',
      data: material,
    })
  } catch (error) {
    console.error('Update material error:', error)
    res.status(500).json({ success: false, message: 'Failed to update material' })
  }
})

// Delete material
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const existing = db.prepare('SELECT id FROM materials WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      })
    }

    // Check if used in any BOM
    const bomCount = db.prepare('SELECT COUNT(*) as count FROM bom_items WHERE material_id = ?').get(req.params.id) as any
    if (bomCount.count > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete: Material is used in ${bomCount.count} BOM(s)`,
      })
    }

    // Delete related stock items first
    db.prepare('DELETE FROM stock_items WHERE material_id = ? AND tenant_id = ?').run(req.params.id, tenantId)

    // Delete material
    db.prepare('DELETE FROM materials WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)

    res.json({
      success: true,
      message: 'Material deleted successfully',
    })
  } catch (error) {
    console.error('Delete material error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete material' })
  }
})

// Adjust stock for material
router.post('/:id/stock', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { type, quantity, notes } = req.body

    if (!type || quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Type and quantity are required',
      })
    }

    const material = db.prepare('SELECT * FROM materials WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any

    if (!material) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      })
    }

    let stockItem = db.prepare('SELECT * FROM stock_items WHERE material_id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any

    // Create stock item if doesn't exist
    if (!stockItem) {
      const stockId = generateId()
      const now = new Date().toISOString()
      db.prepare(`
        INSERT INTO stock_items (id, tenant_id, sku, name, category, material_id, quantity, unit, min_stock, max_stock, location, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'RAW_MATERIAL', ?, 0, ?, ?, ?, 'WAREHOUSE', 'NO_STOCK', ?, ?)
      `).run(
        stockId,
        tenantId,
        `STK-${material.code}`,
        `Stock: ${material.name}`,
        material.id,
        material.unit,
        material.min_stock,
        material.max_stock,
        now,
        now
      )
      stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(stockId)
    }

    // Calculate new quantity
    let newQuantity = stockItem.quantity
    if (type === 'IN') {
      newQuantity += quantity
    } else if (type === 'OUT') {
      newQuantity -= quantity
      if (newQuantity < 0) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient stock',
        })
      }
    } else if (type === 'ADJUST') {
      newQuantity = quantity
    }

    // Determine status
    let status = 'ADEQUATE'
    if (newQuantity <= material.min_stock * 0.3) {
      status = 'CRITICAL'
    } else if (newQuantity <= material.min_stock) {
      status = 'LOW'
    } else if (newQuantity >= material.max_stock) {
      status = 'OVERSTOCK'
    }

    const now = new Date().toISOString()

    // Update stock item
    db.prepare('UPDATE stock_items SET quantity = ?, status = ?, updated_at = ? WHERE id = ?').run(newQuantity, status, now, stockItem.id)

    // Record movement
    const movementId = generateId()
    db.prepare(`
      INSERT INTO stock_movements (id, stock_item_id, type, quantity, notes, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(movementId, stockItem.id, type, quantity, notes || '', now, 'system')

    res.json({
      success: true,
      message: 'Stock adjusted successfully',
      data: {
        material,
        stockItem: { ...stockItem, quantity: newQuantity, status },
        previousQuantity: stockItem.quantity,
        newQuantity,
      },
    })
  } catch (error) {
    console.error('Adjust stock error:', error)
    res.status(500).json({ success: false, message: 'Failed to adjust stock' })
  }
})

export default router
