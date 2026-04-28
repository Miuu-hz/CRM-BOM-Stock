import { Router } from 'express'
import db from '../db/sqlite'
import { authenticate } from '../middleware/auth.middleware'

const router = Router()

router.use(authenticate)

// Helper: Generate ID (24-char hex, same as other routes)
const generateId = () => {
  const chars = '0123456789abcdef'
  let id = ''
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

// Helper: Get current timestamp
const now = () => new Date().toISOString()

// ==================== POS CATEGORIES ====================

// Get all categories
router.get('/categories', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    
    const stmt = db.prepare(`
      SELECT * FROM pos_categories 
      WHERE tenant_id = ? AND is_active = 1
      ORDER BY sort_order ASC, name ASC
    `)
    
    const categories = stmt.all(tenantId)
    res.json({ success: true, data: categories })
  } catch (error) {
    console.error('Error fetching POS categories:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch categories' })
  }
})

// Create category
router.post('/categories', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { name, color, icon, sort_order } = req.body
    
    if (!name) {
      return res.status(400).json({ success: false, message: 'Name is required' })
    }
    
    const id = generateId()
    const stmt = db.prepare(`
      INSERT INTO pos_categories (id, tenant_id, name, color, icon, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    
    stmt.run(id, tenantId, name, color || '#00f0ff', icon || null, sort_order || 0)
    
    res.json({ 
      success: true, 
      message: 'Category created successfully',
      data: { id, name, color, icon, sort_order }
    })
  } catch (error) {
    console.error('Error creating POS category:', error)
    res.status(500).json({ success: false, message: 'Failed to create category' })
  }
})

// Update category
router.put('/categories/:id', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { id } = req.params
    const { name, color, icon, sort_order, is_active } = req.body
    
    const stmt = db.prepare(`
      UPDATE pos_categories 
      SET name = ?, color = ?, icon = ?, sort_order = ?, is_active = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `)
    
    stmt.run(name, color, icon, sort_order, is_active, now(), id, tenantId)
    
    res.json({ success: true, message: 'Category updated successfully' })
  } catch (error) {
    console.error('Error updating POS category:', error)
    res.status(500).json({ success: false, message: 'Failed to update category' })
  }
})

// Delete category
router.delete('/categories/:id', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { id } = req.params
    
    // Soft delete
    const stmt = db.prepare(`
      UPDATE pos_categories 
      SET is_active = 0, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `)
    
    stmt.run(now(), id, tenantId)
    
    res.json({ success: true, message: 'Category deleted successfully' })
  } catch (error) {
    console.error('Error deleting POS category:', error)
    res.status(500).json({ success: false, message: 'Failed to delete category' })
  }
})

// ==================== POS MENU CONFIGS ====================

// Get all menu configs (with product details)
router.get('/menu-configs', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { category_id, is_available } = req.query
    
    let query = `
      SELECT
        pmc.*,
        p.name as product_name,
        p.sku as product_code,
        p.category as product_category,
        pc.name as category_name,
        pc.color as category_color,
        b.version as bom_version,
        b.status as bom_status
      FROM pos_menu_configs pmc
      LEFT JOIN stock_items p ON pmc.product_id = p.id
      LEFT JOIN pos_categories pc ON pmc.category_id = pc.id
      LEFT JOIN boms b ON pmc.bom_id = b.id
      WHERE pmc.tenant_id = ? AND pmc.is_pos_enabled = 1
    `
    
    const params: any[] = [tenantId]
    
    if (category_id) {
      query += ' AND pmc.category_id = ?'
      params.push(category_id)
    }
    
    if (is_available !== undefined) {
      query += ' AND pmc.is_available = ?'
      params.push(is_available === 'true' ? 1 : 0)
    }
    
    query += ' ORDER BY pc.sort_order ASC, pmc.display_order ASC, p.name ASC'
    
    const stmt = db.prepare(query)
    const menus = stmt.all(...params)
    
    res.json({ success: true, data: menus })
  } catch (error) {
    console.error('Error fetching POS menu configs:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch menu configs' })
  }
})

// Get single menu config with ingredients
router.get('/menu-configs/:id', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { id } = req.params
    
    // Get menu config
    const menuStmt = db.prepare(`
      SELECT
        pmc.*,
        p.name as product_name,
        p.sku as product_code,
        pc.name as category_name,
        b.version as bom_version,
        b.status as bom_status
      FROM pos_menu_configs pmc
      LEFT JOIN stock_items p ON pmc.product_id = p.id
      LEFT JOIN pos_categories pc ON pmc.category_id = pc.id
      LEFT JOIN boms b ON pmc.bom_id = b.id
      WHERE pmc.id = ? AND pmc.tenant_id = ?
    `)
    
    const menu = menuStmt.get(id, tenantId)
    
    if (!menu) {
      return res.status(404).json({ success: false, message: 'Menu config not found' })
    }
    
    // Get ingredients - ใช้ BOM items ถ้ามี bom_id ไม่งันใช้ pos_menu_ingredients
    let ingredients: any[] = []
    
    if (menu.bom_id) {
      // ดึงวัตถุดิบจาก BOM
      const ingStmt = db.prepare(`
        SELECT 
          bi.id as ingredient_id,
          bi.material_id as stock_item_id,
          bi.quantity as quantity_used,
          si.name as stock_item_name,
          si.unit as stock_item_unit,
          si.quantity as current_stock,
          0 as is_optional
        FROM bom_items bi
        LEFT JOIN stock_items si ON bi.material_id = si.id
        WHERE bi.bom_id = ? AND bi.tenant_id = ? AND bi.item_type = 'MATERIAL'
      `)
      ingredients = ingStmt.all(menu.bom_id, tenantId)
    } else {
      // ใช้ pos_menu_ingredients (แบบเก่า) ถ้าไม่มี BOM
      const ingStmt = db.prepare(`
        SELECT 
          pmi.*,
          si.name as stock_item_name,
          si.unit as stock_item_unit,
          si.quantity as current_stock
        FROM pos_menu_ingredients pmi
        LEFT JOIN stock_items si ON pmi.stock_item_id = si.id
        WHERE pmi.pos_menu_id = ? AND pmi.tenant_id = ?
      `)
      ingredients = ingStmt.all(id, tenantId)
    }
    
    res.json({ 
      success: true, 
      data: { ...menu, ingredients }
    })
  } catch (error) {
    console.error('Error fetching POS menu config:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch menu config' })
  }
})

// Create menu config
router.post('/menu-configs', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const {
      product_id,
      bom_id,
      category_id,
      pos_price,
      cost_price,
      is_available,
      display_order,
      quick_code,
      image_url,
      preparation_time,
      description
    } = req.body
    
    if (!product_id || !pos_price) {
      return res.status(400).json({ 
        success: false, 
        message: 'Product ID and POS price are required' 
      })
    }
    
    // Check if product already exists in POS
    const checkStmt = db.prepare(`
      SELECT id FROM pos_menu_configs 
      WHERE product_id = ? AND tenant_id = ?
    `)
    const existing = checkStmt.get(product_id, tenantId)
    
    if (existing) {
      return res.status(400).json({ 
        success: false, 
        message: 'Product already exists in POS menu' 
      })
    }
    
    const id = generateId()
    const { sale_unit } = req.body
    const stmt = db.prepare(`
      INSERT INTO pos_menu_configs (
        id, tenant_id, product_id, bom_id, category_id, pos_price, cost_price,
        is_available, is_pos_enabled, display_order, quick_code, 
        image_url, preparation_time, description, sale_unit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    
    stmt.run(
      id, tenantId, product_id, bom_id || null, category_id || null, pos_price, cost_price || 0,
      is_available !== undefined ? is_available : 1, 
      1, // is_pos_enabled
      display_order || 0, 
      quick_code || null, 
      image_url || null, 
      preparation_time || 10,
      description || null,
      sale_unit || null
    )
    
    res.json({ 
      success: true, 
      message: 'Menu config created successfully',
      data: { id }
    })
  } catch (error) {
    console.error('Error creating POS menu config:', error)
    res.status(500).json({ success: false, message: 'Failed to create menu config' })
  }
})

// Update menu config
router.put('/menu-configs/:id', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { id } = req.params
    const allowed = ['bom_id', 'category_id', 'pos_price', 'cost_price', 'is_available',
      'is_pos_enabled', 'display_order', 'quick_code', 'image_url', 'preparation_time', 'description', 'sale_unit']

    const fields: string[] = []
    const values: any[] = []
    for (const key of allowed) {
      if (key in req.body) {
        fields.push(`${key} = ?`)
        values.push(req.body[key] ?? null)
      }
    }
    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' })
    }
    fields.push('updated_at = ?')
    values.push(now(), id, tenantId)

    db.prepare(`UPDATE pos_menu_configs SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`)
      .run(...values)

    res.json({ success: true, message: 'Menu config updated successfully' })
  } catch (error) {
    console.error('Error updating POS menu config:', error)
    res.status(500).json({ success: false, message: 'Failed to update menu config' })
  }
})

// Toggle menu availability
router.patch('/menu-configs/:id/toggle', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { id } = req.params
    const { is_available } = req.body
    
    const stmt = db.prepare(`
      UPDATE pos_menu_configs 
      SET is_available = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `)
    
    stmt.run(is_available ? 1 : 0, now(), id, tenantId)
    
    res.json({ 
      success: true, 
      message: `Menu ${is_available ? 'enabled' : 'disabled'} successfully` 
    })
  } catch (error) {
    console.error('Error toggling POS menu:', error)
    res.status(500).json({ success: false, message: 'Failed to toggle menu' })
  }
})

// Delete menu config
router.delete('/menu-configs/:id', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { id } = req.params
    
    // Hard delete (or can use soft delete)
    const stmt = db.prepare(`
      DELETE FROM pos_menu_configs 
      WHERE id = ? AND tenant_id = ?
    `)
    
    stmt.run(id, tenantId)
    
    res.json({ success: true, message: 'Menu config deleted successfully' })
  } catch (error) {
    console.error('Error deleting POS menu config:', error)
    res.status(500).json({ success: false, message: 'Failed to delete menu config' })
  }
})

// ==================== POS MENU INGREDIENTS ====================

// Add ingredient to menu
router.post('/menu-configs/:id/ingredients', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { id } = req.params
    const { stock_item_id, quantity_used, unit_id, is_optional } = req.body
    
    if (!stock_item_id || !quantity_used) {
      return res.status(400).json({ 
        success: false, 
        message: 'Stock item ID and quantity are required' 
      })
    }
    
    const ingId = generateId()
    const stmt = db.prepare(`
      INSERT INTO pos_menu_ingredients 
      (id, tenant_id, pos_menu_id, stock_item_id, quantity_used, unit_id, is_optional)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    
    stmt.run(
      ingId, tenantId, id, stock_item_id, quantity_used, 
      unit_id || null, is_optional ? 1 : 0
    )
    
    res.json({ 
      success: true, 
      message: 'Ingredient added successfully',
      data: { id: ingId }
    })
  } catch (error) {
    console.error('Error adding ingredient:', error)
    res.status(500).json({ success: false, message: 'Failed to add ingredient' })
  }
})

// Update ingredient
router.put('/menu-configs/:menuId/ingredients/:ingId', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { ingId } = req.params
    const { quantity_used, unit_id, is_optional } = req.body
    
    const stmt = db.prepare(`
      UPDATE pos_menu_ingredients 
      SET quantity_used = ?, unit_id = ?, is_optional = ?
      WHERE id = ? AND tenant_id = ?
    `)
    
    stmt.run(quantity_used, unit_id || null, is_optional ? 1 : 0, ingId, tenantId)
    
    res.json({ success: true, message: 'Ingredient updated successfully' })
  } catch (error) {
    console.error('Error updating ingredient:', error)
    res.status(500).json({ success: false, message: 'Failed to update ingredient' })
  }
})

// Delete ingredient
router.delete('/menu-configs/:menuId/ingredients/:ingId', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { ingId } = req.params
    
    const stmt = db.prepare(`
      DELETE FROM pos_menu_ingredients 
      WHERE id = ? AND tenant_id = ?
    `)
    
    stmt.run(ingId, tenantId)
    
    res.json({ success: true, message: 'Ingredient removed successfully' })
  } catch (error) {
    console.error('Error removing ingredient:', error)
    res.status(500).json({ success: false, message: 'Failed to remove ingredient' })
  }
})

// ==================== PRODUCTS FOR POS SELECTION ====================

// Get products that can be added to POS
router.get('/available-products', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { search } = req.query
    
    let query = `
      SELECT p.id, p.sku as code, p.name, p.category, NULL as description
      FROM stock_items p
      WHERE p.tenant_id = ?
        AND p.status = 'ACTIVE'
        AND p.id NOT IN (
          SELECT product_id FROM pos_menu_configs
          WHERE tenant_id = ? AND is_pos_enabled = 1
        )
    `
    
    const params: any[] = [tenantId, tenantId]
    
    if (search) {
      query += ' AND (p.name LIKE ? OR p.code LIKE ?)'
      params.push(`%${search}%`, `%${search}%`)
    }
    
    query += ' ORDER BY p.name ASC'
    
    const stmt = db.prepare(query)
    const products = stmt.all(...params)
    
    res.json({ success: true, data: products })
  } catch (error) {
    console.error('Error fetching available products:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch products' })
  }
})

// ==================== STOCK CHECK ====================

// Check stock availability for menu item
router.get('/menu-configs/:id/stock', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { id } = req.params
    const { quantity } = req.query
    const qty = parseInt(quantity as string) || 1
    
    // Get menu with bom_id
    const menuStmt = db.prepare('SELECT bom_id FROM pos_menu_configs WHERE id = ? AND tenant_id = ?')
    const menu = menuStmt.get(id, tenantId) as any
    
    let ingredients: any[] = []
    
    if (menu?.bom_id) {
      // ดึงจาก BOM
      const stmt = db.prepare(`
        SELECT 
          bi.id,
          bi.quantity as quantity_used,
          0 as is_optional,
          si.id as stock_item_id,
          si.name as stock_item_name,
          si.quantity as current_stock,
          si.unit
        FROM bom_items bi
        JOIN stock_items si ON bi.material_id = si.id
        WHERE bi.bom_id = ? AND bi.tenant_id = ? AND bi.item_type = 'MATERIAL'
      `)
      ingredients = stmt.all(menu.bom_id, tenantId)
    } else {
      // ดึงจาก pos_menu_ingredients
      const stmt = db.prepare(`
        SELECT 
          pmi.id,
          pmi.quantity_used,
          pmi.is_optional,
          si.id as stock_item_id,
          si.name as stock_item_name,
          si.quantity as current_stock,
          si.unit
        FROM pos_menu_ingredients pmi
        JOIN stock_items si ON pmi.stock_item_id = si.id
        WHERE pmi.pos_menu_id = ? AND pmi.tenant_id = ?
      `)
      ingredients = stmt.all(id, tenantId)
    }
    
    // Calculate max available quantity
    let maxAvailable = Infinity
    const stockDetails = ingredients.map((ing: any) => {
      const required = ing.quantity_used * qty
      const available = ing.current_stock
      const canMake = Math.floor(available / ing.quantity_used)
      
      if (!ing.is_optional && canMake < maxAvailable) {
        maxAvailable = canMake
      }
      
      return {
        ...ing,
        required,
        available,
        sufficient: available >= required,
        can_make: canMake
      }
    })
    
    if (maxAvailable === Infinity) maxAvailable = 999
    
    res.json({
      success: true,
      data: {
        menu_id: id,
        requested_quantity: qty,
        can_fulfill: maxAvailable >= qty,
        max_available: maxAvailable,
        ingredients: stockDetails
      }
    })
  } catch (error) {
    console.error('Error checking stock:', error)
    res.status(500).json({ success: false, message: 'Failed to check stock' })
  }
})

export default router
