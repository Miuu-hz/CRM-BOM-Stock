import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { formatDocumentNumber } from './id'

const tenant = 'test_docnum_settings_' + Date.now()

const setFormat = (docType: string, prefix: string, o: { padding?: number; date?: string; reset?: string } = {}) =>
  db.prepare(`INSERT OR REPLACE INTO document_number_formats
    (tenant_id, doc_type, enabled, prefix, padding, date_format, separator, reset_period, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, '-', ?, datetime('now'))`)
    .run(tenant, docType, prefix, o.padding ?? 3, o.date ?? 'DDMMYY', o.reset ?? 'YEAR')

afterEach(() => {
  db.prepare('DELETE FROM document_number_formats WHERE tenant_id = ?').run(tenant)
  db.prepare('DELETE FROM document_sequences WHERE tenant_id = ?').run(tenant)
  db.prepare('DELETE FROM journal_entries WHERE tenant_id = ?').run(tenant)
})

describe('เลขเอกสารตามค่าใน Settings', () => {
  it.each([
    ['PO', 'PO', 'PO-001-211026'],
    ['GOODS_RECEIPT', 'GR', 'GR-001-211026'],
    ['PURCHASE_INVOICE', 'PI', 'PI-001-211026'],
    ['SUPPLIER_PAYMENT', 'PAY', 'PAY-001-211026'],
    ['INVOICE', 'INV', 'INV-001-211026'],
    ['RECEIPT', 'RC', 'RC-001-211026'],
    ['POS_BILL', 'POS', 'POS-001-211026'],
    ['JOURNAL', 'JV', 'JV-001-211026'],
    ['POS_SHIFT', 'SHIFT', 'SHIFT-001-211026'],
  ])('%s ออกตามรูปแบบที่ตั้ง (prefix ใน Settings ชนะ prefix ในโค้ด)', (docType, prefix, expected) => {
    setFormat(docType, prefix)
    expect(formatDocumentNumber('XX', tenant, docType, 2026, 5, '2026-10-21')).toBe(expected)
  })

  it('JV แบบที่ผู้ใช้เลือก: JV-ลำดับ-DDMMYY รีเซ็ตรายวัน', () => {
    setFormat('JOURNAL', 'JV', { reset: 'DAY' })
    expect(formatDocumentNumber('JV', tenant, 'JOURNAL', 2026, 5, '2026-10-21')).toBe('JV-001-211026')
    expect(formatDocumentNumber('JV', tenant, 'JOURNAL', 2026, 5, '2026-10-21')).toBe('JV-002-211026')
    expect(formatDocumentNumber('JV', tenant, 'JOURNAL', 2026, 5, '2026-10-22')).toBe('JV-001-221026')
  })

  it('JV ใช้ความกว้างจาก Settings ไม่ว่าโค้ดส่ง pad เท่าไร', () => {
    setFormat('JOURNAL', 'JV', { padding: 5, date: 'NONE' })
    db.prepare('UPDATE document_number_formats SET date_format = ? WHERE tenant_id = ?').run('', tenant)
    expect(formatDocumentNumber('JV', tenant, 'JOURNAL', 2026, 6)).toBe('JV-00001')
  })

  it('ไม่ได้ตั้ง = รูปแบบเดิม (JV-ปี-ลำดับ)', () => {
    expect(formatDocumentNumber('JV', tenant, 'JOURNAL', 2026, 5)).toBe('JV-2026-00001')
    expect(formatDocumentNumber('JV', tenant, 'JOURNAL', 2026, 5)).toBe('JV-2026-00002')
  })

  it('reset_period ตามที่ตั้ง: DAY เริ่ม 001 ใหม่ทุกวัน, YEAR ต่อเนื่อง', () => {
    setFormat('PO', 'PO', { reset: 'DAY' })
    expect(formatDocumentNumber('PO', tenant, 'PO', 2026, 5, '2026-10-21')).toBe('PO-001-211026')
    expect(formatDocumentNumber('PO', tenant, 'PO', 2026, 5, '2026-10-21')).toBe('PO-002-211026')
    expect(formatDocumentNumber('PO', tenant, 'PO', 2026, 5, '2026-10-22')).toBe('PO-001-221026')
    setFormat('PO', 'PO', { reset: 'YEAR' })
    expect(formatDocumentNumber('PO', tenant, 'PO', 2026, 5, '2026-10-23')).toBe('PO-001-231026')
    expect(formatDocumentNumber('PO', tenant, 'PO', 2026, 5, '2026-10-24')).toBe('PO-002-241026')
  })

  it('เปลี่ยนรอบรีเซ็ตแล้วถังใหม่เริ่ม 1 → ข้ามเลขที่เคยออกไปแล้ว ไม่ซ้ำ', () => {
    setFormat('JOURNAL', 'JV', { reset: 'MONTH' })
    // เอกสารเดิมที่ออกไปแล้วด้วยรูปแบบก่อนหน้า ชนกับเลข 001 ของถังเดือนใหม่
    const ins = db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, description, total_debit, total_credit)
      VALUES (?, ?, ?, '2026-10-21', 'x', 0, 0)`)
    ins.run('je_a_' + tenant, tenant, 'JV-001-211026')
    ins.run('je_b_' + tenant, tenant, 'JV-002-211026')
    expect(formatDocumentNumber('JV', tenant, 'JOURNAL', 2026, 5, '2026-10-21')).toBe('JV-003-211026')
  })
})
