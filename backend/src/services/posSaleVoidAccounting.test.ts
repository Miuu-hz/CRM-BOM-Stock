import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import posAccountingService from './pos-accounting.service'
import { cancelPosBill } from './posBillCancel.service'
import { postJournal, JournalError } from './accounting.service'
import { ACC } from '../config/accountCodes'
import taxRouter from '../routes/tax.routes'
import { createTestUser } from '../test/testAuth'

/**
 * 2026-10-08: recordSale/recordCancelledSale sync + throw · void หลังปิดกะคืนจากเงินสด/ธนาคาร (ไม่ใช่ 1180)
 * · void กลับ VAT (vat_entries + tax_transactions) · ฐานภาษี POS = total − tax
 */
const app = express()
app.use(express.json())
app.use('/api/tax', taxRouter)

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    for (const tbl of ['journal_lines', 'journal_entries', 'vat_entries', 'tax_transactions', 'tax_periods',
                       'pos_payments', 'pos_bill_items', 'pos_running_bills', 'pos_shifts', 'accounts',
                       'users', 'document_sequences']) {
      try { db.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t) } catch { /* ไม่มีคอลัมน์ tenant_id */ }
    }
  }
})

const newTenant = () => { const t = 'tn' + generateId().slice(0, 12); tenants.push(t); return t }

function balanceOf(tenantId: string, code: string) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS bal
    FROM journal_lines l JOIN accounts a ON a.id = l.account_id AND a.tenant_id = l.tenant_id
    WHERE l.tenant_id = ? AND a.code = ?
  `).get(tenantId, code) as any
  return Math.round((row.bal || 0) * 100) / 100
}

/** บิล ฿107 (สินค้า 100 + VAT 7) จ่ายแล้ว ลงบัญชีผ่าน recordSale จริง */
function seedPaidBill(tenantId: string, opts: { method?: string; shiftStatus?: 'OPEN' | 'CLOSED' } = {}) {
  const shiftId = generateId()
  const openedAt = new Date(Date.now() - 3600_000).toISOString()
  db.prepare(`INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, opening_cash, opened_by)
              VALUES (?, ?, 'SH-T', 'OPEN', ?, 0, 'tester')`).run(shiftId, tenantId, openedAt)
  const billId = generateId()
  const bill = {
    id: billId, bill_number: 'B-' + billId.slice(0, 6), display_name: 'โต๊ะ 1',
    subtotal: 100, service_charge_amount: 0, discount_amount: 0, extra_charge_amount: 0,
    tax_rate: 7, tax_amount: 7, total_amount: 107,
  }
  db.prepare(`INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, subtotal, tax_rate, tax_amount,
                total_amount, shift_id, closed_at) VALUES (?, ?, ?, 'โต๊ะ 1', 'PAID', 100, 7, 7, 107, ?, ?)`)
    .run(billId, tenantId, bill.bill_number, shiftId, new Date().toISOString())
  db.prepare(`INSERT INTO pos_payments (id, tenant_id, bill_id, payment_method, amount, received_by)
              VALUES (?, ?, ?, ?, 107, 'tester')`).run(generateId(), tenantId, billId, opts.method || 'CASH')
  posAccountingService.recordSale(bill as any, { payment_method: opts.method || 'CASH', amount: 107 } as any, tenantId, 'u1')

  if (opts.shiftStatus === 'CLOSED') {
    // ปิดกะ: เคลียร์ 1180 ไปเงินสด/ธนาคาร เหมือน buildShiftCloseJournal
    const cash = (opts.method || 'CASH') === 'CASH'
    postJournal({
      tenantId, date: thaiDateStr(), referenceType: 'POS_SHIFT_CLOSE', referenceId: shiftId, description: 'ปิดกะ',
      lines: [{ code: cash ? ACC.CASH : ACC.BANK, debit: 107 }, { code: ACC.POS_CLEARING, credit: 107 }],
    })
    db.prepare(`UPDATE pos_shifts SET status = 'CLOSED', closed_at = ? WHERE id = ? AND tenant_id = ?`)
      .run(new Date().toISOString(), shiftId, tenantId)
  }
  return { billId, shiftId }
}

describe('recordSale — sync, throws, balanced', () => {
  it('บิลข้อมูลไม่ดุลต้องโยน และไม่เขียนอะไรลงเลย (journal/vat)', () => {
    const t = newTenant()
    const billId = generateId()
    expect(() => posAccountingService.recordSale({
      id: billId, bill_number: 'B-X', display_name: 'x', subtotal: 50, service_charge_amount: 0,
      tax_rate: 7, tax_amount: 7, total_amount: 107,
    } as any, { payment_method: 'CASH', amount: 107 } as any, t, 'u1')).toThrow(JournalError)
    const je = db.prepare('SELECT COUNT(*) c FROM journal_entries WHERE tenant_id = ?').get(t) as any
    const ve = db.prepare('SELECT COUNT(*) c FROM vat_entries WHERE tenant_id = ?').get(t) as any
    expect(je.c).toBe(0)
    expect(ve.c).toBe(0)
  })

  it('บิล ฿107: Dr 1180 107 = Cr รายได้ 100 + ภาษีขาย 7', () => {
    const t = newTenant()
    seedPaidBill(t)
    const je = db.prepare(`SELECT total_debit, total_credit FROM journal_entries WHERE tenant_id = ? AND reference_type = 'POS_SALE'`).get(t) as any
    expect(je.total_debit).toBe(107)
    expect(je.total_credit).toBe(107)
    expect(balanceOf(t, ACC.POS_CLEARING)).toBe(107)
    expect(balanceOf(t, ACC.REVENUE_PRODUCT)).toBe(-100)
    expect(balanceOf(t, ACC.OUTPUT_VAT)).toBe(-7)
  })
})

describe('void หลังปิดกะ', () => {
  it('กะปิดแล้ว บิลเงินสด ฿107: คืนจากเงินสด ไม่แตะ 1180', async () => {
    const t = newTenant()
    const { billId } = seedPaidBill(t, { shiftStatus: 'CLOSED' })
    expect(balanceOf(t, ACC.CASH)).toBe(107)
    expect(balanceOf(t, ACC.POS_CLEARING)).toBe(0)

    await cancelPosBill(t, 'u1', billId, 'ลูกค้าเปลี่ยนใจ', 'VOID')

    expect(balanceOf(t, ACC.POS_CLEARING), 'บัญชีพักต้องไม่ติดลบ').toBe(0)
    expect(balanceOf(t, ACC.CASH), 'คืนเงินสด 107').toBe(0)
    expect(balanceOf(t, ACC.OUTPUT_VAT), 'ภาษีขายกลับเป็นศูนย์').toBe(0)
    expect(balanceOf(t, ACC.SALES_RETURN)).toBe(100)
    const je = db.prepare(`SELECT total_debit, total_credit FROM journal_entries WHERE tenant_id = ? AND reference_type = 'POS_CANCEL'`).get(t) as any
    expect(je.total_debit).toBe(je.total_credit)
  })

  it('กะปิดแล้ว บิล QR: คืนจากธนาคาร', async () => {
    const t = newTenant()
    const { billId } = seedPaidBill(t, { method: 'QR_CODE', shiftStatus: 'CLOSED' })
    await cancelPosBill(t, 'u1', billId, undefined, 'VOID')
    expect(balanceOf(t, ACC.BANK)).toBe(0)
    expect(balanceOf(t, ACC.CASH)).toBe(0)
    expect(balanceOf(t, ACC.POS_CLEARING)).toBe(0)
  })

  it('กะยังเปิด: กลับรายการที่ 1180 ตามเดิม', async () => {
    const t = newTenant()
    const { billId } = seedPaidBill(t)
    await cancelPosBill(t, 'u1', billId, undefined, 'VOID')
    expect(balanceOf(t, ACC.POS_CLEARING)).toBe(0)
    expect(balanceOf(t, ACC.CASH)).toBe(0)
  })
})

describe('void กลับ VAT', () => {
  it('vat_entries ภาษีขายรวมเป็น 0 และ tax_transactions POS_BILL ถูกลบ (งวดยังเปิด)', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const t = user.tenantId
    const { billId } = seedPaidBill(t)
    await request(app).post('/api/tax/sync').set('Authorization', `Bearer ${user.token}`).expect(200)
    expect(db.prepare(`SELECT COUNT(*) c FROM tax_transactions WHERE tenant_id = ? AND source_id = ?`).get(t, billId)).toEqual({ c: 1 })

    await cancelPosBill(t, 'u1', billId, undefined, 'VOID')
    await cancelPosBill(t, 'u1', billId, undefined, 'VOID') // รันซ้ำต้องไม่ลงซ้ำ

    const v = db.prepare(`SELECT SUM(vat_amount) vat, SUM(base_amount) base, COUNT(*) c FROM vat_entries
                          WHERE tenant_id = ? AND is_output_vat = 1`).get(t) as any
    expect(v).toEqual({ vat: 0, base: 0, c: 2 })
    expect(db.prepare(`SELECT COUNT(*) c FROM tax_transactions WHERE tenant_id = ? AND source_id = ?`).get(t, billId)).toEqual({ c: 0 })

    await request(app).post('/api/tax/sync').set('Authorization', `Bearer ${user.token}`).expect(200)
    expect(db.prepare(`SELECT COUNT(*) c FROM tax_transactions WHERE tenant_id = ? AND source_id = ?`).get(t, billId),
      'sync ซ้ำต้องไม่ดึงบิล VOID กลับมา').toEqual({ c: 0 })
  })

  it('งวดยื่นแล้ว: คงแถวเดิม ลงแถวปรับลดติดลบ รวมเป็น 0', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const t = user.tenantId
    const { billId } = seedPaidBill(t)
    await request(app).post('/api/tax/sync').set('Authorization', `Bearer ${user.token}`).expect(200)
    db.prepare(`UPDATE tax_periods SET status = 'CLOSED' WHERE tenant_id = ?`).run(t)

    await cancelPosBill(t, 'u1', billId, undefined, 'VOID')
    await cancelPosBill(t, 'u1', billId, undefined, 'VOID')

    const rows = db.prepare(`SELECT source_type, tax_amount, base_amount FROM tax_transactions
                             WHERE tenant_id = ? AND source_id = ? ORDER BY source_type`).all(t, billId) as any[]
    expect(rows).toEqual([
      { source_type: 'POS_BILL', tax_amount: 7, base_amount: 100 },
      { source_type: 'POS_BILL_CANCEL', tax_amount: -7, base_amount: -100 },
    ])
  })
})

describe('tax sync — ฐานภาษีบิล POS', () => {
  it('ส่วนลดท้ายบิล: base = total − tax (ไม่ใช่ subtotal)', async () => {
    const user = createTestUser({ role: 'ADMIN' })
    tenants.push(user.tenantId)
    const t = user.tenantId
    const billId = generateId()
    // สินค้า 100 ลด 10 → ฐาน 90 · VAT 6 (ปัดบาท) · total 96
    db.prepare(`INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, subtotal, discount_amount,
                  tax_rate, tax_amount, total_amount, closed_at) VALUES (?, ?, 'B-D', 'x', 'PAID', 100, 10, 7, 6, 96, ?)`)
      .run(billId, t, new Date().toISOString())
    await request(app).post('/api/tax/sync').set('Authorization', `Bearer ${user.token}`).expect(200)
    const row = db.prepare(`SELECT base_amount, tax_amount FROM tax_transactions WHERE tenant_id = ? AND source_id = ?`).get(t, billId)
    expect(row).toEqual({ base_amount: 90, tax_amount: 6 })
  })
})

describe('cancel — แยก tenant', () => {
  it('tenant อื่นยกเลิกบิลไม่ได้ และไม่แตะข้อมูลของเจ้าของบิล', async () => {
    const a = newTenant()
    const b = newTenant()
    const { billId } = seedPaidBill(a, { shiftStatus: 'CLOSED' })
    const snapshot = () => ({
      je: db.prepare('SELECT COUNT(*) c FROM journal_entries WHERE tenant_id = ?').get(a),
      ve: db.prepare('SELECT COUNT(*) c FROM vat_entries WHERE tenant_id = ?').get(a),
      st: db.prepare('SELECT status FROM pos_running_bills WHERE id = ? AND tenant_id = ?').get(billId, a),
    })
    const before = snapshot()

    await expect(cancelPosBill(b, 'u1', billId, undefined, 'VOID')).rejects.toThrow('BILL_NOT_FOUND')
    // เรียก service ตรงด้วย tenant ผิด: ไม่เจอ journal/vat ของ tenant นั้น → ไม่ลงอะไรเลย
    const res = posAccountingService.recordCancelledSale(
      { id: billId, bill_number: 'x', display_name: 'x', total_amount: 107 } as any, b, 'u1')
    expect(res.journalEntryId).toBeUndefined()

    expect(snapshot()).toEqual(before)
    expect((snapshot().st as any).status).toBe('PAID')
    expect(db.prepare('SELECT COUNT(*) c FROM journal_entries WHERE tenant_id = ?').get(b)).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) c FROM vat_entries WHERE tenant_id = ?').get(b)).toEqual({ c: 0 })
  })
})
