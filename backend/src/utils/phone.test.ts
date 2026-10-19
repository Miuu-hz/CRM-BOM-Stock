import { describe, it, expect } from 'vitest'
import { phoneDigits, normalizeThaiMobile, maskPhone } from './phone'

describe('phone', () => {
  it('เบอร์เดียวกันที่เขียนต่างแบบ ได้ตัวเลขชุดเดียวกัน', () => {
    for (const raw of ['0812345678', '081-234-5678', '081 234 5678', '+66 81 234 5678', '66812345678', '(081) 234-5678']) {
      expect(phoneDigits(raw), raw).toBe('0812345678')
    }
    expect(phoneDigits('+66 2 123 4567')).toBe('021234567')
    expect(phoneDigits(null)).toBe('')
    expect(phoneDigits('-')).toBe('')
  })

  it('สมาชิกต้องเป็นเบอร์มือถือ 10 หลัก', () => {
    expect(normalizeThaiMobile('+66 91 234 5678')).toBe('0912345678')
    expect(normalizeThaiMobile('021234567')).toBeNull()
    expect(normalizeThaiMobile('081234567')).toBeNull()
    expect(normalizeThaiMobile('08123456789')).toBeNull()
  })

  it('ปิดเบอร์ตรงกลาง', () => {
    expect(maskPhone('081-234-5678')).toBe('081-xxx-5678')
  })
})
