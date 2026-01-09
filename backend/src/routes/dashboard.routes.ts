import { Router, Request, Response } from 'express'
import { customers, orders, stockItems } from '../db/mockData'

const router = Router()

// Get dashboard statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const totalCustomers = customers.filter((c) => c.status === 'ACTIVE').length
    const activeOrders = orders.filter((o) =>
      ['PENDING', 'PROCESSING'].includes(o.status)
    ).length

    // Calculate monthly revenue (current month)
    const currentMonth = new Date().getMonth()
    const currentYear = new Date().getFullYear()
    const monthlyRevenue = orders
      .filter(
        (o) =>
          o.orderDate.getMonth() === currentMonth &&
          o.orderDate.getFullYear() === currentYear
      )
      .reduce((sum, order) => sum + order.totalAmount, 0)

    res.json({
      success: true,
      data: {
        totalCustomers,
        activeOrders,
        stockItems: stockItems.length,
        monthlyRevenue,
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
    const activities = orders
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10)
      .map((order) => {
        const customer = customers.find((c) => c.id === order.customerId)
        return {
          id: order.id,
          type: 'order',
          message: `New order ${order.orderNumber} from ${customer?.name || 'Unknown'}`,
          timestamp: order.createdAt,
        }
      })

    res.json({
      success: true,
      data: activities,
    })
  } catch (error) {
    console.error('Dashboard activities error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch activities' })
  }
})

export default router
