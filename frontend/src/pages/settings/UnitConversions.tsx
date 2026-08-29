import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeftRight, Plus, Trash2, Edit2, Globe, Lock,
  Search, X, Save, ChevronDown, ChevronUp, Info, Package,
  Sparkles, CheckCircle2, AlertCircle, Network, AlertTriangle, Shuffle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { invalidateUnitsCache, UNIT_LABELS, unitLabel as unitLabelFor } from '../../hooks/useUnits'
import { normalizeUnit } from '../../utils/unitNormalize'
import UnitChainEditor from '../../components/common/UnitChainEditor'

interface UnitConversion {
  id: string
  material_id: string | null
  from_unit: string
  to_unit: string
  conversion_factor: number
  is_global: number
  notes?: string
  material_name?: string
  material_sku?: string
}

interface StandardConversion {
  from_unit: string
  to_unit: string
  factor: number
}

/** Payload of a 409 UNIT_CONVERSION_CONFLICT from the API. */
interface ConversionConflict {
  fromLabel: string
  toLabel: string
  newFactor: number
  existingFactor: number
  pathLabels: string[]
  message: string
}

interface StockItem {
  id: string
  name: string
  sku: string
  unit: string
}

/** Shape returned by GET /materials/unit-conversions/catalog (optional endpoint) */
interface CatalogSpecial {
  code: string
  label?: string
  category?: string
  scope?: string
  factor?: number
  baseUnit?: string
  baseLabel?: string
  note?: string
}

const ul = (u: string) => (UNIT_LABELS[u] ? `${u} (${unitLabelFor(u)})` : u)
const unitLabel = (u: string) => unitLabelFor(u)

// ── Unit categories ────────────────────────────────────────────────
// Used only for advisory badges/warnings — never blocks the user.
const UNIT_CATEGORY: Record<string, string> = {}
const registerCategory = (cat: string, units: string[]) => units.forEach(u => { UNIT_CATEGORY[u] = cat })
registerCategory('weight', ['mg', 'g', 'hg', 'kg', 'ton', 'lb', 'oz'])
registerCategory('volume', ['ml', 'cc', 'l', 'ltr', 'gallon', 'tsp', 'tbsp', 'cup'])
registerCategory('length', ['mm', 'cm', 'm', 'km', 'inch', 'ft', 'yard'])
registerCategory('area', ['m2', 'cm2'])
registerCategory('count', ['pcs', 'piece', 'dozen', 'gross', 'pair', 'item', 'egg', 'tablet', 'sheet'])
registerCategory('container', [
  'pack', 'box', 'case', 'bag', 'set', 'bottle', 'can', 'sachet', 'tube',
  'roll', 'glass', 'plate', 'tray', 'scoop', 'carton', 'crate', 'drum', 'bundle', 'tank',
])

/**
 * Packaging units whose meaning is product-specific.
 * "1 pack = 12 pcs" for most goods, but "1 pack of eggs = 30 eggs".
 * A tenant-wide rule built on these silently hits every product.
 */
const PACKAGING_UNITS = new Set([
  'pack', 'box', 'case', 'bag', 'set', 'carton', 'crate', 'bundle', 'tray', 'drum',
])

const categoryOf = (u: string): string | null => UNIT_CATEGORY[normalizeUnit(u)] ?? null
const isPackagingUnit = (u: string) => PACKAGING_UNITS.has(normalizeUnit(u))
const isCrossCategory = (from: string, to: string) => {
  const a = categoryOf(from)
  const b = categoryOf(to)
  return !!a && !!b && a !== b
}
const pairKey = (from: string, to: string) => `${normalizeUnit(from)}|${normalizeUnit(to)}`

export default function UnitConversions() {
  const { t } = useTranslation()
  const [allConversions, setAllConversions] = useState<UnitConversion[]>([])
  const [standards, setStandards] = useState<StandardConversion[]>([])
  const [catalogSpecials, setCatalogSpecials] = useState<CatalogSpecial[]>([])
  const [catalogUnits, setCatalogUnits] = useState<Array<{ value: string; label: string }>>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<UnitConversion | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    weight: true, length: true, volume: false, count: true,
  })

  // Form state
  const [fromUnit, setFromUnit] = useState('')
  const [toUnit, setToUnit] = useState('')
  const [factor, setFactor] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Path checker state (advisor panel)
  const [checkFrom, setCheckFrom] = useState('')
  const [checkTo, setCheckTo] = useState('')
  const [pathResult, setPathResult] = useState<{
    found: boolean; path?: string[]; factor?: number; from_norm?: string; to_norm?: string
  } | null>(null)
  const [suggestion, setSuggestion] = useState<{ factor: number | null; note: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [suggesting, setSuggesting] = useState(false)

  const [chainEditorCtx, setChainEditorCtx] = useState<{ id: string | null; name: string } | null>(null)

  // The API refuses a rate that contradicts what the other rules already imply.
  // Hold the refusal here so the user can see what disagrees and decide, instead
  // of getting a toast that vanishes before they can read the numbers.
  const [conflict, setConflict] = useState<{ info: ConversionConflict; retry: () => Promise<void> } | null>(null)
  const [overriding, setOverriding] = useState(false)

  // Material selector state
  const [selectedMaterial, setSelectedMaterial] = useState<StockItem | null>(null)
  const [materialSearch, setMaterialSearch] = useState('')
  const [materialResults, setMaterialResults] = useState<StockItem[]>([])
  const [showMaterialDropdown, setShowMaterialDropdown] = useState(false)
  const [allStock, setAllStock] = useState<StockItem[]>([])
  const materialRef = useRef<HTMLDivElement>(null)
  const materialInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchAll() }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (materialRef.current && !materialRef.current.contains(e.target as Node)) {
        setShowMaterialDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  /**
   * Optional enrichment endpoint. If it is not deployed yet the page keeps
   * working off /materials/unit-conversions/all exactly as before.
   */
  const fetchCatalog = async () => {
    try {
      const res = await api.get('/materials/unit-conversions/catalog')
      const payload = res.data?.data ?? res.data ?? {}
      const rawUnits: any[] = Array.isArray(payload.units) ? payload.units : []
      setCatalogUnits(rawUnits.map(u =>
        typeof u === 'string'
          ? { value: u, label: ul(u) }
          : { value: u?.code ?? u?.value ?? '', label: u?.label ?? ul(u?.code ?? u?.value ?? '') },
      ).filter(u => !!u.value))
      setCatalogSpecials(Array.isArray(payload.specials) ? payload.specials : [])
    } catch {
      // graceful fallback — everything below derives from allConversions
      setCatalogUnits([])
      setCatalogSpecials([])
    }
  }

  const fetchAll = async () => {
    setLoading(true)
    try {
      const [allRes, stdRes, stockRes] = await Promise.all([
        api.get('/materials/unit-conversions/all'),
        api.get('/materials/unit-conversions/standards'),
        api.get('/stock'),
      ])
      setAllConversions(allRes.data.data ?? [])
      setStandards(stdRes.data.data ?? [])
      setAllStock(stockRes.data.data ?? stockRes.data ?? [])
    } catch {
      toast.error(t('settings.unitConversions.toast.loadFailed'))
    } finally {
      setLoading(false)
    }
    fetchCatalog()
  }

  const handleMaterialSearch = (val: string) => {
    setMaterialSearch(val)
    setShowMaterialDropdown(true)
    if (!val.trim()) {
      setMaterialResults(allStock.slice(0, 8))
      return
    }
    const q = val.toLowerCase()
    setMaterialResults(
      allStock.filter(s => s.name.toLowerCase().includes(q) || s.sku.toLowerCase().includes(q)).slice(0, 8)
    )
  }

  const focusMaterialPicker = () => {
    setMaterialResults(allStock.slice(0, 8))
    setShowMaterialDropdown(true)
    materialInputRef.current?.focus()
    materialInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const handleCheckPath = async () => {
    if (!checkFrom.trim() || !checkTo.trim()) return
    setChecking(true)
    setPathResult(null)
    setSuggestion(null)
    try {
      const res = await api.post('/materials/unit-conversions/check-path', {
        from_unit: checkFrom.trim(),
        to_unit: checkTo.trim(),
        material_id: selectedMaterial?.id,
      })
      setPathResult(res.data.data)
    } catch {
      toast.error(t('settings.unitConversions.toast.pathCheckFailed'))
    } finally {
      setChecking(false)
    }
  }

  const handleSuggest = async () => {
    if (!pathResult || pathResult.found) return
    setSuggesting(true)
    try {
      const res = await api.post('/materials/unit-conversions/suggest', {
        from_unit: pathResult.from_norm ?? checkFrom,
        to_unit: pathResult.to_norm ?? checkTo,
        material_id: selectedMaterial?.id,
        material_name: selectedMaterial?.name,
      })
      setSuggestion(res.data.data)
    } catch {
      toast.error(t('settings.unitConversions.toast.aiSuggestFailed'))
    } finally {
      setSuggesting(false)
    }
  }

  const applyAdvisorToForm = () => {
    if (!pathResult) return
    setFromUnit(pathResult.from_norm ?? checkFrom)
    setToUnit(pathResult.to_norm ?? checkTo)
    if (suggestion?.factor) setFactor(String(suggestion.factor))
  }

  const openCreate = () => {
    setEditTarget(null)
    setFromUnit('')
    setToUnit('')
    setFactor('')
    setNotes('')
    setSelectedMaterial(null)
    setMaterialSearch('')
    setCheckFrom('')
    setCheckTo('')
    setPathResult(null)
    setSuggestion(null)
    setShowForm(true)
  }

  const openEdit = (c: UnitConversion) => {
    setEditTarget(c)
    setFromUnit(c.from_unit)
    setToUnit(c.to_unit)
    setFactor(String(c.conversion_factor))
    setNotes(c.notes ?? '')
    setSelectedMaterial(c.material_id ? { id: c.material_id, name: c.material_name ?? '', sku: c.material_sku ?? '', unit: '' } : null)
    setMaterialSearch(c.material_name ?? '')
    setShowForm(true)
  }

  const closeForm = () => { setShowForm(false); setEditTarget(null) }

  const openCreateForMaterial = (materialId: string, name: string, sku: string) => {
    openCreate()
    setSelectedMaterial({ id: materialId, name, sku, unit: '' })
    setMaterialSearch(name)
  }

  const handleSave = async () => {
    if (!fromUnit.trim() || !toUnit.trim() || !factor) return toast.error(t('settings.unitConversions.toast.validation'))
    if (Number(factor) <= 0) return toast.error(t('settings.unitConversions.toast.factorPositive'))
    if (fromUnit.trim() === toUnit.trim()) return toast.error(t('settings.unitConversions.toast.sameUnit'))
    setSaving(true)
    const submit = async (force: boolean) => {
      if (editTarget) {
        await api.put(`/materials/unit-conversions/${editTarget.id}`, {
          conversion_factor: Number(factor),
          notes: notes.trim() || undefined,
          ...(force ? { force: true } : {}),
        })
        toast.success(t('settings.unitConversions.toast.updateSuccess'))
      } else {
        await api.post('/materials/unit-conversions', {
          from_unit: normalizeUnit(fromUnit),
          to_unit: normalizeUnit(toUnit),
          conversion_factor: Number(factor),
          notes: notes.trim() || undefined,
          material_id: selectedMaterial?.id ?? undefined,
          ...(force ? { force: true } : {}),
        })
        toast.success(t('settings.unitConversions.toast.createSuccess'))
      }
      invalidateUnitsCache()
      closeForm()
      await fetchAll()
    }

    try {
      await submit(false)
    } catch (err: any) {
      const info = err?.response?.status === 409 && err?.response?.data?.code === 'UNIT_CONVERSION_CONFLICT'
        ? (err.response.data.data as ConversionConflict)
        : null
      if (info) setConflict({ info, retry: () => submit(true) })
      else toast.error(err?.response?.data?.message ?? t('settings.adminUserManagement.toast.error'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string, label: string) => {
    if (!confirm(t('settings.unitConversions.toast.deleteConfirm', { label }))) return
    try {
      await api.delete(`/materials/unit-conversions/${id}`)
      toast.success(t('settings.unitConversions.toast.deleteSuccess'))
      invalidateUnitsCache()
      setAllConversions(prev => prev.filter(c => c.id !== id))
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? t('settings.unitConversions.toast.deleteFailed'))
    }
  }

  // แยก global vs per-material
  const globalConversions = allConversions.filter(c => !c.material_id)
  const perMaterialConversions = allConversions.filter(c => !!c.material_id)

  // จัดกลุ่ม per-material ตามสินค้า
  const perMaterialGroups = perMaterialConversions.reduce<Record<string, { name: string; sku: string; items: UnitConversion[] }>>((acc, c) => {
    const key = c.material_id!
    if (!acc[key]) acc[key] = { name: c.material_name ?? key, sku: c.material_sku ?? '', items: [] }
    acc[key].items.push(c)
    return acc
  }, {})

  /** normalized from|to  →  the tenant-wide rule for that pair */
  const globalByPair = useMemo(() => {
    const m = new Map<string, UnitConversion>()
    globalConversions.forEach(c => m.set(pairKey(c.from_unit, c.to_unit), c))
    return m
  }, [allConversions])

  /** normalized from|to  →  per-product rules that disagree with the tenant-wide one */
  const overridesByPair = useMemo(() => {
    const m = new Map<string, UnitConversion[]>()
    for (const c of perMaterialConversions) {
      const k = pairKey(c.from_unit, c.to_unit)
      const g = globalByPair.get(k)
      if (!g || g.conversion_factor === c.conversion_factor) continue
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(c)
    }
    return m
  }, [allConversions, globalByPair])

  /** unit code → explanatory note, when the catalog endpoint is available */
  const specialNoteByCode = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of catalogSpecials) {
      if (s?.code && s?.note) m.set(normalizeUnit(s.code), s.note)
    }
    return m
  }, [catalogSpecials])

  /** how many stock items actually use a given unit (advisory only) */
  const unitUsageCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of allStock) {
      const u = normalizeUnit(s.unit ?? '')
      if (!u) continue
      m.set(u, (m.get(u) ?? 0) + 1)
    }
    return m
  }, [allStock])

  /** plain-language sentence: "1 แพ็ค = 30 ฟอง" */
  const sentence = (c: UnitConversion) =>
    t('settings.unitConversions.human.sentence', {
      from: unitLabel(c.from_unit),
      factor: c.conversion_factor,
      to: unitLabel(c.to_unit),
    })

  const filterConv = (list: UnitConversion[]) =>
    !searchTerm ? list : list.filter(c =>
      c.from_unit.includes(searchTerm.toLowerCase()) ||
      c.to_unit.includes(searchTerm.toLowerCase()) ||
      unitLabel(c.from_unit).includes(searchTerm) ||
      unitLabel(c.to_unit).includes(searchTerm) ||
      (c.material_name ?? '').toLowerCase().includes(searchTerm.toLowerCase())
    )

  const toggleGroup = (label: string) =>
    setExpandedGroups(prev => ({ ...prev, [label]: !prev[label] }))

  const chainConversions = useMemo(
    () => chainEditorCtx
      ? allConversions.filter(c =>
        chainEditorCtx.id ? c.material_id === chainEditorCtx.id : !c.material_id,
      )
      : [],
    [allConversions, chainEditorCtx],
  )

  const chainAvailableUnits = useMemo(() => {
    const seen = new Set<string>()
    const result: Array<{ value: string; label: string }> = []
    const add = (u: string, label?: string) => {
      if (u && !seen.has(u)) {
        seen.add(u)
        result.push({ value: u, label: label ?? (UNIT_LABELS[u] ? `${UNIT_LABELS[u]} (${u})` : u) })
      }
    }
    Object.keys(UNIT_LABELS).forEach(u => add(u))
    catalogUnits.forEach(u => add(u.value, u.label))
    allConversions.forEach(c => { add(c.from_unit); add(c.to_unit) })
    return result
  }, [allConversions, catalogUnits])

  const handleChainAdd = async (from: string, to: string, factor: number) => {
    const submit = async (force: boolean) => {
      await api.post('/materials/unit-conversions', {
        from_unit: from,
        to_unit: to,
        conversion_factor: factor,
        material_id: chainEditorCtx?.id ?? undefined,
        ...(force ? { force: true } : {}),
      })
      invalidateUnitsCache()
      await fetchAll()
    }
    try {
      await submit(false)
    } catch (err: any) {
      const info = err?.response?.status === 409 && err?.response?.data?.code === 'UNIT_CONVERSION_CONFLICT'
        ? (err.response.data.data as ConversionConflict)
        : null
      if (!info) throw err
      setConflict({ info, retry: () => submit(true) })
    }
  }

  const handleChainDelete = async (id: string) => {
    await api.delete(`/materials/unit-conversions/${id}`)
    invalidateUnitsCache()
    setAllConversions(prev => prev.filter(c => c.id !== id))
  }

  const standardGroups = [
    { key: 'weight', units: ['kg', 'g', 'mg', 'lb', 'oz'] },
    { key: 'length', units: ['m', 'cm', 'mm', 'km', 'inch', 'ft', 'yard'] },
    { key: 'volume', units: ['l', 'ltr', 'ml', 'gallon'] },
    { key: 'count', units: ['pcs', 'dozen', 'gross', 'pair'] },
  ]

  // ── Badges ───────────────────────────────────────────────────────
  const ScopeBadge = ({ scope }: { scope: 'builtIn' | 'global' | 'material' }) => {
    const cfg = {
      builtIn: { Icon: Lock, cls: 'bg-[var(--success-soft)] text-[var(--success)]' },
      global: { Icon: Globe, cls: 'bg-[var(--info-soft)] text-[var(--info)]' },
      material: { Icon: Package, cls: 'bg-[var(--warning-soft)] text-[var(--warning)]' },
    }[scope]
    const { Icon, cls } = cfg
    return (
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium whitespace-nowrap ${cls}`}>
        <Icon className="w-2.5 h-2.5" />
        {t(`settings.unitConversions.scope.${scope}`)}
      </span>
    )
  }

  const WarnBadge = ({ label, tip, Icon }: { label: string; tip: string; Icon: typeof AlertTriangle }) => (
    <span
      title={tip}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium whitespace-nowrap bg-[var(--warning-soft)] text-[var(--warning)] border border-[var(--warning)]/30"
    >
      <Icon className="w-2.5 h-2.5" />
      {label}
    </span>
  )

  const ConversionRow = ({ c, scope }: { c: UnitConversion; scope: 'global' | 'material' }) => {
    const crossCat = isCrossCategory(c.from_unit, c.to_unit)
    const packaging = isPackagingUnit(c.from_unit) || isPackagingUnit(c.to_unit)
    const key = pairKey(c.from_unit, c.to_unit)
    const overrides = scope === 'global' ? (overridesByPair.get(key) ?? []) : []
    const beatenGlobal = scope === 'material' ? globalByPair.get(key) : undefined
    const overridesGlobal = !!beatenGlobal && beatenGlobal.conversion_factor !== c.conversion_factor

    return (
      <motion.div
        key={c.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--surface-2)] transition-colors"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
          <span
            title={specialNoteByCode.get(normalizeUnit(c.from_unit))}
            className="px-2.5 py-1 bg-[var(--info-soft)] text-[var(--info)] rounded-md text-sm font-mono whitespace-nowrap"
          >
            1 {unitLabel(c.from_unit)}
          </span>
          <ArrowLeftRight className="w-3.5 h-3.5 text-[var(--fg-4)] flex-shrink-0" />
          <span className="px-2.5 py-1 bg-[var(--success-soft)] text-[var(--success)] rounded-md text-sm font-mono whitespace-nowrap">
            {c.conversion_factor} {unitLabel(c.to_unit)}
          </span>
          <span className="text-[var(--fg-4)] text-xs font-mono hidden sm:block">
            ({c.from_unit} → {c.to_unit})
          </span>

          <ScopeBadge scope={scope} />

          {crossCat && (
            <WarnBadge
              Icon={Shuffle}
              label={t('settings.unitConversions.badge.crossCategory')}
              tip={t('settings.unitConversions.badge.crossCategoryTip', {
                from: t(`settings.unitConversions.category.${categoryOf(c.from_unit)}`),
                to: t(`settings.unitConversions.category.${categoryOf(c.to_unit)}`),
              })}
            />
          )}

          {scope === 'global' && packaging && (
            <WarnBadge
              Icon={AlertTriangle}
              label={t('settings.unitConversions.badge.packagingUnit')}
              tip={t('settings.unitConversions.badge.packagingUnitTip', {
                unit: unitLabel(isPackagingUnit(c.from_unit) ? c.from_unit : c.to_unit),
                count: unitUsageCount.get(normalizeUnit(isPackagingUnit(c.from_unit) ? c.from_unit : c.to_unit)) ?? 0,
              })}
            />
          )}

          {scope === 'global' && overrides.length > 0 && (
            <span
              title={overrides.map(o => `${o.material_name ?? o.material_id}: ${sentence(o)}`).join('\n')}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium whitespace-nowrap bg-[var(--surface-2)] text-[var(--fg-3)] border border-[var(--border-strong)]"
            >
              <Package className="w-2.5 h-2.5" />
              {t('settings.unitConversions.badge.overriddenBy', { count: overrides.length })}
            </span>
          )}

          {overridesGlobal && (
            <span
              title={t('settings.unitConversions.badge.overridesGlobalTip')}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium whitespace-nowrap bg-[var(--primary-soft)] text-[var(--primary)]"
            >
              <CheckCircle2 className="w-2.5 h-2.5" />
              {t('settings.unitConversions.badge.overridesGlobal', {
                factor: beatenGlobal!.conversion_factor,
                unit: unitLabel(c.to_unit),
              })}
            </span>
          )}
        </div>

        {c.notes && <span className="text-[var(--fg-4)] text-xs truncate max-w-[140px] hidden md:block">{c.notes}</span>}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => openEdit(c)} className="p-1.5 text-[var(--fg-3)] hover:text-[var(--info)] hover:bg-[var(--info-soft)] rounded-lg transition-colors">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => handleDelete(c.id, `${c.from_unit} → ${c.to_unit}`)} className="p-1.5 text-[var(--fg-3)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] rounded-lg transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>
    )
  }

  // ── modal advisory flags ─────────────────────────────────────────
  const warnPackagingGlobal = !editTarget && !selectedMaterial && !!fromUnit.trim() &&
    (isPackagingUnit(fromUnit) || isPackagingUnit(toUnit))
  const warnCrossCategory = !!fromUnit.trim() && !!toUnit.trim() && isCrossCategory(fromUnit, toUnit)
  const warnPackagingUnitName = unitLabel(
    isPackagingUnit(fromUnit) ? normalizeUnit(fromUnit) : normalizeUnit(toUnit),
  )

  const riskyGlobalCount = globalConversions.filter(c =>
    isPackagingUnit(c.from_unit) || isPackagingUnit(c.to_unit) || isCrossCategory(c.from_unit, c.to_unit)
  ).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[var(--primary-soft)] rounded-lg">
            <ArrowLeftRight className="w-5 h-5 text-[var(--primary)]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--fg-1)]">{t('settings.unitConversions.title')}</h2>
            <p className="text-xs text-[var(--fg-3)]">{t('settings.unitConversions.subtitle')}</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('settings.unitConversions.add')}
        </button>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--fg-4)]" />
        <input
          type="text"
          placeholder={t('settings.unitConversions.searchPlaceholder')}
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full pl-9 pr-4 py-2 bg-[var(--surface)] border border-[var(--border-strong)]/50 rounded-lg text-sm text-[var(--fg-2)] placeholder-[var(--fg-4)] focus:outline-none focus:border-purple-500/50"
        />
        {searchTerm && (
          <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-4)] hover:text-[var(--fg-2)]">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── SECTION 1: Standard rules (tenant-wide) ── */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border-strong)]/50 overflow-hidden">
        <div className="p-4 border-b border-[var(--border-strong)]/50">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[var(--info)]" />
            <span className="text-sm font-medium text-[var(--fg-2)]">{t('settings.unitConversions.sectionStandard.title')}</span>
            <span className="px-2 py-0.5 bg-[var(--info-soft)] text-[var(--info)] text-xs rounded-full">
              {t('common.itemCount', { count: globalConversions.length })}
            </span>
            <button
              onClick={() => setChainEditorCtx({ id: null, name: t('settings.unitConversions.sectionStandard.title') })}
              className="ml-auto flex items-center gap-1.5 px-2.5 py-1 bg-purple-500/10 border border-purple-500/30 text-[var(--primary)] rounded-lg text-xs hover:bg-purple-500/20 transition-colors"
            >
              <Network className="w-3.5 h-3.5" />
              {t('settings.unitConversions.global.chainView')}
            </button>
          </div>
          <p className="text-xs text-[var(--fg-4)] mt-1">{t('settings.unitConversions.sectionStandard.desc')}</p>
          {riskyGlobalCount > 0 && (
            <div className="mt-2 flex items-start gap-2 p-2.5 bg-[var(--warning-soft)] border border-[var(--warning)]/25 rounded-lg">
              <AlertTriangle className="w-3.5 h-3.5 text-[var(--warning)] flex-shrink-0 mt-0.5" />
              <p className="text-xs text-[var(--warning)]">
                {t('settings.unitConversions.sectionStandard.riskyNotice', { count: riskyGlobalCount })}
              </p>
            </div>
          )}
        </div>

        {loading ? (
          <div className="p-6 text-center text-[var(--fg-4)] text-sm">{t('common.loading')}</div>
        ) : filterConv(globalConversions).length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-[var(--fg-4)] text-sm">{t('settings.unitConversions.global.empty')}</p>
            <p className="text-[var(--fg-4)] text-xs mt-1">{t('settings.unitConversions.global.emptyHint')}</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {filterConv(globalConversions).map(c => <ConversionRow key={c.id} c={c} scope="global" />)}
          </div>
        )}
      </div>

      {/* ── SECTION 2: Special units, per product ── */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border-strong)]/50 overflow-hidden">
        <div className="p-4 border-b border-[var(--border-strong)]/50">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-[var(--warning)]" />
            <span className="text-sm font-medium text-[var(--fg-2)]">{t('settings.unitConversions.sectionSpecial.title')}</span>
            <span className="px-2 py-0.5 bg-[var(--warning-soft)] text-[var(--warning)] text-xs rounded-full">
              {t('settings.unitConversions.sectionSpecial.productCount', { count: Object.keys(perMaterialGroups).length })}
            </span>
            <span className="px-2 py-0.5 bg-[var(--surface-2)] text-[var(--fg-3)] text-xs rounded-full">
              {t('common.itemCount', { count: perMaterialConversions.length })}
            </span>
          </div>
          <p className="text-xs text-[var(--fg-4)] mt-1">{t('settings.unitConversions.sectionSpecial.desc')}</p>
        </div>

        {loading ? (
          <div className="p-6 text-center text-[var(--fg-4)] text-sm">{t('common.loading')}</div>
        ) : Object.keys(perMaterialGroups).length === 0 ? (
          <div className="p-6 text-center">
            <Package className="w-10 h-10 text-[var(--fg-4)] mx-auto mb-2" />
            <p className="text-[var(--fg-4)] text-sm">{t('settings.unitConversions.perMaterial.empty')}</p>
            <p className="text-[var(--fg-4)] text-xs mt-1">{t('settings.unitConversions.perMaterial.emptyHint')}</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {Object.entries(perMaterialGroups)
              .filter(([, g]) => !searchTerm || filterConv(g.items).length > 0)
              .map(([materialId, group]) => (
                <div key={materialId}>
                  <div className="px-4 py-2.5 bg-[var(--warning-soft)]/40">
                    <div className="flex items-center gap-2">
                      <Package className="w-3.5 h-3.5 text-[var(--warning)] flex-shrink-0" />
                      <span className="text-xs font-medium text-[var(--warning)]">{group.name}</span>
                      {group.sku && <span className="text-xs text-[var(--fg-4)] font-mono">{group.sku}</span>}
                      <span className="text-xs text-[var(--fg-4)]">{t('settings.unitConversions.perMaterial.itemCount', { count: group.items.length })}</span>
                      <button
                        onClick={() => openCreateForMaterial(materialId, group.name, group.sku)}
                        className="ml-auto flex items-center gap-1 px-2 py-0.5 bg-[var(--warning-soft)] border border-[var(--warning)]/30 text-[var(--warning)] rounded-lg text-xs hover:bg-[var(--warning-soft)]/70 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        {t('settings.unitConversions.sectionSpecial.addForProduct')}
                      </button>
                      <button
                        onClick={() => setChainEditorCtx({ id: materialId, name: group.name })}
                        className="flex items-center gap-1 px-2 py-0.5 bg-purple-500/10 border border-purple-500/30 text-[var(--primary)] rounded-lg text-xs hover:bg-purple-500/20 transition-colors"
                      >
                        <Network className="w-3 h-3" />
                        {t('settings.unitConversions.perMaterial.chain')}
                      </button>
                    </div>
                    {/* plain-language summary — "ไข่ไก่: 1 แพ็ค = 30 ฟอง" */}
                    <p className="text-xs text-[var(--fg-3)] mt-1 pl-5">
                      <span className="text-[var(--fg-2)]">{group.name}:</span>{' '}
                      {group.items.map(c => sentence(c)).join('  ·  ')}
                    </p>
                  </div>
                  {filterConv(group.items).map(c => <ConversionRow key={c.id} c={c} scope="material" />)}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* ── SECTION 3: Built-in Standards ── */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border-strong)]/50 overflow-hidden">
        <div className="p-4 border-b border-[var(--border-strong)]/50 flex items-center gap-2">
          <Globe className="w-4 h-4 text-[var(--success)]" />
          <span className="text-sm font-medium text-[var(--fg-2)]">{t('settings.unitConversions.builtIn.title')}</span>
          <span className="px-2 py-0.5 bg-[var(--success-soft)] text-[var(--success)] text-xs rounded-full">{t('common.itemCount', { count: standards.length })}</span>
          <ScopeBadge scope="builtIn" />
          <div className="flex items-center gap-1 ml-1 text-xs text-[var(--fg-4)]">
            <Lock className="w-3 h-3" /><span>{t('settings.unitConversions.builtIn.locked')}</span>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-start gap-2 p-3 bg-[var(--success-soft)] border border-[var(--success)]/20 rounded-lg">
            <Info className="w-4 h-4 text-[var(--success)] mt-0.5 flex-shrink-0" />
            <p className="text-xs text-[var(--fg-3)]">
              {t('settings.unitConversions.builtIn.info')}
            </p>
          </div>

          {standardGroups.map(group => {
            const groupConversions = standards.filter(s =>
              group.units.includes(s.from_unit) && group.units.includes(s.to_unit)
            )
            const isOpen = expandedGroups[group.key]
            return (
              <div key={group.key} className="border border-[var(--border-strong)] rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleGroup(group.key)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-[var(--surface-2)] hover:bg-[var(--surface-2)] transition-colors"
                >
                  <span className="text-sm font-medium text-[var(--fg-2)]">{t(`settings.unitConversions.standardGroups.${group.key}`)}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--fg-4)]">{t('settings.unitConversions.builtIn.pairCount', { count: groupConversions.length })}</span>
                    {isOpen ? <ChevronUp className="w-4 h-4 text-[var(--fg-4)]" /> : <ChevronDown className="w-4 h-4 text-[var(--fg-4)]" />}
                  </div>
                </button>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-1 p-2">
                        {groupConversions.map((s, i) => (
                          <div key={i} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[var(--surface-2)] rounded-lg text-xs">
                            <span className="text-[var(--fg-3)] font-mono">1 {s.from_unit}</span>
                            <span className="text-[var(--fg-4)]">=</span>
                            <span className="text-[var(--success)] font-mono">{s.factor} {s.to_unit}</span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── MODAL FORM ── */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={closeForm}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-[var(--surface)] border border-[var(--border-strong)] rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl"
            >
              <div className="flex items-center justify-between p-5 border-b border-[var(--border-strong)]">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="w-5 h-5 text-[var(--primary)]" />
                  <h3 className="font-semibold text-[var(--fg-1)]">
                    {editTarget ? t('settings.unitConversions.modal.titleEdit') : t('settings.unitConversions.modal.titleCreate')}
                  </h3>
                </div>
                <button onClick={closeForm} className="text-[var(--fg-3)] hover:text-[var(--fg-2)] transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {/* Preview */}
                {fromUnit && toUnit && factor && Number(factor) > 0 && (
                  <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg text-center">
                    <span className="text-[var(--primary)] font-medium">
                      {selectedMaterial
                        ? t('settings.unitConversions.modal.previewWithMaterial', { from: unitLabel(fromUnit) || fromUnit, factor, to: unitLabel(toUnit) || toUnit, material: selectedMaterial.name })
                        : t('settings.unitConversions.modal.preview', { from: unitLabel(fromUnit) || fromUnit, factor, to: unitLabel(toUnit) || toUnit })}
                    </span>
                    <div className="mt-1 flex items-center justify-center gap-1.5">
                      <ScopeBadge scope={selectedMaterial ? 'material' : 'global'} />
                    </div>
                  </div>
                )}

                {/* ── Inline advisories (never block saving) ── */}
                <AnimatePresence>
                  {warnPackagingGlobal && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-start gap-2 p-3 bg-[var(--warning-soft)] border border-[var(--warning)]/30 rounded-lg">
                        <AlertTriangle className="w-4 h-4 text-[var(--warning)] flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[var(--warning)]">
                            {t('settings.unitConversions.warn.packagingTitle', { unit: warnPackagingUnitName })}
                          </p>
                          <p className="text-xs text-[var(--fg-3)] mt-0.5">
                            {t('settings.unitConversions.warn.packagingBody')}
                          </p>
                          <button
                            onClick={focusMaterialPicker}
                            className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--warning-soft)] border border-[var(--warning)]/40 text-[var(--warning)] rounded-lg text-xs font-medium hover:bg-[var(--warning-soft)]/70 transition-colors"
                          >
                            <Package className="w-3 h-3" />
                            {t('settings.unitConversions.warn.packagingAction')}
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {warnCrossCategory && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-start gap-2 p-3 bg-[var(--warning-soft)] border border-[var(--warning)]/30 rounded-lg">
                        <Shuffle className="w-4 h-4 text-[var(--warning)] flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[var(--warning)]">
                            {t('settings.unitConversions.warn.crossCategoryTitle')}
                          </p>
                          <p className="text-xs text-[var(--fg-3)] mt-0.5">
                            {t('settings.unitConversions.warn.crossCategoryBody', {
                              from: t(`settings.unitConversions.category.${categoryOf(fromUnit)}`),
                              to: t(`settings.unitConversions.category.${categoryOf(toUnit)}`),
                            })}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* ── Path Advisor (create mode only) ── */}
                {!editTarget && (
                  <div className="p-3 bg-[var(--surface-2)] border border-[var(--border-strong)]/40 rounded-xl space-y-2">
                    <p className="text-xs font-medium text-[var(--fg-3)] flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-[var(--primary)]" />
                      {t('settings.unitConversions.modal.advisorTitle')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={checkFrom}
                        onChange={e => { setCheckFrom(e.target.value); setPathResult(null); setSuggestion(null) }}
                        placeholder={t('settings.unitConversions.modal.fromPlaceholder')}
                        className="flex-1 px-2.5 py-1.5 bg-[var(--surface-2)] border border-[var(--border-strong)]/50 rounded-lg text-sm text-[var(--fg-2)] placeholder-[var(--fg-4)] focus:outline-none focus:border-purple-500/50"
                      />
                      <span className="text-[var(--fg-4)] self-center">→</span>
                      <input
                        type="text"
                        value={checkTo}
                        onChange={e => { setCheckTo(e.target.value); setPathResult(null); setSuggestion(null) }}
                        placeholder={t('settings.unitConversions.modal.toPlaceholder')}
                        className="flex-1 px-2.5 py-1.5 bg-[var(--surface-2)] border border-[var(--border-strong)]/50 rounded-lg text-sm text-[var(--fg-2)] placeholder-[var(--fg-4)] focus:outline-none focus:border-purple-500/50"
                      />
                      <button
                        onClick={handleCheckPath}
                        disabled={checking || !checkFrom.trim() || !checkTo.trim()}
                        className="px-3 py-1.5 bg-purple-600/70 hover:bg-purple-600 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition-colors"
                      >
                        {checking ? t('settings.unitConversions.modal.checking') : <span className="whitespace-nowrap">{t('settings.unitConversions.modal.check')}</span>}
                      </button>
                    </div>

                    <AnimatePresence>
                      {pathResult && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                          {pathResult.found ? (
                            <div className="flex items-start gap-2 p-2.5 bg-[var(--success-soft)] border border-[var(--success)]/20 rounded-lg">
                              <CheckCircle2 className="w-4 h-4 text-[var(--success)] flex-shrink-0 mt-0.5" />
                              <div className="text-xs text-[var(--success)] space-y-0.5">
                                <p className="font-medium">{t('settings.unitConversions.modal.pathFound', { path: pathResult.path?.join(' → ') })}</p>
                                <p className="text-[var(--success)]">{t('settings.unitConversions.modal.pathFoundValue', { from: pathResult.path?.[0], factor: pathResult.factor?.toFixed(6).replace(/\.?0+$/, ''), to: pathResult.path?.[pathResult.path.length - 1] })}</p>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex items-start gap-2 p-2.5 bg-[var(--warning-soft)] border border-[var(--warning)]/20 rounded-lg">
                                <AlertCircle className="w-4 h-4 text-[var(--warning)] flex-shrink-0 mt-0.5" />
                                <div className="text-xs text-[var(--warning)]">
                                  <p className="font-medium">{t('settings.unitConversions.modal.pathNotFound', { from: pathResult.from_norm, to: pathResult.to_norm })}</p>
                                  <p className="text-[var(--warning)] mt-0.5">{t('settings.unitConversions.modal.pathNotFoundHint')}</p>
                                </div>
                              </div>
                              {!suggestion && (
                                <button
                                  onClick={handleSuggest}
                                  disabled={suggesting}
                                  className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-purple-600/50 hover:bg-purple-600/70 disabled:opacity-40 text-[var(--primary)] rounded-lg text-xs transition-colors"
                                >
                                  <Sparkles className="w-3.5 h-3.5" />
                                  {suggesting ? t('settings.unitConversions.modal.aiThinking') : t('settings.unitConversions.modal.aiSuggest')}
                                </button>
                              )}
                              {suggestion && (
                                <div className="flex items-center gap-2 p-2.5 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                                  <Sparkles className="w-3.5 h-3.5 text-[var(--primary)] flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs text-[var(--primary)] font-medium">
                                      {suggestion.factor
                                        ? t('settings.unitConversions.modal.aiSuggestion', { from: pathResult.from_norm, factor: suggestion.factor, to: pathResult.to_norm })
                                        : suggestion.note}
                                    </p>
                                    {suggestion.note && suggestion.factor && (
                                      <p className="text-xs text-[var(--fg-4)] truncate">{suggestion.note}</p>
                                    )}
                                  </div>
                                  {suggestion.factor && (
                                    <button
                                      onClick={applyAdvisorToForm}
                                      className="flex-shrink-0 px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-md text-xs font-medium transition-colors"
                                    >
                                      {t('settings.unitConversions.modal.applyValue')}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* Material selector (optional) */}
                {!editTarget && (
                  <div ref={materialRef}>
                    <label className="block text-xs text-[var(--fg-3)] mb-1.5">
                      {t('settings.unitConversions.modal.materialLabel')} <span className="text-[var(--fg-4)]">{t('settings.unitConversions.modal.materialHint')}</span>
                    </label>
                    <div className="relative">
                      <Package className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--fg-4)]" />
                      <input
                        ref={materialInputRef}
                        type="text"
                        value={materialSearch}
                        onChange={e => handleMaterialSearch(e.target.value)}
                        onFocus={() => { setShowMaterialDropdown(true); setMaterialResults(allStock.slice(0, 8)) }}
                        placeholder={t('settings.unitConversions.modal.materialPlaceholder')}
                        className={`w-full pl-9 pr-8 py-2 bg-[var(--surface-2)] border rounded-lg text-sm text-[var(--fg-2)] placeholder-[var(--fg-4)] focus:outline-none focus:border-purple-500/50 ${
                          warnPackagingGlobal ? 'border-[var(--warning)]/60' : 'border-[var(--border-strong)]/50'
                        }`}
                      />
                      {selectedMaterial && (
                        <button
                          onClick={() => { setSelectedMaterial(null); setMaterialSearch('') }}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-4)] hover:text-[var(--fg-2)]"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {selectedMaterial && (
                      <div className="mt-1 flex items-center gap-2 px-2 py-1 bg-[var(--warning-soft)] border border-[var(--warning)]/20 rounded-lg">
                        <Package className="w-3 h-3 text-[var(--warning)]" />
                        <span className="text-xs text-[var(--warning)]">{selectedMaterial.name}</span>
                        <span className="text-xs text-[var(--fg-4)] font-mono">{selectedMaterial.sku}</span>
                      </div>
                    )}
                    <AnimatePresence>
                      {showMaterialDropdown && materialResults.length > 0 && !selectedMaterial && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                          className="absolute z-10 mt-1 w-full bg-[var(--surface)] border border-[var(--border-strong)] rounded-xl shadow-xl overflow-hidden max-h-48 overflow-y-auto"
                          style={{ width: 'calc(100% - 2.5rem)' }}
                        >
                          {materialResults.map(s => (
                            <button
                              key={s.id}
                              onClick={() => {
                                setSelectedMaterial(s)
                                setMaterialSearch(s.name)
                                setShowMaterialDropdown(false)
                              }}
                              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-[var(--surface-2)] transition-colors text-left"
                            >
                              <Package className="w-3.5 h-3.5 text-[var(--fg-4)] flex-shrink-0" />
                              <span className="text-sm text-[var(--fg-2)] flex-1 truncate">{s.name}</span>
                              <span className="text-xs text-[var(--fg-4)] font-mono">{s.sku}</span>
                              <span className="text-xs text-[var(--fg-4)]">{unitLabel(s.unit)}</span>
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1.5">{t('settings.unitConversions.modal.fromUnitLabel')}</label>
                    <input
                      type="text"
                      value={fromUnit}
                      onChange={e => setFromUnit(e.target.value)}
                      disabled={!!editTarget}
                      placeholder={t('settings.unitConversions.modal.fromUnitPlaceholder')}
                      className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-strong)]/50 rounded-lg text-sm text-[var(--fg-2)] placeholder-[var(--fg-4)] focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
                    />
                    {fromUnit && <p className="text-xs text-[var(--fg-4)] mt-1">{unitLabel(fromUnit)}</p>}
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--fg-3)] mb-1.5">{t('settings.unitConversions.modal.toUnitLabel')}</label>
                    <input
                      type="text"
                      value={toUnit}
                      onChange={e => setToUnit(e.target.value)}
                      disabled={!!editTarget}
                      placeholder={t('settings.unitConversions.modal.toUnitPlaceholder')}
                      className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-strong)]/50 rounded-lg text-sm text-[var(--fg-2)] placeholder-[var(--fg-4)] focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
                    />
                    {toUnit && <p className="text-xs text-[var(--fg-4)] mt-1">{unitLabel(toUnit)}</p>}
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1.5">
                    {t('settings.unitConversions.modal.factorLabel', { from: fromUnit || '?', to: toUnit || '?' })}
                  </label>
                  <input
                    type="number"
                    value={factor}
                    onChange={e => setFactor(e.target.value)}
                    placeholder={t('settings.unitConversions.modal.factorPlaceholder')}
                    min="0.0000001"
                    step="any"
                    className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-strong)]/50 rounded-lg text-sm text-[var(--fg-2)] placeholder-[var(--fg-4)] focus:outline-none focus:border-purple-500/50"
                  />
                </div>

                <div>
                  <label className="block text-xs text-[var(--fg-3)] mb-1.5">{t('settings.unitConversions.modal.notesLabel')}</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder={t('settings.unitConversions.modal.notesPlaceholder')}
                    className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-strong)]/50 rounded-lg text-sm text-[var(--fg-2)] placeholder-[var(--fg-4)] focus:outline-none focus:border-purple-500/50"
                  />
                </div>

                <div className="flex gap-3 pt-1">
                  <button onClick={closeForm} className="flex-1 py-2.5 border border-[var(--border-strong)] text-[var(--fg-2)] hover:text-[var(--fg-1)] rounded-lg text-sm transition-colors">
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    {saving ? <span className="animate-pulse">{t('settings.unitConversions.modal.saving')}</span> : <><Save className="w-4 h-4" />{t('common.save')}</>}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* กฎขัดกัน — ให้เห็นตัวเลขทั้งสองฝั่งก่อนตัดสินใจ */}
      <AnimatePresence>
        {conflict && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[var(--fg-1)]/50 flex items-center justify-center z-[60] p-4"
            onClick={() => setConflict(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="phopy-card w-full max-w-md"
            >
              <div className="p-5 border-b border-[var(--border)] flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-[var(--warning)]" />
                <h3 className="font-bold text-[var(--fg-1)]">{t('settings.unitConversions.conflict.title')}</h3>
              </div>

              <div className="p-5 space-y-4">
                <p className="text-sm text-[var(--fg-2)]">{conflict.info.message}</p>

                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] divide-y divide-[var(--border)] text-sm">
                  <div className="p-3">
                    <p className="text-xs text-[var(--fg-4)] mb-0.5">{t('settings.unitConversions.conflict.derived')}</p>
                    <p className="text-[var(--fg-1)] font-medium">
                      1 {conflict.info.fromLabel} = {conflict.info.existingFactor} {conflict.info.toLabel}
                    </p>
                    {conflict.info.pathLabels?.length > 2 && (
                      <p className="text-xs text-[var(--fg-4)] mt-0.5">{conflict.info.pathLabels.join(' → ')}</p>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-xs text-[var(--fg-4)] mb-0.5">{t('settings.unitConversions.conflict.incoming')}</p>
                    <p className="text-[var(--warning)] font-medium">
                      1 {conflict.info.fromLabel} = {conflict.info.newFactor} {conflict.info.toLabel}
                    </p>
                  </div>
                </div>

                <p className="text-xs text-[var(--fg-4)]">{t('settings.unitConversions.conflict.hint')}</p>
              </div>

              <div className="p-5 border-t border-[var(--border)] flex justify-end gap-2">
                <button
                  onClick={() => setConflict(null)}
                  className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  {t('settings.unitConversions.conflict.cancel')}
                </button>
                <button
                  disabled={overriding}
                  onClick={async () => {
                    setOverriding(true)
                    try {
                      await conflict.retry()
                      setConflict(null)
                    } catch (e: any) {
                      toast.error(e?.response?.data?.message ?? t('settings.adminUserManagement.toast.error'))
                    } finally {
                      setOverriding(false)
                    }
                  }}
                  className="px-4 py-2 rounded-lg text-sm text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-40 transition-colors"
                >
                  {t('settings.unitConversions.conflict.override')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {chainEditorCtx && (
        <UnitChainEditor
          conversions={chainConversions}
          availableUnits={chainAvailableUnits}
          onAdd={handleChainAdd}
          onDelete={handleChainDelete}
          onClose={() => setChainEditorCtx(null)}
        />
      )}
    </div>
  )
}
