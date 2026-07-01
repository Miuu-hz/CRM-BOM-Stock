import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { generateId, formatDocumentNumber } from '../../utils/id'
import { createSalesJournal } from './shared'

const router = Router()

// POST create receipt (payment)
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { invoiceId, receiptDate, paymentMethod, paymentReference, amount, notes } = req.body
    
    if (!invoiceId || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invoice and valid amount are required' })
    }

    // Get invoice details (join SO for so_number cross-reference)
    const invoice = db.prepare(`
      SELECT i.*, so.so_number, i.invoice_number
      FROM invoices i
      LEFT JOIN sales_orders so ON i.sales_order_id = so.id
      WHERE i.id = ? AND i.tenant_id = ?
    `).get(invoiceId, tenantId) as any
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' })
    }

    if (amount > invoice.balance_amount) {
      return res.status(400).json({ success: false, message: 'Payment amount exceeds balance' })
    }

    const id = generateId()
    const receiptNumber = formatDocumentNumber('RC', tenantId, 'RECEIPT', new Date().getFullYear(), 5)
    const now = new Date().toISOString()
    const date = receiptDate || now

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO receipts (id, tenant_id, receipt_number, invoice_id, customer_id, receipt_date, payment_method,
          payment_reference, amount, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tenantId, receiptNumber, invoiceId, invoice.customer_id, date, paymentMethod || 'CASH',
        paymentReference || '', amount, notes || '', now, now)

      // Update invoice paid and balance
      const newPaid = invoice.paid_amount + amount
      const newBalance = invoice.total_amount - newPaid
      let paymentStatus = 'PARTIAL'
      let invoiceStatus = 'PARTIAL'
      
      if (newBalance <= 0) {
        paymentStatus = 'PAID'
        invoiceStatus = 'PAID'
      }

      db.prepare(`
        UPDATE invoices SET paid_amount = ?, balance_amount = ?, payment_status = ?, status = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(newPaid, newBalance, paymentStatus, invoiceStatus, now, invoiceId, tenantId)

      // Update sales order payment status
      db.prepare("UPDATE sales_orders SET payment_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(paymentStatus, now, invoice.sales_order_id, tenantId)
    })

    transaction()

    const receipt = db.prepare('SELECT * FROM receipts WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
    const updatedInvoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(invoiceId, tenantId)

    // Journal: DR เงินสด/ธนาคาร / CR ลูกหนี้การค้า
    createSalesJournal(tenantId, 'RECEIPT', id,
      `รับชำระเงิน ${receiptNumber} (${paymentMethod || 'CASH'})`,
      amount, 0, paymentMethod, receiptNumber, invoice.so_number)

    res.status(201).json({
      success: true,
      data: { receipt, invoice: updatedInvoice },
      message: 'Payment recorded successfully'
    })
  } catch (error) {
    console.error('Create receipt error:', error)
    res.status(500).json({ success: false, message: 'Failed to record payment' })
  }
})

export default router
