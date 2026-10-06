import { describe, it, expect, vi, afterEach } from 'vitest'
import db from '../db/sqlite'
import { formatDocumentNumber, docYear } from './id'

// เซิร์ฟเวอร์รัน UTC: 23:30Z วันที่ 31 ธ.ค. = 06:30 น. วันที่ 1 ม.ค. ตามเวลาไทย
describe('เลขเอกสารใช้วันที่ตามเวลาไทย', () => {
  const tenant = 'test_docnum_' + Date.now()
  afterEach(() => {
    vi.useRealTimers()
    db.prepare('DELETE FROM document_number_formats WHERE tenant_id = ?').run(tenant)
    db.prepare('DELETE FROM document_sequences WHERE tenant_id = ?').run(tenant)
  })

  it('ออกเลขช่วงเช้ามืดได้วันที่/ปีของวันนี้ ไม่ใช่เมื่อวาน', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-12-31T23:30:00Z'))
    db.prepare(`INSERT INTO document_number_formats (tenant_id, doc_type, prefix, separator, date_format, padding, enabled)
      VALUES (?, 'PO', 'PO', '-', 'DDMMYY', 3, 1)`).run(tenant)
    expect(formatDocumentNumber('PO', tenant, 'PO', docYear(), 3)).toBe('PO-001-010127')
    expect(docYear()).toBe(2027)
    // timestamp ที่มีโซน → วันตามเวลาไทย · วันที่ล้วน → ไม่เลื่อน
    expect(docYear('2026-12-31T20:00:00.000Z')).toBe(2027)
    expect(formatDocumentNumber('PO', tenant, 'PO', 2026, 3, '2026-08-18')).toBe('PO-001-180826')
  })
})
