import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

// Get dashboard statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    // Count active customers for this tenant
    const customerStats = db.prepare(`
      SELECT COUNT(*) as total_customers,
        SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as active_customers
      FROM customers
      WHERE tenant_id = ?
    `).get(tenantId) as any

    // Count active orders for this tenant
    const activeOrders = (db.prepare(`
      SELECT COUNT(*) as count FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE c.tenant_id = ? AND o.status IN ('PENDING', 'PROCESSING')
    `).get(tenantId) as any).count

    // Count stock items for this tenant
    const stockItems = (db.prepare(`
      SELECT COUNT(*) as count FROM stock_items WHERE tenant_id = ?
    `).get(tenantId) as any).count

    // Calculate monthly revenue (current month) for this tenant
    const currentMonth = new Date().getMonth()
    const currentYear = new Date().getFullYear()
    const monthlyRevenue = db.prepare(`
      SELECT COALESCE(SUM(o.total_amount), 0) as revenue
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE c.tenant_id = ? 
        AND strftime('%m', o.order_date) = ?
        AND strftime('%Y', o.order_date) = ?
    `).get(tenantId, String(currentMonth + 1).padStart(2, '0'), String(currentYear)) as any

    res.json({
      success: true,
      data: {
        totalCustomers: customerStats.active_customers || 0,
        activeOrders: activeOrders || 0,
        stockItems: stockItems || 0,
        monthlyRevenue: monthlyRevenue?.revenue || 0,
      },
    })
  } catch (error) {
    console.error('Dashboard stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stats' })
  }
})

// Get recent activities
router.get('/activities', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    // Get recent orders for this tenant
    const activities = db.prepare(`
      SELECT o.id, o.order_number, o.created_at, o.total_amount,
        c.name as customer_name
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE c.tenant_id = ?
      ORDER BY o.created_at DESC
      LIMIT 10
    `).all(tenantId) as any[]

    const formattedActivities = activities.map((order) => ({
      id: order.id,
      type: 'order',
      message: `New order ${order.order_number} from ${order.customer_name || 'Unknown'}`,
      timestamp: order.created_at,
    }))

    res.json({
      success: true,
      data: formattedActivities,
    })
  } catch (error) {
    console.error('Dashboard activities error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch activities' })
  }
})

export default router
