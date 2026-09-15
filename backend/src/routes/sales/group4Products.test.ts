import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import salesRouter from './index'
import { createTestUser } from '../../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/sales', authenticate, salesRouter)

/**
 * กลุ่ม 4 ของการเลิกใช้ตาราง `products`: 3 จุดที่ยัง LEFT JOIN products อยู่
 * ทั้ง 3 จุดพิสูจน์ด้วยข้อมูลจริงบนเครื่องไม่ได้ เพราะตารางต้นทางว่างเปล่าทั้งหมด
 *   pos_daily_sales_bills = 0 แถว · quotation_template_items = 0 · product_variants = 0
 * เทสต์นี้จึง seed ข้อมูลเองเพื่อพิสูจน์ว่า **ถ้ามีข้อมูลจริงเมื่อไหร่ ชื่อ/หมวดจะไม่เป็น null**
 */
function mkStockItem(tenantId: string, name: string, category = 'finished') {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
    VALUES (?, ?, ?, ?, ?, 10, 'pcs', 'pcs', 'STOCK', 'ACTIVE')
  `).run(id, tenantId, 'SKU-' + id.slice(0, 8), name, category)
  return id
}

describe('เลิกใช้ตาราง products — 3 จุดที่ตารางยังว่างอยู่ (กลุ่ม 4)', () => {
  it('รายงานยอดขายรายวัน: หมวดสินค้าต้องมาจาก stock_items ไม่ใช่ null', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const stockId = mkStockItem(user.tenantId, 'กาแฟเย็นทดสอบ', 'DRINK')

    const menuId = generateId()
    db.prepare(`INSERT INTO pos_menu_configs (id, tenant_id, product_id, pos_price, is_available, is_pos_enabled)
      VALUES (?, ?, ?, 50, 1, 1)`).run(menuId, user.tenantId, stockId)

    const billId = generateId()
    db.prepare(`INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, total_amount)
      VALUES (?, ?, ?, 'โต๊ะ 1', 'PAID', 50)`).run(billId, user.tenantId, 'POS-TEST-' + billId.slice(0, 6))
    db.prepare(`INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name, quantity, unit_price, total_price)
      VALUES (?, ?, ?, ?, 'กาแฟเย็นทดสอบ', 1, 50, 50)`).run(generateId(), user.tenantId, billId, menuId)

    const dsId = generateId()
    db.prepare(`INSERT INTO pos_daily_sales (id, tenant_id, summary_number, sales_date, total_revenue, bill_count)
      VALUES (?, ?, ?, '20260915', 50, 1)`).run(dsId, user.tenantId, 'SUM-TEST-' + dsId.slice(0, 6))
    db.prepare(`INSERT INTO pos_daily_sales_bills (id, tenant_id, daily_sales_id, bill_id, amount)
      VALUES (?, ?, ?, ?, 50)`).run(generateId(), user.tenantId, dsId, billId)

    const res = await request(app).get(`/api/sales/pos-daily-sales/${dsId}`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(200)
    const products = res.body.data.products
    expect(products).toHaveLength(1)
    expect(products[0].product_name).toBe('กาแฟเย็นทดสอบ')
    expect(products[0].product_category).toBe('DRINK')   // เดิมเป็น null เพราะ join products
  })

  it('เทมเพลตใบเสนอราคา: ชื่อ/รหัสสินค้าในรายการต้องไม่เป็น null', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const stockId = mkStockItem(user.tenantId, 'สินค้าในเทมเพลต')

    const tplId = generateId()
    db.prepare(`INSERT INTO quotation_templates (id, tenant_id, name, expiration_days)
      VALUES (?, ?, 'เทมเพลตทดสอบ', 30)`).run(tplId, user.tenantId)
    db.prepare(`INSERT INTO quotation_template_items (id, tenant_id, template_id, product_id, quantity, unit_price, sort_order)
      VALUES (?, ?, ?, ?, 2, 100, 1)`).run(generateId(), user.tenantId, tplId, stockId)

    const res = await request(app).get(`/api/sales/quotation-templates/${tplId}`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.items[0].product_name).toBe('สินค้าในเทมเพลต')
    expect(res.body.data.items[0].product_code).toBeTruthy()
  })

  it('ตัวเลือกสินค้า (variants): ชื่อสินค้าแม่ต้องไม่เป็น null', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const stockId = mkStockItem(user.tenantId, 'เสื้อยืดทดสอบ')

    db.prepare(`INSERT INTO product_variants (id, tenant_id, product_id, sku, variant_name, attributes, unit_price)
      VALUES (?, ?, ?, ?, 'ไซส์ M', '{"size":"M"}', 120)`)
      .run(generateId(), user.tenantId, stockId, 'VAR-' + stockId.slice(0, 8))

    const res = await request(app).get('/api/sales/product-variants')
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(200)
    const mine = (res.body.data as any[]).filter(v => v.product_id === stockId)
    expect(mine).toHaveLength(1)
    expect(mine[0].product_name).toBe('เสื้อยืดทดสอบ')
  })
})
