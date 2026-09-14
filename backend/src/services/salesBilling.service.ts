import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
import { createSalesJournal } from '../routes/sales/shared'

/**
 * ตรรกะ "ออกใบแจ้งหนี้จาก SO" และ "รับชำระเงิน" ยกออกมาจาก routes/sales/invoices.ts และ
 * routes/sales/receipts.ts (ตัวที่ครบสุด — มีอยู่ที่เดียวอยู่แล้ว ไม่มีสำเนา MCP เดิม) เพื่อให้
 * ทั้ง REST และ mcp/tools/salesBilling.ts เรียกตัวเดียวกัน — แพทเทิร์นเดียวกับ
 * services/goodsReceipt.service.ts (ดูคอมเมนต์บนสุดของไฟล์นั้น)
 *
 * บั๊กที่แก้ไปด้วยตรงนี้ (2026-09-14):
 *  1) ออกใบแจ้งหนี้ซ้ำจาก SO เดิมได้ — REST/Sales.tsx เดิมไม่กันเลย กด 2 ครั้งได้ 2 ใบ =
 *     รายได้ลงบัญชีซ้ำ สอง INVOICE journal. ตอนนี้เช็ค findActiveInvoiceForSO() ก่อนสร้างเสมอ.
 *  2) รับชำระกับใบแจ้งหนี้ที่ถูกยกเลิกไปแล้วได้ — receipts.ts เดิมไม่เช็ค invoice.status เลย,
 *     เช็คแค่ยอดไม่เกิน balance_amount (ซึ่งหลังยกเลิกมักไม่เป็น 0) ตอนนี้บล็อกไว้ชัดเจน.
 */

export class SalesBillingError extends Error {
  constructor(
    public code:
      | 'SO_NOT_FOUND'
      | 'DUPLICATE_INVOICE'
      | 'CURRENCY_NOT_FOUND'
      | 'INVALID_EXCHANGE_RATE'
      | 'INVOICE_NOT_FOUND'
      | 'INVOICE_CANCELLED'
      | 'INVALID_AMOUNT'
      | 'OVER_BALANCE',
    message: string
  ) {
    super(message)
  }
}

export interface CreateInvoicePayload {
  salesOrderId: string
  dueDate?: string | null
  notes?: string
  currencyCode?: string
  exchangeRate?: number
  foreignAmount?: number
}

/** ใบแจ้งหนี้ของ SO นี้ที่ยังไม่ถูกยกเลิก — มีอยู่แล้วห้ามออกซ้ำ (ยกเลิกใบเดิมก่อนถ้าจะออกใหม่) */
export function findActiveInvoiceForSO(tenantId: string, salesOrderId: string): any {
  return db.prepare(
    "SELECT * FROM invoices WHERE tenant_id = ? AND sales_order_id = ? AND status != 'CANCELLED'"
  ).get(tenantId, salesOrderId)
}

/** ออกใบแจ้งหนี้จากคำสั่งขาย (ทั้งใบ — ยังไม่มี partial-billing ต่องวดส่งของในระบบนี้) */
export function createInvoiceFromSO(tenantId: string, payload: CreateInvoicePayload) {
  const { salesOrderId, dueDate, notes, currencyCode, exchangeRate, foreignAmount } = payload
  if (!salesOrderId) throw new SalesBillingError('SO_NOT_FOUND', 'Sales order is required')

  // กันออกใบซ้ำ — ต้องเช็คก่อนสิ่งอื่นทั้งหมด ไม่ใช่แค่กันที่ frontend
  const existing = findActiveInvoiceForSO(tenantId, salesOrderId)
  if (existing) {
    throw new SalesBillingError(
      'DUPLICATE_INVOICE',
      `SO นี้มีใบแจ้งหนี้ ${existing.invoice_number} (สถานะ ${existing.status}) อยู่แล้ว ออกซ้ำไม่ได้ — ยกเลิกใบเดิมก่อนถ้าต้องออกใหม่`
    )
  }

  // ponytail: invoice totals (subtotal/tax/total) are derived from the linked sales order,
  // not entered ad hoc — currency is pass-through metadata computed by the caller; THB
  // fields stay authoritative, keeping THB invoices byte-identical to before this existed.
  let currency_code = 'THB'
  let exchange_rate = 1
  let foreign_amount: number | null = null
  if (currencyCode && currencyCode !== 'THB') {
    const currency = db.prepare('SELECT code FROM currencies WHERE tenant_id = ? AND code = ? AND is_active = 1')
      .get(tenantId, currencyCode) as { code: string } | undefined
    if (!currency) throw new SalesBillingError('CURRENCY_NOT_FOUND', 'ไม่พบสกุลเงินที่ระบุ หรือสกุลเงินถูกปิดใช้งาน')
    const rate = Number(exchangeRate)
    if (!Number.isFinite(rate) || rate <= 0) throw new SalesBillingError('INVALID_EXCHANGE_RATE', 'อัตราแลกเปลี่ยนไม่ถูกต้อง')
    currency_code = currencyCode
    exchange_rate = rate
    const fa = Number(foreignAmount)
    foreign_amount = Number.isFinite(fa) ? fa : null
  }

  const salesOrder = db.prepare(`
    SELECT so.*, c.id as customer_id, c.name as customer_name, c.tax_id as customer_tax_id
    FROM sales_orders so
    JOIN customers c ON so.customer_id = c.id
    WHERE so.id = ? AND so.tenant_id = ?
  `).get(salesOrderId, tenantId) as any
  if (!salesOrder) throw new SalesBillingError('SO_NOT_FOUND', 'Sales order not found')

  const id = generateId()
  const invoiceNumber = formatDocumentNumber('INV', tenantId, 'INVOICE', new Date().getFullYear(), 5)
  const now = new Date().toISOString()

  const salesOrderItems = db.prepare('SELECT * FROM sales_order_items WHERE sales_order_id = ?').all(salesOrderId) as any[]

  db.transaction(() => {
    db.prepare(`
      INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, invoice_date, due_date,
        subtotal, discount_amount, tax_rate, tax_amount, total_amount, balance_amount, status, payment_status, notes, created_at, updated_at,
        currency_code, exchange_rate, foreign_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'UNPAID', ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, invoiceNumber, salesOrderId, salesOrder.customer_id, now, dueDate || null,
      salesOrder.subtotal, salesOrder.discount_amount, salesOrder.tax_rate, salesOrder.tax_amount,
      salesOrder.total_amount, salesOrder.total_amount, notes || '', now, now,
      currency_code, exchange_rate, foreign_amount)

    const insertItem = db.prepare(`
      INSERT INTO invoice_items (id, tenant_id, invoice_id, sales_order_item_id, stock_item_id, product_id, product_name, quantity, unit_price, total_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const item of salesOrderItems) {
      insertItem.run(generateId(), tenantId, id, item.id,
        item.stock_item_id || null, null, item.product_name || null,
        item.quantity, item.unit_price, item.total_price)
    }

    if ((salesOrder.tax_amount || 0) > 0) {
      db.prepare(`
        INSERT INTO vat_entries (id, tenant_id, document_type, document_id, document_number, document_date, party_name, party_tax_id, base_amount, vat_rate, vat_amount, total_amount, is_input_vat, is_output_vat, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
      `).run(generateId(), tenantId, 'INVOICE', id, invoiceNumber, now.substring(0, 10),
        salesOrder.customer_name || '', salesOrder.customer_tax_id || null,
        salesOrder.subtotal, salesOrder.tax_rate || 7, salesOrder.tax_amount, salesOrder.total_amount, now)
    }
  })()

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
  const invoiceItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(id)

  // Journal: DR ลูกหนี้การค้า / CR รายได้ขาย + ภาษีขาย (ลงครั้งเดียวตอนออกใบแจ้งหนี้)
  createSalesJournal(tenantId, 'INVOICE', id,
    `ขายสินค้า INV ${invoiceNumber}`,
    salesOrder.total_amount, salesOrder.tax_amount || 0,
    undefined, invoiceNumber, salesOrder.so_number)

  return { invoice, items: invoiceItems }
}

export interface RecordPaymentPayload {
  invoiceId: string
  receiptDate?: string
  paymentMethod?: string
  paymentReference?: string
  amount: number
  notes?: string
  bankAccountId?: string | null
}

/** รับชำระเงินจากลูกค้าเข้าใบแจ้งหนี้ — รับเต็มหรือบางส่วนได้ */
export function recordCustomerPayment(tenantId: string, payload: RecordPaymentPayload) {
  const { invoiceId, receiptDate, paymentMethod, paymentReference, amount, notes, bankAccountId } = payload
  if (!invoiceId || !amount || amount <= 0) {
    throw new SalesBillingError('INVALID_AMOUNT', 'ต้องระบุใบแจ้งหนี้และจำนวนเงินที่มากกว่า 0')
  }

  const invoice = db.prepare(`
    SELECT i.*, so.so_number, i.invoice_number
    FROM invoices i
    LEFT JOIN sales_orders so ON i.sales_order_id = so.id
    WHERE i.id = ? AND i.tenant_id = ?
  `).get(invoiceId, tenantId) as any
  if (!invoice) throw new SalesBillingError('INVOICE_NOT_FOUND', 'Invoice not found')

  // เดิม REST ไม่เช็คจุดนี้เลย — ใบแจ้งหนี้ที่ถูกยกเลิก (journal ถูกกลับรายการแล้ว) ยังรับ
  // ชำระซ้ำได้ เพราะ balance_amount หลังยกเลิกมักไม่ใช่ 0 (voidReceipt คืนมันกลับไปที่ total)
  if (invoice.status === 'CANCELLED') {
    throw new SalesBillingError('INVOICE_CANCELLED', 'ใบแจ้งหนี้นี้ถูกยกเลิกไปแล้ว รับชำระไม่ได้')
  }

  if (amount > invoice.balance_amount) {
    throw new SalesBillingError('OVER_BALANCE', `ยอดชำระ (${amount}) เกินยอดค้าง (${invoice.balance_amount})`)
  }

  const id = generateId()
  const receiptNumber = formatDocumentNumber('RC', tenantId, 'RECEIPT', new Date().getFullYear(), 5)
  const now = new Date().toISOString()
  const date = receiptDate || now

  const newPaid = invoice.paid_amount + amount
  const newBalance = invoice.total_amount - newPaid
  // สถานะจริงในระบบนี้คือ DRAFT/ISSUED/PAID/PARTIAL/OVERDUE/CANCELLED — ไม่มี PARTIALLY_PAID
  let paymentStatus = 'PARTIAL'
  let invoiceStatus = 'PARTIAL'
  if (newBalance <= 0) {
    paymentStatus = 'PAID'
    invoiceStatus = 'PAID'
  }

  db.transaction(() => {
    db.prepare(`
      INSERT INTO receipts (id, tenant_id, receipt_number, invoice_id, customer_id, receipt_date, payment_method,
        payment_reference, amount, notes, bank_account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, receiptNumber, invoiceId, invoice.customer_id, date, paymentMethod || 'CASH',
      paymentReference || '', amount, notes || '', bankAccountId || null, now, now)

    db.prepare(`
      UPDATE invoices SET paid_amount = ?, balance_amount = ?, payment_status = ?, status = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(newPaid, newBalance, paymentStatus, invoiceStatus, now, invoiceId, tenantId)

    db.prepare("UPDATE sales_orders SET payment_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(paymentStatus, now, invoice.sales_order_id, tenantId)
  })()

  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
  const updatedInvoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(invoiceId, tenantId) as any

  // Journal: DR เงินสด/ธนาคาร / CR ลูกหนี้การค้า (ลงคนละชุดจากตอนออกใบแจ้งหนี้ ไม่ซ้ำกัน)
  createSalesJournal(tenantId, 'RECEIPT', id,
    `รับชำระเงิน ${receiptNumber} (${paymentMethod || 'CASH'})`,
    amount, 0, paymentMethod, receiptNumber, invoice.so_number, bankAccountId || null)

  return { receipt, invoice: updatedInvoice, previousBalance: invoice.balance_amount, previousPaid: invoice.paid_amount }
}
