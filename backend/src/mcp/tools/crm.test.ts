import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { registerCrmTools } from './crm'
import type { IMcpServer } from '../sdk-compat'

function fakeServer() {
  const tools: Record<string, (args: any) => Promise<any>> = {}
  const schemas: Record<string, any> = {}
  const server: IMcpServer = {
    tool: (name: string, _desc: string, schema: any, handler: any) => { tools[name] = handler; schemas[name] = schema },
    connect: async () => {},
    close: async () => {},
  }
  // ตรวจ args ผ่าน zod schema จริงก่อนเรียก handler (เรียกตรงๆ จะข้าม validation ไป)
  const valid = (name: string, args: any) => z.object(schemas[name]).safeParse(args).success
  return { server, tools, valid }
}

const parseOk = (res: any) => JSON.parse(res.content[0].text)

const tenants: string[] = []
function setupTenant() {
  const t = 'test_crm_' + generateId()
  tenants.push(t)
  return t
}

afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of [
      'customer_recommendations', 'activity_logs', 'invoice_items', 'invoices',
      'quotations', 'sales_orders', 'pos_running_bills', 'customers',
    ]) {
      db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t)
    }
  }
})

function addCustomer(t: string, name: string, daysAgoCreated = 0) {
  const id = generateId()
  db.prepare(`INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, address, status, created_at)
              VALUES (?, ?, ?, ?, 'COMPANY', '-', '-', '0800000000', '-', '-', 'ACTIVE', ?)`)
    .run(id, t, 'C' + id.slice(0, 6), name, new Date(Date.now() - daysAgoCreated * 86_400_000).toISOString())
  return id
}

function addInvoice(t: string, customerId: string, total: number, daysAgo: number, status = 'ISSUED', paymentStatus = 'PAID') {
  const so = generateId()
  const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString()
  // created_at ของ SO ต้องย้อนวันตามใบแจ้งหนี้ด้วย ไม่งั้นนับเป็นกิจกรรม "วันนี้" ปนเข้ามา (SO นี้สร้างแค่เพื่อผ่าน FK)
  db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(so, t, 'SO-' + so.slice(0, 8), customerId, date)
  const invId = generateId()
  db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, invoice_date, created_at,
                total_amount, paid_amount, balance_amount, status, payment_status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
    .run(invId, t, 'INV-' + invId.slice(0, 8), so, customerId, date, date, total, total, status, paymentStatus)
  return invId
}

function addActivityLog(t: string, customerId: string, daysAgo: number) {
  db.prepare(`INSERT INTO activity_logs (id, customer_id, type, note, tenant_id, created_at)
              VALUES (?, ?, 'CALL', 'โทรคุยงาน', ?, ?)`)
    .run(generateId(), customerId, t, new Date(Date.now() - daysAgo * 86_400_000).toISOString())
}

function addQuotation(t: string, customerId: string, status: string, total: number, daysAgoDate: number, expiryDaysFromNow: number | null) {
  const id = generateId()
  const date = new Date(Date.now() - daysAgoDate * 86_400_000).toISOString()
  const expiry = expiryDaysFromNow === null ? null : new Date(Date.now() + expiryDaysFromNow * 86_400_000).toISOString()
  db.prepare(`INSERT INTO quotations (id, tenant_id, quotation_number, customer_id, quotation_date, expiry_date, total_amount, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, t, 'QT-' + id.slice(0, 8), customerId, date, expiry, total, status)
  return id
}

describe('get_customer_insights mode=dormant', () => {
  it('หาลูกค้าเงียบ (ไม่เคยมีกิจกรรม / เงียบนานกว่า days) และไม่รวมลูกค้าที่ยังเคลื่อนไหวอยู่', async () => {
    const t = setupTenant()
    const neverActive = addCustomer(t, 'ลูกค้าไม่เคยซื้อ')
    const staleActive = addCustomer(t, 'ลูกค้าเงียบนาน')
    addInvoice(t, staleActive, 1000, 60) // 60 วันก่อน — เกิน 30 วัน
    const freshActive = addCustomer(t, 'ลูกค้าขยัน')
    addInvoice(t, freshActive, 500, 5) // 5 วันก่อน — ไม่เงียบ

    const { server, tools, valid } = fakeServer()
    registerCrmTools(server, t)
    expect(valid('get_customer_insights', { mode: 'dormant', days: 30 })).toBe(true)
    const res = parseOk(await tools['get_customer_insights']({ mode: 'dormant', days: 30 }))

    const names = res.customers.map((c: any) => c.name)
    expect(names).toContain('ลูกค้าไม่เคยซื้อ')
    expect(names).toContain('ลูกค้าเงียบนาน')
    expect(names).not.toContain('ลูกค้าขยัน')

    // ไม่เคยมีกิจกรรมเลย = เงียบที่สุด ต้องมาก่อน
    expect(res.customers[0].name).toBe('ลูกค้าไม่เคยซื้อ')
    expect(res.customers[0].days_silent).toBeNull()
    const stale = res.customers.find((c: any) => c.name === 'ลูกค้าเงียบนาน')
    expect(stale.days_silent).toBeGreaterThanOrEqual(60)
    // SO กับใบแจ้งหนี้ถูกสร้างเวลาเดียวกันในเทสต์นี้ (SO สร้างแค่เพื่อผ่าน FK) — ทั้งสองนับเป็นกิจกรรมที่ถูกต้อง
    expect(['ใบแจ้งหนี้', 'ใบสั่งขาย']).toContain(stale.last_activity_kind)
    expect(stale.lifetime_spend).toBe(1000)
  })
})

describe('get_quotations', () => {
  it('default (open=DRAFT+SENT, เดือนนี้) นับยอดรวม/จำนวนถูกต้อง และกรองเดือน/สถานะอื่นออก', async () => {
    const t = setupTenant()
    const cust = addCustomer(t, 'บริษัททดสอบ')
    addQuotation(t, cust, 'DRAFT', 100, 1, 3)   // เดือนนี้, open, หมดอายุใน 3 วัน → เข้า + expiring
    addQuotation(t, cust, 'SENT', 200, 2, 20)   // เดือนนี้, open, ยังไม่ใกล้หมดอายุ
    addQuotation(t, cust, 'ACCEPTED', 999, 1, 10) // เดือนนี้ แต่ไม่ใช่ open → ไม่นับ
    addQuotation(t, cust, 'SENT', 888, 45, 5)   // เดือนก่อน → ไม่นับเพราะ filter เดือนนี้

    const { server, tools, valid } = fakeServer()
    registerCrmTools(server, t)
    expect(valid('get_quotations', {})).toBe(true)
    const res = parseOk(await tools['get_quotations']({}))

    expect(res.totals.count).toBe(2)
    expect(res.totals.sum_total_amount).toBe(300)
    expect(res.totals.expiring_within_7_days).toBe(1)
    expect(res.quotations.map((q: any) => q.total_amount).sort()).toEqual([100, 200])
  })

  it('month=all รวมทุกเดือน, status=ACCEPTED กรองเฉพาะสถานะนั้น', async () => {
    const t = setupTenant()
    const cust = addCustomer(t, 'บริษัททดสอบ2')
    addQuotation(t, cust, 'ACCEPTED', 50, 1, null)
    addQuotation(t, cust, 'ACCEPTED', 70, 90, null) // เก่ามาก แต่ month=all ต้องเจอ
    addQuotation(t, cust, 'SENT', 999, 1, null)

    const { server, tools } = fakeServer()
    registerCrmTools(server, t)
    const res = parseOk(await tools['get_quotations']({ status: 'ACCEPTED', month: 'all' }))
    expect(res.totals.count).toBe(2)
    expect(res.totals.sum_total_amount).toBe(120)
  })
})

describe('tenant isolation', () => {
  it('ข้อมูลของ tenant B ต้องไม่โผล่ในผลลัพธ์ของ tenant A ทั้ง dormant/profile/quotations', async () => {
    const tA = setupTenant()
    const tB = setupTenant()

    const custA = addCustomer(tA, 'ลูกค้า A เงียบ')
    const custB = addCustomer(tB, 'ลูกค้า B เงียบ')
    // ทั้งคู่ไม่มีกิจกรรมเลย → เงียบทั้งคู่ แต่คนละ tenant
    addQuotation(tA, custA, 'SENT', 111, 1, 5)
    addQuotation(tB, custB, 'SENT', 222, 1, 5)
    addActivityLog(tA, custA, 1)
    addActivityLog(tB, custB, 1)

    const { server: serverA, tools: toolsA } = fakeServer()
    registerCrmTools(serverA, tA)
    const dormantA = parseOk(await toolsA['get_customer_insights']({ mode: 'dormant', days: 30 }))
    expect(dormantA.customers.map((c: any) => c.name)).not.toContain('ลูกค้า B เงียบ')

    const quotA = parseOk(await toolsA['get_quotations']({}))
    expect(quotA.quotations.map((q: any) => q.total_amount)).not.toContain(222)
    expect(quotA.quotations.map((q: any) => q.total_amount)).toContain(111)

    const profileA = parseOk(await toolsA['get_customer_insights']({ mode: 'profile', customer: 'ลูกค้า B เงียบ' }))
    expect(profileA.error).toBeDefined() // ชื่อของ tenant อื่นต้องหาไม่เจอใน tenant A
  })
})

describe('get_customer_insights mode=profile', () => {
  it('สรุปข้อมูลลูกค้ารายเดียวถูกต้อง: ยอดสะสม, ค้างชำระ, กิจกรรมล่าสุด', async () => {
    const t = setupTenant()
    const cust = addCustomer(t, 'บริษัท โปรไฟล์ จำกัด')
    addInvoice(t, cust, 1000, 10, 'ISSUED', 'PAID')
    addInvoice(t, cust, 500, 5, 'ISSUED', 'UNPAID')
    addActivityLog(t, cust, 2)

    const { server, tools } = fakeServer()
    registerCrmTools(server, t)
    const res = parseOk(await tools['get_customer_insights']({ mode: 'profile', customer: 'บริษัท โปรไฟล์ จำกัด' }))

    expect(res.contact.name).toBe('บริษัท โปรไฟล์ จำกัด')
    expect(res.lifetime_spend).toBe(1500)
    expect(res.outstanding_balance).toBe(500)
    expect(res.recent_activity.length).toBe(1)
  })

  it('ชื่อกำกวม (เจอหลายคน) ต้องคืน candidates ไม่เดาให้', async () => {
    const t = setupTenant()
    addCustomer(t, 'ร้านสมชาย 1')
    addCustomer(t, 'ร้านสมชาย 2')

    const { server, tools } = fakeServer()
    registerCrmTools(server, t)
    const res = parseOk(await tools['get_customer_insights']({ mode: 'profile', customer: 'สมชาย' }))
    expect(res.ambiguous).toBe(true)
    expect(res.candidates.length).toBe(2)
  })
})
