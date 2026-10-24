import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { generateId, formatDocumentNumber } from '../../utils/id'
import { gateSalesCancel, pendingCancelBody, assertInvoiceCancellable, cancelInvoiceNow, SalesCancelError } from '../../services/salesCancel.service'
import { recordAutoAction } from '../../services/approvalGate.service'
import { getOrCreateReceiptToken, buildReceiptUrl, buildReceiptQr } from '../../utils/receiptToken'
import { createInvoiceFromSO, SalesBillingError } from '../../services/salesBilling.service'
import { canHandleBilling } from '../../services/rbac.service'
import { creditNoteCreditableRemaining } from './creditNotes'

// Additive multi-currency columns. Guarded so it only runs once per fresh DB, same
// pattern as tax.routes.ts's wht_form column.
function ensureInvoiceCurrencyColumns() {
  try {
    const columns = db.prepare('PRAGMA table_info(invoices)').all() as { name: string }[]
    const names = new Set(columns.map((c) => c.name))
    if (!names.has('currency_code')) db.exec("ALTER TABLE invoices ADD COLUMN currency_code TEXT DEFAULT 'THB'")
    if (!names.has('exchange_rate')) db.exec('ALTER TABLE invoices ADD COLUMN exchange_rate REAL DEFAULT 1')
    if (!names.has('foreign_amount')) db.exec('ALTER TABLE invoices ADD COLUMN foreign_amount REAL')
  } catch (error) {
    console.error('Failed to ensure invoice currency columns:', error)
  }
}
ensureInvoiceCurrencyColumns()

const router = Router()

// GET all invoices
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const invoices = db.prepare(`
      SELECT i.*, c.name as customer_name, c.code as customer_code,
        so.so_number, pb.bill_number as pos_bill_number
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id AND c.tenant_id = i.tenant_id
      LEFT JOIN sales_orders so ON i.sales_order_id = so.id AND so.tenant_id = i.tenant_id
      LEFT JOIN pos_running_bills pb ON i.pos_bill_id = pb.id AND pb.tenant_id = i.tenant_id
      WHERE i.tenant_id = ?
      ORDER BY i.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: invoices })
  } catch (error) {
    console.error('Get invoices error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch invoices' })
  }
})

// GET single invoice
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const invoice = db.prepare(`
      SELECT i.*, c.name as customer_name, c.code as customer_code, c.tax_id as customer_tax_id, c.address as customer_address, c.email as customer_email, c.phone as customer_phone,
        c.tax_branch as customer_tax_branch, so.so_number, pb.bill_number as pos_bill_number
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id AND c.tenant_id = i.tenant_id
      LEFT JOIN sales_orders so ON i.sales_order_id = so.id AND so.tenant_id = i.tenant_id
      LEFT JOIN pos_running_bills pb ON i.pos_bill_id = pb.id AND pb.tenant_id = i.tenant_id
      WHERE i.id = ? AND i.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' })
    }

    const items = db.prepare(`
      -- ห้ามใช้ p.name as product_name เฉย ๆ: ชื่อคอลัมน์ซ้ำกับ ii.* แล้วตัวหลังทับตัวหน้า
      -- = เอา null ไปทับชื่อสินค้าจริงในแถว (invoice_items ไม่มีคอลัมน์อื่นให้ fallback)
      SELECT ii.*, COALESCE(si.name, ii.product_name) as product_name, si.sku as product_code
      FROM invoice_items ii
      LEFT JOIN stock_items si ON ii.stock_item_id = si.id AND si.tenant_id = ii.tenant_id
      WHERE ii.invoice_id = ? AND ii.tenant_id = ?
    `).all(req.params.id, tenantId)

    const receipts = db.prepare(`
      SELECT r.* FROM receipts r WHERE r.invoice_id = ? AND r.tenant_id = ? ORDER BY r.created_at DESC
    `).all(req.params.id, tenantId)

    const withholdingTax = db.prepare(`
      SELECT * FROM withholding_tax WHERE invoice_id = ? AND tenant_id = ?
    `).all(req.params.id, tenantId)

    const attachments = db.prepare(`
      SELECT * FROM invoice_attachments WHERE invoice_id = ? AND tenant_id = ? ORDER BY created_at ASC
    `).all(req.params.id, tenantId)

    // Paperless receipt: lazily mint/reuse a public share token + QR for this invoice
    const receiptToken = getOrCreateReceiptToken('invoice', req.params.id, tenantId)
    const receipt_url = buildReceiptUrl(receiptToken)
    const receipt_qr = await buildReceiptQr(receiptToken)

    // ยอดลดหนี้ที่ยังออกได้อีก (มูลค่าใบแจ้งหนี้ − ใบลดหนี้ที่ไม่ถูกยกเลิกทั้งหมด) — ให้หน้าสร้างใบลดหนี้
    // ใช้เป็น max ของช่องกรอกยอด แทนการเพิ่ม endpoint ใหม่ (ตรรกะเดียวกับ creditNotes.ts ที่ใช้ตรวจจริง)
    const creditable_remaining = creditNoteCreditableRemaining(tenantId, req.params.id)

    res.json({ success: true, data: { ...invoice, items, receipts, withholdingTax, attachments, receipt_url, receipt_qr, creditable_remaining } })
  } catch (error) {
    console.error('Get invoice error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch invoice' })
  }
})

// Map SalesBillingError codes → HTTP status. DUPLICATE_INVOICE uses 409 (conflict) so
// the frontend can tell "already exists" apart from a plain validation error (400).
const INVOICE_ERROR_STATUS: Record<string, number> = {
  SO_NOT_FOUND: 404,
  DUPLICATE_INVOICE: 409,
  CURRENCY_NOT_FOUND: 400,
  INVALID_EXCHANGE_RATE: 400,
}

// POST create invoice from sales order
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canHandleBilling(req.user!, 'sales')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ทำรายการนี้ — ต้องอยู่ฝ่ายขาย/ฝ่ายบัญชี หรือเป็น ADMIN/MASTER' })
    }
    const { salesOrderId, dueDate, notes, currencyCode, exchangeRate, foreignAmount } = req.body

    if (!salesOrderId) {
      return res.status(400).json({ success: false, message: 'Sales order is required' })
    }

    // ตรรกะจริงอยู่ที่ services/salesBilling.service.ts (ใช้ร่วมกับ MCP create_sales_invoice)
    // รวมถึงการกันออกใบแจ้งหนี้ซ้ำจาก SO เดิม (บั๊กที่ยืนยันแล้ว 2026-09-14)
    const { invoice, items } = createInvoiceFromSO(tenantId, {
      salesOrderId, dueDate, notes, currencyCode, exchangeRate, foreignAmount,
    })

    res.status(201).json({ success: true, data: { ...invoice, items } })
  } catch (error) {
    if (error instanceof SalesBillingError) {
      return res.status(INVOICE_ERROR_STATUS[error.code] || 400).json({ success: false, message: error.message })
    }
    console.error('Create invoice error:', error)
    res.status(500).json({ success: false, message: 'Failed to create invoice' })
  }
})

// PUT update invoice status
// PAID/PARTIAL ตั้งได้จากการรับชำระ (receipts) เท่านั้น · PAID และ CANCELLED เป็นสถานะสุดท้าย
// CANCELLED ต้องผ่านประตูอนุมัติ 'sales_cancel' (services/salesCancel.service.ts)
const INVOICE_NEXT_STATUS: Record<string, string[]> = {
  DRAFT: ['ISSUED', 'CANCELLED'],
  ISSUED: ['OVERDUE', 'CANCELLED'],
  OVERDUE: ['ISSUED', 'CANCELLED'],
  PARTIAL: ['OVERDUE', 'CANCELLED'],
  // ใบกำกับจากบิล POS เกิดมาเป็น PAID (เอกสารล้วน) — ยกเลิกได้ ที่เหลือ assertInvoiceCancellable ตัดสิน
  PAID: ['CANCELLED'],
  CANCELLED: [],
}

router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['DRAFT', 'ISSUED', 'PAID', 'PARTIAL', 'OVERDUE', 'CANCELLED']

    if (!canHandleBilling(req.user!, 'sales')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ทำรายการนี้ — ต้องอยู่ฝ่ายขาย/ฝ่ายบัญชี หรือเป็น ADMIN/MASTER' })
    }

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const existing = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Invoice not found' })
    }

    // ยิงสถานะเดิมซ้ำ = no-op
    if (status === existing.status) {
      return res.json({ success: true, data: existing })
    }
    if (!(INVOICE_NEXT_STATUS[existing.status] || []).includes(status)) {
      return res.status(400).json({
        success: false, code: 'INVALID_STATUS_TRANSITION',
        message: ['PAID', 'PARTIAL'].includes(status)
          ? 'สถานะชำระเงินเปลี่ยนได้จากการรับชำระ (ใบเสร็จรับเงิน) เท่านั้น'
          : `เปลี่ยนสถานะใบแจ้งหนี้จาก ${existing.status} เป็น ${status} ไม่ได้`,
      })
    }

    if (status === 'CANCELLED') {
      if (!['ADMIN', 'MANAGER', 'MASTER', 'OWNER'].includes(req.user!.role)) {
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ยกเลิกใบแจ้งหนี้ — ต้องเป็น ADMIN/MANAGER/MASTER' })
      }
      // ยกเลิกไม่ได้อยู่แล้ว (มีใบลดหนี้ที่ออกแล้ว ฯลฯ) → บอกเลย ไม่สร้างคำขอที่อนุมัติไม่ผ่าน
      assertInvoiceCancellable(tenantId, existing)
      // การยกเลิกจริง (void ใบเสร็จ + กลับ journal เฉพาะใบที่ไม่ได้มาจากบิล POS) อยู่ใน cancelInvoiceNow
      // ใช้ตัวเดียวกันทั้งตอนผู้อนุมัติทำเองและตอนอนุมัติคำขอ (routes/approval.routes.ts)
      const { pending, gateArgs } = gateSalesCancel({
        tenantId, user: req.user! as any, kind: 'invoice', refId: existing.id, docNumber: existing.invoice_number,
        docDate: existing.invoice_date || existing.created_at, amount: existing.total_amount, reason: req.body.reason,
      })
      if (pending) return res.status(202).json(pendingCancelBody(pending, existing.invoice_number))
      const invoice = cancelInvoiceNow(tenantId, existing.id)
      recordAutoAction(gateArgs)
      return res.json({ success: true, data: invoice })
    }

    const now = new Date().toISOString()
    db.prepare("UPDATE invoices SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(status, now, req.params.id, tenantId)

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: invoice })
  } catch (error) {
    if (error instanceof SalesCancelError) {
      return res.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Update invoice status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// POST add withholding tax to invoice
router.post('/:id/withholding-tax', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    if (!canHandleBilling(req.user!, 'sales')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ทำรายการนี้ — ต้องอยู่ฝ่ายขาย/ฝ่ายบัญชี หรือเป็น ADMIN/MASTER' })
    }
    const { taxType, description } = req.body
    // เดิมรับค่าดิบจาก body — base/rate ติดลบ/ไม่ใช่ตัวเลข/อัตรา 100% ก็ลงได้ ยอดสุทธิใบแจ้งหนี้เพี้ยน
    const taxBase = Math.round(Number(req.body.taxBase) * 100) / 100
    const taxRate = Number(req.body.taxRate)
    if (!Number.isFinite(taxBase) || taxBase <= 0) {
      return res.status(400).json({ success: false, message: 'ฐานภาษีหัก ณ ที่จ่ายต้องเป็นตัวเลขมากกว่า 0' })
    }
    // อัตราตามกฎหมาย 1/1.5/2/3/5/10/15% — รับช่วง 0 < อัตรา ≤ 15
    if (!Number.isFinite(taxRate) || taxRate <= 0 || taxRate > 15) {
      return res.status(400).json({ success: false, message: 'อัตราภาษีหัก ณ ที่จ่ายต้องมากกว่า 0 และไม่เกิน 15%' })
    }

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' })
    }
    if (invoice.status === 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'ใบแจ้งหนี้นี้ถูกยกเลิกแล้ว' })
    }
    if (taxBase > Number(invoice.total_amount || 0) + 0.005) {
      return res.status(400).json({ success: false, message: 'ฐานภาษีหัก ณ ที่จ่ายเกินยอดใบแจ้งหนี้' })
    }

    const id = generateId()
    const taxAmount = Math.round(taxBase * taxRate) / 100
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO withholding_tax (id, tenant_id, invoice_id, tax_type, tax_rate, tax_base, tax_amount, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, req.params.id, taxType, taxRate, taxBase, taxAmount, description || '', now)

    // Update invoice net amount (deduct withholding tax)
    const whtTotal = (db.prepare('SELECT COALESCE(SUM(tax_amount), 0) as total FROM withholding_tax WHERE invoice_id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any).total
    const netAmount = invoice.total_amount - whtTotal

    res.json({
      success: true,
      data: {
        withholdingTax: { id, taxType, taxRate, taxBase, taxAmount },
        invoiceTotal: invoice.total_amount,
        withholdingTaxTotal: whtTotal,
        netAmount: netAmount
      }
    })
  } catch (error) {
    console.error('Add withholding tax error:', error)
    res.status(500).json({ success: false, message: 'Failed to add withholding tax' })
  }
})

// GET withholding tax for invoice
router.get('/:id/withholding-tax', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const wht = db.prepare(`
      SELECT * FROM withholding_tax WHERE invoice_id = ? AND tenant_id = ?
    `).all(req.params.id, tenantId)

    res.json({ success: true, data: wht })
  } catch (error) {
    console.error('Get withholding tax error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch withholding tax' })
  }
})

export default router
