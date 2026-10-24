import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import { createGoodsReceipt, confirmGoodsReceipt, getPendingPoItems, GoodsReceiptError } from './goodsReceipt.service'
import { createPurchaseInvoice, updatePurchaseInvoice, paySupplier } from './purchaseBilling.service'
import { applyPurchaseOrderUpdate, PurchaseOrderUpdateError } from './purchaseOrderUpdate.service'

/** แก้ตามรีวิวบัญชีจัดซื้อ 2026-10-24 — แต่ละเคสพังก่อนแก้ */

type Line = { qty: number; price: number; skipStock?: boolean; withMaterial?: boolean }

function seedPo(tenantId: string, lines: Line[], opts: { taxRate?: number; inclusive?: boolean; discount?: number; isPaid?: boolean; paidAmount?: number; total?: number; paymentMethod?: string; supplierId?: string } = {}) {
  const supplierId = opts.supplierId || generateId()
  if (!opts.supplierId) {
    db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')").run(supplierId, tenantId, supplierId)
  }
  const poId = generateId()
  const now = new Date().toISOString()
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0)
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_rate, vat_inclusive, discount_amount, tax_amount, total_amount,
      is_paid, paid_amount, payment_method, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'APPROVED', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
  `).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, subtotal, opts.taxRate ?? 7, opts.inclusive ? 1 : 0, opts.discount ?? 0,
    opts.total ?? subtotal, opts.isPaid ? 1 : 0, opts.paidAmount ?? null, opts.paymentMethod ?? null, now, now)
  const poItemIds: string[] = []
  const materialIds: string[] = []
  for (const l of lines) {
    let materialId: string | null = null
    if (!l.skipStock || l.withMaterial) {
      materialId = generateId()
      db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
        VALUES (?, ?, ?, ?, 'raw', 0, 'pcs', 'pcs', 10, 'STOCK', 'ACTIVE')`).run(materialId, tenantId, 'SKU-' + materialId.slice(0, 8), 'ของ ' + materialId.slice(0, 4))
    }
    const poItemId = generateId()
    db.prepare(`INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty, skip_stock)
      VALUES (?, ?, ?, ?, ?, ?, 'pcs', ?, ?, 0, ?)`).run(poItemId, tenantId, poId, materialId, materialId ? 'ของ ' + materialId.slice(0, 4) : 'ค่าส่ง', l.qty, l.price, l.qty * l.price, l.skipStock ? 1 : 0)
    poItemIds.push(poItemId)
    materialIds.push(materialId as string)
  }
  return { poId, supplierId, poItemIds, materialIds }
}

/** รับของ (ทั้งหมดที่ค้าง หรือสัดส่วน fraction) แล้วยืนยัน */
function receive(tenantId: string, poId: string, fraction = 1, receiptDate?: string) {
  const pending = getPendingPoItems(tenantId, poId)
  const gr = createGoodsReceipt(tenantId, 'u@x', {
    purchaseOrderId: poId, receiptDate,
    items: pending.map(p => ({ poItemId: p.id, materialId: p.material_id, orderedQty: p.quantity, receivedQty: p.pending_qty * fraction, acceptedQty: p.pending_qty * fraction })),
  }) as any
  return confirmGoodsReceipt(tenantId, 'u1', gr.id) as any
}

/** ยอดคงเหลือ (Dr − Cr) ของรหัสบัญชีทั้งกิจการ */
function balance(tenantId: string, code: string) {
  const r = db.prepare(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS b FROM journal_lines l
    JOIN journal_entries je ON je.id = l.journal_entry_id JOIN accounts a ON a.id = l.account_id
    WHERE je.tenant_id = ? AND a.code = ?`).get(tenantId, code) as any
  return Math.round(r.b * 100) / 100
}

function seedAccount(tenantId: string, code: string, type: string) {
  const id = generateId()
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, level, is_active, is_system, normal_balance, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'OTHER', 2, 1, 0, ?, ?, ?)`).run(id, tenantId, code, 'acc ' + code, type, type === 'LIABILITY' ? 'CREDIT' : 'DEBIT', now, now)
  return id
}

const err = (fn: () => any) => { try { fn() } catch (e) { return e as any } return null }

describe('#1 2109 ปิดเต็มยอดเสมอ', () => {
  it('จด VAT + PO ราคารวม VAT: GR ตั้ง 2109 ที่ราคาไม่รวม VAT และใบแจ้งหนี้ปิดเหลือ 0 (เดิมค้าง 7)', () => {
    const u = createTestUser({ role: 'ADMIN' })
    const { poId } = seedPo(u.tenantId, [{ qty: 1, price: 107 }], { inclusive: true })
    const gr = receive(u.tenantId, poId)
    expect(balance(u.tenantId, '2109')).toBe(-100)
    createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [gr.id], autoPay: false })
    expect(balance(u.tenantId, '2109')).toBe(0)
    expect(balance(u.tenantId, '1107')).toBe(100)
    expect(balance(u.tenantId, '1110')).toBe(7)
    expect(balance(u.tenantId, '2101')).toBe(-107)
  })

  it('ราคาในใบแจ้งหนี้ต่ำกว่าใบรับ → Cr สต็อกส่วนต่าง 2109 เป็น 0', () => {
    const u = createTestUser({ role: 'ADMIN' })
    const { poId } = seedPo(u.tenantId, [{ qty: 2, price: 100 }], { taxRate: 0 })
    const gr = receive(u.tenantId, poId)
    const grItem = db.prepare('SELECT id FROM goods_receipt_items WHERE goods_receipt_id = ?').get(gr.id) as any
    createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [gr.id], items: [{ grItemId: grItem.id, unitPrice: 90 }], autoPay: false })
    expect(balance(u.tenantId, '2109')).toBe(0)
    expect(balance(u.tenantId, '1107')).toBe(180)
  })
})

describe('#1b กิจการไม่จด VAT + PO ราคารวม VAT (เคสจริง PO-057-280826 / PO-050-040826)', () => {
  const notRegistered = (tenantId: string) =>
    db.prepare('INSERT INTO company_settings (tenant_id, name, vat_registered) VALUES (?, ?, 0)').run(tenantId, 'ไม่จด VAT')

  it('GR แล้วใบแจ้งหนี้: 2109 เป็น 0 และ 1107 = ต้นทุนรวม VAT ครั้งเดียว (เดิม 2109 ค้าง 41.66 + 1107 นับ VAT ซ้ำ)', () => {
    const u = createTestUser({ role: 'ADMIN' })
    notRegistered(u.tenantId)
    const { poId } = seedPo(u.tenantId, [{ qty: 1, price: 636.73 }], { inclusive: true })
    const gr = receive(u.tenantId, poId)
    expect(balance(u.tenantId, '2109')).toBe(-636.73)
    createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [gr.id], autoPay: false })
    expect(balance(u.tenantId, '2109')).toBe(0)
    expect(balance(u.tenantId, '1107')).toBe(636.73)
    expect(balance(u.tenantId, '1110')).toBe(0)
    expect(balance(u.tenantId, '2101')).toBe(-636.73)
  })

  it('มีบรรทัดไม่นับสต็อกปน: 2109 เป็น 0, 1107 = ส่วนสต็อกรวม VAT, ค่าใช้จ่าย = ส่วนไม่นับสต็อกรวม VAT', () => {
    const u = createTestUser({ role: 'ADMIN' })
    notRegistered(u.tenantId)
    const { poId } = seedPo(u.tenantId, [{ qty: 1, price: 107 }, { qty: 1, price: 129, skipStock: true }], { inclusive: true })
    const gr = receive(u.tenantId, poId)
    createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [gr.id], autoPay: false })
    expect(balance(u.tenantId, '2109')).toBe(0)
    expect(balance(u.tenantId, '1107')).toBe(107)
    expect(balance(u.tenantId, '5403')).toBe(129)
    expect(balance(u.tenantId, '2101')).toBe(-236)
  })
})

describe('#2 ส่วนลดท้ายบิลของ PO ใช้ครั้งเดียว', () => {
  it('รับสองรอบ ออกสองใบ → ส่วนลดรวม = ส่วนลดของ PO ไม่ใช่สองเท่า', () => {
    const u = createTestUser({ role: 'ADMIN' })
    const { poId } = seedPo(u.tenantId, [{ qty: 10, price: 100 }], { taxRate: 0, discount: 100 })
    const gr1 = receive(u.tenantId, poId, 0.5)
    const inv1 = createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [gr1.id], autoPay: false }) as any
    const gr2 = receive(u.tenantId, poId)
    const inv2 = createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [gr2.id], autoPay: false }) as any
    expect(inv1.discount_amount + inv2.discount_amount).toBe(100)
    expect(inv1.total_amount + inv2.total_amount).toBe(900)
    expect(balance(u.tenantId, '2109')).toBe(0)
  })

  it('ส่ง discountAmount = 0 มาเอง → ไม่มีส่วนลด', () => {
    const u = createTestUser({ role: 'ADMIN' })
    const { poId } = seedPo(u.tenantId, [{ qty: 1, price: 100 }], { taxRate: 0, discount: 10 })
    const gr = receive(u.tenantId, poId)
    const inv = createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [gr.id], discountAmount: 0, autoPay: false }) as any
    expect(inv.total_amount).toBe(100)
  })
})

describe('#3 บัญชี Dr/Cr ที่เลือกติดไปกับใบ', () => {
  it('แก้ยอดแล้วยังลงบัญชีเดิม และจ่ายเงิน Dr บัญชีหนี้ของใบ ไม่ใช่ 2101', () => {
    const u = createTestUser({ role: 'ADMIN' })
    const expenseAcc = seedAccount(u.tenantId, '5999', 'EXPENSE')
    const loanAcc = seedAccount(u.tenantId, '2199', 'LIABILITY')
    const { poId, supplierId } = seedPo(u.tenantId, [{ qty: 1, price: 100 }], { taxRate: 0 })
    const gr = receive(u.tenantId, poId)
    const inv = createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [gr.id], drAccountId: expenseAcc, crAccountId: loanAcc, autoPay: false }) as any
    expect(inv.cr_account_id).toBe(loanAcc)
    const piItem = db.prepare('SELECT id FROM purchase_invoice_items WHERE purchase_invoice_id = ?').get(inv.id) as any
    updatePurchaseInvoice(u.tenantId, u.email, inv.id, { items: [{ id: piItem.id, unitPrice: 120 }] })
    expect(balance(u.tenantId, '5999')).toBe(20)   // ส่วนเกินจาก 2109 ยังลงบัญชีที่เลือก (เดิมเด้งไป 1107)
    expect(balance(u.tenantId, '2199')).toBe(-120)
    expect(balance(u.tenantId, '2101')).toBe(0)
    paySupplier(u.tenantId, u.email, { supplierId, purchaseInvoiceId: inv.id, amount: 120 })
    expect(balance(u.tenantId, '2199')).toBe(0)
    expect(balance(u.tenantId, '2101')).toBe(0)
  })

  it('โหมด VAT ไม่ตรงกับ PO → ปฏิเสธ', () => {
    const u = createTestUser({ role: 'ADMIN' })
    const { poId } = seedPo(u.tenantId, [{ qty: 1, price: 100 }])
    const gr = receive(u.tenantId, poId)
    const inv = createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [gr.id], autoPay: false }) as any
    expect(err(() => updatePurchaseInvoice(u.tenantId, u.email, inv.id, { vatInclusive: true }))?.code).toBe('VAT_MODE_MISMATCH')
    expect(err(() => updatePurchaseInvoice(u.tenantId, u.email, inv.id, { vatInclusive: false }))).toBeNull()
  })
})

describe('#6 ยืนยัน GR ในงวดที่ปิดแล้วไม่ได้', () => {
  it('PERIOD_CLOSED และสต็อก/2109 ไม่ขยับ', () => {
    const u = createTestUser({ role: 'ADMIN' })
    db.prepare(`INSERT INTO tax_periods (id, tenant_id, year, month, period_type, start_date, end_date, status)
      VALUES (?, ?, 2025, 3, 'MONTHLY', '2025-03-01', '2025-03-31', 'CLOSED')`).run(generateId(), u.tenantId)
    const { poId, materialIds } = seedPo(u.tenantId, [{ qty: 1, price: 100 }])
    const e = err(() => receive(u.tenantId, poId, 1, '2025-03-10'))
    expect(e).toBeInstanceOf(GoodsReceiptError)
    expect(e.code).toBe('PERIOD_CLOSED')
    expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(materialIds[0]) as any).quantity).toBe(0)
    expect(balance(u.tenantId, '2109')).toBe(0)
  })
})

describe('#7 paySupplier ตรวจยอดเงิน/ผู้ขาย', () => {
  function issued() {
    const u = createTestUser({ role: 'ADMIN' })
    const { poId, supplierId } = seedPo(u.tenantId, [{ qty: 1, price: 100 }], { taxRate: 0 })
    const inv = createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [receive(u.tenantId, poId).id], autoPay: false }) as any
    return { u, supplierId, inv }
  }
  it('ยอดติดลบ / WHT ไม่ถูก / ผู้ขายไม่ตรงใบ → ปฏิเสธ', () => {
    const { u, supplierId, inv } = issued()
    expect(err(() => paySupplier(u.tenantId, u.email, { supplierId, purchaseInvoiceId: inv.id, amount: -50 }))?.code).toBe('AMOUNT_REQUIRED')
    expect(err(() => paySupplier(u.tenantId, u.email, { supplierId, purchaseInvoiceId: inv.id, amount: 50, withholdingTax: 50 }))?.code).toBe('WHT_INVALID')
    expect(err(() => paySupplier(u.tenantId, u.email, { supplierId, purchaseInvoiceId: inv.id, amount: 50, withholdingTax: -1 }))?.code).toBe('WHT_INVALID')
    const other = generateId()
    db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'B', 'C')").run(other, u.tenantId, other)
    expect(err(() => paySupplier(u.tenantId, u.email, { supplierId: other, purchaseInvoiceId: inv.id, amount: 50 }))?.code).toBe('SUPPLIER_MISMATCH')
    const foreign = createTestUser({ role: 'ADMIN' })
    db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'F', 'C')").run('f-' + other, foreign.tenantId, 'f-' + other)
    expect(err(() => paySupplier(u.tenantId, u.email, { supplierId: 'f-' + other, amount: 50 }))?.code).toBe('SUPPLIER_MISMATCH')
    expect((db.prepare('SELECT paid_amount FROM purchase_invoices WHERE id = ?').get(inv.id) as any).paid_amount).toBe(0)
  })
  it('ยอดเศษเกินสตางค์ถูกปัดก่อนลงบัญชี', () => {
    const { u, supplierId, inv } = issued()
    const pay = paySupplier(u.tenantId, u.email, { supplierId, purchaseInvoiceId: inv.id, amount: 33.333, withholdingTax: 1.006 }) as any
    expect(pay.amount).toBe(33.33)
    expect(pay.net_amount).toBe(32.32)
    expect(balance(u.tenantId, '2101')).toBe(-66.67)
  })
})

describe('#8 auto-settle', () => {
  it('PO ติดธงจ่ายบางส่วน → จ่ายตามที่ PO จ่ายจริง ไม่ใช่เต็มใบ', () => {
    const u = createTestUser({ role: 'ADMIN' })
    const { poId } = seedPo(u.tenantId, [{ qty: 1, price: 100 }], { taxRate: 0, isPaid: true, paidAmount: 40, total: 100 })
    const inv = createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [receive(u.tenantId, poId).id] }) as any
    expect(inv.paid_amount).toBe(40)
    expect(inv.balance_amount).toBe(60)
  })
  it('จ่ายไม่ผ่าน → แจ้ง error และไม่มีใบแจ้งหนี้ค้างครึ่งทาง', () => {
    const u = createTestUser({ role: 'ADMIN' })
    const { poId } = seedPo(u.tenantId, [{ qty: 1, price: 100 }], { taxRate: 0, isPaid: true, paymentMethod: 'POS_CASH' })
    const gr = receive(u.tenantId, poId)
    expect(err(() => createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [gr.id] }))?.code).toBe('POS_CASH_REQUIRED')
    expect((db.prepare('SELECT COUNT(*) c FROM purchase_invoices WHERE tenant_id = ?').get(u.tenantId) as any).c).toBe(0)
    expect((db.prepare('SELECT invoiced_at FROM goods_receipts WHERE id = ?').get(gr.id) as any).invoiced_at).toBeNull()
  })
})

describe('#10/#11 ภาษีซื้อ', () => {
  it('vat_entries ฐานภาษี = หลังหักส่วนลด', () => {
    const u = createTestUser({ role: 'ADMIN' })
    const { poId } = seedPo(u.tenantId, [{ qty: 7, price: 100 }])
    const inv = createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [receive(u.tenantId, poId).id], discountAmount: 70, autoPay: false }) as any
    const v = db.prepare("SELECT base_amount, vat_amount FROM vat_entries WHERE document_id = ? AND document_type = 'PURCHASE_INVOICE'").get(inv.id) as any
    expect(v).toEqual({ base_amount: 630, vat_amount: 44.1 })
  })
  it('รวม PO ที่โหมด VAT ต่างกันเข้าบิลเดียวไม่ได้', () => {
    const u = createTestUser({ role: 'ADMIN' })
    const a = seedPo(u.tenantId, [{ qty: 1, price: 107 }], { inclusive: true })
    const b = seedPo(u.tenantId, [{ qty: 1, price: 100 }], { supplierId: a.supplierId })
    const ga = receive(u.tenantId, a.poId)
    const gb = receive(u.tenantId, b.poId)
    expect(err(() => createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [ga.id, gb.id], autoPay: false }))?.code).toBe('VAT_MODE_MISMATCH')
  })
})

describe('#12 บรรทัดไม่นับสต็อกที่ผูกสินค้า', () => {
  it('ไม่เข้าคลัง ไม่ตั้ง 2109 และใบแจ้งหนี้ลงค่าใช้จ่าย 2109 เป็น 0', () => {
    const u = createTestUser({ role: 'ADMIN' })
    const { poId, materialIds } = seedPo(u.tenantId, [{ qty: 1, price: 200, skipStock: true, withMaterial: true }], { taxRate: 0 })
    const gr = receive(u.tenantId, poId)
    expect((db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(materialIds[0]) as any).quantity).toBe(0)
    createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [gr.id], autoPay: false })
    expect(balance(u.tenantId, '2109')).toBe(0)
    expect(balance(u.tenantId, '1107')).toBe(0)
    expect(balance(u.tenantId, '5403')).toBe(200)
  })
})

describe('#14 applyPurchaseOrderUpdate', () => {
  it('ไม่ส่ง items/taxRate/ส่วนลด → ยอดเดิมคงอยู่ (เดิมกลายเป็น 0)', () => {
    const u = createTestUser({ role: 'ADMIN' })
    const { poId } = seedPo(u.tenantId, [{ qty: 2, price: 50 }], { discount: 10 })
    db.prepare("UPDATE purchase_orders SET status = 'DRAFT' WHERE id = ?").run(poId)
    applyPurchaseOrderUpdate(u.tenantId, poId, { notes: 'แก้หมายเหตุ' })
    const po = db.prepare('SELECT subtotal, tax_rate, discount_amount, total_amount FROM purchase_orders WHERE id = ?').get(poId) as any
    expect(po).toEqual({ subtotal: 100, tax_rate: 7, discount_amount: 10, total_amount: 96.3 })
  })
  it('มีใบรับสินค้าที่ยังไม่ยกเลิก → แก้ไม่ได้ (รวมคำขอแก้ที่อนุมัติทีหลัง)', () => {
    const u = createTestUser({ role: 'ADMIN' })
    const { poId } = seedPo(u.tenantId, [{ qty: 2, price: 50 }])
    receive(u.tenantId, poId, 0.5)
    expect(err(() => applyPurchaseOrderUpdate(u.tenantId, poId, { notes: 'x' }))).toBeInstanceOf(PurchaseOrderUpdateError)
  })
})
