import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { getSubscription } from '../services/subscription.service'
import authRouter from './auth.routes'

const app = express()
app.set('trust proxy', 1)  // แยก IP ต่อคำขอ (ค่าเดียวกับ index.ts) ไม่ให้ชน limiter 5 ครั้ง/ชม.
app.use(express.json())
let ip = 0
const register = (b: object) => request(app).post('/api/auth/register').set('X-Forwarded-For', `10.9.0.${++ip}`).send(b)
app.use('/api/auth', authRouter)

const body = (over: Record<string, unknown> = {}) => ({
  businessName: 'ร้านทดสอบ', adminName: 'เจ้าของ', email: `su-${generateId()}@example.com`, password: 'password123', phone: '0800000000', ...over,
})
const userOf = (email: unknown) => db.prepare('SELECT tenant_id, role FROM users WHERE email = ?').get(email) as any

describe('POST /api/auth/register — สมัครแล้วใช้ได้เลย ไม่ต้องรอ MASTER', () => {
  it('แพ็ก/Pack ไม่ถูกต้อง → 400 ไม่สร้างอะไร', async () => {
    const b = body({ plan: 'business', cycle: 'monthly', packs: ['shop'] })  // Business ต้องเลือก 2 Pack
    const res = await register(b)
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('ต้องเลือก 2 Pack')
    expect(userOf(b.email)).toBeUndefined()
  })

  it('Free → เปิดบริษัททันที เป็น ADMIN แพ็ก Free ไม่หมดอายุ', async () => {
    const b = body()
    const res = await register(b)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ activated: true, plan: 'free', trialDays: 0 })
    const u = userOf(b.email)
    expect(u.role).toBe('ADMIN')
    expect(getSubscription(u.tenant_id)).toMatchObject({ status: 'FREE', planCode: 'free', currentPeriodEnd: null })
    const sr = db.prepare('SELECT status, reviewed_by, phone, tenant_id FROM signup_requests WHERE email = ?').get(b.email) as any
    expect(sr).toEqual({ status: 'approved', reviewed_by: 'self', phone: '0800000000', tenant_id: u.tenant_id })
  })

  it('แพ็กเสียเงิน → ทดลองแพ็กนั้น + Pack ที่เลือก 30 วัน', async () => {
    const b = body({ plan: 'business', cycle: 'yearly', packs: ['shop', 'accounting'] })
    const res = await register(b)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ activated: true, plan: 'business', trialDays: 30 })
    const s = getSubscription(userOf(b.email).tenant_id)
    expect(s.status).toBe('TRIAL')
    expect(s.planCode).toBe('business')
    expect(s.packs).toEqual(['shop', 'accounting'])
    const days = (new Date(s.currentPeriodEnd!).getTime() - Date.now()) / 86400000
    expect(days).toBeGreaterThan(29.9)
    expect(days).toBeLessThan(30.1)
  })

  it('ส่ง Add-on มาทาง API ตอนสมัคร → ทดลองไม่ได้ Add-on ฟรี', async () => {
    const b = body({ plan: 'enterprise_ai', cycle: 'monthly', addons: { extra_users: 100 } })
    const res = await register(b)
    expect(res.status).toBe(200)
    const s = getSubscription(userOf(b.email).tenant_id)
    expect(s.addons).toEqual({})
    expect(s.maxUsers).toBe(20)
  })

  it('ชื่อไม่ใช่ข้อความ / ยาวเกิน → 400', async () => {
    for (const over of [{ businessName: { $gt: '' } }, { adminName: 'ก'.repeat(101) }, { password: 'x'.repeat(129) }]) {
      const b = body(over)
      const res = await register(b)
      expect(res.status).toBe(400)
      expect(userOf(b.email)).toBeUndefined()
    }
  })

  it('อีเมลซ้ำ → 409', async () => {
    const b = body()
    await register(b)
    const res = await register({ ...b, businessName: 'อีกร้าน' })
    expect(res.status).toBe(409)
  })
})
