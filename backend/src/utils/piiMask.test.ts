import { describe, it, expect } from 'vitest'
import { maskName, maskPhone, maskAddress } from './piiMask'

describe('piiMask — กติกามาสก์ตาม docs/contracts/online-orders.md ข้อ 1', () => {
  describe('maskName', () => {
    it('ตรงตามตัวอย่างเจ้าของในสัญญาทุกข้อ', () => {
      expect(maskName('ธัชพงษ์')).toBe('ธัชพxxx')
      expect(maskName('ทีปกร สะอาดถิ่น')).toBe('ทีxxx สะอาดถxxx')
      expect(maskName('อร')).toBe('อxxx')
    })

    it('trim และยุบช่องว่างซ้อน', () => {
      expect(maskName('  ทีปกร   สะอาดถิ่น  ')).toBe('ทีxxx สะอาดถxxx')
    })

    it('รองรับคำสั้น 1–3 code point และค่าว่าง/null/undefined', () => {
      expect(maskName('ก')).toBe('กxxx')
      expect(maskName('สมช')).toBe('สxxx')
      expect(maskName('สมชา')).toBe('สxxx')
      expect(maskName('')).toBe('')
      expect(maskName('   ')).toBe('')
      expect(maskName(null)).toBe('')
      expect(maskName(undefined)).toBe('')
    })
  })

  describe('maskPhone', () => {
    it('ตรงตามตัวอย่างในสัญญา (แทนตัวเลข 3 ตัวสุดท้ายด้วย x คงอักขระอื่นไว้ตำแหน่งเดิม)', () => {
      expect(maskPhone('081-234-5678')).toBe('081-234-5xxx')
      expect(maskPhone('66812345678')).toBe('66812345xxx')
    })

    it('คงขีดคั่นที่อยู่ระหว่างตัวเลข 3 ตัวสุดท้าย', () => {
      expect(maskPhone('081-234-56-78')).toBe('081-234-5x-xx')
    })

    it('ไม่มีตัวเลข → คืนค่าเดิม; null/undefined → ว่าง', () => {
      expect(maskPhone('ไม่มีเบอร์')).toBe('ไม่มีเบอร์')
      expect(maskPhone('')).toBe('')
      expect(maskPhone(null)).toBe('')
      expect(maskPhone(undefined)).toBe('')
    })
  })

  describe('maskAddress', () => {
    it('ตรงตามตัวอย่างในสัญญาทุกข้อ', () => {
      expect(
        maskAddress('เลขที่ 858/7 หมู่ที่ 4 หมู่บ้าน บ้านฟิวเจอร์โซน ตำบลรอบเมือง อำเภอเมืองชัยภูมิ จังหวัดชัยภูมิ 36000'),
      ).toBe('เลขที่ xxx หมู่ที่ 4 หมู่บ้าน บ้านฟิวเจอร์โซน ตำบลรอบเมือง อำเภอเมืองชัยภูมิ จังหวัดชัยภูมิ 36000')

      expect(
        maskAddress('โรงเรียนรัฐราษฏร์อัปถัมภ์ 196 ม.7 ต.อ่างทอง อ.เมือง จ.ราชบุรี 70000'),
      ).toBe('โรงเรียนรัฐราษฏร์อัปถัมภ์ xxx ม.7 ต.อ่างทอง อ.เมือง จ.ราชบุรี 70000')
    })

    it('ข้ามตัวเลขหลังคำนำหน้าต้องห้าม (ม./หมู่/หมู่ที่/ซ./ซอย/ถ./ถนน/ต./อ./จ./ชั้น/ห้อง) และรหัสไปรษณีย์ 5 หลัก', () => {
      expect(maskAddress('ม.7 ต.อ่างทอง อ.เมือง จ.ราชบุรี 70000')).toBe('ม.7 ต.อ่างทอง อ.เมือง จ.ราชบุรี 70000')
      expect(maskAddress('หมู่ 4 ซ.5 ซอย 12 ถ.304 ถนน 9 ชั้น 2 ห้อง 405 10110')).toBe(
        'หมู่ 4 ซ.5 ซอย 12 ถ.304 ถนน 9 ชั้น 2 ห้อง 405 10110',
      )
      expect(maskAddress('ม.4 88/12-13 ซ.3 ถ.สุขุมวิท 10110')).toBe('ม.4 xxx ซ.3 ถ.สุขุมวิท 10110')
    })

    it('ไม่มีบ้านเลขที่หรือค่าว่าง → คืนค่าเดิม/ว่าง', () => {
      expect(maskAddress('หมู่บ้านแสนสุข ตำบลในเมือง อำเภอเมือง จังหวัดเชียงใหม่ 50000')).toBe(
        'หมู่บ้านแสนสุข ตำบลในเมือง อำเภอเมือง จังหวัดเชียงใหม่ 50000',
      )
      expect(maskAddress('')).toBe('')
      expect(maskAddress(null)).toBe('')
      expect(maskAddress(undefined)).toBe('')
    })
  })
})
