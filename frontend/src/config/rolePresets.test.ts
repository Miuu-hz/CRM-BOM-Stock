import { describe, it, expect } from 'vitest'
import { ROLE_PRESETS } from './rolePresets'

// กด "แคชเชียร์" แล้วแผนกถูกล้างเป็น [] → สิทธิ์หลุดหมด ออกใบกำกับจากบิล POS ไม่ได้ (2026-09-28)
describe('ROLE_PRESETS', () => {
  it('ทุกพรีเซ็ตต้องมีอย่างน้อย 1 แผนก', () => {
    for (const p of ROLE_PRESETS) expect(p.departments.length, p.key).toBeGreaterThan(0)
  })
  it('แคชเชียร์ได้แผนก POS แผนกเดียว (ใช้ได้แค่หน้าร้าน)', () => {
    expect(ROLE_PRESETS.find(p => p.key === 'cashier')?.departments).toEqual(['POS'])
  })
})
