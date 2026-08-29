import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Search, Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUnits, unitLabelOf, unitCategoryOf, type UnitCategory, type UnitOption, type UnitSpecial } from '../../hooks/useUnits'
import { normalizeUnit, canonicalUnitCode } from '../../utils/unitNormalize'

interface UnitPickerProps {
  value: string
  onChange: (unit: string) => void
  /** ส่ง id ของสินค้า เพื่อดึงหน่วยพิเศษเฉพาะสินค้านั้น */
  materialId?: string | null
  disabled?: boolean
  className?: string
  placeholder?: string
  size?: 'sm' | 'md'
  /**
   * หน่วยฐาน/หน่วยสต็อกของสินค้าที่กำลังเลือกหน่วยให้ — ใช้เพื่อกรอง/เตือนหน่วยที่แปลงไม่ถึง
   * ไม่ส่งมา = พฤติกรรมเดิมทุกประการ (ไม่มีการกรอง/เตือน)
   */
  baseUnit?: string
  /**
   * 'none'  = ไม่กรอง/เตือนเลย (พฤติกรรมเดิม แม้จะส่ง baseUnit มา)
   * 'warn'  = (ค่าเริ่มต้นเมื่อมี baseUnit) จัดกลุ่มหน่วยที่แปลงถึงไว้บนสุด ส่วนที่แปลงไม่ถึงยังเลือกได้แต่หรี่สี+เตือน
   * 'strict'= เหมือน warn แต่หน่วยที่แปลงไม่ถึงเลือกไม่ได้ (disabled)
   */
  restrict?: 'none' | 'warn' | 'strict'
}

/** แถวที่เลือกได้ในลิสต์ */
interface Row {
  code: string
  label: string
  special?: UnitSpecial
  category?: UnitCategory
}

interface Group {
  key: string
  title: string
  rows: Row[]
  /** กลุ่มหน่วยพิเศษ — โชว์ badge */
  specialScope?: 'material' | 'tenant'
}

const CATEGORY_ORDER: UnitCategory[] = ['count', 'weight', 'volume', 'length', 'area', 'other']

export function UnitPicker({
  value,
  onChange,
  materialId,
  disabled = false,
  className = '',
  placeholder,
  size = 'md',
  baseUnit,
  restrict = 'warn',
}: UnitPickerProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { units, specials, loading } = useUnits(materialId || null)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, openUp: false })

  const categoryTitle = useCallback((c: UnitCategory) => {
    switch (c) {
      case 'count': return t('unitPicker.groupCount')
      case 'weight': return t('unitPicker.groupWeight')
      case 'volume': return t('unitPicker.groupVolume')
      case 'length': return t('unitPicker.groupLength')
      case 'area': return t('unitPicker.groupArea')
      default: return t('unitPicker.groupOther')
    }
  }, [t])

  /** ข้อความที่ใช้ค้นหาได้ของแต่ละหน่วย */
  const searchTextOf = useCallback((u: UnitOption, sp?: UnitSpecial) =>
    [u.value, u.label, ...(u.aliases ?? []), sp?.note ?? '', sp?.baseLabel ?? '']
      .join(' ')
      .toLowerCase()
  , [])

  const specialByCode = useMemo(() => {
    const m = new Map<string, UnitSpecial>()
    for (const s of specials) if (!m.has(s.code)) m.set(s.code, s)
    return m
  }, [specials])

  const unitByCode = useMemo(() => {
    const m = new Map<string, UnitOption>()
    for (const u of units) m.set(u.value, u)
    return m
  }, [units])

  // ---- ความเข้ากันได้กับหน่วยฐาน (baseUnit) — สำหรับกรอง/เตือนหน่วยที่แปลงไม่ถึง ----
  const baseUnitCode = useMemo(
    () => (baseUnit ? canonicalUnitCode(normalizeUnit(String(baseUnit))) : ''),
    [baseUnit]
  )
  const restrictActive = !!baseUnitCode && restrict !== 'none'
  const categoryOfCode = useCallback(
    (code: string) => unitByCode.get(code)?.category ?? unitCategoryOf(code),
    [unitByCode]
  )
  const baseUnitCategory = useMemo(
    () => (baseUnitCode ? categoryOfCode(baseUnitCode) : undefined),
    [baseUnitCode, categoryOfCode]
  )
  const baseUnitLabel = useMemo(
    () => (baseUnitCode ? unitByCode.get(baseUnitCode)?.label ?? unitLabelOf(baseUnitCode) : ''),
    [baseUnitCode, unitByCode]
  )

  /**
   * แปลงถึงหน่วยฐานได้ไหม (คำนวณฝั่ง client จาก units+specials ที่มีอยู่แล้ว ไม่ยิง API เพิ่ม):
   *  - category เดียวกับหน่วยฐาน → ถึงได้ (มาตราวัดเดียวกัน)
   *  - มี special ของหน่วยนี้ที่ baseUnit ตรงกับหน่วยฐานเป้าหมายเป๊ะ → ถึงได้ (1 hop)
   *  - หรือ special นั้นมี baseUnit อยู่ category เดียวกับหน่วยฐานเป้าหมาย → ถึงได้ (multi-hop ผ่าน category เดียวกัน)
   */
  const isReachable = useCallback(
    (code: string, category?: UnitCategory, sp?: UnitSpecial): boolean => {
      if (!restrictActive || !baseUnitCode) return true
      if (code === baseUnitCode) return true
      const cat = category ?? categoryOfCode(code)
      if (baseUnitCategory && cat === baseUnitCategory) return true
      const special = sp ?? specialByCode.get(code)
      if (special) {
        if (special.baseUnit === baseUnitCode) return true
        if (baseUnitCategory && categoryOfCode(special.baseUnit) === baseUnitCategory) return true
      }
      return false
    },
    [restrictActive, baseUnitCode, baseUnitCategory, categoryOfCode, specialByCode]
  )

  /** จัดกลุ่ม: หน่วยพิเศษของสินค้านี้ → หน่วยพิเศษทั้งระบบ → ตาม category */
  const groups: Group[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = (u: UnitOption, sp?: UnitSpecial) => !q || searchTextOf(u, sp).includes(q)

    const out: Group[] = []
    const usedInSpecial = new Set<string>()

    for (const scope of ['material', 'tenant'] as const) {
      const rows: Row[] = []
      for (const sp of specials) {
        if (sp.scope !== scope) continue
        if (usedInSpecial.has(sp.code)) continue
        const u = unitByCode.get(sp.code) ?? {
          value: sp.code, label: sp.label, category: sp.category, scope, aliases: [],
        }
        if (!matches(u, sp)) { usedInSpecial.add(sp.code); continue }
        rows.push({ code: sp.code, label: sp.label || u.label, special: sp, category: sp.category ?? u.category })
        usedInSpecial.add(sp.code)
      }
      if (rows.length) {
        out.push({
          key: `special-${scope}`,
          title: scope === 'material'
            ? t('unitPicker.groupMaterialSpecial')
            : t('unitPicker.groupTenantSpecial'),
          rows,
          specialScope: scope,
        })
      }
    }

    // หน่วยที่ขึ้นกลุ่มพิเศษไปแล้ว ไม่ต้องซ้ำในกลุ่มปกติ
    const byCategory = new Map<UnitCategory, Row[]>()
    for (const u of units) {
      if (specialByCode.has(u.value)) continue
      if (!matches(u)) continue
      const cat = (u.category ?? 'other') as UnitCategory
      if (!byCategory.has(cat)) byCategory.set(cat, [])
      byCategory.get(cat)!.push({ code: u.value, label: u.label, category: cat })
    }
    for (const cat of CATEGORY_ORDER) {
      const rows = byCategory.get(cat)
      if (rows && rows.length) out.push({ key: cat, title: categoryTitle(cat), rows })
    }
    return out
  }, [units, specials, query, specialByCode, unitByCode, searchTextOf, categoryTitle, t])

  /**
   * เมื่อมี baseUnit + restrict !== 'none': แยกหน่วยที่แปลงถึงหน่วยฐานได้จริงขึ้นมาเป็นกลุ่มบนสุด
   * ส่วนที่แปลงไม่ถึง ยังอยู่ในกลุ่มเดิม (ตาม category) แต่จะถูกหรี่สี+เตือนตอน render
   */
  const displayGroups: Group[] = useMemo(() => {
    if (!restrictActive) return groups
    const reachableRows: Row[] = []
    const rest: Group[] = []
    for (const g of groups) {
      const reach: Row[] = []
      const unreach: Row[] = []
      for (const row of g.rows) {
        if (isReachable(row.code, row.category, row.special)) reach.push(row)
        else unreach.push(row)
      }
      reachableRows.push(...reach)
      if (unreach.length) rest.push({ ...g, rows: unreach })
    }
    const out: Group[] = []
    if (reachableRows.length) {
      out.push({ key: '__reachable', title: t('unitPicker.groupReachable'), rows: reachableRows })
    }
    out.push(...rest)
    return out
  }, [groups, restrictActive, isReachable, t])

  /** ลิสต์แบน ใช้กับคีย์บอร์ด */
  const flatRows: Row[] = useMemo(() => displayGroups.flatMap(g => g.rows), [displayGroups])

  const selectedUnit = unitByCode.get(value)
  const selectedSpecial = specialByCode.get(value)
  const selectedLabel = selectedUnit?.label || (value ? value : '')
  const valueUnreachable =
    restrictActive && !!value && !isReachable(value, selectedUnit?.category, selectedSpecial)

  // ---- ตำแหน่ง dropdown (fixed + portal เพื่อไม่ให้โดน modal/overflow ตัด) ----
  const updatePos = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const desired = 320
    const below = window.innerHeight - rect.bottom
    const openUp = below < desired && rect.top > below
    setPos({
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 240),
      openUp,
    })
  }, [])

  useEffect(() => {
    if (!open) return
    updatePos()
    window.addEventListener('resize', updatePos)
    window.addEventListener('scroll', updatePos, true)
    return () => {
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
    }
  }, [open, updatePos])

  // ---- click นอกพื้นที่ = ปิด ----
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (containerRef.current?.contains(target)) return
      const portal = document.querySelector('[data-unit-picker-portal]')
      if (portal?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery('')
      const idx = flatRows.findIndex(r => r.code === value)
      setActiveIndex(idx >= 0 ? idx : 0)
      // โฟกัสช่องค้นหาหลัง portal mount
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => { setActiveIndex(0) }, [query])

  // เลื่อนรายการที่ active ให้อยู่ในจอ
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  /** ในโหมด strict ห้าม commit หน่วยที่แปลงไม่ถึงหน่วยฐาน */
  const canCommit = (row: Row) =>
    !(restrictActive && restrict === 'strict' && !isReachable(row.code, row.category, row.special))

  const commit = (code: string) => {
    onChange(code)
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => (flatRows.length ? (i + 1) % flatRows.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => (flatRows.length ? (i - 1 + flatRows.length) % flatRows.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = flatRows[activeIndex]
      if (row && canCommit(row)) commit(row.code)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const sm = size === 'sm'
  const triggerCls = [
    'w-full flex items-center justify-between gap-1 bg-[var(--bg)] border rounded-lg',
    'text-[var(--fg-1)] text-left transition-colors focus:outline-none',
    sm ? 'px-2 py-1.5 text-sm' : 'px-3 py-2 text-sm',
    open ? 'border-phopy-indigo' : 'border-[var(--border)]',
    disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-[var(--fg-4)]',
  ].join(' ')

  let rowCursor = -1

  const dropdown = (
    <motion.div
      data-unit-picker-portal
      initial={{ opacity: 0, y: pos.openUp ? 4 : -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      className="fixed z-[60] bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col overflow-hidden"
      style={{
        top: pos.openUp ? undefined : pos.top,
        bottom: pos.openUp ? window.innerHeight - pos.top : undefined,
        left: pos.left,
        width: pos.width,
        maxHeight: 320,
      }}
    >
      {/* ช่องค้นหา */}
      <div className="p-2 border-b border-[var(--border)]/60 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--fg-4)] pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('unitPicker.searchPlaceholder')}
            className="w-full pl-8 pr-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--fg-1)] placeholder-gray-600 focus:outline-none focus:border-phopy-indigo"
          />
        </div>
      </div>

      {/* รายการ */}
      <div ref={listRef} className="overflow-y-auto flex-1">
        {loading && flatRows.length === 0 && (
          <div className="px-3 py-3 text-center text-xs text-[var(--fg-4)]">
            {t('unitPicker.loading')}
          </div>
        )}
        {!loading && flatRows.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-[var(--fg-4)]">
            {t('unitPicker.noResults')}
          </div>
        )}
        {displayGroups.map(g => {
          const isReachableGroup = g.key === '__reachable'
          const isDimGroup = restrictActive && !isReachableGroup
          return (
          <div key={g.key}>
            <div className="sticky top-0 z-10 px-3 py-1.5 bg-[var(--surface)] border-b border-[var(--border)]/40 flex items-center gap-1.5">
              {g.specialScope && <Sparkles className="w-3 h-3 text-[var(--primary)]" />}
              {isReachableGroup && <CheckCircle2 className="w-3 h-3 text-success" />}
              <span className={`text-[11px] font-semibold tracking-wide ${isReachableGroup ? 'text-success' : 'text-[var(--fg-4)]'}`}>
                {g.title}
              </span>
            </div>
            {g.rows.map(row => {
              rowCursor += 1
              const idx = rowCursor
              const isActive = idx === activeIndex
              const isSelected = row.code === value
              const sp = row.special
              const disabledRow = isDimGroup && restrict === 'strict'
              return (
                <button
                  key={`${g.key}-${row.code}`}
                  type="button"
                  data-active={isActive}
                  disabled={disabledRow}
                  onMouseEnter={() => !disabledRow && setActiveIndex(idx)}
                  onMouseDown={e => { e.preventDefault(); if (canCommit(row)) commit(row.code) }}
                  className={`w-full px-3 py-2 text-left transition-colors ${
                    isActive && !disabledRow ? 'bg-[var(--bg)]' : ''
                  } ${isSelected ? 'bg-[var(--primary-soft)]' : ''} ${
                    disabledRow ? 'opacity-40 cursor-not-allowed' : isDimGroup ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-sm truncate ${isSelected ? 'text-[var(--primary)] font-medium' : 'text-[var(--fg-1)]'}`}>
                      {row.label}
                    </span>
                    {row.label !== row.code && (
                      <span className="text-[11px] font-mono text-[var(--fg-4)] shrink-0">
                        {row.code}
                      </span>
                    )}
                    {isDimGroup && (
                      <AlertTriangle className="ml-auto w-3 h-3 text-warning shrink-0" />
                    )}
                    {sp && (
                      <span
                        className={`${isDimGroup ? '' : 'ml-auto'} shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
                          sp.scope === 'material'
                            ? 'bg-[var(--warning-soft)] text-[var(--warning-strong)]'
                            : 'bg-[var(--info-soft)] text-[var(--info)]'
                        }`}
                      >
                        {sp.scope === 'material'
                          ? t('unitPicker.badgeMaterial')
                          : t('unitPicker.badgeTenant')}
                      </span>
                    )}
                  </div>
                  {isDimGroup && (
                    <div className="text-[11px] text-warning mt-0.5 truncate">
                      {t('unitPicker.unreachableRowHint', { base: baseUnitLabel })}
                    </div>
                  )}
                  {sp && (
                    <div className="text-[11px] text-[var(--fg-4)] mt-0.5 truncate">
                      {sp.note}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
          )
        })}
      </div>
    </motion.div>
  )

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        onKeyDown={e => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
            e.preventDefault()
            setOpen(true)
          }
        }}
        className={triggerCls}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <span className={`truncate ${selectedLabel ? 'text-[var(--fg-1)]' : 'text-[var(--fg-4)]'}`}>
            {selectedLabel || placeholder || t('unitPicker.placeholder')}
          </span>
          {selectedSpecial && (
            <span
              className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                selectedSpecial.scope === 'material' ? 'bg-[var(--warning)]' : 'bg-[var(--info)]'
              }`}
              title={selectedSpecial.note}
            />
          )}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[var(--fg-4)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && createPortal(dropdown, document.body)}
      {valueUnreachable && (
        <div className="mt-1 flex items-start gap-1 text-[11px] text-warning">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
          <span>
            {t('unitPicker.unreachableHint', { base: baseUnitLabel })}{' '}
            <button
              type="button"
              onClick={() => navigate('/settings?tab=units')}
              className="underline hover:text-[var(--primary)]"
            >
              {t('unitPicker.unreachableHintLink')}
            </button>
          </span>
        </div>
      )}
    </div>
  )
}

export default UnitPicker
