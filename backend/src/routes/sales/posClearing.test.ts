import { describe, it, expect, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import posRouter from './pos.routes'
import { createTestUser } from '../../test/testAuth'
import { postJournal, JournalError, getOrCreateAccount } from '../../services/accounting.service'
import { ACC } from '../../config/accountCodes'

const app = express()
app.use(express.json())
app.use('/api/sales', authenticate, posRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_lines', 'journal_entries', 'pos_payments', 'pos_bill_items',
                       'pos_running_bills', 'pos_shifts', 'accounts', 'users', 'document_sequences']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* ตารางไม่มีคอลัมน์ tenant_id ก็ข้าม */ }
    }
  }
})

/** ยอดรวมของบัญชีหนึ่งใน tenant — เดบิตลบเครดิต (บัญชีพักต้องกลับเป็นศูนย์) */
function balanceOf(tenantId: string, code: string) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS bal
    FROM journal_lines l JOIN accounts a ON a.id = l.account_id
    WHERE l.tenant_id = ? AND a.code = ?
  `).get(tenantId, code) as any
  return Math.round((row.bal || 0) * 100) / 100
}

/** เปิดกะ + บิลที่จ่ายแล้ว พร้อมลง Dr 1180 เหมือนที่ฝั่งขายทำตอนปิดบิล */
function seedShift(tenantId: string, bills: { amount: number; method: string }[]) {
  const shiftId = generateId()
  const openedAt = new Date(Date.now() - 3600_000).toISOString()
  db.prepare(`INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, opening_cash, opened_by)
              VALUES (?, ?, 'SH-TEST', 'OPEN', ?, 500, 'tester')`).run(shiftId, tenantId, openedAt)

  for (const b of bills) {
    const billId = generateId()
    db.prepare(`INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, total_amount, subtotal, shift_id, closed_at)
                VALUES (?, ?, ?, 'โต๊ะ 1', 'PAID', ?, ?, ?, ?)`)
      .run(billId, tenantId, 'B-' + billId.slice(0, 6), b.amount, b.amount, shiftId, new Date().toISOString())
    db.prepare(`INSERT INTO pos_payments (id, tenant_id, bill_id, payment_method, amount, received_by, paid_at)
                VALUES (?, ?, ?, ?, ?, 'tester', ?)`)
      .run(generateId(), tenantId, billId, b.method, b.amount, new Date().toISOString())

    // ฝั่งขายลงบัญชีพักไว้ตอนปิดบิล — จำลองให้เหมือนของจริง
    postJournal({
      tenantId, date: new Date().toISOString().slice(0, 10),
      referenceType: 'POS_SALE', referenceId: billId, description: 'ขายหน้าร้าน',
      lines: [
        { code: ACC.POS_CLEARING, debit: b.amount },
        { code: ACC.REVENUE_PRODUCT, credit: b.amount },
      ],
    })
  }
  return shiftId
}

describe('postJournal — ประตูกลางลงสมุดรายวัน', () => {
  it('ไม่ดุลต้องโยน ห้ามปล่อยลงฐานข้อมูล', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    expect(() => postJournal({
      tenantId: user.tenantId, date: '2026-09-19', referenceType: 'TEST', description: 'ไม่ดุล',
      lines: [{ code: ACC.CASH, debit: 100 }, { code: ACC.REVENUE_PRODUCT, credit: 90 }],
    })).toThrow(JournalError)
    const n = db.prepare('SELECT COUNT(*) c FROM journal_entries WHERE tenant_id = ?').get(user.tenantId) as any
    expect(n.c, 'รายการที่ไม่ดุลต้องไม่ถูกบันทึกเลย').toBe(0)
  })

  it('บรรทัดยอดศูนย์ถูกตัดทิ้ง ไม่ทำให้ดุลพัง', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const id = postJournal({
      tenantId: user.tenantId, date: '2026-09-19', referenceType: 'TEST', description: 'มีบรรทัดศูนย์',
      lines: [
        { code: ACC.CASH, debit: 100 },
        { code: ACC.CASH_OVER_SHORT, debit: 0 },
        { code: ACC.REVENUE_PRODUCT, credit: 100 },
      ],
    })
    const lines = db.prepare('SELECT COUNT(*) c FROM journal_lines WHERE journal_entry_id = ?').get(id) as any
    expect(lines.c).toBe(2)
  })

  it('บรรทัดที่มีทั้งเดบิตและเครดิตต้องโยน', () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    expect(() => postJournal({
      tenantId: user.tenantId, date: '2026-09-19', referenceType: 'TEST', description: 'สองข้าง',
      lines: [{ code: ACC.CASH, debit: 50, credit: 50 }],
    })).toThrow(JournalError)
  })
})

describe('ปิดกะ POS — ปิดยอดบัญชีพัก 1180', () => {
  it('นับเงินตรง: บัญชีพักกลับเป็นศูนย์ เงินสดกับธนาคารแยกถูกฝั่ง', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const shiftId = seedShift(user.tenantId, [
      { amount: 300, method: 'CASH' },
      { amount: 700, method: 'QR_CODE' },
    ])
    expect(balanceOf(user.tenantId, ACC.POS_CLEARING), 'ก่อนปิดกะ บัญชีพักต้องค้าง 1,000').toBe(1000)

    const res = await request(app).post(`/api/sales/pos-shifts/${shiftId}/close`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ closing_cash_counted: 500 + 300 })

    expect(res.status).toBe(200)
    expect(balanceOf(user.tenantId, ACC.POS_CLEARING), 'ปิดกะแล้วบัญชีพักต้องเป็นศูนย์').toBe(0)
    expect(balanceOf(user.tenantId, ACC.CASH), 'เงินสดต้องได้เฉพาะยอดขายเงินสด').toBe(300)
    expect(balanceOf(user.tenantId, ACC.BANK), 'ยอดโอน/QR ต้องเข้าธนาคาร').toBe(700)
    expect(balanceOf(user.tenantId, ACC.CASH_OVER_SHORT), 'นับตรงต้องไม่มีเงินขาดเงินเกิน').toBe(0)
  })

  it('นับเงินขาด 40: ส่วนต่างเข้า 5901 และบัญชีพักยังกลับเป็นศูนย์', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const shiftId = seedShift(user.tenantId, [{ amount: 1000, method: 'CASH' }])

    const res = await request(app).post(`/api/sales/pos-shifts/${shiftId}/close`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ closing_cash_counted: 500 + 1000 - 40 })

    expect(res.status).toBe(200)
    expect(balanceOf(user.tenantId, ACC.POS_CLEARING)).toBe(0)
    expect(balanceOf(user.tenantId, ACC.CASH), 'เงินสดต้องลงเท่าที่นับได้จริง').toBe(960)
    expect(balanceOf(user.tenantId, ACC.CASH_OVER_SHORT), 'เงินขาดเป็นค่าใช้จ่าย ยอดเดบิต').toBe(40)
  })

  it('นับเงินเกิน 25: ส่วนต่างเป็นเครดิต 5901', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const shiftId = seedShift(user.tenantId, [{ amount: 1000, method: 'CASH' }])

    await request(app).post(`/api/sales/pos-shifts/${shiftId}/close`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ closing_cash_counted: 500 + 1000 + 25 })

    expect(balanceOf(user.tenantId, ACC.POS_CLEARING)).toBe(0)
    expect(balanceOf(user.tenantId, ACC.CASH)).toBe(1025)
    expect(balanceOf(user.tenantId, ACC.CASH_OVER_SHORT)).toBe(-25)
  })
  it('ยอดบิลมีเศษสตางค์ครึ่ง: ปิดกะได้ ไม่หลุดดุล 0.01 (เดิม JournalError เดบิต 27.65 ≠ เครดิต 27.66)', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const shiftId = seedShift(user.tenantId, [
      { amount: 13.825, method: 'CASH' },
      { amount: 13.825, method: 'QR_CODE' },
    ])

    const res = await request(app).post(`/api/sales/pos-shifts/${shiftId}/close`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ closing_cash_counted: 500 + 13.83 })

    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const je = db.prepare(`SELECT total_debit, total_credit FROM journal_entries
                           WHERE tenant_id = ? AND reference_type = 'POS_SHIFT_CLOSE'`).get(user.tenantId) as any
    expect(je, 'ต้องลงบัญชีปิดกะได้').toBeTruthy()
    expect(je.total_debit).toBe(je.total_credit)
    // บัญชีพักเหลือเศษได้ไม่เกินสตางค์เดียว (ฝั่งขายลงรายบิล ฝั่งปิดกะปัดที่ยอดรวม)
    expect(Math.abs(balanceOf(user.tenantId, ACC.POS_CLEARING))).toBeLessThanOrEqual(0.01)
  })

  it('ขายโอนล้วนแต่เงินในลิ้นชักขาด: ขาเงินสดย้ายไปฝั่งเครดิต ไม่โยนยอดติดลบ', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const shiftId = seedShift(user.tenantId, [{ amount: 200, method: 'QR_CODE' }])

    const res = await request(app).post(`/api/sales/pos-shifts/${shiftId}/close`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ closing_cash_counted: 500 - 20 })

    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(balanceOf(user.tenantId, ACC.POS_CLEARING)).toBe(0)
    expect(balanceOf(user.tenantId, ACC.BANK)).toBe(200)
    expect(balanceOf(user.tenantId, ACC.CASH), 'เงินสดหายไป 20').toBe(-20)
    expect(balanceOf(user.tenantId, ACC.CASH_OVER_SHORT)).toBe(20)
  })
})

describe('ปิดกะ POS — ยอดเงินสด/โอนรวมต่อบิล', () => {
  it('บิลจ่ายแยก 2 ช่องทาง / payment ซ้ำ ไม่นับยอดบิลซ้ำ · บิลไม่มี payment เตือนแล้วตกเป็นเงินสด', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const t = user.tenantId
    const shiftId = seedShift(t, [{ amount: 300, method: 'CASH' }, { amount: 200, method: 'CASH' }])
    const [split, dup] = db.prepare('SELECT id FROM pos_running_bills WHERE shift_id = ? ORDER BY total_amount DESC').all(shiftId) as any[]
    const pay = db.prepare(`INSERT INTO pos_payments (id, tenant_id, bill_id, payment_method, amount, received_by) VALUES (?, ?, ?, ?, ?, 'tester')`)
    db.prepare('UPDATE pos_payments SET amount = 100 WHERE bill_id = ?').run(split.id)
    pay.run(generateId(), t, split.id, 'QR_CODE', 200)   // 300 = เงินสด 100 + QR 200
    pay.run(generateId(), t, dup.id, 'CASH', 200)        // แถวซ้ำ
    const orphan = generateId()                           // บิลไม่มี payment
    db.prepare(`INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, total_amount, subtotal, shift_id, closed_at)
                VALUES (?, ?, 'B-ORPHAN', 'โต๊ะ 2', 'PAID', 50, 50, ?, ?)`).run(orphan, t, shiftId, new Date().toISOString())
    postJournal({ tenantId: t, date: new Date().toISOString().slice(0, 10), referenceType: 'POS_SALE', referenceId: orphan,
      description: 'ขายหน้าร้าน', lines: [{ code: ACC.POS_CLEARING, debit: 50 }, { code: ACC.REVENUE_PRODUCT, credit: 50 }] })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await request(app).post(`/api/sales/pos-shifts/${shiftId}/close`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ closing_cash_counted: 500 + 300 })
    const warned = warn.mock.calls.some(c => String(c[0]).includes('50.00'))
    warn.mockRestore()

    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.data.total_revenue).toBe(550)
    expect(res.body.data.cash_revenue, 'เงินสด 100 + 200 (ไม่เบิ้ลแถวซ้ำ)').toBe(300)
    expect(res.body.data.bank_revenue).toBe(200)
    expect(warned, 'บิลไม่มี payment ต้องเตือน').toBe(true)
    expect(balanceOf(t, ACC.POS_CLEARING)).toBe(0)
    expect(balanceOf(t, ACC.BANK)).toBe(200)
    expect(balanceOf(t, ACC.CASH)).toBe(350)
  })
})

describe('ปิดกะ POS — วันที่ journal ตามเวลาไทย', () => {
  afterEach(() => { vi.useRealTimers() })
  it('ปิดกะ 02:00 ไทย (19:00Z วันก่อน) → journal ลงวันที่ไทย', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const shiftId = seedShift(user.tenantId, [{ amount: 100, method: 'CASH' }])
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-25T19:00:00Z'))
    const res = await request(app).post(`/api/sales/pos-shifts/${shiftId}/close`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ closing_cash_counted: 600 })
    expect(res.status).toBe(200)
    const je = db.prepare("SELECT date FROM journal_entries WHERE tenant_id = ? AND reference_type = 'POS_SHIFT_CLOSE'").get(user.tenantId) as any
    expect(je.date).toBe('2026-09-26')
  })
})
