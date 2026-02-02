import { Router, Request, Response } from 'express'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

const router = Router()

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

// Get BOM statistics
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const totalBOMs = (db.prepare('SELECT COUNT(*) as count FROM boms').get() as any).count
    const activeBOMs = (db.prepare("SELECT COUNT(*) as count FROM boms WHERE status = 'ACTIVE'").get() as any).count
    const totalMaterials = (db.prepare('SELECT COUNT(*) as count FROM materials').get() as any).count

    // Calculate average cost per unit
    const boms = db.prepare(`
      SELECT b.*, p.name as product_name, p.code as product_code
      FROM boms b
      LEFT JOIN products p ON b.product_id = p.id
    `).all() as any[]

    const bomItems = db.prepare(`
      SELECT bi.*, m.unit_cost
      FROM bom_items bi
      LEFT JOIN materials m ON bi.material_id = m.id
    `).all() as any[]

    let totalCost = 0
    for (const bom of boms) {
      const items = bomItems.filter((item) => item.bom_id === bom.id)
      for (const item of items) {
        totalCost += Number(item.quantity) * Number(item.unit_cost || 0)
      }
    }
    const avgCostPerUnit = boms.length > 0 ? Math.round(totalCost / boms.length) : 0

    res.json({
      success: true,
      data: {
        totalBOMs,
        activeBOMs,
        totalMaterials,
        avgCostPerUnit,
      },
    })
  } catch (error) {
    console.error('Get BOM stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch BOM stats' })
  }
})

// Get all BOMs
router.get('/', async (_req: Request, res: Response) => {
  try {
    const boms = db.prepare(`
      SELECT b.*, p.name as product_name, p.code as product_code
      FROM boms b
      LEFT JOIN products p ON b.product_id = p.id
      ORDER BY b.updated_at DESC
    `).all() as any[]

    const bomItems = db.prepare(`
      SELECT bi.*, m.name as material_name, m.code as material_code, m.unit_cost, m.unit
      FROM bom_items bi
      LEFT JOIN materials m ON bi.material_id = m.id
    `).all() as any[]

    // Calculate total cost for each BOM
    const bomsWithCost = boms.map((bom) => {
      const items = bomItems.filter((item) => item.bom_id === bom.id)
      const totalCost = items.reduce((sum: number, item: any) => {
        return sum + Number(item.quantity) * Number(item.unit_cost || 0)
      }, 0)

      return {
        ...bom,
        materials: items,
        totalCost,
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

// Get BOM by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const bom = db.prepare(`
      SELECT b.*, p.name as product_name, p.code as product_code
      FROM boms b
      LEFT JOIN products p ON b.product_id = p.id
      WHERE b.id = ?
    `).get(req.params.id) as any

    if (!bom) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found',
      })
    }

    const items = db.prepare(`
      SELECT bi.*, m.name as material_name, m.code as material_code, m.unit_cost, m.unit
      FROM bom_items bi
      LEFT JOIN materials m ON bi.material_id = m.id
      WHERE bi.bom_id = ?
    `).all(req.params.id) as any[]

    const totalCost = items.reduce((sum: number, item: any) => {
      return sum + Number(item.quantity) * Number(item.unit_cost || 0)
    }, 0)

    res.json({
      success: true,
      data: {
        ...bom,
        materials: items,
        totalCost,
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
    const { productId, version, status = 'DRAFT', materials } = req.body

    if (!productId || !version) {
      return res.status(400).json({
        success: false,
        message: 'Product ID and version are required',
      })
    }

    // Check if product exists
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as any
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      })
    }

    // Check for duplicate version
    const existingBOM = db.prepare('SELECT * FROM boms WHERE product_id = ? AND version = ?').get(productId, version) as any
    if (existingBOM) {
      return res.status(400).json({
        success: false,
        message: 'BOM with this version already exists for this product',
      })
    }

    const id = generateId()
    const now = new Date().toISOString()

    const insertBOM = db.transaction(() => {
      db.prepare(`
        INSERT INTO boms (id, product_id, version, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, productId, version, status, now, now)

      if (materials && materials.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO bom_items (id, bom_id, material_id, quantity, unit)
          VALUES (?, ?, ?, ?, ?)
        `)
        for (const m of materials) {
          insertItem.run(generateId(), id, m.materialId, m.quantity, m.unit)
        }
      }
    })

    insertBOM()

    const newBom = db.prepare(`
      SELECT b.*, p.name as product_name, p.code as product_code
      FROM boms b
      LEFT JOIN products p ON b.product_id = p.id
      WHERE b.id = ?
    `).get(id) as any

    const items = db.prepare(`
      SELECT bi.*, m.name as material_name, m.code as material_code, m.unit_cost, m.unit
      FROM bom_items bi
      LEFT JOIN materials m ON bi.material_id = m.id
      WHERE bi.bom_id = ?
    `).all(id) as any[]

    const totalCost = items.reduce((sum: number, item: any) => {
      return sum + Number(item.quantity) * Number(item.unit_cost || 0)
    }, 0)

    res.json({
      success: true,
      message: 'BOM created successfully',
      data: {
        ...newBom,
        materials: items,
        totalCost,
      },
    })
  } catch (error) {
    console.error('Create BOM error:', error)
    res.status(500).json({ success: false, message: 'Failed to create BOM' })
  }
})

// Update BOM
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { version, status, materials } = req.body

    const existingBOM = db.prepare('SELECT * FROM boms WHERE id = ?').get(req.params.id) as any
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
        UPDATE boms SET version = COALESCE(?, version), status = COALESCE(?, status), updated_at = ?
        WHERE id = ?
      `).run(version, status, now, req.params.id)

      // If materials are being updated, delete existing and create new
      if (materials) {
        db.prepare('DELETE FROM bom_items WHERE bom_id = ?').run(req.params.id)
        const insertItem = db.prepare(`
          INSERT INTO bom_items (id, bom_id, material_id, quantity, unit)
          VALUES (?, ?, ?, ?, ?)
        `)
        for (const m of materials) {
          insertItem.run(generateId(), req.params.id, m.materialId, m.quantity, m.unit)
        }
      }
    })

    updateBOM()

    const updatedBom = db.prepare(`
      SELECT b.*, p.name as product_name, p.code as product_code
      FROM boms b
      LEFT JOIN products p ON b.product_id = p.id
      WHERE b.id = ?
    `).get(req.params.id) as any

    const items = db.prepare(`
      SELECT bi.*, m.name as material_name, m.code as material_code, m.unit_cost, m.unit
      FROM bom_items bi
      LEFT JOIN materials m ON bi.material_id = m.id
      WHERE bi.bom_id = ?
    `).all(req.params.id) as any[]

    const totalCost = items.reduce((sum: number, item: any) => {
      return sum + Number(item.quantity) * Number(item.unit_cost || 0)
    }, 0)

    res.json({
      success: true,
      message: 'BOM updated successfully',
      data: {
        ...updatedBom,
        materials: items,
        totalCost,
      },
    })
  } catch (error) {
    console.error('Update BOM error:', error)
    res.status(500).json({ success: false, message: 'Failed to update BOM' })
  }
})

// Delete BOM
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const existingBOM = db.prepare('SELECT * FROM boms WHERE id = ?').get(req.params.id) as any
    if (!existingBOM) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found',
      })
    }

    const deleteBOM = db.transaction(() => {
      db.prepare('DELETE FROM bom_items WHERE bom_id = ?').run(req.params.id)
      db.prepare('DELETE FROM boms WHERE id = ?').run(req.params.id)
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

export default router
