import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import summaryRouter from './summary.routes'
import { createTestUser } from '../../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/sales/summary', authenticate, summaryRouter)

const tenants: string[] = []

afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['receipts', 'invoices', 'delivery_orders', 'sales_orders', 'quotations', 'credit_notes', 'customers', 'users']) {
      db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t)
    }
  }
})

// ใบเสนอราคา → ใบสั่งขาย → ใบส่งของ → ใบแจ้งหนี้ → ใบเสร็จ อย่างละใบ เวลาห่างกันทีละชั่วโมง
function seedDeal(tenantId: string) {
  const at = (h: number) => new Date(Date.UTC(2026, 0, 1, h)).toISOString()
  const customerId = generateId()
  db.prepare(`INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, tenant_id) VALUES (?, ?, 'ลูกค้าฟีด', 'RETAIL', 'x', 'x@example.com', '0800000000', 'BKK', ?)`)
    .run(customerId, 'CUS-' + customerId.slice(0, 8), tenantId)

  const qtId = generateId(), soId = generateId(), doId = generateId(), invId = generateId(), rcId = generateId()
  db.prepare(`INSERT INTO quotations (id, tenant_id, quotation_number, customer_id, total_amount, status, created_at, updated_at)
              VALUES (?, ?, 'QT-FEED', ?, 100, 'SENT', ?, ?)`).run(qtId, tenantId, customerId, at(1), at(1))
  db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, total_amount, status, created_at, updated_at)
              VALUES (?, ?, 'SO-FEED', ?, 100, 'CONFIRMED', ?, ?)`).run(soId, tenantId, customerId, at(2), at(2))
  db.prepare(`INSERT INTO delivery_orders (id, tenant_id, do_number, sales_order_id, customer_id, status, created_at, updated_at)
              VALUES (?, ?, 'DO-FEED', ?, ?, 'DELIVERED', ?, ?)`).run(doId, tenantId, soId, customerId, at(3), at(3))
  db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, total_amount, paid_amount, balance_amount, status, payment_status, created_at, updated_at)
              VALUES (?, ?, 'INV-FEED', ?, ?, 100, 100, 0, 'ISSUED', 'PAID', ?, ?)`).run(invId, tenantId, soId, customerId, at(4), at(4))
  db.prepare(`INSERT INTO receipts (id, tenant_id, receipt_number, invoice_id, customer_id, amount, payment_method, created_at, updated_at)
              VALUES (?, ?, 'RC-FEED', ?, ?, 100, 'CASH', ?, ?)`).run(rcId, tenantId, invId, customerId, at(5), at(5))

  return { qtId, soId, doId, invId, rcId }
}

describe('GET /api/sales/summary — ฟีดความเคลื่อนไหวของเอกสารขาย', () => {
  it('รวมเอกสารครบทุกชนิด เรียงใหม่สุดขึ้นก่อน และผูกคู่กรณีเป็นชื่อลูกค้า', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    seedDeal(user.tenantId)

    const res = await request(app).get('/api/sales/summary').set('Authorization', `Bearer ${user.token}`)
    expect(res.status).toBe(200)

    const feed = res.body.data.recentActivity as any[]
    expect(feed.map(a => a.kind)).toEqual(['RC', 'INV', 'DO', 'SO', 'QT'])
    expect(feed.map(a => a.doc)).toEqual(['RC-FEED', 'INV-FEED', 'DO-FEED', 'SO-FEED', 'QT-FEED'])
    expect(new Set(feed.map(a => a.party))).toEqual(new Set(['ลูกค้าฟีด']))
    // ใบส่งของไม่มียอดเงินของตัวเอง ห้ามหยิบยอดของ SO มาแปะ
    expect(feed.find(a => a.kind === 'DO').amount).toBeNull()
  })

  it('ใบเสร็จชี้ open_id กลับไปที่ใบแจ้งหนี้ต้นทาง (ใบเสร็จไม่มีหน้าของตัวเอง)', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const { invId } = seedDeal(user.tenantId)

    const res = await request(app).get('/api/sales/summary').set('Authorization', `Bearer ${user.token}`)
    const rc = (res.body.data.recentActivity as any[]).find(a => a.kind === 'RC')
    expect(rc.open_id).toBe(invId)
    expect(rc.id).not.toBe(invId)
  })

  it('ไม่ข้ามเขต tenant', async () => {
    const mine = createTestUser({ role: 'ADMIN' })
    const other = createTestUser({ role: 'ADMIN' })
    tenants.push(mine.tenantId, other.tenantId)
    seedDeal(other.tenantId)

    const res = await request(app).get('/api/sales/summary').set('Authorization', `Bearer ${mine.token}`)
    expect(res.body.data.recentActivity).toEqual([])
  })
})
