import { describe, it, expect, vi, afterEach } from 'vitest'
import { getRange } from './dashboard.routes'

// เซิร์ฟเวอร์รัน UTC: 23:30 UTC ของวันที่ 6 = 06:30 เช้าวันที่ 7 ตามเวลาไทย
describe('dashboard getRange ใช้เวลาไทย', () => {
  afterEach(() => { vi.useRealTimers() })

  it('ก่อน 7 โมงเช้าไทย แท็บวันนี้ต้องเป็นวันไทย ไม่ใช่เมื่อวานตาม UTC', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T23:30:00Z'))
    expect(getRange('day', 0)).toEqual({ start: '2026-10-07', end: '2026-10-07' })
    expect(getRange('week', 0)).toEqual({ start: '2026-10-01', end: '2026-10-07' })
    expect(getRange('year', 0)).toEqual({ start: '2026-01-01', end: '2026-10-07' })
  })
})

// แดชบอร์ดต้องกรองบริษัทเสมอ แม้เป็น MASTER — เดิม OR ? = MASTER ทำให้ MASTER เห็นยอดทุกบริษัทปนกัน
it("dashboard ไม่มีทางลัด MASTER ข้าม tenant", async () => {
  const fs = await import("fs")
  const src = fs.readFileSync(__dirname + "/dashboard.routes.ts", "utf8")
  expect(src).not.toMatch(/OR \? = .MASTER./)
})
