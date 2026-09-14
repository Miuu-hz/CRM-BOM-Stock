import { describe, it, expect, afterEach } from 'vitest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { registerSalesBillingTools } from './salesBilling'
import type { IMcpServer } from '../sdk-compat'

/**
 * ปลอม IMcpServer แบบขั้นต่ำ — เก็บ handler ของแต่ละ tool ไว้เรียกตรงๆ ในเทสต์ (เหมือน sales.test.ts)
 */
function fakeServer(): { server: IMcpServer; tools: Record<string, (args: any) => Promise<any>> } {
  const tools: Record<string, (args: any) => Promise<any>> = {}
  const server: IMcpServer = {
    tool: (name: string, _desc: string, _schema: any, handler: any) => { tools[name] = handler },
    connect: async () => {},
    close: async () => {},
  }
  return { server, tools }
}

function parseOk(res: any): any {
  return JSON.parse(res.content[0].text)
}

const tenants: string[] = []

/** ตั้ง tenant + ลูกค้า + สินค้า + SO ที่มีของครบ 1 รายการ พร้อมออกใบแจ้งหนี้/รับชำระ */
function setupSO(totalAmount = 1000, taxAmount = 0) {
  const t = 'test_mcp_billing_' + generateId()
  tenants.push(t)
  db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock) VALUES (?, ?, 0)').run(t, 'test')

  const customerId = generateId()
  db.prepare(`INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, status, created_at, updated_at)
              VALUES (?, ?, ?, 'ลูกค้าทดสอบ', 'RETAIL', '-', '', '', '', 'ACTIVE', datetime('now'), datetime('now'))`)
    .run(customerId, t, 'CUS-' + customerId.slice(0, 6))

  const soId = generateId()
  const soNumber = 'SO-TEST-' + soId.slice(0, 6)
  const subtotal = totalAmount - taxAmount
  db.prepare(`
    INSERT INTO sales_orders (id, tenant_id, so_number, quotation_id, customer_id, order_date, delivery_date,
      subtotal, discount_amount, tax_rate, tax_amount, total_amount, status, payment_status, notes, created_at, updated_at)
    VALUES (?, ?, ?, NULL, ?, datetime('now'), NULL, ?, 0, 0, ?, ?, 'CONFIRMED', 'UNPAID', '', datetime('now'), datetime('now'))
  `).run(soId, t, soNumber, customerId, subtotal, taxAmount, totalAmount)

  db.prepare(`
    INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_id, product_name, quantity, unit, unit_price, discount_percent, total_price, notes)
    VALUES (?, ?, ?, NULL, NULL, 'สินค้าทดสอบ', 1, 'pcs', ?, 0, ?, '')
  `).run(generateId(), t, soId, subtotal, subtotal)

  return { tenantId: t, soId, soNumber, totalAmount }
}

afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const table of ['journal_lines', 'journal_entries', 'vat_entries', 'receipts', 'invoice_items', 'invoices',
      'sales_order_items', 'sales_orders', 'customers', 'stock_items', 'accounts', 'document_sequences', 'company_settings']) {
      try { db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(t) } catch { /* ตารางไม่มีคอลัมน์นี้ */ }
    }
  }
})

describe('MCP create_sales_invoice', () => {
  it('ออกใบแจ้งหนี้จาก SO → journal ดุล ยอดตรง', async () => {
    const { tenantId, soNumber, totalAmount } = setupSO(1070, 70)
    const { server, tools } = fakeServer()
    registerSalesBillingTools(server, tenantId, 'u1', 'tester', 'ADMIN')

    const res = parseOk(await tools['create_sales_invoice']({ so_id: soNumber }))
    expect(res.success, res.message).toBe(true)
    expect(res.invoiceNumber).toMatch(/^INV-\d{4}-\d{5}$/)
    expect(res.totalAmount).toBe(totalAmount)
    expect(res.balanceAmount).toBe(totalAmount)
    expect(res.table.length).toBeGreaterThan(0)

    const entries = db.prepare("SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = 'INVOICE'").all(tenantId) as any[]
    expect(entries.length, 'ต้องลงบัญชี 1 ใบพอดี').toBe(1)
    expect(entries[0].total_debit, 'เดบิตต้องเท่าเครดิต').toBe(entries[0].total_credit)

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(res.invoiceId) as any
    expect(invoice.status).toBe('DRAFT')
    expect(invoice.paid_amount).toBe(0)
  })

  it('ออกใบแจ้งหนี้ซ้ำจาก SO เดิมไม่ได้ (บั๊กที่แก้ 2026-09-14)', async () => {
    const { tenantId, soNumber } = setupSO()
    const { server, tools } = fakeServer()
    registerSalesBillingTools(server, tenantId, 'u1', 'tester', 'ADMIN')

    const first = parseOk(await tools['create_sales_invoice']({ so_id: soNumber }))
    expect(first.success).toBe(true)

    const second = parseOk(await tools['create_sales_invoice']({ so_id: soNumber }))
    expect(second.success, 'ออกใบที่สองจาก SO เดิมต้องถูกบล็อก').toBe(false)
    expect(second.message).toMatch(/มีใบแจ้งหนี้.*อยู่แล้ว/)

    const invoiceCount = (db.prepare('SELECT COUNT(*) c FROM invoices WHERE tenant_id = ?').get(tenantId) as any).c
    expect(invoiceCount, 'ต้องมีใบแจ้งหนี้แค่ใบเดียวในระบบ').toBe(1)

    const journalCount = (db.prepare("SELECT COUNT(*) c FROM journal_entries WHERE tenant_id = ? AND reference_type = 'INVOICE'").get(tenantId) as any).c
    expect(journalCount, 'ต้องไม่ลงบัญชีซ้ำ').toBe(1)
  })

  it('ยกเลิกใบแจ้งหนี้เดิมแล้วออกใหม่ได้ (ไม่ใช่ SO ที่มีใบยังไม่ยกเลิก)', async () => {
    const { tenantId, soNumber } = setupSO()
    const { server, tools } = fakeServer()
    registerSalesBillingTools(server, tenantId, 'u1', 'tester', 'ADMIN')

    const first = parseOk(await tools['create_sales_invoice']({ so_id: soNumber }))
    db.prepare("UPDATE invoices SET status = 'CANCELLED' WHERE id = ?").run(first.invoiceId)

    const second = parseOk(await tools['create_sales_invoice']({ so_id: soNumber }))
    expect(second.success, second.message).toBe(true)
    expect(second.invoiceNumber).not.toBe(first.invoiceNumber)
  })
})

describe('MCP record_customer_payment', () => {
  it('รับชำระบางส่วน → PARTIAL ยอดคงค้างถูก', async () => {
    const { tenantId, soNumber, totalAmount } = setupSO(1000)
    const { server, tools } = fakeServer()
    registerSalesBillingTools(server, tenantId, 'u1', 'tester', 'ADMIN')

    const inv = parseOk(await tools['create_sales_invoice']({ so_id: soNumber }))
    const pay = parseOk(await tools['record_customer_payment']({ invoice_id: inv.invoiceNumber, amount: 400, payment_method: 'CASH' }))

    expect(pay.success, pay.message).toBe(true)
    expect(pay.status).toBe('PARTIAL')
    expect(pay.balanceAmount).toBe(totalAmount - 400)

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.invoiceId) as any
    expect(invoice.paid_amount).toBe(400)
    expect(invoice.status).toBe('PARTIAL')
    expect(invoice.payment_status).toBe('PARTIAL')

    const so = db.prepare('SELECT payment_status FROM sales_orders WHERE so_number = ?').get(soNumber) as any
    expect(so.payment_status, 'สถานะชำระเงินของ SO ต้องเดินตามใบแจ้งหนี้').toBe('PARTIAL')
  })

  it('รับชำระครบยอด → PAID', async () => {
    const { tenantId, soNumber, totalAmount } = setupSO(1000)
    const { server, tools } = fakeServer()
    registerSalesBillingTools(server, tenantId, 'u1', 'tester', 'ADMIN')

    const inv = parseOk(await tools['create_sales_invoice']({ so_id: soNumber }))
    const pay = parseOk(await tools['record_customer_payment']({ invoice_id: inv.invoiceNumber, amount: totalAmount, payment_method: 'TRANSFER' }))

    expect(pay.success, pay.message).toBe(true)
    expect(pay.status).toBe('PAID')
    expect(pay.balanceAmount).toBe(0)

    const journalCount = (db.prepare("SELECT COUNT(*) c FROM journal_entries WHERE tenant_id = ? AND reference_type = 'PAYMENT'").get(tenantId) as any).c
    expect(journalCount, 'รับชำระต้องลงบัญชีแยกอีกชุดจากตอนออกใบแจ้งหนี้').toBe(1)

    const allEntries = db.prepare('SELECT * FROM journal_entries WHERE tenant_id = ?').all(tenantId) as any[]
    expect(allEntries.every(e => e.total_debit === e.total_credit), 'ทุกใบต้องดุล').toBe(true)
  })

  it('รับเกินยอดค้างไม่ได้', async () => {
    const { tenantId, soNumber, totalAmount } = setupSO(1000)
    const { server, tools } = fakeServer()
    registerSalesBillingTools(server, tenantId, 'u1', 'tester', 'ADMIN')

    const inv = parseOk(await tools['create_sales_invoice']({ so_id: soNumber }))
    const pay = parseOk(await tools['record_customer_payment']({ invoice_id: inv.invoiceNumber, amount: totalAmount + 1 }))

    expect(pay.success, 'รับเกินยอดค้างต้องถูกบล็อก').toBe(false)
    expect(pay.message).toMatch(/เกินยอดค้าง/)

    const invoice = db.prepare('SELECT paid_amount, balance_amount FROM invoices WHERE id = ?').get(inv.invoiceId) as any
    expect(invoice.paid_amount, 'ปฏิเสธแล้วต้องไม่แตะยอดเดิม').toBe(0)
    expect(invoice.balance_amount).toBe(totalAmount)
  })

  it('รับชำระกับใบแจ้งหนี้ที่ถูกยกเลิกไปแล้วไม่ได้ (บั๊กที่เจอ+แก้ 2026-09-14)', async () => {
    const { tenantId, soNumber } = setupSO(1000)
    const { server, tools } = fakeServer()
    registerSalesBillingTools(server, tenantId, 'u1', 'tester', 'ADMIN')

    const inv = parseOk(await tools['create_sales_invoice']({ so_id: soNumber }))
    db.prepare("UPDATE invoices SET status = 'CANCELLED' WHERE id = ?").run(inv.invoiceId)

    const pay = parseOk(await tools['record_customer_payment']({ invoice_id: inv.invoiceNumber, amount: 100 }))
    expect(pay.success, 'ใบแจ้งหนี้ที่ยกเลิกแล้วต้องรับชำระไม่ได้').toBe(false)
    expect(pay.message).toMatch(/ยกเลิกไปแล้ว/)
  })

  it('หา invoice ผ่าน so_id ได้เมื่อไม่รู้เลขใบแจ้งหนี้', async () => {
    const { tenantId, soNumber, totalAmount } = setupSO(500)
    const { server, tools } = fakeServer()
    registerSalesBillingTools(server, tenantId, 'u1', 'tester', 'ADMIN')

    await tools['create_sales_invoice']({ so_id: soNumber })
    const pay = parseOk(await tools['record_customer_payment']({ so_id: soNumber, amount: totalAmount }))
    expect(pay.success, pay.message).toBe(true)
    expect(pay.status).toBe('PAID')
  })
})
