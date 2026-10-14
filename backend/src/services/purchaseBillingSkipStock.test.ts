import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { createGoodsReceipt, confirmGoodsReceipt, getPendingPoItems } from './goodsReceipt.service'
import { createPurchaseInvoice, updatePurchaseInvoice } from './purchaseBilling.service'
import { createTestUser } from '../test/testAuth'
import { resolveExpenseAccountId, PurchaseOrderUpdateError } from './purchaseOrderUpdate.service'

/** สร้างบัญชี EXPENSE ตรงลง DB (ไม่ผ่าน seedChartOfAccounts — test เรียก service ตรง ไม่ใช่ route) */
function seedExpenseAccount(tenantId: string, code: string, name: string): string {
  const id = generateId()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO accounts (id, tenant_id, code, name, type, category, level, is_active, is_system, normal_balance, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'EXPENSE', 'OTHER', 2, 1, 1, 'DEBIT', ?, ?)
  `).run(id, tenantId, code, name, now, now)
  return id
}

/**
 * บั๊ก: purchase_order_items.skip_stock = 1 (ของไม่นับสต็อก เช่นน้ำมันรถส่งของ/ของใช้สำนักงาน)
 * ไม่เคยเข้า GRNI accrual ตอนยืนยัน GR (ถูกแล้ว — ของพวกนี้ไม่เข้าคลัง) แต่ตอนออกใบแจ้งหนี้ซื้อ
 * ยอดของมันหลุดไปอยู่ใน inventoryAccId (1107 สต็อกวัตถุดิบ) เต็ม ๆ เพราะเป็น "ส่วนที่เหลือหลังปิด
 * 2109" กลายเป็นสินทรัพย์ปลอม — ที่ถูกคือแยกไปบัญชีค่าใช้จ่าย (5403) ตามสัดส่วนมูลค่า skip_stock
 * ในบิล (ดู postPurchaseInvoiceJournal / calcPurchaseInvoiceTotals)
 */

type Line = { description: string; qty: number; unitPrice: number; skipStock?: boolean; expenseAccountId?: string | null }

function seedPo(tenantId: string, lines: Line[], taxRate = 7) {
  const supplierId = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'Sup', 'C')")
    .run(supplierId, tenantId, supplierId)
  const poId = generateId()
  const now = new Date().toISOString()
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)
  db.prepare(`
    INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_rate, tax_amount, total_amount, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'APPROVED', ?, ?, 0, ?, ?, ?)
  `).run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, subtotal, taxRate, subtotal, now, now)
  for (const line of lines) {
    const skip = line.skipStock ? 1 : 0
    let materialId: string | null = null
    if (!skip) {
      materialId = generateId()
      db.prepare(`
        INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
        VALUES (?, ?, ?, ?, 'raw', 0, 'pcs', 'pcs', 10, 'STOCK', 'ACTIVE')
      `).run(materialId, tenantId, 'SKU-' + materialId.slice(0, 8), line.description)
    }
    db.prepare(`
      INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty, skip_stock, expense_account_id)
      VALUES (?, ?, ?, ?, ?, ?, 'pcs', ?, ?, 0, ?, ?)
    `).run(generateId(), tenantId, poId, materialId, line.description, line.qty, line.unitPrice, line.qty * line.unitPrice, skip, skip ? (line.expenseAccountId || null) : null)
  }
  return poId
}

/** รับของทั้ง PO ในรอบเดียว (ทั้งบรรทัดสต็อกและ skip_stock) แล้วยืนยัน GR ทันที */
function receiveWholePo(tenantId: string, userEmail: string, poId: string) {
  const pending = getPendingPoItems(tenantId, poId)
  const created = createGoodsReceipt(tenantId, userEmail, {
    purchaseOrderId: poId,
    items: pending.map(p => ({ poItemId: p.id, materialId: p.material_id, orderedQty: p.quantity, receivedQty: p.pending_qty, acceptedQty: p.pending_qty })),
  }) as any
  return confirmGoodsReceipt(tenantId, userEmail, created.id) as any
}

/** สรุป journal ปัจจุบัน (reference_type = PURCHASE_INVOICE) ของใบแจ้งหนี้ — ยอดต่อรหัสบัญชี + ผลรวม */
function journalSummary(tenantId: string, piId: string) {
  const je = db.prepare(
    "SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_type = 'PURCHASE_INVOICE' AND reference_id = ?"
  ).get(tenantId, piId) as any
  const lines = db.prepare(`
    SELECT a.code as code, l.debit as debit, l.credit as credit
    FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.journal_entry_id = ?
  `).all(je.id) as any[]
  const byCode = (code: string) => lines.filter(l => l.code === code).reduce((s, l) => s + l.debit, 0)
  const debitTotal = lines.reduce((s, l) => s + l.debit, 0)
  const creditTotal = lines.reduce((s, l) => s + l.credit, 0)
  return { je, lines, byCode, debitTotal, creditTotal }
}

describe('ใบแจ้งหนี้ซื้อ — แยก skip_stock ออกจากสต็อก (5403 ไม่ใช่ 1107)', () => {
  it('(a) ทุกบรรทัดเป็น skip_stock → เดบิต 5403 เต็มยอด ไม่มี 1107 เลย', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const poId = seedPo(user.tenantId, [{ description: 'น้ำมันรถส่งของ', qty: 1, unitPrice: 1000, skipStock: true }], 0)
    const gr = receiveWholePo(user.tenantId, user.email, poId)
    const inv = createPurchaseInvoice(user.tenantId, user.email, { goodsReceiptIds: [gr.id] })

    const { byCode, debitTotal, creditTotal } = journalSummary(user.tenantId, inv.id)
    expect(debitTotal).toBeCloseTo(creditTotal, 5)
    expect(byCode('5403')).toBeCloseTo(1000, 2)
    expect(byCode('1107')).toBe(0)
    expect(byCode('2109')).toBe(0)
  })

  it('(b) GR ผสม (สต็อก+skip) + ส่วนลดท้ายบิล → 2109 ปิดยอดค้าง, 5403 ได้ส่วน skip, ดุล', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const poId = seedPo(user.tenantId, [
      { description: 'แป้งสาลี', qty: 5, unitPrice: 100 },
      { description: 'น้ำมันรถส่งของ', qty: 1, unitPrice: 200, skipStock: true },
    ], 7)
    const gr = receiveWholePo(user.tenantId, user.email, poId)
    // subtotal 700, skipShare = 200/700, discount 70 → base 630, vat 44.1, total 674.1
    const inv = createPurchaseInvoice(user.tenantId, user.email, { goodsReceiptIds: [gr.id], discountAmount: 70 })

    const { byCode, debitTotal, creditTotal } = journalSummary(user.tenantId, inv.id)
    expect(debitTotal).toBeCloseTo(creditTotal, 5)
    expect(debitTotal).toBeCloseTo(674.1, 2)
    expect(byCode('2109')).toBeCloseTo(450, 2)   // min(accrued 500, 630-180)
    expect(byCode('5403')).toBeCloseTo(180, 2)   // 630 × (200/700)
    expect(byCode('1107')).toBeCloseTo(0, 2)     // residual หลังหัก 2109+5403 = 0
    expect(byCode('1110')).toBeCloseTo(44.1, 2)  // จด VAT แล้ว — ภาษีซื้อไม่ถูกแยกตาม skip_stock
  })

  it('(c) กิจการยังไม่จด VAT + VAT แยก 7% → ส่วน skip ของ VAT ก็ลง 5403 ด้วย', () => {
    const user = createTestUser({ role: 'ADMIN' })
    db.prepare('INSERT INTO company_settings (tenant_id, name, vat_registered) VALUES (?, ?, 0)').run(user.tenantId, 'ร้านทดสอบ')
    const poId = seedPo(user.tenantId, [
      { description: 'แป้งสาลี', qty: 2, unitPrice: 100 },
      { description: 'น้ำมันรถส่งของ', qty: 1, unitPrice: 100, skipStock: true },
    ], 7)
    const gr = receiveWholePo(user.tenantId, user.email, poId)
    // subtotal 300, skipShare = 1/3, vat 21 (ขอคืนไม่ได้ → ลงบัญชีตัวของ), total 321
    const inv = createPurchaseInvoice(user.tenantId, user.email, { goodsReceiptIds: [gr.id] })

    const { byCode, debitTotal, creditTotal } = journalSummary(user.tenantId, inv.id)
    expect(debitTotal).toBeCloseTo(creditTotal, 5)
    expect(debitTotal).toBeCloseTo(321, 2)
    expect(byCode('2109')).toBeCloseTo(200, 2)
    expect(byCode('5403')).toBeCloseTo(107, 2)  // ส่วนของ (100) + ส่วนภาษีซื้อขอคืนไม่ได้ (7)
    expect(byCode('1107')).toBeCloseTo(14, 2)   // ภาษีซื้อขอคืนไม่ได้ ส่วนที่ไม่ใช่ skip_stock (21 × 2/3)
  })

  it('(d) แก้ไขใบแจ้งหนี้ (เปลี่ยนส่วนลด) → สัดส่วน skip_stock คำนวณใหม่ด้วยสูตรเดียวกัน', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const poId = seedPo(user.tenantId, [
      { description: 'แป้งสาลี', qty: 4, unitPrice: 100 },
      { description: 'น้ำมันรถส่งของ', qty: 1, unitPrice: 100, skipStock: true },
    ], 7)
    const gr = receiveWholePo(user.tenantId, user.email, poId)
    const inv = createPurchaseInvoice(user.tenantId, user.email, { goodsReceiptIds: [gr.id] })

    let s = journalSummary(user.tenantId, inv.id)
    expect(s.byCode('2109')).toBeCloseTo(400, 2)
    expect(s.byCode('5403')).toBeCloseTo(100, 2)
    expect(s.byCode('1110')).toBeCloseTo(35, 2)

    // เพิ่มส่วนลดท้ายบิล 50 — reverse journal เดิม + ลงใหม่ทั้งใบ (updatePurchaseInvoice)
    updatePurchaseInvoice(user.tenantId, user.email, inv.id, { discountAmount: 50 })
    s = journalSummary(user.tenantId, inv.id)
    expect(s.debitTotal).toBeCloseTo(s.creditTotal, 5)
    expect(s.debitTotal).toBeCloseTo(481.5, 2)
    expect(s.byCode('2109')).toBeCloseTo(360, 2)
    expect(s.byCode('5403')).toBeCloseTo(90, 2)
    expect(s.byCode('1110')).toBeCloseTo(31.5, 2)
  })

  it('(e) หลายบัญชีค่าใช้จ่ายต่อบรรทัด — แยก Dr ต่อบัญชี ตามสัดส่วน + บรรทัดไม่เลือกบัญชี fallback ไป 5403', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const travelAccId = seedExpenseAccount(user.tenantId, '5308', 'ค่าใช้จ่ายเดินทาง')
    const packagingAccId = seedExpenseAccount(user.tenantId, '5204', 'ค่าใช้จ่ายบรรจุภัณฑ์')
    const poId = seedPo(user.tenantId, [
      { description: 'แป้งสาลี', qty: 3, unitPrice: 100 },
      { description: 'น้ำมันรถส่งของ', qty: 1, unitPrice: 100, skipStock: true, expenseAccountId: travelAccId },
      { description: 'กล่องกระดาษ', qty: 1, unitPrice: 100, skipStock: true, expenseAccountId: packagingAccId },
      { description: 'ของเบ็ดเตล็ดไม่ได้เลือกบัญชี', qty: 1, unitPrice: 100, skipStock: true },
    ], 7)
    const gr = receiveWholePo(user.tenantId, user.email, poId)
    // subtotal 600, discount 60 → base 540, vat 37.8, total 577.8
    // skipShare = 300/600 = 0.5 → expensePortion = 540×0.5 = 270 แบ่งเท่ากัน 3 บัญชี (ถ่วงน้ำหนักเท่ากัน) = 90 ต่อบัญชี
    const inv = createPurchaseInvoice(user.tenantId, user.email, { goodsReceiptIds: [gr.id], discountAmount: 60 })

    const { byCode, debitTotal, creditTotal } = journalSummary(user.tenantId, inv.id)
    expect(debitTotal).toBeCloseTo(creditTotal, 5)
    expect(debitTotal).toBeCloseTo(577.8, 2)
    expect(byCode('5308')).toBeCloseTo(90, 2)
    expect(byCode('5204')).toBeCloseTo(90, 2)
    expect(byCode('5403')).toBeCloseTo(90, 2) // บรรทัดที่ไม่ได้เลือกบัญชี → fallback ไปค่าใช้จ่ายอื่น
    expect(byCode('1110')).toBeCloseTo(37.8, 2) // จด VAT แล้ว ไม่ต้องแยกตาม skip_stock
  })
})

describe('resolveExpenseAccountId — บัญชีค่าใช้จ่ายต่อบรรทัดต้องเป็น EXPENSE ของ tenant นี้เท่านั้น', () => {
  it('skip_stock=false → ไม่เก็บบัญชีเลย ถึงจะส่งมาก็ตาม', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const accId = seedExpenseAccount(user.tenantId, '5308', 'ค่าใช้จ่ายเดินทาง')
    expect(resolveExpenseAccountId(user.tenantId, accId, false)).toBeNull()
  })

  it('บัญชีของ tenant อื่น → ปฏิเสธ', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const otherTenantId = generateId()
    const otherAccId = seedExpenseAccount(otherTenantId, '5308', 'ค่าใช้จ่ายเดินทางของอีก tenant')
    expect(() => resolveExpenseAccountId(user.tenantId, otherAccId, true)).toThrow(PurchaseOrderUpdateError)
  })

  it('บัญชีที่ไม่ใช่ประเภท EXPENSE (เช่นสต็อกวัตถุดิบ) → ปฏิเสธ', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const assetAccId = generateId()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO accounts (id, tenant_id, code, name, type, category, level, is_active, is_system, normal_balance, created_at, updated_at)
      VALUES (?, ?, '1107', 'สต็อกวัตถุดิบ', 'ASSET', 'INVENTORY', 2, 1, 1, 'DEBIT', ?, ?)
    `).run(assetAccId, user.tenantId, now, now)
    expect(() => resolveExpenseAccountId(user.tenantId, assetAccId, true)).toThrow(PurchaseOrderUpdateError)
  })

  it('บัญชี EXPENSE ของ tenant นี้เอง → ผ่าน คืน id เดิม', () => {
    const user = createTestUser({ role: 'ADMIN' })
    const accId = seedExpenseAccount(user.tenantId, '5308', 'ค่าใช้จ่ายเดินทาง')
    expect(resolveExpenseAccountId(user.tenantId, accId, true)).toBe(accId)
  })
})

describe('ใบแจ้งหนี้ซื้อ — กิจการยังไม่จด VAT + PO ราคารวม VAT', () => {
  // GR ตั้ง 2109 ไว้ 107 (ราคารวมภาษี) — ใบแจ้งหนี้ต้องปิด 2109 ครบ 107 และลงบัญชีได้ (ดุล)
  // เดิม: ปิดได้แค่ 100 เศษ 7 ค้าง 2109 + Dr 1107 อีก 7 · รอบแก้แรก: ปิด 107 แล้วยังลงภาษีอีก 7 → Dr 114 ≠ Cr 107
  it('ปิด 2109 เต็มยอดที่ GR ตั้งไว้ ไม่นับภาษีซ้ำ และไม่ Dr สต็อกเพิ่ม', () => {
    const user = createTestUser({ role: 'ADMIN' })
    db.prepare('INSERT INTO company_settings (tenant_id, name, vat_registered) VALUES (?, ?, 0)').run(user.tenantId, 'ร้านทดสอบ')
    const poId = seedPo(user.tenantId, [{ description: 'แป้งสาลี', qty: 1, unitPrice: 107 }], 7)
    db.prepare('UPDATE purchase_orders SET vat_inclusive = 1 WHERE id = ?').run(poId)
    const gr = receiveWholePo(user.tenantId, user.email, poId)
    const inv = createPurchaseInvoice(user.tenantId, user.email, { goodsReceiptIds: [gr.id] })

    const { byCode, debitTotal, creditTotal } = journalSummary(user.tenantId, inv.id)
    expect(debitTotal).toBeCloseTo(creditTotal, 5)
    expect(creditTotal).toBeCloseTo(107, 2)
    expect(byCode('2109')).toBeCloseTo(107, 2)
    expect(byCode('1107')).toBeCloseTo(0, 2)
  })
})
