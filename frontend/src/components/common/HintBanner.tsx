import { useState, type ReactNode } from 'react'
import { Sparkles, X } from 'lucide-react'

interface HintBannerProps {
  /** Unique id used as the localStorage dismiss key — reuse a stable id per hint. */
  id: string
  title?: string
  children: ReactNode
}

const STORAGE_PREFIX = 'phopy-hint-dismissed:'

/**
 * Small dismissible hint banner. Persists dismissal in localStorage so it
 * doesn't reappear on next visit. Reusable across pages — pass a unique `id`.
 */
export default function HintBanner({ id, title, children }: HintBannerProps) {
  const storageKey = STORAGE_PREFIX + id
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === '1'
    } catch {
      return false
    }
  })

  if (dismissed) return null

  const handleDismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(storageKey, '1')
    } catch {
      // ponytail: localStorage can throw in private-browsing/storage-full edge cases —
      // dismissal just won't persist, banner still closes for this session.
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--primary)]/30 bg-[var(--primary-soft)] px-4 py-3">
      <Sparkles className="w-5 h-5 text-[var(--primary)] shrink-0 mt-0.5" />
      <div className="flex-1 text-sm text-[var(--fg-2)]">
        {title && <p className="font-semibold text-[var(--fg-1)] mb-1">{title}</p>}
        {children}
      </div>
      <button
        onClick={handleDismiss}
        aria-label="ปิดคำแนะนำ"
        className="text-[var(--fg-4)] hover:text-[var(--fg-1)] transition-colors shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
