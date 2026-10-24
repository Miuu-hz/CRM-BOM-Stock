import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import purchaseRouter from './purchase.routes'
import { createTestUser } from '../test/testAuth'
import { createConversion } from '../services/unitConversion.service'
import { createGoodsReceipt, confirmGoodsReceipt, getPendingPoItems } from '../services/goodsReceipt.service'
import { createPurchaseInvoice } from '../services/purchaseBilling.service'

/** ยกเลิก GR / คืนสินค้า — แก้ตามรีวิวบัญชีจัดซื้อ 2026-10-24 */

const app = express()
app.use(express.json())
app.use('/api/purchase', purchaseRouter)

type Line = { qty: number; price: number; unit?: string; skipStock?: boolean; stock?: { baseUnit: string; displayUnit?: string; unitCost?: number } }

function seedPo(tenantId: string, lines: Line[], taxRate = 7) {
  const supplierId = generateId()
  db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name, status) VALUES (?, ?, ?, 'Sup', 'C', 'ACTIVE')").run(supplierId, tenantId, supplierId)
  const poId = generateId()
  db.prepare(`INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, tax_rate) VALUES (?, ?, ?, ?, 'APPROVED', ?)`)
    .run(poId, tenantId, 'PO-' + poId.slice(0, 6), supplierId, taxRate)
  const materialIds: (string | null)[] = []
  const poItemIds: string[] = []
  for (const l of lines) {
    let materialId: string | null = null
    if (!l.skipStock) {
      materialId = generateId()
      const st = l.stock || { baseUnit: 'pcs' }
      db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, sealed_qty, unit, base_unit, display_unit, unit_cost, location, status)
        VALUES (?, ?, ?, ?, 'raw', 0, 0, ?, ?, ?, ?, 'STOCK', 'ACTIVE')`)
        .run(materialId, tenantId, materialId, 'ของ ' + materialId.slice(0, 4), st.baseUnit, st.baseUnit, st.displayUnit ?? null, st.unitCost ?? 10)
    }
    const poItemId = generateId()
    db.prepare(`INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, quantity, unit, unit_price, total_price, received_qty, skip_stock)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`).run(poItemId, tenantId, poId, materialId, materialId ? 'ของ ' + materialId.slice(0, 4) : 'ค่าส่ง',
      l.qty, l.unit || 'pcs', l.price, l.qty * l.price, l.skipStock ? 1 : 0)
    materialIds.push(materialId)
    poItemIds.push(poItemId)
  }
  return { poId, supplierId, materialIds, poItemIds }
}

function receive(tenantId: string, poId: string) {
  const pending = getPendingPoItems(tenantId, poId)
  const gr = createGoodsReceipt(tenantId, 'u@x', {
    purchaseOrderId: poId,
    items: pending.map(p => ({ poItemId: p.id, materialId: p.material_id, orderedQty: p.quantity, receivedQty: p.pending_qty, acceptedQty: p.pending_qty })),
  }) as any
  return confirmGoodsReceipt(tenantId, 'u1', gr.id) as any
}

const cancelGr = (token: string, grId: string) =>
  request(app).put(`/api/purchase/goods-receipts/${grId}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'CANCELLED' })

function balance(tenantId: string, code: string) {
  const r = db.prepare(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS b FROM journal_lines l
    JOIN journal_entries je ON je.id = l.journal_entry_id JOIN accounts a ON a.id = l.account_id
    WHERE je.tenant_id = ? AND a.code = ?`).get(tenantId, code) as any
  return Math.round(r.b * 100) / 100
}
const stock = (id: string | null) => db.prepare('SELECT quantity, sealed_qty, unit_cost FROM stock_items WHERE id = ?').get(id) as any

describe('ยกเลิกใบรับสินค้า', () => {
  it('#4 คืน received_qty ทุกบรรทัด รวมบรรทัดไม่นับสต็อก → PO กลับเป็น APPROVED', async () => {
    const u = createTestUser()
    const { poId, poItemIds } = seedPo(u.tenantId, [{ qty: 2, price: 100 }, { qty: 1, price: 50, skipStock: true }], 0)
    const gr = receive(u.tenantId, poId)
    const res = await cancelGr(u.token, gr.id)
    expect(res.status).toBe(200)
    const rq = poItemIds.map(id => (db.prepare('SELECT received_qty FROM purchase_order_items WHERE id = ?').get(id) as any).received_qty)
    expect(rq).toEqual([0, 0])
    expect((db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(poId) as any).status).toBe('APPROVED')
  })

  it('#5 แพ็คถูกแกะไปแล้ว → หักส่วนที่แกะจาก quantity (เดิมของค้างในคลัง)', async () => {
    const u = createTestUser()
    const { poId, materialIds } = seedPo(u.tenantId, [{ qty: 2, price: 50, unit: 'pack', stock: { baseUnit: 'g', displayUnit: 'pack' } }], 0)
    createConversion(u.tenantId, { material_id: materialIds[0]!, from_unit: 'pack', to_unit: 'g', conversion_factor: 1000 })
    const gr = receive(u.tenantId, poId)
    expect(stock(materialIds[0])).toMatchObject({ quantity: 0, sealed_qty: 2 })
    db.prepare('UPDATE stock_items SET sealed_qty = 1, quantity = 1000 WHERE id = ?').run(materialIds[0]) // แกะไป 1 แพ็ค
    expect((await cancelGr(u.token, gr.id)).status).toBe(200)
    expect(stock(materialIds[0])).toMatchObject({ quantity: 0, sealed_qty: 0 })
  })

  it('#13 คืนต้นทุนต่อหน่วยเดิม ถ้ายังไม่มี GR อื่นมาทับ', async () => {
    const u = createTestUser()
    const { poId, materialIds } = seedPo(u.tenantId, [{ qty: 1, price: 1000, stock: { baseUnit: 'pcs', unitCost: 10 } }], 0)
    const gr = receive(u.tenantId, poId)
    expect(stock(materialIds[0]).unit_cost).toBe(1000)
    expect((await cancelGr(u.token, gr.id)).status).toBe(200)
    expect(stock(materialIds[0]).unit_cost).toBe(10)
  })
})

async function returnFlow(token: string, body: any) {
  const c = await request(app).post('/api/purchase/returns').set('Authorization', `Bearer ${token}`).send(body)
  if (c.status !== 201) return { create: c }
  const id = c.body.data.id
  for (const status of ['SUBMITTED', 'APPROVED']) {
    await request(app).put(`/api/purchase/returns/${id}/status`).set('Authorization', `Bearer ${token}`).send({ status })
  }
  const confirm = await request(app).put(`/api/purchase/returns/${id}/confirm`).set('Authorization', `Bearer ${token}`)
  return { create: c, confirm, id }
}

describe('#9 คืนสินค้า', () => {
  it('คืนก่อนออกใบแจ้งหนี้ → Dr 2109 / Cr สต็อก, ราคาจาก PO, ใบแจ้งหนี้ที่ออกทีหลังคิดเฉพาะที่เหลือ และ 2109 เป็น 0', async () => {
    const u = createTestUser()
    const { poId, materialIds } = seedPo(u.tenantId, [{ qty: 2, price: 100 }], 7)
    const gr = receive(u.tenantId, poId)
    const r = await returnFlow(u.token, { purchaseOrderId: poId, reason: 'ชำรุด', items: [{ materialId: materialIds[0], quantity: 1, unit: 'pcs', unitPrice: 999 }] })
    expect(r.create.body.data).toMatchObject({ subtotal: 100, tax_amount: 7, total_amount: 107, goods_receipt_id: gr.id })
    expect(r.confirm!.status).toBe(200)
    expect(balance(u.tenantId, '2109')).toBe(-100)
    expect(balance(u.tenantId, '1107')).toBe(100)
    expect(balance(u.tenantId, '2101')).toBe(0)
    expect(balance(u.tenantId, '1110')).toBe(0)

    const inv = createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [gr.id], autoPay: false }) as any
    expect(inv.total_amount).toBe(107)
    expect(balance(u.tenantId, '2109')).toBe(0)
    expect(balance(u.tenantId, '1107')).toBe(100)
    expect(stock(materialIds[0]).quantity).toBe(1)
  })

  it('คืนหลังออกใบแจ้งหนี้ ผู้ขายไม่คิด VAT → Dr เจ้าหนี้ / Cr สต็อก ไม่มีภาษีซื้อปลอม', async () => {
    const u = createTestUser()
    const { poId, materialIds } = seedPo(u.tenantId, [{ qty: 2, price: 100 }], 0)
    const gr = receive(u.tenantId, poId)
    createPurchaseInvoice(u.tenantId, u.email, { goodsReceiptIds: [gr.id], autoPay: false })
    const r = await returnFlow(u.token, { purchaseOrderId: poId, reason: 'ชำรุด', items: [{ materialId: materialIds[0], quantity: 1, unit: 'pcs' }] })
    expect(r.confirm!.status).toBe(200)
    expect(balance(u.tenantId, '2101')).toBe(-100)
    expect(balance(u.tenantId, '1107')).toBe(100)
    expect(balance(u.tenantId, '1110')).toBe(0)
    expect((db.prepare("SELECT COUNT(*) c FROM vat_entries WHERE document_id = ?").get(r.id) as any).c).toBe(0)
  })

  it('คืนเกินจำนวนที่รับ → 400', async () => {
    const u = createTestUser()
    const { poId, materialIds } = seedPo(u.tenantId, [{ qty: 2, price: 100 }], 0)
    receive(u.tenantId, poId)
    const r = await returnFlow(u.token, { purchaseOrderId: poId, reason: 'x', items: [{ materialId: materialIds[0], quantity: 3, unit: 'pcs' }] })
    expect(r.create.status).toBe(400)
  })

  it('ยืนยันคืนในงวดที่ปิดแล้ว → 400 สต็อกไม่ขยับ', async () => {
    const u = createTestUser()
    const { poId, materialIds } = seedPo(u.tenantId, [{ qty: 2, price: 100 }], 0)
    receive(u.tenantId, poId)
    const c = await request(app).post('/api/purchase/returns').set('Authorization', `Bearer ${u.token}`)
      .send({ purchaseOrderId: poId, reason: 'x', items: [{ materialId: materialIds[0], quantity: 1, unit: 'pcs' }] })
    const id = c.body.data.id
    db.prepare("UPDATE purchase_returns SET status = 'APPROVED', return_date = '2025-04-02' WHERE id = ?").run(id)
    db.prepare(`INSERT INTO tax_periods (id, tenant_id, year, month, period_type, start_date, end_date, status)
      VALUES (?, ?, 2025, 4, 'MONTHLY', '2025-04-01', '2025-04-30', 'CLOSED')`).run(generateId(), u.tenantId)
    const res = await request(app).put(`/api/purchase/returns/${id}/confirm`).set('Authorization', `Bearer ${u.token}`)
    expect(res.status).toBe(400)
    expect(stock(materialIds[0]).quantity).toBe(2)
  })
})
