import { describe, it, expect } from 'vitest'
import { datePreset, readFilters, toApiParams, writeFilters, activeFilterChips } from './JournalColumnFilters'

describe('ตัวกรองสมุดรายวันใน URL', () => {
  it('อ่าน/เขียน search params กลับไปกลับมาได้ และไม่ใส่ค่าว่าง', () => {
    const sp = new URLSearchParams('types=POS_SALE,PAYROLL&from=2026-10-01&dmin=100&status=posted&junk=1')
    const f = readFilters(sp)
    expect(f.types).toEqual(['POS_SALE', 'PAYROLL'])
    expect(writeFilters(f).toString()).toBe('from=2026-10-01&dmin=100&types=POS_SALE%2CPAYROLL&status=posted')
    expect(writeFilters(readFilters(new URLSearchParams())).toString()).toBe('')
  })

  it('แปลงเป็น query ของ API', () => {
    const f = readFilters(new URLSearchParams('no=JV&to=2026-10-31&types=MANUAL&cmax=500&status=draft&acc=a1&q=ค่าไฟ'))
    expect(toApiParams(f)).toEqual({
      entryNumber: 'JV', endDate: '2026-10-31', referenceTypes: 'MANUAL', maxCredit: '500', isPosted: false, accountId: 'a1', q: 'ค่าไฟ',
    })
  })

  it('ปุ่มลัดวันที่ (เดือนก่อนข้ามปีได้)', () => {
    const now = new Date(2026, 0, 15)
    expect(datePreset('today', now)).toEqual({ from: '2026-01-15', to: '2026-01-15' })
    expect(datePreset('thisMonth', now)).toEqual({ from: '2026-01-01', to: '2026-01-31' })
    expect(datePreset('lastMonth', now)).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })

  it('ป้ายตัวกรอง — ล้างทีละประเภทได้', () => {
    const f = readFilters(new URLSearchParams('types=POS_SALE,PAYROLL&dmax=50'))
    const chips = activeFilterChips(f, t => t, id => id)
    expect(chips.map(c => c.label)).toEqual(['POS_SALE', 'PAYROLL', 'เดบิต ≤ 50'])
    expect(chips[0].clear).toEqual({ types: ['PAYROLL'] })
  })
})
