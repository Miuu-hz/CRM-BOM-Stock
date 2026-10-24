import { describe, it, expect, vi, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import { authenticate } from '../../middleware/auth.middleware'
import creditNotesRouter from './creditNotes'
import summaryRouter from './summary.routes'
import { createTestUser } from '../../test/testAuth'

/** ใบลดหนี้หักยอดค้างเฉพาะตอน ISSUED · คืนเฉพาะเมื่อยกเลิกใบที่หักไปแล้ว + "รับวันนี้" ตามเวลาไทย */
const app = express()
app.use(express.json())
app.use('/api/sales/credit-notes', authenticate, creditNotesRouter)
app.use('/api/sales/summary', authenticate, summaryRouter)

function seed(t: string) {
  db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(t, 'test')
  const customerId = generateId()
  db.prepare(`INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city)
    VALUES (?, ?, ?, 'ลูกค้า', 'RETAIL', '-', '-', '-', '-')`).run(customerId, t, 'C-' + customerId.slice(0, 6))
  const soId = generateId()
  db.prepare(`INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, status) VALUES (?, ?, ?, ?, 'CONFIRMED')`)
    .run(soId, t, 'SO-' + soId.slice(0, 6), customerId)
  const invoiceId = generateId()
  db.prepare(`INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, subtotal, tax_rate, tax_amount, total_amount, balance_amount, vat_inclusive)
    VALUES (?, ?, ?, ?, ?, 1000, 7, 70, 1070, 1070, 0)`).run(invoiceId, t, 'INV-' + invoiceId.slice(0, 6), soId, customerId)
  return { customerId, invoiceId }
}
const balance = (id: string) => (db.prepare('SELECT balance_amount FROM invoices WHERE id = ?').get(id) as any).balance_amount

async function createCn(token: string, invoiceId: string) {
  const res = await request(app).post('/api/sales/credit-notes').set('Authorization', `Bearer ${token}`)
    .send({ invoiceId, reason: 'ลดราคา', amount: 100 })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body.data.id as string
}
const setStatus = (token: string, id: string, status: string) =>
  request(app).put(`/api/sales/credit-notes/${id}/status`).set('Authorization', `Bearer ${token}`).send({ status })
const cnSeq = (t: string) => {
  const row = db.prepare("SELECT last_number FROM document_sequences WHERE tenant_id = ? AND doc_type = 'CREDIT_NOTE'").get(t) as any
  return row?.last_number || 0
}
// แทรกใบลดหนี้ตรงฐานข้อมูล (ข้ามการตรวจของ POST /) จำลองสภาวะแข่ง: สอง DRAFT ที่ผ่านเช็คตอนสร้าง
// เพราะยังไม่เห็นกัน แต่รวมกันเกินมูลค่าใบแจ้งหนี้ — ใช้ตรวจว่า DRAFT→ISSUED เช็คซ้ำจริง
function insertRawCn(t: string, invoiceId: string, customerId: string, totalAmount: number) {
  const id = generateId()
  db.prepare(`INSERT INTO credit_notes (id, tenant_id, cn_number, invoice_id, customer_id, reason, subtotal, tax_rate, tax_amount, total_amount, status, balance_applied)
    VALUES (?, ?, ?, ?, ?, 'ลดราคา', ?, 0, 0, ?, 'DRAFT', 0)`).run(id, t, 'CN-RAW-' + id.slice(0, 6), invoiceId, customerId, totalAmount, totalAmount)
  return id
}

describe('ใบลดหนี้กับยอดค้างใบแจ้งหนี้', () => {
  it('DRAFT ไม่หัก · ISSUED หัก · ออกซ้ำ 409 · ยกเลิกใบที่ออกแล้วไม่ได้ (409)', async () => {
    const { tenantId: t, token } = createTestUser()
    const { invoiceId } = seed(t)
    const cnId = await createCn(token, invoiceId)
    expect(balance(invoiceId), 'DRAFT ยังไม่หัก').toBe(1070)

    expect((await setStatus(token, cnId, 'ISSUED')).status).toBe(200)
    expect(balance(invoiceId), 'ISSUED หัก 107').toBe(963)

    const again = await setStatus(token, cnId, 'ISSUED')
    expect(again.status).toBe(409)
    expect(balance(invoiceId)).toBe(963)
    const jv = db.prepare("SELECT COUNT(*) n FROM journal_entries WHERE tenant_id = ? AND reference_type = 'CREDIT_NOTE'").get(t) as any
    expect(jv.n).toBe(1)

    // ถอยสถานะไม่ได้ · ยกเลิกใบที่ออกแล้ว (MASTER ทำได้เลย ผ่านประตู sales_cancel) → กลับ journal + คืนยอดค้าง
    expect((await setStatus(token, cnId, 'DRAFT')).status).toBe(409)
    expect((await setStatus(token, cnId, 'CANCELLED')).status).toBe(200)
    expect(balance(invoiceId), 'ยกเลิกใบที่ออกแล้ว คืนยอดค้าง').toBe(1070)
    const rev = db.prepare("SELECT COUNT(*) n FROM journal_entries WHERE tenant_id = ? AND reference_type = 'CREDIT_NOTE_CANCEL'").get(t) as any
    expect(rev.n).toBe(1)
    expect((await setStatus(token, cnId, 'CANCELLED')).status, 'ยกเลิกซ้ำ').toBe(409)
  })

  it('ยกเลิก DRAFT (ทั้ง status และ DELETE) ไม่บวกยอด', async () => {
    const { tenantId: t, token } = createTestUser()
    const { invoiceId } = seed(t)
    const a = await createCn(token, invoiceId)
    expect((await setStatus(token, a, 'CANCELLED')).status).toBe(200)
    const b = await createCn(token, invoiceId)
    expect((await request(app).delete(`/api/sales/credit-notes/${b}`).set('Authorization', `Bearer ${token}`)).status).toBe(200)
    expect(balance(invoiceId)).toBe(1070)
  })

  it('ใบเก่า (balance_applied NULL) ถือว่าหักไปแล้วตอนสร้าง: ออกไม่หักซ้ำ · ลบ DRAFT คืนยอด', async () => {
    const { tenantId: t, token } = createTestUser()
    const { invoiceId, customerId } = seed(t)
    db.prepare('UPDATE invoices SET balance_amount = 856 WHERE id = ?').run(invoiceId) // โค้ดเดิมหัก 2 ใบ × 107 ไปแล้ว
    const legacy = (n: string) => {
      const id = generateId()
      db.prepare(`INSERT INTO credit_notes (id, tenant_id, cn_number, invoice_id, customer_id, reason, subtotal, tax_rate, tax_amount, total_amount, status)
        VALUES (?, ?, ?, ?, ?, 'เก่า', 100, 7, 7, 107, 'DRAFT')`).run(id, t, n + id.slice(0, 6), invoiceId, customerId)
      return id
    }
    const issued = legacy('CN-A-')
    const drafted = legacy('CN-B-')
    expect((await setStatus(token, issued, 'ISSUED')).status).toBe(200)
    expect(balance(invoiceId)).toBe(856)
    expect((await request(app).delete(`/api/sales/credit-notes/${drafted}`).set('Authorization', `Bearer ${token}`)).status).toBe(200)
    expect(balance(invoiceId)).toBe(963)
  })

  it('tenant อื่นแตะใบลดหนี้ไม่ได้ และยอดไม่เปลี่ยน', async () => {
    const owner = createTestUser()
    const other = createTestUser()
    const { invoiceId } = seed(owner.tenantId)
    const cnId = await createCn(owner.token, invoiceId)
    expect((await setStatus(other.token, cnId, 'ISSUED')).status).toBe(404)
    expect((await request(app).delete(`/api/sales/credit-notes/${cnId}`).set('Authorization', `Bearer ${other.token}`)).status).toBe(404)
    expect(balance(invoiceId)).toBe(1070)
  })
})

describe('ใบลดหนี้รวมต้องไม่เกินมูลค่าใบแจ้งหนี้ (ม.82/10 / ม.86/10)', () => {
  it('ใบลดราคาเกินมูลค่าใบแจ้งหนี้ → 400 และไม่เผาเลขเอกสาร', async () => {
    const { tenantId: t, token } = createTestUser()
    const { invoiceId } = seed(t) // total_amount 1070
    const seqBefore = cnSeq(t)
    const res = await request(app).post('/api/sales/credit-notes').set('Authorization', `Bearer ${token}`)
      .send({ invoiceId, reason: 'ลดราคา', amount: 1050 }) // total ~1123.5 > 1070
    expect(res.status, JSON.stringify(res.body)).toBe(400)
    expect(cnSeq(t), 'ถูกปฏิเสธ ต้องไม่กันเลขไป').toBe(seqBefore)
  })

  it('สองใบรวมกันเกิน → ใบที่สองถูกปฏิเสธ', async () => {
    const { tenantId: t, token } = createTestUser()
    const { invoiceId } = seed(t) // total_amount 1070
    const first = await request(app).post('/api/sales/credit-notes').set('Authorization', `Bearer ${token}`)
      .send({ invoiceId, reason: 'ลดราคา', amount: 950 }) // total 1016.5, เหลือให้ลดอีก 53.5
    expect(first.status, JSON.stringify(first.body)).toBe(201)
    const second = await request(app).post('/api/sales/credit-notes').set('Authorization', `Bearer ${token}`)
      .send({ invoiceId, reason: 'ลดราคา', amount: 100 }) // total 107 > 53.5 ที่เหลือ
    expect(second.status, JSON.stringify(second.body)).toBe(400)
  })

  it('ใบแจ้งหนี้จ่ายครบแล้ว ลดหนี้ภายในมูลค่ารวม → 201 พร้อม refundDue', async () => {
    const { tenantId: t, token } = createTestUser()
    const { invoiceId } = seed(t)
    db.prepare('UPDATE invoices SET balance_amount = 0 WHERE id = ?').run(invoiceId) // จ่ายครบแล้ว
    const cnId = await createCn(token, invoiceId) // amount 100 → total 107, ยังไม่เกิน 1070
    const res = await setStatus(token, cnId, 'ISSUED')
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.refundDue, 'ลูกค้าจ่ายครบแล้ว ส่วนนี้ต้องคืนเงิน').toBe(107)
    expect(balance(invoiceId), 'ยอดค้างยังคง clamp ที่ 0').toBe(0)
  })

  it('อีกใบถูกสร้างแซงระหว่างที่ใบนี้ยังเป็น DRAFT → ออก ISSUED ไม่ได้ (409)', async () => {
    const { tenantId: t, token } = createTestUser()
    const { invoiceId, customerId } = seed(t) // total_amount 1070
    const res1 = await request(app).post('/api/sales/credit-notes').set('Authorization', `Bearer ${token}`)
      .send({ invoiceId, reason: 'ลดราคา', amount: 900 }) // total 963, เหลือให้ลดได้อีก 107 ณ ตอนสร้าง
    expect(res1.status, JSON.stringify(res1.body)).toBe(201)
    const cnId = res1.body.data.id as string
    // จำลองอีกคำขอแซงเข้ามาระหว่างที่ cnId ยังเป็น DRAFT (แทรกตรง DB แทนการยิง POST ซ้อนจริง)
    insertRawCn(t, invoiceId, customerId, 200) // รวมกับ cnId (963) = 1163 > 1070 แล้ว
    const res = await setStatus(token, cnId, 'ISSUED')
    expect(res.status, JSON.stringify(res.body)).toBe(409)
  })
})

describe('สรุปยอดขาย: รับชำระวันนี้ตามเวลาไทย', () => {
  afterEach(() => vi.useRealTimers())

  it('2026-10-08 00:30 (+07:00) นับใบเสร็จของวันที่ 8 ไทย ไม่นับวันที่ 7 · ไม่ปน tenant', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T00:30:00+07:00'))
    const { tenantId: t, token } = createTestUser()
    const other = createTestUser()
    const { invoiceId, customerId } = seed(t)
    const rc = (tenant: string, date: string, amount: number) => db.prepare(`INSERT INTO receipts (id, tenant_id, receipt_number, invoice_id, customer_id, receipt_date, payment_method, amount)
      VALUES (?, ?, ?, ?, ?, ?, 'CASH', ?)`).run(generateId(), tenant, 'RC-' + generateId().slice(0, 8), invoiceId, customerId, date, amount)
    rc(t, '2026-10-08', 1)                     // วันที่ไทยจากหน้าจอ
    rc(t, '2026-10-07T17:15:00.000Z', 10)      // 00:15 ไทย วันที่ 8
    rc(t, '2026-10-07 17:20:00', 100)          // CURRENT_TIMESTAMP (UTC) 00:20 ไทย
    rc(t, '2026-10-07', 1000)                  // เมื่อวาน
    rc(t, '2026-10-07T16:59:00.000Z', 10000)   // 23:59 ไทย วันที่ 7
    rc(other.tenantId, '2026-10-08', 100000)   // tenant อื่น

    const res = await request(app).get('/api/sales/summary').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.receipts.todayReceived).toBe(111)
  })
})
