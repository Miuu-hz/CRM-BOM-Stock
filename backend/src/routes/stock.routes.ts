import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'
import multer from 'multer'
import path from 'path'
import fs from 'fs'

// Multer config: store in uploads/stock-images/
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'stock-images')
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, _file, cb) => {
    const ext = path.extname(_file.originalname).toLowerCase() || '.jpg'
    cb(null, `${req.params.id}-${Date.now()}${ext}`)
  },
})
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files allowed'))
  },
})

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
             m.name as material_name, m.code as material_code, m.unit_cost as material_unit_cost
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
             m.name as material_name, m.code as material_code, m.unit_cost as material_unit_cost
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
    const { sku, gs1Barcode, name, category, unit, quantity = 0, minStock = 0, maxStock = 100, location, isPosEnabled = false, unitCost, unitPrice } = req.body

    if (!sku || !name) {
      return res.status(400).json({ success: false, message: 'SKU and name are required' })
    }

    const id = generateId()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO stock_items (id, tenant_id, sku, gs1_barcode, name, category, quantity, unit, unit_cost, unit_price, min_stock, max_stock, location, status, is_pos_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
    `).run(id, tenantId, sku, gs1Barcode || null, name, category, quantity, unit, unitCost ? Number(unitCost) : 0, unitPrice ? Number(unitPrice) : 0, minStock, maxStock, location || 'Main Warehouse', isPosEnabled ? 1 : 0, now, now)

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
    const { name, gs1Barcode, category, unit, minStock, maxStock, location, isPosEnabled, unitCost, unitPrice } = req.body

    const existing = db.prepare('SELECT id FROM stock_items WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Stock item not found' })
    }

    const currentItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any

    const now = new Date().toISOString()

    db.prepare(`
      UPDATE stock_items SET
        name = COALESCE(?, name),
        gs1_barcode = COALESCE(?, gs1_barcode),
        category = COALESCE(?, category),
        unit = COALESCE(?, unit),
        unit_cost = COALESCE(?, unit_cost),
        unit_price = COALESCE(?, unit_price),
        min_stock = COALESCE(?, min_stock),
        max_stock = COALESCE(?, max_stock),
        location = COALESCE(?, location),
        is_pos_enabled = COALESCE(?, is_pos_enabled),
        updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(name, gs1Barcode, category, unit || undefined, unitCost !== undefined ? Number(unitCost) : undefined, unitPrice !== undefined ? Number(unitPrice) : undefined, minStock, maxStock, location, isPosEnabled !== undefined ? (isPosEnabled ? 1 : 0) : undefined, now, req.params.id, tenantId)

    // Record price change in movements
    if (unitCost !== undefined && currentItem && Number(unitCost) !== Number(currentItem.unit_cost)) {
      const movId = generateId()
      db.prepare(`
        INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
        VALUES (?, ?, ?, 'PRICE_CHANGE', 0, '', ?, ?, ?)
      `).run(movId, tenantId, req.params.id, `ราคาเปลี่ยนจาก ฿${currentItem.unit_cost || 0} → ฿${unitCost}`, now, req.user!.email)
    }

    // Always get latest stock item after update
    const stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(req.params.id) as any
    const posPrice = stockItem?.unit_price || stockItem?.unit_cost || 0
    const costPrice = stockItem?.unit_cost || 0

    // Sync pos_price / cost_price whenever unitPrice or unitCost changes
    if (unitPrice !== undefined || unitCost !== undefined) {
      db.prepare('UPDATE pos_menu_configs SET pos_price = ?, cost_price = ?, updated_at = ? WHERE product_id = ? AND tenant_id = ?')
        .run(posPrice, costPrice, now, req.params.id, tenantId)
    }

    // Sync with pos_menu_configs when POS enabled flag changes
    if (isPosEnabled !== undefined) {
      if (isPosEnabled) {
        // Upsert: create pos_menu_configs entry if not exists
        const existingPOS = db.prepare('SELECT id FROM pos_menu_configs WHERE product_id = ? AND tenant_id = ?').get(req.params.id, tenantId)
        if (!existingPOS) {
          const posId = randomUUID().replace(/-/g, '').substring(0, 25)
          db.prepare(`
            INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price, cost_price, image_url, is_available, is_pos_enabled, display_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?)
          `).run(posId, tenantId, req.params.id, posPrice, costPrice, stockItem?.image_url || null, now, now)
        } else {
          db.prepare('UPDATE pos_menu_configs SET is_pos_enabled = 1, is_available = 1, pos_price = ?, cost_price = ?, updated_at = ? WHERE product_id = ? AND tenant_id = ?')
            .run(posPrice, costPrice, now, req.params.id, tenantId)
        }
      } else {
        // Disable in pos_menu_configs
        db.prepare('UPDATE pos_menu_configs SET is_pos_enabled = 0, updated_at = ? WHERE product_id = ? AND tenant_id = ?')
          .run(now, req.params.id, tenantId)
      }
    }

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
    const { stockItemId, type, quantity, reference, notes, unitCost } = req.body
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
    } else if (type === 'ADJUST') {
      newQuantity = quantity
    }

    const now = new Date().toISOString()

    db.prepare('UPDATE stock_items SET quantity = ?, updated_at = ? WHERE id = ?').run(newQuantity, now, stockItemId)

    // Update unit_cost on stock-in if provided
    if (type === 'IN' && unitCost !== undefined && unitCost !== null) {
      db.prepare('UPDATE stock_items SET unit_cost = ?, updated_at = ? WHERE id = ?')
        .run(Number(unitCost), now, stockItemId)
    }

    const movementId = generateId()
    db.prepare(`
      INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(movementId, tenantId, stockItemId, type, quantity, reference || '', notes || '', now, createdBy)

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

// Get movements for a stock item
router.get('/:id/movements', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const movements = db.prepare(`
      SELECT * FROM stock_movements
      WHERE stock_item_id = ? AND tenant_id = ?
      ORDER BY created_at DESC
    `).all(req.params.id, tenantId)
    res.json({ success: true, data: movements })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch movements' })
  }
})

// Upload image for stock item
router.post('/:id/image', (req: Request, res: Response, next: any) => {
  upload.single('image')(req, res, (err: any) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'ไฟล์ใหญ่เกินไป (สูงสุด 10MB)' })
    }
    if (err) return res.status(400).json({ success: false, message: err.message })
    next()
  })
}, async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const file = req.file
    if (!file) return res.status(400).json({ success: false, message: 'No image file provided' })

    const existing = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!existing) return res.status(404).json({ success: false, message: 'Stock item not found' })

    // Delete old image file if exists
    if (existing.image_url) {
      const oldPath = path.join(__dirname, '..', '..', existing.image_url.replace(/^\//, ''))
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
    }

    const imageUrl = `/uploads/stock-images/${file.filename}`
    const now = new Date().toISOString()

    db.prepare('UPDATE stock_items SET image_url = ?, updated_at = ? WHERE id = ?')
      .run(imageUrl, now, req.params.id)

    // Sync image to pos_menu_configs
    db.prepare('UPDATE pos_menu_configs SET image_url = ?, updated_at = ? WHERE product_id = ? AND tenant_id = ?')
      .run(imageUrl, now, req.params.id, tenantId)

    res.json({ success: true, data: { image_url: imageUrl } })
  } catch (error) {
    console.error('Upload image error:', error)
    res.status(500).json({ success: false, message: 'Failed to upload image' })
  }
})

// Delete image for stock item
router.delete('/:id/image', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const existing = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!existing) return res.status(404).json({ success: false, message: 'Stock item not found' })

    if (existing.image_url) {
      const filePath = path.join(__dirname, '..', '..', existing.image_url.replace(/^\//, ''))
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }

    const now = new Date().toISOString()
    db.prepare('UPDATE stock_items SET image_url = NULL, updated_at = ? WHERE id = ?').run(now, req.params.id)
    db.prepare('UPDATE pos_menu_configs SET image_url = NULL, updated_at = ? WHERE product_id = ? AND tenant_id = ?')
      .run(now, req.params.id, tenantId)

    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete image' })
  }
})

export default router
