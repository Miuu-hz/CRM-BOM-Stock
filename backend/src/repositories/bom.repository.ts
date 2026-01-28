import db, { generateId, snakeToCamel } from '../db/database'

export const getAllBOMs = () => {
  const boms = db.prepare(`
    SELECT b.*, p.name as product_name, p.code as product_code, p.category as product_category
    FROM boms b
    JOIN products p ON b.product_id = p.id
    ORDER BY b.updated_at DESC
  `).all()

  return boms.map((bom: any) => {
    const materials = getBOMItems(bom.id)
    const totalCost = materials.reduce((sum: number, m: any) => {
      return sum + (Number(m.quantity) * Number(m.unitCost))
    }, 0)

    return {
      ...snakeToCamel(bom),
      product: {
        id: bom.product_id,
        name: bom.product_name,
        code: bom.product_code,
        category: bom.product_category,
      },
      materials,
      totalCost,
    }
  })
}

export const getBOMById = (id: string) => {
  const bom = db.prepare(`
    SELECT b.*, p.name as product_name, p.code as product_code, p.category as product_category
    FROM boms b
    JOIN products p ON b.product_id = p.id
    WHERE b.id = ?
  `).get(id)

  if (!bom) return null

  const materials = getBOMItems(id)
  const totalCost = materials.reduce((sum: number, m: any) => {
    return sum + (Number(m.quantity) * Number(m.unitCost))
  }, 0)

  return {
    ...snakeToCamel(bom),
    product: {
      id: bom.product_id,
      name: bom.product_name,
      code: bom.product_code,
      category: bom.product_category,
    },
    materials,
    totalCost,
  }
}

export const getBOMItems = (bomId: string) => {
  const items = db.prepare(`
    SELECT bi.*, m.name as material_name, m.code as material_code, m.unit_cost, m.unit as material_unit
    FROM bom_items bi
    JOIN materials m ON bi.material_id = m.id
    WHERE bi.bom_id = ?
  `).all(bomId)

  return items.map((item: any) => ({
    ...snakeToCamel(item),
    material: {
      id: item.material_id,
      name: item.material_name,
      code: item.material_code,
      unitCost: item.unit_cost,
      unit: item.material_unit,
    },
  }))
}

export const getBOMByProductId = (productId: string, status?: string) => {
  let query = `
    SELECT b.*, p.name as product_name, p.code as product_code
    FROM boms b
    JOIN products p ON b.product_id = p.id
    WHERE b.product_id = ?
  `
  const params: any[] = [productId]

  if (status) {
    query += ' AND b.status = ?'
    params.push(status)
  }

  const bom = db.prepare(query).get(...params)
  if (!bom) return null

  const materials = getBOMItems(bom.id)
  const totalCost = materials.reduce((sum: number, m: any) => {
    return sum + (Number(m.quantity) * Number(m.unitCost))
  }, 0)

  return {
    ...snakeToCamel(bom),
    materials,
    totalCost,
  }
}

export const createBOM = (data: {
  productId: string
  version: string
  status?: string
  materials?: Array<{ materialId: string; quantity: number; unit: string }>
}) => {
  const id = generateId()

  db.prepare(`
    INSERT INTO boms (id, product_id, version, status)
    VALUES (?, ?, ?, ?)
  `).run(id, data.productId, data.version, data.status || 'DRAFT')

  // Add materials if provided
  if (data.materials && data.materials.length > 0) {
    const insertItem = db.prepare(`
      INSERT INTO bom_items (id, bom_id, material_id, quantity, unit)
      VALUES (?, ?, ?, ?, ?)
    `)

    const insertMany = db.transaction((materials: any[]) => {
      for (const m of materials) {
        insertItem.run(generateId(), id, m.materialId, m.quantity, m.unit)
      }
    })

    insertMany(data.materials)
  }

  return getBOMById(id)
}

export const updateBOM = (id: string, data: {
  version?: string
  status?: string
  materials?: Array<{ materialId: string; quantity: number; unit: string }>
}) => {
  const existing = getBOMById(id)
  if (!existing) return null

  // Update BOM fields
  const updates: string[] = []
  const params: any[] = []

  if (data.version) {
    updates.push('version = ?')
    params.push(data.version)
  }
  if (data.status) {
    updates.push('status = ?')
    params.push(data.status)
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')")
    params.push(id)
    db.prepare(`UPDATE boms SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  }

  // Update materials if provided
  if (data.materials) {
    // Delete existing items
    db.prepare('DELETE FROM bom_items WHERE bom_id = ?').run(id)

    // Insert new items
    const insertItem = db.prepare(`
      INSERT INTO bom_items (id, bom_id, material_id, quantity, unit)
      VALUES (?, ?, ?, ?, ?)
    `)

    const insertMany = db.transaction((materials: any[]) => {
      for (const m of materials) {
        insertItem.run(generateId(), id, m.materialId, m.quantity, m.unit)
      }
    })

    insertMany(data.materials)
  }

  return getBOMById(id)
}

export const deleteBOM = (id: string) => {
  // Delete BOM items first (CASCADE should handle this, but explicit is safer)
  db.prepare('DELETE FROM bom_items WHERE bom_id = ?').run(id)

  // Delete BOM
  const result = db.prepare('DELETE FROM boms WHERE id = ?').run(id)
  return result.changes > 0
}

export const countBOMs = (status?: string) => {
  if (status) {
    return db.prepare('SELECT COUNT(*) as count FROM boms WHERE status = ?').get(status).count
  }
  return db.prepare('SELECT COUNT(*) as count FROM boms').get().count
}

export const getBOMStats = () => {
  const totalBOMs = countBOMs()
  const activeBOMs = countBOMs('ACTIVE')
  const totalMaterials = db.prepare('SELECT COUNT(*) as count FROM materials').get().count

  // Calculate average cost
  const allBOMs = getAllBOMs()
  const totalCost = allBOMs.reduce((sum: number, bom: any) => sum + (bom.totalCost || 0), 0)
  const avgCostPerUnit = allBOMs.length > 0 ? Math.round(totalCost / allBOMs.length) : 0

  return {
    totalBOMs,
    activeBOMs,
    totalMaterials,
    avgCostPerUnit,
  }
}
