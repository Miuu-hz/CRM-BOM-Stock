import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'

const router = Router()

// Global search endpoint
router.get('/', async (req: Request, res: Response) => {
  try {
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

    const searchTerm = q.trim().toLowerCase()

    // Search in parallel for better performance
    const [customers, orders, products, materials, boms, stock] = await Promise.all([
      // Search customers
      prisma.customer.findMany({
        where: {
          OR: [
            { name: { contains: searchTerm } },
            { email: { contains: searchTerm } },
            { phone: { contains: searchTerm } },
            { company: { contains: searchTerm } },
          ],
        },
        take: 5,
        select: {
          id: true,
          name: true,
          email: true,
          company: true,
          status: true,
        },
      }),

      // Search orders
      prisma.order.findMany({
        where: {
          OR: [
            { orderNumber: { contains: searchTerm } },
            { customer: { name: { contains: searchTerm } } },
          ],
        },
        take: 5,
        include: {
          customer: {
            select: { name: true },
          },
        },
      }),

      // Search products
      prisma.product.findMany({
        where: {
          OR: [
            { name: { contains: searchTerm } },
            { sku: { contains: searchTerm } },
            { description: { contains: searchTerm } },
          ],
        },
        take: 5,
        select: {
          id: true,
          name: true,
          sku: true,
          price: true,
          category: true,
        },
      }),

      // Search materials
      prisma.material.findMany({
        where: {
          OR: [
            { name: { contains: searchTerm } },
            { code: { contains: searchTerm } },
            { description: { contains: searchTerm } },
          ],
        },
        take: 5,
        select: {
          id: true,
          name: true,
          code: true,
          unit: true,
          unitCost: true,
          stockQuantity: true,
        },
      }),

      // Search BOMs
      prisma.bOM.findMany({
        where: {
          OR: [
            { name: { contains: searchTerm } },
            { code: { contains: searchTerm } },
            { product: { name: { contains: searchTerm } } },
          ],
        },
        take: 5,
        include: {
          product: {
            select: { name: true },
          },
        },
      }),

      // Search stock items
      prisma.stockItem.findMany({
        where: {
          OR: [
            { name: { contains: searchTerm } },
            { sku: { contains: searchTerm } },
            { location: { contains: searchTerm } },
          ],
        },
        take: 5,
        select: {
          id: true,
          name: true,
          sku: true,
          quantity: true,
          unit: true,
          category: true,
          location: true,
        },
      }),
    ])

    res.json({
      success: true,
      data: {
        customers: customers.map((c) => ({
          ...c,
          type: 'customer',
          label: c.name,
          subtitle: c.company || c.email,
        })),
        orders: orders.map((o) => ({
          ...o,
          type: 'order',
          label: o.orderNumber,
          subtitle: `${o.customer?.name || 'Unknown'} - ฿${Number(o.totalAmount).toLocaleString()}`,
        })),
        products: products.map((p) => ({
          ...p,
          type: 'product',
          label: p.name,
          subtitle: `SKU: ${p.sku} - ฿${Number(p.price).toLocaleString()}`,
        })),
        materials: materials.map((m) => ({
          ...m,
          type: 'material',
          label: m.name,
          subtitle: `${m.code} - ${m.stockQuantity} ${m.unit}`,
        })),
        boms: boms.map((b) => ({
          ...b,
          type: 'bom',
          label: b.name,
          subtitle: b.product?.name || b.code,
        })),
        stock: stock.map((s) => ({
          ...s,
          type: 'stock',
          label: s.name,
          subtitle: `${s.sku} - ${s.quantity} ${s.unit}`,
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
