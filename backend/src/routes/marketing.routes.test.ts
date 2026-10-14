import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import marketingRouter from './marketing.routes'
import { createTestUser } from '../test/testAuth'
import db from '../db/sqlite'

// ============================================================
// บั๊กใหม่ (review item E): end_month=2026-13 ผ่าน regex /^\d{4}-\d{2}$/ (เช็คแค่จำนวนหลัก ไม่เช็คช่วง
// เดือน 01-12) แล้วเดือนเกินขอบถูก Date คำนวณ roll ไปปี/เดือนถัดไปเงียบ ๆ (2026-13 → 2027-01)
// ============================================================

const app = express()
app.use(express.json())
app.use('/api/marketing', marketingRouter)

describe('GET /marketing/platform-dashboard — ตรวจสอบสิทธิ์และการเข้าถึง (RBAC)', () => {
  it('ผู้ใช้ที่ไม่มีสิทธิ์การตลาด (เช่น แผนก PRODUCTION) ต้องได้รับ 403 Forbidden', async () => {
    const user = createTestUser({ role: 'USER' })
    db.prepare('UPDATE users SET departments = ? WHERE id = ?').run(JSON.stringify(['PRODUCTION']), user.userId)

    const res = await request(app)
      .get('/api/marketing/platform-dashboard/shops')
      .set('Authorization', 'Bearer ' + user.token)

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/ไม่มีสิทธิ์เข้าถึง/)
  })

  it('ผู้ใช้ฝ่ายการตลาด (แผนก MARKETING) ต้องผ่านการตรวจสอบสิทธิ์ (ได้รับ 200)', async () => {
    const user = createTestUser({ role: 'USER' })
    db.prepare('UPDATE users SET departments = ? WHERE id = ?').run(JSON.stringify(['MARKETING']), user.userId)

    const res = await request(app)
      .get('/api/marketing/platform-dashboard/shops')
      .set('Authorization', 'Bearer ' + user.token)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

describe('GET /marketing/platform-dashboard — ตรวจ end_month เดือนต้องอยู่ 01-12', () => {
  it('end_month=2026-13 (เดือนเกินขอบ) ต้องถูกปฏิเสธ 400 ไม่ roll ไปปีถัดไปเงียบ ๆ', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const res = await request(app)
      .get('/api/marketing/platform-dashboard')
      .query({ platform: 'SHOPEE', shop_key: 'ร้านหลัก', end_month: '2026-13', range: 1 })
      .set('Authorization', 'Bearer ' + user.token)
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/end_month/)
  })

  it('end_month=2026-00 (เดือน 0) ต้องถูกปฏิเสธ 400 ด้วย', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const res = await request(app)
      .get('/api/marketing/platform-dashboard')
      .query({ platform: 'SHOPEE', shop_key: 'ร้านหลัก', end_month: '2026-00', range: 1 })
      .set('Authorization', 'Bearer ' + user.token)
    expect(res.status).toBe(400)
  })

  it('end_month=2026-12 (ขอบบนที่ถูกต้อง) ต้องผ่านการตรวจรูปแบบ (ไม่ตอบ 400 จากเหตุ end_month)', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    const res = await request(app)
      .get('/api/marketing/platform-dashboard')
      .query({ platform: 'SHOPEE', shop_key: 'ร้านหลัก', end_month: '2026-12', range: 1 })
      .set('Authorization', 'Bearer ' + user.token)
    // ไม่มีข้อมูลร้านนี้จริง — แค่ยืนยันว่าไม่ได้ถูกปฏิเสธเพราะ end_month (ไม่ควรเจอ 400 "end_month ต้องเป็นรูปแบบ")
    if (res.status === 400) expect(res.body.message).not.toMatch(/end_month/)
  })
})
