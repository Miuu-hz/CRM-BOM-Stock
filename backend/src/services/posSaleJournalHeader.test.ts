import { describe, it, expect } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import posAccountingService from './pos-accounting.service'

/**
 * Phase 1 (2026-10-03): หัว journal POS_SALE ต้องเท่าผลรวมบรรทัดจริง (เดิมใส่ bill.total_amount
 * ทั้ง total_debit และ total_credit — ถ้าบรรทัดเครดิตรวมไม่ลง total หัวรายการจะโกหกว่าดุล)
 */
const r2 = (n: number) => Math.round(n * 100) / 100

describe('recordSale — หัวรายการ = ผลรวมบรรทัด', () => {
  it('ยอดมีเศษ float → หัวรายการปัดเป็นสตางค์และตรงกับบรรทัด', async () => {
    const tenantId = generateId()
    const billId = generateId()
    const res = await posAccountingService.recordSale({
      id: billId, bill_number: 'B-' + billId.slice(0, 6), display_name: 'โต๊ะ 1',
      subtotal: 93.46, service_charge_amount: 0, tax_rate: 7, tax_amount: 6.54,
      total_amount: 100.00000000000001,
    } as any, { payment_method: 'CASH', amount: 100 }, tenantId, 'u1')
    expect(res.success, res.errors.join()).toBe(true)

    const je = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(res.journalEntryId) as any
    const lines = db.prepare('SELECT debit, credit FROM journal_lines WHERE journal_entry_id = ?').all(je.id) as any[]
    const dr = r2(lines.reduce((s, l) => s + l.debit, 0))
    const cr = r2(lines.reduce((s, l) => s + l.credit, 0))
    expect(je.total_debit).toBe(dr)
    expect(je.total_credit).toBe(cr)
    expect(je.total_debit).toBe(100)
    expect(je.total_credit).toBe(100)
  })
})
