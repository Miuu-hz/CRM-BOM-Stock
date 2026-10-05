import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * คำเตือน "แปลงไม่ถึงหน่วยฐาน" ใต้ช่องหน่วยในบิล เดิมลิงก์พาไป /settings?tab=units
 * บิลที่กรอกค้างหายหมด → ต้องเปิดผังแปลงหน่วยซ้อนบนบิล บันทึกแล้วคำเตือนหายเองโดยไม่รีเฟรชหน้า
 */
vi.mock('react-i18next', async (orig) => ({ ...(await orig<typeof import('react-i18next')>()), useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'th' } }) }))

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))

// สถานะฝั่ง "backend" — เริ่มยังไม่มีกฎ กล่อง→ml
let rules: Array<{ id: string; from_unit: string; to_unit: string; conversion_factor: number }> = []
let denyList = false
const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }))
vi.mock('../../services/api', () => ({ default: apiMock }))

import UnitPicker from './UnitPicker'

beforeEach(() => {
  rules = []
  denyList = false
  navigate.mockReset()
  apiMock.get.mockReset().mockImplementation(async (url: string) => {
    if (url.startsWith('/materials/unit-conversions/catalog')) {
      return { data: { data: {
        units: [{ code: 'ml', category: 'volume' }, { code: 'box', category: 'count' }],
        specials: rules.map(r => ({ code: r.from_unit, baseUnit: r.to_unit, factor: r.conversion_factor, scope: 'material' })),
      } } }
    }
    if (url.startsWith('/materials/unit-conversions?materialId=m1')) {
      if (denyList) throw { response: { status: 403 } }
      return { data: { data: rules } }
    }
    throw new Error('unexpected GET ' + url)
  })
  apiMock.post.mockReset().mockImplementation(async (_url: string, body: any) => {
    rules = [...rules, { id: 'r1', ...body }]
    return { data: { success: true } }
  })
})

const renderBill = () => {
  const parentClick = vi.fn()
  render(
    <div onClick={parentClick}>
      <UnitPicker value="box" onChange={() => {}} materialId="m1" baseUnit="ml" />
    </div>,
  )
  return { parentClick }
}

describe('UnitPicker — แก้หน่วยที่แปลงไม่ถึงได้โดยไม่ออกจากบิล', () => {
  it('กดลิงก์แล้วเปิดผังซ้อน ไม่ navigate · บันทึกแล้วคำเตือนหายเอง', async () => {
    const { parentClick } = renderBill()
    fireEvent.click(await screen.findByText('unitPicker.unreachableHintLink'))

    expect(navigate).not.toHaveBeenCalled()
    // เปิดมาพร้อมช่องกรอกอัตรา กล่อง → มิลลิลิตร ให้เลย
    const input = await screen.findByPlaceholderText('เช่น 24')
    expect(screen.getByRole('dialog', { name: 'ผังการแปลงหน่วย' })).toBeTruthy()
    // คลิกในผังต้องไม่ไหลไปถึง backdrop ของบิล (บิลจะปิด)
    parentClick.mockClear()
    fireEvent.click(input)
    expect(parentClick).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '1000' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/materials/unit-conversions', {
      material_id: 'm1', from_unit: 'box', to_unit: 'ml', conversion_factor: 1000,
    }))
    await waitFor(() => expect(screen.queryByText('unitPicker.unreachableHint')).toBeNull())
  })

  it('ไม่มีสิทธิ์ → บอกเป็นภาษาไทย ไม่โชว์ฟอร์มเสีย', async () => {
    denyList = true
    renderBill()
    fireEvent.click(await screen.findByText('unitPicker.unreachableHintLink'))
    expect(await screen.findByText(/ไม่มีสิทธิ์ตั้งค่าการแปลงหน่วย/)).toBeTruthy()
    expect(screen.queryByPlaceholderText('เช่น 24')).toBeNull()
  })

  it('Esc ในช่องกรอกอัตรา ปิดแค่ช่องกรอก ไม่ปิดผังทั้งหน้าต่าง', async () => {
    renderBill()
    fireEvent.click(await screen.findByText('unitPicker.unreachableHintLink'))
    const input = await screen.findByPlaceholderText('เช่น 24')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByPlaceholderText('เช่น 24')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'ผังการแปลงหน่วย' })).toBeTruthy()
  })
})
