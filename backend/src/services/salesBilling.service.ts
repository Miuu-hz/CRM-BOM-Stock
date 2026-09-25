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
      | 'OVER_BALANCE'
      | 'POS_BILL_NOT_FOUND'
      | 'POS_BILL_NOT_PAID'
      | 'POS_BILL_CANCELLED'
      | 'CUSTOMER_REQUIRED'
      | 'CUSTOMER_NOT_FOUND'
  | 'SELLER_TAX_ID_REQUIRED',
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

/** ใบกำกับภาษีของบิล POS นี้ที่ยังไม่ถูกยกเลิก — มีอยู่แล้วห้ามออกซ้ำ (เหมือน findActiveInvoiceForSO) */
export function findActiveInvoiceForPosBill(tenantId: string, posBillId: string): any {
  return db.prepare(
    "SELECT * FROM invoices WHERE tenant_id = ? AND pos_bill_id = ? AND status != 'CANCELLED'"
  ).get(tenantId, posBillId)
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
        subtotal, discount_amount, extra_charge_amount, extra_charge_label, tax_rate, tax_amount, total_amount, vat_inclusive, balance_amount, status, payment_status, notes, created_at, updated_at,
        currency_code, exchange_rate, foreign_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'UNPAID', ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, invoiceNumber, salesOrderId, salesOrder.customer_id, now, dueDate || null,
      salesOrder.subtotal, salesOrder.discount_amount,
      salesOrder.extra_charge_amount || 0, salesOrder.extra_charge_label || null,
      salesOrder.tax_rate, salesOrder.tax_amount,
      // ใบแจ้งหนี้เป็นเอกสารต่อจากใบสั่งขาย ยอดคัดลอกมาทั้งชุด ธงโหมด VAT จึงต้องตามมาด้วย
      salesOrder.total_amount, salesOrder.vat_inclusive ?? 0, salesOrder.total_amount, notes || '', now, now,
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
    // ค่าขนส่ง/ค่าบริการอื่นต้องมีบรรทัดของตัวเองบนใบกำกับ ไม่งั้นผลรวมรายการไม่เท่าหัวใบ
    // (ม.79 ค่าขนส่งที่ผู้ขายเรียกเก็บอยู่ในฐานภาษี ต้องแสดงให้ลูกค้าเห็น)
    if ((salesOrder.extra_charge_amount || 0) > 0) {
      insertItem.run(generateId(), tenantId, id, null, null, null,
        salesOrder.extra_charge_label || 'ค่าขนส่ง',
        1, salesOrder.extra_charge_amount, salesOrder.extra_charge_amount)
    }

    if ((salesOrder.tax_amount || 0) > 0) {
      db.prepare(`
        INSERT INTO vat_entries (id, tenant_id, document_type, document_id, document_number, document_date, party_name, party_tax_id, base_amount, vat_rate, vat_amount, total_amount, is_input_vat, is_output_vat, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
      `).run(generateId(), tenantId, 'INVOICE', id, invoiceNumber, now.substring(0, 10),
        salesOrder.customer_name || '', salesOrder.customer_tax_id || null,
        salesOrder.subtotal, salesOrder.tax_rate || 7, salesOrder.tax_amount, salesOrder.total_amount, now)
    }

    // Journal: DR ลูกหนี้การค้า / CR รายได้ขาย + ภาษีขาย (ลงครั้งเดียวตอนออกใบแจ้งหนี้)
    // อยู่ในทรานแซกชันเดียวกับการสร้างเอกสาร — createSalesJournal throw ออกมาถ้าลงไม่ได้ (ดุลหลุด/
    // DB error) ตอนนี้แล้ว ต้อง rollback ใบแจ้งหนี้ที่เพิ่งสร้างไปด้วย ไม่ใช่ปล่อยให้ออกเอกสารสำเร็จ
    // ทั้งที่บัญชีไม่ลง (เคยทำให้เงิน ฿34,026 หายจากงบมาแล้ว)
    createSalesJournal(tenantId, 'INVOICE', id,
      `ขายสินค้า INV ${invoiceNumber}`,
      salesOrder.total_amount, salesOrder.tax_amount || 0,
      undefined, invoiceNumber, salesOrder.so_number)
  })()

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
  const invoiceItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(id)

  return { invoice, items: invoiceItems }
}

export interface CreateInvoiceFromPosBillPayload {
  posBillId: string
  customerId: string
  notes?: string
}

/**
 * ออกใบกำกับภาษีจากบิล POS ที่ปิดบิลแล้ว — "เอกสารล้วน" ห้ามลงบัญชี/VAT/สต็อกซ้ำเด็ดขาด
 * เพราะตอนปิดบิล POS (pos-accounting.service.ts recordSale()) ลง journal ไปแล้ว
 * (Dr 1180 พัก POS / Cr รายได้ขาย / Cr ภาษีขาย + Dr ต้นทุนขาย / Cr สินค้าคงคลัง),
 * tax.routes.ts syncVatOutputFromPosBills() เก็บ VAT ขายไปแล้ว, และ pos-stock.service.ts
 * ตัดสต็อกไปแล้ว — ถ้าฟังก์ชันนี้ลงซ้ำอีก รายได้/VAT จะเบิ้ล
 */
export function createInvoiceFromPosBill(tenantId: string, payload: CreateInvoiceFromPosBillPayload) {
  const { posBillId, customerId, notes } = payload
  if (!posBillId) throw new SalesBillingError('POS_BILL_NOT_FOUND', 'POS bill is required')

  // กันออกซ้ำก่อนอย่างอื่นทั้งหมด — เหมือน createInvoiceFromSO ข้างบน
  const existingInvoice = findActiveInvoiceForPosBill(tenantId, posBillId)
  if (existingInvoice) {
    const existingBill = db.prepare('SELECT bill_number FROM pos_running_bills WHERE id = ? AND tenant_id = ?')
      .get(posBillId, tenantId) as any
    throw new SalesBillingError(
      'DUPLICATE_INVOICE',
      `บิล ${existingBill?.bill_number || posBillId} มีใบกำกับ ${existingInvoice.invoice_number} (สถานะ ${existingInvoice.status}) อยู่แล้ว ออกซ้ำไม่ได้ — ยกเลิกใบเดิมก่อนถ้าต้องออกใหม่`
    )
  }

  const bill = db.prepare('SELECT * FROM pos_running_bills WHERE id = ? AND tenant_id = ?').get(posBillId, tenantId) as any
  if (!bill) throw new SalesBillingError('POS_BILL_NOT_FOUND', 'ไม่พบบิล POS นี้')
  if (bill.status === 'CANCELLED') throw new SalesBillingError('POS_BILL_CANCELLED', 'บิลนี้ถูกยกเลิกไปแล้ว ออกใบกำกับไม่ได้')
  // เงื่อนไขพิเศษที่เจ้าของงานสั่งมาโดยเฉพาะ: ออกใบกำกับได้เฉพาะบิลที่คิดเงินแล้วเท่านั้น
  if (bill.status !== 'PAID') throw new SalesBillingError('POS_BILL_NOT_PAID', 'ออกใบกำกับได้เฉพาะบิลที่ชำระเงินแล้ว')

  // ใบกำกับภาษีเต็มรูปต้องมีเลขประจำตัวผู้เสียภาษี + สาขาของ "ผู้ขาย" (ประมวลรัษฎากร ม.86/4)
  // ออกไปโดยไม่มีสองอย่างนี้ = ใบกำกับไม่สมบูรณ์ ลูกค้าเอาไปใช้ไม่ได้ ต้องบล็อกตั้งแต่ต้นทาง
  const company = db.prepare('SELECT name, tax_id, tax_branch, pos_vat_inclusive FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
  if (!company?.tax_id || !String(company.tax_id).trim()) {
    throw new SalesBillingError(
      'SELLER_TAX_ID_REQUIRED',
      'ยังไม่ได้ตั้งเลขประจำตัวผู้เสียภาษีของกิจการ — ไปที่ ตั้งค่า > ข้อมูลบริษัท กรอกก่อนจึงจะออกใบกำกับภาษีได้'
    )
  }

  if (!customerId) throw new SalesBillingError('CUSTOMER_REQUIRED', 'ต้องระบุลูกค้าก่อนออกใบกำกับภาษี')
  const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND tenant_id = ?').get(customerId, tenantId) as any
  if (!customer) throw new SalesBillingError('CUSTOMER_NOT_FOUND', 'ไม่พบลูกค้ารายนี้')

  const id = generateId()
  const invoiceNumber = formatDocumentNumber('INV', tenantId, 'INVOICE', new Date().getFullYear(), 5)
  const now = new Date().toISOString()
  const invoiceDate = bill.closed_at || now

  const billItems = db.prepare(`
    SELECT bi.*, pmc.product_id AS stock_item_id
    FROM pos_bill_items bi
    LEFT JOIN pos_menu_configs pmc ON bi.pos_menu_id = pmc.id
    WHERE bi.bill_id = ? AND bi.tenant_id = ?
    ORDER BY bi.added_at ASC
  `).all(posBillId, tenantId) as any[]

  // การขายครั้งเดียวมีใบกำกับภาษีได้ใบเดียว — ใบเต็มรูปนี้ออกแทนใบกำกับอย่างย่อ (สลิป) ที่ลูกค้าได้ไปแล้ว
  // จึงต้องอ้างเลขใบย่อเดิมไว้บนใบเต็ม และสลิปใบเดิมจะเลิกเป็นใบกำกับภาษีทันที (ดู resolveBillType ฝั่ง frontend)
  const supersedeNote = [`ออกแทนใบกำกับภาษีอย่างย่อเลขที่ ${bill.bill_number}`, notes]
    .filter(Boolean).join(' · ')

  db.transaction(() => {
    // ⚠️ invoices ไม่มีคอลัมน์เก็บค่าบริการแยก ต้องบวก service_charge_amount เข้า subtotal
    // ไม่งั้น subtotal + tax_amount จะไม่เท่ากับ total_amount แล้วใบพิมพ์ออกมายอดไม่บาลานซ์
    const subtotal = (bill.subtotal || 0) + (bill.service_charge_amount || 0) + (bill.extra_charge_amount || 0)

    db.prepare(`
      INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, pos_bill_id, customer_id, invoice_date, due_date,
        subtotal, discount_amount, tax_rate, tax_amount, total_amount, vat_inclusive, paid_amount, balance_amount, status, payment_status, notes, created_at, updated_at,
        currency_code, exchange_rate, foreign_amount)
      VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, 'PAID', 'PAID', ?, ?, ?, 'THB', 1, NULL)
    `).run(id, tenantId, invoiceNumber, posBillId, customerId, invoiceDate,
      subtotal, bill.discount_amount || 0, bill.tax_rate || 0, bill.tax_amount || 0,
      // บิล POS ถอด VAT ออกจากราคาป้ายไปแล้วหรือยัง ขึ้นกับ pos_vat_inclusive ของกิจการ
      bill.total_amount, company?.pos_vat_inclusive === 1 ? 1 : 0, bill.total_amount, supersedeNote, now, now)

    const insertItem = db.prepare(`
      INSERT INTO invoice_items (id, tenant_id, invoice_id, sales_order_item_id, stock_item_id, product_id, product_name, quantity, unit_price, total_price)
      VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?)
    `)
    // โหมด "ราคารวม VAT" เก็บ bill.subtotal เป็นยอดหลังถอด VAT แล้ว แต่รายการยังเป็นราคาป้าย
    // ใบกำกับต้องแสดงราคาก่อน VAT จึงย่อทุกบรรทัดด้วยอัตราส่วนเดียวกัน
    // (โหมดปกติ bill.subtotal เท่ากับผลรวมรายการพอดี factor = 1 รายการจึงไม่ถูกแตะเลย)
    const lineGross = billItems.reduce((n, it) => n + (it.total_price || 0), 0)
    const factor = lineGross > 0 ? (bill.subtotal || 0) / lineGross : 1
    const r2 = (n: number) => Math.round(n * 100) / 100
    let allocated = 0
    billItems.forEach((item, idx) => {
      // บรรทัดสุดท้ายรับเศษที่เหลือ เพื่อให้ผลรวมรายการเท่ากับ subtotal ของหัวใบเป๊ะ
      const lineNet = idx === billItems.length - 1
        ? r2((bill.subtotal || 0) - allocated)
        : r2((item.total_price || 0) * factor)
      allocated = r2(allocated + lineNet)
      const qty = item.quantity || 1
      insertItem.run(generateId(), tenantId, id, item.stock_item_id || null, item.product_name, qty, r2(lineNet / qty), lineNet)
    })
    // ค่าบริการ/ค่าขนส่ง (ถ้ามี) ต้องมีรายการของตัวเองด้วย ไม่งั้นผลรวมรายการจะไม่เท่ากับ subtotal ของหัวใบ
    if ((bill.service_charge_amount || 0) > 0) {
      insertItem.run(generateId(), tenantId, id, null, `ค่าบริการ ${bill.service_charge_rate}%`, 1, bill.service_charge_amount, bill.service_charge_amount)
    }
    if ((bill.extra_charge_amount || 0) > 0) {
      insertItem.run(generateId(), tenantId, id, null, bill.extra_charge_label || 'ค่าขนส่ง', 1, bill.extra_charge_amount, bill.extra_charge_amount)
    }

    // เลขที่ใช้ยื่นภาษีขายต้องเป็นเลขใบกำกับภาษีเต็มรูป ไม่ใช่เลขบิล POS ที่ลงไว้ตอนปิดบิล
    // — ไม่ได้ลงภาษีเพิ่ม แค่เปลี่ยนเลขอ้างอิงของรายการเดิมให้ตรงกับเอกสารที่ลูกค้าถืออยู่
    db.prepare('UPDATE vat_entries SET document_number = ? WHERE tenant_id = ? AND document_id = ? AND is_output_vat = 1')
      .run(invoiceNumber, tenantId, posBillId)
    // tax_transactions เป็นตาราง derived (POST /tax/sync สร้างใหม่จากเอกสารต้นทาง) มีช่องของมันเองอยู่แล้ว
    db.prepare("UPDATE tax_transactions SET tax_invoice_number = ?, tax_invoice_date = ? WHERE tenant_id = ? AND source_type = 'POS_BILL' AND source_id = ?")
      .run(invoiceNumber, String(invoiceDate).slice(0, 10), tenantId, posBillId)

    // ❌❌ ห้ามเรียก createSalesJournal ห้าม insert vat_entries ห้ามแตะสต็อกตรงนี้เด็ดขาด ❌❌
    // pos-accounting.service.ts recordSale() ลงบัญชี (Dr 1180 พัก POS / Cr รายได้ขาย / Cr ภาษีขาย
    // + Dr ต้นทุนขาย / Cr สินค้าคงคลัง) และ pos-stock.service.ts ตัดสต็อกไปแล้วตั้งแต่ตอนปิดบิล POS
    // ใบกำกับนี้เป็นแค่เอกสารที่ออกซ้ำจากของที่ลงบัญชีไปแล้ว ถ้าลงบัญชี/VAT/สต็อกซ้ำตรงนี้อีก
    // รายได้จะเบิ้ล (double count)
  })()

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(id)

  return { invoice, items }
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

    // Journal: DR เงินสด/ธนาคาร / CR ลูกหนี้การค้า (ลงคนละชุดจากตอนออกใบแจ้งหนี้ ไม่ซ้ำกัน) — อยู่ใน
    // ทรานแซกชันเดียวกับการสร้างใบเสร็จ ด้วยเหตุผลเดียวกับตอนออกใบแจ้งหนี้ข้างบน
    createSalesJournal(tenantId, 'RECEIPT', id,
      `รับชำระเงิน ${receiptNumber} (${paymentMethod || 'CASH'})`,
      amount, 0, paymentMethod, receiptNumber, invoice.so_number, bankAccountId || null)
  })()

  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
  const updatedInvoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(invoiceId, tenantId) as any

  return { receipt, invoice: updatedInvoice, previousBalance: invoice.balance_amount, previousPaid: invoice.paid_amount }
}
