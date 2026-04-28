import { useState, useEffect } from 'react'
import api from '../services/api'

export interface UnitOption {
  value: string
  label: string
}

export const UNIT_LABELS: Record<string, string> = {
  pcs: 'ชิ้น', kg: 'กิโลกรัม', g: 'กรัม', mg: 'มิลลิกรัม',
  lb: 'ปอนด์', oz: 'ออนซ์', m: 'เมตร', cm: 'เซนติเมตร',
  mm: 'มิลลิเมตร', km: 'กิโลเมตร', inch: 'นิ้ว', ft: 'ฟุต',
  yard: 'หลา', l: 'ลิตร', ltr: 'ลิตร', ml: 'มิลลิลิตร',
  gallon: 'แกลลอน', roll: 'ม้วน', box: 'กล่อง', pack: 'แพ็ค',
  set: 'ชุด', pair: 'คู่', sheet: 'แผ่น', bottle: 'ขวด',
  bag: 'ถุง', sachet: 'ซอง', dozen: 'โหล', gross: 'กุรอส',
  case: 'ลัง', can: 'กระป๋อง', tube: 'หลอด', tablet: 'เม็ด',
}

export const BASE_UNITS: UnitOption[] = [
  { value: 'pcs', label: 'ชิ้น' },
  { value: 'kg', label: 'กิโลกรัม' },
  { value: 'g', label: 'กรัม' },
  { value: 'm', label: 'เมตร' },
  { value: 'cm', label: 'เซนติเมตร' },
  { value: 'yard', label: 'หลา' },
  { value: 'roll', label: 'ม้วน' },
  { value: 'box', label: 'กล่อง' },
  { value: 'pack', label: 'แพ็ค' },
  { value: 'set', label: 'ชุด' },
  { value: 'pair', label: 'คู่' },
  { value: 'sheet', label: 'แผ่น' },
  { value: 'ltr', label: 'ลิตร' },
  { value: 'bottle', label: 'ขวด' },
  { value: 'bag', label: 'ถุง' },
  { value: 'sachet', label: 'ซอง' },
]

const getLabel = (u: string): string =>
  UNIT_LABELS[u] ? `${UNIT_LABELS[u]} (${u})` : u

const BASE_SET = new Set(BASE_UNITS.map(u => u.value))

// Module-level cache — invalidated when conversions change
let globalExtraCache: UnitOption[] | null = null
let cachePromise: Promise<UnitOption[]> | null = null

async function loadGlobalExtras(): Promise<UnitOption[]> {
  if (globalExtraCache !== null) return globalExtraCache
  if (!cachePromise) {
    cachePromise = api.get('/materials/unit-conversions/all')
      .then(res => {
        const all: any[] = res.data.data ?? []
        const extras = new Map<string, UnitOption>()
        for (const c of all) {
          if (c.material_id) continue // skip per-material here
          for (const u of [c.from_unit, c.to_unit]) {
            if (!BASE_SET.has(u) && !extras.has(u)) {
              extras.set(u, { value: u, label: getLabel(u) })
            }
          }
        }
        globalExtraCache = Array.from(extras.values())
        return globalExtraCache
      })
      .catch(() => {
        cachePromise = null
        return []
      })
  }
  return cachePromise
}

/** Call this after adding/deleting a global unit conversion */
export function invalidateUnitsCache() {
  globalExtraCache = null
  cachePromise = null
}

/**
 * Returns a merged unit list:
 *  - BASE_UNITS (hardcoded standards)
 *  - Extra units from global conversions (tenant-wide)
 *  - If materialId provided: also extra units from that material's conversions
 */
export function useUnits(materialId?: string | null): {
  units: UnitOption[]
  loading: boolean
} {
  const [units, setUnits] = useState<UnitOption[]>(BASE_UNITS)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    async function load() {
      try {
        const extras = await loadGlobalExtras()
        let result = [...BASE_UNITS, ...extras]

        if (materialId) {
          const res = await api.get(`/materials/unit-conversions?materialId=${materialId}`)
          const matConvs: any[] = res.data.data ?? []
          const existing = new Set(result.map(u => u.value))
          for (const c of matConvs) {
            for (const u of [c.from_unit, c.to_unit]) {
              if (!existing.has(u)) {
                result.push({ value: u, label: getLabel(u) })
                existing.add(u)
              }
            }
          }
        }

        if (!cancelled) setUnits(result)
      } catch {
        if (!cancelled) setUnits(BASE_UNITS)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [materialId])

  return { units, loading }
}
