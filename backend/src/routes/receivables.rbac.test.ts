import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createTestUser } from '../test/testAuth'
import receivablesRouter from './receivables.routes'

const app = express()
app.use(express.json())
app.use('/api/receivables', receivablesRouter)

// ยอดหนี้ลูกค้า/ผู้ขายทั้งบริษัท — เมนูซ่อนจาก USER แล้ว API ต้องปิดด้วย ไม่งั้นเรียกตรงก็เห็น
describe('/api/receivables สิทธิ์ตาม role', () => {
  it('USER → 403', async () => {
    const { token } = createTestUser({ role: 'USER' })
    for (const path of ['ar-aging', 'ap-aging', 'collections']) {
      const res = await request(app).get(`/api/receivables/${path}`).set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(403)
    }
  })

  it('deal-timeline ยังเปิดให้ USER (หน้าขายใช้)', async () => {
    const { token } = createTestUser({ role: 'USER' })
    const res = await request(app).get('/api/receivables/deal-timeline/no-such-so').set('Authorization', `Bearer ${token}`)
    expect(res.status).not.toBe(403)
  })

  it('ADMIN / MANAGER / POWERUSER → ใช้ได้', async () => {
    for (const role of ['ADMIN', 'MANAGER', 'POWERUSER'] as const) {
      const { token } = createTestUser({ role })
      const res = await request(app).get('/api/receivables/ar-aging').set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
    }
  })
})
