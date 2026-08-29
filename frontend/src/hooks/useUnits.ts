import { useState, useEffect } from 'react'
import api from '../services/api'
import { normalizeUnit, canonicalUnitCode } from '../utils/unitNormalize'
import i18n from '../i18n'

export type UnitCategory = 'count' | 'weight' | 'volume' | 'length' | 'area' | 'other'
export type UnitScope = 'base' | 'tenant' | 'material'

export interface UnitOption {
  /** รหัสหน่วย canonical เช่น 'pcs' — ใช้เป็น value ของ input */
  value: string
  /** ชื่อที่แสดง (ภาษาไทยล้วน ไม่มีวงเล็บซ้ำรหัส) เช่น 'ชิ้น' */
  label: string
  category?: UnitCategory
  scope?: UnitScope
  /** คำพ้อง/คำค้นเพิ่มเติม เช่น ['กก', 'กิโล', 'kg'] */
  aliases?: string[]
}

/** หน่วยที่มีอัตราแปลงเฉพาะ — ของสินค้าชิ้นนั้น หรือ override ทั้ง tenant */
export interface UnitSpecial {
  code: string
  label: string
  category?: UnitCategory
  scope: 'tenant' | 'material'
  factor: number
  baseUnit: string
  baseLabel: string
  /** ข้อความอธิบาย เช่น '1 แพ็ค = 30 ฟอง' */
  note: string
}

export const UNIT_LABELS: Record<string, string> = {
  pcs: 'ชิ้น', kg: 'กิโลกรัม', g: 'กรัม', mg: 'มิลลิกรัม', hg: 'ขีด',
  lb: 'ปอนด์', oz: 'ออนซ์', m: 'เมตร', cm: 'เซนติเมตร',
  mm: 'มิลลิเมตร', km: 'กิโลเมตร', inch: 'นิ้ว', ft: 'ฟุต',
  yard: 'หลา', l: 'ลิตร', ltr: 'ลิตร', ml: 'มิลลิลิตร',
  gallon: 'แกลลอน', roll: 'ม้วน', box: 'กล่อง', pack: 'แพ็ค',
  set: 'ชุด', pair: 'คู่', sheet: 'แผ่น', bottle: 'ขวด',
  bag: 'ถุง', sachet: 'ซอง', dozen: 'โหล', gross: 'กุรอส',
  case: 'ลัง', can: 'กระป๋อง', tube: 'หลอด', tablet: 'เม็ด',
  glass: 'แก้ว', tsp: 'ช้อนชา', tbsp: 'ช้อนโต๊ะ',
  plate: 'จาน', tray: 'ถาด', piece: 'ลูก', egg: 'ฟอง',
  item: 'รายการ', scoop: 'สกู๊ป',
  // เพิ่มใหม่ — พบใน stock_items จริง
  tank: 'ถัง', slice: 'สไลซ์', unit: 'หน่วย',
  m2: 'ตารางเมตร', cm2: 'ตารางเซนติเมตร',
}

/** หมวดของแต่ละหน่วย ใช้จัดกลุ่มใน UnitPicker */
export const UNIT_CATEGORY: Record<string, UnitCategory> = {
  pcs: 'count', pair: 'count', dozen: 'count', gross: 'count', set: 'count',
  box: 'count', pack: 'count', case: 'count', sheet: 'count', roll: 'count',
  bottle: 'count', bag: 'count', sachet: 'count', can: 'count', tube: 'count',
  tablet: 'count', glass: 'count', plate: 'count', tray: 'count', piece: 'count',
  egg: 'count', item: 'count', scoop: 'count', tank: 'count', slice: 'count',
  unit: 'count',
  kg: 'weight', g: 'weight', mg: 'weight', hg: 'weight', lb: 'weight', oz: 'weight',
  l: 'volume', ltr: 'volume', ml: 'volume', gallon: 'volume', tsp: 'volume', tbsp: 'volume',
  m: 'length', cm: 'length', mm: 'length', km: 'length', inch: 'length',
  ft: 'length', yard: 'length',
  m2: 'area', cm2: 'area',
}

/** คำพ้องสำหรับการค้นหา — พิมพ์ 'กก' หรือ 'กิโล' หรือ 'kg' ต้องเจอเหมือนกัน */
export const UNIT_ALIASES: Record<string, string[]> = {
  kg: ['กก', 'กก.', 'ก.ก.', 'กิโล', 'กิโลกรัม', 'kilo', 'kilogram'],
  g: ['กรัม', 'gram'],
  mg: ['มิลลิกรัม', 'milligram'],
  hg: ['ขีด'],
  l: ['ลิตร', 'ltr', 'litre', 'liter'],
  ml: ['มล', 'มล.', 'มิลลิลิตร', 'ซีซี', 'cc', 'millilitre'],
  pcs: ['ชิ้น', 'pc', 'piece', 'pieces', 'อัน'],
  pack: ['แพ็ค', 'แพ๊ค', 'แพค', 'แพ็ก', 'pkt'],
  box: ['กล่อง'],
  bottle: ['ขวด'],
  bag: ['ถุง'],
  sachet: ['ซอง'],
  set: ['ชุด'],
  sheet: ['แผ่น'],
  roll: ['ม้วน'],
  egg: ['ฟอง'],
  tsp: ['ช้อนชา', 'ชช'],
  tbsp: ['ช้อนโต๊ะ', 'ชต'],
  plate: ['จาน'],
  glass: ['แก้ว'],
  tray: ['ถาด'],
  piece: ['ลูก'],
  can: ['กระป๋อง'],
  case: ['ลัง'],
  tube: ['หลอด'],
  tablet: ['เม็ด'],
  item: ['รายการ'],
  scoop: ['สกู๊ป'],
  tank: ['ถัง'],
  slice: ['สไลซ์', 'slices'],
  unit: ['หน่วย'],
  dozen: ['โหล'],
  gross: ['กุรอส', 'โกรส'],
  pair: ['คู่'],
  m: ['เมตร'],
  cm: ['เซนติเมตร', 'ซม'],
  mm: ['มิลลิเมตร'],
  km: ['กิโลเมตร'],
  inch: ['นิ้ว'],
  ft: ['ฟุต'],
  yard: ['หลา'],
  gallon: ['แกลลอน'],
  m2: ['ตารางเมตร', 'ตร.ม.'],
  cm2: ['ตารางเซนติเมตร'],
  lb: ['ปอนด์'],
  oz: ['ออนซ์'],
}

/**
 * English names for the same canonical codes. Unit names used to be Thai-only,
 * so an English UI still read "ขวด" — the code is the identity, the label is
 * just how it is spelled for the reader.
 */
export const UNIT_LABELS_EN: Record<string, string> = {
  pcs: 'piece', kg: 'kilogram', g: 'gram', mg: 'milligram', hg: 'hectogram',
  lb: 'pound', oz: 'ounce', m: 'metre', cm: 'centimetre',
  mm: 'millimetre', km: 'kilometre', inch: 'inch', ft: 'foot',
  yard: 'yard', l: 'litre', ml: 'millilitre',
  gallon: 'gallon', fl_oz: 'fluid ounce', m2: 'square metre', cm2: 'square centimetre',
  roll: 'roll', box: 'box', pack: 'pack',
  set: 'set', pair: 'pair', sheet: 'sheet', bottle: 'bottle',
  bag: 'bag', sachet: 'sachet', dozen: 'dozen', gross: 'gross',
  case: 'case', can: 'can', tube: 'tube', tablet: 'tablet',
  glass: 'glass', tsp: 'teaspoon', tbsp: 'tablespoon',
  plate: 'plate', tray: 'tray', piece: 'unit', egg: 'egg',
  item: 'item', scoop: 'scoop', tank: 'tank', slice: 'slice',
  unit: 'unit',
}

const isEnglish = (): boolean => String(i18n.language || 'th').toLowerCase().startsWith('en')

/** Known display name for a code, or undefined when the code is custom. */
const knownLabel = (code: string): string | undefined =>
  isEnglish() ? (UNIT_LABELS_EN[code] ?? UNIT_LABELS[code]) : UNIT_LABELS[code]

const labelOf = (code: string): string => knownLabel(code) ?? code

/** Display name for a unit code in the reader's language. */
export const unitLabel = (unit: string | null | undefined): string => {
  if (!unit) return ''
  const code = canonicalUnitCode(normalizeUnit(String(unit)))
  return knownLabel(code) ?? code ?? String(unit)
}

const fmtFactor = (n: number): string => n.toLocaleString(isEnglish() ? 'en-US' : 'th-TH')

/**
 * Re-spell an already-loaded list for the current language. Labels are baked in
 * at fetch/cache time, so without this a language switch would keep showing the
 * names from whichever language was active when the list was built.
 */
const relabel = (list: UnitOption[]): UnitOption[] =>
  list.map(u => ({ ...u, label: knownLabel(u.value) ?? u.label ?? u.value }))

const relabelSpecials = (list: UnitSpecial[]): UnitSpecial[] =>
  list.map(s => {
    const label = knownLabel(s.code) ?? s.label ?? s.code
    const baseLabel = knownLabel(s.baseUnit) ?? s.baseLabel ?? s.baseUnit
    return { ...s, label, baseLabel, note: `1 ${label} = ${fmtFactor(s.factor)} ${baseLabel}` }
  })
const categoryOf = (code: string): UnitCategory => UNIT_CATEGORY[code] ?? 'other'
const aliasesOf = (code: string): string[] => UNIT_ALIASES[code] ?? []

const mkOption = (code: string, scope: UnitScope): UnitOption => ({
  value: code,
  label: labelOf(code),
  category: categoryOf(code),
  scope,
  aliases: aliasesOf(code),
})

/**
 * หน่วยมาตรฐาน built-in
 * หมายเหตุ: ใช้ 'l' (ไม่ใช่ 'ltr') ให้ตรงกับ DB และ backend
 */
export const BASE_UNITS: UnitOption[] = [
  'pcs', 'kg', 'hg', 'g', 'm', 'cm', 'yard', 'roll', 'box', 'pack',
  'set', 'pair', 'sheet', 'l', 'bottle', 'bag', 'sachet',
].map(c => mkOption(c, 'base'))

const BASE_SET = new Set(BASE_UNITS.map(u => u.value))

/** รวมรายการหน่วยแบบไม่ซ้ำ โดย canonicalize + normalize ก่อนเสมอ */
function dedupeUnits(list: UnitOption[]): UnitOption[] {
  const seen = new Map<string, UnitOption>()
  for (const u of list) {
    const code = canonicalUnitCode(normalizeUnit(u.value))
    if (!code) continue
    const existing = seen.get(code)
    if (existing) {
      // เก็บ scope ที่เจาะจงกว่าไว้ (material > tenant > base) และรวม alias
      const rank: Record<string, number> = { base: 0, tenant: 1, material: 2 }
      const merged: UnitOption = {
        ...existing,
        scope: rank[u.scope ?? 'base'] > rank[existing.scope ?? 'base'] ? u.scope : existing.scope,
        aliases: Array.from(new Set([...(existing.aliases ?? []), ...(u.aliases ?? [])])),
      }
      seen.set(code, merged)
      continue
    }
    seen.set(code, {
      ...u,
      value: code,
      label: u.label && u.label !== u.value ? u.label : labelOf(code),
      category: u.category ?? categoryOf(code),
      aliases: Array.from(new Set([...(u.aliases ?? []), ...aliasesOf(code)])),
    })
  }
  return Array.from(seen.values())
}

/** เก็บหน่วยจากแถว conversion (from_unit/to_unit) แบบ normalize แล้ว */
function harvestUnits(rows: any[], scope: UnitScope): UnitOption[] {
  const out: UnitOption[] = []
  for (const c of rows) {
    for (const raw of [c.from_unit, c.to_unit]) {
      if (!raw) continue
      const code = canonicalUnitCode(normalizeUnit(String(raw)))
      if (!code) continue
      out.push(mkOption(code, scope))
    }
  }
  return out
}

/**
 * สร้าง specials จากแถว conversion (ใช้ในโหมด fallback ตอน /catalog ยังไม่ deploy)
 * ข้ามแถวที่เป็นแค่ synonym (from == to หลัง normalize) เพราะไม่ได้ให้ข้อมูลอะไร
 */
function deriveSpecials(rows: any[], scope: 'tenant' | 'material'): UnitSpecial[] {
  const out = new Map<string, UnitSpecial>()
  for (const c of rows) {
    const from = canonicalUnitCode(normalizeUnit(String(c.from_unit ?? '')))
    const to = canonicalUnitCode(normalizeUnit(String(c.to_unit ?? '')))
    const factor = Number(c.conversion_factor ?? c.factor ?? 0)
    if (!from || !to || from === to) continue
    if (!factor || !isFinite(factor) || factor === 1) continue
    // เก็บอันแรกที่เจอต่อหนึ่งหน่วย (ถ้าหน่วยเดียวแปลงได้หลายทาง)
    if (out.has(from)) continue
    out.set(from, {
      code: from,
      label: labelOf(from),
      category: categoryOf(from),
      scope,
      factor,
      baseUnit: to,
      baseLabel: labelOf(to),
      note: `1 ${labelOf(from)} = ${factor.toLocaleString('th-TH')} ${labelOf(to)}`,
    })
  }
  return Array.from(out.values())
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface GlobalData { units: UnitOption[]; specials: UnitSpecial[] }

let globalExtraCache: GlobalData | null = null
let cachePromise: Promise<GlobalData> | null = null
/** ถ้า /catalog ตอบ 404 แล้วครั้งหนึ่ง ก็ไม่ต้องยิงซ้ำทุกครั้ง */
let catalogUnavailable = false

const EMPTY_GLOBAL: GlobalData = { units: [], specials: [] }

async function loadGlobalExtras(): Promise<GlobalData> {
  if (globalExtraCache !== null) return globalExtraCache
  if (!cachePromise) {
    cachePromise = api.get('/materials/unit-conversions/all')
      .then(res => {
        const all: any[] = res.data?.data ?? []
        const globals = all.filter(c => !c.material_id)
        const units = dedupeUnits(harvestUnits(globals, 'tenant'))
          .filter(u => !BASE_SET.has(u.value))
        globalExtraCache = { units, specials: deriveSpecials(globals, 'tenant') }
        return globalExtraCache
      })
      .catch(() => {
        cachePromise = null
        return EMPTY_GLOBAL
      })
  }
  return cachePromise
}

/** Call this after adding/deleting a global unit conversion */
export function invalidateUnitsCache() {
  globalExtraCache = null
  cachePromise = null
  catalogUnavailable = false
}

// ---------------------------------------------------------------------------
// Catalog API (contract ล็อกแล้ว — ห้ามเปลี่ยน)
// ---------------------------------------------------------------------------

interface CatalogResult { units: UnitOption[]; specials: UnitSpecial[] }

async function loadCatalog(materialId?: string | null): Promise<CatalogResult | null> {
  if (catalogUnavailable) return null
  try {
    const qs = materialId ? `?materialId=${encodeURIComponent(materialId)}` : ''
    const res = await api.get(`/materials/unit-conversions/catalog${qs}`)
    const data = res.data?.data
    if (!data || !Array.isArray(data.units)) return null

    const units: UnitOption[] = data.units.map((u: any) => {
      const code = canonicalUnitCode(normalizeUnit(String(u.code ?? '')))
      return {
        value: code,
        label: u.label || labelOf(code),
        category: (u.category as UnitCategory) || categoryOf(code),
        scope: (u.scope as UnitScope) || 'base',
        aliases: Array.from(new Set([...(u.aliases ?? []), ...aliasesOf(code)])),
      }
    })

    const specials: UnitSpecial[] = (data.specials ?? []).map((s: any) => {
      const code = canonicalUnitCode(normalizeUnit(String(s.code ?? '')))
      const baseUnit = canonicalUnitCode(normalizeUnit(String(s.baseUnit ?? '')))
      const factor = Number(s.factor ?? 0)
      const baseLabel = s.baseLabel || labelOf(baseUnit)
      const label = s.label || labelOf(code)
      return {
        code,
        label,
        category: (s.category as UnitCategory) || categoryOf(code),
        scope: s.scope === 'tenant' ? 'tenant' : 'material',
        factor,
        baseUnit,
        baseLabel,
        note: s.note || `1 ${label} = ${factor.toLocaleString('th-TH')} ${baseLabel}`,
      }
    })

    return { units: dedupeUnits(units), specials }
  } catch (e: any) {
    // 404 = ยังไม่ deploy — จำไว้ ไม่ต้องยิงซ้ำ
    if (e?.response?.status === 404) catalogUnavailable = true
    return null
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns a merged unit list:
 *  - ถ้า /catalog ใช้ได้ → ใช้ผลจาก backend ตรง ๆ
 *  - ถ้าไม่ได้ (404/error) → fallback: BASE_UNITS + global conversions + material conversions
 *    โดย normalize + dedupe ให้ถูกต้อง จึงไม่มีหน่วยซ้ำ
 */
export function useUnits(materialId?: string | null): {
  units: UnitOption[]
  specials: UnitSpecial[]
  loading: boolean
} {
  const lang = isEnglish() ? 'en' : 'th'
  const [units, setUnits] = useState<UnitOption[]>(() => relabel(BASE_UNITS))
  const [specials, setSpecials] = useState<UnitSpecial[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    async function load() {
      try {
        // 1) ทางหลัก — catalog endpoint
        const catalog = await loadCatalog(materialId)
        if (catalog) {
          if (!cancelled) {
            setUnits(relabel(catalog.units))
            setSpecials(relabelSpecials(catalog.specials))
          }
          return
        }

        // 2) fallback — logic เดิมแต่ normalize/dedupe แล้ว
        const extras = await loadGlobalExtras()
        let result: UnitOption[] = [...BASE_UNITS, ...extras.units]
        let sp: UnitSpecial[] = [...extras.specials]

        if (materialId) {
          const res = await api.get(`/materials/unit-conversions?materialId=${encodeURIComponent(materialId)}`)
          const matConvs: any[] = res.data?.data ?? []
          result = [...result, ...harvestUnits(matConvs, 'material')]
          const matSpecials = deriveSpecials(matConvs, 'material')
          // หน่วยพิเศษระดับสินค้า ทับของระดับ tenant ที่รหัสเดียวกัน
          const matCodes = new Set(matSpecials.map(s => s.code))
          sp = [...matSpecials, ...sp.filter(s => !matCodes.has(s.code))]
        }

        if (!cancelled) {
          setUnits(relabel(dedupeUnits(result)))
          setSpecials(relabelSpecials(sp))
        }
      } catch {
        if (!cancelled) {
          setUnits(relabel(BASE_UNITS))
          setSpecials([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [materialId, lang])

  return { units, specials, loading }
}

// export ไว้ให้ UnitPicker / test ใช้ซ้ำได้
export { dedupeUnits, harvestUnits, deriveSpecials, labelOf as unitLabelOf, categoryOf as unitCategoryOf }
