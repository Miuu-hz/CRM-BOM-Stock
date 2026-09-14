import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { voidReceipt } from './shared'
import { recordCustomerPayment, SalesBillingError } from '../../services/salesBilling.service'
import { canHandleBilling } from '../../services/rbac.service'

const router = Router()

// Map SalesBillingError codes → HTTP status
const RECEIPT_ERROR_STATUS: Record<string, number> = {
  INVOICE_NOT_FOUND: 404,
  INVOICE_CANCELLED: 400,
  INVALID_AMOUNT: 400,
  OVER_BALANCE: 400,
}

// POST create receipt (payment)
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canHandleBilling(req.user!, 'sales')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ทำรายการนี้ — ต้องอยู่ฝ่ายขาย/ฝ่ายบัญชี หรือเป็น ADMIN/MASTER' })
    }
    const { invoiceId, receiptDate, paymentMethod, paymentReference, amount, notes, bankAccountId } = req.body

    // ตรรกะจริงอยู่ที่ services/salesBilling.service.ts (ใช้ร่วมกับ MCP record_customer_payment)
    // รวมถึงกันรับชำระกับใบแจ้งหนี้ที่ถูกยกเลิกไปแล้ว (บั๊กที่เจอ+แก้ 2026-09-14)
    const { receipt, invoice: updatedInvoice } = recordCustomerPayment(tenantId, {
      invoiceId, receiptDate, paymentMethod, paymentReference, amount, notes, bankAccountId,
    })

    res.status(201).json({
      success: true,
      data: { receipt, invoice: updatedInvoice },
      message: 'Payment recorded successfully'
    })
  } catch (error) {
    if (error instanceof SalesBillingError) {
      return res.status(RECEIPT_ERROR_STATUS[error.code] || 400).json({ success: false, message: error.message })
    }
    console.error('Create receipt error:', error)
    res.status(500).json({ success: false, message: 'Failed to record payment' })
  }
})

// DELETE /:id — reverse (void) a receipt: reverses its journal + restores the invoice
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    if (!['ADMIN', 'MANAGER', 'MASTER'].includes(req.user!.role)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ยกเลิกใบเสร็จรับเงิน — ต้องเป็น ADMIN/MANAGER/MASTER' })
    }
    const tenantId = req.user!.tenantId
    const receipt = db.prepare('SELECT * FROM receipts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!receipt) return res.status(404).json({ success: false, message: 'Receipt not found' })
    db.transaction(() => { voidReceipt(tenantId, receipt) })()
    res.json({ success: true, message: 'Receipt reversed' })
  } catch (error: any) {
    console.error('Void receipt error:', error)
    res.status(500).json({ success: false, message: error?.message || 'Failed to reverse receipt' })
  }
})

export default router
