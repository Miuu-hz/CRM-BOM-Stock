import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'
import salesRouter from './index'
import { createTestUser } from '../../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/sales', salesRouter)

// กิจการที่ยังไม่จด VAT ห้ามเก็บ VAT จากลูกค้า (ม.85) · ใบขายเปิด VAT เป็นค่าเริ่มต้นเฉพาะกิจการที่จดแล้ว
function setup(vatRegistered: number) {
  const u = createTestUser({ role: 'ADMIN' })
  db.prepare(`INSERT INTO company_settings (tenant_id, name) VALUES (?, 'ทดสอบ')`).run(u.tenantId)
  db.prepare('UPDATE company_settings SET vat_registered = ? WHERE tenant_id = ?').run(vatRegistered, u.tenantId)
  const customerId = generateId()
  db.prepare(`INSERT INTO customers (id, code, name, type, contact_name, email, phone, city, tenant_id) VALUES (?, ?, 'ลูกค้า', 'RETAIL', 'x', 'x@example.com', '0800000000', 'BKK', ?)`)
    .run(customerId, 'C-' + customerId.slice(0, 6), u.tenantId)
  return { u, body: { customerId, taxRate: 7, items: [{ productName: 'ของ', quantity: 1, unitPrice: 100 }] } }
}
const qtCounter = (t: string) =>
  (db.prepare("SELECT COALESCE(MAX(last_number), 0) n FROM document_sequences WHERE tenant_id = ? AND doc_type = 'QUOTATION'").get(t) as any).n

describe('ใบเสนอราคา — ขายแบบมี VAT', () => {
  it('ยังไม่จด VAT: ใส่ VAT ถูกปฏิเสธ และไม่เสียเลขเอกสาร', async () => {
    const { u, body } = setup(0)
    const res = await request(app).post('/api/sales/quotations').set('Authorization', `Bearer ${u.token}`).send(body)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VAT_NOT_REGISTERED')
    expect(qtCounter(u.tenantId)).toBe(0)
  })

  it('ยังไม่จด VAT: ขายแบบไม่มี VAT ผ่าน', async () => {
    const { u, body } = setup(0)
    const res = await request(app).post('/api/sales/quotations').set('Authorization', `Bearer ${u.token}`).send({ ...body, taxRate: 0 })
    expect(res.status).toBeLessThan(300)
  })

  it('จด VAT แล้ว: ขายแบบมี VAT ผ่าน', async () => {
    const { u, body } = setup(1)
    const res = await request(app).post('/api/sales/quotations').set('Authorization', `Bearer ${u.token}`).send(body)
    expect(res.status).toBeLessThan(300)
  })
})
