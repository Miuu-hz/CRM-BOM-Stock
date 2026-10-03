import { describe, it, expect } from 'vitest'
// อ่านไฟล์เป็นข้อความด้วย ?raw ของ Vite — ตามแบบ Purchase.guards.test.ts
import BOMModalSource from './BOMModal.tsx?raw'

const SRC: string = BOMModalSource

// บั๊กที่เจอ 2026-10-03: ปุ่ม "ตั้งค่าหน่วยส่วนกลาง" เปิด '/settings/unit-conversions'
// ซึ่งไม่มี route นี้จริง (App.tsx ไม่มี catch-all) จึงเปิดหน้าเปล่า
// Settings.tsx อ่าน ?tab= แทน ('units' จะเรนเดอร์ <UnitConversions/>)
describe('BOMModal.tsx — ปุ่มตั้งค่าหน่วยต้องลิงก์ไปแท็บที่มีจริง', () => {
  it('ห้ามเปิด /settings/unit-conversions ที่ไม่มี route', () => {
    expect(SRC).not.toContain("'/settings/unit-conversions'")
  })

  it('ต้องเปิด /settings?tab=units แทน', () => {
    expect(SRC).toContain('/settings?tab=units')
  })
})
