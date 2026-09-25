import { describe, it, expect, afterEach } from 'vitest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { registerSalesTools } from './sales'
import { registerSalesBillingTools } from './salesBilling'
import type { IMcpServer } from '../sdk-compat'

/**
 * ปลอม IMcpServer แบบขั้นต่ำ — เก็บ handler ของแต่ละ tool ไว้เรียกตรงๆ ในเทสต์
 * โดยไม่ต้องพึ่ง MCP SDK server/transport จริง (registerSalesTools ต้องการแค่ .tool())
 */
function fakeServer(): { server: IMcpServer; tools: Record<string, (args: any) => Promise<any>> } {
  const tools: Record<string, (args: any) => Promise<any>> = {}
  const server: IMcpServer = {
    tool: (name: string, _desc: string, _schema: any, handler: any) => { tools[name] = handler },
    connect: async () => {},
    close: async () => {},
  }
  return { server, tools }
}

function parseOk(res: any): any {
  return JSON.parse(res.content[0].text)
}

const tenants: string[] = []
function setupTenant() {
  const t = 'test_mcp_so_' + generateId()
  tenants.push(t)
  db.prepare('INSERT INTO company_settings (tenant_id, name, allow_negative_stock) VALUES (?, ?, 0)').run(t, 'test')
  return t
}

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM quotation_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM quotations WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_movements WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM approval_requests WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM sales_order_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM sales_orders WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM customers WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM stock_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM document_sequences WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM company_settings WHERE tenant_id = ?').run(t)
  }
})

/**
 * เดิม mcp/tools/sales.ts มีสำเนา deductStockForSO ของตัวเอง ที่หย่อนกว่าของจริงใน
 * routes/sales/shared.ts: เงียบเมื่อแปลงหน่วยไม่ได้ (ใช้เลขดิบข้ามหน่วย), floor() ปัดเศษหาย,
 * MAX(0, ...) เงียบตอนของไม่พอ, ไม่ atomic. ตอนนี้เรียกตัวจริงแล้ว — เทสต์นี้ยืนยันว่า
 * แปลงหน่วยถูกต้องตามอัตราแปลงจริง ไม่ใช่ลอกเลขดิบข้ามหน่วย
 */
describe('ขอบเขตของ MCP ฝั่งขาย — ออกได้แค่ใบเสนอราคา', () => {
  it('ไม่มี tool ที่สร้างใบสั่งขาย/ใบแจ้งหนี้/รับชำระเงินให้ AI เรียกอีกแล้ว', () => {
    const { server, tools } = fakeServer()
    registerSalesTools(server, 'tenant_x', 'user_x', 'ทดสอบ', 'ADMIN')
    registerSalesBillingTools(server, 'tenant_x', 'user_x', 'ทดสอบ', 'ADMIN')
    for (const banned of ['create_sales_order', 'update_sales_order', 'update_sales_order_status',
                          'create_sales_invoice', 'record_customer_payment']) {
      expect(tools[banned], `${banned} ต้องไม่ถูกลงทะเบียน — ขั้นตอนที่ตัดสต็อก/ลงบัญชีต้องทำในระบบเอง`).toBeUndefined()
    }
    expect(tools['create_quotation'], 'ใบเสนอราคาคือทางเดียวที่ AI ขายได้').toBeTypeOf('function')
    expect(tools['get_sales_orders'], 'อ่านยังได้อยู่').toBeTypeOf('function')
  })

  it('สร้างใบเสนอราคาได้ พร้อมสร้างลูกค้าใหม่ให้ถ้ายังไม่มี', async () => {
    const t = setupTenant()
    const { server, tools } = fakeServer()
    registerSalesTools(server, t, 'user_x', 'ทดสอบ', 'ADMIN')

    const res = parseOk(await tools['create_quotation']({
      items: [{ description: 'หมอนหนุน', quantity: 50, unitPrice: 250, unit: 'ใบ' }],
      customer_hint: 'บริษัทเอบีซี',
      tax_rate: 7,
    }))

    expect(res.success).toBe(true)
    expect(res.เลขที่ใบเสนอราคา).toMatch(/^QT/)
    const qt = db.prepare('SELECT * FROM quotations WHERE quotation_number = ? AND tenant_id = ?')
      .get(res.เลขที่ใบเสนอราคา, t) as any
    expect(qt.subtotal).toBe(12500)
    expect(qt.tax_amount).toBe(875)
    expect(qt.total_amount).toBe(13375)
    expect(qt.status, 'ต้องเป็นร่างเสมอ ไม่ผูกพันอะไร').toBe('DRAFT')
    const items = db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ?').all(qt.id) as any[]
    expect(items).toHaveLength(1)
    expect(db.prepare('SELECT name FROM customers WHERE id = ?').get(qt.customer_id) as any).toMatchObject({ name: 'บริษัทเอบีซี' })
  })

  it('กิจการเปิดโหมดราคารวม VAT → ใบเสนอราคาจาก AI ถอดภาษีให้เหมือนกัน', async () => {
    const t = setupTenant()
    db.prepare('UPDATE company_settings SET vat_inclusive = 1 WHERE tenant_id = ?').run(t)
    const { server, tools } = fakeServer()
    registerSalesTools(server, t, 'user_x', 'ทดสอบ', 'ADMIN')

    const res = parseOk(await tools['create_quotation']({
      items: [{ description: 'ของทดสอบ', quantity: 1, unitPrice: 107, unit: 'ชิ้น' }],
      tax_rate: 7,
    }))
    const qt = db.prepare('SELECT * FROM quotations WHERE quotation_number = ? AND tenant_id = ?').get(res.เลขที่ใบเสนอราคา, t) as any
    expect(qt.vat_inclusive).toBe(1)
    expect(qt.total_amount).toBeCloseTo(107, 2)
    expect(qt.tax_amount).toBeCloseTo(7, 2)
  })
})
