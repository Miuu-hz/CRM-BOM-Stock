import { describe, it, expect } from 'vitest'
// อ่านไฟล์เป็นข้อความด้วย ?raw ของ Vite (ตามแพทเทิร์นใน Purchase.guards.test.ts) —
// WorkOrders.tsx เป็นหน้าใหญ่ผูกกับ api/i18n/auth เต็มไปหมด render จริงในเทสต์แพงเกินคุ้ม
// สำหรับบั๊กที่เป็น "รูปแบบโค้ด" ล้วน ๆ แบบนี้ ตรวจที่ source text แทน
import WorkOrdersSource from './WorkOrders.tsx?raw'

const SRC: string = WorkOrdersSource

function sliceFn(name: string, nextName: string) {
  const start = SRC.indexOf(`function ${name}(`)
  const end = SRC.indexOf(`function ${nextName}(`)
  expect(start, `หา function ${name} ไม่เจอ`).toBeGreaterThan(-1)
  expect(end, `หา function ${nextName} ไม่เจอ`).toBeGreaterThan(start)
  return SRC.slice(start, end)
}

describe('WorkOrders.tsx — CreateWOModal ผูก stock map ด้วย item.id (fixes1005)', () => {
  const body = sliceFn('CreateWOModal', 'WODetailModal')

  it('ไม่มี item.material_id || item.materialId หลงเหลือ (stock_items ไม่มีคอลัมน์นี้)', () => {
    expect(body).not.toMatch(/item\.material_id\s*\|\|\s*item\.materialId/)
  })

  it('ใช้ item.id เป็นตัวผูกกับ stock map', () => {
    expect(body).toMatch(/const mid = item\.id/)
  })
})

describe('WorkOrders.tsx — IssueMaterialsModal เตือน+บล็อกของเกินสต็อก (fixes1005)', () => {
  const body = sliceFn('IssueMaterialsModal', 'ReceiveGoodsModal')

  it('ไม่มีคำเตือนแบบ sr-only ที่มองไม่เห็น (เช็คการใช้งานจริงเป็น className ไม่ใช่แค่คำในคอมเมนต์)', () => {
    expect(body).not.toMatch(/className="sr-only"/)
  })

  it('ปุ่มส่งต้อง disabled เมื่อมีแถวเกินสต็อก (hasShortRow)', () => {
    expect(body).toMatch(/disabled=\{saving \|\| hasShortRow\}/)
  })

  it('handleSubmit ต้องกันส่งเมื่อ hasShortRow', () => {
    expect(body).toMatch(/if \(items\.length === 0 \|\| hasShortRow\) return/)
  })

  it('ไม่มี alert( หลงเหลือในโมดัลนี้ (ใช้ toast.error แทน)', () => {
    expect(body).not.toContain('alert(')
    expect(body).toContain('toast.error(')
  })
})
