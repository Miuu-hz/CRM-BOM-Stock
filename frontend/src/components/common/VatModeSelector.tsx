import { useRef } from 'react'
import { VatMode, VAT_MODE_LABEL, VAT_MODE_LABEL_SHORT } from '../../utils/vat'

// ponytail: ป้าย/คำเตือนฮาร์ดโค้ดเป็นไทยล้วน (ตาม Cashier.tsx ที่ทำแบบนี้อยู่แล้ว) — ไม่ผ่าน i18n
// เพราะ vatModeWarning ใน utils/vat.ts ต้อง interpolate ป้ายเดียวกันนอกคอมโพเนนต์ React
// อัปเกรด: ถ้าต้องรองรับ EN จริงจัง ส่ง t() เข้าไปเป็น param ของ vat.ts ทั้งชุด

// ปุ่มกลุ่มเลือกโหมด VAT — ที่เดียวที่ใช้ในทุกหัวเอกสาร (Quotation/SO/PO/PI/Return)
// ทั้ง 3 ปุ่มโชว์พร้อมกันเสมอ ไม่ทำเป็น dropdown (ผู้ใช้ต้องเห็นตัวเลือกทั้งหมดตั้งแต่แรก)
const MODES: VatMode[] = ['NONE', 'INCLUSIVE', 'EXCLUSIVE']

/** ปุ่มลูกศรซ้าย/ขวา เลื่อน + เลือกไปในตัว ตามมาตรฐาน ARIA radiogroup */
function segmentedKeyNav(groupRef: React.RefObject<HTMLDivElement>, count: number, onSelect: (i: number) => void) {
  return (e: React.KeyboardEvent, i: number) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return
    e.preventDefault()
    const dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1
    const next = (i + dir + count) % count
    onSelect(next)
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }
}

const segBtn = (active: boolean, disabled: boolean, first: boolean) =>
  `px-3 py-1.5 text-sm whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-1 transition-colors ${first ? '' : 'border-l border-[var(--border)]'} ${
    disabled ? 'bg-[var(--bg)] text-[var(--fg-4)] cursor-not-allowed'
      : active ? 'bg-phopy-indigo text-white' : 'bg-[var(--surface)] text-[var(--fg-2)] hover:bg-[var(--bg)]'
  }`

export function VatModeSelector({ value, onChange, locked, sourceHint, warning, groupLabel = 'โหมด VAT' }: {
  value: VatMode
  onChange: (m: VatMode) => void
  /** ล็อกเลือกไม่ได้ — เทาทั้งแถบ + โชว์เหตุผล (แทน sourceHint) */
  locked?: { reason: string }
  /** บรรทัดเล็กใต้ปุ่ม บอกที่มาของค่าเริ่มต้น เช่น "ตามที่ใช้ครั้งก่อนกับผู้ขายรายนี้" */
  sourceHint?: string
  /** แถบเหลืองเตือนแบบไม่บล็อก */
  warning?: string
  groupLabel?: string
}) {
  const groupRef = useRef<HTMLDivElement>(null)
  const disabled = !!locked
  const onKeyDown = segmentedKeyNav(groupRef, MODES.length, i => !disabled && onChange(MODES[i]))

  return (
    <div>
      <div ref={groupRef} role="radiogroup" aria-label={groupLabel}
        className={`inline-flex rounded-lg border border-[var(--border)] overflow-hidden ${disabled ? 'opacity-70' : ''}`}>
        {MODES.map((m, i) => {
          const active = value === m
          return (
            <button key={m} type="button" role="radio" aria-checked={active} disabled={disabled}
              tabIndex={active ? 0 : -1}
              onClick={() => !disabled && onChange(m)}
              onKeyDown={e => onKeyDown(e, i)}
              className={segBtn(active, disabled, i === 0)}>
              <span className="hidden sm:inline">{VAT_MODE_LABEL[m]}</span>
              <span className="sm:hidden">{VAT_MODE_LABEL_SHORT[m]}</span>
            </button>
          )
        })}
      </div>
      {locked && <p className="text-xs text-[var(--fg-4)] mt-1">{locked.reason}</p>}
      {!locked && sourceHint && <p className="text-xs text-[var(--fg-4)] mt-1">{sourceHint}</p>}
      {warning && (
        <p className="text-xs text-warning bg-yellow-500/10 border border-yellow-500/20 rounded px-2 py-1 mt-1">{warning}</p>
      )}
    </div>
  )
}

// ── สำหรับฟอร์มผู้ติดต่อ (ลูกค้า/ผู้ขาย) — เพิ่มตัวเลือก "ไม่ระบุ" (null) ──────────
const FIELD_MODES: (VatMode | null)[] = [null, 'NONE', 'INCLUSIVE', 'EXCLUSIVE']
const fieldLabel = (m: VatMode | null, short: boolean) =>
  m === null ? 'ไม่ระบุ' : short ? VAT_MODE_LABEL_SHORT[m] : VAT_MODE_LABEL[m]

export function VatModeField({ value, onChange, label }: {
  value: VatMode | null
  onChange: (m: VatMode | null) => void
  label?: string
}) {
  const groupRef = useRef<HTMLDivElement>(null)
  const lbl = label || 'VAT ของลูกค้า/ผู้ขายรายนี้'
  const onKeyDown = segmentedKeyNav(groupRef, FIELD_MODES.length, i => onChange(FIELD_MODES[i]))

  return (
    <div>
      <label className="block text-sm text-[var(--fg-3)] mb-1.5">{lbl}</label>
      <div ref={groupRef} role="radiogroup" aria-label={lbl}
        className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden flex-wrap">
        {FIELD_MODES.map((m, i) => {
          const active = value === m
          return (
            <button key={String(m)} type="button" role="radio" aria-checked={active} tabIndex={active ? 0 : -1}
              onClick={() => onChange(m)}
              onKeyDown={e => onKeyDown(e, i)}
              className={segBtn(active, false, i === 0)}>
              <span className="hidden sm:inline">{fieldLabel(m, false)}</span>
              <span className="sm:hidden">{fieldLabel(m, true)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
