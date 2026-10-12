import { describe, it, expect } from 'vitest'
import purchaseSource from './Purchase.tsx?raw'

/**
 * Purchase.tsx (~6000 บรรทัด, ผูก api/auth/modal หลายชั้น) render จริงใน jsdom ไม่คุ้ม —
 * ตรวจที่ระดับซอร์สโค้ดแทนว่า 3 จุดที่แก้ยังอยู่ตรงกันและไม่หลุดคู่กัน:
 * 1) select หมวดค่าใช้จ่ายโผล่เฉพาะในเงื่อนไข item.skip_stock
 * 2) payload ทั้งสร้าง (submitOrderFlow) และแก้ไข (handleUpdateOrder) ส่ง expenseAccountId
 * 3) เลิกติ๊ก/ผูก SKU ต้องล้าง expense_account_id ไม่ให้ค้าง
 */
describe('ตัวเลือกหมวดค่าใช้จ่ายสำหรับบรรทัด "ไม่นับสต็อก" ใน PO', () => {
  it('select หมวดค่าใช้จ่ายอยู่หลังเงื่อนไข item.skip_stock เท่านั้น (ไม่โชว์ตลอด)', () => {
    const selectIdx = purchaseSource.indexOf("drAccounts.filter(a => a.type === 'EXPENSE')")
    expect(selectIdx).toBeGreaterThan(-1)
    // เงื่อนไข {item.skip_stock && ( ต้องอยู่ "เหนือ" select นี้ภายในระยะไม่กี่บรรทัด ไม่ใช่แค่โผล่ที่ไหนในไฟล์
    const precedingChunk = purchaseSource.slice(Math.max(0, selectIdx - 900), selectIdx)
    expect(precedingChunk).toContain('{item.skip_stock && (')
    expect(precedingChunk).toContain('purchase.orderModal.expenseCategory')
  })

  it('payload สร้าง PO และแก้ไข PO ทั้งสองทางส่ง expenseAccountId ตาม skip_stock', () => {
    const matches = purchaseSource.match(/expenseAccountId: item\.skip_stock \? \(item\.expense_account_id \|\| null\) : null,/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(2) // submitOrderFlow + handleUpdateOrder
  })

  it('เลิกติ๊ก "ไม่นับสต็อก" ต้องล้าง expense_account_id ไปด้วย', () => {
    expect(purchaseSource).toContain(
      "updateOrderItemFields(index, { skip_stock: e.target.checked, expense_account_id: e.target.checked ? item.expense_account_id : null })"
    )
  })

  it('ผูกรหัสสินค้า (SKU) ให้บรรทัดต้องล้าง expense_account_id ไปด้วย (เข้าคลังแล้วไม่ใช่ค่าใช้จ่ายอีก)', () => {
    expect(purchaseSource).toContain('expense_account_id: id ? null : item.expense_account_id,')
  })
})
