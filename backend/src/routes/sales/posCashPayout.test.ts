import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import posRouter from './pos.routes'
import { createTestUser } from '../../test/testAuth'
import { ACC } from '../../config/accountCodes'
import { paySupplier, listPosCashUnmatched, PurchaseBillingError, createPurchaseInvoice, updatePurchaseInvoice } from '../../services/purchaseBilling.service'
import { createGoodsReceipt, confirmGoodsReceipt, getPendingPoItems } from '../../services/goodsReceipt.service'
import purchaseRouter, { reverseSupplierPayment } from '../purchase.routes'

/**
 * เงินจาก POS: เงินออกจากลิ้นชักก่อนมีบิล (เปิดกะด้วยเงินขาด / เงินออกระหว่างกะ) ลงพักไว้ที่ 1182
 * แล้วใบจ่ายเงินผู้ขายวิธี POS_CASH จับคู่ปิดยอดนั้น — เงินสดต้องถูกตัดครั้งเดียว
 */
const app = express()
app.use(express.json())
app.use('/api/sales', authenticate, posRouter)
app.use('/api/purchase', authenticate, purchaseRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_lines', 'journal_entries', 'supplier_payments', 'purchase_invoice_items', 'purchase_invoices',
                       'goods_receipt_items', 'goods_receipts', 'purchase_order_items', 'purchase_orders', 'stock_movements', 'stock_items',
                       'suppliers', 'pos_shift_cash_movements', 'pos_shifts',
                       'company_settings', 'accounts', 'users', 'document_sequences']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* no tenant_id column */ }
    }
  }
})

function newTenant() {
  const u = createTestUser()
  tenants.push(u.tenantId)
  db.prepare('INSERT INTO company_settings (tenant_id, pos_bom_deduct) VALUES (?, 0)').run(u.tenantId)
  const supplierId = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'ร้านน้ำแข็ง', 'C')").run(supplierId, u.tenantId, supplierId)
  return { ...u, supplierId }
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

function balance(tenantId: string, code: string): number {
  const r = db.prepare(`
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS b FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id WHERE jl.tenant_id = ? AND a.code = ?
  `).get(tenantId, code) as { b: number }
  return Math.round(r.b * 100) / 100
}

async function openShortShift(u: ReturnType<typeof newTenant>) {
  const s1 = await request(app).post('/api/sales/pos-shifts/open').set(auth(u.token)).send({ opening_cash: 1495 })
  await request(app).post(`/api/sales/pos-shifts/${s1.body.data.id}/close`).set(auth(u.token)).send({ closing_cash_counted: 1495 })
  return request(app).post('/api/sales/pos-shifts/open').set(auth(u.token))
    .send({ opening_cash: 1162, opening_gap_reason: 'พนักงานเอาไปซื้อของ' })
}

describe('เงินจาก POS (1182)', () => {
  it('เปิดกะด้วยเงินขาด + หมายเหตุ → ลงพัก 1182 และไม่นับเป็นเงินออกของกะ', async () => {
    const u = newTenant()
    const res = await openShortShift(u)
    expect(res.status).toBe(200)
    expect(res.body.data.opening_gap).toBe(333)

    expect(balance(u.tenantId, ACC.POS_PAYOUT_PENDING)).toBe(333)
    expect(balance(u.tenantId, ACC.CASH)).toBe(-333)

    const cur = await request(app).get('/api/sales/pos-shifts/current').set(auth(u.token))
    expect(cur.body.data.live.paid_out).toBe(0) // เงินออกไปก่อนนับยอดเปิดกะ — ไม่กระทบยอดที่ควรมีตอนปิด

    const items = listPosCashUnmatched(u.tenantId)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: 'OPENING_GAP', remaining: 333, reason: 'พนักงานเอาไปซื้อของ' })
  })

  it('ไม่ใส่หมายเหตุ → ไม่ลงบัญชีอะไร (เหมือนเดิม)', async () => {
    const u = newTenant()
    const s1 = await request(app).post('/api/sales/pos-shifts/open').set(auth(u.token)).send({ opening_cash: 1495 })
    await request(app).post(`/api/sales/pos-shifts/${s1.body.data.id}/close`).set(auth(u.token)).send({ closing_cash_counted: 1495 })
    await request(app).post('/api/sales/pos-shifts/open').set(auth(u.token)).send({ opening_cash: 1162 })
    expect(listPosCashUnmatched(u.tenantId)).toHaveLength(0)
    expect(balance(u.tenantId, ACC.POS_PAYOUT_PENDING)).toBe(0)
  })

  it('จ่ายผู้ขายด้วยเงินจาก POS → ปิด 1182 ไม่หักเงินสดซ้ำ, ยกเลิกแล้วกลับมารอจับคู่', async () => {
    const u = newTenant()
    await openShortShift(u)
    const mv = listPosCashUnmatched(u.tenantId)[0]

    let caught: any
    try { paySupplier(u.tenantId, u.email, { supplierId: u.supplierId, amount: 400, paymentMethod: 'POS_CASH', posCashMovementId: mv.id }) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(PurchaseBillingError)
    expect(caught.code).toBe('POS_CASH_OVER')

    try { paySupplier(u.tenantId, u.email, { supplierId: u.supplierId, amount: 333, paymentMethod: 'POS_CASH' }) } catch (e) { caught = e }
    expect(caught.code).toBe('POS_CASH_REQUIRED')

    const pay = paySupplier(u.tenantId, u.email, { supplierId: u.supplierId, amount: 333, paymentMethod: 'POS_CASH', posCashMovementId: mv.id, bankAccountId: 'ignored' }) as any
    expect(pay.pos_cash_movement_id).toBe(mv.id)
    expect(pay.bank_account_id).toBeNull()
    expect(balance(u.tenantId, ACC.POS_PAYOUT_PENDING)).toBe(0)
    expect(balance(u.tenantId, ACC.CASH)).toBe(-333) // ตัดครั้งเดียวตอนเงินออกจากลิ้นชัก
    expect(listPosCashUnmatched(u.tenantId)).toHaveLength(0)

    reverseSupplierPayment(u.tenantId, pay, u.email, '2026-10-19')
    expect(balance(u.tenantId, ACC.POS_PAYOUT_PENDING)).toBe(333)
    expect(listPosCashUnmatched(u.tenantId)[0].remaining).toBe(333)
  })

  it('จ่ายบางส่วนได้ ยอดที่เหลือยังรอจับคู่', async () => {
    const u = newTenant()
    await openShortShift(u)
    const mv = listPosCashUnmatched(u.tenantId)[0]
    paySupplier(u.tenantId, u.email, { supplierId: u.supplierId, amount: 200, paymentMethod: 'POS_CASH', posCashMovementId: mv.id })
    expect(listPosCashUnmatched(u.tenantId)[0].remaining).toBe(133)
    expect(balance(u.tenantId, ACC.POS_PAYOUT_PENDING)).toBe(133)
  })
})

/** PO ไม่มี VAT 1 บรรทัด + GR ยืนยันแล้ว (Dr 1107 / Cr 2109) — แบบบิลร้านค้าเงินสดที่ลงย้อนหลัง */
function seedReceivedPo(u: ReturnType<typeof newTenant>, price: number) {
  const poId = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_rate, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'APPROVED', ?, 0, 0, ?, ?, ?)
  `).run(poId, u.tenantId, 'PO-' + poId.slice(0, 6), u.supplierId, price, price, now, now)
  const materialId = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, 'น้ำแข็ง', 'raw', 0, 'pcs', 'pcs', ?, 'STOCK', 'ACTIVE')
  `).run(materialId, u.tenantId, 'SKU-' + materialId.slice(0, 8), price)
  db.prepare(`
    INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty)
    VALUES (?, ?, ?, ?, 'น้ำแข็ง', 1, 'pcs', ?, ?, 0)
  `).run(generateId(), u.tenantId, poId, materialId, price, price)
  const pending = getPendingPoItems(u.tenantId, poId)
  const created = createGoodsReceipt(u.tenantId, u.email, {
    purchaseOrderId: poId,
    items: pending.map(p => ({ poItemId: p.id, materialId: p.material_id, orderedQty: p.quantity, receivedQty: p.pending_qty, acceptedQty: p.pending_qty })),
  }) as any
  const gr = confirmGoodsReceipt(u.tenantId, 'u1', created.id) as any
  return { poId, grId: gr.id as string }
}

describe('ใบแจ้งหนี้ฝั่ง Cr = เงินจาก POS (จับคู่ Dr ของ กับ Cr เงินที่ออกไปแล้ว)', () => {
  it('ลงบิลย้อนหลัง → Dr 2109 / Cr 1182, ใบจ่ายแล้วทันที, ไม่มีเจ้าหนี้, 1182 กลับเป็นศูนย์', async () => {
    const u = newTenant()
    await openShortShift(u)
    const mv = listPosCashUnmatched(u.tenantId)[0]
    const g = seedReceivedPo(u, 333)

    const inv = createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [g.grId], posCashMovementId: mv.id, autoPay: true }) as any
    expect(inv).toMatchObject({ total_amount: 333, paid_amount: 333, balance_amount: 0, payment_status: 'PAID', pos_cash_movement_id: mv.id })

    const lines = db.prepare(`
      SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id JOIN accounts a ON a.id = jl.account_id
      WHERE je.reference_type = 'PURCHASE_INVOICE' AND je.reference_id = ? ORDER BY jl.line_number
    `).all(inv.id)
    expect(lines).toEqual([{ code: ACC.GRNI, debit: 333, credit: 0 }, { code: ACC.POS_PAYOUT_PENDING, debit: 0, credit: 333 }])

    expect(balance(u.tenantId, ACC.POS_PAYOUT_PENDING)).toBe(0)
    expect(balance(u.tenantId, ACC.GRNI)).toBe(0)
    expect(balance(u.tenantId, ACC.AP)).toBe(0)
    expect(balance(u.tenantId, ACC.RAW_MATERIAL)).toBe(333)
    expect(balance(u.tenantId, ACC.CASH)).toBe(-333)
    expect(listPosCashUnmatched(u.tenantId)).toHaveLength(0)
    // autoPay ถูกข้าม — ไม่มีใบจ่ายเงินซ้ำ
    expect((db.prepare('SELECT COUNT(*) c FROM supplier_payments WHERE tenant_id = ?').get(u.tenantId) as any).c).toBe(0)
  })

  it('บิลเกินเงินที่เหลือ → ปฏิเสธ และไม่เบิร์นเลขใบ', async () => {
    const u = newTenant()
    await openShortShift(u)
    const mv = listPosCashUnmatched(u.tenantId)[0]
    const g = seedReceivedPo(u, 400)
    let caught: any
    try { createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [g.grId], posCashMovementId: mv.id }) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(PurchaseBillingError)
    expect(caught.code).toBe('POS_CASH_OVER')
    expect((db.prepare("SELECT COUNT(*) c FROM document_sequences WHERE tenant_id = ? AND doc_type = 'PURCHASE_INVOICE'").get(u.tenantId) as any)?.c ?? 0).toBe(0)
  })

  it('แก้ยอดบิลลง → ยังผูก 1182 และจ่ายแล้ว, ส่วนที่เหลือรอจับคู่ · ยกเลิกใบ → กลับมารอจับคู่ครบ', async () => {
    const u = newTenant()
    await openShortShift(u)
    const mv = listPosCashUnmatched(u.tenantId)[0]
    const g = seedReceivedPo(u, 333)
    const inv = createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [g.grId], posCashMovementId: mv.id }) as any

    const item = db.prepare('SELECT id FROM purchase_invoice_items WHERE purchase_invoice_id = ?').get(inv.id) as any
    const edited = updatePurchaseInvoice(u.tenantId, u.email, inv.id, { items: [{ id: item.id, unitPrice: 300 }] }) as any
    expect(edited).toMatchObject({ total_amount: 300, paid_amount: 300, balance_amount: 0, payment_status: 'PAID' })
    expect(listPosCashUnmatched(u.tenantId)[0].remaining).toBe(33)
    expect(balance(u.tenantId, ACC.POS_PAYOUT_PENDING)).toBe(33)
    expect(balance(u.tenantId, ACC.AP)).toBe(0)

    const res = await request(app).put(`/api/purchase/invoices/${inv.id}/status`).set(auth(u.token)).send({ status: 'CANCELLED' })
    expect(res.status).toBe(200)
    expect(listPosCashUnmatched(u.tenantId)[0].remaining).toBe(333)
    expect(balance(u.tenantId, ACC.POS_PAYOUT_PENDING)).toBe(333)
  })
})
