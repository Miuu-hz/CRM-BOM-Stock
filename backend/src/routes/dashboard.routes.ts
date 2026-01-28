import { Router, Request, Response } from 'express'
import * as customerRepo from '../repositories/customer.repository'
import * as orderRepo from '../repositories/order.repository'
import * as stockRepo from '../repositories/stock.repository'

const router = Router()

// Get dashboard statistics
router.get('/stats', (req: Request, res: Response) => {
  try {
    const totalCustomers = customerRepo.countCustomers('ACTIVE')
    const stockStats = stockRepo.getStockStats()

    // Get orders with status PENDING or PROCESSING
    const pendingOrders = orderRepo.countOrders('PENDING')
    const processingOrders = orderRepo.countOrders('PROCESSING')
    const activeOrders = pendingOrders + processingOrders

    // Calculate monthly revenue (current month)
    const orders = orderRepo.getAllOrders()
    const currentMonth = new Date().getMonth()
    const currentYear = new Date().getFullYear()
    const monthlyRevenue = orders
      .filter((o: any) => {
        const orderDate = new Date(o.orderDate)
        return orderDate.getMonth() === currentMonth && orderDate.getFullYear() === currentYear
      })
      .reduce((sum: number, order: any) => sum + (order.totalAmount || 0), 0)

    res.json({
      success: true,
      data: {
        totalCustomers,
        activeOrders,
        stockItems: stockStats.totalItems,
        monthlyRevenue,
      },
    })
  } catch (error) {
    console.error('Dashboard stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stats' })
  }
})

// Get recent activities
router.get('/activities', (req: Request, res: Response) => {
  try {
    const recentOrders = orderRepo.getRecentOrders(10)
    const customers = customerRepo.getAllCustomers()
    const customerMap = new Map<string, any>(customers.map((c: any) => [c.id, c]))

    const activities = recentOrders.map((order: any) => {
      const customer = customerMap.get(order.customerId)
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
