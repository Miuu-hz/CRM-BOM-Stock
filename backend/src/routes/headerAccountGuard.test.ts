import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { seedChartOfAccounts } from '../config/chartOfAccounts'
import { ACC } from '../config/accountCodes'
import journalRouter from './journal.routes'
import settingsRouter from './settings.routes'
import { registerPurchaseBillingTools } from '../mcp/tools/purchaseBilling'
import { paySupplier, PurchaseBillingError } from '../services/purchaseBilling.service'
import { createTestUser } from '../test/testAuth'
import type { IMcpServer } from '../mcp/sdk-compat'

// A1 ห้ามลงบัญชีหัว (trigger) + บัญชีธนาคารค่าเริ่มต้น · A2 รูปแบบกิจการ · A8 ถอย/กลับรายการ
const app = express()
app.use(express.json())
app.use('/api/journal', journalRouter)
app.use('/api/settings', settingsRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_unposts', 'journal_lines', 'journal_entries', 'supplier_payments', 'purchase_invoices', 'purchase_orders',
      'bank_accounts', 'suppliers', 'accounts', 'document_sequences', 'company_settings', 'users']) {
      db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t)
    }
  }
})

function setup(role: 'ADMIN' | 'USER' = 'ADMIN') {
  const u = createTestUser({ role })
  tenants.push(u.tenantId)
  seedChartOfAccounts(u.tenantId)
  return u
}
const accId = (t: string, code: string) => (db.prepare('SELECT id FROM accounts WHERE tenant_id = ? AND code = ?').get(t, code) as any).id
const seq = (t: string) => (db.prepare(`SELECT COALESCE(MAX(last_number), 0) AS n FROM document_sequences WHERE tenant_id = ? AND doc_type = 'JOURNAL'`).get(t) as any).n

/** บัญชีย่อยธนาคาร (แบบที่ Settings > บัญชีธนาคาร สร้าง) — ทำให้ 1102 กลายเป็นบัญชีหัว */
function addBank(t: string, code: string, isDefault = 0) {
  const id = generateId()
  db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, parent_id, level, is_active, normal_balance)
    VALUES (?, ?, ?, ?, 'ASSET', 'CASH', ?, 3, 1, 'DEBIT')`).run(id, t, code, `ธนาคาร ${code}`, accId(t, ACC.BANK))
  db.prepare(`INSERT INTO bank_accounts (id, tenant_id, bank_name, account_name, account_number, account_id, is_default, is_active)
    VALUES (?, ?, 'กรุงศรี', 'ร้าน', ?, ?, ?, 1)`).run(generateId(), t, code, id, isDefault)
  return id
}

const jePayload = (lines: Array<{ accountId: string; debit?: number; credit?: number }>) => ({
  date: new Date().toISOString().slice(0, 10), description: 'ทดสอบ', lines,
})

describe('A1 ห้ามลงบัญชีหัว', () => {
  it('REST: ลง 1102 ที่มีบัญชีย่อย → 400 ข้อความไทย และเลข JV ไม่ถูกใช้', async () => {
    const u = setup()
    addBank(u.tenantId, '1102-01')
    const before = seq(u.tenantId)
    const res = await request(app).post('/api/journal').set('Authorization', `Bearer ${u.token}`)
      .send(jePayload([{ accountId: accId(u.tenantId, ACC.BANK), debit: 100 }, { accountId: accId(u.tenantId, '4203'), credit: 100 }]))
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('ลงบัญชีหัวไม่ได้')
    expect(seq(u.tenantId)).toBe(before)
    expect(db.prepare('SELECT COUNT(*) AS n FROM journal_entries WHERE tenant_id = ?').get(u.tenantId)).toEqual({ n: 0 })
  })

  it('บัญชีหัวที่มียอดค้างเดิม: ย้ายยอดออก (ทิศตรงข้าม ไม่เกินยอด) ได้ · ลงเพิ่มไม่ได้', async () => {
    const u = setup()
    const t = u.tenantId
    // ยอดเดิมก่อนมีบัญชีย่อย: จ่ายออกจาก 1102 ไป 500 (เครดิต)
    const pay = await request(app).post('/api/journal').set('Authorization', `Bearer ${u.token}`)
      .send(jePayload([{ accountId: accId(t, '2101'), debit: 500 }, { accountId: accId(t, ACC.BANK), credit: 500 }]))
    expect(pay.status).toBe(200)
    const child = addBank(t, '1102-01')
    // ย้าย 1102 → 1102-01: Dr 1102 500 / Cr 1102-01 500
    const move = await request(app).post('/api/journal').set('Authorization', `Bearer ${u.token}`)
      .send(jePayload([{ accountId: accId(t, ACC.BANK), debit: 500 }, { accountId: child, credit: 500 }]))
    expect(move.status).toBe(200)
    // ยอดหัวเหลือ 0 แล้ว — ลงต่ออีกไม่ได้ทั้งสองทิศ
    for (const lines of [
      [{ accountId: accId(t, ACC.BANK), debit: 1 }, { accountId: child, credit: 1 }],
      [{ accountId: child, debit: 1 }, { accountId: accId(t, ACC.BANK), credit: 1 }],
    ]) {
      const r = await request(app).post('/api/journal').set('Authorization', `Bearer ${u.token}`).send(jePayload(lines))
      expect(r.status).toBe(400)
    }
  })

  it('MCP pay_supplier: มีหลายบัญชีธนาคารแต่ไม่ได้เลือก/ไม่มีค่าเริ่มต้น → ปฏิเสธข้อความไทย · REST service โยน PurchaseBillingError (= 400)', async () => {
    const u = setup()
    const t = u.tenantId
    addBank(t, '1102-01'); addBank(t, '1102-02')
    const supplierId = generateId()
    db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'ผู้ขาย', 'C')").run(supplierId, t, supplierId)
    const poId = generateId()
    db.prepare(`INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, subtotal, tax_rate, tax_amount, total_amount, created_at, updated_at)
      VALUES (?, ?, 'PO-T-1', ?, 'RECEIVED', 300, 0, 0, 300, datetime('now'), datetime('now'))`).run(poId, t, supplierId)
    const piId = generateId()
    db.prepare(`INSERT INTO purchase_invoices (id, tenant_id, pi_number, purchase_order_id, supplier_id, invoice_date, subtotal, tax_amount, total_amount,
      paid_amount, balance_amount, status, payment_status, created_at, updated_at)
      VALUES (?, ?, 'PI-T-1', ?, ?, '2026-10-01', 300, 0, 300, 0, 300, 'APPROVED', 'UNPAID', datetime('now'), datetime('now'))`).run(piId, t, poId, supplierId)

    const tools: Record<string, (a: any) => Promise<any>> = {}
    const server: IMcpServer = { tool: (n: string, _d: any, _s: any, h: any) => { tools[n] = h }, connect: async () => {}, close: async () => {} }
    registerPurchaseBillingTools(server, t, u.userId, u.email, 'ADMIN')
    const res = JSON.parse((await tools['pay_supplier']({ purchase_invoice_id: piId, amount: 100, payment_method: 'TRANSFER' })).content[0].text)
    expect(res.success).toBe(false)
    expect(res.message).toContain('ลงบัญชีหัวไม่ได้')
    expect(() => paySupplier(t, u.email, { supplierId, purchaseInvoiceId: piId, amount: 100, paymentMethod: 'TRANSFER' } as any))
      .toThrow(PurchaseBillingError)
    // ไม่มีเลขใบจ่ายเงินหลุด ไม่มีใบจ่ายค้าง และใบแจ้งหนี้ยังค้างเต็ม
    expect(db.prepare('SELECT COUNT(*) AS n FROM supplier_payments WHERE tenant_id = ?').get(t)).toEqual({ n: 0 })
    expect((db.prepare('SELECT balance_amount FROM purchase_invoices WHERE id = ?').get(piId) as any).balance_amount).toBe(300)
  })

  it('โอนแต่ไม่ได้เลือกบัญชี + มีบัญชีธนาคารเดียว → ลงบัญชีย่อยนั้น ไม่ใช่ 1102 หัว', async () => {
    const u = setup()
    const t = u.tenantId
    const only = addBank(t, '1102-01')
    const supplierId = generateId()
    db.prepare("INSERT INTO suppliers (id, tenant_id, code, name, contact_name) VALUES (?, ?, ?, 'ผู้ขาย', 'C')").run(supplierId, t, supplierId)
    const p = paySupplier(t, u.email, { supplierId, amount: 250, paymentMethod: 'TRANSFER' } as any) as any
    const line = db.prepare(`SELECT jl.account_id FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE je.reference_type = 'SUPPLIER_PAYMENT' AND je.reference_id = ? AND jl.credit > 0`).get(p.id) as any
    expect(line.account_id).toBe(only)
  })
})

describe('A2 รูปแบบกิจการ', () => {
  it('ADMIN ตั้งได้/ล้างได้ · ค่าผิด 400 · USER แก้ไม่ได้', async () => {
    const u = setup()
    const put = (tok: string, body: any) => request(app).put('/api/settings/company').set('Authorization', `Bearer ${tok}`).send(body)
    expect((await put(u.token, { entity_type: 'PARTNERSHIP' })).status).toBe(200)
    expect((db.prepare('SELECT entity_type FROM company_settings WHERE tenant_id = ?').get(u.tenantId) as any).entity_type).toBe('PARTNERSHIP')
    expect((await put(u.token, { entity_type: 'LLC' })).status).toBe(400)
    expect((await put(u.token, { entity_type: '' })).status).toBe(200)
    expect((db.prepare('SELECT entity_type FROM company_settings WHERE tenant_id = ?').get(u.tenantId) as any).entity_type).toBeNull()
    const basic = createTestUser({ role: 'USER', tenantId: u.tenantId })
    expect((await put(basic.token, { entity_type: 'COMPANY' })).status).toBe(403)
  })

  it('ผังบัญชีใหม่มีบัญชีเจ้าของ/พักรอตรวจสอบครบ', () => {
    const u = setup()
    for (const code of [ACC.PETTY_CASH, ACC.DIRECTOR_LOAN, ACC.SUSPENSE, ACC.OWNER_ADVANCE, ACC.OWNER_DRAWINGS, ACC.PRIOR_PERIOD_ADJ]) {
      expect(accId(u.tenantId, code), code).toBeTruthy()
    }
  })
})

describe('A8 ถอยรายการ/กลับรายการ', () => {
  async function postedJe(u: ReturnType<typeof setup>) {
    const t = u.tenantId
    const c = await request(app).post('/api/journal').set('Authorization', `Bearer ${u.token}`)
      .send(jePayload([{ accountId: accId(t, '5303'), debit: 120 }, { accountId: accId(t, ACC.CASH), credit: 120 }]))
    await request(app).post(`/api/journal/${c.body.data.id}/post`).set('Authorization', `Bearer ${u.token}`)
    return c.body.data.id as string
  }

  it('unpost ต้องมีเหตุผล · วันเดียวกันถอยได้และเก็บประวัติยอดเดิม', async () => {
    const u = setup()
    const id = await postedJe(u)
    expect((await request(app).post(`/api/journal/${id}/unpost`).set('Authorization', `Bearer ${u.token}`).send({})).status).toBe(400)
    const ok = await request(app).post(`/api/journal/${id}/unpost`).set('Authorization', `Bearer ${u.token}`).send({ reason: 'ใส่ยอดผิดหลัก' })
    expect(ok.status).toBe(200)
    const h = db.prepare('SELECT * FROM journal_unposts WHERE journal_entry_id = ?').get(id) as any
    expect(h.reason).toBe('ใส่ยอดผิดหลัก')
    expect(h.unposted_by).toBe(u.email)
    expect(h.total_debit).toBe(120)
    expect(JSON.parse(h.lines_json)).toHaveLength(2)
  })

  it('ยืนยันไปแล้วข้ามวัน → ถอยไม่ได้ ต้องกลับรายการ · กลับได้ครั้งเดียว', async () => {
    const u = setup()
    const id = await postedJe(u)
    db.prepare(`UPDATE journal_entries SET posted_at = '2020-01-01T03:00:00.000Z' WHERE id = ?`).run(id)
    const un = await request(app).post(`/api/journal/${id}/unpost`).set('Authorization', `Bearer ${u.token}`).send({ reason: 'แก้ยอดผิด' })
    expect(un.status).toBe(400)
    expect(un.body.message).toContain('กลับรายการ')
    const rv = await request(app).post(`/api/journal/${id}/reverse`).set('Authorization', `Bearer ${u.token}`).send({ reason: 'แก้ยอดผิด' })
    expect(rv.status).toBe(200)
    const lines = db.prepare(`SELECT a.code, jl.debit, jl.credit FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE jl.journal_entry_id = ? ORDER BY a.code`).all(rv.body.data.id) as any[]
    expect(lines).toEqual([{ code: ACC.CASH, debit: 120, credit: 0 }, { code: '5303', debit: 0, credit: 120 }])
    expect((await request(app).post(`/api/journal/${id}/reverse`).set('Authorization', `Bearer ${u.token}`).send({ reason: 'ซ้ำอีกรอบ' })).status).toBe(400)
  })

  it('รายการที่ระบบสร้างจากเอกสารถอย/กลับตรงไม่ได้', async () => {
    const u = setup()
    const id = await postedJe(u)
    db.prepare(`UPDATE journal_entries SET is_auto_generated = 1, reference_type = 'POS_SALE' WHERE id = ?`).run(id)
    const un = await request(app).post(`/api/journal/${id}/unpost`).set('Authorization', `Bearer ${u.token}`).send({ reason: 'ทดสอบถอย' })
    expect(un.status).toBe(400)
    expect(un.body.message).toContain('เอกสารต้นทาง')
    expect((await request(app).post(`/api/journal/${id}/reverse`).set('Authorization', `Bearer ${u.token}`).send({ reason: 'ทดสอบกลับ' })).status).toBe(400)
  })
})
