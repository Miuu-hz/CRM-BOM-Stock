import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * โซดา Kids House 2026-09-28: มีกฎ แพ็ค→ขวด (6) + ขวด→ml (325) ครบ backend แปลงได้ 1,950
 * แต่ช่องหน่วยใน PO เตือน "หน่วยนี้ยังไม่มีอัตราแปลงเป็นมิลลิลิตร" เพราะ isReachable ดูแค่ทอดเดียว
 */
vi.mock('react-i18next', async (orig) => ({ ...(await orig<typeof import('react-i18next')>()), useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'th' } }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../../hooks/useUnits', async (orig) => ({
  ...(await orig<typeof import('../../hooks/useUnits')>()),
  useUnits: () => ({
    loading: false,
    units: [
      { value: 'ml', label: 'มิลลิลิตร', category: 'volume' },
      { value: 'bottle', label: 'ขวด', category: 'count' },
      { value: 'pack', label: 'แพ็ค', category: 'count' },
      { value: "box", label: "กล่อง", category: "count" },
      { value: "set", label: "ชุด", category: "count" },
      { value: "pcs", label: "ชิ้น", category: "count" },
      { value: "dozen", label: "โหล", category: "count" },
      { value: "kg", label: "กิโลกรัม", category: "weight" },
      { value: "g", label: "กรัม", category: "weight" },
    ],
    specials: [
      { code: 'bottle', label: 'ขวด', category: 'count', scope: 'material', factor: 325, baseUnit: 'ml' },
      { code: 'pack', label: 'แพ็ค', category: 'count', scope: 'material', factor: 6, baseUnit: 'bottle' },
    ],
  }),
}))

import UnitPicker from './UnitPicker'

const warns = (value: string, baseUnit = 'ml') => {
  const { unmount } = render(<UnitPicker value={value} onChange={() => {}} baseUnit={baseUnit} restrict="strict" />)
  const found = screen.queryAllByText(/unitPicker\.unreachableHint/).length > 0
  unmount()
  return found
}

describe('UnitPicker — แปลงหลายทอด', () => {
  it('แพ็ค→ขวด→ml ต้องไม่เตือน', () => expect(warns('pack')).toBe(false))
  it('ขวด→ml ทอดเดียวยังผ่าน', () => expect(warns('bottle')).toBe(false))
  it('กล่องที่ไม่มีกฎจริงยังต้องเตือน', () => expect(warns('box')).toBe(true))

  it("ชุด→ชิ้น ไม่มีกฎ ต้องเตือน (หมวดนับเหมือนกันไม่ได้แปลว่าแปลงได้)", () => expect(warns("set", "pcs")).toBe(true))
  it("โหล→ชิ้น มาตราสากล ไม่เตือน", () => expect(warns("dozen", "pcs")).toBe(false))
  it("กก.→กรัม มาตราสากล ไม่เตือน", () => expect(warns("kg", "g")).toBe(false))
})
