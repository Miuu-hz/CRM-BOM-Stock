import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId, formatDocumentNumber } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import { createTestUser } from '../../test/testAuth'
import invoicesRouter from './invoices'
import customersRouter from '../customer.routes'
import { createInvoiceFromPosBill } from '../../services/salesBilling.service'
import { getOrCreateAccount } from '../../services/accounting.service'

/**
 * ทดสอบระบบ "ออกใบกำกับภาษีจากบิล POS" (2026-09-23):
 *  1) ยกเลิกใบกำกับที่ออกจากบิล POS ต้องไม่กลับรายการบัญชี — journal ลงไปครั้งเดียวตอนปิดบิล POS
 *     แล้ว ใบกำกับพวกนี้เป็น "เอกสารล้วน" ไม่มี journal ของตัวเอง (routes/sales/invoices.ts PUT /:id/status)
 *  2) ยกเลิกใบแจ้งหนี้ปกติ (จาก SO) ยังต้อง reverse journal เหมือนเดิม — กันไม่ให้แก้ข้อ 1 พังของเดิม
 *  3) GET /invoices/:id ของใบจากบิล POS ต้องคืน customer_tax_branch และ pos_bill_number มาด้วย
 *  4/5) POST /customers ต้อง auto-gen code, fallback contactName, และรับ taxBranch ได้
 */
const app = express()
app.use(express.json())
app.use('/api/invoices', authenticate, invoicesRouter)
app.use('/api/customers', authenticate, customersRouter)

const tenants: string[] = []
function setup() {
  const user = createTestUser({ role: 'ADMIN' })
  tenants.push(user.tenantId)
  const t = user.tenantId
  db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock) VALUES (?, ?, 0)').run(t, 'ร้านทดสอบ')

  const customerId = generateId()
  db.prepare(`
    INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, address, city, status, tax_branch)
    VALUES (?, ?, ?, 'บริษัททดสอบ จำกัด', 'CORPORATE', '-', 'x@example.com', '0800000000', '1 ถนนทดสอบ', 'BKK', 'ACTIVE', 'สาขาที่ 00001')
  `).run(customerId, t, 'CUS-' + customerId.slice(0, 6))

  return { ...user, customerId, auth: (r: any) => r.set('Authorization', 'Bearer ' + user.token) }
}

/** สร้างบิล POS ที่ปิดแล้ว (PAID) แบบขั้นต่ำพอให้ createInvoiceFromPosBill ใช้ได้ — ไม่ลง journal
 * เพราะเทสต์ชุดนี้สนใจแค่ว่า "ยกเลิกใบกำกับจากบิลนี้แล้ว journal เดิมต้องไม่ขยับ" ไม่ใช่ทดสอบ
 * pos-accounting.service.ts เอง (มีเทสต์ของตัวเองแยกอยู่แล้ว) */
function seedPaidPosBill(tenantId: string) {
  // pos_bill_items.pos_menu_id NOT NULL + FK -> pos_menu_configs -> stock_items ต้องมีทั้งคู่
  // ก่อน insert ได้ (foreign_keys = ON ทั้ง prod/test)
  const stockId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
    VALUES (?, ?, ?, 'สินค้า POS ทดสอบ', 'FINISHED', 100, 'pcs', 'pcs', 'MAIN', 'ACTIVE')
  `).run(stockId, tenantId, 'SKU-POS-' + stockId.slice(0, 6))

  const menuId = generateId()
  db.prepare(`
    INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price)
    VALUES (?, ?, ?, 100)
  `).run(menuId, tenantId, stockId)

  const billId = generateId()
  db.prepare(`
    INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, subtotal, discount_amount, tax_rate, tax_amount,
      service_charge_amount, service_charge_rate, total_amount, closed_at)
    VALUES (?, ?, ?, 'บิลทดสอบ', 'PAID', 100, 0, 7, 7, 0, 0, 107, ?)
  `).run(billId, tenantId, 'POS-TEST-' + billId.slice(0, 8), new Date().toISOString())

  db.prepare(`
    INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price, added_at)
    VALUES (?, ?, ?, ?, 'สินค้าทดสอบ POS', 1, 100, 100, ?)
  `).run(generateId(), tenantId, billId, menuId, new Date().toISOString())

  // journal ปลอมของบิล POS เอง (จำลอง pos-accounting.service.ts ที่ลงไปตอนปิดบิลจริง) — ต้องไม่ถูกแตะ
  const suspenseAccountId = getOrCreateAccount(tenantId, '1180')
  const revenueAccountId = getOrCreateAccount(tenantId, '4000')
  const journalId = generateId()
  db.prepare(`
    INSERT INTO journal_entries (id, tenant_id, entry_number, date, description, reference_type, reference_id, total_debit, total_credit, created_at)
    VALUES (?, ?, ?, ?, 'ปิดบิล POS', 'POS_BILL', ?, 107, 107, ?)
  `).run(journalId, tenantId, 'JE-POS-TEST-' + journalId.slice(0, 6), new Date().toISOString().slice(0, 10), billId, new Date().toISOString())
  db.prepare(`
    INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, debit, credit)
    VALUES (?, ?, ?, ?, 107, 0), (?, ?, ?, ?, 0, 107)
  `).run(generateId(), tenantId, journalId, suspenseAccountId, generateId(), tenantId, journalId, revenueAccountId)

  return billId
}

afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const table of ['journal_lines', 'journal_entries', 'receipts', 'invoice_items', 'invoices',
      'pos_bill_items', 'pos_running_bills', 'pos_menu_configs', 'sales_order_items', 'sales_orders', 'customers',
      'stock_items', 'accounts', 'document_sequences', 'company_settings', 'users']) {
      try { db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(t) } catch { /* ตารางไม่มีคอลัมน์นี้ */ }
    }
  }
})

describe('PUT /api/invoices/:id/status — ยกเลิกใบกำกับจากบิล POS ต้องไม่กลับรายการบัญชี', () => {
  it('ยกเลิกใบกำกับที่ออกจากบิล POS → journal_entries/journal_lines ต้องไม่เปลี่ยนเลย', async () => {
    const s = setup()
    const billId = seedPaidPosBill(s.tenantId)
    const { invoice } = createInvoiceFromPosBill(s.tenantId, { posBillId: billId, customerId: s.customerId })

    const before = {
      entries: (db.prepare('SELECT COUNT(*) c FROM journal_entries WHERE tenant_id = ?').get(s.tenantId) as any).c,
      lines: (db.prepare('SELECT COUNT(*) c FROM journal_lines WHERE tenant_id = ?').get(s.tenantId) as any).c,
    }

    const cancel = await s.auth(request(app).put(`/api/invoices/${invoice.id}/status`)).send({ status: 'CANCELLED' })
    expect(cancel.status).toBe(200)
    expect(cancel.body.data.status).toBe('CANCELLED')

    const after = {
      entries: (db.prepare('SELECT COUNT(*) c FROM journal_entries WHERE tenant_id = ?').get(s.tenantId) as any).c,
      lines: (db.prepare('SELECT COUNT(*) c FROM journal_lines WHERE tenant_id = ?').get(s.tenantId) as any).c,
    }

    expect(after.entries, 'ห้ามมี journal เพิ่ม/หายไปจากการยกเลิกใบกำกับ POS').toBe(before.entries)
    expect(after.lines, 'ห้ามมี journal line เพิ่ม/หายไปจากการยกเลิกใบกำกับ POS').toBe(before.lines)
  })

  it('ยกเลิกใบแจ้งหนี้ปกติ (จาก SO) ยัง reverse journal เหมือนเดิม (ไม่ regression)', async () => {
    const s = setup()
    const stockId = generateId()
    db.prepare(`
      INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status, unit_cost, unit_price)
      VALUES (?, ?, ?, 'สินค้าทดสอบ', 'FINISHED', 100, 'pcs', 'pcs', 'MAIN', 'ACTIVE', 60, 100)
    `).run(stockId, s.tenantId, 'SKU-' + stockId.slice(0, 6))

    const soId = generateId()
    db.prepare(`
      INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, subtotal, tax_rate, tax_amount, total_amount, status)
      VALUES (?, ?, ?, ?, 100, 0, 0, 100, 'CONFIRMED')
    `).run(soId, s.tenantId, formatDocumentNumber('SO', s.tenantId, 'SALES_ORDER', new Date().getFullYear(), 5), s.customerId)

    const inv = await s.auth(request(app).post('/api/invoices')).send({ salesOrderId: soId })
    expect(inv.status).toBe(201)
    const invoiceId = inv.body.data.id

    const journalBefore = (db.prepare("SELECT COUNT(*) c FROM journal_entries WHERE tenant_id = ? AND reference_type = 'INVOICE' AND reference_id = ?").get(s.tenantId, invoiceId) as any).c
    expect(journalBefore, 'ต้องมี journal ของใบแจ้งหนี้ปกติตั้งแต่ออกใบ').toBe(1)

    const cancel = await s.auth(request(app).put(`/api/invoices/${invoiceId}/status`)).send({ status: 'CANCELLED' })
    expect(cancel.status).toBe(200)

    const reversalCount = (db.prepare("SELECT COUNT(*) c FROM journal_entries WHERE tenant_id = ? AND reference_type = 'INVOICE_CANCEL' AND reference_id = ?").get(s.tenantId, invoiceId) as any).c
    expect(reversalCount, 'ใบแจ้งหนี้ปกติต้องยังถูก reverse journal เหมือนเดิม').toBe(1)
  })
})

describe('GET /api/invoices/:id — ใบจากบิล POS ต้องมีข้อมูลพิมพ์ใบกำกับครบ', () => {
  it('คืน customer_tax_branch และ pos_bill_number มาด้วย', async () => {
    const s = setup()
    const billId = seedPaidPosBill(s.tenantId)
    const bill = db.prepare('SELECT bill_number FROM pos_running_bills WHERE id = ?').get(billId) as any
    const { invoice } = createInvoiceFromPosBill(s.tenantId, { posBillId: billId, customerId: s.customerId })

    const res = await s.auth(request(app).get(`/api/invoices/${invoice.id}`))
    expect(res.status).toBe(200)
    expect(res.body.data.customer_tax_branch).toBe('สาขาที่ 00001')
    expect(res.body.data.pos_bill_number).toBe(bill.bill_number)
  })
})

describe('POST /api/customers — popup เพิ่มลูกค้าใหม่จาก POS', () => {
  it('ไม่ส่ง code และไม่ส่ง contactName → สร้างสำเร็จ 201 และได้ code auto-generate', async () => {
    const s = setup()
    const res = await s.auth(request(app).post('/api/customers')).send({
      name: 'ลูกค้าหน้าร้าน POS', type: 'RETAIL', phone: '0899999999',
    })
    expect(res.status).toBe(201)
    expect(res.body.data.code).toMatch(/^CUS-/)

    const row = db.prepare('SELECT contact_name FROM customers WHERE id = ?').get(res.body.data.id) as any
    expect(row.contact_name).toBe('ลูกค้าหน้าร้าน POS')
  })

  it('ส่ง taxBranch → เก็บลง DB จริง', async () => {
    const s = setup()
    const res = await s.auth(request(app).post('/api/customers')).send({
      name: 'บริษัท ขอใบกำกับ จำกัด', type: 'CORPORATE', phone: '0888888888', taxBranch: 'สาขาที่ 00001',
    })
    expect(res.status).toBe(201)

    const row = db.prepare('SELECT tax_branch FROM customers WHERE id = ?').get(res.body.data.id) as any
    expect(row.tax_branch).toBe('สาขาที่ 00001')
  })
})
