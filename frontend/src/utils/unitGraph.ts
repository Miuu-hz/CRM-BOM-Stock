import { normalizeUnit } from './unitNormalize'

// กราฟกฎแปลงหน่วย + ราคาที่ผูกกับหน่วย — ชุดเดียวที่ทั้งโมดัลแก้ไขและโมดัลเพิ่มสินค้าใช้ร่วมกัน
// เดิมโค้ดชุดนี้อยู่ใน EditModal ก๊อปเดียว โมดัลเพิ่มสินค้าจึงไม่มีเลย ราคาค้างหน่วยเดิมเงียบ ๆ
// (ไฟล์นี้ตั้งใจไม่ผูกกับ React เพื่อเทสต์ตรรกะได้โดยไม่ต้อง render หน้า)

export type ConvRule = { from_unit: string; to_unit: string; factor: number }
export type UnitStep = { unit: string; factor: number; shared: boolean }
export type UnitGraph = Record<string, Array<{ to: string; factor: number; shared: boolean }>>

// กลุ่มที่ส่งมาก่อนถูกค้นเจอก่อนเมื่อเส้นทางยาวเท่ากัน ลำดับที่ควรส่งคือ
// กฎเฉพาะสินค้า → กฎกลางของร้าน → มาตราสากล (ตรงกับ buildConversionGraph ฝั่ง backend)
// shared = เส้นนี้ไม่ใช่กฎเจาะจงของสินค้าชิ้นนี้ (ใช้โชว์บนผังหน่วยว่าเป็นกฎที่ใช้ร่วมกัน)
export function buildUnitGraph(groups: Array<{ rules: ConvRule[]; shared: boolean }>): UnitGraph {
  const graph: UnitGraph = {}
  const addEdge = (a: string, b: string, f: number, shared: boolean) => {
    if (!a || !b || !f || f <= 0 || !isFinite(f)) return
    const na = normalizeUnit(a); const nb = normalizeUnit(b)
    if (na === nb) return
    if (!graph[na]) graph[na] = []
    if (!graph[nb]) graph[nb] = []
    graph[na].push({ to: nb, factor: f, shared })
    graph[nb].push({ to: na, factor: 1 / f, shared })
  }
  for (const group of groups) {
    for (const rule of group.rules) addEdge(rule.from_unit, rule.to_unit, Number(rule.factor), group.shared)
  }
  return graph
}

// เส้นทางน้อยทอดที่สุดจาก a ไป b พร้อมตัวคูณรายช่วง · null = แปลงไม่ได้จริง · [] = หน่วยเดียวกัน
export function pathBetween(graph: UnitGraph, from: string, to: string): UnitStep[] | null {
  const a = normalizeUnit(from); const b = normalizeUnit(to)
  if (!a || !b) return null
  if (a === b) return []
  const prev: Record<string, UnitStep> = {}
  const seen = new Set<string>([a])
  const queue = [a]
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur === b) break
    for (const e of graph[cur] ?? []) {
      if (seen.has(e.to)) continue
      seen.add(e.to)
      prev[e.to] = { unit: cur, factor: e.factor, shared: e.shared }
      queue.push(e.to)
    }
  }
  if (!seen.has(b)) return null
  const out: UnitStep[] = []
  let cur = b
  while (cur !== a) {
    const step = prev[cur]
    out.unshift({ unit: cur, factor: step.factor, shared: step.shared })
    cur = step.unit
  }
  return out
}

// ปัดให้สั้นที่สุดเท่าที่ยังแทนค่าเดิมได้ (คลาดไม่เกิน 1e-9 เชิงสัดส่วน)
// เดิมใช้ toFixed(4) ซึ่งมีพื้นแข็งอยู่ที่ 0.0001 — ราคาต่อหน่วยย่อยที่ต่ำกว่านั้นกลายเป็น 0
// แล้วรอบถัดไปฟังก์ชันนี้เห็น price = 0 เป็น falsy จึงคืน 0 ทันที คูณกลับขึ้นหน่วยใหญ่
// ไม่ได้อีกเลย (฿1/ขวด → ml → ขวด เคยได้ ฿0.90 กลับมา คลาด 10%)
// ปัดแบบเลขนัยสำคัญแก้ทั้งสองเรื่อง: ของถูกมากไม่หาย และสลับหน่วยกลับไปกลับมา
// ไม่โผล่เลขอย่าง 9.99999999999 ในช่องราคา
function tidy(x: number): number {
  if (!isFinite(x)) return x
  for (let digits = 2; digits <= 12; digits++) {
    const r = Number(x.toPrecision(digits))
    if (x === 0 || Math.abs(r - x) <= Math.abs(x) * 1e-9) return r
  }
  return x
}

// ราคาที่ซื้อมาผูกกับหน่วยซื้อ — เปลี่ยนหน่วยแล้วต้องคูณราคาตาม ไม่งั้น ฿10/ขวด กลายเป็น ฿10/ลัง
// แล้ว backend หารเป็น unit_cost ต่อหน่วยฐานผิดไปทั้งก้อนเงียบ ๆ (โซดา Kids House 2026-09-28)
// แปลงไม่ได้ = คงราคาเดิม แล้วปล่อยให้ backend ตีกลับ UNIT_CONVERSION_MISSING ตอนกดบันทึก
export function repriceForUnit(graph: UnitGraph, price: number, fromUnit: string, toUnit: string): number {
  if (!price || !fromUnit || !toUnit) return price
  const seg = pathBetween(graph, fromUnit, toUnit)
  if (seg === null) return price
  const perOld = seg.reduce((m, st) => m * st.factor, 1) // 1 หน่วยเดิม = perOld หน่วยใหม่
  return perOld > 0 ? tidy(price / perOld) : price
}
