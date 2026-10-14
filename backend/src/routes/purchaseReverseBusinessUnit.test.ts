import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { getOrCreateAccount } from '../services/accounting.service'
import { reverseJournalEntryForReference } from './purchase.routes'

// finding #12: reverseJournalEntryForReference เดิมไม่ copy business_unit จากใบต้นฉบับ — หลัง unpost/reverse
// ธุรกรรมที่เคยอยู่ business_unit เดิม (เช่น ONLINE) จะเหลือ NULL แล้วงบ P&L แยกหน่วยธุรกิจไปนับผิดที่ OTHER

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM journal_lines WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM journal_entries WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM accounts WHERE tenant_id = ?').run(t)
  }
})
function newTenant() {
  const t = 'test_revbu_' + generateId()
  tenants.push(t)
  return t
}

describe('reverseJournalEntryForReference — copy business_unit จากใบต้นฉบับ (finding #12)', () => {
  it('ใบกลับรายการต้องได้ business_unit เดียวกับใบต้นฉบับ (ไม่ใช่ NULL)', () => {
    const tenantId = newTenant()
    const accId = getOrCreateAccount(tenantId, '1181')
    const journalId = generateId()
    db.prepare(`
      INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id,
        description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at, business_unit)
      VALUES (?, ?, 'JE-TEST-1', '2026-10-01', 'PLATFORM_MONTH_SALES', 'M1:TOKEN', 'ทดสอบ', 100, 100, 1, 1, 'tester', ?, ?, 'ONLINE')
    `).run(journalId, tenantId, new Date().toISOString(), new Date().toISOString())
    db.prepare(`
      INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
      VALUES (?, ?, ?, ?, 1, 'ทดสอบ', 100, 0)
    `).run(generateId(), tenantId, journalId, accId)

    const reversalId = reverseJournalEntryForReference(
      tenantId, 'PLATFORM_MONTH_SALES', 'PLATFORM_MONTH_SALES_UNPOST', 'M1:TOKEN', 'ยกเลิก', 'tester', '2026-10-01'
    )
    expect(reversalId).toBeTruthy()
    const reversal = db.prepare('SELECT business_unit FROM journal_entries WHERE id = ?').get(reversalId) as any
    expect(reversal.business_unit).toBe('ONLINE')
  })

  it('ใบต้นฉบับไม่มี business_unit (NULL) — ใบกลับรายการก็ได้ NULL เหมือนกัน (ไม่ throw)', () => {
    const tenantId = newTenant()
    const accId = getOrCreateAccount(tenantId, '1181')
    const journalId = generateId()
    db.prepare(`
      INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id,
        description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at)
      VALUES (?, ?, 'JE-TEST-2', '2026-10-01', 'PO_CANCEL', 'PO1', 'ทดสอบ', 50, 50, 1, 1, 'tester', ?, ?)
    `).run(journalId, tenantId, new Date().toISOString(), new Date().toISOString())
    db.prepare(`
      INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
      VALUES (?, ?, ?, ?, 1, 'ทดสอบ', 50, 0)
    `).run(generateId(), tenantId, journalId, accId)

    const reversalId = reverseJournalEntryForReference(
      tenantId, 'PO_CANCEL', 'PO_CANCEL_UNDO', 'PO1', 'ยกเลิก', 'tester', '2026-10-01'
    )
    const reversal = db.prepare('SELECT business_unit FROM journal_entries WHERE id = ?').get(reversalId) as any
    expect(reversal.business_unit == null).toBe(true)
  })
})
