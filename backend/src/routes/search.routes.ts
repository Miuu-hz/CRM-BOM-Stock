import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

// Global search endpoint
router.get('/', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { q } = req.query

    if (!q || typeof q !== 'string' || q.trim().length < 2) {
      return res.json({
        success: true,
        data: {
          customers: [],
          orders: [],
          products: [],
          materials: [],
          boms: [],
          stock: [],
        },
      })
    }

    const searchTerm = `%${q.trim().toLowerCase()}%`

    // Search customers
    const customers = db.prepare(`
      SELECT id, code, name, email, phone, city, status
      FROM customers
      WHERE tenant_id = ? AND (
        LOWER(name) LIKE ? OR 
        LOWER(email) LIKE ? OR 
        LOWER(phone) LIKE ? OR 
        LOWER(code) LIKE ?
      )
      LIMIT 5
    `).all(tenantId, searchTerm, searchTerm, searchTerm, searchTerm) as any[]

    // Search orders
    const orders = db.prepare(`
      SELECT o.id, o.order_number, o.total_amount, o.status, c.name as customer_name
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE o.tenant_id = ? AND (
        LOWER(o.order_number) LIKE ? OR 
        LOWER(c.name) LIKE ?
      )
      LIMIT 5
    `).all(tenantId, searchTerm, searchTerm) as any[]

    // Search products
    const products = db.prepare(`
      SELECT id, code, name, category, status
      FROM products
      WHERE tenant_id = ? AND (
        LOWER(name) LIKE ? OR 
        LOWER(code) LIKE ? OR 
        LOWER(description) LIKE ?
      )
      LIMIT 5
    `).all(tenantId, searchTerm, searchTerm, searchTerm) as any[]

    // Search materials
    const materials = db.prepare(`
      SELECT id, code, name, unit, unit_cost
      FROM materials
      WHERE tenant_id = ? AND (
        LOWER(name) LIKE ? OR 
        LOWER(code) LIKE ?
      )
      LIMIT 5
    `).all(tenantId, searchTerm, searchTerm) as any[]

    // Search BOMs
    const boms = db.prepare(`
      SELECT b.id, b.version, b.status, p.name as product_name, p.code as product_code
      FROM boms b
      JOIN products p ON b.product_id = p.id
      WHERE b.tenant_id = ? AND (
        LOWER(b.version) LIKE ? OR 
        LOWER(p.name) LIKE ? OR 
        LOWER(p.code) LIKE ?
      )
      LIMIT 5
    `).all(tenantId, searchTerm, searchTerm, searchTerm) as any[]

    // Search stock items
    const stock = db.prepare(`
      SELECT id, sku, name, quantity, unit, category, location, status
      FROM stock_items
      WHERE tenant_id = ? AND (
        LOWER(name) LIKE ? OR 
        LOWER(sku) LIKE ? OR 
        LOWER(location) LIKE ?
      )
      LIMIT 5
    `).all(tenantId, searchTerm, searchTerm, searchTerm) as any[]

    res.json({
      success: true,
      data: {
        customers: customers.map((c) => ({
          ...c,
          type: 'customer',
          label: c.name,
          subtitle: `${c.code} - ${c.city}`,
        })),
        orders: orders.map((o) => ({
          ...o,
          type: 'order',
          label: o.order_number,
          subtitle: `${o.customer_name || 'Unknown'} - ฿${Number(o.total_amount).toLocaleString()}`,
        })),
        products: products.map((p) => ({
          ...p,
          type: 'product',
          label: p.name,
          subtitle: `Code: ${p.code} - ${p.category}`,
        })),
        materials: materials.map((m) => ({
          ...m,
          type: 'material',
          label: m.name,
          subtitle: `${m.code} - ${Number(m.unit_cost).toLocaleString()} ฿/${m.unit}`,
        })),
        boms: boms.map((b) => ({
          ...b,
          type: 'bom',
          label: `BOM ${b.product_name || 'Unknown'}`,
          subtitle: `Version: ${b.version} - ${b.product_code || ''}`,
        })),
        stock: stock.map((s) => ({
          ...s,
          type: 'stock',
          label: s.name,
          subtitle: `${s.sku} - ${s.quantity} ${s.unit} @ ${s.location}`,
        })),
      },
    })
  } catch (error) {
    console.error('Search error:', error)
    res.status(500).json({
      success: false,
      message: 'Search failed',
    })
  }
})

export default router
