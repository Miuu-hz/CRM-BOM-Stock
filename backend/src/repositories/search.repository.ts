import db from '../db/database'

export interface SearchResult {
  id: string
  type: 'customer' | 'order' | 'product' | 'material' | 'bom' | 'stock'
  label: string
  title: string
  subtitle: string
  navigateTo: string
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  total: number
}

export const globalSearch = (query: string): SearchResponse => {
  const q = `%${query}%`
  const results: SearchResult[] = []

  // 1. Customers
  const customers = db.prepare(`
    SELECT id, code, name, contact_name, email, phone
    FROM customers
    WHERE code LIKE ? OR name LIKE ? OR contact_name LIKE ? OR email LIKE ? OR phone LIKE ?
    LIMIT 5
  `).all(q, q, q, q, q) as any[]
  for (const c of customers) {
    results.push({
      id: c.id,
      type: 'customer',
      label: 'ลูกค้า',
      title: c.name,
      subtitle: `${c.code} | ${c.contact_name}`,
      navigateTo: '/crm',
    })
  }

  // 2. Orders
  const orders = db.prepare(`
    SELECT o.id, o.order_number, o.status, c.name as customer_name
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    WHERE o.order_number LIKE ? OR o.notes LIKE ?
    LIMIT 5
  `).all(q, q) as any[]
  for (const o of orders) {
    results.push({
      id: o.id,
      type: 'order',
      label: 'คำสั่งซื้อ',
      title: o.order_number,
      subtitle: `${o.customer_name || '-'} | ${o.status}`,
      navigateTo: '/crm',
    })
  }

  // 3. Products
  const products = db.prepare(`
    SELECT id, code, name, category
    FROM products
    WHERE code LIKE ? OR name LIKE ? OR category LIKE ?
    LIMIT 5
  `).all(q, q, q) as any[]
  for (const p of products) {
    results.push({
      id: p.id,
      type: 'product',
      label: 'สินค้า',
      title: p.name,
      subtitle: `${p.code} | ${p.category}`,
      navigateTo: '/bom',
    })
  }

  // 4. Materials
  const materials = db.prepare(`
    SELECT id, code, name, unit
    FROM materials
    WHERE code LIKE ? OR name LIKE ?
    LIMIT 5
  `).all(q, q) as any[]
  for (const m of materials) {
    results.push({
      id: m.id,
      type: 'material',
      label: 'วัตถุดิบ',
      title: m.name,
      subtitle: `${m.code} | ${m.unit}`,
      navigateTo: '/bom',
    })
  }

  // 5. BOMs
  const boms = db.prepare(`
    SELECT b.id, b.version, b.status, p.name as product_name, p.code as product_code
    FROM boms b
    JOIN products p ON b.product_id = p.id
    WHERE b.version LIKE ? OR p.name LIKE ? OR p.code LIKE ?
    LIMIT 5
  `).all(q, q, q) as any[]
  for (const b of boms) {
    results.push({
      id: b.id,
      type: 'bom',
      label: 'BOM',
      title: `${b.product_name} v${b.version}`,
      subtitle: `${b.product_code} | ${b.status}`,
      navigateTo: '/bom',
    })
  }

  // 6. Stock Items
  const stockItems = db.prepare(`
    SELECT id, sku, name, location, status
    FROM stock_items
    WHERE sku LIKE ? OR name LIKE ? OR location LIKE ?
    LIMIT 5
  `).all(q, q, q) as any[]
  for (const s of stockItems) {
    results.push({
      id: s.id,
      type: 'stock',
      label: 'สต็อก',
      title: s.name,
      subtitle: `${s.sku} | ${s.location}`,
      navigateTo: '/stock',
    })
  }

  return { query, results, total: results.length }
}
