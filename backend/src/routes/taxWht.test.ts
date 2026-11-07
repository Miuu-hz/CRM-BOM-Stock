import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { syncWhtFromSupplierPayments } from './tax.routes'

describe('syncWhtFromSupplierPayments WHT base computation', () => {
  it('computes WHT base from price before VAT (paid 10,700 incl. 7% VAT, 3% -> base 10,000, tax 300)', () => {
    const tenantId = generateId()

    // 1. Seed supplier
    const supplierId = generateId()
    db.prepare(`
      INSERT INTO suppliers (id, tenant_id, code, name, contact_name, email, phone, tax_id)
      VALUES (?, ?, ?, 'บริษัท ทดสอบ จำกัด', 'ผู้ติดต่อ', 'test@example.com', '0812345678', '0105555555555')
    `).run(supplierId, tenantId, 'SUP-' + supplierId.slice(0, 6))

    // 2. Seed purchase order
    const poId = generateId()
    db.prepare(`
      INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, total_amount, order_date)
      VALUES (?, ?, ?, ?, 'RECEIVED', 10700, '2026-11-08')
    `).run(poId, tenantId, 'PO-TEST-' + poId.slice(0, 6), supplierId)

    // 3. Seed purchase invoice with 7% VAT
    const piId = generateId()
    const piNumber = 'PI-TEST-10700'
    db.prepare(`
      INSERT INTO purchase_invoices (
        id, tenant_id, pi_number, purchase_order_id, supplier_id, invoice_date,
        subtotal, tax_rate, tax_amount, total_amount, paid_amount, balance_amount, status
      ) VALUES (?, ?, ?, ?, ?, '2026-11-08', 10000, 7, 700, 10700, 10700, 0, 'ISSUED')
    `).run(piId, tenantId, piNumber, poId, supplierId)

    // 3. Seed supplier payment: paid 10,700, withholding_tax 300
    const paymentId = generateId()
    const paymentNumber = 'SP-TEST-10700'
    db.prepare(`
      INSERT INTO supplier_payments (
        id, tenant_id, payment_number, supplier_id, purchase_invoice_id,
        payment_date, payment_method, amount, withholding_tax, net_amount, status
      ) VALUES (?, ?, ?, ?, ?, '2026-11-08', 'TRANSFER', 10700, 300, 10400, 'ACTIVE')
    `).run(paymentId, tenantId, paymentNumber, supplierId, piId)

    // 4. Sync WHT transactions
    syncWhtFromSupplierPayments(tenantId)

    // 5. Query tax_transactions
    const txn = db.prepare(`
      SELECT * FROM tax_transactions
      WHERE tenant_id = ? AND source_type = 'SUPPLIER_PAYMENT' AND source_id = ?
    `).get(tenantId, paymentId) as any

    expect(txn).toBeTruthy()
    // WHT base must be 10,000 (pre-VAT), NOT 10,700 (VAT-inclusive)
    expect(txn.base_amount).toBe(10000)
    expect(txn.tax_amount).toBe(300)
    // Derived rate must be exactly 3% (300 / 10,000 * 100)
    expect(txn.wht_rate).toBe(3)
    expect(txn.wht_form).toBe('PND53')
  })
})
