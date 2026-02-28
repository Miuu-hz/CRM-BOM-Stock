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
        (SELECT COUNT(*) FROM orders WHERE customer_id = c.id) as total_orders,
        (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE customer_id = c.id) as total_revenue
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

// Get customer by ID (ตรวจสอบว่าเป็นของบริษัทนี้จริงๆ)
router.get('/:id', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params
    
    const customer = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM orders WHERE customer_id = c.id) as total_orders,
        (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE customer_id = c.id) as total_revenue
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

// Get customer insights (orders, favourites, recommendations, proposals)
router.get('/:id/insights', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params
    
    // Check customer exists and belongs to tenant
    const customer = db.prepare('SELECT id FROM customers WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    if (!customer) {
      return res.status(404).json({ success: false, message: 'ไม่พบลูกค้า' })
    }
    
    // Get order stats
    const orderStats = db.prepare(`
      SELECT 
        COUNT(*) as totalOrders,
        COALESCE(SUM(total_amount), 0) as totalRevenue,
        MAX(order_date) as lastOrderDate,
        CASE 
          WHEN MAX(order_date) IS NOT NULL 
          THEN julianday('now') - julianday(MAX(order_date))
          ELSE NULL 
        END as daysSinceLastOrder,
        CASE 
          WHEN COUNT(*) > 0 THEN COALESCE(SUM(total_amount), 0) / COUNT(*)
          ELSE 0 
        END as avgOrderValue
      FROM orders 
      WHERE customer_id = ?
    `).get(id) as any
    
    // Get recent orders with items
    const recentOrders = db.prepare(`
      SELECT 
        o.id, o.order_number as orderNumber, o.order_date as orderDate, 
        o.total_amount as totalAmount, o.status, o.notes
      FROM orders o
      WHERE o.customer_id = ?
      ORDER BY o.order_date DESC
      LIMIT 10
    `).all(id) as any[]
    
    // Get order items for each order
    for (const order of recentOrders) {
      order.items = db.prepare(`
        SELECT 
          oi.product_id as productId, 
          COALESCE(p.name, oi.product_name) as productName,
          COALESCE(p.category, 'ทั่วไป') as category,
          oi.quantity, oi.total_price as totalPrice
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `).all(order.id) || []
    }
    
    // Get favourite products (most ordered)
    const favouriteProducts = db.prepare(`
      SELECT 
        oi.product_id as productId,
        COALESCE(p.name, oi.product_name) as name,
        COALESCE(p.category, 'ทั่วไป') as category,
        SUM(oi.quantity) as totalQuantity,
        SUM(oi.total_price) as totalRevenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE o.customer_id = ?
      GROUP BY oi.product_id
      ORDER BY totalQuantity DESC
      LIMIT 10
    `).all(id) || []
    
    // Get product recommendations (popular products not yet ordered by this customer)
    const recommendations = db.prepare(`
      SELECT 
        p.id as productId, p.name, p.category,
        COUNT(DISTINCT oi.order_id) as popularity
      FROM products p
      JOIN order_items oi ON p.id = oi.product_id
      WHERE p.id NOT IN (
        SELECT DISTINCT oi2.product_id 
        FROM order_items oi2 
        JOIN orders o2 ON oi2.order_id = o2.id 
        WHERE o2.customer_id = ?
      )
      GROUP BY p.id
      ORDER BY popularity DESC
      LIMIT 5
    `).all(id) || []
    
    // Get proposals history (from order notes)
    const proposalsHistory = db.prepare(`
      SELECT 
        order_number as orderNumber,
        COALESCE(notes, '') as note,
        created_at as createdAt
      FROM orders
      WHERE customer_id = ? AND notes IS NOT NULL AND notes != ''
      ORDER BY created_at DESC
      LIMIT 10
    `).all(id) || []
    
    res.json({
      success: true,
      data: {
        stats: {
          totalOrders: orderStats.totalOrders || 0,
          totalRevenue: orderStats.totalRevenue || 0,
          lastOrderDate: orderStats.lastOrderDate,
          daysSinceLastOrder: orderStats.daysSinceLastOrder ? Math.floor(orderStats.daysSinceLastOrder) : undefined,
          avgOrderValue: orderStats.avgOrderValue || 0
        },
        recentOrders: recentOrders.map(o => ({
          ...o,
          items: o.items || []
        })),
        favouriteProducts,
        recommendations,
        proposalsHistory
      }
    })
  } catch (error) {
    console.error('Get customer insights error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูล insights ได้' })
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
    
    // นับ orders และ revenue
    const orderStats = db.prepare(`
      SELECT 
        COUNT(*) as total_orders,
        COALESCE(SUM(total_amount), 0) as total_revenue
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE c.tenant_id = ?
    `).get(tenantId) as any
    
    // คำนวณ avg order value
    const avgOrderValue = orderStats.total_orders > 0 
      ? orderStats.total_revenue / orderStats.total_orders 
      : 0
    
    res.json({ 
      success: true, 
      data: {
        total_customers: customerStats.total_customers,
        active_customers: customerStats.active_customers,
        total_orders: orderStats.total_orders,
        total_revenue: orderStats.total_revenue,
        avg_customer_value: avgOrderValue
      }
    })
  } catch (error) {
    console.error('Get customer stats error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลสถิติได้' })
  }
})

export default router
