import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import templatesRouter from './templates'
import { createTestUser } from '../../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/quotation-templates', authenticate, templatesRouter)

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
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status, unit_price)
    VALUES (?, ?, ?, ?, ?, 100, 'pcs', 'pcs', 'MAIN', 'ACTIVE', 50)
  `).run(id, tenantId, id, name, category)
  return id
}

function seedTemplate(tenantId: string, productId: string) {
  const templateId = generateId()
  db.prepare(`
    INSERT INTO quotation_templates (id, tenant_id, name, expiration_days, header_text)
    VALUES (?, ?, ?, 30, '')
  `).run(templateId, tenantId, 'เทมเพลตทดสอบ ' + templateId.slice(0, 6))
  db.prepare(`
    INSERT INTO quotation_template_items (id, tenant_id, template_id, product_id, quantity, unit_price, discount_percent, sort_order)
    VALUES (?, ?, ?, ?, 2, 50, 0, 0)
  `).run(generateId(), tenantId, templateId, productId)
  return templateId
}

/**
 * ITEM 3 (ตรวจ 2026-10-05): from-template เดิมใช้ req.body.taxRate ดิบๆ (|| 0) — ขายวัตถุดิบ
 * ก็ยังไม่เคยเช็ค findNonSellableLine มาก่อน (เพิ่งเพิ่มพร้อม VAT_NOT_REGISTERED ในรอบนี้)
 * ยืนยันว่าการ์ดทั้งสองใช้งานได้จริงบน endpoint นี้ด้วย ไม่ใช่แค่ quotations.ts POST
 */
describe('การ์ดขายวัตถุดิบไม่ได้ — POST /quotation-templates/from-template', () => {
  it('template ผูกสินค้าวัตถุดิบ (category=raw) ถูกบล็อก 400 ITEM_NOT_SELLABLE', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const customerId = seedCustomer(u.tenantId)
    const rawId = seedStockItem(u.tenantId, 'raw')
    const templateId = seedTemplate(u.tenantId, rawId)

    const res = await request(app).post('/api/quotation-templates/from-template')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ templateId, customerId })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('ITEM_NOT_SELLABLE')
  })

  it('template ผูกสินค้าสำเร็จรูป (FINISHED) ผ่าน สร้างใบเสนอราคาได้', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const customerId = seedCustomer(u.tenantId)
    const finId = seedStockItem(u.tenantId, 'FINISHED')
    const templateId = seedTemplate(u.tenantId, finId)

    const res = await request(app).post('/api/quotation-templates/from-template')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ templateId, customerId })

    expect(res.status).toBe(201)
  })
})

/**
 * ITEM 3: เดิมโค้ด hardcode taxRate = 7 เสมอ (บั๊ก: บังคับ VAT แม้กิจการไม่จด) ตอนแก้ผ่านมา
 * เปลี่ยนเป็น req.body.taxRate || 0 ดิบๆ (บั๊กใหม่: กิจการจด VAT แล้วไม่ส่ง taxRate มา กลับได้ 0
 * ทั้งที่ควร default 7 เหมือนพฤติกรรมเดิมของกิจการที่จด VAT) แก้ให้ default ตามสถานะจด VAT แล้ว
 */
describe('taxRate default ของ from-template ตามสถานะจด VAT', () => {
  it('จด VAT แล้ว + ไม่ส่ง taxRate มา → default 7 (ไม่ใช่ 0)', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    db.prepare(`INSERT INTO company_settings (tenant_id, name, vat_registered) VALUES (?, 'ทดสอบ', 1)`).run(u.tenantId)
    const customerId = seedCustomer(u.tenantId)
    const finId = seedStockItem(u.tenantId, 'FINISHED')
    const templateId = seedTemplate(u.tenantId, finId)

    const res = await request(app).post('/api/quotation-templates/from-template')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ templateId, customerId })

    expect(res.status).toBe(201)
    expect(res.body.data.tax_rate).toBe(7)
  })

  it('ไม่จด VAT + ไม่ส่ง taxRate มา → default 0 (ไม่ถูกบล็อก VAT_NOT_REGISTERED)', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    db.prepare(`INSERT INTO company_settings (tenant_id, name, vat_registered) VALUES (?, 'ทดสอบ', 0)`).run(u.tenantId)
    const customerId = seedCustomer(u.tenantId)
    const finId = seedStockItem(u.tenantId, 'FINISHED')
    const templateId = seedTemplate(u.tenantId, finId)

    const res = await request(app).post('/api/quotation-templates/from-template')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ templateId, customerId })

    expect(res.status).toBe(201)
    expect(res.body.data.tax_rate).toBe(0)
  })
})
