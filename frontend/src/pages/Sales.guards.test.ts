import { describe, it, expect } from 'vitest'
// อ่านซอร์สเป็นข้อความด้วย ?raw — Sales.tsx 4,400+ บรรทัดผูกกับ api/auth/i18n เต็มไปหมด
// render ทั้งหน้าในเทสต์แพงเกินคุ้ม บั๊กชุดนี้ (สถานะ PARTIAL ทางตัน, filter sellable) อ่านจากซอร์สจับได้ตรงกว่า
// แบบแผนเดียวกับ src/pages/Stock.guards.test.ts และ Purchase.guards.test.ts
import SalesSource from './Sales.tsx?raw'
import SalesServiceSource from '../services/sales.service.ts?raw'

const SRC: string = SalesSource
const slice = (from: string, to: string) => {
  const a = SRC.indexOf(from), b = SRC.indexOf(to, a < 0 ? 0 : a)
  // หมุดหาย = ขอบเขตผิด ต้องล้มเสียงดัง ไม่ใช่เงียบแล้วตัดไปจนจบไฟล์ (เหมือน Stock.guards.test.ts)
  if (a < 0) throw new Error('หาหมุดหัวไม่เจอ: ' + from)
  if (b < 0) throw new Error('หาหมุดท้ายไม่เจอ: ' + to)
  return SRC.slice(a, b)
}

describe('Sales.tsx — SO status PARTIAL ต้องไม่เป็นทางตัน (Sales audit 2026-10-04)', () => {
  it('soNextStatus (ปุ่มเดินสถานะในแถว/การ์ด) ต้องมีทางออกจาก PARTIAL', () => {
    const block = slice('const soNextStatus', '\n    }')
    expect(block).toMatch(/PARTIAL:\s*\{\s*status:\s*'DELIVERED'/)
  })

  it('nextStatus/nextLabel (ปุ่มเดินสถานะในโมดัลรายละเอียด SO) ต้องมีทางออกจาก PARTIAL', () => {
    expect(SRC).toMatch(/const nextStatus: Record<string, string> = \{[^}]*PARTIAL: 'DELIVERED'/)
    expect(SRC).toMatch(/const nextLabel: Record<string, string> = \{[^}]*PARTIAL:/)
  })

  it('ปุ่ม "สร้างใบแจ้งหนี้" ต้องเปิดให้ SO สถานะ PARTIAL ด้วย ไม่ใช่แค่ READY/DELIVERED', () => {
    // 4 จุด: แถวตาราง + การ์ด (OrdersContent) + ปุ่มในโมดัลรายละเอียด SO
    const matches = SRC.match(/\[('CONFIRMED',\s*'PROCESSING',\s*'READY',\s*'PARTIAL',\s*'DELIVERED',\s*'COMPLETED')\]\.includes/g) || []
    expect(matches.length).toBeGreaterThanOrEqual(3)
  })
})

describe('Sales.tsx — ปุ่ม "ออกใบส่งของ" ในโมดัลรายละเอียด SO', () => {
  it('เรียก endpoint ที่ backend เพิ่งเพิ่ม และไม่เสนอปุ่มซ้ำถ้ามีใบส่งของแล้ว', () => {
    expect(SRC).toContain("/delivery-order")
    expect(SRC).toContain('hasDeliveryOrder')
  })
})

describe('Sales.tsx — ราคา × หน่วย ในตัวแก้ไขรายการสินค้า (shared: QT/SO)', () => {
  const EDITOR = slice('function LineItemsEditor', '// ─── Shared: Totals Summary')

  it('เลือกสินค้าแล้วรีไพรซ์ด้วย factor จาก backend (endpoint เดียวกับ BOMModal ใช้)', () => {
    expect(EDITOR).toContain('/materials/unit-conversions/convert')
    expect(EDITOR).toContain('repriceRow')
  })

  it('พิมพ์ราคาเองต้องตั้ง priceEdited กันการเปลี่ยนหน่วยทับราคา', () => {
    expect(EDITOR).toContain('priceEdited: true')
    expect(EDITOR).toMatch(/!item\.priceEdited/)
  })
})

describe('sales.service.ts — ตัวเลือกสินค้าในหน้าขาย ต้องขอเฉพาะของที่ขายได้ (sellable=1)', () => {
  it('getProducts ต้องเรียก /stock?...sellable=1 ไม่ใช่ is_pos_enabled=false เดิม', () => {
    expect(SalesServiceSource).toContain('sellable=1')
    expect(SalesServiceSource).not.toContain('is_pos_enabled=false')
  })
})
