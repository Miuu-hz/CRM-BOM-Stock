import { Router, Request, Response } from 'express'
import * as customerRepo from '../repositories/customer.repository'
import * as orderRepo from '../repositories/order.repository'
import * as productRepo from '../repositories/product.repository'

const router = Router()

// List customers with basic stats (for CRM list)
router.get('/', (req: Request, res: Response) => {
  try {
    const customers = customerRepo.getAllCustomers()
    res.json({ success: true, data: customers })
  } catch (error) {
    console.error('Get customers error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch customers' })
  }
})

// CRM summary for all customers (header stats + recent contacts/orders)
router.get('/summary', (req: Request, res: Response) => {
  try {
    const summary = customerRepo.getCustomerSummary()

    const recentOrdersDto = summary.recentOrders.map((o: any) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customerName || 'Unknown',
      contactName: o.contactName || '',
      orderDate: o.orderDate,
      totalAmount: o.totalAmount,
      status: o.status,
    }))

    const recentContacts = recentOrdersDto.map((o: any) => ({
      customerName: o.customerName,
      contactName: o.contactName,
      lastContactAt: o.orderDate,
      lastOrderNumber: o.orderNumber,
      totalAmount: o.totalAmount,
    }))

    res.json({
      success: true,
      data: {
        totalCustomers: summary.totalCustomers,
        activeCustomers: summary.activeCustomers,
        totalRevenue: summary.totalRevenue,
        avgOrderValue: summary.avgOrderValue,
        recentOrders: recentOrdersDto,
        recentContacts,
      },
    })
  } catch (error) {
    console.error('CRM summary error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch CRM summary' })
  }
})

// Get customer by ID with basic orders
router.get('/:id', (req: Request, res: Response) => {
  try {
    const customer = customerRepo.getCustomerWithOrders(req.params.id)

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      })
    }

    res.json({
      success: true,
      data: customer,
    })
  } catch (error) {
    console.error('Get customer error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch customer' })
  }
})

// Detailed CRM insights for a single customer
router.get('/:id/insights', (req: Request, res: Response) => {
  try {
    const customerId = req.params.id
    const customer = customerRepo.getCustomerById(customerId)

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      })
    }

    const customerOrders = orderRepo.getOrdersByCustomerId(customerId)

    const totalOrders = customerOrders.length
    const totalRevenue = customerOrders.reduce((sum: number, o: any) => sum + (o.totalAmount || 0), 0)
    const lastOrderDate = customerOrders.length ? customerOrders[0].orderDate : null

    const recentOrders = customerOrders.slice(0, 5).map((o: any) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      orderDate: o.orderDate,
      totalAmount: o.totalAmount,
      status: o.status,
      notes: o.notes,
      items: o.items || [],
    }))

    // Favorite products for this customer (by quantity)
    const favAgg: Record<string, any> = {}
    customerOrders.forEach((o: any) => {
      (o.items || []).forEach((it: any) => {
        if (!favAgg[it.productId]) {
          favAgg[it.productId] = {
            productId: it.productId,
            name: it.product?.name || 'Unknown',
            category: it.product?.category || '',
            totalQuantity: 0,
            totalRevenue: 0,
          }
        }
        favAgg[it.productId].totalQuantity += it.quantity
        favAgg[it.productId].totalRevenue += it.totalPrice || 0
      })
    })

    const favouriteProducts = Object.values(favAgg)
      .sort((a: any, b: any) => b.totalQuantity - a.totalQuantity)
      .slice(0, 5)

    const boughtProductIds = new Set(Object.keys(favAgg))

    // Popularity across all customers
    const popularity = orderRepo.getProductPopularity()
    const popularityMap = new Map(popularity.map((p: any) => [p.productId, p.totalQuantity]))

    const products = productRepo.getAllProducts().filter((p: any) => p.status === 'ACTIVE')

    const recommendations = products
      .filter((p: any) => !boughtProductIds.has(p.id))
      .map((p: any) => ({
        productId: p.id,
        name: p.name,
        category: p.category,
        popularity: popularityMap.get(p.id) || 0,
      }))
      .sort((a: any, b: any) => b.popularity - a.popularity)
      .slice(0, 5)

    // "Proposals" = notes from previous orders
    const proposalsHistory = customerOrders
      .filter((o: any) => o.notes && o.notes.trim().length > 0)
      .slice(0, 5)
      .map((o: any) => ({
        orderNumber: o.orderNumber,
        note: o.notes,
        createdAt: o.createdAt,
      }))

    res.json({
      success: true,
      data: {
        customer,
        stats: { totalOrders, totalRevenue, lastOrderDate },
        recentOrders,
        favouriteProducts,
        recommendations,
        proposalsHistory,
      },
    })
  } catch (error) {
    console.error('Customer insights error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch customer insights' })
  }
})

// Create customer
router.post('/', (req: Request, res: Response) => {
  try {
    const created = customerRepo.createCustomer(req.body)
    res.json({
      success: true,
      message: 'Customer created successfully',
      data: created,
    })
  } catch (error) {
    console.error('Create customer error:', error)
    res.status(500).json({ success: false, message: 'Failed to create customer' })
  }
})

// Update customer
router.put('/:id', (req: Request, res: Response) => {
  try {
    const updated = customerRepo.updateCustomer(req.params.id, req.body)

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Customer not found' })
    }

    res.json({
      success: true,
      message: 'Customer updated successfully',
      data: updated,
    })
  } catch (error) {
    console.error('Update customer error:', error)
    res.status(500).json({ success: false, message: 'Failed to update customer' })
  }
})

// Delete customer
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const deleted = customerRepo.deleteCustomer(req.params.id)

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Customer not found' })
    }

    res.json({
      success: true,
      message: 'Customer deleted successfully',
    })
  } catch (error) {
    console.error('Delete customer error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete customer' })
  }
})

export default router
