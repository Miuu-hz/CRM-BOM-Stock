import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'

const router = Router()

// GET /sales/badge-counts — total outstanding count across the whole Sales
// category (quotations + orders + delivery orders + invoices + backorders).
// Mirrors purchase.routes.ts GET /purchase/badge-counts and the same status
// filters already used client-side for the per-tab badges in Sales.tsx
// (pendingQuotations/pendingOrders/pendingDeliveryOrders/pendingInvoices/pendingBackorders).
router.get('/badge-counts', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const quotations = (db.prepare(
      `SELECT COUNT(*) as cnt FROM quotations WHERE tenant_id = ? AND status IN ('DRAFT', 'SENT')`
    ).get(tenantId) as any).cnt as number

    const orders = (db.prepare(
      `SELECT COUNT(*) as cnt FROM sales_orders WHERE tenant_id = ? AND status IN ('PROCESSING', 'READY')`
    ).get(tenantId) as any).cnt as number

    const deliveryOrders = (db.prepare(
      `SELECT COUNT(*) as cnt FROM delivery_orders WHERE tenant_id = ? AND status IN ('DRAFT', 'READY')`
    ).get(tenantId) as any).cnt as number

    const invoices = (db.prepare(
      `SELECT COUNT(*) as cnt FROM invoices WHERE tenant_id = ? AND payment_status IN ('UNPAID', 'OVERDUE')`
    ).get(tenantId) as any).cnt as number

    const backorders = (db.prepare(
      `SELECT COUNT(*) as cnt FROM backorders WHERE tenant_id = ? AND status = 'PENDING'`
    ).get(tenantId) as any).cnt as number

    const total = quotations + orders + deliveryOrders + invoices + backorders

    res.json({
      success: true,
      data: { quotations, orders, deliveryOrders, invoices, backorders, total }
    })
  } catch (error) {
    console.error('Get sales badge counts error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch sales badge counts' })
  }
})

export default router
