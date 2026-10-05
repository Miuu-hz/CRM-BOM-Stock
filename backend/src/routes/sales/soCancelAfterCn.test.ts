import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import creditNotesRouter from './creditNotes'
import { createTestUser } from '../../test/testAuth'
import { ACC } from '../../config/accountCodes'
import { createConversion } from '../../services/unitConversion.service'
import { deductStockForSO, restoreStockForSO, issuedBasePerUnit } from './shared'

/**
 * ใบลดหนี้รับคืนบางส่วนแล้วค่อยยกเลิก SO — สต็อกจริงกับสต็อกในงบต้องตรงกัน
 * (เดิมยกเลิกแล้ว mirror SO_COGS ทั้งก้อน ส่วนที่ CN คืนไปแล้วถูกกลับต้นทุนซ้ำ)
 * + ยืนยัน→ยกเลิก→ยืนยันใหม่ แล้วใบลดหนี้ต้องคืนตามตัวคูณจริง ไม่เบิ้ล
 */
const app = express()
app.use(express.json())
app.use('/api/sales/credit-notes', authenticate, creditNotesRouter)

function balanceOf(tenantId: string, code: string) {
  const row = db.prepare(`SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS bal
    FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.tenant_id = ? AND a.code = ?`).get(tenantId, code) as any
  return Math.round((row.bal || 0) * 100) / 100
}
const stockQty = (id: string) => (db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(id) as any).quantity

function seed(t: string, soQty: number, soUnit: string) {
  db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock) VALUES (?, ?, 0)').run(t, 'test')
  const customerId = generateId()
  db.prepare(`INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city)
    VALUES (?, ?, ?, 'ลูกค้า', 'RETAIL', '-', '-', '-', '-')`).run(customerId, t, 'C-' + customerId.slice(0, 6))
  const stockId = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
    VALUES (?, ?, ?, 'สินค้า', 'FINISHED', 100, 'pcs', 'pcs', 100, 'STOCK', 'ACTIVE')`).run(stockId, t, 'SKU-' + stockId.slice(0, 8))
  const soId = generateId()
  const soNumber = 'SO-CN-' + soId.slice(0, 6)
  db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, status) VALUES (?, ?, ?, ?, 'CONFIRMED')`)
    .run(soId, t, soNumber, customerId)
  const soItemId = generateId()
  db.prepare(`INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_name, quantity, unit, unit_price, total_price)
    VALUES (?, ?, ?, ?, 'สินค้า', ?, ?, 200, ?)`).run(soItemId, t, soId, stockId, soQty, soUnit, soQty * 200)
  return { customerId, stockId, soId, soNumber, soItemId }
}

async function issueCreditNote(t: string, token: string, s: ReturnType<typeof seed>, qty: number) {
  const invoiceId = generateId()
  db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id) VALUES (?, ?, ?, ?, ?)`)
    .run(invoiceId, t, 'INV-' + invoiceId.slice(0, 6), s.soId, s.customerId)
  const invoiceItemId = generateId()
  db.prepare(`INSERT INTO invoice_items (id, tenant_id, invoice_id, sales_order_item_id, stock_item_id, product_name, quantity, unit_price, total_price)
    VALUES (?, ?, ?, ?, ?, 'สินค้า', 10, 200, 2000)`).run(invoiceItemId, t, invoiceId, s.soItemId, s.stockId)
  const cnId = generateId()
  db.prepare(`INSERT INTO credit_notes (id, tenant_id, cn_number, invoice_id, customer_id, credit_date, reason, subtotal, tax_rate, tax_amount, total_amount, status)
    VALUES (?, ?, ?, ?, ?, ?, 'รับคืนสินค้า', ?, 0, 0, ?, 'DRAFT')`)
    .run(cnId, t, 'CN-' + cnId.slice(0, 6), invoiceId, s.customerId, new Date().toISOString(), qty * 200, qty * 200)
  db.prepare(`INSERT INTO credit_note_items (id, tenant_id, credit_note_id, invoice_item_id, quantity, unit_price, total_price)
    VALUES (?, ?, ?, ?, ?, 200, ?)`).run(generateId(), t, cnId, invoiceItemId, qty, qty * 200)
  const res = await request(app).put(`/api/sales/credit-notes/${cnId}/status`)
    .set('Authorization', `Bearer ${token}`).send({ status: 'ISSUED' })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
}

describe('ยกเลิก SO หลังใบลดหนี้รับคืนบางส่วน', () => {
  it('ขาย 10 @100 → CN คืน 4 → ยกเลิก: สต็อก +6 · สต็อกในงบ +600 · ต้นทุนขายสุทธิ 0', async () => {
    const { tenantId: t, token } = createTestUser()
    const s = seed(t, 10, 'pcs')
    deductStockForSO(t, s.soId, s.soNumber)
    await issueCreditNote(t, token, s, 4)
    expect(stockQty(s.stockId)).toBe(94)
    expect(balanceOf(t, ACC.INVENTORY)).toBe(-600)

    restoreStockForSO(t, s.soId, s.soNumber)
    expect(stockQty(s.stockId), 'ยกเลิกคืนแค่ 6 ที่ยังไม่ได้คืน').toBe(100)
    const cancel = db.prepare(`SELECT total_debit FROM journal_entries WHERE tenant_id = ? AND reference_type = 'SO_COGS_CANCEL'`).get(t) as any
    expect(cancel.total_debit, 'กลับรายการต้นทุนเฉพาะ 6 หน่วย').toBe(600)
    expect(balanceOf(t, ACC.INVENTORY), 'สต็อกในงบตรงกับสต็อกจริง (กลับครบ)').toBe(0)
    expect(balanceOf(t, ACC.COGS_PRODUCT), 'ต้นทุนขายสุทธิ ขาย/CN/ยกเลิก = 0').toBe(0)

    restoreStockForSO(t, s.soId, s.soNumber) // ยกเลิกซ้ำไม่ลงซ้ำ
    expect(stockQty(s.stockId)).toBe(100)
    expect(balanceOf(t, ACC.INVENTORY)).toBe(0)
  })

  it('ยืนยัน→ยกเลิก→ยืนยันใหม่ แล้ว CN คืน 1 แพ็ค = 12 ชิ้น ไม่ใช่ 24', async () => {
    const { tenantId: t, token } = createTestUser()
    const s = seed(t, 2, 'pack')
    createConversion(t, { material_id: s.stockId, from_unit: 'pack', to_unit: 'pcs', conversion_factor: 12 })
    deductStockForSO(t, s.soId, s.soNumber)
    restoreStockForSO(t, s.soId, s.soNumber)
    expect(issuedBasePerUnit(t, s.soItemId), 'คืนครบแล้ว = ไม่สอดคล้อง → แปลงแบบเดิม').toBeNull()
    deductStockForSO(t, s.soId, s.soNumber)
    expect(stockQty(s.stockId)).toBe(76)
    expect(issuedBasePerUnit(t, s.soItemId)).toBe(12)

    await issueCreditNote(t, token, s, 1)
    expect(stockQty(s.stockId)).toBe(88)
  })
})

describe('ยืนยัน→ยกเลิก→ยืนยันใหม่→ยกเลิก: สต็อกกับสต็อกในงบตรงกันทุกจุด', () => {
  it('รอบสองลง SO_COGS ใหม่ และยกเลิกรอบสองกลับรายการพอดี', () => {
    const { tenantId: t } = createTestUser()
    const s = seed(t, 10, 'pcs')
    // สต็อกในงบ (ส่วนที่ขยับจาก SO นี้) ต้องเท่ากับ (สต็อกจริง − 100) × ต้นทุน 100 เสมอ
    const check = (qty: number, label: string) => {
      expect(stockQty(s.stockId), label).toBe(qty)
      expect(balanceOf(t, ACC.INVENTORY), label).toBe((qty - 100) * 100)
      expect(balanceOf(t, ACC.COGS_PRODUCT), label).toBe((100 - qty) * 100)
    }
    deductStockForSO(t, s.soId, s.soNumber); check(90, 'ยืนยัน')
    restoreStockForSO(t, s.soId, s.soNumber); check(100, 'ยกเลิก')
    deductStockForSO(t, s.soId, s.soNumber); check(90, 'ยืนยันใหม่')
    restoreStockForSO(t, s.soId, s.soNumber); check(100, 'ยกเลิกรอบสอง')
    restoreStockForSO(t, s.soId, s.soNumber); check(100, 'ยกเลิกซ้ำ')
    const n = (type: string) => (db.prepare('SELECT COUNT(*) AS c FROM journal_entries WHERE tenant_id = ? AND reference_type = ?').get(t, type) as any).c
    expect(n('SO_COGS')).toBe(2)
    expect(n('SO_COGS_CANCEL')).toBe(2)
  })
})
