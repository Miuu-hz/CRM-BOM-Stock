import db, { generateId, snakeToCamel } from '../db/database'

export const getAllProducts = () => {
  const products = db.prepare('SELECT * FROM products ORDER BY name ASC').all()
  return snakeToCamel(products)
}

export const getProductById = (id: string) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id)
  return snakeToCamel(product)
}

export const getProductByCode = (code: string) => {
  const product = db.prepare('SELECT * FROM products WHERE code = ?').get(code)
  return snakeToCamel(product)
}

export const createProduct = (data: {
  code: string
  name: string
  category: string
  description?: string
  status?: string
}) => {
  const id = generateId()
  db.prepare(`
    INSERT INTO products (id, code, name, category, description, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, data.code, data.name, data.category, data.description || null, data.status || 'ACTIVE')

  return getProductById(id)
}

export const updateProduct = (id: string, data: any) => {
  const existing = getProductById(id)
  if (!existing) return null

  const fields = ['code', 'name', 'category', 'description', 'status']
  const updates: string[] = []
  const params: any[] = []

  fields.forEach((field) => {
    if (data[field] !== undefined) {
      updates.push(`${field} = ?`)
      params.push(data[field])
    }
  })

  if (updates.length === 0) return existing

  updates.push("updated_at = datetime('now')")
  params.push(id)

  db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  return getProductById(id)
}

export const deleteProduct = (id: string) => {
  const result = db.prepare('DELETE FROM products WHERE id = ?').run(id)
  return result.changes > 0
}

export const countProducts = () => {
  return db.prepare('SELECT COUNT(*) as count FROM products').get().count
}
