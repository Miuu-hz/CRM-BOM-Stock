import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { VatModeSelector, VatModeField } from './VatModeSelector'

describe('VatModeSelector — ปุ่มเลือกโหมด VAT', () => {
  it('เรนเดอร์ครบ 3 ปุ่ม และปุ่มที่เลือกอยู่มี aria-checked=true', () => {
    const { container } = render(<VatModeSelector value="EXCLUSIVE" onChange={() => {}} />)
    const radios = container.querySelectorAll('[role="radio"]')
    expect(radios.length).toBe(3)
    const checked = Array.from(radios).filter(r => r.getAttribute('aria-checked') === 'true')
    expect(checked.length).toBe(1)
    expect(checked[0].textContent).toContain('บวก')
  })

  it('คลิกปุ่มอื่นต้องยิง onChange ด้วยโหมดที่ถูกต้อง', () => {
    const onChange = vi.fn()
    const { container } = render(<VatModeSelector value="NONE" onChange={onChange} />)
    const radios = container.querySelectorAll('[role="radio"]')
    fireEvent.click(radios[2]) // EXCLUSIVE
    expect(onChange).toHaveBeenCalledWith('EXCLUSIVE')
  })

  it('ลูกศรขวาต้องเลื่อนไปปุ่มถัดไปและเลือกให้เลย (ARIA radiogroup pattern)', () => {
    const onChange = vi.fn()
    const { container } = render(<VatModeSelector value="NONE" onChange={onChange} />)
    const radios = container.querySelectorAll('[role="radio"]')
    fireEvent.keyDown(radios[0], { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('INCLUSIVE')
  })

  it('locked=true ต้องปิดปุ่มทั้งหมดและโชว์เหตุผล ไม่ใช่ sourceHint', () => {
    const onChange = vi.fn()
    const { container } = render(
      <VatModeSelector value="NONE" onChange={onChange} locked={{ reason: 'ร้านยังไม่จดทะเบียน VAT' }} sourceHint="ไม่ควรเห็นบรรทัดนี้" />
    )
    const radios = container.querySelectorAll('[role="radio"]')
    radios.forEach(r => expect((r as HTMLButtonElement).disabled).toBe(true))
    expect(container.textContent).toContain('ร้านยังไม่จดทะเบียน VAT')
    expect(container.textContent).not.toContain('ไม่ควรเห็นบรรทัดนี้')
    fireEvent.click(radios[1])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('warning ต้องโชว์เป็นข้อความแยกจาก sourceHint', () => {
    const { container } = render(
      <VatModeSelector value="NONE" onChange={() => {}} warning="เตือนอะไรบางอย่าง" />
    )
    expect(container.textContent).toContain('เตือนอะไรบางอย่าง')
  })
})

describe('VatModeField — ฟอร์มผู้ติดต่อ มีตัวเลือก "ไม่ระบุ" เพิ่มมา', () => {
  it('มี 4 ปุ่ม (ไม่ระบุ + 3 โหมด) และค่า null เลือกปุ่มแรก', () => {
    const { container } = render(<VatModeField value={null} onChange={() => {}} />)
    const radios = container.querySelectorAll('[role="radio"]')
    expect(radios.length).toBe(4)
    expect(radios[0].getAttribute('aria-checked')).toBe('true')
  })

  it('เลือกโหมดจริงแล้วกลับไป "ไม่ระบุ" ได้ โดยส่ง null กลับ', () => {
    const onChange = vi.fn()
    const { container } = render(<VatModeField value="EXCLUSIVE" onChange={onChange} />)
    const radios = container.querySelectorAll('[role="radio"]')
    fireEvent.click(radios[0])
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
