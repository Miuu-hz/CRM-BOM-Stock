import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import stockRouter from './stock.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/stock', stockRouter)

// เดิม alias ใช้ requireRole('ADMIN','MASTER','MANAGER') ซึ่งเทียบ role ตรงตัว
// POWERUSER ที่สร้าง/แก้สินค้าได้ กลับผูกชื่อเรียกแทนไม่ได้ (403) — ตอนนี้สิทธิ์เท่ากับ POST/PUT /stock
describe('ชื่อเรียกแทน SKU — สิทธิ์เขียนเท่ากับสร้างสินค้า', () => {
  it('POWERUSER เพิ่มและลบชื่อเรียกแทนได้', async () => {
    const u = createTestUser({ role: 'POWERUSER' })
    const auth = `Bearer ${u.token}`
    const item = await request(app).post('/api/stock').set('Authorization', auth)
      .send({ sku: 'AL-001', name: 'น้ำปลาตรา A', unit: 'bottle', category: 'raw' })
    expect(item.status).toBe(201)

    const saved = await request(app).post('/api/stock/aliases').set('Authorization', auth)
      .send({ name: 'น้ำปลาตรา B', stockItemId: item.body.data.id })
    expect(saved.status).toBe(200)
    const alias = (saved.body.data as any[]).find(a => a.name === 'น้ำปลาตรา B')
    expect(alias).toBeTruthy()

    const del = await request(app).delete(`/api/stock/aliases/${alias.id}`).set('Authorization', auth)
    expect(del.status).toBe(200)
  })

  it('ลบชื่อเรียกแทนของร้านอื่นไม่ได้ (404)', async () => {
    const a = createTestUser({ role: 'ADMIN' })
    const item = await request(app).post('/api/stock').set('Authorization', `Bearer ${a.token}`)
      .send({ sku: 'AL-002', name: 'ซีอิ๊วตรา A', unit: 'bottle', category: 'raw' })
    const saved = await request(app).post('/api/stock/aliases').set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'ซีอิ๊วตรา B', stockItemId: item.body.data.id })
    const aliasId = saved.body.data[0].id

    const other = createTestUser({ role: 'POWERUSER' })
    const del = await request(app).delete(`/api/stock/aliases/${aliasId}`).set('Authorization', `Bearer ${other.token}`)
    expect(del.status).toBe(404)
  })
})
