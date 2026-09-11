import { describe, it, expect, afterEach } from 'vitest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { deductStockForSO, restoreStockForSO } from './shared'
import { SERVICE_CATEGORY, isServiceItem } from '../../services/stockItem.service'

// เทสต์ยิงใส่ dev.db ตัวจริง — ใช้ tenant ทิ้งแล้วลบทุกครั้ง
const tenants: string[] = []
function setupTenant() {
  const t = 'test_svc_' + generateId()
  tenants.push(t)
  // allow_negative_stock = 0 คือค่าของ tenant โรงงานหมอนจริง — เคสที่ทำให้บิลยืนยันไม่ผ่าน
  db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock) VALUES (?, ?, 0)').run(t, 'test')
  return t
}
function addItem(tenantId: string, category: string, unit: string) {
  const id = generateId()
  db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status)
              VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'MAIN', 'ACTIVE')`).run(id, tenantId, id, 'x', category, unit, unit)
  return id
}
// sales_order_items ผูก FK ไป sales_orders -> customers จึงต้องสร้างครบสาย
function addSalesOrder(tenantId: string) {
  const custId = generateId()
  db.prepare(`INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, status)
              VALUES (?, ?, ?, 'test', 'RETAIL', '-', '-', '-', '-', 'ACTIVE')`).run(custId, tenantId, custId)
  const soId = generateId()
  db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, order_date, subtotal, total_amount, status)
              VALUES (?, ?, ?, ?, date('now'), 100, 100, 'DRAFT')`).run(soId, tenantId, soId, custId)
  return soId
}
function addSOLine(tenantId: string, soId: string, stockItemId: string, unit: string) {
  db.prepare(`INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_name, quantity, unit_price, total_price, unit)
              VALUES (?, ?, ?, ?, 'x', 1, 100, 100, ?)`).run(generateId(), tenantId, soId, stockItemId, unit)
}
afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM stock_movements WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM sales_order_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM sales_orders WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM customers WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM company_settings WHERE tenant_id = ?').run(t)
  }
})

describe('รายการบริการ (ค่าขนส่ง/ค่าแพ็ค) ต้องไม่ถูกตัดสต็อก', () => {
  it('ยืนยันบิลที่มีค่าขนส่งผ่านได้ ทั้งที่สต็อก 0 และห้ามติดลบ', () => {
    const t = setupTenant()
    const soId = addSalesOrder(t)
    addSOLine(t, soId, addItem(t, SERVICE_CATEGORY, 'rob'), 'rob')

    expect(() => deductStockForSO(t, soId, 'SO-TEST-1')).not.toThrow()
    const moves = db.prepare('SELECT COUNT(*) c FROM stock_movements WHERE tenant_id = ?').get(t) as any
    expect(moves.c, 'ไม่ควรมี stock_movements ของรายการบริการ').toBe(0)
    const item = db.prepare('SELECT quantity FROM stock_items WHERE tenant_id = ?').get(t) as any
    expect(item.quantity).toBe(0)
  })

  it('ยกเลิกบิลแล้วไม่คืนสต็อกให้รายการบริการ (ไม่งั้นจะงอกของจากอากาศ)', () => {
    const t = setupTenant()
    const soId = addSalesOrder(t)
    addSOLine(t, soId, addItem(t, SERVICE_CATEGORY, 'rob'), 'rob')

    deductStockForSO(t, soId, 'SO-TEST-2')
    restoreStockForSO(t, soId, 'SO-TEST-2')
    const item = db.prepare('SELECT quantity FROM stock_items WHERE tenant_id = ?').get(t) as any
    expect(item.quantity, 'สต็อกต้องอยู่ที่ 0 ไม่ใช่ +1').toBe(0)
  })

  it('สินค้าจริงยังถูกบล็อกเหมือนเดิม — guard ต้องไม่เผลอปิดการเช็คสต็อกทั้งระบบ', () => {
    const t = setupTenant()
    const soId = addSalesOrder(t)
    addSOLine(t, soId, addItem(t, 'FINISHED', 'pcs'), 'pcs')

    expect(() => deductStockForSO(t, soId, 'SO-TEST-3')).toThrow(/Insufficient stock/)
  })

  it('isServiceItem อ่านหมวดแบบไม่สนตัวพิมพ์และช่องว่าง', () => {
    expect(isServiceItem({ category: 'SERVICE' })).toBe(true)
    expect(isServiceItem({ category: ' service ' })).toBe(true)
    expect(isServiceItem({ category: 'FINISHED' })).toBe(false)
    expect(isServiceItem({ category: null })).toBe(false)
    expect(isServiceItem(null)).toBe(false)
  })
})
