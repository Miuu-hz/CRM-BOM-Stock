import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * BrokenUnitsModal (ส่วนของหน้าคลังสินค้า) — เตือน "หน่วยมีปัญหา" และคลิกแถวเพื่อเปิด
 * UnitChainModal ตรงหน่วยที่ใช้อยู่จริง (ไม่ใช่หน่วยฐานเฉยๆ) เพื่อตั้งกฎแปลงได้ทันทีโดยไม่ออกจากหน้า
 * mock UnitChainModal เพราะมันยิง API ของตัวเองตอน mount — ที่นี่สนใจแค่ props ที่ส่งให้มันถูกไหม
 */
vi.mock('../components/common/UnitChainModal', () => ({
  default: (props: { materialId: string; baseUnit: string; unit: string }) => (
    <div data-testid="chain-modal">{props.materialId}|{props.baseUnit}|{props.unit}</div>
  ),
}))

import { BrokenUnitsModal, type BrokenUnitPair } from './Stock'

const items: BrokenUnitPair[] = [
  { stock_item_id: 's1', name: 'ผงแป้งทดสอบ', sku: 'MAT-001', base_unit: 'kg', unit: 'bag', used_in: ['bom', 'purchase_order'], count: 3 },
]

describe('BrokenUnitsModal', () => {
  it('open=false ไม่ render อะไรเลย', () => {
    const { container } = render(<BrokenUnitsModal open={false} items={items} onClose={vi.fn()} onFixed={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('แสดงจำนวนรายการ และคลิกแถวแล้วเปิด UnitChainModal ด้วยหน่วยที่ใช้จริง (ไม่ใช่หน่วยฐาน)', () => {
    render(<BrokenUnitsModal open items={items} onClose={vi.fn()} onFixed={vi.fn()} />)

    expect(screen.getByText('หน่วยมีปัญหา 1 รายการ')).toBeTruthy()
    expect(screen.queryByTestId('chain-modal')).toBeNull()

    fireEvent.click(screen.getByText('ผงแป้งทดสอบ'))

    // materialId=s1, baseUnit=kg, unit=bag — ไม่ใช่ kg|kg ที่เท่ากับไม่มีอะไรให้ตั้งค่า
    expect(screen.getByTestId('chain-modal').textContent).toBe('s1|kg|bag')
  })
})
