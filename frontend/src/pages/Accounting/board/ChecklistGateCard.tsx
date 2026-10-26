import { useState, useEffect } from 'react'
import { ShieldCheck, ExternalLink } from 'lucide-react'
import { phopyBoardApi, ChecklistResult, ChecklistStatus } from '../../../services/phopyBoard'
import { closeChecklistPeriod } from './period'

const STATUS_CHIPS: Record<ChecklistStatus, { label: string; className: string }> = {
  pass: { label: 'ผ่าน', className: 'bg-[var(--success-soft,#dcfce7)] text-[color:var(--success,#16a34a)]' },
  warn: { label: 'เตือน', className: 'bg-[var(--warning-soft,#fef3c7)] text-[color:var(--warning,#d97706)]' },
  block: { label: 'บล็อก', className: 'bg-[var(--danger-soft,#fee2e2)] text-[color:var(--danger,#dc2626)]' },
  na: { label: 'ไม่เกี่ยว', className: 'bg-[var(--surface-2)] text-[var(--fg-3)]' },
}

interface ChecklistGateCardProps {
  endDate: string
}

export function ChecklistGateCard({ endDate }: ChecklistGateCardProps) {
  const [checklist, setChecklist] = useState<ChecklistResult | null>(null)
  const [loading, setLoading] = useState(false)

  const period = closeChecklistPeriod(endDate)

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      try {
        const res = await phopyBoardApi.getChecklist(period)
        if (active) setChecklist(res.data.data)
      } catch (err) {
        console.error('Failed to load checklist:', err)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [period])

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-[var(--primary)]" />
          <div>
            <h2 className="text-base font-bold text-[var(--fg-1)]">
              ความน่าเชื่อถือข้อมูล {checklist ? checklist.label : '...'}
            </h2>
            <p className="text-xs text-[var(--fg-3)]">
              ด่านตรวจปิดงวด 11 ข้อ · งวด {period}
            </p>
          </div>
        </div>
      </div>

      {loading && !checklist ? (
        <div className="flex justify-center py-10">
          <div className="w-8 h-8 border-4 border-[var(--primary)]/30 border-t-[var(--primary)] rounded-full animate-spin" />
        </div>
      ) : checklist ? (
        <div className="divide-y divide-[var(--border)]">
          {checklist.items.map(item => {
            const chip = STATUS_CHIPS[item.status] || STATUS_CHIPS.na
            return (
              <div key={item.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 first:pt-0 last:pb-0">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${chip.className}`}>
                      {chip.label}
                    </span>
                    <span className="text-sm font-semibold text-[var(--fg-1)] truncate">
                      {item.id}. {item.title}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--fg-3)] leading-relaxed">
                    {item.detail}
                  </p>
                </div>
                {item.link && (
                  <div className="flex-none sm:self-center">
                    <a
                      href={item.link}
                      className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-lg bg-[var(--surface-2)] text-[var(--primary)] hover:border-[var(--primary)] border border-[var(--border)] transition-colors"
                    >
                      <span>เปิดดู</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-[var(--fg-4)] text-center py-4">ไม่สามารถโหลดข้อมูลด่านตรวจได้</p>
      )}
    </div>
  )
}
