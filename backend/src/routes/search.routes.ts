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
          suppliers: [],
          purchase_orders: [],
          work_orders: [],
          sales_orders: [],
          quotations: [],
          invoices: [],
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
      WHERE c.tenant_id = ? AND (
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

    // Search suppliers
    const suppliers = db.prepare(`
      SELECT id, code, name, contact_name, email, phone, city, status, tax_id
      FROM suppliers
      WHERE tenant_id = ? AND (
        LOWER(name) LIKE ? OR 
        LOWER(code) LIKE ? OR 
        LOWER(contact_name) LIKE ? OR 
        LOWER(email) LIKE ? OR 
        LOWER(phone) LIKE ? OR 
        LOWER(city) LIKE ? OR 
        LOWER(tax_id) LIKE ?
      )
      LIMIT 5
    `).all(tenantId, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm) as any[]

    // Search purchase orders
    const purchaseOrders = db.prepare(`
      SELECT po.id, po.po_number, po.status, po.total_amount, s.name as supplier_name
      FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
      WHERE po.tenant_id = ? AND (
        LOWER(po.po_number) LIKE ? OR 
        LOWER(s.name) LIKE ?
      )
      LIMIT 5
    `).all(tenantId, searchTerm, searchTerm) as any[]

    // Search work orders
    const workOrders = db.prepare(`
      SELECT id, wo_number, product_name, quantity, status, priority, assigned_to
      FROM work_orders
      WHERE tenant_id = ? AND (
        LOWER(wo_number) LIKE ? OR 
        LOWER(product_name) LIKE ? OR 
        LOWER(assigned_to) LIKE ?
      )
      LIMIT 5
    `).all(tenantId, searchTerm, searchTerm, searchTerm) as any[]

    // Search sales orders
    const salesOrders = db.prepare(`
      SELECT so.id, so.so_number, so.status, so.total_amount, c.name as customer_name
      FROM sales_orders so
      JOIN customers c ON so.customer_id = c.id
      WHERE so.tenant_id = ? AND (
        LOWER(so.so_number) LIKE ? OR 
        LOWER(c.name) LIKE ?
      )
      LIMIT 5
    `).all(tenantId, searchTerm, searchTerm) as any[]

    // Search quotations
    const quotations = db.prepare(`
      SELECT q.id, q.quotation_number, q.status, q.total_amount, c.name as customer_name
      FROM quotations q
      JOIN customers c ON q.customer_id = c.id
      WHERE q.tenant_id = ? AND (
        LOWER(q.quotation_number) LIKE ? OR 
        LOWER(c.name) LIKE ?
      )
      LIMIT 5
    `).all(tenantId, searchTerm, searchTerm) as any[]

    // Search invoices
    const invoices = db.prepare(`
      SELECT i.id, i.invoice_number, i.status, i.total_amount, c.name as customer_name
      FROM invoices i
      JOIN customers c ON i.customer_id = c.id
      WHERE i.tenant_id = ? AND (
        LOWER(i.invoice_number) LIKE ? OR 
        LOWER(c.name) LIKE ?
      )
      LIMIT 5
    `).all(tenantId, searchTerm, searchTerm) as any[]

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
        suppliers: suppliers.map((s) => ({
          ...s,
          type: 'supplier',
          label: s.name,
          subtitle: `${s.code} - ${s.contact_name} | ${s.phone}`,
        })),
        purchase_orders: purchaseOrders.map((po) => ({
          ...po,
          type: 'purchase_order',
          label: po.po_number,
          subtitle: `${po.supplier_name || 'Unknown'} - ${po.status} - ฿${Number(po.total_amount).toLocaleString()}`,
        })),
        work_orders: workOrders.map((wo) => ({
          ...wo,
          type: 'work_order',
          label: wo.wo_number,
          subtitle: `${wo.product_name || 'Unknown'} - Qty: ${wo.quantity} - ${wo.status}`,
        })),
        sales_orders: salesOrders.map((so) => ({
          ...so,
          type: 'sales_order',
          label: so.so_number,
          subtitle: `${so.customer_name || 'Unknown'} - ฿${Number(so.total_amount).toLocaleString()}`,
        })),
        quotations: quotations.map((q) => ({
          ...q,
          type: 'quotation',
          label: q.quotation_number,
          subtitle: `${q.customer_name || 'Unknown'} - ฿${Number(q.total_amount).toLocaleString()}`,
        })),
        invoices: invoices.map((i) => ({
          ...i,
          type: 'invoice',
          label: i.invoice_number,
          subtitle: `${i.customer_name || 'Unknown'} - ฿${Number(i.total_amount).toLocaleString()} - ${i.status}`,
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
