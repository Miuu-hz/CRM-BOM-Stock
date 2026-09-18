import { describe, it, expect } from 'vitest'
import { autoLayout } from './UnitChainEditor'

/**
 * เจ้าของเปิดผังของ "แตงกวา" แล้วเห็น [กรัม] [กิโลกรัม] วางข้างกันไม่มีเส้น
 * โดยหน่วยย่อยสุด (กรัม) อยู่ซ้าย — ผิดหลัก เพราะหน่วยนับสต็อกคือ "ปลายทาง" ของการแปลง
 *
 * ต้นเหตุ: autoLayout รูท BFS ที่ baseUnit แล้วเดินตามทิศ from -> to
 * แต่กฎเขียนทิศใหญ่ -> เล็ก (kg -> g) ดังนั้น adj[baseUnit] ว่าง
 * หน่วยใหญ่จึงตกไปกอง unvisited ที่วางเรียงแบบไม่มีความหมาย
 *
 * เทสต์นี้เรียก autoLayout ตัวจริงจากไฟล์ component ไม่ใช่ตรรกะที่ลอกมาไว้ที่อื่น
 */
const col = (pos: Record<string, { x: number; y: number }>, u: string) => pos[u]?.x
const rule = (id: string, from: string, to: string, f: number) =>
  ({ id, from_unit: from, to_unit: to, conversion_factor: f })

describe('autoLayout — หน่วยนับสต็อกต้องเป็นปลายทางเสมอ', () => {
  it('ไม่มีกฎเฉพาะสินค้าเลย (เคสแตงกวาที่เจ้าของเจอ) baseUnit ยังต้องอยู่ขวาสุด', () => {
    // แตงกวาจริง: base_unit=g, display_unit=kg, กฎเฉพาะสินค้า 0 แถว
    const pos = autoLayout(['g', 'kg'], [], 'g')
    expect(col(pos, 'kg')).toBeLessThan(col(pos, 'g')!)
  })

  it('โซ่ตรงเรียงตามทิศจริง ซ้ายไปขวา', () => {
    const pos = autoLayout(['pack', 'bottle', 'ml'], [
      rule('1', 'pack', 'bottle', 12),
      rule('2', 'bottle', 'ml', 720),
    ], 'ml')
    expect(col(pos, 'pack')).toBeLessThan(col(pos, 'bottle')!)
    expect(col(pos, 'bottle')).toBeLessThan(col(pos, 'ml')!)
  })

  it('กฎสองทิศทาง (วง) ต้องไม่พังเป็นจอว่าง และ baseUnit ยังอยู่ขวาสุด', () => {
    // ข้อมูลจริงเก็บทั้ง kg->g 1000 และ g->kg 0.001 เป็นคนละแถว
    const pos = autoLayout(['kg', 'g'], [
      rule('1', 'kg', 'g', 1000),
      rule('2', 'g', 'kg', 0.001),
    ], 'g')
    expect(Object.keys(pos)).toHaveLength(2)
    expect(col(pos, 'kg')).toBeLessThan(col(pos, 'g')!)
  })

  it('หน่วยลอยไม่เชื่อมใคร ต้องได้ตำแหน่งไม่ทับกัน', () => {
    const pos = autoLayout(['kg', 'g', 'box', 'roll'], [rule('1', 'kg', 'g', 1000)], 'g')
    const seen = new Set(Object.values(pos).map(p => p.x + ',' + p.y))
    expect(seen.size).toBe(4)
    expect(col(pos, 'g')).toBeGreaterThanOrEqual(Math.max(...Object.values(pos).map(p => p.x)))
  })

  it('ไม่มีหน่วยเลย ต้องคืนค่าว่าง ไม่ throw', () => {
    expect(autoLayout([], [], 'g')).toEqual({})
  })
})
