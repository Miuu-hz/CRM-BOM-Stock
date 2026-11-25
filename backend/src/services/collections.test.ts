import { describe, it, expect, vi, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import salesRouter from '../routes/sales'
import activityRouter from '../routes/activity.routes'
import { createInvoiceFromSO, SalesBillingError } from './salesBilling.service'
import { collectionItems, getCollections } from './collections.service'
import { lineBotService } from './line-bot.service'
import { registerSalesTools } from '../mcp/tools/sales'
import type { IMcpServer } from '../mcp/sdk-compat'
import { thaiToday, addDaysStr } from './phopyBoard.service'

const app = express()
app.use(express.json())
app.use('/api/sales', salesRouter)
app.use('/api/activities', activityRouter)

const tenants: string[] = []

function setupTenant(role: 'ADMIN' | 'MANAGER' | 'POWERUSER' | 'MASTER' | 'USER' | 'OWNER' = 'ADMIN', existingTenantId?: string) {
  const u = createTestUser({ role: role as any, tenantId: existingTenantId })
  if (!existingTenantId) {
    tenants.push(u.tenantId)
    db.prepare(
      'INSERT INTO company_settings (tenant_id, name, allow_negative_stock, vat_registered) VALUES (?, ?, 1, 1)'
    ).run(u.tenantId, 'ร้านทดสอบ-' + u.tenantId.slice(0, 6))
  }
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${u.token}`)
  return { ...u, auth }
}

function seedCustomer(tenantId: string, name = 'ลูกค้าทดสอบ', phone = '0812345678') {
  const id = generateId()
  db.prepare(`
    INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, tenant_id)
    VALUES (?, ?, ?, 'RETAIL', 'x', 'x@example.com', ?, 'BKK', ?)
  `).run(id, 'CUS-' + id.slice(0, 8), name, phone, tenantId)
  return id
}

function seqLast(tenantId: string, docType: string): number {
  const r = db.prepare(
    'SELECT COALESCE(MAX(last_number), 0) AS n FROM document_sequences WHERE tenant_id = ? AND doc_type = ?'
  ).get(tenantId, docType) as { n: number }
  return r.n
}

function fakeMcp(tenantId: string) {
  const tools: Record<string, (args: any) => Promise<any>> = {}
  const server: IMcpServer = {
    tool: (name, _desc, _schema, handler) => { tools[name] = handler },
    connect: async () => {},
    close: async () => {},
  }
  registerSalesTools(server, tenantId)
  return tools
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM line_master_alerts WHERE key LIKE ?').run(`%${t}%`)
    for (const table of [
      'vat_entries', 'journal_lines', 'journal_entries', 'accounts', 'receipts',
      'invoice_items', 'invoices', 'stock_movements', 'sales_order_items', 'sales_orders',
      'quotation_items', 'quotations', 'activity_logs', 'customers', 'stock_items',
      'document_sequences', 'line_user_mappings', 'line_push_counts', 'tenant_subscriptions',
      'company_settings', 'users',
    ]) {
      try { db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(t) } catch { /* ignore */ }
    }
  }
})

describe('Due dates: inheritance, PUT keep/clear/invalid, no number burned', () => {
  it('สืบทอดวันครบกำหนดชำระ QT -> SO -> INV (ทั้ง REST และ createInvoiceFromSO) และ override ได้', async () => {
    const s = setupTenant('ADMIN')
    const customerId = seedCustomer(s.tenantId)
    const item = { productName: 'สินค้าทดสอบ', quantity: 2, unitPrice: 500, unit: 'pcs' }

    // 1. สร้าง QT พร้อม dueDate
    const qtRes = await s.auth(request(app).post('/api/sales/quotations')).send({
      customerId, dueDate: '2026-07-15', expiryDate: '2026-07-01', taxRate: 0, items: [item],
    })
    expect(qtRes.status).toBe(201)
    expect(qtRes.body.data.due_date).toBe('2026-07-15')
    expect(qtRes.body.data.expiry_date).toBe('2026-07-01')

    // 2. สร้าง SO จาก QT โดยไม่ส่ง dueDate -> สืบทอดจาก QT
    const soRes = await s.auth(request(app).post('/api/sales/sales-orders')).send({
      quotationId: qtRes.body.data.id, customerId, taxRate: 0, items: [item],
    })
    expect(soRes.status).toBe(201)
    expect(soRes.body.data.due_date).toBe('2026-07-15')

    // ยืนยัน SO เพื่อให้ออกใบแจ้งหนี้ได้
    const confRes = await s.auth(request(app).put(`/api/sales/sales-orders/${soRes.body.data.id}/status`))
      .send({ status: 'CONFIRMED' })
    expect(confRes.status).toBe(200)

    // 3. ออก INV ผ่าน REST โดยไม่ส่ง dueDate -> สืบทอดจาก SO
    const invRes = await s.auth(request(app).post('/api/sales/invoices')).send({
      salesOrderId: soRes.body.data.id,
    })
    expect(invRes.status).toBe(201)
    expect(invRes.body.data.due_date).toBe('2026-07-15')

    // 4. เรียก createInvoiceFromSO ตรงๆ กับ SO ที่มี due_date -> สืบทอด และระบุ dueDate เอง -> override
    const so2Res = await s.auth(request(app).post('/api/sales/sales-orders')).send({
      customerId, dueDate: '2026-08-10', taxRate: 0, items: [item],
    })
    expect(so2Res.status).toBe(201)
    await s.auth(request(app).put(`/api/sales/sales-orders/${so2Res.body.data.id}/status`)).send({ status: 'CONFIRMED' })

    const { invoice: invDirect } = createInvoiceFromSO(s.tenantId, { salesOrderId: so2Res.body.data.id })
    expect(invDirect.due_date).toBe('2026-08-10')

    const so3Res = await s.auth(request(app).post('/api/sales/sales-orders')).send({
      customerId, dueDate: '2026-08-10', taxRate: 0, items: [item],
    })
    await s.auth(request(app).put(`/api/sales/sales-orders/${so3Res.body.data.id}/status`)).send({ status: 'CONFIRMED' })
    const { invoice: invOverride } = createInvoiceFromSO(s.tenantId, { salesOrderId: so3Res.body.data.id, dueDate: '2026-09-01' })
    expect(invOverride.due_date).toBe('2026-09-01')

    // 5. MCP create_quotation รองรับ due_date
    const mcp = fakeMcp(s.tenantId)
    const mcpRes = JSON.parse((await mcp['create_quotation']({
      items: [{ description: 'บริการติดตั้ง', quantity: 1, unitPrice: 1200 }],
      due_date: '2026-08-20',
    })).content[0].text)
    expect(mcpRes.success).toBe(true)
    const mcpQt = db.prepare('SELECT due_date FROM quotations WHERE quotation_number = ? AND tenant_id = ?')
      .get(mcpRes.เลขที่ใบเสนอราคา, s.tenantId) as any
    expect(mcpQt.due_date).toBe('2026-08-20')
  })

  it('PUT keep (undefined) / clear (null หรือ "") / invalid 400 และไม่เสียเลขเอกสารเมื่อ invalid', async () => {
    const s = setupTenant('ADMIN')
    const other = setupTenant('ADMIN')
    const customerId = seedCustomer(s.tenantId)
    const item = { productName: 'สินค้า', quantity: 1, unitPrice: 100, unit: 'pcs' }

    // invalid dueDate บน POST ต้อง 400 และเลขเอกสารไม่เดิน
    const qtSeqBefore = seqLast(s.tenantId, 'QUOTATION')
    const badQt = await s.auth(request(app).post('/api/sales/quotations')).send({
      customerId, dueDate: '2026-02-29', taxRate: 0, items: [item], // 2026 ไม่ใช่ปีอธิกสุรทิน
    })
    expect(badQt.status).toBe(400)
    expect(badQt.body.message).toBe('วันครบกำหนดชำระไม่ถูกต้อง')
    expect(seqLast(s.tenantId, 'QUOTATION')).toBe(qtSeqBefore)

    const soSeqBefore = seqLast(s.tenantId, 'SALES_ORDER')
    const badSo = await s.auth(request(app).post('/api/sales/sales-orders')).send({
      customerId, dueDate: 'not-a-date', taxRate: 0, items: [item],
    })
    expect(badSo.status).toBe(400)
    expect(badSo.body.message).toBe('วันครบกำหนดชำระไม่ถูกต้อง')
    expect(seqLast(s.tenantId, 'SALES_ORDER')).toBe(soSeqBefore)

    // QT valid แล้ว PUT keep / clear / invalid
    const qt = (await s.auth(request(app).post('/api/sales/quotations')).send({
      customerId, dueDate: '2026-06-10', taxRate: 0, items: [item],
    })).body.data

    const qtKeep = await s.auth(request(app).put(`/api/sales/quotations/${qt.id}`)).send({
      taxRate: 0, items: [item],
    })
    expect(qtKeep.status).toBe(200)
    expect(qtKeep.body.data.due_date).toBe('2026-06-10')

    const qtInvalid = await s.auth(request(app).put(`/api/sales/quotations/${qt.id}`)).send({
      dueDate: '2026-04-31', taxRate: 0, items: [item],
    })
    expect(qtInvalid.status).toBe(400)
    expect(qtInvalid.body.message).toBe('วันครบกำหนดชำระไม่ถูกต้อง')

    const qtClear = await s.auth(request(app).put(`/api/sales/quotations/${qt.id}`)).send({
      dueDate: '', taxRate: 0, items: [item],
    })
    expect(qtClear.status).toBe(200)
    expect(qtClear.body.data.due_date).toBeNull()

    // SO PUT keep / clear / invalid
    const so = (await s.auth(request(app).post('/api/sales/sales-orders')).send({
      customerId, dueDate: '2026-06-20', taxRate: 0, items: [item],
    })).body.data

    const soKeep = await s.auth(request(app).put(`/api/sales/sales-orders/${so.id}`)).send({
      taxRate: 0, items: [item],
    })
    expect(soKeep.status).toBe(200)
    expect(soKeep.body.data.due_date).toBe('2026-06-20')

    const soClear = await s.auth(request(app).put(`/api/sales/sales-orders/${so.id}`)).send({
      dueDate: null, taxRate: 0, items: [item],
    })
    expect(soClear.status).toBe(200)
    expect(soClear.body.data.due_date).toBeNull()

    // createInvoiceFromSO invalid dueDate -> ไม่เสียเลข INV
    await s.auth(request(app).put(`/api/sales/sales-orders/${so.id}/status`)).send({ status: 'CONFIRMED' })
    const invSeqBefore = seqLast(s.tenantId, 'INVOICE')
    expect(() => createInvoiceFromSO(s.tenantId, { salesOrderId: so.id, dueDate: '2026-13-01' })).toThrow(SalesBillingError)
    expect(seqLast(s.tenantId, 'INVOICE')).toBe(invSeqBefore)

    // สืบทอด QT ข้าม tenant ต้องไม่ได้
    const otherCust = seedCustomer(other.tenantId)
    const crossSo = await other.auth(request(app).post('/api/sales/sales-orders')).send({
      quotationId: qt.id, customerId: otherCust, taxRate: 0, items: [item],
    })
    expect(crossSo.status).toBe(400)
  })
})

describe('PUT /due-date endpoints: roles, tenant isolation, CANCELLED, invoice sync', () => {
  it('ตรวจสิทธิ์ 403/200, ข้ามบริษัท 404, CANCELLED 400, อัปเดต INV ค้างรับและไม่ลงบัญชี', async () => {
    const admin = setupTenant('ADMIN')
    const manager = setupTenant('MANAGER', admin.tenantId)
    const poweruser = setupTenant('POWERUSER', admin.tenantId)
    const owner = setupTenant('OWNER', admin.tenantId)
    const master = setupTenant('MASTER', admin.tenantId)
    const basicUser = setupTenant('USER', admin.tenantId)
    const other = setupTenant('ADMIN')

    const customerId = seedCustomer(admin.tenantId)
    const soId = generateId()
    const invOpenId = generateId()
    const invPaidId = generateId()
    const invCancelledId = generateId()

    db.prepare(`
      INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, status, payment_status, total_amount, due_date)
      VALUES (?, ?, 'SO-DD-1', ?, 'CONFIRMED', 'UNPAID', 1000, '2026-05-01')
    `).run(soId, admin.tenantId, customerId)

    db.prepare(`
      INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, status, payment_status, total_amount, balance_amount, due_date)
      VALUES (?, ?, 'INV-DD-OPEN', ?, ?, 'ISSUED', 'UNPAID', 1000, 500, '2026-05-01')
    `).run(invOpenId, admin.tenantId, soId, customerId)

    db.prepare(`
      INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, status, payment_status, total_amount, balance_amount, due_date)
      VALUES (?, ?, 'INV-DD-PAID', ?, ?, 'PAID', 'PAID', 1000, 0, '2026-05-01')
    `).run(invPaidId, admin.tenantId, soId, customerId)

    db.prepare(`
      INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, status, payment_status, total_amount, balance_amount, due_date)
      VALUES (?, ?, 'INV-DD-CANC', ?, ?, 'CANCELLED', 'UNPAID', 1000, 1000, '2026-05-01')
    `).run(invCancelledId, admin.tenantId, soId, customerId)

    // USER -> 403 ทั้งสอง endpoint
    expect((await basicUser.auth(request(app).put(`/api/sales/sales-orders/${soId}/due-date`)).send({ dueDate: '2026-06-01' })).status).toBe(403)
    expect((await basicUser.auth(request(app).put(`/api/sales/invoices/${invOpenId}/due-date`)).send({ dueDate: '2026-06-01' })).status).toBe(403)

    // บริษัทอื่น -> 404
    expect((await other.auth(request(app).put(`/api/sales/sales-orders/${soId}/due-date`)).send({ dueDate: '2026-06-01' })).status).toBe(404)
    expect((await other.auth(request(app).put(`/api/sales/invoices/${invOpenId}/due-date`)).send({ dueDate: '2026-06-01' })).status).toBe(404)

    // CANCELLED -> 400
    const cancelledSoId = generateId()
    db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, status, total_amount) VALUES (?, ?, 'SO-CANC', ?, 'CANCELLED', 100)`)
      .run(cancelledSoId, admin.tenantId, customerId)
    expect((await admin.auth(request(app).put(`/api/sales/sales-orders/${cancelledSoId}/due-date`)).send({ dueDate: '2026-06-01' })).status).toBe(400)
    expect((await admin.auth(request(app).put(`/api/sales/invoices/${invCancelledId}/due-date`)).send({ dueDate: '2026-06-01' })).status).toBe(400)

    // ADMIN / MANAGER / POWERUSER / OWNER / MASTER ผ่านหมด
    for (const [idx, actor] of [admin, manager, poweruser, owner, master].entries()) {
      const targetDate = `2026-06-0${idx + 1}`
      const r = await actor.auth(request(app).put(`/api/sales/sales-orders/${soId}/due-date`)).send({ dueDate: targetDate })
      expect(r.status).toBe(200)
      expect(r.body.data.due_date).toBe(targetDate)
    }

    // ตรวจการอัปเดตใบแจ้งหนี้ลูก: เฉพาะใบที่ยังไม่ยกเลิกและ balance_amount > 0
    expect((db.prepare('SELECT due_date FROM invoices WHERE id = ?').get(invOpenId) as any).due_date).toBe('2026-06-05')
    expect((db.prepare('SELECT due_date FROM invoices WHERE id = ?').get(invPaidId) as any).due_date).toBe('2026-05-01')
    expect((db.prepare('SELECT due_date FROM invoices WHERE id = ?').get(invCancelledId) as any).due_date).toBe('2026-05-01')

    // PUT /invoices/:id/due-date และล้างค่าเป็น null
    const invUpd = await manager.auth(request(app).put(`/api/sales/invoices/${invOpenId}/due-date`)).send({ dueDate: null })
    expect(invUpd.status).toBe(200)
    expect(invUpd.body.data.due_date).toBeNull()

    // ไม่มีการลงบัญชีเพิ่ม
    const jvCount = (db.prepare('SELECT COUNT(*) AS c FROM journal_entries WHERE tenant_id = ?').get(admin.tenantId) as any).c
    expect(jvCount).toBe(0)
  })
})

describe('Collections service + GET /api/sales/collections + POST /api/activities', () => {
  it('รวมบิลไม่นับ SO ซ้ำกับ INV, จัดการ null due, next_follow_date override/clear, summary และแยก tenant', async () => {
    const tA = setupTenant('ADMIN')
    const tUser = setupTenant('USER', tA.tenantId)
    const tB = setupTenant('ADMIN')
    const custA1 = seedCustomer(tA.tenantId, 'ลูกหนี้ เอ1', '0811111111')
    const custA2 = seedCustomer(tA.tenantId, 'ลูกหนี้ เอ2', '0822222222')
    const custB = seedCustomer(tB.tenantId, 'ลูกหนี้ บี', '0899999999')

    const today = '2026-05-10'

    // 1. INVOICE ค้างชำระ เกินกำหนด 2 วัน (2026-05-08), balance = 1500
    const soInvoicedId = generateId()
    db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, status, payment_status, total_amount, due_date)
      VALUES (?, ?, 'SO-HAS-INV', ?, 'CONFIRMED', 'UNPAID', 2000, '2026-05-08')`).run(soInvoicedId, tA.tenantId, custA1)
    const invOverdueId = generateId()
    db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, status, payment_status, total_amount, balance_amount, due_date)
      VALUES (?, ?, 'INV-1', ?, ?, 'ISSUED', 'PARTIAL', 2000, 1500, '2026-05-08')`).run(invOverdueId, tA.tenantId, soInvoicedId, custA1)

    // 2. INVOICE ไม่มี due_date (null) -> ต้องแสดงท้ายสุดและไม่นับเข้า summary
    const soNullId = generateId()
    db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, status, payment_status, total_amount)
      VALUES (?, ?, 'SO-NULL', ?, 'CONFIRMED', 'UNPAID', 800)`).run(soNullId, tA.tenantId, custA2)
    const invNullId = generateId()
    db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, status, payment_status, total_amount, balance_amount, due_date)
      VALUES (?, ?, 'INV-NULL', ?, ?, 'DRAFT', 'UNPAID', 800, 800, NULL)`).run(invNullId, tA.tenantId, soNullId, custA2)

    // 3. INVOICE PAID / CANCELLED (DRAFT นับเป็นหนี้แล้ว) -> ต้องไม่โผล่
    db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, status, payment_status, total_amount, balance_amount, due_date)
      VALUES (?, ?, 'INV-CANCELLED', ?, ?, 'CANCELLED', 'UNPAID', 900, 900, '2026-05-01')`).run(generateId(), tA.tenantId, soNullId, custA1)
    db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, status, payment_status, total_amount, balance_amount, due_date)
      VALUES (?, ?, 'INV-PAID', ?, ?, 'PAID', 'PAID', 900, 0, '2026-05-01')`).run(generateId(), tA.tenantId, soNullId, custA1)

    // 4. SO ยืนยันแล้ว ไม่มี INV ครบวันนี้ (2026-05-10) ยอด 3000 + SO DRAFT (ไม่นับ)
    const soTodayId = generateId()
    db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, status, payment_status, total_amount, due_date)
      VALUES (?, ?, 'SO-OPEN', ?, 'CONFIRMED', 'UNPAID', 3000, '2026-05-10')`).run(soTodayId, tA.tenantId, custA1)
    db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, status, payment_status, total_amount, due_date)
      VALUES (?, ?, 'SO-DRAFT', ?, 'DRAFT', 'UNPAID', 5000, '2026-05-10')`).run(generateId(), tA.tenantId, custA1)

    // 5. QT เปิด อีก 2 วัน (2026-05-12) ยอด 4000 (นับ count ใน soon, ไม่รวมยอดเงิน) + QT ที่มี SO แล้ว (ไม่นับ)
    const qtOpenId = generateId()
    db.prepare(`INSERT INTO quotations (id, tenant_id, quotation_number, customer_id, status, total_amount, due_date)
      VALUES (?, ?, 'QT-OPEN', ?, 'SENT', 4000, '2026-05-12')`).run(qtOpenId, tA.tenantId, custA2)
    const qtConvertedId = generateId()
    db.prepare(`INSERT INTO quotations (id, tenant_id, quotation_number, customer_id, status, total_amount, due_date)
      VALUES (?, ?, 'QT-CONV', ?, 'SENT', 9999, '2026-05-09')`).run(qtConvertedId, tA.tenantId, custA2)
    db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, quotation_id, customer_id, status, payment_status, total_amount)
      VALUES (?, ?, 'SO-FROM-QT', ?, ?, 'DRAFT', 'UNPAID', 9999)`).run(generateId(), tA.tenantId, qtConvertedId, custA2)

    // 6. ข้อมูลบริษัท B (ห้ามรั่วมาที่ A)
    const soBId = generateId()
    db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, status, payment_status, total_amount, due_date)
      VALUES (?, ?, 'SO-B', ?, 'CONFIRMED', 'UNPAID', 7777, '2026-05-05')`).run(soBId, tB.tenantId, custB)

    const col1 = getCollections(tA.tenantId, { today })
    // ต้องมี 4 รายการ (INV-1, SO-OPEN, QT-OPEN, INV-NULL) — ไม่นับ SO-HAS-INV ซ้ำ
    expect(col1.items.map(i => i.number)).toEqual(['INV-1', 'SO-OPEN', 'QT-OPEN', 'INV-NULL'])
    expect(col1.items[0].days_left).toBe(-2)
    expect(col1.items[1].days_left).toBe(0)
    expect(col1.items[2].days_left).toBe(2)
    expect(col1.items[3].days_left).toBeNull()

    expect(col1.summary).toEqual({
      overdue: { count: 1, amount: 1500 },
      today: { count: 1, amount: 3000 },
      soon: { count: 1, amount: 0 }, // QT นับจำนวน ไม่รวมยอดเงิน
    })

    // ตรวจ POST /api/activities validation + next_follow_date override + clear
    expect((await tA.auth(request(app).post('/api/activities')).send({
      customerId: custA1, type: 'CALL', note: 'bad date', nextFollowDate: '2026-02-30',
    })).status).toBe(400)
    expect((await tA.auth(request(app).post('/api/activities')).send({
      customerId: custA1, type: 'CALL', note: 'bad docType', docType: 'PO', docId: invOverdueId,
    })).status).toBe(400)
    expect((await tA.auth(request(app).post('/api/activities')).send({
      customerId: custA1, type: 'CALL', note: 'wrong customer', docType: 'INVOICE', docId: invNullId,
    })).status).toBe(400)
    expect((await tA.auth(request(app).post('/api/activities')).send({
      customerId: custA1, type: 'CALL', note: 'other tenant', docType: 'SALES_ORDER', docId: soBId,
    })).status).toBe(400)

    // เลื่อนวันติดตาม INV-1 ไป 2026-05-13 (days_left = 3)
    const act1 = await tA.auth(request(app).post('/api/activities')).send({
      customerId: custA1, type: 'CALL', note: 'ลูกค้าขอจ่ายวันที่ 13',
      docType: 'INVOICE', docId: invOverdueId, nextFollowDate: '2026-05-13',
    })
    expect(act1.status).toBe(201)

    const col2 = getCollections(tA.tenantId, { today })
    expect(col2.items.map(i => i.number)).toEqual(['SO-OPEN', 'QT-OPEN', 'INV-1', 'INV-NULL'])
    const invAfterMove = col2.items.find(i => i.id === invOverdueId)!
    expect(invAfterMove.next_follow_date).toBe('2026-05-13')
    expect(invAfterMove.follow_date).toBe('2026-05-13')
    expect(invAfterMove.days_left).toBe(3)
    expect(invAfterMove.last_follow?.note).toBe('ลูกค้าขอจ่ายวันที่ 13')

    // บันทึกกิจกรรมใหม่ที่ nextFollowDate = null -> ไม่ล้างนัดเดิม แค่เปลี่ยน last_follow
    const act2 = await tA.auth(request(app).post('/api/activities')).send({
      customerId: custA1, type: 'NOTE', note: 'โทรแล้วไม่รับ',
      docType: 'INVOICE', docId: invOverdueId, nextFollowDate: null,
    })
    expect(act2.status).toBe(201)
    const col3 = collectionItems(tA.tenantId, { today })
    const kept = col3.find(x => x.id === invOverdueId)!
    expect(kept.next_follow_date).toBe('2026-05-13')
    expect(kept.days_left).toBe(3)
    expect(kept.last_follow?.note).toBe('โทรแล้วไม่รับ')

    // GET /api/sales/collections role + customerId filter
    expect((await tUser.auth(request(app).get('/api/sales/collections'))).status).toBe(403)
    const apiCol = await tA.auth(request(app).get(`/api/sales/collections?customerId=${custA2}`))
    expect(apiCol.status).toBe(200)
    expect(apiCol.body.data.items.map((i: any) => i.number)).toEqual(['QT-OPEN', 'INV-NULL'])

    // GET /api/activities/customer/:customerId แนบ doc_number
    const actList = await tA.auth(request(app).get(`/api/activities/customer/${custA1}`))
    expect(actList.status).toBe(200)
    expect(actList.body.data[0].doc_number).toBe('INV-1')
  })
})

describe('LINE sendCollectionDigests: trigger days, once per day, staff only, subscription', () => {
  it('ส่งเฉพาะวันทริกเกอร์ [3,0,-1,-7,-15,-30], ส่งถึง adminLineUsers เท่านั้น, วันละครั้ง และข้าม EXPIRED', async () => {
    const push = vi.fn(async (_to: string, _m: any) => {})
    vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ pushMessage: push })

    const tActive = setupTenant('ADMIN')
    const tNoTrigger = setupTenant('ADMIN')
    const tExpired = setupTenant('ADMIN')

    const today = thaiToday()

    // ผูก LINE ของ ADMIN (ควรได้), USER (ห้ามได้), และลูกค้า (ห้ามได้)
    const adminLine = 'U_ADM_' + generateId()
    const userLine = 'U_USR_' + generateId()
    const userObj = setupTenant('USER', tActive.tenantId)
    db.prepare('INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, ?)')
      .run(generateId(), tActive.tenantId, tActive.userId, adminLine, 'ADMIN')
    db.prepare('INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, ?)')
      .run(generateId(), tActive.tenantId, userObj.userId, userLine, 'USER')

    const custActive = seedCustomer(tActive.tenantId, 'บริษัท ก')
    // บิลวันทริกเกอร์: +3 (SO ยังไม่ออกบิล) และ -7 (INV), บิลนอกทริกเกอร์: -2 (ไม่โผล่ในลิสต์แต่รวมในยอดเกินกำหนด)
    const soInvoiced = generateId()
    db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, status, payment_status, total_amount, due_date)
      VALUES (?, ?, 'SO-INVOICED', ?, 'CONFIRMED', 'UNPAID', 2500, ?)`).run(soInvoiced, tActive.tenantId, custActive, addDaysStr(today, -7))
    db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, status, payment_status, total_amount, due_date)
      VALUES (?, ?, 'SO-D3', ?, 'CONFIRMED', 'UNPAID', 1200, ?)`).run(generateId(), tActive.tenantId, custActive, addDaysStr(today, 3))
    db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, status, payment_status, total_amount, balance_amount, due_date)
      VALUES (?, ?, 'INV-D-7', ?, ?, 'ISSUED', 'UNPAID', 2500, 2500, ?)`).run(generateId(), tActive.tenantId, soInvoiced, custActive, addDaysStr(today, -7))
    db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, status, payment_status, total_amount, balance_amount, due_date)
      VALUES (?, ?, 'INV-D-2', ?, ?, 'ISSUED', 'UNPAID', 500, 500, ?)`).run(generateId(), tActive.tenantId, soInvoiced, custActive, addDaysStr(today, -2))

    // บริษัทที่มีเฉพาะบิล +2 วัน (ไม่เข้าทริกเกอร์) -> ห้ามส่ง
    const adminNoTrigLine = 'U_ADM2_' + generateId()
    db.prepare('INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, ?)')
      .run(generateId(), tNoTrigger.tenantId, tNoTrigger.userId, adminNoTrigLine, 'ADMIN')
    const custNoTrig = seedCustomer(tNoTrigger.tenantId, 'บริษัท ข')
    db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, status, payment_status, total_amount, due_date)
      VALUES (?, ?, 'SO-D2', ?, 'CONFIRMED', 'UNPAID', 900, ?)`).run(generateId(), tNoTrigger.tenantId, custNoTrig, addDaysStr(today, 2))

    // บริษัทที่แพ็กเกจ EXPIRED -> ห้ามส่งแม้มีบิลเข้าทริกเกอร์
    const adminExpLine = 'U_ADMX_' + generateId()
    db.prepare('INSERT INTO line_user_mappings (id, tenant_id, user_id, line_user_id, role) VALUES (?, ?, ?, ?, ?)')
      .run(generateId(), tExpired.tenantId, tExpired.userId, adminExpLine, 'ADMIN')
    db.prepare(`INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status) VALUES (?, ?, 'free', 'EXPIRED')`)
      .run(generateId(), tExpired.tenantId)
    const custExp = seedCustomer(tExpired.tenantId, 'บริษัท ค')
    db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, status, payment_status, total_amount, due_date)
      VALUES (?, ?, 'SO-EXP', ?, 'CONFIRMED', 'UNPAID', 900, ?)`).run(generateId(), tExpired.tenantId, custExp, today)

    await lineBotService.sendCollectionDigests(today)

    const activeCalls = push.mock.calls.filter((c: any[]) => c[0] === adminLine)
    expect(activeCalls).toHaveLength(1)
    expect(push.mock.calls.map((c: any[]) => c[0])).not.toContain(userLine)
    expect(push.mock.calls.map((c: any[]) => c[0])).not.toContain(adminNoTrigLine)
    expect(push.mock.calls.map((c: any[]) => c[0])).not.toContain(adminExpLine)

    const msgText = (activeCalls[0][1] as any).text as string
    expect(msgText).toContain('INV-D-7')
    expect(msgText).toContain('SO-D3')
    expect(msgText).not.toContain('SO-INVOICED') // SO ที่มี INV แล้วต้องไม่แสดงซ้ำ
    expect(msgText).not.toContain('INV-D-2')
    expect(msgText).toContain('ดูทั้งหมดที่ เมนูกระดิ่ง / CRM > ตามบิล')
    expect(msgText).toContain('3,000.00') // รวมเกินกำหนดทั้งหมด = 2500 + 500

    // รันซ้ำวันเดิม -> ต้องไม่ส่งซ้ำ
    const callsBefore = push.mock.calls.length
    await lineBotService.sendCollectionDigests(today)
    expect(push.mock.calls.length).toBe(callsBefore)
  })
})
