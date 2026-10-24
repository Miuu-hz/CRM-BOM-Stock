import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createTestUser } from '../test/testAuth'
import db from '../db/sqlite'
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

  it('deal-timeline ยังเปิดให้ USER ฝ่ายขาย (หน้าขายใช้) แต่ผู้ใช้พื้นฐาน (ไม่มีแผนก) ถูกปิดทั้ง /api/receivables (D2)', async () => {
    const sales = createTestUser({ role: 'USER' })
    db.prepare("UPDATE users SET departments = '[\"SALES\"]' WHERE id = ?").run(sales.userId)
    const res = await request(app).get('/api/receivables/deal-timeline/no-such-so').set('Authorization', `Bearer ${sales.token}`)
    expect(res.status).not.toBe(403)

    const basic = createTestUser({ role: 'USER' })
    const denied = await request(app).get('/api/receivables/deal-timeline/no-such-so').set('Authorization', `Bearer ${basic.token}`)
    expect(denied.status).toBe(403)
    expect(denied.body.code).toBe('BASIC_SCOPE')
  })

  it('ADMIN / MANAGER / POWERUSER → ใช้ได้', async () => {
    for (const role of ['ADMIN', 'MANAGER', 'POWERUSER'] as const) {
      const { token } = createTestUser({ role })
      const res = await request(app).get('/api/receivables/ar-aging').set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
    }
  })
})
