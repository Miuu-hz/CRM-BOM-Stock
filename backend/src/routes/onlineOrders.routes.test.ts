import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { piiDb, upsertOrderPii, deleteTenantPii } from '../db/piiConnection'
import { generateId } from '../utils/id'
import { createTestUser } from '../test/testAuth'
import platformSettlementRouter from './platformSettlement.routes'
import masterRouter from './master.routes'
import { submitOnlineOrders } from '../services/onlineOrders.service'

const app = express()
app.use(express.json())
app.use('/api/platform-settlement', platformSettlementRouter)
app.use('/api/master', masterRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    deleteTenantPii(t)
    for (const tbl of [
      'online_order_lines',
      'online_orders',
      'online_import_batches',
      'online_return_events',
      'stock_movements',
      'platform_sku_proposals',
      'stock_item_aliases',
      'stock_items',
      'platform_months',
      'platform_fee_mappings',
      'users',
    ]) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch {}
    }
  }
})

describe('platformSettlement.routes — online-orders + requireRole on GET + purge PII', () => {
  it('requireRole: role USER ถูกบล็อก 403 บนทุก GET route (ทั้งเดิมและใหม่)', async () => {
    const u = createTestUser({ role: 'USER' })
    tenants.push(u.tenantId)
    const auth = { Authorization: `Bearer ${u.token}` }

    const paths = [
      '/api/platform-settlement/months',
      '/api/platform-settlement/months/fake-id/mapping',
      '/api/platform-settlement/months/fake-id/posting-preview',
      '/api/platform-settlement/fee-mappings',
      '/api/platform-settlement/online-orders/summary?groupBy=province',
      '/api/platform-settlement/online-orders/list',
      '/api/platform-settlement/online-orders/unlinked',
      '/api/platform-settlement/online-orders/returns',
      '/api/platform-settlement/online-orders/unattributed-returns?platform=SHOPEE&shopKey=bebozch&month=2026-10',
    ]

    for (const p of paths) {
      const res = await request(app).get(p).set(auth)
      expect(res.status, p).toBe(403)
    }
  })

  it('endpoint เก่า GET / ถูกลบแล้ว (404)', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    tenants.push(admin.tenantId)
    const res = await request(app)
      .get('/api/platform-settlement/')
      .set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(404)
  })

  it('GET /online-orders/list และ /summary คืนเฉพาะค่ามาสก์ ไม่มี PII ดิบ', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    tenants.push(admin.tenantId)
    const auth = { Authorization: `Bearer ${admin.token}` }

    submitOnlineOrders(admin.tenantId, {
      platform: 'SHOPEE',
      shopKey: 'bebozch',
      rows: [
        {
          orderNo: 'REST-001',
          orderTime: '2026-10-15 14:30',
          status: 'สำเร็จ',
          buyerName: 'ธัชพงษ์',
          buyerPhone: '081-234-5678',
          fullAddress: 'เลขที่ 858/7 หมู่ที่ 4 จังหวัดชัยภูมิ 36000',
          province: 'ชัยภูมิ',
          district: 'เมืองชัยภูมิ',
          postalCode: '36000',
          productName: 'หมอน',
          qty: 2,
          netPrice: 500,
        },
      ],
    })

    const listRes = await request(app).get('/api/platform-settlement/online-orders/list').set(auth)
    expect(listRes.status).toBe(200)
    expect(listRes.body.success).toBe(true)
    const listText = JSON.stringify(listRes.body)
    expect(listText).not.toContain('ธัชพงษ์')
    expect(listText).not.toContain('081-234-5678')
    expect(listText).not.toContain('858/7')
    expect(listRes.body.data.items[0].buyerNameMasked).toBe('ธัชพxxx')
    expect(listRes.body.data.items[0].buyerPhoneMasked).toBe('081-234-5xxx')

    const sumRes = await request(app)
      .get('/api/platform-settlement/online-orders/summary?from=2026-10-01&to=2026-10-31&groupBy=province')
      .set(auth)
    expect(sumRes.status).toBe(200)
    expect(sumRes.body.data).toHaveLength(1)
    expect(sumRes.body.data[0]).toMatchObject({ key: 'ชัยภูมิ', orders: 1, sales: 500, netSales: 500 })
  })

  it('DELETE /api/master/tenant/:tenantId/purge เรียก deleteTenantPii ลบ PII ของเทแนนต์นั้นออกจาก pii.db', async () => {
    const master = createTestUser({ role: 'MASTER' })
    tenants.push(master.tenantId)
    const targetTenant = 'test_purge_' + generateId()
    const otherTenant = 'test_keep_' + generateId()
    tenants.push(targetTenant, otherTenant)

    upsertOrderPii([
      { tenantId: targetTenant, platform: 'SHOPEE', shopKey: 'bebozch', orderNo: 'P-1', buyerName: 'ธัชพงษ์', buyerPhone: '081-234-5678' },
      { tenantId: otherTenant, platform: 'SHOPEE', shopKey: 'bebozch', orderNo: 'K-1', buyerName: 'ทีปกร', buyerPhone: '089-111-2222' },
    ])

    const res = await request(app)
      .delete(`/api/master/tenant/${targetTenant}/purge`)
      .set('Authorization', `Bearer ${master.token}`)
    expect(res.status).toBe(200)

    const leftTarget = piiDb.prepare('SELECT COUNT(*) AS c FROM online_order_pii WHERE tenant_id = ?').get(targetTenant) as any
    const leftOther = piiDb.prepare('SELECT COUNT(*) AS c FROM online_order_pii WHERE tenant_id = ?').get(otherTenant) as any
    expect(leftTarget.c).toBe(0)
    expect(leftOther.c).toBe(1)
  })

  it('Finding 5: POST /online-orders/mapping/confirm ปฏิเสธ factor <= 0 หรือไม่ใช่ตัวเลข (400) และ /returns/restock ปฏิเสธ ids ที่ไม่ใช่ string[] ไม่ว่าง (400)', async () => {
    const admin = createTestUser({ role: 'ADMIN' })
    tenants.push(admin.tenantId)
    const auth = { Authorization: `Bearer ${admin.token}` }

    const stockId = generateId()
    db.prepare(`
      INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, base_unit, unit_cost, location, status)
      VALUES (?, ?, 'SKU-R5', 'สินค้าทดสอบ', 'FINISHED', 10, 'pcs', 'pcs', 50, 'WH1', 'ACTIVE')
    `).run(stockId, admin.tenantId)

    for (const badFactor of [-1, 0, 'abc', null]) {
      const res = await request(app)
        .post('/api/platform-settlement/online-orders/mapping/confirm')
        .set(auth)
        .send({ sourceRef: 'SHOPEE:V1', stockItemId: stockId, factor: badFactor })
      expect(res.status, `factor=${String(badFactor)}`).toBe(400)
    }

    for (const badIds of [[], 'not-array', [123], [''], [null], ['ok', 42]]) {
      const res = await request(app)
        .post('/api/platform-settlement/online-orders/returns/restock')
        .set(auth)
        .send({ ids: badIds })
      expect(res.status, `ids=${JSON.stringify(badIds)}`).toBe(400)
    }
  })
})
