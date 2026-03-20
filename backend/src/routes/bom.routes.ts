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

// ============================================
// NESTED BOM - Helper Functions
// ============================================

/**
 * คำนวณต้นทุน BOM แบบ Recursive (รวมต้นทุนลูกทั้งหมด)
 */
function calculateBOMCost(bomId: string, tenantId: string, visited: Set<string> = new Set()): number {
  // Prevent circular reference
  if (visited.has(bomId)) return 0
  visited.add(bomId)

  const items = db.prepare(`
    SELECT bi.*,
           COALESCE(m.unit_cost, 0) as unit_cost,
           m.name as material_name,
           m.unit as material_unit,
           child_bom.product_id as child_product_id
    FROM bom_items bi
    LEFT JOIN stock_items m ON bi.material_id = m.id
    LEFT JOIN boms child_bom ON bi.child_bom_id = child_bom.id
    WHERE bi.bom_id = ? AND bi.tenant_id = ?
  `).all(bomId, tenantId) as any[]

  let totalCost = 0

  for (const item of items) {
    if (item.item_type === 'CHILD_BOM' && item.child_bom_id) {
      // Recursive: คำนวณต้นทุนของ BOM ลูก
      const childCost = calculateBOMCost(item.child_bom_id, tenantId, visited)
      totalCost += childCost * Number(item.quantity)
    } else {
      // Raw Material
      totalCost += Number(item.quantity) * Number(item.unit_cost || 0)
    }
  }

  return totalCost
}

/**
 * ดึง BOM Tree แบบ Recursive
 */
function getBOMTree(bomId: string, tenantId: string, level: number = 0, visited: Set<string> = new Set()): any {
  if (visited.has(bomId)) return null // Prevent infinite loop
  visited.add(bomId)

  const bom = db.prepare(`
    SELECT b.*, p.name as product_name, p.sku as product_code, p.category as product_category
    FROM boms b
    LEFT JOIN stock_items p ON b.product_id = p.id
    WHERE b.id = ? AND b.tenant_id = ?
  `).get(bomId, tenantId) as any

  if (!bom) return null

  // Get items with both material and child BOM info
  const items = db.prepare(`
    SELECT
      bi.*,
      m.name as material_name,
      m.sku as material_code,
      m.unit_cost,
      m.unit,
      child_bom.id as child_bom_id_ref,
      child_bom.version as child_bom_version,
      child_p.name as child_bom_product_name,
      child_p.sku as child_bom_product_code
    FROM bom_items bi
    LEFT JOIN stock_items m ON bi.material_id = m.id
    LEFT JOIN boms child_bom ON bi.child_bom_id = child_bom.id
    LEFT JOIN stock_items child_p ON child_bom.product_id = child_p.id
    WHERE bi.bom_id = ? AND bi.tenant_id = ?
    ORDER BY bi.sort_order
  `).all(bomId, tenantId) as any[]

  const processedItems = items.map(item => {
    if (item.item_type === 'CHILD_BOM' && item.child_bom_id) {
      // Recursively get child BOM tree
      const childTree = getBOMTree(item.child_bom_id, tenantId, level + 1, new Set(visited))
      return {
        ...item,
        childBOM: childTree,
        isExpanded: false
      }
    }
    return item
  })

  const totalCost = calculateBOMCost(bomId, tenantId)

  return {
    ...bom,
    level,
    items: processedItems,
    totalCost,
    itemCount: items.length
  }
}

/**
 * ดึงรายการ BOM ที่เป็นไปได้สำหรับเป็น Child BOM (Semi-finished)
 * กรองออก BOM ปัจจุบันและลูกหลานของมัน (prevent circular)
 */
function getAvailableChildBOMs(currentBomId: string | null, tenantId: string): any[] {
  let excludeIds: string[] = []
  
  if (currentBomId) {
    // หา BOM ที่เป็นลูกหลานของ currentBomId เพื่อป้องกัน circular reference
    const findDescendants = (bomId: string): string[] => {
      const children = db.prepare(`
        SELECT DISTINCT child_bom_id as id 
        FROM bom_items 
        WHERE bom_id = ? AND item_type = 'CHILD_BOM' AND child_bom_id IS NOT NULL
      `).all(bomId) as any[]
      
      let ids = [bomId]
      for (const child of children) {
        if (child.id) {
          ids = [...ids, ...findDescendants(child.id)]
        }
      }
      return ids
    }
    excludeIds = findDescendants(currentBomId)
  }

  let query = `
    SELECT b.*, p.name as product_name, p.sku as product_code
    FROM boms b
    LEFT JOIN stock_items p ON b.product_id = p.id
    WHERE b.tenant_id = ? AND b.is_semi_finished = 1
  `
  
  if (excludeIds.length > 0) {
    const placeholders = excludeIds.map(() => '?').join(',')
    query += ` AND b.id NOT IN (${placeholders})`
  }
  
  query += ` ORDER BY p.name`

  return db.prepare(query).all(tenantId, ...excludeIds) as any[]
}

// ============================================
// API Routes
// ============================================

// Get BOM statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const totalBOMs = (db.prepare('SELECT COUNT(*) as count FROM boms WHERE tenant_id = ?').get(tenantId) as any).count
    const activeBOMs = (db.prepare("SELECT COUNT(*) as count FROM boms WHERE tenant_id = ? AND status = 'ACTIVE'").get(tenantId) as any).count
    const semiFinishedBOMs = (db.prepare("SELECT COUNT(*) as count FROM boms WHERE tenant_id = ? AND is_semi_finished = 1").get(tenantId) as any).count
    const totalMaterials = (db.prepare("SELECT COUNT(*) as count FROM stock_items WHERE tenant_id = ? AND category IN ('raw', 'material')").get(tenantId) as any).count

    // Calculate average cost per unit (top-level BOMs only)
    const topLevelBOMs = db.prepare(`
      SELECT b.id 
      FROM boms b
      WHERE b.tenant_id = ? AND (b.parent_id IS NULL OR b.level = 0)
    `).all(tenantId) as any[]

    let totalCost = 0
    for (const bom of topLevelBOMs) {
      totalCost += calculateBOMCost(bom.id, tenantId)
    }
    const avgCostPerUnit = topLevelBOMs.length > 0 ? Math.round(totalCost / topLevelBOMs.length) : 0

    res.json({
      success: true,
      data: {
        totalBOMs,
        activeBOMs,
        semiFinishedBOMs,
        totalMaterials,
        avgCostPerUnit,
      },
    })
  } catch (error) {
    console.error('Get BOM stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch BOM stats' })
  }
})

// Get all BOMs (flat list)
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const boms = db.prepare(`
      SELECT b.*, p.name as product_name, p.sku as product_code,
             parent_bom.version as parent_version,
             parent_p.name as parent_product_name
      FROM boms b
      LEFT JOIN stock_items p ON b.product_id = p.id
      LEFT JOIN boms parent_bom ON b.parent_id = parent_bom.id
      LEFT JOIN stock_items parent_p ON parent_bom.product_id = parent_p.id
      WHERE b.tenant_id = ?
      ORDER BY b.level, b.updated_at DESC
    `).all(tenantId) as any[]

    // Calculate cost for each BOM
    const bomsWithCost = boms.map((bom) => {
      const totalCost = calculateBOMCost(bom.id, tenantId)
      return {
        ...bom,
        totalCost,
        isTopLevel: !bom.parent_id && bom.level === 0
      }
    })

    res.json({
      success: true,
      data: bomsWithCost,
    })
  } catch (error) {
    console.error('Get BOMs error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch BOMs' })
  }
})

// Get BOM Tree (nested structure)
router.get('/tree/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const tree = getBOMTree(req.params.id, tenantId)

    if (!tree) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found',
      })
    }

    res.json({
      success: true,
      data: tree,
    })
  } catch (error) {
    console.error('Get BOM tree error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch BOM tree' })
  }
})

// Get available child BOMs (for dropdown) - MUST BE BEFORE /:id
router.get('/available-children/:id?', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const currentBomId = req.params.id || null
    
    const availableBOMs = getAvailableChildBOMs(currentBomId, tenantId)

    res.json({
      success: true,
      data: availableBOMs,
    })
  } catch (error) {
    console.error('Get available child BOMs error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch available child BOMs' })
  }
})

// Get BOM by ID (flat structure) - MUST BE AFTER specific routes
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const bom = db.prepare(`
      SELECT b.*, p.name as product_name, p.sku as product_code,
             parent_bom.version as parent_version,
             parent_p.name as parent_product_name
      FROM boms b
      LEFT JOIN stock_items p ON b.product_id = p.id
      LEFT JOIN boms parent_bom ON b.parent_id = parent_bom.id
      LEFT JOIN stock_items parent_p ON parent_bom.product_id = parent_p.id
      WHERE b.id = ? AND b.tenant_id = ?
    `).get(req.params.id, tenantId) as any

    if (!bom) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found',
      })
    }

    // Get items with both material and child BOM info
    const items = db.prepare(`
      SELECT
        bi.*,
        m.name as material_name,
        m.sku as material_code,
        m.unit_cost,
        m.unit,
        child_bom.version as child_bom_version,
        child_p.name as child_bom_product_name,
        child_p.sku as child_bom_product_code
      FROM bom_items bi
      LEFT JOIN stock_items m ON bi.material_id = m.id
      LEFT JOIN boms child_bom ON bi.child_bom_id = child_bom.id
      LEFT JOIN stock_items child_p ON child_bom.product_id = child_p.id
      WHERE bi.bom_id = ? AND bi.tenant_id = ?
      ORDER BY bi.sort_order
    `).all(req.params.id, tenantId) as any[]

    const totalCost = calculateBOMCost(bom.id, tenantId)

    // Get available child BOMs for dropdown
    const availableChildBOMs = getAvailableChildBOMs(req.params.id, tenantId)

    res.json({
      success: true,
      data: {
        ...bom,
        items,
        totalCost,
        availableChildBOMs,
      },
    })
  } catch (error) {
    console.error('Get BOM error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch BOM' })
  }
})

// Create BOM
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { 
      productId, 
      version, 
      status = 'DRAFT', 
      parentId = null,
      isSemiFinished = false,
      items 
    } = req.body

    if (!productId || !version) {
      return res.status(400).json({
        success: false,
        message: 'Product ID and version are required',
      })
    }

    // Check if product exists
    const product = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(productId, tenantId) as any
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found in stock',
      })
    }

    // Check for duplicate version
    const existingBOM = db.prepare('SELECT * FROM boms WHERE product_id = ? AND version = ? AND tenant_id = ?').get(productId, version, tenantId) as any
    if (existingBOM) {
      return res.status(400).json({
        success: false,
        message: 'BOM with this version already exists for this product',
      })
    }

    // Calculate level if has parent
    let level = 0
    if (parentId) {
      const parentBOM = db.prepare('SELECT level FROM boms WHERE id = ? AND tenant_id = ?').get(parentId, tenantId) as any
      if (parentBOM) {
        level = (parentBOM.level || 0) + 1
      }
    }

    const id = generateId()
    const now = new Date().toISOString()

    const insertBOM = db.transaction(() => {
      // Insert BOM
      db.prepare(`
        INSERT INTO boms (id, tenant_id, product_id, parent_id, version, status, level, is_semi_finished, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tenantId, productId, parentId, version, status, level, isSemiFinished ? 1 : 0, now, now)

      // Insert items
      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO bom_items (id, tenant_id, bom_id, item_type, material_id, child_bom_id, quantity, notes, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          
          if (item.itemType === 'CHILD_BOM' && item.childBomId) {
            // Validate child BOM exists and not circular
            const childBOM = db.prepare('SELECT id, level FROM boms WHERE id = ? AND tenant_id = ?').get(item.childBomId, tenantId) as any
            if (!childBOM) {
              throw new Error(`Child BOM ${item.childBomId} not found`)
            }
            if (childBOM.id === id) {
              throw new Error('Cannot reference self as child BOM')
            }
            
            insertItem.run(generateId(), tenantId, id, 'CHILD_BOM', null, item.childBomId, item.quantity, item.notes || '', i)
          } else {
            // Raw Material - check in stock_items table
            const material = db.prepare('SELECT id FROM stock_items WHERE id = ? AND tenant_id = ?').get(item.materialId, tenantId)
            if (!material) {
              throw new Error(`Material ${item.materialId} not found`)
            }
            insertItem.run(generateId(), tenantId, id, 'MATERIAL', item.materialId, null, item.quantity, item.notes || '', i)
          }
        }
      }
    })

    insertBOM()

    const newBom = db.prepare(`
      SELECT b.*, p.name as product_name, p.sku as product_code
      FROM boms b
      LEFT JOIN stock_items p ON b.product_id = p.id
      WHERE b.id = ?
    `).get(id) as any

    const totalCost = calculateBOMCost(id, tenantId)

    res.json({
      success: true,
      message: 'BOM created successfully',
      data: {
        ...newBom,
        totalCost,
      },
    })
  } catch (error: any) {
    console.error('Create BOM error:', error)
    res.status(500).json({ success: false, message: error.message || 'Failed to create BOM' })
  }
})

// Update BOM
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { version, status, isSemiFinished, items } = req.body

    const existingBOM = db.prepare('SELECT * FROM boms WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!existingBOM) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found',
      })
    }

    const now = new Date().toISOString()

    const updateBOM = db.transaction(() => {
      // Update BOM
      db.prepare(`
        UPDATE boms 
        SET version = COALESCE(?, version), 
            status = COALESCE(?, status),
            is_semi_finished = COALESCE(?, is_semi_finished),
            updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(version, status, isSemiFinished !== undefined ? (isSemiFinished ? 1 : 0) : undefined, now, req.params.id, tenantId)

      // Update items if provided
      if (items) {
        db.prepare('DELETE FROM bom_items WHERE bom_id = ? AND tenant_id = ?').run(req.params.id, tenantId)
        
        const insertItem = db.prepare(`
          INSERT INTO bom_items (id, tenant_id, bom_id, item_type, material_id, child_bom_id, quantity, notes, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          
          if (item.itemType === 'CHILD_BOM' && item.childBomId) {
            // Validate child BOM
            const childBOM = db.prepare('SELECT id FROM boms WHERE id = ? AND tenant_id = ?').get(item.childBomId, tenantId) as any
            if (!childBOM) {
              throw new Error(`Child BOM ${item.childBomId} not found`)
            }
            if (childBOM.id === req.params.id) {
              throw new Error('Cannot reference self as child BOM')
            }
            
            insertItem.run(generateId(), tenantId, req.params.id, 'CHILD_BOM', null, item.childBomId, item.quantity, item.notes || '', i)
          } else {
            // Raw Material - check in stock_items table
            const material = db.prepare('SELECT id FROM stock_items WHERE id = ? AND tenant_id = ?').get(item.materialId, tenantId)
            if (!material) {
              throw new Error(`Material ${item.materialId} not found`)
            }
            insertItem.run(generateId(), tenantId, req.params.id, 'MATERIAL', item.materialId, null, item.quantity, item.notes || '', i)
          }
        }
      }
    })

    updateBOM()

    const updatedBom = db.prepare(`
      SELECT b.*, p.name as product_name, p.sku as product_code
      FROM boms b
      LEFT JOIN stock_items p ON b.product_id = p.id
      WHERE b.id = ?
    `).get(req.params.id) as any

    const totalCost = calculateBOMCost(req.params.id, tenantId)

    res.json({
      success: true,
      message: 'BOM updated successfully',
      data: {
        ...updatedBom,
        totalCost,
      },
    })
  } catch (error: any) {
    console.error('Update BOM error:', error)
    res.status(500).json({ success: false, message: error.message || 'Failed to update BOM' })
  }
})

// Delete BOM
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const existingBOM = db.prepare('SELECT * FROM boms WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!existingBOM) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found',
      })
    }

    // Check if this BOM is used as child in other BOMs
    const usedAsChild = db.prepare('SELECT COUNT(*) as count FROM bom_items WHERE child_bom_id = ?').get(req.params.id) as any
    if (usedAsChild.count > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete BOM that is used as a component in other BOMs',
      })
    }

    const deleteBOM = db.transaction(() => {
      db.prepare('DELETE FROM bom_items WHERE bom_id = ? AND tenant_id = ?').run(req.params.id, tenantId)
      db.prepare('DELETE FROM boms WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)
    })

    deleteBOM()

    res.json({
      success: true,
      message: 'BOM deleted successfully',
    })
  } catch (error) {
    console.error('Delete BOM error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete BOM' })
  }
})

// Explode BOM - แยกส่วนประกอบทั้งหมด (flatten)
router.get('/explode/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const bomId = req.params.id
    const multiplier = parseFloat(req.query.multiplier as string) || 1

    const bom = db.prepare('SELECT * FROM boms WHERE id = ? AND tenant_id = ?').get(bomId, tenantId) as any
    if (!bom) {
      return res.status(404).json({ success: false, message: 'BOM not found' })
    }

    // Recursive function to explode BOM
    const explode = (currentBomId: string, qty: number, level: number, visited: Set<string>): any[] => {
      if (visited.has(currentBomId)) return [] // Prevent circular
      visited.add(currentBomId)

      const items = db.prepare(`
        SELECT bi.*, m.name as material_name, m.sku as material_code, m.unit
        FROM bom_items bi
        LEFT JOIN stock_items m ON bi.material_id = m.id
        WHERE bi.bom_id = ? AND bi.tenant_id = ?
      `).all(currentBomId, tenantId) as any[]

      let result: any[] = []

      for (const item of items) {
        const totalQty = item.quantity * qty

        if (item.item_type === 'CHILD_BOM' && item.child_bom_id) {
          // Recursively explode child BOM
          const childItems = explode(item.child_bom_id, totalQty, level + 1, new Set(visited))
          result = [...result, ...childItems]
        } else {
          // Raw material
          result.push({
            materialId: item.material_id,
            materialName: item.material_name,
            materialCode: item.material_code,
            unit: item.unit,
            quantity: totalQty,
            level,
            sourceBomId: currentBomId
          })
        }
      }

      return result
    }

    const exploded = explode(bomId, multiplier, 0, new Set())

    // Group by material
    const grouped = exploded.reduce((acc: any, item: any) => {
      const key = item.materialId
      if (!acc[key]) {
        acc[key] = { ...item, quantity: 0 }
      }
      acc[key].quantity += item.quantity
      return acc
    }, {})

    res.json({
      success: true,
      data: {
        bomId,
        multiplier,
        totalItems: Object.values(grouped).length,
        materials: Object.values(grouped),
        rawList: exploded // รายการก่อนรวม (แสดงที่มา)
      }
    })
  } catch (error) {
    console.error('Explode BOM error:', error)
    res.status(500).json({ success: false, message: 'Failed to explode BOM' })
  }
})

export default router
