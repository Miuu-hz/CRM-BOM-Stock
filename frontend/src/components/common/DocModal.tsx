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
    <div className="fixed inset-0 bg-[var(--fg-1)]/60 backdrop-blur-sm z-50 flex items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={e => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={title}
        className={`bg-[var(--surface)] border border-[var(--border)] rounded-t-2xl sm:rounded-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-3xl'} flex flex-col max-h-[calc(100dvh-0.5rem)] sm:max-h-[calc(100vh-2rem)]`}>
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-[var(--border)] flex items-center justify-between gap-3 shrink-0">
          <h2 className="text-base sm:text-lg font-bold text-[var(--fg-1)] truncate min-w-0">{title}</h2>
          <button onClick={onClose} aria-label="close" className="p-2 sm:p-1.5 rounded-lg hover:bg-[var(--bg)] text-[var(--fg-3)] hover:text-[var(--fg-1)] shrink-0 min-h-[40px] min-w-[40px] flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 space-y-4 sm:space-y-5 flex-1 min-h-0 overscroll-contain">{children}</div>
        {/* จอ < 640: กลุ่มปุ่มซ้าย/ขวาของแต่ละโมดัลไหลรวมแถวเดียว (contents) — ไม่งั้น "ปิด" ตกไปอยู่แถวของตัวเอง ท้ายโมดัลกินจอ 1 ใน 3 */}
        {footer && <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-[var(--border)] shrink-0 bg-[var(--surface)] max-sm:[&>div]:flex max-sm:[&>div]:flex-wrap max-sm:[&>div]:items-center max-sm:[&>div]:gap-2 max-sm:[&>div>div]:contents">{footer}</div>}
      </motion.div>
    </div>
  )
}

/** แถบเลขที่เอกสาร — ไอคอน · เลขที่ · คู่ค้าชิดขวา (เหมือนแถบ PO) */
export const DocBand = ({ icon: Icon, number, party, right }: { icon: ElementType; number: string; party?: string; right?: ReactNode }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2 p-3 bg-phopy-indigo/10 border border-phopy-indigo-50 rounded-xl">
    <div className="flex items-center gap-2 min-w-0">
      <Icon className="w-4 h-4 text-[var(--primary)] shrink-0" />
      <span className="text-sm font-mono text-[var(--primary)] font-semibold shrink-0">{number}</span>
    </div>
    {(party || right) && (
      <div className="flex items-center gap-2 min-w-0 sm:ml-auto pl-6 sm:pl-0">
        {party && <span className="text-xs text-[var(--fg-3)] truncate">{party}</span>}
        {right}
      </div>
    )}
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
    <div className="relative">
      <div className="flex items-center gap-1 overflow-x-auto py-1 flex-nowrap pr-8 sm:pr-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
      <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[var(--surface)] to-transparent sm:hidden" />
    </div>
  )
}

/** หัวข้อย่อยในโมดัล */
export const DocSection = ({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) => (
  <section className="space-y-2">
    <div className="flex items-baseline justify-between gap-2 flex-wrap"><h3 className="text-sm font-semibold text-[var(--fg-1)]">{title}</h3>{right}</div>
    {children}
  </section>
)

/** ช่องข้อมูลมีป้ายกำกับ 2 คอลัมน์ — ค่าว่างแสดง "-" ไม่ซ่อนแถว จะได้รู้ว่ายังไม่ได้กรอก */
export const FieldGrid = ({ fields }: { fields: { label: string; value?: ReactNode; full?: boolean; tone?: string }[] }) => (
  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 sm:gap-x-6 gap-y-2.5 sm:gap-y-3 rounded-xl border border-[var(--border)] p-3 sm:p-4">
    {fields.map(f => (
      <div key={f.label} className={`min-w-0 ${f.full ? 'sm:col-span-2' : ''}`}>
        <dt className="text-xs text-[var(--fg-4)]">{f.label}</dt>
        <dd className={`text-sm mt-0.5 break-words [overflow-wrap:anywhere] ${f.tone ?? 'text-[var(--fg-1)]'}`}>{f.value === undefined || f.value === null || f.value === '' ? '-' : f.value}</dd>
      </div>
    ))}
  </dl>
)

export type DocItemRow = { name: string; sub?: string; warn?: string; qty: number; unit?: string; price: number; discount?: string; amount: number }
const money = (n: number) => (n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** ตารางรายการแบบเอกสาร — # · รายการ · จำนวน · หน่วย · ราคา/หน่วย · ส่วนลด · จำนวนเงิน */
//   qtyOnly = เอกสารที่ไม่มีราคา (ใบส่งของ/ค้างส่ง) ซ่อน 3 คอลัมน์เงิน ไม่ใช่โชว์ 0.00
//   ponytail: < 640px ใช้ stacked card แทน table 7 คอลัมน์เพื่อตัดปัญหาจอแคบเลื่อนข้าง
export const ItemsTable = ({ rows, labels, qtyOnly }: {
  rows: DocItemRow[]
  labels: { no: string; item: string; qty: string; unit: string; price: string; discount: string; amount: string; empty: string }
  qtyOnly?: boolean
}) => (
  <div className="rounded-xl border border-[var(--border)] overflow-hidden">
    {/* จอแคบ (< 640px): บล็อกข้อมูลซ้อนกัน กะทัดรัด ไม่ต้องเลื่อนแนวนอน */}
    <div className="sm:hidden divide-y divide-[var(--border)]/60">
      {rows.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-[var(--fg-4)]">{labels.empty}</div>
      ) : rows.map((r, i) => (
        <div key={i} className="p-3 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--fg-1)] break-words">{r.name}</p>
              {r.sub && <p className="text-[11px] text-[var(--fg-4)] break-words">{r.sub}</p>}
              {r.warn && <p className="text-[11px] text-danger break-words">{r.warn}</p>}
            </div>
            <span className="text-[11px] text-[var(--fg-4)] tabular-nums shrink-0">#{i + 1}</span>
          </div>
          {qtyOnly ? (
            <div className="text-xs text-[var(--fg-3)]">
              {(r.qty || 0).toLocaleString('th-TH')}{r.unit ? ` ${r.unit}` : ''}
            </div>
          ) : (
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-[var(--fg-3)] min-w-0 break-words">
                {(r.qty || 0).toLocaleString('th-TH')}{r.unit ? ` ${r.unit}` : ''} × {money(r.price)}
                {r.discount && r.discount !== '-' ? `  −${r.discount}` : ''}
              </span>
              <span className="font-semibold text-sm text-[var(--fg-1)] tabular-nums shrink-0">
                ฿{money(r.amount)}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>

    {/* จอปกติ (>= 640px): ตารางเต็ม 7 คอลัมน์ */}
    <div className="hidden sm:block overflow-x-auto">
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
  </div>
)

/** ยอดรวมชิดขวาแบบท้ายเอกสาร — grand คือบรรทัดหนาสุดท้าย */
export const TotalsBox = ({ rows, grand }: { rows: { label: string; value: number; sign?: '+' | '-' }[]; grand: { label: string; value: number } }) => (
  <div className="w-full flex justify-end">
    <dl className="w-full sm:w-80 text-sm space-y-1.5">
      {rows.map(r => (
        <div key={r.label} className="flex justify-between items-baseline gap-2 text-[var(--fg-3)]">
          <dt className="min-w-0 break-words">{r.label}</dt>
          <dd className="tabular-nums shrink-0">{r.sign === '-' ? '-' : ''}฿{money(r.value)}</dd>
        </div>
      ))}
      <div className="flex justify-between items-baseline gap-2 border-t border-[var(--border)] pt-2 font-bold text-base text-[var(--fg-1)]">
        <dt className="min-w-0 break-words">{grand.label}</dt>
        <dd className="tabular-nums shrink-0">฿{money(grand.value)}</dd>
      </div>
    </dl>
  </div>
)

/** ปุ่มท้ายโมดัล — ใช้ 3 แบบนี้เท่านั้น ห้ามปุ่มพาสเทลหลายสี */
export const btnPrimary = 'px-5 py-2.5 bg-phopy-indigo text-white font-semibold rounded-xl hover:bg-phopy-indigo/80 disabled:opacity-50 flex items-center justify-center gap-2 text-sm whitespace-nowrap min-h-[40px] transition-colors'
export const btnSecondary = 'px-4 py-2.5 border border-[var(--border)] text-[var(--fg-2)] rounded-xl hover:bg-[var(--bg)] disabled:opacity-50 flex items-center justify-center gap-2 text-sm whitespace-nowrap min-h-[40px] transition-colors'
export const btnDanger = 'px-3 py-2 text-danger hover:bg-[var(--danger-soft)] rounded-xl disabled:opacity-50 flex items-center justify-center text-sm whitespace-nowrap min-h-[40px] transition-colors'
export const btnClose = 'px-4 py-2 text-[var(--fg-3)] hover:text-[var(--fg-1)] flex items-center justify-center text-sm whitespace-nowrap min-h-[40px]'

/** ตัวช่วยจัดเลย์เอาต์ท้ายโมดัล: ซ้าย = ปิด/ยกเลิก, ขวา = ปุ่มทำงาน (เต็มแถว/กริิดบนมือถือ) */
export const DocFooter = ({ left, right }: { left?: ReactNode; right?: ReactNode }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 w-full min-w-0">
    {left && <div className="flex items-center gap-2 flex-wrap min-w-0">{left}</div>}
    {right && (
      <div className="flex items-center gap-2 flex-wrap min-w-0 w-full sm:w-auto sm:ml-auto justify-end [&>*]:flex-1 sm:[&>*]:flex-none [&>*]:min-w-[calc(50%-0.5rem)] sm:[&>*]:min-w-0">
        {right}
      </div>
    )}
  </div>
)

/** ข้อความล็อกท้ายโมดัล เช่น "ยืนยันแล้ว แก้ไขไม่ได้" */
export const LockedNote = ({ text }: { text: string }) => (
  <span className="flex items-center gap-1.5 text-xs text-[var(--fg-4)]"><Lock className="w-3.5 h-3.5 shrink-0" />{text}</span>
)
