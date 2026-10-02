import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import journalRouter from '../routes/journal.routes'
import posBillRouter from '../routes/pos-bill.routes'
import { createTestUser } from '../test/testAuth'
import { isCashierOnly, cashierAllowed } from './cashierScope'

// ตรวจสิทธิ์ 2026-09-29: เดิมไม่มี route ไหนตรวจแผนก — แคชเชียร์/พนักงานทั่วไปลงสมุดรายวันได้
const app = express()
app.use(express.json())
app.use('/api/journal', journalRouter)
app.use('/api/pos', posBillRouter)

const withDepts = (depts: string[], role: any = 'USER') => {
  const u = createTestUser({ role })
  db.prepare('UPDATE users SET departments = ? WHERE id = ?').run(JSON.stringify(depts), u.userId)
  return u
}

describe('cashierScope', () => {
  it('แคชเชียร์ = แผนก POS แผนกเดียว และไม่ใช่ Admin', () => {
    expect(isCashierOnly('USER', ['POS'])).toBe(true)
    expect(isCashierOnly('USER', ['POS', 'SALES'])).toBe(false)
    expect(isCashierOnly('ADMIN', ['POS'])).toBe(false)
    expect(isCashierOnly('USER', [])).toBe(false)
  })
  it('อนุญาตงานหน้าร้าน ห้ามงานอื่น', () => {
    expect(cashierAllowed('POST', '/api/pos/bills/abc/pay')).toBe(true)
    expect(cashierAllowed('GET', '/api/settings/company?x=1')).toBe(true)
    expect(cashierAllowed('POST', '/api/pos/clearing/transfer')).toBe(false)
    expect(cashierAllowed('POST', '/api/purchase/orders')).toBe(false)
    expect(cashierAllowed('GET', '/api/reports/profit-loss')).toBe(false)
    expect(cashierAllowed('PUT', '/api/settings/company')).toBe(false)
  })
})

describe('ล็อกผ่าน authenticate จริง', () => {
  it('แคชเชียร์เรียก API นอกหน้าร้านได้ 403 CASHIER_SCOPE แต่ใช้ POS ได้', async () => {
    const c = withDepts(['POS'])
    const j = await request(app).get('/api/journal').set('Authorization', `Bearer ${c.token}`)
    expect(j.status).toBe(403)
    expect(j.body.code).toBe('CASHIER_SCOPE')
    const p = await request(app).get('/api/pos/bills/open').set('Authorization', `Bearer ${c.token}`)
    expect(p.status).not.toBe(403)
  })

  it('สมุดรายวัน: ผู้ใช้ทั่วไปดูได้ แต่ลงรายการไม่ได้ · แผนกบัญชีลงได้', async () => {
    const plain = withDepts(['SALES'])
    expect((await request(app).get('/api/journal').set('Authorization', `Bearer ${plain.token}`)).status).toBe(200)
    const denied = await request(app).post('/api/journal').set('Authorization', `Bearer ${plain.token}`).send({})
    expect(denied.status).toBe(403)

    const acc = withDepts(['ACCOUNTING'])
    const ok = await request(app).post('/api/journal').set('Authorization', `Bearer ${acc.token}`).send({})
    expect(ok.status).not.toBe(403) // ผ่านด่านสิทธิ์แล้ว (body ว่างจะโดน validation เป็น 400)
  })
})
