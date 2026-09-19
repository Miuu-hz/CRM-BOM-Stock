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

    // ความเคลื่อนไหวล่าสุดของโมดูลขาย — รวม 6 ตารางแล้วเรียงตามเวลาที่ขยับล่าสุด
    // open_id = เอกสารที่ให้เปิดเมื่อคลิก (ใบเสร็จไม่มีหน้าตัวเอง จึงเปิดใบแจ้งหนี้ต้นทาง)
    // ครอบ try แยกไว้ ถ้าคิวรีนี้พังต้องไม่ทำให้สถิติทั้งก้อนล่มตาม (แบบเดียวกับฝั่งจัดซื้อ)
    let recentActivity: any[] = []
    try {
      recentActivity = db.prepare(`
        SELECT 'QT' AS kind, q.id, q.quotation_number AS doc, c.name AS party,
               q.total_amount AS amount, q.status AS status, q.updated_at AS updated_at, q.id AS open_id
          FROM quotations q LEFT JOIN customers c ON c.id = q.customer_id AND c.tenant_id = q.tenant_id
         WHERE q.tenant_id = ?
        UNION ALL
        SELECT 'SO', so.id, so.so_number, c.name, so.total_amount, so.status, so.updated_at, so.id
          FROM sales_orders so LEFT JOIN customers c ON c.id = so.customer_id AND c.tenant_id = so.tenant_id
         WHERE so.tenant_id = ?
        UNION ALL
        SELECT 'DO', d.id, d.do_number, c.name, NULL, d.status, d.updated_at, d.id
          FROM delivery_orders d LEFT JOIN customers c ON c.id = d.customer_id AND c.tenant_id = d.tenant_id
         WHERE d.tenant_id = ?
        UNION ALL
        SELECT 'INV', i.id, i.invoice_number, c.name, i.total_amount, i.payment_status, i.updated_at, i.id
          FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
         WHERE i.tenant_id = ?
        UNION ALL
        SELECT 'RC', r.id, r.receipt_number, c.name, r.amount, 'PAID', r.updated_at, r.invoice_id
          FROM receipts r LEFT JOIN customers c ON c.id = r.customer_id AND c.tenant_id = r.tenant_id
         WHERE r.tenant_id = ?
        UNION ALL
        SELECT 'CN', cn.id, cn.cn_number, c.name, cn.total_amount, cn.status, cn.updated_at, cn.id
          FROM credit_notes cn LEFT JOIN customers c ON c.id = cn.customer_id AND c.tenant_id = cn.tenant_id
         WHERE cn.tenant_id = ?
        ORDER BY updated_at DESC LIMIT 12
      `).all(tenantId, tenantId, tenantId, tenantId, tenantId, tenantId) as any[]
    } catch (e) {
      console.error('sales recentActivity query error (ไม่กระทบสถิติส่วนอื่น):', e)
    }

    res.json({
      success: true,
      data: {
        recentActivity,
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
