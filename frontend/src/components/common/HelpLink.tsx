import { HelpCircle } from 'lucide-react'

export function HelpLink({
  to = '/help/permissions',
  anchor,
  label = 'คำอธิบาย',
}: {
  to?: string
  anchor?: string
  label?: string
}) {
  return (
    <a
      href={to + (anchor ? '#' + anchor : '')}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[var(--fg-4)] hover:text-[var(--primary)] hover:bg-[var(--surface-2)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
    >
      <HelpCircle size={14} />
    </a>
  )
}
