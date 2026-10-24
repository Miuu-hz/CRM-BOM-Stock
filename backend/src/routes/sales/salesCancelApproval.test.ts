import { describe, it, expect, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import { createTestUser } from '../../test/testAuth'
import creditNotesRouter from './creditNotes'
import invoicesRouter from './invoices'
import receiptsRouter from './receipts'
import salesOrdersRouter from './salesOrders'
import deliveryOrdersRouter from './deliveryOrders'
import posRouter from './pos.routes'
import approvalRouter from '../approval.routes'
import { isApprovalRequired, hasBypass } from '../../services/approvalGate.service'
import { lineBotService } from '../../services/line-bot.service'
import type { Role } from '../../config/roles'

/**
 * ความปลอดภัย/ความถูกต้องทางบัญชีฝั่งขาย (รีวิว 2026-10-22)
 * A ใบลดหนี้เฉพาะ ADMIN/MANAGER(+MASTER/OWNER) · B ค่าใช้จ่ายตอนปิดกะ log + LINE ไม่ต้องอนุมัติ
 * C ยกเลิกเอกสารขายต้องขออนุมัติเสมอ (หมวด sales_cancel) อนุมัติแล้วระบบยกเลิกให้
 */
const app = express()
app.use(express.json())
app.use('/api/sales/credit-notes', authenticate, creditNotesRouter)
app.use('/api/invoices', authenticate, invoicesRouter)
app.use('/api/receipts', authenticate, receiptsRouter)
app.use('/api/sales-orders', authenticate, salesOrdersRouter)
app.use('/api/delivery-orders', authenticate, deliveryOrdersRouter)
app.use('/api/sales', authenticate, posRouter)
app.use('/api/approval', approvalRouter)

afterEach(() => vi.restoreAllMocks())

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

function tenant() {
  const master = createTestUser({ role: 'MASTER' })
  const t = master.tenantId
  db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock, pos_bom_deduct) VALUES (?, ?, 0, 0)').run(t, 'test')
  const user = (role: Role, depts: string[] = ['SALES']) => {
    const u = createTestUser({ role, tenantId: t })
    db.prepare('UPDATE users SET departments = ? WHERE id = ?').run(JSON.stringify(depts), u.userId)
    return u
  }
  const customerId = generateId()
  db.prepare(`INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city)
    VALUES (?, ?, ?, 'ลูกค้า', 'RETAIL', '-', '-', '-', '-')`).run(customerId, t, 'C-' + customerId.slice(0, 6))
  const stockId = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, 'สินค้า', 'FINISHED', 100, 'pcs', 'pcs', 60, 'MAIN', 'ACTIVE')`).run(stockId, t, 'SKU-' + stockId.slice(0, 8))
  return { t, master, user, customerId, stockId }
}
type T = ReturnType<typeof tenant>

function seedSO(s: T, qty = 5, status = 'DRAFT') {
  const soId = generateId()
  const soNumber = 'SO-T-' + soId.slice(0, 8)
  db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, subtotal, tax_rate, tax_amount, total_amount, status)
    VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`).run(soId, s.t, soNumber, s.customerId, qty * 100, qty * 100, status)
  const soItemId = generateId()
  db.prepare(`INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_name, quantity, unit, unit_price, total_price)
    VALUES (?, ?, ?, ?, 'สินค้า', ?, 'pcs', 100, ?)`).run(soItemId, s.t, soId, s.stockId, qty, qty * 100)
  return { soId, soNumber, soItemId }
}

async function confirmedSOWithInvoice(s: T, qty = 5) {
  const so = seedSO(s, qty)
  expect((await request(app).put(`/api/sales-orders/${so.soId}/status`).set(auth(s.master.token)).send({ status: 'CONFIRMED' })).status).toBe(200)
  const inv = await request(app).post('/api/invoices').set(auth(s.master.token)).send({ salesOrderId: so.soId })
  expect(inv.status, JSON.stringify(inv.body)).toBe(201)
  return { ...so, invoiceId: inv.body.data.id as string, invoiceItemId: inv.body.data.items[0].id as string }
}

const stockQty = (id: string) => (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(id) as any).quantity
const statusOf = (table: string, id: string) => (db.prepare(`SELECT status FROM ${table} WHERE id = ?`).get(id) as any)?.status
const decide = (token: string, reqId: string, decision = 'APPROVED') =>
  request(app).put(`/api/approval/requests/${reqId}/decision`).set(auth(token)).send({ decision })

describe('ประตู sales_cancel', () => {
  it('ต้องขออนุมัติเสมอแม้ไม่มี approval_settings · bypass รายคน/แผนกไม่ช่วย · ADMIN ผ่าน', () => {
    const s = tenant()
    const mgr = s.user('MANAGER', ['CEO'])
    db.prepare(`INSERT INTO user_approval_permissions (id, tenant_id, user_id, module_type, can_approve, can_bypass)
      VALUES (?, ?, ?, 'sales_cancel', 1, 1)`).run(generateId(), s.t, mgr.userId)
    const g = { userId: mgr.userId, email: mgr.email, role: 'MANAGER', departments: ['CEO'] as any }
    expect(isApprovalRequired(s.t, g, 'sales_cancel')).toBe(true)
    expect(hasBypass(s.t, g, 'sales_cancel')).toBe(false)
    expect(isApprovalRequired(s.t, { ...g, role: 'ADMIN' }, 'sales_cancel')).toBe(false)
  })
})

describe('Task 1 — ใบลดหนี้', () => {
  it('สิทธิ์: USER/POWERUSER 403 ทั้งสร้าง/เปลี่ยนสถานะ/ลบ · MANAGER สร้างได้', async () => {
    const s = tenant()
    const { invoiceId } = await confirmedSOWithInvoice(s)
    for (const role of ['USER', 'POWERUSER'] as Role[]) {
      const u = s.user(role)
      expect((await request(app).post('/api/sales/credit-notes').set(auth(u.token)).send({ invoiceId, reason: 'x', amount: 10 })).status).toBe(403)
    }
    const mgr = s.user('MANAGER')
    const ok = await request(app).post('/api/sales/credit-notes').set(auth(mgr.token)).send({ invoiceId, reason: 'x', amount: 10 })
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)
    const u = s.user('USER')
    expect((await request(app).put(`/api/sales/credit-notes/${ok.body.data.id}/status`).set(auth(u.token)).send({ status: 'ISSUED' })).status).toBe(403)
    expect((await request(app).delete(`/api/sales/credit-notes/${ok.body.data.id}`).set(auth(u.token))).status).toBe(403)
  })

  it('ราคาต่อหน่วยมาจาก invoice_items ไม่ใช่ body · จำนวน ≤ 0/เกินที่เหลือ/ยอด ≤ 0 → 400', async () => {
    const s = tenant()
    const { invoiceId, invoiceItemId } = await confirmedSOWithInvoice(s)
    const post = (body: any) => request(app).post('/api/sales/credit-notes').set(auth(s.master.token)).send({ invoiceId, reason: 'คืน', ...body })
    const res = await post({ items: [{ invoiceItemId, quantity: 2, unitPrice: 99999 }] })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.data.total_amount, '2 × 100 ตามใบแจ้งหนี้').toBe(200)
    expect(res.body.data.items[0].unit_price).toBe(100)
    expect((await post({ items: [{ invoiceItemId, quantity: 0 }] })).status).toBe(400)
    expect((await post({ items: [{ invoiceItemId, quantity: -1 }] })).status).toBe(400)
    expect((await post({ items: [{ invoiceItemId, quantity: 4 }] })).status, 'ขาย 5 คืนไปแล้ว 2').toBe(400)
    expect((await post({ items: [{ invoiceItemId, quantity: 2 }, { invoiceItemId, quantity: 2 }] })).status, 'บรรทัดซ้ำรวมกัน').toBe(400)
    expect((await post({ amount: -50 })).status).toBe(400)
    expect((await post({ amount: 0 })).status).toBe(400)
  })

  it('ใบแจ้งหนี้ที่ยกเลิกแล้ว / ใบกำกับจากบิล POS → 400', async () => {
    const s = tenant()
    const { invoiceId } = await confirmedSOWithInvoice(s)
    db.prepare("UPDATE invoices SET status = 'CANCELLED' WHERE id = ?").run(invoiceId)
    expect((await request(app).post('/api/sales/credit-notes').set(auth(s.master.token)).send({ invoiceId, reason: 'x', amount: 10 })).status).toBe(400)
    const billId = generateId()
    db.prepare(`INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, total_amount)
      VALUES (?, ?, ?, 'บิล', 'PAID', 107)`).run(billId, s.t, 'B-' + billId.slice(0, 6))
    const posInv = generateId()
    db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, pos_bill_id, customer_id, total_amount, status)
      VALUES (?, ?, ?, ?, ?, 107, 'PAID')`).run(posInv, s.t, 'INV-POS-' + posInv.slice(0, 6), billId, s.customerId)
    expect((await request(app).post('/api/sales/credit-notes').set(auth(s.master.token)).send({ invoiceId: posInv, reason: 'x', amount: 10 })).status).toBe(400)
  })

  it('ยกเลิกใบลดหนี้ที่ออกแล้ว: MANAGER → 202 · อนุมัติแล้วกลับ journal + เอาของที่รับคืนออก + คืนยอดค้าง · เห็นงวดภาษีที่ปิด', async () => {
    const s = tenant()
    const { invoiceId, invoiceItemId } = await confirmedSOWithInvoice(s)
    expect(stockQty(s.stockId)).toBe(95)
    const cn = await request(app).post('/api/sales/credit-notes').set(auth(s.master.token))
      .send({ invoiceId, reason: 'คืน', items: [{ invoiceItemId, quantity: 2 }] })
    expect((await request(app).put(`/api/sales/credit-notes/${cn.body.data.id}/status`).set(auth(s.master.token)).send({ status: 'ISSUED' })).status).toBe(200)
    expect(stockQty(s.stockId)).toBe(97)
    const balAfterIssue = (db.prepare('SELECT balance_amount FROM invoices WHERE id = ?').get(invoiceId) as any).balance_amount

    const now = new Date()
    db.prepare(`INSERT INTO tax_periods (id, tenant_id, year, month, period_type, start_date, end_date, status)
      VALUES (?, ?, ?, ?, 'MONTHLY', '2000-01-01', '2000-01-31', 'CLOSED')`).run(generateId(), s.t, now.getFullYear(), now.getMonth() + 1)

    const mgr = s.user('MANAGER')
    const req1 = await request(app).put(`/api/sales/credit-notes/${cn.body.data.id}/status`).set(auth(mgr.token)).send({ status: 'CANCELLED', reason: 'ออกผิด' })
    expect(req1.status, JSON.stringify(req1.body)).toBe(202)
    expect(req1.body.pending_approval).toBe(true)
    expect(statusOf('credit_notes', cn.body.data.id)).toBe('ISSUED')
    const ar = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(req1.body.request_id) as any
    expect(ar.module_type).toBe('sales_cancel')
    expect(JSON.parse(ar.payload).taxPeriodClosed, 'ผู้อนุมัติเห็นว่างวดปิดแล้ว').toBe(true)

    const ok = await decide(s.master.token, ar.id)
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(statusOf('credit_notes', cn.body.data.id)).toBe('CANCELLED')
    expect(stockQty(s.stockId), 'ของที่รับคืนถูกเอาออก').toBe(95)
    const rev = db.prepare("SELECT COUNT(*) n FROM journal_entries WHERE tenant_id = ? AND reference_type = 'CREDIT_NOTE_CANCEL'").get(s.t) as any
    expect(rev.n).toBe(1)
    const bal = (db.prepare('SELECT balance_amount FROM invoices WHERE id = ?').get(invoiceId) as any).balance_amount
    expect(bal).toBe(Math.min(500, balAfterIssue + 200))
  })
})

describe('Task 2 — สถานะใบแจ้งหนี้', () => {
  it('ไม่มีสิทธิ์ฝั่งบิล 403 · ตั้ง PAID/PARTIAL เองไม่ได้ · CANCELLED เป็นสถานะสุดท้าย', async () => {
    const s = tenant()
    const { invoiceId } = await confirmedSOWithInvoice(s)
    const prod = s.user('USER', ['PRODUCTION'])
    expect((await request(app).put(`/api/invoices/${invoiceId}/status`).set(auth(prod.token)).send({ status: 'ISSUED' })).status).toBe(403)
    expect((await request(app).put(`/api/invoices/${invoiceId}/status`).set(auth(s.master.token)).send({ status: 'PAID' })).status).toBe(400)
    expect((await request(app).put(`/api/invoices/${invoiceId}/status`).set(auth(s.master.token)).send({ status: 'PARTIAL' })).status).toBe(400)
    expect((await request(app).put(`/api/invoices/${invoiceId}/status`).set(auth(s.master.token)).send({ status: 'ISSUED' })).status).toBe(200)
    expect((await request(app).put(`/api/invoices/${invoiceId}/status`).set(auth(s.master.token)).send({ status: 'CANCELLED' })).status).toBe(200)
    expect((await request(app).put(`/api/invoices/${invoiceId}/status`).set(auth(s.master.token)).send({ status: 'ISSUED' })).status).toBe(400)
  })

  it('MANAGER ยกเลิก → 202 ใบยังไม่ยกเลิก · อนุมัติแล้วยกเลิก + กลับ journal · ปฏิเสธแล้วสถานะคงเดิม', async () => {
    const s = tenant()
    const mgr = s.user('MANAGER')
    const a = await confirmedSOWithInvoice(s)
    const r = await request(app).put(`/api/invoices/${a.invoiceId}/status`).set(auth(mgr.token)).send({ status: 'CANCELLED' })
    expect(r.status, JSON.stringify(r.body)).toBe(202)
    expect(r.body.message).toContain('ส่งคำขออนุมัติแล้ว')
    expect(statusOf('invoices', a.invoiceId)).toBe('DRAFT')
    // กดซ้ำได้คำขอเดิม ไม่ท่วม inbox
    const again = await request(app).put(`/api/invoices/${a.invoiceId}/status`).set(auth(mgr.token)).send({ status: 'CANCELLED' })
    expect(again.body.request_id).toBe(r.body.request_id)
    // ผู้ขออนุมัติเองไม่ได้
    expect((await decide(mgr.token, r.body.request_id)).status).toBe(403)
    expect((await decide(s.master.token, r.body.request_id)).status).toBe(200)
    expect(statusOf('invoices', a.invoiceId)).toBe('CANCELLED')
    const rev = db.prepare("SELECT COUNT(*) n FROM journal_entries WHERE tenant_id = ? AND reference_type = 'INVOICE_CANCEL' AND reference_id = ?").get(s.t, a.invoiceId) as any
    expect(rev.n).toBe(1)

    const b = await confirmedSOWithInvoice(s, 2)
    const r2 = await request(app).put(`/api/invoices/${b.invoiceId}/status`).set(auth(mgr.token)).send({ status: 'CANCELLED' })
    expect((await decide(s.master.token, r2.body.request_id, 'REJECTED')).status).toBe(200)
    expect(statusOf('invoices', b.invoiceId)).toBe('DRAFT')
  })

  it('ADMIN ยกเลิกได้เลย + บันทึก AUTO · มีใบลดหนี้ที่ออกแล้ว → 409', async () => {
    const s = tenant()
    const admin = s.user('ADMIN')
    const a = await confirmedSOWithInvoice(s)
    const cn = await request(app).post('/api/sales/credit-notes').set(auth(admin.token)).send({ invoiceId: a.invoiceId, reason: 'ลด', amount: 50 })
    await request(app).put(`/api/sales/credit-notes/${cn.body.data.id}/status`).set(auth(admin.token)).send({ status: 'ISSUED' })
    const blocked = await request(app).put(`/api/invoices/${a.invoiceId}/status`).set(auth(admin.token)).send({ status: 'CANCELLED' })
    expect(blocked.status).toBe(409)
    expect(blocked.body.message).toContain(cn.body.data.cn_number)

    const b = await confirmedSOWithInvoice(s, 1)
    const draftCn = await request(app).post('/api/sales/credit-notes').set(auth(admin.token)).send({ invoiceId: b.invoiceId, reason: 'ลด', amount: 10 })
    expect((await request(app).put(`/api/invoices/${b.invoiceId}/status`).set(auth(admin.token)).send({ status: 'CANCELLED' })).status).toBe(200)
    expect(statusOf('credit_notes', draftCn.body.data.id), 'ใบลดหนี้ DRAFT ถูกยกเลิกตาม').toBe('CANCELLED')
    const auto = db.prepare("SELECT status FROM approval_requests WHERE tenant_id = ? AND module_type = 'sales_cancel' AND reference_id = ?").get(s.t, b.invoiceId) as any
    expect(auto.status).toBe('AUTO')
  })
})

describe('Task 3 — ภาษีหัก ณ ที่จ่าย', () => {
  it('ไม่มีสิทธิ์ 403 · base/rate ผิด 400 · ถูกต้อง 200', async () => {
    const s = tenant()
    const { invoiceId } = await confirmedSOWithInvoice(s)
    const post = (token: string, body: any) => request(app).post(`/api/invoices/${invoiceId}/withholding-tax`).set(auth(token)).send({ taxType: 'SERVICE', ...body })
    expect((await post(s.user('USER', ['PRODUCTION']).token, { taxBase: 100, taxRate: 3 })).status).toBe(403)
    for (const bad of [{ taxBase: -100, taxRate: 3 }, { taxBase: 0, taxRate: 3 }, { taxBase: 'abc', taxRate: 3 },
      { taxBase: 100, taxRate: 0 }, { taxBase: 100, taxRate: 50 }, { taxBase: 100, taxRate: 'x' }, { taxBase: 100000, taxRate: 3 }]) {
      expect((await post(s.master.token, bad)).status, JSON.stringify(bad)).toBe(400)
    }
    const ok = await post(s.master.token, { taxBase: 100, taxRate: 3 })
    expect(ok.status).toBe(200)
    expect(ok.body.data.withholdingTax.taxAmount).toBe(3)
  })
})

describe('Task 4/5 — ใบส่งของ & ใบแจ้งหนี้ต้องมาจาก SO ที่ยืนยันแล้ว', () => {
  it('SO DRAFT ออกใบส่งของ/ใบแจ้งหนี้ไม่ได้ · ต้องระบุบรรทัด SO · เกินค้างส่ง 400 · isPartial ตั้ง PARTIAL', async () => {
    const s = tenant()
    const draft = seedSO(s)
    expect((await request(app).post('/api/delivery-orders').set(auth(s.master.token))
      .send({ salesOrderId: draft.soId, isPartial: true, items: [{ salesOrderItemId: draft.soItemId, quantity: 1 }] })).status).toBe(400)
    expect(statusOf('sales_orders', draft.soId)).toBe('DRAFT')
    expect((await request(app).post('/api/invoices').set(auth(s.master.token)).send({ salesOrderId: draft.soId })).status).toBe(400)

    const so = seedSO(s, 5)
    await request(app).put(`/api/sales-orders/${so.soId}/status`).set(auth(s.master.token)).send({ status: 'CONFIRMED' })
    const post = (items: any[], isPartial = false) => request(app).post('/api/delivery-orders').set(auth(s.master.token)).send({ salesOrderId: so.soId, isPartial, items })
    expect((await post([{ quantity: 1 }])).status).toBe(400)
    expect((await post([{ salesOrderItemId: so.soItemId, quantity: 6 }])).status).toBe(400)
    const first = await post([{ salesOrderItemId: so.soItemId, quantity: 3 }], true)
    expect(first.status, JSON.stringify(first.body)).toBe(201)
    expect(statusOf('sales_orders', so.soId)).toBe('PARTIAL')
    expect((await post([{ salesOrderItemId: so.soItemId, quantity: 3 }])).status, 'ใบแรกยังไม่ส่ง กันไว้ 3 เหลือ 2').toBe(400)
    expect((await post([{ salesOrderItemId: so.soItemId, quantity: 2 }])).status).toBe(201)
  })
})

describe('Task 6 — คำสั่งขาย', () => {
  it('ยืนยัน SO: ตัดสต็อกไม่ผ่าน → 400 และสถานะไม่เปลี่ยน (ทรานแซกชันเดียว)', async () => {
    const s = tenant()
    const so = seedSO(s)
    db.exec(`CREATE TEMP TRIGGER fail_move_${s.t} BEFORE INSERT ON stock_movements WHEN NEW.tenant_id = '${s.t}'
      BEGIN SELECT RAISE(ABORT, 'จำลองตัดสต็อกพัง'); END`)
    try {
      const r = await request(app).put(`/api/sales-orders/${so.soId}/status`).set(auth(s.master.token)).send({ status: 'CONFIRMED' })
      expect(r.status).toBe(400)
    } finally {
      db.exec(`DROP TRIGGER IF EXISTS temp.fail_move_${s.t}`)
    }
    expect(statusOf('sales_orders', so.soId)).toBe('DRAFT')
    expect(stockQty(s.stockId)).toBe(100)
  })

  it('มีใบแจ้งหนี้ → ยกเลิก SO ไม่ได้ (409) · MANAGER ยกเลิก → 202 อนุมัติแล้วคืนสต็อก · DRAFT ยกเลิกได้เลย', async () => {
    const s = tenant()
    const mgr = s.user('MANAGER')
    const withInv = await confirmedSOWithInvoice(s)
    expect((await request(app).put(`/api/sales-orders/${withInv.soId}/status`).set(auth(s.master.token)).send({ status: 'CANCELLED' })).status).toBe(409)

    const so = seedSO(s, 4)
    await request(app).put(`/api/sales-orders/${so.soId}/status`).set(auth(s.master.token)).send({ status: 'CONFIRMED' })
    expect(stockQty(s.stockId)).toBe(91)
    const r = await request(app).put(`/api/sales-orders/${so.soId}/status`).set(auth(mgr.token)).send({ status: 'CANCELLED' })
    expect(r.status, JSON.stringify(r.body)).toBe(202)
    expect(statusOf('sales_orders', so.soId)).toBe('CONFIRMED')
    expect((await decide(s.master.token, r.body.request_id)).status).toBe(200)
    expect(statusOf('sales_orders', so.soId)).toBe('CANCELLED')
    expect(stockQty(s.stockId)).toBe(95)

    const draft = seedSO(s, 1)
    expect((await request(app).put(`/api/sales-orders/${draft.soId}/status`).set(auth(mgr.token)).send({ status: 'CANCELLED' })).status).toBe(200)
    expect((await request(app).put(`/api/sales-orders/${seedSO(s).soId}/status`).set(auth(s.user('POWERUSER').token)).send({ status: 'CANCELLED' })).status).toBe(403)
  })

  it('คำขออนุมัติที่ยกเลิกไม่ได้แล้ว (มีใบแจ้งหนี้เกิดระหว่างรอ) → อนุมัติไม่ผ่าน คำขอยัง PENDING', async () => {
    const s = tenant()
    const mgr = s.user('MANAGER')
    const so = seedSO(s, 2)
    await request(app).put(`/api/sales-orders/${so.soId}/status`).set(auth(s.master.token)).send({ status: 'CONFIRMED' })
    const r = await request(app).put(`/api/sales-orders/${so.soId}/status`).set(auth(mgr.token)).send({ status: 'CANCELLED' })
    expect(r.status).toBe(202)
    await request(app).post('/api/invoices').set(auth(s.master.token)).send({ salesOrderId: so.soId })
    expect((await decide(s.master.token, r.body.request_id)).status).toBe(409)
    expect(statusOf('approval_requests', r.body.request_id)).toBe('PENDING')
    expect(statusOf('sales_orders', so.soId)).toBe('CONFIRMED')
  })
})

describe('Task 7 — ยกเลิกใบเสร็จ', () => {
  it('MANAGER → 202 ใบเสร็จยังอยู่ · อนุมัติแล้วถูก void · MASTER ทำเลยได้', async () => {
    const s = tenant()
    const mgr = s.user('MANAGER')
    const a = await confirmedSOWithInvoice(s)
    const pay = (amt: number) => request(app).post('/api/receipts').set(auth(s.master.token)).send({ invoiceId: a.invoiceId, amount: amt, paymentMethod: 'CASH' })
    const r1 = (await pay(100)).body.data.receipt.id
    const r2 = (await pay(50)).body.data.receipt.id
    const req1 = await request(app).delete(`/api/receipts/${r1}`).set(auth(mgr.token))
    expect(req1.status).toBe(202)
    expect(db.prepare('SELECT 1 FROM receipts WHERE id = ?').get(r1)).toBeTruthy()
    expect((await decide(s.master.token, req1.body.request_id)).status).toBe(200)
    expect(db.prepare('SELECT 1 FROM receipts WHERE id = ?').get(r1)).toBeUndefined()
    expect((await request(app).delete(`/api/receipts/${r2}`).set(auth(s.master.token))).status).toBe(200)
    const inv = db.prepare('SELECT paid_amount, balance_amount FROM invoices WHERE id = ?').get(a.invoiceId) as any
    expect(inv.paid_amount).toBe(0)
    expect(inv.balance_amount).toBe(500)
  })
})

describe('Task 8 — ปิดกะ: ค่าใช้จ่ายเงินสด', () => {
  async function openShift(s: T) {
    const r = await request(app).post('/api/sales/pos-shifts/open').set(auth(s.master.token)).send({ opening_cash: 500 })
    expect(r.status).toBe(200)
    return r.body.data.id as string
  }

  it('ไม่มีเหตุผล/ยอดไม่ใช่ตัวเลขบวก/บัญชีของกิจการอื่น → 400 และกะยังเปิด', async () => {
    const s = tenant()
    const other = tenant()
    const foreignAcc = generateId()
    db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance) VALUES (?, ?, '5999', 'อื่น', 'EXPENSE', 'OPEX', 'DEBIT')`)
      .run(foreignAcc, other.t)
    const shiftId = await openShift(s)
    const close = (cash_expenses: any) => request(app).post(`/api/sales/pos-shifts/${shiftId}/close`).set(auth(s.master.token))
      .send({ closing_cash_counted: 400, cash_expenses })
    expect((await close([{ reason: '', amount: 100 }])).status).toBe(400)
    expect((await close([{ reason: 'น้ำแข็ง', amount: 'abc' }])).status).toBe(400)
    expect((await close([{ reason: 'น้ำแข็ง', amount: -5 }])).status).toBe(400)
    expect((await close([{ reason: 'น้ำแข็ง', amount: 'Infinity' }])).status).toBe(400)
    expect((await close([{ reason: 'น้ำแข็ง', amount: 100, account_id: foreignAcc }])).status).toBe(400)
    expect(statusOf('pos_shifts', shiftId)).toBe('OPEN')
  })

  it('ลงได้ไม่ต้องอนุมัติ · บันทึกความเคลื่อนไหวทุกรายการ · ส่ง LINE (LINE พังไม่ทำให้ปิดกะล้ม) · บัญชีของกิจการใช้ได้', async () => {
    const s = tenant()
    const accId = generateId()
    db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance) VALUES (?, ?, '5998', 'ค่าน้ำแข็ง', 'EXPENSE', 'OPEX', 'DEBIT')`)
      .run(accId, s.t)
    const spy = vi.spyOn(lineBotService, 'notifyShiftExpenses').mockRejectedValue(new Error('LINE ล่ม'))
    const shiftId = await openShift(s)
    const r = await request(app).post(`/api/sales/pos-shifts/${shiftId}/close`).set(auth(s.master.token)).send({
      closing_cash_counted: 350,
      cash_expenses: [{ reason: 'น้ำแข็ง', amount: 50, account_id: accId }, { reason: 'ผงซักฟอก', amount: 100 }],
    })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.data.cash_difference).toBe(0)
    const mv = db.prepare('SELECT account_id FROM pos_shift_cash_movements WHERE shift_id = ? AND reason = ?').get(shiftId, 'น้ำแข็ง') as any
    expect(mv.account_id).toBe(accId)
    const logs = db.prepare("SELECT status, amount, payload FROM approval_requests WHERE tenant_id = ? AND module_type = 'pos_shift_expense' ORDER BY amount").all(s.t) as any[]
    expect(logs.map(l => l.amount)).toEqual([50, 100])
    expect(logs.every(l => l.status === 'AUTO' && JSON.parse(l.payload).severity === 'medium')).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][1].expenses).toHaveLength(2)
  })
})

describe('Task 9 — ยกเลิกบิล POS ที่ออกใบกำกับเต็มรูปแล้ว', () => {
  it('มีใบกำกับที่ยังไม่ยกเลิก → 400 · ยกเลิกใบกำกับแล้วผ่านด่านนี้', async () => {
    const s = tenant()
    const billId = generateId()
    db.prepare(`INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, total_amount)
      VALUES (?, ?, ?, 'บิล', 'PAID', 107)`).run(billId, s.t, 'B-' + billId.slice(0, 6))
    const invId = generateId()
    db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, pos_bill_id, customer_id, total_amount, status)
      VALUES (?, ?, ?, ?, ?, 107, 'PAID')`).run(invId, s.t, 'INV-P-' + invId.slice(0, 6), billId, s.customerId)
    const r = await request(app).post(`/api/sales/pos-running-bills/${billId}/void`).set(auth(s.master.token)).send({ reason: 'x' })
    expect(r.status).toBe(400)
    expect(r.body.message).toContain('INV-P-')
    expect(statusOf('pos_running_bills', billId)).toBe('PAID')
  })
})
