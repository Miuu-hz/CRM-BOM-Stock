import { describe, it, expect, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import settingsRouter from './settings.routes'
import salesRouter from './sales/index'
import { createTestUser } from '../test/testAuth'
import { generateId } from '../utils/id'
import { lineBotService } from '../services/line-bot.service'

/**
 * 2026-10-23 เจ้าของสั่ง: อัตรา VAT ให้ admin ตั้งที่ Settings > บิล/VAT · คนอื่นแก้แท็บนี้ได้เมื่อ admin มอบสิทธิ์
 * settings:write ผ่านระบบสิทธิ์เดิม (แก้ได้เฉพาะช่องในแท็บนี้) · เอกสารขายรับ VAT แค่ 0 หรืออัตราที่ตั้งไว้
 * · แจ้งค่าใช้จ่ายปิดกะเข้ากลุ่ม LINE ได้ถ้าเปิดไว้
 */
const app = express()
app.use(express.json())
app.use('/api/settings', settingsRouter)
app.use('/api/sales', salesRouter)

const tenants: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const t of tenants.splice(0)) {
    for (const table of ['sales_order_items', 'sales_orders', 'customers', 'stock_items', 'document_sequences', 'company_settings', 'tenant_subscriptions', 'users']) {
      try { db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(t) } catch { /* ตารางไม่มีคอลัมน์นี้ */ }
    }
  }
})

function admin() {
  const u = createTestUser({ role: 'ADMIN' })
  tenants.push(u.tenantId)
  db.prepare('INSERT INTO company_settings (tenant_id, name, vat_registered) VALUES (?, ?, 1)').run(u.tenantId, 'ร้านทดสอบ')
  return u
}

function managerOf(tenantId: string, customPermissions?: Record<string, boolean>) {
  const m = createTestUser({ role: 'MANAGER', tenantId })
  db.prepare('UPDATE users SET departments = ?, custom_permissions = ? WHERE id = ?')
    .run(JSON.stringify(['SALES']), customPermissions ? JSON.stringify(customPermissions) : null, m.userId)
  return m
}

const put = (token: string, body: any) => request(app).put('/api/settings/company').set('Authorization', 'Bearer ' + token).send(body)

describe('PUT /settings/company — แท็บ บิล/VAT ตามสิทธิ์', () => {
  it('MANAGER ที่ไม่ได้รับสิทธิ์ → 403 และ can_edit_billing = false', async () => {
    const a = admin()
    const m = managerOf(a.tenantId)
    expect((await put(m.token, { pos_vat_rate: 10 })).status).toBe(403)
    const me = await request(app).get('/api/settings/company').set('Authorization', 'Bearer ' + m.token)
    expect(me.body.data.can_edit_billing).toBe(false)
  })

  it('MANAGER ที่ admin ให้ settings:write → แก้ VAT ได้ แต่แก้ช่องอื่นของบริษัทไม่ได้', async () => {
    const a = admin()
    const m = managerOf(a.tenantId, { 'settings:write': true })
    const me = await request(app).get('/api/settings/company').set('Authorization', 'Bearer ' + m.token)
    expect(me.body.data.can_edit_billing).toBe(true)

    expect((await put(m.token, { pos_vat_enabled: true, pos_vat_rate: 10, pos_vat_inclusive: false, pos_service_enabled: false, pos_service_rate: 10 })).status).toBe(200)
    expect((db.prepare('SELECT pos_vat_rate FROM company_settings WHERE tenant_id = ?').get(a.tenantId) as any).pos_vat_rate).toBe(10)

    expect((await put(m.token, { name: 'เปลี่ยนชื่อร้าน' })).status).toBe(403)
    expect((await put(m.token, { pos_vat_rate: 7, line_shift_expense_groups: true })).status).toBe(403)
  })

  it.each([0, -7, 50, 'abc'])('อัตรา VAT %s → 400', async (rate) => {
    const a = admin()
    expect((await put(a.token, { pos_vat_rate: rate })).status).toBe(400)
  })
})

describe('เอกสารขายรับ VAT แค่ 0 หรืออัตราที่กิจการตั้ง', () => {
  it('ตั้ง 10% → SO taxRate 10 ผ่าน, 7 ไม่ผ่าน (ข้อความบอกอัตราที่ใช้ได้)', async () => {
    const a = admin()
    expect((await put(a.token, { pos_vat_rate: 10 })).status).toBe(200)
    const customerId = generateId()
    db.prepare(`INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, tenant_id) VALUES (?, ?, 'ลูกค้า', 'RETAIL', 'x', 'x@example.com', '0800000000', 'BKK', ?)`)
      .run(customerId, 'C-' + customerId.slice(0, 6), a.tenantId)
    const stockId = generateId()
    db.prepare(`INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, location, status, unit_cost, unit_price)
      VALUES (?, ?, ?, 'สินค้า', 'FINISHED', 100, 'pcs', 'pcs', 'MAIN', 'ACTIVE', 60, 100)`).run(stockId, a.tenantId, 'SKU-' + stockId.slice(0, 6))
    const so = (taxRate: number) => request(app).post('/api/sales/sales-orders').set('Authorization', 'Bearer ' + a.token)
      .send({ customerId, items: [{ productId: stockId, productName: 'สินค้า', quantity: 1, unit: 'pcs', unitPrice: 100 }], taxRate })

    expect((await so(10)).status).toBe(201)
    const bad = await so(7)
    expect(bad.status).toBe(400)
    expect(bad.body.message).toContain('10%')
    expect((await so(0)).status).toBe(201)
  })
})

describe('แจ้งค่าใช้จ่ายปิดกะเข้ากลุ่ม LINE', () => {
  async function run(groupsOn: boolean) {
    const a = admin()
    if (groupsOn) expect((await put(a.token, { line_shift_expense_groups: true })).status).toBe(200)
    const push = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(lineBotService as any, 'getClient').mockReturnValue({ pushMessage: push })
    vi.spyOn(lineBotService as any, 'adminLineUsers').mockReturnValue([{ line_user_id: 'U-admin' }])
    const groups = vi.spyOn(lineBotService, 'pushToAllGroups').mockResolvedValue(undefined)
    await lineBotService.notifyShiftExpenses(a.tenantId, { shiftNumber: 'SH-1', expenses: [{ reason: 'น้ำแข็ง', amount: 50 }] })
    return { push, groups }
  }

  it('ปิดอยู่ (ค่าตั้งต้น) → ส่งรายคนอย่างเดียว', async () => {
    const { push, groups } = await run(false)
    expect(push).toHaveBeenCalledWith('U-admin', expect.anything())
    expect(groups).not.toHaveBeenCalled()
  })

  it('เปิด → ส่งรายคนและเข้ากลุ่ม', async () => {
    const { push, groups } = await run(true)
    expect(push).toHaveBeenCalled()
    expect(groups).toHaveBeenCalledTimes(1)
  })
})
