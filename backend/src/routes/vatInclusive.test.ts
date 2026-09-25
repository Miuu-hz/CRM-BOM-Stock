import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import quotationRouter from './sales/quotations'
import salesOrderRouter from './sales/salesOrders'
import { createTestUser } from '../test/testAuth'
import { authenticate } from '../middleware/auth.middleware'
import { createInvoiceFromSO } from '../services/salesBilling.service'
import { recalculateBillTotals } from './pos-bill.routes'

/**
 * โหมด "ราคาที่กรอกรวม VAT แล้ว" — ตั้งค่าตั้งต้นที่กิจการ แล้ว override ได้รายเอกสาร
 * และต้องสืบทอดตามสาย QT → SO → INV ไม่ใช่กลับไปอ่านค่าตั้งต้นใหม่ทุกใบ
 */
const app = express()
app.use(express.json())
app.use('/api/quotations', authenticate, quotationRouter)
app.use('/api/sales-orders', authenticate, salesOrderRouter)

function setup(vatInclusive: 0 | 1) {
  const u = createTestUser({ role: 'ADMIN' })
  db.prepare('INSERT INTO company_settings (tenant_id, name, tax_id, vat_inclusive) VALUES (?, ?, ?, ?)')
    .run(u.tenantId, 'ร้านทดสอบ', '0105561234567', vatInclusive)
  const customerId = generateId()
  db.prepare(`INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, address, city, status)
    VALUES (?, ?, ?, 'ลูกค้าทดสอบ', 'RETAIL', '-', 'c@example.com', '0800000000', '1 ถนน', 'BKK', 'ACTIVE')`)
    .run(customerId, u.tenantId, 'CUS-' + customerId.slice(0, 6))
  return { ...u, customerId }
}

const line = { description: 'ของทดสอบ', quantity: 1, unitPrice: 107, unit: 'ชิ้น' }

describe('โหมดราคารวม VAT', () => {
  it('กิจการเปิดโหมดรวม VAT → ใบเสนอราคาถอดภาษีออกจากราคาที่กรอก', async () => {
    const s = setup(1)
    const res = await request(app).post('/api/quotations')
      .set('Authorization', `Bearer ${s.token}`)
      .send({ customerId: s.customerId, taxRate: 7, items: [line] })

    expect(res.status).toBe(201)
    const qt = db.prepare('SELECT * FROM quotations WHERE id = ?').get(res.body.data.id) as any
    expect(qt.vat_inclusive).toBe(1)
    expect(qt.total_amount, 'ลูกค้าจ่ายเท่าราคาที่กรอก').toBeCloseTo(107, 2)
    expect(qt.tax_amount, '107 × 7/107').toBeCloseTo(7, 2)
    expect(qt.subtotal).toBeCloseTo(100, 2)
  })

  it('กิจการปิดโหมด → บวกภาษีเพิ่มเหมือนเดิม', async () => {
    const s = setup(0)
    const res = await request(app).post('/api/quotations')
      .set('Authorization', `Bearer ${s.token}`)
      .send({ customerId: s.customerId, taxRate: 7, items: [{ ...line, unitPrice: 100 }] })

    const qt = db.prepare('SELECT * FROM quotations WHERE id = ?').get(res.body.data.id) as any
    expect(qt.vat_inclusive).toBe(0)
    expect(qt.tax_amount).toBe(7)
    expect(qt.total_amount).toBe(107)
  })

  it('เอกสารเลือกเองได้ ชนะค่าตั้งต้นกิจการ', async () => {
    const s = setup(0)
    const res = await request(app).post('/api/quotations')
      .set('Authorization', `Bearer ${s.token}`)
      .send({ customerId: s.customerId, taxRate: 7, vatInclusive: true, items: [line] })

    const qt = db.prepare('SELECT * FROM quotations WHERE id = ?').get(res.body.data.id) as any
    expect(qt.vat_inclusive).toBe(1)
    expect(qt.total_amount).toBeCloseTo(107, 2)
  })

  it('สืบทอดตลอดสาย QT → SO → INV', async () => {
    const s = setup(1)
    const qtRes = await request(app).post('/api/quotations')
      .set('Authorization', `Bearer ${s.token}`)
      .send({ customerId: s.customerId, taxRate: 7, items: [line] })
    const quotationId = qtRes.body.data.id

    // กิจการเปลี่ยนใจปิดโหมดหลังออกใบเสนอราคาไปแล้ว — ใบที่ต่อมาต้องยังตามใบต้นทาง
    db.prepare('UPDATE company_settings SET vat_inclusive = 0 WHERE tenant_id = ?').run(s.tenantId)

    const soRes = await request(app).post('/api/sales-orders')
      .set('Authorization', `Bearer ${s.token}`)
      .send({ customerId: s.customerId, quotationId, taxRate: 7, items: [line] })
    const so = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(soRes.body.data.id) as any
    expect(so.vat_inclusive, 'ใบสั่งขายต้องตามใบเสนอราคา ไม่ใช่ค่าตั้งต้นใหม่').toBe(1)

    const { invoice } = createInvoiceFromSO(s.tenantId, { salesOrderId: so.id }) as any
    expect(invoice.vat_inclusive, 'ใบแจ้งหนี้ต้องตามใบสั่งขาย').toBe(1)
    expect(invoice.total_amount).toBeCloseTo(so.total_amount, 2)
  })

  it('ค่าขนส่งฝั่งขายเข้าฐาน VAT และสืบทอด QT → SO → INV', async () => {
    const s = setup(0)
    const qtRes = await request(app).post('/api/quotations')
      .set('Authorization', `Bearer ${s.token}`)
      .send({ customerId: s.customerId, taxRate: 7, extraChargeAmount: 50, extraChargeLabel: 'ค่าส่งด่วน',
              items: [{ ...line, unitPrice: 100 }] })

    const qt = db.prepare('SELECT * FROM quotations WHERE id = ?').get(qtRes.body.data.id) as any
    expect(qt.extra_charge_amount).toBe(50)
    expect(qt.extra_charge_label).toBe('ค่าส่งด่วน')
    expect(qt.tax_amount, '(100 + 50) × 7% = 10.5 ไม่ใช่ 7').toBeCloseTo(10.5, 2)
    expect(qt.total_amount).toBeCloseTo(160.5, 2)

    const soRes = await request(app).post('/api/sales-orders')
      .set('Authorization', `Bearer ${s.token}`)
      .send({ customerId: s.customerId, quotationId: qt.id, taxRate: 7, extraChargeAmount: 50,
              extraChargeLabel: 'ค่าส่งด่วน', items: [{ ...line, unitPrice: 100 }] })
    const so = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(soRes.body.data.id) as any
    expect(so.extra_charge_amount).toBe(50)

    const { invoice, items } = createInvoiceFromSO(s.tenantId, { salesOrderId: so.id }) as any
    expect(invoice.extra_charge_amount).toBe(50)
    const lineNames = (items as any[]).map(i => i.product_name)
    expect(lineNames, 'ใบกำกับต้องมีบรรทัดค่าขนส่งให้ลูกค้าเห็น (ม.79)').toContain('ค่าส่งด่วน')
    const lineSum = (items as any[]).reduce((n, i) => n + i.total_price, 0)
    expect(lineSum, 'ผลรวมรายการต้องเท่ากับ subtotal + ค่าขนส่ง').toBeCloseTo(invoice.subtotal + invoice.extra_charge_amount, 2)
  })

  it('กิจการยังไม่มีเลขผู้เสียภาษี → POS ไม่คิด VAT แม้สวิตช์เปิดค้างไว้', async () => {
    const s = setup(0)
    db.prepare('UPDATE company_settings SET tax_id = NULL, pos_vat_enabled = 1, pos_vat_rate = 7 WHERE tenant_id = ?').run(s.tenantId)

    const billId = generateId()
    db.prepare(`INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, subtotal, total_amount, opened_at, created_by)
      VALUES (?, ?, ?, 'บิล', 'OPEN', 0, 0, datetime('now'), 'tester')`).run(billId, s.tenantId, 'POS-' + billId.slice(0, 6))
    const stockId = generateId()
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status, unit_cost, unit_price)
      VALUES (?, ?, ?, 'ของทดสอบ', 'FINISHED', 100, 'pcs', 'pcs', 'MAIN', 'ACTIVE', 20, 100)`)
      .run(stockId, s.tenantId, 'SKU-' + stockId.slice(0, 6))
    const menuId = generateId()
    db.prepare('INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price, cost_price) VALUES (?, ?, ?, 100, 20)')
      .run(menuId, s.tenantId, stockId)
    db.prepare(`INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price)
      VALUES (?, ?, ?, ?, 'ของทดสอบ', 1, 100, 100)`).run(generateId(), s.tenantId, billId, menuId)

    recalculateBillTotals(billId)
    const bill = db.prepare('SELECT * FROM pos_running_bills WHERE id = ?').get(billId) as any
    expect(bill.tax_amount, 'ยังไม่จด VAT เก็บภาษีจากลูกค้าไม่ได้').toBe(0)
    expect(bill.total_amount).toBe(100)
  })
})
