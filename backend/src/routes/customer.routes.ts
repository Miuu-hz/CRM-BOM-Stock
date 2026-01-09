import { Router, Request, Response } from 'express'
import { customers, orders } from '../db/mockData'

const router = Router()

// Get all customers
router.get('/', async (req: Request, res: Response) => {
  try {
    const customersWithStats = customers.map((customer) => {
      const customerOrders = orders.filter((o) => o.customerId === customer.id)
      return {
        ...customer,
        totalOrders: customerOrders.length,
        totalRevenue: customerOrders.reduce((sum, o) => sum + o.totalAmount, 0),
      }
    })

    res.json({
      success: true,
      data: customersWithStats,
    })
  } catch (error) {
    console.error('Get customers error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch customers' })
  }
})

// Get customer by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const customer = customers.find((c) => c.id === req.params.id)

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      })
    }

    const customerOrders = orders.filter((o) => o.customerId === customer.id)

    res.json({
      success: true,
      data: {
        ...customer,
        orders: customerOrders,
      },
    })
  } catch (error) {
    console.error('Get customer error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch customer' })
  }
})

// Create customer
router.post('/', async (req: Request, res: Response) => {
  try {
    const newCustomer = {
      id: String(customers.length + 1),
      ...req.body,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    customers.push(newCustomer)

    res.json({
      success: true,
      message: 'Customer created successfully',
      data: newCustomer,
    })
  } catch (error) {
    console.error('Create customer error:', error)
    res.status(500).json({ success: false, message: 'Failed to create customer' })
  }
})

// Update customer
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const index = customers.findIndex((c) => c.id === req.params.id)

    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      })
    }

    customers[index] = {
      ...customers[index],
      ...req.body,
      updatedAt: new Date(),
    }

    res.json({
      success: true,
      message: 'Customer updated successfully',
      data: customers[index],
    })
  } catch (error) {
    console.error('Update customer error:', error)
    res.status(500).json({ success: false, message: 'Failed to update customer' })
  }
})

// Delete customer
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const index = customers.findIndex((c) => c.id === req.params.id)

    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      })
    }

    customers.splice(index, 1)

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
