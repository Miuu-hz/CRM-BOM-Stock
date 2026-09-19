import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import { createTestUser } from '../../test/testAuth'
import quotationsRouter from './quotations'
import salesOrdersRouter from './salesOrders'
import deliveryOrdersRouter from './deliveryOrders'
import invoicesRouter from './invoices'
import receiptsRouter from './receipts'

/** นับสมุดรายวันแยกตามชนิดเอกสารต้นทาง — { SO_COGS: 1, INVOICE: 1 } อ่านง่ายกว่าเลขรวม
 *  และถ้าลงซ้ำจะเห็นทันทีว่าซ้ำที่ชนิดไหน */
const byRefType = (rows: any[]) =>
  rows.reduce<Record<string, number>>((m, e) => { m[e.reference_type] = (m[e.reference_type] || 0) + 1; return m }, {})

/**
 * เดินสายขายทั้งเส้นผ่าน HTTP จริงเหมือนคนกดปุ่มทีละปุ่ม
 *   ใบเสนอราคา → คำสั่งขาย → ยืนยัน → ส่งของแล้ว → ใบส่งของ → ใบแจ้งหนี้ → ใบเสร็จ → เสร็จสิ้น
 * สิ่งที่เทสต์นี้เฝ้าคือ **ของต้องออกจากคลังครั้งเดียว** ไม่ว่าจะเดินผ่านกี่ขั้น
 * และเอกสารขั้นถัดไปต้องเกิดขึ้นจริงจากการกดขั้นก่อนหน้า ไม่ใช่ต้องไปสร้างเอง
 */
const app = express()
app.use(express.json())
app.use('/api/quotations', authenticate, quotationsRouter)
app.use('/api/sales-orders', authenticate, salesOrdersRouter)
app.use('/api/delivery-orders', authenticate, deliveryOrdersRouter)
app.use('/api/invoices', authenticate, invoicesRouter)
app.use('/api/receipts', authenticate, receiptsRouter)

const tenants: string[] = []
function setup() {
  const user = createTestUser({ role: 'ADMIN' })
  tenants.push(user.tenantId)
  const t = user.tenantId
  db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock) VALUES (?, ?, 0)').run(t, 'ร้านทดสอบ')

  const customerId = generateId()
  db.prepare(`
    INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, address, city, status)
    VALUES (?, ?, ?, 'ลูกค้าทดสอบ', 'RETAIL', '-', 'x@example.com', '0800000000', '1 ถนนทดสอบ', 'BKK', 'ACTIVE')
  `).run(customerId, t, 'CUS-' + customerId.slice(0, 6))

  const stockId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status, unit_cost, unit_price)
    VALUES (?, ?, ?, 'สินค้าทดสอบ', 'FINISHED', 100, 'pcs', 'pcs', 'MAIN', 'ACTIVE', 60, 100)
  `).run(stockId, t, 'SKU-' + stockId.slice(0, 6))

  return { ...user, customerId, stockId, auth: (r: any) => r.set('Authorization', 'Bearer ' + user.token) }
}

const qtyOf = (stockId: string) => (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockId) as any).quantity
const outMoves = (t: string, soNumber: string) =>
  db.prepare("SELECT * FROM stock_movements WHERE tenant_id = ? AND type = 'OUT' AND reference = ?").all(t, 'SO: ' + soNumber) as any[]

afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const table of ['journal_lines', 'journal_entries', 'receipts', 'invoice_items', 'invoices',
      'delivery_order_items', 'delivery_orders', 'stock_movements', 'sales_order_items', 'sales_orders',
      'quotation_items', 'quotations', 'customers', 'stock_items', 'accounts', 'document_sequences',
      'approval_requests', 'company_settings', 'users']) {
      try { db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(t) } catch { /* ตารางไม่มีคอลัมน์นี้ */ }
    }
  }
})

describe('สายขายทั้งเส้น — กดทีละปุ่มเหมือนหน้างาน', () => {
  it('ใบเสนอราคา → คำสั่งขาย → ส่งของ → ใบแจ้งหนี้ → ใบเสร็จ: ของออกจากคลังครั้งเดียว', async () => {
    const s = setup()
    const line = { productId: s.stockId, productName: 'สินค้าทดสอบ', quantity: 10, unit: 'pcs', unitPrice: 100 }

    // ── 1. ใบเสนอราคา ────────────────────────────────────────────────────────
    const qt = await s.auth(request(app).post('/api/quotations')).send({
      customerId: s.customerId, items: [line], taxRate: 7,
    })
    expect(qt.status, 'สร้างใบเสนอราคา').toBe(201)

    // ── 2. แปลงเป็นคำสั่งขาย — ใบเสนอราคาต้องถูกปิดเป็น ACCEPTED ให้เอง ──────────
    const so = await s.auth(request(app).post('/api/sales-orders')).send({
      quotationId: qt.body.data.id, customerId: s.customerId, items: [line], taxRate: 7,
    })
    expect(so.status, 'สร้างคำสั่งขาย').toBe(201)
    const soId = so.body.data.id
    const soNumber = so.body.data.so_number
    expect((db.prepare('SELECT status FROM quotations WHERE id = ?').get(qt.body.data.id) as any).status,
      'ใบเสนอราคาต้องถูกปิดเป็น ACCEPTED อัตโนมัติ').toBe('ACCEPTED')
    expect(qtyOf(s.stockId), 'ยังไม่ยืนยัน ของต้องยังอยู่ครบ').toBe(100)

    // ── 3. ยืนยัน → ตัดสต็อกที่นี่ที่เดียว ────────────────────────────────────
    const confirm = await s.auth(request(app).put(`/api/sales-orders/${soId}/status`)).send({ status: 'CONFIRMED' })
    expect(confirm.status).toBe(200)
    expect(qtyOf(s.stockId), 'ยืนยันแล้วต้องตัด 10').toBe(90)
    expect(outMoves(s.tenantId, soNumber), 'รายการตัดออกต้องมีใบเดียว').toHaveLength(1)

    // ── 4. กำลังดำเนินการ / พร้อมส่ง — ต้องไม่แตะสต็อก ──────────────────────────
    for (const st of ['PROCESSING', 'READY']) {
      const r = await s.auth(request(app).put(`/api/sales-orders/${soId}/status`)).send({ status: st })
      expect(r.status, st).toBe(200)
    }
    expect(qtyOf(s.stockId), 'เปลี่ยนสถานะกลางทางต้องไม่แตะสต็อก').toBe(90)

    // ── 5. ส่งของแล้ว → ต้องได้ใบส่งของอัตโนมัติ และห้ามตัดซ้ำ ────────────────────
    const delivered = await s.auth(request(app).put(`/api/sales-orders/${soId}/status`)).send({ status: 'DELIVERED' })
    expect(delivered.status).toBe(200)
    const dos = db.prepare('SELECT * FROM delivery_orders WHERE sales_order_id = ?').all(soId) as any[]
    expect(dos, 'กดส่งของแล้วต้องได้ใบส่งของ 1 ใบ ไม่ต้องไปสร้างเอง').toHaveLength(1)
    expect(dos[0].status).toBe('SHIPPED')
    expect(qtyOf(s.stockId), 'ออกใบส่งของแล้วห้ามตัดซ้ำ').toBe(90)

    // ── 6. หน้างานกดรับของ (ใบส่งของ → DELIVERED) — ยังห้ามตัดซ้ำ ────────────────
    const doDone = await s.auth(request(app).put(`/api/delivery-orders/${dos[0].id}/status`)).send({ status: 'DELIVERED' })
    expect(doDone.status).toBe(200)
    expect(qtyOf(s.stockId), 'รับของแล้วก็ยังห้ามตัดซ้ำ').toBe(90)
    expect(outMoves(s.tenantId, soNumber), 'ตลอดสายต้องมีรายการตัดออกใบเดียว').toHaveLength(1)
    expect((db.prepare('SELECT delivered_qty FROM sales_order_items WHERE sales_order_id = ?').get(soId) as any).delivered_qty,
      'จำนวนที่ส่งแล้วต้องถูกบันทึก').toBe(10)

    // ── 7. ใบแจ้งหนี้ → ลงบัญชีครั้งเดียว และต้องดุล ────────────────────────────
    const inv = await s.auth(request(app).post('/api/invoices')).send({ salesOrderId: soId })
    expect(inv.status, 'ออกใบแจ้งหนี้').toBe(201)
    const entries = db.prepare('SELECT * FROM journal_entries WHERE tenant_id = ?').all(s.tenantId) as any[]
    // ต้นทุนขายไม่ได้ฝังอยู่ในใบแจ้งหนี้แล้ว — ลงแยกตั้งแต่ตอนตัดสต็อก (SO_COGS) เพื่อไม่ให้
    // สต็อกในงบสูงเกินจริงระหว่างส่งของกับวางบิล นับแยกตามชนิดแทนการนับใบรวม ๆ
    // จะจับ "ลงซ้ำ" ได้จริง ไม่ใช่แค่จับว่าจำนวนเปลี่ยน
    expect(byRefType(entries), 'ต้นทุนขาย 1 ใบ + ใบแจ้งหนี้ 1 ใบ ห้ามมีใบซ้ำ').toEqual({ SO_COGS: 1, INVOICE: 1 })
    expect(entries.every(e => e.total_debit === e.total_credit), 'ทุกใบต้องดุล').toBe(true)
    expect(qtyOf(s.stockId), 'ออกใบแจ้งหนี้ต้องไม่แตะสต็อก').toBe(90)

    // ── 8. รับชำระ → ใบเสร็จ + ปิดยอดค้าง ──────────────────────────────────────
    const rc = await s.auth(request(app).post('/api/receipts')).send({
      invoiceId: inv.body.data.id, amount: inv.body.data.total_amount, paymentMethod: 'CASH',
    })
    expect(rc.status, 'รับชำระ').toBe(201)
    const paid = db.prepare('SELECT status, paid_amount, balance_amount FROM invoices WHERE id = ?').get(inv.body.data.id) as any
    expect(paid.balance_amount, 'จ่ายเต็มแล้วยอดค้างต้องเป็น 0').toBe(0)
    expect((db.prepare('SELECT payment_status FROM sales_orders WHERE id = ?').get(soId) as any).payment_status,
      'สถานะชำระเงินของคำสั่งขายต้องเดินตามใบแจ้งหนี้').toBe('PAID')

    // รับชำระลงอีกใบ (เดบิตเงินสด/เครดิตลูกหนี้) — รวมทั้งสาย 2 ใบ ห้ามมีรายได้ซ้ำ
    const allEntries = db.prepare('SELECT * FROM journal_entries WHERE tenant_id = ?').all(s.tenantId) as any[]
    expect(byRefType(allEntries), 'จบสาย: ต้นทุนขาย 1 + ใบแจ้งหนี้ 1 + รับชำระ 1').toEqual({ SO_COGS: 1, INVOICE: 1, PAYMENT: 1 })
    expect(allEntries.every(e => e.total_debit === e.total_credit), 'ทุกใบต้องดุล').toBe(true)
    const revenue = db.prepare(`
      SELECT SUM(l.credit) - SUM(l.debit) net FROM journal_lines l
      JOIN accounts a ON a.id = l.account_id WHERE l.tenant_id = ? AND a.code = '4101'
    `).get(s.tenantId) as any
    expect(revenue.net, 'รายได้ต้องบันทึกครั้งเดียว = ยอดก่อนภาษี 1,000').toBe(1000)

    // ── 9. เสร็จสิ้น — ห้ามออกใบส่งของใบที่สอง ห้ามแตะสต็อก ────────────────────
    const done = await s.auth(request(app).put(`/api/sales-orders/${soId}/status`)).send({ status: 'COMPLETED' })
    expect(done.status).toBe(200)
    expect(db.prepare('SELECT COUNT(*) c FROM delivery_orders WHERE sales_order_id = ?').get(soId), 'ห้ามออกใบส่งของซ้ำ').toEqual({ c: 1 })
    expect(qtyOf(s.stockId), 'จบสายแล้วของต้องหายไป 10 ชิ้นพอดี').toBe(90)

    // สรุปให้อ่านตอนรันเทสต์
    console.log([
      '  ── สรุปสายขาย ──',
      `  ใบเสนอราคา ${qt.body.data.quotation_number} → ${soNumber} → ${dos[0].do_number} → ${inv.body.data.invoice_number} → ${rc.body.data.receipt.receipt_number}`,
      `  สต็อก 100 → ${qtyOf(s.stockId)} · รายการตัดออก ${outMoves(s.tenantId, soNumber).length} ใบ · สมุดรายวัน ${entries.length} ใบ`,
    ].join('\n'))
  })

  it('ยกเลิกคำสั่งขายที่ยืนยันแล้ว → ของกลับเข้าคลังครบ ไม่คืนซ้ำ', async () => {
    const s = setup()
    const line = { productId: s.stockId, productName: 'สินค้าทดสอบ', quantity: 10, unit: 'pcs', unitPrice: 100 }
    const so = await s.auth(request(app).post('/api/sales-orders')).send({ customerId: s.customerId, items: [line], taxRate: 7 })
    const soId = so.body.data.id

    await s.auth(request(app).put(`/api/sales-orders/${soId}/status`)).send({ status: 'CONFIRMED' })
    expect(qtyOf(s.stockId)).toBe(90)

    await s.auth(request(app).put(`/api/sales-orders/${soId}/status`)).send({ status: 'CANCELLED' })
    expect(qtyOf(s.stockId), 'ยกเลิกแล้วของต้องกลับมาครบ').toBe(100)

    // ยิงซ้ำ — ของต้องไม่งอก
    await s.auth(request(app).put(`/api/sales-orders/${soId}/status`)).send({ status: 'CANCELLED' })
    expect(qtyOf(s.stockId), 'ยกเลิกซ้ำต้องไม่คืนของซ้ำ').toBe(100)
  })
})
