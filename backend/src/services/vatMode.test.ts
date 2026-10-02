import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import { vatModeOf, vatModeToFields, normalizeVatFields, VAT_RATE } from '../utils/vat'
import { runMigrations } from '../db/migrations'
import purchaseOrderRouter from '../routes/purchaseOrder.routes'
import salesRouter from '../routes/sales/index'
import { createGoodsReceipt, confirmGoodsReceipt } from './goodsReceipt.service'
import '../routes/currency.routes' // side effect only: creates the `currencies` table

// ระบบโหมด VAT ระดับเอกสาร (2026-09-29) — ดู memory project_erp_vat_mode
// ครอบคลุม: helper บริสุทธิ์, การ "จำ" โหมดของคู่ค้าตอนบันทึกเอกสาร, การ์กขายที่ยังไม่จด VAT,
// (ฝั่งซื้อไม่บล็อก — แก้ไข spec 2026-09-29: ไม่บังคับ NONE อีกต่อไป), ทุนที่ GR คำนวณ, backfill migration

function buildApp(router: express.Router, base: string) {
  const app = express()
  app.use(express.json())
  app.use(base, router)
  return app
}
const poApp = buildApp(purchaseOrderRouter, '/api/purchase-orders')
const salesApp = buildApp(salesRouter, '/api/sales')

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of [
      'journal_lines', 'journal_entries', 'goods_receipt_items', 'goods_receipts',
      'purchase_order_items', 'purchase_orders', 'stock_movements', 'stock_items',
      'suppliers', 'quotation_items', 'quotations', 'customers', 'accounts', 'users',
      'document_sequences', 'vat_entries', 'company_settings',
    ]) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* ข้ามตารางที่ไม่มี tenant_id */ }
    }
  }
})

function seedSupplier(tenantId: string, vatMode: string | null = null) {
  const id = generateId()
  db.prepare(`
    INSERT INTO suppliers (id, tenant_id, code, name, contact_name, status, vat_mode)
    VALUES (?, ?, ?, 'ผู้ขายทดสอบ', 'x', 'ACTIVE', ?)
  `).run(id, tenantId, 'S-' + id.slice(0, 6), vatMode)
  return id
}

function seedCustomer(tenantId: string) {
  const id = generateId()
  db.prepare(`
    INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city)
    VALUES (?, ?, ?, 'ลูกค้าทดสอบ', 'RETAIL', 'x', 'x@example.com', '0800000000', 'BKK')
  `).run(id, tenantId, 'C-' + id.slice(0, 6))
  return id
}

function setCompanyVatRegistered(tenantId: string, registered: number) {
  db.prepare(`INSERT INTO company_settings (tenant_id, name) VALUES (?, 'ทดสอบ')`).run(tenantId)
  db.prepare('UPDATE company_settings SET vat_registered = ? WHERE tenant_id = ?').run(registered, tenantId)
}

describe('vat.ts: VatMode helpers (pure)', () => {
  it('vatModeOf: rate 0 หรือไม่มีค่า → NONE เสมอ (ไม่สน inclusive)', () => {
    expect(vatModeOf(0, true)).toBe('NONE')
    expect(vatModeOf(0, false)).toBe('NONE')
    expect(vatModeOf(null, true)).toBe('NONE')
    expect(vatModeOf(undefined, undefined)).toBe('NONE')
  })

  it('vatModeOf: rate > 0 → INCLUSIVE/EXCLUSIVE ตาม inclusive', () => {
    expect(vatModeOf(7, true)).toBe('INCLUSIVE')
    expect(vatModeOf(7, false)).toBe('EXCLUSIVE')
  })

  it('vatModeToFields: กลับเป็น rate/inclusive ที่ถูกต้อง', () => {
    expect(vatModeToFields('NONE')).toEqual({ rate: 0, inclusive: false })
    expect(vatModeToFields('INCLUSIVE')).toEqual({ rate: VAT_RATE, inclusive: true })
    expect(vatModeToFields('EXCLUSIVE')).toEqual({ rate: VAT_RATE, inclusive: false })
  })

  it('normalizeVatFields: ปัด rate แปลก ๆ (เช่น 15) ให้เป็น VAT_RATE คงที่', () => {
    expect(normalizeVatFields(15, true)).toEqual({ rate: VAT_RATE, inclusive: true })
    expect(normalizeVatFields(0, true)).toEqual({ rate: 0, inclusive: false })
    expect(normalizeVatFields(null, null)).toEqual({ rate: 0, inclusive: false })
  })
})

describe('บันทึกเอกสาร → จำโหมด VAT ของคู่ค้า', () => {
  it('บันทึก PO แล้วจำ vat_mode ของผู้ขาย', async () => {
    const { tenantId, token } = createTestUser({ role: 'ADMIN' })
    tenants.push(tenantId)
    const supplierId = seedSupplier(tenantId)

    const res = await request(poApp).post('/api/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ supplierId, taxRate: 7, vatInclusive: true, items: [{ quantity: 1, unitPrice: 107 }] })
    expect(res.status).toBe(201)

    const supplier = db.prepare('SELECT vat_mode FROM suppliers WHERE id = ?').get(supplierId) as any
    expect(supplier.vat_mode).toBe('INCLUSIVE')
  })

  it('บันทึกใบเสนอราคาแล้วจำ vat_mode ของลูกค้า', async () => {
    const { tenantId, token } = createTestUser({ role: 'ADMIN' })
    tenants.push(tenantId)
    setCompanyVatRegistered(tenantId, 1)
    const customerId = seedCustomer(tenantId)

    const res = await request(salesApp).post('/api/sales/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, taxRate: 7, items: [{ quantity: 1, unitPrice: 100, productName: 'ของ' }] })
    expect(res.status).toBeLessThan(300)

    const customer = db.prepare('SELECT vat_mode FROM customers WHERE id = ?').get(customerId) as any
    expect(customer.vat_mode).toBe('EXCLUSIVE')
  })
})

describe('กิจการยังไม่จดทะเบียน VAT', () => {
  it('ฝั่งขาย: ใบเสนอราคามี VAT ถูกปฏิเสธ 400 ก่อนออกเลขเอกสาร', async () => {
    const { tenantId, token } = createTestUser({ role: 'ADMIN' })
    tenants.push(tenantId)
    setCompanyVatRegistered(tenantId, 0)
    const customerId = seedCustomer(tenantId)
    const before = (db.prepare(
      "SELECT COALESCE(MAX(last_number), 0) n FROM document_sequences WHERE tenant_id = ? AND doc_type = 'QUOTATION'"
    ).get(tenantId) as any).n

    const res = await request(salesApp).post('/api/sales/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, taxRate: 7, items: [{ quantity: 1, unitPrice: 100, productName: 'ของ' }] })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VAT_NOT_REGISTERED')
    const after = (db.prepare(
      "SELECT COALESCE(MAX(last_number), 0) n FROM document_sequences WHERE tenant_id = ? AND doc_type = 'QUOTATION'"
    ).get(tenantId) as any).n
    expect(after).toBe(before)
  })

  it('ฝั่งซื้อ: PO มี VAT บันทึกตามโหมดที่เลือกจริง ไม่ถูกบังคับเป็น NONE (แก้ spec 2026-09-29)', async () => {
    const { tenantId, token } = createTestUser({ role: 'ADMIN' })
    tenants.push(tenantId)
    setCompanyVatRegistered(tenantId, 0)
    const supplierId = seedSupplier(tenantId)

    const res = await request(poApp).post('/api/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ supplierId, taxRate: 7, vatInclusive: false, items: [{ quantity: 1, unitPrice: 100 }] })

    expect(res.status).toBe(201)
    expect(res.body.data.tax_rate).toBe(7)
    expect(res.body.data.vat_inclusive).toBe(0)
    const supplier = db.prepare('SELECT vat_mode FROM suppliers WHERE id = ?').get(supplierId) as any
    expect(supplier.vat_mode).toBe('EXCLUSIVE')
  })
})

describe('GR confirm: ทุนที่บันทึกใน stock_items ปรับตาม VAT', () => {
  function buyOneUnit(opts: { vatRegistered: number; taxRate: number; vatInclusive: number; unitPrice: number }) {
    const user = createTestUser({ role: 'ADMIN' })
    const t = user.tenantId
    tenants.push(t)
    setCompanyVatRegistered(t, opts.vatRegistered)
    const supplierId = seedSupplier(t)
    const stockId = generateId()
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
                VALUES (?, ?, ?, 'ของ', 'RAW', 0, 'kg', 'kg', 0, 'MAIN', 'ACTIVE')`).run(stockId, t, 'K-' + stockId.slice(0, 6))
    const poId = generateId()
    db.prepare(`INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, order_date, subtotal, tax_rate, tax_amount, total_amount, vat_inclusive, status)
                VALUES (?, ?, ?, ?, date('now'), ?, ?, 0, ?, ?, 'APPROVED')`)
      .run(poId, t, 'PO-T-' + poId.slice(0, 5), supplierId, opts.unitPrice, opts.taxRate, opts.unitPrice, opts.vatInclusive)
    const poItemId = generateId()
    db.prepare(`INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, received_qty, unit, unit_price, total_price)
                VALUES (?, ?, ?, ?, 'ของ', 1, 0, 'kg', ?, ?)`).run(poItemId, t, poId, stockId, opts.unitPrice, opts.unitPrice)

    const gr = createGoodsReceipt(t, user.email, {
      purchaseOrderId: poId,
      items: [{ poItemId, materialId: stockId, orderedQty: 1, receivedQty: 1, acceptedQty: 1 }],
    }) as any
    confirmGoodsReceipt(t, user.userId, gr.id)

    return (db.prepare('SELECT unit_cost FROM stock_items WHERE id = ?').get(stockId) as any).unit_cost
  }

  it('จด VAT แล้ว + PO ราคารวม VAT 107 → unit_cost ถอด VAT เหลือ 100', () => {
    const unitCost = buyOneUnit({ vatRegistered: 1, taxRate: 7, vatInclusive: 1, unitPrice: 107 })
    expect(unitCost).toBe(100)
  })

  it('ยังไม่จด VAT + PO ราคาไม่รวม VAT 100 → unit_cost บวก VAT เป็น 107 (VAT ขอคืนไม่ได้ กลายเป็นต้นทุน)', () => {
    const unitCost = buyOneUnit({ vatRegistered: 0, taxRate: 7, vatInclusive: 0, unitPrice: 100 })
    expect(unitCost).toBe(107)
  })
})

describe('migration backfill: customers/suppliers.vat_mode', () => {
  it('เลือกโหมดจากเอกสารล่าสุด (ไม่ใช่ใบเก่าที่ยังไม่ยกเลิก)', () => {
    const { tenantId } = createTestUser({ role: 'ADMIN' })
    tenants.push(tenantId)
    const customerId = seedCustomer(tenantId)
    // ยืนยันว่ายังเป็น NULL ก่อน backfill
    expect((db.prepare('SELECT vat_mode FROM customers WHERE id = ?').get(customerId) as any).vat_mode).toBeNull()

    const older = generateId()
    db.prepare(`INSERT INTO quotations (id, tenant_id, quotation_number, customer_id, tax_rate, vat_inclusive, status, created_at)
                VALUES (?, ?, ?, ?, 0, 0, 'DRAFT', '2026-01-01T00:00:00.000Z')`).run(older, tenantId, 'QT-OLD-' + older.slice(0, 5), customerId)
    const newer = generateId()
    db.prepare(`INSERT INTO quotations (id, tenant_id, quotation_number, customer_id, tax_rate, vat_inclusive, status, created_at)
                VALUES (?, ?, ?, ?, 7, 1, 'DRAFT', '2026-06-01T00:00:00.000Z')`).run(newer, tenantId, 'QT-NEW-' + newer.slice(0, 5), customerId)

    runMigrations(db)

    const customer = db.prepare('SELECT vat_mode FROM customers WHERE id = ?').get(customerId) as any
    expect(customer.vat_mode).toBe('INCLUSIVE')
  }, 60000) // runMigrations() สแกนทั้งฐาน — ช้าเมื่อ test.db สะสมข้อมูลจากไฟล์เทสต์อื่นมาก่อน

  it('ไม่แตะแถวที่มี vat_mode อยู่แล้ว', () => {
    const { tenantId } = createTestUser({ role: 'ADMIN' })
    tenants.push(tenantId)
    const supplierId = seedSupplier(tenantId, 'NONE')
    const poId = generateId()
    db.prepare(`INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, order_date, tax_rate, vat_inclusive, status, created_at)
                VALUES (?, ?, ?, ?, date('now'), 7, 1, 'APPROVED', '2026-06-01T00:00:00.000Z')`)
      .run(poId, tenantId, 'PO-BF-' + poId.slice(0, 5), supplierId)

    runMigrations(db)

    expect((db.prepare('SELECT vat_mode FROM suppliers WHERE id = ?').get(supplierId) as any).vat_mode).toBe('NONE')
  }, 60000)
})
