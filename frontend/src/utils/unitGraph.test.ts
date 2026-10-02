import { describe, it, expect } from 'vitest'
import { buildUnitGraph, pathBetween, repriceForUnit, type ConvRule } from './unitGraph'

// ตัวช่วยสั้น ๆ: กฎชุดเดียวกลุ่มเดียว จะได้ไม่ต้องเขียน {rules, shared} ซ้ำทุกเทสต์
const g1 = (rules: ConvRule[], shared = true) => buildUnitGraph([{ rules, shared }])
const rule = (from_unit: string, to_unit: string, factor: number): ConvRule => ({ from_unit, to_unit, factor })

describe('buildUnitGraph — กฎหนึ่งข้อต้องเดินได้สองทาง', () => {
  it('kg→g factor 1000 ต้องได้ g→kg = 0.001 ให้เองโดยไม่ต้องกรอกกฎย้อนกลับ', () => {
    // เจ้าของร้านกรอกกฎทางเดียว ถ้ากราฟไม่ใส่ขากลับให้ การเปลี่ยนหน่วยกลับทางจะกลายเป็น
    // "แปลงไม่ได้" ทั้งที่ข้อมูลมีอยู่ครบ — เคยเป็นสาเหตุให้ราคาไม่ถูกคูณตอนสลับหน่วยกลับ
    const graph = g1([rule('kg', 'g', 1000)])
    expect(graph['kg']).toEqual([{ to: 'g', factor: 1000, shared: true }])
    expect(graph['g']).toEqual([{ to: 'kg', factor: 0.001, shared: true }])
  })

  it('ชื่อไทยกับรหัสต้องลงโหนดเดียวกัน — "กิโลกรัม" คือ kg ไม่ใช่หน่วยใหม่', () => {
    // ถ้า normalize ไม่ทำงาน กราฟจะมีโหนด "กิโลกรัม" แยกจาก "kg" แล้วหาเส้นทางไม่เจอ
    const graph = g1([rule('กิโลกรัม', 'กรัม', 1000)])
    expect(Object.keys(graph).sort()).toEqual(['g', 'kg'])
  })
})

describe('buildUnitGraph — กฎขยะต้องถูกทิ้ง ไม่ใช่ปล่อยให้ไปพังตอนคำนวณราคา', () => {
  // factor 0 หรือติดลบที่หลุดเข้ากราฟจะทำให้ perOld เป็น 0/ติดลบ แล้วราคากลายเป็น
  // Infinity หรือเลขติดลบไปเงียบ ๆ — ต้องกันที่ปากทางตั้งแต่สร้างกราฟ
  const junk: Array<[string, ConvRule]> = [
    ['factor 0', rule('kg', 'g', 0)],
    ['factor ติดลบ', rule('kg', 'g', -1000)],
    ['factor NaN', rule('kg', 'g', NaN)],
    ['factor Infinity', rule('kg', 'g', Infinity)],
    ['หน่วยต้นทางว่าง', rule('', 'g', 1000)],
    ['หน่วยปลายทางว่าง', rule('kg', '', 1000)],
  ]
  for (const [label, r] of junk) {
    it(`${label} ต้องไม่สร้างโหนดอะไรเลย`, () => {
      expect(g1([r])).toEqual({})
    })
  }

  it('from กับ to เป็นหน่วยเดียวกันหลัง normalize ต้องถูกทิ้ง ("กิโลกรัม" vs "kg")', () => {
    // กฎวนกลับตัวเองไม่ให้ข้อมูลอะไร แต่ทำให้ BFS มีเส้นวนเปล่า ๆ
    expect(g1([rule('กิโลกรัม', 'kg', 1)])).toEqual({})
  })
})

describe('pathBetween — หาเส้นทางแปลงหน่วย', () => {
  it('หน่วยเดียวกันคืน [] (ไม่ใช่ null) เพราะแปลงได้ แค่ไม่ต้องคูณอะไร', () => {
    // [] กับ null ต้องแยกกันให้ชัด: null = แปลงไม่ได้ ต้องคงราคาเดิมแล้วให้ backend ตีกลับ
    // ส่วน [] = แปลงได้ ตัวคูณ 1 ถ้าเหมาเป็น null จะกลายเป็นว่าเปลี่ยนหน่วยกลับตัวเองแล้วพัง
    const graph = g1([rule('kg', 'g', 1000)])
    expect(pathBetween(graph, 'kg', 'kg')).toEqual([])
    expect(pathBetween(graph, 'กิโลกรัม', 'kg')).toEqual([])
  })

  it('ไม่มีเส้นทางจริงคืน null', () => {
    const graph = g1([rule('kg', 'g', 1000)])
    expect(pathBetween(graph, 'ขวด', 'ลัง')).toBeNull()
  })

  it('หน่วยว่างคืน null ไม่ใช่ throw', () => {
    const graph = g1([rule('kg', 'g', 1000)])
    expect(pathBetween(graph, '', 'kg')).toBeNull()
    expect(pathBetween(graph, 'kg', '')).toBeNull()
  })

  it('เดินหลายทอดได้ และคืนตัวคูณครบทุกช่วง (ลัง → kg → g)', () => {
    // ผังหน่วยบนจอโชว์ทีละช่วงพร้อมตัวคูณ ถ้าคืนมาแค่ต้นทางปลายทางจะโชว์ "ลัง → กรัม"
    // แบบไม่มีตัวคูณ ซึ่งเป็นบั๊กที่เคยทำให้สองจอบอกคนละเรื่อง
    const graph = g1([rule('ลัง', 'kg', 15), rule('kg', 'g', 1000)])
    expect(pathBetween(graph, 'ลัง', 'กรัม')).toEqual([
      { unit: 'kg', factor: 15, shared: true },
      { unit: 'g', factor: 1000, shared: true },
    ])
  })
})

describe('pathBetween — ลำดับกลุ่มกฎเป็นตัวตัดสินเมื่อชี้คู่หน่วยเดียวกัน', () => {
  // กฎเฉพาะสินค้าต้องชนะมาตราสากล: ขนมจีน 1 ถุง = 250 กรัม ไม่ใช่ค่ากลางของทั้งร้าน
  // กลุ่มที่ส่งเข้ามาก่อนถูก BFS เจอก่อน เพราะ seen.add() ปิดโหนดนั้นทันทีที่เจอเส้นแรก
  const graph = buildUnitGraph([
    { rules: [rule('ลัง', 'ขวด', 6)], shared: false },   // กฎเฉพาะสินค้า
    { rules: [rule('ลัง', 'ขวด', 12)], shared: true },   // มาตราสากล/กฎกลาง
  ])

  it('กลุ่มแรกชนะ และ flag shared ต้องตรงกับกลุ่มที่ใช้จริง', () => {
    expect(pathBetween(graph, 'ลัง', 'ขวด')).toEqual([{ unit: 'bottle', factor: 6, shared: false }])
  })

  it('ขากลับก็ต้องใช้กฎกลุ่มแรกเหมือนกัน ไม่ใช่สลับไปใช้ของมาตราสากล', () => {
    const seg = pathBetween(graph, 'ขวด', 'ลัง')!
    expect(seg).toHaveLength(1)
    expect(seg[0].shared).toBe(false)
    expect(seg[0].factor).toBeCloseTo(1 / 6, 12)
  })
})

describe('repriceForUnit — ราคาต้องคูณตามหน่วยที่เลือกใหม่', () => {
  // 1 ลัง = 6 ขวด · ฿10/ขวด คือ ฿60/ลัง — ถ้าหารกลับด้านจะได้ ฿1.67/ลัง
  // แล้ว backend หารเป็น unit_cost ต่อหน่วยฐานผิดไปทั้งก้อน (เคสโซดา Kids House)
  const graph = g1([rule('ลัง', 'ขวด', 6)])

  it('ขวด → ลัง: ฿10 ต้องเป็น ฿60 ไม่ใช่ ฿1.67', () => {
    expect(repriceForUnit(graph, 10, 'ขวด', 'ลัง')).toBe(60)
  })

  it('ลัง → ขวด: ฿60 ต้องกลับมาเป็น ฿10', () => {
    expect(repriceForUnit(graph, 60, 'ลัง', 'ขวด')).toBe(10)
  })

  it('เดินหลายทอดก็คูณต่อกันครบ (kg → g: ฿250/kg = ฿0.25/g)', () => {
    const multi = g1([rule('kg', 'g', 1000)])
    expect(repriceForUnit(multi, 250, 'กิโลกรัม', 'กรัม')).toBe(0.25)
  })
})

describe('repriceForUnit — กรณีที่ต้องคงราคาเดิมไว้เฉย ๆ', () => {
  const graph = g1([rule('kg', 'g', 1000)])

  it('แปลงไม่ได้ = คงราคาเดิม ไม่ใช่ 0 หรือ NaN', () => {
    // ปล่อยให้ backend ตีกลับ UNIT_CONVERSION_MISSING ตอนกดบันทึกแทน
    // ถ้าเผลอคืน 0 ผู้ใช้จะเซฟราคา 0 ทับของเดิมโดยไม่มีอะไรเตือน
    expect(repriceForUnit(graph, 10, 'ขวด', 'ลัง')).toBe(10)
  })

  it('ราคา 0 คืน 0 ไม่ต้องไปเดินกราฟ', () => {
    expect(repriceForUnit(graph, 0, 'kg', 'g')).toBe(0)
  })

  it('หน่วยว่างคืนราคาเดิม', () => {
    expect(repriceForUnit(graph, 10, '', 'g')).toBe(10)
    expect(repriceForUnit(graph, 10, 'kg', '')).toBe(10)
  })

  it('หน่วยเดิมเดียวกันคืนราคาเดิม (ตัวคูณ 1)', () => {
    expect(repriceForUnit(graph, 10, 'kg', 'กิโลกรัม')).toBe(10)
  })

  it('ราคาที่มีทศนิยมหลายตำแหน่งต้องไม่ถูกปัดทิ้ง', () => {
    // เดิม toFixed(4) ปัดเหลือ 10.1235 แม้ตัวคูณเป็น 1 (ไม่ได้เปลี่ยนหน่วยเลย)
    // ตอนนี้ปัดแบบเลขนัยสำคัญ ค่าที่ผู้ใช้กรอกไว้จึงอยู่ครบ
    expect(repriceForUnit(graph, 10.123456, 'kg', 'kg')).toBe(10.123456)
  })

  it('ราคาต่ำกว่า 0.0001 ต้องไม่ถูกปัดเป็น 0', () => {
    // บั๊กเดิม: toFixed(4) มีพื้นแข็งที่ 0.0001 ของที่ถูกกว่านั้นกลายเป็น 0
    // แล้วรอบถัดไป repriceForUnit เห็น price = 0 เป็น falsy จึงคืน 0 ทันที
    // คูณกลับขึ้นหน่วยใหญ่ไม่ได้อีกเลย — ถ้าผู้ใช้กดเซฟตอนนั้นคือทุนหายทั้งแถว
    expect(repriceForUnit(graph, 0.000049, 'kg', 'kg')).toBe(0.000049)
  })
})

describe('repriceForUnit — สลับหน่วยกลับไปกลับมาต้องได้ราคาเดิม', () => {
  it('ตัวคูณจำนวนเต็มสวย ๆ กลับมาได้ค่าเดิมเป๊ะ', () => {
    const graph = g1([rule('ลัง', 'ขวด', 7)])
    const up = repriceForUnit(graph, 10, 'ขวด', 'ลัง')
    expect(up).toBe(70)
    expect(repriceForUnit(graph, up, 'ลัง', 'ขวด')).toBe(10)
  })

  it('ตัวคูณไม่ลงตัว — ฿10/ขวด (1 ขวด = 325 ml) ลงไป ml แล้วกลับได้ ฿10 เท่าเดิม', () => {
    // เดิมปัดเหลือ 0.0308 แล้วคูณกลับได้ 10.01 (คลาด 0.1%)
    const graph = g1([rule('ขวด', 'ml', 325)])
    const down = repriceForUnit(graph, 10, 'ขวด', 'มล.')
    expect(down).toBe(0.0307692308)
    expect(repriceForUnit(graph, down, 'มล.', 'ขวด')).toBe(10)
  })

  it('ของถูกในหน่วยย่อยมาก — ฿1/ขวด (1 ขวด = 3000 ml) กลับมาได้ ฿1 ไม่ใช่ ฿0.90', () => {
    // เคสที่พังหนักที่สุดของ toFixed(4): 1/3000 ปัดเหลือ 0.0003 คูณกลับได้ 0.9 คลาด 10%
    const graph = g1([rule('ขวด', 'ml', 3000)])
    const down = repriceForUnit(graph, 1, 'ขวด', 'มล.')
    expect(down).toBe(0.000333333333)
    expect(repriceForUnit(graph, down, 'มล.', 'ขวด')).toBe(1)
  })
})

describe('กราฟข้ามมิติ — กฎกลางของร้านลากน้ำหนักไปต่อกับปริมาตรได้', () => {
  it('กฎ g↔ml ของร้านทำให้ kg → g → ml เดินทะลุได้ และราคาถูกคูณตามค่าประมาณนั้น', () => {
    // กฎจริงของ Kids House: unit_conversions มีแถว g→ml factor 1 โน้ตว่า "cooking approx: 1g ≈ 1ml"
    // พอดึงกฎกลางของร้านเข้ากราฟ หน่วยน้ำหนักกับปริมาตรจึงเชื่อมกัน เดิมมาตราสากลแยกมิติสะอาด
    // ตาราง unit_conversions ไม่มีคอลัมน์มิติให้กันเลย เทสต์นี้จดพฤติกรรมปัจจุบันไว้
    // ว่า "ทะลุได้" ยังไม่ใช่ข้อสรุปว่าควรทะลุ — เจ้าของระบบยังไม่ตัดสินใจเรื่องนี้
    const graph = buildUnitGraph([
      { rules: [rule('g', 'ml', 1)], shared: true },
      { rules: [rule('kg', 'g', 1000)], shared: true },
    ])
    expect(pathBetween(graph, 'กิโลกรัม', 'มล.')).toEqual([
      { unit: 'g', factor: 1000, shared: true },
      { unit: 'ml', factor: 1, shared: true },
    ])
    expect(repriceForUnit(graph, 250, 'กิโลกรัม', 'มล.')).toBe(0.25)
  })
})
