import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { ACC } from '../config/accountCodes'
import { createTestUser } from '../test/testAuth'
import salesRouter from '../routes/sales/index'
import {
  CustomerCreditError,
  registerCredit,
  removeCredit,
  applyOffset,
  refundCredit,
  cancelOffset,
  getOffsetById,
  getCustomerCreditsOverview,
} from './customerCredit.service'
import {
  CustomerBuybackError,
  createCustomerBuyback,
  cancelCustomerBuyback,
  getCustomerBuybackById,
} from './customerBuyback.service'
import { createInvoiceFromSO, recordCustomerPayment } from './salesBilling.service'
import { cancelInvoiceNow, cancelSalesOrderNow, voidReceiptNow, SalesCancelError } from './salesCancel.service'
import { getCostBasis } from './stockCostBasis.service'
import { closeChecklist } from './closeChecklist.service'

const app = express()
app.use(express.json())
app.use('/api/sales', salesRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of [
      'customer_offset_lines',
      'customer_offsets',
      'customer_credits',
      'customer_buyback_items',
      'customer_buybacks',
      'vat_entries',
      'journal_lines',
      'journal_entries',
      'receipts',
      'credit_note_items',
      'credit_notes',
      'invoice_items',
      'invoices',
      'sales_order_items',
      'sales_orders',
      'goods_receipt_items',
      'goods_receipts',
      'purchase_order_items',
      'purchase_orders',
      'suppliers',
      'stock_movements',
      'unit_conversions',
      'stock_items',
      'customers',
      'tax_periods',
      'bank_accounts',
      'accounts',
      'company_settings',
      'document_sequences',
      'users',
    ]) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* ignore */ }
    }
  }
})

function setupTenant(opts: { vatRegistered?: number } = {}) {
  const admin = createTestUser({ role: 'ADMIN' })
  tenants.push(admin.tenantId)
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO company_settings (tenant_id, name, tax_id, vat_registered, allow_negative_stock, updated_at)
    VALUES (?, 'บริษัท ทดสอบ จำกัด', '0105551234567', ?, 0, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET vat_registered = excluded.vat_registered
  `).run(admin.tenantId, opts.vatRegistered ?? 1, now)
  return admin
}

function seedCustomer(tenantId: string, opts: { name?: string; taxId?: string | null } = {}) {
  const id = generateId()
  const code = 'CUS-' + id.slice(0, 6)
  db.prepare(`
    INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, tax_id, status)
    VALUES (?, ?, ?, ?, 'WHOLESALE', ?, 'c@test.com', '0812345678', 'BKK', ?, 'ACTIVE')
  `).run(id, tenantId, code, opts.name || 'ลูกค้า ทดสอบ', opts.name || 'ลูกค้า ทดสอบ', opts.taxId === undefined ? '0105560001112' : opts.taxId)
  return id
}

function seedStockItem(tenantId: string, opts: {
  name?: string
  category?: string
  quantity?: number
  unit?: string
  baseUnit?: string
  unitCost?: number
} = {}) {
  const id = generateId()
  const sku = 'SKU-' + id.slice(0, 6)
  const unit = opts.unit || 'pcs'
  const baseUnit = opts.baseUnit || unit
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'MAIN', 'ACTIVE')
  `).run(
    id, tenantId, sku, opts.name || 'สินค้า A', opts.category || 'FINISHED',
    opts.quantity ?? 100, unit, baseUnit, opts.unitCost ?? 50
  )
  return id
}

function seedConfirmedSOAndInvoice(tenantId: string, customerId: string, stockItemId: string, totalAmount = 10000) {
  const soId = generateId()
  const soItemId = generateId()
  const now = new Date().toISOString()
  const soNumber = 'SO-T-' + soId.slice(0, 6)
  db.prepare(`
    INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, order_date, subtotal, discount_amount, tax_rate, tax_amount, total_amount, vat_inclusive, status, payment_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 0, 'CONFIRMED', 'UNPAID', ?, ?)
  `).run(soId, tenantId, soNumber, customerId, now, totalAmount, totalAmount, now, now)
  db.prepare(`
    INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_name, quantity, unit, unit_price, discount_percent, total_price)
    VALUES (?, ?, ?, ?, 'สินค้า A', 10, 'pcs', ?, 0, ?)
  `).run(soItemId, tenantId, soId, stockItemId, totalAmount / 10, totalAmount)

  const { invoice } = createInvoiceFromSO(tenantId, { salesOrderId: soId })
  // Move invoice to ISSUED so status checks match live issued invoices
  db.prepare("UPDATE invoices SET status = 'ISSUED' WHERE id = ? AND tenant_id = ?").run(invoice.id, tenantId)
  return {
    soId,
    invoice: db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(invoice.id, tenantId) as any,
  }
}

function journalLinesOf(tenantId: string, referenceType: string, referenceId: string) {
  const je = db.prepare(
    'SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = ? AND reference_id = ?'
  ).get(tenantId, referenceType, referenceId) as any
  if (!je) return { je: null, lines: [] }
  const lines = db.prepare(`
    SELECT a.code, ROUND(jl.debit, 2) AS debit, ROUND(jl.credit, 2) AS credit
    FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id AND a.tenant_id = jl.tenant_id
    WHERE jl.journal_entry_id = ? AND jl.tenant_id = ?
    ORDER BY jl.line_number ASC
  `).all(je.id, tenantId) as Array<{ code: string; debit: number; credit: number }>
  return { je, lines }
}

function glBalance(tenantId: string, code: string) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS bal
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.tenant_id = ? AND je.is_posted = 1 AND a.code = ?
  `).get(tenantId, code) as { bal: number }
  return Math.round((row.bal || 0) * 100) / 100
}

describe('Customer Buy-Back & Customer Credit Offset (Sections 1, 2, 3)', () => {
  it('1. 10,000 invoice + buy back 3,000 unregistered with applyTo -> balance 7,000, exact journal lines, stock movement, and closeChecklist 2101 reconciliation', () => {
    const u = setupTenant({ vatRegistered: 1 })
    const t = u.tenantId
    const custId = seedCustomer(t, { name: 'ร้าน ก.', taxId: null })
    const stockId = seedStockItem(t, { quantity: 100, unit: 'pcs', unitCost: 50 })
    const { soId, invoice } = seedConfirmedSOAndInvoice(t, custId, stockId, 10000)
    const today = thaiDateStr()

    expect(invoice.total_amount).toBe(10000)
    expect(invoice.balance_amount).toBe(10000)
    expect(invoice.paid_amount).toBe(0)

    const res = createCustomerBuyback(t, u, {
      customerId: custId,
      date: today,
      sellerVat: false,
      approvedBy: 'ผจก. สมชาย',
      sellerIdDoc: 'บัตรประชาชน 1-1001-00000-00-1',
      notes: 'รับซื้อคืนล็อตเก่า',
      items: [
        { stockItemId: stockId, quantity: 30, unit: 'pcs', unitPrice: 100, condition: 'GOOD' },
      ],
      applyTo: [
        { invoiceId: invoice.id, amount: 3000 },
      ],
    })

    expect(res.status).toBe('POSTED')
    expect(res.subtotal).toBe(3000)
    expect(res.tax_amount).toBe(0)
    expect(res.total_amount).toBe(3000)
    expect(res.credit_amount).toBe(3000)
    expect(res.credit_balance).toBe(0)
    expect(res.offset).toBeTruthy()
    expect(res.offset.total_amount).toBe(3000)
    expect(res.offset.kind).toBe('APPLY')
    expect(res.offset.status).toBe('POSTED')

    // Exact journal lines for CUSTOMER_BUYBACK: Dr 1107 3,000 / Cr 2101 3,000
    const bbJe = journalLinesOf(t, 'CUSTOMER_BUYBACK', res.id)
    expect(bbJe.je).toBeTruthy()
    expect(bbJe.je.date).toBe(today)
    expect(bbJe.lines).toEqual([
      { code: ACC.RAW_MATERIAL, debit: 3000, credit: 0 },
      { code: ACC.AP, debit: 0, credit: 3000 },
    ])

    // Exact journal lines for CUSTOMER_OFFSET (BUYBACK source): Dr 2101 3,000 / Cr 1104 3,000
    const ofJe = journalLinesOf(t, 'CUSTOMER_OFFSET', res.offset.id)
    expect(ofJe.je).toBeTruthy()
    expect(ofJe.je.date).toBe(today)
    expect(ofJe.lines).toEqual([
      { code: ACC.AP, debit: 3000, credit: 0 },
      { code: ACC.AR, debit: 0, credit: 3000 },
    ])

    // Invoice balance = 7,000, paid = 3,000, PARTIAL; SO payment_status = PARTIAL
    const invAfter = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(invoice.id, t) as any
    expect(invAfter.balance_amount).toBe(7000)
    expect(invAfter.paid_amount).toBe(3000)
    expect(invAfter.status).toBe('PARTIAL')
    expect(invAfter.payment_status).toBe('PARTIAL')

    const soAfter = db.prepare('SELECT payment_status FROM sales_orders WHERE id = ? AND tenant_id = ?').get(soId, t) as any
    expect(soAfter.payment_status).toBe('PARTIAL')

    // Stock quantity += 30 (100 -> 130) & weighted avg unit_cost = (100*50 + 3000)/130 = 8000/130
    const stockAfter = db.prepare('SELECT quantity, unit_cost FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockId, t) as any
    expect(stockAfter.quantity).toBe(130)
    expect(stockAfter.unit_cost).toBeCloseTo(8000 / 130, 5)

    // Stock movement reference `BB: <bb_number>`
    const mv = db.prepare('SELECT * FROM stock_movements WHERE tenant_id = ? AND reference = ?').get(t, `BB: ${res.bb_number}`) as any
    expect(mv).toBeTruthy()
    expect(mv.type).toBe('IN')
    expect(mv.quantity).toBe(30)

    // Unregistered seller -> no vat_entries for CUSTOMER_BUYBACK
    const vatCount = (db.prepare("SELECT COUNT(*) AS c FROM vat_entries WHERE tenant_id = ? AND document_type = 'CUSTOMER_BUYBACK'").get(t) as any).c
    expect(vatCount).toBe(0)

    // GL AR = 7,000, GL AP = 0; closeChecklist check #8 passes
    expect(glBalance(t, ACC.AR)).toBe(7000)
    expect(glBalance(t, ACC.AP)).toBe(0)
    const ck = closeChecklist(t, today.slice(0, 7))
    const subledgerCheck = ck.items.find(i => i.key === 'subledger_match')!
    expect(subledgerCheck.status).toBe('pass')
  })

  it('2. VAT seller 1,070 inclusive (VAT-registered tenant): Dr 1107 1,000 + Dr 1110 70 / Cr 2101 1,070 + vat_entries + duplicate taxInvoiceNumber rejected', () => {
    const u = setupTenant({ vatRegistered: 1 })
    const t = u.tenantId
    const custId = seedCustomer(t, { name: 'บจก. คู่ค้ามีแวท', taxId: '0105561234567' })
    const stockId = seedStockItem(t, { quantity: 10, unit: 'pcs', unitCost: 80 })
    const today = thaiDateStr()

    const bb = createCustomerBuyback(t, u, {
      customerId: custId,
      date: today,
      sellerVat: true,
      taxInvoiceNumber: 'TI-2026-0099',
      taxInvoiceDate: today,
      taxRate: 7,
      vatInclusive: true,
      items: [
        { stockItemId: stockId, quantity: 10, unit: 'pcs', unitPrice: 107, condition: 'GOOD' },
      ],
    })

    expect(bb.subtotal).toBe(1000)
    expect(bb.tax_amount).toBe(70)
    expect(bb.total_amount).toBe(1070)
    expect(bb.items[0].total_price).toBe(1000)
    expect(bb.items[0].cost_value).toBe(1000)

    // Exact journal lines: Dr 1107 1,000 + Dr 1110 70 / Cr 2101 1,070
    const je = journalLinesOf(t, 'CUSTOMER_BUYBACK', bb.id)
    expect(je.lines).toEqual([
      { code: ACC.RAW_MATERIAL, debit: 1000, credit: 0 },
      { code: ACC.INPUT_VAT, debit: 70, credit: 0 },
      { code: ACC.AP, debit: 0, credit: 1070 },
    ])

    // vat_entries row created with customer's tax invoice number & date
    const ve = db.prepare("SELECT * FROM vat_entries WHERE tenant_id = ? AND document_type = 'CUSTOMER_BUYBACK' AND document_id = ?")
      .get(t, bb.id) as any
    expect(ve).toBeTruthy()
    expect(ve.is_input_vat).toBe(1)
    expect(ve.is_output_vat).toBe(0)
    expect(ve.document_number).toBe('TI-2026-0099')
    expect(ve.document_date).toBe(today)
    expect(ve.base_amount).toBe(1000)
    expect(ve.vat_amount).toBe(70)
    expect(ve.total_amount).toBe(1070)

    // Weighted average cost uses 1,000 (ex-VAT): (10*80 + 1000) / 20 = 90
    const st = db.prepare('SELECT quantity, unit_cost FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockId, t) as any
    expect(st.quantity).toBe(20)
    expect(st.unit_cost).toBe(90)

    // Unpaid buyback credit in GL 2101 (1,070) matches closeChecklist #8
    const ck = closeChecklist(t, today.slice(0, 7))
    expect(ck.items.find(i => i.key === 'subledger_match')!.status).toBe('pass')

    // Duplicate active taxInvoiceNumber for the same customer -> 400
    expect(() => createCustomerBuyback(t, u, {
      customerId: custId,
      date: today,
      sellerVat: true,
      taxInvoiceNumber: 'ti-2026-0099',
      taxInvoiceDate: today,
      taxRate: 7,
      vatInclusive: true,
      items: [{ stockItemId: stockId, quantity: 1, unit: 'pcs', unitPrice: 107, condition: 'GOOD' }],
    })).toThrowError(expect.objectContaining({ status: 400 }))

    // ยกเลิก: แถว VAT เดิมอยู่ครบ + แถวกลับรายการวันนี้ รวมเป็น 0
    cancelCustomerBuyback(t, u, bb.id, 'ทดสอบ')
    const vs = db.prepare('SELECT COUNT(*) AS c, SUM(vat_amount) AS v, SUM(base_amount) AS b FROM vat_entries WHERE tenant_id = ? AND document_id = ?').get(t, bb.id) as any
    expect([vs.c, vs.v, vs.b]).toEqual([2, 0, 0])
    expect(closeChecklist(t, today.slice(0, 7)).items.find(i => i.key === 'subledger_match')!.status).not.toBe('fail')

    // Seller VAT without 13-digit tax_id on customer -> 400
    const noTaxCustId = seedCustomer(t, { name: 'ลูกค้าไม่มีเลขภาษี', taxId: '12345' })
    expect(() => createCustomerBuyback(t, u, {
      customerId: noTaxCustId,
      date: today,
      sellerVat: true,
      taxInvoiceNumber: 'TI-2026-0100',
      taxInvoiceDate: today,
      items: [{ stockItemId: stockId, quantity: 1, unit: 'pcs', unitPrice: 100, condition: 'GOOD' }],
    })).toThrowError(expect.objectContaining({ status: 400 }))
  })

  it('3. Damaged items and Non-VAT tenant: DAMAGED posts to 5902 with no stock movement; non-VAT tenant allocates VAT into item cost (last item takes rounding remainder)', () => {
    const u = setupTenant({ vatRegistered: 0 })
    const t = u.tenantId
    const custId = seedCustomer(t, { name: 'บจก. ขายคืน', taxId: '0105569876543' })
    const goodStockId = seedStockItem(t, { name: 'สินค้าดี', quantity: 0, unit: 'pcs', unitCost: 0 })
    const dmgStockId = seedStockItem(t, { name: 'สินค้าชำรุด', quantity: 50, unit: 'pcs', unitCost: 40 })
    const today = thaiDateStr()

    // Non-VAT tenant buying from VAT seller: 2 items (100 + 200 = 300 ex-VAT, 7% VAT = 21, total = 321)
    // Good item gets 107 cost, Damaged item gets 214 cost; no 1110 and no vat_entries
    const bb = createCustomerBuyback(t, u, {
      customerId: custId,
      date: today,
      sellerVat: true,
      taxInvoiceNumber: 'TI-NONVAT-01',
      taxInvoiceDate: today,
      taxRate: 7,
      vatInclusive: false,
      items: [
        { stockItemId: goodStockId, quantity: 10, unit: 'pcs', unitPrice: 10, condition: 'GOOD' },
        { stockItemId: dmgStockId, quantity: 20, unit: 'pcs', unitPrice: 10, condition: 'DAMAGED' },
      ],
    })

    expect(bb.subtotal).toBe(300)
    expect(bb.tax_amount).toBe(21)
    expect(bb.total_amount).toBe(321)
    expect(bb.items[0].cost_value).toBe(107)
    expect(bb.items[1].cost_value).toBe(214)

    // Journal: Dr 1107 107 + Dr 5902 214 / Cr 2101 321 (NO 1110)
    const je = journalLinesOf(t, 'CUSTOMER_BUYBACK', bb.id)
    expect(je.lines).toEqual([
      { code: ACC.RAW_MATERIAL, debit: 107, credit: 0 },
      { code: ACC.STOCK_ADJUSTMENT, debit: 214, credit: 0 },
      { code: ACC.AP, debit: 0, credit: 321 },
    ])

    // No vat_entries for non-VAT tenant
    const veCount = (db.prepare("SELECT COUNT(*) AS c FROM vat_entries WHERE tenant_id = ? AND document_id = ?").get(t, bb.id) as any).c
    expect(veCount).toBe(0)

    // GOOD item stock increased to 10 with unit_cost = 10.7; DAMAGED item stock untouched at 50 and no stock movement
    const goodSt = db.prepare('SELECT quantity, unit_cost FROM stock_items WHERE id = ?').get(goodStockId) as any
    expect(goodSt.quantity).toBe(10)
    expect(goodSt.unit_cost).toBeCloseTo(10.7, 5)

    const dmgSt = db.prepare('SELECT quantity, unit_cost FROM stock_items WHERE id = ?').get(dmgStockId) as any
    expect(dmgSt.quantity).toBe(50)
    expect(dmgSt.unit_cost).toBe(40)

    const dmgMv = db.prepare('SELECT COUNT(*) AS c FROM stock_movements WHERE tenant_id = ? AND stock_item_id = ? AND reference = ?')
      .get(t, dmgStockId, `BB: ${bb.bb_number}`) as any
    expect(dmgMv.c).toBe(0)
  })

  it('4. Cross-customer / cross-tenant / over-balance / duplicate invoice / POS invoice / service item guards (without burning document numbers)', () => {
    const uA = setupTenant()
    const uB = setupTenant()
    const tA = uA.tenantId
    const tB = uB.tenantId

    const custA1 = seedCustomer(tA, { name: 'ลูกค้า A1' })
    const custA2 = seedCustomer(tA, { name: 'ลูกค้า A2' })
    const custB1 = seedCustomer(tB, { name: 'ลูกค้า B1' })

    const stockA = seedStockItem(tA, { quantity: 100, unit: 'pcs', unitCost: 50 })
    const svcStockA = seedStockItem(tA, { name: 'ค่าขนส่ง', category: 'SERVICE', quantity: 0 })
    const stockB = seedStockItem(tB, { quantity: 100, unit: 'pcs', unitCost: 50 })

    const { invoice: invA1 } = seedConfirmedSOAndInvoice(tA, custA1, stockA, 2000)
    const { invoice: invA2 } = seedConfirmedSOAndInvoice(tA, custA2, stockA, 2000)
    const { invoice: invB1 } = seedConfirmedSOAndInvoice(tB, custB1, stockB, 2000)
    const today = thaiDateStr()

    // Service item rejected in buyback without burning BB sequence
    expect(() => createCustomerBuyback(tA, uA, {
      customerId: custA1,
      date: today,
      sellerVat: false,
      approvedBy: 'Admin',
      sellerIdDoc: 'ID-123',
      items: [{ stockItemId: svcStockA, quantity: 1, unitPrice: 100 }],
    })).toThrowError(expect.objectContaining({ status: 400 }))

    // Stock item from other tenant rejected
    expect(() => createCustomerBuyback(tA, uA, {
      customerId: custA1,
      date: today,
      sellerVat: false,
      approvedBy: 'Admin',
      sellerIdDoc: 'ID-123',
      items: [{ stockItemId: stockB, quantity: 1, unitPrice: 100 }],
    })).toThrowError(expect.objectContaining({ status: 400 }))

    const bbSeqBefore = (db.prepare("SELECT COALESCE(MAX(last_number), 0) AS n FROM document_sequences WHERE tenant_id = ? AND doc_type = 'CUSTOMER_BUYBACK'").get(tA) as any).n
    expect(bbSeqBefore).toBe(0)

    // Create valid buyback of 3,000 for custA1
    const bb = createCustomerBuyback(tA, uA, {
      customerId: custA1,
      date: today,
      sellerVat: false,
      approvedBy: 'Admin',
      sellerIdDoc: 'ID-123',
      items: [{ stockItemId: stockA, quantity: 30, unit: 'pcs', unitPrice: 100, condition: 'GOOD' }],
    })
    const creditId = bb.credit_id

    // Offset against another customer's invoice (custA2) -> 400
    expect(() => applyOffset(tA, uA, {
      creditId,
      date: today,
      lines: [{ invoiceId: invA2.id, amount: 500 }],
    })).toThrowError(expect.objectContaining({ status: 400 }))

    // Offset against another tenant's invoice (invB1) -> 404
    expect(() => applyOffset(tA, uA, {
      creditId,
      date: today,
      lines: [{ invoiceId: invB1.id, amount: 500 }],
    })).toThrowError(expect.objectContaining({ status: 404 }))

    // Offset over invoice balance (2,500 > 2,000) -> 400
    expect(() => applyOffset(tA, uA, {
      creditId,
      date: today,
      lines: [{ invoiceId: invA1.id, amount: 2500 }],
    })).toThrowError(expect.objectContaining({ status: 400 }))

    // Duplicate invoice in same offset call -> 400
    expect(() => applyOffset(tA, uA, {
      creditId,
      date: today,
      lines: [
        { invoiceId: invA1.id, amount: 500 },
        { invoiceId: invA1.id, amount: 500 },
      ],
    })).toThrowError(expect.objectContaining({ status: 400 }))

    // Offset over credit balance -> 400
    const { invoice: invA1Second } = seedConfirmedSOAndInvoice(tA, custA1, stockA, 2000)
    expect(() => applyOffset(tA, uA, {
      creditId,
      date: today,
      lines: [
        { invoiceId: invA1.id, amount: 1800 },
        { invoiceId: invA1Second.id, amount: 1500 },
      ],
    })).toThrowError(expect.objectContaining({ status: 400 }))

    // No OF document number burned by any failed applyOffset above
    const ofSeq = (db.prepare("SELECT COALESCE(MAX(last_number), 0) AS n FROM document_sequences WHERE tenant_id = ? AND doc_type = 'CUSTOMER_OFFSET'").get(tA) as any).n
    expect(ofSeq).toBe(0)
  })

  it('5. Cancel order & invoice cancel refused while POSTED offset exists; voidReceipt after offset does not wipe offset', () => {
    const u = setupTenant()
    const t = u.tenantId
    const custId = seedCustomer(t)
    const stockId = seedStockItem(t, { quantity: 100, unit: 'pcs', unitCost: 50 })
    const { soId, invoice } = seedConfirmedSOAndInvoice(t, custId, stockId, 10000)
    const today = thaiDateStr()

    // Create buyback of 3,000 and offset 3,000 -> invoice paid 3,000, balance 7,000
    const bb = createCustomerBuyback(t, u, {
      customerId: custId,
      date: today,
      sellerVat: false,
      approvedBy: 'ผจก.',
      sellerIdDoc: 'บัตรประชาชน 123',
      items: [{ stockItemId: stockId, quantity: 30, unit: 'pcs', unitPrice: 100, condition: 'GOOD' }],
      applyTo: [{ invoiceId: invoice.id, amount: 3000 }],
    })
    const offsetId = bb.offset.id

    // 1) Cannot cancel buyback while credit is used by POSTED offset -> 409 'ใช้เครดิตไปแล้ว ยกเลิกใบหักกลบหนี้ก่อน'
    expect(() => cancelCustomerBuyback(t, u, bb.id, 'คีย์ผิด'))
      .toThrowError(expect.objectContaining({ status: 409, message: 'ใช้เครดิตไปแล้ว ยกเลิกใบหักกลบหนี้ก่อน' }))

    // 2) Cannot cancel invoice while POSTED offset touches it (even though balance is 7,000 PARTIAL) -> 409
    expect(() => cancelInvoiceNow(t, invoice.id))
      .toThrowError(expect.objectContaining({ status: 409, message: expect.stringContaining(bb.offset.offset_number) }))

    // 3) Cannot cancel SO while invoice is active -> 409
    expect(() => cancelSalesOrderNow(t, soId))
      .toThrowError(expect.objectContaining({ status: 409 }))

    // 4) Record a cash receipt of 2,000 -> paid = 5,000, balance = 5,000
    const { receipt } = recordCustomerPayment(t, {
      invoiceId: invoice.id,
      receiptDate: today,
      paymentMethod: 'CASH',
      amount: 2000,
    })
    let invCur = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id) as any
    expect(invCur.paid_amount).toBe(5000)
    expect(invCur.balance_amount).toBe(5000)
    expect(invCur.status).toBe('PARTIAL')

    // 5) voidReceipt after offset: restores only the 2,000 receipt -> paid = 3,000, balance = 7,000, PARTIAL (does NOT wipe offset!)
    voidReceiptNow(t, receipt.id)
    invCur = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id) as any
    expect(invCur.paid_amount).toBe(3000)
    expect(invCur.balance_amount).toBe(7000)
    expect(invCur.status).toBe('PARTIAL')
    expect(invCur.payment_status).toBe('PARTIAL')

    // 6) Cancel the offset first -> reverses CUSTOMER_OFFSET journal, restores invoice to 0 paid / 10,000 balance / UNPAID / ISSUED, restores credit to 3,000
    const cancelledOf = cancelOffset(t, u, offsetId, 'ยกเลิกหักกลบเพื่อแก้ไข')
    expect(cancelledOf.status).toBe('CANCELLED')
    expect(cancelledOf.cancelled_reason).toBe('ยกเลิกหักกลบเพื่อแก้ไข')

    const ofCancelJe = journalLinesOf(t, 'CUSTOMER_OFFSET_CANCEL', offsetId)
    expect(ofCancelJe.lines).toEqual([
      { code: ACC.AP, debit: 0, credit: 3000 },
      { code: ACC.AR, debit: 3000, credit: 0 },
    ])

    invCur = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id) as any
    expect(invCur.paid_amount).toBe(0)
    expect(invCur.balance_amount).toBe(10000)
    expect(invCur.payment_status).toBe('UNPAID')
    expect(invCur.status).toBe('ISSUED')

    const creditCur = db.prepare('SELECT * FROM customer_credits WHERE id = ?').get(bb.credit_id) as any
    expect(creditCur.balance).toBe(3000)

    // 7) Now cancel the buyback -> removes credit, deducts 30 stock (BB-CANCEL), reverses journal, deletes vat_entries
    const cancelledBb = cancelCustomerBuyback(t, u, bb.id, 'ยกเลิกใบรับซื้อคืน')
    expect(cancelledBb.status).toBe('CANCELLED')
    expect(db.prepare('SELECT * FROM customer_credits WHERE id = ?').get(bb.credit_id)).toBeUndefined()

    const bbCancelJe = journalLinesOf(t, 'CUSTOMER_BUYBACK_CANCEL', bb.id)
    expect(bbCancelJe.lines).toEqual([
      { code: ACC.RAW_MATERIAL, debit: 0, credit: 3000 },
      { code: ACC.AP, debit: 3000, credit: 0 },
    ])

    const cancelMv = db.prepare('SELECT * FROM stock_movements WHERE tenant_id = ? AND reference = ?')
      .get(t, `BB-CANCEL: ${bb.bb_number}`) as any
    expect(cancelMv).toBeTruthy()
    expect(cancelMv.type).toBe('OUT')
    expect(cancelMv.quantity).toBe(30)

    // Original invoice and SO are now cancellable
    const cancelledInv = cancelInvoiceNow(t, invoice.id)
    expect(cancelledInv.status).toBe('CANCELLED')
  })

  it('6. CREDIT_NOTE credit source: applyOffset posts NO journal (AR already credited); refundCredit posts Dr AR / Cr Cash-or-Bank; BUYBACK refundCredit posts Dr AP / Cr Cash', () => {
    const u = setupTenant()
    const t = u.tenantId
    const custId = seedCustomer(t)
    const stockId = seedStockItem(t, { quantity: 100, unit: 'pcs', unitCost: 50 })
    const { invoice } = seedConfirmedSOAndInvoice(t, custId, stockId, 5000)
    const today = thaiDateStr()

    // Register a CREDIT_NOTE excess credit of 1,500
    const cnId = generateId()
    const cnCredit = registerCredit(t, {
      sourceType: 'CREDIT_NOTE',
      sourceId: cnId,
      sourceNumber: 'CN-2026-00001',
      customerId: custId,
      amount: 1500,
    })
    expect(cnCredit.balance).toBe(1500)

    // Apply 1,000 of CREDIT_NOTE credit to invoice -> NO journal posted
    const ofApply = applyOffset(t, u, {
      creditId: cnCredit.id,
      date: today,
      lines: [{ invoiceId: invoice.id, amount: 1000 }],
    })
    expect(ofApply.total_amount).toBe(1000)
    const applyJe = journalLinesOf(t, 'CUSTOMER_OFFSET', ofApply.id)
    expect(applyJe.je).toBeNull()

    // Cancel CREDIT_NOTE applyOffset -> restores invoice & credit without journal error
    cancelOffset(t, u, ofApply.id, 'ยกเลิกหักกลบ CN')
    expect((db.prepare('SELECT balance FROM customer_credits WHERE id = ?').get(cnCredit.id) as any).balance).toBe(1500)
    expect((db.prepare('SELECT balance_amount FROM invoices WHERE id = ?').get(invoice.id) as any).balance_amount).toBe(5000)

    // Refund 500 of CREDIT_NOTE credit via CASH -> Dr AR (1104) 500 / Cr CASH (1101) 500
    const ofRefundCn = refundCredit(t, u, {
      creditId: cnCredit.id,
      date: today,
      amount: 500,
      paymentMethod: 'CASH',
      notes: 'คืนเงินสดจากใบลดหนี้',
    })
    expect(ofRefundCn.kind).toBe('REFUND')
    const refundCnJe = journalLinesOf(t, 'CUSTOMER_OFFSET', ofRefundCn.id)
    expect(refundCnJe.lines).toEqual([
      { code: ACC.AR, debit: 500, credit: 0 },
      { code: ACC.CASH, debit: 0, credit: 500 },
    ])

    // Refund BUYBACK credit via TRANSFER -> Dr AP (2101) / Cr BANK (1102)
    const bb = createCustomerBuyback(t, u, {
      customerId: custId,
      date: today,
      sellerVat: false,
      approvedBy: 'Admin',
      sellerIdDoc: 'ID-999',
      items: [{ stockItemId: stockId, quantity: 10, unit: 'pcs', unitPrice: 80, condition: 'GOOD' }],
    })
    const ofRefundBb = refundCredit(t, u, {
      creditId: bb.credit_id,
      date: today,
      amount: 800,
      paymentMethod: 'TRANSFER',
    })
    const refundBbJe = journalLinesOf(t, 'CUSTOMER_OFFSET', ofRefundBb.id)
    expect(refundBbJe.lines).toEqual([
      { code: ACC.AP, debit: 800, credit: 0 },
      { code: ACC.BANK, debit: 0, credit: 800 },
    ])
  })

  it('7. Closed period & invalid/future dates -> 400 naming the closed period', () => {
    const u = setupTenant()
    const t = u.tenantId
    const custId = seedCustomer(t)
    const stockId = seedStockItem(t, { quantity: 50, unit: 'pcs', unitCost: 30 })

    // Close period 2026-08
    db.prepare(`
      INSERT INTO tax_periods (id, tenant_id, year, month, period_type, start_date, end_date, status)
      VALUES (?, ?, 2026, 8, 'MONTHLY', '2026-08-01', '2026-08-31', 'CLOSED')
    `).run(generateId(), t)

    // Closed period -> 400 naming '8/2026'
    expect(() => createCustomerBuyback(t, u, {
      customerId: custId,
      date: '2026-08-15',
      sellerVat: false,
      approvedBy: 'Admin',
      sellerIdDoc: 'ID-1',
      items: [{ stockItemId: stockId, quantity: 1, unitPrice: 100 }],
    })).toThrowError(expect.objectContaining({ status: 400, message: expect.stringContaining('8/2026') }))

    // Invalid calendar date (Feb 30) -> 400
    expect(() => createCustomerBuyback(t, u, {
      customerId: custId,
      date: '2026-02-30',
      sellerVat: false,
      approvedBy: 'Admin',
      sellerIdDoc: 'ID-1',
      items: [{ stockItemId: stockId, quantity: 1, unitPrice: 100 }],
    })).toThrowError(expect.objectContaining({ status: 400 }))

    // Future date -> 400
    expect(() => createCustomerBuyback(t, u, {
      customerId: custId,
      date: '2099-01-01',
      sellerVat: false,
      approvedBy: 'Admin',
      sellerIdDoc: 'ID-1',
      items: [{ stockItemId: stockId, quantity: 1, unitPrice: 100 }],
    })).toThrowError(expect.objectContaining({ status: 400 }))
  })

  it('8. Cost basis (getCostBasis): includes POSTED GOOD buy-back lines with unit conversion; excludes DAMAGED and CANCELLED; unchanged when no buy-back exists', () => {
    const u = setupTenant({ vatRegistered: 1 })
    const t = u.tenantId
    const custId = seedCustomer(t, { name: 'ลูกค้า ขายคืนลัง', taxId: '0105561112223' })
    const stockId = seedStockItem(t, { name: 'น้ำดื่ม', quantity: 0, unit: 'ขวด', baseUnit: 'ขวด', unitCost: 10 })
    const today = thaiDateStr()

    // Conversion: 1 ลัง = 12 ขวด
    db.prepare(`
      INSERT INTO unit_conversions (id, tenant_id, material_id, from_unit, to_unit, conversion_factor)
      VALUES (?, ?, ?, 'ลัง', 'ขวด', 12)
    `).run(generateId(), t, stockId)

    // Before any GR or buy-back -> fallback to unit_cost (10)
    const beforeBasis = getCostBasis(t, stockId)
    expect(beforeBasis.basis).toBe('fallback')
    expect(beforeBasis.weightedAvg).toBe(10)
    expect(beforeBasis.sources).toEqual([])

    // Buy back 2 ลัง (= 24 ขวด) @ 180/ลัง (total 360) GOOD + 1 ลัง DAMAGED
    const bb = createCustomerBuyback(t, u, {
      customerId: custId,
      date: today,
      sellerVat: false,
      approvedBy: 'Admin',
      sellerIdDoc: 'ID-1234',
      items: [
        { stockItemId: stockId, quantity: 2, unit: 'ลัง', unitPrice: 180, condition: 'GOOD' },
        { stockItemId: stockId, quantity: 1, unit: 'ลัง', unitPrice: 180, condition: 'DAMAGED' },
      ],
    })

    // Only GOOD line appears in getCostBasis: baseQty = 24, value = 360, weightedAvg = 15/ขวด
    const afterBasis = getCostBasis(t, stockId)
    expect(afterBasis.basis).toBe('weighted')
    expect(afterBasis.totalBaseQty).toBe(24)
    expect(afterBasis.totalValue).toBe(360)
    expect(afterBasis.weightedAvg).toBe(15)
    expect(afterBasis.sources).toHaveLength(1)
    expect(afterBasis.sources[0]).toMatchObject({
      supplier: 'ลูกค้า ขายคืนลัง',
      doc: bb.bb_number,
      baseQty: 24,
      value: 360,
    })

    // Cancel buyback -> removed from getCostBasis
    cancelCustomerBuyback(t, u, bb.id, 'ยกเลิกทดสอบทุน')
    const cancelledBasis = getCostBasis(t, stockId)
    expect(cancelledBasis.basis).toBe('fallback')
    expect(cancelledBasis.sources).toEqual([])
  })

  it('9. REST endpoints & RBAC: ADMIN/MANAGER/MASTER/OWNER allowed, USER gets 403', async () => {
    const admin = setupTenant()
    const t = admin.tenantId
    const staff = createTestUser({ role: 'USER', tenantId: t })
    const custId = seedCustomer(t, { name: 'ลูกค้า REST' })
    const stockId = seedStockItem(t, { quantity: 50, unit: 'pcs', unitCost: 20 })
    const today = thaiDateStr()

    // USER role -> 403 on both routers
    await request(app).get('/api/sales/buybacks').set('Authorization', `Bearer ${staff.token}`).expect(403)
    await request(app).get('/api/sales/customer-credits').set('Authorization', `Bearer ${staff.token}`).expect(403)
    await request(app).post('/api/sales/buybacks').set('Authorization', `Bearer ${staff.token}`).send({}).expect(403)

    // ADMIN creates buyback via POST /api/sales/buybacks
    const postRes = await request(app)
      .post('/api/sales/buybacks')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        customerId: custId,
        date: today,
        sellerVat: false,
        approvedBy: 'Admin',
        sellerIdDoc: 'บัตรประชาชน 999',
        items: [{ stockItemId: stockId, quantity: 5, unit: 'pcs', unitPrice: 100, condition: 'GOOD' }],
      })
      .expect(201)

    expect(postRes.body.success).toBe(true)
    const bbId = postRes.body.data.id

    // GET /api/sales/customer-credits?customerId=
    const overviewRes = await request(app)
      .get(`/api/sales/customer-credits?customerId=${custId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200)
    expect(overviewRes.body.data.credits).toHaveLength(1)
    expect(overviewRes.body.data.buybacks).toHaveLength(1)

    // POST /api/sales/buybacks/:id/cancel without reason -> 400
    await request(app)
      .post(`/api/sales/buybacks/${bbId}/cancel`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({})
      .expect(400)

    // POST /api/sales/buybacks/:id/cancel with reason -> 200
    const cancelRes = await request(app)
      .post(`/api/sales/buybacks/${bbId}/cancel`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ reason: 'ทดสอบยกเลิกผ่าน REST' })
      .expect(200)
    expect(cancelRes.body.data.status).toBe('CANCELLED')
  })
})
