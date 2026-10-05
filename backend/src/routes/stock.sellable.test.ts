import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import stockRouter from './stock.routes'
import { createTestUser } from '../test/testAuth'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/stock', stockRouter)
  return app
}

const app = buildApp()

function seedStockItem(tenantId: string, category: string) {
  const id = generateId()
  db.prepare(`
    INSERT INTO stock_items (id, tenant_id, sku, name, category, quantity, unit, location, status)
    VALUES (?, ?, ?, 'สินค้าทดสอบ sellable', ?, 10, 'pcs', 'MAIN', 'ACTIVE')
  `).run(id, tenantId, id, category)
  return id
}

/**
 * ITEM 7 (ตรวจ 2026-10-05): GET /api/stock?sellable=1 ใหม่ — กรองด้วย
 * UPPER(TRIM(si.category)) IN (SELLABLE_CATEGORIES) ต้องไม่สนตัวพิมพ์เล็กใหญ่ของค่าที่เก็บจริง
 * (ข้อมูลเก่าบางแถวเป็น lowercase) และไม่มี param ต้องเหมือนพฤติกรรมเดิม (คืนของดิบด้วย)
 */
describe('GET /api/stock?sellable=1', () => {
  it('กรองเฉพาะ FINISHED/WIP/SERVICE แบบไม่สนตัวพิมพ์เล็กใหญ่ (wip, SERVICE ผ่าน, raw ไม่ผ่าน)', async () => {
    const { tenantId, token } = createTestUser()
    const rawId = seedStockItem(tenantId, 'raw')
    const wipId = seedStockItem(tenantId, 'wip')
    const serviceId = seedStockItem(tenantId, 'SERVICE')
    const finishedId = seedStockItem(tenantId, 'FINISHED')

    const res = await request(app).get('/api/stock?sellable=1')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.map((i: any) => i.id)
    expect(ids).toContain(wipId)
    expect(ids).toContain(serviceId)
    expect(ids).toContain(finishedId)
    expect(ids).not.toContain(rawId)
  })

  it('ไม่ระบุ sellable → คืนของดิบ (raw) ด้วยเหมือนพฤติกรรมเดิม', async () => {
    const { tenantId, token } = createTestUser()
    const rawId = seedStockItem(tenantId, 'raw')
    const finishedId = seedStockItem(tenantId, 'FINISHED')

    const res = await request(app).get('/api/stock')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.map((i: any) => i.id)
    expect(ids).toContain(rawId)
    expect(ids).toContain(finishedId)
  })
})
