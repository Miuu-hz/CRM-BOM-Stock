import type { ReactNode, ElementType } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Ban, Lock, X } from 'lucide-react'
import { useModalClose } from '../../hooks/useModalClose'

// โครงโมดัล "ดูเอกสาร" แบบเดียวกับรายละเอียดใบสั่งซื้อ (Purchase.tsx)
//   หัว = ชื่อชนิดเอกสาร · แถบเลขที่ + คู่ค้า · ขั้นสถานะ · ช่องข้อมูลมีป้ายกำกับ · ตารางรายการ · ยอดรวม
//   ท้าย = ปุ่ม "ปิด" ซ้าย · งานหลักขวา (ปุ่มทึบ 1 ปุ่ม + ปุ่มขอบ) · งานทำลาย (ยกเลิก/ลบ) เป็นตัวหนังสือแดง
// ทุกส่วนเป็น props ล้วน ไม่ยิง API เอง

export function DocModal({ title, onClose, children, footer, wide }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean
}) {
  useModalClose(onClose)
  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={e => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={title}
        className={`bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-3xl'} flex flex-col`}
        style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold text-[var(--fg-1)]">{title}</h2>
          <button onClick={onClose} aria-label="close" className="p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)]"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto px-6 py-5 space-y-5">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-[var(--border)] shrink-0">{footer}</div>}
      </motion.div>
    </div>
  )
}

/** แถบเลขที่เอกสาร — ไอคอน · เลขที่ · คู่ค้าชิดขวา (เหมือนแถบ PO) */
export const DocBand = ({ icon: Icon, number, party, right }: { icon: ElementType; number: string; party?: string; right?: ReactNode }) => (
  <div className="flex items-center gap-2 p-3 bg-phopy-indigo/10 border border-phopy-indigo-50 rounded-xl">
    <Icon className="w-4 h-4 text-[var(--primary)] shrink-0" />
    <span className="text-sm font-mono text-[var(--primary)] font-semibold">{number}</span>
    <span className="text-xs text-[var(--fg-3)] ml-auto truncate">{party}</span>
    {right}
  </div>
)

/** ขั้นสถานะเป็นชิปต่อกันด้วยลูกศร — dead = ใบที่ยกเลิก/ปฏิเสธ แสดงแถบแดงแทน */
export const StatusFlow = ({ steps, current, dead, skipped = [] }: {
  steps: { key: string; label: string }[]; current: string; dead?: string; skipped?: string[]
}) => {
  if (dead) return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--danger-soft)] border border-danger/30">
      <Ban className="w-4 h-4 text-danger shrink-0" /><span className="text-sm font-medium text-danger">{dead}</span>
    </div>
  )
  const idx = steps.findIndex(s => s.key === current)
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-1">
      {steps.map((s, i) => {
        const skip = skipped.includes(s.key)
        const tone = i === idx ? 'bg-phopy-indigo text-white' : skip ? 'bg-[var(--surface-2)] text-[var(--fg-4)] line-through'
          : idx >= 0 && i < idx ? 'bg-[var(--success-soft)] text-success' : 'bg-[var(--surface-2)] text-[var(--fg-4)]'
        return (
          <div key={s.key} className="flex items-center gap-1 shrink-0">
            <div className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${tone}`}>{s.label}</div>
            {i < steps.length - 1 && <ArrowRight className="w-3 h-3 text-[var(--fg-4)] shrink-0" />}
          </div>
        )
      })}
    </div>
  )
}

/** หัวข้อย่อยในโมดัล */
export const DocSection = ({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) => (
  <section className="space-y-2">
    <div className="flex items-baseline justify-between"><h3 className="text-sm font-semibold text-[var(--fg-1)]">{title}</h3>{right}</div>
    {children}
  </section>
)

/** ช่องข้อมูลมีป้ายกำกับ 2 คอลัมน์ — ค่าว่างแสดง "-" ไม่ซ่อนแถว จะได้รู้ว่ายังไม่ได้กรอก */
export const FieldGrid = ({ fields }: { fields: { label: string; value?: ReactNode; full?: boolean; tone?: string }[] }) => (
  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-[var(--border)] p-4">
    {fields.map(f => (
      <div key={f.label} className={f.full ? 'sm:col-span-2' : ''}>
        <dt className="text-xs text-[var(--fg-4)]">{f.label}</dt>
        <dd className={`text-sm mt-0.5 break-words ${f.tone ?? 'text-[var(--fg-1)]'}`}>{f.value === undefined || f.value === null || f.value === '' ? '-' : f.value}</dd>
      </div>
    ))}
  </dl>
)

export type DocItemRow = { name: string; sub?: string; warn?: string; qty: number; unit?: string; price: number; discount?: string; amount: number }
const money = (n: number) => (n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** ตารางรายการแบบเอกสาร — # · รายการ · จำนวน · หน่วย · ราคา/หน่วย · ส่วนลด · จำนวนเงิน */
//   qtyOnly = เอกสารที่ไม่มีราคา (ใบส่งของ/ค้างส่ง) ซ่อน 3 คอลัมน์เงิน ไม่ใช่โชว์ 0.00
export const ItemsTable = ({ rows, labels, qtyOnly }: {
  rows: DocItemRow[]
  labels: { no: string; item: string; qty: string; unit: string; price: string; discount: string; amount: string; empty: string }
  qtyOnly?: boolean
}) => (
  <div className="rounded-xl border border-[var(--border)] overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-[var(--surface-2)] text-xs text-[var(--fg-3)] border-b border-[var(--border)]">
          <th className="px-3 py-2 text-center font-medium w-10">{labels.no}</th>
          <th className="px-3 py-2 text-left font-medium">{labels.item}</th>
          <th className="px-3 py-2 text-right font-medium">{labels.qty}</th>
          <th className="px-3 py-2 text-left font-medium">{labels.unit}</th>
          {!qtyOnly && <><th className="px-3 py-2 text-right font-medium">{labels.price}</th>
          <th className="px-3 py-2 text-right font-medium">{labels.discount}</th>
          <th className="px-3 py-2 text-right font-medium">{labels.amount}</th></>}
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--border)]/60">
        {rows.length === 0 ? (
          <tr><td colSpan={qtyOnly ? 4 : 7} className="px-3 py-6 text-center text-xs text-[var(--fg-4)]">{labels.empty}</td></tr>
        ) : rows.map((r, i) => (
          <tr key={i}>
            <td className="px-3 py-2 text-center text-xs text-[var(--fg-4)] tabular-nums">{i + 1}</td>
            <td className="px-3 py-2"><p className="text-[var(--fg-1)]">{r.name}</p>{r.sub && <p className="text-[11px] text-[var(--fg-4)]">{r.sub}</p>}{r.warn && <p className="text-[11px] text-danger">{r.warn}</p>}</td>
            <td className="px-3 py-2 text-right tabular-nums">{(r.qty || 0).toLocaleString('th-TH')}</td>
            <td className="px-3 py-2 text-[var(--fg-3)]">{r.unit || '-'}</td>
            {!qtyOnly && <><td className="px-3 py-2 text-right tabular-nums">{money(r.price)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-[var(--fg-3)]">{r.discount || '-'}</td>
            <td className="px-3 py-2 text-right tabular-nums font-medium text-[var(--fg-1)]">{money(r.amount)}</td></>}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

/** ยอดรวมชิดขวาแบบท้ายเอกสาร — grand คือบรรทัดหนาสุดท้าย */
export const TotalsBox = ({ rows, grand }: { rows: { label: string; value: number; sign?: '+' | '-' }[]; grand: { label: string; value: number } }) => (
  <div className="flex justify-end">
    <dl className="w-full sm:w-80 text-sm space-y-1.5">
      {rows.map(r => (
        <div key={r.label} className="flex justify-between text-[var(--fg-3)]">
          <dt>{r.label}</dt><dd className="tabular-nums">{r.sign === '-' ? '-' : ''}฿{money(r.value)}</dd>
        </div>
      ))}
      <div className="flex justify-between border-t border-[var(--border)] pt-2 font-bold text-base text-[var(--fg-1)]">
        <dt>{grand.label}</dt><dd className="tabular-nums">฿{money(grand.value)}</dd>
      </div>
    </dl>
  </div>
)

/** ปุ่มท้ายโมดัล — ใช้ 3 แบบนี้เท่านั้น ห้ามปุ่มพาสเทลหลายสี */
export const btnPrimary = 'px-5 py-2.5 bg-phopy-indigo text-white font-semibold rounded-xl hover:bg-phopy-indigo/80 disabled:opacity-50 flex items-center gap-2 text-sm transition-colors'
export const btnSecondary = 'px-4 py-2.5 border border-[var(--border)] text-[var(--fg-2)] rounded-xl hover:bg-[var(--bg)] disabled:opacity-50 flex items-center gap-2 text-sm transition-colors'
export const btnDanger = 'px-3 py-2 text-danger hover:bg-[var(--danger-soft)] rounded-xl disabled:opacity-50 text-sm transition-colors'
export const btnClose = 'px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] text-sm'

/** ข้อความล็อกท้ายโมดัล เช่น "ยืนยันแล้ว แก้ไขไม่ได้" */
export const LockedNote = ({ text }: { text: string }) => (
  <span className="flex items-center gap-1.5 text-xs text-[var(--fg-4)]"><Lock className="w-3.5 h-3.5" />{text}</span>
)
