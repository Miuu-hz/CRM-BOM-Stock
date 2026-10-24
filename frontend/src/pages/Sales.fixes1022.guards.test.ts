import { describe, it, expect } from 'vitest'
// แบบแผนเดียวกับ Sales.guards.test.ts — อ่านซอร์สเป็นข้อความ (?raw)
import SalesSource from './Sales.tsx?raw'

const SRC: string = SalesSource
const slice = (from: string, to: string) => {
  const a = SRC.indexOf(from), b = SRC.indexOf(to, a < 0 ? 0 : a)
  if (a < 0) throw new Error('หาหมุดหัวไม่เจอ: ' + from)
  if (b < 0) throw new Error('หาหมุดท้ายไม่เจอ: ' + to)
  return SRC.slice(a, b)
}

describe('Sales.tsx — โมดัลปิดกะ/เปิดกะ (รอบแก้ 2026-10-22)', () => {
  const CLOSE = slice('const CloseShiftModal', 'const VoidBillModal')
  const OPEN = slice('const handleOpen', 'ModalShell title={t(\'sales.actions.openShift\')}')

  it('ปิดกะ: ดึง /pos-shifts/current ใหม่ตอนเปิดโมดัล และคิดยอดที่ควรมีจากข้อมูลสดนั้น ไม่ใช่ prop shift', () => {
    expect(CLOSE).toContain("api.get('/sales/pos-shifts/current')")
    expect(CLOSE).toContain('expectedShiftCash(cur)')
    expect(CLOSE).not.toContain('expectedShiftCash(shift)')
  })

  it('ปิดกะ: ช่องว่างไม่กลายเป็น 0 — ต้องเป็นตัวเลข >= 0 ถึงส่งได้', () => {
    expect(CLOSE).not.toMatch(/parseFloat\(closingCash\) \|\| 0/)
    expect(CLOSE).toContain('Number.isFinite(closingValue) || closingValue < 0')
  })

  it('เปิดกะ: ช่องว่าง/ติดลบถูกบล็อก ไม่ส่ง || 0', () => {
    expect(OPEN).not.toMatch(/parseFloat\(openingCash\) \|\| 0/)
    expect(OPEN).toContain('!Number.isFinite(opening) || opening < 0')
  })
})

describe('Sales.tsx — โมดัลใบลดหนี้: คำตอบเก่าต้องไม่ทับใบใหม่', () => {
  const EFFECT = slice('// โหมด "รับคืนสินค้า" — ดึงรายการสินค้า', 'const toggleLine')
  it('มี alive guard ใน cleanup และล้างรายการทันทีที่เปลี่ยนใบ', () => {
    expect(EFFECT).toContain('let alive = true')
    expect(EFFECT).toContain('return () => { alive = false }')
    expect((EFFECT.match(/if \(!alive\) return/g) || []).length).toBeGreaterThanOrEqual(2)
    expect(EFFECT.indexOf('setReturnLines([])')).toBeLessThan(EFFECT.indexOf('salesService.getInvoice'))
    expect(EFFECT.indexOf('setCreditableRemaining(null)')).toBeLessThan(EFFECT.indexOf('salesService.getInvoice'))
  })
})

describe('Sales.tsx — แถวรายการสินค้ามี key คงที่', () => {
  const EDITOR = slice('function LineItemsEditor', '// ─── Shared: Totals Summary')
  it('ใช้ _key เป็น React key ไม่ใช่ index', () => {
    expect(EDITOR).toContain('key={item._key')
    expect(EDITOR).not.toContain('<div key={i} className="bg-[var(--surface-2)] p-3')
    expect(EDITOR).toContain('_key: newLineKey()')
  })
})

describe('Sales.tsx — ตัวกรองวันที่ใช้วันที่ตามเครื่อง ไม่ตัด ISO UTC ตรง ๆ', () => {
  it('searchItems เทียบ localDateOf แทน slice(0, 10)', () => {
    const block = slice('const localDateOf', 'const [sort, setSort]')
    expect(block).toContain('toLocaleDateString')
    expect(block).not.toContain(".slice(0, 10) >= dateFrom")
    expect(block).not.toContain(".slice(0, 10) <= dateTo")
  })
})

describe('Sales.tsx — ปุ่ม → SO ซ่อนเมื่อใบเสนอราคามี SO ที่ไม่ยกเลิกแล้ว', () => {
  it('ทั้งตาราง การ์ด และโมดัลรายละเอียดเช็ค converted', () => {
    expect(SRC).toContain('convertedQtNumbers')
    expect((SRC.match(/q\.status === 'ACCEPTED' && !convertedQtNumbers\.has\(q\.quotation_number\)/g) || []).length).toBe(2)
    expect(SRC).toContain("quotation.status === 'ACCEPTED' && !alreadyConverted")
  })
})

describe('Sales.tsx — ใบแจ้งหนี้ที่ยกเลิกแสดงยอดค้าง 0', () => {
  it("รายการ (ตาราง+การ์ด) ไม่โชว์ balance_amount ของใบ CANCELLED", () => {
    expect((SRC.match(/formatCurrency\(inv\.status === 'CANCELLED' \? 0 : inv\.balance_amount\)/g) || []).length).toBe(2)
  })
})
