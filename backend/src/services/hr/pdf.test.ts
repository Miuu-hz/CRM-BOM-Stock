import { describe, it, expect } from 'vitest'
import { wrapThai, renderPdf } from './pdf'

describe('hr pdf', () => {
  it('wraps a 600-character Thai paragraph with no spaces into multiple lines fitting maxWidth with fake measure', () => {
    // 600-character Thai paragraph with no spaces
    const thaiParagraph = 'พนักงานตกลงปฏิบัติตามระเบียบข้อบังคับของบริษัทอย่างเคร่งครัดและจะไม่กระทำการใดอันก่อให้เกิดความเสียหายแก่บริษัทไม่ว่าทางตรงหรือทางอ้อม'
      .repeat(6)
      .slice(0, 600)
    expect(thaiParagraph.length).toBe(600)
    expect(thaiParagraph).not.toContain(' ')

    const maxWidth = 500
    const fakeMeasure = (s: string) => s.length * 7

    const lines = wrapThai(thaiParagraph, maxWidth, fakeMeasure)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(fakeMeasure(line)).toBeLessThanOrEqual(maxWidth)
    }
    expect(lines.join('')).toBe(thaiParagraph)
  })

  it('renders a PDF buffer starting with %PDF-', async () => {
    const buf = await renderPdf({
      title: 'สัญญาจ้างแรงงาน',
      companyName: 'บริษัท ทดสอบ จำกัด',
      bodyText: 'ข้อ 1 สัญญาจ้าง\nข้อ 2 การปฏิบัติงาน',
      signatures: ['นายจ้าง', 'ลูกจ้าง'],
    })
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
