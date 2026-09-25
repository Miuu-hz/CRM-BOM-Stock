import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import { createInvoiceFromPosBill, findActiveInvoiceForPosBill, SalesBillingError } from './salesBilling.service'

/**
 * เทสต์ createInvoiceFromPosBill — ออกใบกำกับภาษีจากบิล POS ที่ปิดบิลแล้ว
 * บัญชี/VAT/สต็อก ถูกลงไปแล้วตอนปิดบิล POS (pos-accounting.service.ts recordSale()) —
 * ฟังก์ชันนี้ต้องเป็นเอกสารล้วน ห้ามลงบัญชีซ้ำเด็ดขาด (ดูคอมเมนต์ใน salesBilling.service.ts)
 */

const tenants: string[] = []

function seedPosBill(tenantId: string, opts: { status?: string; withServiceCharge?: boolean } = {}) {
  const customerId = generateId()
  db.prepare(`
    INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, address, city, status)
    VALUES (?, ?, ?, 'ลูกค้าทดสอบ', 'RETAIL', '-', 'x@example.com', '0800000000', '1 ถนนทดสอบ', 'BKK', 'ACTIVE')
  `).run(customerId, tenantId, 'CUS-' + customerId.slice(0, 6))

  const stockId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status, unit_cost, unit_price)
    VALUES (?, ?, ?, 'เมนูทดสอบ', 'FINISHED', 100, 'pcs', 'pcs', 'MAIN', 'ACTIVE', 20, 50)
  `).run(stockId, tenantId, 'SKU-' + stockId.slice(0, 6))

  const menuId = generateId()
  db.prepare(`
    INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price, cost_price)
    VALUES (?, ?, ?, 50, 20)
  `).run(menuId, tenantId, stockId)

  const serviceChargeAmount = opts.withServiceCharge === false ? 0 : 13
  const billId = generateId()
  db.prepare(`
    INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, closed_at,
      subtotal, tax_rate, tax_amount, service_charge_rate, service_charge_amount, discount_amount, total_amount)
    VALUES (?, ?, ?, 'บิล 1', ?, ?, 130, 7, 9.1, 10, ?, 0, ?)
  `).run(billId, tenantId, 'POS-' + billId.slice(0, 6), opts.status || 'PAID', new Date().toISOString(),
    serviceChargeAmount, 130 + 9.1 + serviceChargeAmount)

  db.prepare(`
    INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price)
    VALUES (?, ?, ?, ?, 'เมนูทดสอบ', 2, 50, 100)
  `).run(generateId(), tenantId, billId, menuId)
  db.prepare(`
    INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price)
    VALUES (?, ?, ?, ?, 'เมนูทดสอบ 2', 1, 30, 30)
  `).run(generateId(), tenantId, billId, menuId)

  return { billId, customerId, stockId }
}

function setup(opts?: { status?: string; withServiceCharge?: boolean }) {
  const user = createTestUser({ role: 'ADMIN' })
  tenants.push(user.tenantId)
  db.prepare('INSERT INTO company_settings (tenant_id, name, tax_id, allow_negative_stock) VALUES (?, ?, ?, 0)').run(user.tenantId, 'ร้านทดสอบ', '0105561234567')
  const seeded = seedPosBill(user.tenantId, opts)
  return { ...user, ...seeded }
}

afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const table of ['journal_lines', 'journal_entries', 'invoice_items', 'invoices', 'pos_bill_items',
      'pos_running_bills', 'pos_menu_configs', 'stock_items', 'customers', 'company_settings', 'users']) {
      try { db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(t) } catch { /* ตารางไม่มีคอลัมน์นี้ */ }
    }
  }
})

describe('salesBilling.service — createInvoiceFromPosBill', () => {
  it('บิล PAID + ลูกค้าถูกต้อง → ออกใบกำกับได้', () => {
    const s = setup()
    const result = createInvoiceFromPosBill(s.tenantId, { posBillId: s.billId, customerId: s.customerId }) as any

    expect(result.invoice.invoice_number).toMatch(/^INV/)
    expect(result.invoice.status).toBe('PAID')
    expect(result.invoice.payment_status).toBe('PAID')
    expect(result.invoice.balance_amount).toBe(0)
    expect(result.invoice.pos_bill_id).toBe(s.billId)
    expect(result.invoice.sales_order_id).toBeNull()
    // 2 รายการจากบิล + 1 รายการค่าบริการ
    expect(result.items).toHaveLength(3)
  })

  it('ออกซ้ำบิลเดิม → throw DUPLICATE_INVOICE', () => {
    const s = setup()
    createInvoiceFromPosBill(s.tenantId, { posBillId: s.billId, customerId: s.customerId })

    expect(() => createInvoiceFromPosBill(s.tenantId, { posBillId: s.billId, customerId: s.customerId }))
      .toThrow(SalesBillingError)
    try {
      createInvoiceFromPosBill(s.tenantId, { posBillId: s.billId, customerId: s.customerId })
    } catch (e: any) {
      expect(e.code).toBe('DUPLICATE_INVOICE')
    }

    const count = (db.prepare('SELECT COUNT(*) c FROM invoices WHERE pos_bill_id = ?').get(s.billId) as any).c
    expect(count, 'ต้องมีใบกำกับแค่ใบเดียว').toBe(1)
    expect(findActiveInvoiceForPosBill(s.tenantId, s.billId)).toBeTruthy()
  })

  it('บิลที่ยัง OPEN (ยังไม่คิดเงิน) → throw POS_BILL_NOT_PAID', () => {
    const s = setup({ status: 'OPEN' })
    try {
      createInvoiceFromPosBill(s.tenantId, { posBillId: s.billId, customerId: s.customerId })
      throw new Error('should have thrown')
    } catch (e: any) {
      expect(e.code).toBe('POS_BILL_NOT_PAID')
    }
  })

  it('ออกใบกำกับแล้ว จำนวนแถวใน journal_entries ต้องไม่เพิ่มขึ้นเลย (เอกสารล้วน ห้ามลงบัญชีซ้ำ)', () => {
    const s = setup()
    const before = (db.prepare('SELECT COUNT(*) c FROM journal_entries WHERE tenant_id = ?').get(s.tenantId) as any).c

    createInvoiceFromPosBill(s.tenantId, { posBillId: s.billId, customerId: s.customerId })

    const after = (db.prepare('SELECT COUNT(*) c FROM journal_entries WHERE tenant_id = ?').get(s.tenantId) as any).c
    expect(after).toBe(before)
  })

  it('subtotal + tax_amount - discount_amount ต้องเท่ากับ total_amount', () => {
    const s = setup()
    const result = createInvoiceFromPosBill(s.tenantId, { posBillId: s.billId, customerId: s.customerId }) as any
    const inv = result.invoice
    expect(inv.subtotal + inv.tax_amount - inv.discount_amount).toBeCloseTo(inv.total_amount, 6)
  })

  it('กิจการยังไม่ได้กรอกเลขผู้เสียภาษี → ออกใบกำกับไม่ได้ (ม.86/4)', () => {
    const s = setup()
    db.prepare('UPDATE company_settings SET tax_id = NULL WHERE tenant_id = ?').run(s.tenantId)
    try {
      createInvoiceFromPosBill(s.tenantId, { posBillId: s.billId, customerId: s.customerId })
      throw new Error('should have thrown')
    } catch (e: any) {
      expect(e.code).toBe('SELLER_TAX_ID_REQUIRED')
    }
    expect((db.prepare('SELECT COUNT(*) c FROM invoices WHERE pos_bill_id = ?').get(s.billId) as any).c).toBe(0)
  })

  it('ใบกำกับเต็มรูปต้องอ้างเลขใบกำกับอย่างย่อ (สลิป) ที่ออกแทน', () => {
    const s = setup()
    const bill = db.prepare('SELECT bill_number FROM pos_running_bills WHERE id = ?').get(s.billId) as any
    const { invoice } = createInvoiceFromPosBill(s.tenantId, { posBillId: s.billId, customerId: s.customerId }) as any
    expect(invoice.notes).toContain(bill.bill_number)
    expect(invoice.notes).toContain('ออกแทนใบกำกับภาษีอย่างย่อ')
  })

  it('รายงานภาษีขายต้องอ้างเลขใบกำกับ ไม่ใช่เลขบิลหน้าร้าน', () => {
    const s = setup()
    db.prepare(`
      INSERT INTO vat_entries (id, tenant_id, document_type, document_id, document_number, document_date,
        party_name, base_amount, vat_rate, vat_amount, total_amount, is_output_vat, created_at)
      VALUES (?, ?, 'SALES', ?, 'POS-เดิม', date('now'), 'ลูกค้า', 130, 7, 9.1, 152.1, 1, datetime('now'))
    `).run(generateId(), s.tenantId, s.billId)

    const { invoice } = createInvoiceFromPosBill(s.tenantId, { posBillId: s.billId, customerId: s.customerId }) as any

    const vat = db.prepare('SELECT document_number FROM vat_entries WHERE document_id = ?').get(s.billId) as any
    expect(vat.document_number).toBe(invoice.invoice_number)
  })

  it('ร้านตั้งราคารวม VAT → รายการในใบกำกับเป็นยอดก่อนภาษี และรวมได้เท่าหัวใบเป๊ะ', () => {
    const s = setup()
    // บิลแบบถอดภาษีแล้ว: ลูกค้าจ่าย 130 ในนั้นเป็นภาษี 8.5 ฐาน 121.5 (ไม่มีค่าบริการ)
    db.prepare(`UPDATE pos_running_bills SET subtotal = 121.5, tax_amount = 8.5,
      service_charge_amount = 0, total_amount = 130 WHERE id = ?`).run(s.billId)

    const { invoice, items } = createInvoiceFromPosBill(s.tenantId, { posBillId: s.billId, customerId: s.customerId }) as any

    const lines = (items as any[]).reduce((n, i) => n + i.total_price, 0)
    expect(lines, 'ผลรวมรายการต้องเท่ากับ subtotal ของหัวใบ').toBeCloseTo(invoice.subtotal, 2)
    expect(invoice.subtotal, 'ต้องเป็นยอดก่อนภาษี ไม่ใช่ราคาป้าย 130').toBeCloseTo(121.5, 2)
    expect(invoice.subtotal + invoice.tax_amount).toBeCloseTo(invoice.total_amount, 2)
  })
})
