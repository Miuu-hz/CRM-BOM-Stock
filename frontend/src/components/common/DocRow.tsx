import { useState } from 'react'
import { ArrowRight, Ban, CheckCircle2, Lock, MoreHorizontal } from 'lucide-react'

// ชิ้นส่วนแถวเอกสารที่หน้าจัดซื้อและหน้าขายใช้ร่วมกัน (ย้ายมาจาก Purchase.tsx ไม่ได้เขียนใหม่)
// เมนู "..." ท้ายแถว — เก็บปุ่มรอง (พิมพ์/แก้/ลบ/ยกเลิก) ไม่ให้แย่งสายตากับปุ่มขั้นต่อไป
// เงื่อนไขสิทธิ์/สถานะยังเป็นของเดิมทุกข้อ แค่ย้ายที่อยู่ — ไม่ได้เปิดสิทธิ์ให้ใครเพิ่ม
export type RowMenuItem = { label: string; onClick: () => void; danger?: boolean }

export const RowMenu = ({ items, label }: { items: RowMenuItem[]; label: string }) => {
  // เมนูเป็น fixed ตามตำแหน่งปุ่ม (แบบเมนูแถวหน้าคลัง) — absolute เดิมโดนกล่องตาราง overflow ตัดทิ้งที่แถวล่าง ๆ
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const open = anchor !== null
  const setOpen = (v: boolean) => { if (!v) setAnchor(null) }
  if (items.length === 0) return null
  const menuH = items.length * 40 + 8
  const top = anchor && (anchor.bottom + 6 + menuH > window.innerHeight ? Math.max(8, anchor.top - 6 - menuH) : anchor.bottom + 6)
  return (
    <div className="relative flex justify-end">
      <button onClick={e => { e.stopPropagation(); setAnchor(open ? null : e.currentTarget.getBoundingClientRect()) }} aria-label={label} aria-expanded={open}
        className="p-2 rounded-lg text-[var(--fg-4)] hover:text-[var(--fg-1)] hover:bg-[var(--bg)] transition-colors">
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (<>
        <div className="fixed inset-0 z-40" onClick={e => { e.stopPropagation(); setOpen(false) }} />
        <div role="menu" className="fixed z-50 min-w-[168px] py-1 rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-xl"
          style={{ top: top ?? 0, right: Math.max(8, window.innerWidth - (anchor?.right ?? 0)) }}>
          {items.map(it => (
            <button key={it.label} onClick={e => { e.stopPropagation(); setOpen(false); it.onClick() }}
              className={`w-full text-left px-3 py-2.5 text-xs transition-colors hover:bg-[var(--bg)] ${it.danger ? 'text-danger' : 'text-[var(--fg-2)]'}`}>
              {it.label}
            </button>
          ))}
        </div>
      </>)}
    </div>
  )
}

// แถบ "ไปถึงไหนแล้ว" — ขีดสั้น ๆ บอกว่าใบนี้เดินมาถึงขั้นไหนของสาย
//   เขียว = ผ่านแล้ว · น้ำเงิน = อยู่ตรงนี้ · เทา = ยังไม่ถึง · เทาจาง = ข้ามขั้นนั้นไป
// ใบที่ถูกยกเลิก/ปฏิเสธไม่วาดขีด เพราะมันไม่ได้อยู่บนสายแล้ว — ขึ้นป้ายแดงแทน
const SKIP_NOTE = 'ข้ามขั้นนี้ไป'
export type StageView = { stages: string[]; idx: number; skipped?: number[]; dead?: string }

export const StagePips = ({ view }: { view: StageView }) => {
  if (view.dead) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--danger-soft)] text-danger text-[11px] font-medium">
        <Ban className="w-3 h-3 shrink-0" />{view.dead}
      </span>
    )
  }
  const last = view.stages.length - 1
  return (
    <div>
      <div className="flex items-center gap-[3px] mb-1">
        {view.stages.map((label, i) => {
          const skipped = view.skipped?.includes(i)
          // ขั้นที่ข้าม = เขียวจาง ไม่ใช่เทาเลือน ไม่งั้นอ่านเป็นหลอดหาย
          const tone = skipped ? 'bg-success/35'
            : i < view.idx ? 'bg-success'
              : i === view.idx ? 'bg-phopy-indigo' : 'bg-[var(--border-strong)]'
          return (
            <span key={i} title={skipped ? `${label} — ${SKIP_NOTE}` : label}
              className={`w-[15px] h-1 rounded-sm shrink-0 ${tone}`} />
          )
        })}
      </div>
      <span className={`text-[11px] font-medium ${view.idx >= last ? 'text-success' : 'text-[var(--primary)]'}`}>
        {view.stages[view.idx] ?? view.stages[last]}
      </span>
    </div>
  )
}

// ช่อง "ขั้นต่อไป" ของแต่ละแถว — มี 3 หน้าตาเท่านั้น
//   ปุ่ม    = ยังทำได้ กดแล้วเปิดโมดัลสร้างเอกสารใบถัดไป (กรอกให้แล้ว แก้ได้ก่อนยืนยัน)
//   ข้อความ = ทำไปแล้ว บอกว่าไปเป็นใบไหน กดไปดูใบนั้นได้
//   กล่องเทา = ยังทำไม่ได้ พร้อมเหตุผล — ไม่ซ่อนให้ต้องเดา
export type NextStep =
  | { kind: 'action'; label: string; onClick: () => void }
  | { kind: 'done'; label: string; docNumber?: string; onClick?: () => void }
  | { kind: 'locked'; label: string }

export const NextStepCell = ({ step }: { step: NextStep }) => {
  if (step.kind === 'action') {
    return (
      <button onClick={step.onClick} aria-label={step.label}
        className="flex items-center justify-center gap-1.5 w-full min-h-[40px] px-3 rounded-lg bg-phopy-indigo/10 text-[var(--primary)] border border-phopy-indigo/30 text-xs font-semibold hover:bg-phopy-indigo/15 transition-colors">
        {step.label}
        <ArrowRight className="w-3.5 h-3.5 shrink-0" />
      </button>
    )
  }
  if (step.kind === 'done') {
    const body = (
      <span className="flex items-center justify-center gap-1.5">
        <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
        <span className="text-xs text-[var(--fg-3)]">{step.label}</span>
        {step.docNumber && <span className="text-xs font-mono text-[var(--primary)]">{step.docNumber}</span>}
      </span>
    )
    return step.onClick
      ? <button onClick={step.onClick} aria-label={`${step.label} ${step.docNumber ?? ''}`}
          className="w-full min-h-[40px] px-3 rounded-lg hover:bg-[var(--bg)] transition-colors">{body}</button>
      : <div className="w-full min-h-[40px] px-3 flex items-center justify-center">{body}</div>
  }
  return (
    <div className="flex items-center justify-center gap-1.5 w-full min-h-[40px] px-3 rounded-lg bg-[var(--surface-2)] border border-dashed border-[var(--border-strong)]">
      <Lock className="w-3 h-3 text-[var(--fg-4)] shrink-0" />
      <span className="text-xs text-[var(--fg-3)] leading-tight">{step.label}</span>
    </div>
  )
}
