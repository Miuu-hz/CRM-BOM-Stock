import db, { generateId, snakeToCamel } from '../db/database'

export const getAllMaterials = () => {
  const materials = db.prepare('SELECT * FROM materials ORDER BY name ASC').all()
  return snakeToCamel(materials)
}

export const getMaterialById = (id: string) => {
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(id)
  return snakeToCamel(material)
}

export const getMaterialByCode = (code: string) => {
  const material = db.prepare('SELECT * FROM materials WHERE code = ?').get(code)
  return snakeToCamel(material)
}

export const getMaterialsWithStock = () => {
  const materials = db.prepare(`
    SELECT m.*,
      s.id as stock_item_id,
      s.quantity as current_stock,
      s.status as stock_status
    FROM materials m
    LEFT JOIN stock_items s ON m.id = s.material_id
    ORDER BY m.name ASC
  `).all()

  return materials.map((m: any) => {
    const material = snakeToCamel(m)
    // Determine stock status
    let stockStatus = 'NO_STOCK'
    if (material.currentStock !== null) {
      if (material.currentStock <= material.minStock * 0.3) {
        stockStatus = 'CRITICAL'
      } else if (material.currentStock <= material.minStock) {
        stockStatus = 'LOW'
      } else if (material.currentStock >= material.maxStock) {
        stockStatus = 'OVERSTOCK'
      } else {
        stockStatus = 'ADEQUATE'
      }
    }
    return { ...material, stockStatus }
  })
}

export const getMaterialWithDetails = (id: string) => {
  const material = getMaterialById(id)
  if (!material) return null

  const stockItems = db.prepare(`
    SELECT * FROM stock_items WHERE material_id = ?
  `).all(id)

  const bomUsage = db.prepare(`
    SELECT bi.*, b.version, b.status as bom_status, p.name as product_name, p.code as product_code
    FROM bom_items bi
    JOIN boms b ON bi.bom_id = b.id
    JOIN products p ON b.product_id = p.id
    WHERE bi.material_id = ?
  `).all(id)

  return {
    ...material,
    stockItems: snakeToCamel(stockItems),
    bomUsage: snakeToCamel(bomUsage),
    usedInBOMs: bomUsage.length,
  }
}

export const createMaterial = (data: {
  code: string
  name: string
  unit: string
  unitCost: number
  minStock?: number
  maxStock?: number
}) => {
  const id = generateId()
  db.prepare(`
    INSERT INTO materials (id, code, name, unit, unit_cost, min_stock, max_stock)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.code,
    data.name,
    data.unit,
    data.unitCost,
    data.minStock || 0,
    data.maxStock || 1000
  )

  return getMaterialById(id)
}

export const updateMaterial = (id: string, data: any) => {
  const existing = getMaterialById(id)
  if (!existing) return null

  const fieldMap: Record<string, string> = {
    code: 'code',
    name: 'name',
    unit: 'unit',
    unitCost: 'unit_cost',
    minStock: 'min_stock',
    maxStock: 'max_stock',
  }

  const updates: string[] = []
  const params: any[] = []

  Object.entries(fieldMap).forEach(([camel, snake]) => {
    if (data[camel] !== undefined) {
      updates.push(`${snake} = ?`)
      params.push(data[camel])
    }
  })

  if (updates.length === 0) return existing

  updates.push("updated_at = datetime('now')")
  params.push(id)

  db.prepare(`UPDATE materials SET ${updates.join(', ')} WHERE id = ?`).run(...params)

  // Update related stock items if min/max changed
  if (data.minStock !== undefined || data.maxStock !== undefined) {
    const stockUpdates: string[] = []
    const stockParams: any[] = []
    if (data.minStock !== undefined) {
      stockUpdates.push('min_stock = ?')
      stockParams.push(data.minStock)
    }
    if (data.maxStock !== undefined) {
      stockUpdates.push('max_stock = ?')
      stockParams.push(data.maxStock)
    }
    stockParams.push(id)
    db.prepare(`UPDATE stock_items SET ${stockUpdates.join(', ')} WHERE material_id = ?`).run(...stockParams)
  }

  return getMaterialById(id)
}

export const deleteMaterial = (id: string) => {
  // Check if used in BOMs
  const bomUsage = db.prepare('SELECT COUNT(*) as count FROM bom_items WHERE material_id = ?').get(id)
  if (bomUsage.count > 0) {
    return { success: false, message: `Cannot delete: Material is used in ${bomUsage.count} BOM(s)` }
  }

  // Delete related stock items
  db.prepare('DELETE FROM stock_items WHERE material_id = ?').run(id)

  // Delete material
  const result = db.prepare('DELETE FROM materials WHERE id = ?').run(id)
  return { success: result.changes > 0 }
}

export const countMaterials = () => {
  return db.prepare('SELECT COUNT(*) as count FROM materials').get().count
}
