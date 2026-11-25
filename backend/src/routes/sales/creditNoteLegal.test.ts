import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import { createTestUser } from '../../test/testAuth'
import creditNotesRouter from './creditNotes'
import invoicesRouter from './invoices'
import taxRouter from '../tax.routes'
import reportsRouter from '../reports.routes'
import type { Role } from '../../config/roles'

/**
 * ทดสอบข้อกำหนดกฎหมายใบลดหนี้ (Section 4 a–g):
 *  a. reason_code (ม.82/10) บังคับตอนสร้าง 6 รหัส · ไม่ส่ง/ส่งรหัสไม่รู้จัก → 400 'กรุณาเลือกเหตุผลตามกฎหมาย (ม.82/10)'
 *  b. คำเตือนใบแจ้งหนี้เดิมเกิน 90 วันใน warnings:[...] โดยไม่บล็อก
 *  c. credit_date ห้ามก่อน invoice_date / ห้ามอนาคต / ห้ามงวดปิด (ทั้งตอน create และ issue) · journal + COGS + VAT ลงวันที่ credit_date
 *  d. ราคาคืนสุทธิหลังส่วนลดบรรทัดและส่วนลดท้ายบิล (ไม่ปันส่วนให้ extra_charge) · คืนครบทุกบรรทัดเท่ากับยอดลดหนี้ได้พอดี (เศษปัดอยู่ที่บรรทัดสุดท้าย) · GET /invoices/:id คืน creditable_unit_price และ creditable_qty
 *  e. VAT report & tax sync: แถว VAT_OUTPUT ติดลบ (source_type 'CREDIT_NOTE'), vat_entries แถวติดลบตอน issue · ยกเลิก CN เมื่องวด OPEN ลบแถวออก / เมื่องวด CLOSED ลงแถวบวกกลับรายการวันนี้ · ซิงค์ customer_buybacks เป็น VAT_INPUT (POSTED เท่านั้น, is_deductible=1)
 *  f. ตอน issue: หักยอดค้างใบแจ้งหนี้ + อัปเดต status/payment_status (balance 0 -> PAID) และ SO payment_status · ส่วนเกิน (refundDue) -> registerCredit('CREDIT_NOTE') · ยกเลิก CN: removeCredit ก่อน (409 ถ้าใช้เครดิตไปแล้ว) + คืนสถานะใบแจ้งหนี้
 *  g. ข้อมูลพิมพ์ (ป.80/2542): GET /credit-notes/:id และ GET /credit-notes คืน original_invoice_date, original_value (ฐานก่อน VAT หัก CN ที่ ISSUED ก่อนหน้า), correct_value, difference, vat, reason_code
 */
const app = express()
app.use(express.json())
app.use('/api/sales/credit-notes', authenticate, creditNotesRouter)
app.use('/api/sales/invoices', authenticate, invoicesRouter)
app.use('/api/tax', taxRouter)
app.use('/api/reports', authenticate, reportsRouter)

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of [
      'customer_offset_lines', 'customer_offsets', 'customer_credits',
      'customer_buyback_items', 'customer_buybacks',
      'credit_note_items', 'credit_notes', 'invoice_items', 'invoices',
      'sales_order_items', 'sales_orders', 'stock_movements', 'stock_items',
      'vat_entries', 'tax_transactions', 'tax_periods',
      'journal_lines', 'journal_entries', 'approval_logs', 'approval_requests',
      'customers', 'accounts', 'document_sequences', 'company_settings', 'users',
    ]) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch {}
    }
  }
})

function setupTenant(vatRegistered = 1) {
  const master = createTestUser({ role: 'MASTER' })
  const t = master.tenantId
  tenants.push(t)
  db.prepare('INSERT INTO company_settings (tenant_id, name, tax_id, allow_negative_stock, vat_registered) VALUES (?, ?, ?, 0, ?)')
    .run(t, 'บริษัท ทดสอบ จำกัด', '0105560000001', vatRegistered)

  const customerId = generateId()
  db.prepare(`
    INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, tax_id)
    VALUES (?, ?, ?, 'ลูกค้า ทดสอบ', 'CORPORATE', '-', 'c@test.local', '0800000000', 'BKK', '0105560000999')
  `).run(customerId, t, 'C-' + customerId.slice(0, 6))

  const stockA = generateId()
  const stockB = generateId()
  const insStock = db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, ?, 'FINISHED', 100, 'pcs', 'pcs', 40, 'MAIN', 'ACTIVE')
  `)
  insStock.run(stockA, t, 'SKU-A-' + stockA.slice(0, 5), 'สินค้า A')
  insStock.run(stockB, t, 'SKU-B-' + stockB.slice(0, 5), 'สินค้า B')

  return { t, master, customerId, stockA, stockB }
}

function seedInvoiceWithItems(
  s: ReturnType<typeof setupTenant>,
  opts: {
    invoiceDate?: string
    taxRate?: number
    vatInclusive?: number
    discountAmount?: number
    extraChargeAmount?: number
    extraChargeLabel?: string
    paidAmount?: number
    lines?: Array<{ stockItemId: string; name: string; qty: number; unitPrice: number; totalPrice: number; issuedCost?: number }>
  } = {}
) {
  const invoiceDate = opts.invoiceDate ?? '2026-10-01'
  const taxRate = opts.taxRate ?? 7
  const vatInclusive = opts.vatInclusive ?? 0
  const discount = opts.discountAmount ?? 0
  const extra = opts.extraChargeAmount ?? 0
  const extraLabel = opts.extraChargeLabel ?? 'ค่าขนส่ง'
  const lines = opts.lines ?? [
    { stockItemId: s.stockA, name: 'สินค้า A', qty: 10, unitPrice: 100, totalPrice: 1000, issuedCost: 40 },
  ]

  const lineGross = lines.reduce((acc, l) => acc + l.totalPrice, 0)
  const base = lineGross + extra - discount
  const taxAmount = taxRate > 0
    ? Math.round((vatInclusive ? (base * taxRate) / (100 + taxRate) : (base * taxRate) / 100) * 100) / 100
    : 0
  const subtotal = vatInclusive ? Math.round((lineGross - taxAmount) * 100) / 100 : lineGross
  const totalAmount = vatInclusive ? base : Math.round((base + taxAmount) * 100) / 100
  const paidAmount = opts.paidAmount ?? 0
  const balanceAmount = Math.max(0, Math.round((totalAmount - paidAmount) * 100) / 100)
  const payStatus = balanceAmount <= 0 ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'UNPAID'
  const invStatus = balanceAmount <= 0 ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'ISSUED'

  const soId = generateId()
  db.prepare(`
    INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, order_date, subtotal, discount_amount, extra_charge_amount, extra_charge_label, tax_rate, tax_amount, total_amount, vat_inclusive, status, payment_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?)
  `).run(soId, s.t, 'SO-' + soId.slice(0, 6), s.customerId, invoiceDate, subtotal, discount, extra, extra > 0 ? extraLabel : null, taxRate, taxAmount, totalAmount, vatInclusive, payStatus)

  const invoiceId = generateId()
  db.prepare(`
    INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, invoice_date, subtotal, discount_amount, extra_charge_amount, extra_charge_label, tax_rate, tax_amount, total_amount, vat_inclusive, paid_amount, balance_amount, status, payment_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(invoiceId, s.t, 'INV-' + invoiceId.slice(0, 6), soId, s.customerId, invoiceDate, subtotal, discount, extra, extra > 0 ? extraLabel : null, taxRate, taxAmount, totalAmount, vatInclusive, paidAmount, balanceAmount, invStatus, payStatus)

  const itemIds: string[] = []
  for (const l of lines) {
    const soItemId = generateId()
    db.prepare(`
      INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_name, quantity, unit, unit_price, total_price, issued_unit_cost)
      VALUES (?, ?, ?, ?, ?, ?, 'pcs', ?, ?, ?)
    `).run(soItemId, s.t, soId, l.stockItemId, l.name, l.qty, l.unitPrice, l.totalPrice, l.issuedCost ?? 40)

    const invItemId = generateId()
    db.prepare(`
      INSERT INTO invoice_items (id, tenant_id, invoice_id, sales_order_item_id, stock_item_id, product_name, quantity, unit_price, total_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(invItemId, s.t, invoiceId, soItemId, l.stockItemId, l.name, l.qty, l.unitPrice, l.totalPrice)
    itemIds.push(invItemId)
  }

  if (extra > 0) {
    const extraItemId = generateId()
    db.prepare(`
      INSERT INTO invoice_items (id, tenant_id, invoice_id, sales_order_item_id, stock_item_id, product_name, quantity, unit_price, total_price)
      VALUES (?, ?, ?, NULL, NULL, ?, 1, ?, ?)
    `).run(extraItemId, s.t, invoiceId, extraLabel, extra, extra)
    itemIds.push(extraItemId)
  }

  return { soId, invoiceId, itemIds, subtotal, taxAmount, totalAmount, balanceAmount }
}

describe('Section 4 — Lawful Credit Notes (a–g)', () => {
  it('(a) reason_code (ม.82/10) บังคับ 6 รหัสตามกฎหมาย · ไม่ส่งหรือส่งรหัสอื่น → 400 ข้อความไทย และไม่เผาเลขเอกสาร · ตรวจสิทธิ์อ่าน/เขียน', async () => {
    const s = setupTenant()
    const { invoiceId } = seedInvoiceWithItems(s)

    // USER ถูกบล็อก 403 ทั้ง GET และ POST
    const normalUser = createTestUser({ role: 'USER' as Role, tenantId: s.t })
    expect((await request(app).get('/api/sales/credit-notes').set(auth(normalUser.token))).status).toBe(403)

    // ไม่ส่ง reasonCode หรือส่งรหัสที่ไม่อยู่ใน ม.82/10 -> 400
    for (const badCode of [undefined, '', 'UNKNOWN_CODE', 'CHANGE_MIND']) {
      const res = await request(app)
        .post('/api/sales/credit-notes')
        .set(auth(s.master.token))
        .send({ invoiceId, reason: 'ลูกค้าขอคืน', reasonCode: badCode, amount: 50, creditDate: '2026-10-05' })
      expect(res.status).toBe(400)
      expect(res.body.message).toBe('กรุณาเลือกเหตุผลตามกฎหมาย (ม.82/10)')
    }

    // ทั้ง 6 รหัสตามกฎหมายสร้างผ่านและบันทึก reason_code ครบ
    const validCodes = ['DEFECTIVE', 'NOT_AS_AGREED', 'AGREED_RETURN', 'PRICE_ERROR', 'SHORT_DELIVERY', 'OTHER_LEGAL']
    for (const code of validCodes) {
      const res = await request(app)
        .post('/api/sales/credit-notes')
        .set(auth(s.master.token))
        .send({ invoiceId, reason: `เหตุผล ${code}`, reasonCode: code, amount: 10, creditDate: '2026-10-05' })
      expect(res.status, code).toBe(201)
      expect(res.body.data.reason_code).toBe(code)
    }
  })

  it('(b) ใบแจ้งหนี้เดิมออกมาเกิน 90 วัน → คืน warnings:[...] โดยไม่บล็อก · ไม่เกิน 90 วัน → warnings ว่าง', async () => {
    const s = setupTenant()
    const { invoiceId } = seedInvoiceWithItems(s, { invoiceDate: '2026-01-01' })

    // 90 วันพอดี (2026-01-01 -> 2026-04-01 = 90 วัน) -> ไม่เตือน
    const on90 = await request(app)
      .post('/api/sales/credit-notes')
      .set(auth(s.master.token))
      .send({ invoiceId, reason: 'ลดราคา 90 วัน', reasonCode: 'PRICE_ERROR', amount: 100, creditDate: '2026-04-01' })
    expect(on90.status).toBe(201)
    expect(on90.body.warnings).toEqual([])

    // 120 วัน (2026-01-01 -> 2026-05-01 = 120 วัน) -> เตือนแต่สร้างสำเร็จ 201
    const over90 = await request(app)
      .post('/api/sales/credit-notes')
      .set(auth(s.master.token))
      .send({ invoiceId, reason: 'คืนล่าช้า', reasonCode: 'AGREED_RETURN', amount: 100, creditDate: '2026-05-01' })
    expect(over90.status).toBe(201)
    expect(over90.body.warnings).toEqual(['ใบแจ้งหนี้เดิมออกมาแล้ว 120 วัน — การคืนควรอยู่ในเวลาอันสมควร'])
  })

  it('(c) credit_date ห้ามก่อนวันใบแจ้งหนี้ / ห้ามอนาคต / ห้ามวันที่ปลอม / ห้ามงวดปิด (ทั้งตอนสร้างและตอนออก) · journal + COGS + VAT ลงวันที่ credit_date', async () => {
    const s = setupTenant()
    const { invoiceId, itemIds } = seedInvoiceWithItems(s, { invoiceDate: '2026-10-10' })

    // 1. ก่อนวันใบแจ้งหนี้เดิม (2026-10-09 < 2026-10-10) -> 400
    const beforeInv = await request(app)
      .post('/api/sales/credit-notes')
      .set(auth(s.master.token))
      .send({ invoiceId, reason: 'คืน', reasonCode: 'DEFECTIVE', amount: 100, creditDate: '2026-10-09' })
    expect(beforeInv.status).toBe(400)

    // 2. วันในอนาคต (2099-01-01) -> 400
    const future = await request(app)
      .post('/api/sales/credit-notes')
      .set(auth(s.master.token))
      .send({ invoiceId, reason: 'คืน', reasonCode: 'DEFECTIVE', amount: 100, creditDate: '2099-01-01' })
    expect(future.status).toBe(400)

    // 3. วันที่ปฏิทินไม่มีจริง (2026-02-30) -> 400
    const fakeDate = await request(app)
      .post('/api/sales/credit-notes')
      .set(auth(s.master.token))
      .send({ invoiceId, reason: 'คืน', reasonCode: 'DEFECTIVE', amount: 100, creditDate: '2026-02-30' })
    expect(fakeDate.status).toBe(400)

    // 4. งวดปิดแล้วตอนสร้าง -> 400 พร้อมชื่อเดือน/ปี (10/2026)
    const periodId = generateId()
    db.prepare(`
      INSERT INTO tax_periods (id, tenant_id, year, month, period_type, start_date, end_date, status)
      VALUES (?, ?, 2026, 10, 'MONTHLY', '2026-10-01', '2026-10-31', 'CLOSED')
    `).run(periodId, s.t)

    const closedCreate = await request(app)
      .post('/api/sales/credit-notes')
      .set(auth(s.master.token))
      .send({ invoiceId, reason: 'คืน', reasonCode: 'DEFECTIVE', amount: 100, creditDate: '2026-10-15' })
    expect(closedCreate.status).toBe(400)
    expect(closedCreate.body.message).toContain('10/2026')

    // เปิดงวด 10/2026 แล้วสร้าง DRAFT วันที่ 2026-10-20 จากนั้นปิดงวดก่อนกด ISSUED -> ต้องบล็อก 400 ตอนกด ISSUED
    db.prepare("UPDATE tax_periods SET status = 'OPEN' WHERE id = ?").run(periodId)
    const draftRes = await request(app)
      .post('/api/sales/credit-notes')
      .set(auth(s.master.token))
      .send({
        invoiceId,
        reason: 'คืนของชำรุด',
        reasonCode: 'DEFECTIVE',
        creditDate: '2026-10-20',
        items: [{ invoiceItemId: itemIds[0], quantity: 2 }],
      })
    expect(draftRes.status).toBe(201)
    const cnId = draftRes.body.data.id

    db.prepare("UPDATE tax_periods SET status = 'CLOSED' WHERE id = ?").run(periodId)
    const closedIssue = await request(app)
      .put(`/api/sales/credit-notes/${cnId}/status`)
      .set(auth(s.master.token))
      .send({ status: 'ISSUED' })
    expect(closedIssue.status).toBe(400)
    expect(closedIssue.body.message).toContain('10/2026')

    // เปิดงวดแล้วออก ISSUED -> journal, COGS journal และ vat_entries ต้องใช้วันที่ credit_date ('2026-10-20')
    db.prepare("UPDATE tax_periods SET status = 'OPEN' WHERE id = ?").run(periodId)
    const issued = await request(app)
      .put(`/api/sales/credit-notes/${cnId}/status`)
      .set(auth(s.master.token))
      .send({ status: 'ISSUED' })
    expect(issued.status, JSON.stringify(issued.body)).toBe(200)

    const cnJe = db.prepare("SELECT date FROM journal_entries WHERE tenant_id = ? AND reference_type = 'CREDIT_NOTE' AND reference_id = ?").get(s.t, cnId) as any
    const cogsJe = db.prepare("SELECT date FROM journal_entries WHERE tenant_id = ? AND reference_type = 'CREDIT_NOTE_COGS' AND reference_id = ?").get(s.t, cnId) as any
    const vatEntry = db.prepare("SELECT document_date, base_amount, vat_amount, total_amount FROM vat_entries WHERE tenant_id = ? AND document_type = 'CREDIT_NOTE' AND document_id = ?").get(s.t, cnId) as any
    expect(cnJe?.date).toBe('2026-10-20')
    expect(cogsJe?.date).toBe('2026-10-20')
    expect(vatEntry?.document_date).toBe('2026-10-20')
    expect(vatEntry?.base_amount).toBe(-200)
    expect(vatEntry?.vat_amount).toBe(-14)
    expect(vatEntry?.total_amount).toBe(-214)
  })

  it('(d) ปันส่วนลดท้ายบิลเฉพาะบรรทัดสินค้า (ไม่รวม extra_charge) · เศษปัดอยู่บรรทัดสุดท้าย · คืนครบทุกบรรทัดได้ยอดตรงเป๊ะ · GET /invoices/:id คืน creditable_unit_price และ creditable_qty', async () => {
    const s = setupTenant()
    // สินค้า 2 บรรทัด: A (1 ชิ้น × 100 = 100), B (2 ชิ้น × 100 = 200) รวมสินค้า 300
    // ส่วนลดท้ายบิล = 10 -> ปันส่วนให้ A = 3.33 (เหลือ 96.67), B รับที่เหลือ = 200 - 6.67 = 193.33 (ต่อหน่วย 96.67)
    // ค่าขนส่ง (extra_charge) = 50 (ไม่ถูกปันส่วนลด และคืนเป็นสินค้าไม่ได้)
    const { invoiceId, itemIds } = seedInvoiceWithItems(s, {
      invoiceDate: '2026-10-01',
      discountAmount: 10,
      extraChargeAmount: 50,
      extraChargeLabel: 'ค่าขนส่ง',
      lines: [
        { stockItemId: s.stockA, name: 'สินค้า A', qty: 1, unitPrice: 100, totalPrice: 100 },
        { stockItemId: s.stockB, name: 'สินค้า B', qty: 2, unitPrice: 100, totalPrice: 200 },
      ],
    })

    const invGet = await request(app).get(`/api/sales/invoices/${invoiceId}`).set(auth(s.master.token))
    expect(invGet.status).toBe(200)
    const gotItems = invGet.body.data.items as any[]
    const itemA = gotItems.find(x => x.id === itemIds[0])
    const itemB = gotItems.find(x => x.id === itemIds[1])
    const itemExtra = gotItems.find(x => x.id === itemIds[2])

    expect(itemA.creditable_qty).toBe(1)
    expect(itemA.creditable_unit_price).toBe(96.67)
    expect(itemB.creditable_qty).toBe(2)
    expect(itemB.creditable_unit_price).toBe(96.67)
    expect(itemExtra.creditable_qty, 'ค่าขนส่งไม่ให้คืน').toBe(0)
    expect(itemExtra.creditable_unit_price).toBe(0)

    // คืนครบทุกบรรทัดสินค้า (A 1 ชิ้น + B 2 ชิ้น) -> ฐานรวมต้องเท่ากับ 300 - 10 = 290.00 เป๊ะ (ไม่ใช่ 96.67 * 3 = 290.01)
    const fullReturn = await request(app)
      .post('/api/sales/credit-notes')
      .set(auth(s.master.token))
      .send({
        invoiceId,
        reason: 'คืนสินค้าทั้งหมด',
        reasonCode: 'AGREED_RETURN',
        creditDate: '2026-10-05',
        items: [
          { invoiceItemId: itemIds[0], quantity: 1 },
          { invoiceItemId: itemIds[1], quantity: 2 },
        ],
      })
    expect(fullReturn.status, JSON.stringify(fullReturn.body)).toBe(201)
    expect(fullReturn.body.data.subtotal).toBe(290)
    expect(fullReturn.body.data.tax_amount).toBe(20.3)
    expect(fullReturn.body.data.total_amount).toBe(310.3)

    // หลังคืนครบแล้ว GET /invoices/:id ต้องรายงาน creditable_qty = 0 ทั้งคู่
    const invAfter = await request(app).get(`/api/sales/invoices/${invoiceId}`).set(auth(s.master.token))
    const afterItems = invAfter.body.data.items as any[]
    expect(afterItems.find(x => x.id === itemIds[0]).creditable_qty).toBe(0)
    expect(afterItems.find(x => x.id === itemIds[1]).creditable_qty).toBe(0)
  })

  it('(e) VAT report & tax sync: ซิงค์ CN เป็น VAT_OUTPUT ติดลบ + customer_buybacks เป็น VAT_INPUT · ยกเลิกเมื่องวด OPEN ลบแถวออก / เมื่องวด CLOSED ลงแถวกลับรายการวันนี้', async () => {
    const s = setupTenant(1)
    const { invoiceId } = seedInvoiceWithItems(s, { invoiceDate: '2026-10-01' })

    // สร้างและออก CN #1 ในเดือน 10/2026 (subtotal 100, VAT 7, total 107)
    const cn1Res = await request(app)
      .post('/api/sales/credit-notes')
      .set(auth(s.master.token))
      .send({ invoiceId, reason: 'ลดราคา 1', reasonCode: 'PRICE_ERROR', amount: 100, creditDate: '2026-10-05' })
    const cn1Id = cn1Res.body.data.id
    expect((await request(app).put(`/api/sales/credit-notes/${cn1Id}/status`).set(auth(s.master.token)).send({ status: 'ISSUED' })).status).toBe(200)

    // สร้างและออก CN #2 ในเดือน 10/2026 (subtotal 200, VAT 14, total 214)
    const cn2Res = await request(app)
      .post('/api/sales/credit-notes')
      .set(auth(s.master.token))
      .send({ invoiceId, reason: 'ลดราคา 2', reasonCode: 'PRICE_ERROR', amount: 200, creditDate: '2026-10-06' })
    const cn2Id = cn2Res.body.data.id
    expect((await request(app).put(`/api/sales/credit-notes/${cn2Id}/status`).set(auth(s.master.token)).send({ status: 'ISSUED' })).status).toBe(200)

    // เพิ่ม customer_buybacks ที่ POSTED และมี seller_vat = 1
    const bbId = generateId()
    db.prepare(`
      INSERT INTO customer_buybacks (id, tenant_id, bb_number, customer_id, buyback_date, seller_vat, tax_invoice_number, tax_invoice_date, subtotal, tax_rate, tax_amount, total_amount, status)
      VALUES (?, ?, 'BB-2026-00001', ?, '2026-10-07', 1, 'TIV-BB-001', '2026-10-07', 500, 7, 35, 535, 'POSTED')
    `).run(bbId, s.t, s.customerId)

    // ซิงค์ภาษี
    const sync1 = await request(app).post('/api/tax/sync').set(auth(s.master.token))
    expect(sync1.status).toBe(200)

    const cnTx1 = db.prepare("SELECT * FROM tax_transactions WHERE tenant_id = ? AND source_type = 'CREDIT_NOTE' AND source_id = ?").get(s.t, cn1Id) as any
    expect(cnTx1).toBeTruthy()
    expect(cnTx1.transaction_type).toBe('VAT_OUTPUT')
    expect(cnTx1.base_amount).toBe(-100)
    expect(cnTx1.tax_amount).toBe(-7)
    expect(cnTx1.total_amount).toBe(-107)

    const bbTx = db.prepare("SELECT * FROM tax_transactions WHERE tenant_id = ? AND source_type = 'CUSTOMER_BUYBACK' AND source_id = ?").get(s.t, bbId) as any
    expect(bbTx).toBeTruthy()
    expect(bbTx.transaction_type).toBe('VAT_INPUT')
    expect(bbTx.is_deductible).toBe(1)
    expect(bbTx.base_amount).toBe(500)
    expect(bbTx.tax_amount).toBe(35)

    // ยกเลิก CN #1 ขณะที่งวด 10/2026 ยัง OPEN -> แถวใน vat_entries และ tax_transactions ของ CN #1 ต้องถูกลบออก
    expect((await request(app).put(`/api/sales/credit-notes/${cn1Id}/status`).set(auth(s.master.token)).send({ status: 'CANCELLED' })).status).toBe(200)
    expect(db.prepare("SELECT 1 FROM vat_entries WHERE tenant_id = ? AND document_type = 'CREDIT_NOTE' AND document_id = ?").get(s.t, cn1Id)).toBeUndefined()
    expect(db.prepare("SELECT 1 FROM tax_transactions WHERE tenant_id = ? AND source_type = 'CREDIT_NOTE' AND source_id = ?").get(s.t, cn1Id)).toBeUndefined()

    // ปิดงวด 10/2026 แล้วค่อยยกเลิก CN #2 -> แถวเดิมต้องยังอยู่ และเกิดแถวบวกกลับรายการ (CREDIT_NOTE_CANCEL) ลงวันที่วันนี้
    db.prepare("UPDATE tax_periods SET status = 'CLOSED' WHERE tenant_id = ? AND year = 2026 AND month = 10").run(s.t)
    expect((await request(app).put(`/api/sales/credit-notes/${cn2Id}/status`).set(auth(s.master.token)).send({ status: 'CANCELLED' })).status).toBe(200)

    const origVat2 = db.prepare("SELECT * FROM vat_entries WHERE tenant_id = ? AND document_type = 'CREDIT_NOTE' AND document_id = ?").get(s.t, cn2Id) as any
    const revVat2 = db.prepare("SELECT * FROM vat_entries WHERE tenant_id = ? AND document_type = 'CREDIT_NOTE_CANCEL' AND document_id = ?").get(s.t, cn2Id) as any
    expect(origVat2?.vat_amount).toBe(-14)
    expect(revVat2?.vat_amount).toBe(14)

    const origTx2 = db.prepare("SELECT * FROM tax_transactions WHERE tenant_id = ? AND source_type = 'CREDIT_NOTE' AND source_id = ?").get(s.t, cn2Id) as any
    const revTx2 = db.prepare("SELECT * FROM tax_transactions WHERE tenant_id = ? AND source_type = 'CREDIT_NOTE_CANCEL' AND source_id = ?").get(s.t, cn2Id) as any
    expect(origTx2?.tax_amount).toBe(-14)
    expect(revTx2?.tax_amount).toBe(14)

    // รายงาน /api/reports/vat คำนวณยอดสุทธิรวมแถวติดลบได้ถูกต้อง
    const vatRep = await request(app).get('/api/reports/vat').set(auth(s.master.token))
    expect(vatRep.status).toBe(200)
    expect(vatRep.body.data.summary.outputVAT, '-14 + 14 หักกลบเป็น 0').toBe(0)
  })

  it('(f) ตอนออก ISSUED: หักยอดค้างจนเป็น 0 → ตั้ง invoice status/payment_status = PAID และ SO payment_status = PAID · ส่วนเกินลง customer_credits · ยกเลิก CN เมื่อเครดิตถูกใช้แล้ว → 409 · ยังไม่ใช้ → ลบเครดิตและคืนสถานะใบแจ้งหนี้', async () => {
    const s = setupTenant()
    // ใบแจ้งหนี้ total = 1070, ลูกค้าจ่ายแล้ว 870, ค้างชำระ balance_amount = 200 (สถานะ PARTIAL)
    const { soId, invoiceId } = seedInvoiceWithItems(s, { invoiceDate: '2026-10-01', paidAmount: 870 })

    // ออกใบลดหนี้ subtotal 500 + VAT 35 = 535 -> หักยอดค้าง 200 จนเหลือ 0 (กลายเป็น PAID) และเหลือเครดิตส่วนเกิน refundDue = 335
    const cnRes = await request(app)
      .post('/api/sales/credit-notes')
      .set(auth(s.master.token))
      .send({ invoiceId, reason: 'คืนสินค้าบางส่วนหลังจ่ายเงิน', reasonCode: 'DEFECTIVE', amount: 500, creditDate: '2026-10-05' })
    expect(cnRes.status).toBe(201)
    const cnId = cnRes.body.data.id

    const issueRes = await request(app)
      .put(`/api/sales/credit-notes/${cnId}/status`)
      .set(auth(s.master.token))
      .send({ status: 'ISSUED' })
    expect(issueRes.status).toBe(200)
    expect(issueRes.body.refundDue).toBe(335)

    const invAfterIssue = db.prepare('SELECT balance_amount, status, payment_status FROM invoices WHERE id = ?').get(invoiceId) as any
    const soAfterIssue = db.prepare('SELECT payment_status FROM sales_orders WHERE id = ?').get(soId) as any
    expect(invAfterIssue).toMatchObject({ balance_amount: 0, status: 'PAID', payment_status: 'PAID' })
    expect(soAfterIssue.payment_status).toBe('PAID')

    const creditRow = db.prepare("SELECT * FROM customer_credits WHERE tenant_id = ? AND source_type = 'CREDIT_NOTE' AND source_id = ?").get(s.t, cnId) as any
    expect(creditRow).toBeTruthy()
    expect(creditRow.amount).toBe(335)
    expect(creditRow.balance).toBe(335)

    // จำลองว่าใช้เครดิตไปแล้วบางส่วน (balance < amount) -> ยกเลิกใบลดหนี้ต้องถูกปฏิเสธ 409
    db.prepare('UPDATE customer_credits SET balance = 200 WHERE id = ?').run(creditRow.id)
    const blockedCancel = await request(app)
      .put(`/api/sales/credit-notes/${cnId}/status`)
      .set(auth(s.master.token))
      .send({ status: 'CANCELLED' })
    expect(blockedCancel.status).toBe(409)
    expect(blockedCancel.body.message).toContain('ใช้เครดิตไปแล้ว')

    // คืน balance เครดิตกลับมาเต็ม 335 (เช่น ยกเลิกใบหักกลบแล้ว) -> ยกเลิก CN สำเร็จ ลบแถวเครดิต และคืนสถานะใบแจ้งหนี้กลับเป็น PARTIAL (ค้าง 200)
    db.prepare('UPDATE customer_credits SET balance = 335 WHERE id = ?').run(creditRow.id)
    const okCancel = await request(app)
      .put(`/api/sales/credit-notes/${cnId}/status`)
      .set(auth(s.master.token))
      .send({ status: 'CANCELLED' })
    expect(okCancel.status, JSON.stringify(okCancel.body)).toBe(200)

    expect(db.prepare('SELECT 1 FROM customer_credits WHERE id = ?').get(creditRow.id)).toBeUndefined()
    const invRestored = db.prepare('SELECT balance_amount, status, payment_status FROM invoices WHERE id = ?').get(invoiceId) as any
    const soRestored = db.prepare('SELECT payment_status FROM sales_orders WHERE id = ?').get(soId) as any
    expect(invRestored).toMatchObject({ balance_amount: 200, status: 'PARTIAL', payment_status: 'PARTIAL' })
    expect(soRestored.payment_status).toBe('PARTIAL')
  })

  it('(g) ข้อมูลสำหรับพิมพ์ใบลดหนี้ (ป.80/2542): GET /credit-notes/:id และ GET /credit-notes คืน original_invoice_date, original_value, correct_value, difference, vat, reason_code', async () => {
    const s = setupTenant()
    // ใบแจ้งหนี้ฐานก่อนภาษี 1,000 + VAT 70 = 1,070 วันที่ 2026-10-01
    const { invoiceId } = seedInvoiceWithItems(s, { invoiceDate: '2026-10-01' })

    // ใบลดหนี้ใบที่ 1: ลด 300 (VAT 21) และออก ISSUED
    const cn1 = await request(app)
      .post('/api/sales/credit-notes')
      .set(auth(s.master.token))
      .send({ invoiceId, reason: 'ลดหนี้ครั้งที่ 1', reasonCode: 'SHORT_DELIVERY', amount: 300, creditDate: '2026-10-03' })
    const cn1Id = cn1.body.data.id
    await request(app).put(`/api/sales/credit-notes/${cn1Id}/status`).set(auth(s.master.token)).send({ status: 'ISSUED' })

    // ใบลดหนี้ใบที่ 2: ลดอีก 200 (VAT 14) และออก ISSUED
    const cn2 = await request(app)
      .post('/api/sales/credit-notes')
      .set(auth(s.master.token))
      .send({ invoiceId, reason: 'ลดหนี้ครั้งที่ 2', reasonCode: 'PRICE_ERROR', amount: 200, creditDate: '2026-10-04' })
    const cn2Id = cn2.body.data.id
    await request(app).put(`/api/sales/credit-notes/${cn2Id}/status`).set(auth(s.master.token)).send({ status: 'ISSUED' })

    // ตรวจ GET /:id ของใบที่ 1 (original 1000 -> correct 700, diff 300, vat 21)
    const get1 = await request(app).get(`/api/sales/credit-notes/${cn1Id}`).set(auth(s.master.token))
    expect(get1.status).toBe(200)
    expect(get1.body.data).toMatchObject({
      original_invoice_date: '2026-10-01',
      original_value: 1000,
      correct_value: 700,
      difference: 300,
      vat: 21,
      reason_code: 'SHORT_DELIVERY',
    })

    // ตรวจ GET /:id ของใบที่ 2 (หักใบที่ 1 ที่ ISSUED ไปแล้ว 300 -> original 700, correct 500, diff 200, vat 14)
    const get2 = await request(app).get(`/api/sales/credit-notes/${cn2Id}`).set(auth(s.master.token))
    expect(get2.status).toBe(200)
    expect(get2.body.data).toMatchObject({
      original_invoice_date: '2026-10-01',
      original_value: 700,
      correct_value: 500,
      difference: 200,
      vat: 14,
      reason_code: 'PRICE_ERROR',
    })

    // ตรวจ GET / (list) ต้องมีฟิลด์ชุดเดียวกันครบทุกใบ
    const listRes = await request(app).get('/api/sales/credit-notes').set(auth(s.master.token))
    expect(listRes.status).toBe(200)
    const row1 = (listRes.body.data as any[]).find(r => r.id === cn1Id)
    const row2 = (listRes.body.data as any[]).find(r => r.id === cn2Id)
    expect(row1).toMatchObject({ original_invoice_date: '2026-10-01', original_value: 1000, correct_value: 700, difference: 300, vat: 21, reason_code: 'SHORT_DELIVERY' })
    expect(row2).toMatchObject({ original_invoice_date: '2026-10-01', original_value: 700, correct_value: 500, difference: 200, vat: 14, reason_code: 'PRICE_ERROR' })
  })
})
