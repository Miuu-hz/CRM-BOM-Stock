import { useState, type ReactNode } from 'react'
import { Filter, X } from 'lucide-react'
import type { Account } from '../../services/accounting'

// ==================== ตัวกรองสมุดรายวัน (เก็บใน URL search params) ====================

export type PostedFilter = 'all' | 'draft' | 'posted'

export interface JournalFilters {
  no: string        // เลขที่ (contains)
  from: string      // YYYY-MM-DD
  to: string
  types: string[]   // reference_type หลายค่า — MANUAL = บันทึกเอง
  q: string         // ค้นหาในคำอธิบาย
  acc: string       // account id ที่อยู่ในบรรทัด
  dmin: string
  dmax: string
  cmin: string
  cmax: string
  status: PostedFilter
}

export interface TypeCount { type: string; count: number }

const TEXT_KEYS = ['no', 'from', 'to', 'q', 'acc', 'dmin', 'dmax', 'cmin', 'cmax'] as const

export function readFilters(sp: URLSearchParams): JournalFilters {
  const text = Object.fromEntries(TEXT_KEYS.map(k => [k, sp.get(k) ?? ''])) as Record<typeof TEXT_KEYS[number], string>
  const status = sp.get('status')
  return {
    ...text,
    types: (sp.get('types') ?? '').split(',').filter(Boolean),
    status: status === 'draft' || status === 'posted' ? status : 'all',
  }
}

export function writeFilters(f: JournalFilters): URLSearchParams {
  const sp = new URLSearchParams()
  for (const k of TEXT_KEYS) if (f[k].trim()) sp.set(k, f[k].trim())
  if (f.types.length) sp.set('types', f.types.join(','))
  if (f.status !== 'all') sp.set('status', f.status)
  return sp
}

export function toApiParams(f: JournalFilters) {
  const p: Record<string, string | boolean> = {}
  const put = (k: string, v: string) => { if (v.trim()) p[k] = v.trim() }
  put('entryNumber', f.no)
  put('startDate', f.from)
  put('endDate', f.to)
  put('q', f.q)
  put('accountId', f.acc)
  put('minDebit', f.dmin)
  put('maxDebit', f.dmax)
  put('minCredit', f.cmin)
  put('maxCredit', f.cmax)
  if (f.types.length) p.referenceTypes = f.types.join(',')
  if (f.status !== 'all') p.isPosted = f.status === 'posted'
  return p
}

// ---------- ช่วงวันที่ลัด (ตามเวลาเครื่องผู้ใช้) ----------
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function datePreset(kind: 'today' | 'thisMonth' | 'lastMonth', now = new Date()): { from: string; to: string } {
  if (kind === 'today') return { from: ymd(now), to: ymd(now) }
  const offset = kind === 'thisMonth' ? 0 : -1
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return { from: ymd(first), to: ymd(last) }
}

const fmtShortDate = (s: string) =>
  new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })

const rangeLabel = (min: string, max: string) =>
  min && max ? `${min}–${max}` : min ? `≥ ${min}` : `≤ ${max}`

// ---------- ป้ายตัวกรองที่ใช้อยู่ ----------
export function activeFilterChips(
  f: JournalFilters,
  typeLabel: (t: string) => string,
  accountLabel: (id: string) => string,
): Array<{ key: string; label: string; clear: Partial<JournalFilters> }> {
  const chips: Array<{ key: string; label: string; clear: Partial<JournalFilters> }> = []
  if (f.no) chips.push({ key: 'no', label: `เลขที่มี "${f.no}"`, clear: { no: '' } })
  if (f.from || f.to) {
    const label = f.from && f.to ? `${fmtShortDate(f.from)} – ${fmtShortDate(f.to)}` : f.from ? `ตั้งแต่ ${fmtShortDate(f.from)}` : `ถึง ${fmtShortDate(f.to)}`
    chips.push({ key: 'date', label: `วันที่ ${label}`, clear: { from: '', to: '' } })
  }
  for (const t of f.types) chips.push({ key: `t:${t}`, label: typeLabel(t), clear: { types: f.types.filter(x => x !== t) } })
  if (f.q) chips.push({ key: 'q', label: `คำอธิบายมี "${f.q}"`, clear: { q: '' } })
  if (f.acc) chips.push({ key: 'acc', label: `บัญชี ${accountLabel(f.acc)}`, clear: { acc: '' } })
  if (f.dmin || f.dmax) chips.push({ key: 'd', label: `เดบิต ${rangeLabel(f.dmin, f.dmax)}`, clear: { dmin: '', dmax: '' } })
  if (f.cmin || f.cmax) chips.push({ key: 'c', label: `เครดิต ${rangeLabel(f.cmin, f.cmax)}`, clear: { cmin: '', cmax: '' } })
  return chips
}

// ==================== UI ====================

const inputCls = 'w-full px-2.5 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--fg-1)] text-sm focus:outline-none focus:border-phopy-indigo'
const btnPrimary = 'px-3 py-1.5 bg-phopy-indigo text-white text-xs font-semibold rounded-lg hover:bg-phopy-indigo/80'
const btnGhost = 'px-3 py-1.5 text-xs text-[var(--fg-3)] hover:text-[var(--fg-1)]'

function ColumnFilter({ label, active, align = 'left', widthCls = 'w-64', children }: {
  label: string
  active: boolean
  align?: 'left' | 'right'
  widthCls?: string
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <div className={`relative ${align === 'right' ? 'flex justify-end' : ''}`}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className={`inline-flex items-center gap-1 uppercase tracking-wide rounded px-1 -mx-1 transition-colors hover:text-[var(--fg-1)] ${active ? 'text-[var(--primary)] font-semibold' : ''}`}>
        {label}
        <Filter className={`w-3 h-3 ${active ? 'fill-current' : 'opacity-50'}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={close} />
          <div className={`absolute top-full mt-2 z-40 ${widthCls} max-w-[calc(100vw-2rem)] ${align === 'right' ? 'right-0' : 'left-0'}
            bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl p-3 space-y-2.5 normal-case tracking-normal font-normal text-[var(--fg-2)] text-sm text-left`}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}>
            {children(close)}
          </div>
        </>
      )}
    </div>
  )
}

// แก้ค่าในกล่องก่อน แล้วกด "ใช้" (หรือ Enter) ค่อยยิง request — ไม่ต้อง debounce
function useDraft<T>(initial: T) {
  const [draft, setDraft] = useState(initial)
  return [draft, (patch: Partial<T>) => setDraft(d => ({ ...d, ...patch }))] as const
}

function Actions({ onApply, onClear }: { onApply: () => void; onClear: () => void }) {
  return (
    <div className="flex justify-end gap-1 pt-1">
      <button type="button" onClick={onClear} className={btnGhost}>ล้าง</button>
      <button type="button" onClick={onApply} className={btnPrimary}>ใช้ตัวกรอง</button>
    </div>
  )
}

function TextFilterBody({ value, placeholder, onApply }: { value: string; placeholder: string; onApply: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  return (
    <>
      <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} placeholder={placeholder}
        onKeyDown={e => { if (e.key === 'Enter') onApply(draft) }} className={inputCls} />
      <Actions onApply={() => onApply(draft)} onClear={() => onApply('')} />
    </>
  )
}

function DateFilterBody({ f, onApply }: { f: JournalFilters; onApply: (p: Partial<JournalFilters>) => void }) {
  const [d, setD] = useDraft({ from: f.from, to: f.to })
  const presets = [['today', 'วันนี้'], ['thisMonth', 'เดือนนี้'], ['lastMonth', 'เดือนก่อน']] as const
  return (
    <>
      <div className="flex gap-1.5">
        {presets.map(([k, label]) => (
          <button key={k} type="button" onClick={() => onApply(datePreset(k))}
            className="flex-1 px-2 py-1.5 text-xs rounded-lg bg-[var(--bg)] border border-[var(--border)] hover:border-phopy-indigo hover:text-[var(--primary)]">
            {label}
          </button>
        ))}
      </div>
      <label className="block text-xs text-[var(--fg-4)]">จาก
        <input type="date" value={d.from} max={d.to || undefined} onChange={e => setD({ from: e.target.value })} className={`${inputCls} mt-1`} />
      </label>
      <label className="block text-xs text-[var(--fg-4)]">ถึง
        <input type="date" value={d.to} min={d.from || undefined} onChange={e => setD({ to: e.target.value })} className={`${inputCls} mt-1`} />
      </label>
      <Actions onApply={() => onApply(d)} onClear={() => onApply({ from: '', to: '' })} />
    </>
  )
}

function AmountFilterBody({ min, max, onApply }: { min: string; max: string; onApply: (min: string, max: string) => void }) {
  const [d, setD] = useDraft({ min, max })
  const invalid = d.min !== '' && d.max !== '' && Number(d.min) > Number(d.max)
  const apply = () => { if (!invalid) onApply(d.min, d.max) }
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-[var(--fg-4)]">ต่ำสุด
          <input type="number" min={0} inputMode="decimal" value={d.min} onChange={e => setD({ min: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') apply() }} className={`${inputCls} mt-1 font-mono`} />
        </label>
        <label className="block text-xs text-[var(--fg-4)]">สูงสุด
          <input type="number" min={0} inputMode="decimal" value={d.max} onChange={e => setD({ max: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') apply() }} className={`${inputCls} mt-1 font-mono`} />
        </label>
      </div>
      {invalid && <p className="text-xs text-danger">ต่ำสุดต้องไม่มากกว่าสูงสุด</p>}
      <Actions onApply={apply} onClear={() => onApply('', '')} />
    </>
  )
}

const TYPE_GROUP_LABEL: Record<string, string> = {
  ASSET: 'สินทรัพย์', LIABILITY: 'หนี้สิน', EQUITY: 'ทุน', REVENUE: 'รายได้', EXPENSE: 'ค่าใช้จ่าย',
}

function DescriptionFilterBody({ f, typeCounts, typeLabel, accounts, onApply }: {
  f: JournalFilters
  typeCounts: TypeCount[]
  typeLabel: (t: string) => string
  accounts: Account[]
  onApply: (p: Partial<JournalFilters>) => void
}) {
  const [d, setD] = useDraft({ types: f.types, q: f.q, acc: f.acc })
  // ประเภทที่ติ๊กไว้แต่ไม่เหลือในผลลัพธ์ (เช่นเปลี่ยนช่วงวันที่) ต้องยังเห็นเพื่อเอาออกได้
  const rows = [...typeCounts, ...d.types.filter(t => !typeCounts.some(c => c.type === t)).map(type => ({ type, count: 0 }))]
  const toggle = (t: string) => setD({ types: d.types.includes(t) ? d.types.filter(x => x !== t) : [...d.types, t] })
  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-[var(--fg-4)]">ประเภทรายการ</span>
          {d.types.length > 0 && <button type="button" onClick={() => setD({ types: [] })} className="text-xs text-[var(--primary)]">ทุกประเภท</button>}
        </div>
        <div className="max-h-56 overflow-y-auto -mx-1">
          {rows.length === 0 && <p className="px-1 py-2 text-xs text-[var(--fg-4)]">ไม่มีรายการในช่วงที่กรอง</p>}
          {rows.map(({ type, count }) => (
            <label key={type} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-[var(--bg)] cursor-pointer">
              <input type="checkbox" checked={d.types.includes(type)} onChange={() => toggle(type)} className="accent-[var(--primary)]" />
              <span className="flex-1 truncate">{typeLabel(type)}</span>
              <span className="text-xs font-mono text-[var(--fg-4)]">{count}</span>
            </label>
          ))}
        </div>
      </div>
      <label className="block text-xs text-[var(--fg-4)]">ค้นหาในคำอธิบาย
        <input value={d.q} onChange={e => setD({ q: e.target.value })} placeholder="เช่น ค่าไฟ, ชื่อผู้ขาย"
          onKeyDown={e => { if (e.key === 'Enter') onApply(d) }} className={`${inputCls} mt-1`} />
      </label>
      <label className="block text-xs text-[var(--fg-4)]">มีบัญชีนี้ในบรรทัด
        <select value={d.acc} onChange={e => setD({ acc: e.target.value })} className={`${inputCls} mt-1`}>
          <option value="">ทุกบัญชี</option>
          {Object.entries(TYPE_GROUP_LABEL).map(([type, label]) => {
            const group = accounts.filter(a => a.type === type)
            return group.length ? (
              <optgroup key={type} label={label}>
                {group.map(a => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
              </optgroup>
            ) : null
          })}
        </select>
      </label>
      <Actions onApply={() => onApply(d)} onClear={() => onApply({ types: [], q: '', acc: '' })} />
    </>
  )
}

export interface ColumnFilterCells {
  number: ReactNode
  date: ReactNode
  description: ReactNode
  debit: ReactNode
  credit: ReactNode
}

// คืน cell หัวคอลัมน์ทีละช่อง ให้หน้าวางลง grid เดิม (และวางเป็นแถวปุ่มบนมือถือ)
export function columnFilterCells({ f, onChange, typeCounts, typeLabel, accounts }: {
  f: JournalFilters
  onChange: (p: Partial<JournalFilters>) => void
  typeCounts: TypeCount[]
  typeLabel: (t: string) => string
  accounts: Account[]
}): ColumnFilterCells {
  return {
    number: (
      <ColumnFilter label="เลขที่" active={!!f.no} widthCls="w-56">
        {close => <TextFilterBody value={f.no} placeholder="เช่น JV-2026-001" onApply={no => { onChange({ no }); close() }} />}
      </ColumnFilter>
    ),
    date: (
      <ColumnFilter label="วันที่" active={!!(f.from || f.to)}>
        {close => <DateFilterBody f={f} onApply={p => { onChange(p); close() }} />}
      </ColumnFilter>
    ),
    description: (
      <ColumnFilter label="รายการ" active={!!(f.types.length || f.q || f.acc)} widthCls="w-80">
        {close => (
          <DescriptionFilterBody f={f} typeCounts={typeCounts} typeLabel={typeLabel} accounts={accounts}
            onApply={p => { onChange(p); close() }} />
        )}
      </ColumnFilter>
    ),
    debit: (
      <ColumnFilter label="เดบิต" active={!!(f.dmin || f.dmax)} align="right" widthCls="w-60">
        {close => <AmountFilterBody min={f.dmin} max={f.dmax} onApply={(dmin, dmax) => { onChange({ dmin, dmax }); close() }} />}
      </ColumnFilter>
    ),
    credit: (
      <ColumnFilter label="เครดิต" active={!!(f.cmin || f.cmax)} align="right" widthCls="w-60">
        {close => <AmountFilterBody min={f.cmin} max={f.cmax} onApply={(cmin, cmax) => { onChange({ cmin, cmax }); close() }} />}
      </ColumnFilter>
    ),
  }
}

export function ActiveFilterBar({ chips, onClear, onClearAll }: {
  chips: ReturnType<typeof activeFilterChips>
  onClear: (p: Partial<JournalFilters>) => void
  onClearAll: () => void
}) {
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-[var(--fg-4)] mr-1">กรองอยู่:</span>
      {chips.map(c => (
        <span key={c.key} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 text-xs rounded-full bg-[var(--info-soft)] text-[var(--primary)]">
          {c.label}
          <button type="button" onClick={() => onClear(c.clear)} aria-label={`ล้าง ${c.label}`}
            className="p-0.5 rounded-full hover:bg-[var(--primary)]/15"><X className="w-3 h-3" /></button>
        </span>
      ))}
      <button type="button" onClick={onClearAll} className="text-xs text-[var(--fg-3)] hover:text-danger underline underline-offset-2 ml-1">
        ล้างทั้งหมด
      </button>
    </div>
  )
}
