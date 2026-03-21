import { Router, Request, Response } from 'express'
import { authenticate, requireRole } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

// Get all customers (แยกตาม Tenant อัตโนมัติ)
router.get('/', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    // ดึงเฉพาะลูกค้าของบริษัทนี้เท่านั้น (tenant_id filter)
    const customers = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM orders WHERE customer_id = c.id)
          + (SELECT COUNT(*) FROM sales_orders WHERE customer_id = c.id AND tenant_id = c.tenant_id AND status != 'CANCELLED')
          as total_orders,
        (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE customer_id = c.id)
          + (SELECT COALESCE(SUM(paid_amount), 0) FROM invoices WHERE customer_id = c.id AND tenant_id = c.tenant_id)
          as total_revenue
      FROM customers c
      WHERE c.tenant_id = ?
      ORDER BY c.created_at DESC
    `).all(tenantId)
    
    res.json({ success: true, data: customers })
  } catch (error) {
    console.error('Get customers error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลลูกค้าได้' })
  }
})

// Search customers by name or phone (for POS member linking)
// IMPORTANT: must be before /:id to avoid route collision
router.get('/search', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { q = '', limit = 10 } = req.query as { q?: string; limit?: string }

    if (!q || q.trim().length < 1) {
      return res.json({ success: true, data: [] })
    }

    const term = `%${q.trim()}%`
    const customers = db.prepare(`
      SELECT id, code, name, contact_name, phone, email,
             loyalty_points, total_spent, status
      FROM customers
      WHERE tenant_id = ? AND status = 'ACTIVE'
        AND (name LIKE ? OR contact_name LIKE ? OR phone LIKE ? OR code LIKE ?)
      ORDER BY name ASC
      LIMIT ?
    `).all(tenantId, term, term, term, term, parseInt(limit as string)) as any[]

    res.json({ success: true, data: customers })
  } catch (error) {
    console.error('Customer search error:', error)
    res.status(500).json({ success: false, message: 'ค้นหาลูกค้าไม่สำเร็จ' })
  }
})

// Get customer by ID (ตรวจสอบว่าเป็นของบริษัทนี้จริงๆ)
router.get('/:id', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params
    
    const customer = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM orders WHERE customer_id = c.id)
          + (SELECT COUNT(*) FROM sales_orders WHERE customer_id = c.id AND tenant_id = c.tenant_id AND status != 'CANCELLED')
          as total_orders,
        (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE customer_id = c.id)
          + (SELECT COALESCE(SUM(paid_amount), 0) FROM invoices WHERE customer_id = c.id AND tenant_id = c.tenant_id)
          as total_revenue
      FROM customers c
      WHERE c.id = ? AND c.tenant_id = ?
    `).get(id, tenantId) as any
    
    if (!customer) {
      return res.status(404).json({ success: false, message: 'ไม่พบลูกค้า' })
    }
    
    res.json({ success: true, data: customer })
  } catch (error) {
    console.error('Get customer error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลลูกค้าได้' })
  }
})

// Create customer (เพิ่ม tenant_id อัตโนมัติ)
router.post('/', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { code, name, type, contactName, email, phone, city, creditLimit = 0 } = req.body
    
    // Validation
    if (!code || !name || !type || !contactName || !phone) {
      return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบ' })
    }
    
    // Check duplicate code in this tenant
    const existing = db.prepare('SELECT id FROM customers WHERE tenant_id = ? AND code = ?')
      .get(tenantId, code)
    
    if (existing) {
      return res.status(400).json({ success: false, message: 'รหัสลูกค้านี้มีอยู่แล้ว' })
    }
    
    const id = randomUUID().replace(/-/g, '').substring(0, 25)
    const now = new Date().toISOString()
    
    db.prepare(`
      INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, credit_limit, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
    `).run(id, tenantId, code, name, type, contactName, email || '', phone, city || '', creditLimit, now, now)
    
    res.status(201).json({
      success: true,
      message: 'สร้างลูกค้าสำเร็จ',
      data: { id, code, name, type },
    })
  } catch (error) {
    console.error('Create customer error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถสร้างลูกค้าได้' })
  }
})

// Update customer (ตรวจสอบว่าเป็นของบริษัทนี้ก่อน)
router.put('/:id', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params
    const { name, contactName, email, phone, city, creditLimit, status } = req.body
    
    // Check if customer exists and belongs to this tenant
    const existing = db.prepare('SELECT id FROM customers WHERE id = ? AND tenant_id = ?')
      .get(id, tenantId)
    
    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบลูกค้า' })
    }
    
    const now = new Date().toISOString()
    
    db.prepare(`
      UPDATE customers 
      SET name = COALESCE(?, name),
          contact_name = COALESCE(?, contact_name),
          email = COALESCE(?, email),
          phone = COALESCE(?, phone),
          city = COALESCE(?, city),
          credit_limit = COALESCE(?, credit_limit),
          status = COALESCE(?, status),
          updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(name, contactName, email, phone, city, creditLimit, status, now, id, tenantId)
    
    res.json({ success: true, message: 'อัปเดตลูกค้าสำเร็จ' })
  } catch (error) {
    console.error('Update customer error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถอัปเดตลูกค้าได้' })
  }
})

// Delete customer (ตรวจสอบว่าเป็นของบริษัทนี้ก่อน)
router.delete('/:id', requireRole('ADMIN', 'MANAGER'), (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params
    
    // Check if customer exists and belongs to this tenant
    const existing = db.prepare('SELECT id FROM customers WHERE id = ? AND tenant_id = ?')
      .get(id, tenantId)
    
    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบลูกค้า' })
    }
    
    // Check if customer has orders
    const hasOrders = db.prepare('SELECT COUNT(*) as count FROM orders WHERE customer_id = ?').get(id) as any
    
    if (hasOrders.count > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'ไม่สามารถลบลูกค้าได้เนื่องจากมีประวัติการสั่งซื้อ' 
      })
    }
    
    db.prepare('DELETE FROM customers WHERE id = ? AND tenant_id = ?').run(id, tenantId)
    
    res.json({ success: true, message: 'ลบลูกค้าสำเร็จ' })
  } catch (error) {
    console.error('Delete customer error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถลบลูกค้าได้' })
  }
})

// Get customer insights — includes Sales module stats + Quotations + stock links
router.get('/:id/insights', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const customer = db.prepare('SELECT id FROM customers WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    if (!customer) return res.status(404).json({ success: false, message: 'ไม่พบลูกค้า' })

    // ── Order stats (legacy orders table) ──────────────────────────────────────
    const orderStats = db.prepare(`
      SELECT COUNT(*) as totalOrders,
        COALESCE(SUM(total_amount), 0) as totalRevenue,
        MAX(order_date) as lastOrderDate,
        CASE WHEN MAX(order_date) IS NOT NULL THEN julianday('now') - julianday(MAX(order_date)) ELSE NULL END as daysSinceLastOrder,
        CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(total_amount), 0) / COUNT(*) ELSE 0 END as avgOrderValue
      FROM orders WHERE customer_id = ?
    `).get(id) as any

    // ── Sales-module stats (sales_orders, invoices) ────────────────────────────
    const soStats = db.prepare(`
      SELECT COUNT(*) as totalSO,
        COALESCE(SUM(total_amount), 0) as totalSOAmount,
        MAX(order_date) as lastSODate
      FROM sales_orders WHERE customer_id = ? AND tenant_id = ? AND status != 'CANCELLED'
    `).get(id, tenantId) as any

    const invStats = db.prepare(`
      SELECT COUNT(*) as totalInvoices,
        COALESCE(SUM(total_amount), 0) as totalInvoiced,
        COALESCE(SUM(CASE WHEN status = 'PAID' THEN total_amount ELSE 0 END), 0) as totalPaid,
        COALESCE(SUM(CASE WHEN status IN ('ISSUED','PARTIAL','OVERDUE') THEN balance_amount ELSE 0 END), 0) as totalOutstanding
      FROM invoices WHERE customer_id = ? AND tenant_id = ?
    `).get(id, tenantId) as any

    const qtStats = db.prepare(`
      SELECT COUNT(*) as totalQT, COALESCE(SUM(total_amount), 0) as totalQTAmount
      FROM quotations WHERE customer_id = ? AND tenant_id = ? AND status != 'CANCELLED'
    `).get(id, tenantId) as any

    // ── Recent orders (fixed 10 for overview; paginated via /orders endpoint) ──
    const recentOrders = db.prepare(`
      SELECT o.id, o.order_number as orderNumber, o.order_date as orderDate,
        o.total_amount as totalAmount, o.status, o.notes
      FROM orders o WHERE o.customer_id = ?
      ORDER BY o.order_date DESC LIMIT 10
    `).all(id) as any[]

    for (const order of recentOrders) {
      order.items = db.prepare(`
        SELECT oi.product_id as productId,
          COALESCE(si.name, p.name, oi.product_id) as productName,
          COALESCE(si.category, p.category, 'ทั่วไป') as category,
          oi.quantity, oi.total_price as totalPrice
        FROM order_items oi
        LEFT JOIN stock_items si ON oi.product_id = si.id
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `).all(order.id) || []
    }

    // ── Favourites — รวม legacy orders + sales_orders ──────────────────────────
    const favouriteProducts = db.prepare(`
      SELECT name, category,
        SUM(qty) as totalQuantity,
        SUM(revenue) as totalRevenue
      FROM (
        SELECT COALESCE(si.name, p.name, oi.product_id) as name,
          COALESCE(si.category, p.category, 'ทั่วไป') as category,
          oi.quantity as qty, oi.total_price as revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        LEFT JOIN stock_items si ON oi.product_id = si.id
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE o.customer_id = ?
        UNION ALL
        SELECT COALESCE(si.name, soi.product_name, soi.product_id) as name,
          COALESCE(si.category, 'ทั่วไป') as category,
          soi.quantity as qty, soi.total_price as revenue
        FROM sales_order_items soi
        JOIN sales_orders so ON soi.sales_order_id = so.id
        LEFT JOIN stock_items si ON soi.stock_item_id = si.id
        WHERE so.customer_id = ? AND so.tenant_id = ? AND so.status != 'CANCELLED'
      )
      GROUP BY name
      ORDER BY totalQuantity DESC LIMIT 10
    `).all(id, id, tenantId) || []

    // ── Auto-recommendations from stock_items ──────────────────────────────────
    const autoRecommendations = db.prepare(`
      SELECT si.id as productId, si.name, si.category, si.sku,
        si.quantity as stockQty, si.unit,
        COUNT(DISTINCT oi.order_id) as popularity
      FROM stock_items si
      JOIN order_items oi ON si.id = oi.product_id
      WHERE si.tenant_id = ?
        AND si.id NOT IN (
          SELECT DISTINCT oi2.product_id FROM order_items oi2
          JOIN orders o2 ON oi2.order_id = o2.id WHERE o2.customer_id = ?
        )
      GROUP BY si.id ORDER BY popularity DESC LIMIT 5
    `).all(tenantId, id) || []

    // ── Quotations from Sales module (proposals tab) ───────────────────────────
    const quotations = db.prepare(`
      SELECT q.id, q.quotation_number, q.quotation_date, q.expiry_date,
        q.status, q.total_amount, q.notes
      FROM quotations q
      WHERE q.customer_id = ? AND q.tenant_id = ?
      ORDER BY q.quotation_date DESC LIMIT 25
    `).all(id, tenantId) as any[]

    for (const qt of quotations) {
      try {
        qt.items = db.prepare(`
          SELECT COALESCE(si.name, p.name, 'สินค้า') as productName,
            qi.quantity, qi.unit_price, qi.total_price, qi.discount_percent
          FROM quotation_items qi
          LEFT JOIN stock_items si ON qi.product_id = si.id
          LEFT JOIN products p ON qi.product_id = p.id
          WHERE qi.quotation_id = ?
        `).all(qt.id) || []
      } catch { qt.items = [] }
    }

    res.json({
      success: true,
      data: {
        stats: {
          totalOrders: orderStats.totalOrders || 0,
          totalRevenue: orderStats.totalRevenue || 0,
          lastOrderDate: orderStats.lastOrderDate,
          daysSinceLastOrder: orderStats.daysSinceLastOrder ? Math.floor(orderStats.daysSinceLastOrder) : undefined,
          avgOrderValue: orderStats.avgOrderValue || 0,
          totalSO: soStats?.totalSO || 0,
          totalSOAmount: soStats?.totalSOAmount || 0,
          lastSODate: soStats?.lastSODate,
          totalInvoices: invStats?.totalInvoices || 0,
          totalInvoiced: invStats?.totalInvoiced || 0,
          totalPaid: invStats?.totalPaid || 0,
          totalOutstanding: invStats?.totalOutstanding || 0,
          totalQT: qtStats?.totalQT || 0,
          totalQTAmount: qtStats?.totalQTAmount || 0,
        },
        recentOrders: recentOrders.map(o => ({ ...o, items: o.items || [] })),
        favouriteProducts,
        recommendations: autoRecommendations,
        quotations,
        // backward compat
        proposalsHistory: quotations.map(q => ({ orderNumber: q.quotation_number, note: q.notes || '', createdAt: q.quotation_date })),
      }
    })
  } catch (error) {
    console.error('Get customer insights error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูล insights ได้' })
  }
})

// GET /customers/:id/orders?page=1&limit=25 — paginated order history
router.get('/:id/orders', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params
    const page  = Math.max(1, parseInt(req.query.page  as string) || 1)
    const limit = [25, 50, 100].includes(parseInt(req.query.limit as string)) ? parseInt(req.query.limit as string) : 25
    const offset = (page - 1) * limit

    const customer = db.prepare('SELECT id FROM customers WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    if (!customer) return res.status(404).json({ success: false, message: 'ไม่พบลูกค้า' })

    const { total } = db.prepare(`
      SELECT (
        SELECT COUNT(*) FROM orders WHERE customer_id = ?
      ) + (
        SELECT COUNT(*) FROM sales_orders WHERE customer_id = ? AND tenant_id = ? AND status != 'CANCELLED'
      ) as total
    `).get(id, id, tenantId) as any

    const orders = db.prepare(`
      SELECT id, orderNumber, orderDate, totalAmount, status, notes, source
      FROM (
        SELECT o.id, o.order_number as orderNumber, o.order_date as orderDate,
          o.total_amount as totalAmount, o.status, o.notes, 'legacy' as source
        FROM orders o WHERE o.customer_id = ?
        UNION ALL
        SELECT so.id, so.so_number as orderNumber, so.order_date as orderDate,
          so.total_amount as totalAmount, so.status, so.notes, 'SO' as source
        FROM sales_orders so
        WHERE so.customer_id = ? AND so.tenant_id = ? AND so.status != 'CANCELLED'
      )
      ORDER BY orderDate DESC LIMIT ? OFFSET ?
    `).all(id, id, tenantId, limit, offset) as any[]

    for (const order of orders) {
      if (order.source === 'SO') {
        order.items = db.prepare(`
          SELECT COALESCE(si.name, soi.product_name, soi.product_id) as productName,
            soi.quantity, soi.total_price as totalPrice
          FROM sales_order_items soi
          LEFT JOIN stock_items si ON soi.stock_item_id = si.id
          WHERE soi.sales_order_id = ?
        `).all(order.id) || []
      } else {
        order.items = db.prepare(`
          SELECT COALESCE(si.name, p.name, oi.product_id) as productName,
            oi.quantity, oi.total_price as totalPrice
          FROM order_items oi
          LEFT JOIN stock_items si ON oi.product_id = si.id
          LEFT JOIN products p ON oi.product_id = p.id
          WHERE oi.order_id = ?
        `).all(order.id) || []
      }
    }

    res.json({
      success: true,
      data: orders,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    })
  } catch (error) {
    console.error('Get customer orders error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลออเดอร์ได้' })
  }
})

// Get customer summary (เฉพาะของบริษัทนี้)
router.get('/summary/stats', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    // นับลูกค้า
    const customerStats = db.prepare(`
      SELECT 
        COUNT(*) as total_customers,
        SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as active_customers
      FROM customers
      WHERE tenant_id = ?
    `).get(tenantId) as any
    
    // นับ orders และ revenue (legacy + sales module)
    const orderStats = db.prepare(`
      SELECT
        COUNT(*) as total_orders,
        COALESCE(SUM(total_amount), 0) as total_revenue
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE c.tenant_id = ?
    `).get(tenantId) as any

    const soStats = db.prepare(`
      SELECT
        COUNT(*) as total_so,
        COALESCE(SUM(paid_amount), 0) as total_paid
      FROM invoices
      WHERE tenant_id = ?
    `).get(tenantId) as any

    const combinedOrders = (orderStats.total_orders || 0) + (soStats.total_so || 0)
    const combinedRevenue = (orderStats.total_revenue || 0) + (soStats.total_paid || 0)
    const avgOrderValue = combinedOrders > 0 ? combinedRevenue / combinedOrders : 0

    res.json({
      success: true,
      data: {
        total_customers: customerStats.total_customers,
        active_customers: customerStats.active_customers,
        total_orders: combinedOrders,
        total_revenue: combinedRevenue,
        avg_customer_value: avgOrderValue
      }
    })
  } catch (error) {
    console.error('Get customer stats error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลสถิติได้' })
  }
})

export default router
