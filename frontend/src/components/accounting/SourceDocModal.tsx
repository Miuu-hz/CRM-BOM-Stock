import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useModalClose } from '../../hooks/useModalClose'
import { SourceDocSection } from './SourceDocSection'

// โมดัลกลางสำหรับเปิด "เอกสารต้นทาง + สายเอกสาร" จากที่ไหนก็ได้ในระบบ
// (เดิมมีสำเนาเฉพาะกิจอยู่ใน ChartOfAccounts.tsx ชื่อ JournalSourceModal — ย้ายมารวมที่นี่)
export function SourceDocModal({ entryId, kind, refId, title, subtitle, onClose }: {
  entryId?: string
  kind?: string
  refId?: string
  title?: string
  subtitle?: string
  onClose: () => void
}) {
  useModalClose(onClose)
  return (
    <div className="fixed inset-0 bg-[var(--fg-1)]/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-2xl flex flex-col"
        style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="p-5 border-b border-[var(--border)] flex items-start justify-between gap-3 shrink-0">
          <div>
            {title && <p className="text-lg font-bold font-mono text-[var(--primary)]">{title}</p>}
            {subtitle && <p className="text-xs text-[var(--fg-4)]">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="ปิด" className="p-1.5 hover:bg-[var(--surface-2)] rounded-lg text-[var(--fg-3)] shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto phopy-scrollbar">
          <SourceDocSection entryId={entryId} kind={kind} refId={refId} />
        </div>
      </motion.div>
    </div>
  )
}
