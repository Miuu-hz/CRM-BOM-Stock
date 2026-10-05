import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import quotationsRouter from './quotations'
import { createTestUser } from '../../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/quotations', authenticate, quotationsRouter)

function seedCustomer(tenantId: string) {
  const customerId = generateId()
  db.prepare(`
    INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, tenant_id)
    VALUES (?, ?, 'ลูกค้าทดสอบ', 'RETAIL', 'x', 'x@example.com', '0800000000', 'BKK', ?)
  `).run(customerId, 'CUS-' + customerId.slice(0, 8), tenantId)
  return customerId
}

function seedStockItem(tenantId: string, category: string, name = 'สินค้าทดสอบ sellable') {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
    VALUES (?, ?, ?, ?, ?, 100, 'pcs', 'pcs', 'MAIN', 'ACTIVE')
  `).run(id, tenantId, id, name, category)
  return id
}

function seedDraftQT(tenantId: string, customerId: string) {
  const id = generateId()
  db.prepare(`
    INSERT INTO quotations (id, tenant_id, quotation_number, customer_id, total_amount, status)
    VALUES (?, ?, ?, ?, 1000, 'DRAFT')
  `).run(id, tenantId, 'QT-TEST-' + id.slice(0, 8), customerId)
  return id
}

/**
 * ตรวจ 2026-10-05: ขายวัตถุดิบไม่ได้ทุกช่องทาง (เจ้าของยืนยัน) ต้องครอบทั้ง POST และ PUT
 * ของใบเสนอราคา ไม่ใช่แค่ฝั่ง SO — findNonSellableLine ตัวเดียวกับ shared.ts
 */
describe('การ์ดขายวัตถุดิบไม่ได้ — QT POST/PUT', () => {
  it('POST /quotations ขายวัตถุดิบ (category=raw) ถูกบล็อก 400 ITEM_NOT_SELLABLE', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const customerId = seedCustomer(u.tenantId)
    const rawId = seedStockItem(u.tenantId, 'raw')

    const res = await request(app).post('/api/quotations')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ customerId, items: [{ productId: rawId, productName: 'ของดิบ', quantity: 1, unitPrice: 10, unit: 'pcs' }] })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('ITEM_NOT_SELLABLE')
  })

  it('POST /quotations ขายสินค้าสำเร็จรูป (FINISHED) ผ่าน', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const customerId = seedCustomer(u.tenantId)
    const finId = seedStockItem(u.tenantId, 'FINISHED')

    const res = await request(app).post('/api/quotations')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ customerId, items: [{ productId: finId, productName: 'ของสำเร็จ', quantity: 1, unitPrice: 10, unit: 'pcs' }] })

    expect(res.status).toBe(201)
  })

  it('POST /quotations บรรทัดไม่ผูกสินค้า (free text) ผ่านได้เสมอ', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const customerId = seedCustomer(u.tenantId)

    const res = await request(app).post('/api/quotations')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ customerId, items: [{ productName: 'ค่าแรงติดตั้ง', quantity: 1, unitPrice: 500 }] })

    expect(res.status).toBe(201)
  })

  it('PUT /quotations/:id (DRAFT) เปลี่ยนรายการเป็นวัตถุดิบ ถูกบล็อก 400 ITEM_NOT_SELLABLE', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const customerId = seedCustomer(u.tenantId)
    const qtId = seedDraftQT(u.tenantId, customerId)
    const rawId = seedStockItem(u.tenantId, 'raw')

    const res = await request(app).put(`/api/quotations/${qtId}`)
      .set('Authorization', `Bearer ${u.token}`)
      .send({ items: [{ productId: rawId, productName: 'ของดิบ', quantity: 1, unitPrice: 10, unit: 'pcs' }] })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('ITEM_NOT_SELLABLE')
  })
})

/**
 * ITEM 2 (แก้ 2026-10-05): formatDocumentNumber('QT', ...) เดิมถูกเรียกก่อนเข้า db.transaction
 * (บรรทัด ~86 เทียบกับ insert ~98) — ถ้า insert ล้มเหลวทีหลัง (เช่น FK ลูกค้าไม่มีจริง) ตัวนับ
 * document_sequences ขยับไปแล้วและไม่ย้อนกลับ เสียเลขเปล่าๆ ย้ายเข้าไปในทรานแซกชันเดียวกับ
 * insert แล้ว (เหมือน salesOrders.ts/templates.ts) — ตอนนี้ rollback พร้อมกันทั้งคู่
 */
describe('เลขที่เอกสารไม่เสียถ้า insert ล้มเหลว (numbering rollback) — QT', () => {
  it('customerId ไม่มีจริง → FK พังตอน insert, ตัวนับ document_sequences QUOTATION ไม่ขยับ', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const before = (db.prepare(
      "SELECT COALESCE(MAX(last_number),0) n FROM document_sequences WHERE tenant_id = ? AND doc_type = 'QUOTATION'"
    ).get(u.tenantId) as any).n

    const res = await request(app).post('/api/quotations')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ customerId: 'ไม่มีจริง-' + generateId(), items: [{ productName: 'ของ', quantity: 1, unitPrice: 10 }] })

    expect(res.status).toBe(500)

    const after = (db.prepare(
      "SELECT COALESCE(MAX(last_number),0) n FROM document_sequences WHERE tenant_id = ? AND doc_type = 'QUOTATION'"
    ).get(u.tenantId) as any).n
    expect(after, 'เลขต้องไม่ขยับเมื่อ insert ล้มเหลว').toBe(before)
  })
})
