import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import salesRouter from './index'
import { createTestUser } from '../../test/testAuth'

/**
 * รอบแก้ตรรกะโมดูลขาย 2026-10-22: ซ้ำ SO จากใบเสนอราคาเดิม · จำกัดอัตรา VAT · ตรวจรายการเทมเพลต ·
 * ยอด amount ที่เป็น string · ยอดสรุป/ป้ายตัวเลขที่ไม่ควรนับเอกสารที่ยกเลิก
 */
const app = express()
app.use(express.json())
app.use('/api/sales', salesRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const table of ['journal_lines', 'journal_entries', 'receipts', 'invoice_items', 'invoices',
      'sales_order_items', 'sales_orders', 'quotation_items', 'quotations', 'quotation_template_items', 'quotation_templates',
      'customers', 'stock_items', 'accounts', 'document_sequences', 'company_settings', 'users']) {
      try { db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(t) } catch { /* ตารางไม่มีคอลัมน์นี้ */ }
    }
  }
})

function setup(vatRegistered = 1) {
  const u = createTestUser({ role: 'ADMIN' })
  tenants.push(u.tenantId)
  db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock, vat_registered) VALUES (?, ?, 0, ?)').run(u.tenantId, 'ร้านทดสอบ', vatRegistered)
  const customerId = generateId()
  db.prepare(`INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, tenant_id) VALUES (?, ?, 'ลูกค้า', 'RETAIL', 'x', 'x@example.com', '0800000000', 'BKK', ?)`)
    .run(customerId, 'C-' + customerId.slice(0, 6), u.tenantId)
  const stockId = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status, unit_cost, unit_price)
    VALUES (?, ?, ?, 'สินค้า', 'FINISHED', 100, 'pcs', 'pcs', 'MAIN', 'ACTIVE', 60, 100)`).run(stockId, u.tenantId, 'SKU-' + stockId.slice(0, 6))
  const line = { productId: stockId, productName: 'สินค้า', quantity: 5, unit: 'pcs', unitPrice: 100 }
  const auth = (r: any) => r.set('Authorization', 'Bearer ' + u.token)
  return { u, t: u.tenantId, customerId, stockId, line, auth }
}

function seedQuotation(t: string, customerId: string) {
  const id = generateId()
  db.prepare(`INSERT INTO quotations (id, tenant_id, quotation_number, customer_id, total_amount, status) VALUES (?, ?, ?, ?, 500, 'SENT')`)
    .run(id, t, 'QT-' + id.slice(0, 8), customerId)
  return id
}

describe('POST /sales-orders จากใบเสนอราคา — กันแปลงซ้ำ', () => {
  it('ใบเสนอราคาที่มี SO ไม่ยกเลิกอยู่แล้ว → 409 และไม่เกิด SO ที่สอง', async () => {
    const s = setup()
    const quotationId = seedQuotation(s.t, s.customerId)
    const body = { customerId: s.customerId, quotationId, items: [s.line], taxRate: 0 }

    const first = await s.auth(request(app).post('/api/sales/sales-orders')).send(body)
    expect(first.status).toBe(201)
    const second = await s.auth(request(app).post('/api/sales/sales-orders')).send(body)
    expect(second.status).toBe(409)
    expect(second.body.message).toContain(first.body.data.so_number)

    const n = (db.prepare('SELECT COUNT(*) c FROM sales_orders WHERE quotation_id = ?').get(quotationId) as any).c
    expect(n).toBe(1)
  })

  it('SO เดิมถูกยกเลิกแล้ว → แปลงใหม่ได้', async () => {
    const s = setup()
    const quotationId = seedQuotation(s.t, s.customerId)
    const body = { customerId: s.customerId, quotationId, items: [s.line], taxRate: 0 }

    const first = await s.auth(request(app).post('/api/sales/sales-orders')).send(body)
    db.prepare("UPDATE sales_orders SET status = 'CANCELLED' WHERE id = ?").run(first.body.data.id)
    const again = await s.auth(request(app).post('/api/sales/sales-orders')).send(body)
    expect(again.status).toBe(201)
  })
})

describe('อัตรา VAT ต้องเป็น 0 หรือ 7', () => {
  const rates = [15, -1, 'abc']
  it.each(rates)('POST /sales-orders taxRate=%s → 400', async (taxRate) => {
    const s = setup()
    const res = await s.auth(request(app).post('/api/sales/sales-orders')).send({ customerId: s.customerId, items: [s.line], taxRate })
    expect(res.status).toBe(400)
  })

  it.each(rates)('POST /quotations taxRate=%s → 400', async (taxRate) => {
    const s = setup()
    const res = await s.auth(request(app).post('/api/sales/quotations')).send({ customerId: s.customerId, items: [s.line], taxRate })
    expect(res.status).toBe(400)
  })

  it('PUT sales-order / quotation taxRate=15 → 400, taxRate=7 ผ่าน', async () => {
    const s = setup()
    const so = await s.auth(request(app).post('/api/sales/sales-orders')).send({ customerId: s.customerId, items: [s.line], taxRate: 0 })
    const soUrl = `/api/sales/sales-orders/${so.body.data.id}`
    expect((await s.auth(request(app).put(soUrl)).send({ items: [s.line], taxRate: 15 })).status).toBe(400)
    expect((await s.auth(request(app).put(soUrl)).send({ items: [s.line], taxRate: 7 })).status).toBe(200)

    const qt = await s.auth(request(app).post('/api/sales/quotations')).send({ customerId: s.customerId, items: [s.line], taxRate: 0 })
    const qtUrl = `/api/sales/quotations/${qt.body.data.id}`
    expect((await s.auth(request(app).put(qtUrl)).send({ items: [s.line], taxRate: 15 })).status).toBe(400)
    expect((await s.auth(request(app).put(qtUrl)).send({ items: [s.line], taxRate: 7 })).status).toBe(200)
  })

  it('POST /quotation-templates/from-template taxRate=15 → 400 และไม่เสียเลขเอกสาร', async () => {
    const s = setup()
    const templateId = generateId()
    db.prepare(`INSERT INTO quotation_templates (id, tenant_id, name, expiration_days, header_text) VALUES (?, ?, 'T', 30, '')`).run(templateId, s.t)
    db.prepare(`INSERT INTO quotation_template_items (id, tenant_id, template_id, product_id, quantity, unit_price, discount_percent, sort_order)
      VALUES (?, ?, ?, ?, 1, 50, 0, 0)`).run(generateId(), s.t, templateId, s.stockId)
    const bad = await s.auth(request(app).post('/api/sales/quotation-templates/from-template')).send({ templateId, customerId: s.customerId, taxRate: 15 })
    expect(bad.status).toBe(400)
    const ok = await s.auth(request(app).post('/api/sales/quotation-templates/from-template')).send({ templateId, customerId: s.customerId, taxRate: 7 })
    expect(ok.status).toBe(201)
  })
})

describe('POST /quotation-templates — ตรวจรายการ', () => {
  it.each([
    { quantity: -1, unitPrice: 10 },
    { quantity: 1, unitPrice: -10 },
    { quantity: 1, unitPrice: 10, discountPercent: -5 },
    { quantity: 1, unitPrice: 10, discountPercent: 101 },
  ])('รายการ %o → 400 และไม่สร้างเทมเพลต', async (item) => {
    const s = setup()
    const res = await s.auth(request(app).post('/api/sales/quotation-templates')).send({ name: 'เทมเพลตเสีย', items: [{ productId: s.stockId, ...item }] })
    expect(res.status).toBe(400)
    const n = (db.prepare("SELECT COUNT(*) c FROM quotation_templates WHERE tenant_id = ?").get(s.t) as any).c
    expect(n).toBe(0)
  })

  it('รายการปกติผ่าน', async () => {
    const s = setup()
    const res = await s.auth(request(app).post('/api/sales/quotation-templates')).send({ name: 'ดี', items: [{ productId: s.stockId, quantity: 2, unitPrice: 10, discountPercent: 100 }] })
    expect(res.status).toBe(201)
  })
})

describe('POST /receipts — amount ที่ส่งมาเป็น string', () => {
  async function invoiceOf(s: ReturnType<typeof setup>) {
    const so = await s.auth(request(app).post('/api/sales/sales-orders')).send({ customerId: s.customerId, items: [s.line], taxRate: 0 })
    // ออกใบแจ้งหนี้ได้เฉพาะ SO ที่ยืนยัน (ตัดสต็อก) แล้ว
    expect((await s.auth(request(app).put(`/api/sales/sales-orders/${so.body.data.id}/status`)).send({ status: 'CONFIRMED' })).status).toBe(200)
    const inv = await s.auth(request(app).post('/api/sales/invoices')).send({ salesOrderId: so.body.data.id })
    return inv.body.data.id as string
  }

  it('จ่ายบางส่วนเป็นตัวเลขแล้วจ่ายต่อเป็น "30" → paid_amount บวกเป็นตัวเลข ไม่ต่อสตริง', async () => {
    const s = setup()
    const invoiceId = await invoiceOf(s)
    expect((await s.auth(request(app).post('/api/sales/receipts')).send({ invoiceId, amount: 50, paymentMethod: 'CASH' })).status).toBe(201)
    const r = await s.auth(request(app).post('/api/sales/receipts')).send({ invoiceId, amount: '30', paymentMethod: 'CASH' })
    expect(r.status).toBe(201)
    const inv = db.prepare('SELECT paid_amount, balance_amount FROM invoices WHERE id = ?').get(invoiceId) as any
    expect(inv.paid_amount).toBe(80)
    expect(inv.balance_amount).toBe(420)
    const sum = (db.prepare('SELECT SUM(amount) a FROM receipts WHERE invoice_id = ?').get(invoiceId) as any).a
    expect(sum).toBe(80)
  })

  it.each(['abc', '-5', '0', 'Infinity'])('amount=%s → 400 ไม่เกิดใบเสร็จ', async (amount) => {
    const s = setup()
    const invoiceId = await invoiceOf(s)
    const res = await s.auth(request(app).post('/api/sales/receipts')).send({ invoiceId, amount, paymentMethod: 'CASH' })
    expect(res.status).toBe(400)
    expect((db.prepare('SELECT COUNT(*) c FROM receipts WHERE invoice_id = ?').get(invoiceId) as any).c).toBe(0)
  })
})

describe('สรุป/ป้ายตัวเลข — ไม่นับเอกสารที่ยกเลิก', () => {
  function seedInv(s: ReturnType<typeof setup>, status: string, payment: string, amount: number) {
    const soId = generateId()
    db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, total_amount, status) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(soId, s.t, 'SO-' + soId.slice(0, 8), s.customerId, amount, status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED')
    db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, total_amount, paid_amount, balance_amount, status, payment_status)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`).run(generateId(), s.t, 'INV-' + soId.slice(0, 8), soId, s.customerId, amount, amount, status, payment)
  }

  it('GET /summary: ยอดขาย/ลูกหนี้/จำนวนค้างชำระไม่รวม SO และใบแจ้งหนี้ที่ CANCELLED', async () => {
    const s = setup()
    seedInv(s, 'ISSUED', 'UNPAID', 100)
    seedInv(s, 'CANCELLED', 'UNPAID', 900)
    const res = await s.auth(request(app).get('/api/sales/summary'))
    const d = res.body.data
    expect(d.invoices.total).toBe(1)
    expect(d.invoices.unpaid).toBe(1)
    expect(d.invoices.outstanding).toBe(100)
    expect(d.invoices.totalInvoiced).toBe(100)
    expect(d.salesOrders.total).toBe(1)
    expect(d.salesOrders.totalSales).toBe(100)
  })

  it('GET /badge-counts: ใบแจ้งหนี้ที่ยกเลิกไม่นับเป็นค้างชำระ', async () => {
    const s = setup()
    seedInv(s, 'ISSUED', 'UNPAID', 100)
    seedInv(s, 'CANCELLED', 'UNPAID', 900)
    const res = await s.auth(request(app).get('/api/sales/badge-counts'))
    expect(res.body.data.invoices).toBe(1)
  })
})
