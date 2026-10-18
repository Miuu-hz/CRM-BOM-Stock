import type { ReactNode } from 'react'
import { Search } from 'lucide-react'

// แถบกรองแถวเดียวแบบหน้าคลังสินค้า — ช่องค้นหา + ชิปพร้อมจำนวน + ปุ่มด้านขวา
// ใช้ร่วมกันใน Stock / Sales / Purchase / BOM หน้าตาจะได้เหมือนกันทุกหน้า

export type ChipTone = 'neutral' | 'warning' | 'danger'

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-2.5 flex flex-wrap items-center gap-2">
      {children}
    </div>
  )
}

export function FilterSearch({ value, onChange, placeholder, label }: {
  value: string; onChange: (v: string) => void; placeholder: string; label?: string
}) {
  return (
    <div className="relative flex-1 min-w-[200px] basis-full sm:basis-60">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--fg-4)]" aria-hidden="true" />
      <input
        type="search"
        placeholder={placeholder}
        aria-label={label || placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 pl-9 pr-3 rounded-[10px] bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--fg-1)] placeholder-[var(--fg-4)] focus:outline-none focus:border-[var(--primary)]"
      />
    </div>
  )
}

/** แถวชิป — บนมือถือเลื่อนแนวนอนแทนที่จะตกบรรทัดจนเต็มจอ */
export function FilterChips({ children }: { children: ReactNode }) {
  return <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-0.5 px-0.5 py-0.5">{children}</div>
}

export const ChipDivider = () => <span className="w-px h-6 bg-[var(--border)] shrink-0 mx-0.5" />

export function FilterChip({
  label,
  active,
  onClick,
  count,
  tone = 'neutral',
  dot = false,
}: {
  label: string
  active: boolean
  onClick: () => void
  count?: number
  tone?: ChipTone
  /** จุดสีนำหน้าชิปสถานะ — กวาดตาแยกสถานะได้โดยไม่ต้องอ่าน */
  dot?: boolean
}) {
  const empty = count === 0
  const activeCls =
    tone === 'danger' ? 'bg-[var(--danger-soft)] text-danger border-danger/40'
      : tone === 'warning' ? 'bg-[var(--warning-soft)] text-warning border-warning/40'
        : 'bg-[var(--primary)] text-white border-[var(--primary)]'
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm whitespace-nowrap transition-colors ${
        active ? activeCls
          : `bg-transparent border-[var(--border)] hover:border-phopy-indigo/30 ${empty ? 'text-[var(--fg-4)]' : 'text-[var(--fg-3)]'}`
      }`}
    >
      {dot && (
        <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${
          tone === 'danger' ? 'bg-[var(--danger)]' : tone === 'warning' ? 'bg-[var(--warning)]' : 'bg-[var(--fg-4)]'
        }`} />
      )}
      {label}
      {count !== undefined && (
        <span className={`text-[11px] tabular-nums ${active ? 'opacity-70' : 'text-[var(--fg-4)]'}`}>{count}</span>
      )}
    </button>
  )
}

const DANGER = new Set(['CANCELLED', 'REJECTED', 'OVERDUE', 'UNPAID'])
const WARNING = new Set(['PENDING', 'PENDING_APPROVAL', 'SUBMITTED', 'PARTIAL', 'PARTIAL_PAID'])
export const statusTone = (s: string): ChipTone => (DANGER.has(s) ? 'danger' : WARNING.has(s) ? 'warning' : 'neutral')

/**
 * ชิป "ทั้งหมด" + ชิปต่อสถานะที่มีอยู่จริงในรายการ พร้อมจำนวน
 * rows = รายการที่ผ่านคำค้น/ตัวกรองอื่นแล้ว แต่ยังไม่กรองสถานะ — ตัวเลขบนชิปจะได้ตรงกับที่กดแล้วเห็น
 * สถานะที่นับได้ 0 ถูกซ่อน (ยกเว้นตัวที่เลือกค้างอยู่) เรียงตาม order ที่ส่งมา ที่เหลือต่อท้าย
 */
export function StatusChips({ rows, value, onChange, labelOf, order = [], allLabel = 'ทั้งหมด', field = 'status' }: {
  rows: Record<string, any>[]
  value: string
  onChange: (status: string) => void
  labelOf: (status: string) => string
  order?: string[]
  allLabel?: string
  field?: string
}) {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const s = r[field]
    if (s) counts.set(s, (counts.get(s) || 0) + 1)
  }
  if (value && !counts.has(value)) counts.set(value, 0)
  const rank = (s: string) => { const i = order.indexOf(s); return i < 0 ? order.length : i }
  const statuses = [...counts.keys()].sort((a, b) => rank(a) - rank(b))
  if (statuses.length === 0) return null
  return (
    <>
      <FilterChip label={allLabel} count={rows.length} active={!value} onClick={() => onChange('')} />
      {statuses.map(s => (
        <FilterChip key={s} label={labelOf(s)} count={counts.get(s)} tone={statusTone(s)} dot
          active={value === s} onClick={() => onChange(value === s ? '' : s)} />
      ))}
    </>
  )
}
