import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'

const router = Router()

// SALES SUMMARY / STATS
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    // Sales order stats
    const soStats = db.prepare(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) as draft_orders,
        SUM(CASE WHEN status IN ('CONFIRMED', 'PROCESSING', 'READY') THEN 1 ELSE 0 END) as processing_orders,
        SUM(CASE WHEN status = 'PARTIAL' THEN 1 ELSE 0 END) as partial_orders,
        SUM(CASE WHEN status IN ('DELIVERED', 'COMPLETED') THEN 1 ELSE 0 END) as completed_orders,
        COALESCE(SUM(total_amount), 0) as total_sales
      FROM sales_orders
      WHERE tenant_id = ?
    `).get(tenantId) as any

    // Invoice stats
    const invStats = db.prepare(`
      SELECT 
        COUNT(*) as total_invoices,
        SUM(CASE WHEN payment_status = 'UNPAID' THEN 1 ELSE 0 END) as unpaid_invoices,
        SUM(CASE WHEN payment_status = 'PARTIAL' THEN 1 ELSE 0 END) as partial_invoices,
        SUM(CASE WHEN payment_status = 'PAID' THEN 1 ELSE 0 END) as paid_invoices,
        COALESCE(SUM(total_amount), 0) as total_invoiced,
        COALESCE(SUM(balance_amount), 0) as outstanding_balance
      FROM invoices
      WHERE tenant_id = ?
    `).get(tenantId) as any

    // Today's receipts
    const todayReceipts = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as today_received
      FROM receipts
      WHERE tenant_id = ? AND DATE(receipt_date) = DATE('now')
    `).get(tenantId) as any

    // Credit notes
    const cnStats = db.prepare(`
      SELECT COUNT(*) as total_cn, COALESCE(SUM(total_amount), 0) as total_cn_amount
      FROM credit_notes
      WHERE tenant_id = ? AND status != 'CANCELLED'
    `).get(tenantId) as any

    // Backorders
    const boStats = db.prepare(`
      SELECT COUNT(*) as pending_backorders
      FROM backorders
      WHERE tenant_id = ? AND status = 'PENDING'
    `).get(tenantId) as any

    res.json({
      success: true,
      data: {
        salesOrders: {
          total: soStats.total_orders,
          draft: soStats.draft_orders,
          processing: soStats.processing_orders,
          partial: soStats.partial_orders,
          completed: soStats.completed_orders,
          totalSales: soStats.total_sales
        },
        invoices: {
          total: invStats.total_invoices,
          unpaid: invStats.unpaid_invoices,
          partial: invStats.partial_invoices,
          paid: invStats.paid_invoices,
          totalInvoiced: invStats.total_invoiced,
          outstanding: invStats.outstanding_balance
        },
        receipts: {
          todayReceived: todayReceipts.today_received
        },
        creditNotes: {
          total: cnStats.total_cn,
          totalAmount: cnStats.total_cn_amount
        },
        backorders: {
          pending: boStats.pending_backorders
        }
      }
    })
  } catch (error) {
    console.error('Get sales summary error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch summary' })
  }
})

export default router
