import { Router, Request, Response } from 'express'
import prisma from '../db/prisma'

const router = Router()

const toNumber = (v: any) => (v == null ? 0 : Number(v))

// List customers with basic stats (for CRM list)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const customers = await prisma.customer.findMany({
      orderBy: { createdAt: 'desc' },
      include: { orders: { select: { id: true, totalAmount: true } } },
    })

    const data = customers.map((c: any) => {
      const totalOrders = c.orders.length
      const totalRevenue = c.orders.reduce((sum: number, o: any) => sum + toNumber(o.totalAmount), 0)
      return {
        ...c,
        creditLimit: toNumber(c.creditLimit),
        totalOrders,
        totalRevenue,
        orders: undefined,
      }
    })

    res.json({ success: true, data })
  } catch (error) {
    console.error('Get customers error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch customers' })
  }
})

// CRM summary for all customers (header stats + recent contacts/orders)
router.get('/summary', async (_req: Request, res: Response) => {
  try {
    const [totalCustomers, activeCustomers, ordersAgg, recentOrders] = await Promise.all([
      prisma.customer.count(),
      prisma.customer.count({ where: { status: 'ACTIVE' } }),
      prisma.order.aggregate({
        _count: { id: true },
        _sum: { totalAmount: true },
      }),
      prisma.order.findMany({
        orderBy: { orderDate: 'desc' },
        take: 10,
        include: {
          customer: { select: { name: true, contactName: true } },
        },
      }),
    ])

    const totalRevenue = toNumber(ordersAgg._sum.totalAmount)
    const totalOrders = ordersAgg._count.id
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

    const recentOrdersDto = recentOrders.map((o: any) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customer?.name || 'Unknown',
      contactName: o.customer?.contactName || '',
      orderDate: o.orderDate,
      totalAmount: toNumber(o.totalAmount),
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
        totalCustomers,
        activeCustomers,
        totalRevenue,
        avgOrderValue,
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
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        orders: { orderBy: { orderDate: 'desc' } },
      },
    })

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      })
    }

    res.json({
      success: true,
      data: {
        ...customer,
        creditLimit: toNumber(customer.creditLimit),
        orders: customer.orders.map((o: any) => ({
          ...o,
          totalAmount: toNumber(o.totalAmount),
        })),
      },
    })
  } catch (error) {
    console.error('Get customer error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch customer' })
  }
})

// Detailed CRM insights for a single customer
router.get('/:id/insights', async (req: Request, res: Response) => {
  try {
    const customerId = req.params.id
    const customer = await prisma.customer.findUnique({ where: { id: customerId } })

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      })
    }

    const customerOrders = await prisma.order.findMany({
      where: { customerId },
      orderBy: { orderDate: 'desc' },
      include: {
        items: {
          include: {
            product: { select: { name: true, category: true } },
          },
        },
      },
    })

    const totalOrders = customerOrders.length
    const totalRevenue = customerOrders.reduce((sum: number, o: any) => sum + toNumber(o.totalAmount), 0)
    const lastOrderDate = customerOrders.length ? customerOrders[0].orderDate : null

    const recentOrders = customerOrders.slice(0, 5).map((o: any) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      orderDate: o.orderDate,
      totalAmount: toNumber(o.totalAmount),
      status: o.status,
      notes: o.notes,
      items: o.items.map((it: any) => ({
        productId: it.productId,
        productName: it.product?.name || 'Unknown',
        category: it.product?.category || '',
        quantity: it.quantity,
        totalPrice: toNumber(it.totalPrice),
      })),
    }))

    // Favorite products for this customer (by quantity)
    const favAgg: Record<
      string,
      { productId: string; name: string; category: string; totalQuantity: number; totalRevenue: number }
    > = {}

    customerOrders.forEach((o: any) => {
      o.items.forEach((it: any) => {
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
        favAgg[it.productId].totalRevenue += toNumber(it.totalPrice)
      })
    })

    const favouriteProducts = Object.values(favAgg)
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, 5)

    const boughtProductIds = new Set(Object.keys(favAgg))

    // Popularity across all customers
    const popularity = await prisma.orderItem.groupBy({
      by: ['productId'],
      _sum: { quantity: true },
    })
    const popularityMap = new Map(popularity.map((p: any) => [p.productId, p._sum.quantity || 0]))

    const products = await prisma.product.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, category: true },
    })

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

    // "Proposals" = ใช้ notes จากออเดอร์ก่อน ๆ เป็นสิ่งที่เคยเสนอ/พูดคุย
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
router.post('/', async (req: Request, res: Response) => {
  try {
    const created = await prisma.customer.create({
      data: req.body,
    })

    res.json({
      success: true,
      message: 'Customer created successfully',
      data: { ...created, creditLimit: toNumber(created.creditLimit) },
    })
  } catch (error) {
    console.error('Create customer error:', error)
    res.status(500).json({ success: false, message: 'Failed to create customer' })
  }
})

// Update customer
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const updated = await prisma.customer.update({
      where: { id: req.params.id },
      data: req.body,
    })

    res.json({
      success: true,
      message: 'Customer updated successfully',
      data: { ...updated, creditLimit: toNumber(updated.creditLimit) },
    })
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Customer not found' })
    }
    console.error('Update customer error:', error)
    res.status(500).json({ success: false, message: 'Failed to update customer' })
  }
})

// Delete customer
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.customer.delete({ where: { id: req.params.id } })

    res.json({
      success: true,
      message: 'Customer deleted successfully',
    })
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Customer not found' })
    }
    console.error('Delete customer error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete customer' })
  }
})

export default router
