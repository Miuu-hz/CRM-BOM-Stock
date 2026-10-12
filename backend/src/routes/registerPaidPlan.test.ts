import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import authRouter from './auth.routes'

const app = express()
app.use(express.json())
app.use('/api/auth', authRouter)

describe('POST /api/auth/register พร้อมแพ็กเสียเงิน', () => {
  it('แพ็ก/Pack ไม่ถูกต้อง → 400 และไม่บันทึกคำขอสมัคร', async () => {
    const email = `bad-${generateId()}@example.com`
    const res = await request(app).post('/api/auth/register').send({
      businessName: 'ร้าน', adminName: 'คน', email, password: 'password123',
      plan: 'business', cycle: 'monthly', packs: [],  // Business ต้องเลือก 1 Pack
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('ต้องเลือก 1 Pack')
    expect(db.prepare('SELECT COUNT(*) c FROM signup_requests WHERE email = ?').get(email)).toEqual({ c: 0 })
  })
})
