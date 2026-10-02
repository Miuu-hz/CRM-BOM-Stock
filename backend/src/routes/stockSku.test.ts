import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import stockRouter from './stock.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/stock', stockRouter)

// รหัสซ้ำเคยตอบ 500 "บันทึกไม่สำเร็จ" ผู้ใช้ไม่รู้ว่าต้องเปลี่ยนรหัส (2026-09-28)
describe('POST /stock — รหัสสินค้าซ้ำ', () => {
  it('ตอบ 409 SKU_DUPLICATE พร้อมชื่อสินค้าที่ใช้รหัสนี้อยู่', async () => {
    const u = createTestUser({ role: 'ADMIN' })
    const body = { sku: 'DUP-001', name: 'น้ำตาล', unit: 'kg', category: 'raw' }
    const first = await request(app).post('/api/stock').set('Authorization', `Bearer ${u.token}`).send(body)
    expect(first.status).toBe(201)
    const again = await request(app).post('/api/stock').set('Authorization', `Bearer ${u.token}`).send({ ...body, name: 'เกลือ' })
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('SKU_DUPLICATE')
    expect(again.body.message).toContain('น้ำตาล')
  })
})
