import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * บั๊ก HIGH: BillingSettings เคยอ่านค่าตั้งต้นจาก localStorage (pos_billing_settings)
 * ซึ่งถูกล้างตอน logout แล้วไม่เคยโหลดค่าจริงจาก backend เลย — กด Save ทีเดียว
 * ค่า default (VAT ปิด) ทับ pos_vat_enabled ของจริงที่ POS ใช้คิดบิล (pos-bill.routes.ts)
 */
// Settings.tsx ลากเข้า UnitConversions/MaterialCategories ที่ import i18n/index.ts จริง (initReactI18next)
// mock ทั้งโมดูลแล้วไม่คืน initReactI18next จะพังตรงนั้น ต้อง spread ของจริงไว้ก่อน
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) }
})
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

const mockGet = vi.fn()
const mockUpdate = vi.fn()
vi.mock('../services/companySettings.service', () => ({
  default: { get: (...a: any[]) => mockGet(...a), update: (...a: any[]) => mockUpdate(...a) },
}))

import { BillingSettings } from './Settings'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('BillingSettings', () => {
  it('โหลดค่า VAT จริงจาก backend แทนค่า default ที่ค้างใน localStorage แล้ว Save ส่งค่านั้นกลับไป', async () => {
    // localStorage ยังมีค่าเก่า (VAT ปิด) ค้างอยู่ — ต้องไม่ใช้ค่านี้
    localStorage.setItem('pos_billing_settings', JSON.stringify({ vatEnabled: false, vatRate: 0, vatInclusive: false, serviceEnabled: false, serviceRate: 0 }))
    mockGet.mockResolvedValue({
      pos_vat_enabled: 1,
      pos_vat_rate: 7,
      pos_vat_inclusive: 0,
      pos_service_enabled: 0,
      pos_service_rate: 10,
    })
    mockUpdate.mockResolvedValue({})

    render(<BillingSettings />)

    // ค่าจาก backend (VAT เปิด, 7%) ต้องโผล่ ไม่ใช่ค่า default ที่ localStorage ค้างไว้
    await waitFor(() => expect(screen.getByDisplayValue('7')).toBeTruthy())

    fireEvent.click(screen.getByText('settings.settingsPage.billing.save'))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({
      pos_vat_enabled: true,
      pos_vat_rate: 7,
      pos_vat_inclusive: false,
      pos_service_enabled: false,
      pos_service_rate: 10,
    }))
  })

  it('ปุ่มบันทึกถูกปิดจนกว่าจะโหลดค่าจาก backend เสร็จ', async () => {
    let resolveGet!: (v: any) => void
    mockGet.mockImplementation(() => new Promise((r) => { resolveGet = r }))

    render(<BillingSettings />)

    expect((screen.getByRole('button', { name: 'common.loading' }) as HTMLButtonElement).disabled).toBe(true)

    // ตัว get() ถูกเรียกผ่าน dynamic import ซึ่งเป็น microtask อีกชั้น — รอให้ resolveGet ถูกตั้งค่าจริงก่อน
    await waitFor(() => expect(mockGet).toHaveBeenCalled())
    resolveGet({ pos_vat_enabled: 0, pos_vat_rate: 7, pos_vat_inclusive: 0, pos_service_enabled: 0, pos_service_rate: 10 })

    await waitFor(() => expect((screen.getByText('settings.settingsPage.billing.save') as HTMLButtonElement).disabled).toBe(false))
  })

  it('โหลดจาก backend ล้มเหลว ต้องแจ้ง toast.error ไม่ใช่เงียบ', async () => {
    mockGet.mockRejectedValue(new Error('network down'))
    const toast = (await import('react-hot-toast')).default as any

    render(<BillingSettings />)

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
  })
})
