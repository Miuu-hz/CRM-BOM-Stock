import { describe, it, expect, afterEach } from 'vitest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { createDeliveryOrderForSO, soStockAlreadyDeducted, deductStockForSO } from './shared'

// tenant ทิ้ง สร้างใหม่ทุกเคสแล้วลบใน afterEach
const tenants: string[] = []
function setupTenant() {
  const t = 'test_do_' + generateId()
  tenants.push(t)
  db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock) VALUES (?, ?, 1)').run(t, 'test')
  return t
}

function addSO(tenantId: string, status = 'CONFIRMED') {
  const custId = generateId()
  db.prepare(`INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, address, city, status)
              VALUES (?, ?, ?, 'ลูกค้าเทสต์', 'RETAIL', '-', '-', '-', '99 ถนนทดสอบ', '-', 'ACTIVE')`).run(custId, tenantId, custId)
  const soId = generateId()
  db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, order_date, subtotal, total_amount, status)
              VALUES (?, ?, ?, ?, date('now'), 100, 100, ?)`).run(soId, tenantId, 'SO-' + soId.slice(0, 6), custId, status)
  return { soId, soNumber: db.prepare('SELECT so_number FROM sales_orders WHERE id = ?').get(soId) as any }
}

function addStockItem(tenantId: string, qty: number) {
  const id = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
              VALUES (?, ?, ?, 'สินค้าเทสต์', 'FINISHED', ?, 'pcs', 'pcs', 'MAIN', 'ACTIVE')`).run(id, tenantId, id, qty)
  return id
}

function addSOLine(tenantId: string, soId: string, stockItemId: string, qty: number, deliveredQty = 0) {
  const id = generateId()
  db.prepare(`INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_name, quantity, delivered_qty, unit_price, total_price, unit)
              VALUES (?, ?, ?, ?, 'สินค้าเทสต์', ?, ?, 100, 100, 'pcs')`).run(id, tenantId, soId, stockItemId, qty, deliveredQty)
  return id
}

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM delivery_order_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM delivery_orders WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_movements WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM sales_order_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM sales_orders WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM customers WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM document_sequences WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM company_settings WHERE tenant_id = ?').run(t)
  }
})

describe('ออกใบส่งของอัตโนมัติตอนคำสั่งขายเป็น "ส่งของแล้ว"', () => {
  it('ได้ใบส่งของ 1 ใบ สถานะ SHIPPED พร้อมของที่ค้างส่งครบ', () => {
    const t = setupTenant()
    const { soId } = addSO(t)
    addSOLine(t, soId, addStockItem(t, 50), 10)
    addSOLine(t, soId, addStockItem(t, 50), 4)

    const result = createDeliveryOrderForSO(t, soId, { createdBy: 'u1' })
    expect(result).not.toBeNull()

    const dos = db.prepare('SELECT * FROM delivery_orders WHERE tenant_id = ?').all(t) as any[]
    expect(dos).toHaveLength(1)
    expect(dos[0].status, 'ต้องเป็น SHIPPED ไม่ใช่ DELIVERED ไม่งั้นจะตัดสต็อกซ้ำ').toBe('SHIPPED')
    expect(dos[0].sales_order_id).toBe(soId)
    expect(dos[0].delivery_address, 'ดึงที่อยู่ลูกค้ามาให้').toBe('99 ถนนทดสอบ')

    const items = db.prepare('SELECT * FROM delivery_order_items WHERE delivery_order_id = ?').all(dos[0].id) as any[]
    expect(items.map(i => i.quantity).sort((a, b) => a - b)).toEqual([4, 10])
    // ตัวสินค้าตามไปจากแถวขาย ไม่ใช่จาก product_id (ว่างเกือบทุกแถวในฐานจริง)
    const linked = items.map(i => db.prepare('SELECT stock_item_id FROM sales_order_items WHERE id = ?').get(i.sales_order_item_id) as any)
    expect(linked.every(l => !!l?.stock_item_id), 'ต้องตามกลับไปหาสินค้าในคลังได้ทุกแถว').toBe(true)
  })

  it('เรียกซ้ำไม่ออกใบที่สอง (กดสถานะซ้ำ / DELIVERED แล้ว COMPLETED)', () => {
    const t = setupTenant()
    const { soId } = addSO(t)
    addSOLine(t, soId, addStockItem(t, 50), 10)

    expect(createDeliveryOrderForSO(t, soId)).not.toBeNull()
    expect(createDeliveryOrderForSO(t, soId), 'ครั้งที่สองต้องคืน null').toBeNull()
    const n = db.prepare('SELECT COUNT(*) c FROM delivery_orders WHERE tenant_id = ?').get(t) as any
    expect(n.c).toBe(1)
  })

  it('ส่งครบแล้วไม่ต้องออกใบเปล่า', () => {
    const t = setupTenant()
    const { soId } = addSO(t)
    addSOLine(t, soId, addStockItem(t, 50), 10, 10)

    expect(createDeliveryOrderForSO(t, soId)).toBeNull()
    const n = db.prepare('SELECT COUNT(*) c FROM delivery_orders WHERE tenant_id = ?').get(t) as any
    expect(n.c).toBe(0)
  })

  it('เอาเฉพาะของที่ยังค้าง ไม่ใช่จำนวนเต็มของบิล', () => {
    const t = setupTenant()
    const { soId } = addSO(t)
    addSOLine(t, soId, addStockItem(t, 50), 10, 4)

    createDeliveryOrderForSO(t, soId)
    const item = db.prepare('SELECT quantity FROM delivery_order_items WHERE tenant_id = ?').get(t) as any
    expect(item.quantity).toBe(6)
  })

  it('ใบที่ถูกยกเลิกไปแล้วไม่นับ ออกใบใหม่ได้', () => {
    const t = setupTenant()
    const { soId } = addSO(t)
    addSOLine(t, soId, addStockItem(t, 50), 10)

    const first = createDeliveryOrderForSO(t, soId)!
    db.prepare("UPDATE delivery_orders SET status = 'CANCELLED' WHERE id = ?").run(first.id)
    expect(createDeliveryOrderForSO(t, soId)).not.toBeNull()
  })
})

describe('การ์ดกันตัดสต็อกซ้ำ', () => {
  it('SO ที่ยืนยันแล้วถือว่าตัดสต็อกไปแล้ว', () => {
    const t = setupTenant()
    const { soId } = addSO(t)
    const stockId = addStockItem(t, 50)
    addSOLine(t, soId, stockId, 10)
    const so = db.prepare('SELECT so_number FROM sales_orders WHERE id = ?').get(soId) as any

    expect(soStockAlreadyDeducted(t, so.so_number), 'ก่อนยืนยันยังไม่ตัด').toBe(false)
    deductStockForSO(t, soId, so.so_number)
    expect(soStockAlreadyDeducted(t, so.so_number), 'หลังยืนยันต้องรู้ว่าตัดแล้ว').toBe(true)

    const stock = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(stockId) as any
    expect(stock.quantity, 'ตัดครั้งเดียว 50 - 10').toBe(40)
  })

  it('SO คนละใบไม่ปนกัน', () => {
    const t = setupTenant()
    const { soId } = addSO(t)
    addSOLine(t, soId, addStockItem(t, 50), 10)
    const so = db.prepare('SELECT so_number FROM sales_orders WHERE id = ?').get(soId) as any
    deductStockForSO(t, soId, so.so_number)

    expect(soStockAlreadyDeducted(t, 'SO-ไม่มีจริง')).toBe(false)
  })
})
