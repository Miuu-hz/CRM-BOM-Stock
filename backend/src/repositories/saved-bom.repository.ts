import db, { generateId, snakeToCamel } from '../db/database'

export const getAllSavedBOMs = () => {
  const boms = db.prepare('SELECT * FROM saved_boms ORDER BY updated_at DESC').all()
  return boms.map((bom: any) => ({
    ...snakeToCamel(bom),
    materials: JSON.parse(bom.materials || '[]'),
  }))
}

export const getSavedBOMById = (id: string) => {
  const bom = db.prepare('SELECT * FROM saved_boms WHERE id = ?').get(id)
  if (!bom) return null

  return {
    ...snakeToCamel(bom),
    materials: JSON.parse(bom.materials || '[]'),
  }
}

export const createSavedBOM = (data: {
  name: string
  description?: string
  materials: any[]
  operatingCost?: number
  scrapValue?: number
  totalCost: number
}) => {
  const id = generateId()

  db.prepare(`
    INSERT INTO saved_boms (id, name, description, materials, operating_cost, scrap_value, total_cost)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.description || null,
    JSON.stringify(data.materials),
    data.operatingCost || 0,
    data.scrapValue || 0,
    data.totalCost
  )

  return getSavedBOMById(id)
}

export const updateSavedBOM = (id: string, data: any) => {
  const existing = getSavedBOMById(id)
  if (!existing) return null

  const updates: string[] = []
  const params: any[] = []

  if (data.name !== undefined) {
    updates.push('name = ?')
    params.push(data.name)
  }
  if (data.description !== undefined) {
    updates.push('description = ?')
    params.push(data.description)
  }
  if (data.materials !== undefined) {
    updates.push('materials = ?')
    params.push(JSON.stringify(data.materials))
  }
  if (data.operatingCost !== undefined) {
    updates.push('operating_cost = ?')
    params.push(data.operatingCost)
  }
  if (data.scrapValue !== undefined) {
    updates.push('scrap_value = ?')
    params.push(data.scrapValue)
  }
  if (data.totalCost !== undefined) {
    updates.push('total_cost = ?')
    params.push(data.totalCost)
  }

  if (updates.length === 0) return existing

  updates.push("updated_at = datetime('now')")
  params.push(id)

  db.prepare(`UPDATE saved_boms SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  return getSavedBOMById(id)
}

export const deleteSavedBOM = (id: string) => {
  const result = db.prepare('DELETE FROM saved_boms WHERE id = ?').run(id)
  return result.changes > 0
}
