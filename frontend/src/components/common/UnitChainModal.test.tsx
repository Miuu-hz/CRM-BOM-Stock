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
import UnitChainModal from './UnitChainModal'

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

  it('อัตราขัดกับกฎเดิม (409) → ถามในหน้าต่าง · กลับไปแก้ไม่บันทึก · บันทึกทับส่ง force', async () => {
    const conflict = { fromLabel: 'กล่อง', toLabel: 'มิลลิลิตร', newFactor: 500, existingFactor: 1000, pathLabels: ['กล่อง', 'ลิตร', 'มิลลิลิตร'], message: 'ขัดกับกฎที่มีอยู่' }
    apiMock.post.mockImplementation(async (_url: string, body: any) => {
      if (!body.force) throw { response: { status: 409, data: { code: 'UNIT_CONVERSION_CONFLICT', message: conflict.message, data: conflict } } }
      rules = [...rules, { id: 'r1', ...body }]
      return { data: { success: true } }
    })
    renderBill()
    fireEvent.click(await screen.findByText('unitPicker.unreachableHintLink'))
    const input = await screen.findByPlaceholderText('เช่น 24')
    fireEvent.change(input, { target: { value: '500' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText('กล่อง → ลิตร → มิลลิลิตร')).toBeTruthy()
    // Esc = กลับไปแก้ ไม่ปิดผัง
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByPlaceholderText('เช่น 24')).toBeTruthy()
    expect(apiMock.post).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(screen.getByPlaceholderText('เช่น 24'), { key: 'Enter' })
    fireEvent.click(await screen.findByText('settings.unitConversions.conflict.override'))
    await waitFor(() => expect(apiMock.post).toHaveBeenLastCalledWith('/materials/unit-conversions', {
      material_id: 'm1', from_unit: 'box', to_unit: 'ml', conversion_factor: 500, force: true,
    }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.queryByPlaceholderText('เช่น 24')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'ผังการแปลงหน่วย' })).toBeTruthy()
  })

  // เดิมใช้ window.confirm — ตอนนี้ถามในกล่องของแอปเอง แบบเดียวกับกล่องกฎขัดกัน
  describe('ลบกฎต้องถามในกล่องของแอป', () => {
    const renderModal = () => {
      rules = [{ id: 'r9', from_unit: 'pack', to_unit: 'box', conversion_factor: 6 }]
      apiMock.delete.mockReset().mockImplementation(async (url: string) => {
        rules = rules.filter(r => !url.endsWith('/' + r.id))
        return { data: { success: true } }
      })
      const onClose = vi.fn()
      render(<UnitChainModal materialId="m1" baseUnit="ml" unit="box" onClose={onClose} />)
      return { onClose }
    }

    it('ลบจากป้ายกฎ: Esc ปิดแค่กล่องถาม ไม่ลบ ไม่ปิดผัง · กดลบแล้วค่อยยิง DELETE', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm')
      const { onClose } = renderModal()
      fireEvent.click(await screen.findByTitle('ลบกฎนี้'))

      const dlg = await screen.findByRole('alertdialog')
      expect(dlg.textContent).toContain('ถาวร')
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog', { name: 'ผังการแปลงหน่วย' })).toBeTruthy()
      expect(apiMock.delete).not.toHaveBeenCalled()

      fireEvent.click(screen.getByTitle('ลบกฎนี้'))
      fireEvent.click(await screen.findByText('common.delete'))
      await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith('/materials/unit-conversions/r9'))
      expect(apiMock.delete).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(screen.queryByTitle('ลบกฎนี้')).toBeNull())
      expect(confirmSpy).not.toHaveBeenCalled()
      confirmSpy.mockRestore()
    })

    it('เอาหน่วยออกจากผัง: บอกจำนวนกฎที่จะหาย · ยกเลิกแล้วไม่ลบ', async () => {
      renderModal()
      await screen.findByTitle('ลบกฎนี้')
      // ปุ่ม X บนโหนด "กล่อง" (ผูกกฎ pack→box อยู่ 1 ข้อ)
      const removeBtn = screen.getAllByTitle('เอาหน่วยนี้ออก (ลบกฎแปลงที่ผูกอยู่ด้วย)')
        .find(b => b.closest('.rounded-xl')?.textContent?.includes('กล่อง'))
      fireEvent.click(removeBtn!)

      const dlg = await screen.findByRole('alertdialog')
      expect(dlg.textContent).toContain('1 ข้อ')
      fireEvent.click(screen.getByText('common.cancel'))
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(apiMock.delete).not.toHaveBeenCalled()
    })
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

// ฝั่งจัดซื้อใช้ restrict="strict" — เดิมแถวที่แปลงไม่ถึงเป็น disabled เฉยๆ ไม่มีทางไปตั้งหน่วยจากบิลเลย
describe('UnitPicker strict — คลิกหน่วยที่แปลงไม่ถึงแล้วตั้งอัตราได้ทันที', () => {
  // jsdom ไม่มี scrollIntoView (ดรอปดาวน์เลื่อนแถวที่ active เข้าจอ)
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })
  it('คลิกแถว → เปิดผัง ไม่เลือกหน่วยก่อน · บันทึกกฎแล้วปิด → เลือกหน่วยนั้นให้', async () => {
    const onChange = vi.fn()
    render(<UnitPicker value="ml" onChange={onChange} materialId="m1" baseUnit="ml" restrict="strict" />)
    fireEvent.click(screen.getAllByRole('button')[0])
    // แถวถูกวาดใหม่ตอน catalog โหลดเสร็จ — หาใหม่ทุกรอบจนผังเปิด (ไม่ถือ node เก่าที่หลุดจาก DOM)
    await screen.findAllByText(/unreachableRowSetup/)
    await waitFor(() => {
      const btn = screen.queryAllByText(/unreachableRowSetup/)[0]?.closest("button")
      if (btn) fireEvent.mouseDown(btn)
      expect(screen.getByRole("dialog")).toBeTruthy()
    })

    expect(onChange).not.toHaveBeenCalled()
    const input = await screen.findByPlaceholderText('เช่น 24')
    fireEvent.change(input, { target: { value: '1000' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/materials/unit-conversions', {
      material_id: 'm1', from_unit: 'box', to_unit: 'ml', conversion_factor: 1000,
    }))
    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }))
    expect(onChange).toHaveBeenCalledWith('box')
  })

  it('เปิดผังแล้วปิดโดยไม่บันทึก → ไม่เปลี่ยนหน่วย', async () => {
    const onChange = vi.fn()
    render(<UnitPicker value="ml" onChange={onChange} materialId="m1" baseUnit="ml" restrict="strict" />)
    fireEvent.click(screen.getAllByRole('button')[0])
    await screen.findAllByText(/unreachableRowSetup/)
    await waitFor(() => {
      const btn = screen.queryAllByText(/unreachableRowSetup/)[0]?.closest('button')
      if (btn) fireEvent.mouseDown(btn)
      expect(screen.getByRole('dialog')).toBeTruthy()
    })
    await screen.findByPlaceholderText('เช่น 24')
    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(apiMock.post).not.toHaveBeenCalled()
  })
})
