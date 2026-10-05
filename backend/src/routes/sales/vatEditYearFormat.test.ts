import { describe, it, expect, beforeEach } from 'vitest'
import db from '../../db/sqlite'
import { formatDocumentNumber, getNextDocumentNumber } from '../../utils/id'
import { calcVat } from '../../utils/vat'

describe('VAT Inclusive calculation & Document Number Year reset', () => {
  const testTenant = 'test_tenant_cat3_' + Date.now()

  it('calcVat correctly extracts tax when inclusive: true', () => {
    // 107 baht with 7% VAT inclusive
    const result = calcVat(107, { rate: 7, inclusive: true })
    expect(result.totalAmount).toBe(107)
    expect(result.taxAmount).toBe(7)
    expect(result.subtotal).toBe(100)

    // Exclusive would have added 7% on top: 107 + 7.49 = 114.49
    const exclusiveResult = calcVat(107, { rate: 7, inclusive: false })
    expect(exclusiveResult.totalAmount).toBe(114.49)
    expect(exclusiveResult.taxAmount).toBe(7.49)
  })

  it('formatDocumentNumber uses currentYear for sequence when format has year', () => {
    const currentYear = new Date().getFullYear()

    // 1. Setup custom format with date_format = 'DDMMYY'
    db.prepare(`
      INSERT OR REPLACE INTO document_number_formats (tenant_id, doc_type, enabled, prefix, padding, date_format, separator, updated_at)
      VALUES (?, 'QUOTATION', 1, 'QT', 4, 'DDMMYY', '-', datetime('now'))
    `).run(testTenant)

    const docNum = formatDocumentNumber('QT', testTenant, 'QUOTATION')
    expect(docNum).toMatch(/^QT-0001-\d{6}$/)

    // Sequence in document_sequences should be keyed by currentYear, NOT 0
    const seqRow = db.prepare(
      'SELECT last_number FROM document_sequences WHERE tenant_id = ? AND doc_type = ? AND year = ?'
    ).get(testTenant, 'QUOTATION', currentYear) as any

    expect(seqRow).toBeDefined()
    expect(seqRow.last_number).toBe(1)
  })

  it('formatDocumentNumber uses year 0 when format date_format is NONE', () => {
    db.prepare(`
      INSERT OR REPLACE INTO document_number_formats (tenant_id, doc_type, enabled, prefix, padding, date_format, separator, updated_at)
      VALUES (?, 'PO', 1, 'PO', 4, 'NONE', '-', datetime('now'))
    `).run(testTenant)

    const docNum = formatDocumentNumber('PO', testTenant, 'PO')
    expect(docNum).toBe('PO-0001')

    const seqRow = db.prepare(
      'SELECT last_number FROM document_sequences WHERE tenant_id = ? AND doc_type = ? AND year = ?'
    ).get(testTenant, 'PO', 0) as any

    expect(seqRow).toBeDefined()
    expect(seqRow.last_number).toBe(1)
  })
})
