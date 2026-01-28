import db, { generateId, snakeToCamel } from '../db/database'

export const getAllStockItems = () => {
  const items = db.prepare(`
    SELECT s.*,
      p.name as product_name, p.code as product_code,
      m.name as material_name, m.code as material_code, m.unit_cost as material_unit_cost
    FROM stock_items s
    LEFT JOIN products p ON s.product_id = p.id
    LEFT JOIN materials m ON s.material_id = m.id
    ORDER BY s.updated_at DESC
  `).all()

  return items.map((item: any) => {
    const movements = getRecentMovements(item.id, 5)
    return {
      ...snakeToCamel(item),
      product: item.product_id ? {
        id: item.product_id,
        name: item.product_name,
        code: item.product_code,
      } : null,
      material: item.material_id ? {
        id: item.material_id,
        name: item.material_name,
        code: item.material_code,
        unitCost: item.material_unit_cost,
      } : null,
      movements,
    }
  })
}

export const getStockItemById = (id: string) => {
  const item = db.prepare(`
    SELECT s.*,
      p.name as product_name, p.code as product_code,
      m.name as material_name, m.code as material_code, m.unit_cost as material_unit_cost
    FROM stock_items s
    LEFT JOIN products p ON s.product_id = p.id
    LEFT JOIN materials m ON s.material_id = m.id
    WHERE s.id = ?
  `).get(id)

  if (!item) return null

  const movements = getRecentMovements(id, 20)

  return {
    ...snakeToCamel(item),
    product: item.product_id ? {
      id: item.product_id,
      name: item.product_name,
      code: item.product_code,
    } : null,
    material: item.material_id ? {
      id: item.material_id,
      name: item.material_name,
      code: item.material_code,
      unitCost: item.material_unit_cost,
    } : null,
    movements,
  }
}

export const getStockItemBySku = (sku: string) => {
  const item = db.prepare('SELECT * FROM stock_items WHERE sku = ?').get(sku)
  return snakeToCamel(item)
}

export const getStockItemByMaterialId = (materialId: string) => {
  const item = db.prepare('SELECT * FROM stock_items WHERE material_id = ?').get(materialId)
  return snakeToCamel(item)
}

export const getRecentMovements = (stockItemId: string, limit: number = 10) => {
  const movements = db.prepare(`
    SELECT * FROM stock_movements
    WHERE stock_item_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(stockItemId, limit)
  return snakeToCamel(movements)
}

export const createStockItem = (data: {
  sku: string
  name: string
  category: string
  productId?: string
  materialId?: string
  quantity?: number
  unit: string
  minStock?: number
  maxStock?: number
  location?: string
}) => {
  const id = generateId()
  const qty = data.quantity || 0
  const min = data.minStock || 0
  const max = data.maxStock || 1000

  // Determine status
  let status = 'ADEQUATE'
  if (qty <= 0) {
    status = 'NO_STOCK'
  } else if (qty <= min * 0.3) {
    status = 'CRITICAL'
  } else if (qty <= min) {
    status = 'LOW'
  } else if (qty >= max) {
    status = 'OVERSTOCK'
  }

  db.prepare(`
    INSERT INTO stock_items (id, sku, name, category, product_id, material_id, quantity, unit, min_stock, max_stock, location, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.sku,
    data.name,
    data.category,
    data.productId || null,
    data.materialId || null,
    qty,
    data.unit,
    min,
    max,
    data.location || 'WAREHOUSE',
    status
  )

  // Record initial movement if quantity > 0
  if (qty > 0) {
    createMovement({
      stockItemId: id,
      type: 'IN',
      quantity: qty,
      notes: 'Initial stock',
      createdBy: 'system',
    })
  }

  return getStockItemById(id)
}

export const updateStockItem = (id: string, data: any) => {
  const existing = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(id)
  if (!existing) return null

  const fieldMap: Record<string, string> = {
    name: 'name',
    category: 'category',
    minStock: 'min_stock',
    maxStock: 'max_stock',
    location: 'location',
  }

  const updates: string[] = []
  const params: any[] = []

  Object.entries(fieldMap).forEach(([camel, snake]) => {
    if (data[camel] !== undefined) {
      updates.push(`${snake} = ?`)
      params.push(data[camel])
    }
  })

  // Recalculate status
  const min = data.minStock !== undefined ? data.minStock : existing.min_stock
  const max = data.maxStock !== undefined ? data.maxStock : existing.max_stock
  const qty = existing.quantity

  let status = 'ADEQUATE'
  if (qty <= 0) {
    status = 'NO_STOCK'
  } else if (qty <= min * 0.3) {
    status = 'CRITICAL'
  } else if (qty <= min) {
    status = 'LOW'
  } else if (qty >= max) {
    status = 'OVERSTOCK'
  }

  updates.push('status = ?')
  params.push(status)
  updates.push("updated_at = datetime('now')")
  params.push(id)

  db.prepare(`UPDATE stock_items SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  return getStockItemById(id)
}

export const deleteStockItem = (id: string) => {
  // Delete movements first
  db.prepare('DELETE FROM stock_movements WHERE stock_item_id = ?').run(id)
  // Delete stock item
  const result = db.prepare('DELETE FROM stock_items WHERE id = ?').run(id)
  return result.changes > 0
}

export const createMovement = (data: {
  stockItemId: string
  type: string
  quantity: number
  reference?: string
  notes?: string
  createdBy: string
}) => {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_movements (id, stock_item_id, type, quantity, reference, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.stockItemId,
    data.type,
    data.quantity,
    data.reference || null,
    data.notes || null,
    data.createdBy
  )
  return id
}

export const recordMovement = (stockItemId: string, type: string, quantity: number, notes?: string, reference?: string) => {
  const item = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(stockItemId)
  if (!item) return { success: false, message: 'Stock item not found' }

  let newQuantity = item.quantity
  if (type === 'IN') {
    newQuantity += quantity
  } else if (type === 'OUT') {
    newQuantity -= quantity
    if (newQuantity < 0) {
      return { success: false, message: 'Insufficient stock' }
    }
  } else if (type === 'ADJUST') {
    newQuantity = quantity
  }

  // Determine status
  let status = 'ADEQUATE'
  if (newQuantity <= 0) {
    status = 'NO_STOCK'
  } else if (newQuantity <= item.min_stock * 0.3) {
    status = 'CRITICAL'
  } else if (newQuantity <= item.min_stock) {
    status = 'LOW'
  } else if (newQuantity >= item.max_stock) {
    status = 'OVERSTOCK'
  }

  // Update stock item
  db.prepare(`
    UPDATE stock_items SET quantity = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newQuantity, status, stockItemId)

  // Record movement
  createMovement({
    stockItemId,
    type,
    quantity,
    notes,
    reference,
    createdBy: 'system',
  })

  return { success: true, data: getStockItemById(stockItemId) }
}

export const getStockStats = () => {
  const totalItems = db.prepare('SELECT COUNT(*) as count FROM stock_items').get().count

  const items = db.prepare(`
    SELECT s.*, m.unit_cost
    FROM stock_items s
    LEFT JOIN materials m ON s.material_id = m.id
  `).all()

  const lowStockCount = items.filter((i: any) => i.quantity <= i.min_stock && i.quantity > 0).length
  const criticalCount = items.filter((i: any) => i.quantity <= i.min_stock * 0.3).length

  const totalValue = items.reduce((sum: number, item: any) => {
    if (item.unit_cost) {
      return sum + (item.quantity * item.unit_cost)
    }
    return sum
  }, 0)

  return {
    totalItems,
    lowStockCount,
    criticalCount,
    totalValue: Math.round(totalValue),
  }
}
